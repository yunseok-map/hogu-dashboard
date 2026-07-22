import './src/env.js'; // ⚠ 최상단: 환경(.env.<qa|prod> → .env) 로드 후 다른 모듈이 env를 읽음
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProduct, buildSearchQuery } from './src/search/productParser.js';
import { closeBrowser, cdpStatus } from './src/crawl/browserFetch.js';
import { searchSimilar } from './src/search/searchProviders.js';
import { judge } from './src/verdict.js';
import {
  listHistory, saveResult, getResult, deleteResult, recordPricePoint, readPriceSeriesByHash,
  readDeals, saveDeals, dealsStale, listWatch, addWatch, removeWatch, isWatched, markWatchSampled,
} from './src/store.js';
import { collectHistoryDeals, collectCrawledDeals, mergeDeals } from './src/deals/collect.js';
import { ENV, IS_PROD } from './src/env.js';
import { rateLimitMw, hitRateLimit, clientIp, acquireSlot, releaseSlot, checkCrawlUrl, adminGuard, isAdmin, guardStatus } from './src/guard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.set('trust proxy', true); // Cloudflare Tunnel 뒤 실제 IP 신뢰
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = Number(process.env.PORT || 3311);
// 히스토리 목록 공개 여부 — prod에선 기본 비공개(프라이버시). HOGU_PUBLIC_HISTORY=1로 공개 전환.
const publicHistoryEnabled = () => !IS_PROD || process.env.HOGU_PUBLIC_HISTORY === '1';

/**
 * 분석 파이프라인. onProgress(step, detail)로 진행 상황을 알린다.
 * @param {{url?: string, query?: string, priceOverride?: number}} input
 */
async function analyze(input, onProgress = () => {}) {
  const started = Date.now();
  let product = null;
  let query = (input.query || '').trim();

  if (input.url) {
    onProgress('crawl', '상품 페이지 크롤링 중…');
    product = await parseProduct(input.url);
    if (input.priceOverride) {
      product.price = Math.round(input.priceOverride);
      product.warnings.push('가격은 사용자가 직접 입력한 값입니다.');
    }
    if (!product.ok && !query) {
      return { ok: false, error: product.error, product, elapsedMs: Date.now() - started };
    }
    query = query || buildSearchQuery(product.title);
  } else if (query) {
    product = {
      title: query, price: input.priceOverride ? Math.round(input.priceOverride) : null,
      originalPrice: null, image: null, brand: null, mall: null,
      rating: null, reviewCount: null, reviews: [], promos: [], url: null,
      source: 'keyword', warnings: ['키워드 검색 모드 — 원본 상품 페이지 없이 시세만 조회합니다.'], ok: true,
    };
  } else {
    return { ok: false, error: 'url 또는 query 중 하나는 필요합니다.' };
  }

  onProgress('search', input.deep
    ? `유사 상품 + 메이저몰(SSG·11번가·옥션·G마켓) 검색 중… (검색어: ${query})`
    : `유사 상품 검색 중… (검색어: ${query})`);
  const similar = await searchSimilar(query, product.title, { deep: !!input.deep });

  onProgress('judge', `가격 ${similar.items.filter((i) => i.price).length}건 비교·판정 중…`);
  const verdict = judge(product, similar.items);

  const result = {
    ok: true,
    product,
    query,
    similar,
    verdict,
    reviewSearchLinks: buildReviewLinks(product.title || query),
    analyzedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
  };

  // 가격 히스토리(일자별) 패시브 적립 — 실패해도 분석 흐름은 유지
  try {
    const s = verdict.stats;
    if (product.price != null || s) {
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const point = {
        date, ts: now.toISOString(),
        myPrice: product.price ?? null,
        min: s?.min ?? null, median: s?.median ?? null, avg: s?.avg ?? null, max: s?.max ?? null, count: s?.count ?? 0,
        score: verdict.score ?? null, tier: verdict.tier ?? null,
      };
      const rec = recordPricePoint(query, point, product.title || query);
      if (rec) { result.priceKey = rec.hash; result.priceHistory = rec.points; }
    }
  } catch { /* 히스토리 적립 실패는 무시 */ }

  result.watched = isWatched(query);

  onProgress('save', '결과 저장 중…');
  result.id = saveResult(result);
  return result;
}

function buildReviewLinks(title) {
  if (!title) return [];
  const q = encodeURIComponent(title);
  const qReview = encodeURIComponent(title + ' 후기');
  const links = [
    { name: '구글 후기 검색', url: `https://www.google.com/search?q=${qReview}` },
    { name: '네이버 블로그 후기', url: `https://search.naver.com/search.naver?ssc=tab.blog.all&query=${qReview}` },
    { name: '네이버 쇼핑 가격비교', url: `https://search.shopping.naver.com/search/all?query=${q}` },
    { name: '다나와 검색', url: `https://search.danawa.com/dsearch.php?query=${q}` },
    { name: '유튜브 리뷰', url: `https://www.youtube.com/results?search_query=${qReview}` },
  ];
  // 브랜드 공식몰 바로가기 (검색 크롤링은 지연 렌더로 불가 — 링크로 보완)
  if (/삼성|samsung|갤럭시|galaxy|비스포크/i.test(title)) {
    links.push({ name: '삼성닷컴 공식몰', url: `https://www.samsung.com/sec/search/?searchvalue=${q}` });
  }
  if (/\blg\b|엘지|그램\b|올레드|oled|스탠바이미|퓨리케어|트롬|휘센|디오스/i.test(title)) {
    links.push({ name: 'LG전자 공식몰', url: `https://www.lge.co.kr/search?search=${q}` });
  }
  return links;
}

/** 관심상품 전체를 재분석해 가격점을 적립(수동 refresh·스케줄러 공용). 개별 실패는 무시. */
async function refreshWatched() {
  const done = [];
  for (const w of listWatch()) {
    try {
      const input = w.url
        ? { url: w.url, priceOverride: w.priceOverride ?? undefined, deep: !!w.deep }
        : { query: w.query || w.key, priceOverride: w.priceOverride ?? undefined, deep: !!w.deep };
      await analyze(input);
      markWatchSampled(w.key);
      done.push(w.key);
    } catch { /* 개별 관심상품 실패 무시 */ }
  }
  return done;
}

// ---- API ----

// SSE 스트리밍 분석 (프런트 기본 경로)
app.get('/api/analyze/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const input = {
    url: req.query.url || undefined,
    query: req.query.query || undefined,
    priceOverride: req.query.price ? Number(req.query.price) : undefined,
    deep: req.query.deep === '1',
  };

  // 공개(prod) 방어: 레이트리밋 → SSRF URL 검사 → 전역 동시성 캡
  const rl = hitRateLimit('analyze', clientIp(req));
  if (!rl.ok) { send('result', { ok: false, error: `요청이 많습니다. ${rl.retry}초 후 다시 시도해 주세요.` }); return res.end(); }
  if (input.url) {
    const chk = await checkCrawlUrl(String(input.url));
    if (!chk.ok) { send('result', { ok: false, error: chk.reason }); return res.end(); }
  }
  if (!acquireSlot()) { send('result', { ok: false, error: '지금 검사 요청이 몰려 있습니다. 잠시 후 다시 시도해 주세요.' }); return res.end(); }

  try {
    const result = await analyze(input, (step, detail) => send('progress', { step, detail }));
    send('result', result);
  } catch (e) {
    send('result', { ok: false, error: '분석 중 오류: ' + String(e.message || e) });
  } finally {
    releaseSlot();
  }
  res.end();
});

// 단발 POST 분석 (curl/스크립트용)
app.post('/api/analyze', rateLimitMw('analyze'), async (req, res) => {
  const body = req.body || {};
  if (body.url) {
    const chk = await checkCrawlUrl(String(body.url));
    if (!chk.ok) return res.status(400).json({ ok: false, error: chk.reason });
  }
  if (!acquireSlot()) return res.status(429).json({ ok: false, error: '검사 요청이 많습니다. 잠시 후 다시 시도해 주세요.' });
  try {
    const result = await analyze(body);
    res.status(result.ok ? 200 : 422).json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  } finally {
    releaseSlot();
  }
});

// 목록: prod 비공개 시 관리자만(공유용 개별 /api/history/:id 는 유지)
app.get('/api/history', (req, res) => res.json(publicHistoryEnabled() || isAdmin(req) ? listHistory() : []));
app.get('/api/history/:id', (req, res) => {
  const r = getResult(req.params.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json(r);
});
app.delete('/api/history/:id', adminGuard, (req, res) => res.json({ ok: deleteResult(req.params.id) }));

// 가격 히스토리(일자별 시계열) — 저장된 결과 재오픈 시 최신 series 재조회용
app.get('/api/price-history/:key', (req, res) => res.json({ points: readPriceSeriesByHash(req.params.key) }));

// ---- 핫딜 레이더 (2트랙: 검색기반 백본 + 키워드/공홈 크롤 캐시) ----
const DEALS_TTL_MS = 30 * 60 * 1000; // 크롤 캐시 30분 지연 갱신
let dealsRefreshing = false;
let kwOffset = 0; // 매 갱신마다 다른 키워드 훑기

/** 크롤 소스(키워드[+공홈])를 백그라운드로 갱신해 캐시에 저장. 중복 실행 방지. */
async function kickDealsRefresh({ malls = false } = {}) {
  if (dealsRefreshing) return;
  dealsRefreshing = true;
  try {
    const crawled = await collectCrawledDeals({ malls, deep: true, offset: kwOffset, max: 5 });
    kwOffset += 5;
    // malls 미크롤 시 기존 공홈 딜은 보존
    const prevMall = malls ? [] : (readDeals().items || []).filter((d) => d.source === '공홈');
    saveDeals(mergeDeals([], [...crawled, ...prevMall]));
  } catch { /* 갱신 실패 무시 */ } finally { dealsRefreshing = false; }
}

// 즉시 반환: 백본(신선·빠름) + 캐시(키워드/공홈). stale이면 백그라운드 갱신을 걸어둔다.
app.get('/api/deals', (_req, res) => {
  const cache = readDeals();
  if (dealsStale(DEALS_TTL_MS)) kickDealsRefresh({ malls: false });
  res.json({ updatedAt: cache.updatedAt, items: mergeDeals(collectHistoryDeals(), cache.items), refreshing: dealsRefreshing });
});

// 강제 갱신(비블로킹) — ?malls=1 이면 공홈 레지스트리 크롤 포함. 진행은 백그라운드. (prod: 관리자)
app.post('/api/deals/refresh', adminGuard, (req, res) => {
  kickDealsRefresh({ malls: req.query.malls === '1' || (req.body && req.body.malls === true) });
  res.json({ ok: true, refreshing: true });
});

// ---- 관심상품(watch) ----
app.get('/api/watch', (_req, res) => res.json(listWatch()));
app.post('/api/watch', adminGuard, (req, res) => {
  const b = req.body || {};
  const key = b.query || b.key;
  if (!key) return res.status(400).json({ error: 'query 필요' });
  const list = addWatch(key, { label: b.label || key, query: b.query || null, url: b.url || null, priceOverride: b.priceOverride ?? null, deep: !!b.deep });
  res.json({ watched: true, list });
});
app.post('/api/watch/remove', adminGuard, (req, res) => {
  const b = req.body || {};
  res.json({ watched: false, list: removeWatch(b.query || b.key || '') });
});
// 관심상품 즉시 재수집(가격점 적립) — 수동/스케줄러 공용 (prod: 관리자)
app.post('/api/watch/refresh', adminGuard, async (_req, res) => {
  try { res.json({ ok: true, sampled: await refreshWatched() }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

app.get('/api/health', async (_req, res) =>
  res.json({
    ok: true,
    env: ENV,
    guard: guardStatus(),
    publicHistory: publicHistoryEnabled(),
    naverApi: !!(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET),
    cdp: await cdpStatus(),
  })
);

// 옵션 스케줄러 — env HOGU_REFRESH_MIN(분)마다 딜(공홈 포함)+관심상품 재수집. 기본 off.
const REFRESH_MIN = Number(process.env.HOGU_REFRESH_MIN || 0);
if (REFRESH_MIN > 0) {
  setInterval(() => {
    kickDealsRefresh({ malls: true });
    refreshWatched().catch(() => {});
  }, REFRESH_MIN * 60 * 1000).unref();
  console.log(`[hogu] 스케줄러 ON — ${REFRESH_MIN}분마다 딜(공홈 포함)·관심상품 재수집`);
}
// 시작 시 크롤 캐시가 비었/오래됐으면 백그라운드로 키워드 딜 예열(비블로킹)
if (dealsStale(DEALS_TTL_MS)) kickDealsRefresh({ malls: false });

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => { await closeBrowser(); process.exit(0); });
}

app.listen(PORT, () => {
  console.log(`[hogu] 호구 방지 대시보드 [${ENV.toUpperCase()}] → http://localhost:${PORT}`);
  if (IS_PROD) console.log(`[hogu] 운영 모드: 레이트리밋·동시성캡·SSRF차단·관리자게이트 ${process.env.HOGU_ADMIN_TOKEN ? 'ON' : '(⚠ HOGU_ADMIN_TOKEN 미설정 — 관리 엔드포인트 잠김)'}`);
  console.log(`[hogu] 네이버 쇼핑 API: ${process.env.NAVER_CLIENT_ID ? '활성' : '비활성 (.env 설정 시 정확도 상승)'}`);
});

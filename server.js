import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseProduct, buildSearchQuery } from './src/search/productParser.js';
import { closeBrowser, cdpStatus } from './src/crawl/browserFetch.js';
import { searchSimilar } from './src/search/searchProviders.js';
import { judge } from './src/verdict.js';
import { listHistory, saveResult, getResult, deleteResult } from './src/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env 로드 (dotenv 없이 — 의존성 최소화)
try {
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
    if (m && !m[1].startsWith('#') && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* .env 없음 — 선택 사항 */ }

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = Number(process.env.PORT || 3311);

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
  try {
    const result = await analyze(input, (step, detail) => send('progress', { step, detail }));
    send('result', result);
  } catch (e) {
    send('result', { ok: false, error: '분석 중 오류: ' + String(e.message || e) });
  }
  res.end();
});

// 단발 POST 분석 (curl/스크립트용)
app.post('/api/analyze', async (req, res) => {
  try {
    const result = await analyze(req.body || {});
    res.status(result.ok ? 200 : 422).json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.get('/api/history', (_req, res) => res.json(listHistory()));
app.get('/api/history/:id', (req, res) => {
  const r = getResult(req.params.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json(r);
});
app.delete('/api/history/:id', (req, res) => res.json({ ok: deleteResult(req.params.id) }));

app.get('/api/health', async (_req, res) =>
  res.json({
    ok: true,
    naverApi: !!(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET),
    cdp: await cdpStatus(),
  })
);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => { await closeBrowser(); process.exit(0); });
}

app.listen(PORT, () => {
  console.log(`[hogu] 호구 방지 대시보드 → http://localhost:${PORT}`);
  console.log(`[hogu] 네이버 쇼핑 API: ${process.env.NAVER_CLIENT_ID ? '활성' : '비활성 (.env 설정 시 정확도 상승)'}`);
});

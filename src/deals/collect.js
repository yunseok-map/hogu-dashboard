// 핫딜 레이더 수집기.
// 신뢰 백본 = 저장된 분석 결과에서 이 앱이 이미 계산한 "실제 딜"(better-deal·쿠폰·파격가)을 추출.
// (옵션) 공홈 레지스트리 크롤을 얹어 병합. 딜 카드 shape는 registry.js와 동일.
import { listHistory, getResult, historyVersion } from '../store.js';

const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';

/** 분석 결과 1건 → 딜 카드 배열(better-deal + 절약 큰 대안). */
export function dealsFromResult(result) {
  const v = result?.verdict;
  if (!v) return [];
  const cap = result.analyzedAt || null;
  const q = result.query || result.product?.title || '';
  const out = [];

  const dp = v.dealPitch;
  if (dp && dp.kind === 'better-deal' && dp.best) {
    const b = dp.best;
    const price = b.effPrice ?? b.price ?? null;
    const orig = (b.price != null && price != null && b.price > price) ? b.price : null;
    const discountPct = (orig && price) ? Math.round((1 - price / orig) * 100)
      : (b.discount > 0 && b.price ? Math.round((b.discount / b.price) * 100) : null);
    out.push({
      title: b.title || q, mall: b.mall || b.provider || '', url: b.link || null,
      price, origPrice: orig, discountPct, savings: b.savingsVsMine || b.savingsVsMedian || null,
      badges: (b.promos || []).concat(b.discount > 0 ? [`쿠폰 -${won(b.discount)}`] : []),
      source: 'analysis', capturedAt: cap, query: q,
    });
  }

  for (const a of (v.alternatives || [])) {
    if (!(a.savings > 0) && !(a.discount > 0)) continue;
    const price = a.effPrice ?? a.price ?? null;
    const orig = (a.price != null && a.effPrice != null && a.price > a.effPrice) ? a.price : null;
    const discountPct = (orig && price) ? Math.round((1 - price / orig) * 100) : null;
    out.push({
      title: a.title || q, mall: a.mall || a.provider || '', url: a.link || null,
      price, origPrice: orig, discountPct, savings: a.savings || null,
      badges: (a.promos || []).concat(a.discount > 0 ? [`쿠폰 -${won(a.discount)}`] : []),
      source: 'analysis', capturedAt: cap, query: q,
    });
  }
  return out;
}

const dealKey = (d) => d.url || `${d.title}|${d.mall}`;

function dedupe(deals) {
  const seen = new Set();
  return deals.filter((d) => { const k = dealKey(d); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** "핫딜"으로 노출할 가치가 있는지 — 할인율 10%↑ 또는 절약 2만원↑ 또는 쿠폰/이벤트 배지. */
function qualifies(d) {
  return (d.discountPct >= 10) || (d.savings >= 20000) || (d.badges && d.badges.length > 0);
}

// 백본 메모: 히스토리(버전)가 바뀔 때만 재계산. /api/deals 폴링마다 결과 파일 수십 개를 재스캔하던 비용 제거.
// (14일 만료 컷오프가 오래 고정되지 않도록 버전이 그대로여도 10분마다는 재평가)
let _backboneMemo = { ver: -1, limit: -1, at: 0, deals: null };
const BACKBONE_MEMO_MAX_MS = 10 * 60 * 1000;

/** 저장된 최근 분석에서 딜 백본 수집(브라우저 없음, 빠름·신뢰). */
export function collectHistoryDeals(limit = 40) {
  const ver = historyVersion();
  if (_backboneMemo.deals && _backboneMemo.ver === ver && _backboneMemo.limit === limit
      && Date.now() - _backboneMemo.at < BACKBONE_MEMO_MAX_MS) return _backboneMemo.deals;

  const ids = listHistory().slice(0, limit).map((h) => h.id);
  let deals = [];
  for (const id of ids) {
    const r = getResult(id);
    if (r) deals.push(...dealsFromResult(r));
  }
  deals = dedupe(deals.filter(qualifies));
  const cutoff = Date.now() - 14 * 864e5; // 14일 지난 딜은 만료
  deals = deals.filter((d) => !d.capturedAt || new Date(d.capturedAt).getTime() >= cutoff);
  deals.sort((a, b) => (b.discountPct || 0) - (a.discountPct || 0) || (b.savings || 0) - (a.savings || 0));
  const out = deals.slice(0, 24);
  _backboneMemo = { ver, limit, at: Date.now(), deals: out };
  return out;
}

/** 백본(검색기반) + 캐시(키워드/공홈)를 합쳐 노출용으로 정리. */
export function mergeDeals(backbone, cached) {
  return dedupe([...(cached || []), ...(backbone || [])]).slice(0, 40);
}

/**
 * 크롤 소스(느림) 수집: 키워드 자동 딜 [+ 옵션 공홈 레지스트리]. 스케줄러/수동 refresh 전용.
 * @param {{malls?:boolean, deep?:boolean, offset?:number, max?:number}} opts
 */
export async function collectCrawledDeals({ malls = false, deep = true, offset = 0, max = 5 } = {}) {
  let kw = [];
  try { const { collectKeywordDeals } = await import('./keywords.js'); kw = await collectKeywordDeals({ deep, offset, max }); }
  catch { /* 키워드 크롤 실패 무시 */ }
  let mall = [];
  if (malls) {
    try { const { crawlMallDeals } = await import('./registry.js'); mall = await crawlMallDeals(); }
    catch { /* 공홈 크롤 실패 무시 */ }
  }
  return dedupe([...kw, ...mall]);
}

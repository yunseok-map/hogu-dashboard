// 키워드 자동 딜 수집 — 앱이 고른 인기 키워드로 기존 검색 파이프라인(searchSimilar)을 돌려
// "시세 대비 파격가/쿠폰" 상품을 뽑는다. 오픈마켓(다나와·에누리 집계 + deep 시 11번가·G마켓·옥션·SSG)을
// 그대로 재사용하므로 딜 페이지 스크래핑보다 견고. 매번 로테이션으로 다른 키워드를 훑는다.
import { searchSimilar } from '../search/searchProviders.js';

// 큐레이션: 가격 경쟁이 치열하고 특가가 잦은 실용 소비재 위주.
export const KEYWORDS = [
  '에어팟 프로 2', '갤럭시 버즈3 프로', '다이슨 에어랩', '닌텐도 스위치 2',
  '삼성 T7 SSD 1TB', '로지텍 MX 마스터 3S', '스탠리 퀜처 텀블러', 'LG 그램 2025',
  '아이패드 에어', '샤오미 로봇청소기', '필립스 에어프라이어', '브라운 실크에페일',
];

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/** KEYWORDS에서 offset부터 n개를 순환 선택(매 갱신마다 다른 키워드를 훑기 위함). */
function rotate(offset, n) {
  const len = KEYWORDS.length;
  return Array.from({ length: Math.min(n, len) }, (_, i) => KEYWORDS[(offset + i) % len]);
}

/**
 * 키워드별 최고 딜 카드 배열. 시세(중앙값) 대비 15%↑ 싸거나 쿠폰이 붙은 최저가를 채택.
 * @param {{deep?:boolean, max?:number, offset?:number}} opts
 */
export async function collectKeywordDeals({ deep = false, max = 6, offset = 0 } = {}) {
  const out = [];
  for (const kw of rotate(offset, max)) {
    try {
      const { items = [] } = await searchSimilar(kw, kw, { deep });
      // 실제 상품만: 부속품 배제 + 유사도 0.45↑ (케이스/필터/거치대 등이 파격딜로 오인되는 것 방지)
      const priced = items.filter((i) => i.price > 0 && !i.accessory && i.similarity >= 0.45);
      if (priced.length < 3) continue;
      const med = median(priced.map((i) => i.price));
      // 후보: 쿠폰이 있거나 정제 시세보다 20%↑ 싼 최저가. med*0.45 미만·할인 65% 초과는 오인 컷.
      const cand = priced
        .filter((i) => i.price >= med * 0.45 && (i.price <= med * 0.80 || (i.promos && i.promos.length)))
        .sort((a, b) => a.price - b.price)[0];
      if (!cand) continue;
      const discountPct = cand.price < med ? Math.round((1 - cand.price / med) * 100) : null;
      // 실제 가격인하 프로모만 인정(무료배송/기획전/적립 제외)
      const realPromos = (cand.promos || []).filter((p) => /쿠폰|할인|[%％]|원\s*↓|특가|딜|세일|즉시/.test(p) && !/무료\s*배송|배송비|적립|기획전/.test(p));
      // 딜 인정 조건: 실인하 쿠폰 있음 OR 시세보다 15%↑ 저렴. 비현실적(>65%)은 오인 컷.
      if (!realPromos.length && (discountPct == null || discountPct < 15)) continue;
      if (discountPct != null && discountPct > 65) continue;
      out.push({
        title: cand.title, mall: cand.mall || cand.provider || '', url: cand.link || null,
        price: cand.price, origPrice: null, discountPct,
        savings: Math.max(0, Math.round(med - cand.price)),
        badges: (realPromos.length ? realPromos : (cand.promos || [])).slice(0, 2),
        source: '키워드', keyword: kw, capturedAt: new Date().toISOString(),
      });
    } catch { /* 개별 키워드 실패 무시 */ }
  }
  return out;
}

export const KEYWORD_COUNT = KEYWORDS.length;

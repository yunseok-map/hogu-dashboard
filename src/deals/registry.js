// 공홈 딜 소스 레지스트리 (베스트에포트) — 몰마다 크롤 → 공구/특가/기획전 딜 카드로 정규화.
// 정형 파싱이 어려운 공홈이 많아(§HANDOFF 6) "되는 몰만" 등록한다. 실패는 조용히 빈 배열.
// 딜 카드 shape: { title, mall, url, price, origPrice, discountPct, savings, badges[], source:'공홈', capturedAt }
import * as cheerio from 'cheerio';
import { browserFetchPage } from '../crawl/browserFetch.js';

/** 배너 파일명/빈 문자열 등 쓰레기 제목 걸러내기. */
function cleanTitle(t) {
  t = String(t || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length < 4) return null;
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(t)) return null;   // 배너 이미지 파일명
  if (/^\d+$/.test(t)) return null;
  return t.slice(0, 60);
}

/** 쿠쿠 공식몰(cuckoo.co.kr) — 기획전(공구·특가) 링크 수집. 실측: 크롬+스크롤로 렌더됨. */
async function cuckoo() {
  const r = await browserFetchPage('https://www.cuckoo.co.kr/', { timeoutMs: 18000, scroll: true, warmup: false });
  const $ = cheerio.load(r.html || '');
  const seen = new Set(); const out = [];
  $('a[href*="planningView"]').each((_, a) => {
    const href = ($(a).attr('href') || '');
    const url = href.startsWith('http') ? href : ('https://www.cuckoo.co.kr' + href);
    const title = cleanTitle($(a).attr('title') || $(a).find('img[alt]').attr('alt') || $(a).text());
    if (!title) return;
    const k = url.split('&')[0];
    if (seen.has(k)) return; seen.add(k);
    out.push({ title, mall: '쿠쿠 공식몰', url, price: null, origPrice: null, discountPct: null, savings: null, badges: ['기획전'], source: '공홈', capturedAt: new Date().toISOString() });
  });
  return out.slice(0, 8);
}

// 등록된 공홈 소스. 새 몰은 여기 { id, name, run } 한 줄 + 파서만 추가하면 된다.
export const MALLS = [
  { id: 'cuckoo', name: '쿠쿠', run: cuckoo },
];

/** 등록 몰을 순차 크롤(브라우저 공유라 순차). 각 몰 타임아웃 가드, 실패는 무시. */
export async function crawlMallDeals() {
  const all = [];
  for (const m of MALLS) {
    try {
      const items = await Promise.race([
        m.run(),
        new Promise((res) => setTimeout(() => res([]), 26000)),
      ]);
      if (Array.isArray(items)) all.push(...items);
    } catch { /* 몰 크롤 실패 무시 */ }
  }
  return all;
}

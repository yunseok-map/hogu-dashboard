// 신규 쇼핑몰 크롤링 가능성 정찰 도구 — 몰마다 즉시 출력(행 방지), 실제 Chrome+스크롤.
// 가격 hit 수와 상품 컨테이너 클래스를 보고 파서를 붙일지 판단한다. 원본 HTML 미출력.
// 사용법: node tools/mall-probe.mjs [검색어] [몰이름...]
//   예) node tools/mall-probe.mjs "아이폰 15 케이스" gmarket auction
import * as cheerio from 'cheerio';
import { browserFetchPage, closeBrowser } from '../src/crawl/browserFetch.js';

const args = process.argv.slice(2);
const q = args.find((a) => /[가-힣]/.test(a) || a.includes(' ')) || '아이폰 15 케이스';
const only = args.filter((a) => a !== q);
const enc = encodeURIComponent(q);

// 후보 몰. browser.* 서브도메인은 CDP goto가 행 걸리니 정규 호스트 사용.
const MALLS = {
  auction:     `https://www.auction.co.kr/n/search?keyword=${enc}`,
  gmarket:     `https://www.gmarket.co.kr/n/search?keyword=${enc}`,
  ssg:         `https://www.ssg.com/search.ssg?target=all&query=${enc}`,
  st11:        `https://search.11st.co.kr/pc/total-search?kwd=${enc}&tabId=TOTAL_SEARCH`,
  lotteon:     `https://www.lotteon.com/search/search/search.ecn?render=search&mallId=1&query=${enc}`,
  tmon:        `https://search.tmon.co.kr/search/?keyword=${enc}`,
  wemakeprice: `https://front.wemakeprice.com/search/${enc}`,
  gsshop:      `https://with.gsshop.com/search/searchSect.gs?tq=${enc}`,
  homeplus:    `https://front.homeplus.co.kr/search?entryText=${enc}`,
};

function analyze(html) {
  const $ = cheerio.load(html);
  const cls = {};
  $('*').each((_, el) => {
    const t = $(el).clone().children().remove().end().text().trim();
    if (/^[\d,]{5,}\s*원?$/.test(t)) {
      let p = el.parent;
      for (let i = 0; i < 4 && p; i++) {
        const c = ($(p).attr('class') || '').trim().split(/\s+/)[0];
        if (c) cls[c] = (cls[c] || 0) + 1;
        p = p.parent;
      }
    }
  });
  return {
    len: html.length,
    priceHits: (html.match(/[\d,]{4,}\s*원/g) || []).length,
    nextData: html.includes('__NEXT_DATA__'),
    topClasses: Object.entries(cls).sort((a, b) => b[1] - a[1]).slice(0, 4),
  };
}

const entries = Object.entries(MALLS).filter(([n]) => !only.length || only.includes(n));
for (const [name, url] of entries) {
  let res;
  try {
    const r = await Promise.race([
      browserFetchPage(url, { timeoutMs: 22000, scroll: true, warmup: false }),
      new Promise((resolve) => setTimeout(() => resolve({ html: '', status: -1, error: 'outer-timeout 30s' }), 30000)),
    ]);
    res = { status: r.status, engine: r.engine, title: (r.html.match(/<title>([^<]*)</) || [])[1]?.slice(0, 30) ?? null, ...analyze(r.html || ''), err: r.error ?? null };
  } catch (e) {
    res = { error: String(e.message || e).slice(0, 70) };
  }
  console.log(name + '\t' + JSON.stringify(res));
}
await closeBrowser();
process.exit(0);

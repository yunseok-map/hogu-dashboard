#!/usr/bin/env node
// 토큰 절약용 검색 프로브: 검색어 하나로 3개 제공자를 돌리고 "집계 요약"만 출력한다.
// 사용법: node tools/search-probe.mjs <검색어> [--full]  (--full: 상위 5개 아이템 상세)
import { searchSimilar } from '../src/search/searchProviders.js';
import { judge } from '../src/verdict.js';

const args = process.argv.slice(2);
const full = args.includes('--full');
const deep = args.includes('--deep');
const query = args.filter((a) => !a.startsWith('--')).join(' ');
if (!query) {
  console.error('usage: node tools/search-probe.mjs <query> [--full] [--deep]');
  process.exit(1);
}

const r = await searchSimilar(query, query, { deep });
const priced = r.items.filter((i) => i.price);
const verdict = judge({ title: query, price: null, rating: null, reviewCount: null }, r.items);

const compact = {
  query,
  providers: r.providers,
  totalItems: r.items.length,
  pricedItems: priced.length,
  webResults: r.webResults.length,
  priceStats: verdict.stats,
  ratedItems: r.items.filter((i) => i.rating != null).length,
  top5: r.items.slice(0, 5).map((i) => ({
    t: i.title.slice(0, 50), p: i.price, sim: i.similarity, prov: i.provider,
    ...(full ? { rating: i.rating, rc: i.reviewCount, mall: i.mall, link: i.link.slice(0, 80) } : {}),
  })),
};
console.log(JSON.stringify(compact, null, 1));
if (deep) { const { closeBrowser } = await import('../src/crawl/browserFetch.js'); await closeBrowser(); }

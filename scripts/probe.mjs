#!/usr/bin/env node
// 토큰 절약용 크롤링 프로브: 상품 URL 하나를 파싱해 "압축 요약 JSON"만 출력한다.
// 원본 HTML을 절대 출력하지 않으므로 LLM 개발 세션에서 저비용으로 파서를 검증할 수 있다.
// 사용법: node scripts/probe.mjs <상품URL>
import { parseProduct, buildSearchQuery } from '../lib/productParser.js';
import { closeBrowser } from '../lib/browserFetch.js';

const url = process.argv[2];
if (!url) {
  console.error('usage: node scripts/probe.mjs <product-url>');
  process.exit(1);
}

const p = await parseProduct(url);
const compact = {
  ok: p.ok,
  source: p.source,
  title: p.title?.slice(0, 80) ?? null,
  price: p.price,
  originalPrice: p.originalPrice,
  rating: p.rating,
  reviewCount: p.reviewCount,
  reviewsExtracted: p.reviews.length,
  firstReview: p.reviews[0]?.text?.slice(0, 60) ?? null,
  mall: p.mall,
  brand: p.brand,
  hasImage: !!p.image,
  searchQuery: buildSearchQuery(p.title),
  warnings: p.warnings,
  error: p.error ?? null,
};
console.log(JSON.stringify(compact, null, 1));
await closeBrowser(); // 자동 실행한 Chrome 정리

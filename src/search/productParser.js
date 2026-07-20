import * as cheerio from 'cheerio';
import { fetchPage } from '../crawl/fetchPage.js';
import { browserFetchPage } from '../crawl/browserFetch.js';
import { extractPromos, extractSpecs, STOP } from './searchProviders.js';

/**
 * 상품 페이지 파싱 결과 표준 형태
 * @typedef {Object} ProductInfo
 * @property {string} title
 * @property {number|null} price        현재 판매가
 * @property {number|null} originalPrice 정가(할인 전)
 * @property {string|null} image
 * @property {string|null} brand
 * @property {string|null} mall         판매처/쇼핑몰 이름
 * @property {number|null} rating       평점 (5점 만점)
 * @property {number|null} reviewCount
 * @property {Array<{text:string, rating:number|null, author:string|null}>} reviews
 * @property {string} url
 * @property {string} source            파싱에 사용된 어댑터 이름
 * @property {string[]} warnings
 */

const num = (v) => {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

const cleanText = (s) =>
  String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** 객체 트리를 깊이 우선으로 돌며 predicate를 만족하는 첫 값을 찾는다. */
function deepFind(obj, predicate, depth = 0, seen = new Set()) {
  if (obj == null || depth > 12 || typeof obj !== 'object' || seen.has(obj)) return undefined;
  seen.add(obj);
  for (const [k, v] of Object.entries(obj)) {
    try {
      if (predicate(k, v)) return v;
    } catch { /* predicate 오류 무시 */ }
    if (v && typeof v === 'object') {
      const found = deepFind(v, predicate, depth + 1, seen);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** <script type="application/ld+json"> 블록 전부 파싱 */
function parseJsonLd($) {
  const blocks = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw.trim());
      blocks.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch { /* 잘못된 JSON-LD는 건너뜀 */ }
  });
  // @graph 평탄화
  const flat = [];
  for (const b of blocks) {
    flat.push(b);
    if (Array.isArray(b?.['@graph'])) flat.push(...b['@graph']);
  }
  return flat;
}

function fromJsonLd($, out) {
  const nodes = parseJsonLd($);
  const product = nodes.find((n) => {
    const t = n?.['@type'];
    return t === 'Product' || (Array.isArray(t) && t.includes('Product'));
  });
  if (!product) return false;

  out.title = out.title || cleanText(product.name);
  out.image = out.image || (Array.isArray(product.image) ? product.image[0] : product.image) || null;
  out.brand = out.brand || cleanText(product.brand?.name || product.brand) || null;

  const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
  if (offers) {
    out.price = out.price ?? num(offers.price ?? offers.lowPrice);
    out.mall = out.mall || cleanText(offers.seller?.name) || null;
  }
  const agg = product.aggregateRating;
  if (agg) {
    const r = Number(agg.ratingValue);
    out.rating = out.rating ?? (Number.isFinite(r) ? Math.min(5, r) : null);
    out.reviewCount = out.reviewCount ?? num(agg.reviewCount ?? agg.ratingCount);
  }
  const reviews = Array.isArray(product.review) ? product.review : product.review ? [product.review] : [];
  for (const rv of reviews.slice(0, 20)) {
    const text = cleanText(rv.reviewBody || rv.description);
    if (text) {
      out.reviews.push({
        text,
        rating: Number(rv.reviewRating?.ratingValue) || null,
        author: cleanText(rv.author?.name || rv.author) || null,
      });
    }
  }
  return true;
}

function fromOpenGraph($, out) {
  const og = (p) => $(`meta[property="${p}"]`).attr('content') || $(`meta[name="${p}"]`).attr('content');
  out.title = out.title || cleanText(og('og:title')) || null;
  out.image = out.image || og('og:image') || null;
  out.price = out.price ?? num(og('product:price:amount') || og('og:price:amount'));
  out.mall = out.mall || cleanText(og('og:site_name')) || null;
  // itemprop 백업
  out.price = out.price ?? num($('[itemprop="price"]').attr('content') || $('[itemprop="price"]').first().text());
  return !!out.title;
}

/** 페이지 내 인라인 JSON에서 가격/평점 흔적을 찾는 최후 수단 */
function fromInlineJson(html, out) {
  if (out.price == null) {
    const m =
      html.match(/"(?:salePrice|discountedSalePrice|finalPrice|sellingPrice|lowestPrice|dealPrice)"\s*:\s*\{?\s*"?(?:price"?\s*:\s*)?(\d{3,9})/) ||
      html.match(/"price"\s*:\s*"?(\d{3,9})"?\s*[,}]/);
    if (m) out.price = num(m[1]);
  }
  if (out.rating == null) {
    const m = html.match(/"(?:ratingAverage|averageReviewScore|avgStarScore|starScore|averageRating)"\s*:\s*"?([\d.]+)"?/);
    if (m) {
      const r = Number(m[1]);
      if (Number.isFinite(r)) out.rating = r > 5 ? +(r / 20).toFixed(2) : r; // 100점 척도 대응
    }
  }
  if (out.reviewCount == null) {
    const m = html.match(/"(?:ratingCount|totalReviewCount|reviewCount|reviewCnt)"\s*:\s*"?(\d+)"?/);
    if (m) out.reviewCount = num(m[1]);
  }
}

/** 네이버 스마트스토어/브랜드스토어: __PRELOADED_STATE__ 딥스캔 */
function adaptSmartstore(html, out) {
  const m = html.match(/__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\})\s*(?:;|<\/script>)/);
  if (!m) return;
  let state;
  try {
    state = JSON.parse(m[1]);
  } catch {
    return;
  }
  const product =
    deepFind(state, (k, v) => k === 'A' && v && typeof v === 'object' && v.name && (v.salePrice || v.discountedSalePrice)) ||
    deepFind(state, (k, v) => v && typeof v === 'object' && v.name && v.salePrice != null && v.productNo != null);
  if (product) {
    out.title = out.title || cleanText(product.name);
    out.price = out.price ?? num(product.benefitsView?.discountedSalePrice ?? product.discountedSalePrice ?? product.salePrice);
    out.originalPrice = out.originalPrice ?? num(product.salePrice);
    out.image = out.image || product.representImage?.url || null;
    out.brand = out.brand || cleanText(product.naverShoppingSearchInfo?.brandName) || null;
  }
  const reviewInfo = deepFind(state, (k, v) => v && typeof v === 'object' && v.totalReviewCount != null && v.averageReviewScore != null);
  if (reviewInfo) {
    out.rating = out.rating ?? (Number(reviewInfo.averageReviewScore) || null);
    out.reviewCount = out.reviewCount ?? num(reviewInfo.totalReviewCount);
  }
  out.mall = out.mall || '네이버 스마트스토어';
  out.source = 'smartstore';
}

/** 쿠팡: JSON-LD가 가장 안정적(가격 offers.price). DOM은 개편이 잦아 폴백으로만 사용. */
function adaptCoupang($, html, out) {
  out.title = out.title
    || cleanText($('h1.prod-buy-header__title').first().text())
    || cleanText($('.prod-buy-header__title').first().text()) || null;

  if (out.price == null) {
    // 구버전 DOM
    let p = num($('.prod-coupon-price .total-price').first().text())
      ?? num($('.prod-sale-price .total-price').first().text())
      ?? num($('.total-price strong').first().text());
    // 신버전(twc-* Tailwind): 굵은 큰 폰트 가격 텍스트 중 '원' 포함 첫 값
    if (p == null) {
      $('[class*="twc-font-bold"]').each((_, el) => {
        if (p != null) return false;
        const txt = cleanText($(el).text());
        if (/^\d[\d,]{2,}\s*원/.test(txt)) p = num(txt);
      });
    }
    out.price = p;
  }
  out.originalPrice = out.originalPrice ?? num($('.prod-origin-price .origin-price').first().text());
  if (out.reviewCount == null) {
    out.reviewCount = num($('.prod-buy-header__count, #prod-review-nav-link .count').first().text());
  }
  fromInlineJson(html, out);
  out.mall = out.mall || '쿠팡';
  out.source = out.source === 'json-ld' ? 'coupang+json-ld' : 'coupang';
}

const BLOCKED_TITLE = /access denied|forbidden|robot|captcha|blocked|보안\s*문자|접근이\s*차단|비정상적인/i;

/** HTML 한 벌에서 상품 정보를 뽑는다 (fetch 방법과 무관하게 동일 로직) */
function extractFromHtml(html, finalUrl, url) {
  /** @type {any} */
  const out = {
    title: null, price: null, originalPrice: null, image: null, brand: null,
    mall: null, rating: null, reviewCount: null, reviews: [], promos: [], url,
    source: 'generic', warnings: [], ok: false,
  };
  const $ = cheerio.load(html);
  const host = (() => { try { return new URL(finalUrl).hostname; } catch { return ''; } })();

  // 1) 범용: JSON-LD → OpenGraph
  const hadJsonLd = fromJsonLd($, out);
  fromOpenGraph($, out);
  if (hadJsonLd) out.source = 'json-ld';

  // 2) 사이트별 어댑터로 보강
  if (/smartstore\.naver\.com|brand\.naver\.com|shopping\.naver\.com/.test(host)) adaptSmartstore(html, out);
  else if (/coupang\.com/.test(host)) adaptCoupang($, html, out);

  // 3) 그래도 비면 인라인 JSON 최후 수단
  if (out.price == null || out.rating == null) fromInlineJson(html, out);

  // 4) title 최후 수단: <title>
  if (!out.title) {
    const t = cleanText($('title').first().text());
    if (t) { out.title = t; out.warnings.push('제목을 <title> 태그에서 가져왔습니다 — 부정확할 수 있습니다.'); }
  }
  if (!out.mall) out.mall = host.replace(/^www\./, '') || null;

  // 쿠폰·이벤트·혜택: 관련 컨테이너 텍스트에서만 추출 (전체 페이지는 노이즈)
  const promoText = $('[class*="coupon"], [class*="benefit"], [class*="promotion"], [id*="coupon"], [class*="혜택"], [class*="discount"], [class*="delivery"], [class*="prod-coupon"]')
    .slice(0, 40).map((_, el) => $(el).text()).get().join(' ');
  out.promos = extractPromos(promoText);

  // 차단 페이지의 제목은 무효 처리
  if (out.title && BLOCKED_TITLE.test(out.title) && out.price == null) out.title = null;
  return out;
}

/** 추출 품질 점수: title/price가 핵심, rating은 보너스 */
const quality = (o) => (o ? (o.title ? 2 : 0) + (o.price != null ? 2 : 0) + (o.rating != null ? 1 : 0) : -1);

/**
 * 상품 URL을 받아 정보를 크롤링한다.
 * 1차: 일반 HTTP(빠름) → 차단·가격누락 시 2차: 실제 브라우저 렌더링(Playwright, 로컬 Chrome/Edge).
 * @returns {Promise<ProductInfo & {ok: boolean, error?: string}>}
 */
export async function parseProduct(url) {
  const page = await fetchPage(url);
  let out = page.html ? extractFromHtml(page.html, page.finalUrl, url) : null;
  if (out && !page.ok) out.warnings.push(`일반 HTTP가 ${page.status}로 거부됨.`);

  // 브라우저 재시도 조건: 페이지 실패 / 차단 상태코드 / 제목 없음 / 가격 없음
  const needBrowser =
    !out || !out.title || out.price == null || [403, 429, 503].includes(page.status);

  let engine = null;
  if (needBrowser) {
    const bpage = await browserFetchPage(url);
    if (bpage.html) {
      const bout = extractFromHtml(bpage.html, bpage.finalUrl, url);
      if (quality(bout) >= quality(out)) {
        bout.warnings.unshift(`실제 브라우저 엔진(${bpage.engine || 'chromium'})으로 크롤링했습니다.`);
        out = bout;
        engine = bpage.engine;
      }
    } else if (out) {
      out.warnings.push(`브라우저 크롤링도 실패: ${bpage.error || 'HTTP ' + bpage.status}`);
    } else {
      out = {
        title: null, price: null, originalPrice: null, image: null, brand: null,
        mall: null, rating: null, reviewCount: null, reviews: [], url,
        source: 'generic', warnings: [], ok: false,
        error: `페이지를 가져오지 못했습니다 (HTTP: ${page.error || page.status} / 브라우저: ${bpage.error || bpage.status})`,
      };
    }
  }

  out.fetchEngine = engine || 'http';
  out.ok = !!out.title;
  if (!out.ok) {
    out.error = out.error ||
      '이 페이지는 크롤링에 실패했습니다. 로그인이 필요하거나 JS 렌더링 전용 페이지일 수 있습니다. 상품명을 키워드로 넣고 가격을 직접 입력하면 시세 비교가 가능합니다.';
  }
  if (out.ok && out.price == null) out.warnings.push('가격을 찾지 못했습니다 — 대시보드에서 직접 입력하면 비교가 가능합니다.');
  return out;
}

/**
 * 검색 쿼리용 상품명 정제. 광고/몰 꼬리표를 걷어낸 뒤 "구별력 있는 토큰"만 우선순위로 남긴다.
 *  핵심명사(브랜드·제품군) → 모델코드 → 대표 스펙 순으로 조립하고, 흔한 카테고리어는 트림 대상.
 *  예) "[정품]삼성 갤럭시 버즈3 프로 무선 이어폰 SM-R630N 블랙 : 쿠팡" → "삼성 갤럭시 버즈3 프로 SM-R630N"
 */
export function buildSearchQuery(title) {
  if (!title) return '';
  const t = title
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')            // [무료배송], (당일출고) 류 제거
    .replace(/[/|:]\s*(?:네이버|쿠팡|11번가|G마켓|지마켓|옥션|SSG|롯데온|티몬|위메프|인터파크|다나와|에누리)[^,]*$/i, ' ')
    .replace(/(?:무료배송|당일발송|당일출고|정품|공식인증|공식|특가|할인|세일|사은품|증정|기획전|모음전?|최저가|빠른배송|1\+1|BEST|HOT|NEW)/gi, ' ')
    .replace(/[^\w가-힣.\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = t.split(' ').filter(Boolean);
  const isModel = (w) => /[a-z]/i.test(w) && /\d/.test(w);
  const isSpec = (w) => extractSpecs(w).size > 0;
  const model = tokens.filter(isModel);
  const spec = tokens.filter((w) => isSpec(w) && !model.includes(w));
  const core = tokens.filter((w) => !isModel(w) && !isSpec(w) && !STOP.has(w));
  const filler = tokens.filter((w) => STOP.has(w) && !isModel(w) && !isSpec(w));

  // 핵심명사 최대 4개(부족하면 카테고리어로 보충) + 모델 2 + 스펙 1
  let picked = core.slice(0, 4);
  if (picked.length < 3) picked = picked.concat(filler.slice(0, 3 - picked.length));
  picked = picked.concat(model.slice(0, 2), spec.slice(0, 1));

  const seen = new Set();
  const q = picked.filter((w) => {
    const k = w.toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return q.join(' ') || t;
}

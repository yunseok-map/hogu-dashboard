import * as cheerio from 'cheerio';
import { fetchPage, fetchJson } from './fetchPage.js';
import { browserFetchPage } from './browserFetch.js';

/**
 * 유사 상품 표준 형태
 * @typedef {Object} SimilarItem
 * @property {string} title
 * @property {number|null} price
 * @property {string} link
 * @property {string|null} image
 * @property {string|null} mall
 * @property {number|null} rating      5점 만점
 * @property {number|null} reviewCount
 * @property {string} provider        'naver' | 'danawa' | 'web'
 * @property {number} similarity      0~1, 원본 상품명과의 유사도
 */

const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
const toInt = (s) => {
  const n = Number(String(s ?? '').replace(/[^\d]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const tok = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^\w가-힣.\- ]/g, ' ')
    .replace(/([가-힣])(\d)/g, '$1 $2')   // "아이폰15" → "아이폰 15" (세대 번호 분리)
    .replace(/(\d)([가-힣])/g, '$1 $2')
    .split(/\s+/)
    .filter((w) => w.length >= 2);

/** 세대/시리즈 번호 추출 — 아이폰"15", 갤럭시"S24", 버즈"3" 등. 스펙 숫자(256GB·40oz)는 제외. */
export function seriesNumbers(str) {
  const s = String(str || '').toLowerCase();
  const spec = new Set();
  for (const m of s.matchAll(/(\d+)\s?(?:gb|tb|기가|테라|oz|온스|ml|㎖|l|리터|인치|형|inch|cm|센치|w|와트|개입|개|매|장|팩|구|병|포|세대)\b/gi)) spec.add(m[1]);
  const out = new Set();
  // 한글 또는 (경계 뒤) 단일 영문 다음에 오는 1~3자리 숫자 = 세대/시리즈 (모델코드 내부 숫자 제외)
  for (const m of s.matchAll(/(?:[가-힣]|(?:^|[^a-z0-9])[a-z])\s*(\d{1,3})(?![a-z0-9])/g)) {
    if (!spec.has(m[1])) out.add(String(Number(m[1])));
  }
  return out;
}

/** 흔한 카테고리/마케팅/색상/에디션 토큰 — 상품을 구별하지 못하므로 유사도 가중치를 낮춘다. */
export const STOP = new Set(
  ('무선 유선 블루투스 정품 새제품 새상품 미개봉 국내 해외 병행 직구 구매대행 관세 관부가세 포함 당일 발송 배송 무료배송 옵션 색상 컬러 '
  + '블랙 화이트 실버 골드 그레이 그레이스 블루 레드 핑크 그린 퍼플 베이지 크림 카멜 네이비 로즈 민트 아이보리 스카이 라벤더 옐로우 오렌지 '
  + '한정판 리미티드 에디션 스페셜 시즌 홀리데이 데코 기획 단독 인기 추천 베스트 최신 공식 인증 강력 초경량 가정용 프리미엄 '
  + '이어폰 헤드폰 스피커 마우스 키보드 노트북 태블릿 텀블러 보틀 물병 드라이어 스타일러 청소기 세트 패키지 신형 신제품 상품').split(' ')
);

/** 구조적 변형 키워드 — 한쪽에만 있으면 "다른 라인/세대"라 가격대가 다르다 (프로맥스 등 복합어 포함) */
const VARIANT = new Set(
  ('프로맥스 promax 프로 pro 플러스 plus 울트라 ultra 에어 air 미니 mini 맥스 max 라이트 lite se fe '
  + '롱 long 멀티 multi 네오 neo 콤보 combo 슬림 slim 1세대 2세대 3세대 4세대 5세대 신형 구형').split(' ')
);
// tok은 1글자 토큰(롱 등)을 버리므로, 변형 검출은 길이 필터 없이 분리한다
const variantSet = (str) => {
  const t = new Set(String(str || '').toLowerCase().replace(/[^\w가-힣.\- ]/g, ' ').split(/\s+/).filter(Boolean));
  return new Set([...VARIANT].filter((v) => t.has(v)));
};

/** 용량/크기/수량 등 "가격을 가르는 사양"을 정규화해 뽑는다. 부피(oz/ml/l)는 ml로 환산해 버킷. */
const SPEC_UNITS = [
  [/(\d+(?:\.\d+)?)\s?(?:tb|테라)\b/gi, (v) => 'st' + v + 'tb'],
  [/(\d+(?:\.\d+)?)\s?(?:gb|기가)\b/gi, (v) => 'st' + v + 'gb'],
  [/(\d+(?:\.\d+)?)\s?(?:인치|형|inch)\b/gi, (v) => 'sz' + v + 'in'],
  [/(\d+(?:\.\d+)?)\s?(?:cm|센치|센티미?터?)\b/gi, (v) => 'sz' + v + 'cm'],
  [/(\d+(?:\.\d+)?)\s?(?:w|와트)\b/gi, (v) => 'pw' + v],
  [/(\d+)\s?(?:개입|개|매|장|팩|구|병|포)\b/g, (v) => 'ea' + v],
];
export function extractSpecs(str) {
  const s = String(str || '').toLowerCase();
  const out = new Set();
  for (const [re, tag] of SPEC_UNITS) {
    for (const m of s.matchAll(re)) {
      const v = m[1].replace(/\.0$/, '');
      if (tag === SPEC_UNITS[5][1] && v === '1') continue; // "1개"는 구별력 없음
      out.add(tag(v));
    }
  }
  // 부피: oz/ml/l → ml로 환산 후 50ml 버킷 (40oz ↔ 1.18L 매칭)
  const vol = (ml) => out.add('vol' + Math.round(ml / 50) * 50);
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s?(?:oz|온스)\b/gi)) vol(+m[1] * 29.57);
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s?(?:ml|㎖)\b/gi)) vol(+m[1]);
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s?(?:l|리터)\b/gi)) vol(+m[1] * 1000);
  return out;
}

/** 모델코드 정규화 추출: "SM-R630N"/"SM R630N" → "smr630n" (몰마다 표기가 달라도 매칭) */
export function modelCodes(str) {
  const s = String(str || '').toLowerCase();
  const out = new Set();
  for (const m of s.matchAll(/[a-z][a-z0-9\- ]*\d[a-z0-9\- ]*/g)) {
    const norm = m[0].replace(/[^a-z0-9]/g, '');
    if (/[a-z]/.test(norm) && /\d/.test(norm) && norm.length >= 4 && norm.length <= 18) out.add(norm);
  }
  return out;
}

/** 카드/페이지 텍스트에서 쿠폰·이벤트·혜택 문구를 뽑는다 (중복 제거, 최대 3개) */
export function extractPromos(text) {
  if (!text) return [];
  const t = String(text).replace(/\s+/g, ' ');
  const out = [];
  const push = (s) => { s = s.trim(); if (s && s.length <= 24 && !out.includes(s)) out.push(s); };
  // "3,000원 쿠폰", "10% 쿠폰", "즉시할인 5%", "카드 최대 12%" 등
  const patterns = [
    /([\d,]+원\s*(?:즉시)?쿠폰)/g,
    /(\d{1,2}%\s*(?:즉시)?쿠폰)/g,
    /((?:즉시|추가|중복)?할인\s*[\d,]+원)/g,
    /((?:즉시|추가|중복)?할인\s*\d{1,2}%)/g,
    /((?:카드|무이자)\s*(?:최대\s*)?\d{1,2}%?)/g,
    /(\d{1,2}%?\s*적립)/g,
    /(무료배송|당일배송|내일도착|로켓배송|새벽배송)/g,
    /(사은품|증정|1\+1|기획전|타임딜|특가|균일가)/g,
  ];
  for (const re of patterns) {
    for (const m of t.matchAll(re)) { push(m[1]); if (out.length >= 3) return out; }
  }
  return out;
}

/** 쿠폰/할인 문구에서 실제 할인액(원)을 계산한다. "3,000원 쿠폰"=절대액, "10% 쿠폰"=정가 대비. */
export function promoDiscount(promos, price) {
  if (!price || !Array.isArray(promos)) return 0;
  let disc = 0;
  for (const p of promos) {
    const won = p.match(/(?:할인\s*)?([\d,]{3,})\s*원/);
    const pct = p.match(/(\d{1,2})\s*%/);
    if (won) disc += toInt(won[1]) || 0;
    else if (pct) disc += Math.round((price * Number(pct[1])) / 100);
  }
  // 오탐 방지: 정가의 60% 이상 할인은 무시(가격 오파싱/과장 문구)
  return disc >= price * 0.6 ? 0 : disc;
}

/** 부속품/소모품/변형상품 키워드 — 본품 시세를 오염시키는 주범들 */
const ACC = /케이스|이어팁|필름|보호|파우치|스트랩|거치대|거치|충전기|충전독|크래들|케이블|어댑터|어답터|아답터|아답타|단품|리퍼|중고|호환|악세서리|액세서리|벌크|묶음|개입|세트|배터리|부품|부속|필터|브러시|브러쉬|노즐|헤드|먼지통|먼지봉투|호스|걸레|패드|밀대|리모컨|커버|받침대|삼각대|수리|교체용|전용/;

/**
 * 부속품 불일치 판정: 후보 제목에 부속품 키워드가 있는데 원본 제목엔 없으면 true.
 * (사용자가 "청소기 어댑터"를 직접 검색하면 원본에도 있으므로 false — 의도 보존)
 */
export function accessoryMismatch(refTitle, candTitle) {
  const inCand = tok(candTitle).some((w) => ACC.test(w));
  if (!inCand) return false;
  const inRef = tok(refTitle).some((w) => ACC.test(w));
  return !inRef;
}

/**
 * 상품명 유사도 (0~1). 단순 자카드의 한계(흔한 단어가 점수를 부풀림, 모델/용량 차이를 못 봄)를
 * 아래 4단계로 보완한다.
 *  1) 가중 자카드 — 흔한 카테고리어(STOP)는 가중치↓
 *  2) 모델코드 — 정규화 매칭. 둘 다 모델이 있는데 겹치면 강한 보너스, 안 겹치면 "다른 상품"으로 캡
 *  3) 스펙(용량/크기/수량) — 둘 다 있는데 다르면 "다른 변형"으로 감점(가격대가 다름)
 *  4) 부속품 — 어댑터/필터 등은 원천적으로 낮게
 */
export function similarity(a, b) {
  const A = new Set(tok(a));
  const B = new Set(tok(b));
  if (!A.size || !B.size) return 0;

  // 1) 가중 자카드
  let num = 0, den = 0;
  for (const w of new Set([...A, ...B])) {
    const weight = STOP.has(w) ? 0.35 : 1;
    den += weight;
    if (A.has(w) && B.has(w)) num += weight;
  }
  let score = den ? num / den : 0;

  // 2) 모델코드
  const mA = modelCodes(a), mB = modelCodes(b);
  if (mA.size && mB.size) {
    const shared = [...mA].some((m) => mB.has(m));
    if (shared) score = Math.min(1, score + 0.4);
    else score = Math.min(score, 0.3);            // 서로 다른 모델 = 다른 상품
  }

  // 3) 스펙: 둘 다 있는데 겹치면 "같은 규격"이라 가점, 다르면 "다른 변형"이라 감점
  const sA = extractSpecs(a), sB = extractSpecs(b);
  if (sA.size && sB.size) {
    if ([...sA].some((s) => sB.has(s))) score = Math.min(1, score + 0.12);
    else score *= 0.5;
  }

  // 3-2) 변형 키워드 불일치(프로/에어/맥스/세대 등이 한쪽에만) → 다른 라인이라 강하게 감점
  const vA = variantSet(a), vB = variantSet(b);
  if ([...vA].some((v) => !vB.has(v)) || [...vB].some((v) => !vA.has(v))) score *= 0.4;

  // 3-3) 세대/시리즈 번호 불일치(아이폰15 vs 14, 버즈3 vs 2) → 다른 세대라 0.3 캡
  const nA = seriesNumbers(a), nB = seriesNumbers(b);
  if (nA.size && nB.size && ![...nA].some((n) => nB.has(n))) score = Math.min(score, 0.3);

  // 4) 부속품 오염 방지
  if (accessoryMismatch(a, b)) score = Math.min(score * 0.3, 0.15);

  return +Math.max(0, Math.min(1, score)).toFixed(3);
}

/** 네이버 쇼핑 오픈API — NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수 필요 (무료 발급) */
export async function searchNaver(query, { display = 40 } = {}) {
  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) return { available: false, items: [], reason: 'API 키 없음 (.env에 NAVER_CLIENT_ID/SECRET 설정 시 활성화)' };

  const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(query)}&display=${display}&sort=sim`;
  const res = await fetchJson(url, {
    headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret },
  });
  if (!res.ok || !res.body?.items) return { available: true, items: [], reason: `API 오류 (HTTP ${res.status})` };

  const items = res.body.items.map((it) => ({
    title: stripTags(it.title),
    price: toInt(it.lprice),
    link: it.link,
    image: it.image || null,
    mall: it.mallName || null,
    rating: null,
    reviewCount: null,
    provider: 'naver',
    similarity: 0,
    brand: it.brand || null,
    category: [it.category1, it.category2, it.category3].filter(Boolean).join(' > ') || null,
  }));
  return { available: true, items, reason: null };
}

/** 다나와 검색 크롤링 — API 키 불필요. 평점/리뷰수까지 나온다. */
export async function searchDanawa(query, { limit = 40 } = {}) {
  const url = `https://search.danawa.com/dsearch.php?query=${encodeURIComponent(query)}`;
  const page = await fetchPage(url);
  if (!page.ok || !page.html) return { available: true, items: [], reason: `다나와 접속 실패 (${page.error || 'HTTP ' + page.status})` };

  const $ = cheerio.load(page.html);
  const items = [];
  // prod_main_info는 li.prod_item 내부에 중첩되므로 li가 잡히면 li만 사용 (이중 매칭 방지)
  const $nodes = $('li.prod_item').length ? $('li.prod_item') : $('div.prod_main_info');
  $nodes.each((_, el) => {
    if (items.length >= limit) return false;
    const $el = $(el);
    const $name = $el.find('.prod_name a').first();
    const title = stripTags($name.text());
    if (!title) return;
    let link = $name.attr('href') || '';
    if (link.startsWith('//')) link = 'https:' + link;
    if (!/^https?:/.test(link)) return;

    // 가격: 첫 번째 price_sect strong (최저가)
    const price = toInt($el.find('.price_sect strong').first().text());
    // 평점: "점수 4.8점" 같은 텍스트 또는 .text__score
    let rating = null;
    const scoreText = $el.find('.text__score').first().text() || $el.find('.star-single').first().text();
    if (scoreText) {
      const r = Number(String(scoreText).replace(/[^\d.]/g, ''));
      if (Number.isFinite(r) && r > 0) rating = r > 5 ? +(r / 20).toFixed(2) : r;
    }
    // 리뷰(상품의견) 수
    let reviewCount = null;
    const opinion = $el.find('.text__number').first().text() || $el.find('.cnt_opinion').first().text();
    if (opinion) reviewCount = toInt(opinion);

    const image = $el.find('.thumb_image img').attr('data-src') || $el.find('.thumb_image img').attr('src') || null;

    items.push({
      title, price, link,
      image: image && image.startsWith('//') ? 'https:' + image : image,
      mall: '다나와(최저가)',
      rating, reviewCount,
      promos: extractPromos(stripTags($el.text())),
      provider: 'danawa',
      similarity: 0,
    });
  });
  return { available: true, items, reason: items.length ? null : '검색 결과 없음(또는 페이지 구조 변경)' };
}

/** 에누리 검색 크롤링 — API 키 불필요. 최저가·판매처 수·평점·리뷰 수까지 나온다. */
export async function searchEnuri(query, { limit = 40 } = {}) {
  const url = `https://www.enuri.com/search.jsp?keyword=${encodeURIComponent(query)}`;
  const page = await fetchPage(url);
  if (!page.ok || !page.html) return { available: true, items: [], reason: `에누리 접속 실패 (${page.error || 'HTTP ' + page.status})` };

  const $ = cheerio.load(page.html);
  const items = [];
  const seen = new Set();
  $('a.product-link').each((_, el) => {
    if (items.length >= limit) return false;
    const $el = $(el);
    let link = $el.attr('href') || '';
    if (link.startsWith('//')) link = 'https:' + link;
    if (!/^https?:/.test(link) || seen.has(link)) return;
    seen.add(link);

    const text = stripTags($el.text()).replace(/\s+/g, ' ');
    // "상품명 최저 가격 217,980 원~ (166개 판매처) 4.9 / 5.0 (2758개 리뷰) ..."
    const title = text.split(/최저\s*가격/)[0].trim();
    if (!title) return;
    const price = toInt((text.match(/최저\s*가격\s*([\d,]+)\s*원/) || [])[1]);
    const sellers = toInt((text.match(/\((\d[\d,]*)개\s*판매처\)/) || [])[1]);
    const ratingM = text.match(/([\d.]+)\s*\/\s*5\.0/);
    const rating = ratingM ? Number(ratingM[1]) : null;
    const reviewCount = toInt((text.match(/\((\d[\d,]*)개\s*리뷰\)/) || [])[1]);
    let image = $el.find('img').first().attr('data-src') || $el.find('img').first().attr('src') || null;
    if (image && image.startsWith('//')) image = 'https:' + image;

    items.push({
      title, price, link, image,
      mall: sellers ? `에누리(판매처 ${sellers}곳)` : '에누리(최저가)',
      rating: Number.isFinite(rating) && rating > 0 ? rating : null,
      reviewCount,
      provider: 'enuri',
      similarity: 0,
    });
  });
  return { available: true, items, reason: items.length ? null : '검색 결과 없음(또는 페이지 구조 변경)' };
}

/* ================= 메이저몰 (브라우저 엔진 경유) =================
   일반 HTTP를 막는 대형몰은 실제 Chrome(CDP)으로 렌더링해서 긁는다.
   객체 트리 딥스캔(SSG)과 DOM 셀렉터(11번가 등)를 병행. */

/** 객체 트리에서 predicate를 만족하는 "배열"을 찾는다 (SSG __NEXT_DATA__용) */
function deepFindArray(obj, predicate, depth = 0, seen = new Set()) {
  if (obj == null || depth > 14 || typeof obj !== 'object' || seen.has(obj)) return null;
  seen.add(obj);
  if (Array.isArray(obj) && obj.length >= 3) {
    try { if (predicate(obj)) return obj; } catch { /* 무시 */ }
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const found = deepFindArray(v, predicate, depth + 1, seen);
      if (found) return found;
    }
  }
  return null;
}

/** SSG: __NEXT_DATA__ JSON에서 상품 배열 딥스캔 */
export async function searchSsg(query, { limit = 20 } = {}) {
  const url = `https://www.ssg.com/search.ssg?target=all&query=${encodeURIComponent(query)}`;
  const page = await browserFetchPage(url, { timeoutMs: 28000, warmup: false });
  if (!page.html) return { available: true, items: [], reason: `SSG 접속 실패 (${page.error || 'HTTP ' + page.status})` };

  const m = page.html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return { available: true, items: [], reason: 'SSG 데이터 블록 없음 (구조 변경?)' };
  let data;
  try { data = JSON.parse(m[1]); } catch { return { available: true, items: [], reason: 'SSG JSON 파싱 실패' }; }

  // 상품 배열: itemNm/itemName + 가격 필드를 가진 객체들
  const arr = deepFindArray(data, (a) => a.some((it) => it && typeof it === 'object' &&
    (it.itemNm || it.itemName || it.item?.itemNm) && JSON.stringify(it).includes('price')));
  if (!arr) return { available: true, items: [], reason: 'SSG 상품 배열 미발견' };

  const items = [];
  for (const raw of arr) {
    if (items.length >= limit) break;
    const it = raw.item && typeof raw.item === 'object' ? { ...raw, ...raw.item } : raw;
    const title = stripTags(it.itemNm || it.itemName || '');
    if (!title) continue;
    const s = JSON.stringify(raw);
    // 가격이 "246,210" 같은 콤마 문자열인 경우가 있어 콤마 포함 매칭
    const price = toInt((s.match(/"(?:sellPrc|bestAmt|finalPrice|sellPrice|price)"\s*:\s*"?([\d,]{3,12})"?/) || [])[1]);
    const itemId = it.itemId || it.itemid || (s.match(/"itemId"\s*:\s*"(\d+)"/) || [])[1];
    if (!itemId) continue;
    const rating = Number((s.match(/"(?:recomGrd|avgGrd|grade)"\s*:\s*"?([\d.]+)/) || [])[1]) || null;
    const reviewCount = toInt((s.match(/"(?:recomCnt|reviewCnt|commentCnt)"\s*:\s*"?(\d+)/) || [])[1]);
    items.push({
      title, price,
      link: `https://www.ssg.com/item/itemView.ssg?itemId=${itemId}`,
      image: null,
      mall: 'SSG',
      rating: rating && rating > 5 ? +(rating / 20).toFixed(2) : rating,
      reviewCount,
      provider: 'ssg', similarity: 0,
    });
  }
  return { available: true, items, reason: items.length ? null : 'SSG 결과 0건' };
}

/** 11번가: 렌더된 DOM의 .c-card-item 파싱 */
export async function search11st(query, { limit = 20 } = {}) {
  const url = `https://search.11st.co.kr/pc/total-search?kwd=${encodeURIComponent(query)}&tabId=TOTAL_SEARCH`;
  const page = await browserFetchPage(url, { timeoutMs: 28000, warmup: false });
  if (!page.html) return { available: true, items: [], reason: `11번가 접속 실패 (${page.error || 'HTTP ' + page.status})` };

  const $ = cheerio.load(page.html);
  const items = [];
  const seen = new Set();
  $('.c-card-item').each((_, el) => {
    if (items.length >= limit) return false;
    const $el = $(el);
    const title = stripTags($el.find('.c-card-item__name, [class*="__name"]').first().text()).replace(/^상품명\s*/, '');
    let link = $el.find('a[href*="11st.co.kr"], a[href*="/products/"]').first().attr('href') || '';
    if (link.startsWith('//')) link = 'https:' + link;
    if (!title || !/^https?:/.test(link) || seen.has(link)) return;
    const price = toInt($el.find('.c-card-item__price strong, .c-card-item__price').first().text());
    if (!price) return;
    seen.add(link);
    // "별점 4.5점" / "리뷰 123건" 텍스트 패턴에서 추출 (별점·리뷰수 혼동 방지)
    const cardText = stripTags($el.text());
    const rating = Number((cardText.match(/별점\s*([\d.]+)/) || [])[1]) || null;
    const reviewCount = toInt((cardText.match(/리뷰\s*([\d,]+)/) || [])[1]);
    const image = $el.find('img').first().attr('data-src') || $el.find('img').first().attr('src') || null;
    items.push({
      title, price, link,
      image: image && image.startsWith('//') ? 'https:' + image : image,
      mall: '11번가',
      rating: rating && rating > 5 ? +(rating / 20).toFixed(2) : rating,
      reviewCount,
      promos: extractPromos(cardText),
      provider: '11st', similarity: 0,
    });
  });
  return { available: true, items, reason: items.length ? null : '11번가 결과 0건 (구조 변경?)' };
}

/**
 * 옥션/G마켓 공용 파서 — 둘 다 eBay코리아 프론트지만 클래스가 서로 다르다
 * (옥션: itempage3/area--itemcard_price, G마켓: goodscode/box__item-price).
 * 그래서 안정적인 "상품 링크"를 기준으로 카드를 잡고, 가격은 다중 셀렉터+정규식 폴백.
 */
async function searchEbayKorea({ mall, url, linkSel, itemRe, provider }, { limit = 20 } = {}) {
  const page = await browserFetchPage(url, { timeoutMs: 28000, scroll: true, warmup: false });
  if (!page.html) return { available: true, items: [], reason: `${mall} 접속 실패 (${page.error || 'HTTP ' + page.status})` };

  const $ = cheerio.load(page.html);
  const items = [];
  const seen = new Set();
  $(linkSel).each((_, a) => {
    if (items.length >= limit) return false;
    const $a = $(a);
    let link = ($a.attr('href') || '').replace(/&amp;/g, '&');
    if (link.startsWith('//')) link = 'https:' + link;
    const idm = link.match(itemRe);
    if (!idm || seen.has(idm[1])) return; // 상품 식별자로 중복 제거 (광고 포함)

    // 카드 래퍼: 반드시 "가격+이름을 모두 담은" 컨테이너를 지정.
    // 그리디 [class*=itemcard]는 링크 자신(link--itemcard, 가격 없음)을 잡아버려 금지.
    const $card = $a.closest('.box__item-container, .section--itemcard, li[class*="box__item"], .itemcard');
    if (!$card.length) return;
    const cardText = stripTags($card.text());

    // 가격: 셀렉터 우선 → 카드 텍스트의 첫 'N,NNN원' 폴백
    let price = toInt($card.find('.box__item-price strong, .text__value, .area--itemcard_price strong, strong.text__value, .price strong').first().text());
    if (!price) { const pm = cardText.match(/([\d]{1,3}(?:,\d{3})+)\s*원/); price = pm ? toInt(pm[1]) : null; }
    if (!price) return;

    // 상품명: 링크 title 속성 우선 → 카드 제목 → 링크 텍스트, "상품명" 접두 제거
    let title = stripTags($a.attr('title') || $card.find('.text__item, [class*="itemcard_title"], .box__item-title, .text__title, .itemcard__title').first().text() || $a.text()).replace(/\s+/g, ' ').trim();
    if (/상품명/.test(title)) title = title.replace(/^.*?상품명\s*/, '');
    if (!title || title.length < 4) return;
    seen.add(idm[1]);

    const rating = Number((cardText.match(/(?:별점|평점)\s*([\d.]+)/) || [])[1]) || null;
    const reviewCount = toInt((cardText.match(/(?:리뷰|후기)\s*\(?\s*([\d,]+)/) || [])[1]);
    let image = $card.find('img').first().attr('data-src') || $card.find('img').first().attr('src') || null;
    if (image && image.startsWith('//')) image = 'https:' + image;

    items.push({
      title, price, link, image, mall,
      rating: rating && rating > 5 ? +(rating / 20).toFixed(2) : rating,
      reviewCount,
      promos: extractPromos(cardText),
      provider, similarity: 0,
    });
  });
  return { available: true, items, reason: items.length ? null : `${mall} 결과 0건 (구조 변경?)` };
}

export const searchAuction = (query, opts) => searchEbayKorea({
  mall: '옥션', provider: 'auction',
  linkSel: 'a[href*="itempage3.auction"], a[href*="itemno="]',
  itemRe: /itemno=([A-Z0-9]+)/i,
  url: `https://www.auction.co.kr/n/search?keyword=${encodeURIComponent(query)}`,
}, opts);

export const searchGmarket = (query, opts) => searchEbayKorea({
  mall: 'G마켓', provider: 'gmarket',
  linkSel: 'a[href*="item.gmarket"], a[href*="goodscode="]',
  itemRe: /goodscode=([A-Z0-9]+)/i,
  url: `https://www.gmarket.co.kr/n/search?keyword=${encodeURIComponent(query)}`,
}, opts);

/** 웹 검색 폴백 (DuckDuckGo HTML) — 가격은 없지만 관련 판매처/후기 링크를 건진다. */
export async function searchWeb(query, { limit = 8 } = {}) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + ' 가격')}&kl=kr-kr`;
  const page = await fetchPage(url, { timeoutMs: 10000 });
  if (!page.ok || !page.html) return { available: true, items: [], reason: '웹 검색 실패' };

  const $ = cheerio.load(page.html);
  const items = [];
  $('.result').each((_, el) => {
    if (items.length >= limit) return false;
    const $a = $(el).find('a.result__a').first();
    let href = $a.attr('href') || '';
    // DDG 리다이렉트 링크에서 실제 URL 추출
    const m = href.match(/uddg=([^&]+)/);
    if (m) href = decodeURIComponent(m[1]);
    const title = stripTags($a.text());
    const snippet = stripTags($(el).find('.result__snippet').text());
    if (!title || !/^https?:/.test(href)) return;
    items.push({
      title, price: null, link: href, image: null,
      mall: (() => { try { return new URL(href).hostname.replace(/^www\./, ''); } catch { return null; } })(),
      rating: null, reviewCount: null,
      provider: 'web', similarity: 0, snippet,
    });
  });
  return { available: true, items, reason: items.length ? null : '검색 결과 없음' };
}

/**
 * 모든 제공자를 병렬 호출해 통합·유사도 계산·중복 제거까지 끝낸 목록을 돌려준다.
 */
export async function searchSimilar(query, originalTitle, { deep = false } = {}) {
  const fail = (e) => ({ available: true, items: [], reason: String(e) });
  // 일반(HTTP/API) 제공자는 동시 실행
  const jobs = Promise.all([
    searchNaver(query).catch((e) => ({ available: false, items: [], reason: String(e) })),
    searchDanawa(query).catch(fail),
    searchEnuri(query).catch(fail),
    searchWeb(query).catch(fail),
  ]);

  // 정밀 모드: 메이저몰 직접 크롤링. 한 Chrome을 공유하므로 동시 실행하면 렌더링이
  // 서로 방해해 결과가 비는 경우가 있어 반드시 "순차"로 돌린다.
  const off = { available: false, items: [], reason: '정밀 검색 꺼짐' };
  const deepPromise = (async () => {
    if (!deep) return [off, off, off, off];
    const out = [];
    for (const fn of [searchSsg, search11st, searchAuction, searchGmarket]) {
      out.push(await fn(query).catch(fail));
    }
    return out;
  })();

  const [[naver, danawa, enuri, web], [ssg, st11, auction, gmarket]] = await Promise.all([jobs, deepPromise]);

  const ref = originalTitle || query;
  const all = [...naver.items, ...danawa.items, ...enuri.items, ...ssg.items, ...st11.items, ...auction.items, ...gmarket.items];
  for (const it of all) {
    it.similarity = similarity(ref, it.title);
    it.accessory = accessoryMismatch(ref, it.title); // 부속품은 시세 비교에서 원천 배제용 플래그
    it.discount = promoDiscount(it.promos, it.price); // 쿠폰 할인액(원)
    it.effPrice = it.price != null ? it.price - it.discount : null; // 쿠폰 적용 실구매가
  }
  for (const it of web.items) it.similarity = similarity(ref, it.title);

  // 링크 기준 중복 제거 + 유사도순 정렬 (쿼리스트링은 상품 식별자일 수 있어 해시만 제거)
  const seen = new Set();
  const items = all
    .filter((it) => {
      const key = it.link.replace(/#.*$/, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.similarity - a.similarity);

  return {
    items,
    webResults: web.items,
    providers: {
      naver: { available: naver.available, count: naver.items.length, reason: naver.reason },
      danawa: { available: danawa.available, count: danawa.items.length, reason: danawa.reason },
      enuri: { available: enuri.available, count: enuri.items.length, reason: enuri.reason },
      ssg: { available: ssg.available, count: ssg.items.length, reason: ssg.reason },
      st11: { available: st11.available, count: st11.items.length, reason: st11.reason },
      auction: { available: auction.available, count: auction.items.length, reason: auction.reason },
      gmarket: { available: gmarket.available, count: gmarket.items.length, reason: gmarket.reason },
      web: { available: web.available, count: web.items.length, reason: web.reason },
    },
  };
}

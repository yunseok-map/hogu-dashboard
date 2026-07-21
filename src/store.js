import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const RESULTS_DIR = path.join(DATA_DIR, 'results');
const PRICES_DIR = path.join(DATA_DIR, 'prices');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const DEALS_FILE = path.join(DATA_DIR, 'deals.json');
const WATCH_FILE = path.join(DATA_DIR, 'watch.json');
const MAX_HISTORY = 100;
const MAX_POINTS = 180;

function ensureDirs() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

export function listHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

export function saveResult(result) {
  ensureDirs();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  result.id = id;
  fs.writeFileSync(path.join(RESULTS_DIR, `${id}.json`), JSON.stringify(result), 'utf-8');

  const history = listHistory();
  history.unshift({
    id,
    ts: new Date().toISOString(),
    title: result.product?.title || result.query || '(제목 없음)',
    url: result.product?.url || null,
    price: result.product?.price ?? null,
    image: result.product?.image ?? null,
    verdict: result.verdict ? { score: result.verdict.score, tier: result.verdict.tier, emoji: result.verdict.emoji, label: result.verdict.label } : null,
    itemCount: result.similar?.items?.length ?? 0,
  });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(0, MAX_HISTORY), null, 1), 'utf-8');
  return id;
}

export function getResult(id) {
  if (!/^[a-z0-9]+$/i.test(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, `${id}.json`), 'utf-8'));
  } catch {
    return null;
  }
}

export function deleteResult(id) {
  if (!/^[a-z0-9]+$/i.test(id)) return false;
  const history = listHistory().filter((h) => h.id !== id);
  ensureDirs();
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 1), 'utf-8');
  try { fs.unlinkSync(path.join(RESULTS_DIR, `${id}.json`)); } catch { /* 이미 없음 */ }
  return true;
}

/* ===== 가격 히스토리(일자별 시계열) — 패시브 적립 ===== */

/** 검색어/제목을 시계열 그룹 키로 정규화(소문자·기호 제거·공백 단일화). 유니코드(한글) 유지. */
export function normalizeKey(s) {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

/** 정규화 키 → 파일명용 짧은 해시(djb2, base36). */
function keyHash(key) {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = (((h << 5) + h) ^ key.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function priceFile(hash) { return path.join(PRICES_DIR, `${hash}.json`); }

/**
 * 가격 관측점 1개 적립. 같은 날짜는 최신 값으로 대체(하루 1점), 시간순 정렬, 최대 MAX_POINTS.
 * @returns {{key:string, hash:string, points:object[]}|null}
 */
export function recordPricePoint(rawKey, point, label) {
  const key = normalizeKey(rawKey);
  if (!key || !point || !point.date) return null;
  fs.mkdirSync(PRICES_DIR, { recursive: true });
  const hash = keyHash(key);
  let data;
  try { data = JSON.parse(fs.readFileSync(priceFile(hash), 'utf-8')); }
  catch { data = { key, label: label || key, points: [] }; }
  data.key = key;
  if (label) data.label = label;
  const pts = (data.points || []).filter((p) => p.date !== point.date); // 당일 최신으로 대체
  pts.push(point);
  pts.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  data.points = pts.slice(-MAX_POINTS);
  fs.writeFileSync(priceFile(hash), JSON.stringify(data), 'utf-8');
  return { key, hash, points: data.points };
}

/** 원본 키(검색어)로 시계열 포인트 조회. */
export function readPriceSeries(rawKey) {
  const key = normalizeKey(rawKey);
  if (!key) return [];
  return readPriceSeriesByHash(keyHash(key));
}

/** 파일명 해시로 직접 조회(프런트 재조회용). */
export function readPriceSeriesByHash(hash) {
  if (!/^[a-z0-9]+$/i.test(hash)) return [];
  try { return JSON.parse(fs.readFileSync(priceFile(hash), 'utf-8')).points || []; }
  catch { return []; }
}

/** 검색어 → 파일명 해시(프런트에서 관심상품 키 매칭용). */
export function keyHashOf(rawKey) { return keyHash(normalizeKey(rawKey)); }

/* ===== 핫딜 레이더 캐시 (data/deals.json) ===== */

export function saveDeals(items) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const payload = { updatedAt: new Date().toISOString(), items: items || [] };
  fs.writeFileSync(DEALS_FILE, JSON.stringify(payload), 'utf-8');
  return payload;
}

export function readDeals() {
  try { return JSON.parse(fs.readFileSync(DEALS_FILE, 'utf-8')); }
  catch { return { updatedAt: null, items: [] }; }
}

/** 캐시가 maxAgeMs보다 오래됐거나 비었으면 true. */
export function dealsStale(maxAgeMs) {
  const d = readDeals();
  if (!d.updatedAt || !d.items?.length) return true;
  return Date.now() - new Date(d.updatedAt).getTime() > maxAgeMs;
}

/* ===== 관심상품 watch (data/watch.json) ===== */

export function listWatch() {
  try { return JSON.parse(fs.readFileSync(WATCH_FILE, 'utf-8')); }
  catch { return []; }
}

function writeWatch(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(WATCH_FILE, JSON.stringify(list, null, 1), 'utf-8');
}

/** 관심상품 추가(이미 있으면 갱신). key=정규화 검색어. entry={label,query,url,priceOverride,deep} */
export function addWatch(rawKey, entry = {}) {
  const key = normalizeKey(rawKey);
  if (!key) return listWatch();
  const list = listWatch().filter((w) => w.key !== key);
  list.unshift({ key, hash: keyHash(key), addedAt: new Date().toISOString(), lastSampled: null, ...entry });
  writeWatch(list.slice(0, 60));
  return list;
}

export function removeWatch(rawKey) {
  const key = normalizeKey(rawKey);
  const list = listWatch().filter((w) => w.key !== key);
  writeWatch(list);
  return list;
}

export function isWatched(rawKey) {
  const key = normalizeKey(rawKey);
  return listWatch().some((w) => w.key === key);
}

export function markWatchSampled(rawKey) {
  const key = normalizeKey(rawKey);
  const list = listWatch();
  const w = list.find((x) => x.key === key);
  if (w) { w.lastSampled = new Date().toISOString(); writeWatch(list); }
}

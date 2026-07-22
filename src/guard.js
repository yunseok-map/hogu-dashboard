// 공개(prod) 방어 계층 — QA(로컬)에선 전부 무제한, prod에서만 활성.
// ① IP 레이트리밋 ② 전역 동시성 캡 ③ SSRF 차단(스킴/사설IP/allowlist) ④ 관리자 토큰 게이트.
import { lookup } from 'node:dns/promises';
import { IS_PROD } from './env.js';

const int = (v, d) => (Number.isFinite(+v) && +v > 0 ? +v : d);

// ---- 설정(.env.prod로 조정) ----
const RATE_MAX = int(process.env.HOGU_RATE_MAX, 8);           // IP당 허용 횟수
const RATE_WINDOW_MS = int(process.env.HOGU_RATE_WINDOW_MS, 5 * 60 * 1000); // 창(기본 5분)
const CONCURRENCY = int(process.env.HOGU_CONCURRENCY, 2);     // 전역 동시 크롤 상한
const ADMIN_TOKEN = process.env.HOGU_ADMIN_TOKEN || '';
const DEFAULT_ALLOW = [
  'coupang.com', '11st.co.kr', 'gmarket.co.kr', 'auction.co.kr', 'ssg.com', 'emart.com',
  'danawa.com', 'enuri.com', 'naver.com', 'lotteon.com', 'oliveyoung.co.kr', 'kurly.com',
  'apple.com', 'samsung.com', 'lge.co.kr', 'cuckoo.co.kr', 'coway.com',
];
const ALLOWED = (process.env.HOGU_ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const ALLOWLIST = ALLOWED.length ? ALLOWED : DEFAULT_ALLOW;

export const guardStatus = () => ({ env: IS_PROD ? 'prod' : 'qa', rateMax: RATE_MAX, rateWindowMs: RATE_WINDOW_MS, concurrency: CONCURRENCY, adminToken: IS_PROD ? !!ADMIN_TOKEN : 'n/a' });

// ---- 클라이언트 IP(Cloudflare Tunnel 뒤) ----
export function clientIp(req) {
  return req.headers['cf-connecting-ip']
    || (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.ip || req.socket?.remoteAddress || 'unknown';
}

// ---- 레이트리밋(prod 전용) ----
const buckets = new Map();
export function hitRateLimit(name, ip) {
  if (!IS_PROD) return { ok: true };
  const now = Date.now();
  const key = `${name}:${ip}`;
  const arr = (buckets.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) {
    return { ok: false, retry: Math.ceil((RATE_WINDOW_MS - (now - arr[0])) / 1000) };
  }
  arr.push(now);
  buckets.set(key, arr);
  return { ok: true };
}
export function rateLimitMw(name) {
  return (req, res, next) => {
    const r = hitRateLimit(name, clientIp(req));
    if (r.ok) return next();
    res.set('Retry-After', String(r.retry));
    res.status(429).json({ ok: false, error: `요청이 많습니다. ${r.retry}초 후 다시 시도해 주세요.` });
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of buckets) {
    const live = arr.filter((t) => now - t < RATE_WINDOW_MS);
    if (live.length) buckets.set(k, live); else buckets.delete(k);
  }
}, RATE_WINDOW_MS).unref();

// ---- 전역 동시성 캡(prod 전용) ----
let inFlight = 0;
export function acquireSlot() {
  if (IS_PROD && inFlight >= CONCURRENCY) return false;
  inFlight++;
  return true;
}
export function releaseSlot() { inFlight = Math.max(0, inFlight - 1); }

// ---- SSRF/URL 검사 ----
function isPrivateIp(ip) {
  ip = String(ip).toLowerCase();
  if (ip === '::1' || ip === '::' ) return true;
  if (ip.startsWith('::ffff:')) ip = ip.slice(7); // v4-mapped
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;      // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  return ip.startsWith('fe80') || ip.startsWith('fc') || ip.startsWith('fd'); // IPv6 link-local/ULA
}

/** 크롤 대상 URL 안전성 검사. prod에선 쇼핑몰 allowlist까지 강제. */
export async function checkCrawlUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return { ok: false, reason: 'URL 형식이 올바르지 않습니다.' }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, reason: 'http/https 링크만 허용됩니다.' };
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    return { ok: false, reason: '내부 주소는 크롤할 수 없습니다.' };
  }
  try {
    const addrs = await lookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
      return { ok: false, reason: '내부/사설 주소는 크롤할 수 없습니다.' };
    }
  } catch { return { ok: false, reason: '주소를 확인할 수 없습니다.' }; }
  if (IS_PROD && !ALLOWLIST.some((d) => host === d || host.endsWith('.' + d))) {
    return { ok: false, reason: '운영 모드에서는 지원 쇼핑몰 링크 또는 상품명 검색만 가능합니다.' };
  }
  return { ok: true };
}

// ---- 관리자 판별(에러 없이 boolean) ----
export function isAdmin(req) {
  if (!IS_PROD) return true;
  const t = req.headers['x-hogu-admin'] || req.query.admin;
  return !!ADMIN_TOKEN && t === ADMIN_TOKEN;
}

// ---- 관리자 게이트(prod: 토큰 필요, 미설정 시 fail-closed) ----
export function adminGuard(req, res, next) {
  if (!IS_PROD) return next();
  if (!ADMIN_TOKEN) return res.status(403).json({ ok: false, error: '운영 모드: 관리자 토큰(HOGU_ADMIN_TOKEN) 미설정으로 잠금.' });
  const t = req.headers['x-hogu-admin'] || req.query.admin;
  if (t && t === ADMIN_TOKEN) return next();
  res.status(401).json({ ok: false, error: '관리자 권한이 필요합니다.' });
}

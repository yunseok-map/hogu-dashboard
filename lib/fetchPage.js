// 브라우저처럼 보이는 헤더로 페이지를 가져온다. 쇼핑몰 상당수가 기본 fetch UA를 차단한다.
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

/**
 * HTML 페이지를 가져온다.
 * @returns {Promise<{ok: boolean, status: number, html: string, finalUrl: string, error?: string}>}
 */
export async function fetchPage(url, { timeoutMs = 15000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { ...BROWSER_HEADERS, ...headers },
      redirect: 'follow',
      signal: controller.signal,
    });
    const buf = Buffer.from(await res.arrayBuffer());
    let html = buf.toString('utf-8');
    // EUC-KR 페이지 감지 (charset 선언 확인) — 깨진 경우 latin1 재해석은 의미 없어 안내만 남긴다.
    const charsetMatch = html.slice(0, 2000).match(/charset=["']?([\w-]+)/i);
    if (charsetMatch && /euc-kr|ks_c_5601/i.test(charsetMatch[1])) {
      try {
        html = new TextDecoder('euc-kr').decode(buf);
      } catch {
        /* Node의 TextDecoder가 euc-kr 미지원인 빌드면 utf-8 그대로 사용 */
      }
    }
    return { ok: res.ok, status: res.status, html, finalUrl: res.url || url };
  } catch (e) {
    const msg = e.name === 'AbortError' ? `timeout ${timeoutMs}ms` : String(e.message || e);
    return { ok: false, status: 0, html: '', finalUrl: url, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/** JSON API 호출용 (네이버 오픈API 등) */
export async function fetchJson(url, { timeoutMs = 10000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: null, error: String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

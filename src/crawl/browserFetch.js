// 봇 차단 사이트용 실제 브라우저 크롤러. LLM/외부 API 없이 로컬 브라우저 엔진으로 직접 훑는다.
//
// 자동 크롤링 전략 (사용자가 아무것도 안 해도 됨):
//  1) 이미 열린 디버그 Chrome(CDP)이 있으면 거기에 붙는다.
//  2) 없으면 서버가 실제 Chrome을 백그라운드(화면 밖)로 자동 실행해서 CDP로 붙는다.
//     → OS가 정상 실행한 Chrome이라 자동화 지문이 없어 쿠팡(Akamai)급 차단도 통과한다.
//  3) Chrome이 아예 없으면 playwright headless로 폴백한다.
import { spawn, execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let pw = null;
let launched = null;         // playwright가 띄운 headless (최후 폴백)
let launchedWith = null;
let idleTimer = null;

let autoProc = null;         // 우리가 spawn한 실제 Chrome 프로세스
let autoLaunching = null;    // 동시 요청 시 중복 실행 방지용 Promise
const warmedOrigins = new Set(); // Akamai 쿠키 워밍업 완료한 오리진

const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const CDP_ENDPOINT = process.env.CDP_ENDPOINT || `http://localhost:${CDP_PORT}`;
const PROFILE_DIR = path.join(os.tmpdir(), 'hogu-chrome-profile');
const AUTO_LAUNCH = process.env.HOGU_NO_AUTO_CHROME !== '1'; // 끄고 싶으면 환경변수로
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function ensurePw() {
  if (!pw) pw = await import('playwright-core');
  return pw;
}

function findChromeBinary() {
  const c = process.platform === 'win32'
    ? [
        path.join(process.env['ProgramFiles'] || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
        path.join(process.env['LOCALAPPDATA'] || '', 'Google/Chrome/Application/chrome.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
      ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  return c.find((p) => p && fs.existsSync(p)) || null;
}

/** CDP 엔드포인트가 살아있는지 확인 */
async function cdpAlive(timeoutMs = 700) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(CDP_ENDPOINT + '/json/version', { signal: ctrl.signal }).catch(() => null);
    clearTimeout(t);
    return !!(r && r.ok);
  } catch { return false; }
}

/** 실제 Chrome을 백그라운드(화면 밖)로 자동 실행하고 준비될 때까지 대기 */
async function autoLaunchChrome() {
  if (await cdpAlive()) return true;
  if (autoLaunching) return autoLaunching;

  autoLaunching = (async () => {
    const bin = findChromeBinary();
    if (!bin) return false;
    try {
      autoProc = spawn(bin, [
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${PROFILE_DIR}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-popup-blocking',
        '--window-position=-32000,-32000',   // 화면 밖 (사용자 방해 최소화)
        '--window-size=1366,900',
        'about:blank',
      ], { detached: true, stdio: 'ignore' });
      autoProc.unref();
    } catch {
      return false;
    }
    // /json/version 응답까지 최대 ~12초 폴링
    for (let i = 0; i < 40; i++) {
      if (await cdpAlive(500)) return true;
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  })();

  try { return await autoLaunching; }
  finally { autoLaunching = null; }
}

async function getHeadless() {
  if (launched?.isConnected()) return launched;
  const { chromium } = await ensurePw();
  const opts = {
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--lang=ko-KR', '--disable-infobars'],
  };
  for (const channel of ['chrome', 'msedge']) {
    try { launched = await chromium.launch({ ...opts, channel }); launchedWith = channel + ' (headless)'; return launched; }
    catch { /* 다음 후보 */ }
  }
  launched = await chromium.launch(opts);
  launchedWith = 'chromium (headless)';
  return launched;
}

function scheduleIdleClose() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    try { await launched?.close(); } catch { /* 이미 닫힘 */ }
    launched = null;
  }, 60_000);
  if (idleTimer.unref) idleTimer.unref();
}

/** autoProc 트리를 죽인다. sync=true면 프로세스 종료 훅에서 동기로 실행. */
function killAuto({ sync = false } = {}) {
  const pid = autoProc?.pid;
  if (!pid) return;
  autoProc = null;
  try {
    if (process.platform === 'win32') {
      if (sync) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F']);
      else return new Promise((res) => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => res()));
    } else {
      process.kill(-pid); // POSIX: detached spawn이라 그룹 리더 → 그룹 전체 종료
    }
  } catch { /* 무시 */ }
}

export async function closeBrowser() {
  clearTimeout(idleTimer);
  try { await launched?.close(); } catch { /* 무시 */ }
  launched = null;
  await killAuto();
  warmedOrigins.clear();
}

// 강제 종료(신호 핸들러 미도달) 대비 백스톱: 정상 exit 시 동기 정리
process.on('exit', () => killAuto({ sync: true }));

export async function cdpStatus() {
  const available = await cdpAlive();
  return { available, endpoint: CDP_ENDPOINT, autoLaunch: AUTO_LAUNCH, chromeFound: !!findChromeBinary() };
}

/** 지연 로딩 콘텐츠 트리거: 페이지를 몇 단계 스크롤 후 잠시 대기 */
async function lazyScroll(page) {
  try {
    await page.evaluate(async () => {
      for (let i = 1; i <= 2; i++) {
        window.scrollTo(0, (document.body.scrollHeight / 2) * i);
        await new Promise((r) => setTimeout(r, 250));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(500);
  } catch { /* 스크롤 실패는 치명적이지 않음 */ }
}

/** CDP로 붙어 페이지를 가져온다 (연결 실패 시 null) */
async function fetchViaCDP(url, { timeoutMs, scroll, warmup }) {
  const { chromium } = await ensurePw();
  let browser = null, page = null;
  try {
    browser = await chromium.connectOverCDP(CDP_ENDPOINT, { timeout: 5000 });
  } catch {
    return null; // 연결 자체 실패 → 폴백으로
  }
  const looksBlocked = (h) => !h || h.length < 1500 || /access denied|forbidden|잠시 후 다시|비정상적인 접근/i.test(h.slice(0, 3000));
  try {
    const context = browser.contexts()[0] || (await browser.newContext());
    page = await context.newPage();
    const engine = autoProc ? 'real-chrome (자동실행)' : 'real-chrome (CDP)';

    let origin = null;
    try { origin = new URL(url).origin; } catch { /* 잘못된 URL */ }
    // 봇 차단 우회용 홈 워밍업(오리진당 1회). 검색 몰은 차단이 약해 warmup=false로 건너뛴다(성능).
    if (warmup && origin && !warmedOrigins.has(origin)) {
      await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {});
      await page.waitForTimeout(2000);
      warmedOrigins.add(origin);
    }

    let resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForLoadState('networkidle', { timeout: 3500 }).catch(() => {});
    if (scroll) await lazyScroll(page);
    let html = await page.content();

    // 차단으로 보이면 (warmup 껐더라도) 홈 워밍업 후 1회 재시도
    if (looksBlocked(html) && origin) {
      warmedOrigins.delete(origin);
      await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {});
      await page.waitForTimeout(2500);
      warmedOrigins.add(origin);
      resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      if (scroll) await lazyScroll(page);
      html = await page.content();
    }

    const status = resp ? resp.status() : 200;
    return { ok: status >= 200 && status < 400, status, html, finalUrl: page.url(), engine };
  } catch (e) {
    return { ok: false, status: 0, html: '', finalUrl: url, error: 'CDP: ' + String(e.message || e), engine: 'real-chrome' };
  } finally {
    try { await page?.close(); } catch { /* 무시 */ }
    try { await browser?.close(); } catch { /* 연결만 끊음, 브라우저는 유지 */ }
  }
}

/**
 * 실제 브라우저로 페이지를 렌더링해 HTML을 가져온다.
 * @returns {Promise<{ok:boolean, status:number, html:string, finalUrl:string, engine?:string, error?:string}>}
 */
export async function browserFetchPage(url, { timeoutMs = 30000, scroll = false, warmup = true } = {}) {
  const opts = { timeoutMs, scroll, warmup };
  // 1) 이미 열린 CDP Chrome
  if (await cdpAlive()) {
    const r = await fetchViaCDP(url, opts);
    if (r && r.html) return r;
  }
  // 2) 실제 Chrome 자동 실행 후 CDP
  if (AUTO_LAUNCH && await autoLaunchChrome()) {
    const r = await fetchViaCDP(url, opts);
    if (r && r.html) return r;
  }
  // 3) 폴백: playwright headless
  let context = null;
  try {
    const b = await getHeadless();
    context = await b.newContext({
      userAgent: UA, locale: 'ko-KR', timezoneId: 'Asia/Seoul',
      viewport: { width: 1366, height: 900 },
      extraHTTPHeaders: { 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.7' },
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = window.chrome || { runtime: {} };
    });
    const page = await context.newPage();
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
    const html = await page.content();
    const status = resp ? resp.status() : 0;
    return { ok: status >= 200 && status < 400, status, html, finalUrl: page.url(), engine: launchedWith };
  } catch (e) {
    return { ok: false, status: 0, html: '', finalUrl: url, error: String(e.message || e), engine: launchedWith };
  } finally {
    try { await context?.close(); } catch { /* 무시 */ }
    scheduleIdleClose();
  }
}

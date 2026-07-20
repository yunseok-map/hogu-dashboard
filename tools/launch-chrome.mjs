#!/usr/bin/env node
// 봇 차단 사이트(쿠팡 등) 크롤링용 Chrome을 원격 디버깅 포트로 띄운다.
// 대시보드의 browserFetch가 이 Chrome(localhost:9222)에 CDP로 붙어 실제 세션으로 페이지를 훑는다.
// 여기서 로그인해두면(쿠팡 등) 크롤링 성공률이 더 올라간다.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = process.env.CDP_PORT || 9222;
const PROFILE = path.join(os.tmpdir(), 'hogu-chrome-profile'); // 기존 프로필과 분리(잠금 충돌 방지)

const candidates = process.platform === 'win32'
  ? [
      path.join(process.env['ProgramFiles'] || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
      path.join(process.env['LOCALAPPDATA'] || '', 'Google/Chrome/Application/chrome.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    ]
  : process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge'];

const bin = candidates.find((p) => p && fs.existsSync(p));
if (!bin) {
  console.error('❌ Chrome/Edge를 찾지 못했습니다. 직접 실행하세요:');
  console.error(`   chrome.exe --remote-debugging-port=${PORT} --user-data-dir="${PROFILE}"`);
  process.exit(1);
}

console.log(`▶ Chrome 실행: ${bin}`);
console.log(`  디버그 포트: ${PORT}  프로필: ${PROFILE}`);
console.log('  이 창을 켜둔 채로 대시보드에서 쿠팡 URL을 분석하세요.');
console.log('  (쿠팡에 로그인해두면 크롤링 성공률이 더 올라갑니다.)\n');

const child = spawn(bin, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--no-first-run',
  '--no-default-browser-check',
  'https://www.coupang.com',
], { stdio: 'inherit' });

child.on('exit', (code) => process.exit(code ?? 0));

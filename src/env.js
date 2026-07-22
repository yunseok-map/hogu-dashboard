// 환경 로더 — server.js에서 "가장 먼저" import 해야 다른 모듈이 env를 읽기 전에 세팅된다.
// HOGU_ENV = qa(기본, 로컬 개발) | prod(배포/운영). 환경별 .env.<env> → 공통 .env 순으로 로드.
// 이미 셸에 설정된 값은 덮어쓰지 않는다(셸 > 파일).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadFile(file) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf-8'); } catch { return; }
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
    if (m && !m[1].startsWith('#') && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

export const ENV = (process.env.HOGU_ENV || 'qa').toLowerCase();
process.env.HOGU_ENV = ENV;

loadFile(path.join(ROOT, `.env.${ENV}`)); // 환경별(우선)
loadFile(path.join(ROOT, '.env'));        // 공통(보완)

export const IS_PROD = ENV === 'prod';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const RESULTS_DIR = path.join(DATA_DIR, 'results');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const MAX_HISTORY = 100;

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

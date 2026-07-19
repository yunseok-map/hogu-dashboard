// CDP Chrome으로 앱을 열어 쿠폰 배지/렌더 검증 + 스크린샷. 압축 출력만.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0] || (await browser.newContext());
const page = await ctx.newPage();
await page.goto('http://localhost:3311', { waitUntil: 'domcontentloaded', timeout: 20000 });

// deep 분석 결과가 담긴 최신 히스토리를 열어 렌더
const audit = await page.evaluate(async () => {
  const list = await fetch('/api/history').then((r) => r.json());
  // promos가 있는 결과 찾기
  for (const h of list.slice(0, 8)) {
    const r = await fetch('/api/history/' + h.id).then((x) => x.json());
    const hasPromo = (r.similar?.items || []).some((i) => i.promos && i.promos.length);
    if (hasPromo) { window.currentResult = r; window.renderResult(r); break; }
  }
  await new Promise((res) => setTimeout(res, 500));
  return {
    promoEls: document.querySelectorAll('.promo').length,
    cellPromos: document.querySelectorAll('.cell-promos').length,
    tableRows: document.querySelectorAll('#itemTable tbody tr').length,
    stickerText: document.querySelector('.sticker')?.textContent || null,
    hScroll: document.body.scrollWidth > innerWidth,
    samplePromos: [...document.querySelectorAll('.cell-promos .promo')].slice(0, 6).map((e) => e.textContent),
  };
});
await page.evaluate(() => window.scrollTo(0, document.querySelector('#itemTable').getBoundingClientRect().top + scrollY - 90));
await page.waitForTimeout(300);
const shot = await page.screenshot();
fs.writeFileSync('scripts/_ui-shot.png', shot);
console.log(JSON.stringify(audit, null, 1));
await page.close();
await browser.close();
process.exit(0);

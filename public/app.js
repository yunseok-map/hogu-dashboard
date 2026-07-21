/* 호구체크 v6 "일렉트릭 리소" 프런트엔드 — 구조/규칙은 docs/DESIGN.md 참고 */
'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const won = (n) => (n == null ? '—' : n.toLocaleString('ko-KR') + '원');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

let currentResult = null;
let sortKey = 'price';
let es = null;
let historyPts = [];

/* ===== 유틸 ===== */
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), ms);
}

function relTime(ts) {
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (d < 60) return '방금';
  if (d < 3600) return `${Math.floor(d / 60)}분 전`;
  if (d < 86400) return `${Math.floor(d / 3600)}시간 전`;
  if (d < 86400 * 7) return `${Math.floor(d / 86400)}일 전`;
  return new Date(ts).toLocaleDateString('ko-KR');
}

const fmtDate = (d) =>
  `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}.`;

/** 'YYYY-MM-DD' → 'MM.DD' (가격 추이 축 라벨) */
const fmtMD = (s) => { const p = String(s).split('-'); return p.length === 3 ? `${p[1]}.${p[2]}` : String(s); };

/** 숫자 카운트업 */
function countUp(el, to, { dur = 700, format = (v) => Math.round(v).toLocaleString('ko-KR') } = {}) {
  if (to == null) { el.textContent = '—'; return; }
  if (REDUCED || to === 0) { el.textContent = format(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    el.textContent = format(to * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ===== 화면 상태 ===== */
function showView(name) {
  $('#empty').classList.toggle('hidden', name !== 'empty');
  $('#skeleton').classList.toggle('hidden', name !== 'loading');
  $('#result').classList.toggle('hidden', name !== 'result');
  $('#loadbar').classList.toggle('on', name === 'loading');
  $('#statusLine').classList.toggle('hidden', name !== 'loading');
}

/* ===== 단축키 / 홈 ===== */
document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '');
  if (e.key === '/' && !typing) { e.preventDefault(); $('#urlInput').focus(); }
});
$('#homeBtn').addEventListener('click', () => {
  history.replaceState(null, '', '/');
  showView('empty');
  window.scrollTo({ top: 0, behavior: 'instant' });
});

/* ===== 분석 실행 ===== */
$('#analyzeBtn').addEventListener('click', startAnalyze);
$('#urlInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') startAnalyze(); });
$('#priceInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') startAnalyze(); });

function startAnalyze(rawArg) {
  const raw = (typeof rawArg === 'string' ? rawArg : $('#urlInput').value).trim();
  if (!raw) { $('#urlInput').focus(); return; }
  const price = Number($('#priceInput').value.replace(/[^\d]/g, '')) || undefined;

  const params = new URLSearchParams();
  params.set(/^https?:\/\//i.test(raw) ? 'url' : 'query', raw);
  if (price) params.set('price', price);
  if ($('#deepChk')?.checked) params.set('deep', '1');

  es?.close();
  $('#analyzeBtn').disabled = true;
  $('#errorBox').classList.add('hidden');
  showView('loading');
  $('#statusText').textContent = '감정 접수…';

  es = new EventSource('/api/analyze/stream?' + params);
  es.addEventListener('progress', (e) => {
    $('#statusText').textContent = JSON.parse(e.data).detail;
  });
  es.addEventListener('result', (e) => {
    es.close();
    $('#analyzeBtn').disabled = false;
    const result = JSON.parse(e.data);
    if (!result.ok) {
      showView('empty');
      showError(result.error || '감정에 실패했습니다.');
      return;
    }
    currentResult = result;
    history.replaceState(null, '', '?id=' + result.id);
    renderResult(result);
    loadHistory();
  });
  es.onerror = () => {
    es.close();
    $('#analyzeBtn').disabled = false;
    showView('empty');
    showError('서버 연결이 끊겼습니다. 서버가 실행 중인지 확인하세요.');
  };
}

function showError(msg) {
  $('#errorBox').textContent = msg;
  $('#errorBox').classList.remove('hidden');
  toast('감정 실패 — 안내를 확인하세요');
}

/* ===== 결과 렌더링 ===== */
function renderResult(r) {
  showView('result');
  renderVerdict(r);
  renderDeal(r);
  renderProduct(r);
  renderChart(r);
  renderPriceHistory(r);
  renderAlternatives(r);
  renderReviews(r);
  renderTable(r);
  renderWeb(r);
  setWatchBtn(!!r.watched);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* ===== 이래서 이득 — 상황별 렌더 ===== */
function renderDeal(r) {
  const box = $('#dealBox');
  const d = r.verdict.dealPitch;
  if (!d) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const linesHtml = (d.lines || []).map((l) => `<li>${l}</li>`).join('');

  if (d.kind === 'already-best') {
    // 내 가격이 이미 최저 — "저걸 사라"는 오해 방지: 내 가격을 확정 프레임으로
    const cta = d.productUrl
      ? `<a class="deal-go" href="${esc(d.productUrl)}" target="_blank" rel="noopener noreferrer">이 상품 보러 가기 →</a>` : '';
    box.className = 'deal deal-ok';
    box.innerHTML = `
      <div class="deal-head deal-head-ok">지금이 최저가</div>
      <div class="deal-card best">
        <div class="deal-l">
          <span class="deal-kicker">지금 보고 계신 가격</span>
          <span id="dealEff" class="deal-eff-num">${won(d.myPrice)}</span>
          <span class="deal-eff-lbl">이미 시세보다 쌉니다 · 바로 사도 좋아요</span>
          ${cta}
        </div>
        <div class="deal-r">
          <div class="deal-ref"><span>시세 최저</span><b>${won(d.marketLow?.price)}</b><span>${esc(d.marketLow?.mall || d.marketLow?.provider || '')}</span></div>
        </div>
      </div>
      <ul class="deal-lines">${linesHtml}</ul>`;
    countUp($('#dealEff'), d.myPrice, { format: (x) => Math.round(x).toLocaleString('ko-KR') + '원' });
    return;
  }

  // better-deal — 더 싼 판매처로 사러 가기
  const b = d.best || {};
  const saveHtml = b.savingsVsMine > 0
    ? `<span class="deal-save-lbl">내 가격보다</span><b>−${won(b.savingsVsMine)}</b>`
    : (b.savingsVsMedian > 0 ? `<span class="deal-save-lbl">시세보다</span><b>−${won(b.savingsVsMedian)}</b>` : '');
  const promos = (b.promos || []).map((t) => `<span class="promo">${esc(t)}</span>`).join('')
    + (b.discount > 0 ? `<span class="promo promo-hot">쿠폰 −${won(b.discount)}</span>` : '');
  const meta = [
    b.discount > 0 ? `정가 ${won(b.price)}` : null,
    b.rating != null ? `★${b.rating}${b.reviewCount ? ` (${b.reviewCount.toLocaleString('ko-KR')})` : ''}` : null,
  ].filter(Boolean).join(' · ');
  box.className = 'deal';
  box.innerHTML = `
    <div class="deal-head deal-head-hot">여기서 사면 더 쌉니다</div>
    <a class="deal-card better" href="${esc(b.link || '#')}" target="_blank" rel="noopener noreferrer">
      <div class="deal-l">
        <span class="deal-kicker">최저 실구매처 · ${esc(b.mall || b.provider || '')}</span>
        <span id="dealEff" class="deal-eff-num">${won(b.effPrice)}</span>
        <span class="deal-eff-lbl">쿠폰 적용 실구매가</span>
        <div class="deal-title">${esc(b.title || '')}</div>
        <div class="promos">${promos}</div>
        ${meta ? `<div class="deal-meta">${esc(meta)}</div>` : ''}
      </div>
      <div class="deal-r">
        ${saveHtml ? `<div class="deal-save">${saveHtml}</div>` : ''}
        <span class="deal-go">사러 가기 →</span>
      </div>
    </a>
    <ul class="deal-lines">${linesHtml}</ul>`;
  countUp($('#dealEff'), b.effPrice, { format: (x) => Math.round(x).toLocaleString('ko-KR') + '원' });
}

const TIER_CLS = { great: 'tier-great', fair: 'tier-fair', meh: 'tier-meh', bad: 'tier-bad', hogu: 'tier-hogu', unknown: 'tier-unknown' };

const TIER_FILL = { great: '#46e07d', fair: '#46e07d', meh: '#ffc22e', bad: '#ff8a3c', hogu: '#ff3b52', unknown: '#d8d5e0' };

function renderVerdict(r) {
  const v = r.verdict;
  countUp($('#verdictScore'), v.score, { dur: 900, format: (x) => String(Math.round(x)) });
  if (v.score == null) $('#verdictScore').textContent = '—';

  // 바버폴 미터
  const fill = $('#meterFill');
  fill.style.setProperty('--fillc', TIER_FILL[v.tier] || TIER_FILL.unknown);
  fill.style.width = '0%';
  requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = (v.score ?? 0) + '%'; }));

  // 스티커 (재부착 시 슬랩 애니메이션 재시작)
  const stk = $('#verdictLabel');
  stk.textContent = v.label;
  stk.className = 'sticker ' + (TIER_CLS[v.tier] || 'tier-unknown');
  stk.style.animation = 'none';
  void stk.offsetWidth;
  stk.style.animation = '';

  $('#reasons').innerHTML = v.reasons.map((t) => `<li>${esc(t)}</li>`).join('') ||
    '<li>가격 정보가 부족해 판정하지 못했습니다. 본 가격을 직접 입력해 보세요.</li>';
  $('#verdictWarnings').innerHTML = v.warnings.map((t) => `<div>${esc(t)}</div>`).join('');
  buildTicker(r);
}

/** 시세 마퀴 티커: 통계를 두 벌 채워 무한 루프 */
function buildTicker(r) {
  const s = r.verdict.stats;
  const wrap = document.querySelector('.ticker-data');
  if (!s) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  const parts = [
    `내 가격 <b>${won(r.product.price)}</b>`,
    `비교군 최저 <b>${won(s.min)}</b>`,
    `중앙값 <b>${won(s.median)}</b>`,
    `평균 <b>${won(s.avg)}</b>`,
    `최고 <b>${won(s.max)}</b>`,
    r.verdict.savingsPotential > 0 ? `아낄 수 있는 돈 <b>${won(r.verdict.savingsPotential)}</b>` : `비교 상품 <b>${s.count}개</b>`,
  ];
  const half = parts.map((p) => `<span>${p}</span><i>▸</i>`).join('');
  $('#priceTicker').innerHTML = half + half;
}

function renderProduct(r) {
  const p = r.product;
  const img = $('#pImage');
  if (p.image) { img.src = p.image; img.classList.remove('hidden'); img.onerror = () => img.classList.add('hidden'); }
  else img.classList.add('hidden');

  const titleEl = $('#pTitle');
  titleEl.textContent = p.title || '(제목 없음)';
  if (p.url) titleEl.href = p.url; else titleEl.removeAttribute('href');

  const priceEl = $('#pPrice');
  if (p.price != null) {
    priceEl.innerHTML = `<span class="pp-num"></span>${p.originalPrice && p.originalPrice > p.price ? `<span class="orig">${won(p.originalPrice)}</span>` : ''}`;
    countUp(priceEl.querySelector('.pp-num'), p.price, { format: (x) => Math.round(x).toLocaleString('ko-KR') + '원' });
  } else {
    priceEl.innerHTML = '<span style="font-family:var(--sans);color:var(--faint);font-size:13px;font-weight:500">가격 미확인 — 본 가격을 입력하면 판정됩니다</span>';
  }
  $('#pRating').innerHTML = p.rating != null
    ? `<span class="stars">${stars(p.rating)}</span> ${p.rating}점 · 리뷰 ${p.reviewCount?.toLocaleString('ko-KR') ?? '?'}건`
    : '<span style="color:var(--faint)">평점 미확인</span>';
  const mallEl = $('#pMall');
  mallEl.textContent = [p.mall, p.brand && `브랜드 ${p.brand}`].filter(Boolean).join(' · ');
  mallEl.title = `추출: ${p.source} / ${p.fetchEngine || 'http'}`;
  // 쿠폰·이벤트 배지
  const promoEl = $('#pPromos');
  if (promoEl) {
    promoEl.innerHTML = (p.promos || []).map((t) => `<span class="promo">${esc(t)}</span>`).join('');
    promoEl.classList.toggle('hidden', !(p.promos && p.promos.length));
  }
  $('#pWarnings').innerHTML = (p.warnings || []).map((t) => `<div>${esc(t)}</div>`).join('');

  // 통계 블록
  const s = r.verdict.stats;
  const rows = [{ k: '내 가격', v: won(p.price) }];
  if (s) rows.push({ k: '비교군 최저가', v: won(s.min) }, { k: '중앙값', v: won(s.median) }, { k: '평균가', v: won(s.avg) }, { k: '비교 상품', v: s.count + '개' });
  if (r.verdict.savingsPotential > 0) rows.push({ k: '아낄 수 있는 돈', v: won(r.verdict.savingsPotential), hl: true });
  $('#statTiles').innerHTML = rows.map((t) =>
    `<div class="block ${t.hl ? 'hl' : ''}"><span class="k">${t.k}</span><span class="v">${t.v}</span></div>`).join('');
}

const stars = (r) => '★'.repeat(Math.min(5, Math.round(r))) + '☆'.repeat(Math.max(0, 5 - Math.round(r)));

/* ===== 시세 분포 차트 (잉크 스타일) ===== */
function renderChart(r) {
  const svg = $('#priceChart');
  const box = svg.parentElement;
  const items = r.similar.items.filter((it) => it.price && it.similarity >= (r.verdict.similarityThreshold ?? 0.2));
  const myPrice = r.product.price;
  const prices = items.map((i) => i.price).concat(myPrice ? [myPrice] : []);
  $('#chartLegend').innerHTML = `
    <span class="li"><span class="dot"></span>유사 상품 ${items.length}개</span>
    ${myPrice ? '<span class="li"><span class="dia"></span>내 가격</span>' : ''}`;
  if (prices.length < 2) {
    svg.innerHTML = '<text x="10" y="30" fill="#8d8672" font-size="13">표시할 가격 데이터가 부족합니다.</text>';
    return;
  }
  const W = Math.max(480, box.clientWidth || 700), H = 150;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const padL = 18, padR = 26, y0 = 86;
  const min = Math.min(...prices), max = Math.max(...prices);
  const span = Math.max(1, max - min);
  const x = (p) => padL + ((p - min) / span) * (W - padL - padR);

  let el = `<line x1="${padL}" y1="${y0 + 24}" x2="${W - padR}" y2="${y0 + 24}" stroke="var(--ink)" stroke-width="1.2"/>`;
  for (const t of niceTicks(min, max, 5)) {
    if (t < min || t > max) continue;
    el += `<line x1="${x(t)}" y1="${y0 + 20}" x2="${x(t)}" y2="${y0 + 28}" stroke="var(--hair)"/>
           <text x="${x(t)}" y="${y0 + 44}" text-anchor="middle" font-size="11" fill="var(--faint)">${compactWon(t)}</text>`;
  }
  items.forEach((it, i) => {
    const jitter = ((i * 37) % 40) - 20;
    el += `<circle class="chart-dot" data-i="${i}" cx="${x(it.price).toFixed(1)}" cy="${y0 - 24 + jitter}" r="5.5"
             fill="var(--blue)" fill-opacity="0.85" stroke="var(--ink)" stroke-width="1.5"
             style="animation-delay:${Math.min(i * 30, 500)}ms"/>`;
  });
  if (myPrice) {
    const mx = x(myPrice);
    el += `<line x1="${mx}" y1="10" x2="${mx}" y2="${y0 + 24}" stroke="var(--t-hogu)" stroke-width="2" stroke-dasharray="6 4"/>
           <rect x="${mx - 6.5}" y="${y0 - 57}" width="13" height="13" fill="var(--t-hogu)" stroke="var(--ink)" stroke-width="1.5" transform="rotate(45 ${mx} ${y0 - 50.5})"/>
           <text x="${mx}" y="8" text-anchor="middle" font-size="12" font-weight="900" fill="var(--ink)" dominant-baseline="hanging">내 가격 ${compactWon(myPrice)}</text>`;
  }
  svg.innerHTML = el;

  const tip = $('#tooltip');
  svg.querySelectorAll('.chart-dot').forEach((dot) => {
    dot.addEventListener('mousemove', (e) => {
      const it = items[Number(dot.dataset.i)];
      tip.innerHTML = `<b>${esc(it.title.slice(0, 60))}</b>${won(it.price)} · ${esc(it.mall || it.provider)}${it.rating ? ` · ★${it.rating}` : ''}`;
      tip.style.left = Math.min(e.clientX + 14, innerWidth - 290) + 'px';
      tip.style.top = e.clientY + 14 + 'px';
      tip.classList.remove('hidden');
    });
    dot.addEventListener('mouseleave', () => tip.classList.add('hidden'));
    dot.addEventListener('click', () => window.open(items[Number(dot.dataset.i)].link, '_blank', 'noopener'));
  });
}

function compactWon(n) {
  if (n >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, '') + '억';
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '만';
  return n.toLocaleString('ko-KR');
}
function niceTicks(min, max, count) {
  const span = max - min;
  const step = Math.pow(10, Math.floor(Math.log10(span / count)));
  const err = span / count / step;
  const s = step * (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1);
  const out = [];
  for (let t = Math.ceil(min / s) * s; t <= max; t += s) out.push(t);
  return out;
}
/* ===== 가격 추이 (일자별 시계열) ===== */
function renderPriceHistory(r) {
  const block = $('#historyBlock');
  const apply = (points) => {
    historyPts = Array.isArray(points) ? points : [];
    if (historyPts.length < 2) { block.classList.add('hidden'); return; }
    block.classList.remove('hidden');
    const hasMy = historyPts.some((p) => p.myPrice != null);
    $('#historyLegend').innerHTML =
      `<span class="li"><span class="hl-med"></span>중앙값</span>` +
      (hasMy ? `<span class="li"><span class="hl-my"></span>내 가격</span>` : '') +
      `<span class="li"><span class="hl-band"></span>최저–최고</span>`;
    $('#historyNote').textContent = `${historyPts.length}개 시점 · ${fmtMD(historyPts[0].date)} ~ ${fmtMD(historyPts[historyPts.length - 1].date)}`;
    drawHistoryChart(historyPts);
  };
  apply(r.priceHistory || []);
  // 저장된(오래된) 결과 재오픈 시 최신 시계열로 갱신
  if (r.priceKey) {
    fetch('/api/price-history/' + encodeURIComponent(r.priceKey))
      .then((x) => x.json()).then((d) => { if (d && Array.isArray(d.points)) apply(d.points); })
      .catch(() => {});
  }
}

function drawHistoryChart(points) {
  const svg = $('#historyChart');
  const box = svg.parentElement;
  const W = Math.max(480, box.clientWidth || 700), H = 150;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const padL = 14, padR = 44, padT = 14, padB = 34;
  const vals = [];
  points.forEach((p) => [p.min, p.median, p.max, p.myPrice].forEach((v) => { if (v != null) vals.push(v); }));
  if (vals.length < 2) { svg.innerHTML = ''; return; }
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo *= 0.98; hi *= 1.02; }
  const n = points.length;
  const x = (i) => padL + (n === 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
  const y = (v) => (H - padB) - ((v - lo) / (hi - lo)) * (H - padT - padB);

  let el = '';
  for (const t of niceTicks(lo, hi, 4)) {
    if (t < lo || t > hi) continue;
    el += `<line x1="${padL}" y1="${y(t).toFixed(1)}" x2="${W - padR}" y2="${y(t).toFixed(1)}" stroke="var(--hair)" stroke-dasharray="2 3"/>
           <text x="${W - padR + 4}" y="${y(t).toFixed(1)}" font-size="10" fill="var(--faint)" dominant-baseline="middle">${compactWon(t)}</text>`;
  }
  // 최저–최고 밴드
  if (points.some((p) => p.min != null && p.max != null)) {
    const top = points.map((p, i) => `${x(i).toFixed(1)},${y(p.max ?? p.median ?? p.min).toFixed(1)}`);
    const bot = points.map((p, i) => `${x(i).toFixed(1)},${y(p.min ?? p.median ?? p.max).toFixed(1)}`).reverse();
    el += `<polygon points="${top.concat(bot).join(' ')}" fill="var(--lime)" fill-opacity="0.2" stroke="none"/>`;
  }
  const line = (sel, color, dash) => {
    const pts = points.map((p, i) => (p[sel] != null ? `${x(i).toFixed(1)},${y(p[sel]).toFixed(1)}` : null)).filter(Boolean);
    return pts.length > 1 ? `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="${dash ? 2 : 2.5}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>` : '';
  };
  el += line('median', 'var(--blue)', null);
  el += line('myPrice', 'var(--t-hogu)', '6 4');

  const labelEvery = Math.max(1, Math.ceil(n / 6));
  points.forEach((p, i) => {
    if (p.median != null) el += `<circle cx="${x(i).toFixed(1)}" cy="${y(p.median).toFixed(1)}" r="3.5" fill="var(--blue)" stroke="var(--ink)" stroke-width="1.3"/>`;
    if (p.myPrice != null) { const mx = x(i), my = y(p.myPrice); el += `<rect x="${(mx - 3).toFixed(1)}" y="${(my - 3).toFixed(1)}" width="6" height="6" fill="var(--t-hogu)" stroke="var(--ink)" stroke-width="1.2" transform="rotate(45 ${mx.toFixed(1)} ${my.toFixed(1)})"/>`; }
    if (i % labelEvery === 0 || i === n - 1) el += `<text x="${x(i).toFixed(1)}" y="${H - padB + 16}" text-anchor="middle" font-size="10" fill="var(--faint)">${fmtMD(p.date)}</text>`;
  });
  svg.innerHTML = el;
}

new ResizeObserver(() => {
  if (currentResult && !$('#result').classList.contains('hidden')) {
    renderChart(currentResult);
    if (historyPts.length >= 2) drawHistoryChart(historyPts);
  }
}).observe(document.body);

/* ===== 더 싼 구매처 (원장) ===== */
function renderAlternatives(r) {
  const alts = r.verdict.alternatives || [];
  $('#altSection').classList.toggle('hidden', !alts.length);
  $('#altCards').innerHTML = alts.map((a) => {
    const hasCoupon = a.discount > 0 && a.effPrice != null;
    const priceHtml = hasCoupon
      ? `<span class="alt-p">${won(a.effPrice)}<span class="alt-orig">${won(a.price)}</span></span>`
      : `<span class="alt-p">${won(a.price)}</span>`;
    const promos = (a.promos || []).map((t) => `<span class="promo">${esc(t)}</span>`).join('')
      + (hasCoupon ? `<span class="promo promo-hot">쿠폰 −${won(a.discount)}</span>` : '');
    return `<li><a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">
      <span class="alt-t">${esc(a.title)}${promos}</span>
      <span class="alt-meta">${esc(a.mall || a.provider)}${a.rating ? ` · ★${a.rating}` : ''}</span>
      <span class="alt-leader"></span>
      ${priceHtml}
      ${a.savings > 0 ? `<span class="alt-save">−${won(a.savings)}</span>` : ''}
      <span class="alt-go">→</span>
    </a></li>`;
  }).join('');
}

/* ===== 리뷰 소견 / 참고 자료 ===== */
function renderReviews(r) {
  const rv = r.verdict.reviewVerdict;
  $('#reviewVerdict').innerHTML = rv.lines.map((l, i) => `<div class="${i === 0 ? 'rv-' + rv.sentiment : ''}">${esc(l)}</div>`).join('');
  $('#reviewSnippets').innerHTML = (r.product.reviews || []).slice(0, 8).map((s) => `
    <div class="quote">${esc(s.text.slice(0, 200))}<span class="who">— ${s.rating ? `★${s.rating} · ` : ''}${esc(s.author || '익명')}</span></div>`).join('');
  $('#reviewLinks').innerHTML = (r.reviewSearchLinks || []).map((l) =>
    `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.name)}</a>`).join('');
}

function renderWeb(r) {
  const web = r.similar.webResults || [];
  $('#webSection').classList.toggle('hidden', !web.length);
  $('#webResults').innerHTML = web.map((w) => `
    <li><a class="t" href="${esc(w.link)}" target="_blank" rel="noopener noreferrer">${esc(w.title)}</a>
      ${w.snippet ? `<div class="s">${esc(w.snippet.slice(0, 140))}</div>` : ''}
      <div class="h">${esc(w.mall || '')}</div></li>`).join('');
}

/* ===== 전체 비교 목록 ===== */
$('#simFilter').addEventListener('change', () => currentResult && renderTable(currentResult));
$$('.sort').forEach((b) => b.addEventListener('click', () => {
  sortKey = b.dataset.sort;
  $$('.sort').forEach((x) => x.classList.toggle('active', x === b));
  if (currentResult) renderTable(currentResult);
}));

function renderTable(r) {
  const myPrice = r.product.price;
  const thr = Math.max(0.2, r.verdict.similarityThreshold ?? 0.2);
  let items = [...r.similar.items];
  if ($('#simFilter').checked) items = items.filter((it) => it.similarity >= thr);
  items.sort((a, b) => {
    if (sortKey === 'price') return (a.price ?? Infinity) - (b.price ?? Infinity);
    if (sortKey === 'rating') return (b.rating ?? -1) - (a.rating ?? -1);
    return b.similarity - a.similarity;
  });
  $('#itemCount').textContent = `${items.length}건 표시 · 전체 ${r.similar.items.length}건 수집`;
  $('#itemTable tbody').innerHTML = items.map((it, i) => {
    const simCls = it.similarity >= 0.45 ? 'sim-hi' : it.similarity >= 0.25 ? 'sim-mid' : 'sim-lo';
    let delta = '—', deltaCls = '';
    if (myPrice && it.price) {
      const d = it.price - myPrice;
      if (d < 0) { delta = '−' + won(-d); deltaCls = 'down'; }
      else if (d > 0) { delta = '+' + won(d); deltaCls = 'up'; }
      else delta = '동일';
    }
    return `<tr class="${it.similarity < 0.2 ? 'dim' : ''}">
      <td class="num c-idx">${String(i + 1).padStart(2, '0')}</td>
      <td class="c-name"><a class="item-title" href="${esc(it.link)}" target="_blank" rel="noopener noreferrer">${esc(it.title)}</a>${(it.promos || []).length ? `<div class="cell-promos">${it.promos.map((t) => `<span class="promo">${esc(t)}</span>`).join('')}</div>` : ''}</td>
      <td class="num" data-th="가격"><b>${won(it.price)}</b></td>
      <td class="num ${deltaCls}" data-th="내 가격 대비">${delta}</td>
      <td data-th="평점">${it.rating != null ? `<span><span class="stars">★</span> ${it.rating}</span>` : '—'}</td>
      <td class="num" data-th="리뷰">${it.reviewCount != null ? it.reviewCount.toLocaleString('ko-KR') : '—'}</td>
      <td class="num ${simCls}" data-th="유사도">${Math.round(it.similarity * 100)}%</td>
      <td data-th="출처"><span class="prov">${esc(it.mall || it.provider)}</span></td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" style="color:var(--faint)">표시할 상품이 없습니다. 필터를 꺼보세요.</td></tr>';
}

/* ===== 지난 감정 목록 ===== */
async function loadHistory() {
  const list = await fetch('/api/history').then((r) => r.json()).catch(() => []);
  $('#histCount').textContent = list.length;
  $('#indexCount').textContent = list.length ? `${list.length}건 보관 중` : '';

  $('#historyList').innerHTML = list.length
    ? list.map((h) => `
      <li class="index-item"><button type="button" data-id="${h.id}">
        <span class="idx-title">${esc(h.title)}</span>
        ${h.verdict ? `<span class="mini-stamp ${TIER_CLS[h.verdict.tier] || 'tier-unknown'}">${h.verdict.label}</span>` : ''}
        <span class="idx-leader"></span>
        ${h.price != null ? `<span class="idx-price">${won(h.price)}</span>` : ''}
        <span class="idx-time">${relTime(h.ts)}</span>
        <span class="idx-del" data-del="${h.id}" title="삭제">×</span>
      </button></li>`).join('')
    : '<li class="idx-empty">아직 감정 기록이 없습니다. 첫 감정을 의뢰해 보세요.</li>';

  $$('#historyList .index-item > button').forEach((el) => el.addEventListener('click', async (e) => {
    if (e.target.dataset.del) return;
    await openResult(el.dataset.id);
  }));
  $$('.idx-del').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    await fetch('/api/history/' + b.dataset.del, { method: 'DELETE' });
    if (new URLSearchParams(location.search).get('id') === b.dataset.del) history.replaceState(null, '', '/');
    loadHistory();
  }));
}

async function openResult(id) {
  const r = await fetch('/api/history/' + id).then((x) => x.json()).catch(() => null);
  if (r && r.ok) {
    currentResult = r;
    history.replaceState(null, '', '?id=' + id);
    renderResult(r);
  } else {
    toast('기록을 불러오지 못했습니다');
  }
}

/* ===== 핫딜 레이더 (2트랙: 검색 기반 / 키워드 특가) ===== */
async function loadDeals() {
  const payload = await fetch('/api/deals').then((r) => r.json()).catch(() => null);
  renderRadar(payload);
}
function dealCardHtml(d) {
  const disc = d.discountPct ? `<span class="rd-disc">-${d.discountPct}%</span>` : '';
  const price = d.price != null ? `<span class="rd-price">${won(d.price)}</span>` : '';
  const orig = (d.origPrice != null && d.origPrice !== d.price) ? `<span class="rd-orig">${won(d.origPrice)}</span>` : '';
  const save = d.savings > 0 ? `<span class="rd-save">-${won(d.savings)}</span>` : '';
  const srcCls = d.source === '공홈' ? 'rd-src rd-src-mall' : d.source === '키워드' ? 'rd-src rd-src-kw' : 'rd-src';
  const srcTxt = d.source === '공홈' ? '공식몰' : d.source === '키워드' ? esc(d.keyword || '키워드') : '포착';
  const badges = (d.badges || []).slice(0, 2).map((b) => `<span class="promo">${esc(b)}</span>`).join('');
  const inner = `<span class="rd-top"><span class="${srcCls}">${srcTxt}</span><span class="rd-mall">${esc(d.mall || '')}</span>${disc}</span>
    <span class="rd-title">${esc(d.title || '')}</span>
    <span class="rd-bottom">${price}${orig}${save}</span>
    ${badges ? `<span class="rd-badges">${badges}</span>` : ''}`;
  return d.url
    ? `<li><a class="rd-card" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">${inner}</a></li>`
    : `<li><span class="rd-card">${inner}</span></li>`;
}
function renderRadar(payload) {
  const items = (payload && payload.items) || [];
  const search = items.filter((d) => d.source !== '키워드' && d.source !== '공홈');
  const crawl = items.filter((d) => d.source === '키워드' || d.source === '공홈');
  $('#radarList').innerHTML = search.map(dealCardHtml).join('');
  $('#radarListKw').innerHTML = crawl.map(dealCardHtml).join('');
  $('#radarGroupSearch').classList.toggle('hidden', !search.length);
  $('#radarGroupKw').classList.toggle('hidden', !crawl.length);
  $('#dealRadar').classList.toggle('hidden', !items.length);
  $('#radarNote').textContent = items.length
    ? `검색 ${search.length} · 키워드/공홈 ${crawl.length}${payload.updatedAt ? ' · ' + relTime(payload.updatedAt) + ' 갱신' : ''}${payload.refreshing ? ' · 수집 중…' : ''}`
    : '';
}
$('#radarRefresh').addEventListener('click', async () => {
  const btn = $('#radarRefresh'); const old = btn.textContent;
  btn.disabled = true; btn.textContent = '수집 중…';
  try {
    await fetch('/api/deals/refresh?malls=1', { method: 'POST' });
    toast('핫딜 수집 시작 — 잠시 후 자동 반영됩니다');
    setTimeout(() => { btn.disabled = false; btn.textContent = old; }, 12000);
    let n = 0; const iv = setInterval(async () => { n++; await loadDeals(); if (n >= 15) clearInterval(iv); }, 10000);
  } catch { toast('갱신 실패'); btn.disabled = false; btn.textContent = old; }
});

/* ===== 관심상품 담기 ===== */
function setWatchBtn(on) {
  const b = $('#watchBtn');
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.classList.toggle('on', !!on);
  b.textContent = on ? '✓ 관심상품 추적 중' : '＋ 관심상품 담기';
}
$('#watchBtn').addEventListener('click', async () => {
  if (!currentResult) return;
  const r = currentResult;
  const on = $('#watchBtn').getAttribute('aria-pressed') === 'true';
  try {
    if (on) {
      await fetch('/api/watch/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: r.query }) });
      setWatchBtn(false); toast('관심상품에서 제외했습니다');
    } else {
      await fetch('/api/watch', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: r.query, label: r.product?.title || r.query, url: r.product?.url || null, priceOverride: r.product?.price ?? null }) });
      setWatchBtn(true); toast('관심상품에 담았습니다 — 주기적으로 시세를 추적합니다');
    }
  } catch { toast('관심상품 처리에 실패했습니다'); }
});

/* ===== 견본 버튼 ===== */
$$('.try').forEach((b) => b.addEventListener('click', () => {
  $('#urlInput').value = b.dataset.q;
  startAnalyze(b.dataset.q);
}));

/* ===== 초기화 ===== */
(async function init() {
  showView('empty');
  loadDeals();
  await loadHistory();

  const id = new URLSearchParams(location.search).get('id');
  if (id) await openResult(id);

  const health = await fetch('/api/health').then((r) => r.json()).catch(() => null);
  const base = ['다나와', '에누리'];
  if (health?.naverApi) base.unshift('네이버쇼핑API');
  const deep = ['SSG', '11번가', '옥션', 'G마켓'];
  $('#srcStatus').textContent = `가격 소스: ${base.join(' · ')} + 정밀검색 시 ${deep.join('·')}`;
  if (health && health.cdp && health.cdp.chromeFound === false) {
    toast('Chrome이 없어 일부 차단 사이트는 상품명+가격 입력으로 이용하세요', 4000);
  }
})();

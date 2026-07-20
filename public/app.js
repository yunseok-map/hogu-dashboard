/* 호구체크 v4 "종이 감정서" 프런트엔드 — 구조/규칙은 docs/DESIGN.md 참고 */
'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const won = (n) => (n == null ? '—' : n.toLocaleString('ko-KR') + '원');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

let currentResult = null;
let sortKey = 'price';
let es = null;

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
  renderAlternatives(r);
  renderReviews(r);
  renderTable(r);
  renderWeb(r);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* ===== 이래서 이득 (최저 실구매 딜) ===== */
function renderDeal(r) {
  const box = $('#dealBox');
  const d = r.verdict.dealPitch;
  if (!d || !d.best) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const b = d.best;
  $('#dealCard').href = b.link || '#';
  const effEl = $('#dealEff');
  countUp(effEl, b.effPrice, { format: (x) => Math.round(x).toLocaleString('ko-KR') + '원' });
  $('#dealSave').innerHTML = b.savingsVsMine > 0
    ? `내 가격보다 <b>−${won(b.savingsVsMine)}</b>`
    : (b.savingsVsMedian > 0 ? `시세보다 <b>−${won(b.savingsVsMedian)}</b>` : '');
  $('#dealTitle').textContent = b.title || '';
  $('#dealPromos').innerHTML = (b.promos || []).map((t) => `<span class="promo">${esc(t)}</span>`).join('')
    + (b.discount > 0 ? `<span class="promo promo-hot">쿠폰 −${won(b.discount)}</span>` : '');
  $('#dealMeta').innerHTML = [
    b.mall || b.provider,
    b.discount > 0 ? `정가 ${won(b.price)}` : null,
    b.rating != null ? `★${b.rating}${b.reviewCount ? ` (${b.reviewCount.toLocaleString('ko-KR')})` : ''}` : null,
  ].filter(Boolean).join(' · ');
  $('#dealLines').innerHTML = (d.lines || []).map((l) => `<li>${l}</li>`).join('');
}

const TIER_CLS = { great: 'tier-great', fair: 'tier-fair', meh: 'tier-meh', bad: 'tier-bad', hogu: 'tier-hogu', unknown: 'tier-unknown' };

const TIER_FILL = { great: '#d7f53f', fair: '#d7f53f', meh: '#ffd43a', bad: '#ff8a3d', hogu: '#ff4b3e', unknown: '#dcd8ca' };

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
new ResizeObserver(() => { if (currentResult && !$('#result').classList.contains('hidden')) renderChart(currentResult); })
  .observe(document.body);

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

/* ===== 견본 버튼 ===== */
$$('.try').forEach((b) => b.addEventListener('click', () => {
  $('#urlInput').value = b.dataset.q;
  startAnalyze(b.dataset.q);
}));

/* ===== 초기화 ===== */
(async function init() {
  showView('empty');
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

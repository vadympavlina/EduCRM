// ============================================================
//  Статистика — виплати вчителям, воронка, динаміка за 6 місяців
//  Усі суми — з data/payroll.js (та сама формула, що в «Завершених»
//  і в щомісячному листі).
// ============================================================

import { db, ref, onValue } from '../core/firebase.js';
import { html, render, on } from '../core/dom.js';
import { money, plural } from '../core/format.js';
import { initShell } from '../ui/shell.js';
import { icon } from '../ui/icons.js';
import { enhanceSelects } from '../ui/select.js';
import { monthPicker, currentMonth, monthTitle, MONTHS } from '../ui/month-picker.js';
import { teacherColor } from '../data/teachers.js';
import { computePayroll, contractsFromClients } from '../data/payroll.js';
import { store, teacherOptions } from '../calendar/store.js';
import { startSync } from '../calendar/sync.js';

const page = document.getElementById('page');
let month = currentMonth();
let teacher = '';
let sync = null, pricing = null, pricingLoaded = false, contracts = null;

const shiftMonth = (v, d) => { const [y, m] = v.split('-').map(Number); const t = new Date(y, m - 1 + d, 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`; };
const monthStart = v => new Date(v + '-01T12:00');
const MONTHS_GEN = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
const pct = (n, base) => base > 0 ? Math.round(n / base * 100) : null;

const shellReady = initShell({ page: 'stats', title: 'Статистика', subtitle: 'Виплати вчителям і результати за місяць' });

render(page, html`
  <div class="card filters no-print">
    <div id="month"></div>
    <div id="teacher-filter"></div>
    <span class="spacer"></span>
    <button class="btn btn-sm" data-action="csv">${icon('file-text', 15)} Експорт CSV</button>
    <button class="btn btn-sm" data-action="print">${icon('copy', 15)} Друк</button>
  </div>
  <h2 class="print-only" id="print-title"></h2>
  <div class="kpis" id="kpis"></div>
  <section class="card" id="payouts"></section>
  <div class="stats-row">
    <section class="card" id="funnel"></section>
    <section class="card" id="trend"></section>
  </div>
  <div class="viz-tip" id="viz-tip" role="tooltip" hidden></div>`);

monthPicker(document.getElementById('month'), {
  value: month,
  onChange: v => { month = v; sync?.ensure(monthStart(shiftMonth(v, -5))); renderAll(); },
});

store.staff = await shellReady;
sync = startSync(what => {
  if (what === 'people') renderFilter();
  if (['events', 'groups', 'people'].includes(what)) renderAll();
});
sync.ensure(monthStart(shiftMonth(month, -5)));   // для графіка динаміки
onValue(ref(db, 'pricing/config'), s => { pricing = s.val(); pricingLoaded = true; renderAll(); });
onValue(ref(db, 'clients'), s => { contracts = contractsFromClients(s.val() || {}); renderAll(); });

function renderFilter() {
  const box = document.getElementById('teacher-filter');
  render(box, html`
    <select class="select" aria-label="Вчитель">
      <option value="">Усі вчителі</option>
      ${teacherOptions(teacher).map(t => html`<option value="${t.id}" data-color="${teacherColor(store.teachers, t.id)}" ${t.id === teacher ? 'selected' : ''}>${t.name}</option>`)}
    </select>`);
  enhanceSelects(box);
  box.querySelector('select').addEventListener('change', e => { teacher = e.target.value; renderAll(); });
}

const payFor = m => computePayroll({ events: store.events, groupEvents: store.groupEvents, people: store.teachers, pricing, contracts, month: m, teacherId: teacher });
let current = null;

function renderAll() {
  if (!sync?.loaded.events || !sync.loaded.groups || !contracts || !pricingLoaded) return;
  const pay = payFor(month);
  const prev = payFor(shiftMonth(month, -1));
  current = pay;
  document.getElementById('print-title').textContent = `Статистика EduCRM — ${monthTitle(month)}${teacher ? ' · ' + (store.teachers[teacher]?.name || '') : ''}`;
  renderKpis(pay, prev);
  renderPayouts(pay);
  renderFunnel(pay.funnel);
  renderTrend();
}

// ── Показники ────────────────────────────────────────────────
function delta(cur, prev) {
  if (!prev && !cur) return '';
  if (!prev) return html`<span class="delta up">нове</span>`;
  const d = Math.round((cur - prev) / prev * 100);
  if (!d) return html`<span class="delta">як минулого місяця</span>`;
  return html`<span class="delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)}% <span class="muted">до ${MONTHS_GEN[monthStart(shiftMonth(month, -1)).getMonth()]}</span></span>`;
}

function renderKpis(pay, prev) {
  const conv = pct(pay.funnel.contract, pay.funnel.created);
  render(document.getElementById('kpis'), html`
    <div class="kpi stat"><span class="kpi-label">До виплати</span><span class="stat-value hero">${money(pay.totals.earnings)}</span>${delta(pay.totals.earnings, prev.totals.earnings)}</div>
    <div class="kpi stat"><span class="kpi-label">Проведено занять</span><span class="stat-value">${pay.totals.events}</span>${delta(pay.totals.events, prev.totals.events)}</div>
    <div class="kpi stat"><span class="kpi-label">Нових договорів</span><span class="stat-value">${pay.totals.contracts}</span>${delta(pay.totals.contracts, prev.totals.contracts)}</div>
    <div class="kpi stat"><span class="kpi-label">Записів стали договорами</span><span class="stat-value">${conv == null ? '—' : conv + '%'}</span>
      <span class="delta muted">${pay.funnel.contract} з ${pay.funnel.created} записів</span></div>`);
}

// ── Нарахування вчителям: гістограма + таблиця ───────────────
function renderPayouts(pay) {
  const rows = pay.rows.map(r => {
    const base = r.count * r.baseReward;
    return { ...r, base, bonus: r.earnings - base };
  });
  const max = Math.max(1, ...rows.map(r => r.earnings));
  const box = document.getElementById('payouts');
  if (!rows.length) {
    render(box, html`<div class="card-head"><h2>Нарахування вчителям</h2></div>
      <div class="empty"><div class="empty-icon">${icon('wallet', 22)}</div><p>За ${monthTitle(month).toLowerCase()} нарахувань немає</p></div>`);
    return;
  }
  const sumBase = rows.reduce((s, r) => s + r.base, 0);
  render(box, html`
    <div class="card-head">
      <div><h2>Нарахування вчителям</h2><p>${monthTitle(month)} · ${rows.length} ${plural(rows.length, 'вчитель', 'вчителі', 'вчителів')}</p></div>
      <span class="spacer"></span>
      <div class="viz-legend">
        <span><i style="background:var(--viz-1)"></i>За заняття</span>
        <span><i style="background:var(--viz-2)"></i>За договори</span>
      </div>
    </div>
    <div class="hbars">
      ${rows.map(r => html`
        <div class="hbar-row">
          <span class="hbar-name"><span class="dot" style="--dot:${r.teacherId ? teacherColor(store.teachers, r.teacherId) : '#98a2b3'}"></span>${r.name}</span>
          <span class="hbar-track">
            <span class="hbar-fill" style="width:${r.earnings / max * 100}%">
              ${r.base ? html`<span class="seg" style="flex:${r.base};background:var(--viz-1)" tabindex="0"
                data-tip="${r.name}|За заняття|${money(r.base)}|${r.count} × ${money(r.baseReward)}"></span>` : ''}
              ${r.bonus ? html`<span class="seg" style="flex:${r.bonus};background:var(--viz-2)" tabindex="0"
                data-tip="${r.name}|За договори|${money(r.bonus)}|${r.contracts} × ${money(r.contractBonus)}"></span>` : ''}
            </span>
            <b class="hbar-value num">${money(r.earnings)}</b>
          </span>
        </div>`)}
    </div>
    <div class="table-wrap">
      <table class="table" id="payout-table">
        <thead><tr>
          <th>Вчитель</th><th class="col-num">Занять</th><th class="col-num">За заняття</th>
          <th class="col-num">Договорів</th><th class="col-num">За договори</th><th class="col-num">До виплати</th>
        </tr></thead>
        <tbody>${rows.map(r => html`
          <tr>
            <td><span class="teacher-tag"><span class="dot" style="--dot:${r.teacherId ? teacherColor(store.teachers, r.teacherId) : '#98a2b3'}"></span>${r.name}</span></td>
            <td class="col-num">${r.count}</td>
            <td class="col-num">${money(r.base)} <span class="row-sub">по ${money(r.baseReward)}</span></td>
            <td class="col-num">${r.contracts}</td>
            <td class="col-num">${money(r.bonus)} <span class="row-sub">по ${money(r.contractBonus)}</span></td>
            <td class="col-num"><b>${money(r.earnings)}</b></td>
          </tr>`)}</tbody>
        <tfoot><tr>
          <td>Разом</td><td class="col-num">${pay.totals.events}</td><td class="col-num">${money(sumBase)}</td>
          <td class="col-num">${pay.totals.contracts}</td><td class="col-num">${money(pay.totals.earnings - sumBase)}</td>
          <td class="col-num">${money(pay.totals.earnings)}</td>
        </tr></tfoot>
      </table>
    </div>`);
}

// ── Воронка ──────────────────────────────────────────────────
function renderFunnel(f) {
  const steps = [
    ['Записано', f.created, 'усі записи, крім скасованих', null],
    ['Підтверджено', f.confirmed, 'від записаних', f.created],
    ['Проведено', f.completed, 'від підтверджених', f.confirmed],
    ['Уклали договір', f.contract, 'від проведених', f.completed],
  ];
  const max = Math.max(1, f.created);
  render(document.getElementById('funnel'), html`
    <div class="card-head"><div><h2>Шлях від запису до договору</h2><p>${monthTitle(month)}</p></div></div>
    <div class="funnel">
      ${steps.map(([label, n, note, base]) => html`
        <div class="funnel-row">
          <div class="funnel-top"><span><b class="num">${n}</b> ${label}</span>
            <span class="muted">${base == null ? note : (pct(n, base) == null ? '—' : `${pct(n, base)}% ${note}`)}</span></div>
          <span class="funnel-track"><span class="funnel-fill" style="width:${n / max * 100}%" tabindex="0" data-tip="${label}|${note}|${n}|${base == null ? '' : `${pct(n, base) ?? 0}%`}"></span></span>
        </div>`)}
      <p class="funnel-note">${icon('x', 14)} Скасовано: <b>${f.cancelled}</b>${f.total ? ` (${pct(f.cancelled, f.total)}% від усіх записів)` : ''}</p>
    </div>`);
}

// ── Динаміка виплат за 6 місяців ─────────────────────────────
function renderTrend() {
  const months = [-5, -4, -3, -2, -1, 0].map(d => shiftMonth(month, d));
  const loadedFrom = sync.from.slice(0, 7);
  const data = months.map(m => ({ m, v: m >= loadedFrom ? payFor(m).totals.earnings : null }));
  const max = Math.max(1, ...data.map(d => d.v || 0));
  const ticks = niceTicks(max);
  render(document.getElementById('trend'), html`
    <div class="card-head"><div><h2>Виплати за пів року</h2><p>Сума до виплати по місяцях</p></div></div>
    <div class="cols">
      <div class="cols-grid">${ticks.map(t => html`<span style="bottom:${t / ticks[ticks.length - 1] * 100}%"><i>${t >= 1000 ? (t / 1000) + 'k' : t}</i></span>`)}</div>
      ${data.map(d => html`
        <div class="col ${d.m === month ? 'current' : ''}">
          <span class="col-bar-wrap">
            ${d.m === month && d.v != null ? html`<b class="col-label num" style="--h:${(d.v || 0) / ticks[ticks.length - 1] * 100}%">${money(d.v)}</b>` : ''}
            <span class="col-bar" tabindex="0" style="height:${(d.v || 0) / ticks[ticks.length - 1] * 100}%"
              data-tip="${monthTitle(d.m)}|До виплати|${d.v == null ? 'немає даних' : money(d.v)}|"></span>
          </span>
          <span class="col-x">${MONTHS[monthStart(d.m).getMonth()].slice(0, 3)}</span>
        </div>`)}
    </div>`);
}

function niceTicks(max) {
  const step = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000].find(s => max / s <= 4) || Math.ceil(max / 4);
  const out = [];
  for (let v = 0; v <= max + step - 1; v += step) { out.push(v); if (v >= max) break; }
  return out;
}

// ── Підказки (hover і фокус) ─────────────────────────────────
const tip = document.getElementById('viz-tip');
function showTip(el, x, y) {
  const [title, series, value, sub] = el.dataset.tip.split('|');
  tip.replaceChildren();
  const v = document.createElement('b'); v.textContent = value;
  const s = document.createElement('span'); s.textContent = series + (sub ? ` · ${sub}` : '');
  const t = document.createElement('small'); t.textContent = title;
  tip.append(v, s, t);
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(x + 14, innerWidth - r.width - 12) + 'px';
  tip.style.top = Math.max(8, y - r.height - 12) + 'px';
}
page.addEventListener('pointermove', e => { const el = e.target.closest('[data-tip]'); if (el) showTip(el, e.clientX, e.clientY); else tip.hidden = true; });
page.addEventListener('pointerleave', () => { tip.hidden = true; });
page.addEventListener('focusin', e => { const el = e.target.closest('[data-tip]'); if (el) { const r = el.getBoundingClientRect(); showTip(el, r.left + r.width / 2, r.top); } });
page.addEventListener('focusout', () => { tip.hidden = true; });

// ── Експорт і друк ───────────────────────────────────────────
on(page, 'click', '[data-action="print"]', () => print());
on(page, 'click', '[data-action="csv"]', () => {
  if (!current) return;
  const rows = [['Вчитель', 'Занять', 'Ставка за заняття', 'За заняття', 'Договорів', 'Бонус за договір', 'За договори', 'До виплати']];
  current.rows.forEach(r => { const base = r.count * r.baseReward; rows.push([r.name, r.count, r.baseReward, base, r.contracts, r.contractBonus, r.earnings - base, r.earnings]); });
  rows.push(['Разом', current.totals.events, '', '', current.totals.contracts, '', '', current.totals.earnings]);
  const csv = '﻿' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `educrm-vyplaty-${month}${teacher ? '-' + (store.teachers[teacher]?.name || teacher) : ''}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

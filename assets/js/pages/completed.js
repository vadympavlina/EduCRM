// ============================================================
//  Завершені — проведені заняття і нарахування за місяць
//  Суми рахує data/payroll.js — та сама формула, що в
//  «Статистиці» і в щомісячному листі.
// ============================================================

import { db, ref, onValue } from '../core/firebase.js';
import { html, render, on, initials } from '../core/dom.js';
import { money, plural, fmtDate, phoneDigits } from '../core/format.js';
import { pageReady } from '../ui/loader.js';
import { initShell } from '../ui/shell.js';
import { icon } from '../ui/icons.js';
import { enhanceSelects } from '../ui/select.js';
import { monthPicker, currentMonth, monthTitle } from '../ui/month-picker.js';
import { teacherColor, ratesFor } from '../data/teachers.js';
import { computePayroll, contractsFromClients } from '../data/payroll.js';
import { store, teacherName, teacherOptions } from '../calendar/store.js';
import { startSync } from '../calendar/sync.js';
import { openEventDialog } from '../calendar/event-dialog.js';
import { openGroupDialog } from '../calendar/group-dialog.js';

const page = document.getElementById('page');
let month = currentMonth();
let teacher = '';
let sync = null;
let pricing = null;
let pricingLoaded = false;
let contracts = null;
const expanded = new Set();

const shellReady = initShell({ page: 'completed', title: 'Завершені', subtitle: 'Проведені заняття і нарахування вчителям' });

render(page, html`
  <div class="card filters">
    <div id="month"></div>
    <div id="teacher-filter"></div>
    <span class="spacer"></span>
    <a class="btn btn-ghost btn-sm" href="stats">${icon('bar-chart', 15)} Деталі по вчителях</a>
  </div>
  <div class="kpis kpis-3" id="kpis"></div>
  <section class="card" id="list"><div class="page-loader"><div class="spinner"></div></div></section>`);

monthPicker(document.getElementById('month'), {
  value: month,
  onChange: v => { month = v; sync?.ensure(new Date(v + '-01T12:00')); renderAll(); },
});

store.staff = await shellReady;
sync = startSync(what => {
  if (what === 'people') renderTeacherFilter();
  if (['events', 'groups', 'people'].includes(what)) renderAll();
});
onValue(ref(db, 'pricing/config'), s => { pricing = s.val(); pricingLoaded = true; renderAll(); });
onValue(ref(db, 'clients'), s => { contracts = contractsFromClients(s.val() || {}); renderAll(); });

function renderTeacherFilter() {
  const box = document.getElementById('teacher-filter');
  render(box, html`
    <select class="select" aria-label="Вчитель">
      <option value="">Усі вчителі</option>
      ${teacherOptions(teacher).map(t => html`<option value="${t.id}" data-color="${teacherColor(store.teachers, t.id)}" ${t.id === teacher ? 'selected' : ''}>${t.name}</option>`)}
    </select>`);
  enhanceSelects(box);
  box.querySelector('select').addEventListener('change', e => { teacher = e.target.value; renderAll(); });
}

// ── Рендер ───────────────────────────────────────────────────
function renderAll() {
  if (!sync?.loaded.events || !sync.loaded.groups || !contracts || !pricingLoaded) return;
  pageReady();
  const pay = computePayroll({
    events: store.events, groupEvents: store.groupEvents, people: store.teachers,
    pricing, contracts, month, teacherId: teacher,
  });
  const P = pay.pricing;
  const bonusOf = c => ratesFor(P, c.teacherId).contractBonus;
  const key = c => c.phone + '/' + c.id;
  const used = new Set();
  const legacyIds = new Set(pay.legacy.map(e => e.id));

  const rows = [
    ...pay.completed.map(e => {
      const own = pay.contractsInMonth.filter(c => c.eventId === e.id);
      own.forEach(c => used.add(key(c)));
      const r = ratesFor(P, e.assignedPersonId);
      const legacy = legacyIds.has(e.id);
      return {
        kind: 'event', item: e, contracts: own.length + (legacy ? 1 : 0),
        earn: r.baseReward + own.reduce((s, c) => s + bonusOf(c), 0) + (legacy ? r.contractBonus : 0),
      };
    }),
    ...pay.completedGroups.map(g => {
      const own = pay.contractsInMonth.filter(c => String(c.eventId || '').startsWith(`group_${g.id}_`));
      own.forEach(c => used.add(key(c)));
      return { kind: 'group', item: g, contracts: own.length, earn: ratesFor(P, g.assignedPersonId).baseReward + own.reduce((s, c) => s + bonusOf(c), 0) };
    }),
  ].sort((a, b) => ((b.item.date || '') + (b.item.startTime || '')).localeCompare((a.item.date || '') + (a.item.startTime || '')));

  // Договори місяця, які не прив'язані до занять цього місяця (ручні або до заняття з іншого місяця)
  const loose = pay.contractsInMonth.filter(c => !used.has(key(c)));
  const looseSum = loose.reduce((s, c) => s + bonusOf(c), 0);

  render(document.getElementById('kpis'), html`
    <div class="kpi" style="--k:var(--success);--k-soft:var(--success-soft)">
      <span class="kpi-icon">${icon('check-circle', 18)}</span>
      <span class="kpi-text"><span class="kpi-value">${pay.totals.events}</span>
        <span class="kpi-label">${plural(pay.totals.events, 'заняття проведено', 'заняття проведено', 'занять проведено')}</span></span>
    </div>
    <div class="kpi" style="--k:var(--brand);--k-soft:var(--brand-soft)">
      <span class="kpi-icon">${icon('file-text', 18)}</span>
      <span class="kpi-text"><span class="kpi-value">${pay.totals.contracts}</span>
        <span class="kpi-label">${plural(pay.totals.contracts, 'новий договір', 'нові договори', 'нових договорів')}</span></span>
    </div>
    <div class="kpi" style="--k:var(--violet);--k-soft:var(--violet-soft)">
      <span class="kpi-icon">${icon('wallet', 18)}</span>
      <span class="kpi-text"><span class="kpi-value">${money(pay.totals.earnings)}</span>
        <span class="kpi-label">до виплати за ${monthTitle(month).toLowerCase()}</span></span>
    </div>`);

  const box = document.getElementById('list');
  if (!rows.length && !loose.length) {
    render(box, html`
      <div class="empty">
        <div class="empty-icon">${icon('check-circle', 24)}</div>
        <h3>Проведених занять немає</h3>
        <p>За ${monthTitle(month).toLowerCase()}${teacher ? ' у цього вчителя' : ''} нічого не знайдено.</p>
      </div>`);
    return;
  }

  render(box, html`
    <div class="table-wrap" style="border-radius:var(--r-lg)">
      <table class="table stack">
        <thead><tr>
          <th>Дата</th><th>Час</th><th>Клієнт / подія</th><th>Вчитель</th>
          <th>Договір</th><th class="col-num">Нараховано</th><th>Провів</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => r.kind === 'group' ? groupRow(r) : eventRow(r))}
          ${loose.length ? html`
            <tr class="clickable" data-toggle="loose">
              <td colspan="4">
                <span class="row-title">Договори без заняття цього місяця</span>
                <span class="row-sub">оформлені вручну або до заняття з іншого місяця</span>
              </td>
              <td><button type="button" class="expand" aria-expanded="${String(expanded.has('loose'))}">${loose.length} ${icon('chevron-down', 13)}</button></td>
              <td class="col-num">${money(looseSum)}</td><td></td>
            </tr>
            ${expanded.has('loose') ? loose.map(c => html`
              <tr class="sub-row">
                <td colspan="2">${fmtDate(c.signedAt)}</td>
                <td><a href="client?id=${encodeURIComponent(c.phone)}" target="_blank">${c.clientName || c.clientCardName || c.phone}</a> · ${c.title || 'Договір'}</td>
                <td>${teacherName(c.teacherId) || '—'}</td><td></td>
                <td class="col-num">${money(bonusOf(c))}</td><td>${c.signedBy || ''}</td>
              </tr>`) : ''}` : ''}
        </tbody>
        <tfoot><tr>
          <td colspan="4">Разом</td><td>${pay.totals.contracts}</td>
          <td class="col-num">${money(pay.totals.earnings)}</td><td></td>
        </tr></tfoot>
      </table>
    </div>`);
}

const dateCell = d => d ? new Date(d + 'T12:00').toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', weekday: 'short' }) : '—';
const teacherCell = id => html`<span class="teacher-tag"><span class="dot" style="--dot:${id ? teacherColor(store.teachers, id) : '#98a2b3'}"></span>${teacherName(id) || '—'}</span>`;
const contractCell = n => n ? html`<span class="badge badge-success">${icon('check', 12)} ${n > 1 ? n : ''}</span>` : html`<span class="muted">—</span>`;

function eventRow({ item: e, contracts: n, earn }) {
  return html`
    <tr class="clickable" data-open="${e.id}">
      <td class="col-time">${dateCell(e.date)}</td>
      <td class="col-time">${e.startTime || ''}–${e.endTime || ''}</td>
      <td><span class="row-title">${e.title || '—'}</span>${phoneDigits(e.phone) ? html`<a class="row-sub" href="client?id=${encodeURIComponent(phoneDigits(e.phone))}" target="_blank" data-stop>${e.phone}</a>` : ''}</td>
      <td>${teacherCell(e.assignedPersonId)}</td>
      <td>${contractCell(n)}</td>
      <td class="col-num"><b>${money(earn)}</b></td>
      <td class="muted">${e.completedBy || '—'}</td>
    </tr>`;
}

function groupRow({ item: g, contracts: n, earn }) {
  const people = Object.entries(g.participants || {});
  const open = expanded.has(g.id);
  const allContracts = new Set(contracts.map(c => c.eventId));
  return html`
    <tr class="clickable" data-open-group="${g.id}">
      <td class="col-time">${dateCell(g.date)}</td>
      <td class="col-time">${g.startTime || ''}–${g.endTime || ''}</td>
      <td>
        <span class="row-title" style="display:inline-flex;align-items:center;gap:6px">${icon('users', 14)} ${g.title || 'Групова подія'}</span>
        <button type="button" class="expand" data-toggle="${g.id}" aria-expanded="${String(open)}">${people.length} ${plural(people.length, 'учасник', 'учасники', 'учасників')} ${icon('chevron-down', 13)}</button>
      </td>
      <td>${teacherCell(g.assignedPersonId)}</td>
      <td>${contractCell(n)}</td>
      <td class="col-num"><b>${money(earn)}</b></td>
      <td class="muted">${g.updatedBy || g.createdBy || '—'}</td>
    </tr>
    ${open ? people.map(([pid, p]) => html`
      <tr class="sub-row">
        <td colspan="2"></td>
        <td><span style="display:inline-flex;align-items:center;gap:8px"><span class="avatar avatar-sm">${initials(p.name)}</span>${p.name || '—'}${p.age ? html` <span class="muted">· ${p.age} р.</span>` : ''}</span></td>
        <td>${p.phone || ''}</td>
        <td>${allContracts.has(`group_${g.id}_${pid}`) ? html`<span class="badge badge-success">${icon('check', 12)}</span>` : ''}</td>
        <td></td><td></td>
      </tr>`) : ''}`;
}

// ── Дії ──────────────────────────────────────────────────────
on(page, 'click', '[data-toggle]', (e, el) => {
  e.stopPropagation();
  const id = el.dataset.toggle;
  expanded.has(id) ? expanded.delete(id) : expanded.add(id);
  renderAll();
});
on(page, 'click', '[data-stop]', e => e.stopPropagation());
on(page, 'click', '[data-open]', (e, el) => { if (!e.target.closest('[data-stop], [data-toggle]')) openEventDialog({ id: el.dataset.open }); });
on(page, 'click', '[data-open-group]', (e, el) => { if (!e.target.closest('[data-stop], [data-toggle]')) openGroupDialog({ id: el.dataset.openGroup }); });

// ============================================================
//  Підтверджені — заняття, які треба провести або відмітити
// ============================================================

import { html, render, on, busy } from '../core/dom.js';
import { isoDate, plural } from '../core/format.js';
import { pageReady } from '../ui/loader.js';
import { initShell } from '../ui/shell.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/dialog.js';
import { enhanceSelects } from '../ui/select.js';
import { monthPicker, currentMonth } from '../ui/month-picker.js';
import { teacherColor } from '../data/teachers.js';
import { setEventStatus } from '../data/events.js';
import { store, ctx, teacherName, teacherOptions } from '../calendar/store.js';
import { startSync } from '../calendar/sync.js';
import { openEventDialog } from '../calendar/event-dialog.js';

const page = document.getElementById('page');
let month = currentMonth();
let teacher = '';
let sync = null;

const shellReady = initShell({ page: 'confirmed', title: 'Підтверджені', subtitle: 'Заняття, які треба провести або скасувати' });

render(page, html`
  <div class="card filters">
    <div id="month"></div>
    <div id="teacher-filter"></div>
    <span class="spacer"></span>
    <span class="summary" id="summary"></span>
  </div>
  <section class="card" id="list"><div class="page-loader"><div class="spinner"></div></div></section>`);

monthPicker(document.getElementById('month'), {
  value: month,
  onChange: v => { month = v; sync?.ensure(new Date(v + '-01T12:00')); renderList(); },
});

store.staff = await shellReady;
sync = startSync(what => {
  if (what === 'people') renderTeacherFilter();
  if (what === 'events' || what === 'people') renderList();
});

// ── Фільтр вчителя ───────────────────────────────────────────
function renderTeacherFilter() {
  const box = document.getElementById('teacher-filter');
  render(box, html`
    <select class="select" id="teacher-select" aria-label="Вчитель">
      <option value="">Усі вчителі</option>
      ${teacherOptions(teacher).map(t => html`<option value="${t.id}" data-color="${teacherColor(store.teachers, t.id)}" ${t.id === teacher ? 'selected' : ''}>${t.name}</option>`)}
    </select>`);
  enhanceSelects(box);
  box.querySelector('select').addEventListener('change', e => { teacher = e.target.value; renderList(); });
}

// ── Список ───────────────────────────────────────────────────
const dayTitle = date => {
  const today = isoDate(new Date());
  const tomorrow = isoDate(new Date(Date.now() + 864e5));
  const d = new Date(date + 'T12:00');
  const label = `${d.toLocaleDateString('uk-UA', { weekday: 'long' })}, ${d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}`;
  return date === today ? `Сьогодні · ${label}` : date === tomorrow ? `Завтра · ${label}` : label;
};

function renderList() {
  if (!sync?.loaded.events) return;
  pageReady();
  const now = new Date();
  const nowKey = isoDate(now) + 'T' + now.toTimeString().slice(0, 5);
  const list = Object.values(store.events)
    .filter(e => e.status === 'confirmed' && !e.isGroupMirror && (e.date || '').startsWith(month) && (!teacher || e.assignedPersonId === teacher))
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  const overdue = list.filter(e => `${e.date}T${e.endTime || e.startTime}` < nowKey);

  render(document.getElementById('summary'), list.length ? html`
    <b>${list.length}</b> ${plural(list.length, 'заняття', 'заняття', 'занять')}
    ${overdue.length ? html` · <b style="color:var(--warning)">${overdue.length}</b> ${plural(overdue.length, 'вже минуло', 'вже минули', 'вже минули')} — відмітьте результат` : ''}` : '');

  const box = document.getElementById('list');
  if (!list.length) {
    render(box, html`
      <div class="empty">
        <div class="empty-icon">${icon('check-square', 24)}</div>
        <h3>Підтверджених занять немає</h3>
        <p>За обраний місяць${teacher ? ' у цього вчителя' : ''} нічого не чекає на проведення.</p>
      </div>`);
    return;
  }

  const rows = [];
  let lastDate = '';
  for (const e of list) {
    if (e.date !== lastDate) {
      lastDate = e.date;
      rows.push(html`<tr class="day-row ${e.date === isoDate(now) ? 'today' : ''}"><td colspan="5">${dayTitle(e.date)}</td></tr>`);
    }
    const late = overdue.includes(e);
    rows.push(html`
      <tr class="${late ? 'overdue' : ''}">
        <td class="col-time">${e.startTime}–${e.endTime || ''}</td>
        <td>
          <button type="button" class="row-title" data-open="${e.id}" style="border:0;background:none;padding:0;text-align:left;cursor:pointer">${e.title || '—'}</button>
          <span class="row-sub">${e.phone || ''}</span>
        </td>
        <td><span class="teacher-tag"><span class="dot" style="--dot:${e.assignedPersonId ? teacherColor(store.teachers, e.assignedPersonId) : '#98a2b3'}"></span>${teacherName(e.assignedPersonId) || '—'}</span></td>
        <td>${late ? html`<span class="badge badge-warning">${icon('clock', 12)} Час минув</span>` : ''}</td>
        <td class="col-actions">
          <div class="row-actions always">
            <button class="btn btn-sm btn-primary" data-done="${e.id}">${icon('check-circle', 14)} Проведено</button>
            <button class="btn btn-sm" data-cancel="${e.id}">Скасувати</button>
            <button class="icon-btn" data-open="${e.id}" title="Відкрити" aria-label="Відкрити">${icon('pencil', 15)}</button>
          </div>
        </td>
      </tr>`);
  }
  render(box, html`
    <div class="table-wrap" style="border-radius:var(--r-lg)">
      <table class="table stack">
        <thead><tr><th>Час</th><th>Клієнт</th><th>Вчитель</th><th></th><th class="col-actions"><span class="sr-only">Дії</span></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`);
}

// ── Дії ──────────────────────────────────────────────────────
on(page, 'click', '[data-open]', (_, el) => openEventDialog({ id: el.dataset.open }));

on(page, 'click', '[data-done]', async (_, btn) => {
  const ev = store.events[btn.dataset.done];
  if (!ev) return;
  const ok = await confirmDialog({ title: 'Позначити як проведене?', message: `${ev.title} · ${ev.startTime}, ${teacherName(ev.assignedPersonId)}. Вчителю буде нараховано оплату.`, confirmText: 'Проведено' });
  if (!ok) return;
  await busy(btn, () => setEventStatus(ev, 'completed', ctx())
    .then(() => toast('Заняття проведено', 'success'))
    .catch(err => { console.error(err); toast('Не вдалося змінити статус', 'error'); }));
});

on(page, 'click', '[data-cancel]', async (_, btn) => {
  const ev = store.events[btn.dataset.cancel];
  if (!ev) return;
  const ok = await confirmDialog({ title: 'Скасувати заняття?', message: `${ev.title} · ${ev.date} ${ev.startTime}. Менеджери побачать скасування в Telegram.`, confirmText: 'Скасувати заняття', danger: true });
  if (!ok) return;
  await busy(btn, () => setEventStatus(ev, 'cancelled', ctx())
    .then(() => toast('Заняття скасовано', 'success'))
    .catch(err => { console.error(err); toast('Не вдалося змінити статус', 'error'); }));
});

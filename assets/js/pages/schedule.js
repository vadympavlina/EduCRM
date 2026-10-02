// ============================================================
//  Графік роботи — повторювані блокування (пари, обід, наради)
//  і разові «зайнятий час». Усе можна редагувати.
//  settings/blockedTimes/{id} = { title, teacherId, days:[0..6], start, end, from, until }
// ============================================================

import { db, ref, push, set, remove } from '../core/firebase.js';
import { html, render, on } from '../core/dom.js';
import { isoDate, plural, fmtDate } from '../core/format.js';
import { pageReady } from '../ui/loader.js';
import { initShell } from '../ui/shell.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { openDialog, confirmDialog, fieldError } from '../ui/dialog.js';
import { enhanceSelects } from '../ui/select.js';
import { teacherColor } from '../data/teachers.js';
import { findBlock, toMin } from '../data/events.js';
import { store, teacherName, teacherOptions } from '../calendar/store.js';
import { startSync } from '../calendar/sync.js';
import { openBusyDialog } from '../calendar/busy-dialog.js';

// Понеділок — перший; значення як у Date.getDay() (0 — неділя)
const WEEK = [[1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'], [5, 'Пт'], [6, 'Сб'], [0, 'Нд']];
const DAY_NAME = Object.fromEntries(WEEK);
const PRESETS = { weekdays: [1, 2, 3, 4, 5], weekend: [6, 0], all: [1, 2, 3, 4, 5, 6, 0] };

const page = document.getElementById('page');
let who = '';          // '' — усі, '_all' — лише загальні, або id вчителя
let showPast = false;
let sync = null;

const shellReady = initShell({
  page: 'schedule',
  title: 'Графік роботи',
  subtitle: 'Коли записувати не можна: пари, обід, наради',
  actions: html`
    <button class="btn" data-action="new-busy">${icon('clock', 16)} Разове</button>
    <button class="btn btn-primary" data-action="new-block">${icon('plus', 16)} Повторюване блокування</button>`,
});

render(page, html`
  <div class="card filters">
    <div id="who-filter"></div>
    <span class="spacer"></span>
    <span class="summary" id="summary"></span>
  </div>
  <section class="card" id="week"></section>
  <section class="card" id="blocks"></section>
  <section class="card" id="busy"></section>`);

store.staff = await shellReady;
sync = startSync(what => {
  if (what === 'people') renderFilter();
  renderAll();
});

const today = () => isoDate(new Date());
const isPast = b => b.until && b.until < today();
const matchesWho = b => !who || (who === '_all' ? !b.teacherId : (!b.teacherId || b.teacherId === who));
const blockColor = b => b.teacherId ? teacherColor(store.teachers, b.teacherId) : '#d92d20';
const sortDays = days => [...(days || [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));

function daysLabel(days) {
  const d = sortDays(days);
  const key = d.join(',');
  if (key === PRESETS.all.join(',')) return 'Щодня';
  if (key === PRESETS.weekdays.join(',')) return 'Будні';
  if (key === PRESETS.weekend.join(',')) return 'Вихідні';
  return d.map(x => DAY_NAME[x]).join(', ');
}

function periodLabel(b) {
  if (b.from && b.until) return `${fmtDate(b.from + 'T12:00')} — ${fmtDate(b.until + 'T12:00')}`;
  if (b.from) return `з ${fmtDate(b.from + 'T12:00')}`;
  if (b.until) return `до ${fmtDate(b.until + 'T12:00')}`;
  return 'постійно';
}

// ── Фільтр ───────────────────────────────────────────────────
function renderFilter() {
  const box = document.getElementById('who-filter');
  render(box, html`
    <select class="select" aria-label="Для кого">
      <option value="">Усі блокування</option>
      <option value="_all" data-color="#d92d20" ${who === '_all' ? 'selected' : ''}>Лише загальні</option>
      ${teacherOptions(who).map(t => html`<option value="${t.id}" data-color="${teacherColor(store.teachers, t.id)}" ${t.id === who ? 'selected' : ''}>${t.name}</option>`)}
    </select>`);
  enhanceSelects(box);
  box.querySelector('select').addEventListener('change', e => { who = e.target.value; renderAll(); });
}

// ── Рендер ───────────────────────────────────────────────────
function renderAll() {
  if (sync?.loaded.people && sync.loaded.blocks) pageReady();
  const blocks = Object.entries(store.blockedTimes).map(([id, b]) => ({ id, ...b })).filter(matchesWho);
  const active = blocks.filter(b => !isPast(b));
  const past = blocks.filter(isPast);
  render(document.getElementById('summary'), html`<b>${active.length}</b> ${plural(active.length, 'діюче блокування', 'діючі блокування', 'діючих блокувань')}`);
  renderWeek(active);
  renderTable(active, past);
  renderBusy();
}

function renderWeek(blocks) {
  let from = 8 * 60, to = 21 * 60;
  blocks.forEach(b => { from = Math.min(from, toMin(b.start)); to = Math.max(to, toMin(b.end)); });
  from = Math.floor(from / 60) * 60; to = Math.ceil(to / 60) * 60;
  const HOUR = 44;
  const height = (to - from) / 60 * HOUR;
  const todayDow = new Date().getDay();

  const columns = WEEK.map(([dow, label]) => {
    const items = blocks.filter(b => (b.days || []).includes(dow)).sort((a, b) => toMin(a.start) - toMin(b.start));
    // доріжки для блоків, що перетинаються
    const lanes = [];
    items.forEach(b => {
      const lane = lanes.findIndex(end => end <= toMin(b.start));
      if (lane === -1) { b._lane = lanes.length; lanes.push(toMin(b.end)); } else { b._lane = lane; lanes[lane] = toMin(b.end); }
    });
    const n = Math.max(1, lanes.length);
    return html`
      <div class="wk-col ${dow === todayDow ? 'today' : ''}">
        <div class="wk-head">${label}</div>
        <div class="wk-body" style="height:${height}px">
          ${items.map(b => html`
            <button type="button" class="wk-block ${b.teacherId ? '' : 'global'} ${b.from && b.from > today() ? 'future' : ''}" data-edit="${b.id}"
              style="--c:${blockColor(b)};top:${(toMin(b.start) - from) / 60 * HOUR}px;height:${Math.max(18, (toMin(b.end) - toMin(b.start)) / 60 * HOUR)}px;left:calc(${b._lane} * 100% / ${n});width:calc(100% / ${n} - 3px)"
              title="${b.title || 'Зайнято'} · ${b.start}–${b.end}${b.teacherId ? ' · ' + teacherName(b.teacherId) : ' · для всіх'}">
              <span class="wk-title">${b.title || 'Зайнято'}</span>
              <span class="wk-time">${b.start}–${b.end}</span>
              ${b.teacherId ? html`<span class="wk-who">${teacherName(b.teacherId)}</span>` : ''}
            </button>`)}
        </div>
      </div>`;
  });

  const hours = [];
  for (let m = from; m < to; m += 60) hours.push(m / 60);
  render(document.getElementById('week'), html`
    <div class="card-head">
      <div><h2>Тиждень</h2><p>Натисніть на блокування, щоб змінити його</p></div>
      <span class="spacer"></span>
      <span class="teacher-tag" style="font-size:var(--fs-xs)"><span class="dot" style="--dot:#d92d20"></span>для всіх</span>
      <span class="teacher-tag muted" style="font-size:var(--fs-xs)">· кольором вчителя — лише для нього</span>
    </div>
    <div class="wk">
      <div class="wk-axis"><div class="wk-head"></div>
        <div class="wk-body" style="height:${height}px">${hours.map(h => html`<span style="top:${(h * 60 - from) / 60 * HOUR}px">${String(h).padStart(2, '0')}:00</span>`)}</div>
      </div>
      ${columns}
    </div>`);
  document.querySelectorAll('#week .wk-body').forEach(el => el.style.setProperty('--hour', HOUR + 'px'));
}

function blockRow(b) {
  const past = isPast(b);
  const future = b.from && b.from > today();
  return html`
    <tr class="${past ? 'archived-row' : ''}">
      <td>
        <span class="teacher-tag"><span class="dot" style="--dot:${blockColor(b)}"></span><span class="row-title">${b.title || 'Зайнято'}</span></span>
      </td>
      <td>${b.teacherId ? teacherName(b.teacherId) || 'Невідомо' : html`<span class="badge badge-danger">Для всіх</span>`}</td>
      <td><span class="days-chips">${sortDays(b.days).map(d => html`<span class="day-chip">${DAY_NAME[d]}</span>`)}</span></td>
      <td class="col-time">${b.start}–${b.end}</td>
      <td>${periodLabel(b)} ${past ? html`<span class="badge">Завершено</span>` : future ? html`<span class="badge badge-info">Ще не діє</span>` : ''}</td>
      <td class="col-actions">
        <div class="row-actions">
          <button class="icon-btn" data-edit="${b.id}" title="Редагувати" aria-label="Редагувати">${icon('pencil', 16)}</button>
          <button class="icon-btn" data-copy="${b.id}" title="Дублювати" aria-label="Дублювати">${icon('plus', 16)}</button>
          <button class="icon-btn danger" data-del="${b.id}" title="Видалити" aria-label="Видалити">${icon('trash', 16)}</button>
        </div>
      </td>
    </tr>`;
}

function renderTable(active, past) {
  const sorted = list => list.sort((a, b) => (a.teacherId ? 1 : 0) - (b.teacherId ? 1 : 0) || toMin(a.start) - toMin(b.start));
  render(document.getElementById('blocks'), html`
    <div class="card-head">
      <div><h2>Повторювані блокування</h2><p>Діють щотижня в обрані дні</p></div>
      <span class="spacer"></span>
      ${past.length ? html`<button class="btn btn-ghost btn-sm" data-action="toggle-past">${icon('archive', 15)} ${showPast ? 'Сховати завершені' : `Завершені · ${past.length}`}</button>` : ''}
    </div>
    ${active.length || (showPast && past.length) ? html`
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Назва</th><th>Для кого</th><th>Дні</th><th>Час</th><th>Період</th><th class="col-actions"><span class="sr-only">Дії</span></th></tr></thead>
          <tbody>${sorted(active).map(blockRow)}${showPast ? sorted(past).map(blockRow) : ''}</tbody>
        </table>
      </div>` : html`
      <div class="empty">
        <div class="empty-icon">${icon('clock', 24)}</div>
        <h3>Блокувань немає</h3>
        <p>Додайте пари, обід чи інший час, коли записувати не можна.</p>
        <button class="btn btn-primary" data-action="new-block" style="margin-top:8px">${icon('plus', 16)} Повторюване блокування</button>
      </div>`}`);
}

function renderBusy() {
  const t = today();
  const list = Object.entries(store.busySlots).map(([id, b]) => ({ id, ...b }))
    .filter(b => b.date >= t && matchesWho(b))
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  render(document.getElementById('busy'), html`
    <div class="card-head">
      <div><h2>Разові блокування</h2><p>Найближчі «зайняті» проміжки — створюються і в календарі</p></div>
      <span class="spacer"></span>
      <button class="btn btn-sm" data-action="new-busy">${icon('plus', 14)} Додати</button>
    </div>
    ${list.length ? html`
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Дата</th><th>Час</th><th>Причина</th><th>Для кого</th><th>Створив</th><th class="col-actions"><span class="sr-only">Дії</span></th></tr></thead>
          <tbody>${list.map(b => html`
            <tr class="clickable" data-busy="${b.id}">
              <td class="col-time">${fmtDate(b.date + 'T12:00')}</td>
              <td class="col-time">${b.startTime}–${b.endTime}</td>
              <td><span class="row-title">${b.title || 'Зайнято'}</span></td>
              <td>${b.teacherId ? html`<span class="teacher-tag"><span class="dot" style="--dot:${teacherColor(store.teachers, b.teacherId)}"></span>${teacherName(b.teacherId)}</span>` : html`<span class="badge badge-danger">Для всіх</span>`}</td>
              <td class="muted">${b.createdBy || '—'}</td>
              <td class="col-actions"><div class="row-actions"><button class="icon-btn" data-busy="${b.id}" aria-label="Редагувати">${icon('pencil', 16)}</button></div></td>
            </tr>`)}</tbody>
        </table>
      </div>` : html`<div class="empty" style="padding:28px"><p>Найближчих разових блокувань немає</p></div>`}`);
}

// ── Діалог повторюваного блокування ──────────────────────────
function openBlockDialog({ id = null, copyOf = null } = {}) {
  const src = id ? store.blockedTimes[id] : copyOf ? store.blockedTimes[copyOf] : null;
  const v = src || { title: '', teacherId: who && who !== '_all' ? who : '', days: [], start: '09:00', end: '10:00', from: '', until: '' };
  const editing = !!id;

  const dlg = openDialog({
    title: editing ? 'Редагувати блокування' : copyOf ? 'Копія блокування' : 'Нове блокування',
    subtitle: 'Повторюється щотижня в обрані дні',
    width: 560,
    submitText: editing ? 'Зберегти зміни' : 'Додати',
    extraFooter: editing ? html`<button type="button" class="btn btn-ghost" data-action="delete" style="color:var(--danger)">${icon('trash', 15)} Видалити</button>` : '',
    content: html`
      <div class="field-row">
        <label class="field"><span class="field-label">Назва</span>
          <input class="input" name="title" maxlength="60" value="${v.title || ''}" placeholder="напр. Пари, Обід" autofocus></label>
        <label class="field"><span class="field-label">Для кого</span>
          <select class="select" name="teacher">
            <option value="" data-color="#d92d20">Для всіх</option>
            ${teacherOptions(v.teacherId).map(t => html`<option value="${t.id}" data-color="${teacherColor(store.teachers, t.id)}" ${t.id === v.teacherId ? 'selected' : ''}>${t.name}</option>`)}
          </select></label>
      </div>
      <div class="field">
        <span class="field-label">Дні тижня</span>
        <div class="days-pick">
          ${WEEK.map(([d, label]) => html`<label><input type="checkbox" name="days" value="${d}" ${(v.days || []).includes(d) ? 'checked' : ''}><span>${label}</span></label>`)}
        </div>
        <div class="days-presets">
          <span class="field-hint">Швидко:</span>
          <button type="button" class="btn btn-ghost btn-sm" data-preset="weekdays">Будні</button>
          <button type="button" class="btn btn-ghost btn-sm" data-preset="weekend">Вихідні</button>
          <button type="button" class="btn btn-ghost btn-sm" data-preset="all">Щодня</button>
        </div>
      </div>
      <div class="field-row">
        <label class="field"><span class="field-label">Початок</span><input class="input" type="time" name="start" value="${v.start}"></label>
        <label class="field"><span class="field-label">Кінець</span><input class="input" type="time" name="end" value="${v.end}"></label>
      </div>
      <div class="field-row">
        <label class="field"><span class="field-label">Діє з <span class="muted">(не обов'язково)</span></span>
          <input class="input" type="date" name="from" value="${v.from || ''}" placeholder="Від сьогодні" data-optional></label>
        <label class="field"><span class="field-label">Діє до <span class="muted">(не обов'язково)</span></span>
          <input class="input" type="date" name="until" value="${v.until || ''}" placeholder="Без кінця" data-optional></label>
      </div>
      <div data-conflicts></div>`,
    onOpen(form) {
      const check = () => renderConflicts(form, id);
      form.addEventListener('change', check);
      check();
      on(form, 'click', '[data-preset]', (_, el) => {
        const set_ = PRESETS[el.dataset.preset];
        form.querySelectorAll('[name="days"]').forEach(cb => { cb.checked = set_.includes(+cb.value); });
        check();
      });
      on(form, 'click', '[data-action="delete"]', async () => {
        if (await deleteBlock(id)) dlg.close('ok');
      });
    },
    async onSubmit(form) {
      const data = readBlock(form);
      if (!data) return false;
      if (editing) await set(ref(db, 'settings/blockedTimes/' + id), data);
      else await set(push(ref(db, 'settings/blockedTimes')), data);
      toast(editing ? 'Блокування оновлено' : 'Блокування додано', 'success');
    },
  });
}

function readBlock(form, quiet = false) {
  const f = form.elements;
  const days = [...form.querySelectorAll('[name="days"]:checked')].map(cb => +cb.value);
  const data = {
    title: f.title.value.trim(),
    teacherId: f.teacher.value || '',
    days: sortDays(days),
    start: f.start.value, end: f.end.value,
    from: f.from.value || '', until: f.until.value || '',
  };
  if (quiet) return data;
  if (!data.title) return fieldError(f.title) && null;
  if (!days.length) { toast('Оберіть хоча б один день', 'warning'); return null; }
  if (!data.start) return fieldError(f.start) && null;
  if (!data.end || toMin(data.end) <= toMin(data.start)) { toast('Кінець має бути пізніше за початок', 'warning'); return fieldError(f.end) && null; }
  if (data.from && data.until && data.until < data.from) { toast('«Діє до» має бути пізніше за «Діє з»', 'warning'); return fieldError(f.until) && null; }
  return data;
}

/** Попередження: які майбутні заняття потрапляють у це блокування. */
function renderConflicts(form, id) {
  const b = readBlock(form, true);
  const box = form.querySelector('[data-conflicts]');
  if (!b.days.length || !b.start || !b.end || toMin(b.end) <= toMin(b.start)) { render(box, ''); return; }
  const t = today();
  const hits = Object.values(store.events).filter(e =>
    !e.isGroupMirror && (e.status === 'pending' || e.status === 'confirmed') && e.date >= t
    && findBlock({ date: e.date, startTime: e.startTime, endTime: e.endTime || e.startTime, teacherId: e.assignedPersonId }, { x: b }, {}))
    .sort((a, c) => (a.date + a.startTime).localeCompare(c.date + c.startTime));
  render(box, hits.length ? html`
    <div class="alert alert-warning">${icon('alert-triangle', 16)}
      <span>У цей час уже ${plural(hits.length, 'записане', 'записані', 'записано')} <b>${hits.length}</b> ${plural(hits.length, 'заняття', 'заняття', 'занять')}:
        ${hits.slice(0, 3).map((e, i) => html`${i ? ', ' : ''}${e.title} (${fmtDate(e.date + 'T12:00')}, ${e.startTime})`)}${hits.length > 3 ? ' …' : ''}.
        Блокування їх не скасує — перенесіть вручну, якщо потрібно.</span>
    </div>` : '');
}

async function deleteBlock(id) {
  const b = store.blockedTimes[id];
  if (!b) return false;
  const ok = await confirmDialog({
    title: 'Видалити блокування?',
    message: `«${b.title || 'Зайнято'}» (${daysLabel(b.days)}, ${b.start}–${b.end}${b.teacherId ? `, ${teacherName(b.teacherId)}` : ''}) буде видалено. Цей час знову стане доступним для запису.`,
    confirmText: 'Видалити', danger: true,
  });
  if (!ok) return false;
  try { await remove(ref(db, 'settings/blockedTimes/' + id)); toast('Блокування видалено', 'success'); return true; }
  catch { toast('Не вдалося видалити', 'error'); return false; }
}

// ── Дії ──────────────────────────────────────────────────────
on(document, 'click', '[data-action="new-block"]', () => openBlockDialog());
on(document, 'click', '[data-action="new-busy"]', () => openBusyDialog());
on(page, 'click', '[data-action="toggle-past"]', () => { showPast = !showPast; renderAll(); });
on(page, 'click', '[data-edit]', (_, el) => openBlockDialog({ id: el.dataset.edit }));
on(page, 'click', '[data-copy]', (_, el) => openBlockDialog({ copyOf: el.dataset.copy }));
on(page, 'click', '[data-del]', (_, el) => deleteBlock(el.dataset.del));
on(page, 'click', '[data-busy]', (e, el) => { e.stopPropagation(); openBusyDialog({ id: el.dataset.busy }); });

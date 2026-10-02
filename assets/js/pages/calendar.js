// ============================================================
//  Календар — головна сторінка
// ============================================================

import { db, ref, onValue, query, orderByChild, startAt, push, set, remove } from '../core/firebase.js';
import { html, render, on, initials } from '../core/dom.js';
import { isoDate, monthKey, pad, phoneDigits, plural, fmtDate } from '../core/format.js';
import { initShell } from '../ui/shell.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { openDialog, confirmDialog, fieldError } from '../ui/dialog.js';
import { teacherColor } from '../data/teachers.js';
import { STATUS, findBlock, findTeacherOverlap, moveEvent, toMin } from '../data/events.js';
import { moveGroup, countComing } from '../data/group-events.js';
import { store, ctx, teacherName, teacherOptions } from '../calendar/store.js';
import { openEventDialog } from '../calendar/event-dialog.js';
import { openGroupDialog } from '../calendar/group-dialog.js';

const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const VIEW_KEY = 'educrm.calendarView';
const FILTER_KEY = 'educrm.calendarTeachers';
const VIEWS = [
  ['timeGridWeek', 'Тиждень'], ['timeGridDay', 'День'], ['dayGridMonth', 'Місяць'], ['listWeek', 'Список'],
];

const readLS = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } };
const writeLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

let calendar = null;
// Події та разові блокування слухаємо від початку минулого місяця (див. ensureRange)
let rangeFrom = isoDate(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1));
const unsub = {};
let filter = new Set(readLS(FILTER_KEY, []));
const loaded = { people: false, events: false };

// ── КАРКАС ───────────────────────────────────────────────────
const shellReady = initShell({
  page: 'calendar',
  title: 'Календар',
  subtitle: new Date().toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' }),
  actions: html`
    <div class="presence" id="presence"></div>
    <div class="search" id="search">
      ${icon('search', 16)}
      <input class="input" id="search-input" type="search" placeholder="Клієнт або заняття" autocomplete="off" aria-label="Пошук">
      <kbd>/</kbd>
    </div>
    <button class="btn" data-action="new-group">${icon('users', 16)} Групова</button>
    <button class="btn btn-primary" data-action="new-event">${icon('plus', 16)} Нове заняття</button>`,
});

const page = document.getElementById('page');
render(page, html`
  <div class="kpis" id="kpis">
    ${[0, 1, 2, 3].map(() => html`<div class="kpi"><span class="skeleton" style="width:36px;height:36px;border-radius:8px"></span>
      <div style="flex:1;display:grid;gap:6px"><span class="skeleton" style="width:40%;height:16px"></span><span class="skeleton" style="width:70%"></span></div></div>`)}
  </div>
  <section class="card cal-card">
    <div class="cal-toolbar">
      <div class="btn-group">
        <button class="btn" data-nav="prev" aria-label="Назад" title="Назад">${icon('chevron-left', 16)}</button>
        <button class="btn" data-nav="next" aria-label="Вперед" title="Вперед">${icon('chevron-right', 16)}</button>
      </div>
      <button class="btn" data-nav="today">Сьогодні</button>
      <h2 id="cal-title"></h2>
      <span class="spacer"></span>
      <div class="legend" id="legend"></div>
      <div class="segmented" id="views" role="radiogroup" aria-label="Вигляд">
        ${VIEWS.map(([v, label]) => html`<label><input type="radio" name="view" value="${v}"><span>${label}</span></label>`)}
      </div>
    </div>
    <div class="cal-body"><div id="calendar" style="height:100%"></div></div>
  </section>`);


// ── ДАНІ ─────────────────────────────────────────────────────
// Події та разові блокування слухаємо лише від початку минулого місяця
// (або раніше, якщо користувач гортає назад) — а не всю історію.

function subscribe() {
  onValue(ref(db, 'people'), snap => { store.teachers = snap.val() || {}; loaded.people = true; refresh(); maybeImport(); });
  onValue(ref(db, 'groupEvents'), snap => {
    const next = {};
    snap.forEach(c => { next[c.key] = { id: c.key, ...c.val() }; });
    store.groupEvents = next; refresh();
  });
  onValue(ref(db, 'settings/blockedTimes'), snap => { store.blockedTimes = snap.val() || {}; refresh(); });
  onValue(ref(db, 'presence'), snap => renderPresence(snap.val() || {}));
  subscribeRange();
}

function subscribeRange() {
  unsub.events?.(); unsub.busy?.();
  unsub.events = onValue(query(ref(db, 'events'), orderByChild('date'), startAt(rangeFrom)), snap => {
    const next = {};
    snap.forEach(c => { next[c.key] = { id: c.key, ...c.val() }; });
    store.events = next; loaded.events = true; refresh(); maybeImport();
  }, err => { console.error(err); toast('Не вдалося завантажити події', 'error'); });
  unsub.busy = onValue(query(ref(db, 'busySlots'), orderByChild('date'), startAt(rangeFrom)), snap => {
    store.busySlots = snap.val() || {}; refresh();
  });
}

function ensureRange(start) {
  const from = isoDate(new Date(start.getFullYear(), start.getMonth() - 1, 1));
  if (from < rangeFrom) { rangeFrom = from; if (store.staff) subscribeRange(); }
}

let frame = 0;
function refresh() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    calendar?.refetchEvents();
    renderKpis();
    renderLegend();
  });
}

// ── КАЛЕНДАР ─────────────────────────────────────────────────
function initCalendar() {
  const FC = window.FullCalendar;
  const initialView = VIEWS.some(([v]) => v === readLS(VIEW_KEY)) ? readLS(VIEW_KEY) : 'timeGridWeek';

  calendar = new FC.Calendar(document.getElementById('calendar'), {
    locale: 'uk',
    firstDay: 1,
    headerToolbar: false,
    initialView,
    height: '100%',
    allDaySlot: false,
    slotMinTime: '08:00:00',
    slotMaxTime: '22:00:00',
    slotDuration: '00:30:00',
    snapDuration: '00:15:00',
    scrollTime: '09:00:00',
    expandRows: true,
    nowIndicator: true,
    selectable: true,
    selectMirror: true,
    editable: true,
    eventResizableFromStart: true,
    slotEventOverlap: false,
    eventMaxStack: 3,
    dayMaxEvents: 3,
    eventDisplay: 'block',
    slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    noEventsContent: 'На цей період занять немає',
    moreLinkContent: arg => `ще ${arg.num}`,

    events: (_info, success) => success(buildEvents()),

    dayHeaderContent(arg) {
      const dow = arg.date.toLocaleDateString('uk-UA', { weekday: 'short' });
      if (arg.view.type === 'dayGridMonth' || arg.view.type.startsWith('list')) return { html: String(html`<div class="day-head"><span class="dow">${dow}</span></div>`) };
      return { html: String(html`<div class="day-head"><span class="dow">${dow}</span><span class="dnum">${arg.date.getDate()}</span></div>`) };
    },

    eventContent(arg) {
      const p = arg.event.extendedProps;
      if (p.kind === 'block') return { html: '' };
      const statusIcon = p.kind === 'group' ? icon('users', 12) : p.kind === 'busy' ? icon('clock', 12) : icon(STATUS[p.status]?.icon || 'clock', 12);
      const count = p.kind === 'group' ? html`<span class="ev-count">${p.coming}/${p.total}</span>` : '';
      const view = arg.view.type;
      if (view.startsWith('list')) {
        return { html: String(html`<span class="ev-inline">${statusIcon}<b>${arg.event.title}</b>${p.teacher ? html`<span class="muted">· ${p.teacher}</span>` : ''}${count}</span>`) };
      }
      if (view === 'dayGridMonth') {
        return { html: String(html`<span class="ev-inline"><span class="ev-time">${arg.timeText}</span><span class="ev-title"><span>${arg.event.title}</span></span>${count}</span>`) };
      }
      return { html: String(html`
        <div class="ev-inner">
          <div class="ev-time">${arg.timeText}</div>
          <div class="ev-title">${statusIcon}<span>${arg.event.title}</span>${count}</div>
          ${p.teacher ? html`<div class="ev-sub">${p.teacher}</div>` : ''}
        </div>`) };
    },

    eventDidMount(arg) {
      const p = arg.event.extendedProps;
      if (p.color) arg.el.style.setProperty('--ev', p.color);
      if (p.kind === 'block') {
        const label = document.createElement('div');
        label.className = 'block-label';
        render(label, html`${p.label}${p.teacher ? html`<small>${p.teacher}</small>` : ''}`);
        arg.el.append(label);
      }
      const tip = [arg.event.title, p.teacher, p.kind === 'event' ? STATUS[p.status]?.label : ''].filter(Boolean).join(' · ');
      if (tip && p.kind !== 'block') arg.el.title = tip;
    },

    selectAllow(info) {
      if (info.allDay) return true;
      return !findBlock({ date: isoDate(info.start), startTime: hhmm(info.start), endTime: hhmm(info.end) },
        store.blockedTimes, store.busySlots, { globalOnly: true });
    },

    select(info) {
      let start = info.start, end = info.end;
      if (info.allDay) { // місячний вигляд — пропонуємо 10:00–11:00 обраного дня
        start = new Date(start); start.setHours(10, 0, 0, 0);
        end = new Date(start.getTime() + 3600e3);
      }
      showSlotMenu(info.jsEvent, start, end);
    },

    eventClick(arg) {
      arg.jsEvent.preventDefault();
      const p = arg.event.extendedProps;
      if (p.kind === 'event') openEventDialog({ id: p.ref });
      else if (p.kind === 'group') openGroupDialog({ id: p.ref });
      else if (p.kind === 'busy') deleteBusy(p.ref);
    },

    eventDrop: onMove,
    eventResize: onMove,

    datesSet(arg) {
      document.getElementById('cal-title').textContent = arg.view.title;
      ensureRange(arg.start);
      const radio = document.querySelector(`#views input[value="${arg.view.type}"]`);
      if (radio) radio.checked = true;
    },
  });
  calendar.render();
}

function buildEvents() {
  const view = calendar?.view?.type || '';
  const visible = id => !filter.size || filter.has(id);
  const out = [];

  for (const ev of Object.values(store.events)) {
    if (ev.isGroupMirror || !ev.date || !ev.startTime || !visible(ev.assignedPersonId)) continue;
    const status = STATUS[ev.status] ? ev.status : 'pending';
    const end = ev.endTime && toMin(ev.endTime) > toMin(ev.startTime) ? ev.endTime : null;
    out.push({
      id: 'e:' + ev.id,
      title: ev.title || '—',
      start: `${ev.date}T${ev.startTime}`,
      ...(end ? { end: `${ev.date}T${end}` } : {}),
      classNames: ['ev', 'ev-' + status],
      editable: status === 'pending' || status === 'confirmed',
      extendedProps: { kind: 'event', ref: ev.id, status, teacher: teacherName(ev.assignedPersonId), color: ev.assignedPersonId ? teacherColor(store.teachers, ev.assignedPersonId) : '#98a2b3' },
    });
  }

  for (const ge of Object.values(store.groupEvents)) {
    if (!ge.date || !ge.startTime || !visible(ge.assignedPersonId)) continue;
    const status = ge.status || 'pending';
    out.push({
      id: 'g:' + ge.id,
      title: ge.title || 'Групова подія',
      start: `${ge.date}T${ge.startTime}`,
      ...(ge.endTime && toMin(ge.endTime) > toMin(ge.startTime) ? { end: `${ge.date}T${ge.endTime}` } : {}),
      classNames: ['ev', 'ev-group', 'ev-' + status],
      editable: status === 'pending',
      extendedProps: { kind: 'group', ref: ge.id, status, color: '#7a5af8', teacher: teacherName(ge.assignedPersonId), coming: countComing(ge), total: Object.keys(ge.participants || {}).length },
    });
  }

  for (const [id, b] of Object.entries(store.busySlots)) {
    if (!b.date || !b.startTime || (b.teacherId && !visible(b.teacherId))) continue;
    out.push({
      id: 'b:' + id,
      title: b.title || 'Зайнято',
      start: `${b.date}T${b.startTime}`, end: `${b.date}T${b.endTime}`,
      classNames: ['ev', 'ev-busy'],
      editable: false,
      extendedProps: { kind: 'busy', ref: id, color: '#98a2b3', teacher: b.teacherId ? teacherName(b.teacherId) : 'Для всіх' },
    });
  }

  // Повторювані блокування — фоном і лише в тижневому/денному вигляді
  if (view.startsWith('timeGrid')) {
    for (const [id, b] of Object.entries(store.blockedTimes)) {
      if (!b.start || !b.end || !(b.days || []).length || (b.teacherId && !visible(b.teacherId))) continue;
      let endRecur;
      if (b.until) { const d = new Date(b.until + 'T00:00:00'); d.setDate(d.getDate() + 1); endRecur = isoDate(d); }
      out.push({
        id: 'r:' + id,
        daysOfWeek: b.days, startTime: b.start, endTime: b.end,
        ...(endRecur ? { endRecur } : {}),
        display: 'background',
        classNames: ['block', b.teacherId ? 'block-teacher' : 'block-global'],
        extendedProps: { kind: 'block', label: b.title || 'Зайнято', teacher: b.teacherId ? teacherName(b.teacherId) : '' },
      });
    }
  }
  return out;
}

async function onMove(arg) {
  const p = arg.event.extendedProps;
  const s = arg.event.start;
  const e = arg.event.end || new Date(s.getTime() + 3600e3);
  const times = { date: isoDate(s), startTime: hhmm(s), endTime: hhmm(e) };
  if (isoDate(e) !== times.date) { arg.revert(); toast('Заняття має закінчуватися того ж дня', 'warning'); return; }

  const item = p.kind === 'group' ? store.groupEvents[p.ref] : store.events[p.ref];
  if (!item) { arg.revert(); return; }
  const block = findBlock({ ...times, teacherId: item.assignedPersonId }, store.blockedTimes, store.busySlots);
  if (block) { arg.revert(); toast(`Не можна перенести: ${block.title}`, 'error'); return; }
  if (p.kind === 'event') {
    const overlap = findTeacherOverlap(store.events, { id: item.id, ...times, teacherId: item.assignedPersonId });
    if (overlap) toast(`У ${teacherName(item.assignedPersonId)} у цей час уже є «${overlap.title}»`, 'warning');
  }
  try {
    if (p.kind === 'group') await moveGroup(item, times, ctx());
    else await moveEvent(item, times, ctx());
    toast(`Перенесено на ${fmtDate(new Date(times.date + 'T12:00'))}, ${times.startTime}`, 'success');
  } catch (err) {
    console.error(err); arg.revert(); toast('Не вдалося перенести', 'error');
  }
}

// ── МЕНЮ ВИБОРУ СЛОТУ ────────────────────────────────────────
function showSlotMenu(jsEvent, start, end) {
  document.querySelector('.menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'popover menu';
  render(menu, html`
    <div class="menu-head">${start.toLocaleDateString('uk-UA', { weekday: 'short', day: 'numeric', month: 'short' })} · ${hhmm(start)}–${hhmm(end)}</div>
    <button class="menu-item" data-slot="event">${icon('calendar', 16)} Нове заняття</button>
    <button class="menu-item" data-slot="group">${icon('users', 16)} Групова подія</button>
    <button class="menu-item" data-slot="busy">${icon('clock', 16)} Зайнятий час</button>`);
  document.body.append(menu);
  const x = Math.min(jsEvent?.clientX ?? innerWidth / 2, innerWidth - menu.offsetWidth - 12);
  const y = Math.min(jsEvent?.clientY ?? innerHeight / 2, innerHeight - menu.offsetHeight - 12);
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  const close = () => { menu.remove(); calendar.unselect(); document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', esc); };
  const outside = e => { if (!menu.contains(e.target)) close(); };
  const esc = e => { if (e.key === 'Escape') close(); };
  setTimeout(() => { document.addEventListener('mousedown', outside); document.addEventListener('keydown', esc); });
  on(menu, 'click', '[data-slot]', (_, el) => {
    close();
    if (el.dataset.slot === 'event') openEventDialog({ start, end });
    else if (el.dataset.slot === 'group') openGroupDialog({ start, end });
    else openBusyDialog(start, end);
  });
  menu.querySelector('.menu-item').focus();
}

// ── ЗАЙНЯТИЙ ЧАС ─────────────────────────────────────────────
function openBusyDialog(start, end) {
  openDialog({
    title: 'Зайнятий час',
    subtitle: 'Разове блокування — в цей час не можна записати заняття',
    width: 460,
    submitText: 'Заблокувати',
    content: html`
      <label class="field"><span class="field-label">Причина</span>
        <input class="input" name="bTitle" maxlength="60" placeholder="напр. Нарада, обід" autofocus></label>
      <div class="field-row-3">
        <label class="field"><span class="field-label">Дата</span><input class="input num" type="date" name="bDate" value="${isoDate(start)}"></label>
        <label class="field"><span class="field-label">Початок</span><input class="input num" type="time" name="bStart" step="300" value="${hhmm(start)}"></label>
        <label class="field"><span class="field-label">Кінець</span><input class="input num" type="time" name="bEnd" step="300" value="${hhmm(end)}"></label>
      </div>
      <label class="field"><span class="field-label">Для кого</span>
        <select class="select" name="bTeacher">
          <option value="">Для всіх</option>
          ${teacherOptions().map(t => html`<option value="${t.id}">${t.name}</option>`)}
        </select></label>`,
    async onSubmit(form) {
      const f = form.elements;
      if (!f.bDate.value) return fieldError(f.bDate);
      if (!f.bStart.value) return fieldError(f.bStart);
      if (!f.bEnd.value || toMin(f.bEnd.value) <= toMin(f.bStart.value)) { toast('Кінець має бути пізніше за початок', 'warning'); return fieldError(f.bEnd); }
      await set(push(ref(db, 'busySlots')), {
        title: f.bTitle.value.trim() || 'Зайнято',
        date: f.bDate.value, startTime: f.bStart.value, endTime: f.bEnd.value,
        teacherId: f.bTeacher.value || '',
        createdBy: store.staff.name, createdAt: Date.now(),
      });
      toast('Час заблоковано', 'success');
    },
  });
}

async function deleteBusy(id) {
  const b = store.busySlots[id];
  if (!b) return;
  const ok = await confirmDialog({
    title: 'Зняти блокування?',
    message: `«${b.title || 'Зайнято'}» ${b.startTime}–${b.endTime}${b.teacherId ? ` (${teacherName(b.teacherId)})` : ''} буде видалено.`,
    confirmText: 'Зняти', danger: true,
  });
  if (!ok) return;
  await remove(ref(db, 'busySlots/' + id))
    .then(() => toast('Блокування знято', 'success'))
    .catch(() => toast('Не вдалося видалити', 'error'));
}

// ── ПОКАЗНИКИ ────────────────────────────────────────────────
function renderKpis() {
  if (!loaded.events) return;
  const now = new Date();
  const today = isoDate(now), month = monthKey(now), nowT = hhmm(now);
  const evs = Object.values(store.events).filter(e => !e.isGroupMirror);
  const groups = Object.values(store.groupEvents);

  const todayItems = [...evs, ...groups].filter(e => e.date === today && e.status !== 'cancelled');
  const next = todayItems.filter(e => (e.startTime || '') >= nowT).sort((a, b) => a.startTime.localeCompare(b.startTime))[0];
  const pending = evs.filter(e => e.status === 'pending' && e.date >= today);
  const done = [...evs, ...groups].filter(e => e.status === 'completed' && (e.date || '').startsWith(month));
  const cancelled = evs.filter(e => e.status === 'cancelled' && (e.date || '').startsWith(month));
  const monthName = ['січні', 'лютому', 'березні', 'квітні', 'травні', 'червні', 'липні', 'серпні', 'вересні', 'жовтні', 'листопаді', 'грудні'][now.getMonth()];

  render(document.getElementById('kpis'), html`
    <button class="kpi" data-kpi="today" style="--k:var(--brand);--k-soft:var(--brand-soft)">
      <span class="kpi-icon">${icon('calendar', 18)}</span>
      <span class="kpi-text"><span class="kpi-value">${todayItems.length}</span>
        <span class="kpi-label">${plural(todayItems.length, 'заняття', 'заняття', 'занять')} сьогодні${next ? ` · наступне о ${next.startTime}` : ''}</span></span>
    </button>
    <button class="kpi" data-kpi="pending" style="--k:var(--warning);--k-soft:var(--warning-soft)">
      <span class="kpi-icon">${icon('clock', 18)}</span>
      <span class="kpi-text"><span class="kpi-value">${pending.length}</span>
        <span class="kpi-label">очікують підтвердження</span></span>
    </button>
    <a class="kpi" href="completed" style="--k:var(--success);--k-soft:var(--success-soft)">
      <span class="kpi-icon">${icon('check-circle', 18)}</span>
      <span class="kpi-text"><span class="kpi-value">${done.length}</span>
        <span class="kpi-label">проведено в ${monthName}</span></span>
    </a>
    <div class="kpi" style="--k:var(--danger);--k-soft:var(--danger-soft)">
      <span class="kpi-icon">${icon('x', 18)}</span>
      <span class="kpi-text"><span class="kpi-value">${cancelled.length}</span>
        <span class="kpi-label">скасовано цього місяця</span></span>
    </div>`);
}

function openPendingList() {
  const today = isoDate(new Date());
  const list = Object.values(store.events)
    .filter(e => !e.isGroupMirror && e.status === 'pending' && e.date >= today)
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  const dlg = openDialog({
    title: 'Очікують підтвердження',
    subtitle: list.length ? `${list.length} ${plural(list.length, 'заняття', 'заняття', 'занять')} від сьогодні` : '',
    width: 560,
    hideSubmit: true,
    cancelText: 'Закрити',
    content: list.length ? html`
      <div class="participants">
        ${list.map(e => html`
          <button type="button" class="participant search-item" data-open="${e.id}" style="border-radius:0">
            <span class="avatar" style="--av:${e.assignedPersonId ? teacherColor(store.teachers, e.assignedPersonId) : '#98a2b3'}">${initials(e.title)}</span>
            <span class="info">
              <span class="name" style="display:block">${e.title}</span>
              <span class="sub">${fmtDate(new Date(e.date + 'T12:00'))}, ${e.startTime}–${e.endTime || ''} · ${teacherName(e.assignedPersonId) || 'без вчителя'}</span>
            </span>
            ${icon('chevron-right', 16)}
          </button>`)}
      </div>` : html`<div class="empty"><div class="empty-icon">${icon('check-all', 22)}</div><h3>Усе підтверджено</h3></div>`,
    onOpen(form) {
      on(form, 'click', '[data-open]', (_, el) => {
        const ev = store.events[el.dataset.open];
        dlg.close();
        if (ev) { calendar.gotoDate(ev.date); openEventDialog({ id: ev.id }); }
      });
    },
  });
}

// ── ЛЕГЕНДА / ФІЛЬТР ВЧИТЕЛІВ ────────────────────────────────
function renderLegend() {
  const box = document.getElementById('legend');
  const list = teacherOptions();
  // Прибираємо з фільтра вчителів, яких більше немає
  for (const id of filter) if (!store.teachers[id] || store.teachers[id].archived) filter.delete(id);
  box.classList.toggle('filtering', filter.size > 0);
  render(box, html`
    ${filter.size ? html`<button class="chip" data-teacher="" title="Показати всіх">${icon('x', 12)} Усі</button>` : ''}
    ${list.map(t => html`
      <button class="chip" data-teacher="${t.id}" aria-pressed="${String(filter.has(t.id))}" title="Показати лише ${t.name}">
        <span class="dot" style="--dot:${teacherColor(store.teachers, t.id)}"></span>${t.name.split(' ')[0]}
      </button>`)}`);
}

// ── ПРИСУТНІСТЬ ──────────────────────────────────────────────
function renderPresence(data) {
  const box = document.getElementById('presence');
  if (!box) return;
  const others = Object.values(data).filter(p => p?.name && p.name !== store.staff?.name);
  const shown = others.slice(0, 5);
  render(box, html`
    ${shown.map(p => html`<span class="avatar ${p.active === false ? 'away' : ''}" title="${p.name} — ${p.active === false ? 'відійшов' : 'онлайн'}">${initials(p.name)}</span>`)}
    ${others.length > shown.length ? html`<span class="avatar" title="Ще ${others.length - shown.length}">+${others.length - shown.length}</span>` : ''}`);
}

// ── ПОШУК ────────────────────────────────────────────────────
const searchBox = document.getElementById('search');
const searchInput = document.getElementById('search-input');
let searchPop = null;

function runSearch() {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) { closeSearch(); return; }
  const qd = q.replace(/\D/g, '');
  const evs = Object.values(store.events).filter(e => !e.isGroupMirror && (
    (e.title || '').toLowerCase().includes(q) || (qd.length >= 3 && String(e.phone || '').replace(/\D/g, '').includes(qd))));
  evs.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const clients = [];
  const seen = new Set();
  for (const e of evs) {
    const key = phoneDigits(e.phone);
    if (key && !seen.has(key)) { seen.add(key); clients.push({ key, name: e.title, phone: e.phone }); }
  }
  const groups = Object.values(store.groupEvents).filter(g => (g.title || '').toLowerCase().includes(q));

  if (!searchPop) {
    searchPop = document.createElement('div');
    searchPop.className = 'popover search-pop';
    searchBox.append(searchPop);
    on(searchPop, 'click', '[data-go]', (_, el) => {
      const [kind, id] = el.dataset.go.split(':');
      closeSearch();
      searchInput.value = '';
      if (kind === 'client') { window.open('client?id=' + encodeURIComponent(id), '_blank'); return; }
      const item = kind === 'g' ? store.groupEvents[id] : store.events[id];
      if (item?.date) calendar.gotoDate(item.date);
      if (kind === 'g') openGroupDialog({ id }); else openEventDialog({ id });
    });
  }
  const nothing = !clients.length && !evs.length && !groups.length;
  render(searchPop, nothing ? html`<div class="search-empty">Нічого не знайдено серед занять від ${fmtDate(new Date(rangeFrom + 'T12:00'))}</div>` : html`
    ${clients.length ? html`<div class="search-section">Клієнти</div>
      ${clients.slice(0, 4).map(c => html`
        <button class="search-item" data-go="client:${c.key}">
          <span class="avatar avatar-sm">${initials(c.name)}</span>
          <span class="search-item-body"><span class="search-item-title" style="display:block">${c.name}</span><span class="search-item-sub">${c.phone}</span></span>
          ${icon('user', 15)}
        </button>`)}` : ''}
    ${evs.length || groups.length ? html`<div class="search-section">Заняття</div>
      ${[...groups.map(g => ({ ...g, _g: true })), ...evs].slice(0, 7).map(e => html`
        <button class="search-item" data-go="${e._g ? 'g' : 'e'}:${e.id}">
          <span class="dot" style="--dot:${e._g ? 'var(--violet)' : (e.assignedPersonId ? teacherColor(store.teachers, e.assignedPersonId) : '#98a2b3')}"></span>
          <span class="search-item-body">
            <span class="search-item-title" style="display:block">${e.title}</span>
            <span class="search-item-sub">${e.date ? fmtDate(new Date(e.date + 'T12:00')) : ''} ${e.startTime || ''} · ${teacherName(e.assignedPersonId) || '—'}</span>
          </span>
          ${e._g ? html`<span class="badge badge-violet">Група</span>` : html`<span class="badge badge-${STATUS[e.status]?.badge || 'warning'}">${STATUS[e.status]?.label || 'Очікує'}</span>`}
        </button>`)}` : ''}`);
}

function closeSearch() { searchPop?.remove(); searchPop = null; }

let searchTimer = 0;
searchInput.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 120); });
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') { searchInput.value = ''; closeSearch(); searchInput.blur(); }
  if (e.key === 'Enter') searchPop?.querySelector('[data-go]')?.click();
});
document.addEventListener('mousedown', e => { if (searchPop && !searchBox.contains(e.target)) closeSearch(); });
document.addEventListener('keydown', e => {
  if (e.key === '/' && !e.target.closest('input, textarea, select, [contenteditable]') && !document.querySelector('dialog[open]')) {
    e.preventDefault(); searchInput.focus();
  }
});

// ── ДІЇ ──────────────────────────────────────────────────────
on(document, 'click', '[data-action="new-event"]', () => openEventDialog());
on(document, 'click', '[data-action="new-group"]', () => openGroupDialog());
on(document, 'click', '[data-nav]', (_, el) => {
  const nav = el.dataset.nav;
  if (nav === 'prev') calendar.prev(); else if (nav === 'next') calendar.next(); else calendar.today();
});
on(document, 'change', '#views input', (_, el) => { calendar.changeView(el.value); writeLS(VIEW_KEY, el.value); calendar.refetchEvents(); });
on(document, 'click', '[data-teacher]', (_, el) => {
  const id = el.dataset.teacher;
  if (!id) filter.clear();
  else if (filter.has(id)) filter.delete(id);
  else filter.add(id);
  writeLS(FILTER_KEY, [...filter]);
  renderLegend();
  calendar.refetchEvents();
});
on(document, 'click', '[data-kpi="today"]', () => { calendar.today(); });
on(document, 'click', '[data-kpi="pending"]', openPendingList);

// ── ІМПОРТ З РОЗШИРЕННЯ (робоча CRM) ─────────────────────────
// index?importName=…&importPhone=…&importSource=<посилання на картку>
let importDone = false;
function maybeImport() {
  if (importDone || !loaded.people || !loaded.events) return;
  importDone = true;
  const params = new URLSearchParams(location.search);
  const name = params.get('importName'), phone = params.get('importPhone'), source = params.get('importSource');
  if (!name && !phone) return;
  history.replaceState(null, '', location.pathname); // щоб не повторювалось при оновленні
  openEventDialog({ phone: phone || '', imported: { name, phone, source } });
}

// ── СТАРТ ────────────────────────────────────────────────────
initCalendar();
store.staff = await shellReady;
subscribe();
if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});

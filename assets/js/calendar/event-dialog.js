// ============================================================
//  calendar/event-dialog.js — створення/редагування заняття
// ============================================================

import { db, ref, get } from '../core/firebase.js';
import { html, render, on, initials, safeUrl, busy } from '../core/dom.js';
import { fmtDateTime, phoneDigits, isoDate, pad, plural } from '../core/format.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { openDialog, confirmDialog, fieldError } from '../ui/dialog.js';
import {
  STATUS, findBlock, findTeacherOverlap, createEvent, updateEvent, setEventStatus, deleteEvent, toMin,
} from '../data/events.js';
import { siteUrl } from '../data/telegram.js';
import { contractsForPhone } from '../data/contracts.js';
import { openContractDialog } from './contract-dialog.js';
import { store, ctx, teacherName, teacherOptions } from './store.js';
import { teacherColor } from '../data/teachers.js';

const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function nextHalfHour() {
  const d = new Date();
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return d;
}

const STATUS_TOAST = {
  confirmed: 'Подію підтверджено', cancelled: 'Подію скасовано',
  completed: 'Подію проведено', pending: 'Подію повернуто в очікування',
};

/**
 * openEventDialog({ id })                       — редагування
 * openEventDialog({ start, end })               — нова подія на обраний час
 * openEventDialog({ phone, imported })          — імпорт із розширення CRM
 */
export function openEventDialog({ id = null, start = null, end = null, phone = '', imported = null } = {}) {
  const ev = id ? store.events[id] : null;
  if (id && !ev) { toast('Подію не знайдено — можливо, її вже видалили', 'warning'); return; }

  const s = start || nextHalfHour();
  const e = end || new Date(s.getTime() + 60 * 60 * 1000);
  const v = ev || {
    title: '', phone, description: '', assignedPersonId: '',
    date: isoDate(s), startTime: hhmm(s), endTime: hhmm(e),
  };
  const st = ev ? (STATUS[ev.status] ? ev.status : 'pending') : null;
  let dirty = false;
  let dlg;

  const statusStrip = ev ? html`
    <div class="status-strip">
      <span class="badge badge-${STATUS[st].badge}">${icon(STATUS[st].icon, 13)} ${STATUS[st].label}</span>
      <span class="meta">
        ${ev.createdBy ? html`Створив ${ev.createdBy}` : ''}
        ${ev.confirmedBy ? html` · Підтвердив ${ev.confirmedBy}` : ''}
        ${ev.completedBy ? html` · Провів ${ev.completedBy}` : ''}
        ${ev.cancelledBy && st === 'cancelled' ? html` · Скасував ${ev.cancelledBy}` : ''}
      </span>
      <span class="spacer"></span>
      ${st === 'pending' ? html`
        <button type="button" class="btn btn-sm btn-primary" data-status="confirmed">${icon('check', 14)} Підтвердити</button>
        <button type="button" class="btn btn-sm" data-status="cancelled">Скасувати</button>` : ''}
      ${st === 'confirmed' ? html`
        <button type="button" class="btn btn-sm btn-primary" data-status="completed">${icon('check-circle', 14)} Проведено</button>
        <button type="button" class="btn btn-sm" data-status="cancelled">Скасувати</button>` : ''}
      ${st === 'completed' ? html`
        <button type="button" class="btn btn-sm" data-action="contract" hidden>${icon('file-text', 14)} <span>Оформити договір</span></button>
        <button type="button" class="btn btn-sm" data-action="copy-review">${icon('message-square', 14)} Посилання на відгук</button>` : ''}
      ${st === 'cancelled' ? html`
        <button type="button" class="btn btn-sm" data-status="pending">Повернути в очікування</button>` : ''}
    </div>` : '';

  const importBanner = imported ? html`
    <div class="alert alert-success">
      ${icon('check-circle', 16)}
      <div style="flex:1;min-width:0">
        <b>Імпортовано з робочої CRM</b>
        <div>${[imported.name, imported.phone].filter(Boolean).join(' · ')}</div>
      </div>
      ${safeUrl(imported.source) ? html`<a href="${safeUrl(imported.source)}" target="_blank" rel="noopener">Картка ↗</a>` : ''}
    </div>` : '';

  dlg = openDialog({
    title: ev ? 'Заняття' : 'Нове заняття',
    width: 600,
    submitText: ev ? 'Зберегти зміни' : 'Створити',
    extraFooter: ev ? html`<button type="button" class="btn btn-ghost" data-action="delete" style="color:var(--danger)">${icon('trash', 15)} Видалити</button>` : '',
    content: html`
      ${statusStrip}
      ${importBanner}
      <label class="field">
        <span class="field-label">Клієнт або назва заняття</span>
        <input class="input" name="title" maxlength="120" value="${v.title || ''}" placeholder="напр. Іван Петренко — пробне заняття" ${ev ? '' : 'autofocus'}>
      </label>
      <div class="field-row">
        <label class="field">
          <span class="field-label">Телефон клієнта</span>
          <input class="input num" name="phone" type="tel" maxlength="20" value="${v.phone || ''}" placeholder="+380 XX XXX XX XX" autocomplete="off">
        </label>
        <label class="field">
          <span class="field-label">Вчитель</span>
          <select class="select" name="teacher">
            <option value="">— Оберіть вчителя —</option>
            ${teacherOptions(v.assignedPersonId).map(t => html`
              <option value="${t.id}" data-color="${teacherColor(store.teachers, t.id)}" ${t.id === v.assignedPersonId ? 'selected' : ''}>${t.name}${t.archived ? ' (архів)' : ''}</option>`)}
          </select>
        </label>
      </div>
      <div data-client></div>
      <div class="field-row-3">
        <label class="field"><span class="field-label">Дата</span>
          <input class="input num" type="date" name="date" value="${v.date || ''}"></label>
        <label class="field"><span class="field-label">Початок</span>
          <input class="input num" type="time" name="startTime" step="300" value="${v.startTime || ''}"></label>
        <label class="field"><span class="field-label">Кінець</span>
          <input class="input num" type="time" name="endTime" step="300" value="${v.endTime || ''}"></label>
      </div>
      <div data-alerts style="display:contents"></div>
      <label class="field">
        <span class="field-label">Опис <span class="muted">(не обов'язково)</span></span>
        <textarea class="textarea" name="description" rows="3" placeholder="Нотатки для вчителя й менеджерів">${v.description || ''}</textarea>
      </label>
      <div data-review></div>`,

    onOpen(form) {
      form.addEventListener('input', () => { dirty = true; });
      form.addEventListener('input', e => {
        if (['date', 'startTime', 'endTime', 'teacher'].includes(e.target.name)) renderAlerts(form, ev);
        if (e.target.name === 'phone') loadClient(form, ev);
      });
      form.addEventListener('change', e => { if (e.target.name === 'teacher') renderAlerts(form, ev); });
      renderAlerts(form, ev);
      loadClient(form, ev);
      if (ev) loadReview(form, ev.id);
      if (st === 'completed') loadContract(form, ev);

      on(form, 'click', '[data-status]', (_, btn) => applyStatus(form, btn.dataset.status, btn));
      on(form, 'click', '[data-action="copy-review"]', (_, btn) => {
        navigator.clipboard.writeText(siteUrl(`review?eventId=${encodeURIComponent(ev.id)}`))
          .then(() => toast('Посилання на відгук скопійовано', 'success'))
          .catch(() => toast('Не вдалося скопіювати', 'error'));
      });
      on(form, 'click', '[data-action="contract"]', async (_, btn) => {
        const cur = store.events[ev.id] || ev;
        if (!cur.assignedPersonId) { toast('У заняття не вказано вчителя', 'warning'); return; }
        const done = await openContractDialog({
          phone: cur.phone, clientName: cur.clientName || cur.title, teacherId: cur.assignedPersonId,
          eventId: cur.id, eventTitle: cur.title, exists: btn.dataset.has === '1', staff: store.staff,
        });
        if (done) markContract(btn);
      });
      on(form, 'click', '[data-action="delete"]', async () => {
        const ok = await confirmDialog({
          title: 'Видалити заняття?',
          message: `«${ev.title}» буде видалено назавжди разом із повідомленням у Telegram.`,
          confirmText: 'Видалити', danger: true,
        });
        if (!ok) return;
        try {
          await deleteEvent(store.events[ev.id] || ev, ctx());
          toast('Заняття видалено', 'success');
          dlg.close('ok');
        } catch (err) { console.error(err); toast('Не вдалося видалити', 'error'); }
      });
    },

    async onSubmit(form) {
      const data = readValid(form, ev);
      if (!data) return false;
      if (ev) {
        await updateEvent(store.events[ev.id] || ev, data, ctx(), { crmLink: imported?.source });
        toast('Зміни збережено', 'success');
      } else {
        await createEvent(data, ctx(), { crmLink: imported?.source });
        toast('Заняття створено', 'success');
      }
    },
  });

  async function applyStatus(form, status, btn) {
    if (status === 'cancelled') {
      const ok = await confirmDialog({ title: 'Скасувати заняття?', message: 'Менеджери побачать скасування в Telegram.', confirmText: 'Скасувати заняття', danger: true });
      if (!ok) return;
    }
    await busy(btn, async () => {
      try {
        let cur = store.events[ev.id] || ev;
        if (dirty) {
          const data = readValid(form, ev);
          if (!data) return;
          cur = await updateEvent(cur, data, ctx());
        }
        await setEventStatus(cur, status, ctx());
        toast(STATUS_TOAST[status], 'success');
        dlg.close('ok');
      } catch (err) { console.error(err); toast('Не вдалося змінити статус', 'error'); }
    });
  }
}

// ── Перевірки ────────────────────────────────────────────────
function values(form) {
  return {
    title: form.elements.title.value.trim().replace(/\s+/g, ' '),
    phone: form.elements.phone.value.trim(),
    assignedPersonId: form.elements.teacher.value,
    date: form.elements.date.value,
    startTime: form.elements.startTime.value,
    endTime: form.elements.endTime.value,
    description: form.elements.description.value.trim(),
  };
}

function readValid(form, ev) {
  const d = values(form);
  if (!d.title) return fieldError(form.elements.title) && null;
  if (!phoneDigits(d.phone)) { toast('Вкажіть номер телефону клієнта', 'warning'); return fieldError(form.elements.phone) && null; }
  if (!d.assignedPersonId) { toast('Оберіть вчителя', 'warning'); return fieldError(form.elements.teacher) && null; }
  if (!d.date) return fieldError(form.elements.date) && null;
  if (!d.startTime) return fieldError(form.elements.startTime) && null;
  if (!d.endTime || toMin(d.endTime) <= toMin(d.startTime)) { toast('Кінець має бути пізніше за початок', 'warning'); return fieldError(form.elements.endTime) && null; }
  const block = findBlock({ ...d, teacherId: d.assignedPersonId }, store.blockedTimes, store.busySlots);
  if (block) {
    toast(block.global ? `Цей час заблоковано: ${block.title}` : `У вчителя заблоковано цей час: ${block.title}`, 'error');
    return fieldError(form.elements.startTime) && null;
  }
  return d;
}

function renderAlerts(form, ev) {
  const d = values(form);
  const box = form.querySelector('[data-alerts]');
  const block = findBlock({ ...d, teacherId: d.assignedPersonId }, store.blockedTimes, store.busySlots);
  const overlap = findTeacherOverlap(store.events, { id: ev?.id, ...d, teacherId: d.assignedPersonId });
  render(box, html`
    ${block ? html`<div class="alert alert-danger">${icon('alert-circle', 16)}
      <span>${block.global ? 'Цей час заблоковано для всіх' : `Цей час заблоковано для вчителя ${teacherName(d.assignedPersonId)}`}: <b>${block.title}</b></span></div>` : ''}
    ${!block && overlap ? html`<div class="alert alert-warning">${icon('alert-triangle', 16)}
      <span>У ${teacherName(d.assignedPersonId)} вже є заняття ${overlap.startTime}–${overlap.endTime}: <b>${overlap.title}</b>. Зберегти все одно можна.</span></div>` : ''}`);
}

// ── Клієнт за номером ────────────────────────────────────────
let clientTimer = null;
function loadClient(form, ev) {
  clearTimeout(clientTimer);
  const box = form.querySelector('[data-client]');
  const key = phoneDigits(form.elements.phone.value);
  if (!key) { render(box, ''); return; }
  clientTimer = setTimeout(async () => {
    let client = null;
    try { client = (await get(ref(db, 'clients/' + key))).val(); } catch {}
    if (phoneDigits(form.elements.phone.value) !== key) return; // номер уже змінили
    const count = Object.values(store.events).filter(x => !x.isGroupMirror && phoneDigits(x.phone) === key).length;
    const crm = safeUrl(client?.crmLink || ev?.importSource || '');
    render(box, client ? html`
      <div class="client-chip">
        <span class="avatar">${initials(client.name || key.slice(-2))}</span>
        <div class="info">
          <div class="name">${client.name || 'Без імені'}</div>
          <div class="sub">${client.phone || key}${count ? ` · ${count} ${plural(count, 'заняття', 'заняття', 'занять')} у календарі` : ''}</div>
        </div>
        ${crm ? html`<a class="btn btn-sm" href="${crm}" target="_blank" rel="noopener">CRM ↗</a>` : ''}
        <a class="btn btn-sm" href="client?id=${encodeURIComponent(key)}" target="_blank">${icon('user', 14)} Картка</a>
      </div>` : html`
      <div class="client-chip">
        <span class="avatar" style="--av:var(--success)">${icon('plus', 15)}</span>
        <div class="info">
          <div class="name">Новий клієнт</div>
          <div class="sub">Картку клієнта буде створено автоматично</div>
        </div>
      </div>`);
  }, 300);
}

async function loadReview(form, eventId) {
  try {
    const snap = await get(ref(db, 'reviews/' + eventId));
    if (!snap.exists()) return;
    const r = snap.val();
    render(form.querySelector('[data-review]'), html`
      <div class="review-block">
        <div class="label">${icon('message-square', 14)} Відгук клієнта</div>
        <p>${r.comment || ''}</p>
        <div class="time">${fmtDateTime(r.createdAt)}</div>
      </div>`);
  } catch {}
}

// Кнопка договору для проведеного заняття: показує, чи договір уже є
async function loadContract(form, ev) {
  const btn = form.querySelector('[data-action="contract"]');
  if (!btn) return;
  const list = await contractsForPhone(ev.phone).catch(() => []);
  if (list.some(c => c.eventId === ev.id)) markContract(btn);
  btn.hidden = false;
}

function markContract(btn) {
  btn.dataset.has = '1';
  btn.style.cssText = 'color:var(--success);border-color:var(--success-border);background:var(--success-soft)';
  btn.querySelector('span').textContent = 'Договір оформлено';
}

// ============================================================
//  calendar/group-dialog.js — групова подія з учасниками
// ============================================================

import { db, ref, get, set } from '../core/firebase.js';
import { html, render, on, initials, busy } from '../core/dom.js';
import { phoneDigits, isoDate, pad } from '../core/format.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { openDialog, confirmDialog, fieldError } from '../ui/dialog.js';
import { findBlock, toMin } from '../data/events.js';
import {
  GROUP_STATUS, CONFIRM, contractTag, newParticipantId, saveGroup, setGroupStatus, deleteGroup,
} from '../data/group-events.js';
import { contractsForPhone } from '../data/contracts.js';
import { openContractDialog } from './contract-dialog.js';
import { store, ctx, teacherOptions } from './store.js';
import { teacherColor } from '../data/teachers.js';

const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

let clientsCache = null;   // завантажуємо всіх клієнтів лише при першому пошуку
async function clients() {
  if (!clientsCache) {
    const snap = await get(ref(db, 'clients'));
    clientsCache = {};
    snap.forEach(c => { clientsCache[c.key] = { key: c.key, ...c.val() }; });
  }
  return clientsCache;
}

export function openGroupDialog({ id = null, start = null, end = null } = {}) {
  const ge = id ? store.groupEvents[id] : null;
  if (id && !ge) { toast('Подію не знайдено — можливо, її вже видалили', 'warning'); return; }

  const s = start || new Date(new Date().setHours(10, 0, 0, 0));
  const e = end || new Date(s.getTime() + 60 * 60 * 1000);
  const v = ge || { title: '', description: '', assignedPersonId: '', date: isoDate(s), startTime: hhmm(s), endTime: hhmm(e) };
  const st = ge ? (GROUP_STATUS[ge.status] ? ge.status : 'pending') : null;
  const draft = structuredClone(ge?.participants || {});
  let dirty = false;
  let dlg;

  dlg = openDialog({
    title: ge ? 'Групова подія' : 'Нова групова подія',
    width: 660,
    submitText: ge ? 'Зберегти зміни' : 'Створити',
    extraFooter: ge ? html`<button type="button" class="btn btn-ghost" data-action="delete" style="color:var(--danger)">${icon('trash', 15)} Видалити</button>` : '',
    content: html`
      ${ge ? html`
        <div class="status-strip">
          <span class="badge badge-${GROUP_STATUS[st].badge}">${GROUP_STATUS[st].label}</span>
          ${ge.updatedBy ? html`<span class="meta">Оновив ${ge.updatedBy}</span>` : ''}
          <span class="spacer"></span>
          ${st === 'pending' ? html`
            <button type="button" class="btn btn-sm btn-primary" data-status="completed">${icon('check-circle', 14)} Проведено</button>
            <button type="button" class="btn btn-sm" data-status="cancelled">Скасувати</button>` : html`
            <button type="button" class="btn btn-sm" data-status="pending">Повернути в очікування</button>`}
        </div>` : ''}
      <label class="field">
        <span class="field-label">Назва</span>
        <input class="input" name="gTitle" maxlength="120" value="${v.title || ''}" placeholder="напр. Майстер-клас з робототехніки" ${ge ? '' : 'autofocus'}>
      </label>
      <div class="field-row">
        <label class="field"><span class="field-label">Вчитель</span>
          <select class="select" name="gTeacher">
            <option value="" data-placeholder>— Оберіть вчителя —</option>
            ${teacherOptions(v.assignedPersonId).map(t => html`
              <option value="${t.id}" data-color="${teacherColor(store.teachers, t.id)}" ${t.id === v.assignedPersonId ? 'selected' : ''}>${t.name}${t.archived ? ' (архів)' : ''}</option>`)}
          </select></label>
        <label class="field"><span class="field-label">Дата</span>
          <input class="input num" type="date" name="gDate" value="${v.date || ''}"></label>
      </div>
      <div class="field-row">
        <label class="field"><span class="field-label">Початок</span>
          <input class="input num" type="time" name="gStart" step="300" value="${v.startTime || ''}"></label>
        <label class="field"><span class="field-label">Кінець</span>
          <input class="input num" type="time" name="gEnd" step="300" value="${v.endTime || ''}"></label>
      </div>
      <label class="field">
        <span class="field-label">Опис <span class="muted">(не обов'язково)</span></span>
        <textarea class="textarea" name="gDesc" rows="2">${v.description || ''}</textarea>
      </label>

      <div class="section-head">
        <h3>Учасники</h3>
        <span class="badge num" data-count></span>
        <span class="spacer"></span>
        <button type="button" class="btn btn-sm" data-action="toggle-add">${icon('plus', 14)} Додати учасника</button>
      </div>
      <div class="add-panel" data-add hidden>
        <div class="search">
          ${icon('search', 16)}
          <input class="input" data-search placeholder="Знайти клієнта за ім'ям або телефоном" autocomplete="off" style="width:100%">
        </div>
        <div class="add-results" data-results></div>
        <div class="divider-text">або новий клієнт</div>
        <div class="field-row-3" style="grid-template-columns:1.6fr .6fr 1.2fr">
          <input class="input" data-new="name" placeholder="Ім'я та прізвище" maxlength="80">
          <input class="input num" data-new="age" placeholder="Вік" inputmode="numeric" maxlength="3">
          <input class="input num" data-new="phone" type="tel" placeholder="Телефон" maxlength="20">
        </div>
        <div><button type="button" class="btn btn-sm btn-primary" data-action="add-new">${icon('plus', 14)} Додати нового</button></div>
      </div>
      <div data-list></div>`,

    onOpen(form) {
      form.addEventListener('input', e => { if (!e.target.closest('[data-add]')) dirty = true; });
      renderList(form);

      on(form, 'click', '[data-action="toggle-add"]', () => {
        const panel = form.querySelector('[data-add]');
        panel.hidden = !panel.hidden;
        if (!panel.hidden) form.querySelector('[data-search]').focus();
      });
      form.querySelector('[data-search]').addEventListener('input', e => renderResults(form, e.target.value));
      // Enter у панелі додавання не повинен відправляти всю форму
      form.querySelector('[data-add]').addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });

      on(form, 'click', '[data-pick]', (_, el) => addExisting(form, el.dataset.pick));
      on(form, 'click', '[data-action="add-new"]', (_, btn) => busy(btn, () => addNew(form)));
      on(form, 'click', '[data-confirm]', (_, el) => {
        const p = draft[el.dataset.pid];
        if (!p) return;
        p.confirmStatus = el.dataset.confirm;
        p.attending = el.dataset.confirm !== 'not_coming';
        dirty = true;
        renderList(form);
      });
      on(form, 'click', '[data-remove]', async (_, el) => {
        const p = draft[el.dataset.remove];
        const ok = await confirmDialog({ title: 'Прибрати учасника?', message: `${p?.name || 'Учасника'} буде прибрано з цієї події після збереження.`, confirmText: 'Прибрати', danger: true });
        if (!ok) return;
        delete draft[el.dataset.remove];
        dirty = true;
        renderList(form);
      });
      on(form, 'click', '[data-contract]', (_, el) => openContract(form, el.dataset.contract));
      on(form, 'click', '[data-status]', (_, btn) => applyStatus(form, btn.dataset.status, btn));
      on(form, 'click', '[data-action="delete"]', async () => {
        const ok = await confirmDialog({
          title: 'Видалити групову подію?',
          message: `«${ge.title}» і записи всіх учасників буде видалено назавжди.`,
          confirmText: 'Видалити', danger: true,
        });
        if (!ok) return;
        try {
          await deleteGroup(store.groupEvents[ge.id] || ge);
          toast('Групову подію видалено', 'success');
          dlg.close('ok');
        } catch (err) { console.error(err); toast('Не вдалося видалити', 'error'); }
      });

      if (ge) loadContracts(form);
    },

    async onSubmit(form) {
      const data = readValid(form);
      if (!data) return false;
      await saveGroup(ge ? (store.groupEvents[ge.id] || ge) : null, data, ctx());
      toast(ge ? 'Зміни збережено' : 'Групову подію створено', 'success');
    },
  });

  // ── Учасники ────────────────────────────────────────────────
  function renderList(form) {
    const entries = Object.entries(draft);
    const coming = entries.filter(([, p]) => p.attending !== false).length;
    form.querySelector('[data-count]').textContent = entries.length ? `${coming}/${entries.length}` : '0';
    render(form.querySelector('[data-list]'), entries.length ? html`
      <div class="participants">
        ${entries.map(([pid, p]) => html`
          <div class="participant">
            <span class="avatar">${initials(p.name)}</span>
            <div class="info">
              <div class="name">${p.name || '—'}</div>
              <div class="sub">${p.phone || '—'}${p.age ? ` · ${p.age} р.` : ''}</div>
            </div>
            <div class="tri" role="group" aria-label="Чи прийде">
              ${Object.entries(CONFIRM).map(([val, c]) => html`
                <button type="button" data-confirm="${val}" data-pid="${pid}" data-value="${val}" title="${c.label}"
                  aria-pressed="${String((p.confirmStatus || 'pending') === val)}">${icon(c.icon, 14)}</button>`)}
            </div>
            <button type="button" class="btn btn-sm" data-contract="${pid}" ${ge ? '' : html`disabled title="Спочатку збережіть подію"`}
              style="${p.hasContract ? 'color:var(--success);border-color:var(--success-border);background:var(--success-soft)' : ''}">
              ${p.hasContract ? html`${icon('check', 13)} Договір` : 'Договір'}
            </button>
            <button type="button" class="icon-btn danger" data-remove="${pid}" title="Прибрати" aria-label="Прибрати">${icon('x', 15)}</button>
          </div>`)}
      </div>` : html`
      <div class="empty" style="padding:24px;border:1px dashed var(--border-strong);border-radius:var(--r-lg)">
        <p>Додайте хоча б одного учасника</p>
      </div>`);
  }

  async function renderResults(form, query) {
    const box = form.querySelector('[data-results]');
    const q = query.trim().toLowerCase();
    const qd = q.replace(/\D/g, '');
    if (!q) { render(box, ''); return; }
    const all = await clients().catch(() => ({}));
    const found = Object.values(all).filter(c =>
      (c.name || '').toLowerCase().includes(q) || (qd.length >= 3 && (c.key.includes(qd) || String(c.phone || '').replace(/\D/g, '').includes(qd)))
    ).slice(0, 8);
    render(box, found.length ? found.map(c => html`
      <button type="button" class="search-item" data-pick="${c.key}">
        <span class="avatar avatar-sm">${initials(c.name || c.key.slice(-2))}</span>
        <span class="search-item-body">
          <span class="search-item-title">${c.name || 'Без імені'}</span>
          <span class="search-item-sub">${c.phone || c.key}${c.age ? ` · ${c.age} р.` : ''}</span>
        </span>
        ${icon('plus', 15)}
      </button>`) : html`<div class="search-empty">Нікого не знайдено — додайте нового клієнта нижче</div>`);
  }

  function addParticipant(form, p) {
    const dup = Object.values(draft).some(x => phoneDigits(x.phone) === phoneDigits(p.phone) && (x.name || '').toLowerCase() === (p.name || '').toLowerCase());
    if (dup) { toast('Цей учасник уже є у списку', 'warning'); return; }
    draft[newParticipantId()] = { ...p, confirmStatus: 'pending', attending: true };
    dirty = true;
    form.querySelector('[data-add]').hidden = true;
    form.querySelector('[data-search]').value = '';
    render(form.querySelector('[data-results]'), '');
    renderList(form);
  }

  function addExisting(form, key) {
    const c = clientsCache?.[key];
    if (!c) return;
    addParticipant(form, { phone: c.phone || key, name: c.name || '', age: c.age || '' });
  }

  async function addNew(form) {
    const get_ = n => form.querySelector(`[data-new="${n}"]`);
    const name = get_('name').value.trim();
    const age = get_('age').value.trim();
    const rawPhone = get_('phone').value.trim();
    const key = phoneDigits(rawPhone);
    if (!name) return fieldError(get_('name'));
    if (!key) { toast('Вкажіть коректний номер телефону', 'warning'); return fieldError(get_('phone')); }
    const all = await clients().catch(() => ({}));
    if (!all[key]) {
      // Нова картка клієнта; якщо номер уже є — картку не перезаписуємо
      const card = { name, age: age || null, phone: rawPhone, createdAt: Date.now(), createdBy: store.staff.name };
      await set(ref(db, 'clients/' + key), card);
      all[key] = { key, ...card };
    }
    addParticipant(form, { phone: rawPhone, name, age });
    ['name', 'age', 'phone'].forEach(n => { get_(n).value = ''; });
  }

  async function loadContracts(form) {
    const phones = [...new Set(Object.values(draft).map(p => phoneDigits(p.phone)).filter(Boolean))];
    const byPhone = {};
    await Promise.all(phones.map(async ph => { byPhone[ph] = await contractsForPhone(ph).catch(() => []); }));
    Object.entries(draft).forEach(([pid, p]) => {
      p.hasContract = (byPhone[phoneDigits(p.phone)] || []).some(c => c.eventId === contractTag(ge.id, pid));
    });
    renderList(form);
  }

  async function openContract(form, pid) {
    const p = draft[pid];
    const cur = store.groupEvents[ge.id] || ge;
    if (!p || !cur) return;
    if (!cur.assignedPersonId) { toast('Спочатку оберіть і збережіть вчителя', 'warning'); return; }
    if (!ge.participants?.[pid]) { toast('Спочатку збережіть подію з цим учасником', 'warning'); return; }
    const done = await openContractDialog({
      phone: p.phone, clientName: p.name, teacherId: cur.assignedPersonId,
      eventId: contractTag(cur.id, pid), eventTitle: cur.title, exists: p.hasContract, staff: store.staff,
    });
    if (done) { p.hasContract = true; renderList(form); }
  }

  // ── Збереження і статуси ────────────────────────────────────
  function readValid(form) {
    const f = form.elements;
    const d = {
      title: f.gTitle.value.trim().replace(/\s+/g, ' '),
      assignedPersonId: f.gTeacher.value,
      date: f.gDate.value, startTime: f.gStart.value, endTime: f.gEnd.value,
      description: f.gDesc.value.trim(),
      participants: draft,
    };
    if (!d.title) return fieldError(f.gTitle) && null;
    if (!d.assignedPersonId) { toast('Оберіть вчителя', 'warning'); return fieldError(f.gTeacher) && null; }
    if (!d.date) return fieldError(f.gDate) && null;
    if (!d.startTime) return fieldError(f.gStart) && null;
    if (!d.endTime || toMin(d.endTime) <= toMin(d.startTime)) { toast('Кінець має бути пізніше за початок', 'warning'); return fieldError(f.gEnd) && null; }
    if (!Object.keys(draft).length) { toast('Додайте хоча б одного учасника', 'warning'); return null; }
    const block = findBlock({ ...d, teacherId: d.assignedPersonId }, store.blockedTimes, store.busySlots);
    if (block) { toast(`Цей час заблоковано: ${block.title}`, 'error'); return fieldError(f.gStart) && null; }
    return d;
  }

  async function applyStatus(form, status, btn) {
    if (status === 'cancelled') {
      const ok = await confirmDialog({ title: 'Скасувати групову подію?', message: 'Усі учасники отримають статус «Скасовано».', confirmText: 'Скасувати подію', danger: true });
      if (!ok) return;
    }
    await busy(btn, async () => {
      try {
        let cur = store.groupEvents[ge.id] || ge;
        if (dirty) {
          const data = readValid(form);
          if (!data) return;
          cur = await saveGroup(cur, data, ctx());
        }
        await setGroupStatus(cur, status, ctx());
        toast(status === 'completed' ? 'Подію проведено' : status === 'cancelled' ? 'Подію скасовано' : 'Подію повернуто в очікування', 'success');
        dlg.close('ok');
      } catch (err) { console.error(err); toast('Не вдалося змінити статус', 'error'); }
    });
  }
}

// ============================================================
//  Відкритий захід — реєстрація учасників і відмітка присутності
//  openDayEvent = { title, groups: { gid: { name, createdAt,
//                   people: { pid: { name, age, phone, present, createdAt } } } } }
//  Тепер лише для співробітників (раніше сторінка була відкрита всім).
// ============================================================

import { db, ref, get, set, push, update, remove, onValue } from '../core/firebase.js';
import { html, render, on, initials, busy } from '../core/dom.js';
import { plural, fmtDate } from '../core/format.js';
import { initShell } from '../ui/shell.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { openDialog, confirmDialog, fieldError } from '../ui/dialog.js';
import { phoneKey, resolveClientKey, addComment } from '../data/clients.js';

const ROOT = 'openDayEvent';
const page = document.getElementById('page');
let data = null, active = null, q = '';
let staff = null;

const shellReady = initShell({
  page: 'openday', title: 'Відкритий захід', subtitle: 'Реєстрація учасників і відмітка присутності',
  actions: html`
    <button class="btn" data-action="to-clients">${icon('users', 16)} Перенести в клієнти</button>
    <button class="btn" data-action="new-group">${icon('plus', 16)} Група</button>`,
});

render(page, html`
  <section class="card od-head">
    <input class="od-title" id="od-title" maxlength="80" placeholder="Назва заходу, напр. «День відкритих дверей 12 жовтня»" aria-label="Назва заходу">
    <div class="od-stats" id="od-stats"></div>
  </section>
  <div class="od-tabs" id="od-tabs"></div>
  <section class="card" id="od-group"><div class="page-loader"><div class="spinner"></div></div></section>`);

staff = await shellReady;

// Стара структура (people без груп) → перша група, щоб нічого не загубити
const legacy = (await get(ref(db, ROOT)).catch(() => null))?.val();
if (legacy?.people && !legacy.groups) {
  const gid = push(ref(db, `${ROOT}/groups`)).key;
  await update(ref(db), { [`${ROOT}/groups/${gid}`]: { name: 'Група 1', createdAt: Date.now(), people: legacy.people }, [`${ROOT}/people`]: null });
}

const titleInput = document.getElementById('od-title');
onValue(ref(db, ROOT), s => {
  data = s.val() || {};
  if (document.activeElement !== titleInput) titleInput.value = data.title || '';
  const ids = groupIds();
  if (!ids.length) { set(push(ref(db, `${ROOT}/groups`)), { name: '', createdAt: Date.now() }); return; }
  if (!active || !data.groups?.[active]) active = ids[0];
  renderAll();
});
titleInput.addEventListener('change', () => set(ref(db, `${ROOT}/title`), titleInput.value.trim()));
titleInput.addEventListener('keydown', e => { if (e.key === 'Enter') titleInput.blur(); });

const groupIds = () => Object.keys(data?.groups || {}).sort((a, b) => (data.groups[a].createdAt || 0) - (data.groups[b].createdAt || 0));
const peopleOf = gid => Object.entries(data.groups?.[gid]?.people || {}).map(([id, p]) => ({ id, ...p })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

// ── Рендер ───────────────────────────────────────────────────
function renderAll() {
  const ids = groupIds();
  const all = ids.flatMap(peopleOf);
  render(document.getElementById('od-stats'), html`
    <span class="od-stat"><b class="num">${all.length}</b> ${plural(all.length, 'учасник', 'учасники', 'учасників')}</span>
    <span class="od-stat on"><b class="num">${all.filter(p => p.present).length}</b> присутні</span>`);

  render(document.getElementById('od-tabs'), ids.length > 1 ? html`
    ${ids.map(gid => {
      const ppl = peopleOf(gid);
      return html`<button class="chip od-tab" data-group="${gid}" aria-pressed="${String(gid === active)}">
        ${data.groups[gid].name || 'Без назви'} <span class="muted num">${ppl.filter(p => p.present).length}/${ppl.length}</span></button>`;
    })}
    <button class="chip" data-action="new-group">${icon('plus', 12)} Група</button>` : '');
  renderGroup();
}

function renderGroup() {
  const g = data.groups?.[active];
  if (!g) return;
  const ppl = peopleOf(active);
  const ql = q.toLowerCase(), qd = q.replace(/\D/g, '');
  const list = ppl.filter(p => !q || (p.name || '').toLowerCase().includes(ql) || (qd && String(p.phone || '').replace(/\D/g, '').includes(qd)));
  const multi = groupIds().length > 1;
  render(document.getElementById('od-group'), html`
    <div class="card-head">
      <div>
        <h2>${multi ? (g.name || 'Без назви') : 'Учасники'}</h2>
        <p>${ppl.filter(p => p.present).length} з ${ppl.length} на місці</p>
      </div>
      ${multi ? html`<button class="icon-btn" data-action="edit-group" title="Перейменувати або видалити групу" aria-label="Редагувати групу">${icon('pencil', 15)}</button>` : ''}
      <span class="spacer"></span>
      <div class="search">${icon('search', 16)}<input class="input" id="od-search" type="search" placeholder="Пошук" value="${q}" style="width:200px;padding-right:12px"></div>
      ${ppl.length ? html`<button class="btn btn-ghost btn-sm" data-action="clear-group" style="color:var(--danger)">Очистити</button>` : ''}
    </div>
    <form class="od-add" id="od-add" autocomplete="off">
      <input class="input" name="name" placeholder="Ім'я та прізвище учасника" maxlength="80" aria-label="Ім'я">
      <input class="input num" name="age" placeholder="Вік" maxlength="3" inputmode="numeric" aria-label="Вік">
      <input class="input num" name="phone" type="tel" placeholder="Телефон батьків" maxlength="20" aria-label="Телефон">
      <button class="btn btn-primary" type="submit">${icon('plus', 16)} Додати</button>
    </form>
    ${list.length ? html`
      <ul class="od-list">
        ${list.map((p, i) => html`
          <li class="od-row ${p.present ? 'present' : ''}">
            <button type="button" class="od-check" data-toggle="${p.id}" aria-pressed="${String(!!p.present)}" title="${p.present ? 'Прибрати відмітку' : 'Відмітити присутність'}">${icon('check', 16)}</button>
            <span class="od-num num">${i + 1}</span>
            <span class="avatar avatar-sm">${initials(p.name)}</span>
            <span class="od-name">${p.name || 'Без імені'}</span>
            <span class="muted">${p.age ? `${p.age} р.` : ''}</span>
            <span class="num muted od-phone">${p.phone || ''}</span>
            ${p.clientKey ? html`<a class="badge badge-success" href="client?id=${encodeURIComponent(p.clientKey)}" title="Картка клієнта">${icon('user', 12)} у CRM</a>` : html`<span></span>`}
            <span class="row-actions">
              <button class="icon-btn" data-edit="${p.id}" aria-label="Редагувати">${icon('pencil', 15)}</button>
              <button class="icon-btn danger" data-del="${p.id}" aria-label="Видалити">${icon('trash', 15)}</button>
            </span>
          </li>`)}
      </ul>` : html`<div class="empty" style="padding:32px"><p>${q ? 'Нікого не знайдено' : 'Поки що нікого немає — додайте першого учасника вище'}</p></div>`}`);
  const s = document.getElementById('od-search');
  s.addEventListener('input', () => { q = s.value.trim(); renderGroupKeepFocus(); });
}

function renderGroupKeepFocus() {
  const pos = document.getElementById('od-search')?.selectionStart;
  renderGroup();
  const s = document.getElementById('od-search');
  s.focus(); s.setSelectionRange(pos, pos);
}

// ── Дії ──────────────────────────────────────────────────────
const personRef = id => ref(db, `${ROOT}/groups/${active}/people/${id}`);

on(page, 'submit', '#od-add', async (e, form) => {
  e.preventDefault();
  const f = form.elements;
  const name = f.name.value.trim().replace(/\s+/g, ' ');
  if (!name) { f.name.focus(); return; }
  await set(push(ref(db, `${ROOT}/groups/${active}/people`)), {
    name, age: f.age.value.trim(), phone: f.phone.value.trim(), present: false, createdAt: Date.now(),
  }).catch(() => toast('Не вдалося додати', 'error'));
  form.reset();
  document.querySelector('#od-add [name="name"]')?.focus();
});

on(page, 'click', '[data-toggle]', (_, el) => {
  const p = data.groups[active].people[el.dataset.toggle];
  set(ref(db, `${ROOT}/groups/${active}/people/${el.dataset.toggle}/present`), !p.present);
});

on(page, 'click', '[data-group]', (_, el) => { active = el.dataset.group; q = ''; renderAll(); });

on(page, 'click', '[data-edit]', (_, el) => {
  const id = el.dataset.edit;
  const p = data.groups[active].people[id];
  openDialog({
    title: 'Учасник', width: 440,
    content: html`
      <label class="field"><span class="field-label">Ім'я та прізвище</span><input class="input" name="pName" value="${p.name || ''}" maxlength="80" autofocus></label>
      <div class="field-row">
        <label class="field"><span class="field-label">Вік</span><input class="input num" name="pAge" value="${p.age || ''}" maxlength="3" inputmode="numeric"></label>
        <label class="field"><span class="field-label">Телефон</span><input class="input num" name="pPhone" type="tel" value="${p.phone || ''}" maxlength="20"></label>
      </div>`,
    async onSubmit(form) {
      const f = form.elements;
      if (!f.pName.value.trim()) return fieldError(f.pName);
      await update(personRef(id), { name: f.pName.value.trim(), age: f.pAge.value.trim(), phone: f.pPhone.value.trim() });
    },
  });
});

on(page, 'click', '[data-del]', async (_, el) => {
  const p = data.groups[active].people[el.dataset.del];
  if (!await confirmDialog({ title: 'Видалити учасника?', message: `«${p?.name || 'Учасник'}» буде видалено зі списку.`, confirmText: 'Видалити', danger: true })) return;
  await remove(personRef(el.dataset.del));
});

on(page, 'click', '[data-action="clear-group"]', async () => {
  const n = peopleOf(active).length;
  if (!await confirmDialog({ title: 'Очистити групу?', message: `Буде видалено всіх учасників групи (${n}). Дію не можна скасувати.`, confirmText: 'Очистити', danger: true })) return;
  await remove(ref(db, `${ROOT}/groups/${active}/people`));
});

function openGroupDialog(gid = null) {
  const g = gid ? data.groups[gid] : null;
  const dlg = openDialog({
    title: g ? 'Група' : 'Нова група', width: 420, submitText: g ? 'Зберегти' : 'Створити',
    extraFooter: g && groupIds().length > 1 ? html`<button type="button" class="btn btn-ghost" data-action="del-group" style="color:var(--danger)">${icon('trash', 15)} Видалити</button>` : '',
    content: html`<label class="field"><span class="field-label">Назва групи</span><input class="input" name="gName" value="${g?.name || ''}" placeholder="напр. Група 1 (10:00)" maxlength="40" autofocus></label>`,
    onOpen(form) {
      on(form, 'click', '[data-action="del-group"]', async () => {
        const n = peopleOf(gid).length;
        if (!await confirmDialog({ title: 'Видалити групу?', message: `Групу «${g.name || 'Без назви'}»${n ? ` і всіх її учасників (${n})` : ''} буде видалено.`, confirmText: 'Видалити', danger: true })) return;
        await remove(ref(db, `${ROOT}/groups/${gid}`));
        dlg.close();
      });
    },
    async onSubmit(form) {
      const name = form.elements.gName.value.trim();
      if (!name) return fieldError(form.elements.gName);
      if (g) await update(ref(db, `${ROOT}/groups/${gid}`), { name });
      else { const r = push(ref(db, `${ROOT}/groups`)); await set(r, { name, createdAt: Date.now() }); active = r.key; }
    },
  });
}
on(document, 'click', '[data-action="new-group"]', () => openGroupDialog());
on(page, 'click', '[data-action="edit-group"]', () => openGroupDialog(active));

// Присутні з телефоном → картки клієнтів (+ нотатка про захід)
on(document, 'click', '[data-action="to-clients"]', async (_, btn) => {
  const all = groupIds().flatMap(gid => peopleOf(gid).map(p => ({ ...p, gid })));
  const todo = all.filter(p => p.present && phoneKey(p.phone) && !p.clientKey);
  if (!todo.length) { toast('Немає присутніх з телефоном, яких ще не перенесено', 'info'); return; }
  const ok = await confirmDialog({
    title: 'Перенести в клієнти?',
    message: `${todo.length} ${plural(todo.length, 'присутній учасник', 'присутні учасники', 'присутніх учасників')} з телефоном отримають картку клієнта (або нотатку в наявній) з позначкою про захід.`,
    confirmText: 'Перенести',
  });
  if (!ok) return;
  await busy(btn, async () => {
    const title = data.title || 'Відкритий захід';
    let created = 0;
    for (const p of todo) {
      const key = await resolveClientKey(p.phone);
      const exists = (await get(ref(db, 'clients/' + key))).exists();
      if (!exists) {
        await set(ref(db, 'clients/' + key), { name: p.name || '', age: p.age || null, phone: p.phone, phoneKey: phoneKey(p.phone), createdAt: Date.now(), createdBy: staff.name, source: 'openday' });
        created++;
      }
      await addComment(key, `Був(ла) на заході «${title}» ${fmtDate(Date.now())}${p.age ? `, вік ${p.age}` : ''}${exists ? ` (учасник: ${p.name})` : ''}`, staff);
      await update(ref(db, `${ROOT}/groups/${p.gid}/people/${p.id}`), { clientKey: key });
    }
    toast(`Готово: ${created} нових карток, ${todo.length - created} нотаток у наявних`, 'success');
  });
});

// ============================================================
//  Відкритий захід — окрема універсальна сторінка (без меню CRM)
//  Працює без входу: відкрив посилання на телефоні — і реєструєш.
//  openDayEvent = { title, groups: { gid: { name, createdAt,
//                   people: { pid: { name, age, phone, present, createdAt, clientKey? } } } } }
// ============================================================

import { auth, db, ref, get, set, push, update, remove, onValue } from '../core/firebase.js';
import { findStaff } from '../core/auth.js';
import { html, render, on, initials, busy } from '../core/dom.js';
import { plural, fmtDate } from '../core/format.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { openDialog, fieldError } from '../ui/dialog.js';
import { pageReady } from '../ui/loader.js';
import { phoneKey, resolveClientKey, addComment } from '../data/clients.js';

const ROOT = 'openDayEvent';
const top = document.getElementById('od-top');
const main = document.getElementById('od-main');
let data = null, active = null, q = '', staff = null;

// ── Каркас ───────────────────────────────────────────────────
render(top, html`
  <div class="od-bar">
    <span class="od-logo" aria-hidden="true">${icon('sparkles', 18)}</span>
    <input class="od-title" id="od-title" maxlength="80" placeholder="Назва заходу" aria-label="Назва заходу" enterkeyhint="done">
    <span class="od-conn" id="od-conn" title="З'єднання…"></span>
    <button class="icon-btn od-menu" id="od-menu" type="button" aria-label="Дії">${icon('more', 20)}</button>
  </div>
  <div class="od-stats" id="od-stats"></div>
  <div class="od-tabs" id="od-tabs"></div>
  <div class="od-search">${icon('search', 16)}<input id="od-search" type="search" placeholder="Пошук за ім'ям або телефоном" aria-label="Пошук" enterkeyhint="search"></div>`);

render(main, html`
  <form class="od-add" id="od-add" autocomplete="off">
    <input class="input" name="name" placeholder="Ім'я та прізвище" maxlength="80" aria-label="Ім'я" enterkeyhint="next">
    <input class="input num" name="age" placeholder="Вік" maxlength="3" inputmode="numeric" aria-label="Вік" enterkeyhint="next">
    <input class="input num" name="phone" type="tel" placeholder="Телефон" maxlength="20" aria-label="Телефон" enterkeyhint="done">
    <button class="btn btn-primary" type="submit">${icon('plus', 16)} Додати</button>
  </form>
  <ul class="od-list" id="od-list"></ul>`);

// ── Дані ─────────────────────────────────────────────────────
onValue(ref(db, '.info/connected'), s => {
  const el = document.getElementById('od-conn');
  el.classList.toggle('live', s.val() === true);
  el.title = s.val() === true ? 'Наживо — зміни бачать усі' : "Немає з'єднання — зміни збережуться пізніше";
});

// Стара структура (people без груп) → перша група
const legacy = (await get(ref(db, ROOT)).catch(() => null))?.val();
if (legacy?.people && !legacy.groups) {
  const gid = push(ref(db, `${ROOT}/groups`)).key;
  await update(ref(db), { [`${ROOT}/groups/${gid}`]: { name: '', createdAt: Date.now(), people: legacy.people }, [`${ROOT}/people`]: null });
}

const titleInput = document.getElementById('od-title');
onValue(ref(db, ROOT), s => {
  data = s.val() || {};
  if (document.activeElement !== titleInput) titleInput.value = data.title || '';
  const ids = groupIds();
  if (!ids.length) { set(push(ref(db, `${ROOT}/groups`)), { name: '', createdAt: Date.now() }); return; }
  if (!active || !data.groups?.[active]) active = ids[0];
  renderAll();
  pageReady();
});

// Співробітник, який увійшов у CRM, бачить додаткову дію «Перенести в клієнти»
auth.authStateReady().then(async () => {
  if (auth.currentUser) staff = await findStaff(auth.currentUser.email).then(s => s && { name: s.name || auth.currentUser.email }).catch(() => null);
});

const groupIds = () => Object.keys(data?.groups || {}).sort((a, b) => (data.groups[a].createdAt || 0) - (data.groups[b].createdAt || 0));
const peopleOf = gid => Object.entries(data.groups?.[gid]?.people || {}).map(([id, p]) => ({ id, ...p })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
const groupName = gid => data.groups?.[gid]?.name || (groupIds().length > 1 ? 'Без назви' : 'Усі учасники');

// ── Рендер ───────────────────────────────────────────────────
function renderAll() {
  const ids = groupIds();
  const all = ids.flatMap(peopleOf);
  const here = all.filter(p => p.present).length;
  render(document.getElementById('od-stats'), html`
    <span class="od-pill"><b class="num">${all.length}</b> ${plural(all.length, 'учасник', 'учасники', 'учасників')}</span>
    <span class="od-pill on"><b class="num">${here}</b> на місці</span>
    ${all.length ? html`<span class="od-progress" aria-hidden="true"><span style="width:${here / all.length * 100}%"></span></span>` : ''}`);

  render(document.getElementById('od-tabs'), html`
    ${ids.length > 1 ? ids.map(gid => {
      const ppl = peopleOf(gid);
      return html`<button type="button" class="od-tab" data-group="${gid}" aria-pressed="${String(gid === active)}">
        <span>${groupName(gid)}</span><span class="od-tab-count num">${ppl.filter(p => p.present).length}/${ppl.length}</span></button>`;
    }) : ''}
    <button type="button" class="od-tab ghost" data-action="new-group">${icon('plus', 14)} ${ids.length > 1 ? 'Група' : 'Розділити на групи'}</button>`);
  renderList();
}

function renderList() {
  const ppl = peopleOf(active);
  const ql = q.toLowerCase(), qd = q.replace(/\D/g, '');
  const list = ppl.filter(p => !q || (p.name || '').toLowerCase().includes(ql) || (qd.length >= 2 && String(p.phone || '').replace(/\D/g, '').includes(qd)));
  const box = document.getElementById('od-list');
  if (!list.length) {
    render(box, html`<li class="od-empty">
      <span class="empty-icon">${icon(q ? 'search' : 'users', 24)}</span>
      <b>${q ? 'Нікого не знайдено' : 'Поки що нікого немає'}</b>
      <span>${q ? 'Спробуйте інше ім’я або номер' : 'Натисніть «+», щоб додати першого учасника'}</span></li>`);
    return;
  }
  render(box, list.map(p => html`
    <li class="od-row ${p.present ? 'present' : ''}" data-toggle="${p.id}" role="button" tabindex="0" aria-pressed="${String(!!p.present)}">
      <span class="od-check">${icon('check', 18)}</span>
      <span class="avatar">${initials(p.name)}</span>
      <span class="od-info">
        <span class="od-name">${p.name || 'Без імені'}</span>
        <span class="od-meta">${[p.age ? `${p.age} р.` : '', p.phone || ''].filter(Boolean).join(' · ') || ' '}${p.clientKey ? html` · <span class="od-crm">у CRM</span>` : ''}</span>
      </span>
      <button type="button" class="icon-btn od-edit" data-edit="${p.id}" aria-label="Редагувати ${p.name || ''}">${icon('pencil', 17)}</button>
    </li>`));
}

// ── Відмітка присутності (тап по рядку) ──────────────────────
function toggle(id) {
  const p = data.groups?.[active]?.people?.[id];
  if (!p) return;
  if (navigator.vibrate) navigator.vibrate(10);
  set(ref(db, `${ROOT}/groups/${active}/people/${id}/present`), !p.present);
}
on(main, 'click', '[data-toggle]', (e, el) => { if (!e.target.closest('[data-edit]')) toggle(el.dataset.toggle); });
on(main, 'keydown', '[data-toggle]', (e, el) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); toggle(el.dataset.toggle); } });

// ── Додавання ────────────────────────────────────────────────
async function addPerson({ name, age, phone }) {
  await set(push(ref(db, `${ROOT}/groups/${active}/people`)), { name, age, phone, present: false, createdAt: Date.now() });
}
const clean = v => String(v || '').trim().replace(/\s+/g, ' ');

on(main, 'submit', '#od-add', async (e, form) => {
  e.preventDefault();
  const f = form.elements;
  const name = clean(f.name.value);
  if (!name) { f.name.focus(); return; }
  await addPerson({ name, age: clean(f.age.value), phone: clean(f.phone.value) }).catch(() => toast('Не вдалося додати', 'error'));
  form.reset();
  f.name.focus();
});

function openPersonSheet(id = null) {
  const p = id ? data.groups[active].people[id] : null;
  let added = 0;
  const dlg = openDialog({
    title: p ? 'Учасник' : 'Новий учасник',
    subtitle: groupIds().length > 1 ? `Група: ${groupName(active)}` : '',
    width: 460,
    submitText: p ? 'Зберегти' : 'Додати',
    cancelText: p ? 'Скасувати' : 'Готово',
    extraFooter: p ? html`<button type="button" class="btn btn-ghost" data-action="del" style="color:var(--danger)">${icon('trash', 15)} Видалити</button>` : '',
    content: html`
      <label class="field"><span class="field-label">Ім'я та прізвище</span>
        <input class="input" name="pName" value="${p?.name || ''}" maxlength="80" autofocus enterkeyhint="next" autocomplete="off"></label>
      <div class="field-row od-sheet-row">
        <label class="field"><span class="field-label">Вік</span>
          <input class="input num" name="pAge" value="${p?.age || ''}" maxlength="3" inputmode="numeric" enterkeyhint="next"></label>
        <label class="field"><span class="field-label">Телефон</span>
          <input class="input num" name="pPhone" type="tel" value="${p?.phone || ''}" maxlength="20" enterkeyhint="done" placeholder="+380…"></label>
      </div>
      ${p ? '' : html`<p class="field-hint" data-added>Після «Додати» поля очищаються — можна одразу вводити наступного.</p>`}`,
    onOpen(form) {
      on(form, 'click', '[data-action="del"]', async () => {
        const snap = structuredClone(p);
        await remove(ref(db, `${ROOT}/groups/${active}/people/${id}`));
        dlg.close();
        const gid = active;
        toast(`«${p.name || 'Учасник'}» видалено`, 'info', { action: { label: 'Повернути', onClick: () => set(ref(db, `${ROOT}/groups/${gid}/people/${id}`), snap) } });
      });
    },
    async onSubmit(form) {
      const f = form.elements;
      const name = clean(f.pName.value);
      if (!name) return fieldError(f.pName);
      const rec = { name, age: clean(f.pAge.value), phone: clean(f.pPhone.value) };
      if (p) { await update(ref(db, `${ROOT}/groups/${active}/people/${id}`), rec); return; }
      await addPerson(rec);
      added++;
      form.reset();
      form.querySelector('[data-added]').textContent = `Додано ${added}: ${name}. Вводьте наступного або натисніть «Готово».`;
      f.pName.focus();
      return false; // лишаємо вікно відкритим для швидкого введення
    },
  });
}
document.getElementById('od-fab').addEventListener('click', () => openPersonSheet());
on(main, 'click', '[data-edit]', (_, el) => openPersonSheet(el.dataset.edit));

// ── Назва, пошук, групи ──────────────────────────────────────
titleInput.addEventListener('change', () => set(ref(db, `${ROOT}/title`), titleInput.value.trim()));
titleInput.addEventListener('keydown', e => { if (e.key === 'Enter') titleInput.blur(); });
document.getElementById('od-search').addEventListener('input', e => { q = e.target.value.trim(); renderList(); });
on(top, 'click', '[data-group]', (_, el) => { active = el.dataset.group; renderAll(); });
on(top, 'click', '[data-action="new-group"]', () => openGroupSheet());

function openGroupSheet(gid = null) {
  const g = gid ? data.groups[gid] : null;
  const first = !gid && groupIds().length === 1;
  openDialog({
    title: g ? 'Назва групи' : 'Нова група',
    subtitle: first ? 'Нинішні учасники залишаться в першій групі — її теж можна назвати' : '',
    width: 420,
    submitText: g ? 'Зберегти' : 'Створити',
    content: html`
      ${first ? html`<label class="field"><span class="field-label">Назва першої групи</span>
        <input class="input" name="firstName" value="${data.groups[active]?.name || ''}" placeholder="напр. Група 10:00" maxlength="40"></label>` : ''}
      <label class="field"><span class="field-label">${first ? 'Назва нової групи' : 'Назва'}</span>
        <input class="input" name="gName" value="${g?.name || ''}" placeholder="напр. Група 11:00" maxlength="40" autofocus></label>`,
    async onSubmit(form) {
      const name = clean(form.elements.gName.value);
      if (!name) return fieldError(form.elements.gName);
      if (g) { await update(ref(db, `${ROOT}/groups/${gid}`), { name }); return; }
      if (first && form.elements.firstName.value.trim()) await update(ref(db, `${ROOT}/groups/${active}`), { name: clean(form.elements.firstName.value) });
      const r = push(ref(db, `${ROOT}/groups`));
      await set(r, { name, createdAt: Date.now() });
      active = r.key;
    },
  });
}

// ── Дії та швидке очищення (з можливістю повернути) ──────────
function withUndo(message, fn) {
  const snapshot = structuredClone(data);
  return fn().then(() => toast(message, 'success', { action: { label: 'Повернути', onClick: () => set(ref(db, ROOT), snapshot).then(() => toast('Повернуто', 'success')) } }))
    .catch(() => toast('Не вдалося виконати дію', 'error'));
}

document.getElementById('od-menu').addEventListener('click', () => {
  const ids = groupIds();
  const multi = ids.length > 1;
  const gname = groupName(active);
  const all = ids.flatMap(peopleOf);
  const dlg = openDialog({
    title: 'Дії',
    width: 420,
    hideSubmit: true,
    cancelText: 'Закрити',
    content: html`
      <div class="action-list">
        <button type="button" data-do="new-group">${icon('plus', 18)}<span>Нова група</span></button>
        ${multi ? html`<button type="button" data-do="rename">${icon('pencil', 18)}<span>Перейменувати «${gname}»</span></button>` : ''}
        <button type="button" data-do="unmark" ${all.some(p => p.present) ? '' : 'disabled'}>${icon('undo', 18)}<span>Зняти всі відмітки «на місці»</span></button>
        <button type="button" data-do="clear-group" ${peopleOf(active).length ? '' : 'disabled'}>${icon('eraser', 18)}<span>Очистити ${multi ? `групу «${gname}»` : 'список учасників'}</span></button>
        ${multi ? html`<button type="button" data-do="del-group" class="danger">${icon('trash', 18)}<span>Видалити групу «${gname}»</span></button>` : ''}
        <button type="button" data-do="reset" class="danger">${icon('sparkles', 18)}<span>Новий захід — очистити все<small>Назву, групи й учасників</small></span></button>
        ${staff ? html`
          <hr>
          <button type="button" data-do="to-clients">${icon('users', 18)}<span>Перенести присутніх у клієнти<small>Для співробітників CRM</small></span></button>
          <a href="./">${icon('calendar', 18)}<span>Відкрити CRM</span></a>` : ''}
      </div>`,
    onOpen(form) {
      on(form, 'click', '[data-do]', async (_, b) => {
        const act = b.dataset.do;
        if (act === 'to-clients') { await moveToClients(b); dlg.close(); return; }
        dlg.close();
        if (act === 'new-group') openGroupSheet();
        else if (act === 'rename') openGroupSheet(active);
        else if (act === 'unmark') {
          const u = {};
          ids.forEach(gid => peopleOf(gid).forEach(p => { if (p.present) u[`${ROOT}/groups/${gid}/people/${p.id}/present`] = false; }));
          withUndo('Відмітки знято', () => update(ref(db), u));
        } else if (act === 'clear-group') withUndo(`Список «${gname}» очищено`, () => remove(ref(db, `${ROOT}/groups/${active}/people`)));
        else if (act === 'del-group') withUndo(`Групу «${gname}» видалено`, () => remove(ref(db, `${ROOT}/groups/${active}`)));
        else if (act === 'reset') {
          const gid = push(ref(db, `${ROOT}/groups`)).key;
          q = ''; document.getElementById('od-search').value = '';
          withUndo('Усе очищено — можна починати новий захід', () => set(ref(db, ROOT), { title: '', groups: { [gid]: { name: '', createdAt: Date.now() } } }));
        }
      });
    },
  });
});

// Присутні з телефоном → картки клієнтів (+ нотатка про захід). Лише для співробітників.
async function moveToClients(btn) {
  const todo = groupIds().flatMap(gid => peopleOf(gid).map(p => ({ ...p, gid }))).filter(p => p.present && phoneKey(p.phone) && !p.clientKey);
  if (!todo.length) { toast('Немає присутніх з телефоном, яких ще не перенесено', 'info'); return; }
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
  }).catch(() => toast('Не вдалося перенести — потрібен вхід у CRM', 'error'));
}

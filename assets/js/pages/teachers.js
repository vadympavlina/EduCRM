// ============================================================
//  Вчителі та ставки
//  Об'єднує колишні сторінки «Вчителі» і «Ціноутворення».
//  Вчителі не видаляються, а архівуються — історія занять
//  і виплат лишається з правильними іменами.
// ============================================================

import { db, ref, onValue, push, set, update } from '../core/firebase.js';
import { html, render, on, busy, initials } from '../core/dom.js';
import { money } from '../core/format.js';
import { pageReady } from '../ui/loader.js';
import { initShell } from '../ui/shell.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { openDialog, confirmDialog, fieldError } from '../ui/dialog.js';
import {
  TEACHER_COLORS, teacherColor, normalizePricing, byName,
} from '../data/teachers.js';

const page = document.getElementById('page');

let teachers = null;          // { id: { name, color, archived } }
let pricing  = null;          // { default, overrides }
let showArchived = false;
let ratesDirty = false;

await initShell({
  page: 'teachers',
  title: 'Вчителі та ставки',
  subtitle: 'Хто веде заняття і скільки за це отримує',
  actions: html`<button class="btn btn-primary" data-action="add">${icon('plus', 16)} Додати вчителя</button>`,
});

onValue(ref(db, 'people'), snap => { teachers = snap.val() || {}; renderAll(); });
onValue(ref(db, 'pricing/config'), snap => { pricing = normalizePricing(snap.val()); renderAll(); });

// ── РЕНДЕР ───────────────────────────────────────────────────
function renderAll() {
  if (!teachers || !pricing) return;
  pageReady();
  if (!page.querySelector('#rates-card')) {
    render(page, html`
      <section class="card" id="rates-card"></section>
      <section class="card" id="teachers-card"></section>`);
    renderRates();
  } else if (!ratesDirty) {
    fillRates();
  }
  renderTeachers();
}

function renderRates() {
  render(document.getElementById('rates-card'), html`
    <div class="card-head">
      <div>
        <h2>Стандартні ставки</h2>
        <p>Діють для всіх вчителів, яким не задано індивідуальні</p>
      </div>
    </div>
    <form class="card-body rates-grid" id="rates-form" novalidate>
      <label class="field">
        <span class="field-label">За проведене заняття</span>
        <span class="input-group"><span class="input-prefix">₴</span>
          <input class="input num" type="number" min="0" step="1" name="baseReward" required></span>
      </label>
      <label class="field">
        <span class="field-label">Бонус за новий договір</span>
        <span class="input-group"><span class="input-prefix">₴</span>
          <input class="input num" type="number" min="0" step="1" name="contractBonus" required></span>
      </label>
      <div><button class="btn btn-primary" type="submit" disabled>Зберегти</button></div>
    </form>`);
  fillRates();

  const form = document.getElementById('rates-form');
  form.addEventListener('input', () => {
    ratesDirty = true;
    form.querySelector('[type="submit"]').disabled = false;
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const base  = readRate(form.baseReward);
    const bonus = readRate(form.contractBonus);
    if (base == null) return fieldError(form.baseReward);
    if (bonus == null) return fieldError(form.contractBonus);
    const btn = form.querySelector('[type="submit"]');
    busy(btn, async () => {
      try {
        await set(ref(db, 'pricing/config/default'), { baseReward: base, contractBonus: bonus });
        ratesDirty = false;
        btn.disabled = true;
        toast('Стандартні ставки збережено', 'success');
      } catch (err) {
        console.error(err);
        toast('Не вдалося зберегти ставки', 'error');
      }
    });
  });
}

function fillRates() {
  const form = document.getElementById('rates-form');
  if (!form) return;
  form.baseReward.value    = pricing.default.baseReward;
  form.contractBonus.value = pricing.default.contractBonus;
  form.querySelector('[type="submit"]').disabled = true;
}

function renderTeachers() {
  const all = Object.entries(teachers).map(([id, t]) => ({ id, ...t }));
  const active = all.filter(t => !t.archived).sort(byName);
  const archived = all.filter(t => t.archived).sort(byName);
  const rows = showArchived ? [...active, ...archived] : active;

  render(document.getElementById('teachers-card'), html`
    <div class="card-head">
      <h2>Вчителі</h2>
      <span class="badge num">${active.length}</span>
      <span class="spacer"></span>
      ${archived.length ? html`
        <button class="btn btn-ghost btn-sm" data-action="toggle-archived" aria-pressed="${String(showArchived)}">
          ${icon('archive', 15)} ${showArchived ? 'Сховати архів' : `Архів · ${archived.length}`}
        </button>` : ''}
    </div>
    ${rows.length ? html`
      <div class="table-wrap">
        <table class="table">
          <thead><tr>
            <th>Вчитель</th>
            <th class="col-num">За заняття</th>
            <th class="col-num">За договір</th>
            <th>Ставки</th>
            <th class="col-actions"><span class="sr-only">Дії</span></th>
          </tr></thead>
          <tbody>${rows.map(teacherRow)}</tbody>
        </table>
      </div>` : html`
      <div class="empty">
        <div class="empty-icon">${icon('graduation-cap', 24)}</div>
        <h3>Ще немає вчителів</h3>
        <p>Додайте першого — і його можна буде призначати на заняття.</p>
        <button class="btn btn-primary" data-action="add" style="margin-top:8px">${icon('plus', 16)} Додати вчителя</button>
      </div>`}`);
}

function teacherRow(t) {
  const own = pricing.overrides[t.id];
  const rates = own || pricing.default;
  return html`
    <tr class="${t.archived ? 'archived-row' : ''}">
      <td>
        <div class="teacher-cell">
          <span class="avatar" style="--av:${teacherColor(teachers, t.id)}">${initials(t.name)}</span>
          <span class="teacher-name">${t.name || 'Без імені'}</span>
          ${t.archived ? html`<span class="badge">В архіві</span>` : ''}
        </div>
      </td>
      <td class="col-num">${money(rates.baseReward)}</td>
      <td class="col-num">${money(rates.contractBonus)}</td>
      <td>${own ? html`<span class="badge badge-brand">Індивідуальні</span>` : html`<span class="muted">Стандартні</span>`}</td>
      <td class="col-actions">
        <div class="row-actions">
          ${t.archived ? html`
            <button class="icon-btn" data-action="restore" data-id="${t.id}" title="Відновити з архіву" aria-label="Відновити">${icon('archive-restore', 16)}</button>` : html`
            <button class="icon-btn" data-action="edit" data-id="${t.id}" title="Редагувати" aria-label="Редагувати">${icon('pencil', 16)}</button>
            <button class="icon-btn danger" data-action="archive" data-id="${t.id}" title="Архівувати" aria-label="Архівувати">${icon('archive', 16)}</button>`}
        </div>
      </td>
    </tr>`;
}

// ── ДІЇ ──────────────────────────────────────────────────────
on(document, 'click', '[data-action]', (e, el) => {
  const { action, id } = el.dataset;
  if (action === 'add') openTeacherDialog();
  else if (action === 'edit') openTeacherDialog(id);
  else if (action === 'archive') archiveTeacher(id);
  else if (action === 'restore') restoreTeacher(id);
  else if (action === 'toggle-archived') { showArchived = !showArchived; renderTeachers(); }
});

function openTeacherDialog(id = null) {
  if (!teachers || !pricing) return;
  const t = id ? teachers[id] : null;
  const own = id ? pricing.overrides[id] : null;
  const color = id ? teacherColor(teachers, id) : nextFreeColor();
  const rates = own || pricing.default;

  openDialog({
    title: t ? 'Редагувати вчителя' : 'Новий вчитель',
    submitText: t ? 'Зберегти' : 'Додати',
    content: html`
      <label class="field">
        <span class="field-label">Ім'я та прізвище</span>
        <input class="input" name="teacherName" maxlength="80" autocomplete="off" value="${t?.name || ''}" autofocus>
      </label>
      <div class="field">
        <span class="field-label">Колір у календарі</span>
        <div class="swatches">
          ${TEACHER_COLORS.map(c => html`
            <label title="${c}"><input type="radio" name="color" value="${c}" ${c === color ? 'checked' : ''}><span style="--sw:${c}"></span></label>`)}
        </div>
      </div>
      <div class="field">
        <span class="field-label">Ставки</span>
        <div class="segmented">
          <label><input type="radio" name="mode" value="default" ${own ? '' : 'checked'}><span>Стандартні</span></label>
          <label><input type="radio" name="mode" value="custom" ${own ? 'checked' : ''}><span>Індивідуальні</span></label>
        </div>
        <span class="field-hint" data-hint>
          ${money(pricing.default.baseReward)} за заняття · ${money(pricing.default.contractBonus)} за договір
        </span>
        <div class="rates-fieldset" data-custom ${own ? '' : 'hidden'}>
          <div class="field-row">
            <label class="field">
              <span class="field-label">За заняття</span>
              <span class="input-group"><span class="input-prefix">₴</span>
                <input class="input num" type="number" min="0" step="1" name="baseReward" value="${rates.baseReward}"></span>
            </label>
            <label class="field">
              <span class="field-label">За договір</span>
              <span class="input-group"><span class="input-prefix">₴</span>
                <input class="input num" type="number" min="0" step="1" name="contractBonus" value="${rates.contractBonus}"></span>
            </label>
          </div>
        </div>
      </div>`,
    onOpen(form) {
      const sync = () => {
        const custom = form.mode.value === 'custom';
        form.querySelector('[data-custom]').hidden = !custom;
        form.querySelector('[data-hint]').hidden = custom;
      };
      form.addEventListener('change', e => { if (e.target.name === 'mode') sync(); });
      sync();
    },
    async onSubmit(form) {
      const name = form.teacherName.value.trim().replace(/\s+/g, ' ');
      if (!name) return fieldError(form.teacherName);
      const duplicate = Object.entries(teachers).some(([tid, x]) =>
        tid !== id && !x.archived && (x.name || '').toLowerCase() === name.toLowerCase());
      if (duplicate) { toast('Вчитель з таким іменем уже є', 'warning'); return fieldError(form.teacherName); }

      const custom = form.mode.value === 'custom';
      let override = null;
      if (custom) {
        const base = readRate(form.baseReward);
        const bonus = readRate(form.contractBonus);
        if (base == null) return fieldError(form.baseReward);
        if (bonus == null) return fieldError(form.contractBonus);
        override = { baseReward: base, contractBonus: bonus };
      }

      const tid = id || push(ref(db, 'people')).key;
      await update(ref(db), {
        [`people/${tid}/name`]: name,
        [`people/${tid}/color`]: form.color.value,
        [`pricing/config/overrides/${tid}`]: override,
      });
      toast(id ? 'Зміни збережено' : `${name} — додано`, 'success');
    },
  });
}

async function archiveTeacher(id) {
  const t = teachers[id];
  const ok = await confirmDialog({
    title: `Архівувати «${t.name}»?`,
    message: 'Вчитель зникне зі списків вибору, але вся історія занять, договорів і виплат збережеться. Відновити можна будь-коли.',
    confirmText: 'Архівувати',
    danger: true,
  });
  if (!ok) return;
  await update(ref(db, 'people/' + id), { archived: true, archivedAt: Date.now() })
    .then(() => toast(`${t.name} — в архіві`, 'success'))
    .catch(() => toast('Не вдалося архівувати', 'error'));
}

async function restoreTeacher(id) {
  await update(ref(db, 'people/' + id), { archived: null, archivedAt: null })
    .then(() => toast(`${teachers[id].name} — відновлено`, 'success'))
    .catch(() => toast('Не вдалося відновити', 'error'));
}

// ── ДОПОМІЖНЕ ────────────────────────────────────────────────
function readRate(input) {
  const v = input.value.trim();
  if (v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 100000 ? n : null;
}

/** Перший колір палітри, який ще не зайнятий активними вчителями. */
function nextFreeColor() {
  const used = new Set(Object.keys(teachers).filter(id => !teachers[id].archived).map(id => teacherColor(teachers, id)));
  return TEACHER_COLORS.find(c => !used.has(c)) || TEACHER_COLORS[Object.keys(teachers).length % TEACHER_COLORS.length];
}

// ============================================================
//  Теги — мітки для клієнтів (Python, VIP, Передзвонити…)
//  tags/{id} = { name, color };  clients/{key}/tags = [id, …]
// ============================================================

import { db, ref, onValue, push, set, update } from '../core/firebase.js';
import { html, render, on } from '../core/dom.js';
import { plural } from '../core/format.js';
import { initShell } from '../ui/shell.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { openDialog, confirmDialog, fieldError } from '../ui/dialog.js';

const COLORS = ['#4f6ef7', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#dc2626', '#65a30d', '#9333ea', '#0ea5e9', '#f59e0b', '#10b981'];
const page = document.getElementById('page');
let tags = null, clients = {};

const shellReady = initShell({
  page: 'tags', title: 'Теги', subtitle: 'Мітки для клієнтів — фільтруйте за ними список клієнтів',
  actions: html`<button class="btn btn-primary" data-action="new">${icon('plus', 16)} Новий тег</button>`,
});
render(page, html`<section class="card" id="list"><div class="page-loader"><div class="spinner"></div></div></section>`);

await shellReady;
onValue(ref(db, 'tags'), s => { tags = s.val() || {}; renderList(); });
onValue(ref(db, 'clients'), s => { clients = s.val() || {}; renderList(); });

const usage = id => Object.values(clients).filter(c => (c?.tags || []).includes(id)).length;

function renderList() {
  if (!tags) return;
  const list = Object.entries(tags).map(([id, t]) => ({ id, ...t, n: usage(id) })).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'uk'));
  const box = document.getElementById('list');
  if (!list.length) {
    render(box, html`<div class="empty"><div class="empty-icon">${icon('tag', 24)}</div><h3>Тегів ще немає</h3>
      <p>Створіть, наприклад, «Python», «VIP» чи «Передзвонити».</p>
      <button class="btn btn-primary" data-action="new" style="margin-top:8px">${icon('plus', 16)} Новий тег</button></div>`);
    return;
  }
  render(box, html`
    <div class="table-wrap" style="border-radius:var(--r-lg)">
      <table class="table">
        <thead><tr><th>Тег</th><th>Клієнтів</th><th class="col-actions"></th></tr></thead>
        <tbody>${list.map(t => html`
          <tr>
            <td><span class="tag" style="--t:${t.color || '#4f6ef7'}">${t.name}</span></td>
            <td>${t.n ? html`<a href="clients" class="muted">${t.n} ${plural(t.n, 'клієнт', 'клієнти', 'клієнтів')}</a>` : html`<span class="muted">—</span>`}</td>
            <td class="col-actions"><div class="row-actions">
              <button class="icon-btn" data-edit="${t.id}" title="Редагувати" aria-label="Редагувати">${icon('pencil', 16)}</button>
              <button class="icon-btn danger" data-del="${t.id}" title="Видалити" aria-label="Видалити">${icon('trash', 16)}</button>
            </div></td>
          </tr>`)}</tbody>
      </table>
    </div>`);
}

function openTagDialog(id = null) {
  const t = id ? tags[id] : null;
  const used = new Set(Object.values(tags || {}).map(x => x.color));
  const color = t?.color || COLORS.find(c => !used.has(c)) || COLORS[0];
  openDialog({
    title: t ? 'Редагувати тег' : 'Новий тег',
    width: 440,
    submitText: t ? 'Зберегти' : 'Створити',
    content: html`
      <label class="field"><span class="field-label">Назва</span>
        <input class="input" name="tName" maxlength="30" value="${t?.name || ''}" placeholder="напр. VIP" autofocus></label>
      <div class="field"><span class="field-label">Колір</span>
        <div class="swatches">${COLORS.map(c => html`<label title="${c}"><input type="radio" name="tColor" value="${c}" ${c === color ? 'checked' : ''}><span style="--sw:${c}"></span></label>`)}</div>
      </div>
      <div class="field"><span class="field-label">Вигляд</span><div><span class="tag" data-preview style="--t:${color}">${t?.name || 'Новий тег'}</span></div></div>`,
    onOpen(form) {
      const prev = form.querySelector('[data-preview]');
      form.addEventListener('input', () => {
        prev.textContent = form.elements.tName.value.trim() || 'Новий тег';
        prev.style.setProperty('--t', form.elements.tColor.value);
      });
    },
    async onSubmit(form) {
      const name = form.elements.tName.value.trim();
      if (!name) return fieldError(form.elements.tName);
      const dup = Object.entries(tags).some(([tid, x]) => tid !== id && (x.name || '').toLowerCase() === name.toLowerCase());
      if (dup) { toast('Такий тег уже є', 'warning'); return fieldError(form.elements.tName); }
      const data = { name, color: form.elements.tColor.value };
      if (id) await update(ref(db, 'tags/' + id), data); else await set(push(ref(db, 'tags')), data);
      toast(id ? 'Тег оновлено' : 'Тег створено', 'success');
    },
  });
}

on(document, 'click', '[data-action="new"]', () => openTagDialog());
on(page, 'click', '[data-edit]', (_, el) => openTagDialog(el.dataset.edit));
on(page, 'click', '[data-del]', async (_, el) => {
  const id = el.dataset.del;
  const n = usage(id);
  const ok = await confirmDialog({
    title: `Видалити тег «${tags[id]?.name}»?`,
    message: n ? `Тег зникне в ${n} ${plural(n, 'клієнта', 'клієнтів', 'клієнтів')}.` : 'Тег ніде не використовується.',
    confirmText: 'Видалити', danger: true,
  });
  if (!ok) return;
  // прибираємо тег у клієнтів і сам тег — одним записом
  const updates = { ['tags/' + id]: null };
  Object.entries(clients).forEach(([key, c]) => { if ((c?.tags || []).includes(id)) updates[`clients/${key}/tags`] = c.tags.filter(x => x !== id); });
  await update(ref(db), updates).then(() => toast('Тег видалено', 'success')).catch(() => toast('Не вдалося видалити', 'error'));
});

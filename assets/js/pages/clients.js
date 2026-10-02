// ============================================================
//  Клієнти — список з пошуком, тегами і сортуванням
// ============================================================

import { db, ref, get, set, onValue } from '../core/firebase.js';
import { html, render, on, initials } from '../core/dom.js';
import { fmtDate, plural, isoDate } from '../core/format.js';
import { initShell } from '../ui/shell.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { openDialog, fieldError } from '../ui/dialog.js';
import { enhanceSelects } from '../ui/select.js';
import { phoneKey, resolveClientKey, ensurePhoneKeys } from '../data/clients.js';

const PAGE = 60;
const page = document.getElementById('page');
let clients = null;   // key -> client
let tags = {};
let stats = null;     // phoneKey -> { total, done, last }
let q = '', tag = '', sort = 'recent', shown = PAGE;

const shellReady = initShell({
  page: 'clients',
  title: 'Клієнти',
  subtitle: 'Усі, хто записувався на заняття',
  actions: html`
    <div class="search">
      ${icon('search', 16)}
      <input class="input" id="client-search" type="search" placeholder="Ім'я або телефон" autocomplete="off" aria-label="Пошук клієнта">
      <kbd>/</kbd>
    </div>
    <button class="btn btn-primary" data-action="new-client">${icon('plus', 16)} Клієнт</button>`,
});

render(page, html`
  <div class="card filters">
    <div id="tag-filter"></div>
    <div id="sort-filter"></div>
    <span class="spacer"></span>
    <span class="summary" id="summary"></span>
  </div>
  <section class="card" id="list"><div class="page-loader"><div class="spinner"></div></div></section>`);

await shellReady;

// Один раз дописуємо phoneKey старим записам; заодно отримуємо всі заняття для лічильників
const migrated = await ensurePhoneKeys().catch(err => { console.error(err); return null; });
const evSnap = migrated?.events || await get(ref(db, 'events'));
stats = {};
const todayIso = isoDate(new Date());
evSnap.forEach(c => {
  const e = c.val();
  const k = e?.phoneKey || phoneKey(e?.phone);
  if (!k || e.isGroupMirror && !e.clientName) return;
  const s = (stats[k] ||= { total: 0, done: 0, last: '', next: '' });
  s.total++;
  if (e.status === 'completed') s.done++;
  if (!e.date || e.status === 'cancelled') return;
  if (e.date <= todayIso) { if (e.date > s.last) s.last = e.date; }
  else if (!s.next || e.date < s.next) s.next = e.date;
});

onValue(ref(db, 'tags'), s => { tags = s.val() || {}; renderFilters(); renderList(); });
onValue(ref(db, 'clients'), s => { clients = s.val() || {}; renderList(); });

// ── Фільтри ──────────────────────────────────────────────────
function renderFilters() {
  render(document.getElementById('tag-filter'), html`
    <select class="select" aria-label="Тег">
      <option value="">Усі теги</option>
      ${Object.entries(tags).map(([id, t]) => html`<option value="${id}" data-color="${t.color || '#4f6ef7'}" ${id === tag ? 'selected' : ''}>${t.name}</option>`)}
    </select>`);
  render(document.getElementById('sort-filter'), html`
    <select class="select" aria-label="Сортування">
      ${[['recent', 'Активні спочатку'], ['name', 'За іменем'], ['new', 'Нові спочатку'], ['count', 'Найбільше занять']]
        .map(([v, l]) => html`<option value="${v}" ${v === sort ? 'selected' : ''}>${l}</option>`)}
    </select>`);
  enhanceSelects(page.querySelector('.filters'));
  page.querySelector('#tag-filter select').addEventListener('change', e => { tag = e.target.value; shown = PAGE; renderList(); });
  page.querySelector('#sort-filter select').addEventListener('change', e => { sort = e.target.value; shown = PAGE; renderList(); });
}

// ── Список ───────────────────────────────────────────────────
function rows() {
  const byKey = {};
  Object.entries(clients).forEach(([key, c]) => { const k = c?.phoneKey || phoneKey(c?.phone || key); if (k) (byKey[k] ||= []).push(key); });
  const qd = q.replace(/\D/g, '');
  const ql = q.toLowerCase();
  let list = Object.entries(clients).map(([key, c]) => {
    const k = c?.phoneKey || phoneKey(c?.phone || key);
    const s = stats?.[k] || { total: 0, done: 0, last: '', next: '' };
    return { key, ...c, k, s, contracts: Object.keys(c?.contracts || {}).length, dup: (byKey[k] || []).length > 1,
      activity: Math.max(s.next ? Date.parse(s.next + 'T12:00') : 0, s.last ? Date.parse(s.last + 'T12:00') : 0, c?.createdAt || 0) };
  });
  if (q) list = list.filter(c => (c.name || '').toLowerCase().includes(ql) || (qd.length >= 3 && (String(c.phone || c.key).replace(/\D/g, '').includes(qd) || (c.k || '').includes(qd.slice(-9)))));
  if (tag) list = list.filter(c => (c.tags || []).includes(tag));
  const by = {
    recent: (a, b) => b.activity - a.activity,
    name: (a, b) => (a.name || '￿').localeCompare(b.name || '￿', 'uk'),
    new: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    count: (a, b) => b.s.total - a.s.total,
  }[sort];
  return list.sort(by);
}

function renderList() {
  if (!clients || !stats) return;
  const list = rows();
  document.getElementById('summary').textContent = `${list.length} ${plural(list.length, 'клієнт', 'клієнти', 'клієнтів')}`;
  const box = document.getElementById('list');
  if (!list.length) {
    render(box, html`<div class="empty"><div class="empty-icon">${icon('users', 24)}</div>
      <h3>${q || tag ? 'Нікого не знайдено' : 'Клієнтів ще немає'}</h3>
      <p>${q || tag ? 'Спробуйте інший запит або тег.' : 'Картки створюються автоматично під час запису на заняття.'}</p></div>`);
    return;
  }
  render(box, html`
    <div class="table-wrap" style="border-radius:var(--r-lg)">
      <table class="table">
        <thead><tr><th>Клієнт</th><th>Теги</th><th class="col-num">Занять</th><th>Заняття</th><th>Договір</th><th class="col-actions"></th></tr></thead>
        <tbody>${list.slice(0, shown).map(c => html`
          <tr class="clickable" data-go="${c.key}">
            <td>
              <div class="teacher-cell">
                <span class="avatar">${initials(c.name || c.key.slice(-2))}</span>
                <div>
                  <span class="row-title">${c.name || html`<span class="muted">Без імені</span>`}</span>
                  <span class="row-sub">${c.phone || c.key}${c.dup ? html` · <span class="badge badge-warning" title="Є інша картка з цим самим номером в іншому форматі">дубль</span>` : ''}</span>
                </div>
              </div>
            </td>
            <td><span class="tag-list">${(c.tags || []).filter(id => tags[id]).map(id => html`<span class="tag" style="--t:${tags[id].color || '#4f6ef7'}">${tags[id].name}</span>`)}</span></td>
            <td class="col-num">${c.s.total ? html`<b>${c.s.total}</b> <span class="muted">· ${c.s.done} пров.</span>` : html`<span class="muted">—</span>`}</td>
            <td>
              ${c.s.next ? html`<span class="badge badge-info">наступне ${fmtDate(c.s.next + 'T12:00')}</span>` : ''}
              ${c.s.last ? html`<span class="row-sub">останнє ${fmtDate(c.s.last + 'T12:00')}</span>` : c.s.next ? '' : html`<span class="muted">—</span>`}
            </td>
            <td>${c.contracts ? html`<span class="badge badge-success">${icon('check', 12)} ${c.contracts}</span>` : ''}</td>
            <td class="col-actions muted">${icon('chevron-right', 16)}</td>
          </tr>`)}</tbody>
      </table>
    </div>
    ${list.length > shown ? html`<div style="padding:12px;text-align:center"><button class="btn" data-action="more">Показати ще ${Math.min(PAGE, list.length - shown)} з ${list.length - shown}</button></div>` : ''}`);
}

// ── Дії ──────────────────────────────────────────────────────
const search = document.getElementById('client-search');
let t = 0;
search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { q = search.value.trim(); shown = PAGE; renderList(); }, 120); });
document.addEventListener('keydown', e => {
  if (e.key === '/' && !e.target.closest('input, textarea, select') && !document.querySelector('dialog[open]')) { e.preventDefault(); search.focus(); }
});
on(page, 'click', '[data-go]', (_, el) => { location.href = 'client?id=' + encodeURIComponent(el.dataset.go); });
on(page, 'click', '[data-action="more"]', () => { shown += PAGE; renderList(); });
on(document, 'click', '[data-action="new-client"]', () => openDialog({
  title: 'Новий клієнт',
  width: 440,
  submitText: 'Створити',
  content: html`
    <label class="field"><span class="field-label">Ім'я</span><input class="input" name="cName" maxlength="80" autofocus></label>
    <label class="field"><span class="field-label">Телефон</span><input class="input num" name="cPhone" type="tel" maxlength="20" placeholder="+380 XX XXX XX XX"></label>`,
  async onSubmit(form) {
    const f = form.elements;
    const name = f.cName.value.trim(), phone = f.cPhone.value.trim();
    if (!name) return fieldError(f.cName);
    if (!phoneKey(phone)) { toast('Вкажіть коректний номер', 'warning'); return fieldError(f.cPhone); }
    const key = await resolveClientKey(phone);
    if (clients[key]) { toast('Такий клієнт уже є — відкриваю картку', 'info'); location.href = 'client?id=' + encodeURIComponent(key); return; }
    await set(ref(db, 'clients/' + key), { name, phone, phoneKey: phoneKey(phone), createdAt: Date.now() });
    location.href = 'client?id=' + encodeURIComponent(key);
  },
}));

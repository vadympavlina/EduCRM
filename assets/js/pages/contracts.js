// ============================================================
//  Договори — усі договори за місяць підписання
// ============================================================

import { db, ref, onValue } from '../core/firebase.js';
import { html, render, on } from '../core/dom.js';
import { money, plural } from '../core/format.js';
import { pageReady } from '../ui/loader.js';
import { initShell } from '../ui/shell.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/dialog.js';
import { enhanceSelects } from '../ui/select.js';
import { monthPicker, currentMonth, monthTitle } from '../ui/month-picker.js';
import { teacherColor, normalizePricing, ratesFor } from '../data/teachers.js';
import { contractsFromClients, localMonth } from '../data/payroll.js';
import { deleteContract } from '../data/clients.js';
import { teacherOptions, teacherName, store } from '../calendar/store.js';

const page = document.getElementById('page');
let month = currentMonth(), teacher = '', kind = '', q = '';
let contracts = null, pricing = normalizePricing(null);

const shellReady = initShell({
  page: 'contracts', title: 'Договори', subtitle: 'Оформлені договори за місяцем підписання',
  actions: html`<div class="search">${icon('search', 16)}<input class="input" id="c-search" type="search" placeholder="Клієнт або назва" autocomplete="off" aria-label="Пошук договору"></div>`,
});

render(page, html`
  <div class="card filters">
    <div id="month"></div>
    <div id="teacher-filter"></div>
    <div class="segmented" id="kind">
      ${[['', 'Усі'], ['new', 'Нові'], ['had', 'Вже мали']].map(([v, l]) => html`<label><input type="radio" name="kind" value="${v}" ${v === kind ? 'checked' : ''}><span>${l}</span></label>`)}
    </div>
    <span class="spacer"></span>
    <span class="summary" id="summary"></span>
  </div>
  <section class="card" id="list"><div class="page-loader"><div class="spinner"></div></div></section>`);

monthPicker(document.getElementById('month'), { value: month, onChange: v => { month = v; renderList(); } });

await shellReady;
onValue(ref(db, 'people'), s => { store.teachers = s.val() || {}; renderFilter(); renderList(); });
onValue(ref(db, 'pricing/config'), s => { pricing = normalizePricing(s.val()); renderList(); });
onValue(ref(db, 'clients'), s => { contracts = contractsFromClients(s.val() || {}); renderList(); });

function renderFilter() {
  const box = document.getElementById('teacher-filter');
  render(box, html`
    <select class="select" aria-label="Вчитель">
      <option value="">Усі вчителі</option>
      ${teacherOptions(teacher).map(t => html`<option value="${t.id}" data-color="${teacherColor(store.teachers, t.id)}" ${t.id === teacher ? 'selected' : ''}>${t.name}</option>`)}
    </select>`);
  enhanceSelects(box);
  box.querySelector('select').addEventListener('change', e => { teacher = e.target.value; renderList(); });
}

function renderList() {
  if (!contracts) return;
  pageReady();
  const ql = q.toLowerCase();
  const list = contracts
    .filter(c => c.signedAt && localMonth(c.signedAt) === month)
    .filter(c => !teacher || c.teacherId === teacher)
    .filter(c => !kind || (kind === 'had' ? c.alreadyHad : !c.alreadyHad))
    .filter(c => !ql || [c.clientName, c.clientCardName, c.title, c.phone, c.eventTitle].some(v => String(v || '').toLowerCase().includes(ql)))
    .sort((a, b) => b.signedAt - a.signedAt);
  const fresh = list.filter(c => !c.alreadyHad && c.teacherId);
  const bonus = fresh.reduce((s, c) => s + ratesFor(pricing, c.teacherId).contractBonus, 0);
  render(document.getElementById('summary'), list.length ? html`<b>${list.length}</b> ${plural(list.length, 'договір', 'договори', 'договорів')} · нових <b>${fresh.length}</b> · бонусів <b>${money(bonus)}</b>` : '');

  const box = document.getElementById('list');
  if (!list.length) {
    render(box, html`<div class="empty"><div class="empty-icon">${icon('file-text', 24)}</div><h3>Договорів немає</h3>
      <p>За ${monthTitle(month).toLowerCase()} нічого не знайдено${teacher || kind || q ? ' з такими фільтрами' : ''}.</p></div>`);
    return;
  }
  render(box, html`
    <div class="table-wrap" style="border-radius:var(--r-lg)">
      <table class="table">
        <thead><tr><th>Дата</th><th>Клієнт</th><th>Договір</th><th>Вчитель</th><th>Тип</th><th class="col-num">Бонус</th><th>Оформив</th><th class="col-actions"></th></tr></thead>
        <tbody>${list.map(c => html`
          <tr>
            <td class="col-time">${new Date(c.signedAt).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}
              <span class="row-sub">${new Date(c.signedAt).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}</span></td>
            <td><a class="row-title" href="client?id=${encodeURIComponent(c.phone)}">${c.clientName || c.clientCardName || 'Без імені'}</a><span class="row-sub">${c.phone}</span></td>
            <td><span class="row-title" style="font-weight:500">${c.title || 'Договір'}</span><span class="row-sub">${c.eventTitle ? `до заняття «${c.eventTitle}»` : c.eventId ? 'до заняття' : 'без прив\'язки до заняття'}</span></td>
            <td>${c.teacherId ? html`<span class="teacher-tag"><span class="dot" style="--dot:${teacherColor(store.teachers, c.teacherId)}"></span>${teacherName(c.teacherId) || 'Невідомо'}</span>` : html`<span class="muted">—</span>`}</td>
            <td>${c.alreadyHad ? html`<span class="badge">Вже мав</span>` : html`<span class="badge badge-success">Новий</span>`}</td>
            <td class="col-num">${c.alreadyHad || !c.teacherId ? html`<span class="muted">—</span>` : money(ratesFor(pricing, c.teacherId).contractBonus)}</td>
            <td class="muted">${c.signedBy || '—'}</td>
            <td class="col-actions"><div class="row-actions">
              <button class="icon-btn danger" data-del="${c.phone}/${c.id}" title="Видалити" aria-label="Видалити">${icon('trash', 16)}</button>
            </div></td>
          </tr>`)}</tbody>
      </table>
    </div>`);
}

const search = document.getElementById('c-search');
let t = 0;
search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { q = search.value.trim(); renderList(); }, 120); });
on(page, 'change', '#kind input', (_, el) => { kind = el.value; renderList(); });
on(page, 'click', '[data-del]', async (_, el) => {
  const [phone, id] = el.dataset.del.split('/');
  const c = contracts.find(x => x.phone === phone && x.id === id);
  const ok = await confirmDialog({ title: 'Видалити договір?', message: `«${c?.title || 'Договір'}» — ${c?.clientName || c?.clientCardName || phone}. Бонус вчителю буде знято зі статистики.`, confirmText: 'Видалити', danger: true });
  if (!ok) return;
  await deleteContract(phone, id).then(() => toast('Договір видалено', 'success')).catch(() => toast('Не вдалося видалити', 'error'));
});

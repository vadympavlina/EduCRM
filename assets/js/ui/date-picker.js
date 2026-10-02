// ============================================================
//  ui/date-picker.js — власні поля дати і часу замість системних
//
//  enhanceDates(root):  <input type="date" class="input"> → кнопка + календар.
//    Поле стає type="hidden" і далі зберігає значення "2026-10-02",
//    тож form.elements.x.value і події input/change працюють як раніше.
//    data-optional — у календарі з'являється «Очистити».
//  upgradeTimes(root):  <input type="time" class="input"> → <select class="select">
//    з кроком 15 хв (оформлення дає ui/select.js).
// ============================================================

import { html, render } from '../core/dom.js';
import { icon } from './icons.js';

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];

export const fmtField = v => v
  ? new Date(v + 'T12:00').toLocaleDateString('uk-UA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  : '';

// ── Час ──────────────────────────────────────────────────────
export function timeOptions(selected = '', { from = 7, to = 22, step = 15 } = {}) {
  const list = [];
  for (let m = from * 60; m <= to * 60 + 45; m += step) list.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  if (selected && !list.includes(selected)) { list.push(selected); list.sort(); }
  return list;
}

export function upgradeTimes(root = document) {
  root.querySelectorAll('input[type="time"].input').forEach(input => {
    const sel = document.createElement('select');
    sel.className = 'select';
    sel.name = input.name;
    if (input.id) sel.id = input.id;
    const value = input.value;
    sel.innerHTML = (value ? '' : '<option value="" data-placeholder>--:--</option>')
      + timeOptions(value).map(t => `<option value="${t}"${t === value ? ' selected' : ''}>${t}</option>`).join('');
    input.replaceWith(sel);
  });
}

// ── Дата ─────────────────────────────────────────────────────
export function enhanceDates(root = document) {
  root.querySelectorAll('input[type="date"].input:not([data-enhanced])').forEach(enhance);
}

function enhance(input) {
  input.dataset.enhanced = '1';
  const optional = input.hasAttribute('data-optional');
  input.type = 'hidden';

  const wrap = document.createElement('div');
  wrap.className = 'cdate';
  input.after(wrap);
  wrap.append(input);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'input cselect-btn';
  btn.setAttribute('aria-haspopup', 'dialog');
  wrap.prepend(btn);

  let pop = null, view = null;

  const paint = () => render(btn, html`
    ${icon('calendar', 16)}
    <span class="cselect-value ${input.value ? '' : 'placeholder'}"><span>${input.value ? fmtField(input.value) : (input.placeholder || 'Оберіть дату')}</span></span>
    ${icon('chevron-down', 16)}`);

  const set = v => {
    if (input.value === v) return;
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    paint();
  };

  function open() {
    const base = input.value ? new Date(input.value + 'T12:00') : new Date();
    view = new Date(base.getFullYear(), base.getMonth(), 1);
    pop = document.createElement('div');
    pop.className = 'popover dp-pop';
    (btn.closest('dialog') || document.body).append(pop);
    pop.addEventListener('mousedown', e => e.preventDefault()); // не забирати фокус
    pop.addEventListener('click', e => {
      const b = e.target.closest('[data-dp], [data-day]');
      if (!b) return;
      if (b.dataset.dp) { view.setMonth(view.getMonth() + +b.dataset.dp); paintPop(); return; }
      set(b.dataset.day); close(); btn.focus();
    });
    paintPop();
    const r = btn.getBoundingClientRect();
    const h = pop.offsetHeight;
    pop.style.left = Math.min(r.left, innerWidth - pop.offsetWidth - 12) + 'px';
    pop.style.top = (innerHeight - r.bottom < h + 12 && r.top > h ? r.top - h - 6 : r.bottom + 6) + 'px';
    wrap.classList.add('open');
    setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('scroll', onScroll, true); });
    document.addEventListener('keydown', esc, true);
  }

  function paintPop() {
    const today = iso(new Date());
    const first = new Date(view);
    const offset = (first.getDay() + 6) % 7; // понеділок — перший
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(first.getFullYear(), first.getMonth(), 1 - offset + i);
      cells.push({ v: iso(d), n: d.getDate(), out: d.getMonth() !== view.getMonth() });
    }
    render(pop, html`
      <div class="dp-head">
        <button type="button" class="icon-btn" data-dp="-1" aria-label="Попередній місяць">${icon('chevron-left', 16)}</button>
        <b>${MONTHS[view.getMonth()]} ${view.getFullYear()}</b>
        <button type="button" class="icon-btn" data-dp="1" aria-label="Наступний місяць">${icon('chevron-right', 16)}</button>
      </div>
      <div class="dp-grid">
        ${DOW.map(d => html`<span class="dp-dow">${d}</span>`)}
        ${cells.map(c => html`<button type="button" data-day="${c.v}"
          class="${c.out ? 'out' : ''} ${c.v === today ? 'today' : ''} ${c.v === input.value ? 'selected' : ''}">${c.n}</button>`)}
      </div>
      <div class="dp-foot">
        <button type="button" class="btn btn-ghost btn-sm" data-day="${today}">Сьогодні</button>
        ${optional && input.value ? html`<button type="button" class="btn btn-ghost btn-sm" data-day="">Очистити</button>` : ''}
      </div>`);
  }

  function close() {
    pop?.remove(); pop = null;
    wrap.classList.remove('open');
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('scroll', onScroll, true);
    document.removeEventListener('keydown', esc, true);
  }
  const outside = e => { if (!pop?.contains(e.target) && !btn.contains(e.target)) close(); };
  const onScroll = e => { if (!pop?.contains(e.target)) close(); };
  const esc = e => { if (e.key === 'Escape' && pop) { e.preventDefault(); e.stopPropagation(); close(); btn.focus(); } };

  btn.addEventListener('click', () => (pop ? close() : open()));
  input.addEventListener('change', paint);
  paint();
}

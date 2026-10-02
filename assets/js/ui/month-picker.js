// ============================================================
//  ui/month-picker.js — вибір місяця: ‹ Жовтень 2026 ›
//  Клік по назві відкриває сітку місяців. Без системних полів.
//
//  const mp = monthPicker(el, { value: '2026-10', onChange: v => … })
//  mp.value → '2026-10'
// ============================================================

import { html, render } from '../core/dom.js';
import { icon } from './icons.js';

export const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
  'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
const SHORT = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру'];

const pad = n => String(n).padStart(2, '0');
const split = v => v.split('-').map(Number);
const shift = (v, d) => { const [y, m] = split(v); const t = new Date(y, m - 1 + d, 1); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}`; };
export const currentMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
export const monthTitle = v => { const [y, m] = split(v); return `${MONTHS[m - 1]} ${y}`; };

export function monthPicker(el, { value = currentMonth(), onChange } = {}) {
  let cur = value, pop = null, year = split(cur)[0];
  el.classList.add('month-picker');

  const paint = () => render(el, html`
    <button type="button" class="icon-btn" data-mp="prev" aria-label="Попередній місяць">${icon('chevron-left', 16)}</button>
    <button type="button" class="mp-label" data-mp="open" aria-haspopup="dialog">${monthTitle(cur)}</button>
    <button type="button" class="icon-btn" data-mp="next" aria-label="Наступний місяць">${icon('chevron-right', 16)}</button>`);

  const set = v => { if (v === cur) return; cur = v; paint(); onChange?.(cur); };

  function open() {
    year = split(cur)[0];
    pop = document.createElement('div');
    pop.className = 'popover mp-pop';
    el.append(pop);
    paintPop();
    setTimeout(() => document.addEventListener('mousedown', outside, true));
    document.addEventListener('keydown', esc);
  }
  function paintPop() {
    const [cy, cm] = split(cur);
    const [ty, tm] = split(currentMonth());
    render(pop, html`
      <div class="mp-year">
        <button type="button" class="icon-btn" data-y="-1" aria-label="Попередній рік">${icon('chevron-left', 16)}</button>
        <b>${year}</b>
        <button type="button" class="icon-btn" data-y="1" aria-label="Наступний рік">${icon('chevron-right', 16)}</button>
      </div>
      <div class="mp-grid">
        ${SHORT.map((s, i) => html`<button type="button" data-m="${i + 1}"
          class="${year === cy && i + 1 === cm ? 'selected' : ''} ${year === ty && i + 1 === tm ? 'today' : ''}">${s}</button>`)}
      </div>`);
  }
  function close() {
    pop?.remove(); pop = null;
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('keydown', esc);
  }
  const outside = e => { if (!el.contains(e.target)) close(); };
  const esc = e => { if (e.key === 'Escape') close(); };

  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.mp === 'prev') set(shift(cur, -1));
    else if (b.dataset.mp === 'next') set(shift(cur, 1));
    else if (b.dataset.mp === 'open') pop ? close() : open();
    else if (b.dataset.y) { year += +b.dataset.y; paintPop(); }
    else if (b.dataset.m) { close(); set(`${year}-${pad(b.dataset.m)}`); }
  });

  paint();
  return { get value() { return cur; }, set };
}

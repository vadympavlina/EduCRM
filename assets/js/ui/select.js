// ============================================================
//  ui/select.js — власний випадаючий список замість системного <select>
//
//  enhanceSelects(root) перетворює кожен <select class="select"> у root.
//  Нативний select лишається прихованим і зберігає значення, тому
//  form.elements.x.value і події change працюють як раніше.
//  <option data-color="#hex"> — показує кольорову крапку (вчителі).
// ============================================================

import { html, render } from '../core/dom.js';
import { icon } from './icons.js';

const SEARCH_FROM = 8; // пошук з'являється, якщо варіантів більше

export function enhanceSelects(root = document) {
  root.querySelectorAll('select.select:not([data-enhanced])').forEach(enhance);
}

function enhance(native) {
  native.dataset.enhanced = '1';
  native.hidden = true;
  native.tabIndex = -1;

  const wrap = document.createElement('div');
  wrap.className = 'cselect';
  native.after(wrap);
  wrap.append(native);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'input cselect-btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  const label = native.closest('label')?.querySelector('.field-label')?.textContent;
  if (label) btn.setAttribute('aria-label', label);
  wrap.prepend(btn);

  let pop = null, active = -1, items = [];

  const options = () => [...native.options].map((o, i) => ({ i, value: o.value, text: o.textContent.trim(), color: o.dataset.color || '', disabled: o.disabled }));

  function paint() {
    const o = native.selectedOptions[0];
    const empty = !o || o.value === '';
    render(btn, html`
      <span class="cselect-value ${empty ? 'placeholder' : ''}">
        ${o?.dataset.color ? html`<span class="dot" style="--dot:${o.dataset.color}"></span>` : ''}
        <span>${o ? o.textContent.trim() : ''}</span>
      </span>
      ${icon('chevron-down', 16)}`);
  }

  function choose(value) {
    if (native.value !== value) {
      native.value = value;
      native.dispatchEvent(new Event('input', { bubbles: true }));
      native.dispatchEvent(new Event('change', { bubbles: true }));
    }
    close();
    btn.focus();
  }

  function open() {
    if (pop) return;
    const all = options();
    pop = document.createElement('div');
    pop.className = 'popover cselect-pop';
    pop.setAttribute('role', 'listbox');
    render(pop, html`
      ${all.length > SEARCH_FROM ? html`
        <div class="cselect-search">${icon('search', 15)}<input type="text" placeholder="Пошук…" aria-label="Пошук"></div>` : ''}
      <div class="cselect-list"></div>`);
    // У діалозі — всередину <dialog> (верхній шар), інакше в body
    (btn.closest('dialog') || document.body).append(pop);
    place();
    btn.setAttribute('aria-expanded', 'true');
    wrap.classList.add('open');

    const search = pop.querySelector('.cselect-search input');
    const list = pop.querySelector('.cselect-list');
    const fill = q => {
      const query = (q || '').trim().toLowerCase();
      items = all.filter(o => !query || o.text.toLowerCase().includes(query));
      active = Math.max(0, items.findIndex(o => o.value === native.value));
      render(list, items.length ? items.map((o, idx) => html`
        <div class="cselect-opt ${o.value === native.value ? 'selected' : ''} ${idx === active ? 'active' : ''} ${o.value === '' ? 'placeholder' : ''}"
             role="option" aria-selected="${String(o.value === native.value)}" data-idx="${idx}" ${o.disabled ? html`aria-disabled="true"` : ''}>
          ${o.color ? html`<span class="dot" style="--dot:${o.color}"></span>` : ''}
          <span class="cselect-opt-text">${o.text}</span>
          ${o.value === native.value && o.value !== '' ? icon('check', 15) : ''}
        </div>`) : html`<div class="cselect-empty">Нічого не знайдено</div>`);
      list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
    };
    fill('');

    list.addEventListener('mousedown', e => e.preventDefault()); // не втрачати фокус
    list.addEventListener('click', e => {
      const el = e.target.closest('.cselect-opt');
      if (!el || el.getAttribute('aria-disabled')) return;
      choose(items[+el.dataset.idx].value);
    });
    list.addEventListener('mousemove', e => {
      const el = e.target.closest('.cselect-opt');
      if (el && +el.dataset.idx !== active) setActive(+el.dataset.idx);
    });
    search?.addEventListener('input', () => fill(search.value));
    search?.addEventListener('keydown', onKey);
    (search || btn).focus();

    setTimeout(() => {
      document.addEventListener('mousedown', outside, true);
      addEventListener('resize', close);
      document.addEventListener('scroll', onScroll, true);
    });
  }

  function setActive(idx) {
    active = Math.max(0, Math.min(items.length - 1, idx));
    pop?.querySelectorAll('.cselect-opt').forEach((el, i) => el.classList.toggle('active', i === active));
    pop?.querySelector('.cselect-opt.active')?.scrollIntoView({ block: 'nearest' });
  }

  function place() {
    const r = btn.getBoundingClientRect();
    const h = Math.min(320, pop.scrollHeight);
    const below = innerHeight - r.bottom - 8;
    const up = below < h && r.top > below;
    pop.style.left = r.left + 'px';
    pop.style.width = Math.max(r.width, 200) + 'px';
    pop.style.top = up ? (r.top - h - 6) + 'px' : (r.bottom + 6) + 'px';
  }

  function close() {
    if (!pop) return;
    pop.remove(); pop = null; items = []; active = -1;
    btn.setAttribute('aria-expanded', 'false');
    wrap.classList.remove('open');
    document.removeEventListener('mousedown', outside, true);
    removeEventListener('resize', close);
    document.removeEventListener('scroll', onScroll, true);
  }

  const outside = e => { if (!pop?.contains(e.target) && !btn.contains(e.target)) close(); };
  const onScroll = e => { if (!pop?.contains(e.target)) close(); };

  function onKey(e) {
    if (!pop) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[active]) choose(items[active].value); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); btn.focus(); }
    else if (e.key === 'Tab') close();
  }

  btn.addEventListener('click', () => (pop ? close() : open()));
  btn.addEventListener('keydown', onKey);
  native.addEventListener('change', paint);
  paint();
}

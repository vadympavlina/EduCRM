// ============================================================
//  ui/toast.js — короткі сповіщення внизу праворуч
//  toast('Збережено', 'success' | 'error' | 'warning' | 'info')
// ============================================================

import { html, render } from '../core/dom.js';
import { icon } from './icons.js';

const ICONS = { success: 'check-circle', error: 'alert-circle', warning: 'alert-triangle', info: 'info' };

let container;

/** toast(msg, type, { duration, action: { label, onClick } }) — дія, напр. «Повернути» */
export function toast(message, type = 'info', opts = 3200) {
  const { duration = 3200, action = null } = typeof opts === 'number' ? { duration: opts } : opts;
  if (!container) {
    container = document.createElement('div');
    container.className = 'toasts';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    document.body.append(container);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  render(el, html`${icon(ICONS[type] || 'info', 18)}<span>${message}</span>${action ? html`<button type="button" class="toast-action">${action.label}</button>` : ''}`);
  container.append(el);
  const leave = () => {
    if (el.classList.contains('leaving')) return;
    el.classList.add('leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };
  if (action) el.querySelector('.toast-action').addEventListener('click', () => { action.onClick(); leave(); });
  setTimeout(leave, action ? Math.max(duration, 7000) : duration);
}

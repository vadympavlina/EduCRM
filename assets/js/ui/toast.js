// ============================================================
//  ui/toast.js — короткі сповіщення внизу праворуч
//  toast('Збережено', 'success' | 'error' | 'warning' | 'info')
// ============================================================

import { html, render } from '../core/dom.js';
import { icon } from './icons.js';

const ICONS = { success: 'check-circle', error: 'alert-circle', warning: 'alert-triangle', info: 'info' };

let container;

export function toast(message, type = 'info', duration = 3200) {
  if (!container) {
    container = document.createElement('div');
    container.className = 'toasts';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    document.body.append(container);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  render(el, html`${icon(ICONS[type] || 'info', 18)}<span>${message}</span>`);
  container.append(el);
  setTimeout(() => {
    el.classList.add('leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, duration);
}

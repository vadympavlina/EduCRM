// ============================================================
//  core/dom.js
//  Безпечний HTML: усе, що підставляється в html`...`,
//  екранується автоматично. Сирий HTML — лише через raw().
// ============================================================

class SafeHTML {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ESC[ch]);
}

/** Позначає рядок як довірений HTML (тільки для власної розмітки, не для даних з бази). */
export const raw = value => new SafeHTML(String(value ?? ''));

function serialize(value) {
  if (value == null || value === false) return '';
  if (value instanceof SafeHTML) return value.value;
  if (Array.isArray(value)) return value.map(serialize).join('');
  return escape(value);
}

/** Шаблонний тег: html`<b>${name}</b>` — name буде екрановано. */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += serialize(values[i]) + strings[i + 1];
  return new SafeHTML(out);
}

/** Пропускає лише http(s)-посилання — захист від javascript: у href. */
export function safeUrl(url) {
  try {
    const u = new URL(String(url), location.href);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch { return ''; }
}

export function render(el, content) {
  el.innerHTML = serialize(content);
}

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Делегування подій: on(root, 'click', '[data-action]', (e, el) => …) */
export function on(root, type, selector, handler) {
  root.addEventListener(type, e => {
    const el = e.target.closest(selector);
    if (el && root.contains(el)) handler(e, el);
  });
}

/** Ставить кнопку в стан завантаження на час виконання fn. */
export async function busy(button, fn) {
  if (!button) return fn();
  button.setAttribute('aria-busy', 'true');
  try { return await fn(); }
  finally { button.removeAttribute('aria-busy'); }
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] || '?').slice(0, 2)).toUpperCase();
}

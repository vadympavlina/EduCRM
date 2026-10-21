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

// Що востаннє намалювали в елемент: { src — розмітка, яку передали, out — що стало в DOM }
const painted = new WeakMap();

/**
 * Малює розмітку в елемент. Якщо розмітка та сама, що й минулого разу, і DOM
 * відтоді ніхто не змінював — нічого не робить: дані з бази часто приходять
 * повторно без змін, і так не збиваються прокрутка, фокус і відкриті списки.
 */
export function render(el, content) {
  const src = serialize(content);
  const prev = painted.get(el);
  if (prev && prev.src === src && el.innerHTML === prev.out) return;
  el.innerHTML = src;
  painted.set(el, { src, out: el.innerHTML });
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

/**
 * Об'єднує часті виклики в один кадр: кілька оновлень з бази поспіль
 * (статус, Telegram, lookup…) дають одне перемальовування, а не 3–4.
 */
export function batched(fn) {
  let frame = 0;
  return () => {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; fn(); });
  };
}

const sigs = new Map();
/** true, якщо дані для блоку key змінились з минулого разу (щоб не перемальовувати фільтри даремно). */
export function changed(key, value) {
  const sig = typeof value === 'string' ? value : JSON.stringify(value);
  if (sigs.get(key) === sig) return false;
  sigs.set(key, sig);
  return true;
}

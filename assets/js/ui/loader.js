// ============================================================
//  ui/loader.js — повноекранний завантажувач сторінки
//  Розмітка .app-loader є в кожному HTML (видно одразу, без «блимання»).
//  Сторінка викликає pageReady(), коли перші дані вже на екрані.
// ============================================================

const root = document.documentElement;

export function pageReady() {
  root.classList.add('is-ready');
  root.classList.remove('is-leaving');
}

// Підстраховка: якщо щось пішло не так — не тримаємо екран закритим вічно
setTimeout(pageReady, 12000);

// При переході на іншу сторінку CRM — одразу показуємо завантажувач
document.addEventListener('click', e => {
  const a = e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || url.href === location.href || a.hasAttribute('download') || !/^https?:/.test(url.protocol)) return;
  root.classList.add('is-leaving');
});

// Повернення кнопкою «Назад» зі збереженої сторінки (bfcache) — прибрати завантажувач
addEventListener('pageshow', e => { if (e.persisted) pageReady(); });

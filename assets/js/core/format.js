// ============================================================
//  core/format.js — гроші, дати, телефони, множина
// ============================================================

const moneyFmt = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 });

/** 1250 → "₴1 250" */
export function money(n) {
  return '₴' + moneyFmt.format(Math.round(Number(n) || 0)).replace(/ /g, ' ');
}

/** plural(5, 'заняття', 'заняття', 'занять') → 'занять' */
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

export const pad = n => String(n).padStart(2, '0');

/** Date → "2026-10-02" (локальний час) */
export const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Date → "2026-10" */
export const monthKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

/** ts / Date → "2 жовт. 2026" */
export function fmtDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** ts → "2 жовт., 14:05" */
export function fmtDateTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Відносний час: "щойно", "5 хв тому", "вчора" … */
export function fmtRelative(value) {
  if (!value) return '';
  const diff = Date.now() - value;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'щойно';
  if (min < 60) return `${min} хв тому`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} год тому`;
  const d = Math.round(h / 24);
  if (d === 1) return 'вчора';
  if (d < 7) return `${d} ${plural(d, 'день', 'дні', 'днів')} тому`;
  return fmtDate(value);
}

/** Тільки цифри; null якщо номер закороткий. */
export function phoneDigits(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  return d.length >= 9 ? d : null;
}

// ============================================================
//  ui/ext-version.js — розширення для робочої CRM:
//  чи встановлене (його скрипт ставить data-educrm-ext на <html>)
//  і яка найновіша версія (extension/manifest.json на сайті).
// ============================================================

const CACHE_KEY = 'educrm.extLatest';

export const installedExt = () => document.documentElement.dataset.educrmExt || '';

/** Найновіша версія розширення на сайті (кеш на сесію). */
export async function latestExt() {
  try { const c = sessionStorage.getItem(CACHE_KEY); if (c) return c; } catch {}
  try {
    const res = await fetch('extension/manifest.json', { cache: 'no-store' });
    const v = res.ok ? (await res.json()).version || '' : '';
    try { if (v) sessionStorage.setItem(CACHE_KEY, v); } catch {}
    return v;
  } catch { return ''; }
}

/** -1, якщо a старіша за b; 0 — однакові; 1 — новіша. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

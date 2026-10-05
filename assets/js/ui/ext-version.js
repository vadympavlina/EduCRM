// ============================================================
//  ui/ext-version.js — розширення для робочої CRM (їх два):
//  чи встановлене (його скрипт ставить data-атрибут на <html>)
//  і яка найновіша версія (manifest.json у папці на сайті).
// ============================================================

export const EXTENSIONS = {
  main:      { attr: 'educrmExt',    dir: 'extension',           zip: 'extension.zip',           name: 'EduCRM' },
  marketing: { attr: 'educrmMktExt', dir: 'extension-marketing', zip: 'extension-marketing.zip', name: 'EduCRM Marketing' },
};

export const installedExt = (id = 'main') => document.documentElement.dataset[EXTENSIONS[id].attr] || '';

/** Найновіша версія розширення на сайті (кеш на сесію). */
export async function latestExt(id = 'main') {
  const key = 'educrm.extLatest.' + id;
  try { const c = sessionStorage.getItem(key); if (c) return c; } catch {}
  try {
    const res = await fetch(EXTENSIONS[id].dir + '/manifest.json', { cache: 'no-store' });
    const v = res.ok ? (await res.json()).version || '' : '';
    try { if (v) sessionStorage.setItem(key, v); } catch {}
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

/** Розширення, які встановлені, але застаріли: [{ id, name, have, latest }]. */
export async function outdatedExtensions() {
  const out = [];
  for (const id of Object.keys(EXTENSIONS)) {
    const have = installedExt(id);
    if (!have) continue;
    const latest = await latestExt(id);
    if (latest && compareVersions(have, latest) < 0) out.push({ id, name: EXTENSIONS[id].name, have, latest });
  }
  return out;
}

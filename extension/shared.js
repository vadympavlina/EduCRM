// ============================================================
//  shared.js — спільне для банера (crm-watcher.js) і popup.
//  Адреси, розбір картки клієнта, пошук заняття в EduCRM.
// ============================================================

/* exported EDU */
var EDU = (() => {
  const URL_APP = 'https://vadympavlina.github.io/EduCRM/';
  const URL_DB  = 'https://educrm-85756-default-rtdb.firebaseio.com';
  const CLIENT_PAGE = /^https:\/\/crm\.itstep\.org\/(.*\/)?clients\/\d+/;

  const MONTHS = ['січ.', 'лют.', 'бер.', 'квіт.', 'трав.', 'черв.', 'лип.', 'серп.', 'вер.', 'жовт.', 'лист.', 'груд.'];
  const DAYS = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const STATUS = {
    pending:   { label: 'Очікує підтвердження', color: '#dc6803', bg: '#fffaeb' },
    confirmed: { label: 'Підтверджено',         color: '#079455', bg: '#ecfdf3' },
  };

  /** Останні 9 цифр номера: +380 67…, 067… і 38067… дають один ключ. */
  const phoneKey = p => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : null; };
  const digits = p => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 9 ? d : null; };

  /** Дані клієнта зі сторінки робочої CRM. */
  function parseClient(doc = document) {
    const name = doc.querySelector('span.info__contact--name')?.textContent.trim() || '';
    const phones = [...doc.querySelectorAll('button.info__contact--value')]
      .map(el => el.textContent.trim()).filter(p => digits(p));
    return { name, phones: [...new Set(phones)], sourceUrl: location.href };
  }

  async function readLookup(key) {
    try {
      const res = await fetch(`${URL_DB}/lookup/${encodeURIComponent(key)}.json`, { cache: 'no-store' });
      return res.ok ? await res.json() : null;
    } catch { return null; }
  }

  /**
   * Найближче майбутнє заняття для будь-якого з номерів клієнта.
   * Повертає { ...lookup, phone, key } або null. Минулі заняття відкидаються.
   */
  async function findUpcoming(phones) {
    const now = Date.now();
    const keys = [];
    for (const p of phones) {
      const k = phoneKey(p); if (k && !keys.some(x => x.key === k)) keys.push({ key: k, phone: p });
      const d = digits(p); if (d && d !== k && !keys.some(x => x.key === d)) keys.push({ key: d, phone: p }); // старий формат
    }
    const found = await Promise.all(keys.map(async x => ({ ...x, data: await readLookup(x.key) })));
    let best = null;
    for (const { key, phone, data } of found) {
      if (!data?.hasUpcoming || !data.date || !data.startTime) continue;
      const end = new Date(`${data.date}T${data.endTime || data.startTime}`).getTime();
      if (!(end > now)) continue;
      const ts = data.ts || new Date(`${data.date}T${data.startTime}`).getTime();
      if (!best || ts < best.ts) best = { ...data, ts, phone, key: phoneKey(phone) || key };
    }
    return best;
  }

  /** "вт, 6 жовт. · 15:00–16:30" */
  function fmtWhen(l) {
    const d = new Date(`${l.date}T12:00`);
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const diff = Math.round((d - today) / 864e5);
    const day = diff === 0 ? 'Сьогодні' : diff === 1 ? 'Завтра' : `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
    return `${day} · ${l.startTime}${l.endTime ? '–' + l.endTime : ''}`;
  }

  const clientUrl = key => `${URL_APP}client?id=${encodeURIComponent(key)}`;
  function importUrl({ name, phone, sourceUrl }) {
    const q = new URLSearchParams();
    if (name) q.set('importName', name);
    if (phone) q.set('importPhone', phone);
    if (sourceUrl) q.set('importSource', sourceUrl);
    return `${URL_APP}?${q}`;
  }

  /** Невеликий помічник: el('div', { class: 'x', text: '…' }, ...діти) — без innerHTML. */
  function el(tag, attrs = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    n.append(...children.flat().filter(c => c != null && c !== false));
    return n;
  }

  /** SVG-іконка з набору (шляхи Lucide, ліцензія ISC). */
  const ICONS = {
    cap: '<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    ext: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
    undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  };
  function icon(name, size = 16) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [k, v] of Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) s.setAttribute(k, v);
    // шляхи — власні константи, не дані зі сторінки
    s.innerHTML = ICONS[name] || ICONS.info;
    return s;
  }

  const initials = name => {
    const p = String(name || '').trim().split(/\s+/).filter(Boolean);
    return (p.length > 1 ? p[0][0] + p[1][0] : (p[0] || '?').slice(0, 2)).toUpperCase();
  };

  return { URL_APP, CLIENT_PAGE, STATUS, phoneKey, digits, parseClient, findUpcoming, fmtWhen, clientUrl, importUrl, el, icon, initials };
})();

// ============================================================
//  event-import.js — crm.itstep.org, сторінка маркетингових заходів.
//  Коли відкрите вікно «Список клієнтів» заходу, внизу з'являється
//  плашка: «Перенести у Відкритий захід». Вона замінює весь список
//  Відкритого заходу в EduCRM (назва + учасники). Попередній список
//  зберігається, тож перенесення можна скасувати кнопкою «Повернути».
// ============================================================

(() => {
  const { el, icon } = EDU;
  const DIALOG = 'app-marketing-events-client-list-dialog';
  const HOST_ID = 'educrm-event-import';
  let current = null;   // відкрите вікно, для якого показана плашка

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .bar { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 2147483000;
      display: flex; align-items: center; gap: 12px; max-width: calc(100vw - 32px); padding: 10px 10px 10px 12px;
      background: #fff; border: 1px solid #e4e7ec; border-radius: 16px;
      box-shadow: 0 20px 40px -12px rgba(16,24,40,.35), 0 4px 10px -4px rgba(16,24,40,.12);
      font: 13px/1.45 Inter, -apple-system, 'Segoe UI', system-ui, sans-serif; color: #101828; -webkit-font-smoothing: antialiased;
      animation: up .25s cubic-bezier(.2,.8,.2,1); }
    @keyframes up { from { opacity: 0; transform: translate(-50%, 12px); } }
    .logo { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; flex: none; color: #fff;
      background: linear-gradient(135deg, #5b7bff, #3450d1); box-shadow: 0 2px 6px rgba(79,110,247,.35); }
    .logo.ok { background: linear-gradient(135deg, #32d583, #079455); box-shadow: 0 2px 6px rgba(7,148,85,.35); }
    .logo.warn { background: linear-gradient(135deg, #fdb022, #dc6803); box-shadow: 0 2px 6px rgba(220,104,3,.35); }
    .logo.err { background: linear-gradient(135deg, #f97066, #d92d20); }
    .text { min-width: 0; }
    .t1 { font-weight: 700; font-size: 14px; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 420px; }
    .t2 { font-size: 12px; color: #667085; }
    .t2 b { color: #344054; }
    .btns { display: flex; gap: 8px; margin-left: 8px; flex: none; }
    .btn { display: inline-flex; align-items: center; gap: 7px; height: 38px; padding: 0 14px; border-radius: 10px;
      border: 1px solid #d0d5dd; background: #fff; color: #344054; font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; text-decoration: none; }
    .btn:hover { background: #f9fafb; }
    .btn.primary { background: #4f6ef7; border-color: #4f6ef7; color: #fff; box-shadow: 0 1px 2px rgba(79,110,247,.3); }
    .btn.primary:hover { background: #3f5ce6; border-color: #3f5ce6; }
    .btn.danger { background: #d92d20; border-color: #d92d20; color: #fff; }
    .btn.danger:hover { background: #b42318; }
    .btn:disabled { opacity: .6; pointer-events: none; }
    .x { width: 30px; height: 30px; border: 0; border-radius: 8px; background: transparent; color: #98a2b3; display: grid; place-items: center; cursor: pointer; flex: none; }
    .x:hover { background: #f2f4f7; color: #344054; }
    .spin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid rgba(255,255,255,.4); border-top-color: #fff; animation: s .7s linear infinite; }
    @keyframes s { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .bar { animation: none; } }
  `;

  // ── Дані з вікна ───────────────────────────────────────────
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  function readDialog(d) {
    const title = clean(d.querySelector('[mat-dialog-title] h3, .mat-mdc-dialog-title h3')?.textContent);
    const seen = new Set();
    const people = [];
    d.querySelectorAll('tbody tr').forEach(tr => {
      const a = tr.querySelector('.mat-column-fio a, .cdk-column-fio a');
      const name = clean((a || tr.querySelector('.mat-column-fio, .cdk-column-fio'))?.textContent);
      const raw = clean(tr.querySelector('.mat-column-phone, .cdk-column-phone')?.textContent);
      const digits = raw.replace(/\D/g, '');
      const key = EDU.phoneKey(digits) || name.toLowerCase();
      if (!name && !digits) return;
      if (seen.has(key)) return;
      seen.add(key);
      const href = a?.getAttribute('href');
      people.push({
        name: name || 'Без імені',
        phone: digits.length === 12 && digits.startsWith('380') ? '+' + digits : (raw || ''),
        crmLink: href ? new URL(href, location.origin).href : '',
      });
    });
    return { title, people };
  }

  // ── Запити до бази — через фонову частину розширення ───────
  const send = msg => new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(msg, res => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        res?.ok ? resolve(res.data) : reject(new Error(res?.error || 'Помилка'));
      });
    } catch (e) { reject(e); }
  });

  // ── Плашка ─────────────────────────────────────────────────
  function root() {
    let h = document.getElementById(HOST_ID);
    if (!h) { h = document.createElement('div'); h.id = HOST_ID; h.attachShadow({ mode: 'open' }); document.documentElement.append(h); }
    return h.shadowRoot;
  }
  const remove = () => document.getElementById(HOST_ID)?.remove();

  function bar(logoCls, logoIcon, t1, t2, buttons, closable = true) {
    root().replaceChildren(el('style', { text: CSS }), el('div', { class: 'bar', role: 'status' },
      el('span', { class: 'logo ' + logoCls }, icon(logoIcon, 19)),
      el('div', { class: 'text' }, el('div', { class: 't1', text: t1 }), t2 ? el('div', { class: 't2' }, t2) : null),
      el('div', { class: 'btns' }, buttons),
      closable ? el('button', { class: 'x', title: 'Сховати', 'aria-label': 'Сховати', onclick: remove }, icon('x', 16)) : null));
  }
  const plural = (n, a, b, c) => { const m = n % 100, k = n % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k >= 2 && k <= 4 ? b : c; };
  const people = n => `${n} ${plural(n, 'клієнт', 'клієнти', 'клієнтів')}`;

  function showStart(d) {
    const { title, people: list } = readDialog(d);
    if (!list.length) return remove();
    bar('', 'sparkles', title || 'Захід без назви', ['Перенести ', el('b', { text: people(list.length) }), ' у Відкритий захід EduCRM'],
      [el('button', { class: 'btn primary', onclick: () => confirmStep(d) }, icon('download', 16), 'Перенести')]);
  }

  async function confirmStep(d) {
    const { title, people: list } = readDialog(d);
    bar('', 'sparkles', 'Перевіряю Відкритий захід…', null, [el('button', { class: 'btn primary', disabled: true }, el('span', { class: 'spin' }))]);
    let prev;
    try { prev = await send({ type: 'openday-get' }); } catch (e) { return showError(d, e); }
    const prevCount = Object.values(prev?.groups || {}).reduce((n, g) => n + Object.keys(g?.people || {}).length, 0);
    if (!prevCount && !prev?.title) return doImport(d, title, list);
    bar('warn', 'alert', 'Замінити поточний список?',
      ['Зараз у Відкритому заході ', el('b', { text: `«${prev?.title || 'без назви'}» · ${people(prevCount)}` }), '. Його буде очищено.'],
      [el('button', { class: 'btn', onclick: () => showStart(d) }, 'Скасувати'),
       el('button', { class: 'btn danger', onclick: () => doImport(d, title, list) }, 'Замінити')]);
  }

  async function doImport(d, title, list) {
    bar('', 'sparkles', `Переношу ${people(list.length)}…`, null, [el('button', { class: 'btn primary', disabled: true }, el('span', { class: 'spin' }))], false);
    try {
      await send({ type: 'openday-replace', title, people: list });
    } catch (e) { return showError(d, e); }
    bar('ok', 'check', `Готово: ${people(list.length)} у Відкритому заході`, title ? ['Назва: ', el('b', { text: title })] : null, [
      el('button', { class: 'btn', title: 'Повернути попередній список', onclick: () => undo(d) }, icon('undo', 15), 'Повернути'),
      el('button', { class: 'btn primary', onclick: () => send({ type: 'open-app', url: EDU.URL_APP + 'openday' }).catch(() => window.open(EDU.URL_APP + 'openday', '_blank')) }, icon('ext', 15), 'Відкрити'),
    ]);
  }

  async function undo(d) {
    bar('', 'undo', 'Повертаю попередній список…', null, [el('button', { class: 'btn', disabled: true }, el('span', { class: 'spin', style: 'border-color:#d0d5dd;border-top-color:#4f6ef7' }))], false);
    try { await send({ type: 'openday-undo' }); }
    catch (e) { return showError(d, e); }
    bar('ok', 'check', 'Попередній список повернуто', null, [el('button', { class: 'btn', onclick: () => showStart(d) }, 'Перенести знову')]);
  }

  function showError(d, e) {
    console.warn('[EduCRM]', e);
    bar('err', 'alert', 'Не вдалося перенести', 'Перевірте інтернет і спробуйте ще раз.', [el('button', { class: 'btn primary', onclick: () => confirmStep(d) }, 'Спробувати ще')]);
  }

  // ── Стежимо за появою/закриттям вікна (сторінка — SPA на Angular) ──
  let pending = 0;
  function scan() {
    const d = document.querySelector(DIALOG);
    if (d === current) return;
    current = d;
    if (!d) return remove();
    // таблиця може домальовуватись — коротко чекаємо, поки з'являться рядки
    clearTimeout(pending);
    let tries = 0;
    const wait = () => {
      if (current !== d) return;
      if (d.querySelector('tbody tr') || ++tries > 20) return showStart(d);
      pending = setTimeout(wait, 250);
    };
    wait();
  }
  new MutationObserver(() => scan()).observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();

// ============================================================
//  crm-watcher.js — працює на crm.itstep.org.
//  На картці клієнта показує маленьку кнопку EduCRM у кутку:
//   • клік — відкрити EduCRM з даними клієнта для нового заняття;
//   • наведення — підказка з найближчим заняттям (якщо є) і посилання
//     на картку клієнта в EduCRM.
//  Робоча CRM — односторінковий застосунок, тому стежимо за адресою.
// ============================================================

(() => {
  const { el, icon } = EDU;
  const HOST_ID = 'educrm-helper';
  const HIDDEN_KEY = 'educrm.hiddenOn';
  let lastUrl = '';
  let runId = 0;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .wrap { position: fixed; right: 20px; bottom: 20px; z-index: 2147483000; display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
      font: 13px/1.45 Inter, -apple-system, 'Segoe UI', system-ui, sans-serif; color: #101828; -webkit-font-smoothing: antialiased; }

    /* Кнопка: кружок з логотипом, при наведенні — підпис */
    .fab { position: relative; display: flex; align-items: center; height: 46px; padding: 0; border: 0; border-radius: 999px; cursor: pointer;
      background: linear-gradient(135deg, #5b7bff, #3450d1); color: #fff; font: inherit; font-weight: 700; font-size: 13px;
      box-shadow: 0 8px 20px -4px rgba(52,80,209,.55), 0 2px 4px rgba(16,24,40,.12);
      transition: box-shadow .15s, transform .12s; animation: pop .25s cubic-bezier(.2,.8,.2,1); }
    .fab:hover { box-shadow: 0 10px 26px -4px rgba(52,80,209,.65), 0 2px 4px rgba(16,24,40,.12); }
    .fab:active { transform: scale(.97); }
    .fab:focus-visible { outline: 3px solid rgba(79,110,247,.4); outline-offset: 3px; }
    .fab .logo { width: 46px; height: 46px; display: grid; place-items: center; flex: none; }
    .fab .label { max-width: 0; overflow: hidden; white-space: nowrap; opacity: 0; transition: max-width .22s cubic-bezier(.2,.8,.2,1), opacity .15s, padding .22s; }
    .wrap:hover .fab .label, .fab:focus-visible .label { max-width: 220px; opacity: 1; padding-right: 18px; }
    .fab .dot { position: absolute; top: 1px; right: 1px; width: 13px; height: 13px; border-radius: 50%; background: #12b76a; box-shadow: 0 0 0 2.5px #fff; }
    @keyframes pop { from { opacity: 0; transform: scale(.6); } }

    /* Підказка над кнопкою (лише при наведенні) */
    .tip { width: 268px; background: #fff; border: 1px solid #e4e7ec; border-radius: 12px; padding: 12px;
      box-shadow: 0 16px 32px -8px rgba(16,24,40,.22); display: none; flex-direction: column; gap: 10px; }
    .wrap:hover .tip, .wrap:focus-within .tip { display: flex; animation: up .16s ease; }
    @keyframes up { from { opacity: 0; transform: translateY(4px); } }
    .row { display: flex; align-items: center; gap: 10px; }
    .ico { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; flex: none; background: #ecfdf3; color: #079455; }
    .ico.group { background: #f4f3ff; color: #7a5af8; }
    .ico.none { background: #f2f4f7; color: #98a2b3; }
    .t1 { font-weight: 700; }
    .t2 { font-size: 12px; color: #667085; }
    .grow { flex: 1; min-width: 0; }
    .link { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 30px; border-radius: 8px;
      border: 1px solid #d0d5dd; background: #fff; color: #344054; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; text-decoration: none; }
    .link:hover { background: #f9fafb; }
    .hide { align-self: flex-start; width: 24px; height: 24px; margin: -4px -4px 0 0; border: 0; border-radius: 6px; background: transparent; color: #98a2b3; display: grid; place-items: center; cursor: pointer; flex: none; }
    .hide:hover { background: #f2f4f7; color: #344054; }
    @media (prefers-reduced-motion: reduce) { .fab, .tip { animation: none !important; } .fab .label { transition: none; } }
  `;

  const hiddenHere = () => { try { return sessionStorage.getItem(HIDDEN_KEY) === location.pathname; } catch { return false; } };
  const clear = () => document.getElementById(HOST_ID)?.remove();

  function openApp(url) {
    try { chrome.runtime.sendMessage({ type: 'open-app', url }); }
    catch { window.open(url, '_blank', 'noopener'); } // якщо розширення щойно оновили
  }

  function render(client, info) {
    clear();
    const host = document.createElement('div');
    host.id = HOST_ID;
    const root = host.attachShadow({ mode: 'open' });
    const phone = info?.phone || client.phones[0] || '';
    const st = info && (EDU.STATUS[info.status] || EDU.STATUS.pending);

    const hideBtn = el('button', { class: 'hide', title: 'Сховати на цій картці', 'aria-label': 'Сховати', onclick: () => {
      try { sessionStorage.setItem(HIDDEN_KEY, location.pathname); } catch {}
      clear();
    } }, icon('x', 14));
    const tip = el('div', { class: 'tip' },
      info
        ? el('div', { class: 'row' },
            el('span', { class: 'ico' + (info.isGroup ? ' group' : '') }, icon(info.isGroup ? 'users' : 'calendar', 17)),
            el('div', { class: 'grow' },
              el('div', { class: 't1', text: EDU.fmtWhen(info) }),
              el('div', { class: 't2', text: `${info.isGroup ? 'Групове · ' : ''}${st.label}${info.count > 1 ? ` · ще ${info.count - 1}` : ''}` })),
            hideBtn)
        : el('div', { class: 'row' },
            el('span', { class: 'ico none' }, icon('calendar', 17)),
            el('div', { class: 'grow' },
              el('div', { class: 't1', text: client.name || 'Клієнт' }),
              el('div', { class: 't2', text: 'Майбутніх занять в EduCRM немає' })),
            hideBtn),
      info ? el('button', { class: 'link', onclick: () => openApp(EDU.clientUrl(info.key)) }, icon('ext', 13), 'Картка в EduCRM') : null);

    const fab = el('button', { class: 'fab', title: 'Записати клієнта на заняття в EduCRM',
      onclick: () => openApp(EDU.importUrl({ name: client.name, phone, sourceUrl: location.href })) },
      el('span', { class: 'logo' }, icon('cap', 21)),
      el('span', { class: 'label', text: 'Записати в EduCRM' }),
      info ? el('span', { class: 'dot', title: 'Є заняття в EduCRM' }) : null);

    root.append(el('style', { text: CSS }), el('div', { class: 'wrap' }, tip, fab));
    document.documentElement.append(host);
  }

  // Картка CRM довантажує дані асинхронно — чекаємо телефони до 10 с
  function waitForClient(id) {
    return new Promise(resolve => {
      let tries = 0;
      const tick = () => {
        if (id !== runId) return resolve(null);
        const c = EDU.parseClient();
        if (c.phones.length) return resolve(c);
        if (++tries >= 20) return resolve(c.name ? c : null);
        setTimeout(tick, 500);
      };
      tick();
    });
  }

  async function check() {
    const id = ++runId;
    clear();
    if (!EDU.CLIENT_PAGE.test(location.href) || hiddenHere()) return;
    const client = await waitForClient(id);
    if (!client || id !== runId) return;
    render(client, null);                                   // кнопка одразу
    const info = client.phones.length ? await EDU.findUpcoming(client.phones) : null;
    if (info && id === runId) render(client, info);         // + інформація про заняття
  }

  setInterval(() => { if (location.href !== lastUrl) { lastUrl = location.href; check(); } }, 800);
  lastUrl = location.href;
  check();
})();

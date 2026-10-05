// ============================================================
//  crm-watcher.js — працює на crm.itstep.org.
//  На картці клієнта шукає в EduCRM найближче заняття (за будь-яким
//  з номерів) і показує картку-підказку. Робоча CRM — односторінковий
//  застосунок, тому стежимо за зміною адреси без перезавантаження.
// ============================================================

(() => {
  const { el, icon } = EDU;
  const HOST_ID = 'educrm-helper';
  const COLLAPSE_AFTER = 12000;
  let lastUrl = '';
  let runId = 0;

  // ── Стилі (у Shadow DOM — не конфліктують зі сторінкою CRM) ──
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .wrap { position: fixed; top: 16px; right: 16px; z-index: 2147483000;
      font: 13px/1.45 Inter, -apple-system, 'Segoe UI', system-ui, sans-serif; color: #101828; -webkit-font-smoothing: antialiased; }
    .card { width: 312px; background: #fff; border: 1px solid #e4e7ec; border-radius: 14px; overflow: hidden;
      box-shadow: 0 16px 32px -8px rgba(16,24,40,.22), 0 4px 8px -4px rgba(16,24,40,.08); animation: in .22s cubic-bezier(.2,.8,.2,1); }
    @keyframes in { from { opacity: 0; transform: translateY(-6px) scale(.98); } }
    .head { display: flex; align-items: center; gap: 8px; padding: 10px 10px 10px 12px; border-bottom: 1px solid #f2f4f7; }
    .logo { width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center; color: #fff;
      background: linear-gradient(135deg, #5b7bff, #3450d1); flex: none; }
    .brand { font-weight: 700; font-size: 12px; letter-spacing: -.01em; }
    .brand span { color: #98a2b3; font-weight: 500; }
    .x { margin-left: auto; width: 26px; height: 26px; border: 0; border-radius: 7px; background: transparent; color: #98a2b3;
      display: grid; place-items: center; cursor: pointer; }
    .x:hover { background: #f2f4f7; color: #344054; }
    .body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
    .row { display: flex; align-items: center; gap: 10px; }
    .ico { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; flex: none;
      background: #eef1fe; color: #4f6ef7; }
    .ico.group { background: #f4f3ff; color: #7a5af8; }
    .title { font-weight: 700; font-size: 14px; letter-spacing: -.01em; }
    .when { color: #344054; font-variant-numeric: tabular-nums; }
    .badges { display: flex; flex-wrap: wrap; gap: 6px; }
    .badge { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px; border-radius: 999px;
      font-size: 11.5px; font-weight: 600; border: 1px solid transparent; }
    .badge i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .badge.more { background: #f2f4f7; color: #475467; }
    .actions { display: flex; gap: 8px; }
    .btn { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 34px; padding: 0 10px;
      border-radius: 9px; border: 1px solid #d0d5dd; background: #fff; color: #344054; font: inherit; font-weight: 600; font-size: 12.5px;
      text-decoration: none; cursor: pointer; white-space: nowrap; transition: background .12s, border-color .12s; }
    .btn:hover { background: #f9fafb; }
    .btn.primary { background: #4f6ef7; border-color: #4f6ef7; color: #fff; }
    .btn.primary:hover { background: #3f5ce6; border-color: #3f5ce6; }
    .pill { display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 12px 0 6px; border-radius: 999px;
      border: 1px solid #e4e7ec; background: #fff; cursor: pointer; font: inherit; font-weight: 600; font-size: 12.5px; color: #101828;
      box-shadow: 0 8px 20px -6px rgba(16,24,40,.25); animation: in .2s ease; }
    .pill:hover { border-color: #c7d1fd; }
    .pill .logo { width: 24px; height: 24px; border-radius: 999px; }
    .pill .dot { width: 8px; height: 8px; border-radius: 50%; }
    @media (prefers-reduced-motion: reduce) { .card, .pill { animation: none; } }
  `;

  function host() {
    let h = document.getElementById(HOST_ID);
    if (!h) {
      h = document.createElement('div');
      h.id = HOST_ID;
      h.attachShadow({ mode: 'open' });
      document.documentElement.append(h);
    }
    return h.shadowRoot;
  }
  const clear = () => document.getElementById(HOST_ID)?.remove();

  function renderCard(root, info, client) {
    const st = EDU.STATUS[info.status] || EDU.STATUS.pending;
    let timer = null;
    const collapse = () => renderPill(root, info, client);
    const card = el('div', { class: 'card', role: 'dialog', 'aria-label': 'Заняття в EduCRM',
      onmouseenter: () => clearTimeout(timer), onmouseleave: () => { timer = setTimeout(collapse, COLLAPSE_AFTER / 2); } },
      el('div', { class: 'head' },
        el('span', { class: 'logo' }, icon('cap', 13)),
        el('span', { class: 'brand' }, 'EduCRM ', el('span', { text: '· заняття клієнта' })),
        el('button', { class: 'x', title: 'Згорнути', 'aria-label': 'Згорнути', onclick: collapse }, icon('x', 15))),
      el('div', { class: 'body' },
        el('div', { class: 'row' },
          el('span', { class: 'ico' + (info.isGroup ? ' group' : '') }, icon(info.isGroup ? 'users' : 'calendar', 18)),
          el('div', {},
            el('div', { class: 'title', text: info.isGroup ? 'Групове заняття' : 'Заплановане заняття' }),
            el('div', { class: 'when', text: EDU.fmtWhen(info) }))),
        el('div', { class: 'badges' },
          el('span', { class: 'badge', style: `color:${st.color};background:${st.bg}` }, el('i'), st.label),
          info.count > 1 ? el('span', { class: 'badge more', text: `+ ще ${info.count - 1}` }) : null),
        el('div', { class: 'actions' },
          el('a', { class: 'btn primary', href: EDU.clientUrl(info.key), target: '_blank', rel: 'noopener' }, icon('ext', 14), 'Картка клієнта'),
          el('a', { class: 'btn', href: EDU.importUrl({ ...client, phone: info.phone }), target: '_blank', rel: 'noopener', title: 'Записати ще на одне заняття' }, icon('plus', 14), 'Записати'))));
    root.replaceChildren(el('style', { text: CSS }), el('div', { class: 'wrap' }, card));
    timer = setTimeout(collapse, COLLAPSE_AFTER);
  }

  function renderPill(root, info, client) {
    const st = EDU.STATUS[info.status] || EDU.STATUS.pending;
    root.replaceChildren(el('style', { text: CSS }), el('div', { class: 'wrap' },
      el('button', { class: 'pill', title: 'Показати заняття в EduCRM', onclick: () => renderCard(root, info, client) },
        el('span', { class: 'logo' }, icon('cap', 13)),
        el('span', { class: 'dot', style: `background:${st.color}` }),
        EDU.fmtWhen(info))));
  }

  // Картка CRM довантажує дані асинхронно — чекаємо телефони до 10 с
  function waitForPhones(id) {
    return new Promise(resolve => {
      let tries = 0;
      const tick = () => {
        if (id !== runId) return resolve(null);
        const c = EDU.parseClient();
        if (c.phones.length) return resolve(c);
        if (++tries >= 20) return resolve(null);
        setTimeout(tick, 500);
      };
      tick();
    });
  }

  async function check() {
    const id = ++runId;
    clear();
    if (!EDU.CLIENT_PAGE.test(location.href)) return;
    const client = await waitForPhones(id);
    if (!client || id !== runId) return;
    const info = await EDU.findUpcoming(client.phones);
    if (!info || id !== runId) return;
    renderCard(host(), info, client);
  }

  // Перевірка при відкритті та при переході між картками без перезавантаження
  setInterval(() => { if (location.href !== lastUrl) { lastUrl = location.href; check(); } }, 800);
  lastUrl = location.href;
  check();
})();

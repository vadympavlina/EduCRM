// ============================================================
//  popup.js — вікно розширення: дані клієнта з поточної вкладки,
//  чи є він в EduCRM, і швидкий запис на заняття.
// ============================================================

const { el, icon } = EDU;
const main = document.getElementById('main');

document.getElementById('logo').append(icon('cap', 18));
const appLink = document.getElementById('open-app');
appLink.href = EDU.URL_APP;
appLink.append(icon('ext', 16));

/** Відкрити адресу EduCRM: у вже відкритій вкладці EduCRM або в новій. */
async function openInApp(url) {
  try {
    const [existing] = await chrome.tabs.query({ url: EDU.URL_APP + '*' });
    if (existing) {
      await chrome.tabs.update(existing.id, { url, active: true });
      await chrome.windows.update(existing.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url });
    }
    window.close();
  } catch {
    await chrome.tabs.create({ url });
    window.close();
  }
}

function showEmpty(title, text) {
  main.replaceChildren(el('div', { class: 'empty' },
    el('div', { class: 'empty-ico' }, icon('info', 22)),
    el('h2', { text: title }),
    el('p', { text: text })),
    el('button', { class: 'btn', onclick: () => openInApp(EDU.URL_APP) }, icon('ext', 15), 'Відкрити EduCRM'));
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !EDU.CLIENT_PAGE.test(tab.url)) {
    return showEmpty('Відкрийте картку клієнта', 'Перейдіть на сторінку клієнта в робочій CRM (crm.itstep.org/…/clients/…) і натисніть на іконку ще раз.');
  }

  let client;
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['shared.js'],
    }).then(() => chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => EDU.parseClient() }));
    client = res?.result;
  } catch { client = null; }
  if (!client) return showEmpty('Не вдалося зчитати сторінку', 'Оновіть сторінку CRM і спробуйте ще раз.');
  if (!client.phones.length && !client.name) return showEmpty('Картка ще завантажується', 'Зачекайте секунду, поки CRM покаже дані клієнта, і відкрийте розширення знову.');

  let selected = client.phones[0] || '';
  const status = el('div', { class: 'card status' },
    el('span', { class: 'status-ico' }, el('span', { class: 'spinner' })),
    el('div', {}, el('div', { class: 'status-title', text: 'Перевіряю EduCRM…' })));

  const phoneList = client.phones.length
    ? el('div', { class: 'card phones' }, client.phones.map((p, i) => client.phones.length > 1
        ? el('label', { class: 'phone' },
            el('input', { type: 'radio', name: 'phone', value: p, checked: i === 0, onchange: () => { selected = p; } }),
            p)
        : el('div', { class: 'phone single' }, icon('phone', 15), p)))
    : el('div', { class: 'card phones' }, el('div', { class: 'phone single muted', text: 'Телефон не знайдено' }));

  const createBtn = el('button', { class: 'btn primary', onclick: async () => {
    createBtn.disabled = true;
    await openInApp(EDU.importUrl({ name: client.name, phone: selected, sourceUrl: client.sourceUrl }));
  } }, icon('plus', 16), 'Записати на заняття');

  let srcText = client.sourceUrl.replace(/^https?:\/\//, '');
  if (srcText.length > 38) srcText = srcText.slice(0, 38) + '…';

  main.replaceChildren(
    el('div', { class: 'card client' },
      el('span', { class: 'avatar', text: EDU.initials(client.name) }),
      el('div', { class: 'info' },
        el('div', { class: 'client-name', text: client.name || 'Без імені' }),
        el('a', { class: 'client-src', href: client.sourceUrl, target: '_blank', rel: 'noopener', title: client.sourceUrl }, icon('link', 12), srcText))),
    client.phones.length > 1 ? el('div', { class: 'section-label', text: 'Основний телефон' }) : null,
    phoneList,
    status,
    el('div', { class: 'actions' }, createBtn),
    el('div', { class: 'foot', text: 'Дані беруться з відкритої картки робочої CRM' }));

  // Чи є вже заняття в EduCRM
  const info = client.phones.length ? await EDU.findUpcoming(client.phones) : null;
  if (info) {
    const st = EDU.STATUS[info.status] || EDU.STATUS.pending;
    status.className = 'card status has';
    status.replaceChildren(
      el('span', { class: 'status-ico' }, icon(info.isGroup ? 'users' : 'calendar', 17)),
      el('div', {},
        el('div', { class: 'status-title', text: EDU.fmtWhen(info) }),
        el('div', { class: 'status-sub', text: `${info.isGroup ? 'Групове · ' : ''}${st.label}${info.count > 1 ? ` · ще ${info.count - 1}` : ''}` })),
      el('a', { class: 'open', href: '#', onclick: e => { e.preventDefault(); openInApp(EDU.clientUrl(info.key)); } }, 'Картка →'));
  } else {
    status.replaceChildren(
      el('span', { class: 'status-ico' }, icon('calendar', 17)),
      el('div', {},
        el('div', { class: 'status-title', text: 'Майбутніх занять немає' }),
        el('div', { class: 'status-sub', text: 'Запишіть клієнта кнопкою нижче' })),
      client.phones.length ? el('a', { class: 'open', href: '#', onclick: e => { e.preventDefault(); openInApp(EDU.clientUrl(EDU.phoneKey(selected) || EDU.digits(selected))); } }, 'Картка →') : null);
  }
}

init();

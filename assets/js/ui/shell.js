// ============================================================
//  ui/shell.js — спільний каркас: бокове меню + верхня панель.
//
//  Використання на сторінці:
//    const staff = await initShell({ page: 'teachers', title: '…',
//                                    subtitle: '…', actions: html`…` });
//  Каркас малюється одразу, а промис повертає профіль
//  співробітника після перевірки входу.
// ============================================================

import { html, render, initials } from '../core/dom.js';
import { requireStaff, cachedStaff, logout } from '../core/auth.js';
import { icon } from './icons.js';
import { initNotifications } from './notifications.js';
import { db, ref, onValue } from '../core/firebase.js';

export const NAV = [
  { group: 'Робота', items: [
    { id: 'calendar',  href: './',     label: 'Календар',     icon: 'calendar' },
    { id: 'confirmed', href: 'confirmed', label: 'Підтверджені', icon: 'check-square' },
    { id: 'completed', href: 'completed', label: 'Завершені',    icon: 'check-circle' },
  ]},
  { group: 'Клієнти', items: [
    { id: 'clients',   href: 'clients',   label: 'Клієнти',          icon: 'users' },
    { id: 'contracts', href: 'contracts', label: 'Договори',         icon: 'file-text' },
    { id: 'openday',   href: 'openday',   label: 'Відкритий захід',  icon: 'sparkles' },
  ]},
  { group: 'Фінанси', items: [
    { id: 'stats',     href: 'stats',     label: 'Статистика',   icon: 'bar-chart' },
  ]},
  { group: 'Налаштування', items: [
    { id: 'teachers',  href: 'teachers',  label: 'Вчителі та ставки', icon: 'graduation-cap' },
    { id: 'schedule',  href: 'schedule',  label: 'Графік роботи',     icon: 'clock' },
    { id: 'tags',      href: 'tags',      label: 'Теги',              icon: 'tag' },
  ]},
];

const COLLAPSE_KEY = 'educrm.sidebarCollapsed';

export function initShell({ page, title, subtitle = '', actions = '', back = null }) {
  document.body.dataset.page = page;

  const sidebar = document.getElementById('sidebar');
  render(sidebar, html`
    <div class="sb-head">
      <a href="./" class="sb-logo" aria-label="EduCRM — на головну">${icon('graduation-cap', 18)}</a>
      <span class="sb-brand">EduCRM</span>
      <button class="sb-collapse" id="sb-collapse" aria-label="Згорнути меню" title="Згорнути меню">${icon('chevrons-left', 16)}</button>
    </div>
    <nav class="sb-nav" aria-label="Розділи">
      ${NAV.map(g => html`
        <div class="sb-group">
          <div class="sb-group-label">${g.group}</div>
          ${g.items.map(it => html`
            <a class="sb-link ${it.id === page ? 'active' : ''}" href="${it.href}" data-label="${it.label}"
               ${it.id === page ? html`aria-current="page"` : ''}>
              ${icon(it.icon, 18)}<span>${it.label}</span>
            </a>`)}
        </div>`)}
    </nav>
    <div class="sb-foot">
      <div class="sb-user">
        <span class="avatar" id="sb-avatar">…</span>
        <div class="sb-user-info">
          <div class="sb-user-name" id="sb-name">&nbsp;</div>
          <div class="sb-user-email" id="sb-email">&nbsp;</div>
        </div>
        <button class="icon-btn" id="sb-logout" aria-label="Вийти" title="Вийти">${icon('log-out', 17)}</button>
      </div>
    </div>`);

  const topbar = document.getElementById('topbar');
  render(topbar, html`
    ${back ? html`<a class="icon-btn topbar-back" href="${back.href}" title="${back.label}" aria-label="${back.label}">${icon('chevron-left', 18)}</a>` : ''}
    <div class="topbar-title" id="topbar-title">
      <h1>${title}</h1>
      ${subtitle ? html`<p>${subtitle}</p>` : ''}
    </div>
    <div class="topbar-actions">
      <div id="page-actions" style="display:flex;gap:8px">${actions}</div>
      <div>
        <button class="icon-btn bell" id="bell" aria-label="Сповіщення" title="Відгуки клієнтів">${icon('bell')}</button>
      </div>
    </div>`);

  // Згортання меню (стан запам'ятовується)
  document.getElementById('sb-collapse').addEventListener('click', () => {
    const collapsed = document.documentElement.classList.toggle('sb-collapsed');
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : ''); } catch {}
  });
  document.getElementById('sb-logout').addEventListener('click', logout);

  // Тінь під верхньою панеллю при прокрутці
  const onScroll = () => topbar.classList.toggle('scrolled', scrollY > 4);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const cached = cachedStaff();
  if (cached) setUser(cached);

  return requireStaff().then(staff => {
    setUser(staff);
    initNotifications(document.getElementById('bell'), staff);
    watchConnection();
    return staff;
  });
}

/** Змінити заголовок сторінки після завантаження даних (напр. ім'я клієнта). */
export function setPageTitle(title, subtitle = '') {
  render(document.getElementById('topbar-title'), html`<h1>${title}</h1>${subtitle ? html`<p>${subtitle}</p>` : ''}`);
  document.title = `${title} — EduCRM`;
}

function setUser({ name, email, photoURL }) {
  const av = document.getElementById('sb-avatar');
  if (photoURL) render(av, html`<img src="${photoURL}" alt="" referrerpolicy="no-referrer">`);
  else av.textContent = initials(name);
  document.getElementById('sb-name').textContent = name;
  document.getElementById('sb-email').textContent = email;
}

// Плашка «Немає з'єднання» — з'являється, лише якщо зв'язку немає довше кількох секунд
function watchConnection() {
  let timer = null, pill = null;
  onValue(ref(db, '.info/connected'), snap => {
    clearTimeout(timer);
    if (snap.val() === true) { pill?.remove(); pill = null; return; }
    timer = setTimeout(() => {
      if (pill) return;
      pill = document.createElement('div');
      pill.className = 'offline-pill';
      pill.setAttribute('role', 'status');
      render(pill, html`${icon('alert-triangle', 16)} Немає з'єднання — зміни збережуться, щойно зв'язок відновиться`);
      document.body.append(pill);
    }, 4000);
  });
}

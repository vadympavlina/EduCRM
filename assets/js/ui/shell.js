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
import './loader.js';
import { db, ref, onValue } from '../core/firebase.js';

export const NAV = [
  { group: 'Робота', items: [
    { id: 'calendar',  href: './',     label: 'Календар',     icon: 'calendar' },
    { id: 'confirmed', href: 'confirmed', label: 'Підтверджені', short: 'Заняття', icon: 'check-square' },
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
  { group: 'Налаштування', bottom: true, items: [
    { id: 'teachers',  href: 'teachers',  label: 'Вчителі та ставки', icon: 'graduation-cap' },
    { id: 'schedule',  href: 'schedule',  label: 'Графік роботи',     icon: 'clock' },
    { id: 'tags',      href: 'tags',      label: 'Теги',              icon: 'tag' },
  ]},
];

const ALL = NAV.flatMap(g => g.items);
const TABS = ['calendar', 'confirmed', 'clients', 'stats'];
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

// ── Швидкий перехід (Ctrl/⌘ + K) ─────────────────────────────
function openPalette() {
  if (document.getElementById('palette')) return;
  const items = [
    ...ALL.map(it => ({ ...it, group: 'Перейти' })),
    { id: 'theme', label: 'Змінити тему', icon: 'moon', group: 'Вигляд', run: toggleTheme },
    { id: 'logout', label: 'Вийти з акаунта', icon: 'log-out', group: 'Акаунт', run: logout },
  ];
  const dlg = document.createElement('dialog');
  dlg.className = 'dialog palette';
  dlg.id = 'palette';
  render(dlg, html`
    <div class="palette-search">${icon('search', 18)}
      <input id="palette-q" placeholder="Куди перейти?" autocomplete="off" aria-label="Швидкий перехід"><kbd>Esc</kbd></div>
    <div class="palette-list" id="palette-list" role="listbox"></div>`);
  document.body.append(dlg);
  const input = dlg.querySelector('#palette-q'), list = dlg.querySelector('#palette-list');
  let shown = items, idx = 0;
  const draw = () => {
    render(list, shown.length ? shown.map((it, i) => html`
      <button type="button" class="palette-item ${i === idx ? 'active' : ''}" data-i="${i}" role="option" aria-selected="${i === idx}">
        ${icon(it.icon, 18)}<span>${it.label}</span><small>${it.group}</small>${i === idx ? icon('corner-down-left', 14) : ''}
      </button>`) : html`<div class="palette-empty">Нічого не знайдено</div>`);
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  };
  const go = it => {
    if (!it) return;
    dlg.close();
    if (it.run) it.run();
    else if (it.id !== page) { document.documentElement.classList.add('is-leaving'); location.href = it.href; }
  };
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    shown = items.filter(it => it.label.toLowerCase().includes(q)); idx = 0; draw();
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx + 1, shown.length - 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx - 1, 0); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); go(shown[idx]); }
  });
  list.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) go(shown[+b.dataset.i]); });
  list.addEventListener('mousemove', e => { const b = e.target.closest('[data-i]'); if (b && +b.dataset.i !== idx) { idx = +b.dataset.i; list.querySelectorAll('.palette-item').forEach((el, i) => el.classList.toggle('active', i === idx)); } });
  dlg.addEventListener('mousedown', e => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => dlg.remove());
  draw();
  dlg.showModal();
  input.focus();
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('educrm.theme', next); } catch {}
}

const GROUPS_KEY = 'educrm.navClosed';
function navClosed() {
  try { return new Set(JSON.parse(localStorage.getItem(GROUPS_KEY)) || (['Налаштування'])); } catch { return new Set(); }
}

// Підказка для згорнутого меню: окремий fixed-елемент, бо .sb-nav обрізає все, що виходить за межі
function initNavTips(sidebar) {
  let tip = null;
  const hide = () => { tip?.remove(); tip = null; };
  const show = el => {
    if (!document.documentElement.classList.contains('sb-collapsed') || innerWidth <= 900) return;
    hide();
    tip = document.createElement('div');
    tip.className = 'sb-tip';
    tip.setAttribute('role', 'tooltip');
    tip.textContent = el.dataset.label;
    document.body.append(tip);
    const r = el.getBoundingClientRect();
    tip.style.left = r.right + 10 + 'px';
    tip.style.top = r.top + r.height / 2 + 'px';
  };
  sidebar.addEventListener('mouseover', e => { const a = e.target.closest('.sb-link'); if (a) show(a); else hide(); });
  sidebar.addEventListener('focusin', e => { const a = e.target.closest('.sb-link'); if (a) show(a); });
  sidebar.addEventListener('mouseleave', hide);
  sidebar.addEventListener('focusout', hide);
  sidebar.addEventListener('click', hide);
  sidebar.querySelector('.sb-nav').addEventListener('scroll', hide, { passive: true });
}

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
    <button class="sb-find" id="sb-find" type="button" title="Швидкий перехід (Ctrl+K)">
      ${icon('search', 16)}<span>Швидкий перехід</span><kbd>${isMac ? '⌘K' : 'Ctrl K'}</kbd>
    </button>
    <nav class="sb-nav" aria-label="Розділи">
      ${NAV.map(g => {
        const hasActive = g.items.some(it => it.id === page);
        const closed = !hasActive && navClosed().has(g.group);
        return html`
        <div class="sb-group ${g.bottom ? 'bottom' : ''} ${closed ? 'closed' : ''}" data-group="${g.group}">
          <button class="sb-group-label" type="button" aria-expanded="${!closed}">
            <span>${g.group}</span>${icon('chevron-down', 14)}
          </button>
          <div class="sb-group-items">
            ${g.items.map(it => html`
              <a class="sb-link ${it.id === page ? 'active' : ''}" href="${it.href}" data-label="${it.label}"
                 ${it.id === page ? html`aria-current="page"` : ''}>
                <span class="sb-ico">${icon(it.icon, 18)}</span><span class="sb-text">${it.label}</span>
              </a>`)}
          </div>
        </div>`; })}
    </nav>
    <div class="sb-foot">
      <div class="sb-user">
        <span class="avatar" id="sb-avatar">…</span>
        <div class="sb-user-info">
          <div class="sb-user-name" id="sb-name">&nbsp;</div>
          <div class="sb-user-email" id="sb-email">&nbsp;</div>
        </div>
        <button class="icon-btn theme-btn" id="sb-theme" aria-label="Змінити тему" title="Світла / темна тема"><span class="t-moon">${icon('moon', 17)}</span><span class="t-sun">${icon('sun', 17)}</span></button>
        <button class="icon-btn" id="sb-logout" aria-label="Вийти" title="Вийти">${icon('log-out', 17)}</button>
      </div>
    </div>`);

  const topbar = document.getElementById('topbar');
  render(topbar, html`
    <button class="icon-btn topbar-menu" id="tb-menu" aria-label="Меню" aria-controls="sidebar">${icon('menu', 20)}</button>
    ${back ? html`<a class="icon-btn topbar-back" href="${back.href}" title="${back.label}" aria-label="${back.label}">${icon('chevron-left', 18)}</a>` : ''}
    <div class="topbar-title" id="topbar-title">
      <h1>${title}</h1>
      ${subtitle ? html`<p>${subtitle}</p>` : ''}
    </div>
    <div class="topbar-actions">
      <div id="page-actions" class="page-actions">${actions}</div>
      <div class="bell-wrap">
        <button class="icon-btn bell" id="bell" aria-label="Сповіщення" title="Відгуки клієнтів">${icon('bell')}</button>
      </div>
    </div>`);

  // Нижня навігація та шторка меню для телефона
  const app = document.querySelector('.app');
  const tabs = document.createElement('nav');
  tabs.className = 'tabbar';
  tabs.setAttribute('aria-label', 'Основна навігація');
  render(tabs, html`
    ${TABS.map(id => { const it = ALL.find(x => x.id === id); return html`
      <a class="tab ${id === page ? 'active' : ''}" href="${it.href}" ${id === page ? html`aria-current="page"` : ''}>${icon(it.icon, 22)}<span>${it.short || it.label}</span></a>`; })}
    <button class="tab" id="tab-more" type="button" aria-label="Усі розділи">${icon('menu', 22)}<span>Меню</span></button>`);
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  app.append(tabs, scrim);

  const root = document.documentElement;
  const closeNav = () => root.classList.remove('nav-open');
  const openNav = () => root.classList.add('nav-open');
  document.getElementById('tb-menu').addEventListener('click', openNav);
  document.getElementById('tab-more').addEventListener('click', openNav);
  scrim.addEventListener('click', closeNav);
  sidebar.addEventListener('click', e => { if (e.target.closest('.sb-link')) closeNav(); });
  document.getElementById('sb-find').addEventListener('click', () => { closeNav(); openPalette(); });
  addEventListener('keydown', e => {
    if (e.key === 'Escape') closeNav();
    if (e.key === '[' && !e.target.closest('input, textarea, select, [contenteditable]') && innerWidth > 900) document.getElementById('sb-collapse').click();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  });

  // Згортання меню (стан запам'ятовується)
  document.getElementById('sb-collapse').addEventListener('click', () => {
    const collapsed = document.documentElement.classList.toggle('sb-collapsed');
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : ''); } catch {}
  });
  document.getElementById('sb-logout').addEventListener('click', logout);
  initNavTips(sidebar);
  sidebar.addEventListener('click', e => {
    const label = e.target.closest('.sb-group-label');
    if (!label) return;
    const group = label.closest('.sb-group');
    const closed = group.classList.toggle('closed');
    label.setAttribute('aria-expanded', String(!closed));
    const set = navClosed();
    closed ? set.add(group.dataset.group) : set.delete(group.dataset.group);
    try { localStorage.setItem(GROUPS_KEY, JSON.stringify([...set])); } catch {}
  });
  document.getElementById('sb-theme').addEventListener('click', toggleTheme);

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

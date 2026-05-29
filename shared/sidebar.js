// ============================================================
//  shared/sidebar.js
//  Рендерить icon-only sidebar і позначає активний пункт.
//
//  Використання:
//    1. В <body> має бути <aside id="sidebar"></aside>
//    2. Підключи цей файл після firebase.js
//    3. Виклич: Sidebar.init('calendar')  ← назва активної сторінки
// ============================================================

const Sidebar = (() => {

  const NAV_ITEMS = [
    {
      page: 'calendar', href: 'index.html', tip: 'Календар',
      icon: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/>
        <line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
      </svg>`
    },
    {
      page: 'confirmed', href: 'confirmed.html', tip: 'Підтверджені',
      icon: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M9 11l3 3L22 4"/>
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
      </svg>`
    },
    {
      page: 'schedule', href: 'schedule.html', tip: 'Графік роботи',
      icon: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4"/>
      </svg>`
    },
    {
      page: 'completed', href: 'completed.html', tip: 'Завершені',
      icon: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>`
    },
    {
      page: 'stats', href: 'stats.html', tip: 'Статистика',
      icon: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <line x1="18" y1="20" x2="18" y2="10"/>
        <line x1="12" y1="20" x2="12" y2="4"/>
        <line x1="6" y1="20" x2="6" y2="14"/>
      </svg>`
    },
    { divider: true },
    {
      page: 'pricing', href: 'pricing.html', tip: 'Ціноутворення',
      icon: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <line x1="12" y1="1" x2="12" y2="23"/>
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
      </svg>`
    },
    {
      page: 'teachers', href: 'teachers.html', tip: 'Вчителі',
      icon: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>`
    },
    { divider: true },
    {
      page: 'clients', href: 'clients.html', tip: 'Клієнти',
      icon: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>`
    },
  ];

  const BOTTOM_ITEMS = [
    {
      id: 'btn-change-name', tip: '', isUser: true,
      icon: `<div class="sb-user-av" id="user-avatar-letter">?</div>`
    },
    {
      id: 'sb-logout-btn', tip: 'Вийти',
      icon: `<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
        <polyline points="16 17 21 12 16 7"/>
        <line x1="21" y1="12" x2="9" y2="12"/>
      </svg>`
    },
  ];

  function _item(html, cls = '') {
    return `<div class="sb-item ${cls}">${html}</div>`;
  }

  function render(activePage) {
    const aside = document.getElementById('sidebar');
    if (!aside) return;

    const navHTML = NAV_ITEMS.map(item => {
      if (item.divider) return `<div class="sb-divider"></div>`;
      const isActive = item.page === activePage ? 'active' : '';
      return `<a class="sb-item ${isActive}" href="${item.href}">
        ${item.icon}
        <span class="sb-tip">${item.tip}</span>
      </a>`;
    }).join('');

    aside.innerHTML = `
      <div class="sb-logo">
        <div class="sb-logo-icon">
          <svg width="20" height="20" fill="none" stroke="white" stroke-width="2.2" viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="18" rx="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
        </div>
      </div>
      <div class="sb-divider"></div>
      <nav class="sb-nav">${navHTML}</nav>
      <div class="sb-bottom">
        <div class="sb-divider"></div>
        <div class="sb-item sb-user-item">
          <div class="sb-user-av" id="user-avatar-letter">?</div>
          <span class="sb-tip" id="user-name-display">—</span>
        </div>
        <button class="sb-item sb-logout" id="btn-change-name" aria-label="Вийти">
          <svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          <span class="sb-tip">Вийти</span>
        </button>
      </div>
      <span id="user-email-display" style="display:none"></span>
    `;
  }

  function init(activePage) {
    document.addEventListener('DOMContentLoaded', () => render(activePage));
  }

  // Якщо DOMContentLoaded вже спрацював — рендеримо одразу
  function initNow(activePage) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => render(activePage));
    } else {
      render(activePage);
    }
  }

  return { init, initNow, render };
})();

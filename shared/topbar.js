// ============================================================
//  shared/topbar.js
//  Додає дзвіночок сповіщень і каунтери на будь-яку сторінку.
//
//  Підключай після firebase.js, auth.js
//  auth.js викличе onAuthReady() → Topbar.init() стартує
//
//  Потребує в <head>: styles.css (для .tbar-bell, .notif-*)
// ============================================================

const Topbar = (() => {

  let _allReviews  = {};
  let _notifReads  = {};
  let _events      = {};
  let _appInitTime = Date.now();

  // ── INJECT HTML ───────────────────────────────────────────
  function _injectHTML() {
    // 1. Bell button — append to first .topbar
    const topbar = document.querySelector('.topbar');
    if (topbar && !document.getElementById('btn-notif-bell')) {
      const bellHTML = `
        <div class="tbar-spacer" style="flex:1"></div>
        <button class="tbar-bell" id="btn-notif-bell" onclick="Topbar.toggle()" title="Сповіщення">
          <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          <span class="tbar-bell-badge" id="notif-badge" style="display:none">0</span>
        </button>`;
      topbar.insertAdjacentHTML('beforeend', bellHTML);
    }

    // 2. Counters bar — inject between sidebar and page-wrap if not index
    if (!document.getElementById('topbar-counters') && !document.getElementById('calendar')) {
      const pageWrap = document.querySelector('.page-wrap');
      if (pageWrap) {
        const countersHTML = `
          <div class="topbar-counters" id="topbar-counters" style="flex-shrink:0">
            <button class="tbar-item" onclick="window.location.href='index.html'">
              <span class="tbar-icon tbar-icon-today">
                <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                  <rect x="3" y="4" width="18" height="18" rx="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              </span>
              <span class="tbar-value" id="cnt-today">—</span>
              <span class="tbar-label">Сьогодні</span>
            </button>
            <div class="tbar-divider"></div>
            <button class="tbar-item" onclick="window.location.href='completed.html'">
              <span class="tbar-icon tbar-icon-completed">
                <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
              </span>
              <span class="tbar-value" id="cnt-completed">—</span>
              <span class="tbar-label">Проведено (міс.)</span>
            </button>
            <div class="tbar-divider"></div>
            <button class="tbar-item" onclick="window.location.href='stats.html'">
              <span class="tbar-icon tbar-icon-contracts">
                <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="9" y1="13" x2="15" y2="13"/>
                  <line x1="9" y1="17" x2="13" y2="17"/>
                </svg>
              </span>
              <span class="tbar-value" id="cnt-contracts">—</span>
              <span class="tbar-label">Договорів (міс.)</span>
            </button>
            <div class="tbar-divider"></div>
            <button class="tbar-item">
              <span class="tbar-icon tbar-icon-cancelled">
                <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="15" y1="9" x2="9" y2="15"/>
                  <line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
              </span>
              <span class="tbar-value" id="cnt-cancelled">—</span>
              <span class="tbar-label">Скасовано (міс.)</span>
            </button>
          </div>`;
        pageWrap.insertAdjacentHTML('afterbegin', countersHTML);
      }
    }

    // 3. Notification overlay + panel
    if (!document.getElementById('notif-panel')) {
      document.body.insertAdjacentHTML('beforeend', `
        <div id="notif-overlay" class="notif-overlay" onclick="Topbar.close()"></div>
        <div id="notif-panel" class="notif-panel">
          <div class="notif-panel-header">
            <div class="notif-panel-title">
              <svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              Сповіщення
            </div>
            <button class="notif-panel-close" onclick="Topbar.close()" aria-label="Закрити">
              <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <div id="notif-list" class="notif-list">
            <div class="notif-empty">Поки що відгуків немає</div>
          </div>
        </div>`);
    }
  }

  // ── LISTENERS ─────────────────────────────────────────────
  function _listenEvents() {
    db.ref('events').on('value', snap => {
      _events = {};
      if (snap.exists()) {
        snap.forEach(c => { _events[c.key] = { id: c.key, ...c.val() }; });
      }
      _renderCounters();
    });
  }

  function _listenReviews() {
    const managerKey = currentUser.replace(/[.#$[\]]/g, '_');

    db.ref('notifReads/' + managerKey).on('value', snap => {
      _notifReads = snap.val() || {};
      _renderBadge();
      _renderPanel();
    });

    db.ref('reviews').on('child_added', snap => {
      const review = { id: snap.key, ...snap.val() };
      _allReviews[snap.key] = review;
      if (review.createdAt > _appInitTime && !_notifReads[snap.key]) {
        _playBloop();
      }
      _renderBadge();
      _renderPanel();
    });
  }

  // ── COUNTERS ──────────────────────────────────────────────
  function _renderCounters() {
    const today    = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const monthStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;

    let cntToday = 0, cntCompleted = 0, cntContracts = 0, cntCancelled = 0;
    Object.values(_events).forEach(ev => {
      if (ev.date === todayStr && ev.status !== 'cancelled') cntToday++;
      if (ev.status === 'completed' && ev.date?.startsWith(monthStr)) {
        cntCompleted++;
        if (ev.contractSigned) cntContracts++;
      }
      if (ev.status === 'cancelled' && ev.date?.startsWith(monthStr)) cntCancelled++;
    });

    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    set('cnt-today',     cntToday);
    set('cnt-completed', cntCompleted);
    set('cnt-contracts', cntContracts);
    set('cnt-cancelled', cntCancelled);
  }

  // ── BADGE ─────────────────────────────────────────────────
  function _renderBadge() {
    const unread = Object.keys(_allReviews).filter(id => !_notifReads[id]).length;
    const badge  = document.getElementById('notif-badge');
    const bell   = document.getElementById('btn-notif-bell');
    if (badge) {
      badge.textContent   = unread > 9 ? '9+' : String(unread);
      badge.style.display = unread > 0 ? 'flex' : 'none';
    }
    if (bell) bell.classList.toggle('has-unread', unread > 0);
    _updateFavicon(unread > 0);
  }

  // ── PANEL ─────────────────────────────────────────────────
  function _renderPanel() {
    const list = document.getElementById('notif-list');
    if (!list) return;

    const reviews = Object.values(_allReviews).sort((a, b) => b.createdAt - a.createdAt);
    if (reviews.length === 0) {
      list.innerHTML = '<div class="notif-empty">Поки що відгуків немає</div>';
      return;
    }

    list.innerHTML = reviews.map(r => {
      const isRead = !!_notifReads[r.id];
      const time   = new Date(r.createdAt).toLocaleString('uk-UA',
        { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
      const safeTitle   = (r.eventTitle || 'Захід').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const safeComment = (r.comment || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const ev    = _events[r.id];
      const phone = ev ? _normalizePhone(ev.phone) : null;
      const url   = phone ? `client.html?id=${encodeURIComponent(phone)}` : null;
      return `
        <div class="notif-item ${isRead ? 'read' : 'unread'}"
             onmouseenter="Topbar.markRead('${r.id}')"
             style="${url ? 'cursor:pointer' : ''}"
             onclick="${url ? `window.open('${url}','_blank')` : ''}">
          <div class="notif-item-icon">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <div class="notif-item-body">
            <div class="notif-item-title">${safeTitle}</div>
            <div class="notif-item-text">${safeComment}</div>
            <div class="notif-item-time">${time}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
            ${!isRead ? '<div class="notif-dot"></div>' : ''}
            ${url ? `<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" style="color:var(--accent);opacity:0.7"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>` : ''}
          </div>
        </div>`;
    }).join('');
  }

  // ── HELPERS ───────────────────────────────────────────────
  function _normalizePhone(p) {
    if (!p) return null;
    const d = p.replace(/\D/g, '');
    return d.length >= 9 ? d : null;
  }

  function _updateFavicon(hasUnread) {
    const links = document.querySelectorAll('link[rel="icon"]');
    const link  = links[links.length - 1];
    if (!link) return;
    link.href = hasUnread
      ? "data:image/svg+xml," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#4f6ef7'/><stop offset='1' stop-color='#3b5be8'/></linearGradient></defs><rect width='32' height='32' rx='9' fill='url(#g)'/><rect x='7' y='9' width='11' height='2.5' rx='1.25' fill='white'/><rect x='7' y='14.75' width='18' height='2.5' rx='1.25' fill='white'/><rect x='7' y='20.5' width='8' height='2.5' rx='1.25' fill='white'/><circle cx='26' cy='7' r='6' fill='#dc2626'/><text x='26' y='11' font-family='Arial' font-size='9' font-weight='bold' fill='white' text-anchor='middle'>!</text></svg>`)
      : "data:image/svg+xml," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#4f6ef7'/><stop offset='1' stop-color='#3b5be8'/></linearGradient></defs><rect width='32' height='32' rx='9' fill='url(#g)'/><rect x='7' y='9' width='11' height='2.5' rx='1.25' fill='white'/><rect x='7' y='14.75' width='18' height='2.5' rx='1.25' fill='white'/><rect x='7' y='20.5' width='8' height='2.5' rx='1.25' fill='white'/></svg>`);
  }

  function _playBloop() {
    try {
      const ctx  = new (window.AudioContext || window.webkitAudioContext)();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(420, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
      osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.22);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.45);
      setTimeout(() => ctx.close(), 700);
    } catch (e) {}
  }

  // ── PUBLIC API ────────────────────────────────────────────
  function init() {
    _injectHTML();
    _listenEvents();
    _listenReviews();
  }

  function toggle() {
    const panel   = document.getElementById('notif-panel');
    const overlay = document.getElementById('notif-overlay');
    if (!panel || !overlay) return;
    const isOpen = panel.classList.contains('open');
    panel.classList.toggle('open', !isOpen);
    overlay.classList.toggle('open', !isOpen);
  }

  function close() {
    document.getElementById('notif-panel')?.classList.remove('open');
    document.getElementById('notif-overlay')?.classList.remove('open');
  }

  function markRead(eventId) {
    const managerKey = currentUser.replace(/[.#$[\]]/g, '_');
    db.ref('notifReads/' + managerKey + '/' + eventId).set(true);
  }

  return { init, toggle, close, markRead };
})();

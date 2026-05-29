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
  let _appInitTime = Date.now();

  // ── INJECT HTML ───────────────────────────────────────────
  function _injectHTML() {
    // 1. Bell button — insert before closing </header> of .topbar
    const topbar = document.querySelector('.topbar');
    if (topbar && !document.getElementById('btn-notif-bell')) {
      // Remove any existing tbar-spacer so bell goes after controls
      const bellHTML = `<button class="tbar-bell" id="btn-notif-bell" onclick="Topbar.toggle()" title="Сповіщення" style="margin-left:auto;flex-shrink:0">
          <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          <span class="tbar-bell-badge" id="notif-badge" style="display:none">0</span>
        </button>`;
      topbar.insertAdjacentHTML('beforeend', bellHTML);
    }

    // 2. Notification overlay + panel
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

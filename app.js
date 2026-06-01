// ============================================================
//  APP.JS — Internal Event Management CRM (Realtime Database)
//  Vanilla JS, no ES modules — works on GitHub Pages
// ============================================================

// ── TELEGRAM CONFIG ──────────────────────────────────────────
const TELEGRAM = {
  BOT_TOKEN: '',
  CHAT_ID:   '-1003992712563'
};

// ── SITE URL — замін на свій GitHub Pages домен ──────────────
const SITE_URL = 'https://vadympavlina.github.io/EduCRM';

function loadConfig() {
  return db.ref('settings/telegramToken').once('value').then(snap => {
    if (snap.exists()) {
      TELEGRAM.BOT_TOKEN = snap.val();
      console.log('Конфігурація Telegram завантажена');
    } else {
      console.error('Токен не знайдено в Firebase!');
    }
  });
}

// ── STATE ────────────────────────────────────────────────────
let currentUser     = '';
let currentEmail    = '';
let currentPhotoURL = '';
let events       = {};
let teachers     = {};
let pricing      = { default: { baseReward: 50, contractBonus: 100 }, overrides: {} };
let blockedTimes = {};
let busySlots     = {};
let calendarInstance = null;
let confirmCallback  = null;
let allReviews  = {};
let notifReads  = {};
const appInitTime = Date.now();

// ── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupNav();
  setupHamburger();

  // Поки перевіряється авторизація — крутиться лоадер
  auth.onAuthStateChanged(async (firebaseUser) => {
    const loader = document.getElementById('auth-loader');

    if (firebaseUser) {
      try {
        const snap = await db.ref('users').orderByChild('email')
          .equalTo(firebaseUser.email.toLowerCase()).once('value');
        const data = snap.val();

        if (!data) {
          await auth.signOut();
          loader.style.display = 'none';
          showLoginModal(true);
          showLoginError('Цей акаунт не має доступу до системи');
          return;
        }

        const uid  = Object.keys(data)[0];
        const user = data[uid];

        currentUser     = user.name || firebaseUser.displayName || firebaseUser.email;
        currentEmail    = firebaseUser.email;
        currentPhotoURL = firebaseUser.photoURL || '';

        loader.style.display = 'none';
        renderUserInfo();
        startApp();
      } catch (err) {
        console.error('Помилка перевірки юзера:', err);
        loader.style.display = 'none';
        showLoginModal(true);
        showLoginError('Помилка підключення. Спробуйте ще раз.');
      }
    } else {
      loader.style.display = 'none';
      showLoginModal(true);
    }
  });
});

async function startApp() {
  try { await loadConfig(); } catch (error) { console.error("Помилка завантаження токена:", error); }

  // Request browser notification permission
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  initPresence();
  initOfflineIndicator();
  listenTeachers();
  listenPricing();
  listenEvents();
  listenBlockedTimes();
  listenBusySlots();
  listenReviews();

  setTimeout(initCalendar, 200);
}

// ── PRESENCE (ОНЛАЙН СТАТУС) ─────────────────────────────────
// ── OFFLINE INDICATOR ────────────────────────────────────────
function initOfflineIndicator() {
  db.ref('.info/connected').on('value', snap => {
    const isOnline = snap.val() === true;
    let bar = document.getElementById('offline-bar');

    if (!isOnline) {
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'offline-bar';
        bar.innerHTML = `
          <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
            <line x1="1" y1="1" x2="23" y2="23"/>
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
            <path d="M10.71 5.05A16 16 0 0 1 22.56 9"/>
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
            <line x1="12" y1="20" x2="12.01" y2="20"/>
          </svg>
          Немає з'єднання з сервером`;
        bar.style.cssText = [
          'position:fixed', 'bottom:0', 'left:0', 'right:0', 'z-index:9998',
          'background:#1e293b', 'color:#f8fafc',
          'display:flex', 'align-items:center', 'justify-content:center', 'gap:8px',
          'padding:10px 16px', 'font-size:13px', 'font-weight:600',
          'transition:transform 0.3s ease',
          'transform:translateY(100%)'
        ].join(';');
        document.body.appendChild(bar);
      }
      requestAnimationFrame(() => { bar.style.transform = 'translateY(0)'; });
    } else {
      if (bar) {
        bar.style.transform = 'translateY(100%)';
        setTimeout(() => bar?.remove(), 350);
      }
    }
  });
}

function initPresence() {
  if (!currentUser) return;
  
  const safeKey = currentUser.replace(/[.#$[\]]/g, '_');
  const myPresenceRef = db.ref('presence/' + safeKey);
  
  const updatePresence = (isActive) => {
    myPresenceRef.set({
      name: currentUser,
      active: isActive,
      updatedAt: firebase.database.ServerValue.TIMESTAMP
    });
  };

  window.addEventListener('focus', () => updatePresence(true));
  window.addEventListener('blur',  () => updatePresence(false));
  myPresenceRef.onDisconnect().remove();
  updatePresence(document.hasFocus());

  db.ref('presence').on('value', snap => {
    const data = snap.val() || {};
    renderPresence(data);
  });
}

function renderPresence(data) {
  const now = Date.now();
  let html = '';
  let zIndexCount = 50;
  
  Object.values(data).forEach(user => {
    if (!user.active && now - user.updatedAt > 2 * 60 * 60 * 1000) return;
    
    const initial = user.name ? user.name.charAt(0).toUpperCase() : '?';
    const statusClass = user.active ? 'active' : 'inactive';
    const statusText = user.active ? 'Онлайн' : 'Відійшов';
    
    html += `
      <div class="presence-avatar" style="z-index: ${zIndexCount--}">
        <div class="presence-initial">${initial}</div>
        <span class="presence-name">${user.name} (${statusText})</span>
        <div class="presence-dot ${statusClass}"></div>
      </div>
    `;
  });

  document.querySelectorAll('.page-header-left').forEach(header => {
    let container = header.querySelector('.presence-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'presence-container';
      header.appendChild(container);
    }
    container.innerHTML = html;
  });
}

// ── NOTIFICATIONS (Відгуки) ───────────────────────────────
function listenReviews() {
  const managerKey = currentUser.replace(/[.#$[\]]/g, '_');

  // Read-стан цього менеджера (real-time)
  db.ref('notifReads/' + managerKey).on('value', snap => {
    notifReads = snap.val() || {};
    renderNotifBadge();
    renderNotifPanel();
  });

  // Всі відгуки — child_added спрацьовує і для існуючих, і для нових
  db.ref('reviews').on('child_added', snap => {
    const review = { id: snap.key, ...snap.val() };
    allReviews[snap.key] = review;

    // Справді новий відгук (прийшов поки застосунок відкритий і не прочитаний)
    if (review.createdAt > appInitTime && !notifReads[snap.key]) {
      playBloop();
      showBrowserNotification(review);
    }

    renderNotifBadge();
    renderNotifPanel();
  });
}

function markNotifRead(eventId) {
  const managerKey = currentUser.replace(/[.#$[\]]/g, '_');
  db.ref('notifReads/' + managerKey + '/' + eventId).set(true);
}

function toggleNotifPanel() {
  const panel   = document.getElementById('notif-panel');
  const overlay = document.getElementById('notif-overlay');
  if (!panel || !overlay) return;
  const isOpen = panel.classList.contains('open');
  panel.classList.toggle('open', !isOpen);
  overlay.classList.toggle('open', !isOpen);
}

function closeNotifPanel() {
  document.getElementById('notif-panel')?.classList.remove('open');
  document.getElementById('notif-overlay')?.classList.remove('open');
}

function renderNotifBadge() {
  const unread = Object.keys(allReviews).filter(id => !notifReads[id]).length;
  const badge  = document.getElementById('notif-badge');
  const bell   = document.getElementById('btn-notif-bell');
  if (!badge || !bell) return;
  badge.textContent   = unread > 9 ? '9+' : String(unread);
  badge.style.display = unread > 0 ? 'flex' : 'none';
  bell.classList.toggle('has-unread', unread > 0);
  updateFavicon(unread > 0);
}

function renderNotifPanel() {
  const list = document.getElementById('notif-list');
  if (!list) return;

  const reviews = Object.values(allReviews).sort((a, b) => b.createdAt - a.createdAt);

  if (reviews.length === 0) {
    list.innerHTML = '<div class="notif-empty">Поки що відгуків немає</div>';
    return;
  }

  list.innerHTML = reviews.map(r => {
    const isRead = !!notifReads[r.id];
    const d      = new Date(r.createdAt);
    const time   = d.toLocaleString('uk-UA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    const safeTitle   = (r.eventTitle || 'Захід').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeComment = (r.comment    || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const ev = events[r.id];
    const phone = ev ? normalizePhone(ev.phone) : null;
    const clientUrl = phone ? `client.html?id=${encodeURIComponent(phone)}` : null;
    return `
      <div class="notif-item ${isRead ? 'read' : 'unread'}"
           onmouseenter="markNotifRead('${r.id}')"
           style="${clientUrl ? 'cursor:pointer' : ''}"
           onclick="${clientUrl ? `window.open('${clientUrl}','_blank')` : ''}">
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
          ${clientUrl ? `<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" style="color:var(--accent);opacity:0.7"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>` : ''}
        </div>
      </div>`;
  }).join('');
}

function updateFavicon(hasUnread) {
  const links = document.querySelectorAll('link[rel="icon"]');
  const link  = links[links.length - 1];
  if (!link) return;
  if (hasUnread) {
    link.href = "data:image/svg+xml," + encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>
        <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
          <stop offset='0' stop-color='#4f6ef7'/><stop offset='1' stop-color='#3b5be8'/>
        </linearGradient></defs>
        <rect width='32' height='32' rx='9' fill='url(#g)'/>
        <rect x='7' y='9' width='11' height='2.5' rx='1.25' fill='white'/>
        <rect x='7' y='14.75' width='18' height='2.5' rx='1.25' fill='white'/>
        <rect x='7' y='20.5' width='8' height='2.5' rx='1.25' fill='white'/>
        <circle cx='26' cy='7' r='6' fill='#dc2626'/>
        <text x='26' y='11' font-family='Arial' font-size='9' font-weight='bold' fill='white' text-anchor='middle'>!</text>
      </svg>`
    );
  } else {
    link.href = "data:image/svg+xml," + encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>
        <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
          <stop offset='0' stop-color='#4f6ef7'/><stop offset='1' stop-color='#3b5be8'/>
        </linearGradient></defs>
        <rect width='32' height='32' rx='9' fill='url(#g)'/>
        <rect x='7' y='9' width='11' height='2.5' rx='1.25' fill='white'/>
        <rect x='7' y='14.75' width='18' height='2.5' rx='1.25' fill='white'/>
        <rect x='7' y='20.5' width='8' height='2.5' rx='1.25' fill='white'/>
      </svg>`
    );
  }
}

function showBrowserNotification(review) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const title = review.eventTitle || 'Новий відгук';
  const body  = review.comment   || '';
  const ev    = events[review.id];
  const phone = ev ? (ev.phone || '').replace(/\D/g, '') : '';
  const url   = phone.length >= 9
    ? `${location.origin}${location.pathname.replace(/[^/]+$/, '')}client.html?id=${encodeURIComponent(phone)}`
    : null;

  const notif = new Notification('EduCRM — Новий відгук', {
    body:    `${title}\n${body}`,
    icon:    "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='%234f6ef7'/><stop offset='1' stop-color='%233b5be8'/></linearGradient></defs><rect width='32' height='32' rx='9' fill='url(%23g)'/><rect x='7' y='9' width='11' height='2.5' rx='1.25' fill='white'/><rect x='7' y='14.75' width='18' height='2.5' rx='1.25' fill='white'/><rect x='7' y='20.5' width='8' height='2.5' rx='1.25' fill='white'/></svg>",
    tag:     'educrm-review-' + review.id,
    silent:  false,
  });

  if (url) {
    notif.onclick = () => {
      window.open(url, '_blank');
      notif.close();
    };
  }

  // Auto-close after 8 seconds
  setTimeout(() => notif.close(), 8000);
}

function playBloop() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.22);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.45);
    setTimeout(() => ctx.close(), 700);
  } catch (e) {}
}

// ── LOGIN (Google Auth) ──────────────────────────────────────
function showLoginModal(required = false) {
  const overlay      = document.getElementById('name-modal');
  const stepGoogle   = document.getElementById('login-step-google');
  const stepConfirm  = document.getElementById('login-step-confirm');
  const errorEl      = document.getElementById('login-error');
  const googleBtn    = document.getElementById('btn-google-signin');

  stepGoogle.style.display  = '';
  stepConfirm.style.display = 'none';
  errorEl.style.display     = 'none';

  overlay.classList.add('open');

  let pendingGoogleUser = null;

  googleBtn.onclick = async () => {
    errorEl.style.display = 'none';
    googleBtn.disabled = true;
    googleBtn.style.opacity = '0.7';

    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      const result   = await auth.signInWithPopup(provider);
      const gUser    = result.user;

      // Перевіряємо чи є у БД
      const snap = await db.ref('users').orderByChild('email')
        .equalTo(gUser.email.toLowerCase()).once('value');
      const data = snap.val();

      googleBtn.disabled = false;
      googleBtn.style.opacity = '';

      if (!data) {
        await auth.signOut();
        showLoginError('Цей акаунт не має доступу до системи');
        return;
      }

      const uid  = Object.keys(data)[0];
      const user = data[uid];
      pendingGoogleUser = { gUser, dbUser: user };

      // Показуємо крок підтвердження
      stepGoogle.style.display  = 'none';
      stepConfirm.style.display = '';

      const avatar = document.getElementById('login-google-avatar');
      if (gUser.photoURL) { avatar.src = gUser.photoURL; avatar.style.display = 'block'; }
      else { avatar.style.display = 'none'; }

      document.getElementById('login-confirmed-name').textContent  = user.name || gUser.displayName;
      document.getElementById('login-confirmed-email').textContent = gUser.email;

      document.getElementById('login-confirm-btn').onclick = () => {
        currentUser     = user.name || gUser.displayName || gUser.email;
        currentEmail    = gUser.email;
        currentPhotoURL = gUser.photoURL || '';
        overlay.classList.remove('open');
        renderUserInfo();
        startApp();
      };

      document.getElementById('login-back-btn').onclick = async () => {
        await auth.signOut();
        pendingGoogleUser = null;
        stepGoogle.style.display  = '';
        stepConfirm.style.display = 'none';
        errorEl.style.display     = 'none';
      };

    } catch (err) {
      googleBtn.disabled = false;
      googleBtn.style.opacity = '';
      if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        showLoginError('Помилка входу. Спробуйте ще раз.');
      }
    }
  };
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  document.getElementById('login-error-text').textContent = msg;
  el.style.display = 'flex';
}

function renderUserInfo() {
  const initial = currentUser.charAt(0).toUpperCase();

  // Sidebar elements
  const sbAv  = document.querySelector('.sb-user-av');
  if (sbAv)  sbAv.textContent  = initial;

  const sbTip = document.querySelector('.sb-user-item .sb-tip');
  if (sbTip) sbTip.textContent = currentUser;

  // Legacy (hidden span kept for compat)
  const nameEl  = document.getElementById('user-name-display');
  if (nameEl)  nameEl.textContent  = currentUser;
  const emailEl = document.getElementById('user-email-display');
  if (emailEl) emailEl.textContent = currentEmail;

  const letterEl = document.getElementById('user-avatar-letter');
  if (letterEl)  letterEl.textContent = initial;
}

document.getElementById('btn-change-name').addEventListener('click', async () => {
  if (currentUser) {
    const safeKey = currentUser.replace(/[.#$[\]]/g, '_');
    db.ref('presence/' + safeKey).remove();
  }
  currentUser     = '';
  currentEmail    = '';
  currentPhotoURL = '';
  await auth.signOut();
  showLoginModal(true);
});

// ── NAVIGATION ───────────────────────────────────────────────
function setupNav() {
  // Sidebar is icon-only — no nav-items to wire up
  // Navigation is handled via <a href> links in sidebar.js
}

function goToToday() {
  if (calendarInstance) calendarInstance.today();
}

// ── HAMBURGER (mobile fallback) ──────────────────────────────
function setupHamburger() {
  document.querySelectorAll('.hamburger-btn').forEach(btn => {
    btn.addEventListener('click', toggleSidebar);
  });
  const ov = document.getElementById('sidebar-overlay');
  if (ov) ov.addEventListener('click', closeSidebar);
}

function toggleSidebar() {
  document.getElementById('sidebar')?.classList.toggle('open');
  document.getElementById('sidebar-overlay')?.classList.toggle('open');
}

function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('open');
}

// ── FIREBASE LISTENERS ───────────────────────────────────────
function renderDashboardCounters() {
  const today = new Date();
  const todayStr  = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const monthStr  = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;

  let cntToday = 0, cntCompleted = 0, cntContracts = 0, cntCancelled = 0;

  Object.values(events).forEach(ev => {
    if (ev.date === todayStr && ev.status !== 'cancelled') cntToday++;
    // Тільки поточний місяць
    if (ev.status === 'completed' && ev.date && ev.date.startsWith(monthStr)) {
      cntCompleted++;
      if (ev.contractSigned) cntContracts++;
    }
    if (ev.status === 'cancelled' && ev.date && ev.date.startsWith(monthStr)) cntCancelled++;
  });

  const animate = (id, value) => {
    const el = document.getElementById(id);
    if (!el) return;
    const prev = parseInt(el.dataset.val);
    if (!isNaN(prev) && prev === value) return;
    el.dataset.val = value;
    el.textContent = value;
    el.classList.remove('tbar-bump');
    void el.offsetWidth; // reflow
    el.classList.add('tbar-bump');
  };

  animate('cnt-today',     cntToday);
  animate('cnt-completed', cntCompleted);
  animate('cnt-contracts', cntContracts);
  animate('cnt-cancelled', cntCancelled);
}

function listenEvents() {
  db.ref('events').on('value', snap => {
    const data = snap.val() || {};
    events = {};
    Object.keys(data).forEach(key => {
      events[key] = { id: key, ...data[key] };
    });
    refreshCalendar();
    renderDashboardCounters();
  }, err => {
    showToast('Помилка завантаження подій: ' + err.code, 'error');
    console.error('Events listener error:', err);
  });
}

function listenTeachers() {
  db.ref('people').on('value', snap => {
    const data = snap.val() || {};
    teachers = {};
    Object.keys(data).forEach(key => {
      teachers[key] = { id: key, ...data[key] };
    });
    populateTeacherSelect();
    refreshCalendar();
  }, err => {
    showToast('Помилка завантаження вчителів: ' + err.code, 'error');
    console.error('Teachers listener error:', err);
  });
}

function listenPricing() {
  db.ref('pricing/config').on('value', snap => {
    const data = snap.val();
    if (data) {
      pricing = data;
      if (!pricing.default)   pricing.default   = { baseReward: 50, contractBonus: 100 };
      if (!pricing.overrides) pricing.overrides = {};
    }
  });
}

// ── CALENDAR ─────────────────────────────────────────────────
function initCalendar() {
  const isMobile = window.innerWidth < 768;
  const calEl = document.getElementById('calendar');

  calendarInstance = new FullCalendar.Calendar(calEl, {
    initialView: isMobile ? 'timeGridDay' : 'timeGridWeek',
    headerToolbar: {
      left:   'prev,next today',
      center: 'title',
      right:  isMobile
        ? 'timeGridDay,listWeek'
        : 'dayGridMonth,timeGridWeek,timeGridDay,listWeek'
    },
    firstDay: 1, 
    height:                '100%',
    allDaySlot:            false,
    slotMinTime:           '08:00:00',
    slotMaxTime:           '22:00:00',
    nowIndicator:          true,
    selectable:            true,
    editable:              true,
    eventResizableFromStart: true,
    selectMirror:          true,
    locale:                'uk',

    selectAllow: function(selectInfo) {
      return !isTimeBlocked(selectInfo.start, selectInfo.end, null, true);
    },

    select(info) {
      showSlotChoice(info.startStr, info.endStr);
      calendarInstance.unselect();
    },

    eventClick(info) {
      if (info.event.display === 'background') return;
      if (info.event.id.startsWith('busy_')) {
        const busyId = info.event.extendedProps.busyId;
        const title  = info.event.title;
        showConfirm(`Видалити "${title}"?`, async () => {
          await db.ref('busySlots/' + busyId).remove();
          showToast('Слот видалено', 'info');
        });
        return;
      }
      if (info.event.id.startsWith('block_')) {
        showToast('Повторюване блокування. Керуй у розділі "Графік роботи"', 'info');
        return;
      }
      openEventModal(info.event.id);
    },

    eventDrop(info) {
      const ev = events[info.event.id];
      if (!ev) { info.revert(); return; }
      const start = info.event.start;
      const end   = info.event.end || new Date(start.getTime() + 3600000);
      
      db.ref('events/' + ev.id).update({
        date:      formatDate(start),
        startTime: formatTime(start),
        endTime:   formatTime(end)
      })
      .then(() => showToast('Подію переміщено', 'success'))
      .catch(() => { info.revert(); showToast('Помилка переміщення', 'error'); });
    },

    eventResize(info) {
      const ev = events[info.event.id];
      if (!ev) { info.revert(); return; }
      
      db.ref('events/' + ev.id).update({
        endTime: formatTime(info.event.end)
      })
      .then(() => showToast('Час змінено', 'success'))
      .catch(() => { info.revert(); showToast('Помилка', 'error'); });
    }
  });

  calendarInstance.render();
  refreshCalendar(); 
}


// ── TEACHER COLOR PALETTE ────────────────────────────────────
const TEACHER_COLORS = [
  { bg: '#4f6ef7', border: '#3b5be8', text: '#fff' },
  { bg: '#059669', border: '#047857', text: '#fff' },
  { bg: '#d97706', border: '#b45309', text: '#fff' },
  { bg: '#7c3aed', border: '#6d28d9', text: '#fff' },
  { bg: '#db2777', border: '#be185d', text: '#fff' },
  { bg: '#0891b2', border: '#0e7490', text: '#fff' },
  { bg: '#dc2626', border: '#b91c1c', text: '#fff' },
  { bg: '#65a30d', border: '#4d7c0f', text: '#fff' },
];

function getTeacherColor(teacherId) {
  if (!teacherId) return null;
  const keys = Object.keys(teachers).sort();
  const idx  = keys.indexOf(teacherId);
  return idx >= 0 ? TEACHER_COLORS[idx % TEACHER_COLORS.length] : null;
}

function refreshCalendar() {
  if (!calendarInstance) return;
  
  const eventsArray = [];

  // 1. Формуємо масив подій
  Object.values(events).forEach(ev => {
    if (!ev.date || !ev.startTime) return; // пропускаємо неповні події
    const start = parseDateTime(ev.date, ev.startTime);
    const end   = parseDateTime(ev.date, ev.endTime || ev.startTime);
    const title = ev.title + (teacherName(ev.assignedPersonId) ? ' · ' + teacherName(ev.assignedPersonId) : '');

    const tColor = getTeacherColor(ev.assignedPersonId);
    const evObj = {
      id:         ev.id,
      title,
      start,
      end,
      classNames: [`status-${ev.status}`]
    };
    if (tColor && ev.status !== 'cancelled') {
      evObj.backgroundColor = tColor.bg;
      evObj.borderColor     = tColor.border;
      evObj.textColor       = tColor.text;
    }
    eventsArray.push(evObj);
  });

  // 2. Формуємо масив блокувань (повторювані з розкладу)
  Object.entries(blockedTimes).forEach(([id, b]) => {
    const isGlobal = !b.teacherId;
    const tName    = b.teacherId ? (teachers[b.teacherId]?.name || '') : '';

    // endRecur is EXCLUSIVE in FullCalendar — add 1 day so "until" date is included
    let endRecur = null;
    if (b.until) {
      const d = new Date(b.until + 'T00:00:00');
      d.setDate(d.getDate() + 1);
      endRecur = formatDate(d);
    }

    eventsArray.push({
      id:              'block_' + id,
      groupId:         'blocked_zone',
      title:           isGlobal
        ? (b.title || 'Зайнято')
        : `${b.title || 'Зайнято'} · ${tName}`,
      startTime:       b.start,
      endTime:         b.end,
      daysOfWeek:      b.days,
      endRecur,
      backgroundColor: isGlobal ? '#fca5a5' : '#bfdbfe',
      borderColor:     isGlobal ? '#ef4444' : '#3b82f6',
      textColor:       isGlobal ? '#7f1d1d' : '#1e3a5f',
      classNames:      ['fc-block-recurring'],
      editable:        false,
    });
  });

  // 3. busySlots — одноразові зайняті слоти з календаря
  Object.entries(busySlots).forEach(([id, b]) => {
    const isGlobal = !b.teacherId;
    const tName = b.teacherId ? (teachers[b.teacherId]?.name || '') : '';
    eventsArray.push({
      id:              'busy_' + id,
      title:           isGlobal
        ? (b.title || 'Зайнято')
        : `${b.title || 'Зайнято'}${tName ? ' · ' + tName : ''}`,
      start:           b.date + 'T' + b.startTime,
      end:             b.date + 'T' + b.endTime,
      backgroundColor: '#64748b',
      borderColor:     '#475569',
      textColor:       '#fff',
      classNames:      ['status-busy'],
      extendedProps:   { busyId: id, teacherId: b.teacherId || '' }
    });
  });

  calendarInstance.removeAllEventSources();
  calendarInstance.addEventSource(eventsArray);
}

function parseDateTime(date, time) {
  const [y, m, d]   = date.split('-').map(Number);
  const [hh, mm]    = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm);
}

// ── SLOT CHOICE ──────────────────────────────────────────────
function showSlotChoice(startStr, endStr) {
  // Remove existing popup if any
  document.getElementById('slot-choice-popup')?.remove();

  const popup = document.createElement('div');
  popup.id = 'slot-choice-popup';
  popup.style.cssText = [
    'position:fixed', 'top:50%', 'left:50%',
    'transform:translate(-50%,-50%)',
    'z-index:600',
    'background:var(--bg2)',
    'border:1px solid var(--border)',
    'border-radius:14px',
    'box-shadow:0 8px 40px rgba(0,0,0,0.18)',
    'padding:20px',
    'display:flex', 'flex-direction:column', 'gap:10px',
    'min-width:240px',
    'font-family:var(--font-main)',
    'animation:popup-in 0.15s ease',
  ].join(';');

  const start = new Date(startStr);
  const end   = new Date(endStr);
  const timeLabel = `${formatTime(start)} – ${formatTime(end)}`;

  popup.innerHTML = `
    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;
                letter-spacing:0.5px;margin-bottom:2px">${timeLabel}</div>
    <button id="scp-event" style="
      display:flex;align-items:center;gap:10px;padding:11px 14px;
      background:var(--accent);color:#fff;border:none;border-radius:10px;
      font-size:13.5px;font-weight:700;cursor:pointer;width:100%;text-align:left;
      font-family:var(--font-main);transition:opacity 0.15s">
      <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/>
        <line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
      Нова подія
    </button>
    <button id="scp-block" style="
      display:flex;align-items:center;gap:10px;padding:11px 14px;
      background:var(--bg3);color:var(--text2);
      border:1.5px solid var(--border);border-radius:10px;
      font-size:13.5px;font-weight:700;cursor:pointer;width:100%;text-align:left;
      font-family:var(--font-main);transition:all 0.15s">
      <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10"/>
        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
      </svg>
      Зайнятий час
    </button>
    <button id="scp-close" style="
      background:none;border:none;cursor:pointer;
      font-size:12px;color:var(--text3);font-family:var(--font-main);
      padding:4px;align-self:center">Скасувати</button>`;

  // Backdrop
  const backdrop = document.createElement('div');
  backdrop.id = 'slot-choice-backdrop';
  backdrop.style.cssText = 'position:fixed;inset:0;z-index:599;';
  backdrop.onclick = () => closeSlotChoice();
  document.body.appendChild(backdrop);
  document.body.appendChild(popup);

  popup.querySelector('#scp-event').onclick = () => {
    closeSlotChoice();
    openCreateModal(startStr, endStr);
  };
  popup.querySelector('#scp-block').onclick = () => {
    closeSlotChoice();
    openBlockModal(startStr, endStr);
  };
  popup.querySelector('#scp-close').onclick = () => closeSlotChoice();
}

function closeSlotChoice() {
  document.getElementById('slot-choice-popup')?.remove();
  document.getElementById('slot-choice-backdrop')?.remove();
}

// ── BLOCK TIME MODAL ─────────────────────────────────────────
function openBlockModal(startStr, endStr) {
  const start = new Date(startStr);
  const end   = new Date(endStr);

  // Populate teacher select
  const teacherOptions = Object.values(teachers)
    .sort((a,b) => a.name.localeCompare(b.name, 'uk'))
    .map(t => `<option value="${t.id}">${t.name.replace(/</g,'&lt;')}</option>`)
    .join('');

  document.getElementById('bm-title').value = '';
  document.getElementById('bm-start').value = formatTime(start);
  document.getElementById('bm-end').value   = formatTime(end);
  document.getElementById('bm-date').value  = formatDate(start);

  const sel = document.getElementById('bm-teacher');
  sel.innerHTML = '<option value="">Всі (загальне)</option>' + teacherOptions;
  sel.value = '';

  document.getElementById('block-modal').classList.add('open');
}

async function saveBlockModal() {
  const title  = document.getElementById('bm-title').value.trim() || 'Зайнято';
  const start  = document.getElementById('bm-start').value;
  const end    = document.getElementById('bm-end').value;
  const date   = document.getElementById('bm-date').value;
  const tid    = document.getElementById('bm-teacher').value;

  if (!start || !end) { showToast('Вкажіть час', 'error'); return; }
  if (start >= end)   { showToast('Кінець має бути пізніше початку', 'error'); return; }

  const d = new Date(date);
  const dayOfWeek = d.getDay(); // 0=Sun..6=Sat

  const btn = document.getElementById('bm-save-btn');
  btn.disabled = true;
  btn.textContent = 'Збереження…';

  try {
    await db.ref('busySlots').push({
      title,
      date,
      startTime: start,
      endTime:   end,
      teacherId: tid || '',
      createdBy: currentUser,
      createdAt: Date.now()
    });
    closeModal('block-modal');
    showToast('Час заблоковано', 'success');
  } catch (err) {
    showToast('Помилка: ' + (err.code || err.message), 'error');
  }

  btn.disabled = false;
  btn.textContent = 'Заблокувати';
}

// ── EVENT MODAL ──────────────────────────────────────────────
function openCreateModal(startStr, endStr) {
  document.getElementById('event-title').value = '';
  document.getElementById('event-description').value = '';
  document.getElementById('event-phone').value = '';
  document.getElementById('event-modal-title').textContent = 'Нова подія';
  document.getElementById('event-id').value = '';

  const start = startStr ? new Date(startStr) : new Date();
  const end   = endStr   ? new Date(endStr)   : new Date(start.getTime() + 3600000);

  document.getElementById('event-date').value  = formatDate(start);
  document.getElementById('event-start').value = formatTime(start);
  document.getElementById('event-end').value   = formatTime(end);

  populateTeacherSelect('');
  document.getElementById('event-status-section').innerHTML = '';
  const cs = document.getElementById('event-client-section'); if (cs) cs.innerHTML = '';
  document.getElementById('event-actions').innerHTML = '';
  document.getElementById('event-modal').classList.add('open');
}

function openEventModal(eventId) {
  const ev = events[eventId];
  if (!ev) return;

  document.getElementById('event-modal-title').textContent = 'Редагувати подію';
  document.getElementById('event-id').value          = ev.id;
  document.getElementById('event-title').value       = ev.title       || '';
  document.getElementById('event-description').value = ev.description || '';
  document.getElementById('event-phone').value       = ev.phone       || '';
  document.getElementById('event-date').value        = ev.date        || '';
  document.getElementById('event-start').value       = ev.startTime   || '';
  document.getElementById('event-end').value         = ev.endTime     || '';
  populateTeacherSelect(ev.assignedPersonId);

  const statusHTML = `
    <div class="event-status-bar">
      <span class="badge badge-${ev.status}">${statusLabel(ev.status)}</span>
      ${ev.createdBy   ? `<span class="meta-by">Створив: ${ev.createdBy}</span>`   : ''}
      ${ev.confirmedBy ? `<span class="meta-by">Підтвердив: ${ev.confirmedBy}</span>` : ''}
    </div>`;
  document.getElementById('event-status-section').innerHTML = statusHTML;

  // ── Client block ──────────────────────────────────────────
  renderEventClientBlock(ev);

  const actions = document.getElementById('event-actions');
  actions.innerHTML = '';

  if (ev.status === 'pending') {
    actions.appendChild(makeBtn('Підтвердити', 'btn btn-success btn-sm', () => confirmEvent(ev.id)));
  }
  if (ev.status === 'pending' || ev.status === 'confirmed') {
    actions.appendChild(makeBtn('Скасувати', 'btn btn-danger btn-sm', () => cancelEvent(ev.id)));
  }
  if (ev.status === 'confirmed') {
    actions.appendChild(makeBtn('Завершити', 'btn btn-info btn-sm', () => completeEvent(ev.id)));
  }
  actions.appendChild(makeBtn('Видалити', 'btn btn-ghost btn-sm', () => deleteEvent(ev.id)));

  // Показуємо відгук якщо є
  const reviewSection = document.getElementById('event-review-section');
  if (reviewSection) {
    db.ref('reviews/' + ev.id).once('value').then(snap => {
      if (snap.exists()) {
        const r = snap.val();
        reviewSection.innerHTML = `
          <div class="review-block">
            <div class="review-block-label">
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              Відгук клієнта
            </div>
            <div class="review-block-text">${r.comment}</div>
            <div class="review-block-meta">${new Date(r.createdAt).toLocaleString('uk-UA')}</div>
          </div>`;
      } else {
        reviewSection.innerHTML = '';
      }
    });
  }

  document.getElementById('event-modal').classList.add('open');
}

async function renderEventClientBlock(ev) {
  const section = document.getElementById('event-client-section');
  if (!section) return;

  if (!ev.phone) {
    section.innerHTML = '';
    return;
  }

  const phone    = ev.phone.replace(/\D/g, '');
  if (phone.length < 9) { section.innerHTML = ''; return; }

  const clientUrl = `client.html?id=${encodeURIComponent(phone)}`;

  // Show skeleton while loading
  section.innerHTML = `
    <div class="event-client-chip">
      <div class="event-client-av" style="background:var(--accent-light);color:var(--accent)">…</div>
      <div class="event-client-info">
        <div class="event-client-name" style="color:var(--text3)">Завантаження…</div>
        <div class="event-client-phone">${ev.phone}</div>
      </div>
    </div>`;

  // Load client name from Firebase
  try {
    const snap = await db.ref('clients/' + phone).once('value');
    const name = snap.exists() ? (snap.val().name || '') : '';
    const initials = name
      ? name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()
      : phone.slice(-2);

    section.innerHTML = `
      <div class="event-client-chip">
        <div class="event-client-av">${initials}</div>
        <div class="event-client-info">
          <div class="event-client-name">${name ? name.replace(/</g,'&lt;') : 'Без імені'}</div>
          <div class="event-client-phone">${ev.phone}</div>
        </div>
        <a href="${clientUrl}" target="_blank" class="event-client-btn">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
          Картка
        </a>
      </div>`;
  } catch (e) {
    section.innerHTML = `
      <div class="event-client-chip">
        <div class="event-client-av">${phone.slice(-2)}</div>
        <div class="event-client-info">
          <div class="event-client-name">Без імені</div>
          <div class="event-client-phone">${ev.phone}</div>
        </div>
        <a href="${clientUrl}" target="_blank" class="event-client-btn">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
          Картка
        </a>
      </div>`;
  }
}

function statusLabel(s) {
  return { pending: 'Очікує', confirmed: 'Підтверджено', cancelled: 'Скасовано', completed: 'Завершено' }[s] || s;
}

function populateTeacherSelect(selectedId) {
  const sel = document.getElementById('event-teacher');
  sel.innerHTML = '<option value="">— Оберіть вчителя —</option>';
  Object.values(teachers).forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    if (t.id === selectedId) opt.selected = true;
    sel.appendChild(opt);
  });
}

function makeBtn(text, className, onClick) {
  const btn = document.createElement('button');
  btn.className = className;
  btn.innerHTML = text;
  btn.onclick = onClick;
  return btn;
}

document.getElementById('event-save-btn').addEventListener('click', async () => {
  const id          = document.getElementById('event-id').value;
  const title       = document.getElementById('event-title').value.trim();
  const description = document.getElementById('event-description').value.trim();
  const phone       = document.getElementById('event-phone').value.trim();
  const date        = document.getElementById('event-date').value;
  const startTime   = document.getElementById('event-start').value;
  const endTime     = document.getElementById('event-end').value;
  const assignedPersonId = document.getElementById('event-teacher').value;

  if (!title || !date || !startTime || !endTime) {
    showToast("Заповніть обов'язкові поля", 'error'); return;
  }

  if (!phone) {
    const phoneEl = document.getElementById('event-phone');
    phoneEl.style.borderColor = 'var(--red)';
    phoneEl.focus();
    setTimeout(() => phoneEl.style.borderColor = '', 2000);
    showToast('Вкажіть номер телефону клієнта', 'error'); return;
  }

  const checkStart = parseDateTime(date, startTime);
  const checkEnd   = parseDateTime(date, endTime);

  if (isTimeBlocked(checkStart, checkEnd, null, true)) {
    showToast('Цей час заблоковано для всіх', 'error'); return;
  }
  if (assignedPersonId && isTimeBlocked(checkStart, checkEnd, assignedPersonId, false)) {
    showToast(`Цей час заблоковано для вчителя ${teacherName(assignedPersonId)}`, 'error'); return;
  }

  const data = { title, description, phone, date, startTime, endTime, assignedPersonId };

  if (!id) {
    data.status    = 'pending';
    data.createdBy = currentUser;
    data.createdAt = new Date().toISOString();
    const newRef = db.ref('events').push();
    await newRef.set(data);
    sendTelegram('СТВОРЕНО', { ...data, id: newRef.key });
    if (phone) upsertClient(phone, title);
    showToast('Подію створено', 'success');
  } else {
    await db.ref('events/' + id).update(data);
    if (phone) upsertClient(phone, title);
    showToast('Подію оновлено', 'success');
  }
  closeModal('event-modal');
});

async function confirmEvent(id) {
  const ev = events[id];
  if (!ev) return;
  await db.ref('events/' + id).update({ status: 'confirmed', confirmedBy: currentUser });
  sendTelegram('ПІДТВЕРДЖЕНО', ev);
  showToast('Подію підтверджено', 'success');
  closeModal('event-modal');
}

function cancelEvent(id) {
  showConfirm('Скасувати цю подію?', async () => {
    const ev = events[id];
    await db.ref('events/' + id).update({ status: 'cancelled', cancelledBy: currentUser });
    sendTelegram('СКАСОВАНО', ev);
    showToast('Подію скасовано', 'info');
    closeModal('event-modal');
  });
}

function completeEvent(id) {
  const ev = events[id];
  if (!ev || ev.status !== 'confirmed') {
    showToast('Спочатку підтвердіть подію', 'error'); return;
  }
  showConfirm('Позначити подію як завершену?', async () => {
    await db.ref('events/' + id).update({
      status:         'completed',
      completedBy:    currentUser,
      completedAt:    new Date().toISOString(),
      contractSigned: false
    });
    showToast('Подію завершено', 'success');
    closeModal('event-modal');
  });
}

function deleteEvent(id) {
  showConfirm('Видалити цю подію назавжди?', async () => {
    const ev = events[id];
    if (ev && ev.telegramMessageId) {
      fetch(`https://api.telegram.org/bot${TELEGRAM.BOT_TOKEN}/deleteMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM.CHAT_ID, message_id: ev.telegramMessageId })
      }).catch(() => {}); 
    }
    await db.ref('events/' + id).remove();
    showToast('Подію видалено', 'info');
    closeModal('event-modal');
  });
}

document.getElementById('event-cancel-btn').addEventListener('click', () => closeModal('event-modal'));

// ── CONFIRMED LIST ───────────────────────────────────────────
// ── BLOCKED TIMES LOGIC ───────────────────────────────────────
function listenBlockedTimes() {
  db.ref('settings/blockedTimes').on('value', snap => {
    blockedTimes = snap.val() || {};
    refreshCalendar();
  }, err => console.error('BlockedTimes error:', err));
}

function listenBusySlots() {
  db.ref('busySlots').on('value', snap => {
    busySlots = snap.val() || {};
    refreshCalendar();
  });
}

function isTimeBlocked(startDT, endDT, teacherId, globalOnly) {
  const selStart = startDT.getHours() * 60 + startDT.getMinutes();
  const selEnd   = endDT.getHours()   * 60 + endDT.getMinutes();
  const selDate  = formatDate(startDT);

  // Check recurring blocked times (settings/blockedTimes)
  const inRecurring = Object.values(blockedTimes).some(b => {
    if (globalOnly && b.teacherId) return false;
    if (!globalOnly && b.teacherId && b.teacherId !== teacherId) return false;
    if (!(b.days || []).includes(startDT.getDay())) return false;
    if (b.until && startDT > new Date(b.until + 'T23:59:59')) return false;
    const [bSH, bSM] = b.start.split(':').map(Number);
    const [bEH, bEM] = b.end.split(':').map(Number);
    return selStart < (bEH*60+bEM) && selEnd > (bSH*60+bSM);
  });
  if (inRecurring) return true;

  // Check one-off busy slots (busySlots/)
  const inBusy = Object.values(busySlots).some(b => {
    if (b.date !== selDate) return false;
    if (globalOnly && b.teacherId) return false;
    if (!globalOnly && b.teacherId && b.teacherId !== teacherId) return false;
    const [bSH, bSM] = b.startTime.split(':').map(Number);
    const [bEH, bEM] = b.endTime.split(':').map(Number);
    return selStart < (bEH*60+bEM) && selEnd > (bSH*60+bSM);
  });
  return inBusy;
}

// ── HELPERS ──────────────────────────────────────────────────

function teacherName(id) { return id ? (teachers[id]?.name || '') : ''; }
function getPricing(tid) { return (tid && pricing.overrides[tid]) ? pricing.overrides[tid] : pricing.default; }
function formatDate(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function formatTime(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function pad(n) { return String(n).padStart(2, '0'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function escStr(s) { return s.replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

function showConfirm(message, onConfirm) {
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('confirm-dialog').classList.add('open');
  confirmCallback = onConfirm;
}

document.getElementById('confirm-ok').addEventListener('click', () => { document.getElementById('confirm-dialog').classList.remove('open'); if (confirmCallback) confirmCallback(); confirmCallback = null; });
document.getElementById('confirm-cancel').addEventListener('click', () => closeModal('confirm-dialog'));

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`; toast.textContent = message;
  container.appendChild(toast); setTimeout(() => toast.remove(), 3200);
}

async function sendTelegram(status, ev) {
  if (!TELEGRAM.BOT_TOKEN) return;
  const escapeHTML = (str) => { if (!str) return ''; return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  const tName = teacherName(ev.assignedPersonId) || 'Не призначено';
  const safeTitle = escapeHTML(ev.title), safeTeacher = escapeHTML(tName), safeUser = escapeHTML(currentUser);
  const safeDesc = ev.description ? escapeHTML(ev.description) : '';

  const descBlock = safeDesc ? `\n\n<blockquote>${safeDesc}</blockquote>` : '';
  const text = `<b>[${status}]</b>\n\n<b>Подія:</b> ${safeTitle}\n<b>Час:</b> ${ev.date} (${ev.startTime} - ${ev.endTime})\n<b>Вчитель:</b> ${safeTeacher}${descBlock}\n\n<i>Менеджер: ${safeUser}</i>`;

  if (ev.telegramMessageId) {
    try { await fetch(`https://api.telegram.org/bot${TELEGRAM.BOT_TOKEN}/deleteMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: TELEGRAM.CHAT_ID, message_id: ev.telegramMessageId }) }); } catch (err) {}
  }

  const payload = { chat_id: TELEGRAM.CHAT_ID, text: text, parse_mode: 'HTML' };

  // Кнопка відгуку — тільки для підтверджених подій
  if (status === 'ПІДТВЕРДЖЕНО' && ev.id) {
    const reviewUrl = `${SITE_URL}/review.html?eventId=${ev.id}`;
    payload.reply_markup = {
      inline_keyboard: [[
        { text: 'Залишити відгук', url: reviewUrl }
      ]]
    };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM.BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (data.ok && data.result && data.result.message_id) { if (ev.id) await db.ref('events/' + ev.id).update({ telegramMessageId: data.result.message_id }); }
  } catch (err) {}
}

function normalizePhone(p) {
  if (!p) return null;
  const d = p.replace(/\D/g, '');
  return d.length >= 9 ? d : null;
}

async function upsertClient(rawPhone, eventTitle) {
  const key = normalizePhone(rawPhone);
  if (!key) return;
  const ref  = db.ref('clients/' + key);
  const snap = await ref.once('value');
  if (!snap.exists()) {
    await ref.set({ phone: rawPhone, name: eventTitle || '', createdAt: Date.now(), lastEventAt: Date.now() });
  } else {
    await ref.update({ lastEventAt: Date.now() });
  }
}

// ── EXPORTS ──────────────────────────────────────────────────
window.openCreateModal = openCreateModal;
window.openEventModal = openEventModal;
window.completeEvent = completeEvent;
window.cancelEvent = cancelEvent;
window.saveBlockModal   = saveBlockModal;
window.closeSlotChoice  = closeSlotChoice;
window.toggleNotifPanel = toggleNotifPanel;
window.closeNotifPanel  = closeNotifPanel;
window.markNotifRead    = markNotifRead;

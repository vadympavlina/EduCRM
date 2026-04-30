// ============================================================
//  APP.JS — Internal Event Management CRM (Realtime Database)
//  Vanilla JS, no ES modules — works on GitHub Pages
// ============================================================

// ── TELEGRAM CONFIG ──────────────────────────────────────────
const TELEGRAM = {
  BOT_TOKEN: '',   
  CHAT_ID:   '-1003992712563'      
};

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
let calendarInstance = null;
let confirmCallback  = null;

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

  initPresence(); 
  listenTeachers();
  listenPricing();
  listenEvents();
  listenBlockedTimes(); 

  setTimeout(initCalendar, 200);

  const now = new Date();
  const monthSel = document.getElementById('stats-month');
  if (monthSel) {
    monthSel.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    monthSel.addEventListener('change', renderStats);
  }

  const teacherSel = document.getElementById('stats-teacher');
  if (teacherSel) {
    teacherSel.addEventListener('change', renderStats);
  }

  const monthFilter = document.getElementById('confirmed-month-filter');
  if (monthFilter) {
    monthFilter.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    monthFilter.addEventListener('change', renderConfirmedList);
  }
}

// ── PRESENCE (ОНЛАЙН СТАТУС) ─────────────────────────────────
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
  document.getElementById('user-name-display').textContent  = currentUser;
  document.getElementById('user-email-display').textContent = currentEmail;

  const letterEl  = document.getElementById('user-avatar-letter');
  const avatarDiv = letterEl.closest('.user-avatar');

  if (currentPhotoURL) {
    // Показуємо фото з Google
    let img = avatarDiv.querySelector('img.user-photo');
    if (!img) {
      img = document.createElement('img');
      img.className = 'user-photo';
      img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;';
      avatarDiv.appendChild(img);
    }
    img.src = currentPhotoURL;
    letterEl.style.display = 'none';
  } else {
    letterEl.textContent   = currentUser.charAt(0).toUpperCase();
    letterEl.style.display = '';
    const oldImg = avatarDiv.querySelector('img.user-photo');
    if (oldImg) oldImg.remove();
  }
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
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      navigateTo(item.dataset.page);
      closeSidebar();
    });
  });
}

function navigateTo(page) {
  document.querySelectorAll('.nav-item').forEach(n =>
    n.classList.toggle('active', n.dataset.page === page));
  document.querySelectorAll('.page').forEach(p =>
    p.classList.toggle('active', p.id === page + '-page'));

  if (page === 'stats')          renderStats();
  if (page === 'completed')      renderCompleted();
  if (page === 'pricing')        renderPricing();
  if (page === 'teachers')       renderTeachers();
  if (page === 'confirmed-list') renderConfirmedList();
  if (page === 'schedule')       renderBlockedTimes(); 
  if (page === 'calendar')       setTimeout(() => calendarInstance && calendarInstance.render(), 50);
}

// ── HAMBURGER ────────────────────────────────────────────────
function setupHamburger() {
  document.querySelectorAll('.hamburger-btn').forEach(btn => {
    btn.addEventListener('click', toggleSidebar);
  });
  document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

// ── FIREBASE LISTENERS ───────────────────────────────────────
function listenEvents() {
  db.ref('events').on('value', snap => {
    const data = snap.val() || {};
    events = {};
    Object.keys(data).forEach(key => {
      events[key] = { id: key, ...data[key] };
    });

    refreshCalendar();
    
    const activePage = document.querySelector('.page.active')?.id;
    if (activePage === 'completed-page') renderCompleted();
    if (activePage === 'stats-page')     renderStats();
    if (activePage === 'confirmed-list-page') renderConfirmedList();
  });
}

function listenTeachers() {
  db.ref('people').on('value', snap => {
    const data = snap.val() || {};
    teachers = {};
    Object.keys(data).forEach(key => {
      teachers[key] = { id: key, ...data[key] };
    });

    populateStatsTeacherSelect();
    const activePage = document.querySelector('.page.active')?.id;
    if (activePage === 'teachers-page') renderTeachers();
    if (activePage === 'pricing-page')  renderPricing();
    if (activePage === 'stats-page')    renderStats();
    populateOverrideSelect();
    
    const bts = document.getElementById('block-teacher-select');
    if (bts) {
      const cur = bts.value;
      bts.innerHTML = '<option value="">Всі (загальне блокування)</option>';
      Object.values(teachers).forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id; opt.textContent = t.name; bts.appendChild(opt);
      });
      bts.value = cur;
    }
    
    const ap = document.querySelector('.page.active')?.id;
    if (ap === 'schedule-page') renderBlockedTimes();
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
    const activePage = document.querySelector('.page.active')?.id;
    if (activePage === 'pricing-page') renderPricing();
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
      openCreateModal(info.startStr, info.endStr);
      calendarInstance.unselect();
    },

    eventClick(info) {
      if (info.event.display === 'background') return; 
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

function refreshCalendar() {
  if (!calendarInstance) return;
  
  const eventsArray = [];

  // 1. Формуємо масив подій
  Object.values(events).forEach(ev => {
    const start = parseDateTime(ev.date, ev.startTime || '09:00');
    const end   = parseDateTime(ev.date, ev.endTime   || '10:00');
    const title = ev.title + (teacherName(ev.assignedPersonId) ? ' · ' + teacherName(ev.assignedPersonId) : '');

    eventsArray.push({
      id:         ev.id,
      title,
      start,
      end,
      classNames: [`status-${ev.status}`]
    });
  });

  // 2. Формуємо масив блокувань
  Object.entries(blockedTimes).forEach(([id, b]) => {
    const isGlobal = !b.teacherId;
    eventsArray.push({
      id: 'block_' + id,
      groupId: 'blocked_zone',
      title: isGlobal ? (b.title || 'ЗАЙНЯТО') : `${b.title || 'ЗАЙНЯТО'} (${teachers[b.teacherId]?.name || ''})`,
      startTime: b.start,
      endTime:   b.end,
      daysOfWeek: b.days,
      endRecur:  b.until || null,
      display:   'background',
      classNames: isGlobal ? ['fc-block-global'] : ['fc-block-teacher'],
      overlap:   false
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

  document.getElementById('event-modal').classList.add('open');
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
    showToast('Подію створено', 'success');
  } else {
    await db.ref('events/' + id).update(data);
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
function renderConfirmedList() {
  const tbody = document.getElementById('confirmed-list-tbody');
  const emptyState = document.getElementById('confirmed-list-empty');
  const selectedMonth = document.getElementById('confirmed-month-filter').value;

  const list = Object.values(events).filter(ev => {
    return ev.status === 'confirmed' && ev.date && ev.date.startsWith(selectedMonth);
  }).sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

  tbody.innerHTML = '';
  if (list.length === 0) {
    tbody.parentElement.parentElement.style.display = 'none';
    emptyState.style.display = 'flex';
    return;
  }
  tbody.parentElement.parentElement.style.display = 'block';
  emptyState.style.display = 'none';

  list.forEach(ev => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${ev.title}</strong></td>
      <td>${ev.date} <span style="color:var(--text3)">${ev.startTime}–${ev.endTime}</span></td>
      <td>${teacherName(ev.assignedPersonId) || '—'}</td>
      <td>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-success btn-sm" onclick="completeEvent('${ev.id}')">Проведено</button>
          <button class="btn btn-ghost btn-sm" onclick="cancelEvent('${ev.id}')" style="color:var(--red)">Ні</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ── COMPLETED & STATS ────────────────────────────────────────
function renderCompleted() {
  const list = Object.values(events).filter(e => e.status === 'completed')
    .sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));

  let totalEarnings = 0, totalContracts = 0;
  const tbody = document.getElementById('completed-tbody');
  tbody.innerHTML = '';

  if (list.length === 0) {
    document.getElementById('completed-empty').style.display = 'flex';
    document.getElementById('completed-table-wrap').style.display = 'none';
  } else {
    document.getElementById('completed-empty').style.display = 'none';
    document.getElementById('completed-table-wrap').style.display = 'block';

    list.forEach(ev => {
      const p = getPricing(ev.assignedPersonId);
      const earnings = ev.contractSigned ? p.baseReward + p.contractBonus : p.baseReward;
      totalEarnings += earnings;
      if (ev.contractSigned) totalContracts++;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${ev.title}</td><td>${ev.date}</td><td>${ev.startTime}–${ev.endTime}</td>
        <td>${teacherName(ev.assignedPersonId)}</td><td>${ev.phone || '—'}</td>
        <td><input type="checkbox" ${ev.contractSigned ? 'checked' : ''} onchange="toggleContract('${ev.id}', this.checked)"></td>
        <td class="earnings-value">₴${earnings}</td><td>${ev.completedBy || '—'}</td>`;
      tbody.appendChild(tr);
    });
  }
  document.getElementById('completed-total').textContent = list.length;
  document.getElementById('completed-earnings').textContent = '₴' + totalEarnings;
  document.getElementById('completed-contracts').textContent = totalContracts;
}

function toggleContract(id, checked) {
  db.ref('events/' + id).update({ contractSigned: checked }).then(() => renderCompleted());
}

function populateStatsTeacherSelect() {
  const sel = document.getElementById('stats-teacher');
  if(!sel) return;
  const currentVal = sel.value; 
  sel.innerHTML = '<option value="">Всі вчителі</option>';
  Object.values(teachers).forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id; opt.textContent = t.name; sel.appendChild(opt);
  });
  sel.value = currentVal; 
}

function renderStats() {
  const selectedMonth = document.getElementById('stats-month').value;
  const selectedTeacher = document.getElementById('stats-teacher').value;

  const completed = Object.values(events).filter(e => {
    if (e.status !== 'completed') return false;
    if (selectedMonth && !e.date.startsWith(selectedMonth)) return false;
    if (selectedTeacher && e.assignedPersonId !== selectedTeacher) return false;
    return true;
  });

  const byTeacher = {};
  completed.forEach(ev => {
    const tid = ev.assignedPersonId || '__none__';
    if (!byTeacher[tid]) byTeacher[tid] = { count: 0, contracts: 0, earnings: 0 };
    const p = getPricing(ev.assignedPersonId);
    byTeacher[tid].count++;
    if (ev.contractSigned) byTeacher[tid].contracts++;
    byTeacher[tid].earnings += ev.contractSigned ? p.baseReward + p.contractBonus : p.baseReward;
  });

  const tbody = document.getElementById('stats-tbody');
  tbody.innerHTML = '';
  Object.entries(byTeacher).forEach(([tid, data]) => {
    const name = tid === '__none__' ? 'Не призначено' : (teachers[tid]?.name || 'Невідомо');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${name}</td><td>${data.count}</td><td>${data.contracts}</td><td class="earnings-value">₴${data.earnings}</td>`;
    tbody.appendChild(tr);
  });
  const tfoot = document.getElementById('stats-tfoot');
  if (tfoot) tfoot.innerHTML = ''; 
}

function printStats() {
  const selectedMonth = document.getElementById('stats-month').value || 'Всі місяці';
  const teacherSelect = document.getElementById('stats-teacher');
  const selectedTeacherName = teacherSelect.options[teacherSelect.selectedIndex].text;
  const tableHTML = document.querySelector('#stats-page table').outerHTML;
  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <html><head><title>Звіт - EduCRM</title><style>
    body { font-family: sans-serif; padding: 20px; color: #111; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #ccc; padding: 10px; text-align: left; }
    .earnings-value { color: #059669; font-weight: bold; }
    </style></head><body>
    <h2>Звіт: Статистика подій</h2><p>Місяць: ${selectedMonth} | Вчитель: ${selectedTeacherName}</p>
    ${tableHTML}<script>window.onload = function() { setTimeout(() => { window.print(); window.close(); }, 250); }</script></body></html>`);
  printWindow.document.close();
}

// ── BLOCKED TIMES LOGIC ───────────────────────────────────────
function listenBlockedTimes() {
  db.ref('settings/blockedTimes').on('value', snap => {
    blockedTimes = snap.val() || {};
    refreshCalendar();
    renderBlockedTimes();
  });
}

function saveBlockedTime() {
  const title     = document.getElementById('block-title').value.trim();
  const until     = document.getElementById('block-until').value;
  const start     = document.getElementById('block-start').value;
  const end       = document.getElementById('block-end').value;
  const teacherId = document.getElementById('block-teacher-select').value || '';
  const days = [];
  document.querySelectorAll('.day-checkbox:checked').forEach(cb => days.push(parseInt(cb.value)));

  if (!title)               { showToast("Введіть назву блокування", 'error'); return; }
  if (days.length === 0)    { showToast('Оберіть хоча б один день', 'error'); return; }
  if (!start || !end)       { showToast('Вкажіть час початку і кінця', 'error'); return; }

  const data = { title, until: until || '', start, end, days, teacherId };
  db.ref('settings/blockedTimes').push(data).then(() => {
    showToast('Блокування додано', 'success');
    document.getElementById('block-title').value = '';
    document.getElementById('block-until').value = '';
    document.getElementById('block-start').value = '';
    document.getElementById('block-end').value   = '';
    document.getElementById('block-teacher-select').value = '';
    document.querySelectorAll('.day-checkbox').forEach(cb => cb.checked = false);
  });
}

function deleteBlockedTime(id) {
  if(confirm('Видалити це обмеження?')) {
    db.ref('settings/blockedTimes/' + id).remove().then(() => showToast('Видалено', 'info'));
  }
}

function renderBlockedTimes() {
  const tbody = document.getElementById('blocked-times-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const dayNames = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

  const sel = document.getElementById('block-teacher-select');
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">Всі (загальне блокування)</option>';
    Object.values(teachers).forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id; opt.textContent = t.name; sel.appendChild(opt);
    });
    sel.value = cur;
  }

  if (Object.keys(blockedTimes).length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:24px">Блокувань ще немає</td></tr>';
    return;
  }

  Object.entries(blockedTimes).forEach(([id, b]) => {
    const tr = document.createElement('tr');
    const daysStr = (b.days || []).map(d => dayNames[d]).join(', ');
    const scope = b.teacherId
      ? `<span class="badge" style="background:var(--blue-bg);color:var(--blue-text);border:1px solid var(--blue)">${teachers[b.teacherId]?.name || 'Невідомо'}</span>`
      : `<span class="badge" style="background:var(--red-bg);color:var(--red-text);border:1px solid var(--red)">Всі</span>`;
    tr.innerHTML = `
      <td><strong>${b.title || 'Зайнято'}</strong></td>
      <td>${scope}</td>
      <td>${daysStr}</td>
      <td>${b.start} – ${b.end}</td>
      <td>${b.until || '∞'}</td>
      <td><button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deleteBlockedTime('${id}')">Видалити</button></td>`;
    tbody.appendChild(tr);
  });
}

// ── PRICING & TEACHERS ───────────────────────────────────────
function renderPricing() {
  document.getElementById('pricing-default-base').value  = pricing.default.baseReward;
  document.getElementById('pricing-default-bonus').value = pricing.default.contractBonus;
  const container = document.getElementById('pricing-overrides');
  container.innerHTML = '';
  Object.entries(pricing.overrides || {}).forEach(([tid, vals]) => {
    const teacher = teachers[tid]; if (!teacher) return;
    const row = document.createElement('div'); row.className = 'pricing-row';
    row.innerHTML = `<span class="pricing-teacher-name">${teacher.name}</span>
      <div class="pricing-input-group"><label>Базова ₴</label><input class="pricing-input" type="number" value="${vals.baseReward}" onchange="updateOverride('${tid}','baseReward',this.value)"></div>
      <div class="pricing-input-group"><label>Бонус ₴</label><input class="pricing-input" type="number" value="${vals.contractBonus}" onchange="updateOverride('${tid}','contractBonus',this.value)"></div>
      <button class="btn btn-danger btn-sm" onclick="removeOverride('${tid}')">Видалити</button>`;
    container.appendChild(row);
  });
}

document.getElementById('pricing-save-default').addEventListener('click', () => {
  const base  = parseInt(document.getElementById('pricing-default-base').value)  || 0;
  const bonus = parseInt(document.getElementById('pricing-default-bonus').value) || 0;
  db.ref('pricing/config').set({ ...pricing, default: { baseReward: base, contractBonus: bonus } }).then(() => showToast('Збережено', 'success'));
});

document.getElementById('btn-add-override').addEventListener('click', () => {
  const tid = document.getElementById('override-teacher-select').value;
  if (!tid) return;
  const base = parseInt(document.getElementById('override-base').value) || 50;
  const bonus = parseInt(document.getElementById('override-bonus').value) || 100;
  const newPricing = { ...pricing, overrides: { ...pricing.overrides, [tid]: { baseReward: base, contractBonus: bonus } } };
  db.ref('pricing/config').set(newPricing).then(() => showToast('Додано', 'success'));
});

function updateOverride(tid, field, value) {
  const newPricing = { ...pricing, overrides: { ...pricing.overrides, [tid]: { ...pricing.overrides[tid], [field]: parseInt(value) || 0 } } };
  db.ref('pricing/config').set(newPricing);
}

function removeOverride(tid) {
  const newOverrides = { ...pricing.overrides }; delete newOverrides[tid];
  db.ref('pricing/config').set({ ...pricing, overrides: newOverrides }).then(() => showToast('Видалено', 'info'));
}

function renderTeachers() {
  const list = document.getElementById('teachers-list');
  list.innerHTML = '';
  Object.values(teachers).forEach(t => {
    const item = document.createElement('div'); item.className = 'teacher-item';
    item.innerHTML = `
      <div style="display:flex; align-items:center; gap:14px; flex:1; min-width:0;">
        <div class="teacher-avatar">${t.name.charAt(0).toUpperCase()}</div>
        <div class="teacher-name">${t.name}</div>
      </div>
      <div class="teacher-actions">
        <button class="btn btn-ghost btn-sm" onclick="editTeacher('${t.id}','${escStr(t.name)}')">Ред.</button>
        <button class="btn btn-danger btn-sm" onclick="deleteTeacher('${t.id}','${escStr(t.name)}')">Вид.</button>
      </div>`;
    list.appendChild(item);
  });
}

document.getElementById('btn-add-teacher').addEventListener('click', () => {
  document.getElementById('teacher-modal-title').textContent = 'Додати вчителя';
  document.getElementById('teacher-id').value = '';
  document.getElementById('teacher-name-input').value = '';
  document.getElementById('teacher-modal').classList.add('open');
  setTimeout(() => document.getElementById('teacher-name-input').focus(), 100);
});

function editTeacher(id, name) {
  document.getElementById('teacher-modal-title').textContent = 'Редагувати вчителя';
  document.getElementById('teacher-id').value = id;
  document.getElementById('teacher-name-input').value = name;
  document.getElementById('teacher-modal').classList.add('open');
  setTimeout(() => document.getElementById('teacher-name-input').focus(), 100);
}

document.getElementById('teacher-save-btn').addEventListener('click', async () => {
  const id = document.getElementById('teacher-id').value;
  const name = document.getElementById('teacher-name-input').value.trim();
  if (!name) return;
  if (id) { await db.ref('people/' + id).update({ name }); showToast('Оновлено', 'success'); }
  else { await db.ref('people').push({ name }); showToast('Додано', 'success'); }
  closeModal('teacher-modal');
});

function deleteTeacher(id, name) {
  showConfirm(`Видалити вчителя "${name}"?`, async () => { await db.ref('people/' + id).remove(); showToast('Видалено', 'info'); });
}

function isTimeBlocked(startDT, endDT, teacherId, globalOnly) {
  return Object.values(blockedTimes).some(b => {
    if (globalOnly && b.teacherId) return false;
    if (!globalOnly && b.teacherId && b.teacherId !== teacherId) return false;

    const dayMatches = (b.days || []).includes(startDT.getDay());
    if (!dayMatches) return false;

    if (b.until) {
      const untilDate = new Date(b.until + 'T23:59:59');
      if (startDT > untilDate) return false;
    }

    const selStart = startDT.getHours() * 60 + startDT.getMinutes();
    const selEnd   = endDT.getHours()   * 60 + endDT.getMinutes();
    const [bSH, bSM] = b.start.split(':').map(Number);
    const [bEH, bEM] = b.end.split(':').map(Number);
    const blockStart = bSH * 60 + bSM;
    const blockEnd   = bEH * 60 + bEM;

    return selStart < blockEnd && selEnd > blockStart;
  });
}

// ── HELPERS ──────────────────────────────────────────────────
function populateOverrideSelect() {
  const sel = document.getElementById('override-teacher-select');
  if(!sel) return;
  sel.innerHTML = '<option value="">— Оберіть вчителя —</option>';
  Object.values(teachers).forEach(t => { const opt = document.createElement('option'); opt.value = t.id; opt.textContent = t.name; sel.appendChild(opt); });
}

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

  const text = `<b>[${status}]</b>\n\n<b>Подія:</b> ${safeTitle}\n<b>Час:</b> ${ev.date} (${ev.startTime} - ${ev.endTime})\n<b>Вчитель:</b> ${safeTeacher}\n\n<i>Менеджер: ${safeUser}</i>`;

  if (ev.telegramMessageId) {
    try { await fetch(`https://api.telegram.org/bot${TELEGRAM.BOT_TOKEN}/deleteMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: TELEGRAM.CHAT_ID, message_id: ev.telegramMessageId }) }); } catch (err) {}
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM.BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: TELEGRAM.CHAT_ID, text: text, parse_mode: 'HTML' }) });
    const data = await response.json();
    if (data.ok && data.result && data.result.message_id) { if (ev.id) await db.ref('events/' + ev.id).update({ telegramMessageId: data.result.message_id }); }
  } catch (err) {}
}

// ── EXPORTS ──────────────────────────────────────────────────
window.openCreateModal = openCreateModal;
window.openEventModal = openEventModal;
window.toggleContract = toggleContract;
window.editTeacher = editTeacher;
window.deleteTeacher = deleteTeacher;
window.updateOverride = updateOverride;
window.removeOverride = removeOverride;
window.completeEvent = completeEvent;
window.cancelEvent = cancelEvent;
window.renderConfirmedList = renderConfirmedList;
window.printStats = printStats;
window.saveBlockedTime = saveBlockedTime;
window.deleteBlockedTime = deleteBlockedTime;

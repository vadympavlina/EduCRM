// ============================================================
//  APP.JS — Internal Event Management CRM (Realtime Database Version)
//  Vanilla JS, no ES modules — works on GitHub Pages
// ============================================================

// ── TELEGRAM CONFIG ──────────────────────────────────────────
const TELEGRAM = {
  BOT_TOKEN: 'YOUR_BOT_TOKEN',   // від @BotFather
  CHAT_ID:   'YOUR_CHAT_ID'      // ID чату або групи
};

// ── STATE ────────────────────────────────────────────────────
let currentUser = localStorage.getItem('crm_user_name') || '';
let events    = {};   // { id: eventObj }
let teachers  = {};   // { id: teacherObj }
let pricing   = { default: { baseReward: 50, contractBonus: 100 }, overrides: {} };
let calendarInstance = null;
let confirmCallback  = null;

// ── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!currentUser) showNameModal(true);
  else renderUserInfo();

  setupNav();
  setupHamburger();
  listenTeachers();
  listenPricing();
  listenEvents();

  // Ініціалізація календаря після невеликої затримки
  setTimeout(initCalendar, 200);

  // Встановити поточний місяць для статистики
  const now = new Date();
  const monthSel = document.getElementById('stats-month');
  if (monthSel) {
    monthSel.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    monthSel.addEventListener('change', renderStats);
  }
});

// ── USER NAME ────────────────────────────────────────────────
function showNameModal(required = false) {
  const overlay  = document.getElementById('name-modal');
  const input    = document.getElementById('name-input');
  const saveBtn  = document.getElementById('name-save-btn');
  const closeBtn = overlay.querySelector('.modal-close');

  input.value = currentUser;
  overlay.classList.add('open');
  setTimeout(() => input.focus(), 150);

  closeBtn.style.display = required ? 'none' : '';
  saveBtn.onclick = () => saveName(input.value.trim(), required);
  input.onkeydown = e => { if (e.key === 'Enter') saveName(input.value.trim(), required); };
  closeBtn.onclick = () => { if (!required) overlay.classList.remove('open'); };
}

function saveName(name, required) {
  if (!name) { showToast('Введіть своє ім\'я', 'error'); return; }
  currentUser = name;
  localStorage.setItem('crm_user_name', name);
  document.getElementById('name-modal').classList.remove('open');
  renderUserInfo();
}

function renderUserInfo() {
  document.getElementById('user-name-display').textContent = currentUser;
  document.getElementById('user-avatar-letter').textContent = currentUser.charAt(0).toUpperCase();
}

document.getElementById('btn-change-name').addEventListener('click', () => showNameModal(false));

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

  if (page === 'stats')      renderStats();
  if (page === 'completed')  renderCompleted();
  if (page === 'pricing')    renderPricing();
  if (page === 'teachers')   renderTeachers();
  if (page === 'calendar')   setTimeout(() => calendarInstance && calendarInstance.render(), 50);
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

// ── FIREBASE LISTENERS (REALTIME DATABASE) ───────────────────
function listenEvents() {
  db.ref('events').on('value', snap => {
    const data = snap.val() || {};
    events = {}; // Очищуємо та перезаписуємо новими даними
    
    Object.keys(data).forEach(key => {
      events[key] = { id: key, ...data[key] };
    });

    refreshCalendar();
    const activePage = document.querySelector('.page.active')?.id;
    if (activePage === 'completed-page') renderCompleted();
    if (activePage === 'stats-page')     renderStats();
  });
}

function listenTeachers() {
  db.ref('people').on('value', snap => {
    const data = snap.val() || {};
    teachers = {};
    
    Object.keys(data).forEach(key => {
      teachers[key] = { id: key, ...data[key] };
    });

    const activePage = document.querySelector('.page.active')?.id;
    if (activePage === 'teachers-page') renderTeachers();
    if (activePage === 'pricing-page')  renderPricing();
    populateOverrideSelect();
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
    slotMinTime:           '07:00:00',
    slotMaxTime:           '22:00:00',
    nowIndicator:          true,
    selectable:            true,
    editable:              true,
    eventResizableFromStart: true,
    selectMirror:          true,
    locale:                'uk',

    select(info) {
      openCreateModal(info.startStr, info.endStr);
      calendarInstance.unselect();
    },

    eventClick(info) {
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

  window.addEventListener('resize', debounce(() => {
    const mobile = window.innerWidth < 768;
    calendarInstance.changeView(mobile ? 'timeGridDay' : 'timeGridWeek');
  }, 300));
}

function refreshCalendar() {
  if (!calendarInstance) return;

  // Видалити події яких більше немає
  calendarInstance.getEvents().forEach(fcEv => {
    if (!events[fcEv.id]) fcEv.remove();
  });

  // Додати або оновити
  Object.values(events).forEach(ev => {
    const existing = calendarInstance.getEventById(ev.id);
    const start = parseDateTime(ev.date, ev.startTime || '09:00');
    const end   = parseDateTime(ev.date, ev.endTime   || '10:00');
    const title = ev.title + (teacherName(ev.assignedPersonId)
      ? ' · ' + teacherName(ev.assignedPersonId) : '');

    if (existing) {
      existing.remove();
    }

    calendarInstance.addEvent({
      id:         ev.id,
      title,
      start,
      end,
      classNames: [`status-${ev.status}`]
    });
  });
}

function parseDateTime(date, time) {
  const [y, m, d]   = date.split('-').map(Number);
  const [hh, mm]    = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm);
}

// ── EVENT MODAL (CREATE / EDIT) ──────────────────────────────
function openCreateModal(startStr, endStr) {
  const form = document.getElementById('event-form');
  form.reset();
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

  // Статус бар
  const statusHTML = `
    <div class="event-status-bar">
      <span class="badge badge-${ev.status}">${statusLabel(ev.status)}</span>
      ${ev.createdBy   ? `<span class="meta-by">Створив: ${ev.createdBy}</span>`   : ''}
      ${ev.confirmedBy ? `<span class="meta-by">Підтвердив: ${ev.confirmedBy}</span>` : ''}
      ${ev.cancelledBy ? `<span class="meta-by">Скасував: ${ev.cancelledBy}</span>` : ''}
      ${ev.completedBy ? `<span class="meta-by">Завершив: ${ev.completedBy}</span>` : ''}
    </div>`;
  document.getElementById('event-status-section').innerHTML = statusHTML;

  // Кнопки дій
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

// Зберегти подію
document.getElementById('event-save-btn').addEventListener('click', async () => {
  const id          = document.getElementById('event-id').value;
  const title       = document.getElementById('event-title').value.trim();
  const description = document.getElementById('event-description').value.trim();
  const phone       = document.getElementById('event-phone').value.trim();
  const date        = document.getElementById('event-date').value;
  const startTime   = document.getElementById('event-start').value;
  const endTime     = document.getElementById('event-end').value;
  const assignedPersonId = document.getElementById('event-teacher').value;

  if (!title)               { showToast('Назва обов\'язкова', 'error'); return; }
  if (!date)                { showToast('Дата обов\'язкова', 'error'); return; }
  if (!startTime || !endTime) { showToast('Час початку та кінця обов\'язковий', 'error'); return; }

  const data = { title, description, phone, date, startTime, endTime, assignedPersonId };

  if (!id) {
    data.status    = 'pending';
    data.createdBy = currentUser;
    data.createdAt = new Date().toISOString();
    
    // Створення нового запису в Realtime Database
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
  if (!ev) return;
  if (ev.status !== 'confirmed') {
    showToast('Спочатку підтвердіть подію', 'error');
    return;
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
    await db.ref('events/' + id).remove();
    showToast('Подію видалено', 'info');
    closeModal('event-modal');
  });
}

document.getElementById('event-cancel-btn').addEventListener('click', () => closeModal('event-modal'));

// ── COMPLETED EVENTS ─────────────────────────────────────────
function renderCompleted() {
  const list = Object.values(events)
    .filter(e => e.status === 'completed')
    .sort((a, b) => new Date(b.completedAt || b.createdAt || 0) - new Date(a.completedAt || a.createdAt || 0));

  let totalEarnings = 0, totalContracts = 0;
  const tbody = document.getElementById('completed-tbody');
  tbody.innerHTML = '';

  if (list.length === 0) {
    document.getElementById('completed-empty').style.display = '';
    document.getElementById('completed-table-wrap').style.display = 'none';
  } else {
    document.getElementById('completed-empty').style.display = 'none';
    document.getElementById('completed-table-wrap').style.display = '';

    list.forEach(ev => {
      const p        = getPricing(ev.assignedPersonId);
      const earnings = ev.contractSigned ? p.baseReward + p.contractBonus : p.baseReward;
      totalEarnings += earnings;
      if (ev.contractSigned) totalContracts++;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Назва">${ev.title}</td>
        <td data-label="Дата">${ev.date}</td>
        <td data-label="Час">${ev.startTime}–${ev.endTime}</td>
        <td data-label="Вчитель">${teacherName(ev.assignedPersonId) || '—'}</td>
        <td data-label="Телефон">${ev.phone || '—'}</td>
        <td data-label="Договір">
          <input type="checkbox" ${ev.contractSigned ? 'checked' : ''}
            onchange="toggleContract('${ev.id}', this.checked)">
        </td>
        <td data-label="Заробіток" class="earnings-value">$${earnings}</td>
        <td data-label="Завершив">${ev.completedBy || '—'}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  document.getElementById('completed-total').textContent    = list.length;
  document.getElementById('completed-earnings').textContent = '$' + totalEarnings;
  document.getElementById('completed-contracts').textContent = totalContracts;
}

function toggleContract(id, checked) {
  db.ref('events/' + id).update({ contractSigned: checked })
    .then(() => renderCompleted());
}

// ── STATISTICS ───────────────────────────────────────────────
function renderStats() {
  const selectedMonth = document.getElementById('stats-month').value;

  const completed = Object.values(events).filter(e => {
    if (e.status !== 'completed') return false;
    if (!selectedMonth) return true;
    return e.date && e.date.startsWith(selectedMonth);
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
  const tfoot = document.getElementById('stats-tfoot');
  tbody.innerHTML = '';
  tfoot.innerHTML = '';

  let gCount = 0, gContracts = 0, gEarnings = 0;

  if (Object.keys(byTeacher).length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:32px">Немає завершених подій за цей період</td></tr>`;
    return;
  }

  Object.entries(byTeacher).forEach(([tid, data]) => {
    const name = tid === '__none__' ? 'Не призначено' : (teachers[tid]?.name || 'Невідомо');
    gCount += data.count; gContracts += data.contracts; gEarnings += data.earnings;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Вчитель">${name}</td>
      <td data-label="Подій">${data.count}</td>
      <td data-label="Договорів">${data.contracts}</td>
      <td data-label="Заробіток" class="earnings-value">$${data.earnings}</td>`;
    tbody.appendChild(tr);
  });

  tfoot.innerHTML = `
    <tr style="font-weight:700;color:var(--accent)">
      <td>РАЗОМ</td><td>${gCount}</td><td>${gContracts}</td>
      <td class="earnings-value">$${gEarnings}</td>
    </tr>`;
}

// ── PRICING ──────────────────────────────────────────────────
function renderPricing() {
  document.getElementById('pricing-default-base').value  = pricing.default.baseReward;
  document.getElementById('pricing-default-bonus').value = pricing.default.contractBonus;

  const container = document.getElementById('pricing-overrides');
  container.innerHTML = '';

  Object.entries(pricing.overrides || {}).forEach(([tid, vals]) => {
    const teacher = teachers[tid];
    if (!teacher) return;
    const row = document.createElement('div');
    row.className = 'pricing-row';
    row.innerHTML = `
      <span class="pricing-teacher-name">${teacher.name}</span>
      <div class="pricing-input-group">
        <label>Базова $</label>
        <input class="pricing-input" type="number" min="0" value="${vals.baseReward}"
          onchange="updateOverride('${tid}','baseReward',this.value)">
      </div>
      <div class="pricing-input-group">
        <label>Бонус $</label>
        <input class="pricing-input" type="number" min="0" value="${vals.contractBonus}"
          onchange="updateOverride('${tid}','contractBonus',this.value)">
      </div>
      <button class="btn btn-danger btn-sm" onclick="removeOverride('${tid}')">Видалити</button>`;
    container.appendChild(row);
  });
}

document.getElementById('pricing-save-default').addEventListener('click', () => {
  const base  = parseInt(document.getElementById('pricing-default-base').value)  || 0;
  const bonus = parseInt(document.getElementById('pricing-default-bonus').value) || 0;
  db.ref('pricing/config').set({ ...pricing, default: { baseReward: base, contractBonus: bonus } })
    .then(() => showToast('Збережено', 'success'));
});

document.getElementById('btn-add-override').addEventListener('click', () => {
  const tid   = document.getElementById('override-teacher-select').value;
  const base  = parseInt(document.getElementById('override-base').value)  || 50;
  const bonus = parseInt(document.getElementById('override-bonus').value) || 100;
  if (!tid) { showToast('Оберіть вчителя', 'error'); return; }
  const newPricing = { ...pricing, overrides: { ...pricing.overrides, [tid]: { baseReward: base, contractBonus: bonus } } };
  db.ref('pricing/config').set(newPricing)
    .then(() => { showToast('Додано', 'success'); document.getElementById('override-teacher-select').value = ''; });
});

function updateOverride(tid, field, value) {
  const newPricing = { ...pricing, overrides: { ...pricing.overrides, [tid]: { ...pricing.overrides[tid], [field]: parseInt(value) || 0 } } };
  db.ref('pricing/config').set(newPricing);
}

function removeOverride(tid) {
  const newOverrides = { ...pricing.overrides };
  delete newOverrides[tid];
  db.ref('pricing/config').set({ ...pricing, overrides: newOverrides })
    .then(() => showToast('Видалено', 'info'));
}

function populateOverrideSelect() {
  const sel = document.getElementById('override-teacher-select');
  const val = sel.value;
  sel.innerHTML = '<option value="">— Оберіть вчителя —</option>';
  Object.values(teachers).forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id; opt.textContent = t.name;
    if (t.id === val) opt.selected = true;
    sel.appendChild(opt);
  });
}

// ── TEACHERS ─────────────────────────────────────────────────
function renderTeachers() {
  const list = document.getElementById('teachers-list');
  list.innerHTML = '';
  populateOverrideSelect();

  const arr = Object.values(teachers);
  if (arr.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg></div><div class="empty-state-text">Вчителів ще немає</div></div>`;
    return;
  }

  arr.forEach(t => {
    const item = document.createElement('div');
    item.className = 'teacher-item';
    item.innerHTML = `
      <div class="teacher-avatar">${t.name.charAt(0).toUpperCase()}</div>
      <div class="teacher-name">${t.name}</div>
      <div class="teacher-actions">
        <button class="btn btn-ghost btn-sm" onclick="editTeacher('${t.id}','${escStr(t.name)}')">Ред.</button>
        <button class="btn btn-danger btn-sm" onclick="deleteTeacher('${t.id}','${escStr(t.name)}')">Вид.</button>
      </div>`;
    list.appendChild(item);
  });
}

function escStr(s) { return s.replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

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
  const id   = document.getElementById('teacher-id').value;
  const name = document.getElementById('teacher-name-input').value.trim();
  if (!name) { showToast("Ім'я обов'язкове", 'error'); return; }

  if (id) {
    await db.ref('people/' + id).update({ name });
    showToast('Оновлено', 'success');
  } else {
    await db.ref('people').push({ name });
    showToast('Додано', 'success');
  }
  closeModal('teacher-modal');
});

document.getElementById('teacher-cancel-btn').addEventListener('click', () => closeModal('teacher-modal'));

function deleteTeacher(id, name) {
  const used = Object.values(events).some(e => e.assignedPersonId === id);
  const msg  = used
    ? `"${name}" призначений до подій. Все одно видалити?`
    : `Видалити вчителя "${name}"?`;
  showConfirm(msg, async () => {
    await db.ref('people/' + id).remove();
    showToast('Видалено', 'info');
  });
}

// ── TELEGRAM ─────────────────────────────────────────────────
function sendTelegram(status, ev) {
  if (!TELEGRAM.BOT_TOKEN || TELEGRAM.BOT_TOKEN === 'YOUR_BOT_TOKEN') return;
  const teacher = teacherName(ev.assignedPersonId) || 'Не призначено';
  const text = `[${status}]\nПодія: ${ev.title}\nДата: ${ev.date} ${ev.startTime}–${ev.endTime}\nВчитель: ${teacher}\nТелефон: ${ev.phone || '—'}\nКим: ${currentUser}`;
  fetch(`https://api.telegram.org/bot${TELEGRAM.BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM.CHAT_ID, text })
  }).catch(() => {});
}

// ── HELPERS ──────────────────────────────────────────────────
function getPricing(tid) {
  return (tid && pricing.overrides[tid]) ? pricing.overrides[tid] : pricing.default;
}

function teacherName(id) {
  return id ? (teachers[id]?.name || '') : '';
}

function formatDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function formatTime(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pad(n) { return String(n).padStart(2, '0'); }

function debounce(fn, delay) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

// ── MODALS ────────────────────────────────────────────────────
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay && overlay.id !== 'name-modal') {
      overlay.classList.remove('open');
    }
  });
});

// ── CONFIRM ──────────────────────────────────────────────────
function showConfirm(message, onConfirm) {
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('confirm-dialog').classList.add('open');
  confirmCallback = onConfirm;
}

document.getElementById('confirm-ok').addEventListener('click', () => {
  document.getElementById('confirm-dialog').classList.remove('open');
  if (confirmCallback) confirmCallback();
  confirmCallback = null;
});

document.getElementById('confirm-cancel').addEventListener('click', () => {
  document.getElementById('confirm-dialog').classList.remove('open');
  confirmCallback = null;
});

// ── TOAST ─────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

// ── GLOBAL EXPORTS (для inline onclick) ──────────────────────
window.openCreateModal  = openCreateModal;
window.openEventModal   = openEventModal;
window.toggleContract   = toggleContract;
window.editTeacher      = editTeacher;
window.deleteTeacher    = deleteTeacher;
window.updateOverride   = updateOverride;
window.removeOverride   = removeOverride;

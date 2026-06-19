// ============================================================
//  group-events.js
//  Групові події — окремий тип події з кількома учасниками.
//  Зберігається у вузлі groupEvents/{id} в Firebase.
//  Залежить від app.js (teachers, pricing, currentUser, escapeHTML,
//  showToast, showConfirm, closeModal, openModal, parseDateTime,
//  formatDate, formatTime, teacherName, TELEGRAM, SITE_URL).
// ============================================================

const GroupEvents = (() => {

  let groupEvents = {};          // id -> groupEvent
  let clientsDB   = {};          // phone -> client (з вузла clients)
  let editingId   = null;        // id події що редагується, або null для нової
  let draftParticipants = {};    // phone -> participant (поки модалка відкрита)

  // ── LISTENERS ────────────────────────────────────────────
  function listen() {
    db.ref('groupEvents').on('value', snap => {
      groupEvents = {};
      if (snap.exists()) {
        snap.forEach(c => { groupEvents[c.key] = { id: c.key, ...c.val() }; });
      }
      if (typeof refreshCalendar === 'function') refreshCalendar();
    });

    db.ref('clients').on('value', snap => {
      clientsDB = {};
      if (snap.exists()) snap.forEach(c => { clientsDB[c.key] = { phone: c.key, ...c.val() }; });
    });
  }

  function getAll() { return groupEvents; }

  // ── HELPERS ──────────────────────────────────────────────
  function normalizePhone(p) {
    if (!p) return '';
    return String(p).replace(/\D/g, '');
  }

  function participantsArray(ge) {
    return Object.values(ge?.participants || {});
  }

  function countAttending(ge) {
    return participantsArray(ge).filter(p => p.attending !== false).length;
  }

  // ── MODAL: OPEN / CLOSE ──────────────────────────────────
  function openCreate(startStr, endStr) {
    editingId = null;
    draftParticipants = {};

    document.getElementById('group-modal-title').textContent = 'Нова групова подія';
    document.getElementById('ge-id').value = '';
    document.getElementById('ge-title').value = '';
    document.getElementById('ge-description').value = '';

    const now = startStr ? new Date(startStr) : new Date();
    document.getElementById('ge-date').value  = formatDate(now);
    document.getElementById('ge-start').value = startStr ? formatTime(new Date(startStr)) : '10:00';
    document.getElementById('ge-end').value   = endStr ? formatTime(new Date(endStr)) : '11:00';

    _populateTeacherSelect('');
    document.getElementById('ge-status-section').innerHTML = '';
    document.getElementById('ge-actions').innerHTML = '';
    document.getElementById('ge-add-panel').style.display = 'none';

    _renderParticipants();
    openModal('group-modal');
  }

  function openEdit(id) {
    const ge = groupEvents[id];
    if (!ge) { showToast('Подію не знайдено', 'error'); return; }

    editingId = id;
    draftParticipants = JSON.parse(JSON.stringify(ge.participants || {}));

    document.getElementById('group-modal-title').textContent = 'Групова подія';
    document.getElementById('ge-id').value = id;
    document.getElementById('ge-title').value = ge.title || '';
    document.getElementById('ge-description').value = ge.description || '';
    document.getElementById('ge-date').value  = ge.date || '';
    document.getElementById('ge-start').value = ge.startTime || '';
    document.getElementById('ge-end').value   = ge.endTime || '';

    _populateTeacherSelect(ge.assignedPersonId || '');
    document.getElementById('ge-add-panel').style.display = 'none';

    _renderStatusSection(ge);
    _renderActions(ge);
    _renderParticipants();
    openModal('group-modal');
  }

  function close() {
    closeModal('group-modal');
    editingId = null;
    draftParticipants = {};
  }

  function _populateTeacherSelect(selectedId) {
    const sel = document.getElementById('ge-teacher');
    sel.innerHTML = '<option value="">— Оберіть вчителя —</option>' +
      Object.values(teachers)
        .sort((a, b) => a.name.localeCompare(b.name, 'uk'))
        .map(t => `<option value="${t.id}">${escapeHTML(t.name)}</option>`)
        .join('');
    sel.value = selectedId || '';
  }

  function _renderStatusSection(ge) {
    const el = document.getElementById('ge-status-section');
    if (!ge.status || ge.status === 'pending') { el.innerHTML = ''; return; }
    const map = {
      completed: { label: 'Проведено', cls: 'status-completed' },
      cancelled: { label: 'Скасовано', cls: 'status-cancelled' }
    };
    const s = map[ge.status];
    if (!s) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="status-badge ${s.cls}" style="margin-bottom:12px">${s.label}</div>`;
  }

  function _renderActions(ge) {
    const el = document.getElementById('ge-actions');
    if (!ge || !ge.id) { el.innerHTML = ''; return; }

    const buttons = [];
    if (ge.status !== 'completed') {
      buttons.push(`<button class="btn btn-success btn-sm" onclick="GroupEvents.setStatus('completed')">Провести</button>`);
    }
    if (ge.status !== 'cancelled') {
      buttons.push(`<button class="btn btn-danger btn-sm" onclick="GroupEvents.setStatus('cancelled')">Скасувати</button>`);
    }
    if (ge.status === 'cancelled' || ge.status === 'completed') {
      buttons.push(`<button class="btn btn-ghost btn-sm" onclick="GroupEvents.setStatus('pending')">Повернути в очікування</button>`);
    }
    buttons.push(`<button class="btn btn-danger btn-sm" onclick="GroupEvents.remove()" style="margin-left:auto">Видалити подію</button>`);
    el.innerHTML = buttons.join('');
  }

  // ── PARTICIPANTS: RENDER ─────────────────────────────────
  function _renderParticipants() {
    const list  = document.getElementById('ge-participants-list');
    const empty = document.getElementById('ge-participants-empty');
    const badge = document.getElementById('ge-count-badge');

    const items = Object.values(draftParticipants);
    badge.textContent = items.length ? `(${items.length})` : '';

    if (items.length === 0) {
      list.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    list.innerHTML = items.map(p => _participantCard(p)).join('');
  }

  function _participantCard(p) {
    const phone = p.phone;
    const contractMap = {
      none:    { label: 'Без договору',  cls: 'cs-none' },
      signed:  { label: 'Підписали',     cls: 'cs-signed' },
      already: { label: 'Вже має',       cls: 'cs-already' }
    };
    const cs = contractMap[p.contractStatus] || contractMap.none;
    const attending = p.attending !== false;

    return `
      <div class="ge-pcard" data-phone="${escapeHTML(phone)}">
        <div class="ge-pcard-top">
          <label class="ge-attend-toggle" title="Прийде на захід">
            <input type="checkbox" ${attending ? 'checked' : ''}
              onchange="GroupEvents.setAttending('${escapeHTML(phone)}', this.checked)">
          </label>
          <div class="ge-pcard-name">${escapeHTML(p.name || '—')}</div>
          <button class="ge-pcard-remove" title="Прибрати з події"
            onclick="GroupEvents.removeParticipant('${escapeHTML(phone)}')">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="ge-pcard-meta">
          <span>${escapeHTML(p.phone || '—')}</span>
          ${p.age ? `<span>· ${escapeHTML(String(p.age))} р.</span>` : ''}
        </div>
        <div class="ge-pcard-contract">
          <button class="ge-contract-chip ${cs.cls}" onclick="GroupEvents.cycleContract('${escapeHTML(phone)}')">
            ${cs.label}
          </button>
        </div>
      </div>`;
  }

  function setAttending(phone, val) {
    if (!draftParticipants[phone]) return;
    draftParticipants[phone].attending = val;
    _renderParticipants();
  }

  function cycleContract(phone) {
    const p = draftParticipants[phone];
    if (!p) return;
    const order = ['none', 'signed', 'already'];
    const idx = order.indexOf(p.contractStatus || 'none');
    const next = order[(idx + 1) % order.length];
    p.contractStatus = next;
    if (next === 'signed') p.contractSignedAt = Date.now();
    _renderParticipants();
  }

  function removeParticipant(phone) {
    showConfirm('Прибрати цього учасника з події?', () => {
      delete draftParticipants[phone];
      _renderParticipants();
    });
  }

  // ── ADD PARTICIPANT PANEL ────────────────────────────────
  function openAddParticipant() {
    const panel = document.getElementById('ge-add-panel');
    const isOpen = panel.style.display === 'block';
    panel.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
      document.getElementById('ge-search-client').value = '';
      document.getElementById('ge-search-results').innerHTML = '';
      document.getElementById('ge-new-name').value = '';
      document.getElementById('ge-new-age').value = '';
      document.getElementById('ge-new-phone').value = '';
      document.getElementById('ge-search-client').focus();
    }
  }

  function _searchClients(query) {
    const q = (query || '').trim().toLowerCase();
    const qDigits = normalizePhone(query);
    if (!q) return [];
    return Object.values(clientsDB).filter(c => {
      const nameMatch  = (c.name || '').toLowerCase().includes(q);
      const phoneMatch = qDigits && normalizePhone(c.phone).includes(qDigits);
      return nameMatch || phoneMatch;
    }).slice(0, 8);
  }

  function _bindSearchInput() {
    const input = document.getElementById('ge-search-client');
    if (!input || input._bound) return;
    input._bound = true;
    input.addEventListener('input', () => {
      const results = _searchClients(input.value);
      const box = document.getElementById('ge-search-results');
      if (results.length === 0) {
        box.innerHTML = input.value.trim()
          ? '<div style="padding:8px;font-size:12px;color:var(--text3)">Нічого не знайдено — додайте нижче</div>'
          : '';
        return;
      }
      box.innerHTML = results.map(c => `
        <div class="ge-search-item" onclick="GroupEvents.addExistingClient('${escapeHTML(c.phone)}')">
          <div class="ge-search-item-name">${escapeHTML(c.name || '—')}</div>
          <div class="ge-search-item-phone">${escapeHTML(c.phone || '')}</div>
        </div>`).join('');
    });
  }

  function addExistingClient(phone) {
    const c = clientsDB[phone];
    if (!c) { showToast('Клієнта не знайдено', 'error'); return; }
    if (draftParticipants[phone]) { showToast('Цей клієнт вже в списку', 'info'); return; }

    draftParticipants[phone] = {
      phone,
      name: c.name || '',
      age:  c.age || '',
      contractStatus: c.contractStatus || 'none',
      attending: true
    };
    document.getElementById('ge-add-panel').style.display = 'none';
    _renderParticipants();
    showToast('Учасника додано', 'success');
  }

  async function addNewClient() {
    const name  = document.getElementById('ge-new-name').value.trim();
    const age   = document.getElementById('ge-new-age').value.trim();
    const phoneRaw = document.getElementById('ge-new-phone').value.trim();
    const phone = normalizePhone(phoneRaw);

    if (!name) { showToast("Вкажіть ПІБ", 'error'); return; }
    if (!phone || phone.length < 9) { showToast('Вкажіть коректний номер телефону', 'error'); return; }
    if (draftParticipants[phone]) { showToast('Цей клієнт вже в списку', 'info'); return; }

    // Якщо клієнта ще нема в базі clients — створюємо
    if (!clientsDB[phone]) {
      try {
        await db.ref('clients/' + phone).set({
          name, age: age || null, phone: phoneRaw,
          createdAt: Date.now(), createdBy: currentUser
        });
      } catch (err) {
        console.error('Помилка створення клієнта:', err);
        showToast('Не вдалося створити клієнта', 'error');
        return;
      }
    }

    draftParticipants[phone] = {
      phone: phoneRaw, name, age: age || '',
      contractStatus: 'none', attending: true
    };

    document.getElementById('ge-add-panel').style.display = 'none';
    _renderParticipants();
    showToast('Клієнта додано', 'success');
  }

  // ── PARTICIPANT SEARCH INPUT BINDING (lazy, on modal open) ──
  document.addEventListener('DOMContentLoaded', () => {
    const obs = new MutationObserver(() => _bindSearchInput());
    const modal = document.getElementById('group-modal');
    if (modal) obs.observe(modal, { attributes: true, attributeFilter: ['class'] });
    _bindSearchInput();
  });

  // ── SAVE / STATUS / DELETE ────────────────────────────────
  async function save() {
    const title    = document.getElementById('ge-title').value.trim();
    const date     = document.getElementById('ge-date').value;
    const start    = document.getElementById('ge-start').value;
    const end      = document.getElementById('ge-end').value;
    const teacher  = document.getElementById('ge-teacher').value;
    const desc     = document.getElementById('ge-description').value.trim();

    if (!title || !date || !start || !end) {
      showToast("Заповніть обов'язкові поля", 'error'); return;
    }
    if (!teacher) {
      const teacherEl = document.getElementById('ge-teacher');
      teacherEl.style.borderColor = 'var(--red)';
      teacherEl.focus();
      setTimeout(() => teacherEl.style.borderColor = '', 2000);
      showToast('Оберіть вчителя', 'error'); return;
    }
    if (Object.keys(draftParticipants).length === 0) {
      showToast('Додайте хоча б одного учасника', 'error'); return;
    }

    const payload = {
      title, date, startTime: start, endTime: end,
      assignedPersonId: teacher,
      description: desc,
      participants: draftParticipants,
      status: groupEvents[editingId]?.status || 'pending',
      updatedAt: Date.now(),
      updatedBy: currentUser
    };

    try {
      let id = editingId;
      if (id) {
        await db.ref('groupEvents/' + id).update(payload);
      } else {
        payload.createdAt = Date.now();
        payload.createdBy = currentUser;
        const ref = await db.ref('groupEvents').push(payload);
        id = ref.key;
      }

      // Синхронізуємо картки клієнтів (ім'я/вік/договір)
      _syncClientCards(draftParticipants);

      await _sendOrUpdateTelegram(id, { id, ...payload });

      showToast('Групову подію збережено', 'success');
      close();
    } catch (err) {
      console.error('Помилка збереження групової події:', err);
      showToast('Помилка збереження', 'error');
    }
  }

  function _syncClientCards(participants) {
    Object.values(participants).forEach(p => {
      const phone = normalizePhone(p.phone);
      if (!phone) return;
      const update = { name: p.name, age: p.age || null };
      if (p.contractStatus === 'signed' || p.contractStatus === 'already') {
        update.contractStatus = p.contractStatus;
        if (p.contractSignedAt) update.contractSignedAt = p.contractSignedAt;
      }
      db.ref('clients/' + phone).update(update).catch(() => {});
    });
  }

  function setStatus(status) {
    if (!editingId) return;
    db.ref('groupEvents/' + editingId + '/status').set(status)
      .then(async () => {
        showToast(status === 'completed' ? 'Подію проведено' : status === 'cancelled' ? 'Подію скасовано' : 'Статус скинуто', 'success');
        const ge = { ...groupEvents[editingId], status };
        await _sendOrUpdateTelegram(editingId, ge);
        openEdit(editingId);
      });
  }

  function remove() {
    if (!editingId) return;
    showConfirm('Видалити цю групову подію повністю?', async () => {
      const ge = groupEvents[editingId];
      if (ge?.telegramMessageId) {
        _deleteTelegramMessage(ge.telegramMessageId).catch(() => {});
      }
      await db.ref('groupEvents/' + editingId).remove();
      showToast('Подію видалено', 'info');
      close();
    });
  }


  // ── TELEGRAM ──────────────────────────────────────────────
  function _escTg(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function _buildTelegramText(ge) {
    const statusMap = {
      pending:   '🟡 Очікується',
      completed: '✅ Проведено',
      cancelled: '❌ Скасовано'
    };
    const statusLine = statusMap[ge.status] || statusMap.pending;
    const tName = (typeof teacherName === 'function') ? teacherName(ge.assignedPersonId) : '';
    const participants = Object.values(ge.participants || {});
    const attending = participants.filter(p => p.attending !== false);

    const dateLabel = ge.date ? ge.date.split('-').reverse().join('.') : '';

    let peopleList = '';
    if (participants.length > 0) {
      peopleList = participants.map((p, i) => {
        const mark = p.attending === false ? '⚪️' : '🔹';
        const contractMark = p.contractStatus === 'signed' ? ' 📄✅'
          : p.contractStatus === 'already' ? ' 📄'
          : '';
        const age = p.age ? `, ${_escTg(p.age)}р.` : '';
        return `${mark} ${i + 1}. ${_escTg(p.name)}${age}${contractMark}`;
      }).join('\n');
    } else {
      peopleList = '<i>Учасників ще немає</i>';
    }

    return [
      `👥 <b>ГРУПОВА ПОДІЯ</b>`,
      `${statusLine}`,
      ``,
      `📌 <b>${_escTg(ge.title)}</b>`,
      `📅 ${dateLabel}   🕐 ${_escTg(ge.startTime)}–${_escTg(ge.endTime)}`,
      `👨‍🏫 ${_escTg(tName) || '—'}`,
      ``,
      `<b>Учасники (${attending.length}/${participants.length}):</b>`,
      peopleList,
      ge.description ? `\n💬 ${_escTg(ge.description)}` : ''
    ].filter(Boolean).join('\n');
  }

  async function _sendOrUpdateTelegram(id, ge) {
    if (!TELEGRAM?.BOT_TOKEN) return;
    try {
      // Стара модель: видаляємо попереднє повідомлення і шлемо нове
      if (ge.telegramMessageId) {
        await _deleteTelegramMessage(ge.telegramMessageId).catch(() => {});
      }
      const text = _buildTelegramText(ge);
      const res = await fetch(`https://api.telegram.org/bot${TELEGRAM.BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM.CHAT_ID, text, parse_mode: 'HTML' })
      });
      const data = await res.json();
      if (data.ok && data.result?.message_id) {
        await db.ref('groupEvents/' + id + '/telegramMessageId').set(data.result.message_id);
      }
    } catch (err) {
      console.error('Telegram error (group event):', err);
    }
  }

  async function _deleteTelegramMessage(messageId) {
    if (!TELEGRAM?.BOT_TOKEN || !messageId) return;
    await fetch(`https://api.telegram.org/bot${TELEGRAM.BOT_TOKEN}/deleteMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM.CHAT_ID, message_id: messageId })
    });
  }

  return {
    listen, getAll, openCreate, openEdit, close, save,
    setStatus, remove,
    setAttending, cycleContract, removeParticipant,
    openAddParticipant, addExistingClient, addNewClient,
    countAttending, normalizePhone
  };

})();

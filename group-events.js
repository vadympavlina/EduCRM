// ============================================================
//  group-events.js
//  Групові події — окремий тип події з кількома учасниками.
//  Зберігається у вузлі groupEvents/{id} в Firebase.
//  Залежить від app.js (teachers, pricing, currentUser, escapeHTML,
//  showToast, showConfirm, closeModal, parseDateTime,
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
    document.getElementById('group-modal').classList.add('open');
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
    document.getElementById('group-modal').classList.add('open');
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
    const map = {
      pending:   'Очікується',
      completed: 'Проведено',
      cancelled: 'Скасовано'
    };
    const label = map[ge.status] || map.pending;
    el.innerHTML = `<div style="margin-bottom:12px">
      <span class="badge badge-${ge.status || 'pending'}">${label}</span>
      ${ge.updatedBy ? `<span class="meta-by" style="margin-left:8px">Оновив: ${escapeHTML(ge.updatedBy)}</span>` : ''}
    </div>`;
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
    const confirmState = p.confirmStatus || 'pending'; // pending | coming | not_coming

    return `
      <div class="ge-pcard" data-phone="${escapeHTML(phone)}">
        <div class="ge-pcard-top">
          <div class="ge-pcard-name-block">
            <div class="ge-pcard-name">${escapeHTML(p.name || '—')}</div>
            <div class="ge-pcard-meta">
              <span>${escapeHTML(p.phone || '—')}</span>
              ${p.age ? `<span>· ${escapeHTML(String(p.age))} р.</span>` : ''}
            </div>
          </div>
          <button class="ge-pcard-remove" title="Прибрати з події"
            onclick="GroupEvents.removeParticipant('${escapeHTML(phone)}')">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="ge-pcard-row">
          <div class="ge-confirm-group" role="group">
            <button class="ge-confirm-btn cb-coming ${confirmState === 'coming' ? 'active' : ''}"
              title="Прийде" onclick="GroupEvents.setConfirmStatus('${escapeHTML(phone)}', 'coming')">
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
            </button>
            <button class="ge-confirm-btn cb-pending ${confirmState === 'pending' ? 'active' : ''}"
              title="Очікується" onclick="GroupEvents.setConfirmStatus('${escapeHTML(phone)}', 'pending')">
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>
            </button>
            <button class="ge-confirm-btn cb-not-coming ${confirmState === 'not_coming' ? 'active' : ''}"
              title="Не прийде" onclick="GroupEvents.setConfirmStatus('${escapeHTML(phone)}', 'not_coming')">
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <button class="ge-contract-chip ${cs.cls}" onclick="GroupEvents.cycleContract('${escapeHTML(phone)}')">
            ${cs.label}
          </button>
        </div>
      </div>`;
  }

  function setConfirmStatus(phone, status) {
    if (!draftParticipants[phone]) return;
    draftParticipants[phone].confirmStatus = status;
    // зберігаємо зворотну сумісність зі старим полем attending
    draftParticipants[phone].attending = status !== 'not_coming';
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
      contractStatus: 'none', // статус договору завжди починається заново для нової події
      confirmStatus: 'pending',
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
      contractStatus: 'none', confirmStatus: 'pending', attending: true
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
      const prevTelegramId = editingId ? groupEvents[editingId]?.telegramMessageId : null;
      const oldParticipants = editingId ? Object.values(groupEvents[editingId]?.participants || {}) : [];

      if (id) {
        await db.ref('groupEvents/' + id).update(payload);
      } else {
        payload.createdAt = Date.now();
        payload.createdBy = currentUser;
        const ref = await db.ref('groupEvents').push(payload);
        id = ref.key;
      }

      // Прибираємо дзеркальні events для учасників, яких видалили зі списку
      const removedUpdates = {};
      oldParticipants.forEach(op => {
        const phone = normalizePhone(op.phone);
        if (phone && !draftParticipants[phone]) {
          removedUpdates['events/' + _mirrorEventId(id, phone)] = null;
        }
      });
      if (Object.keys(removedUpdates).length > 0) {
        await db.ref().update(removedUpdates).catch(() => {});
      }

      // Дзеркалимо кожного учасника в events/, щоб client.html і "Договір" бачили цю подію
      await _syncParticipantEvents(id, { id, ...payload });

      await _sendOrUpdateTelegram(id, { id, ...payload, telegramMessageId: prevTelegramId });

      showToast('Групову подію збережено', 'success');
      close();
    } catch (err) {
      console.error('Помилка збереження групової події:', err);
      showToast('Помилка збереження', 'error');
    }
  }

  // Детермінований id дзеркального запису в events для пари (groupEventId, phone)
  function _mirrorEventId(groupEventId, phone) {
    return 'ge_' + groupEventId + '_' + normalizePhone(phone);
  }

  // Мапа статусу групової події -> статус для events (щоб client.html малював правильні кнопки)
  function _mapGroupStatusToEventStatus(geStatus, confirmStatus) {
    if (geStatus === 'completed') return 'completed';
    if (geStatus === 'cancelled') return 'cancelled';
    // pending групової події: confirmStatus визначає чи це pending/confirmed на рівні client.html
    if (confirmStatus === 'coming') return 'confirmed';
    if (confirmStatus === 'not_coming') return 'cancelled';
    return 'pending';
  }

  async function _syncParticipantEvents(groupEventId, ge) {
    const participants = Object.values(ge.participants || {});
    const updates = {};

    participants.forEach(p => {
      const phone = normalizePhone(p.phone);
      if (!phone) return;
      const mid = _mirrorEventId(groupEventId, phone);
      const eventStatus = _mapGroupStatusToEventStatus(ge.status, p.confirmStatus);

      const mirror = {
        title: ge.title,
        date: ge.date,
        startTime: ge.startTime,
        endTime: ge.endTime,
        assignedPersonId: ge.assignedPersonId,
        phone: p.phone,
        clientName: p.name,
        status: eventStatus,
        isGroupMirror: true,
        groupEventId,
        createdBy: ge.createdBy || currentUser,
        updatedAt: Date.now()
      };

      if (ge.status === 'completed') {
        mirror.completedAt = mirror.completedAt || new Date().toISOString();
        mirror.completedBy = currentUser;
        // contractSigned — булевий, як очікує client.html / stats.html
        mirror.contractSigned = p.contractStatus === 'signed';
        if (p.contractStatus === 'signed') {
          mirror.contractSignedAt = p.contractSignedAt || Date.now();
        } else {
          mirror.contractSignedAt = null;
        }
        // "вже має" — не рахується в бонус, просто позначка на картці клієнта
        mirror.contractAlready = p.contractStatus === 'already';
      }

      updates['events/' + mid] = mirror;

      // Картка клієнта — ім'я/вік завжди оновлюємо
      const clientUpdate = { name: p.name, age: p.age || null };
      db.ref('clients/' + phone).update(clientUpdate).catch(() => {});
    });

    if (Object.keys(updates).length > 0) {
      await db.ref().update(updates);
    }
  }

  function setStatus(status) {
    if (!editingId) return;
    db.ref('groupEvents/' + editingId + '/status').set(status)
      .then(async () => {
        showToast(status === 'completed' ? 'Подію проведено' : status === 'cancelled' ? 'Подію скасовано' : 'Статус скинуто', 'success');
        const ge = { id: editingId, ...groupEvents[editingId], status };
        await _syncParticipantEvents(editingId, ge);
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

      // Прибираємо дзеркальні events-записи учасників
      const participants = Object.values(ge?.participants || {});
      const updates = {};
      participants.forEach(p => {
        const phone = normalizePhone(p.phone);
        if (!phone) return;
        updates['events/' + _mirrorEventId(editingId, phone)] = null;
      });
      if (Object.keys(updates).length > 0) {
        await db.ref().update(updates).catch(() => {});
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
    const attending = participants.filter(p => p.confirmStatus === 'coming' || (p.confirmStatus === undefined && p.attending !== false));

    const dateLabel = ge.date ? ge.date.split('-').reverse().join('.') : '';

    let peopleList = '';
    if (participants.length > 0) {
      peopleList = participants.map((p, i) => {
        const mark = p.confirmStatus === 'coming' ? '✅'
          : p.confirmStatus === 'not_coming' ? '❌'
          : '🕐';
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
    setConfirmStatus, cycleContract, removeParticipant,
    openAddParticipant, addExistingClient, addNewClient,
    countAttending, normalizePhone
  };

})();

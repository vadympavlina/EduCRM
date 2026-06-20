// ============================================================
//  shared/contracts.js
//  Єдина модель договорів клієнта. Договір завжди прив'язаний
//  до вчителя (teacherId) і дати підписання (signedAt) — саме
//  ці два поля визначають бонус вчителя в stats.html.
//
//  Зберігання: clients/{phone}/contracts/{contractId}
//    { title, teacherId, signedAt, signedBy, eventId?, eventTitle? }
//
//  Модуль повністю самодостатній: власні стилі та екранування,
//  не залежить від CSS чи хелперів конкретної сторінки.
//  Залежить лише від: db (firebase), currentUser, showToast (опційно)
// ============================================================

const ContractsAPI = (() => {

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _toast(msg, type) {
    if (typeof showToast === 'function') {
      // app.js: showToast(msg, 'success'|'error'); client.html: showToast(msg, true|false)
      try { showToast(msg, type === 'error' ? false : (type === 'success' ? true : type)); return; } catch (e) {}
    }
    console.log('[ContractsAPI]', msg);
  }

  function normalizePhone(p) {
    if (!p) return '';
    return String(p).replace(/\D/g, '');
  }

  // ── DATA ──────────────────────────────────────────────────
  async function createForEvent(phone, { title, teacherId, eventId, eventTitle, clientName }) {
    const ph = normalizePhone(phone);
    if (!ph) throw new Error('Невірний номер телефону');
    if (!teacherId) throw new Error('Не вказано вчителя');

    const ref = db.ref('clients/' + ph + '/contracts').push();
    const data = {
      title: title || 'Договір',
      teacherId,
      clientName: clientName || null,
      signedAt: Date.now(),
      signedBy: (typeof currentUser !== 'undefined' && currentUser) || 'Менеджер',
      eventId: eventId || null,
      eventTitle: eventTitle || null
    };
    await ref.set(data);
    return { id: ref.key, ...data };
  }

  async function createManual(phone, { title, teacherId, clientName }) {
    return createForEvent(phone, { title, teacherId, clientName, eventId: null, eventTitle: null });
  }

  async function remove(phone, contractId) {
    const ph = normalizePhone(phone);
    await db.ref('clients/' + ph + '/contracts/' + contractId).remove();
  }

  function listenAll(callback) {
    db.ref('clients').on('value', snap => {
      const result = {};
      if (snap.exists()) {
        snap.forEach(c => {
          const v = c.val();
          if (v.contracts) result[c.key] = v.contracts;
        });
      }
      callback(result);
    });
  }

  async function getForPhone(phone) {
    const ph = normalizePhone(phone);
    const snap = await db.ref('clients/' + ph + '/contracts').once('value');
    const out = [];
    if (snap.exists()) snap.forEach(c => out.push({ id: c.key, ...c.val() }));
    return out;
  }

  // ── UI: самодостатня модалка підтвердження ───────────────
  let _pendingResolve = null;
  let _requireTeacher = false;
  let _stylesInjected = false;

  function _injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      #contract-confirm-overlay {
        position: fixed; inset: 0; z-index: 3000;
        background: rgba(15, 18, 30, 0.45);
        display: none; align-items: center; justify-content: center;
        padding: 20px; font-family: 'Inter', system-ui, sans-serif;
      }
      #contract-confirm-overlay.open { display: flex; }
      .cap-modal {
        background: #fff; border-radius: 16px; width: 100%; max-width: 400px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.25);
        overflow: hidden;
      }
      .cap-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 18px 20px; border-bottom: 1px solid #e8eaf0;
      }
      .cap-title { font-size: 15px; font-weight: 800; color: #1a1d29; }
      .cap-close {
        background: none; border: none; cursor: pointer; color: #8b91a3;
        padding: 4px; border-radius: 6px; display: flex;
      }
      .cap-close:hover { background: #f1f2f6; color: #1a1d29; }
      .cap-body { padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; }
      .cap-field label {
        display: block; font-size: 11px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.4px; color: #8b91a3; margin-bottom: 6px;
      }
      .cap-field input, .cap-field select {
        width: 100%; padding: 10px 12px; border: 1.5px solid #dde0e8; border-radius: 9px;
        font-size: 14px; font-family: inherit; color: #1a1d29; outline: none;
        box-sizing: border-box; background: #fff;
      }
      .cap-field input:focus, .cap-field select:focus { border-color: #4f6ef7; }
      .cap-meta { font-size: 12px; color: #8b91a3; font-weight: 600; }
      .cap-footer {
        display: flex; justify-content: flex-end; gap: 8px;
        padding: 14px 20px; border-top: 1px solid #e8eaf0;
      }
      .cap-btn {
        padding: 9px 16px; border-radius: 9px; font-size: 13px; font-weight: 700;
        cursor: pointer; border: none; font-family: inherit;
      }
      .cap-btn-ghost { background: #f1f2f6; color: #4a4f5e; }
      .cap-btn-ghost:hover { background: #e8eaf0; }
      .cap-btn-primary { background: #4f6ef7; color: #fff; }
      .cap-btn-primary:hover { background: #3b5be8; }
    `;
    document.head.appendChild(style);
  }

  function _ensureModal() {
    _injectStyles();
    if (document.getElementById('contract-confirm-overlay')) return;
    const div = document.createElement('div');
    div.innerHTML = `
      <div id="contract-confirm-overlay">
        <div class="cap-modal">
          <div class="cap-header">
            <span class="cap-title">Оформити договір</span>
            <button class="cap-close" onclick="ContractsAPI._cancel()">
              <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="cap-body">
            <div class="cap-field">
              <label>Назва договору *</label>
              <input type="text" id="contract-title-input" placeholder="напр. Договір на навчання">
            </div>
            <div class="cap-field" id="contract-teacher-group" style="display:none">
              <label>Вчитель *</label>
              <select id="contract-teacher-select"></select>
            </div>
            <div class="cap-meta" id="contract-meta-line"></div>
          </div>
          <div class="cap-footer">
            <button class="cap-btn cap-btn-ghost" onclick="ContractsAPI._cancel()">Скасувати</button>
            <button class="cap-btn cap-btn-primary" onclick="ContractsAPI._confirm()">Підтвердити</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(div.firstElementChild);
  }

  // teachersMap: { id: {id,name} } — потрібен лише якщо requireTeacher=true
  function promptCreate({ requireTeacher = false, teachersMap = {}, defaultTitle = '' } = {}) {
    _ensureModal();
    _requireTeacher = requireTeacher;

    const titleInput = document.getElementById('contract-title-input');
    const teacherGroup = document.getElementById('contract-teacher-group');
    const teacherSelect = document.getElementById('contract-teacher-select');
    const metaLine = document.getElementById('contract-meta-line');

    titleInput.value = defaultTitle;
    teacherGroup.style.display = requireTeacher ? 'block' : 'none';
    if (requireTeacher) {
      teacherSelect.innerHTML = '<option value="">— Оберіть вчителя —</option>' +
        Object.values(teachersMap)
          .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'uk'))
          .map(t => `<option value="${_esc(t.id)}">${_esc(t.name)}</option>`).join('');
      teacherSelect.value = '';
    }

    const author = (typeof currentUser !== 'undefined' && currentUser) || 'Менеджер';
    metaLine.textContent = `Дата підписання: сьогодні · Оформив: ${author}`;

    document.getElementById('contract-confirm-overlay').classList.add('open');
    setTimeout(() => titleInput.focus(), 50);

    return new Promise(resolve => { _pendingResolve = resolve; });
  }

  function _confirm() {
    const title = document.getElementById('contract-title-input').value.trim();
    if (!title) { _toast('Вкажіть назву договору', 'error'); return; }

    let teacherId = null;
    if (_requireTeacher) {
      teacherId = document.getElementById('contract-teacher-select').value;
      if (!teacherId) { _toast('Оберіть вчителя', 'error'); return; }
    }

    document.getElementById('contract-confirm-overlay').classList.remove('open');
    if (_pendingResolve) { _pendingResolve({ title, teacherId }); _pendingResolve = null; }
  }

  function _cancel() {
    document.getElementById('contract-confirm-overlay').classList.remove('open');
    if (_pendingResolve) { _pendingResolve(null); _pendingResolve = null; }
  }

  return {
    createForEvent, createManual, remove, listenAll, getForPhone,
    promptCreate, _confirm, _cancel
  };

})();

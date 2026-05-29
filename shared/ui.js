// ============================================================
//  shared/ui.js
//  UI-хелпери: toast, confirm-dialog, modal, escape
//
//  Підключай після firebase.js і auth.js
// ============================================================

// ── TOAST ────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

// ── CONFIRM DIALOG ───────────────────────────────────────────
let _confirmCallback = null;

function showConfirm(message, onConfirm) {
  const dialog = document.getElementById('confirm-dialog');
  const msgEl  = document.getElementById('confirm-message');
  if (!dialog || !msgEl) {
    // fallback якщо модалки нема на сторінці
    if (window.confirm(message)) onConfirm();
    return;
  }
  msgEl.textContent = message;
  dialog.classList.add('open');
  _confirmCallback = onConfirm;
}

document.addEventListener('DOMContentLoaded', () => {
  const okBtn     = document.getElementById('confirm-ok');
  const cancelBtn = document.getElementById('confirm-cancel');
  if (okBtn) {
    okBtn.addEventListener('click', () => {
      closeModal('confirm-dialog');
      if (_confirmCallback) _confirmCallback();
      _confirmCallback = null;
    });
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => closeModal('confirm-dialog'));
  }
});

// ── MODAL ────────────────────────────────────────────────────
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

// ── ESCAPE ───────────────────────────────────────────────────
function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escStr(s) {
  return s.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// ── DATE HELPERS ─────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0'); }
function formatDate(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function formatTime(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

function parseDateTime(date, time) {
  return new Date(`${date}T${time}`);
}

function fmtDateUk(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('uk-UA', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
}

// ── COPY TO CLIPBOARD ────────────────────────────────────────
function copyPhone(el, phone) {
  navigator.clipboard.writeText(phone).then(() => {
    const orig = el.textContent;
    el.textContent = 'Скопійовано!';
    setTimeout(() => { el.textContent = orig; }, 1400);
  }).catch(() => {});
}

// ── AUTH LOADER HTML (вставляється динамічно якщо немає) ──────
document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('auth-loader')) {
    const div = document.createElement('div');
    div.id = 'auth-loader';
    div.innerHTML = '<div class="auth-spinner"></div>';
    div.style.cssText = 'position:fixed;inset:0;z-index:9999;background:var(--bg);display:flex;align-items:center;justify-content:center';
    document.body.prepend(div);
  }
  if (!document.getElementById('toast-container')) {
    const div = document.createElement('div');
    div.id = 'toast-container';
    document.body.appendChild(div);
  }
});

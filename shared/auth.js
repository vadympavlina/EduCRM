// ============================================================
//  shared/auth.js
//  Підключай на кожній захищеній сторінці після firebase.js
// ============================================================

let currentUser     = '';
let currentEmail    = '';
let currentPhotoURL = '';

let _authResolve;
const authReady = new Promise(res => { _authResolve = res; });
function waitForAuth() { return authReady; }

// ── AUTH CHECK ───────────────────────────────────────────────
auth.onAuthStateChanged(async firebaseUser => {
  const loader = document.getElementById('auth-loader');

  if (!firebaseUser) {
    // Firebase може тимчасово повернути null під час ініціалізації.
    // Чекаємо 600ms і перевіряємо ще раз перш ніж редіректити.
    await new Promise(r => setTimeout(r, 600));
    if (!auth.currentUser) {
      if (loader) loader.style.display = 'none';
      _showLoginOrRedirect();
    }
    return;
  }

  try {
    const snap = await db.ref('users').orderByChild('email')
      .equalTo(firebaseUser.email.toLowerCase()).once('value');

    if (!snap.exists()) {
      await auth.signOut();
      if (loader) loader.style.display = 'none';
      _showLoginOrRedirect();
      return;
    }

    const uid  = Object.keys(snap.val())[0];
    const user = snap.val()[uid];

    currentUser     = user.name || firebaseUser.displayName || firebaseUser.email;
    currentEmail    = firebaseUser.email;
    currentPhotoURL = firebaseUser.photoURL || '';

    if (loader) loader.style.display = 'none';

    _renderSidebarUser();
    _initPresence();
    _authResolve({ currentUser, currentEmail, currentPhotoURL });

    if (typeof onAuthReady === 'function') onAuthReady();

  } catch (err) {
    console.error('Auth error:', err);
    // Не редіректимо при мережевій помилці — просто ховаємо лоадер
    if (loader) loader.style.display = 'none';
    // Повторна спроба через 1с
    setTimeout(async () => {
      if (auth.currentUser) {
        window.location.reload();
      } else {
        _showLoginOrRedirect();
      }
    }, 1000);
  }
});

// ── REDIRECT / LOGIN ─────────────────────────────────────────
function _showLoginOrRedirect() {
  if (typeof showLoginModal === 'function') {
    showLoginModal(true);
  } else {
    window.location.href = 'index.html';
  }
}

// ── PRESENCE ─────────────────────────────────────────────────
function _initPresence() {
  if (!currentUser) return;
  const safeKey = currentUser.replace(/[.#$[\]]/g, '_');
  const presRef = db.ref('presence/' + safeKey);
  presRef.set({ name: currentUser, online: true, lastSeen: Date.now() });
  presRef.onDisconnect().remove();
  setInterval(() => {
    if (currentUser) presRef.update({ lastSeen: Date.now() });
  }, 30000);
}

// ── SIDEBAR USER ─────────────────────────────────────────────
function _renderSidebarUser() {
  const initial = currentUser.charAt(0).toUpperCase();

  const sbAv = document.querySelector('.sb-user-av');
  if (sbAv) sbAv.textContent = initial;

  const sbTip = document.querySelector('.sb-user-item .sb-tip');
  if (sbTip) sbTip.textContent = currentUser;

  const letterEl = document.getElementById('user-avatar-letter');
  if (letterEl) letterEl.textContent = initial;
  const nameEl = document.getElementById('user-name-display');
  if (nameEl) nameEl.textContent = currentUser;
  const emailEl = document.getElementById('user-email-display');
  if (emailEl) emailEl.textContent = currentEmail;
}

// ── LOGOUT ───────────────────────────────────────────────────
async function logout() {
  if (currentUser) {
    const safeKey = currentUser.replace(/[.#$[\]]/g, '_');
    await db.ref('presence/' + safeKey).remove().catch(() => {});
  }
  currentUser = currentEmail = currentPhotoURL = '';
  await auth.signOut();
  window.location.href = 'index.html';
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btn-change-name');
  if (btn) btn.addEventListener('click', logout);
});

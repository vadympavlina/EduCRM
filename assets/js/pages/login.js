import { auth, GoogleAuthProvider, signInWithPopup, signOut } from '../core/firebase.js';
import { findStaff } from '../core/auth.js';
import { html, render, busy } from '../core/dom.js';
import { icon } from '../ui/icons.js';

const params = new URLSearchParams(location.search);
const btn = document.getElementById('google-btn');
const alertEl = document.getElementById('login-alert');

// Дозволяємо повертатися лише на власні сторінки (без відкритих редиректів)
const nextParam = params.get('next') || '';
const next = /^[a-z0-9-]+(\.html)?(\?[^#]*)?$/i.test(nextParam) ? nextParam : './';

const MESSAGES = {
  denied: 'Цей акаунт не має доступу до EduCRM. Зверніться до адміністратора, щоб вас додали до списку.',
  error:  'Не вдалося увійти. Перевірте з\'єднання і спробуйте ще раз.',
};

function showAlert(kind) {
  alertEl.hidden = false;
  alertEl.className = 'auth-alert';
  render(alertEl, html`${icon('alert-circle', 18)}<span>${MESSAGES[kind]}</span>`);
}

function setReady() {
  btn.removeAttribute('aria-busy');
  render(btn, html`${icon('google')} Увійти через Google`);
}

async function enter(user) {
  const staff = await findStaff(user.email).catch(() => null);
  if (staff) { location.replace(next); return true; }
  await signOut(auth);
  showAlert('denied');
  return false;
}

if (params.get('reason') === 'denied') showAlert('denied');

await auth.authStateReady();
if (auth.currentUser && await enter(auth.currentUser)) {
  // перенаправляємо — кнопку не показуємо
} else {
  setReady();
}

btn.addEventListener('click', () => busy(btn, async () => {
  alertEl.hidden = true;
  try {
    const { user } = await signInWithPopup(auth, new GoogleAuthProvider());
    await enter(user);
  } catch (err) {
    if (err?.code !== 'auth/popup-closed-by-user' && err?.code !== 'auth/cancelled-popup-request') {
      console.error(err);
      showAlert('error');
    }
  }
}));

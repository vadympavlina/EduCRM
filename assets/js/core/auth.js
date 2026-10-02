// ============================================================
//  core/auth.js
//  requireStaff() — пускає на сторінку лише співробітників зі
//  списку users. Інакше — перенаправлення на login.html.
// ============================================================

import {
  auth, db, ref, get, set, remove, query, orderByChild, equalTo,
  signOut, serverTimestamp, onDisconnect,
} from './firebase.js';

const CACHE_KEY = 'educrm.staff';

/** Профіль з минулого входу — щоб одразу показати ім'я, поки йде перевірка. */
export function cachedStaff() {
  try { return JSON.parse(sessionStorage.getItem(CACHE_KEY)) || null; } catch { return null; }
}

/** Шукає співробітника за email у вузлі users. */
export async function findStaff(email) {
  if (!email) return null;
  const snap = await get(query(ref(db, 'users'), orderByChild('email'), equalTo(email.toLowerCase())));
  if (!snap.exists()) return null;
  return Object.values(snap.val())[0] || null;
}

export function loginUrl(reason) {
  const next = location.pathname.split('/').pop() + location.search;
  const params = new URLSearchParams();
  if (next && next !== 'login.html') params.set('next', next);
  if (reason) params.set('reason', reason);
  const qs = params.toString();
  return 'login.html' + (qs ? '?' + qs : '');
}

let staffPromise = null;

export function requireStaff() {
  staffPromise ||= (async () => {
    await auth.authStateReady();
    const user = auth.currentUser;
    if (!user) return redirect(loginUrl());

    let staff;
    try {
      staff = await findStaff(user.email);
    } catch (err) {
      // permission_denied означає, що правила бази не пускають цей акаунт
      if (String(err?.code || err?.message).includes('PERMISSION_DENIED')) staff = null;
      else throw err;
    }
    if (!staff) {
      await signOut(auth);
      return redirect(loginUrl('denied'));
    }

    const profile = {
      name: staff.name || user.displayName || user.email,
      email: user.email,
      photoURL: user.photoURL || '',
    };
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(profile)); } catch {}
    startPresence(profile.name);
    return profile;
  })();
  return staffPromise;
}

function redirect(url) {
  location.replace(url);
  return new Promise(() => {}); // сторінка вже йде — далі нічого не виконуємо
}

// ── Присутність (хто зараз онлайн) ───────────────────────────
// Формат сумісний з календарем: presence/{імʼя} = { name, active, updatedAt }
const presenceKey = name => name.replace(/[.#$[\]/]/g, '_');

function startPresence(name) {
  const r = ref(db, 'presence/' + presenceKey(name));
  const write = active => set(r, { name, active, updatedAt: serverTimestamp() }).catch(() => {});
  onDisconnect(r).remove().catch(() => {});
  write(document.hasFocus());
  addEventListener('focus', () => write(true));
  addEventListener('blur', () => write(false));
}

export async function logout() {
  const profile = cachedStaff();
  if (profile?.name) await remove(ref(db, 'presence/' + presenceKey(profile.name))).catch(() => {});
  try { sessionStorage.removeItem(CACHE_KEY); } catch {}
  await signOut(auth);
  location.replace('login.html');
}

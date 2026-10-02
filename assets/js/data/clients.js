// ============================================================
//  data/clients.js — клієнти і пошук за номером у будь-якому форматі
//
//  phoneKey — останні 9 цифр номера: 0671112233, +380 67 111 22 33
//  і 380671112233 дають однаковий ключ 671112233. Ключ пишеться в
//  кожне заняття (events/*/phoneKey) і клієнта (clients/*/phoneKey).
// ============================================================

import { db, ref, get, set, update, remove, push, query, orderByChild, equalTo } from '../core/firebase.js';

export const phoneKey = p => {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-9) : null;
};

/** Ключ картки клієнта для номера: наявна картка (у будь-якому форматі) або цифри номера. */
export async function resolveClientKey(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 9) return null;
  if ((await get(ref(db, 'clients/' + digits))).exists()) return digits;
  const snap = await get(query(ref(db, 'clients'), orderByChild('phoneKey'), equalTo(phoneKey(digits)))).catch(() => null);
  if (snap?.exists()) return Object.keys(snap.val())[0];
  return digits;
}

/** Заняття клієнта (за phoneKey). */
export const clientEventsQuery = phone => query(ref(db, 'events'), orderByChild('phoneKey'), equalTo(phoneKey(phone)));

const MIGRATION = 'settings/migrations/phoneKey';

/**
 * Одноразово дописує phoneKey усім старим заняттям і клієнтам.
 * Безпечно запускати повторно: після першого разу лише читає прапорець.
 * Повертає вже завантажені events/clients, якщо довелося їх читати.
 */
export async function ensurePhoneKeys() {
  if ((await get(ref(db, MIGRATION)).catch(() => null))?.val()) return null;
  const [ev, cl] = await Promise.all([get(ref(db, 'events')), get(ref(db, 'clients'))]);
  const updates = {};
  ev.forEach(c => { const v = c.val(); const k = phoneKey(v?.phone); if (k && v.phoneKey !== k) updates[`events/${c.key}/phoneKey`] = k; });
  cl.forEach(c => { const v = c.val(); const k = phoneKey(v?.phone || c.key); if (k && v?.phoneKey !== k) updates[`clients/${c.key}/phoneKey`] = k; });
  const paths = Object.keys(updates);
  for (let i = 0; i < paths.length; i += 400) {
    await update(ref(db), Object.fromEntries(paths.slice(i, i + 400).map(p => [p, updates[p]])));
  }
  await set(ref(db, MIGRATION), { at: Date.now(), events: ev.size, clients: cl.size });
  return { events: ev, clients: cl };
}

// ── Картка ───────────────────────────────────────────────────
export const setClientName = (key, name) => update(ref(db, 'clients/' + key), { name });
export const setClientTags = (key, tags) => update(ref(db, 'clients/' + key), { tags });

export function addComment(key, text, staff) {
  return set(push(ref(db, 'clientTimeline/' + key)), { type: 'comment', text, author: staff.name, createdAt: Date.now() });
}
export const deleteComment = (key, id) => remove(ref(db, `clientTimeline/${key}/${id}`));
export const deleteContract = (key, id) => remove(ref(db, `clients/${key}/contracts/${id}`));

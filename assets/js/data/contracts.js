// ============================================================
//  data/contracts.js — договори клієнтів
//  clients/{телефон}/contracts/{id} =
//    { title, teacherId, clientName, alreadyHad, signedAt, signedBy, eventId, eventTitle }
//  teacherId + signedAt визначають бонус вчителя в статистиці.
// ============================================================

import { db, ref, get, set, push } from '../core/firebase.js';
import { resolveClientKey } from './clients.js';

export async function contractsForPhone(phone) {
  const key = await resolveClientKey(phone);
  if (!key) return [];
  const snap = await get(ref(db, `clients/${key}/contracts`));
  const out = [];
  snap.forEach(c => { out.push({ id: c.key, ...c.val() }); });
  return out;
}

export async function createContract(phone, { title, teacherId, clientName, alreadyHad, eventId, eventTitle, clientKey }, staff) {
  const key = clientKey || await resolveClientKey(phone);
  if (!key) throw new Error('Невірний номер телефону');
  if (!teacherId) throw new Error('Не вказано вчителя');
  const r = push(ref(db, `clients/${key}/contracts`));
  const data = {
    title: title || 'Договір',
    teacherId,
    clientName: clientName || null,
    alreadyHad: !!alreadyHad,
    signedAt: Date.now(),
    signedBy: staff?.name || 'Менеджер',
    eventId: eventId || null,
    eventTitle: eventTitle || null,
  };
  await set(r, data);
  return { id: r.key, ...data };
}

// ============================================================
//  data/events.js — індивідуальні події (заняття)
//  Уся зміна статусів в одному місці: база + Telegram +
//  гілка lookup (для розширення в робочій CRM) + картка клієнта.
// ============================================================

import { db, ref, get, set, update, push, remove } from '../core/firebase.js';
import { phoneDigits } from '../core/format.js';
import { safeUrl } from '../core/dom.js';
import * as tg from './telegram.js';
import { phoneKey, resolveClientKey, clientEventsQuery } from './clients.js';

export const STATUS = {
  pending:   { label: 'Очікує',       badge: 'warning', icon: 'clock' },
  confirmed: { label: 'Підтверджено', badge: 'info',    icon: 'check' },
  completed: { label: 'Проведено',    badge: 'success', icon: 'check-circle' },
  cancelled: { label: 'Скасовано',    badge: 'danger',  icon: 'x' },
};

export const toMin = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const overlaps = (aS, aE, bS, bE) => aS < bE && aE > bS;

/** Чи потрапляє час у блокування. Повертає { title, global } або null. */
export function findBlock({ date, startTime, endTime, teacherId }, blockedTimes, busySlots, { globalOnly = false } = {}) {
  if (!date || !startTime || !endTime) return null;
  const s = toMin(startTime), e = toMin(endTime);
  const weekday = new Date(date + 'T12:00:00').getDay();
  const applies = b => b.teacherId ? (!globalOnly && b.teacherId === teacherId) : true;

  for (const b of Object.values(blockedTimes || {})) {
    if (!applies(b) || !(b.days || []).includes(weekday)) continue;
    if (b.until && date > b.until) continue;
    if (b.from && date < b.from) continue;
    if (overlaps(s, e, toMin(b.start), toMin(b.end))) return { title: b.title || 'Зайнято', global: !b.teacherId };
  }
  for (const b of Object.values(busySlots || {})) {
    if (!applies(b) || b.date !== date) continue;
    if (overlaps(s, e, toMin(b.startTime), toMin(b.endTime))) return { title: b.title || 'Зайнято', global: !b.teacherId };
  }
  return null;
}

/** Інша подія цього ж вчителя, що перетинається за часом. */
export function findTeacherOverlap(events, { id, date, startTime, endTime, teacherId }) {
  if (!teacherId || !date || !startTime || !endTime) return null;
  const s = toMin(startTime), e = toMin(endTime);
  return Object.values(events).find(ev =>
    ev.id !== id && !ev.isGroupMirror && ev.status !== 'cancelled'
    && ev.assignedPersonId === teacherId && ev.date === date && ev.startTime && ev.endTime
    && overlaps(s, e, toMin(ev.startTime), toMin(ev.endTime))) || null;
}

// ── Клієнт і lookup ──────────────────────────────────────────
export async function upsertClient(rawPhone, name, crmLink) {
  // наявна картка з цим номером у будь-якому форматі, інакше — нова
  const key = await resolveClientKey(rawPhone);
  if (!key) return;
  const r = ref(db, 'clients/' + key);
  const snap = await get(r);
  const link = crmLink ? safeUrl(crmLink) || null : null;
  if (!snap.exists()) {
    await set(r, { phone: rawPhone, phoneKey: phoneKey(rawPhone), name: name || '', createdAt: Date.now(), lastEventAt: Date.now(), crmLink: link });
  } else {
    const patch = { lastEventAt: Date.now(), phoneKey: phoneKey(rawPhone) };
    if (link && !snap.val().crmLink) patch.crmLink = link;
    await update(r, patch);
  }
}

// lookup/{phoneKey} — мінімум даних про найближче майбутнє заняття клієнта
// (індивідуальне або групове). Публічно читає розширення в робочій CRM.
// Ключ — останні 9 цифр номера, тож +380 67…, 067… і 38067… збігаються.
// Поки не всі оновили розширення, той самий запис дублюється під повними
// цифрами номера (старий формат).

const endTs = ev => new Date(`${ev.date}T${ev.endTime || ev.startTime}`).getTime();
const isUpcoming = (ev, now) => ev && !ev._deleted && ev.date && ev.startTime
  && ev.status !== 'cancelled' && ev.status !== 'completed' && endTs(ev) > now;

/** Запис lookup для списку занять одного клієнта (або null, якщо майбутніх немає). */
function lookupPayload(list, now = Date.now()) {
  const upcoming = list.filter(ev => isUpcoming(ev, now))
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  if (!upcoming.length) return null;
  const ev = upcoming[0];
  return {
    hasUpcoming: true, count: upcoming.length,
    eventId: ev.isGroupMirror ? (ev.groupEventId || ev.id) : ev.id, isGroup: !!ev.isGroupMirror,
    date: ev.date, startTime: ev.startTime, endTime: ev.endTime || '', status: ev.status || 'pending',
    ts: new Date(`${ev.date}T${ev.startTime}`).getTime(), updatedAt: Date.now(),
  };
}

/** Перерахувати lookup для одного номера (читає всі заняття цього клієнта з бази). */
export async function refreshLookup(rawPhone, events = {}, fresh = null) {
  const key = phoneKey(rawPhone);
  if (!key) return;
  const pool = {};
  const snap = await get(clientEventsQuery(rawPhone)).catch(() => null);
  snap?.forEach(c => { pool[c.key] = { id: c.key, ...c.val() }; });
  for (const ev of Object.values(events || {})) if (ev?.id && phoneKey(ev.phone) === key) pool[ev.id] = ev;
  if (fresh?.id) pool[fresh.id] = fresh;
  const list = Object.values(pool).filter(ev => phoneKey(ev.phone) === key);
  const payload = lookupPayload(list);
  const updates = { ['lookup/' + key]: payload };
  const legacy = phoneDigits(rawPhone);
  if (legacy && legacy !== key) updates['lookup/' + legacy] = payload;
  await update(ref(db), updates);
}

/**
 * Раз на день (перший, хто відкрив календар) перебудовує всю гілку lookup:
 * прибирає минулі заняття і дописує записи в новому форматі.
 * events — заняття з календаря (від минулого місяця), окремо не читаємо.
 */
export async function syncAllLookups(events) {
  const today = new Date().toLocaleDateString('sv-SE');
  const flag = await get(ref(db, 'settings/lookupSyncedOn')).catch(() => null);
  if (flag?.val() === today) return;
  const byKey = {}, legacyOf = {};
  for (const ev of Object.values(events || {})) {
    const k = phoneKey(ev.phone);
    if (!k) continue;
    (byKey[k] ||= []).push(ev);
    const d = phoneDigits(ev.phone);
    if (d && d !== k) (legacyOf[k] ||= new Set()).add(d);
  }
  const updates = {};
  const existing = (await get(ref(db, 'lookup')).catch(() => null))?.val() || {};
  Object.keys(existing).forEach(k => { updates['lookup/' + k] = null; });
  for (const [k, list] of Object.entries(byKey)) {
    const payload = lookupPayload(list);
    if (!payload) continue;
    updates['lookup/' + k] = payload;
    legacyOf[k]?.forEach(d => { updates['lookup/' + d] = payload; });
  }
  updates['settings/lookupSyncedOn'] = today;
  await update(ref(db), updates);
}

// ── Збереження і статуси ─────────────────────────────────────
// ctx: { staff, events, teacherName(id) }
const tgCtx = (ctx, ev) => ({ teacherName: ctx.teacherName(ev.assignedPersonId), manager: ctx.staff.name });

export async function createEvent(data, ctx, { crmLink } = {}) {
  const r = push(ref(db, 'events'));
  const ev = {
    ...data,
    phoneKey: phoneKey(data.phone),
    status: 'pending',
    createdBy: ctx.staff.name,
    createdAt: new Date().toISOString(),
    ...(crmLink && safeUrl(crmLink) ? { importSource: safeUrl(crmLink) } : {}),
  };
  await set(r, ev);
  const full = { id: r.key, ...ev };
  tg.postEvent(full, 'pending', tgCtx(ctx, full));
  await upsertClient(data.phone, data.title, crmLink).catch(err => console.warn('client upsert', err));
  refreshLookup(data.phone, ctx.events, full).catch(() => {});
  return full;
}

export async function updateEvent(prev, data, ctx, { crmLink } = {}) {
  data = { ...data, phoneKey: phoneKey(data.phone) };
  await update(ref(db, 'events/' + prev.id), data);
  const full = { ...prev, ...data };
  tg.editEvent(full, full.status, tgCtx(ctx, full));
  await upsertClient(data.phone, data.title, crmLink).catch(err => console.warn('client upsert', err));
  if (phoneDigits(prev.phone) !== phoneDigits(data.phone)) refreshLookup(prev.phone, ctx.events, { ...full, phone: prev.phone, _deleted: true }).catch(() => {});
  refreshLookup(data.phone, ctx.events, full).catch(() => {});
  return full;
}

export async function setEventStatus(ev, status, ctx) {
  const patch = { status };
  if (status === 'confirmed') patch.confirmedBy = ctx.staff.name;
  if (status === 'cancelled') patch.cancelledBy = ctx.staff.name;
  if (status === 'completed') Object.assign(patch, { completedBy: ctx.staff.name, completedAt: new Date().toISOString(), contractSigned: false });
  await update(ref(db, 'events/' + ev.id), patch);
  const full = { ...ev, ...patch };
  // Підтвердження і скасування — нове повідомлення (зі сповіщенням);
  // «Проведено» — тихо оновлює наявне (кнопка відгуку лишається)
  if (status === 'confirmed' || status === 'cancelled') tg.postEvent(full, status, tgCtx(ctx, full));
  else tg.editEvent(full, status, tgCtx(ctx, full));
  refreshLookup(ev.phone, ctx.events, full).catch(() => {});
  return full;
}

export async function moveEvent(ev, times, ctx) {
  await update(ref(db, 'events/' + ev.id), times);
  const full = { ...ev, ...times };
  tg.editEvent(full, full.status, tgCtx(ctx, full));
  refreshLookup(ev.phone, ctx.events, full).catch(() => {});
  return full;
}

export async function deleteEvent(ev, ctx) {
  tg.deleteMessage(ev.telegramMessageId);
  await remove(ref(db, 'events/' + ev.id));
  refreshLookup(ev.phone, ctx.events, { ...ev, _deleted: true }).catch(() => {});
}

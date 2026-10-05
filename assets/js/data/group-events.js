// ============================================================
//  data/group-events.js — групові події
//  groupEvents/{id} = { title, date, startTime, endTime, assignedPersonId,
//                       description, participants, status, … }
//  Кожен учасник дзеркалиться в events/ge_{id}_{pid} (isGroupMirror),
//  щоб картка клієнта бачила цю подію.
// ============================================================

import { db, ref, get, update, push } from '../core/firebase.js';
import { phoneDigits } from '../core/format.js';
import * as tg from './telegram.js';
import { phoneKey, resolveClientKey } from './clients.js';
import { refreshLookup } from './events.js';

/** Оновити lookup (розширення в робочій CRM) для всіх учасників. */
function refreshParticipantLookups(...lists) {
  const phones = new Set(lists.flatMap(l => Object.values(l || {}).map(p => p?.phone).filter(Boolean)));
  phones.forEach(phone => refreshLookup(phone).catch(() => {}));
}

export const GROUP_STATUS = {
  pending:   { label: 'Очікується', badge: 'warning' },
  completed: { label: 'Проведено',  badge: 'success' },
  cancelled: { label: 'Скасовано',  badge: 'danger' },
};

export const CONFIRM = {
  coming:     { label: 'Прийде',     icon: 'check' },
  pending:    { label: 'Очікується', icon: 'clock' },
  not_coming: { label: 'Не прийде',  icon: 'x' },
};

export const mirrorId = (gid, pid) => `ge_${gid}_${pid}`;
export const contractTag = (gid, pid) => `group_${gid}_${pid}`;
export const newParticipantId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const countComing = ge => Object.values(ge.participants || {}).filter(p => p.attending !== false).length;

function mirrorStatus(geStatus, confirm) {
  if (geStatus === 'completed') return 'completed';
  if (geStatus === 'cancelled') return 'cancelled';
  if (confirm === 'coming') return 'confirmed';
  if (confirm === 'not_coming') return 'cancelled';
  return 'pending';
}

/** Учасники без тимчасових полів (hasContract рахується на льоту). */
function cleanParticipants(participants) {
  return Object.fromEntries(Object.entries(participants || {}).map(([pid, p]) => {
    const { hasContract, ...rest } = p;
    return [pid, rest];
  }));
}

function mirrorUpdates(gid, ge, staff, removedPids = []) {
  const updates = {};
  removedPids.forEach(pid => { updates['events/' + mirrorId(gid, pid)] = null; });
  Object.entries(ge.participants || {}).forEach(([pid, p]) => {
    if (!phoneDigits(p.phone)) return;
    const mirror = {
      title: ge.title, date: ge.date, startTime: ge.startTime, endTime: ge.endTime,
      assignedPersonId: ge.assignedPersonId,
      phone: p.phone, phoneKey: phoneKey(p.phone), clientName: p.name,
      status: mirrorStatus(ge.status, p.confirmStatus),
      isGroupMirror: true, groupEventId: gid, participantId: pid,
      createdBy: ge.createdBy || staff.name,
      updatedAt: Date.now(),
    };
    if (ge.status === 'completed') { mirror.completedAt = new Date().toISOString(); mirror.completedBy = staff.name; }
    updates['events/' + mirrorId(gid, pid)] = mirror;
  });
  return updates;
}

/** Порожню картку клієнта заповнюємо іменем учасника (не перезаписуємо наявне). */
function fillClientCards(participants) {
  Object.values(participants || {}).forEach(async p => {
    const key = await resolveClientKey(p.phone).catch(() => null);
    if (!key) return;
    try {
      const snap = await get(ref(db, 'clients/' + key));
      if (!snap.val()?.name) await update(ref(db, 'clients/' + key), { name: p.name, age: p.age || null, phone: snap.val()?.phone || p.phone, phoneKey: phoneKey(p.phone) });
    } catch {}
  });
}

// ctx: { staff, teacherName(id) }
export async function saveGroup(prev, form, ctx) {
  const id = prev?.id || push(ref(db, 'groupEvents')).key;
  const participants = cleanParticipants(form.participants);
  const ge = {
    title: form.title, date: form.date, startTime: form.startTime, endTime: form.endTime,
    assignedPersonId: form.assignedPersonId, description: form.description || '',
    participants,
    status: prev?.status || 'pending',
    updatedAt: Date.now(), updatedBy: ctx.staff.name,
  };
  if (!prev) { ge.createdAt = Date.now(); ge.createdBy = ctx.staff.name; }

  const removed = Object.keys(prev?.participants || {}).filter(pid => !participants[pid]);
  const full = { ...prev, ...ge, id };
  // Подія і дзеркала учасників — одним атомарним записом
  const updates = { ...mirrorUpdates(id, full, ctx.staff, removed) };
  Object.entries(ge).forEach(([k, v]) => { updates[`groupEvents/${id}/${k}`] = v; });
  await update(ref(db), updates);
  fillClientCards(participants);
  refreshParticipantLookups(participants, Object.fromEntries(removed.map(pid => [pid, prev.participants[pid]])));

  const forTg = { ...full, participants: form.participants };
  if (prev) tg.editGroup(forTg, ctx.teacherName(full.assignedPersonId));
  else tg.postGroup(forTg, ctx.teacherName(full.assignedPersonId));
  return full;
}

export async function setGroupStatus(ge, status, ctx) {
  const full = { ...ge, status, updatedAt: Date.now(), updatedBy: ctx.staff.name };
  await update(ref(db), {
    [`groupEvents/${ge.id}/status`]: status,
    [`groupEvents/${ge.id}/updatedAt`]: full.updatedAt,
    [`groupEvents/${ge.id}/updatedBy`]: full.updatedBy,
    ...mirrorUpdates(ge.id, full, ctx.staff),
  });
  refreshParticipantLookups(ge.participants);
  tg.postGroup(full, ctx.teacherName(ge.assignedPersonId));
  return full;
}

export async function moveGroup(ge, times, ctx) {
  const full = { ...ge, ...times };
  const updates = mirrorUpdates(ge.id, full, ctx.staff);
  Object.entries(times).forEach(([k, v]) => { updates[`groupEvents/${ge.id}/${k}`] = v; });
  await update(ref(db), updates);
  refreshParticipantLookups(ge.participants);
  tg.editGroup(full, ctx.teacherName(ge.assignedPersonId));
  return full;
}

export async function deleteGroup(ge) {
  tg.deleteMessage(ge.telegramMessageId);
  const updates = { [`groupEvents/${ge.id}`]: null };
  Object.keys(ge.participants || {}).forEach(pid => { updates['events/' + mirrorId(ge.id, pid)] = null; });
  await update(ref(db), updates);
  refreshParticipantLookups(ge.participants);
}


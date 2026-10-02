// ============================================================
//  data/payroll.js — ЄДИНИЙ розрахунок виплат вчителям
//  Використовують: «Завершені», «Статистика» і щомісячний лист
//  (scripts/monthly-report). Без залежностей від браузера.
//
//  Правила:
//   • проведене індивідуальне заняття (не дзеркало групи) → ставка за заняття
//   • проведена групова подія → одна ставка за заняття, скільки б не було учасників
//   • новий договір (не «вже мав», є вчитель), підписаний у цьому місяці → бонус
//   • старі події з contractSigned:true без запису в договорах → бонус (сумісність)
// ============================================================

import { normalizePricing, ratesFor } from './teachers.js';

const pad = n => String(n).padStart(2, '0');
/** Місяць позначки часу за локальним часом ("2026-10"). */
export const localMonth = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };

/** clients/{телефон}/contracts → плоский масив договорів. */
export function contractsFromClients(clients = {}) {
  const out = [];
  Object.entries(clients || {}).forEach(([phone, c]) => {
    Object.entries(c?.contracts || {}).forEach(([id, ct]) => out.push({ id, phone, clientCardName: c.name || '', ...ct }));
  });
  return out;
}

const withIds = obj => Object.entries(obj || {}).map(([id, v]) => ({ ...v, id: v?.id || id }));

export function computePayroll({
  events = {}, groupEvents = {}, people = {}, pricing, contracts = [],
  month = '', teacherId = '', monthOf = localMonth,
}) {
  const P = normalizePricing(pricing);
  const inMonth = d => !month || (d && String(d).startsWith(month));
  const forTeacher = id => !teacherId || id === teacherId;

  const evList = withIds(events);
  const completed = evList.filter(e => e.status === 'completed' && !e.isGroupMirror && inMonth(e.date) && forTeacher(e.assignedPersonId));
  const completedGroups = withIds(groupEvents).filter(g => g.status === 'completed' && inMonth(g.date) && forTeacher(g.assignedPersonId));
  const contractsInMonth = contracts.filter(c =>
    !c.alreadyHad && c.teacherId && forTeacher(c.teacherId) && (!month || (c.signedAt && monthOf(c.signedAt) === month)));

  const byTeacher = {};
  const bucket = tid => (byTeacher[tid] ||= { count: 0, contracts: 0, earnings: 0 });

  completed.forEach(e => { const b = bucket(e.assignedPersonId || '__none__'); b.count++; b.earnings += ratesFor(P, e.assignedPersonId).baseReward; });
  completedGroups.forEach(g => { const b = bucket(g.assignedPersonId || '__none__'); b.count++; b.earnings += ratesFor(P, g.assignedPersonId).baseReward; });
  contractsInMonth.forEach(c => { const b = bucket(c.teacherId); b.contracts++; b.earnings += ratesFor(P, c.teacherId).contractBonus; });

  // Сумісність зі старими подіями (contractSigned:true до появи окремих договорів)
  const contractedEventIds = new Set(contracts.filter(c => c.eventId).map(c => c.eventId));
  const legacy = completed.filter(e => e.contractSigned && !contractedEventIds.has(e.id));
  legacy.forEach(e => { const b = bucket(e.assignedPersonId || '__none__'); b.contracts++; b.earnings += ratesFor(P, e.assignedPersonId).contractBonus; });

  const rows = Object.entries(byTeacher).map(([tid, d]) => {
    const r = ratesFor(P, tid === '__none__' ? '' : tid);
    return {
      teacherId: tid === '__none__' ? '' : tid,
      name: tid === '__none__' ? 'Не призначено' : (people[tid]?.name || 'Невідомо'),
      baseReward: r.baseReward, contractBonus: r.contractBonus, ...d,
    };
  }).sort((a, b) => b.earnings - a.earnings);

  const totals = rows.reduce((s, r) => ({
    events: s.events + r.count, contracts: s.contracts + r.contracts, earnings: s.earnings + r.earnings,
  }), { events: 0, contracts: 0, earnings: 0 });

  // Воронка: усі записи за період (як і раніше на сторінці статистики)
  const period = evList.filter(e => inMonth(e.date) && forTeacher(e.assignedPersonId));
  const funnel = {
    total: period.length,
    created: period.filter(e => e.status !== 'cancelled').length,
    confirmed: period.filter(e => e.status === 'confirmed' || e.status === 'completed').length,
    completed: period.filter(e => e.status === 'completed').length,
    cancelled: period.filter(e => e.status === 'cancelled').length,
    contract: contractsInMonth.length,
  };

  return { rows, totals, funnel, completed, completedGroups, contractsInMonth, legacy, pricing: P };
}

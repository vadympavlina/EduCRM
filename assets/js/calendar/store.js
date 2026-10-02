// ============================================================
//  calendar/store.js — спільний стан сторінки календаря
// ============================================================

export const store = {
  staff: null,
  events: {},        // id -> подія (з полем id)
  groupEvents: {},   // id -> групова подія
  teachers: {},      // id -> { name, color, archived }
  blockedTimes: {},  // повторювані блокування (settings/blockedTimes)
  busySlots: {},     // разові «зайнятий час»
};

/** Контекст для data/*.js: хто діє, кеш подій, імена вчителів. */
export const ctx = () => ({
  staff: store.staff,
  events: store.events,
  teacherName: id => store.teachers[id]?.name || '',
});

export const teacherName = id => store.teachers[id]?.name || '';

/** Активні вчителі за абеткою (+ архівний, якщо його вже обрано). */
export function teacherOptions(selectedId = '') {
  return Object.entries(store.teachers)
    .map(([id, t]) => ({ id, ...t }))
    .filter(t => !t.archived || t.id === selectedId)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'uk'));
}

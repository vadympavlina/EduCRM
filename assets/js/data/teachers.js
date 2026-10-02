// ============================================================
//  data/teachers.js — спільна логіка вчителів і ставок
// ============================================================

// Палітра збігається з календарем (app.js → TEACHER_COLORS)
export const TEACHER_COLORS = ['#4f6ef7', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#dc2626', '#65a30d'];

export const DEFAULT_RATES = { baseReward: 50, contractBonus: 100 };

const isColor = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

/** Колір вчителя: збережений, інакше — як досі рахував календар (за позицією в списку). */
export function teacherColor(teachers, id) {
  const own = teachers[id]?.color;
  if (isColor(own)) return own;
  const idx = Object.keys(teachers).sort().indexOf(id);
  return TEACHER_COLORS[(idx < 0 ? 0 : idx) % TEACHER_COLORS.length];
}

export function normalizePricing(raw) {
  return {
    default: { ...DEFAULT_RATES, ...(raw?.default || {}) },
    overrides: raw?.overrides || {},
  };
}

export function ratesFor(pricing, id) {
  return (id && pricing.overrides[id]) || pricing.default;
}

export const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'uk');

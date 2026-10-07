// ============================================================
//  data/telegram.js — повідомлення в робочий Telegram-чат
//
//  ⚠ Токен бота поки що читається з бази (settings/telegramToken),
//  як і раніше. Перенести відправку на сервер — окремий крок
//  (див. аудит безпеки).
// ============================================================

import { db, ref, get, update } from '../core/firebase.js';

const CHAT_ID = '-1003992712563';

let tokenPromise = null;
function token() {
  tokenPromise ||= get(ref(db, 'settings/telegramToken'))
    .then(s => s.val() || '')
    .catch(() => '');
  return tokenPromise;
}

async function call(method, payload) {
  const t = await token();
  if (!t) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${t}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, ...payload }),
    });
    return await res.json();
  } catch (err) {
    console.warn('Telegram:', method, err);
    return null;
  }
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Абсолютне посилання на сторінку сайту (для кнопок у Telegram). */
export const siteUrl = path => new URL(path, new URL('./', location.href)).href;

export const deleteMessage = messageId => messageId ? call('deleteMessage', { message_id: messageId }) : null;

// ── Форматування ─────────────────────────────────────────────
const pad = n => String(n).padStart(2, '0');
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/** "2026-10-06" → "Вівторок, 6 жовтня" */
function fmtDay(date) {
  if (!date) return '—';
  const d = new Date(date + 'T12:00:00');
  if (isNaN(d)) return esc(date);
  // день тижня окремо — щоб завжди називний відмінок («П’ятниця», а не «П’ятницю»)
  return `${cap(d.toLocaleDateString('uk-UA', { weekday: 'long' }))}, ${d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}`;
}

const toMin = t => { const [h, m] = String(t || '').split(':').map(Number); return h * 60 + (m || 0); };
/** "15:00", "16:30" → "15:00–16:30 · 1 год 30 хв" */
function fmtTime(start, end) {
  if (!start) return '—';
  if (!end || toMin(end) <= toMin(start)) return start;
  const d = toMin(end) - toMin(start), h = Math.floor(d / 60), m = d % 60;
  return `${start}–${end} · ${[h ? `${h} год` : '', m ? `${m} хв` : ''].filter(Boolean).join(' ')}`;
}

const updatedLine = () => { const n = new Date(); return `<i>✏️ Оновлено о ${pad(n.getHours())}:${pad(n.getMinutes())}</i>`; };

// ── Кнопки «додати в календар» ───────────────────────────────
// Google Календар — шаблон події одним дотиком; «Інший календар» — сторінка з файлом .ics
function googleCalUrl({ title, date, startTime, endTime, details }) {
  const d = String(date || '').replace(/-/g, '');
  const t = x => String(x || '').replace(':', '') + '00';
  let end = endTime && toMin(endTime) > toMin(startTime) ? endTime : null;
  if (!end) { const m = toMin(startTime) + 60; end = `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`; }
  const q = new URLSearchParams({
    action: 'TEMPLATE', text: title, dates: `${d}T${t(startTime)}/${d}T${t(end)}`,
    ctz: 'Europe/Kyiv', details: details || '',
  });
  return 'https://calendar.google.com/calendar/render?' + q;
}

function calendarButtons(kind, id, item, details, teacher = '') {
  if (!id || !item.date || !item.startTime) return [];
  return [
    { text: '📅 Google Календар', url: googleCalUrl({ title: item.title || 'Заняття', date: item.date, startTime: item.startTime, endTime: item.endTime, details }) },
    { text: '🗓 Інший календар', url: siteUrl('addtocal?' + new URLSearchParams({
      [kind]: id, title: item.title || 'Заняття', date: item.date, start: item.startTime, end: item.endTime || '', teacher,
    })) },
  ];
}

// ── Індивідуальні заняття ────────────────────────────────────
const EVENT_HEAD = {
  pending:   '🟡 <b>НОВЕ ЗАНЯТТЯ</b> · очікує підтвердження',
  confirmed: '🟢 <b>ЗАНЯТТЯ ПІДТВЕРДЖЕНО</b>',
  completed: '✅ <b>ЗАНЯТТЯ ПРОВЕДЕНО</b>',
  cancelled: '🔴 <b>ЗАНЯТТЯ СКАСОВАНО</b>',
};

function eventPayload(ev, status, { teacherName, manager }, { edited = false } = {}) {
  const cancelled = status === 'cancelled';
  const strike = s => cancelled ? `<s>${s}</s>` : s;
  const lines = [
    EVENT_HEAD[status] || EVENT_HEAD.pending,
    '',
    `👤 <b>${esc(ev.title || 'Клієнт')}</b>`,
    `📅 ${strike(esc(fmtDay(ev.date)))}`,
    `🕐 ${strike(esc(fmtTime(ev.startTime, ev.endTime)))}`,
    `👩‍🏫 ${esc(teacherName || 'Вчителя не призначено')}`,
  ];
  if (ev.description) lines.push('', `<blockquote>${esc(ev.description)}</blockquote>`);
  lines.push('', `<i>Менеджер: ${esc(manager || '—')}</i>`);
  if (edited) lines.push(updatedLine());

  const payload = { text: lines.join('\n'), parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
  if (ev.id && !cancelled && status !== 'completed') {
    const details = [`Вчитель: ${teacherName || '—'}`, `Менеджер: ${manager || '—'}`, ev.description || ''].filter(Boolean).join('\n');
    const rows = [calendarButtons('eventId', ev.id, ev, details, teacherName)];
    if (status === 'confirmed') rows.push([{ text: '💬 Посилання на відгук', url: siteUrl(`review?eventId=${encodeURIComponent(ev.id)}`) }]);
    payload.reply_markup = { inline_keyboard: rows.filter(r => r.length) };
  } else if (ev.id && status === 'completed') {
    payload.reply_markup = { inline_keyboard: [[{ text: '💬 Посилання на відгук', url: siteUrl(`review?eventId=${encodeURIComponent(ev.id)}`) }]] };
  } else {
    payload.reply_markup = { inline_keyboard: [] };
  }
  return payload;
}

/** Нове повідомлення (старе видаляється, щоб нове «спливло» в чаті). */
export async function postEvent(ev, status, ctx) {
  if (ev.telegramMessageId) await deleteMessage(ev.telegramMessageId);
  const data = await call('sendMessage', eventPayload(ev, status, ctx));
  const messageId = data?.ok && data.result?.message_id;
  if (messageId && ev.id) await update(ref(db, 'events/' + ev.id), { telegramMessageId: messageId }).catch(() => {});
}

/** Оновлює текст і кнопки наявного повідомлення без нового сповіщення в чаті. */
export async function editEvent(ev, status, ctx) {
  if (!ev.telegramMessageId) return;
  await call('editMessageText', { message_id: ev.telegramMessageId, ...eventPayload(ev, status, ctx, { edited: true }) });
}

// ── Групові заняття ──────────────────────────────────────────
const GROUP_HEAD = {
  pending:   '👥 <b>ГРУПОВЕ ЗАНЯТТЯ</b> · 🟡 очікується',
  completed: '👥 <b>ГРУПОВЕ ЗАНЯТТЯ</b> · ✅ проведено',
  cancelled: '👥 <b>ГРУПОВЕ ЗАНЯТТЯ</b> · 🔴 скасовано',
};

function groupPayload(ge, teacherName, { edited = false } = {}) {
  const people = Object.values(ge.participants || {});
  const coming = people.filter(p => p.confirmStatus === 'coming').length;
  const notComing = people.filter(p => p.confirmStatus === 'not_coming').length;
  const waiting = people.length - coming - notComing;
  const cancelled = ge.status === 'cancelled';
  const strike = s => cancelled ? `<s>${s}</s>` : s;

  const list = people.length
    ? people.map((p, i) => {
        const mark = p.confirmStatus === 'coming' ? '✅' : p.confirmStatus === 'not_coming' ? '❌' : '🕐';
        return `${mark} ${i + 1}. ${esc(p.name)}${p.age ? ` · ${esc(p.age)} р.` : ''}${p.hasContract ? ' · 📄 договір' : ''}`;
      }).join('\n')
    : '<i>Учасників ще немає</i>';

  const summary = people.length
    ? [coming ? `✅ ${coming}` : '', waiting ? `🕐 ${waiting}` : '', notComing ? `❌ ${notComing}` : ''].filter(Boolean).join('   ')
    : '';

  const lines = [
    GROUP_HEAD[ge.status] || GROUP_HEAD.pending,
    '',
    `📌 <b>${esc(ge.title || 'Групове заняття')}</b>`,
    `📅 ${strike(esc(fmtDay(ge.date)))}`,
    `🕐 ${strike(esc(fmtTime(ge.startTime, ge.endTime)))}`,
    `👩‍🏫 ${esc(teacherName || 'Вчителя не призначено')}`,
    '',
    `<b>Учасники (${people.length})</b>${summary ? ` · ${summary}` : ''}`,
    list,
  ];
  if (ge.description) lines.push('', `<blockquote>${esc(ge.description)}</blockquote>`);
  if (edited) lines.push('', updatedLine());

  const payload = { text: lines.join('\n'), parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
  const details = [`Групове заняття · вчитель: ${teacherName || '—'}`, `Учасників: ${people.length}`, ge.description || ''].filter(Boolean).join('\n');
  const row = !cancelled && ge.status !== 'completed' ? calendarButtons('groupId', ge.id, { ...ge, title: ge.title || 'Групове заняття' }, details, teacherName) : [];
  payload.reply_markup = { inline_keyboard: row.length ? [row] : [] };
  return payload;
}

export async function postGroup(ge, teacherName) {
  if (ge.telegramMessageId) await deleteMessage(ge.telegramMessageId);
  const data = await call('sendMessage', groupPayload(ge, teacherName));
  const messageId = data?.ok && data.result?.message_id;
  if (messageId && ge.id) await update(ref(db, 'groupEvents/' + ge.id), { telegramMessageId: messageId }).catch(() => {});
}

export async function editGroup(ge, teacherName) {
  if (!ge.telegramMessageId) return;
  await call('editMessageText', { message_id: ge.telegramMessageId, ...groupPayload(ge, teacherName, { edited: true }) });
}

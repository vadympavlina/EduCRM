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

// ── Індивідуальні події ──────────────────────────────────────
const EVENT_LABEL = { pending: 'СТВОРЕНО', confirmed: 'ПІДТВЕРДЖЕНО', cancelled: 'СКАСОВАНО', completed: 'ЗАВЕРШЕНО' };

function eventPayload(ev, status, { teacherName, manager }) {
  const desc = ev.description ? `\n\n<blockquote>${esc(ev.description)}</blockquote>` : '';
  const text = `<b>[${EVENT_LABEL[status] || EVENT_LABEL.pending}]</b>\n\n`
    + `<b>Подія:</b> ${esc(ev.title)}\n`
    + `<b>Час:</b> ${esc(ev.date)} (${esc(ev.startTime)} - ${esc(ev.endTime)})\n`
    + `<b>Вчитель:</b> ${esc(teacherName || 'Не призначено')}${desc}\n\n`
    + `<i>Менеджер: ${esc(manager)}</i>`;
  const payload = { text, parse_mode: 'HTML' };
  if (status === 'confirmed' && ev.id) {
    payload.reply_markup = { inline_keyboard: [[
      { text: 'Відгук', url: siteUrl(`review?eventId=${encodeURIComponent(ev.id)}`) },
      { text: '📅', url: siteUrl(`addtocal?eventId=${encodeURIComponent(ev.id)}`) },
    ]] };
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

/** Оновлює текст наявного повідомлення без нового сповіщення в чаті. */
export async function editEvent(ev, status, ctx) {
  if (!ev.telegramMessageId) return;
  await call('editMessageText', { message_id: ev.telegramMessageId, ...eventPayload(ev, status, ctx) });
}

// ── Групові події ────────────────────────────────────────────
const GROUP_LABEL = { pending: '🟡 Очікується', completed: '✅ Проведено', cancelled: '❌ Скасовано' };

function groupText(ge, teacherName) {
  const people = Object.values(ge.participants || {});
  const coming = people.filter(p => p.confirmStatus === 'coming' || (p.confirmStatus === undefined && p.attending !== false));
  const list = people.length
    ? people.map((p, i) => {
        const mark = p.confirmStatus === 'coming' ? '✅' : p.confirmStatus === 'not_coming' ? '❌' : '🕐';
        return `${mark} ${i + 1}. ${esc(p.name)}${p.age ? `, ${esc(p.age)}р.` : ''}${p.hasContract ? ' 📄✅' : ''}`;
      }).join('\n')
    : '<i>Учасників ще немає</i>';
  return [
    '👥 <b>ГРУПОВА ПОДІЯ</b>',
    GROUP_LABEL[ge.status] || GROUP_LABEL.pending,
    '',
    `📌 <b>${esc(ge.title)}</b>`,
    `📅 ${esc((ge.date || '').split('-').reverse().join('.'))}   🕐 ${esc(ge.startTime)}–${esc(ge.endTime)}`,
    `👨‍🏫 ${esc(teacherName) || '—'}`,
    '',
    `<b>Учасники (${coming.length}/${people.length}):</b>`,
    list,
    ge.description ? `\n💬 ${esc(ge.description)}` : '',
  ].filter(Boolean).join('\n');
}

export async function postGroup(ge, teacherName) {
  if (ge.telegramMessageId) await deleteMessage(ge.telegramMessageId);
  const data = await call('sendMessage', { text: groupText(ge, teacherName), parse_mode: 'HTML' });
  const messageId = data?.ok && data.result?.message_id;
  if (messageId && ge.id) await update(ref(db, 'groupEvents/' + ge.id), { telegramMessageId: messageId }).catch(() => {});
}

export async function editGroup(ge, teacherName) {
  if (!ge.telegramMessageId) return;
  await call('editMessageText', { message_id: ge.telegramMessageId, text: groupText(ge, teacherName), parse_mode: 'HTML' });
}

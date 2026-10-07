// ============================================================
//  Додати в календар — публічна сторінка з кнопки в Telegram.
//  addtocal?eventId=<id>  — індивідуальне заняття
//  addtocal?groupId=<id>  — групове заняття
//  Google Календар — одним дотиком; Apple / Outlook / інші — файл .ics.
// ============================================================

import { db, ref, get } from '../core/firebase.js';
import { html, render } from '../core/dom.js';
import { icon } from '../ui/icons.js';

const box = document.getElementById('box');
const params = new URLSearchParams(location.search);
const eventId = params.get('eventId'), groupId = params.get('groupId');

const pad = n => String(n).padStart(2, '0');
const toMin = t => { const [h, m] = String(t || '').split(':').map(Number); return h * 60 + (m || 0); };
const endOf = it => it.endTime && toMin(it.endTime) > toMin(it.startTime) ? it.endTime
  : (m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`)(toMin(it.startTime) + 60);

function fail(text) {
  render(box, html`
    <div class="cal-add-ico err">${icon('alert-circle', 26)}</div>
    <h1>Не вдалося знайти заняття</h1>
    <p>${text}</p>`);
}

function googleUrl(it) {
  const d = it.date.replace(/-/g, ''), t = x => x.replace(':', '') + '00';
  return 'https://calendar.google.com/calendar/render?' + new URLSearchParams({
    action: 'TEMPLATE', text: it.title, dates: `${d}T${t(it.startTime)}/${d}T${t(endOf(it))}`,
    ctz: 'Europe/Kyiv', details: it.details,
  });
}

function icsFile(it, uid) {
  const icsEsc = s => String(s || '').replace(/[\\,;]/g, '\\$&').replace(/\r?\n/g, '\\n');
  const dt = (date, time) => `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const body = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//EduCRM//UK', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE', 'TZID:Europe/Kyiv',
    'BEGIN:STANDARD', 'DTSTART:19701025T040000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'TZOFFSETFROM:+0300', 'TZOFFSETTO:+0200', 'END:STANDARD',
    'BEGIN:DAYLIGHT', 'DTSTART:19700329T030000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0300', 'END:DAYLIGHT',
    'END:VTIMEZONE',
    'BEGIN:VEVENT', `UID:${uid}@educrm`, `DTSTAMP:${now}`,
    `DTSTART;TZID=Europe/Kyiv:${dt(it.date, it.startTime)}`, `DTEND;TZID=Europe/Kyiv:${dt(it.date, endOf(it))}`,
    `SUMMARY:${icsEsc(it.title)}`, it.details ? `DESCRIPTION:${icsEsc(it.details)}` : '',
    'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(it.title)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
  return URL.createObjectURL(new Blob([body], { type: 'text/calendar;charset=utf-8' }));
}

async function load() {
  if (!eventId && !groupId) return fail('У посиланні не вказано заняття.');
  const path = groupId ? 'groupEvents/' + groupId : 'events/' + eventId;
  let v, teacher = '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') && /^\d{1,2}:\d{2}$/.test(params.get('start') || '')) {
    // Нові кнопки з Telegram передають дані заняття в посиланні
    v = { title: params.get('title') || '', date: params.get('date'), startTime: params.get('start'), endTime: params.get('end') || '' };
    teacher = params.get('teacher') || '';
  } else {
    // Старі посилання — лише id, читаємо з бази
    const snap = await get(ref(db, path)).catch(() => null);
    if (!snap?.exists()) return fail('Можливо, заняття видалили або посилання застаріло.');
    v = snap.val();
    if (v.assignedPersonId) teacher = (await get(ref(db, `people/${v.assignedPersonId}/name`)).catch(() => null))?.val() || '';
  }
  if (!v.date || !v.startTime) return fail('У заняття не вказано дату або час.');

  const it = {
    title: groupId ? (v.title || 'Групове заняття') : (v.title || 'Заняття'),
    date: v.date, startTime: v.startTime, endTime: v.endTime || '',
    details: [groupId ? 'Групове заняття' : '', teacher ? `Вчитель: ${teacher}` : '', v.description || ''].filter(Boolean).join('\n'),
  };
  const dd = new Date(v.date + 'T12:00:00');
  const day = `${dd.toLocaleDateString('uk-UA', { weekday: 'long' })}, ${dd.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}`;
  const cancelled = v.status === 'cancelled';
  const fileName = it.title.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40) + '.ics';
  document.title = `${it.title} — додати в календар`;

  render(box, html`
    <div class="cal-add-ico">${icon(groupId ? 'users' : 'calendar', 26)}</div>
    <h1>${it.title}</h1>
    <div class="cal-add-when">
      <div>${icon('calendar', 16)}<span>${day.charAt(0).toUpperCase() + day.slice(1)}</span></div>
      <div>${icon('clock', 16)}<span>${it.startTime}–${endOf(it)}</span></div>
      ${teacher ? html`<div>${icon('graduation-cap', 16)}<span>${teacher}</span></div>` : ''}
    </div>
    ${cancelled ? html`<div class="alert alert-danger">${icon('alert-triangle', 16)}<span>Це заняття скасовано.</span></div>` : ''}
    <div class="cal-add-btns">
      <a class="btn btn-primary btn-lg" href="${googleUrl(it)}" target="_blank" rel="noopener">${icon('calendar', 18)} Google Календар</a>
      <a class="btn btn-lg" href="${icsFile(it, path.replace('/', '-'))}" download="${fileName}">${icon('download', 18)} Apple, Outlook та інші (.ics)</a>
    </div>
    <p class="cal-add-hint">Нагадування за годину до початку додається автоматично (у файлі .ics).</p>`);
}

load().catch(() => fail('Перевірте інтернет і спробуйте ще раз.'));

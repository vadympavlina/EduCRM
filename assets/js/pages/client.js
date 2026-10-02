// ============================================================
//  Картка клієнта — профіль, теги, історія (заняття, нотатки,
//  договори, відгуки) і дії з заняттями.
//  client?id=<ключ картки>
// ============================================================

import { db, ref, get, onValue, query, orderByChild, startAt, equalTo } from '../core/firebase.js';
import { html, render, on, initials, safeUrl, busy } from '../core/dom.js';
import { isoDate, fmtDate, fmtDateTime, fmtRelative, plural } from '../core/format.js';
import { initShell, setPageTitle } from '../ui/shell.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/dialog.js';
import { teacherColor } from '../data/teachers.js';
import { STATUS, setEventStatus } from '../data/events.js';
import { GROUP_STATUS, contractTag } from '../data/group-events.js';
import {
  phoneKey, ensurePhoneKeys, clientEventsQuery, setClientName, setClientTags, addComment, deleteComment, deleteContract,
} from '../data/clients.js';
import { store, ctx, teacherName } from '../calendar/store.js';
import { openEventDialog } from '../calendar/event-dialog.js';
import { openGroupDialog } from '../calendar/group-dialog.js';
import { openContractDialog } from '../calendar/contract-dialog.js';

const key = new URLSearchParams(location.search).get('id');
if (!key) location.replace('clients');

const page = document.getElementById('page');
let client = undefined;     // undefined — ще вантажиться, null — немає картки
let comments = [];
let reviews = {};           // eventId -> відгук
let tags = {};
let others = [];            // інші картки з тим самим номером
let filter = 'all';
let eventsLoaded = false;

const shellReady = initShell({
  page: 'clients',
  title: 'Клієнт',
  back: { href: 'clients', label: 'До списку клієнтів' },
  actions: html`
    <button class="btn" data-action="contract">${icon('file-text', 16)} Договір</button>
    <button class="btn btn-primary" data-action="new-event">${icon('plus', 16)} Нове заняття</button>`,
});

render(page, html`
  <div class="client-grid">
    <aside class="client-side">
      <section class="card" id="profile"><div class="page-loader"><div class="spinner"></div></div></section>
      <section class="card" id="facts"></section>
      <section class="card" id="tags"></section>
    </aside>
    <div class="client-main">
      <section class="card composer">
        <textarea class="textarea" id="note" rows="2" maxlength="2000" placeholder="Нотатка про клієнта: результат дзвінка, побажання… (Ctrl+Enter — зберегти)"></textarea>
        <div class="composer-foot"><span class="field-hint" id="note-author"></span><button class="btn btn-primary btn-sm" data-action="note">Додати нотатку</button></div>
      </section>
      <div class="segmented tl-filter" id="tl-filter"></div>
      <div id="timeline"></div>
    </div>
  </div>`);

store.staff = await shellReady;
document.getElementById('note-author').textContent = `Від імені: ${store.staff.name}`;

// ── Дані ─────────────────────────────────────────────────────
onValue(ref(db, 'people'), s => { store.teachers = s.val() || {}; renderAll(); });
onValue(ref(db, 'groupEvents'), s => { const n = {}; s.forEach(c => { n[c.key] = { id: c.key, ...c.val() }; }); store.groupEvents = n; renderAll(); });
onValue(ref(db, 'settings/blockedTimes'), s => { store.blockedTimes = s.val() || {}; });
onValue(query(ref(db, 'busySlots'), orderByChild('date'), startAt(isoDate(new Date()))), s => { store.busySlots = s.val() || {}; });
onValue(ref(db, 'tags'), s => { tags = s.val() || {}; renderTags(); });
onValue(ref(db, 'clientTimeline/' + key), s => {
  comments = [];
  s.forEach(c => { comments.push({ id: c.key, ...c.val() }); });
  renderTimeline();
});

let subscribed = false;
onValue(ref(db, 'clients/' + key), async s => {
  client = s.exists() ? s.val() : null;
  if (client) setPageTitle(client.name || 'Без імені', client.phone || key);
  renderAll();
  if (!subscribed) {
    subscribed = true;
    await ensurePhoneKeys().catch(err => console.error(err));
    const phone = client?.phone || key;
    onValue(clientEventsQuery(phone), es => {
      const n = {};
      es.forEach(c => { n[c.key] = { id: c.key, ...c.val() }; });
      store.events = n; eventsLoaded = true;
      loadReviews();
      renderAll();
    });
    const k = client?.phoneKey || phoneKey(phone);
    if (k) get(query(ref(db, 'clients'), orderByChild('phoneKey'), equalTo(k))).then(d => {
      others = []; d.forEach(c => { if (c.key !== key) others.push({ key: c.key, ...c.val() }); });
      renderProfile();
    }).catch(() => {});
  }
});


async function loadReviews() {
  const ids = Object.keys(store.events).filter(id => !(id in reviews));
  await Promise.all(ids.map(async id => {
    const r = await get(ref(db, 'reviews/' + id)).catch(() => null);
    reviews[id] = r?.exists() ? r.val() : null;
  }));
  renderTimeline();
}

// ── Рендер ───────────────────────────────────────────────────
function renderAll() { renderProfile(); renderFacts(); renderTags(); renderTimeline(); }

function renderProfile() {
  const box = document.getElementById('profile');
  if (client === undefined) return;
  if (client === null) {
    render(box, html`<div class="empty"><div class="empty-icon">${icon('user', 24)}</div><h3>Картку не знайдено</h3>
      <p>Можливо, її видалили. <a href="clients">До списку клієнтів</a></p></div>`);
    return;
  }
  const phone = client.phone || key;
  const k = client.phoneKey || phoneKey(phone);
  const crm = safeUrl(client.crmLink || '');
  render(box, html`
    <div class="profile-head">
      <span class="avatar avatar-xl">${initials(client.name || key.slice(-2))}</span>
      <div class="profile-name">
        <input class="name-edit" id="name-edit" value="${client.name || ''}" placeholder="Додати ім'я" maxlength="80" aria-label="Ім'я клієнта">
        <span class="field-hint">${client.createdAt ? `Клієнт з ${fmtDate(client.createdAt)}` : ''}</span>
      </div>
    </div>
    <div class="contact-row">
      ${icon('phone', 16)}
      <span class="num">${phone}</span>
      <span class="spacer"></span>
      <button class="icon-btn" data-action="copy-phone" title="Скопіювати номер" aria-label="Скопіювати номер">${icon('copy', 16)}</button>
      ${k ? html`<a class="icon-btn" href="tel:+380${k}" title="Подзвонити" aria-label="Подзвонити">${icon('phone', 16)}</a>
        <a class="icon-btn viber" href="viber://chat?number=%2B380${k}" title="Написати у Viber" aria-label="Viber">${icon('message-square', 16)}</a>` : ''}
    </div>
    ${crm ? html`<a class="btn btn-sm" href="${crm}" target="_blank" rel="noopener" style="width:100%">Картка в робочій CRM ↗</a>` : ''}
    ${others.length ? html`
      <div class="alert alert-warning">${icon('alert-triangle', 16)}
        <span>Є ще ${others.length > 1 ? `${others.length} картки` : 'картка'} з цим номером:
          ${others.map((o, i) => html`${i ? ', ' : ''}<a href="client?id=${encodeURIComponent(o.key)}">${o.name || o.phone || o.key}</a>`)}.
          Заняття тут показані з усіх.</span>
      </div>` : ''}`);
}

function renderFacts() {
  const box = document.getElementById('facts');
  if (!client) { render(box, ''); return; }
  const evs = Object.values(store.events);
  const done = evs.filter(e => e.status === 'completed').length;
  const upcoming = evs.filter(e => (e.status === 'pending' || e.status === 'confirmed') && e.date >= isoDate(new Date()))
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))[0];
  const dates = evs.map(e => e.date).filter(Boolean).sort();
  const contracts = Object.values(client.contracts || {});
  render(box, html`
    <div class="fact-grid">
      <div><b class="num">${eventsLoaded ? evs.length : '…'}</b><span>${plural(evs.length, 'заняття', 'заняття', 'занять')}</span></div>
      <div><b class="num" style="color:var(--success)">${eventsLoaded ? done : '…'}</b><span>проведено</span></div>
      <div><b class="num" style="color:var(--brand)">${contracts.length}</b><span>${plural(contracts.length, 'договір', 'договори', 'договорів')}</span></div>
    </div>
    <dl class="facts">
      <dt>Найближче</dt><dd>${upcoming ? html`<a href="#" data-open="${upcoming.id}">${fmtDate(upcoming.date + 'T12:00')}, ${upcoming.startTime}</a>` : '—'}</dd>
      <dt>Перше заняття</dt><dd>${dates[0] ? fmtDate(dates[0] + 'T12:00') : '—'}</dd>
      <dt>Останнє</dt><dd>${dates.length ? fmtDate(dates[dates.length - 1] + 'T12:00') : '—'}</dd>
    </dl>`);
}

function renderTags() {
  const box = document.getElementById('tags');
  if (!client) { render(box, ''); return; }
  const mine = client.tags || [];
  const all = Object.entries(tags);
  render(box, html`
    <div class="card-head" style="padding:12px 16px"><h2 style="font-size:var(--fs-md)">Теги</h2><span class="spacer"></span><a class="btn btn-ghost btn-sm" href="tags">Керувати</a></div>
    <div class="tag-pick">
      ${all.length ? all.map(([id, t]) => html`
        <button type="button" class="tag ${mine.includes(id) ? 'on' : ''}" style="--t:${t.color || '#4f6ef7'}" data-tag="${id}" aria-pressed="${String(mine.includes(id))}">
          ${mine.includes(id) ? icon('check', 12) : ''}${t.name}</button>`) : html`<span class="muted">Тегів ще немає — <a href="tags">створіть</a></span>`}
    </div>`);
}

const FILTERS = [['all', 'Усе'], ['event', 'Заняття'], ['comment', 'Нотатки'], ['contract', 'Договори'], ['review', 'Відгуки']];

function items() {
  const out = [];
  Object.values(store.events).forEach(e => out.push({ type: 'event', ts: e.date ? Date.parse(`${e.date}T${e.startTime || '00:00'}`) : Date.parse(e.createdAt || 0), e }));
  comments.forEach(c => out.push({ type: 'comment', ts: c.createdAt || 0, c }));
  Object.entries(client?.contracts || {}).forEach(([id, c]) => out.push({ type: 'contract', ts: c.signedAt || 0, c: { id, ...c } }));
  Object.entries(reviews).forEach(([id, r]) => { if (r) out.push({ type: 'review', ts: r.createdAt || 0, r, eventId: id }); });
  return out.sort((a, b) => b.ts - a.ts);
}

function renderTimeline() {
  if (!client) { render(document.getElementById('timeline'), ''); return; }
  const all = items();
  const count = t => t === 'all' ? all.length : all.filter(i => i.type === t).length;
  render(document.getElementById('tl-filter'), html`${FILTERS.map(([v, l]) => html`
    <label><input type="radio" name="tl" value="${v}" ${v === filter ? 'checked' : ''}><span>${l}${count(v) ? html` <span class="muted">${count(v)}</span>` : ''}</span></label>`)}`);
  const list = filter === 'all' ? all : all.filter(i => i.type === filter);
  const box = document.getElementById('timeline');
  if (!eventsLoaded) { render(box, html`<div class="page-loader"><div class="spinner"></div></div>`); return; }
  if (!list.length) { render(box, html`<div class="card empty"><div class="empty-icon">${icon('clock', 22)}</div><p>Тут поки порожньо</p></div>`); return; }
  render(box, html`<div class="timeline">${list.map(item => ({ event: eventItem, comment: commentItem, contract: contractItem, review: reviewItem })[item.type](item))}</div>`);
}

const contractsByEvent = () => new Set(Object.values(client?.contracts || {}).map(c => c.eventId).filter(Boolean));

function eventItem({ e }) {
  const st = STATUS[e.status] ? e.status : 'pending';
  const tag = e.isGroupMirror ? contractTag(e.groupEventId, e.participantId) : e.id;
  const hasContract = contractsByEvent().has(tag);
  const ge = e.isGroupMirror ? store.groupEvents[e.groupEventId] : null;
  return html`
    <article class="tl-item">
      <span class="tl-dot" style="--c:${e.assignedPersonId ? teacherColor(store.teachers, e.assignedPersonId) : 'var(--text-4)'}">${icon(e.isGroupMirror ? 'users' : 'calendar', 14)}</span>
      <div class="card tl-card">
        <div class="tl-top">
          <button type="button" class="row-title tl-link" data-${e.isGroupMirror ? 'group' : 'open'}="${e.isGroupMirror ? e.groupEventId : e.id}">${e.title || '—'}</button>
          ${e.isGroupMirror ? html`<span class="badge badge-violet">Група${e.clientName ? ` · ${e.clientName}` : ''}</span>` : ''}
          <span class="badge badge-${STATUS[st].badge}">${STATUS[st].label}</span>
          <span class="spacer"></span>
          <span class="tl-time">${e.date ? fmtDate(e.date + 'T12:00') : ''}${e.startTime ? `, ${e.startTime}–${e.endTime || ''}` : ''}</span>
        </div>
        <div class="tl-meta">
          ${e.assignedPersonId ? html`<span class="teacher-tag"><span class="dot" style="--dot:${teacherColor(store.teachers, e.assignedPersonId)}"></span>${teacherName(e.assignedPersonId)}</span>` : ''}
          ${e.createdBy ? html`<span class="muted">· записав ${e.createdBy}</span>` : ''}
        </div>
        ${e.description ? html`<p class="tl-text">${e.description}</p>` : ''}
        <div class="tl-actions">
          ${e.isGroupMirror ? html`<button class="btn btn-sm" data-group="${e.groupEventId}">${icon('users', 14)} Відкрити групу${ge ? ` · ${GROUP_STATUS[ge.status || 'pending']?.label || ''}` : ''}</button>` : html`
            ${st === 'pending' ? html`<button class="btn btn-sm btn-primary" data-status="confirmed" data-id="${e.id}">${icon('check', 14)} Підтвердити</button>
              <button class="btn btn-sm" data-status="cancelled" data-id="${e.id}">Скасувати</button>` : ''}
            ${st === 'confirmed' ? html`<button class="btn btn-sm btn-primary" data-status="completed" data-id="${e.id}">${icon('check-circle', 14)} Проведено</button>
              <button class="btn btn-sm" data-status="cancelled" data-id="${e.id}">Скасувати</button>` : ''}`}
          ${st === 'completed' ? html`<button class="btn btn-sm ${hasContract ? 'is-done' : ''}" data-contract="${e.id}">${icon(hasContract ? 'check' : 'file-text', 14)} ${hasContract ? 'Договір оформлено' : 'Оформити договір'}</button>` : ''}
        </div>
      </div>
    </article>`;
}

function commentItem({ c }) {
  return html`
    <article class="tl-item">
      <span class="tl-dot" style="--c:var(--info)">${icon('message-square', 14)}</span>
      <div class="card tl-card">
        <div class="tl-top"><span class="avatar avatar-sm">${initials(c.author)}</span><b>${c.author || 'Менеджер'}</b><span class="muted">додав нотатку</span>
          <span class="spacer"></span><span class="tl-time" title="${fmtDateTime(c.createdAt)}">${fmtRelative(c.createdAt)}</span>
          <button class="icon-btn danger" data-del-comment="${c.id}" title="Видалити" aria-label="Видалити">${icon('trash', 14)}</button></div>
        <p class="tl-text">${c.text || ''}</p>
      </div>
    </article>`;
}

function contractItem({ c }) {
  return html`
    <article class="tl-item">
      <span class="tl-dot" style="--c:var(--success)">${icon('file-text', 14)}</span>
      <div class="card tl-card">
        <div class="tl-top"><b>${c.title || 'Договір'}</b>
          ${c.alreadyHad ? html`<span class="badge">Вже мав — без бонусу</span>` : html`<span class="badge badge-success">Новий</span>`}
          <span class="spacer"></span><span class="tl-time">${fmtDate(c.signedAt)}</span>
          <button class="icon-btn danger" data-del-contract="${c.id}" title="Видалити договір" aria-label="Видалити договір">${icon('trash', 14)}</button></div>
        <div class="tl-meta">
          ${c.teacherId ? html`<span class="teacher-tag"><span class="dot" style="--dot:${teacherColor(store.teachers, c.teacherId)}"></span>${teacherName(c.teacherId) || 'Невідомий вчитель'}</span>` : ''}
          ${c.clientName ? html`<span class="muted">· ${c.clientName}</span>` : ''}
          ${c.eventTitle ? html`<span class="muted">· до заняття «${c.eventTitle}»</span>` : ''}
          ${c.signedBy ? html`<span class="muted">· оформив ${c.signedBy}</span>` : ''}
        </div>
      </div>
    </article>`;
}

function reviewItem({ r, eventId }) {
  return html`
    <article class="tl-item">
      <span class="tl-dot" style="--c:var(--warning)">${icon('sparkles', 14)}</span>
      <div class="card tl-card review">
        <div class="tl-top"><b>Відгук клієнта</b><span class="muted">${r.eventTitle ? `· ${r.eventTitle}` : ''}</span>
          <span class="spacer"></span><span class="tl-time">${fmtDateTime(r.createdAt)}</span></div>
        <p class="tl-text">${r.comment || ''}</p>
        ${store.events[eventId] ? html`<div class="tl-actions"><button class="btn btn-sm btn-ghost" data-open="${eventId}">До заняття</button></div>` : ''}
      </div>
    </article>`;
}

// ── Дії ──────────────────────────────────────────────────────
const phoneOf = () => client?.phone || key;

on(page, 'change', '#name-edit', async (_, el) => {
  const name = el.value.trim().replace(/\s+/g, ' ');
  if (name === (client.name || '')) return;
  await setClientName(key, name).then(() => toast('Ім\'я збережено', 'success')).catch(() => toast('Не вдалося зберегти', 'error'));
});
on(page, 'keydown', '#name-edit', (e, el) => { if (e.key === 'Enter') el.blur(); if (e.key === 'Escape') { el.value = client.name || ''; el.blur(); } });

on(page, 'click', '[data-action="copy-phone"]', () => navigator.clipboard.writeText(phoneOf()).then(() => toast('Номер скопійовано', 'success')));

on(page, 'click', '[data-tag]', async (_, el) => {
  const id = el.dataset.tag;
  const cur = client.tags || [];
  await setClientTags(key, cur.includes(id) ? cur.filter(t => t !== id) : [...cur, id]).catch(() => toast('Не вдалося змінити тег', 'error'));
});

on(page, 'change', '#tl-filter input', (_, el) => { filter = el.value; renderTimeline(); });

async function saveNote(btn) {
  const ta = document.getElementById('note');
  const text = ta.value.trim();
  if (!text) { ta.focus(); return; }
  await busy(btn, () => addComment(key, text, store.staff)
    .then(() => { ta.value = ''; toast('Нотатку додано', 'success'); })
    .catch(() => toast('Не вдалося зберегти нотатку', 'error')));
}
on(page, 'click', '[data-action="note"]', (_, btn) => saveNote(btn));
document.getElementById('note').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveNote(page.querySelector('[data-action="note"]')); }
});

on(page, 'click', '[data-open]', (e, el) => { e.preventDefault(); openEventDialog({ id: el.dataset.open }); });
on(page, 'click', '[data-group]', (_, el) => openGroupDialog({ id: el.dataset.group }));

on(page, 'click', '[data-status]', async (_, btn) => {
  const ev = store.events[btn.dataset.id];
  const status = btn.dataset.status;
  if (!ev) return;
  if (status === 'cancelled' && !await confirmDialog({ title: 'Скасувати заняття?', message: `${ev.title} · ${ev.date} ${ev.startTime}`, confirmText: 'Скасувати заняття', danger: true })) return;
  if (status === 'completed' && !await confirmDialog({ title: 'Позначити як проведене?', message: `Вчителю (${teacherName(ev.assignedPersonId)}) буде нараховано оплату.`, confirmText: 'Проведено' })) return;
  await busy(btn, () => setEventStatus(ev, status, ctx())
    .then(() => toast({ confirmed: 'Заняття підтверджено', cancelled: 'Заняття скасовано', completed: 'Заняття проведено' }[status], 'success'))
    .catch(() => toast('Не вдалося змінити статус', 'error')));
});

on(page, 'click', '[data-contract]', async (_, el) => {
  const ev = store.events[el.dataset.contract];
  if (!ev) return;
  if (!ev.assignedPersonId) { toast('У заняття не вказано вчителя', 'warning'); return; }
  const tag = ev.isGroupMirror ? contractTag(ev.groupEventId, ev.participantId) : ev.id;
  await openContractDialog({
    phone: ev.phone || phoneOf(), clientName: ev.clientName || client.name, teacherId: ev.assignedPersonId,
    eventId: tag, eventTitle: ev.title, exists: contractsByEvent().has(tag), staff: store.staff, clientKey: key,
  });
});

on(page, 'click', '[data-del-comment]', async (_, el) => {
  if (!await confirmDialog({ title: 'Видалити нотатку?', message: 'Нотатку буде видалено назавжди.', confirmText: 'Видалити', danger: true })) return;
  await deleteComment(key, el.dataset.delComment).then(() => toast('Нотатку видалено', 'success')).catch(() => toast('Не вдалося видалити', 'error'));
});

on(page, 'click', '[data-del-contract]', async (_, el) => {
  const c = client.contracts?.[el.dataset.delContract];
  if (!await confirmDialog({ title: 'Видалити договір?', message: `«${c?.title || 'Договір'}» від ${fmtDate(c?.signedAt)} зникне зі статистики — бонус вчителю буде знято.`, confirmText: 'Видалити', danger: true })) return;
  await deleteContract(key, el.dataset.delContract).then(() => toast('Договір видалено', 'success')).catch(() => toast('Не вдалося видалити', 'error'));
});

on(document, 'click', '[data-action="new-event"]', () => {
  if (!client) return;
  openEventDialog({ phone: phoneOf(), title: client.name || '' });
});
on(document, 'click', '[data-action="contract"]', async () => {
  if (!client) return;
  await openContractDialog({ phone: phoneOf(), clientName: client.name || '', teacherId: '', staff: store.staff, clientKey: key });
});

// ============================================================
//  ui/notifications.js — дзвіночок з відгуками клієнтів
//  Слухає лише останні 30 відгуків (а не всю базу подій).
// ============================================================

import { db, ref, get, update, onValue, query, orderByChild, limitToLast } from '../core/firebase.js';
import { html, render, on } from '../core/dom.js';
import { fmtRelative, phoneDigits } from '../core/format.js';
import { icon } from './icons.js';

const LIMIT = 30;
const readerKey = name => name.replace(/[.#$[\]/]/g, '_');

export function initNotifications(button, staff) {
  const loadedAt = Date.now();
  const baseTitle = document.title;
  let reviews = [];
  let reads = {};
  let pop = null;
  let firstLoad = true;

  const readsRef = ref(db, 'notifReads/' + readerKey(staff.name));

  onValue(readsRef, snap => { reads = snap.val() || {}; refresh(); });

  onValue(query(ref(db, 'reviews'), orderByChild('createdAt'), limitToLast(LIMIT)), snap => {
    const prevIds = new Set(reviews.map(r => r.id));
    reviews = [];
    snap.forEach(c => { reviews.push({ id: c.key, ...c.val() }); });
    reviews.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const fresh = firstLoad ? [] : reviews.filter(r => !prevIds.has(r.id) && r.createdAt > loadedAt && !reads[r.id]);
    if (fresh.length) { chime(); fresh.forEach(desktopNotice); }
    firstLoad = false;
    refresh();
  });

  button.addEventListener('click', e => { e.stopPropagation(); pop ? close() : open(); });

  function unreadCount() { return reviews.filter(r => !reads[r.id]).length; }

  function refresh() {
    const n = unreadCount();
    let badge = button.querySelector('.bell-badge');
    if (n > 0) {
      if (!badge) { badge = document.createElement('span'); badge.className = 'bell-badge'; button.append(badge); }
      badge.textContent = n > 9 ? '9+' : String(n);
    } else badge?.remove();
    button.setAttribute('aria-label', n ? `Сповіщення: ${n} нових` : 'Сповіщення');
    document.title = (n ? `(${n}) ` : '') + baseTitle;
    if (pop) renderPop();
  }

  function open() {
    pop = document.createElement('div');
    pop.className = 'popover notif-pop';
    button.parentElement.style.position = 'relative';
    button.parentElement.append(pop);
    renderPop();
    on(pop, 'click', '[data-review]', (_, el) => openReview(el.dataset.review));
    on(pop, 'click', '[data-action="read-all"]', () => markRead(reviews.filter(r => !reads[r.id]).map(r => r.id)));
    setTimeout(() => document.addEventListener('click', outside));
    document.addEventListener('keydown', esc);
  }

  function close() {
    pop?.remove(); pop = null;
    document.removeEventListener('click', outside);
    document.removeEventListener('keydown', esc);
  }
  const outside = e => { if (pop && !pop.contains(e.target)) close(); };
  const esc = e => { if (e.key === 'Escape') close(); };

  function renderPop() {
    const n = unreadCount();
    render(pop, html`
      <div class="notif-head">
        <h3>Відгуки клієнтів</h3>
        ${n ? html`<button class="btn btn-ghost btn-sm" data-action="read-all">${icon('check-all', 14)} Прочитати всі</button>` : ''}
      </div>
      <div class="notif-list">
        ${reviews.length ? reviews.map(r => html`
          <button class="notif-item ${reads[r.id] ? '' : 'unread'}" data-review="${r.id}">
            <span class="avatar" style="--av:var(--success)">${icon('message-square', 15)}</span>
            <span class="notif-item-body">
              <span class="notif-item-title">${r.eventTitle || 'Захід'}</span>
              <span class="notif-item-text">${r.comment || ''}</span>
              <span class="notif-item-time">${fmtRelative(r.createdAt)}</span>
            </span>
            ${reads[r.id] ? '' : html`<span class="dot"></span>`}
          </button>`) : html`
          <div class="empty">
            <div class="empty-icon">${icon('bell', 22)}</div>
            <p>Поки що відгуків немає</p>
          </div>`}
      </div>`);
  }

  async function openReview(id) {
    markRead([id]);
    const snap = await get(ref(db, `events/${id}/phone`)).catch(() => null);
    const phone = phoneDigits(snap?.val());
    if (phone) window.open('client?id=' + encodeURIComponent(phone), '_blank', 'noopener');
  }

  function desktopNotice(r) {
    if (!('Notification' in window) || Notification.permission !== 'granted' || document.hasFocus()) return;
    try {
      const n = new Notification('EduCRM — новий відгук', { body: `${r.eventTitle || 'Захід'}\n${r.comment || ''}`, icon: 'assets/favicon.svg', tag: 'educrm-review-' + r.id });
      n.onclick = () => { window.focus(); openReview(r.id); n.close(); };
    } catch {}
  }

  function markRead(ids) {
    if (!ids.length) return;
    update(readsRef, Object.fromEntries(ids.map(id => [id, true]))).catch(() => {});
  }
}

function chime() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(520, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + .12);
    gain.gain.setValueAtTime(.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .4);
    osc.start(); osc.stop(ctx.currentTime + .4);
    setTimeout(() => ctx.close(), 600);
  } catch {}
}

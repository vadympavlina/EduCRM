// ============================================================
//  background.js — фонова частина розширення:
//   • open-app: відкрити EduCRM (у вже відкритій вкладці або новій);
//   • openday-*: записати список заходу у Відкритий захід EduCRM
//     (з резервною копією попереднього списку для «Повернути»).
// ============================================================

const APP = 'https://vadympavlina.github.io/EduCRM/';
const DB = 'https://educrm-85756-default-rtdb.firebaseio.com';
const OD = `${DB}/openDayEvent.json`;
const BACKUP = 'openDayBackup';

async function openApp(url) {
  try {
    const [tab] = await chrome.tabs.query({ url: APP + '*' });
    if (tab) {
      await chrome.tabs.update(tab.id, { url, active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    } else await chrome.tabs.create({ url });
  } catch { await chrome.tabs.create({ url }); }
}

async function req(method, body) {
  const res = await fetch(OD, { method, cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`База відповіла ${res.status}`);
  return res.json();
}

const id = (i, t) => 'crm' + t.toString(36) + i.toString(36).padStart(3, '0');

async function replaceOpenDay({ title, people }) {
  if (!Array.isArray(people) || !people.length) throw new Error('Порожній список');
  const prev = await req('GET');
  await chrome.storage.local.set({ [BACKUP]: { at: Date.now(), data: prev ?? null } });
  const now = Date.now();
  const gid = 'g' + now.toString(36);
  const list = {};
  people.slice(0, 1000).forEach((p, i) => {
    list[id(i, now)] = {
      name: String(p.name || '').slice(0, 80), phone: String(p.phone || '').slice(0, 20), age: '',
      present: false, createdAt: now + i,
      ...(p.crmLink && /^https:\/\/crm\.itstep\.org\//.test(p.crmLink) ? { crmLink: p.crmLink } : {}),
    };
  });
  await req('PUT', {
    title: String(title || '').slice(0, 80),
    importedFrom: 'crm', importedAt: now,
    groups: { [gid]: { name: '', createdAt: now, people: list } },
  });
}

async function undoOpenDay() {
  const { [BACKUP]: b } = await chrome.storage.local.get(BACKUP);
  if (!b) throw new Error('Немає збереженої копії');
  await req('PUT', b.data ?? {});
  await chrome.storage.local.remove(BACKUP);
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const run = fn => { fn().then(data => reply({ ok: true, data }), e => reply({ ok: false, error: e.message })); return true; };
  switch (msg?.type) {
    case 'open-app':
      if (typeof msg.url !== 'string' || !msg.url.startsWith(APP)) return;
      return run(() => openApp(msg.url));
    case 'openday-get': return run(() => req('GET'));
    case 'openday-replace': return run(() => replaceOpenDay(msg));
    case 'openday-undo': return run(() => undoOpenDay());
  }
});

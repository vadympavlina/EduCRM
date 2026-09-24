// ─────────────────────────────────────────────────────────────
// EduCRM — щомісячний звіт на пошту.
// Запускається з GitHub Actions (.github/workflows/monthly-report.yml).
//
// ENV:
//   FIREBASE_SERVICE_ACCOUNT  — JSON сервісного акаунта Firebase (весь файл одним рядком)
//   FIREBASE_DATABASE_URL     — https://<project>-default-rtdb.<region>.firebasedatabase.app
//   RESEND_API_KEY            — ключ Resend
//   REPORT_FROM               — "EduCRM <reports@your-domain.com>" (домен верифікований у Resend)
//   REPORT_RECIPIENTS         — "a@x.com, b@y.com, c@z.com"
//   STATS_URL      (опц.)     — посилання на сторінку статистики для кнопки в листі
//   REPORT_MONTH   (опц.)     — "2026-09"; за замовчуванням поточний місяць (Київ)
//   FORCE=true     (опц.)     — ігнорувати перевірку дати/часу (ручний запуск)
//   DRY_RUN=true   (опц.)     — нічого не надсилати, зберегти report-preview.html
// ─────────────────────────────────────────────────────────────

import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const TZ = 'Europe/Kyiv';
const SEND_HOUR = 18;                    // 18:00 за Києвом
const MAX_WAIT_MS = 4 * 60 * 60 * 1000;  // не чекаємо більше 4 год (захист від помилок)
const CLAIM_TTL_MS = 20 * 60 * 1000;     // "зависле" захоплення вважаємо протухлим через 20 хв
const MARKER_PATH = 'systemReports/monthlyEmail';

const MONTHS_UA = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
  'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];

// ── ЧАС ───────────────────────────────────────────────────────
export function kyivParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map(x => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second };
}

export const monthKey = (year, month) => `${year}-${String(month).padStart(2, '0')}`;

export function isLastDayOfMonth({ year, month, day }) {
  return day === new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function msUntilSendTime({ hour, minute, second }) {
  return (SEND_HOUR * 3600 - (hour * 3600 + minute * 60 + second)) * 1000;
}

export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS_UA[m - 1]} ${y}`;
}

// ── СТАТИСТИКА (та сама логіка, що й у stats.html → renderStats) ──
export function computeStats({ events = {}, groupEvents = {}, people = {}, pricing: rawPricing, clients = {} }, month) {
  const pricing = {
    default: rawPricing?.default || { baseReward: 50, contractBonus: 100 },
    overrides: rawPricing?.overrides || {},
  };
  const getPricing = tid => (tid && pricing.overrides[tid]) ? pricing.overrides[tid] : pricing.default;

  const evList = Object.entries(events).map(([id, v]) => ({ id, ...v }));
  const geList = Object.entries(groupEvents).map(([id, v]) => ({ id, ...v }));
  const inMonth = d => !month || (d && String(d).startsWith(month));

  const allContracts = [];
  Object.entries(clients).forEach(([phone, c]) => {
    if (c && c.contracts) {
      Object.entries(c.contracts).forEach(([cid, ct]) => allContracts.push({ id: cid, phone, ...ct }));
    }
  });

  const completed = evList.filter(e => e.status === 'completed' && !e.isGroupMirror && inMonth(e.date));
  const completedGroupEvents = geList.filter(ge => ge.status === 'completed' && inMonth(ge.date));

  const contractsFiltered = allContracts.filter(c => {
    if (c.alreadyHad) return false;
    if (!c.teacherId) return false;
    if (month) {
      if (!c.signedAt) return false;
      const p = kyivParts(new Date(c.signedAt)); // на сторінці — локальний час браузера (Київ)
      if (monthKey(p.year, p.month) !== month) return false;
    }
    return true;
  });

  const byTeacher = {};
  const bucket = tid => (byTeacher[tid] ||= { count: 0, contracts: 0, earnings: 0 });

  completed.forEach(ev => {
    const b = bucket(ev.assignedPersonId || '__none__');
    b.count++; b.earnings += getPricing(ev.assignedPersonId).baseReward;
  });
  completedGroupEvents.forEach(ge => {
    const b = bucket(ge.assignedPersonId || '__none__');
    b.count++; b.earnings += getPricing(ge.assignedPersonId).baseReward;
  });
  contractsFiltered.forEach(c => {
    const b = bucket(c.teacherId);
    b.contracts++; b.earnings += getPricing(c.teacherId).contractBonus;
  });

  // Зворотна сумісність: старі події з contractSigned:true
  const contractedEventIds = new Set(allContracts.filter(c => c.eventId).map(c => c.eventId));
  completed.forEach(ev => {
    if (!ev.contractSigned || contractedEventIds.has(ev.id)) return;
    const b = bucket(ev.assignedPersonId || '__none__');
    b.contracts++; b.earnings += getPricing(ev.assignedPersonId).contractBonus;
  });

  // Воронка
  const allForPeriod = evList.filter(ev => inMonth(ev.date));
  const funnel = {
    total: allForPeriod.length,
    created: allForPeriod.filter(e => e.status !== 'cancelled').length,
    confirmed: allForPeriod.filter(e => ['confirmed', 'completed'].includes(e.status)).length,
    completed: allForPeriod.filter(e => e.status === 'completed').length,
    cancelled: allForPeriod.filter(e => e.status === 'cancelled').length,
    contract: contractsFiltered.length,
  };

  const rows = Object.entries(byTeacher)
    .map(([tid, d]) => ({
      name: tid === '__none__' ? 'Не призначено' : (people[tid]?.name || 'Невідомо'),
      ...d,
    }))
    .sort((a, b) => b.earnings - a.earnings);

  const totals = rows.reduce((s, r) => ({
    events: s.events + r.count, contracts: s.contracts + r.contracts, earnings: s.earnings + r.earnings,
  }), { events: 0, contracts: 0, earnings: 0 });

  return { rows, totals, funnel };
}

// ── HTML ЛИСТА (inline-стилі — поштові клієнти не розуміють <style>/CSS-змінні) ──
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const pct = (n, base) => base > 0 ? Math.round(n / base * 100) + '%' : '—';
const uah = n => `₴${Number(n).toLocaleString('uk-UA')}`;

export function renderEmail({ rows, totals, funnel }, month, statsUrl) {
  const avgCheck = funnel.completed > 0 ? uah(Math.round(totals.earnings / funnel.completed)) : '—';
  const chip = (val, label, color) => `
    <td style="padding:6px" width="33%">
      <div style="background:#f5f7ff;border-radius:12px;padding:14px 10px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:${color}">${val}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:4px">${label}</div>
      </div>
    </td>`;
  const step = (label, val, sub, color) => `
    <td style="padding:6px;text-align:center" width="25%">
      <div style="font-size:20px;font-weight:700;color:${color}">${val}</div>
      <div style="font-size:12px;color:#374151">${label}</div>
      <div style="font-size:11px;color:#9ca3af;margin-top:2px">${sub}</div>
    </td>`;
  const td = 'padding:10px 12px;border-bottom:1px solid #eef0f4;font-size:14px;color:#111827';
  const th = 'padding:10px 12px;background:#f3f4f6;font-size:12px;color:#6b7280;text-align:left;text-transform:uppercase;letter-spacing:.03em';

  const body = rows.length
    ? rows.map(r => `<tr>
        <td style="${td}">${esc(r.name)}</td>
        <td style="${td}">${r.count}</td>
        <td style="${td}">${r.contracts}</td>
        <td style="${td};color:#059669;font-weight:600">${uah(r.earnings)}</td>
      </tr>`).join('')
    : `<tr><td colspan="4" style="${td};text-align:center;color:#9ca3af">Немає завершених подій за цей місяць</td></tr>`;

  return `<!doctype html>
<html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Звіт EduCRM — ${esc(monthLabel(month))}</title></head>
<body style="margin:0;padding:0;background:#eef1f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f7;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden">
  <tr><td style="background:#4f6ef7;padding:22px 24px;color:#fff">
    <div style="font-size:13px;opacity:.85">EduCRM · щомісячний звіт</div>
    <div style="font-size:22px;font-weight:700;margin-top:4px">${esc(monthLabel(month))}</div>
  </td></tr>

  <tr><td style="padding:18px 18px 4px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      ${chip(totals.events, 'Подій', '#111827')}
      ${chip(uah(totals.earnings), 'Заробіток', '#059669')}
      ${chip(totals.contracts, 'Договорів', '#3b5be8')}
    </tr></table>
  </td></tr>

  <tr><td style="padding:14px 24px 0">
    <div style="font-size:15px;font-weight:700;color:#111827">Конверсія</div>
  </td></tr>
  <tr><td style="padding:4px 18px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      ${step('Створено', funnel.created, '100%', '#b45309')}
      ${step('Підтверджено', funnel.confirmed, `${pct(funnel.confirmed, funnel.created)} від створених`, '#2563eb')}
      ${step('Проведено', funnel.completed, `${pct(funnel.completed, funnel.confirmed)} від підтв.`, '#059669')}
      ${step('Договір', funnel.contract, `${pct(funnel.contract, funnel.completed)} від проведених`, '#4f6ef7')}
    </tr></table>
  </td></tr>
  <tr><td style="padding:8px 24px 4px;font-size:13px;color:#374151">
    Скасовано: <b style="color:#dc2626">${funnel.cancelled}</b> ${funnel.total ? `(${pct(funnel.cancelled, funnel.total)})` : ''}
    &nbsp;·&nbsp; Середній чек: <b>${avgCheck}</b>
    &nbsp;·&nbsp; Конверсія в договір: <b style="color:#059669">${pct(funnel.contract, funnel.created)}</b>
  </td></tr>

  <tr><td style="padding:18px 24px 8px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eef0f4;border-radius:10px;border-collapse:separate;overflow:hidden">
      <thead><tr>
        <th style="${th}">Вчитель</th><th style="${th}">Подій</th><th style="${th}">Договорів</th><th style="${th}">Заробіток</th>
      </tr></thead>
      <tbody>${body}</tbody>
      ${rows.length ? `<tfoot><tr>
        <td style="${td};font-weight:700;background:#fafafa">Разом</td>
        <td style="${td};font-weight:700;background:#fafafa">${totals.events}</td>
        <td style="${td};font-weight:700;background:#fafafa">${totals.contracts}</td>
        <td style="${td};font-weight:700;background:#fafafa;color:#059669">${uah(totals.earnings)}</td>
      </tr></tfoot>` : ''}
    </table>
  </td></tr>

  ${statsUrl ? `<tr><td align="center" style="padding:12px 24px 4px">
    <a href="${esc(statsUrl)}" style="display:inline-block;background:#4f6ef7;color:#fff;text-decoration:none;padding:11px 20px;border-radius:10px;font-size:14px;font-weight:600">Відкрити статистику</a>
  </td></tr>` : ''}

  <tr><td style="padding:16px 24px 22px;font-size:11px;color:#9ca3af;text-align:center">
    Дані станом на ${esc(new Date().toLocaleString('uk-UA', { timeZone: TZ }))} (Київ). Лист сформовано автоматично.
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// ── RESEND ───────────────────────────────────────────────────
async function sendViaResend({ apiKey, from, recipients, subject, html, idempotencyKey }) {
  // Batch API: кожен отримувач отримує окремий лист і не бачить інших адрес.
  const res = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify(recipients.map(to => ({ from, to: [to], subject, html }))),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Resend ${res.status}: ${text}`);
  return text;
}

// ── MAIN ─────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
const need = name => {
  const v = process.env[name];
  if (!v) throw new Error(`Не задано змінну середовища ${name}`);
  return v;
};

async function main() {
  const force = process.env.FORCE === 'true';
  const dryRun = process.env.DRY_RUN === 'true';
  let now = kyivParts();
  const month = process.env.REPORT_MONTH || monthKey(now.year, now.month);

  console.log(`Київ зараз: ${JSON.stringify(now)} | місяць звіту: ${month} | force=${force} dryRun=${dryRun}`);

  if (!force) {
    if (!isLastDayOfMonth(now)) {
      console.log('Сьогодні не останній день місяця — виходжу.');
      return;
    }
    const wait = msUntilSendTime(now);
    if (wait > MAX_WAIT_MS) throw new Error(`До ${SEND_HOUR}:00 ще ${Math.round(wait / 60000)} хв — розклад налаштований неправильно.`);
    if (wait > 0) {
      console.log(`Чекаю ${Math.round(wait / 60000)} хв до ${SEND_HOUR}:00 за Києвом…`);
      await sleep(wait);
    } else {
      console.warn(`УВАГА: запуск стартував із запізненням на ${Math.round(-wait / 60000)} хв — надсилаю одразу.`);
    }
  }

  const recipients = dryRun ? [] : need('REPORT_RECIPIENTS').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  if (!dryRun && recipients.length === 0) throw new Error('Список REPORT_RECIPIENTS порожній');

  const { default: admin } = await import('firebase-admin');
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(need('FIREBASE_SERVICE_ACCOUNT'))),
    databaseURL: need('FIREBASE_DATABASE_URL'),
  });
  const db = admin.database();
  const marker = db.ref(`${MARKER_PATH}/${month}`);
  const useMarker = !force && !dryRun; // ручні тести не блокують справжню розсилку

  try {
    // Захист від дубля: запусків за розкладом два (страховка), лист має піти один раз.
    if (useMarker) {
      const tx = await marker.transaction(cur => {
        if (cur && cur.status === 'sent') return;                                        // вже надіслано
        if (cur && cur.status === 'sending' && Date.now() - cur.claimedAt < CLAIM_TTL_MS) return; // інший запуск саме шле
        return { status: 'sending', claimedAt: Date.now(), runId: process.env.GITHUB_RUN_ID || 'local' };
      });
      if (!tx.committed) {
        console.log(`Звіт за ${month} вже надіслано (або надсилається іншим запуском) — виходжу.`);
        return;
      }
    }

    const paths = ['events', 'groupEvents', 'people', 'pricing', 'clients'];
    const snaps = await Promise.all(paths.map(p => db.ref(p).once('value')));
    const data = Object.fromEntries(paths.map((p, i) => [p, snaps[i].val() || undefined]));

    const stats = computeStats(data, month);
    const html = renderEmail(stats, month, process.env.STATS_URL);
    const subject = `Звіт EduCRM — ${monthLabel(month)}`;
    console.log(`Підсумок: подій ${stats.totals.events}, договорів ${stats.totals.contracts}, заробіток ₴${stats.totals.earnings}`);

    if (dryRun) {
      await writeFile('report-preview.html', html);
      console.log('DRY_RUN: лист НЕ надіслано, превʼю збережено в report-preview.html');
      return;
    }

    const result = await sendViaResend({
      apiKey: need('RESEND_API_KEY'),
      from: need('REPORT_FROM'),
      recipients,
      subject,
      html,
      idempotencyKey: useMarker ? `educrm-monthly-${month}` : undefined,
    });
    console.log(`Надіслано на ${recipients.length} адрес(и). Resend: ${result}`);

    if (useMarker) await marker.set({ status: 'sent', sentAt: Date.now(), recipients: recipients.length, runId: process.env.GITHUB_RUN_ID || 'local' });
  } catch (err) {
    if (useMarker) await marker.remove().catch(() => {}); // звільняємо, щоб страхувальний запуск спробував ще раз
    throw err;
  } finally {
    await admin.app().delete();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error(err); process.exit(1); });
}

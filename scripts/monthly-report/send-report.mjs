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
    .map(([tid, d]) => {
      const p = getPricing(tid === '__none__' ? undefined : tid);
      return {
        name: tid === '__none__' ? 'Не призначено' : (people[tid]?.name || 'Невідомо'),
        baseReward: p.baseReward, contractBonus: p.contractBonus,
        ...d,
      };
    })
    .sort((a, b) => b.earnings - a.earnings);

  const totals = rows.reduce((s, r) => ({
    events: s.events + r.count, contracts: s.contracts + r.contracts, earnings: s.earnings + r.earnings,
  }), { events: 0, contracts: 0, earnings: 0 });

  return { rows, totals, funnel };
}

// ── HTML ЛИСТА ───────────────────────────────────────────────
// Лише таблиці та inline-стилі: так лист однаково виглядає в Gmail, Outlook і на телефоні.
const C = {
  ink: '#1c2340', muted: '#6b7390', faint: '#a3a9bf', line: '#e8ebf3',
  bg: '#f1f3f9', brand: '#4f6ef7', brandSoft: '#eef1ff',
  green: '#0f9d6b', greenSoft: '#e6f6ef', red: '#d93a3a', redSoft: '#fdecec',
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const pctNum = (n, base) => base > 0 ? Math.round(n / base * 100) : null;
const pct = (n, base) => base > 0 ? `${Math.round(n / base * 100)}%` : '—';
const uah = n => `₴${Math.round(Number(n)).toLocaleString('uk-UA').replace(/\u00a0/g, ' ')}`;
const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
};
const MONTHS_GEN = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
  'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
const MONTHS_LOC = ['січні', 'лютому', 'березні', 'квітні', 'травні', 'червні',
  'липні', 'серпні', 'вересні', 'жовтні', 'листопаді', 'грудні'];

export function prevMonthKey(key) {
  const [y, m] = key.split('-').map(Number);
  return m === 1 ? monthKey(y - 1, 12) : monthKey(y, m - 1);
}

// Бейдж зміни відносно минулого місяця
function delta(cur, prev) {
  if (prev == null) return '';
  if (prev === 0 && cur === 0) return '';
  if (prev === 0) return badge('нове', C.brand, C.brandSoft);
  const d = Math.round((cur - prev) / prev * 100);
  if (d === 0) return badge('без змін', C.muted, C.bg);
  return d > 0 ? badge(`▲ ${d}%`, C.green, C.greenSoft) : badge(`▼ ${Math.abs(d)}%`, C.red, C.redSoft);
}
const badge = (text, color, bg) =>
  `<span style="display:inline-block;padding:3px 8px;border-radius:999px;background:${bg};color:${color};font-size:12px;font-weight:600;line-height:16px;white-space:nowrap">${text}</span>`;

// Горизонтальна смужка (таблицею — працює навіть в Outlook)
function bar(percent, color, track = C.bg, height = 8) {
  const p = Math.max(0, Math.min(100, percent || 0));
  const fill = p > 0
    ? `<td width="${p}%" style="background:${color};height:${height}px;line-height:${height}px;font-size:0;border-radius:${height}px">&nbsp;</td>` : '';
  const rest = p < 100 ? `<td style="height:${height}px;line-height:${height}px;font-size:0">&nbsp;</td>` : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${track};border-radius:${height}px"><tr>${fill}${rest}</tr></table>`;
}

export function renderEmail(stats, month, prev = null) {
  const { rows, totals, funnel } = stats;
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const prevName = MONTHS_LOC[(m + 10) % 12];
  const avgCheck = funnel.completed > 0 ? uah(totals.earnings / funnel.completed) : '—';
  const generatedAt = new Date().toLocaleString('uk-UA', { timeZone: TZ, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

  const preheader = `${uah(totals.earnings)} до виплати, ${totals.events} ${plural(totals.events, 'заняття', 'заняття', 'занять')}, ${totals.contracts} ${plural(totals.contracts, 'договір', 'договори', 'договорів')}`;

  // ── Таблиця нарахувань (для бухгалтерії)
  const TB = '#dde2ee';            // колір ліній таблиці
  const ZEBRA = '#f7f8fc';         // фон парних рядків
  const PAY_BG = '#e9f7f0';        // фон колонки "До виплати"
  const th = (t, align = 'right', extra = '') =>
    `<th class="tc" style="padding:12px 10px;font-size:13px;font-weight:700;color:#ffffff;text-align:${align};background:${C.brand};line-height:16px;vertical-align:bottom;${extra}">${t}</th>`;
  const cell = (v, { align = 'right', bold = false, color = C.ink, sub = '', bg = '', size = 15, extra = '' } = {}) =>
    `<td class="tc" style="padding:13px 10px;font-size:${size}px;line-height:20px;color:${color};text-align:${align};border-bottom:1px solid ${TB};${bg ? `background:${bg};` : ''}${bold ? 'font-weight:700;' : ''}${align === 'left' ? '' : 'white-space:nowrap;'}vertical-align:top;${extra}">${v}${sub ? `<div style="font-size:12px;line-height:14px;font-weight:400;color:${C.muted};padding-top:2px">${sub}</div>` : ''}</td>`;

  const tRows = rows.map((r, i) => {
    const forEvents = r.count * r.baseReward;
    const forContracts = r.earnings - forEvents; // включно зі старими contractSigned
    const bg = i % 2 ? ZEBRA : '#ffffff';
    return `<tr>
      ${cell(esc(r.name), { align: 'left', bold: true, bg })}
      ${cell(r.count, { bg })}
      ${cell(uah(forEvents), { sub: `по ${uah(r.baseReward)}`, bg })}
      ${cell(r.contracts, { bg })}
      ${cell(uah(forContracts), { sub: `по ${uah(r.contractBonus)}`, bg })}
      ${cell(uah(r.earnings), { bold: true, color: C.green, bg: PAY_BG, size: 16 })}
    </tr>`;
  }).join('');
  const sumEvents = rows.reduce((s, r) => s + r.count * r.baseReward, 0);
  const T = { bold: true, bg: C.brandSoft, extra: `border-top:2px solid ${C.brand};border-bottom:none;` };
  const tfoot = `<tr>
      ${cell('Разом', { ...T, align: 'left' })}
      ${cell(totals.events, T)}
      ${cell(uah(sumEvents), T)}
      ${cell(totals.contracts, T)}
      ${cell(uah(totals.earnings - sumEvents), T)}
      ${cell(uah(totals.earnings), { ...T, color: C.green, size: 17, bg: '#d5f0e3' })}
    </tr>`;

  const teachersBlock = `<tr><td style="padding-top:6px">
    <div style="border:1px solid ${TB};border-radius:12px;overflow:hidden">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      <thead><tr>
        ${th('Вчитель', 'left')}${th('Занять')}${th('За заняття')}${th('Договорів')}${th('За договори')}${th('До виплати', 'right', `background:${C.green};`)}
      </tr></thead>
      <tbody>${rows.length ? tRows + tfoot
        : `<tr><td colspan="6" style="padding:18px 10px;font-size:15px;color:${C.muted};text-align:center">У цьому місяці немає проведених занять</td></tr>`}</tbody>
    </table>
    </div>
  </td></tr>`;

  // ── Воронка
  const steps = [
    { label: 'Записано', n: funnel.created, note: 'усі заявки, крім скасованих', color: '#9aa8f9' },
    { label: 'Підтверджено', n: funnel.confirmed, note: `${pct(funnel.confirmed, funnel.created)} від записаних`, color: '#7189f8' },
    { label: 'Проведено', n: funnel.completed, note: `${pct(funnel.completed, funnel.confirmed)} від підтверджених`, color: C.brand },
    { label: 'Уклали договір', n: funnel.contract, note: `${pct(funnel.contract, funnel.completed)} від проведених`, color: C.green },
  ];
  const funnelRows = steps.map((s, i) => `
    <tr><td style="padding:${i ? 14 : 4}px 0 0">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-size:14px;color:${C.ink}"><b>${s.n}</b>&nbsp; ${s.label}</td>
        <td align="right" style="font-size:12px;color:${C.faint}">${s.note}</td>
      </tr><tr>
        <td colspan="2" style="padding-top:6px">${bar(pctNum(s.n, funnel.created) ?? 0, s.color)}</td>
      </tr></table>
    </td></tr>`).join('');

  // ── Три факти внизу
  const fact = (value, label, color = C.ink) => `
    <td width="33%" valign="top" style="padding:14px 8px;text-align:center">
      <div style="font-size:18px;font-weight:700;color:${color}">${value}</div>
      <div style="font-size:12px;color:${C.muted};padding-top:3px">${label}</div>
    </td>`;

  const kpi = (value, label, d) => `
    <td width="50%" valign="top" style="padding:0 6px">
      <div style="background:${C.bg};border-radius:12px;padding:14px 16px">
        <div style="font-size:22px;font-weight:700;color:${C.ink}">${value}</div>
        <div style="font-size:13px;color:${C.muted};padding:2px 0 8px">${label}</div>
        ${d || '&nbsp;'}
      </div>
    </td>`;

  const section = (title, inner) => `
  <tr><td class="px" style="padding:28px 28px 0">
    <div style="font-size:18px;font-weight:700;color:${C.ink};padding-bottom:8px">${title}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${inner}</table>
  </td></tr>`;

  return `<!doctype html>
<html lang="uk"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<style>@media (max-width:480px){.px{padding-left:16px!important;padding-right:16px!important}.pxk{padding-left:10px!important;padding-right:10px!important}.wrap{padding:0!important}.tc{padding-left:3px!important;padding-right:3px!important;font-size:12px!important}}</style>
<title>Звіт EduCRM за ${esc(MONTHS_UA[m - 1].toLowerCase())} ${y}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};font-family:${FONT};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}">
<tr><td align="center" class="wrap" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:660px;background:#ffffff;border-radius:18px">

  <!-- Шапка -->
  <tr><td class="px" style="padding:26px 28px 0">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="background:${C.brand};border-radius:8px;width:28px;height:28px;text-align:center;vertical-align:middle">
        <div style="width:12px;height:2px;background:#fff;border-radius:2px;margin:0 0 3px 8px;font-size:0">&nbsp;</div>
        <div style="width:16px;height:2px;background:#fff;border-radius:2px;margin:0 0 3px 8px;font-size:0">&nbsp;</div>
        <div style="width:8px;height:2px;background:#fff;border-radius:2px;margin:0 0 0 8px;font-size:0">&nbsp;</div>
      </td>
      <td style="padding-left:10px;font-size:14px;font-weight:600;color:${C.ink}">EduCRM</td>
    </tr></table>
    <div style="font-size:26px;line-height:32px;font-weight:700;color:${C.ink};padding-top:22px">Підсумки за ${esc(MONTHS_UA[m - 1].toLowerCase())}</div>
    <div style="font-size:14px;color:${C.muted};padding-top:4px">1–${lastDay} ${MONTHS_GEN[m - 1]} ${y}</div>
  </td></tr>

  ${section('Нарахування вчителям', teachersBlock)}
  ${section('Шлях від запису до договору', funnelRows)}

  <!-- Факти -->
  <tr><td class="px" style="padding:24px 28px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-radius:12px"><tr>
      ${fact(avgCheck, 'в середньому за заняття')}
      ${fact(pct(funnel.contract, funnel.created), 'записів стали договорами', C.green)}
      ${fact(`${funnel.cancelled}${funnel.total ? ` <span style="font-size:13px;font-weight:600;color:${C.faint}">(${pct(funnel.cancelled, funnel.total)})</span>` : ''}`, plural(funnel.cancelled, 'запис скасовано', 'записи скасовано', 'записів скасовано'), funnel.cancelled ? C.red : C.ink)}
    </tr></table>
  </td></tr>

  <tr><td class="px" style="padding:26px 28px 26px">
    <div style="border-top:1px solid ${C.line};padding-top:16px;font-size:12px;line-height:18px;color:${C.faint}">
      Дані станом на ${esc(generatedAt)} за київським часом. Цей лист EduCRM надсилає автоматично в останній день кожного місяця.
    </div>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

// Бейдж на синьому фоні головного блоку
function deltaOnBrand(cur, prev) {
  if (prev === 0 && cur === 0) return '';
  if (prev === 0) return badge('нове', '#ffffff', 'rgba(255,255,255,.18)');
  const d = Math.round((cur - prev) / prev * 100);
  if (d === 0) return badge('як минулого місяця', '#ffffff', 'rgba(255,255,255,.18)');
  return badge(`${d > 0 ? '▲' : '▼'} ${Math.abs(d)}%`, '#ffffff', 'rgba(255,255,255,.18)');
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
    const html = renderEmail(stats, month);
    const subject = `Звіт EduCRM за ${monthLabel(month).toLowerCase()}: ${uah(stats.totals.earnings)} до виплати`;
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

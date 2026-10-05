// ============================================================
//  Розширення для робочої CRM — два окремі розширення:
//   • EduCRM — кнопка запису на картці клієнта;
//   • EduCRM Marketing — список заходу → Відкритий захід.
//  Завантаження, інструкція і перевірка встановлених версій.
//  Архіви збирає деплой (.github/workflows/pages.yml).
// ============================================================

import { html, render, on } from '../core/dom.js';
import { pageReady } from '../ui/loader.js';
import { initShell } from '../ui/shell.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { EXTENSIONS, installedExt, latestExt, compareVersions } from '../ui/ext-version.js';

const page = document.getElementById('page');
const INFO = {
  main: {
    icon: 'graduation-cap', tint: 'brand',
    lead: 'Кнопка EduCRM на картці клієнта в робочій CRM',
    features: [
      ['plus', 'Запис в один клік', "Кругла кнопка в правому нижньому куті картки клієнта відкриває «Нове заняття» з ім'ям, телефоном і посиланням на картку."],
      ['calendar', 'Видно заняття', 'Зелена крапка на кнопці — у клієнта вже є заняття. Наведіть, щоб побачити коли, і перейти в картку.'],
    ],
  },
  marketing: {
    icon: 'megaphone', tint: 'violet',
    lead: 'Список клієнтів заходу → Відкритий захід',
    features: [
      ['users', 'Перенесення списку', "У «Маркетинг → Заходи» відкрийте «Список клієнтів» — унизу з'явиться плашка «Перенести». Назва і всі клієнти заходу потрапляють у Відкритий захід."],
      ['undo', 'Безпечно', 'Перед заміною — підтвердження; після — кнопка «Повернути» попередній список.'],
    ],
  },
};

initShell({ page: 'extension', title: 'Розширення для CRM', subtitle: 'Помічники для робочої CRM (crm.itstep.org)' }).then(async () => {
  const items = await Promise.all(Object.keys(EXTENSIONS).map(async id => {
    const have = installedExt(id), latest = await latestExt(id);
    const state = !have ? 'none' : latest && compareVersions(have, latest) < 0 ? 'old' : 'ok';
    return { id, ...EXTENSIONS[id], ...INFO[id], have, latest, state };
  }));
  pageReady();
  const anyOld = items.some(x => x.state === 'old');

  const badge = x => x.state === 'ok' ? html`<span class="badge badge-success">${icon('check', 12)} Встановлено · ${x.have}</span>`
    : x.state === 'old' ? html`<span class="badge badge-warning">${icon('refresh-cw', 12)} Оновлення: ${x.have} → ${x.latest}</span>`
    : html`<span class="badge">Не встановлено</span>`;

  const step = (n, title, body) => html`<li class="xs-step"><span class="xs-num">${n}</span><div><h3>${title}</h3><div class="xs-body">${body}</div></div></li>`;

  render(page, html`
    <div class="xs-cards">
      ${items.map(x => html`
        <section class="card xs-ext xs-${x.state}">
          <div class="xs-ext-head">
            <span class="xs-ext-ico xs-tint-${x.tint}">${icon(x.icon, 22)}</span>
            <div class="xs-ext-title"><h2>${x.name}</h2><p>${x.lead}</p></div>
          </div>
          <div class="xs-ext-status">${badge(x)}</div>
          <ul class="xs-feats">
            ${x.features.map(([ic, t, d]) => html`<li>${icon(ic, 16)}<span><b>${t}.</b> ${d}</span></li>`)}
          </ul>
          <a class="btn ${x.state === 'ok' ? '' : 'btn-primary'}" href="${x.zip}" download="${x.dir}.zip">
            ${icon('download', 16)} ${x.state === 'old' ? 'Завантажити оновлення' : 'Завантажити'}${x.latest ? ` · ${x.latest}` : ''}
          </a>
        </section>`)}
    </div>

    <section class="card">
      <div class="card-head"><div><h2>${anyOld ? 'Як встановити або оновити' : 'Як встановити'}</h2><p>Однаково для обох розширень · Chrome, Edge, Brave, Opera на комп'ютері</p></div></div>
      <ol class="xs-steps">
        ${step(1, 'Завантажте і розпакуйте архів', html`Натисніть «Завантажити» на потрібному розширенні й розпакуйте архів у постійну папку (наприклад, «Документи/EduCRM-розширення»). <span class="muted">Не видаляйте цю папку після встановлення — браузер бере розширення з неї.</span>`)}
        ${step(2, 'Відкрийте сторінку розширень', html`
          Вставте в адресний рядок і натисніть Enter:
          <div class="xs-copy"><code>chrome://extensions</code><button class="btn btn-sm" data-copy="chrome://extensions">${icon('copy', 14)} Копіювати</button></div>
          <span class="muted">В Edge — <code>edge://extensions</code></span>`)}
        ${step(3, 'Увімкніть «Режим розробника»', html`Перемикач у правому верхньому куті сторінки (в Edge — ліворуч унизу).`)}
        ${step(4, 'Оновлюєте? Приберіть стару версію', html`Знайдіть розширення і натисніть <b>Видалити</b>. Або розпакуйте новий архів у ту саму папку поверх старого і натисніть ${icon('refresh-cw', 13)} <b>Оновити</b> — тоді крок 5 не потрібен.`)}
        ${step(5, 'Натисніть «Завантажити розпаковане»', html`Кнопка вгорі ліворуч. Виберіть розпаковану папку — ту, в якій лежить файл <b>manifest.json</b>.`)}
        ${step(6, 'Готово', html`Оновіть цю сторінку — біля розширення з'явиться «Встановлено». Коли вийде нова версія, EduCRM покаже підказку, а в меню біля «Розширення» з'явиться крапка.`)}
      </ol>
    </section>

    <p class="xs-foot">${icon('info', 15)} Браузери не дозволяють сайтам ставити розширення автоматично, тому встановлення — вручну, один раз.</p>`);

  on(page, 'click', '[data-copy]', async (_, btn) => {
    try { await navigator.clipboard.writeText(btn.dataset.copy); toast('Скопійовано — вставте в адресний рядок', 'success'); }
    catch { toast('Не вдалося скопіювати', 'error'); }
  });
});

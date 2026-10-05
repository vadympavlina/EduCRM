// ============================================================
//  Розширення для робочої CRM — завантаження, інструкція
//  встановлення/оновлення і перевірка встановленої версії.
//  Архів extension.zip збирає деплой (.github/workflows/pages.yml).
// ============================================================

import { html, render, on } from '../core/dom.js';
import { pageReady } from '../ui/loader.js';
import { initShell } from '../ui/shell.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { installedExt, latestExt, compareVersions } from '../ui/ext-version.js';

const ZIP = 'extension.zip';
const page = document.getElementById('page');

const shellReady = initShell({
  page: 'extension', title: 'Розширення для CRM',
  subtitle: 'Кнопка EduCRM на картці клієнта в робочій CRM',
  actions: html`<a class="btn btn-primary" href="${ZIP}" download="educrm-extension.zip">${icon('download', 16)} Завантажити</a>`,
});

await shellReady;
const have = installedExt();
const latest = await latestExt();
const state = !have ? 'none' : latest && compareVersions(have, latest) < 0 ? 'old' : 'ok';
pageReady();

const STATE = {
  none: { cls: 'info',    ico: 'puzzle',         title: 'Розширення не встановлене в цьому браузері', text: 'Завантажте архів і встановіть за інструкцією нижче — це займає хвилину.' },
  old:  { cls: 'warning', ico: 'refresh-cw',     title: `Доступне оновлення: ${have} → ${latest}`, text: 'Завантажте новий архів і замініть стару версію (кроки нижче).' },
  ok:   { cls: 'success', ico: 'check-circle',   title: `Встановлено, версія ${have}`, text: 'У вас найновіша версія. Нічого робити не потрібно.' },
}[state];

const step = (n, title, body) => html`
  <li class="xs-step">
    <span class="xs-num">${n}</span>
    <div><h3>${title}</h3><div class="xs-body">${body}</div></div>
  </li>`;

render(page, html`
  <section class="card xs-hero xs-${STATE.cls}">
    <span class="xs-hero-ico">${icon(STATE.ico, 22)}</span>
    <div class="xs-hero-text"><h2>${STATE.title}</h2><p>${STATE.text}</p></div>
    <a class="btn ${state === 'ok' ? '' : 'btn-primary'}" href="${ZIP}" download="educrm-extension.zip">${icon('download', 16)} ${state === 'old' ? 'Завантажити оновлення' : 'Завантажити'}${latest ? ` · ${latest}` : ''}</a>
  </section>

  <div class="xs-grid">
    <section class="card">
      <div class="card-head"><div><h2>${state === 'old' ? 'Як оновити' : 'Як встановити'}</h2><p>Chrome, Edge, Brave, Opera — на комп'ютері</p></div></div>
      <ol class="xs-steps">
        ${step(1, 'Завантажте і розпакуйте архів', html`Натисніть «Завантажити», відкрийте <b>educrm-extension.zip</b> і розпакуйте в постійну папку (наприклад, «Документи/EduCRM-розширення»). <span class="muted">Не видаляйте цю папку після встановлення — браузер бере розширення з неї.</span>`)}
        ${step(2, 'Відкрийте сторінку розширень', html`
          Вставте в адресний рядок і натисніть Enter:
          <div class="xs-copy"><code>chrome://extensions</code><button class="btn btn-sm" data-copy="chrome://extensions">${icon('copy', 14)} Копіювати</button></div>
          <span class="muted">В Edge — <code>edge://extensions</code></span>`)}
        ${step(3, 'Увімкніть «Режим розробника»', html`Перемикач у правому верхньому куті сторінки (в Edge — ліворуч унизу).`)}
        ${state === 'old' || state === 'ok'
          ? step(4, 'Приберіть стару версію', html`Знайдіть «EduCRM» і натисніть <b>Видалити</b>. Або, якщо ви розпакували новий архів у ту саму папку поверх старого, — просто натисніть ${icon('refresh-cw', 13)} <b>Оновити</b> на картці розширення і пропустіть крок 5.`)
          : step(4, 'Якщо стоїть старе розширення', html`Стару версію «EduCRM імпорт клієнта» видаліть кнопкою <b>Видалити</b>, щоб не було двох кнопок.`)}
        ${step(5, 'Натисніть «Завантажити розпаковане»', html`Кнопка з'явиться вгорі ліворуч. Виберіть розпаковану папку — ту, в якій лежить файл <b>manifest.json</b>.`)}
        ${step(6, 'Готово', html`Оновіть цю сторінку — тут з'явиться «Встановлено». Для зручності закріпіть іконку: ${icon('puzzle', 13)} на панелі браузера → шпилька біля «EduCRM».`)}
      </ol>
    </section>

    <aside class="xs-side">
      <section class="card card-body xs-what">
        <h2>Що вміє</h2>
        <ul>
          <li>${icon('plus', 16)}<span><b>Запис в один клік.</b> На картці клієнта в робочій CRM — кругла кнопка EduCRM у правому нижньому куті. Клік відкриває «Нове заняття» з ім'ям, телефоном і посиланням на картку.</span></li>
          <li>${icon('calendar', 16)}<span><b>Видно заняття.</b> Зелена крапка на кнопці — у клієнта вже є заняття. Наведіть, щоб побачити коли, і перейти в картку.</span></li>
          <li>${icon('phone', 16)}<span><b>Будь-який формат номера</b> і всі телефони з картки.</span></li>
        </ul>
      </section>
      <section class="card card-body xs-note">
        ${icon('info', 18)}
        <p>Браузери не дозволяють сайтам ставити розширення автоматично, тому встановлення — вручну. Коли вийде нова версія, EduCRM покаже підказку, а в меню біля «Розширення» з'явиться крапка.</p>
      </section>
    </aside>
  </div>`);

on(page, 'click', '[data-copy]', async (_, btn) => {
  try { await navigator.clipboard.writeText(btn.dataset.copy); toast('Скопійовано — вставте в адресний рядок', 'success'); }
  catch { toast('Не вдалося скопіювати', 'error'); }
});

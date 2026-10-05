// edu-bridge.js — працює на сторінках EduCRM.
// Повідомляє сайту, що розширення встановлене і якої воно версії
// (EduCRM показує підказку, коли виходить нова версія).
document.documentElement.dataset.educrmExt = chrome.runtime.getManifest().version;

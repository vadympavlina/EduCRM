// edu-bridge.js — працює на сторінках EduCRM.
// Повідомляє сайту версію розширення EduCRM Marketing (для підказки про оновлення).
document.documentElement.dataset.educrmMktExt = chrome.runtime.getManifest().version;

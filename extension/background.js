// ============================================================
//  background.js — відкриває EduCRM: у вже відкритій вкладці
//  EduCRM (якщо є) або в новій. Викликається з кнопки на сторінці CRM.
// ============================================================

const APP = 'https://vadympavlina.github.io/EduCRM/';

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'open-app' || typeof msg.url !== 'string' || !msg.url.startsWith(APP)) return;
  (async () => {
    try {
      const [tab] = await chrome.tabs.query({ url: APP + '*' });
      if (tab) {
        await chrome.tabs.update(tab.id, { url: msg.url, active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
      } else {
        await chrome.tabs.create({ url: msg.url });
      }
    } catch {
      chrome.tabs.create({ url: msg.url });
    }
  })();
});

const $ = (id) => document.getElementById(id);
chrome.storage.local.get(['api', 'token', 'batch', 'mode', 'staleDays', 'schedHours', 'site'], (v) => {
  if (v.api) $('api').value = v.api;
  if (v.token) $('token').value = v.token;
  if (v.batch) $('batch').value = v.batch;
  if (v.mode) $('mode').value = v.mode;
  if (v.staleDays) $('days').value = v.staleDays;
  if (v.site) $('site').value = v.site;
  $('sched').value = String(v.schedHours || 0);
  // v1.17.1: показать последний статус фонового сбора (popup мог быть закрыт)
  chrome.storage.local.get(['lastProgress', 'progressAt'], (pv) => {
    if (pv.lastProgress) {
      const ago = pv.progressAt ? Math.round((Date.now() - pv.progressAt) / 1000) : '?';
      $('st').textContent = pv.lastProgress + `  (${ago} с назад)`;
    }
  });
});
$('save').onclick = () => {
  chrome.storage.local.set({ api: $('api').value.trim().replace(/\/+$/, ''), token: $('token').value.trim() });
  $('st').textContent = '✅ Сохранено';
};
async function start(continuous) {
  const { api, token } = await chrome.storage.local.get(['api', 'token']);
  if (!api || !token) { $('st').textContent = '❌ Сначала заполните API URL и токен'; return; }
  const batch = Math.min(100, Math.max(1, parseInt($('batch').value, 10) || 20));
  const mode = $('mode').value;
  const staleDays = Math.min(90, Math.max(1, parseInt($('days').value, 10) || 7));
  const site = $('site').value;
  chrome.storage.local.set({ batch, mode, staleDays, site });
  chrome.runtime.sendMessage({ type: 'start', api, token, batch, mode, staleDays, continuous, site });
  $('st').textContent = continuous ? '⏳ Непрерывный сбор запущен…' : '⏳ Сбор пачки запущен…';
}
$('go').onclick = () => start(false);
$('goall').onclick = () => start(true);
$('stop').onclick = () => chrome.runtime.sendMessage({ type: 'stop' });
$('secGo').onclick = async () => {
  const { api, token } = await chrome.storage.local.get(['api', 'token']);
  if (!api || !token) { $('st').textContent = '❌ Сначала заполните API URL и токен'; return; }
  const url = $('secUrl').value.trim();
  if (!/^https?:\/\//i.test(url)) { $('st').textContent = '❌ Вставьте полный URL раздела'; return; }
  chrome.runtime.sendMessage({ type: 'section', api, token, url });
  $('st').textContent = '⏳ Парсинг раздела запущен…';
};
$('secFileGo').onclick = async () => {
  const { api, token } = await chrome.storage.local.get(['api', 'token']);
  if (!api || !token) { $('st').textContent = '❌ Сначала заполните API URL и токен'; return; }
  const f = $('secFile').files && $('secFile').files[0];
  if (!f) { $('st').textContent = '❌ Выберите .txt файл со списком разделов'; return; }
  const text = await f.text();
  const urls = text.split(/\r?\n/).map(l => l.trim()).filter(l => /^https?:\/\//i.test(l) && !l.startsWith('#'));
  const uniq = [...new Set(urls)];
  if (!uniq.length) { $('st').textContent = '❌ В файле нет URL (один на строку, # — комментарий)'; return; }
  chrome.runtime.sendMessage({ type: 'sections', api, token, urls: uniq });
  $('st').textContent = `⏳ Очередь разделов запущена: ${uniq.length} шт.…`;
};
$('brGo').onclick = async () => {
  const { api, token } = await chrome.storage.local.get(['api', 'token']);
  if (!api || !token) { $('st').textContent = '❌ Сначала заполните API URL и токен'; return; }
  chrome.runtime.sendMessage({ type: 'brands', api, token });
  $('st').textContent = '⏳ Собираю справочник брендов…';
};
$('schedSave').onclick = () => {
  const hours = parseInt($('sched').value, 10) || 0;
  chrome.runtime.sendMessage({ type: 'schedule', hours });
  $('st').textContent = hours > 0 ? `✅ Автозапуск: каждые ${hours} ч (пока открыт Chrome)` : '✅ Автозапуск выключен';
};
chrome.runtime.onMessage.addListener((m) => {
  if (m.type === 'progress') {
    $('st').textContent = m.text + '\n' + $('st').textContent.split('\n').slice(0, 6).join('\n');
  }
});

const $ = (id) => document.getElementById(id);
chrome.storage.local.get(['api', 'token', 'batch', 'mode', 'staleDays', 'schedHours'], (v) => {
  if (v.api) $('api').value = v.api;
  if (v.token) $('token').value = v.token;
  if (v.batch) $('batch').value = v.batch;
  if (v.mode) $('mode').value = v.mode;
  if (v.staleDays) $('days').value = v.staleDays;
  $('sched').value = String(v.schedHours || 0);
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
  chrome.storage.local.set({ batch, mode, staleDays });
  chrome.runtime.sendMessage({ type: 'start', api, token, batch, mode, staleDays, continuous });
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

const $ = (id) => document.getElementById(id);
chrome.storage.local.get(['api', 'token'], (v) => {
  if (v.api) $('api').value = v.api;
  if (v.token) $('token').value = v.token;
});
$('save').onclick = () => {
  chrome.storage.local.set({ api: $('api').value.trim().replace(/\/+$/, ''), token: $('token').value.trim() });
  $('st').textContent = '✅ Сохранено';
};
$('go').onclick = async () => {
  const { api, token } = await chrome.storage.local.get(['api', 'token']);
  if (!api || !token) { $('st').textContent = '❌ Сначала заполните API URL и токен'; return; }
  chrome.runtime.sendMessage({ type: 'start', api, token });
  $('st').textContent = '⏳ Сбор запущен…';
};
$('stop').onclick = () => chrome.runtime.sendMessage({ type: 'stop' });
chrome.runtime.onMessage.addListener((m) => {
  if (m.type === 'progress') $('st').textContent = m.text;
});

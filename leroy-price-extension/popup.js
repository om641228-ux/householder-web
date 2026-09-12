const $ = (id) => document.getElementById(id);
chrome.storage.local.get(['api', 'token', 'batch', 'mode', 'staleDays', 'schedHours', 'site', 'sites'], (v) => {
  if (v.api) $('api').value = v.api;
  if (v.token) $('token').value = v.token;
  if (v.batch) $('batch').value = v.batch;
  if (v.mode) $('mode').value = v.mode;
  if (v.staleDays) $('days').value = v.staleDays;
  const savedSites = Array.isArray(v.sites) ? v.sites : (v.site ? [v.site] : []);
  document.querySelectorAll('.sitecb').forEach(cb => { cb.checked = savedSites.indexOf(cb.value) >= 0; });
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
  // v1.27.6: мультивыбор магазинов галками — каждый магазин = своя параллельная очередь; ни одной = все
  const sites = [...document.querySelectorAll('.sitecb')].filter(cb => cb.checked).map(cb => cb.value);
  chrome.storage.local.set({ batch, mode, staleDays, sites, site: sites.length === 1 ? sites[0] : '' });
  const launch = sites.length ? sites : [''];
  for (const site of launch) chrome.runtime.sendMessage({ type: 'start', api, token, batch, mode, staleDays, continuous, site });
  const names = sites.length ? String(sites.length) + ' магазина(ов)' : 'ВСЕ магазины';
  $('st').textContent = (continuous ? '⏳ Непрерывный сбор запущен: ' : '⏳ Сбор пачки запущен: ') + names + '…';
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
// v1.20.1: ЖИВОЙ статус — панель опрашивает фон каждые 2 с, видно что сборщик работает даже если сообщение потерялось
const fmtT = (ts) => new Date(ts).toLocaleTimeString('ru-RU');
setInterval(async () => {
  try {
    const r = await chrome.runtime.sendMessage({ type: 'status' });
    if (!r || !r.ok) return;
    // v1.23.0: какие очереди активны прямо сейчас
    const tags = (r.active || []).map(k => k.replace(/^q:/, '').replace(/^(www\.|canarias\.|tienda\.)/, '').replace(/\..*$/, '').toUpperCase()).filter(Boolean);
    const ind = r.running ? ('▶ ИДЁТ СБОР' + (tags.length ? ': ' + tags.join(' + ') : '')) : '■ остановлен';
    if ($('runind')) $('runind').textContent = ind;
    if ($('runind')) $('runind').style.color = r.running ? '#1e7e34' : '#8e8e93';
    // v1.23.0: последняя активность ПО КАЖДОМУ магазину + абсолютное время + секунды назад
    if ($('queues') && r.lastBySite) {
      const rows = Object.entries(r.lastBySite).sort((a, b) => b[1].at - a[1].at).slice(0, 5).map(([tag, e]) => {
        const ago = Math.round((Date.now() - e.at) / 1000);
        const live = tags.includes(tag);
        const stale = live && ago > 120;
        return `<div style="margin-top:2px;color:${stale ? '#c41e3a' : live ? '#1e7e34' : '#8e8e93'}">${live ? '▶' : '·'} <b>${tag}</b> — ${String(e.text).replace(/</g, '&lt;').slice(0, 120)}<br><span style="color:#8e8e93">обновлено ${fmtT(e.at)} (${ago} с назад)${stale ? ' — ⚠️ НЕТ ОБНОВЛЕНИЙ 2+ МИН: нажмите ■ Остановить и запустите снова' : ''}</span></div>`;
      });
      $('queues').innerHTML = rows.join('') || '<div style="color:#8e8e93">активности пока не было</div>';
    }
    if (r.last) {
      const ago = r.progressAt ? Math.round((Date.now() - r.progressAt) / 1000) : '?';
      const cur = $('st').textContent || '';
      const line = r.last + (r.running ? `  (обновлено ${fmtT(r.progressAt)}, ${ago} с назад)` : `  (${fmtT(r.progressAt)})`);
      if (!cur.startsWith(r.last)) $('st').textContent = line + '\n' + cur.split('\n').slice(0, 6).join('\n');
    }
  } catch (e) {}
}, 2000);

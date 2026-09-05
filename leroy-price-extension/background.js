let running = false, stopped = false;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const progress = (text) => chrome.runtime.sendMessage({ type: 'progress', text }).catch(() => {});

// извлечение JSON-LD Product на странице товара
function extractOnPage() {
  const out = { title: '', price: null, currency: '', image: '' };
  for (const sc of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const j = JSON.parse(sc.textContent);
      const flat = Array.isArray(j) ? j : [j];
      for (const it of flat) {
        const arr = [it, ...((it && it['@graph']) || [])];
        for (const x of arr) {
          if (x && /Product/i.test(String(x['@type'] || ''))) {
            out.title = String(x.name || '');
            out.article = String(x.sku || x.mpn || '').trim(); // v1.3: каталожный номер из JSON-LD
            const off = Array.isArray(x.offers) ? x.offers[0] : x.offers;
            if (off) {
              out.price = parseFloat(String(off.price || off.lowPrice || '').replace(',', '.')) || null;
              out.currency = String(off.priceCurrency || '');
            }
            out.image = Array.isArray(x.image) ? x.image[0] : String(x.image || '');
          }
        }
      }
    } catch (e) { /* пропускаем битый блок */ }
  }
  if (!out.price) {
    const mp = document.querySelector('meta[property="product:price:amount"],meta[name="og:price:amount"]');
    if (mp) out.price = parseFloat(mp.content.replace(',', '.')) || null;
  }
  // v1.2: распознаём антибот-страницу DataDome, чтобы не считать её «нет цены»
  out.captcha = !!document.querySelector('iframe[src*="captcha"], #captcha-delivery, .captcha-delivery')
    || /captcha|are you a robot|vérif/i.test(String(document.title || ''));
  // v1.3: «Ref. 82088689» из текста страницы, если JSON-LD sku не дал номера
  if (!/^\d{4,}$/.test(out.article || '')) {
    const m = String(document.body ? document.body.innerText.slice(0, 20000) : '').match(/Ref\.?\s*[:#]?\s*(\d{6,})/i);
    if (m) out.article = m[1];
  }
  return out;
}

// v124: список задач — товары без цены (pending) или с устаревшей ценой (stale)
async function fetchQueue(api, token, lim, mode, staleDays) {
  const path = mode === 'stale'
    ? `/api/parse/catalog/stale-prices?limit=${lim}&days=${staleDays || 7}`
    : `/api/parse/catalog/pending-prices?limit=${lim}`;
  const r = await fetch(`${api}${path}&token=${encodeURIComponent(token)}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return { items: j.products || [], total: j.total };
}

async function collectOne(api, token, p) {
  let tab = null;
  let saved = false, chg = null, failReason = null;
  try {
    tab = await chrome.tabs.create({ url: p.url, active: false });
    try { await chrome.tabs.update(tab.id, { autoDiscardable: false }); } catch (e) {} // не даём Chrome выгрузить вкладку
    await new Promise((res) => {
      const to = setTimeout(res, 18000);
      chrome.tabs.onUpdated.addListener(function f(id, ch) {
        if (id === tab.id && ch.status === 'complete') { clearTimeout(to); chrome.tabs.onUpdated.removeListener(f); res(); }
      });
    });
    await sleep(1000); // даём дорендериться JSON-LD/цене
    const [inj] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractOnPage });
    const d = (inj && inj.result) || {};
    if (d.price != null) {
      const rr = await fetch(`${api}/api/parse/ext-price?token=${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: p.url, price: d.price, currency: d.currency, title: d.title, image: d.image, article: d.article || undefined })
      });
      if (rr.ok) { saved = true; const jj = await rr.json().catch(() => ({})); chg = jj.changed || null; }
    } else {
      failReason = d.captcha ? 'captcha' : 'no-price';
    }
  } catch (e) { failReason = 'load-error'; }
  // v1.2: сообщаем серверу о неудаче — товар получит +1 попытку и не будет крутиться вечно
  if (failReason) {
    try {
      await fetch(`${api}/api/parse/ext-price?token=${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: p.url, fail: true, reason: failReason })
      });
    } catch (e) {}
  }
  if (tab) try { await chrome.tabs.remove(tab.id); } catch (e) {}
  return { saved, chg, failReason };
}

// v124: continuous = крутить пачки до конца очереди (режим «Собрать ВСЕ»)
async function run(api, token, batch, mode, staleDays, continuous) {
  if (running) return;
  running = true; stopped = false;
  let totalDone = 0, totalOk = 0, totalChanges = 0, rounds = 0;
  try {
    for (;;) {
      if (stopped) break;
      const lim = Math.min(100, Math.max(1, batch || 20));
      const { items, total } = await fetchQueue(api, token, lim, mode, staleDays);
      if (!items.length) {
        progress(rounds ? `✅ ВСЁ собрано: обработано ${totalDone}, цен ${totalOk}, изменений ${totalChanges}` : (mode === 'stale' ? '✅ Устаревших цен нет' : '✅ Все товары с ценами — очередь пуста'));
        break;
      }
      rounds++;
      let done = 0, captchaStreak = 0, fails = 0;
      for (const p of items) {
        if (stopped) { progress(`⏹ Остановлено: всего обработано ${totalDone}, цен ${totalOk}`); break; }
        progress(`⏳ ${totalDone + 1}${total != null && !continuous ? '/' + total : ''} (пачка ${rounds}, ок ${totalOk}, изм ${totalChanges}, неудач ${fails}): ${p.name || p.url}`);
        const r0 = await collectOne(api, token, p);
        if (r0.saved) totalOk++;
        if (r0.chg) { totalChanges++; progress(`${r0.chg.to > r0.chg.from ? '📈' : '📉'} ${p.name || p.url}: ${r0.chg.from} → ${r0.chg.to}`); }
        if (r0.failReason) {
          fails++;
          captchaStreak = r0.failReason === 'captcha' ? captchaStreak + 1 : 0;
          if (captchaStreak >= 3) { progress('🛑 DataDome показал капчу 3 раза подряд — сбор остановлен. Откройте leroymerlin.es в обычной вкладке, пройдите проверку и запустите снова через 10–15 минут.'); stopped = true; break; }
        }
        done++; totalDone++;
        await sleep(2000 + Math.random() * 1500); // вежливая пауза 2–3,5 с
      }
      if (stopped || !continuous) break;
      await sleep(3000 + Math.random() * 2000); // пауза между пачками
    }
    if (!stopped && rounds) progress(`✅ Готово: обработано ${totalDone}, цен сохранено ${totalOk}, изменений цен ${totalChanges}${continuous ? ' — очередь исчерпана' : '. Можно запустить ещё раз.'}`);
  } catch (e) { progress('❌ ' + e.message); }
  running = false;
}

// v1.3: извлечение карточек товаров со страницы раздела/списка
function extractLinksOnPage() {
  const out = [];
  const seen = new Set();
  for (const a of document.querySelectorAll('a[href*=".html"]')) {
    const href = a.href.split('#')[0];
    if (!/-\d{5,}\.html?$/i.test(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    const img = a.querySelector('img');
    let name = String((img && img.alt) || a.getAttribute('aria-label') || a.textContent || '').replace(/\s+/g, ' ').trim();
    if (name.length > 300) name = name.slice(0, 300);
    out.push({ url: href, name, image: img ? String(img.currentSrc || img.src || '') : '' });
  }
  return out;
}

// v1.3: парсинг раздела до конца — листаем ?p=N, пока не кончатся новые товары
async function runSection(api, token, startUrl) {
  if (running) return;
  running = true; stopped = false;
  const known = new Set();
  let totalSent = 0;
  try {
    for (let page = 1; page <= 100; page++) {
      if (stopped) { progress(`⏹ Раздел остановлен: отправлено ${totalSent} товаров`); break; }
      const sep = startUrl.includes('?') ? '&' : '?';
      const pageUrl = page === 1 ? startUrl : `${startUrl}${sep}p=${page}`;
      progress(`⏳ Раздел, стр. ${page}: ${pageUrl} (уже собрано ${totalSent})`);
      let tab = null, links = [];
      try {
        tab = await chrome.tabs.create({ url: pageUrl, active: false });
        try { await chrome.tabs.update(tab.id, { autoDiscardable: false }); } catch (e) {}
        await new Promise((res) => {
          const to = setTimeout(res, 18000);
          chrome.tabs.onUpdated.addListener(function f(id, ch) {
            if (id === tab.id && ch.status === 'complete') { clearTimeout(to); chrome.tabs.onUpdated.removeListener(f); res(); }
          });
        });
        await sleep(1200);
        const [inj] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractLinksOnPage });
        links = (inj && inj.result) || [];
      } catch (e) { progress('⚠️ Стр. ' + page + ': не загрузилась — ' + e.message); }
      if (tab) try { await chrome.tabs.remove(tab.id); } catch (e) {}
      const fresh = links.filter(l => !known.has(l.url));
      if (!fresh.length) { progress(`✅ Раздел собран до конца: ${page - 1} стр., товаров отправлено ${totalSent}`); break; }
      fresh.forEach(l => known.add(l.url));
      for (let i = 0; i < fresh.length; i += 200) {
        const rr = await fetch(`${api}/api/parse/ext-products?token=${encodeURIComponent(token)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: fresh.slice(i, i + 200) })
        });
        if (rr.ok) { const jj = await rr.json().catch(() => ({})); totalSent += jj.upserted || 0; }
      }
      await sleep(2500 + Math.random() * 1500); // вежливая пауза между страницами
    }
  } catch (e) { progress('❌ ' + e.message); }
  running = false;
}

chrome.runtime.onMessage.addListener((m) => {
  if (m.type === 'section' && !running) runSection(m.api, m.token, m.url);
  if (m.type === 'start' && !running) run(m.api, m.token, m.batch, m.mode, m.staleDays, !!m.continuous);
  if (m.type === 'stop') stopped = true;
  if (m.type === 'schedule') { // v124: планировщик — часы между запусками (0 = выкл)
    chrome.storage.local.set({ schedHours: m.hours });
    chrome.alarms.clear('lm-collect');
    if (m.hours > 0) chrome.alarms.create('lm-collect', { periodInMinutes: m.hours * 60 });
  }
});

// v124: автозапуск по расписанию (работает, пока открыт Chrome)
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'lm-collect' || running) return;
  const v = await chrome.storage.local.get(['api', 'token', 'batch', 'mode', 'staleDays', 'schedHours']);
  if (!v.api || !v.token || !v.schedHours) return;
  run(v.api, v.token, v.batch || 20, v.mode || 'pending', v.staleDays || 7, false);
});

// при старте браузера — восстановить будильник, если был включён
chrome.runtime.onStartup.addListener(async () => {
  const v = await chrome.storage.local.get(['schedHours']);
  if (v.schedHours > 0) chrome.alarms.create('lm-collect', { periodInMinutes: v.schedHours * 60 });
});

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
  return out;
}

async function run(api, token) {
  running = true; stopped = false;
  try {
    const r = await fetch(`${api}/api/parse/catalog/pending-prices?limit=20&token=${encodeURIComponent(token)}`);
    const j = await r.json();
    const items = j.products || [];
    if (!items.length) { progress('✅ Все товары с ценами — очередь пуста'); running = false; return; }
    let done = 0, ok = 0;
    for (const p of items) {
      if (stopped) { progress(`⏹ Остановлено: ${done}/${items.length}`); break; }
      progress(`⏳ ${done + 1}/${items.length}: ${p.name || p.url}`);
      let tab = null;
      try {
        tab = await chrome.tabs.create({ url: p.url, active: false });
        await new Promise((res) => {
          const to = setTimeout(res, 12000);
          chrome.tabs.onUpdated.addListener(function f(id, ch) {
            if (id === tab.id && ch.status === 'complete') { clearTimeout(to); chrome.tabs.onUpdated.removeListener(f); res(); }
          });
        });
        const [inj] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractOnPage });
        const d = (inj && inj.result) || {};
        if (d.price != null) {
          const rr = await fetch(`${api}/api/parse/ext-price?token=${encodeURIComponent(token)}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: p.url, price: d.price, currency: d.currency, title: d.title, image: d.image })
          });
          if (rr.ok) ok++;
        }
      } catch (e) { /* страница не загрузилась — пропускаем */ }
      if (tab) try { await chrome.tabs.remove(tab.id); } catch (e) {}
      done++;
      await sleep(2000 + Math.random() * 1500); // вежливая пауза 2–3,5 с
    }
    if (!stopped) progress(`✅ Готово: ${done} обработано, цен сохранено ${ok}. Можно запустить ещё раз.`);
  } catch (e) { progress('❌ ' + e.message); }
  running = false;
}

chrome.runtime.onMessage.addListener((m) => {
  if (m.type === 'start' && !running) run(m.api, m.token);
  if (m.type === 'stop') stopped = true;
});

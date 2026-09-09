let running = false, stopped = false;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let lastProgress = '', progressAt = 0; // v1.15/v1.16: последний прогресс + метка времени — для опроса из приложения и самосброса зависания
// v1.19.0: клик по иконке открывает БОКОВУЮ ПАНЕЛЬ (как у Data Scraper), а не всплывающий попап
try { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }); } catch (e) {}
chrome.runtime.onInstalled.addListener(() => { try { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }); } catch (e) {} });

const progress = (text) => {
  lastProgress = text; progressAt = Date.now();
  try { chrome.storage.local.set({ lastProgress, progressAt }); } catch (e) {}
  try { chrome.action.setBadgeText({ text: running ? '●' : '' }); chrome.action.setBadgeBackgroundColor({ color: '#0071e3' }); } catch (e) {}
  chrome.runtime.sendMessage({ type: 'progress', text }).catch(() => {});
};
const isStuck = () => running && progressAt && (Date.now() - progressAt > 120000); // v1.16: 2 мин без прогресса = завис

// извлечение JSON-LD Product на странице товара
function extractOnPage() {
  // v1.12: визуальный разбор блока цены LM — текущая (красная крупная) / зачёркнутая / скидка (%, €)
  const __num = (s) => { // «2.999»→2999, «10,99»→10.99, «1.234,56»→1234.56
    s = String(s).replace(/[\s\u00a0]/g, '');
    if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(',', '.');
    const n = parseFloat(s);
    return (isFinite(n) && n > 0 && n < 100000) ? n : null;
  };
  const __struck = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (e.tagName === 'DEL' || e.tagName === 'S' || e.tagName === 'STRIKE') return true;
      const cn = String(typeof e.className === 'string' ? e.className : '');
      if (/tachad|strike|line-through|old[-_ ]?price|antes|was[-_ ]?price|previous|regular[-_ ]?price|original[-_ ]?price/i.test(cn)) return true;
      try { const td = (getComputedStyle(e).textDecorationLine || '') + ' ' + (getComputedStyle(e).textDecoration || ''); if (/line-through/i.test(td)) return true; } catch (err) {}
    }
    return false;
  };
  const __visualPrice = (root) => {
    const res = { price: null, price_original: null, discount_pct: null, discount_abs: null };
    if (!root || !root.querySelectorAll) return res;
    let bestFs = -1;
    for (const el of root.querySelectorAll('span,div,p,strong,b,em,s,del,strike,sup,h2,h3,h4')) {
      if (el.childElementCount > 2) continue;
      let t = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 40) continue;
      if (t.indexOf('\u20ac') < 0) { // цена разбита: «2.999» + <sup>€</sup>
        const nx = el.nextElementSibling, pv = el.previousElementSibling;
        if (/^\d{1,3}([ .]\d{3})*(,\d{1,2})?$/.test(t) && nx && /^\s*\u20ac\s*$/.test(String(nx.textContent || ''))) t = t + ' \u20ac';
      }
      let m = t.match(/^[\-\u2212\u2013]\s*(\d+(?:[.,]\d+)?)\s*%/); // бейдж «-59 %»
      if (m) { const v = parseFloat(m[1].replace(',', '.')); if (v > 0 && v < 100) res.discount_pct = v; continue; }
      m = t.match(/^[\-\u2212\u2013]\s*([\d.,\s\u00a0]+?)\s*\u20ac/); // бейдж «-1.991 €»
      if (m) { const v = __num(m[1]); if (v != null) res.discount_abs = v; continue; }
      if (t.indexOf('\u20ac') < 0) continue;
      if (/\u20ac\s*\/|\/(kg|m\u00b2|m2|l|ud|unidad)s?\b/i.test(t)) continue; // цена за единицу
      const pm = t.match(/(\d{1,3}(?:[ .\u00a0]\d{3})+(?:,\d{1,2})?|\d{1,6}[.,]\d{2}|\d{1,6})(?=\s*\u20ac)/);
      if (!pm) continue;
      const n = __num(pm[1]);
      if (n == null) continue;
      if (__struck(el)) { if (res.price_original == null || n > res.price_original) res.price_original = n; }
      else {
        let fs = 10;
        try { fs = parseFloat(getComputedStyle(el).fontSize) || 10; } catch (err) {}
        if (fs > bestFs || (fs === bestFs && res.price == null)) { bestFs = fs; res.price = n; }
      }
    }
    if (res.price != null && res.price_original != null && res.price_original > res.price) {
      if (res.discount_abs == null) res.discount_abs = Math.round((res.price_original - res.price) * 100) / 100;
      if (res.discount_pct == null) res.discount_pct = Math.round((res.price_original - res.price) / res.price_original * 1000) / 10;
    } else if (res.price != null && res.price_original == null && res.discount_abs != null) {
      res.price_original = Math.round((res.price + res.discount_abs) * 100) / 100;
      if (res.discount_pct == null) res.discount_pct = Math.round(res.discount_abs / res.price_original * 1000) / 10;
    } else if (res.price != null && res.price_original == null && res.discount_pct != null) {
      res.price_original = Math.round(res.price / (1 - res.discount_pct / 100) * 100) / 100;
      res.discount_abs = Math.round((res.price_original - res.price) * 100) / 100;
    }
    if (res.price_original != null && res.price != null && res.price_original <= res.price) { res.price_original = null; res.discount_pct = null; res.discount_abs = null; }
    return res;
  };
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
            out.mpn = String(x.mpn || '').trim(); // v1.6: оригинальный номер производителя
            out.brand = String((x.brand && (x.brand.name || x.brand)) || '').trim(); // v1.6: производитель
            const off = Array.isArray(x.offers) ? x.offers[0] : x.offers;
            if (off) {
              out.price = parseFloat(String(off.price || off.lowPrice || '').replace(',', '.')) || null;
              out.currency = String(off.priceCurrency || '');
            }
            out.image = Array.isArray(x.image) ? x.image[0] : String(x.image || '');
            if (!out.mpn && x.gtin13) out.gtin = String(x.gtin13); // v1.18: штрихкод как запасной вариант
          }
        }
      }
    } catch (e) { /* пропускаем битый блок */ }
  }
  // v1.18: ФОТО — запасные источники (Worten: в JSON-LD фото может не быть)
  if (!out.image) {
    const og = document.querySelector('meta[property="og:image"], meta[name="twitter:image"]');
    if (og && og.content) out.image = og.content;
  }
  if (!out.image) { // самое большое фото в галерее товара
    let best = '', bestW = 0;
    for (const im of document.querySelectorAll('img')) {
      const w = im.naturalWidth || im.width || 0;
      const src = im.currentSrc || im.src || '';
      if (w > bestW && src && !/logo|icon|sprite|svg/i.test(src)) { bestW = w; best = src; }
    }
    if (best) out.image = best;
  }
  if (out.image && /^\//.test(out.image)) out.image = location.origin + out.image; // относительный → абсолютный
  // v1.18: MPN — микроразметка или текст «MPN: …» / «Ref. …» на странице
  if (!out.mpn) {
    const el = document.querySelector('[itemprop="mpn"], [class*="mpn" i], [class*="referencia" i]');
    if (el) {
      const v = String(el.getAttribute('content') || el.textContent || '').replace(/^(MPN|Ref\.?|Referencia)\s*[:.]?\s*/i, '').trim();
      if (/\d/.test(v) && v.length >= 4 && v.length <= 32) out.mpn = v;
    }
  }
  if (!out.mpn) {
    // v1.18.1: строгие границы слов («Ref» ≠ «Refresca» из меню!) + в номере обязательна цифра
    const m = String(document.body ? document.body.innerText.slice(0, 30000) : '')
      .match(/(?:\bMPN\b|\bRef(?:erencia)?\b(?!\w)|\bModelo\b(?!\w)|N[ºo°]\s*de\s*art[íi]culo)\s*[:.\-]?\s*((?=[\w.\-\/]*\d)[A-Z0-9][\w.\-\/]{3,30})/i);
    if (m) out.mpn = m[1];
  }
  // v1.18.3: № производителя = поле «Modelo» из характеристик (Worten); EAN/gtin НЕ используем
  if (!out.mpn) {
    // 1) DOM: ячейка с точным текстом «Modelo» → значение из соседней ячейки/блока
    for (const el of document.querySelectorAll('th,td,dt,span,div,li,p')) {
      const t = String(el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/^Modelo[\sⓘℹ]*$/i.test(t)) continue; // v1.18.6: только точное «Modelo» (+иконка); «Modelo compatible» — заголовок раздела, НЕ брать
      let v = '';
      const sib = el.nextElementSibling;
      if (sib) v = String(sib.textContent || '').trim();
      if (!v && el.parentElement) {
        const cand = el.parentElement.querySelector('dd, td:last-child, [class*="value" i], [class*="valor" i]');
        if (cand && cand !== el) v = String(cand.textContent || '').trim();
      }
      v = v.replace(/\s+/g, ' ').trim();
      if (v && v.length >= 2 && v.length <= 60 && !/^Modelo$/i.test(v)) { out.mpn = v; break; }
    }
    // 1б) v1.18.5: характеристики могут лежать во встроенном JSON (__NEXT_DATA__ и т.п.)
    if (!out.mpn) {
      for (const sc of document.querySelectorAll('script[type="application/json"], script#__NEXT_DATA__, script[type="application/ld+json"]')) {
        const tx = String(sc.textContent || '');
        if (tx.indexOf('Modelo') < 0) continue;
        const jm = tx.match(/"Modelo"[^}]{0,200}?"value"\s*:\s*"([^"\\]{2,60})"/)
                || tx.match(/"value"\s*:\s*"([^"\\]{2,60})"[^}]{0,200}?"Modelo"/)
                || tx.match(/"Modelo"\s*:\s*"([^"\\]{2,60})"/);
        if (jm && jm[1] && !/^Modelo$/i.test(jm[1])) { out.mpn = jm[1]; break; }
      }
    }
    // 2) запасной regex по тексту (значение на следующей строке или через двоеточие)
    if (!out.mpn) {
      const bt = String(document.body ? document.body.innerText.slice(0, 40000) : '');
      const mm = bt.match(/(?:^|\n)Modelo[ \t]*(?:\n[ \t]*|:)[ \t]*([^\n]{2,60})/);
      if (mm) out.mpn = mm[1].trim();
    }
  }
  if (!out.price) {
    const mp = document.querySelector('meta[property="product:price:amount"],meta[name="og:price:amount"]');
    if (mp) out.price = parseFloat(mp.content.replace(',', '.')) || null;
  }
  // v1.12: визуальный блок цены — главный источник (JSON-LD бывает без скидки/устаревшим)
  try {
    const vp = __visualPrice(document.body || document.documentElement);
    if (vp.price != null) { out.price = vp.price; out.currency = out.currency || 'EUR'; }
    if (vp.price_original != null) out.price_original = vp.price_original;
    if (vp.discount_pct != null) out.discount_pct = vp.discount_pct;
    if (vp.discount_abs != null) out.discount_abs = vp.discount_abs;
  } catch (e) {}
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
async function fetchQueue(api, token, lim, mode, staleDays, site) {
  const sq = site ? `&site=${encodeURIComponent(site)}` : '';
  const path = mode === 'stale'
    ? `/api/parse/catalog/stale-prices?limit=${lim}&days=${staleDays || 7}${sq}`
    : `/api/parse/catalog/pending-prices?limit=${lim}${sq}`;
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
    // v1.11: «пока нет цены и фото — не идём дальше»: до 3 попыток с ожиданием и прокруткой
    let d = {};
    for (let att = 1; att <= 3; att++) {
      await sleep(att === 1 ? 1000 : 2500); // даём дорендериться JSON-LD/цене/фото
      if (att > 1) {
        try { await Promise.race([chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { window.scrollTo(0, document.body.scrollHeight / 2); window.scrollTo(0, 0); } }), sleep(5000)]); } catch (e) {}
        await sleep(1200);
      }
      try {
        const [inj] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractOnPage });
        const nd = (inj && inj.result) || {};
        d = { ...d, ...Object.fromEntries(Object.entries(nd).filter(([, v]) => v != null && v !== '')) };
      } catch (e) {}
      if (d.price != null && d.image && (d.mpn || att >= 2)) break; // v1.18.4: ждём ещё и MPN (Worten рендерит характеристики позже)
      if (d.captcha) break;                  // капчу ретраить бессмысленно
    }
    // v1.18.5: характеристики Worten — в модалке «Características»: открываем её, ЖДЁМ таблицу и читаем
    if (d.mpn == null && /worten\./i.test(p.url)) {
      try {
        const clickCar = () => {
          const els = [...document.querySelectorAll('button, a, [role="button"], [class*="tab" i], [class*="characteristic" i]')];
          const cand = els.filter(e => /caracter[íi]sticas/i.test(String(e.textContent || '')));
          const b = cand.find(e => e.offsetWidth > 0 && e.offsetHeight > 0) || cand[0];
          if (b) { b.scrollIntoView({ block: 'center' }); ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t => b.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }))); return true; }
          return false;
        };
        const hasModelo = () => !!document.querySelector('td.table-specifications__evenodd') || /\bModelo\b/i.test(String(document.body ? document.body.innerText : ''));
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: clickCar });
        for (let w = 0; w < 8; w++) { // до ~8 сек: ждём появления таблицы характеристик
          await sleep(1000);
          const [chk] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: hasModelo });
          const [inj2] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractOnPage });
          const nd2 = (inj2 && inj2.result) || {};
          d = { ...d, ...Object.fromEntries(Object.entries(nd2).filter(([k, v]) => v != null && v !== '' && (d[k] == null || d[k] === ''))) };
          if (d.mpn || (chk && chk.result)) break;
          if (w === 2) await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: clickCar }); // повторный клик
        }
      } catch (e) {}
    }
    if (d.price != null) {
      const rr = await fetch(`${api}/api/parse/ext-price?token=${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: p.url, price: d.price, currency: d.currency, title: d.title, image: d.image, article: d.article || undefined, brand: d.brand || undefined, mpn: d.mpn || undefined, price_original: d.price_original, discount_pct: d.discount_pct, discount_abs: d.discount_abs })
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
async function run(api, token, batch, mode, staleDays, continuous, site) {
  if (running) return;
  running = true; stopped = false;
  let totalDone = 0, totalOk = 0, totalChanges = 0, rounds = 0;
  try {
    for (;;) {
      if (stopped) break;
      const lim = Math.min(100, Math.max(1, batch || 20));
      const { items, total } = await fetchQueue(api, token, lim, mode, staleDays, site);
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
  try { chrome.action.setBadgeText({ text: '' }); } catch (e2) {}
}

// v1.3: извлечение карточек товаров со страницы раздела/списка
function extractLinksOnPage() {
  // v1.12: визуальный разбор блока цены LM — текущая (красная крупная) / зачёркнутая / скидка (%, €)
  const __num = (s) => { // «2.999»→2999, «10,99»→10.99, «1.234,56»→1234.56
    s = String(s).replace(/[\s\u00a0]/g, '');
    if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(',', '.');
    const n = parseFloat(s);
    return (isFinite(n) && n > 0 && n < 100000) ? n : null;
  };
  const __struck = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (e.tagName === 'DEL' || e.tagName === 'S' || e.tagName === 'STRIKE') return true;
      const cn = String(typeof e.className === 'string' ? e.className : '');
      if (/tachad|strike|line-through|old[-_ ]?price|antes|was[-_ ]?price|previous|regular[-_ ]?price|original[-_ ]?price/i.test(cn)) return true;
      try { const td = (getComputedStyle(e).textDecorationLine || '') + ' ' + (getComputedStyle(e).textDecoration || ''); if (/line-through/i.test(td)) return true; } catch (err) {}
    }
    return false;
  };
  const __visualPrice = (root) => {
    const res = { price: null, price_original: null, discount_pct: null, discount_abs: null };
    if (!root || !root.querySelectorAll) return res;
    let bestFs = -1;
    for (const el of root.querySelectorAll('span,div,p,strong,b,em,s,del,strike,sup,h2,h3,h4')) {
      if (el.childElementCount > 2) continue;
      let t = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 40) continue;
      if (t.indexOf('\u20ac') < 0) { // цена разбита: «2.999» + <sup>€</sup>
        const nx = el.nextElementSibling, pv = el.previousElementSibling;
        if (/^\d{1,3}([ .]\d{3})*(,\d{1,2})?$/.test(t) && nx && /^\s*\u20ac\s*$/.test(String(nx.textContent || ''))) t = t + ' \u20ac';
      }
      let m = t.match(/^[\-\u2212\u2013]\s*(\d+(?:[.,]\d+)?)\s*%/); // бейдж «-59 %»
      if (m) { const v = parseFloat(m[1].replace(',', '.')); if (v > 0 && v < 100) res.discount_pct = v; continue; }
      m = t.match(/^[\-\u2212\u2013]\s*([\d.,\s\u00a0]+?)\s*\u20ac/); // бейдж «-1.991 €»
      if (m) { const v = __num(m[1]); if (v != null) res.discount_abs = v; continue; }
      if (t.indexOf('\u20ac') < 0) continue;
      if (/\u20ac\s*\/|\/(kg|m\u00b2|m2|l|ud|unidad)s?\b/i.test(t)) continue; // цена за единицу
      const pm = t.match(/(\d{1,3}(?:[ .\u00a0]\d{3})+(?:,\d{1,2})?|\d{1,6}[.,]\d{2}|\d{1,6})(?=\s*\u20ac)/);
      if (!pm) continue;
      const n = __num(pm[1]);
      if (n == null) continue;
      if (__struck(el)) { if (res.price_original == null || n > res.price_original) res.price_original = n; }
      else {
        let fs = 10;
        try { fs = parseFloat(getComputedStyle(el).fontSize) || 10; } catch (err) {}
        if (fs > bestFs || (fs === bestFs && res.price == null)) { bestFs = fs; res.price = n; }
      }
    }
    if (res.price != null && res.price_original != null && res.price_original > res.price) {
      if (res.discount_abs == null) res.discount_abs = Math.round((res.price_original - res.price) * 100) / 100;
      if (res.discount_pct == null) res.discount_pct = Math.round((res.price_original - res.price) / res.price_original * 1000) / 10;
    } else if (res.price != null && res.price_original == null && res.discount_abs != null) {
      res.price_original = Math.round((res.price + res.discount_abs) * 100) / 100;
      if (res.discount_pct == null) res.discount_pct = Math.round(res.discount_abs / res.price_original * 1000) / 10;
    } else if (res.price != null && res.price_original == null && res.discount_pct != null) {
      res.price_original = Math.round(res.price / (1 - res.discount_pct / 100) * 100) / 100;
      res.discount_abs = Math.round((res.price_original - res.price) * 100) / 100;
    }
    if (res.price_original != null && res.price != null && res.price_original <= res.price) { res.price_original = null; res.discount_pct = null; res.discount_abs = null; }
    return res;
  };
  const out = [];
  const seen = new Set();
  // v1.4: путь раздела из хлебных крошек («Productos > Herramientas > …»), fallback — заголовок H1
  // v1.6: точное дерево из пути URL — /productos/herramientas/…/taladros-con-cable/ → «Herramientas > … > Taladros con cable»
  let category = '';
  try {
    const hum = (t) => { const h = t.replace(/\.html?$/i, '').replace(/-/g, ' ').trim(); return h.charAt(0).toUpperCase() + h.slice(1); };
    let parts = location.pathname.split('/').filter(Boolean);
    if (/^productos$/i.test(parts[0] || '')) parts = parts.slice(1);
    parts = parts.filter(p => !/-\d{5,}\.html?$/i.test(p));
    if (parts.length) category = parts.map(hum).join(' > ').slice(0, 300);
    if (!category) {
      const h1 = String((document.querySelector('h1') || {}).textContent || '').trim();
      if (h1) category = h1;
    }
  } catch (e) {}
  for (const a of document.querySelectorAll('a[href*=".html"]')) {
    const href = a.href.split('#')[0];
    if (!/-\d{5,}\.html?$/i.test(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    // v1.8.1: карточка = ближайший КОМПАКТНЫЙ контейнер (иначе хватается шапка сайта с логотипом)
    let card = a.closest('li, article, [data-testid*="product" i], [class*="product-card" i]') || a;
    if (card !== a && String(card.innerText || '').length > 600) card = a; // слишком большой — это не карточка
    if (card === a) { const p = a.parentElement; if (p && String(p.innerText || '').length < 600 && p.querySelectorAll('a[href*=".html"]').length <= 2) card = p; }
    // v1.9.1: отсекаем логотипы И этикетки энергоэффективности (A++/A+ бейджи — не фото товара!)
    const BAD_IMG_DOM = /logo|etiqueta|energetic|energy[-_ ]?label|efficien|clase[-_ ]?ener|eeli/i;
    const imgs = [...card.querySelectorAll('img')].filter(im => !BAD_IMG_DOM.test(String(im.alt || '') + ' ' + String(im.src || '') + ' ' + String(im.getAttribute('data-src') || '')));
    const img = imgs[0] || null;
    // v1.8.3: lazy-load — img.src там лоадер (loader-v2.svg); сначала data-* атрибуты, лоадеры/свг отсекаем
    const BAD_IMG = /loader|placeholder|blank|spinner|\.gif($|\?)|\.svg($|\?)/i;
    const srcOf = (el) => {
      if (!el) return '';
      const cands = [el.getAttribute('data-src'), el.getAttribute('data-lazy-src'), el.getAttribute('data-original'), el.getAttribute('data-srcset'), el.getAttribute('srcset'), el.currentSrc, el.src];
      for (let c of cands) {
        if (!c) continue;
        c = String(c).trim();
        if (c.includes(',')) c = c.split(',').pop().trim().split(' ')[0]; // srcset: берём самый большой
        else c = c.split(' ')[0];
        if (c && !BAD_IMG.test(c)) return c;
      }
      return '';
    };
    let imgSrc = srcOf(img) || srcOf(card.querySelector('picture source')) || srcOf(card.querySelector('[data-src]')) || srcOf(card.querySelector('[data-lazy-src]'));
    if (imgSrc && !/^https?:/i.test(imgSrc)) { try { imgSrc = new URL(imgSrc, location.href).href; } catch (e) { imgSrc = ''; } }
    if (BAD_IMG.test(imgSrc)) imgSrc = '';
    // v1.8.1: имя — из текста/aria-label ссылки в первую очередь; логотипное «Leroy Merlin» отсекаем
    let name = String(a.getAttribute('aria-label') || a.textContent || '').replace(/\s+/g, ' ').trim();
    if (name.length < 10 && img) name = String(img.alt || '').replace(/\s+/g, ' ').trim();
    if (/^leroy\s*merlin$/i.test(name)) name = '';
    if (name.length > 300) name = name.slice(0, 300);
    // v1.12: визуальный разбор цены карточки — текущая/зачёркнутая/скидка; без цен за единицу
    let pv = __visualPrice(card);
    if (pv.price == null) { // карточка схлопнулась до ссылки — ищем у компактных предков
      let el = card;
      for (let up = 0; up < 3 && el && pv.price == null; up++) {
        el = el.parentElement;
        if (el && String(el.innerText || '').length < 1200 && (el.querySelectorAll('a[href*=".html"]').length <= 4)) pv = __visualPrice(el);
      }
    }
    const price = pv.price, currency = price != null ? 'EUR' : '';
    if (!name) {
      const sm = href.match(/\/([^/]+)-\d{5,}\.html?$/i);
      if (sm) name = sm[1].replace(/-/g, ' ').slice(0, 300);
    }
    out.push({ url: href, name, image: imgSrc, category, price, currency, price_original: pv.price_original, discount_pct: pv.discount_pct, discount_abs: pv.discount_abs });
  }
  return out;
}

// v1.3: парсинг раздела до конца — листаем ?p=N, пока не кончатся новые товары
async function runSection(api, token, startUrl) {
  if (running) return;
  running = true; stopped = false;
  await runSectionOnce(api, token, startUrl);
  running = false;
}

async function runSectionOnce(api, token, startUrl) {
  const known = new Set();
  let totalSent = 0;
  // v1.13: накопители статистики для журнала парсинга
  let statTotal = 0, statPhoto = 0, statBrand = 0, statMpn = 0, statPrice = 0, logCat = '';
  const needPrice = []; // v1.16: товары без цены на витрине — дочитаем со страниц товаров
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
        // v1.5.2: прокрутка вниз — принуждаем lazy-load отдать реальные src картинок
        try {
          await Promise.race([
          chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => new Promise((res) => { let y = 0; const t = setInterval(() => { y += 600; window.scrollTo(0, y); if (y >= document.body.scrollHeight) { clearInterval(t); res(); } }, 150); }) }),
          sleep(12000) // v1.16: прокрутка не должна висеть вечно
        ]);
        } catch (e) {}
        await sleep(800);
        const [inj] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractLinksOnPage });
        links = (inj && inj.result) || [];
        // v1.9: MAIN-world JSON-состояние страницы — надёжный источник фото/цены/бренда (мерж по URL, состояние приоритетнее)
        try {
          const [st] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: collectStateProducts });
          const stateItems = (st && st.result) || [];
          if (stateItems.length) {
            const byUrl = new Map(links.map(l => [l.url, l]));
            for (const sp of stateItems) {
              const ex = byUrl.get(sp.url);
              if (ex) {
                if (sp.image) ex.image = sp.image;
                if (sp.price != null) { ex.price = sp.price; ex.currency = sp.currency || 'EUR'; }
                if (sp.price_original != null) ex.price_original = sp.price_original;
                if (sp.discount_pct != null) ex.discount_pct = sp.discount_pct;
                if (sp.discount_abs != null) ex.discount_abs = sp.discount_abs;
                if (sp.brand) ex.brand = sp.brand;
                if (sp.mpn) ex.mpn = sp.mpn;
                if ((!ex.name || ex.name.length < 10) && sp.name) ex.name = sp.name;
              } else {
                byUrl.set(sp.url, { ...sp, category: (links[0] && links[0].category) || '' });
              }
            }
            links = [...byUrl.values()];
          }
        } catch (e) { /* нет доступа к MAIN — работаем по DOM */ }
        // v1.10: добиваем MPN из строки товара, если из JSON не пришёл
        for (const l of links) { if (!l.mpn) { const d = deriveMpn(l.name, l.brand); if (d) l.mpn = d; } }
        // v1.11: «пока нет цены и фото — не переходим»: до 3 проходов по странице (дозагрузка lazy-load)
        for (let pass = 2; pass <= 3 && links.length; pass++) {
          const noPhoto = links.filter(l => !l.image).length;
          const noPrice = links.filter(l => l.price == null).length;
          if (noPhoto <= links.length * 0.2 && noPrice <= links.length * 0.2) break; // ≥80% полных — идём дальше
          progress(`⏳ Стр. ${page}: фото нет у ${noPhoto}/${links.length}, цены нет у ${noPrice} — догружаю (проход ${pass})…`);
          try {
            await Promise.race([
              chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => new Promise((res) => { let y = 0; const t = setInterval(() => { y += 400; window.scrollTo(0, y); if (y >= document.body.scrollHeight) { clearInterval(t); window.scrollTo(0, 0); res(); } }, 250); }) }),
              sleep(15000) // v1.16: таймаут догрузочной прокрутки
            ]);
          } catch (e) {}
          await sleep(2000);
          let again = [];
          try {
            const [inj2] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractLinksOnPage });
            again = (inj2 && inj2.result) || [];
          } catch (e) {}
          try {
            const [st2] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: collectStateProducts });
            again = again.concat((st2 && st2.result) || []);
          } catch (e) {}
          const byU = new Map(links.map(l => [l.url, l]));
          for (const a of again) {
            const ex = byU.get(a.url);
            if (!ex) continue;
            if (!ex.image && a.image) ex.image = a.image;
            if (ex.price == null && a.price != null) { ex.price = a.price; ex.currency = a.currency || 'EUR'; }
            if (ex.price_original == null && a.price_original != null) ex.price_original = a.price_original;
            if (ex.discount_pct == null && a.discount_pct != null) ex.discount_pct = a.discount_pct;
            if (ex.discount_abs == null && a.discount_abs != null) ex.discount_abs = a.discount_abs;
            if (!ex.brand && a.brand) ex.brand = a.brand;
            if (!ex.mpn && a.mpn) ex.mpn = a.mpn;
          }
        }
      } catch (e) { progress('⚠️ Стр. ' + page + ': не загрузилась — ' + e.message); }
      if (tab) try { await chrome.tabs.remove(tab.id); } catch (e) {}
      if (links.length) {
        const wp = links.filter(l => l.price != null).length, wi = links.filter(l => l.image).length, wb = links.filter(l => l.brand).length, wm = links.filter(l => l.mpn).length;
        statTotal += links.length; statPhoto += wi; statBrand += wb; statMpn += wm; statPrice += wp;
        for (const l of links) { if (l.price == null && !needPrice.some(x => x.url === l.url)) needPrice.push({ url: l.url, name: l.name }); }
        if (!logCat && links[0].category) logCat = links[0].category;
        progress(`📦 Стр. ${page}: ${links.length} товаров · 💶 с ценой ${wp} · 📷 с фото ${wi} · 🏷 с брендом ${wb} · отправлено всего ${totalSent}`);
      }
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
    // v1.16: добор цен со СТРАНИЦ ТОВАРОВ — на витрине у вариантов («4 opciones») и «только онлайн/в магазине» цены нет физически
    if (needPrice.length && !stopped) {
      const todo = needPrice.slice(0, 40); // не более 40 страниц за проход — вежливость + время
      progress(`💶 Добор цен со страниц товаров: ${todo.length} из ${needPrice.length} без цены…`);
      let fixed = 0, capStreak = 0;
      for (const it of todo) {
        if (stopped) break;
        progress(`💶 Добор цены ${fixed + 1}/${todo.length}: ${it.name || it.url}`);
        const r = await collectOne(api, token, it);
        if (r.saved) { fixed++; statPrice++; }
        if (r.failReason === 'captcha') { capStreak++; if (capStreak >= 3) { progress('🛑 Капча DataDome — добор цен остановлен'); break; } }
        await sleep(1500 + Math.random() * 1500);
      }
      progress(`💶 Добор цен завершён: получено ${fixed} из ${todo.length}${needPrice.length > 40 ? ` (осталось ${needPrice.length - 40} — следующий проход доберёт)` : ''}`);
    }
    // v1.13: итоги раздела — в журнал парсинга на сервере
    if (statTotal > 0) {
      try {
        await fetch(`${api}/api/parse/ext-log?token=${encodeURIComponent(token)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ site: (() => { try { return new URL(startUrl).hostname; } catch (e) { return ''; } })(), url: startUrl, category: logCat, total: statTotal, with_photo: statPhoto, with_brand: statBrand, with_mpn: statMpn, with_price: statPrice, sent: totalSent })
        });
        progress('📜 Журнал: итоги раздела записаны');
      } catch (e) {}
    }
  } catch (e) { progress('❌ ' + e.message); }
}

// v1.10: выделение оригинального номера производителя (MPN) из строки товара
function deriveMpn(name, brand) {
  if (!name) return '';
  const pm = name.match(/\(([A-Za-z0-9][A-Za-z0-9.\/\- ]{2,24})\)/);
  if (pm && /\d/.test(pm[1]) && !/^\d+([.,]\d+)?\s*(w|v|a|l|kg|mm|cm|m)$/i.test(pm[1].trim())) return pm[1].trim();
  const toks = name.match(/[A-Za-z0-9][A-Za-z0-9.\/\-]*/g) || [];
  const UNIT = /^\d+([.,]\d+)?(w|kw|v|a|mah|ah|l|ml|mm|cm|m|kg|g|hz|db|rpm|bar|lm|kwh|mbar|hz)$/i;
  const DIM = /^\d+([.,]\d+)?([xх×*]\d+([.,]\d+)?)+$/;
  const bl = brand ? String(brand).toLowerCase() : '';
  const bi = bl ? toks.findIndex(t => t.toLowerCase() === bl || t.toLowerCase().startsWith(bl + '-')) : -1;
  // пары «БУКВЫ + цифровой код» сразу после бренда: GBH 2-26, ML 915
  if (bi >= 0) {
    for (let i = bi + 1; i < Math.min(toks.length - 1, bi + 5); i++) {
      if (/^[A-Za-z]{1,8}$/.test(toks[i]) && /\d/.test(toks[i + 1]) && !UNIT.test(toks[i + 1]) && !DIM.test(toks[i + 1]) && !/^\d{5,9}$/.test(toks[i + 1])) {
        return (toks[i] + ' ' + toks[i + 1]).slice(0, 60);
      }
    }
  }
  // одиночный токен буквы+цифры: DHP453, GBH2-26, UP2500
  for (const t of toks) {
    if (UNIT.test(t) || DIM.test(t)) continue;
    if (/[A-Za-z]/.test(t) && /\d/.test(t) && t.length >= 3 && t.length <= 24) return t;
  }
  return '';
}

// v1.9: извлечение товаров из JSON-состояния страницы (MAIN world) — __NEXT_DATA__/__PRELOADED_STATE__/JSON-LD.
// Устойчиво к lazy-load и вёрстке: ищем «товароподобные» объекты {url с -NNNNN.html, name, price?, image?} во всём графе.
function collectStateProducts() {
  const out = new Map();
  const visited = new WeakSet();
  let budget = 300000; // страховка от гигантских графов
  const abs = (u) => { try { return new URL(u, location.href).href; } catch (e) { return ''; } };
  const pickStr = (o, keys) => {
    for (const k of keys) {
      const v = o[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (typeof v.url === 'string' && v.url) return v.url;
        if (typeof v.src === 'string' && v.src) return v.src;
        if (typeof v.name === 'string' && v.name) return v.name;
      }
    }
    return '';
  };
  const pickNum = (v, d) => {
    if (d > 3 || v == null) return null;
    if (Array.isArray(v)) { for (const it of v) { const n = pickNum(it, d + 1); if (n != null) return n; } return null; }
    if (typeof v === 'number' && isFinite(v) && v > 0 && v < 100000) return v;
    if (typeof v === 'string') { const n = parseFloat(v.replace(/\s/g, '').replace(',', '.')); return (isFinite(n) && n > 0 && n < 100000) ? n : null; }
    if (typeof v === 'object') {
      for (const k of ['value', 'current', 'currentPrice', 'sellingPrice', 'finalPrice', 'priceWithTax', 'price', 'amount', 'now', 'sale', 'lowPrice', 'highPrice', '0']) {
        const n = pickNum(v[k], d + 1); if (n != null) return n;
      }
    }
    return null;
  };
  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 14 || visited.has(o) || budget-- <= 0) return;
    visited.add(o);
    if (Array.isArray(o)) { for (const v of o) walk(v, depth + 1); return; }
    const urlRaw = pickStr(o, ['url', 'href', 'link', 'seoUrl', 'seoURL', 'canonicalUrl', 'productUrl', 'path']);
    if (urlRaw) {
      const url = abs(urlRaw.split('#')[0]);
      if (/-\d{5,}\.html?/i.test(url)) {
        const name = pickStr(o, ['name', 'title', 'label', 'productName', 'displayName', 'shortName']);
        if (name && name.length >= 8 && !/^leroy\s*merlin$/i.test(name)) {
          // v1.9.1: фото ТОВАРА — ПЕРВОЕ из images[]/media[]; этикетки энергоэффективности в бан
          const BAD_PHOTO = /etiqueta|energetic|energy|efficien|clase[-_ ]?ener|eeli|label|loader|placeholder|\.svg($|\?)/i;
          const imgFromArr = (arr) => {
            for (const it of arr) {
              const u = typeof it === 'string' ? it : pickStr(it, ['url', 'src', 'path']);
              if (u && !BAD_PHOTO.test(u)) return u;
            }
            return '';
          };
          let image = '';
          if (Array.isArray(o.images) && o.images.length) image = imgFromArr(o.images);
          if (!image && Array.isArray(o.media) && o.media.length) image = imgFromArr(o.media);
          if (!image) { const one = pickStr(o, ['image', 'imageUrl', 'imageURL', 'img', 'thumbnail', 'picture', 'mediaUrl', 'mainImage', 'defaultImage', 'visual']); if (one && !BAD_PHOTO.test(one)) image = one; }
          if (image) { image = abs(image); if (BAD_PHOTO.test(image)) image = ''; }
          const price = pickNum(o.price, 0) ?? pickNum(o.currentPrice, 0) ?? pickNum(o.sellingPrice, 0) ?? pickNum(o.pricing, 0) ?? pickNum(o.priceData, 0) ?? pickNum(o.offers, 0) ?? pickNum(o.prices, 0);
          // v1.12: цена без скидки и скидка из состояния
          let priceOriginal = pickNum(o.originalPrice, 0) ?? pickNum(o.listPrice, 0) ?? pickNum(o.pvp, 0) ?? pickNum(o.pvpPrice, 0) ?? pickNum(o.regularPrice, 0) ?? pickNum(o.previousPrice, 0) ?? pickNum(o.priceBeforeDiscount, 0) ?? pickNum(o.crossedPrice, 0) ?? pickNum(o.wasPrice, 0);
          let discountPct = pickNum(o.discountPercentage, 0) ?? pickNum(o.discountPercent, 0);
          let discountAbs = null;
          if (price != null && priceOriginal != null && priceOriginal > price) {
            discountAbs = Math.round((priceOriginal - price) * 100) / 100;
            if (discountPct == null) discountPct = Math.round((priceOriginal - price) / priceOriginal * 1000) / 10;
          } else if (priceOriginal != null && price != null && priceOriginal <= price) priceOriginal = null;
          let brand = pickStr(o, ['brandName', 'marca', 'manufacturer']); if (!brand && o.brand) brand = typeof o.brand === 'string' ? o.brand : pickStr(o.brand, ['name', 'label']);
          const mpn = pickStr(o, ['mpn', 'reference', 'manufacturerReference', 'supplierReference', 'model', 'ref']);
          if (!out.has(url)) out.set(url, { url, name: name.slice(0, 300), image, price: price != null ? price : null, currency: 'EUR', brand: String(brand || '').slice(0, 120), mpn: String(mpn || '').slice(0, 120), price_original: priceOriginal, discount_pct: discountPct, discount_abs: discountAbs });
        }
      }
    }
    for (const k of Object.keys(o)) { const v = o[k]; if (v && typeof v === 'object') walk(v, depth + 1); }
  };
  const roots = [];
  for (const k of ['__NEXT_DATA__', '__PRELOADED_STATE__', '__INITIAL_STATE__', '__APOLLO_STATE__', '__NUXT__', '__STATE__', '__INITIAL_DATA__', '__APP_DATA__']) {
    try { if (window[k]) roots.push(window[k]); } catch (e) {}
  }
  try {
    for (const k of Object.getOwnPropertyNames(window)) {
      if (/state|data|store|preload|initial|apollo|next|nuxt|redux/i.test(k)) {
        try { const v = window[k]; if (v && typeof v === 'object' && !visited.has(v)) roots.push(v); } catch (e) {}
      }
    }
  } catch (e) {}
  document.querySelectorAll('script[type="application/ld+json"]').forEach((sc) => { try { roots.push(JSON.parse(sc.textContent)); } catch (e) {} });
  for (const r of roots) walk(r, 0);
  return [...out.values()];
}

// v1.7: извлечение брендов со страницы /productos/marcas/
function extractBrandsOnPage() {
  const out = []; const seen = new Set();
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.href.split('#')[0];
    if (!/\/productos\/marcas\/[^/]+/i.test(href) || /\/productos\/marcas\/?$/i.test(href)) continue;
    let name = String(a.getAttribute('aria-label') || a.textContent || (a.querySelector('img') && a.querySelector('img').alt) || '').replace(/\s+/g, ' ').trim();
    if (!name) { const m = href.match(/\/marcas\/([^/?]+)/i); name = m ? m[1].replace(/-/g, ' ') : ''; }
    name = name.charAt(0).toUpperCase() + name.slice(1);
    if (!name || name.length < 2 || name.length > 60) continue;
    const key = name.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, url: href });
  }
  return out;
}

async function runBrands(api, token) {
  if (running) return;
  running = true; stopped = false;
  let tab = null;
  try {
    progress('⏳ Открываю страницу брендов…');
    tab = await chrome.tabs.create({ url: 'https://www.leroymerlin.es/productos/marcas/', active: false });
    try { await chrome.tabs.update(tab.id, { autoDiscardable: false }); } catch (e) {}
    await new Promise((res) => {
      const to = setTimeout(res, 18000);
      chrome.tabs.onUpdated.addListener(function f(id, ch) {
        if (id === tab.id && ch.status === 'complete') { clearTimeout(to); chrome.tabs.onUpdated.removeListener(f); res(); }
      });
    });
    await sleep(1500);
    // прокрутка — список брендов ленивый
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => new Promise((res) => { let y = 0; const t = setInterval(() => { y += 700; window.scrollTo(0, y); if (y >= document.body.scrollHeight) { clearInterval(t); res(); } }, 150); }) });
    } catch (e) {}
    await sleep(800);
    const [inj] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractBrandsOnPage });
    const brands = (inj && inj.result) || [];
    if (!brands.length) { progress('❌ Бренды не найдены на странице (возможно, DataDome)'); running = false; return; }
    const rr = await fetch(`${api}/api/parse/ext-brands?token=${encodeURIComponent(token)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: brands })
    });
    const jj = await rr.json().catch(() => ({}));
    progress(rr.ok ? `✅ Справочник брендов обновлён: ${jj.upserted} шт.` : ('❌ ' + (jj.error || rr.status)));
  } catch (e) { progress('❌ ' + e.message); }
  if (tab) try { await chrome.tabs.remove(tab.id); } catch (e) {}
  running = false;
}

// v1.8: очередь разделов из файла (по одному URL на строку, # — комментарий)
async function runSectionQueue(api, token, urls) {
  if (running) return;
  running = true; stopped = false;
  let done = 0;
  try {
    for (const u of urls) {
      if (stopped) { progress(`⏹ Очередь остановлена: ${done}/${urls.length} разделов`); break; }
      progress(`🗂 Раздел ${done + 1}/${urls.length}: ${u}`);
      await runSectionOnce(api, token, u);
      done++;
      await sleep(4000 + Math.random() * 3000); // пауза между разделами 4–7 с
    }
    if (!stopped) progress(`✅ Все разделы обработаны: ${done}/${urls.length}`);
  } catch (e) { progress('❌ ' + e.message); }
  running = false;
}

// v1.14: команды из веб-приложения Householder (onMessageExternal) — запуск/стоп/статус парсинга раздела
chrome.runtime.onMessageExternal.addListener((m, sender, sendResponse) => {
  (async () => {
    try {
      const { api, token } = await chrome.storage.local.get(['api', 'token']);
      if (!api || !token) { sendResponse({ ok: false, error: 'no-auth' }); return; }
      if (m && m.cmd === 'parse-section' && /^https?:\/\//i.test(String(m.url || ''))) {
        if (isStuck()) { running = false; stopped = false; } // v1.16: самосброс зависшего запуска
        if (running) { sendResponse({ ok: false, error: 'busy' }); return; }
        runSection(api, token, String(m.url));
        sendResponse({ ok: true });
      } else if (m && m.cmd === 'status') {
        if (isStuck()) { running = false; } // v1.16: самосброс
        sendResponse({ ok: true, running, last: lastProgress, stuckCleared: true });
      } else if (m && m.cmd === 'stop') {
        stopped = true; sendResponse({ ok: true });
      } else sendResponse({ ok: false, error: 'unknown-cmd' });
    } catch (e) { sendResponse({ ok: false, error: e.message }); }
  })();
  return true; // ответ асинхронный
});

chrome.runtime.onMessage.addListener((m) => {
  if (isStuck()) { running = false; stopped = false; } // v1.16: зависший сбор не блокирует новые запуски
  if (m.type === 'section' && !running) runSection(m.api, m.token, m.url);
  if (m.type === 'sections' && !running) runSectionQueue(m.api, m.token, m.urls || []);
  if (m.type === 'brands' && !running) runBrands(m.api, m.token);
  if (m.type === 'start' && !running) run(m.api, m.token, m.batch, m.mode, m.staleDays, !!m.continuous, m.site || '');
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
  const v = await chrome.storage.local.get(['api', 'token', 'batch', 'mode', 'staleDays', 'schedHours', 'site']);
  if (!v.api || !v.token || !v.schedHours) return;
  run(v.api, v.token, v.batch || 20, v.mode || 'pending', v.staleDays || 7, false, v.site || '');
});

// при старте браузера — восстановить будильник, если был включён
chrome.runtime.onStartup.addListener(async () => {
  const v = await chrome.storage.local.get(['schedHours']);
  if (v.schedHours > 0) chrome.alarms.create('lm-collect', { periodInMinutes: v.schedHours * 60 });
});

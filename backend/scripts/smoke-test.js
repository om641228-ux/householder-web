// Smoke-тесты ключевых эндпоинтов householder-api (v208)
// Запуск: node smoke-test.js [BASE_URL] [TOKEN]
//   node smoke-test.js https://householder-api-production.up.railway.app
const BASE = (process.argv[2] || 'https://householder-api-production.up.railway.app').replace(/\/+$/, '');
const TOKEN = process.argv[3] || '';
const auth = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log('PASS', name); }
  catch (e) { fail++; console.log('FAIL', name, '—', e.message); }
};
const j = async (url, opts = {}) => {
  const r = await fetch(BASE + url, opts);
  return { status: r.status, body: await r.json().catch(() => null) };
};
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

(async () => {
  console.log('=== Smoke: ' + BASE + ' ===\n-- Публичные --');
  await t('GET /health → 200', async () => expect((await j('/health')).status === 200, 'не 200'));
  await t('POST /api/login с неверным паролем → 401', async () => {
    const r = await j('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'definitely-wrong-' + Date.now() }) });
    expect(r.status === 401, 'ожидался 401, получен ' + r.status);
  });
  console.log('\n-- Закрытые БЕЗ токена (ждём 401) --');
  for (const p of ['/api/diagnostics', '/api/check-models', '/api/check-model?name=x', '/api/list-gemini-models', '/api/receipts?limit=1', '/api/users', '/api/activity-log']) {
    t('GET ' + p + ' → 401', async () => {
      const r = await j(p);
      expect(r.status === 401 || r.status === 403, 'получен ' + r.status);
    });
  }
  await new Promise(r => setTimeout(r, 1500)); // дождаться асинхронных t()
  if (TOKEN) {
    console.log('\n-- С токеном --');
    await t('GET /api/me → 200 + user', async () => { const r = await j('/api/me', { headers: auth }); expect(r.status === 200 && r.body, 'status ' + r.status); });
    await t('GET /api/receipts?limit=1 → 200', async () => { const r = await j('/api/receipts?limit=1', { headers: auth }); expect(r.status === 200, 'status ' + r.status); });
    await t('GET /api/diagnostics → 200 (admin)', async () => { const r = await j('/api/diagnostics', { headers: auth }); expect(r.status === 200, 'status ' + r.status); });
  } else console.log('\n(токен не передан — блок с авторизацией пропущен: node smoke-test.js URL TOKEN)');
  console.log(`\n=== ИТОГ: ${pass} PASS, ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
})();

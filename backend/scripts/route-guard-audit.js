// Аудит: каждый /api/* маршрут должен иметь requireAuth или явную пометку публичности
const fs = require('fs');
const src = fs.readFileSync(process.argv[2] || 'index.js', 'utf8');
const lines = src.split('\n');
// заведомо публичные маршруты (whitelist)
const PUBLIC = [/^\/api\/login$/, /^\/api\/health/, /^\/health$/, /^\/api\/public/, /^\/api\/share\//, /^\/$/, /^\/api\/diag-ping$/];
const routes = [];
const re = /app\.(get|post|put|patch|delete|all)\(\s*['"`]([^'"`]+)['"`]/;
lines.forEach((ln, i) => {
  const m = ln.match(re);
  if (!m) return;
  const path = m[2];
  const guarded = /requireAuth|requireRole|loginRateLimit/.test(ln);
  const isPublic = PUBLIC.some(rx => rx.test(path));
  routes.push({ line: i + 1, method: m[1].toUpperCase(), path, guarded, isPublic });
});
const unguardedApi = routes.filter(r => r.path.startsWith('/api') && !r.guarded && !r.isPublic);
console.log(`Всего маршрутов: ${routes.length}`);
console.log(`Под защитой: ${routes.filter(r => r.guarded).length}`);
console.log(`Публичные (whitelist): ${routes.filter(r => r.isPublic && !r.guarded).length}`);
console.log(`\n⚠ /api/* БЕЗ requireAuth и НЕ в whitelist: ${unguardedApi.length}`);
unguardedApi.forEach(r => console.log(`  строка ${r.line}: ${r.method} ${r.path}`));

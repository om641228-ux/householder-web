# Householder-Web — AI Context File (ФИНАЛЬНЫЙ)

Полный контекст проекта для AI-ассистента. Загрузите этот файл в новый чат вместе с `App.js` и `index.js` — ассистент сразу поймёт архитектуру, историю и текущее состояние.

**Дата обновления: 2026-08-01**
**ВАЖНО: работа ведётся ТОЛЬКО над проектом householder-web. Проект recept-web — отдельный, его файлы и сервисы не трогать!**

---

## 1. Обзор проекта

Householder-Web — веб-приложение для распознавания чеков и фактур с AI (форк проекта recept-web, полностью автономный).
- **Фронтенд:** React SPA (деплой на Railway, `npx serve -s build`)
- **Бэкенд:** Node.js + Express (Railway), entry point `index.js`
- **База данных:** Supabase PostgreSQL — **ОТДЕЛЬНЫЙ проект Supabase** (не общий с recept-web!)
- **Хранилище фото:** Supabase Storage, bucket `receipt-images` (public) — свой, в проекте householder
- **AI-распознавание:** Gemini, Groq, OCR.space, OpenRouter, GitHub Models, Mistral, Kimi (Moonshot)
- **AI-ключи общие** с recept-web (те же значения в Railway Variables) — расход/баланс (особенно Kimi) суммируется между проектами

### URL-адреса (Railway)
| Сервис | URL |
|---|---|
| Backend | `https://householder-api-production.up.railway.app` |
| Frontend | сервис householder-web (домен Railway) |
| Проверка бэкенда | `https://householder-api-production.up.railway.app/api/check-models` |

## 2. Структура проекта (GitHub-репозиторий householder-web)

```
householder-web/
├── backend/                  # Railway Root Directory: backend
│   ├── package.json          # "main": "index.js", "start": "node index.js"
│   ├── index.js              # Главный сервер: Express, routes, AI-распознавание, check-models
│   └── server.js             # Заглушка (require('./index.js'))
│
├── frontend/                 # Railway Root Directory: frontend
│   ├── src/
│   │   ├── App.js            # Главный React-компонент (весь UI), API_URL → householder-api
│   │   └── App.css           # Стили
│   ├── package.json
│   └── public/
│
└── supabase/
    └── setup.sql             # SQL: таблица receipts + колонки + bucket + policies
```

**ВАЖНО:** в Railway у каждого сервиса в Settings → Build должен быть указан Root Directory (`backend` или `frontend`), иначе Build failed.

## 3. Зависимости (backend)

```json
{
  "@google/generative-ai": "^0.21.0",
  "@supabase/supabase-js": "^2.45.0",
  "axios": "^1.7.0",
  "cors": "^2.8.5",
  "dotenv": "^16.4.0",
  "express": "^4.19.0",
  "form-data": "^4.0.0",
  "groq-sdk": "^0.7.0",
  "multer": "^1.4.5-lts.1",
  "sharp": "^0.33.0",
  "ws": "^8.18.0",
  "xlsx": "^0.18.5"
}
```
Node.js >= 20.0.0. Supabase подключён с `realtime.transport: ws` (обход проблемы WebSocket на Railway).

## 4. Переменные окружения (Railway → householder-api → Variables)

| Переменная | Описание |
|---|---|
| `SUPABASE_URL` | URL **householder**-проекта Supabase (не recept!) |
| `SUPABASE_KEY` | Anon key householder-проекта |
| `SUPABASE_SERVICE_ROLE_KEY` | Service Role Key householder-проекта (Storage upload) |
| `GEMINI_API_KEY` | Google AI Studio |
| `GROQ_API_KEY` | console.groq.com |
| `OCRSPACE_API_KEY` | ocr.space (бесплатный ключ) |
| `OPENROUTER_API_KEY` | openrouter.ai → Keys (модели `:free` бесплатны) |
| `GITHUB_TOKEN` | GitHub PAT (classic), доступ к GitHub Models |
| `MISTRAL_API_KEY` | console.mistral.ai (Experiment-тариф бесплатен) |
| `MOONSHOT_API_KEY` | platform.kimi.ai → API Keys (ПЛАТНО, нужен баланс! Баланс общий с recept-web) |
| `PORT` | Railway подставляет сам |
| `NO_CACHE=1` | Добавлять при проблемах с закэшированной сборкой |

Провайдер без ключа помечается ❌ в таблице моделей и пропускается в fallback.

## 5. API Endpoints

### Auth
| Method | Path | Описание |
|---|---|---|
| POST | `/api/login` | Вход (body: {password}) |
| GET | `/api/me` | Проверка токена (?token=) |
| POST | `/api/logout` | Выход |

### Receipts
| Method | Path | Описание |
|---|---|---|
| GET | `/api/receipts` | Список чеков (admin — все, user — свои по owner_id) |
| PUT | `/api/receipts/:id` | Редактирование полей документа (whitelist: store_name*, даты, суммы, currency, object, document_type, subtype, provider, valid_from/valid_to, related_id, meta, object_id) |
| DELETE | `/api/receipts/:id` | Удаление (admin) |
| POST | `/api/bulk-delete` | Массовое удаление (admin) |
| POST | `/api/bulk-update-object` | Массовая смена объекта |
| POST | `/api/bulk-update-currency` | Массовая смена валюты |
| POST | `/api/bulk-update-type` | Массовая смена типа (body: {ids, document_type} — один из 7 типов, см. ниже) |
| POST | `/api/bulk-update-subtype` | Массовая смена подтипа (body: {ids, subtype} — одно из 13 значений SUBTYPE_LABELS) |
| POST | `/api/upload-receipt` | Загрузка + распознавание (multipart/form-data: image/pdf, model, currency, docType, object, token) |
| POST | `/api/upload-document-pages` | Несколько файлов как СТРАНИЦЫ ОДНОГО документа (multipart: pages[] до 60 шт, изображения и/или 1-страничные PDF; собирается постраничным конвейером, обложка — первая страница) |
| POST | `/api/reprocess-receipt` | Перераспознавание |
| POST | `/api/translate-receipt` | Перевод raw_text существующего чека (без перераспознавания) |
| POST | `/api/export-excel` | Экспорт Excel (.xlsx) |
| POST | `/api/bulk-update-payment-status` | Массовая смена статуса оплаты (body: {ids, payment_status} — to_pay/paid/underpaid/null) |
| GET | `/api/diagnostics` | Диагностика без токена: версия, колонка raw_text_ru, колонки v7/v19/v20, настроенные ключи |

### Bank (банковские выписки, v24)
| Method | Path | Описание |
|---|---|---|
| POST | `/api/import-bank-statement` | Импорт выписки .xlsx (multipart: statement). Парсинг формата Ruralvía, upsert по (iban, entry_number), затем runBankMatching — авто-привязка фактур к платежам |
| GET | `/api/bank-movements` | Движения по счетам (до 1000, order operation_date desc). Совпадения фронт обогащает из своего state receipts |

### Objects (дома / недвижимость, v7)
| Method | Path | Описание |
|---|---|---|
| GET | `/api/objects` | Список объектов. Если таблицы objects ещё нет — fallback на distinct receipts.object + флаг migration_needed |
| POST | `/api/objects` | Добавить объект (body: {name, address?, notes?}) |

### Models
| Method | Path | Описание |
|---|---|---|
| GET | `/api/check-models` | **ГЛАВНЫЙ**: опрос ВСЕХ провайдеров реальными запросами (vision-пинг с тестовой картинкой). Возвращает `{checked_at, models:[{name, displayName, provider, active, ms, error}]}` |
| GET | `/api/list-gemini-models` / `/api/list-groq-models` / `/api/list-ocrspace-models` | Статичные списки (legacy) |

### Health
`GET /health`, `GET /api/health`, `GET /`

## 6. Схема таблицы receipts (Supabase householder)

```sql
CREATE TABLE receipts (
  id SERIAL PRIMARY KEY,
  store_name TEXT, store_name_ru TEXT,
  receipt_date DATE, receipt_time TIME,
  total_amount NUMERIC, subtotal NUMERIC,
  tax_amount NUMERIC, tax_rate TEXT,
  currency TEXT DEFAULT 'AED',
  country TEXT, payment_method TEXT, payment_amount NUMERIC, cashier TEXT,
  items JSONB,               -- [{name, name_ru, quantity, price, total}]
  image_url TEXT,            -- Supabase Storage public URL (jpg или pdf) — обложка/первый файл
  -- колонка v13 (миграция supabase-migration-v13.sql):
  page_urls JSONB,           -- [url, ...] ВСЕ страницы документа в Storage (мультифайл и page-by-page PDF); NULL у однофайловых чеков
  raw_text TEXT,             -- распознанный текст, оригинал (модульная структура, см. п. 9)
  raw_text_ru TEXT,          -- ПЕРЕВОД raw_text на русский (та же структура) — ОБЯЗАТЕЛЬНАЯ колонка!
  document_type TEXT DEFAULT 'receipt',   -- 'receipt'|'invoice'|'bill'|'insurance'|'bank'|'contract'|'other'
  object TEXT DEFAULT 'other',            -- имя объекта (fallback-ссылка на objects.name)
  -- колонки v7 (миграция supabase-migration-v7.sql):
  subtype TEXT,              -- electricity|water|gas|internet|phone|comunidad|rent|waste|insurance_home|insurance_car|insurance_health|tax|other
  provider TEXT,             -- компания-поставщик/эмитент (Iberdrola, Movistar, Mapfre, банк...)
  valid_from DATE, valid_to DATE,  -- срок действия (полис/договор) или период счёта; valid_to → бейдж «истекает»
  meta JSONB DEFAULT '{}',   -- номер полиса, лицевой счёт, IBAN и прочее типовое
  related_id BIGINT REFERENCES receipts(id),  -- связь документ→документ (платёж → полис, счёт → договор)
  object_id BIGINT REFERENCES objects(id),    -- FK на объект (имя в object остаётся fallback)
  -- колонки v9 (миграция supabase-migration-v9.sql) — коммунальные счета вода/свет:
  invoice_number TEXT, contract_number TEXT,  -- № фактуры, № договора/контракта
  supply_address TEXT,         -- Dirección de suministro — основа авто-определения объекта
  cups TEXT,                   -- CUPS (электричество, ES0031...)
  meter_number TEXT,           -- NÚMERO CONTADOR (счётчик воды)
  consumption NUMERIC, consumption_unit TEXT,  -- потребление + 'kWh'|'m3'
  recognition_method TEXT,   -- какая модель распознавала (+ fallback info)
  recognized_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  owner_id TEXT, owner_name TEXT,
  -- колонка v19 (миграция supabase-migration-v19.sql):
  payment_status TEXT,         -- 'to_pay'|'paid'|'underpaid'|null — статус оплаты (ручной/авто по выписке)
  -- колонки v20 (миграция supabase-migration-v20.sql):
  bank_movement_id BIGINT,     -- привязка к строке банковской выписки (bank_movements.id)
  paid_date DATE               -- фактическая дата оплаты (из выписки)
);

-- таблица банковских движений (v20, миграция supabase-migration-v20.sql):
-- id, owner_id, iban, account_name, operation_date, value_date, prefix, concept, counterparty,
-- amount NUMERIC(14,2) NOT NULL, balance, entry_number, import_batch,
-- matched_receipt_id BIGINT (без FK), match_status DEFAULT 'unmatched', match_score, matched_at, created_at
-- уникальный индекс: (iban, entry_number) — дедуп при повторном импорте
CREATE TABLE bank_movements (...);

-- таблица объектов (v7): id, name UNIQUE, address, notes, created_at
-- сидится из distinct receipts.object; object_id бэкфиллится по имени
CREATE TABLE objects (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name TEXT NOT NULL UNIQUE, address TEXT, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
```
Bucket: `receipt-images` (public, policies SELECT/INSERT/DELETE).
**Если колонки `raw_text_ru` нет** (setup.sql выполнялся давно): `alter table receipts add column if not exists raw_text_ru text;` — без неё сохранение чеков сломается.
**Имена файлов в Storage** санитизируются (`sanitizeFilename`): Ñ→N, кириллица убирается, пробелы→`_`. Иначе ошибка `Invalid key`.

## 7. Авторизация

- Hardcoded users (11): `admin/admin` → role admin; `user1/user1` … `user10/user10` → role user
- Токены in-memory (Map) — Railway-safe, сбрасываются при рестарте
- Передача токена: `?token=` (query), `x-token` header или body
- User видит только свои чеки (owner_id), admin — все

## 8. AI-провайдеры (критически важные детали!)

### Gemini (Google)
- **Default: `gemini-2.5-flash`** (gemini-1.5-flash снят с поддержки → 404!)
- `generationConfig: { maxOutputTokens: 8192, temperature: 0.1 }` — задано ЯВНО: у 2.5 thinking-токены едят лимит, без запаса обрезается raw_text_ru (перевод)
- `recognizeWithGeminiAuto` перебирает: 2.5-flash → 2.0-flash → 2.5-pro → 1.5-flash → 1.5-pro
- **Единственный провайдер с нативной поддержкой PDF** (inlineData mimeType application/pdf)

### Groq
- **Алиасы** (GROQ_ALIASES): `llama-4-scout` → `meta-llama/llama-4-scout-17b-16e-instruct` и т.д.
- `max_tokens: 8192` (запас на оригинал + перевод)
- Список живьём: `groq.models.list()`, фильтр whisper/playai/tts/guard

### OCR.space
- Engines: engine1 (Basic), engine2 (Advanced), engine3 (Handwriting)
- Сам только извлекает текст; **структурирование — через recognizeWithFallback**
- Принимает PDF (до 3 страниц на free)

### OpenRouter / GitHub Models / Mistral (OpenAI-совместимые)
- OpenRouter: `https://openrouter.ai/api/v1`, headers HTTP-Referer/X-Title, default `google/gemma-4-26b-a4b-it:free`
- GitHub: `https://models.github.ai/inference`, Bearer GITHUB_TOKEN, default `openai/gpt-4o-mini`
- Mistral: `https://api.mistral.ai/v1`, default `mistral-small-latest`
- У всех `max_tokens: 8192`, `temperature: 0.1`

### Kimi / Moonshot — ОСОБЫЕ ПРАВИЛА
- baseURL: `https://api.moonshot.ai/v1`
- **ПЛАТНО** — нужен баланс, иначе "suspended due to insufficient balance"
- **НЕЛЬЗЯ передавать `temperature`** — передача = ошибка 400
- `kimi-k3` (default): `max_completion_tokens: 16384` (не max_tokens!), `reasoning_effort: 'low'`
- `kimi-k2.6`: `max_tokens: 16384` (reasoning_content + content делят лимит)
- `moonshot-v1-*` — закрыты для новых аккаунтов (sunset)

### Цепочка fallback (recognizeWithFallback)
**Gemini auto → OpenRouter → GitHub → Mistral → Kimi**
- Для PDF — только Gemini
- При fallback в ответе `warning` содержит ПРИЧИНУ ошибки исходной модели
- В `recognition_method` пишется фактическая модель: `kimi-kimi-k3 (fallback → gemini-2.5-flash)`

### Префиксы моделей (routing)
`gemini-*`, `groq-*`, `ocrspace-engineN`, `openrouter-*`, `github-*`, `mistral-*`, `kimi-*`

## 9. Распознанный текст: raw_text (оригинал) + raw_text_ru (перевод)

Промпт требует ОБА поля строго по модулям (НЕ JSON-массив, НЕ одна строка):
```
══════ МАГАЗИН ══════
══════ ДОКУМЕНТ ══════
══════ ТОВАРЫ ══════
1. НАЗВАНИЕ — КОЛ-ВО × ЦЕНА = СУММА
══════ СУММЫ ══════
══════ ОПЛАТА ══════
══════ ПРОЧИЙ ТЕКСТ ══════
```
- `raw_text` — на языке оригинала, ничего не переводить
- `raw_text_ru` — **ОБЯЗАТЕЛЬНОЕ поле**: полный перевод, та же структура и порядок строк; числа/даты/артикулы не меняются. В промпте: «ответ без raw_text_ru считается НЕВАЛИДНЫМ»
- Модуля нет на чеке → модуль пропускается
- Бэкенд-страховка: raw_text массивом → склеивается построчно
- Фронт `formatRawText`: старые записи (JSON-массив/объект) разворачиваются построчно
- **Фронт отображает перевод в 3 местах** (все уже есть в App.js): модалка просмотра чека (`viewModal.raw_text_ru`, фон #f0f7ff), блок результата после загрузки (`lastSavedReceipt`, details «Перевод на русский», open), компактный блок в карточке
- Старые чеки без перевода → массово «Перераспознать»

## 10. PDF поддержка

**Фронт (основной путь):** pdf.js 3.11.174 по CDN (cdnjs), `convertPdfToImages` рендерит страницы (до 10) в JPEG (scale 2.0) → `expandFilesWithPdf` → обычный конвейер, работают ВСЕ модели. Имена страниц: `имя_p1.jpg` (только латиница!).
**Бэкенд:** `application/pdf` → без sharp → Gemini нативно / OCR.space; PDF сохраняется в Storage как PDF; в карточках плашка «PDF» (`isPdfUrl`).

## 11. UI-фичи фронта (актуальное состояние App.js)

- **Таблица выбора модели:** кнопка «Выбор модели» → `GET /api/check-models` (~30–40 сек); ✅ Активна / ❌ Не активна (причина под статусом) / ➖; активные сверху; 🔄 Обновить; GROQ_ALIASES_FRONT для подсветки
- **Группировка карточек:** по годам и месяцам («Март 2026 · N шт»), сортировка дата desc по receipt_date||created_at; groupKeyOf/groupTitleOf, заголовок `gridColumn: '1 / -1'`
- **Массовые действия** (панель при выборе): Удалить (admin), Экспорт (Все/Excel/Фото/Текст + Загрузить), Перераспознать, **Сменить объект...**, **Сменить тип...** (все 7 типов документов), **Сменить валюту...** (AED/EUR/USD/RUB), Сбросить
- **Типы документов** (v6): receipt 🧾 Чек, invoice 📄 Фактура, bill 🧮 Счёт (коммуналка/comunidad/связь), insurance 🛡️ Страховка, bank 🏦 Банк, contract 📑 Договор, other 📎 Другое. Единая карта DOC_TYPE_LABELS в App.js — используется в селекторе загрузки, фильтре «Тип», массовой смене типа, бейдже карточки, модалке, поиске. AI определяет тип по правилам промпта (п.12): FACTURA от провайдера услуг (Iberdrola, Telefónica...) → bill, не invoice
- **Чекбокс «Выбрать все на странице» — контролируемый:** checked по selectedReceiptIds, `indeterminate` при частичном выборе; после массовых операций галочка снимается автоматически
- **Фильтры Excel-стиль** (ExcelFilter): Год, Месяц, Тип, Объект — поиск по значениям, чекбоксы, «Авто-применение», «Применить»/«Очистить»; dropdown 240px, maxWidth 92vw, автовыравнивание у правого края
- Таймаут загрузки 180000 мс

## 12. Известные проблемы и решения

| Проблема | Решение |
|---|---|
| Нет перевода raw_text_ru | 1) В БД выполнить `alter table receipts add column if not exists raw_text_ru text;` (без колонки filterRecordByColumns МОЛЧА выбрасывает перевод!) 2) Деплой актуального index.js (ensureRawTextRu дозапрашивает перевод) 3) Старые чеки — «Перераспознать» |
| 502 Bad Gateway / CORS | auth in-memory (без fs), Railway-safe |
| `Invalid key` при upload в Storage | sanitizeFilename (Ñ, кириллица, пробелы) |
| Kimi падает на распознавании, но активен в пинге | НЕ передавать temperature; большой лимит токенов |
| Kimi "suspended due to insufficient balance" | Пополнить platform.kimi.ai → Billing (баланс общий с recept-web!) |
| gemini-1.5-flash 404 | Модель снята → default gemini-2.5-flash |
| Groq короткие имена → молчаливый fallback | GROQ_ALIASES на бэкенде |
| Railway Build failed | Root Directory (backend/frontend) в Settings сервиса |
| Railway отдаёт старую сборку | `NO_CACHE=1` + Redeploy (или Cmd+K → Deploy latest commit) |
| Браузер кэширует фронт | Жёсткое обновление Cmd+Shift+R |
| Frontend Build failed: "Definition for rule 'react-hooks/exhaustive-deps' was not found" | В проекте нет eslint-плагина react-hooks — НЕЛЬЗЯ использовать комментарии `eslint-disable-next-line react-hooks/...` в App.js, сборка CRA падает и фронт остаётся СТАРЫМ |
| Bucket not found | SQL из supabase/setup.sql в БД householder |

## 13. Порядок деплоя

1. **Supabase (householder):** выполнить `supabase/setup.sql` (таблица + raw_text_ru + bucket + policies), затем `supabase-migration-v7.sql` (objects + subtype/provider/valid_*/meta/related_id/object_id), затем `supabase-migration-v9.sql` (поля коммунальных счетов), затем `supabase-migration-v13.sql` (page_urls — все страницы документа)
2. **Railway householder-api:** репо GitHub, Root Directory `backend`, Build `npm install`, Start `node index.js`, Variables (п. 4 — ключи Supabase ОТ ПРОЕКТА HOUSEHOLDER). В backend/package.json обязательна зависимость `"pdf-lib": "^1.17.1"` (постраничный режим, v10)
3. **Railway householder-web:** репо GitHub, Root Directory `frontend`, Build `npm run build`, Start `npx serve -s build`; в App.js `API_URL = 'https://householder-api-production.up.railway.app'`
4. Проверка: `https://householder-api-production.up.railway.app/api/check-models` → JSON со всеми провайдерами

## 14. Changelog

**2026-08-04 (текущая финальная версия, v24 — банковские выписки: импорт Excel + автопривязка фактур к платежам во вкладке «Анализ»)**
- ТРЕБУЕТ миграцию supabase-migration-v20.sql (таблица bank_movements + receipts.bank_movement_id/paid_date; notify pgrst)
- Бэкенд (версия 2026-08-04.22):
  - POST /api/import-bank-statement (requireAuth, upload.single('statement')): парсит выписку Ruralvía .xlsx (Nombre/IBAN в первых 8 строках; строка заголовка «Fecha de la operación/Importe»; excelDateToIso для дат; prefix/concept из «rcbo: CONTRATO…»); дедуп upsert onConflict 'iban,entry_number' (повторный импорт не затирает совпадения); после вставки — runBankMatching; ответ {imported, account, iban, autoMatched, unmatchedPayments}
  - GET /api/bank-movements — до 1000 движений, order operation_date desc
  - runBankMatching(ownerId, iban): только расходные движения (amount<0) без привязки × чеки без bank_movement_id; скоринг: сумма exact ±0.01 (гейт +50) + counterpartySim (containment токенов, NFD-strip, стоп-слова incl. sa/sl/sau/bv/inc) max(store_name/store_name_ru/provider)×30 + окно дат (чек до платежа: −2..+45д = +15; −7..+75д = +8) + strong ID (№ фактуры/договора ≥5 цифр в concept) +40; auto если strong ИЛИ (≥80 с запасом ≥10 над 2-м кандидатом). Побочный эффект: movement matched_receipt_id/match_status 'auto'/match_score/matched_at + receipt payment_status 'paid', paid_date=operation_date, bank_movement_id; в одном прогоне чек не используется дважды (best.r.bank_movement_id помечается)
  - withDbSchemaHint: подсказка миграции v20 для ошибок /bank_movements/i (v19 — для /payment_status/i)
  - diagnostics: v20_receipts_bank_columns (bank_movement_id+paid_date), v20_bank_movements_table, fix_v20_if_false
  - Unit-тест на реальной выписке movimientos-30.xlsx: 248/248 движений; авто-совпадения AXA→95б, Comunidad→88б, O2×2, Telefónica, AEAT (strong); поступления Booking/Airbnb игнорируются; платёж O2 44.42 НЕ привязан к чеку Plenitude (гейт по имени)
- Фронт:
  - Кнопка «🏦 Выписка банка» (зелёная #16a085) в тулбаре загрузки + hidden input accept .xlsx,.xls → handleStatementSelect (FormData 'statement', alert со статистикой, loadReceipts)
  - Вкладка «📊 Анализ»: stats-карточки (движения/платежи/привязано/без фактуры/неоплаченные фактуры), фильтр (все/расходы/поступления/привязанные/без фактуры), поиск по concept/counterparty, кнопка 🔄 (loadBankMovements); строка движения: дата | concept+prefix | сумма (красная/зелёная) | 🟢 кнопка привязанного чека (match_score, → openReceiptById открывает модалку) или ⚪ «Без фактуры»
  - Модалка документа: строка «Дата оплаты: … 🏦 по выписке» при paid_date (+ bank_movement_id)
  - Watchdog-подстрочники подняты до 2026-08-04.22
  - Список чеков снова только при activeTab 'list' (вкладка Анализ теперь своя вёрстка)

**2026-08-04 (v23.2 — карточка: только значок оплаты; новая вкладка «Анализ»)**
- Из списочной карточки УБРАНА текстовая плашка «🟢 Оплачено» под количеством товаров — остался только круглый значок оплаты в правом верхнем углу шапки (после бейджа типа): 🟢/🟠/🔴 с tooltip
- Новая вкладка «📊 Анализ» в верхней навигации (рядом с «Загрузка» и «Чеки/фактуры»): дублирует окно чеков/фактур — активен при activeTab 'analysis', список рендерится при 'list' И 'analysis' (одна и та же вёрстка, отдельная точка входа; при переключении — loadReceipts). Дальше вкладку можно развивать независимо (графики/сводки)
- Бэкенд без изменений (версия 2026-08-04.21)

**2026-08-04 (v23.1 — диагностика ошибки «payment_status column … schema cache»)**
- ПРОБЛЕМА (скриншот): массовая смена оплаты падает с ошибкой Supabase «Could not find the 'payment_status' column of 'receipts' in the schema cache», метки оплаты в карточках нет — колонки payment_status в БД НЕТ: миграция v19 не выполнена / выполнена не в том проекте Supabase (у пользователя ДВА проекта: householder и recept!) / PostgREST держит старый кэш схемы после ALTER TABLE
- РЕШЕНИЕ для пользователя: выполнить supabase-migration-v19.sql в SQL Editor ПРОЕКТА householder (хост = SUPABASE_URL в Railway Variables householder-api); файл теперь содержит `notify pgrst, 'reload schema';` (принудительное обновление кэша PostgREST) + проверочный select (0 строк = не тот проект)
- Backend: withPaymentStatusHint — к любой ошибке, где фигурирует payment_status (PUT /api/receipts/:id, bulk-update-payment-status), добавляется понятное РЕШЕНИЕ прямо в текст ошибки; filterRecordByColumns — громкое console.warn, если статус отброшен из-за отсутствия колонки (раньше терялся молча)
- Версия бэкенда: 2026-08-04.21 (watchdog обновлён синхронно)

**2026-08-04 (v23 — значок оплаты в углу карточки + быстрая менюшка оплаты + массовая смена)**
- Списочная карточка: в правом верхнем углу (в шапке, сразу после бейджа типа) круглый значок статуса оплаты — 🟢 Оплачено / 🟠 К оплате / 🔴 Недоплачено (PAYMENT_STATUS_META.short), цветная рамка+фон, tooltip с полным названием; показывается только если статус задан
- Модалка (просмотр): вместо статичного бейджа — МЕНЮШКА «Оплата:» (select, окрашен по текущему статусу): меняет статус СРАЗУ без режима редактирования — quickSavePaymentStatus: оптимистичное обновление UI + PUT /api/receipts/:id { payment_status }, при ошибке alert + перезагрузка списка (откат)
- Массовые действия: селект «Сменить оплату...» (после «Сменить подтип...») — три статуса + «✖ Очистить статус» (__clear → null); backend POST /api/bulk-update-payment-status { ids, payment_status } — валидация sanitizePaymentStatus, пустое значение = очистка
- Версия бэкенда: 2026-08-04.20 (watchdog обновлён синхронно)

**2026-08-04 (v22 — статус оплаты документа: к оплате / оплачено / недоплачено)**
- Новое поле receipts.payment_status (text): 'to_pay' = 🟠 К оплате, 'paid' = 🟢 Оплачено, 'underpaid' = 🔴 Недоплачено, null = не указан. Это ОТДЕЛЬНОЕ поле, НЕ часть subtype (подтип — услуга: electricity/water/..., его определяет AI; статус оплаты — только ручной выбор, AI его не трогает)
- МИГРАЦИЯ: supabase-migration-v19.sql — `alter table receipts add column if not exists payment_status text;` (выполнить в Supabase SQL Editor; diagnostics → v19_payment_status_column + fix_v19_if_false). Без миграции статус молча не сохранится (filterRecordByColumns отсечёт)
- Backend: sanitizePaymentStatus (только 3 значения, иначе null); saveReceiptToDB + оба upload-эндпоинта (upload-receipt, upload-document-pages — paymentStatusOverride из формы); PUT /api/receipts/:id — payment_status в EDITABLE; fallback-списки колонок дополнены
- Frontend: PAYMENT_STATUS_META (label/цвет/фон); селект «Оплата:» в форме загрузки (между Подтип и Объект, по умолчанию «— Не указан», уходит как payment_status во всех трёх загрузках); карточка-просмотр — строка «Оплата:» с цветным бейджем; карточка-редактирование — селект «Статус оплаты»; список — цветной бейдж под количеством товаров
- Версия бэкенда: 2026-08-04.19 (watchdog обновлён синхронно)

**2026-08-03 (v21.1 — вёрстка карточки: заголовок больше не рвётся по 3 буквы)**
- ПРОБЛЕМА (мобильный скриншот «исправь верстку»): в шапке карточки чекбокс + заголовок + бейдж типа стоят в одной flex-строке без переноса; длинный бейдж «🤝 КОММ. ПРЕДЛОЖЕНИЕ» (~200px) на узком экране оставлял заголовку ~100px → «Conf/ort/de/Tener/ife/Sur»; wordBreak:'break-word' дополнительно рвал слова посередине
- РЕШЕНИЕ (frontend, receipt-header): flexWrap:'wrap' + заголовок flex:'1 1 180px' (гарантированный минимум — при нехватке места бейдж переносится ПОД заголовок, прижимаясь вправо marginLeft:'auto'); h3: overflowWrap:'break-word' вместо wordBreak — перенос по словам, разрыв только при крайней необходимости. На десктопе раскладка визуально прежняя
- Бэкенд без изменений (версия 2026-08-03.18)

**2026-08-03 (v21 — починка распознавания плотных таблиц / коммерческих предложений)**
- ПРОБЛЕМА (скриншоты «не сработало распознавание», 2-стр. коммерческое предложение Confort de Tenerife Sur — смета с мелким текстом): постраничное OCR вернуло ПУСТУЮ СЕТКУ таблицы (рамка из | и -, содержимое ячеек потеряно) → перевод честно перевёл пустоту (панель «Перевод» = пустые строки таблицы) → сводке не из чего было извлечь поля: «Без названия», без суммы, «1 товар». Тип proposal сработал только потому, что выбран вручную при загрузке
- Дополнительно найдено: правка v20 со списком из 10 типов в buildDocumentSummaryPrompt (страничный режим) была потеряна при хотфиксе «мусорного хвоста» — восстановлена (document_type из [bill, invoice, contract, insurance, bank, receipt, municipality, tax, proposal, other] с пояснениями + framing с Ayuntamiento/AEAT/presupuesto)
- РЕШЕНИЕ (backend): 1) looksLikeEmptySkeleton(text) — детектор пустой сетки: ≥4 строк только из [|_\-—–+\s.:] и ≥50% строк, либо <40 видимых знаков; маркеры «(…)» не считаются; 2) extractPageTextWithGemini — промпт с жёсткими правилами таблиц (КАЖДАЯ строка построчно, ячейки через « | », нечитаемое → [неразборчиво], пустая рамка ЗАПРЕЩЕНА) + ОДИН повтор с усиленным промптом (16384 токена, temperature 0), если результат похож на скелет; берётся лучший/длиннейший результат; 3) buildTranslatePrompt: «если текст УЖЕ на русском — верни без изменений», «таблицы переводи построчно, пустая сетка запрещена»; 4) finalizeDocumentFromPageTexts: перевод пуст/скелет при содержательном оригинале → показываем ОРИГИНАЛ (содержимое важнее языка); 5) запасные поля после сводки: store_name из первых содержательных строк 1-й страницы (до 90 зн.), total_amount — regex по «Общая сумма/Итого/Total factura/importe total/precio de compraventa…» + parseAmountLike (форматы 60 736,00 / 60.736,00 / 60,736.00 / 60736)
- РЕШЕНИЕ (frontend): растеризация PDF scale 2.0 → 2.5 в convertPdfToImages — мелкий текст плотных таблиц (сметы, КП) читается моделью заметно лучше; рост размера страниц ~×1.5 приемлем (лимиты upload прежние)
- Юнит-тест: пустая сетка 40 строк → скелет; markdown-рамка → скелет; маркеры «(страница без текста)»/«(ошибка…)» → НЕ скелет; заполненная таблица → НЕ скелет; parseAmountLike 9 форматов; regex запасной суммы на тексте КП («Общая сумма 60736» → 60736) и «Total factura: 460,34 EUR» → 460.34
- Уже сохранённые «пустые» документы: «Распознать заново» (reprocess) после деплоя — поля и перевод заполнятся
- Версия бэкенда: 2026-08-03.18 (watchdog обновлён синхронно)

**2026-08-03 (v20 — новые типы документов: мэрия, налоговая, коммерческое предложение)**
- DOC_TYPE_LABELS (frontend, единый источник для фильтра «Тип», селектов загрузки/редактирования/массовой смены): + municipality «🏛️ Мэрия», tax «💰 Налоговая», proposal «🤝 Комм. предложение»
- Backend: правило 12 промпта — определения: municipality = документы Ayuntamiento (informe urbanístico, licencias, tasas); tax = налоговые органы (AEAT/Hacienda: IBI, IAE, declaraciones, liquidaciones); proposal = presupuesto/oferta/cotización (НЕ счёт к оплате); списки допустимых значений расширены в санитайзере document_type и ALLOWED_TYPES массовой смены; промпт сводки многостраничных документов — полный список из 10 типов; правило 15 (subtype/provider) действует и на новые типы
- HOTFIX: в хвосте index.js обнаружен и удалён мусорный дубль (обрывок catch + повторный START-блок после app.listen) — с ним бэкенд не стартовал бы; node --check зелёный
- Версия бэкенда: 2026-08-03.17 (watchdog обновлён синхронно)

**2026-08-03 (v19 — фактуры в постраничном режиме больше не «договоры»)**
- ПРОБЛЕМА (скриншот «фактуры стали распознаваться как договор»): 3-страничная фактура Plenitude попадает в постраничный режим (порог >2 стр.), а промпт сводки buildDocumentSummaryPrompt предлагал document_type ТОЛЬКО из [contract, insurance, bank, other] — типа «счёт» не существовало, счёт классифицировался как contract; плюс дефолты при неопределённости тоже были 'contract' (finalize fallback и обработчик upload-document-pages)
- РЕШЕНИЕ: промпт сводки переписан — документ может быть счёт за коммуналку (factura de electricidad/agua/gas — consumo, CUPS, período), торговая фактура, договор, полис, выписка, уведомление; document_type — полный список [bill, invoice, contract, insurance, bank, receipt, other] с пояснениями (bill = factura/informe de consumo/CUPS/lecturas); receipt_date для счёта = fecha de emisión; total_amount для счёта = Total factura; примеры store_name для счёта и договора
- Дефолты 'contract' → 'other' при полной неопределённости (нет имени и даты / нет document_type)
- Уже сохранённые неверно типированные документы: либо ✏️ Редактировать → тип (v14), либо массовая смена типа, либо «Распознать заново» (reprocess) — заодно заполнятся пустые поля (адрес, CUPS, № договора)
- Версия бэкенда: 2026-08-03.16 (watchdog обновлён синхронно)

**2026-08-03 (v18 — проверка перед статусом КОПИЯ: разные договоры больше не дубли)**
- ПРОБЛЕМА: дубликаты искались по ключу «название+дата+сумма»; у договоров без названия («Без названия»), даты и суммы ключ пустой и одинаковый у всех → РАЗНЫЕ контракты (Reykjavik 78084 кВт·ч vs Callao 39967 кВт·ч!) склеивались в группу, поздние получали бейдж КОПИЯ
- РЕШЕНИЕ (frontend, поиск дубликатов): 1) документы совсем без идентичности (ни названия, ни даты, ни суммы) в группы не включаются; 2) внутри группы — проверка по СИЛЬНЫМ идентификаторам (contract_number, cups, invoice_number, supply_address, object — 'other' не улика): если у обоих поле заполнено и значения различаются (без частичного вхождения) → разные документы; 3) ДОПОЛНЕНИЕ (тот же день, скриншот «все равно копия»): если структурные поля пусты — сравнение РАСПОЗНАННОГО ТЕКСТА: CUPS-коды (ES[0-9A-Z]{14,24}) у обоих и не пересекаются → конфликт; наборы чисел ≥5 цифр (№ договора, потребление кВт·ч, телефоны) — Жаккар < 0.7 → конфликт. Юнит-тест: два договора ОДНОГО клиента с разными точками поставки (Alcojora 46189 vs Callao 39967, поля в БД пустые) разведены; настоящий дубль (текст совпадает) и дубль чека без raw_text — ловятся
- Tooltip бейджа обновлён: «совпадают название, дата и сумма, а № договора/CUPS/адрес НЕ различаются»
- Бэкенд без изменений (версия 2026-08-03.15)

**2026-08-03 (v17 — перевод выбранной страницы рядом с изображением в карточке)**
- Frontend, галерея страниц в модалке: при выборе страницы (миниатюра/‹select›/свайп навигации) РЯДОМ с изображением сразу показывается текст этой страницы — по умолчанию 🇷🇺 перевод (из raw_text_ru), переключатель «Оригинал» (из raw_text). Панель: maxHeight 55vh, прокрутка, pre-wrap; на узких экранах заворачивается под изображение (flex-wrap)
- Хелпер extractRawPage(rawText, pageNum): режет raw_text/raw_text_ru по заголовкам «══════ СТРАНИЦА N из M ══════» (юнит-тест: первая/средняя/последняя/несуществующая страницы, null)
- Состояние pageTextLang ('ru'|'orig'), сбрасывается при смене чека; если для страницы нет перевода — автопоказ оригинала, неактивная кнопка disabled; если нет ни того ни другого — панель не рендерится
- ФИКС «перевод уезжает за правый край и обрезается» → КАРДИНАЛЬНОЕ РЕШЕНИЕ (browser-independent): отказ от CSS-flex классов модалки для документов с галереей. Корневая причина — .modal-image-section в CSS = flex:0 0 300px (узкая колонка рядом с modal-info), любой широкий контент внутри переполнял её вправо. Теперь: при наличии page_urls modal-body получает inline display:block (flex отключён полностью), галерея — самодостаточный блочный layout: две колонки через display:table + tableLayout:fixed (58% изображение / 42% текст — ширины гарантированы спецификацией, одинаково в Chrome/Safari/Firefox), колонки table-cell с verticalAlign:top; первая попытка (inline flex:1 1 100% на секции) отменена как недостаточно надёжная
- Мобильная раскладка: хук winWidth (resize listener); при ширине <900px колонки отключаются — изображение сверху по центру, панель перевода под ним на всю ширину (maxHeight 45vh); однофайловые чеки — прежняя раскладка CSS-классом (modal-image-section + modal-info рядом)
- Бэкенд без изменений (версия 2026-08-03.15)

**2026-08-03 (v16 — асинхронные задачи: «Ошибка сети» на длинных документах устранена)**
- ДИАГНОЗ (скриншот «Ошибка: Ошибка сети» на 92% при 21-стр. контракте): прокси Railway жёстко обрывает HTTP-запросы дольше ~5 минут (по данным 2026; сотрудник Railway в 2025 говорил о 15 мин — фактически лимит есть и не настраивается). Документ в 20+ плотных страниц = vision + перевод каждой страницы = 10–15 мин работы — ответ не успевал вернуться, XHR получал onerror (не timeout и не HTTP-ошибку). Сервер при этом ЖИВ: обработчик продолжает работу после обрыва соединения и документ обычно УСПЕВАЕТ сохраниться в БД — перед повторной загрузкой проверь список, чтобы не плодить дубли
- РЕШЕНИЕ — асинхронные задачи: POST /api/upload-document-pages после загрузки файлов сразу отвечает { jobId } (секунды, до любого таймаута), обработка идёт в фоне; фронтенд опрашивает GET /api/doc-job/:id каждые 4 сек. Хранилище задач — in-memory Map (single-instance Railway), TTL 2 ч, автоочистка; при перезапуске сервера задача теряется → 404 → понятное сообщение «загрузите заново»
- Реальный прогресс вместо «ползущих» процентов: assembleDocumentFromPages/finalizeDocumentFromPageTexts принимают колбэки onProgress/onTranslate (try/finally — ошибка страницы не ломает счётчик); фронт маппит: vision 40–70%, перевод 70–95%, финализация 96–97%
- Frontend: recognizeDocumentPages поддерживает оба ответа (jobId → опрос; прямой результат → старый синхронный путь — совместимость со старым бэкендом); лимит опроса 25 мин с подсказкой проверить список
- Сообщения об ошибках XHR: «Ошибка сети» → «Соединение оборвано… документ мог успеть сохраниться — обновите список»; устаревшие «(300 сек)» → «(15 мин)»
- ОГРАНИЧЕНИЕ (не закрыто): /api/reprocess-receipt для длинных PDF всё ещё синхронный — тот же риск таймаута; upload-receipt с целым длинным PDF — тоже (из веб-UI редкость: PDF растрируется на страницы во фронте)
- Версия бэкенда: 2026-08-03.15 (watchdog обновлён синхронно)

**2026-08-03 (v15 — все страницы плотных документов распознаются без потерь)**
- ПРОБЛЕМА (на примере CONTRATO PLENITUDE, 21 стр.): у плотных договоров 18–25 тыс. знаков на страницу; в режиме ranges диапазон из 5 страниц = до ~100 тыс. знаков дословного текста, что НЕ влезает в maxOutputTokens 16384 → ответ Gemini обрезался по MAX_TOKENS → последние 1–2 страницы диапазона тихо терялись («(страница не распознана)»)
- РЕШЕНИЕ в recognizeLongPdfByPageRanges: диапазоны уменьшены с 5 до 3 страниц, maxOutputTokens поднят до 24576; extractPageRangeTextWithGemini теперь возвращает { text, truncated } по finishReason === 'MAX_TOKENS'; после первого прохода ВСЕ страницы, которые не распознались или попали в обрезанный/упавший диапазон, дозапрашиваются ПО ОДНОЙ (одна страница всегда влезает в лимит); запасной разбор, если модель не поставила заголовок ═══ на единственной странице (срезаем маркер сами, берём весь текст). Юнит-модель на 21 страницу (обрезанный диапазон + упавший диапазон + тихо потерянная страница + ответ без маркера): потерь 0
- extractPageTextWithGemini (pdf-lib путь): maxOutputTokens 8192 → 12288 — плотная страница 22 тыс. знаков ≈ 6–7 тыс. токенов + thinking-запас gemini-2.5
- ФИКС «лимит 10 страниц при загрузке PDF»: convertPdfToImages во frontend обрезал PDF до 10 страниц (Math.min(numPages, 10)) — поднято до 60 (= лимит бэкенда upload.array('pages', 60)); контракт на 21 стр. теперь идёт целиком через /api/upload-document-pages (каждая страница — vision-запрос + сохранение в page_urls/галерею). Добавлен индикатор «⏳ Конвертирую PDF в страницы…» (состояние preparingPdf) — рендер длинного PDF в браузере занимает до минуты и раньше выглядел как зависание
- Версия бэкенда: 2026-08-02.14 (watchdog обновлён синхронно; фикс лимита — только frontend, App.js)

**2026-08-02 (v14 — ручное редактирование полей в карточке чека)**
- Frontend: кнопка «✏️ Редактировать» в футере модалки → форма (жёлтой панелью над «Основная информация»): название ориг/рус, тип, объект, подтип, поставщик, дата/время, сумма/валюта, действует с/до, адрес поставки, № фактуры, № договора, CUPS, № счётчика, потребление+ед. Сохранение → PUT /api/receipts/:id (бэкенд-эндпоинт существовал с v7); пустая строка → null, суммы → числа; после сохранения обновляются и список, и открытая карточка. Режим сбрасывается при смене чека (тот же useEffect, что и modalPageIdx)
- Галерея страниц при >10 страницах: вместо переносимой ленты всех миниатюр — компактная навигация ‹ + select «Страница N из M» + › и однорядная прокручиваемая лента (overflow-x:auto, миниатюры 46px); ≤10 страниц — прежний режим
- ФИКС «линия через кнопки футера» (Safari): пиксель-анализ показал «призрак» оранжевой кнопки ✏️ Редактировать (#f39c12) — Safari с backdrop-filter на overlay оставляет stale-слой при unmount при переключении режима. Решение: кнопки Редактировать/Отмена/Сохранить всегда смонтированы и прячутся через display:none (без mount/unmount); + flexShrink:0 на modal-header/modal-footer и minHeight:0 на modal-body (классический фикс сжатия футера в flex-column Safari)
- ФИКС вёрстки шапки карточки: бейджи (КОПИЯ/ОРИГИНАЛ, истекает, 📑 N стр.) переехали ПОД название во flex-wrap ряд — три бейджа больше не сжимают заголовок в вертикальный столбик букв
- Бэкенд без изменений (версия 2026-08-02.13)

**2026-08-02 (v13 — все страницы документа сохраняются в базе и показываются в карточке)**
- Новая колонка receipts.page_urls JSONB (миграция supabase-migration-v13.sql) — массив публичных URL ВСЕХ страниц документа в Storage (bucket receipt-images)
- Backend: хелпер uploadPagesToStorage (3 параллельно, ошибка одной страницы не роняет документ); assembleDocumentFromPages и recognizeLongPdfByPages принимают userId и сохраняют каждую страницу; /api/upload-document-pages больше не грузит первую страницу дважды — обложка = page_urls[0]; reprocess обновляет page_urls (только если постраничный режим реально сохранил страницы); page_urls в PUT whitelist и обоих fallback-списках getTableColumns
- Когда page_urls пуст: однофайловые чеки (достаточно image_url) и режим ranges без pdf-lib (нет буферов отдельных страниц — есть только целый PDF в image_url). Для полноценных страниц длинных PDF — поставь pdf-lib
- Frontend: в модалке карточки блок изображения стал ГАЛЕРЕЕЙ страниц — большой просмотр выбранной страницы (клик → полноэкранный зум; PDF-страница — кнопка «открыть в новой вкладке»), лента миниатюр/номеров с подсветкой активной, подпись «📑 Страница N из M»; состояние modalPageIdx сбрасывается при смене чека; на карточке в списке — фиолетовый бейдж «📑 N стр.»
- /api/diagnostics: флаг v13_page_urls_column + SQL-фикс
- Версия бэкенда: 2026-08-02.13 (watchdog обновлён синхронно)

**2026-08-02 (v12 — постраничный режим работает БЕЗ pdf-lib)**
- Устранена жёсткая зависимость от pdf-lib (его отсутствие на Railway = причина молчаливой поломки v10: весь PDF уходил в kimi одним куском → «распознана 1 страница»). Теперь ДВА пути постраничного режима:
  1) pdf-lib есть → разрезка на 1-страничные PDF, vision по страницам (как v10)
  2) pdf-lib нет → recognizeLongPdfByPageRanges: Gemini читает ЦЕЛЫЙ PDF, текст запрашиваем диапазонами по 5 страниц («═══ Страница K ═══» заголовки), splitRangeTextsToPages раскладывает по страницам (юнит-тест в changelog v12 проверен)
- Подсчёт страниц каскадом: pdf-lib → regex «/Type /Page» → getPdfPageCountViaGemini (Gemini видит PDF и отвечает числом); 0/1 → старый цельный режим
- Ошибка 500 «установи pdf-lib» УБРАНА — режим просто работает иначе; recognition_method показывает путь: «page-by-page Np ranges (gemini, pdf-lib отсутствует)». pdf-lib всё ещё рекомендован (точнее и дешевле по контексту)
- assembleDocumentFromPages разделён: финализация (перевод по страницам + модули + JSON-сводка) вынесена в finalizeDocumentFromPageTexts — общая для трёх путей (PDF-разрезка, PDF-диапазоны, многофайловые страницы)
- Версия бэкенда: 2026-08-02.12 (watchdog обновлён синхронно)

**2026-08-02 (v11 — HOTFIX «не распознает N-1 страниц»: многофайловая загрузка как страницы + защиты)**
- КОРЕНЬ БАГА: recognizeAndSave отправлял ТОЛЬКО selectedFiles[currentFileIndex] — при выборе 7 файлов-страниц распознавалась одна. Плюс PDF, отправленный vision-модели без поддержки PDF (Kimi/Groq/OpenRouter/Mistral), читался как «картинка» → первая страница
- Несколько выбранных файлов = СТРАНИЦЫ ОДНОГО документа: recognizeDocumentPages отправляет все файлы в новый POST /api/upload-document-pages (upload.array('pages', 60)); бэкенд собирает их тем же постраничным конвейером (assembleDocumentFromPages — вынесен из recognizeLongPdfByPages, работает и с изображениями, и с 1-страничными PDF); обложка документа — первая страница. Кнопка: «Распознать N страниц как один документ» + синяя подсказка под превью
- Защита от молчаливой деградации pdf-lib: getPdfPageCount при отсутствии пакета считает страницы regex по «/Type /Page»; если PDF многостраничный, а pdf-lib НЕ установлен — upload/reprocess возвращают 500 с ЯВНОЙ инструкцией (вместо тихого неверного результата); /api/diagnostics показывает pdf_lib: true/false + fix
- PDF + модель без поддержки PDF (Kimi/Groq/OpenRouter/GitHub/Mistral): автоматически переключается на fallback-цепочку (Gemini читает PDF), recognition_method = «kimi-k3 (pdf → gemini-…)» — и в upload, и в reprocess
- Версия бэкенда: 2026-08-02.11 (watchdog обновлён синхронно)

**2026-08-02 (v10 — многостраничные документы: распознавание и вывод ПО СТРАНИЦАМ)**
- Постраничный режим для договоров/эскритур/выписок/полисов: PDF длиннее 2 страниц (LONG_PDF_PAGE_THRESHOLD) обрабатывается иначе — pdf-lib разбивает документ на 1-страничные PDF; каждая страница распознаётся Gemini vision отдельным запросом (дословный текст оригинала, без JSON); raw_text собирается модулями `══════ СТРАНИЦА N из M ══════`; перевод — тоже ПО СТРАНИЦАМ (translateRawText на каждую), raw_text_ru с теми же модулями; параллельность 3 (runWithConcurrency — RPM-лимиты); страница с ошибкой не роняет документ — встаёт плашка «(ошибка распознавания страницы)»
- JSON-сводка полей (название, дата, сумма сделки, тип, адрес, № протокола/договора, объект по адресу) — отдельным текстовым запросом callTextChain (Gemini → Groq → OpenRouter/GitHub/Mistral/Kimi) по началу (12k) + концу (5k) документа, через buildDocumentSummaryPrompt; результат прогоняется через обычный parseAIResponse
- Режим работает и в upload-receipt, и в reprocess-receipt; recognition_method = `page-by-page Np (gemini vision)`
- **НОВАЯ ЗАВИСИМОСТЬ backend/package.json: `"pdf-lib": "^1.17.1"`** (pure JS, Railway-safe, нативных бинарей не требует). Без неё getPdfPageCount вернёт 1 → старый цельный режим (деградация безопасная)
- Таймаут фронта при загрузке: 300 сек → 900 сек (29-страничная эскритура: ~29 vision-запросов + ~29 переводов)
- Δ (разница сумм) теперь только для receipt/invoice/bill: у договоров/полисов/выписок нет товарных строк — Δ и её фильтр не показывают шум (diffOf → null → корзина «— Нет сумм»)
- Тестовый документ: ESCRITURA JARDINES DEL DUQUE 19.09.2017 — 29 страниц, ПОЛНОСТЬЮ скан без текстового слоя (только vision)
- Версия бэкенда: 2026-08-02.10 (watchdog обновлён синхронно)

**2026-08-02 (v9 — коммунальные счета: поля, авто-объект по адресу, оригинальные названия)**
- Поля счетов за воду/свет (миграция supabase-migration-v9.sql): invoice_number (№ фактуры), contract_number (№ договора), supply_address (Dirección de suministro), cups (электричество), meter_number (счётчик воды), consumption + consumption_unit ('kWh'|'m3'). Промпт правило 16; parseAIResponse/save/reprocess/PUT whitelist прокидывают; модалка показывает блок (Адрес поставки, № фактуры, № договора, CUPS, № счётчика, Потребление); на карточке — адрес поставки и потребление рядом с объектом; всё searchable
- Авто-объект по адресу поставки (промпт правило 17 + ДЕТЕРМИНИРОВАННАЯ страховка): OBJECT_ADDRESS_MAP в index.js — Reykjavik → Duqe, Callao → Maria, Alcojora → Kit. detectObjectByAddress(supply_address, raw_text) срабатывает даже если модель проигнорировала правило. Приоритет: явный выбор пользователя в форме (≠'other') > AI/карта > 'other'. Reprocess обновляет object только если определён
- Провайдер→подтип (промпт правило 18): AQUALIA/ENTEMANSER/муниципальная вода → water; IBERDROLA/ENDESA/PODO → electricity
- Оригинальное название в заголовке: карточка, модалка, панели результата показывают store_name (оригинал: Iberdrola, Aqualia, PODO), перевод store_name_ru — отдельной строкой «Название (рус)» в модалке; правило 18 требует store_name строго как напечатано
- Версия бэкенда: 2026-08-02.9 (watchdog обновлён синхронно)

**2026-08-02 (v8 — подтип как сущность + зум изображений)**
- Подтип (subtype) стал полноценной сущностью: селектор «Подтип» на странице загрузки (🤖 Авто или вручную — ручной выбор перекрывает AI, formData.subtype → upload-receipt); фильтр «Подтип» (ExcelFilter, значение 'none' = без подтипа); массовое действие «Сменить подтип...» → POST /api/bulk-update-subtype
- Промпт (правило 15): subtype ОБЯЗАТЕЛЕН и для invoice, если это фактура за услуги (свет/вода/интернет/мусор/связь/comunidad) — «подтип фактуры»; добавлен waste (basura/recogida de residuos)
- ФИКС логики: бейдж «⚠️ Истекает / ⛔ Истёк» — ТОЛЬКО для insurance/contract; у bill/bank valid_to — это конец расчётного периода (в модалке для них подпись «Период» вместо «Действует»). Раньше оплаченный счёт Iberdrola 2024 ошибочно показывал «⛔ Истёк»
- Увеличение изображений на странице распознавания: клик по превью в drop-zone открывает полноэкранный просмотр (раньше клик по превью открывал файловый диалог — превью внутри label htmlFor!); в полноэкранном режиме клик по фото переключает «уместить в экран ⇄ натуральный размер» (fsZoom), скролл, Esc — закрыть. Тот же просмотр используется в модалке карточки и панелях результата
- Версия бэкенда: 2026-08-01.8 (watchdog обновлён синхронно)

**2026-08-01 (v7 — домашние документы, шаг 2: объекты и метаданные)**
- Модель данных: ОДНА таблица receipts (все документы) + таблица objects (дома: name UNIQUE, address, notes) + гибкие колонки вместо таблицы-под-тип: subtype, provider, valid_from, valid_to, meta JSONB, related_id (связь документ→документ), object_id (FK). Миграция — supabase-migration-v7.sql: сидит objects из distinct receipts.object и бэкфиллит object_id по имени
- Бэкенд: GET /api/objects (fallback на distinct receipts.object + флаг migration_needed, если миграция не выполнена — НЕ ломается), POST /api/objects; PUT /api/receipts/:id — редактирование полей по whitelist; parseAIResponse извлекает subtype (whitelist из 13 значений)/provider/valid_from/valid_to (промпт правило 15); saveReceiptToDB и reprocess-receipt сохраняют новые поля; diagnostics показывает v7_columns
- Фронт: объекты загружаются из /api/objects (запасной список DEFAULT_OBJECTS при ошибке); SUBTYPE_LABELS (⚡ электричество, 💧 вода, 🌐 интернет и т.д.); expiryInfo — бейджи «⚠️ Истекает через N дн.» (≤30 дней, оранжевый) и «⛔ Истёк» (красный) на карточке и в модалке; модалка показывает Подтип/Поставщик/Действует; поиск по provider и подтипу
- Версия бэкенда: 2026-08-01.7 (watchdog обновлён синхронно)

**2026-08-01 (v6 — домашние документы, шаг 1)**
- Типы документов расширены end-to-end: receipt 🧾 Чек, invoice 📄 Фактура, bill 🧮 Счёт/квитанция (коммуналка, comunidad, связь, подписки), insurance 🛡️ Страховка, bank 🏦 Банк (выписки, SEPA-дебет), contract 📑 Договор, other 📎 Другое
- Бэкенд: промпт (правило 12) описывает все 7 типов + различие invoice/bill (счёт от провайдера услуг → bill); parseAIResponse принимает любой тип из whitelist (неизвестное → старая эвристика invoice/receipt); /api/bulk-update-type валидирует все 7
- Фронт: DOC_TYPE_LABELS — единая карта типов; селектор типа при загрузке, фильтр «Тип», массовая «Сменить тип...», бейдж на карточке, «Тип» в модалке — все показывают читаемые названия; поиск находит по названию типа («страховка», «банк»); вкладка списка: «Чеки/фактуры (N) · Прочие документы (M)»
- Версия бэкенда: 2026-08-01.6 (watchdog на фронте обновлён синхронно — обе строки!)
- Roadmap эволюции в «домовладельца»: сроки действия страховок + напоминания, разделы/вкладки по типам, привязка документов к объектам уже есть

**2026-08-01 (v5.3)**
- Фильтр «Разница Δ» (ExcelFilter): корзины ✅ Без разницы (≤0.01) / Δ до 1 / Δ 1–5 / Δ 5–20 / Δ более 20 / — Нет сумм; diffOf/diffBucketOf — та же математика, что Δ на карточке (|total_amount − Σitems|)

**2026-08-01 (v5.2)**
- Фикс поиска: безымянные чеки ищутся по отображаемому «Без названия» (раньше fallback был только в рендере, в данных пусто — запрос «названия» давал 0 результатов); в поиск добавлен raw_text_ru (перевод тоже searchable)

**2026-08-01 (v5.1)**
- Таймауты под длинные чеки (100+ товаров + thinking-модели): фронт XHR 180 сек → 300 сек; бэкенд axios к AI-провайдерам 180 сек → 280 сек; запрос перевода 90 сек → 180 сек. Ошибка «Превышено время ожидания (180 сек)» на длинных чеках устранена

**2026-08-01 (v5)**
- Длинные чеки (100+ товаров): промпт явно запрещает заглушки модуля ТОВАРЫ ("(109 artículos)", "extracto", "..."); лимиты вывода подняты до 16384 (Gemini maxOutputTokens, OpenAI-compat max_tokens; Mistral и Groq — 8192, их потолок); перевод тоже 16384
- rebuildItemsModule: бэкенд-страховка — если модуль ТОВАРЫ в raw_text/raw_text_ru заменён заглушкой, он пересобирается из распознанного массива items (оригинал — name, перевод — name_ru) автоматически в parseAIResponse
- Watchdog версии бэкенда (баннер «Бэкенд устарел») — см. v4.1

**2026-08-01 (v4.1)**
- Watchdog версии бэкенда: фронт при входе запрашивает GET /api/diagnostics; если версия ≠ 2026-08-01.4 (или endpoint 404/недоступен) — красный баннер под шапкой «Бэкенд устарел» с текущей/нужной версией. Решает повторяющуюся проблему «код задеплоен, но Railway крутит старый»
- Подтверждено: index.js v4 корректен; если фронт пишет «Бэкенд старой версии» при задеплоенном свежем файле — деплой на Railway НЕ произошёл фактически (не тот репо/ветка/Root Directory, автодеплой выключен, билд упал)

**2026-08-01 (v4)**
- /api/translate-receipt: перевод возвращается ВСЕГДА (даже без колонки raw_text_ru) + флаг saved и текст warning — фронт показывает перевод в любом случае
- Фронт: при 404 от translate-receipt — явное сообщение «Задеплой свежий index.js!»; при saved:false — предупреждение про колонку; ошибка + кнопка «Повторить» теперь и в окне результата сканирования (оба блока), и в модалке просмотра
- v3.1: HOTFIX сборки фронта (eslint-disable react-hooks ронял npm run build на Railway)

**2026-08-01 (v3)**
- HOTFIX сборки фронта: удалены комментарии `// eslint-disable-next-line react-hooks/exhaustive-deps` — без плагина react-hooks они роняли `npm run build` на Railway ("Definition for rule ... was not found"), из-за чего фронт с переводом/дубликатами НЕ деплоился вообще

**2026-08-01 (v3)**
- Перевод сделан НЕЗАВИСИМЫМ от модели распознавания — 3 уровня защиты:
  1) промпт требует raw_text_ru обязательным; 2) бэкенд дозапрашивает перевод отдельным текстовым запросом (ensureRawTextRu) при загрузке и перераспознавании; 3) ФРОНТ сам дозапрашивает перевод через POST /api/translate-receipt при открытии карточки без перевода и сразу после загрузки (useEffect на viewModal.id / lastSavedReceipt.id) — старые чеки чинятся при первом открытии, результат сразу пишется в БД
- /api/translate-receipt теперь возвращает raw_text_ru текстом (фронт показывает мгновенно)
- В модалке просмотра: «⏳ Перевожу автоматически...» во время перевода; при ошибке — текст причины + кнопка «Повторить» (причина больше не прячется!)

**2026-08-01 (v2)**
- GET /api/diagnostics — открывается в браузере без токена: версия кода, наличие колонки raw_text_ru (+SQL-фикс), какие AI-ключи настроены
- POST /api/translate-receipt — перевод raw_text → raw_text_ru для СУЩЕСТВУЮЩЕГО чека без перераспознавания (дешёвый текстовый запрос)
- Кнопка « Перевести» в панели массовых действий (bulkTranslate) — переводит выбранные чеки
- Поиск и удаление дубликатов: группировка по ключу магазин+дата+сумма; самый ранний по created_at = ОРИГИНАЛ (зелёный бейдж), остальные = КОПИЯ (красный бейдж, видны на карточках всегда); кнопка « Дубликаты (N)» в строке фильтров — режим показа только дубликатов; инфо-панель «Выбрать все копии» → массовое удаление существующей кнопкой
- Гарантия перевода raw_text_ru (ensureRawTextRu), предупреждение об отсутствии колонки, сортировка «По дате чека»/«По дате распознавания» — см. ниже

**2026-08-01 (v1)**
- Гарантия перевода raw_text_ru: если модель опустила поле (kimi-k3 игнорирует обязательность промпта), бэкенд дозапрашивает перевод ОТДЕЛЬНЫМ текстовым запросом (ensureRawTextRu → translateRawText: Gemini 2.5-flash → Groq llama-3.3-70b → OpenRouter/GitHub/Mistral/Kimi). Подключено в upload-receipt и reprocess-receipt
- Предупреждение в логе, если колонка raw_text_ru отсутствует в БД (filterRecordByColumns раньше молча выбрасывал перевод!)
- Сортировка списка чеков: состояния sortMode ('receipt'|'recognized') + sortDir; кнопки «По дате чека» и «По дате распознавания» в строке рядом с «Выбрать все на странице»; повторный клик по активной кнопке меняет направление (↑/↓); группировка по месяцам следует за выбранным режимом (sortDateOf: receipt_date||created_at / recognized_at||created_at)

**2026-07-31**
- Проект householder-web выделен как самостоятельный: свои Railway-сервисы (householder-api, householder-web), своя БД Supabase; API_URL фронта → householder-api
- Перевод распознанного текста (raw_text_ru): обязательное поле промпта («ответ без raw_text_ru невалиден»); лимиты вывода 4096 → 8192 (Gemini maxOutputTokens 8192 + temperature 0.1 явно; OpenAI-compat и Groq max_tokens 8192); фронт отображает перевод в 3 местах
- Массовая смена типа: POST /api/bulk-update-type + select «Сменить тип...»
- Чекбокс «Выбрать все на странице» — контролируемый (+ indeterminate)

**2026-07-30**
- Excel-фильтры (Год/Месяц/Тип/Объект), фикс вёрстки dropdown
- Группировка карточек по годам и месяцам с заголовками «Март 2026 · N шт»
- Имена пользователей: Admin, User 1..10

**2026-07-23**
- Провайдеры: OpenRouter, GitHub Models, Mistral, Kimi; `/api/check-models` живым vision-пингом
- Цепочка fallback: Gemini → OpenRouter → GitHub → Mistral → Kimi
- raw_text модульной структурой; PDF-фронт (pdf.js CDN) + нативный бэкенд
- sanitizeFilename; warning с причиной fallback

**2026-07-08**
- auth in-memory (Railway read-only fs); entry point index.js; bucket receipt-images; /health

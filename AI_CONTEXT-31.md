# Householder-Web — AI Context File (ФИНАЛЬНЫЙ)

Полный контекст проекта для AI-ассистента. Загрузите этот файл в новый чат вместе с `App.js` и `index.js` — ассистент сразу поймёт архитектуру, историю и текущее состояние.

**Дата обновления: 2026-08-15**
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
│   │   ├── App.css           # Стили
│   │   └── apple-theme.css   # Apple-стиль оформления (перекрывает App.css)
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

### CRM (v33): контрагенты, контакты, задачи с таймлайном
| Method | Path | Описание |
|---|---|---|
| GET | `/api/crm` | Все три раздела одним запросом: `{counterparties, contacts, tasks}` (camelCase). CRM ОБЩАЯ для всех пользователей (командное пространство), owner_id = создатель записи |
| POST | `/api/crm/counterparties` | Создать контрагента (body: name*, type, phone, email, address, comment) |
| PUT | `/api/crm/counterparties/:id` | Редактировать контрагента (whitelist-поля, '' → null) |
| DELETE | `/api/crm/counterparties/:id` | Удалить контрагента (контакты/задачи отвязываются сами — FK ON DELETE SET NULL) |
| POST | `/api/crm/counterparties/:id/files` | **Файлы контрагента (v36):** multipart, поле `files` (фото/видео/аудио, ≤500 МБ) → Storage папка `crm_cp/`; объект `{url, kind, name, ts, actor}` дописывается в attachments (jsonb). Любой авторизованный (командное пространство) |
| DELETE | `/api/crm/counterparties/:id/files` | Удалить файл контрагента (body: `{url}`) |
| GET/POST | `/api/planned-payments` | **Плановые платежи (v41):** список / добавление (title, category, amount, day_of_month, freq_months 1/2/6/12, counterparty, start_date); удаление — DELETE `/api/planned-payments/:id` (мягкое, active=false) |
| GET | `/api/docs` | **Документы (v40):** все разделы {home, auto, personal} с массивами файлов (таблица doc_sections) |
| POST | `/api/docs/:category/files` | Загрузка в раздел (home/auto/personal) — multipart, поле `files`, ЛЮБЫЕ типы ≤500 МБ; фото → sharp, видео >48 МБ → ffmpeg; Storage папка `docs/<category>/`; записи {url, kind: photo|video|audio|doc|file, name, ts, actor} |
| DELETE | `/api/docs/:category/files` | Удалить файл из раздела (body: `{url}`) |
| POST | `/api/crm/contacts/:id/files` | **Файлы контакта (v38):** multipart, поле `files` (фото/видео/аудио/текст/PDF, ≤500 МБ) → Storage папка `crm_contacts/`; объект `{url, kind, name, ts, actor}` дописывается в attachments (jsonb). kind=doc для PDF/текста |
| DELETE | `/api/crm/contacts/:id/files` | Удалить файл контакта (body: `{url}`) |
| POST | `/api/crm/contacts` | Создать контакт (body: counterparty_id, name*, position, phone, email, comment) |
| PUT | `/api/crm/contacts/:id` | Редактировать контакт |
| DELETE | `/api/crm/contacts/:id` | Удалить контакт (задачи отвязываются — FK SET NULL) |
| POST | `/api/crm/tasks` | Создать задачу (body: title*, description, counterparty_id, contact_id, assignee, due_date, priority). created_by = имя вошедшего, timeline = [created] |
| PUT | `/api/crm/tasks/:id` | Редактировать задачу (постановщик/исполнитель/admin); событие 'edited' дописывается в timeline |
| POST | `/api/crm/tasks/:id/action` | Смена статуса (body: {action, note}): `done` — только исполнитель (assignee; пустой = любой), open→pending_confirm; `confirm` — только постановщик (created_by), pending_confirm→closed; `return` — только постановщик, обратно в open (note обязателен); `comment` — все (note обязателен). Каждое действие = событие в timeline. admin может всё. Ошибки: 403/409 с понятным текстом |
| DELETE | `/api/crm/tasks/:id` | Удалить задачу (постановщик или admin) |
| POST | `/api/crm/tasks/:id/photos?kind=before\|after` | **Фотоотчёт (v35):** загрузить фото «до»/«после» — multipart/form-data, поле `photos` (фото/видео/аудио, количество не ограничено, ≤500 МБ на файл — crmMediaUpload через обёртку crmMediaMulter: ошибки multer, напр. LIMIT_FILE_SIZE, отдаются JSON 413/400 с понятным текстом). Записи — объекты `{url, kind, name, ts, actor}` (старые — строки-URL). **Серверное сжатие видео (v37.5):** входящее видео > 48 МБ транскодируется ffmpeg (compressVideoBuffer: x264, битрейт из длительности, 2 прохода до 640px) в mp4 ≤ 50 МБ — лимит объекта Supabase Storage; если ffmpeg-static не установлен или итог > 50 МБ — 400 с понятным текстом. Каждое фото: sharp-сжатие (processImage) → Storage bucket `receipt-images`, папка `crm/`. URL дописывается в photos_before/photos_after (jsonb), событие 'photo' — в timeline. Доступ: постановщик/исполнитель/admin; у закрытой задачи — 409 |
| DELETE | `/api/crm/tasks/:id/photos` | Удалить фото из отчёта (body: `{kind, url}`); событие 'photo_del' в timeline. Те же права |

Маппинг snake_case (БД) ↔ camelCase (фронт) — в index.js: crmCpToApi / crmContactToApi / crmTaskToApi.

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

## 6.5. Таблицы CRM (Supabase householder, миграция `supabase-migration-v21-crm.sql`)

```sql
crm_counterparties(id bigserial PK, owner_id text, name text NOT NULL,
  type text DEFAULT 'client',  -- client | supplier | partner | other
  phone, email, address, comment text, created_at, updated_at timestamptz)

crm_contacts(id bigserial PK, owner_id text,
  counterparty_id bigint REFERENCES crm_counterparties(id) ON DELETE SET NULL,
  name text NOT NULL, position, phone, email, comment text, created_at, updated_at)

crm_tasks(id bigserial PK, owner_id text, title text NOT NULL, description text,
  counterparty_id bigint REFERENCES crm_counterparties(id) ON DELETE SET NULL,
  contact_id      bigint REFERENCES crm_contacts(id)        ON DELETE SET NULL,
  assignee text,        -- исполнитель (имя пользователя; пусто = закрыть может любой)
  created_by text,      -- постановщик (подтверждает закрытие)
  due_date date,        -- срок (календарь)
  priority text DEFAULT 'normal',   -- high | normal | low
  status   text DEFAULT 'open',     -- open | pending_confirm | closed
  done_at, closed_at timestamptz,
  timeline jsonb DEFAULT '[]',      -- [{ts, actor, action, note}], action: created|edited|comment|done|confirmed|returned|photo|photo_del
  photos_before jsonb DEFAULT '[]', -- фотоотчёт «до» (миграция v22): массив URL в Storage (bucket receipt-images, папка crm/)
  photos_after  jsonb DEFAULT '[]', -- фотоотчёт «после» выполнения
  -- v36: photos_before/photos_after могут содержать объекты {url, kind: photo|video|audio, name, ts, actor}
  -- v36: crm_counterparties.attachments jsonb DEFAULT '[]' (миграция v23) — файлы контрагента [{url, kind, name, ts, actor}]
  -- v38: crm_contacts.attachments jsonb DEFAULT '[]' (миграция v24) — файлы контакта; kind может быть doc (PDF/текст)
  created_at, updated_at timestamptz)
```

Цикл задачи: «В работе» → исполнитель «✅ Выполнена» → «На подтверждении» → постановщик «👍 Подтвердить закрытие» («Закрыта») или «↩ На доработку» (снова «В работе»). Каждый шаг — событие в timeline.

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
- **Вкладка «🤝 CRM» (v32–v34), компонент CrmTab в App.js:** разделы 📅 Календарь / 📋 Задачи / 👥 Контрагенты / 📇 Контакты + сводка-счётчики (в работе / на подтверждении / просрочено / закрыто за месяц).
  - **Хранение v33:** сервер `/api/crm*` (Supabase); при недоступности — fallback на localStorage (`crm_*_v1`) с жёлтым баннером и кнопкой «🔄 Повторить». Первое подключение: локальные данные одноразово переносятся на сервер (пересадка id строковые→bigserial, флаг `crm_migrated_v1`).
  - **Календарь:** месячная сетка (неделя с Пн), чипы задач по dueDate, клик по чипу → карточка задачи; клик по дню → панель дня + «＋ Задача на этот день».
  - **Задачи:** фильтры (Активные/В работе/На подтверждении/Просроченные/Закрытые/Все), поиск, общая лента событий «🕓 Таймлайн всех событий» (30 последних).
  - **Интерактивность v34:** карточки-просмотры задачи/контрагента/контакта открываются по клику ОТОВСЮДУ (заголовок задачи, чип в календаре, имя контрагента/контакта в задаче, лента событий, списки справочников, кнопки «👁 Карточка» в форме задачи). Карточка задачи — со всеми действиями (✅/👍/↩/💬/✎/🗑) и полным таймлайном; карточка контрагента — контакты и задачи контрагента (кликабельны), «＋ Контакт», «＋ Задача» (с предустановленным контрагентом); карточка контакта — его контрагент и задачи.
  - **id-сравнения String-безопасные** (id с сервера — числа, из `<select>` — строки): cpById/contactById и все фильтры сравнивают через String().
  - Права на фронте дублируют бэкенд: кнопки действий видны только исполнителю/постановщику; чужим — подсказка, кто может закрыть/подтвердить.
  - **Фотоотчёт (v35):** блок «📷 Фотоотчёт» в карточке задачи (секции «🕐 До выполнения» / «✅ После выполнения»): миниатюры 64px (клик → полноэкранный просмотр photoViewer с зумом: повторный клик по фото — натуральный размер с прокруткой, ещё клик — уместить в экран), кнопка «📷» добавляет фото (multiple, сжатие compressImageFile до ~2 МБ), «✕» удаляет (с confirm). Тот же блок встроен в модалку «✅ Выполнена» — исполнитель сразу прикладывает фото результата. Блок встроен и в карточку задачи в списке/панели дня календаря (renderTaskCard), там же бейдж «📷 n/m» (до/после).
  - **Медиа (v36):** фотоотчёт принимает фото/видео/аудио (accept=`image/*,video/*,audio/*`); записи — объекты {url, kind, name, ts, actor}, legacy-строки трактуются как фото (mediaOf). Миниатюры renderMediaThumb: фото — img с зум-просмотром, видео — кадр с ▶ (просмотр — <video controls autoplay>), аудио — плитка 🎵 (просмотр — <audio controls> в оверлее). Видео/аудио не сжимаются (до 100 МБ), фото жмутся compressImageFile.
  - **Файлы контрагента (v36):** блок «📎 Файлы — фото · видео · аудио» в карточке контрагента (renderCpAttachments): добавление/удаление/просмотр, attachments в crm_counterparties (миграция v23). Редактирование доступно постановщику и исполнителю, пока задача не закрыта; события photo/photo_del попадают в таймлайн. В локальном fallback-режиме фото хранятся как dataURL в задаче.

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

1. **Supabase (householder):** выполнить `supabase/setup.sql` (таблица + raw_text_ru + bucket + policies), затем `supabase-migration-v7.sql` (objects + subtype/provider/valid_*/meta/related_id/object_id), затем `supabase-migration-v9.sql` (поля коммунальных счетов), затем `supabase-migration-v13.sql` (page_urls — все страницы документа), затем `supabase-migration-v21-crm.sql` (CRM: crm_counterparties, crm_contacts, crm_tasks), затем `supabase-migration-v22-crm-photos.sql` (CRM-фотоотчёт: crm_tasks.photos_before / photos_after), затем `supabase-migration-v23-crm-cp-files.sql` (CRM: crm_counterparties.attachments — файлы контрагента), затем `supabase-migration-v24-crm-contact-files.sql` (CRM: crm_contacts.attachments — файлы контакта), затем `supabase-migration-v25-docs.sql` (Документы: doc_sections — разделы home/auto/personal), затем `supabase-migration-v26-planned-payments.sql` (Анализ: planned_payments — ручные плановые платежи), затем `supabase-migration-v27-planned-freq.sql` (planned_payments: freq_months 1/2/6/12, counterparty, start_date)
2. **Railway householder-api:** репо GitHub, Root Directory `backend`, Build `npm install`, Start `node index.js`, Variables (п. 4 — ключи Supabase ОТ ПРОЕКТА HOUSEHOLDER). В backend/package.json обязательны зависимости `"pdf-lib": "^1.17.1"` (постраничный режим, v10) и `"ffmpeg-static": "^5.2.0"` (серверное сжатие CRM-видео, v37.5 — без неё видео > 48 МБ отклоняется с текстом об ошибке)
3. **Railway householder-web:** репо GitHub, Root Directory `frontend`, Build `npm run build`, Start `npx serve -s build`; в App.js `API_URL = 'https://householder-api-production.up.railway.app'`
4. Проверка: `https://householder-api-production.up.railway.app/api/check-models` → JSON со всеми провайдерами

## 14. Changelog

**2026-08-16 (v44 — календарь платежей: ручная логика, Excel-меню в выписке, таймлайн 6 мес)**
- Запрос: «удали данные из календаря, другая логика загрузки: на каждой строчке выпадающее меню как в Excel — Duque/Kit/Maria/Volvo/Porsche/Mercedes × 1/2/6/12 (частота оплаты в месяцах), при выборе сразу заносится в календарь; и предложи таймлайн, где компактно показаны платежи каждый месяц».
- DB: миграция `supabase-migration-v27-planned-freq.sql` — planned_payments + freq_months (1/2/6/12, default 1), counterparty, start_date.
- Backend: POST /api/planned-payments принимает freq_months (только 1/2/6/12), counterparty, start_date; ppToApi отдаёт freqMonths/counterparty/startDate.
- Frontend (App.js, «Анализ»): авто-данные убраны из календаря — отображаются ТОЛЬКО ручные записи planned_payments (авто-детект recurGroups остался только для меток периодичности v43). Кнопка «📅▾» в каждой исходящей строке выписки открывает Excel-меню: CAL_PAYEES (Duque, Kit, Maria, Volvo, Porsche, Mercedes) × CAL_FREQS (1/2/6/12 мес) → assignToCalendar: POST с title «Имя — контрагент», суммой, днём и start_date из даты движения. Показ в месяце: dueInMonth — (разница месяцев от startYm) % freq === 0; оплата 🟢 — совпадение контрагента в выписке за этот месяц (paidSet). Модалка «＋» получила выбор частоты. Под календарями — компактный таймлайн на 6 месяцев: строки «Мес ГГ: чипы платежей … Σ сумма».
- Деплой: Supabase (миграция v27) → householder-api → householder-web.

**2026-08-16 (v43 — метки периодичности в выписке + ручное заполнение календаря)**
- Запрос: «в основной выписке добавь метки по строкам — ежемесячный платеж, ежегодный, 2 раза в месяц — и сделай пустую форму календаря для заполнения вручную».
- Frontend (App.js, «Анализ»): 1) метка периодичности в каждой строке движений (после названия): 🔂 «N раза в месяц» (≥1.5 платежа/мес), 📅 «ежемесячный» (≥0.5), 🗓 «ежегодный» (разброс ≥10 мес), 🔁 «периодический» — freqByKey из recurGroups (группы с ≥2 платежами), freqOfMovement(m). 2) Календарь платежей заполняется вручную кликом по дню: открывается модалка «＋ Плановый платёж» с предзаполненным днём месяца; легенда дополнена подсказкой.
- Деплой: только householder-web.

**2026-08-16 (v42.1 — фикс вёрстки календаря платежей + переключение месяцев)**
- Проблема: длинные чипы раздували колонки grid → два календаря наезжали друг на друга (заголовки дней недели слипались).
- Frontend (App.js): сетка `repeat(7, minmax(0, 1fr))` + ячейки minWidth 0 / overflow hidden (чипы обрезаются с ellipsis); окно из 2 месяцев стало переключаемым — состояние payCalOffset, кнопки «← → Сегодня» (шаг 2 месяца), как в CRM-календаре. Проверено рендером в Chromium.
- Деплой: только householder-web.

**2026-08-16 (v42 — повторяющиеся платежи календарём на 2 месяца)**
- Запрос: «сделай повторяющиеся платежи как в календаре, выводи сразу 2 месяца, платежи по датам; замени то что вывел раньше».
- Frontend (App.js, «Анализ»): таблица-таймлайн v41 заменена на два месячных календаря рядом (текущий + следующий, неделя с Пн, как CRM-календарь): каждый повторяющийся платёж — чип в ячейке своей даты (min(день, дней в месяце)); 🟢 зелёный = оплачен (по выписке в этом месяце), ◌ синий = ожидается, жёлтый = ручной (✋). Сегодняшний день — синяя рамка. Ручные платежи дублируются чипами под календарями с ✕ удалением. Модалка «＋ Добавить платёж» и эндпоинты v41 без изменений.
- Деплой: только householder-web.

**2026-08-15 (v41 — таймлайн повторяющихся платежей во вкладке «Анализ»)**
- Запрос: «во вкладке анализ сделай таймлайн по обязательным повторяющимся платежам (коммуналка, страховка, телефон, уборка, бассейн, интернет), данные из выписки банка, и возможность добавлять фактуры вручную в календаре».
- DB: миграция `supabase-migration-v26-planned-payments.sql` — таблица planned_payments (title, category, amount, day_of_month, note, active).
- Backend (index.js): GET/POST `/api/planned-payments`, DELETE `/api/planned-payments/:id` (мягкое удаление active=false).
- Frontend (App.js, вкладка «Анализ»): блок «📅 Обязательные повторяющиеся платежи» над списком движений. Авто-детект из выписки: исходящие группируются по контрагенту (нормализация имени), повторяющийся = ≥2 месяцев с платежами; вычисляются средняя сумма, медианный день месяца, категория по ключевым словам (Endesa/Iberdrola/агua→💡 коммуналка, seguro/Mapfre→🛡 страховка, Movistar/Orange/Vodafone→📱 телефон, fibra/internet→🌐, limpieza→🧹 уборка, piscina→🏊 бассейн, прочее→🔁). Таблица-таймлайн на 8 месяцев (5 назад + текущий + 2 вперёд): 🟢 оплачен / ◌ ожидается / · пропуск; текущий месяц подсвечен. Ручные платежи (✋): модалка «＋ Добавить платёж» (название, категория, сумма, день месяца) → сервер; строки жёлтого фона с ✕ удалением. Загружаются при входе во вкладку вместе с движениями.
- Деплой: Supabase (миграция v26) → householder-api → householder-web.

**2026-08-15 (v40 — вкладка «📁 Документы»: Дома / Авто / Личное)**
- Запрос: «добавь вкладку после crm вкладку документы; в документах подразделы дома, авто, личное, где загрузки всех типов файлов — везде».
- DB: миграция `supabase-migration-v25-docs.sql` — таблица doc_sections (category text PK: home/auto/personal, attachments jsonb, updated_at) + 3 стартовые строки + notify pgrst.
- Backend (index.js): GET `/api/docs` (все разделы), POST/DELETE `/api/docs/:category/files`; принимаются файлы ЛЮБЫХ типов (kind: photo|video|audio|doc|file); фото — processImage, видео >48 МБ — серверный ffmpeg (compressVideoBuffer), остальное как есть; Storage папка docs/<category>/; upsert по category.
- Frontend (App.js): новая вкладка «📁 Документы» сразу после CRM; компонент DocsTab (top-level, как CrmTab): пилюли-подразделы «🏠 Дома / 🚗 Авто / 👤 Личное» со счётчиками, сетка миниатюр (фото с зум-просмотром, видео ▶ + плеер с фолбэком, аудио 🎵 + плеер, документы 📄/📝 и прочие 📎 — открываются в новой вкладке), имя файла под миниатюрой, удаление ✕, добавление 📎 (accept="*/*", до 500 МБ); баннер-предупреждение, если сервер/миграция недоступны. Без локального fallback — только сервер (файлы любых типов слишком велики для localStorage).
- Деплой: Supabase (миграция v25) → householder-api → householder-web.

**2026-08-15 (v39.1 — фикс вёрстки рейла навигации)**
- Проблема: кнопки рейла «год/месяц» унаследовали глобальные пилюльные стили темы (border-radius 980px, padding, фон) — подписи обрезались, рейл разъехался.
- Frontend (App.js): у кнопок рейла полный инлайн-сброс (appearance none, border/border-radius/background/box-shadow/margin/padding/min-width 0, white-space nowrap, width 100%, justify-content space-between); контейнер — фикс. ширина 76px, alignItems stretch, scrollbarWidth none. Проверено рендером в Chromium с имитацией глобальных пилюльных стилей.

**2026-08-15 (v39 — боковая навигация «год/месяц» в списке чеков)**
- Запрос: «сделай боковую навигацию год месяц как на скрине в меню чеки».
- Frontend (App.js, вкладка «Чеки/фактуры»): справа по центру — фиксированный рейл навигации по группам «год-месяц» текущей страницы (dateRailGroups из paginatedReceipts). Первый месяц года — жирная подпись года, остальные — сокращения месяцев; риска-тик справа от подписи. Клик → плавная прокрутка к заголовку группы (якорь id=`rg-{gk}` на заголовке, scrollMarginTop 110). Видимая при прокрутке группа подсвечивается синим (activeRailGk, scroll-listener на window; хуки добавлены до ранних return). Рейл рисуется только когда групп ≥ 2.
- Деплой: только householder-web.

**2026-08-15 (CRM v38 — файлы контакта: фото/видео/аудио/текст/PDF)**
- Запрос: «добавь сюда [в карточку контакта] возможность загрузки файлов видео аудио фото текст пдф».
- DB: миграция `supabase-migration-v24-crm-contact-files.sql` — `crm_contacts.attachments` (jsonb, default '[]') + notify pgrst.
- Backend (index.js): POST/DELETE `/api/crm/contacts/:id/files` (Storage папка crm_contacts/); новый тип медиа kind='doc' (application/pdf, text/*, расширения .pdf/.txt/.md/.csv) — принимается во всех CRM-эндпоинтах медиа (файлы контрагента, фотоотчёт задачи, файлы контакта); doc грузится как есть (без sharp/ffmpeg), content-type по расширению если пустой; crmContactToApi отдаёт attachments; таймлайн-нота задачи считает «документы +n».
- Frontend (App.js): fileMediaKind → 'doc' для всего не image/video/audio; приёмка файлов и accept у инпутов расширены (pdf/text/.txt/.md/.csv); renderMediaThumb — плитка документа (📄 PDF / 📝 текст), открытие в новой вкладке; addContactFiles/removeContactFile/renderContactAttachments — блок «📎 Файлы» в карточке контакта (список + модалка просмотра), со сжатием фото/видео и серверным ffmpeg-фолбэком, как у контрагента; локальный fallback — dataURL в localStorage.
- Деплой: Supabase (миграция v24) → householder-api → householder-web.

**2026-08-15 (CRM v37.6 — фикс ENOENT при серверном сжатии)**
- Проблема: серверное сжатие падало — «ENOENT: no such file or directory, open '/tmp/crmout_*.mp4'».
- Две причины, обе исправлены (index.js, compressVideoBuffer): 1) в JS-шаблонной строке `\,` съедалось как экранирование → ffmpeg получал `scale=min(960,iw):-2` без экранирования запятой и падал с «No such filter»; теперь в исходнике `\\,` (в runtime-строке — `\,`, как требует синтаксис фильтров ffmpeg). 2) execFile переполнял maxBuffer прогресс-логом ffmpeg на длинных роликах и падал молча; добавлены `-nostats -loglevel error` + обёртка runEncode: перед проходом чистит старый выходной файл, после — проверяет его существование и бросает ошибку с последней строкой stderr ffmpeg.
- Проверено end-to-end локально: testsrc-видео 20 c сжато в mp4 (h264+aac, faststart), длительность и аудио на месте.
- Деплой: только householder-api (зависимость ffmpeg-static из v37.5 уже должна быть в package.json).

**2026-08-15 (CRM v37.5 — серверное сжатие видео ffmpeg, фолбэк для Safari)**
- Проблема: видео 200 МБ в Chrome сжималось и грузилось, в Safari — ошибка: Safari игнорирует videoBitsPerSecond у MediaRecorder, после 3 клиентских проходов результат всё равно 197 МБ (> лимита Storage ~50 МБ), файл пропускался.
- Backend (index.js): опциональный require('ffmpeg-static'); ffmpegRun (execFile-обёртка, stderr парсится даже при exit 1 — там метаданные `ffmpeg -i`); compressVideoBuffer(buffer) — запись во временный файл (os.tmpdir), длительность из stderr-регэкспа `Duration: (\d+):(\d+):([\d.]+)`, битрейт = (45×8×2²⁰/длит.×0.9 − 96k аудио) в диапазоне 200k–4M, кодирование libx264 veryfast + aac 96k + faststart, масштаб `scale=min(W\,iw):-2`; если итог > 49 МБ — второй проход 640px с половинным битрейтом; > 50 МБ после двух проходов — throw с текстом; temp-файлы чистятся в finally. Оба медиа-эндпоинта (`/api/crm/tasks/:id/photos`, `/api/crm/counterparties/:id/files`): видео > 48 МБ автоматически проходит compressVideoBuffer → ct=video/mp4. ffmpeg-static НЕобязателен: без пакета — ошибка с инструкцией добавить зависимость.
- Frontend (App.js): если после 3 клиентских проходов видео всё ещё > 50 МБ и useServer — оригинал отправляется на сервер (параметр compress=1 для наглядности; сервер жмёт по размеру независимо) с индикатором «🎬 Сжатие на сервере (ffmpeg)…»; ответ разбирается text-first, при успехе setTasks/setCps из data.task/data.counterparty, при ошибке — alert с причиной (в т.ч. про отсутствие ffmpeg-static). Локальный fallback (без сервера) — прежний alert-пропуск.
- Деплой: в backend/package.json добавить `"ffmpeg-static": "^5.2.0"` в dependencies → householder-api → householder-web. БД не менялась.

**2026-08-15 (CRM v37.4 — миниатюры видео, фолбэк воспроизведения)**
- Проблема: загруженные видео показывались пустыми плитками — у файлов от MediaRecorder нет seek-метаданных, preload="metadata" не давал первый кадр. Плюс webm, записанный в Chrome, молча не игрался в Safari.
- Frontend (App.js): миниатюра видео — src с фрагментом `#t=0.1` + preload="auto" + playsInline (первый кадр рендерится всегда), тёмный фон плитки. Просмотрщик: onError на <video> → карточка-фолбэк «Браузер не смог воспроизвести» + ссылка «Открыть/скачать оригинал ↗» (viewerError). mime-кандидаты уже ставят mp4 первым — новые сжатия кросс-браузерны, где браузер умеет mp4 в MediaRecorder.
- Деплой: только householder-web.

**2026-08-15 (CRM v37.3 — многопроходное сжатие, предохранитель 50 МБ)**
- Проблема: в Safari после сжатия видео всё равно отклонялось Supabase («The object exceeded the maximum allowed size») — Safari игнорирует videoBitsPerSecond у MediaRecorder, результат выходил > 50 МБ. В Chrome битрейт соблюдается, ошибки не было.
- Frontend (App.js): до 3 проходов сжатия — (45 МБ, 1280×720) → (38 МБ, 960×540) → (28 МБ, 640×360); после каждого проверяется реальный размер, берётся лучший результат. compressVideoFile получил параметры maxW/maxH. Предохранитель: если итог всё равно > 50 МБ (или сжатие невозможно) — файл НЕ отправляется, alert с размером и советом (раньше уходил оригинал 459 МБ → гарантированная ошибка Storage).
- Деплой: только householder-web.

**2026-08-15 (CRM v37.2 — фикс зависания сжатия в Safari)**
- Проблема: в Chrome сжатие работало, в Safari висело на 99% — известный баг Safari: после MediaRecorder.stop() событие onstop может не прийти никогда (сторожевой таймер v37.1 вызывал finish(), но дальше всё висло, т.к. stopped=true, а onstop не случался).
- Frontend (App.js, compressVideoFile): финализация вынесена в общий finalize() (сбор Blob из chunks → File); finish() теперь: requestData() → stop() → setTimeout(finalize, 5000) — если onstop не пришёл за 5 сек, результат собирается из накопленных кусков. В Chrome путь не изменился (onstop → finalize, фолбэк — no-op через флаг settled).
- Деплой: только householder-web.

**2026-08-15 (CRM v37.1 — фикс зависания сжатия на 99%)**
- Проблема: сжатие видео зависало на 99% — у части файлов (типично .mov QuickTime) воспроизведение глохнет за долю секунды до конца duration, событие 'ended' не приходит, MediaRecorder никогда не останавливался.
- Frontend (App.js, compressVideoFile): завершение по ПЕРВОМУ из триггеров — 'ended' ИЛИ currentTime >= duration − 0.25 (в timeupdate); единый идемпотентный finish() (pause + cancelAnimationFrame + rec.stop). Сторожевой таймер: нет прогресса 15 сек → у конца дорисовываем хвост (finish), иначе честная ошибка «видео остановилось на N%». cleanup: clearInterval + остановка треков потока.
- Деплой: только householder-web.

**2026-08-15 (CRM v37 — клиентское сжатие видео до ~50 МБ)**
- Запрос: «напиши сжатие видео максимально до 50 мб» (Supabase free ~50 МБ/объект).
- Frontend (App.js, CrmTab): compressVideoFile — realtime-транскодинг в браузере БЕЗ зависимостей: кадры <video> → <canvas> (макс. 1280×720) → canvas.captureStream(30), звук через AudioContext (createMediaElementSource → MediaStreamDestination), запись MediaRecorder с вычисленным битрейтом (targetMB×8×2²⁰/длительность ×0.92 − 96k аудио, мин. 300k). mimeType-фолбэки: mp4 (Safari/Chrome) → webm vp9 → vp8. Прогресс — плавающий индикатор mediaProgress («🎬 Сжатие видео до ~50 МБ: N%»). Применяется в addTaskPhotos и addCpFiles для видео > 48 МБ; если сжатие не удалось/результат больше оригинала — отправляется оригинал. Лимит-отсев 500 МБ теперь только для НЕ-видео (видео любого размера идёт в сжатие).
- Backend не менялся. Деплой: только householder-web.

**2026-08-15 (CRM v36.1 — фикс загрузки больших видео, HTTP 500)**
- Проблема: видео 459 МБ не грузилось — multer (лимит 100 МБ) бросал LIMIT_FILE_SIZE, Express отвечал HTML-страницей 500, фронт показывал непонятное «Не загрузился файл: HTTP 500».
- Backend (index.js): лимит crmMediaUpload поднят до 500 МБ; обёртка crmMediaMulter(field) — ошибки multer отдаются JSON (413 «Файл слишком большой — максимум 500 МБ на файл» / 400); при полном провале загрузки в ответе 400 указывается причина от Storage (lastErr).
- Frontend (App.js): файлы > 500 МБ отсекаются до отправки с alert со списком имён/размеров; разбор ответа — text-first (JSON.parse в try/catch), при не-JSON ответе показывается текст ошибки, а не «HTTP 500».
- ВНИМАНИЕ: у Supabase Storage на бесплатном тарифе лимит ~50 МБ на объект — очень большие видео может отклонить сам Supabase (текст причины теперь виден в alert).
- Деплой: householder-api + householder-web (SQL не менялся).

**2026-08-15 (CRM v36 — видео и аудио в отчёте задач, файлы контрагента)**
- Запрос: «добавь в карточку контрагента возможность добавлять фото видео и аудио и в календарь соответственно к фото добавь видео и аудио».
- DB: миграция `supabase-migration-v23-crm-cp-files.sql` — `crm_counterparties.attachments` (jsonb, default '[]') + notify pgrst. Колонки задач не менялись (jsonb).
- Backend (index.js): crmMediaUpload (multer, 100 МБ) для CRM-медиа; POST/DELETE `/api/crm/counterparties/:id/files` (Storage папка crm_cp/); `/api/crm/tasks/:id/photos` принимает image/video/audio — фото через processImage, видео/аудио как есть; записи — объекты `{url, kind, name, ts, actor}`; удаление по url совместимо со строками (legacy); note в timeline с разбивкой «фото +n, видео +n, аудио +n».
- Frontend (App.js, CrmTab): mediaOf/fileMediaKind/renderMediaThumb — единый рендер миниатюр (фото с зумом, видео ▶, аудио 🎵); просмотрщик photoViewer = {url, kind} — видео/аудио открываются плеерами; renderCpAttachments + addCpFiles/removeCpFiles в карточке контрагента; addTaskPhotos принимает все три типа.
- Деплой: Supabase (миграция v23) → householder-api → householder-web.

**2026-08-15 (CRM v35.1 — фотоотчёт в карточке задачи, зум, без лимита фото)**
- Запрос: «добавь фото до и после в карточку с возможностью просмотреть с увеличением и неограниченное количество фото».
- Frontend (App.js, CrmTab): renderPhotoReport встроен в renderTaskCard — фото «до»/«после» с добавлением/удалением прямо в карточке задачи в списке и панели дня календаря. Полноэкранный просмотр с зумом (photoZoom): клик по фото — натуральный размер с прокруткой ↔ уместить в экран (паттерн как у fullscreenImage/fsZoom в App).
- Backend (index.js): снят лимит 6 файлов за запрос — `upload.array('photos')` без maxCount (лимит 20 МБ на файл от multer сохраняется).
- Деплой: householder-api + householder-web (миграция v22 уже должна быть применена; новых SQL нет).

**2026-08-15 (CRM v35 — фотоотчёт «до/после» выполнения задачи)**
- Запрос: «добавь фототчет до и после выполнения».
- DB: миграция `supabase-migration-v22-crm-photos.sql` — `crm_tasks.photos_before` / `photos_after` (jsonb, default '[]') + notify pgrst.
- Backend (index.js): POST `/api/crm/tasks/:id/photos?kind=before|after` (multer array до 6 файлов, processImage/sharp, uploadToStorage в bucket receipt-images папка crm/, событие 'photo' в timeline) и DELETE `/api/crm/tasks/:id/photos` (body {kind, url}, событие 'photo_del'). Права: постановщик/исполнитель/admin; закрытая задача → 409. crmTaskToApi отдаёт photosBefore/photosAfter.
- Frontend (App.js, CrmTab): renderPhotoReport — секции «До»/«После» с миниатюрами, добавлением (compressImageFile → multipart fetch с FormData, т.к. crmApi JSON-only) и удалением; блок встроен в карточку задачи и в модалку «✅ Выполнена»; бейдж «📷 n/m» в карточках задач; полноэкранный просмотр photoViewer (zIndex 2600); CRM_ACTION_META += photo/photo_del. Локальный fallback: dataURL в задаче.
- Деплой: Supabase (миграция v22) → householder-api → householder-web.

**2026-08-15 (CRM v34 — интерактивные карточки-просмотры)**
- Запрос: «сделай максимально интерактивные строки везде — в календаре, в задачах (при выборе поставщика открывается карточка), в календаре при выборе задачи открывается карточка задачи».
- Frontend (App.js, CrmTab): карточки-просмотры задачи / контрагента / контакта (viewTaskId / viewCpId / viewContactId). Открываются по клику из: чипа в календаре (stopPropagation + выбор дня), заголовка и ссылок контрагента/контакта в карточке задачи, общей ленты событий, имён в списках контрагентов/контактов, счётчика «открытых задач» (переход в Задачи с поиском по контрагенту), кнопок «👁 Карточка» в форме редактирования задачи. Карточка задачи содержит все действия статуса и полный таймлайн; карточка контрагента — контакты, задачи, «＋ Контакт» / «＋ Задача» (openTaskModal с presetCpId). Модалки стекуются (просмотр под формой редактирования и action-модалкой).
- Фикс надёжности: все сравнения id переведены на String() (id с сервера — number, из `<select>` — string): cpById/contactById, фильтр контактов по контрагенту, фильтр контактов в форме задачи, поиск задачи в action-модалке.
- Деплой: только householder-web (бэкенд не менялся).

**2026-08-14 (CRM v33 — серверное хранение, эндпоинты /api/crm*)**
- Запрос: «подключи сервер». Backend (index.js): блок CRM-эндпоинтов (GET /api/crm; CRUD /api/crm/counterparties|contacts|tasks; POST /api/crm/tasks/:id/action с серверной проверкой прав: done — исполнитель, confirm/return — постановщик, admin — всё; timeline дописывается на сервере). Маппинг snake_case↔camelCase на бэкенде.
- Frontend (App.js): CrmTab получает token; загрузка с сервера, все мутации через API; одноразовый перенос локальных данных (crm_migrated_v1); fallback на localStorage с баннером при недоступности сервера.
- DB: миграция `supabase-migration-v21-crm.sql` (crm_counterparties, crm_contacts, crm_tasks; FK ON DELETE SET NULL; timeline jsonb).
- Деплой: Supabase (миграция) → householder-api → householder-web.

**2026-08-14 (CRM v32 — новая вкладка «🤝 CRM», localStorage)**
- Запрос: «добавь вкладку CRM — календарь с задачами, список контрагентов, справочник контактов, таймлайн исполнения заданий, закрытие задания исполнителем с подтверждением».
- Frontend (App.js): компонент CrmTab — календарь, задачи, контрагенты, контакты, таймлайн, цикл open→pending_confirm→closed. Хранение localStorage (crm_*_v1), демо-данные при первом запуске.
- Фикс сборки Railway: в проекте нет eslint-плагина react-hooks → комментарии `eslint-disable ... react-hooks/...` ЗАПРЕЩЕНЫ (падает build, фронт остаётся старым).

**2026-08-12 (v35.1 — UI-правки: шапка, карточки, зум, единый стиль кнопок)**
- Запрос пользователя: «Приведи интерфейс согласно рисункам: перемести кнопки, выровняй по оси Y, все кнопки меню в одном стиле, в карточке чека уменьши расстояние между строками, увеличь изображение — выводи полностью в уменьшенном виде, сделай возможность увеличения без открытия карточки товара».
- Frontend (App.css + App.js + apple-theme.css):
  1) **Шапка:** `model-selector-wrap` переведён с `column` на `row` — «Выбор модели» и бейдж «Kimi K3» теперь строго в одной строке и центрированы по вертикали с вкладками. Вкладки (`tabs-inline`) — единая серая панель-пилюля (`border-radius: 999px`), все кнопки одинакового размера; активная — белая с тенью, неактивные — прозрачные (Apple Segmented Control).
  2) **Карточка чека:** `gap` уменьшен с 8px → 3px, `padding` с 16px → 12px, убран `margin-left: 28px` у даты/суммы/количества товаров — всё плотно по левому краю. Межстрочные отступы минимальны.
  3) **Изображение в карточке:** убрана жёсткая обрезка (`height: 140px` + `object-fit: cover`). Новые правила: `height: auto`, `max-height: 240px`, `object-fit: contain` — чек показывается целиком, без обрезки, на максимально возможной высоте.
  4) **Зум без открытия карточки:** клик по `receipt-thumb` в списке вызывает `setFullscreenImage` через `e.stopPropagation()` — карточка не открывается, сразу полноэкранный просмотр. Курсор `zoom-in` подсказывает кликабельность.
  5) **Тулбар загрузки:** кнопки (Фото, Выбрать файл, Распознать папку, Выписка банка) — `box-shadow` убран, `border-radius: 999px` (пилюли без границ).
  6) **Селекторы:** `border: none`, серый фон `rgba(120,120,128,0.08)`, `border-radius: 999px`, `flex-wrap: nowrap` — все селекторы (Валюта, Тип, Подтип, Оплата, Объект, Режим) умещаются в одну строку.
  7) **Бейдж Kimi K3:** убран из шапки, добавлен внутрь кнопки «Распознать и сохранить» слева от текста (`model-active-badge-inline` — полупрозрачный бейдж на фиолетовом градиенте кнопки).
- Затронуты App.css, App.js, apple-theme.css. Метка сборки: «сборка 2026-08-12 · v35.1». Деплой: householder-web.

**2026-08-12 (v35.3 — отступы шапки, строки настроек, серая подложка, панель массовых действий в 2 строки, фикс IIFE)**
- Frontend (App.css + App.js + apple-theme.css): отступы, серая подложка, панель массовых действий в 2 строки с пилюлями. Фикс: IIFE в панели массовых действий переписан без вложенных скобок, добавлен `key="dup-btn"` — устранён крах рендера при выборе карточки.
- Метка сборки: «сборка 2026-08-12 · v35.3». Деплой: householder-web.


**2026-08-10 (текущая финальная версия, v35 — двуязычный просмотр документа в карточке: оригинал + русский)**
- Запрос пользователя: «предложи как показывать распознанный документ word в карточке, где указаны русский и оригинал» (+ загружен Word-экспорт cuentas_anuales_ejercicio_693.doc, 16 стр.).
- Проблема: документы БЕЗ галереи фото (импорт из Word/текста) показывались двумя простынями `<pre>` — «оригинал» и «перевод» целиком, без постраничной навигации и без совмещения языков. В галерее (фото/PDF) текст шёл переключателем RU/Оригинал — только один язык.
- Frontend (App.js):
  - **renderDocTextBilingual(r)** — новый просмотрщик текста документа (для всех многостраничных: ≥2 маркеров «══════ СТРАНИЦА N из M ══════»): навигация ‹ Стр. N из M › (кнопки + select) и режимы «⇄ Оба» (по умолчанию) / «🇷🇺 Перевод» / «Оригинал».
  - Режим «Оба»: если число строк оригинала и перевода совпадает — ПОСТРОЧНО: строка оригинала, под ней серая строка перевода; Markdown-таблицы (формы с касильями) сливаются в ОДНУ таблицу — в каждой ячейке значение оригинала, перевод (если отличается) серым под ним; числа не дублируются. Если строки разъехались — две колонки 50/50 «Оригинал | Русский перевод» с синхронной страницей. Состояния docTextPage/docTextMode сбрасываются при открытии другой карточки.
  - Панель текста в ГАЛЕРЕЕ (фото/PDF): третья кнопка «⇄ Оба» — оригинал и перевод страницы друг под другом с подписями.
  - Одностраничные чеки — без изменений (два блока). Подсветка поиска (HighlightText) работает и в новом просмотрщике. Метка: «сборка 2026-08-10 · v35».
- Backend (index.js): при импорте Word/текста вычищается служебная строка-инструкция нашего экспорта («Текст, восстановленный распознаванием…») — она не часть документа и не должна попадать в перевод/структурирование.
- Проверено на реальном файле: cuentas_anuales_ejercicio_693.doc → 16 страниц, детектор annual_accounts=true, 163 строки таблиц из 559; инструкция вычищается.
- Деплой: ОБА сервиса (householder-api + householder-web). Миграций нет.

**2026-08-10 (v34 — детальные таблицы по типам документов + налоговые формы tax_form)**
- Запрос пользователя: «Давай создадим таблицы для разных документов: 1) чеки-фактуры (есть), 2) договоры/справки/доверенности/переписка (текст по страницам), 3) коммерческое предложение, 4) заполненные формы для налоговых органов (PDF с таблицами), 5) скачай для справки все формы из налоговой».
- Миграция БД `supabase-migration-v23.sql` — 3 детальные таблицы (по одной строке на документ, receipt_id UNIQUE → receipts(id) ON DELETE CASCADE):
  - `contract_documents` — договоры/справки/доверенности/переписка: doc_kind (contract|certificate|power_of_attorney|bank_correspondence|gov_correspondence), title, party_a/party_b, doc_date, valid_from/until, summary(_ru);
  - `proposals` — коммерческие предложения: vendor_name/nif, proposal_number/date, valid_until, total, currency, notes;
  - `tax_forms` — налоговые формы И годовая отчётность: modelo ('303'/'200'/'CUENTAS'…), ejercicio, periodo, taxpayer_nif/name, casillas JSONB [{section,casilla,name,name_ru,value,prev_value,text_value}], totals JSONB (ΣBANK).
- Backend (index.js):
  - Новый тип **`tax_form`** (whitelist parseAIResponse + bulk-update ALLOWED_TYPES + annual_accounts туда же). Детектор `looksLikeTaxForm` (≥4 балла: AEAT/Hacienda +2, «modelo NNN» +2, autoliquidación/declaración +2, IVA/IGIC/IRPF/retenciones +1, casilla +1, ejercicio/período +1, a ingresar/devolver/cuota +1); `extractModeloNumber`.
  - `buildTaxFormPrompt` — структурирование формы: items {section DATOS/LIQ/RES, casilla, name ES, name_ru, total, text_value} + ΣBANK (ejercicio/base_imponible/cuota/resultado); `ensureTaxFormBankSummary` — страховка (год + resultado из total_amount). Modelo 200 остаётся annual_accounts.
  - Конвейер: isTaxForm → табличная конвертация страниц (как annual), сэмпл buildAnnualAccountsSample (регулярка расширена: liquidaci/cuota/base imponible/devolver/ingresar/deducci/devengad/soportad/autoliquidaci), после парсинга document_type='tax_form', subtype='tax'.
  - `shouldUseDocumentPipeline(pageTexts)` — короткие формы (1-2 стр., Modelo 130) тоже идут документным конвейером, а не чековым (заменило решение «≤2 стр. = чек» в /api/upload-receipt word-ветке и /api/upload-ocr-text).
  - buildDocumentSummaryPrompt: новые поля party_a, party_b, doc_kind (contract/certificate/power_of_attorney/bank_correspondence/gov_correspondence), summary — для договоров/справок/переписки; parseAIResponse их пробрасывает (в receipts НЕ пишутся).
  - `saveDocumentDetails(receiptId, receiptData)` + `upsertDetail` — best-effort запись в 3 таблицы из saveReceiptToDB (рядом с saveDocumentPages); таблицы нет → одно предупреждение «выполните supabase-migration-v23.sql», дальше пропуск (detailTablesAvailable).
- Frontend (App.js): DOC_TYPE_LABELS += tax_form «📋 Налоговая форма»; карточка tax_form = renderAnnualAccountsCard (касильи/CSV/Word/HTML-форма/сверка с банком); секции DATOS/RES в SECTION_LABELS и SECTION_META (+порядок IDA→DATOS→BA→PA→LIQ→RES); computeAnnualBankCmp для tax_form — resultado vs списания года, base/cuota справочно; экспорт CSV/Word — префикс formulario_*, заголовок Word = store_name; фильтры типов динамические — новый тип появился везде сам. Метка: «сборка 2026-08-10 · v34».
- Пункт 5 (справка): папка `formas-referencia/` — 9 официальных PDF с sede.agenciatributaria.gob.es (бланки Modelo 030/102/200-doc-ingreso + инструкции с видом касилий 200/190/349/390 + anexo 349 + diseño 347) и `ИНДЕКС-форм.md` — каталог AEAT (036…390) и ATC Canarias (IGIC 400/410/415/420/421/425/430/480) со ссылками. Пустых бланков 303/390/130/111/115 у AEAT НЕТ (только веб-форма / пре-декларация с авторизацией); сайт ATC из песочницы не открылся — ссылки в индексе для ручного скачивания.
- Деплой: ОБА сервиса (householder-api + householder-web) + миграция v23. Без миграции карточки сохраняются как раньше, детальные таблицы молча пропускаются.

**2026-08-10 (v33 — качество распознавания + таблица document_pages + Modelo 200)**
- Запрос пользователя: «настрой распознавание лучше, может для лучшего распознавания документов сделать отдельную таблицу в sql» (+ скриншот Modelo 200, где перевод страницы — одни звёздочки «****…»).
- Причина звёздочек: vision на страницах с длинными заполнителями формы (********) выдавал сетку из звёздочек, а детектор «пустого скелета» looksLikeEmptySkeleton НЕ считал `*` скелетным символом → повторная попытка не запускалась, мусор уходил в перевод.
- Backend (index.js):
  - `looksLikeEmptySkeleton`: `*` добавлен в класс скелетных символов (обе регулярки) → страницы-звёздочки ловятся и уходят на повторное распознавание.
  - Промпты vision (основной и retry): явный запрет выводить заполнители форм — длинные ряды точек/звёздочек заменять одним пробелом между названием и значением.
  - Поддержка **Modelo 200 (Impuesto sobre Sociedades)**: детектор looksLikeAnnualAccounts (+2 за «impuesto sobre sociedades», +1 за «modelo 200»); промпт структурирования — страницы liquidación → section "LIQ", store_name «Modelo 200 {год} — {compañía}».
  - **Новая таблица `document_pages`** (миграция v22): постраничное хранение — receipt_id (FK cascade), page_num, page_kind (text/form_table/empty), page_text_raw (как выдал vision/OCR), page_text (после табличной конвертации), page_text_ru. Даёт пере-перевод/пере-структурирование БЕЗ повторного OCR и точечный дожим мусорных страниц. Запись best-effort: `saveDocumentPages` вызывается из saveReceiptToDB; `splitRawPages` режет raw_text по маркерам «══════ СТРАНИЦА N из M ══════»; `_pagesRaw` (исходные тексты страниц) прокидывается из finalizeDocumentFromPageTexts. Если миграция не выполнена — одно предупреждение в лог, документ сохраняется как раньше (documentPagesAvailable=false, повторных попыток нет).
  - `/api/upload-ocr-text`: дожим мусорных страниц локального OCR облачным зрением — если страница прислана файлом и Gemini настроен, плохие страницы перераспознаются (concurrency 2, PDF-страницы пропускаются); восстановленные страницы остаются в документе, 422 — только если плохие ВСЕ.
- Frontend (App.js): секция LIQ добавлена в SECTION_LABELS («Liquidación — Ликвидация (Modelo 200)») и SECTION_META («LIQUIDACIÓN — MODELO 200» / «Расчёт налога») + порядок секций IDA→BA→PA→LIQ. Метка сборки: «сборка 2026-08-10 · v33».
- Миграция БД: `supabase-migration-v22.sql` — выполнить в Supabase SQL Editor проекта householder. Без неё всё работает как в v32.4 (постраничное хранение молча пропускается).
- Деплой: ОБА сервиса (householder-api + householder-web) + миграция v22.

**2026-08-10 (v32.4 — PDF → JPEG → распознавание как ОДИН документ по умолчанию)**
- Запрос пользователя: «наилучший результат — pdf переводим в Jpeg потом распознаем как один документ — реализуй».
- Конвертация PDF → JPEG уже существовала (convertPdfToImages: pdf.js, scale 2.5 для плотных таблиц, качество 0.9, до 60 стр.), но в режиме multiPageMode='auto' страницы шли в smart-классификацию (classifyPagesWithGemini — лишний медленный проход, мог разбить документ на отдельные карточки).
- Frontend (App.js): `pdfExpandedRef` — выставляется в handleFileSelect/handleDrop, если в выборке был PDF. В recognizeAndSave: при нескольких файлах и режиме 'auto' + pdfExpandedRef → сразу `recognizeDocumentPages(selectedFiles)` (асинхронный /api/upload-document-pages → assembleDocumentFromPages → одна карточка со всеми страницами, галерея page_urls, детектор годовой отчётности + конвертация таблиц работают). Явные режимы уважаются: 'separate' — каждая страница в свою карточку, 'single' — как раньше. Подсказка под превью: «📄 PDF → JPEG: будет распознан как ОДИН документ (лучший режим)».
- Backend не менялся. Метка сборки: «сборка 2026-08-10 · v32.4». Деплой: только householder-web.

**2026-08-10 (v32.3 — цепочка PDF → Word → распознавание из текста → HTML)**
- Запрос пользователя: «организуй экспорт сначала pdf в word потом распознавание и представление в html». Word — редактируемое промежуточное звено: экспортировал → поправил ошибки в Word → загрузил обратно → распознавание из исправленного текста → представление в HTML (v32.2).
- Backend (index.js):
  - `extractPageTextsFromWordFile(buffer, filename)` — файл → массив текстов страниц. .txt — как есть; .doc/.htm (Word MIME HTML) — `htmlToTextWithTables` (таблицы → Markdown-строки «| a | b | c |»); .docx — `extractTextFromDocx`: ZIP центральный каталог вручную + Node zlib.inflateRawSync для word/document.xml (новых зависимостей НЕТ), w:tc → « | », w:tr/w:p → переносы; порядок замен важен: `</w:p>` перед `</w:tc>` гасим (иначе каждая ячейка на своей строке). Деление на страницы по маркерам «══════ СТРАНИЦА N из M ══════» (принимаются и =), преамбула до первого маркера дописывается в стр. 1 (заголовок «CUENTAS ANUALES … REGISTRO MERCANTIL» нужен детектору).
  - Ветки импорта: `/api/upload-receipt` (синхронно; >2 стр. → finalizeDocumentFromPageTexts, ≤2 → finalizeReceiptFromPageTexts) и `/api/upload-document-pages` (асинхронно через docJob; смешанные word+изображения — ошибка «загружайте отдельно»). Метод распознавания: «word/text import (N стр.)». Файл сохраняется в Storage как есть.
  - looksLikeAnnualAccounts усилен для ре-импорта из Word (сконвертированные таблицы без заголовков форм): +2 importe neto de la cifra de negocios, +1 activo (no) corriente/patrimonio neto, +1 gastos de personal/otros gastos de explotación.
- Frontend (App.js): кнопка «⬇ Word (.doc)» в карточке годовой отчётности — `downloadAnnualWord(r)`: Word MIME HTML (открывается в MS Word/LibreOffice), заголовок «CUENTAS ANUALES {год} — {denominación} — REGISTRO MERCANTIL» + инструкция (не удалять маркеры страниц), страницы raw_text через `mdPageToWordHtml` (Markdown-таблицы → настоящие Word-таблицы border=1, page-break на каждой странице). Загрузка: accept дополнен (.doc,.docx,.txt,.html,.htm) в обоих file-input; `isWordFile()`; фильтры handleFileSelect/handleDrop; для word-файлов НЕ сжимаем (compressImageFile пропускается), превью — плейсхолдер 📝 вместо <img>; recognizeLocal при word-файле → предупреждение + обычный облачный путь (OCR не нужен).
- Проверено тестами: настоящий .docx (zip+deflate) и Word HTML .doc → страницы с Markdown-таблицами; детектор годовой отчётности на ре-импорте = true.
- Деплой ОБОИХ: householder-api (index.js) + householder-web (App.js). Метка сборки: «сборка 2026-08-10 · v32.3».

**2026-08-10 (v32.2 — HTML-страница документа в виде официальной формы Registro Mercantil)**
- Запрос пользователя (по скриншоту IDA1: текст полей распознан, но вид формы — клеточки, касилии — потерян): «сделать распознавание как оригинал, может экспортировать в HTML а потом распознать (под документ создавать HTML страницу)».
- Решение — НЕ генерация HTML через LLM (дорого/хрупко), а детерминированное восстановление вида формы из уже распознанных касилий (items): точно, мгновенно, бесплатно, всегда совпадает с данными карточки и сверки.
- Backend (index.js): расширен regex buildAnnualAccountsSample — теперь в выборку для структурирования попадают и идентификационные листы (identificación, denominación, domicilio, CNAE, titular real, presentación de cuentas, fecha de inicio/cierre, órgano de administración, personal asalariado), а не только баланс/P&L: раньше IDA1 (NIF, даты cierre, CNAE) мог не попасть в анализ.
- Frontend (App.js): `computeAnnualBankCmp(r)` — общая сверка с банком (вынесена из карточки, используется и в HTML). `buildAnnualHTML(r, standalone)` — генератор HTML в виде официальных листов: рамочные «шиты» (лист IDA1/BA/PA + лист «RESUMEN Y COMPARACIÓN CON EL BANCO»), шапка формы NIF | DENOMINACIÓN SOCIAL | UNIDAD (Euros 09001 ☒) | код листа, колонки CASILLA | статья (ES жирным + RU серым под ней) | EJERCICIO 2025 | EJERCICIO 2024; иерархия отступов по префиксу (A) → I. → 1. → a)), итоговые строки (TOTAL…/RESULTADO…) выделены; IDA-строки — значение text_value на всю ширину; ΣBANK-итоги + таблица сверки с банком (отчётность/банк/разница/✅⚠️) встраиваются в страницу на момент открытия; CSS с префиксом .aaf-, @media print (page-break после каждого листа); дисклеймер «НЕ официальный документ». `openAnnualHTMLPage(r)` — открывает страницу Blob-URL в новой вкладке (сохранение/печать из браузера). В карточке: кнопки «📋 Вид формы» (inline-превью того же HTML через dangerouslySetInnerHTML, состояние annualFormView, сброс при смене документа), «🌐 HTML-страница», «⬇ Excel (CSV)».
- Деплой ОБОИХ: householder-api (index.js) + householder-web (App.js). Метка сборки: «сборка 2026-08-10 · v32.2».

**2026-08-10 (v32.1 — таблица-первым-шагом: конвертация страниц форм в Markdown-таблицы до перевода и разбора + выгрузка в Excel)**
- Запрос пользователя (по скриншотам: перевод страниц BA1/BA2.1/PA рассыпался в точки и битые таблицы): «может сначала конвертировать в таблицу — Excel например — а потом распознавать по строкам».
- Backend (index.js): `looksLikeFormTablePage(t)` — детектор страницы-таблицы формы (balance de situación / cuenta de pérdidas y ganancias / activo corriente / patrimonio neto y pasivo / заголовок ejercicio + испанские суммы / ≥3 пятизначных касилий; текстовые листы IDA/TR не цепляет). `buildFormTablePrompt(text)` — восстанавливает разваленную OCR-таблицу страницы в чистую Markdown-таблицу: шапка «Ключ: значение» (NIF, denominación, unidad, код листа) + | Casilla | Partida (только исп., НЕ переводить) | Notas | Ejercicio 20XX | Ejercicio 20YY |, иерархия A), B), I., 1., a), итоги TOTAL/RESULTADO обязательны, точечные заполнители выбрасываются. В `finalizeDocumentFromPageTexts`: при isAnnualAccounts страницы-формы конвертируются (3 параллельно, срез до 12000 знаков, зачистка ```-ограждений, fallback на исходный текст при сбое/отсутствии «|») ДО сборки raw_text, перевода и извлечения касилий — перевод идёт построчно по готовой таблице (buildTranslatePrompt уже требует построчный перевод таблиц), а buildAnnualAccountsSample получает effTexts → касильи извлекаются точнее. Детект isAnnualAccounts перенесён в начало функции (по pageTexts до конвертации).
- Frontend (App.js): `downloadAnnualCSV(r)` — выгрузка items (без ΣBANK) в CSV с BOM и «;» (Excel-совместимо): Sección | Casilla | Partida (ES) | Перевод (RU) | Ejercicio | Ejercicio anterior; имя файла cuentas_anuales_{год}_{id}.csv. Кнопка «⬇ Excel (CSV)» в шапке карточки годовой отчётности.
- Деплой ОБОИХ: householder-api (index.js) + householder-web (App.js). Версия /api/diagnostics не менялась. Метка сборки: «сборка 2026-08-10 · v32.1».

**2026-08-10 (v32 — распознавание годовой отчётности Cuentas Anuales + сверка с банком)**
- Запрос пользователя: анализ загруженного PDF «B76825199 ISERA 2020 CA 2025 BORRADOR» — это Cuentas Anuales Abreviadas (пакет годовой отчётности для Registro Mercantil, НЕ налоговая декларация): ISERA 2020, S.L., NIF B76825199, ejercicio 2025 (cierre 31.12.2025), 24 страницы (IDA1/IDA2, TR, SRA, BA1/BA2.1/BA2.2, PA, IMA, A1, PR, H). Нужно: распознавание этой формы с сохранением вида оригинала (исп.) + перевод на русский; позже отчётности будут сравниваться с банком.
- Backend (index.js): детектор `looksLikeAnnualAccounts(text)` (скоринг: cuentas anuales/registro mercantil/balance de situación/cuenta de pérdidas y ganancias/casilla NNNN, порог 4). При детекте в `finalizeDocumentFromPageTexts` — спец-выборка страниц `buildAnnualAccountsSample` (страницы с цифрами из СЕРЕДИНЫ пакета: balance/activo/pasivo/casilla/resultado..., до 22К знаков — стандартный сэмпл «начало+конец» их не захватывал) и промпт `buildAnnualAccountsPrompt`: items = строки отчётности {section: IDA/BA/PA, casilla, name (исп. оригинал), name_ru (перевод), total (текущий ejercicio), prev_total (прошлый), text_value (для текстовых полей IDA)} + служебные строки section="ΣBANK" (ejercicio, ingresos, gastos_explotacion, resultado, efectivo, total_activo, patrimonio_neto, acreedores_comerciales, deudores_comerciales — итоги для сверки с банком). document_type = "annual_accounts" (добавлен в whitelist parseAIResponse). `ensureAnnualBankSummary(items)` — страховка: выводит ΣBANK-строки из касилий 40100/40600+40700+40800/49500/12700 и названий (total activo, patrimonio neto...), если модель их не вернула. `normalizeItems` теперь сохраняет доп. поля (…item + prev_total). Миграция БД НЕ нужна: всё лежит в JSONB-колонке items; CHECK-ограничений на document_type нет.
- Frontend (App.js): метка типа «📊 Годовая отчётность». В модалке документа для annual_accounts вместо таблицы «Товары» — `renderAnnualAccountsCard(r)`: таблица Casilla | Partida (оригинал) | Перевод | 2025 | 2024 с группировкой по секциям (Identificación / Balance de Situación / Cuenta de Pérdidas y Ganancias), отрицательные суммы красным; блок «🏦 Сравнить с банком» — Ingresos (casilla 40100) vs поступления за год, Gastos de explotación vs списания, Efectivo (casilla 12700) vs баланс выписки на 31.12 (balance последнего движения года, иначе накопленная сумма); статусы ✅ (расхождение ≤5% или 100 €) / ⚠️ + подсказка про deudores/acreedores comerciales; кнопка «Загрузить движения из базы», если банк не загружен. Подписи «Итого» → «Resultado — Результат года», «Магазин» → «Документ» для этого типа. Проверка «Сумма строк совпадает» теперь только для receipt/invoice/bill.
- Ключевые цифры боррадора 2025 (для теста сверки): Ingresos 602.122,09 (2024: 417.510,50); Gastos de personal −209.737,13; Otros gastos explotación −309.432,44; Amortización −2.174,31; Resultado 75.451,42 (2024: −154.704,03); Efectivo 54.848,49 (22.537,06); Total activo 206.250,25 (82.908,57); Patrimonio neto 32.490,15 (−42.961,27); Acreedores comerciales 172.833,98; Deudores comerciales 69.336,88.
- Backend ИЗМЕНЁН — деплой ОБОИХ: householder-api (index.js) и householder-web (App.js). Версия /api/diagnostics НЕ менялась (watchdog на '2026-08-04.22'). Метка сборки: «сборка 2026-08-10 · v32».

**2026-08-08 (v31.2 — монохром: серая подложка во весь экран, светло-серое меню, серые градиенты в кнопках и разделах)**
- Запрос пользователя: 1) серая подложка во весь экран во всех окнах; 2) в верхнем меню убрать чёрную подложку, шрифт чёрный, меню — градиент серого; 3) убрать цвет в кнопках и разделах — везде градиенты серого.
- apple-theme.css: html/body/#root/.App — #f5f5f7 во весь экран (!important). Все button и .btn-folder — единый серый градиент linear-gradient(180deg,#fff,#ececf0) + бордер #c7c7cc + чёрный текст (!important перекрывает inline-цвета); явно перекрыты классы из App.css (.recognize-main-btn, .danger, .model-refresh-btn). .mini-header — светлый градиент (#ffffff→#f0f0f3→#e4e4e8), чёрный шрифт, светлая сегмент-капсула вкладок; .login-box — тот же светлый градиент. Инпуты/селекты — бордер #d2d2d7 !important.
- App.js (серые разделы): баннер статуса сервера на логине, баннер «бэкенд устарел», жёлтая панель массовых действий, красная панель дубликатов, stat-карточки «Анализа» (текст цвета остаётся в Σ-суммах и суммах строк — это данные), панель «выписка не загружена», баннер дедлайнов, бейджи «через N дн.» (градации серого), блок автозаполнения (серо-белый градиент), карточки кварталов (бордеры серые), блоки «К ОПЛАТЕ»/«a compensar» (серая рамка; сама сумма к оплате осталась красной — отдельная просьба пользователя из v30.1), ссылки Modelo 420/130 — чёрные с подчёркиванием, hover #ececf0. Бейджи-спаны (КОПИЯ/ОРИГИНАЛ/📑 стр./provider) и цветные суммы — намеренно оставлены как семантика данных.
- Backend не менялся. Метка сборки: «сборка 2026-08-08 · v31.2». Затронуты App.js + apple-theme.css. Деплой: householder-web.

**2026-08-08 (v31.1 — типографика apple.com + графитовый градиент меню)**
- Запрос пользователя: шрифты как на сайте Apple; цвет меню (и где он присутствует) заменить на градиент серого.
- Шрифты: CDN Apple отдаёт woff2 с 403 (хотлинк запрещён), поэтому используется системный стек SF Pro — на macOS/iOS это тот же шрифт, что на apple.com. Правила усилены (!important на body/.App/button/input/select/textarea), трекинг как у Apple: .011em для текста, −0.022em для заголовков (вес 600), base 15px/1.45.
- Меню (.mini-header): фирменный цвет заменён на графитово-серый градиент linear-gradient(180deg,#4a4a4d→#323234→#1d1d1f) + blur; текст светлый (#f5f5f7/#d2d2d7); кнопки «Выбор модели» и «Выйти» — полупрозрачные светлые пилюли; сегмент-контрол вкладок на тёмном фоне — тёмная капсула, активный таб — светлая пилюля. Тот же градиент применён к экрану входа (.login-box).
- Backend не менялся. Метка сборки: «сборка 2026-08-08 · v31.1». Затронуты apple-theme.css + App.js (метка). Деплой: householder-web.

**2026-08-08 (v31 — рестайлинг под apple.com: apple-theme.css)**
- Запрос пользователя: заменить стили кнопок и вспомогательных элементов, за основу взять apple.com.
- НОВЫЙ ФАЙЛ apple-theme.css (положить в frontend/src рядом с App.css; в App.js добавлен `import './apple-theme.css'` ПОСЛЕ App.css — перекрывает базовые стили). Семантические цвета inline-кнопок (красный/зелёный/фиолетовый) сохранены — тема меняет форму, поведение и «косметику», не смысловую раскраску.
- Что внутри: дизайн-токены (--apple-blue #0071e3, текст #1d1d1f, серый #6e6e73, фон #f5f5f7, бордер #d2d2d7); системный шрифт SF Pro; все кнопки — плавные hover (приподнятие + brightness), active (scale .97), focus-visible кольцо #0071e3; поля ввода — radius 10, фокус с мягким свечением; вкладки .tabs-inline — сегмент-контрол iOS (серая капсула, активный таб — белая пилюля с тенью); карточки (.info-block, .receipt-card, .result-panel, .upload-section и др.) — белые, radius 20, мягкая тень, receipt-card приподнимается при hover; бейджи — пилюли; модалки/оверлеи — backdrop-filter blur + анимации apple-fade/apple-pop; скроллбары тонкие в стиле macOS; accent-color чекбоксов — #0071e3; prefers-reduced-motion.
- Backend не менялся. Метка сборки: «сборка 2026-08-08 · v31». Затронуты App.js (1 строка import) + новый apple-theme.css (деплой: householder-web, Root frontend — НЕ ЗАБЫТЬ закоммитить оба файла).

**2026-08-08 (v30.4 — «Налоги»: календарь/справочник — иконки в шапке, авто-диапазон и мгновенное заполнение из базы)**
- Запрос пользователя: перенести выпадающие меню в верхнюю строку рядом с «Налоги», оставив только иконки календаря и книги; сделать автоматическую выборку из базы после выбора диапазона — сейчас диапазон приходится вводить вручную.
- Frontend (App.js), вкладка «Налоги»:
  1) Блоки календаря и справочника больше НЕ <details> в потоке — они открываются иконками 📅 и 📚 в шапке рядом с заголовком «Налоги» (state taxCalOpen/taxGuideOpen, активная иконка подсвечена фиолетовым).
  2) Авто-диапазон: useEffect по bankMovements — пока пользователь сам не трогал «с/по» (ref taxRangeTouched), границы подставляются из дат движений в базе (первое/последнее движение → кварталы). Опции кварталов (quarterOptions) теперь покрывают все годы движений, а не только текущий ±1.
  3) Смена любого селектора «с»/«по» сразу делает свежую выборку из базы (loadBankMovements) и открывает модалку с заполненными формами (applyTaxRange) — кнопку нажимать не обязательно; кнопка «🧮 Заполнить формы из банка» осталась как повторный пересчёт.
- Backend и миграции не менялись. Метка сборки: «сборка 2026-08-08 · v30.4». Затронут только App.js (деплой: householder-web, Root frontend).

**2026-08-08 (v30.3 — «Налоги»: вид форм как в официальном бланке + перевод рядом)**
- Запрос пользователя: оставить вид заполненной формы как в v30 (испанские названия casilla, как в официальном бланке) и рядом перевод на русский.
- Frontend (App.js): новый общий генератор строк taxFormRows(form, x, d) — каждая строка вида «Casilla 01 — Base imponible (tipo 7%) — Налогооблагаемая база: 182.286,56» (испанский термин первым — как в бланке AEAT/ATC, русский перевод после тире, значения выровнены padEnd(76)). Используется и в попапе одиночной модели (buildSingleTaxFormText), и в общем черновике диапазона (buildTaxRangeText теперь выводит полные блоки casillas 420 и 130 по каждому кварталу, а не однострочные сводки). «A INGRESAR — К УПЛАТЕ» / «A COMPENSAR — К КОМПЕНСАЦИИ». В ИТОГО диапазона отрицательный 420 показывается как max(0) + пометка «a compensar».
- Backend и миграции не менялись. Метка сборки: «сборка 2026-08-08 · v30.3». Затронут только App.js (деплой: householder-web, Root frontend).

**2026-08-08 (v30.2 — «Налоги»: попап заполненной модели по клику, галки «есть фактура» внутри модалки, фикс отрицательного «к оплате»)**
- Запрос пользователя: при нажатии на значок модели открывать попап с этой заполненной моделью; оставить при заполнении модели за период возможность ставить галки о наличии фактур как в предыдущем варианте.
- Frontend (App.js), вкладка «Налоги»:
  1) Строки «📄 Modelo 420» и «📄 Modelo 130» в карточке квартала (модалка черновика) — кликабельны → попап (state taxFormPopup {form, q.key}) с полностью заполненной моделью по casillas на русском (buildSingleTaxFormText): 420 — base/cuota/deducible/diferencia/resultado + «A INGRESAR» или «A COMPENSAR»; 130 — ingresos/gastos/rendimiento/20%/pagos anteriores/resultado нарастающим итогом. В попапе красный блок «К ОПЛАТЕ» (+ штраф/пени при просрочке) или зелёный «к компенсации», кнопка скачивания одиночной формы .txt. После пересчёта попап берёт свежий квартал из taxDraft по key. Для этого computeTaxRange теперь хранит cumIngresos/cumGastos в объекте квартала.
  2) Галки «есть фактура» внутри модалки: в каждой карточке квартала сворачиваемый список «💶 Платежи квартала» с чекбоксами (toggleInvoiceFlagAndRecalc = toggleInvoiceFlag + loadBankMovements + пересчёт всего диапазона computeTaxRange(prev.fromKey, prev.toKey, prev, mvts) — ручные правки полей сохраняются). Внешний блок «Платежи из банка за квартал» на вкладке остаётся как был.
  3) Фикс: отрицательный результат 420 больше не уходит в «К ОПЛАТЕ» минусом — grandTotal = max(0,total420) + 130 + штрафы + пени; в красном блоке и карточке квартала отрицательный 420 помечается «к компенсации (a compensar)».
- Backend и миграции не менялись. Метка сборки: «сборка 2026-08-08 · v30.2». Затронут только App.js (деплой: householder-web, Root frontend).

**2026-08-08 (v30.1 — «Налоги»: русские бланки, диапазон кварталов со штрафами и пенями, сворачиваемые календарь/справочник, красная сумма к оплате)**
- Запрос пользователя: 1) перевести формы на русский; 2) выборка за ДИАПАЗОН кварталов (например, 1T 2025 → 2T 2026) с отдельным расчётом штрафов и пеней за неоплаченные кварталы; 3) календарь и справочник сделать выпадающими; 4) сумму к оплате выводить отдельно красным.
- Frontend (App.js), вкладка «Налоги»:
  1) TAX_FORM_TEMPLATES полностью на русском: бланки и примеры заполнения всех 6 форм (420/130/100/115/111/036) — «Casilla NN — русский термин (испанский термин)».
  2) Автозаполнение за ДИАПАЗОН: два select «с»/«по» (state taxQFrom/taxQTo, дефолт 2025-1T → текущий квартал) → computeTaxRange(fromKey, toKey, overrides, mvts): идёт по кварталам; доходы/расходы/igicSoportado как в v30 + переопределяются ключами ingresos_Y_Q / gastos_Y_Q / igicSop_Y_Q; modelo 130 нарастающим итогом с авто-зачётом авансов прошлых кварталов (paid130ByYear). buildTaxRangeText — текстовый черновик по всем кварталам + ИТОГО.
  3) ШТРАФЫ И ПЕНИ за просроченные кварталы (дедлайн прошёл, налог > 0): recargo por extemporaneidad (art. 27 LGT) = 1% + 1% за каждый полный месяц просрочки (макс 12%), после 12 мес. — 15%; intereses de demora 4,0625% годовых с 13-го месяца. Отдельные красные строки в квартале и в итогах; расчёт для ДОБРОВОЛЬНОЙ подачи до требования (при требовании — штраф 50–150%, об этом предупреждение).
  4) Модалка черновика: по каждому кварталу карточка с редактируемыми доходами/расходами/IGIC soportado (правка → пересчёт всего диапазона), результатами 420/130 и красной строкой санкций; общая ставка IGIC сверху; КРАСНЫЙ блок «💶 К ОПЛАТЕ: grandTotal €» (420 + 130 + recargo + intereses); скачивание .txt за весь диапазон; «🔄 Финальный пересчёт из банка» (prev-объект передаётся как overrides — переопределённые поля сохраняются).
  5) Календарь и справочник обёрнуты в <details> (по умолчанию свёрнуты); красный баннер оповещений о дедлайнах остаётся всегда видимым.
- Старые computeTaxDraft/buildTaxDraftText удалены (single-quarter версия заменена диапазонной). Backend и миграции не менялись (v21-миграция из v30 по-прежнему обязательна).
- Метка сборки: «сборка 2026-08-08 · v30.1». Затронут только App.js (деплой: householder-web, Root frontend).

**2026-08-08 (v30 — вкладка «Налоги»: календарь, справочник, галка «есть фактура», автозаполнение форм из банка)**
- Запрос пользователя: в окне «Налоги» — галка «есть фактура на этот платёж в банке», календарь платежей с оповещением за месяц до дедлайна, справочник «какие налоги и документы подавать», скачиваемые формы с примером заполнения, автозаполнение форм из банка с «финальным апдейтом» к подаче.
- Профиль налогообложения: Тенерифе (Канары) → IGIC вместо IVA: modelo 420 (ATC) вместо 303; IRPF — modelo 130 поквартально; годовая Renta — modelo 100; retenciones 111/115 + сводки 190/180; censal 036/400. Официальных «плоских» PDF-бланков больше нет — подача электронная в sede AEAT/ATC, поэтому формы = скачиваемые .txt бланки-черновики с casillas + ПРИМЕРЫ заполнения (кнопки «⬇ Бланк» / «⬇ Пример заполнения» на каждой карточке справочника).
- Backend (index.js): POST /api/bank-movement-invoice-flag {movement_id, has_invoice} — галка в bank_movements.has_invoice; подсказка в withDbSchemaHint при ошибке колонки → supabase-migration-v21.sql. МИГРАЦИЯ: supabase-migration-v21.sql (alter table bank_movements add column if not exists has_invoice boolean not null default false + notify pgrst) — ОБЯЗАТЕЛЬНА, иначе галка не сохраняется.
- Frontend (App.js), вкладка «Налоги» (свой блок, больше НЕ копия «Анализа»):
  1) Оповещение-баннер: события с дедлайном ≤35 дней — красная панель «готовьте документы» (что подать, что проверить). TAX_CALENDAR: квартальные 420/130/115/111 (до 20 апр/июл/окт; 4T — до 30 янв для 420/130, до 20 янв для 115/111), годовые 190/180 (31 янв), Renta 100 (30 июн); ближайшее наступление даты, «через N дн.» с цветом (≤35 красный, ≤65 жёлтый); опциональные 111/115/190/180 скрыты за галкой.
  2) Справочник TAX_GUIDE: 6 карточек (кто подаёт/что/документы/когда + официальная ссылка + скачивание бланка и примера заполнения).
  3) Платежи банка за выбранный квартал с ГАЛКОЙ «📄 есть фактура» (toggleInvoiceFlag → POST, оптимистичный UI с откатом при ошибке; требует v21-миграцию); рядом привязанная фактура (клик → карточка) или «не привязан».
  4) Автозаполнение: выбор квартала → computeTaxDraft: ingresos = поступления квартала; gastos = исходящие с галкой/привязкой; igicSoportado = Σtax_amount привязанных фактур (иначе 7/107 от расходов); modelo 420 (casillas 01/06/11/12/17/18/20) и 130 (01/02/03/04=20%/05/07) — модалка с редактируемыми полями (правки пересчитываются), скачиванием .txt и кнопкой «🔄 Финальный пересчёт из банка» (перезагружает движения и считает заново — loadBankMovements теперь ВОЗВРАЩАЕТ движения). Дисклеймер: черновик-помощник, не официальный документ.
- Метка сборки: «сборка 2026-08-08 · v30». Затронуты App.js + index.js + новая supabase-migration-v21.sql.

**2026-08-08 (v29.2 — новая вкладка «🧾 Налоги»)**
- Запрос пользователя: «добавь вкладку Налоги после банка и перемести туда банк, скопируй всё» (уточнение: полная копия вкладки «Анализ» как основа под налоговый учёт).
- Frontend (App.js): новая вкладка «🧾 Налоги» в шапке сразу после «📊 Анализ» (activeTab='taxes', загружает receipts + bankMovements так же). Контент вкладки — ПОЛНАЯ копия банковского анализа: блок рендерится для ОБЕИХ вкладок ({(activeTab==='analysis' || activeTab==='taxes') && ...}) — статистика движений, фильтры (входящие/исходящие/привязанные/без пары, контрагенты, даты, поиск), привязка платежей к фактурам (linkPicker). Заголовок блока на вкладке «Налоги»: «🧾 Налоги — выписка и привязка платежей (полная копия «Анализа»)». Дублирования кода нет — один JSX-блок на две вкладки; дальше налоговую вкладку адаптируем отдельно (фильтр document_type='tax', modelo 303/130, IBI и т.п.).
- Метка сборки: «сборка 2026-08-08 · v29.2» — если на сайте её нет, нужен redeploy householder-web + Cmd+Shift+R.
- Затронут ТОЛЬКО App.js; index.js не менялся; SQL-миграций нет.

**2026-08-08 (v29.1 — меню «Режим»: по страницам / один документ)**
- Запрос пользователя: «добавь в строку ещё одно меню — выбор: распознать по страницам или один документ (например, договор — все страницы)».
- Frontend (App.js): новое состояние multiPageMode ('auto'|'separate'|'single') и селект «Режим:» в строке параметров после «Объект»: 🤖 Авто (AI) — как раньше (classify-pages решает сам); 📄 По страницам — каждая страница в СВОЮ карточку без AI-классификации; 📑 Один документ — все страницы склеиваются в одну карточку (договор/эскритура) без AI-классификации.
- Маршрутизация: recognizeAndSave при нескольких файлах — separate → recognizeFilesSequentially (+финальный alert «Сохранено карточек: N»), single → recognizeDocumentPages, auto → recognizeSelectedFilesSmart (без изменений). Локальная кнопка 🖥: separate → цикл по файлам (OCR страницы → отдельный POST /api/upload-ocr-text на каждую → отдельные карточки, результаты в folderResults); auto/single → как раньше, один документ (локально AI-классификации нет).
- Подсказка под превью при нескольких файлах теперь показывает выбранный режим («КАЖДАЯ страница — в СВОЮ карточку» / «СТРАНИЦЫ ОДНОГО документа» / «AI сам решит»).
- Метка сборки: «сборка 2026-08-08 · v29.1» — если на сайте её нет, нужен redeploy householder-web + Cmd+Shift+R.
- Затронут ТОЛЬКО App.js; index.js не менялся; SQL-миграций нет.

**2026-08-08 (v29 — кнопка «Показать копии» для выбранной карточки)**
- Запрос пользователя: «добавь кнопку показать дубликаты карточки, когда выбираешь карточку, чтобы показывал все карточки КОПИИ» (скриншот 2026-08-07 22:42: Rentokil и PUNTO INVERSIONES TENERIFE с бейджами КОПИЯ).
- Frontend (App.js): новое состояние dupFocusId. Когда выбрана РОВНО ОДНА карточка, в жёлтой панели массовых действий появляется оранжевая кнопка «👯 Показать копии (N)» — N = размер группы дубликатов этой карточки (та же логика группировки: название+дата+сумма с проверкой конфликтов сильных идентификаторов). Если копий нет — кнопка серая/неактивная (клик — alert с пояснением). Клик → список фильтруется до группы: оригинал (зелёный бейдж) + все копии (красный бейдж, видны на карточках всегда); поверх списка — инфо-панель «Дубликаты карточки «Rentokil»: 4 шт.» с кнопками «Выбрать копии (N-1)» (в выборку — все, кроме оригинала → можно сразу удалить) и «Показать все». Общая кнопка «🔍 Дубликаты» сбрасывает фокус. Удаление карточки из группы автоматически сворачивает режим (группа перестаёт существовать → показ всех).
- Метка сборки под кнопкой «Локально»: «сборка 2026-08-08 · v29» — если её нет на сайте, нужен redeploy householder-web + Cmd+Shift+R.
- Затронут ТОЛЬКО App.js (фронтенд); index.js не менялся; SQL-миграций нет.

**2026-08-07 (v28.6 — локальный OCR: страж 422 пропускает плохие страницы вместо отказа всему документу)**
- ПРОБЛЕМА-6 (скриншот 2026-08-07 10:48): 5-страничный скан зелёного альбарана Higinio Tabares (почти пустая табличная сетка + подпись) — локальный OCR отработал, но POST /api/upload-ocr-text упал 422 «зациклился на стр. 1, 2». ДВЕ причины:
  1. ЛОЖНОЕ срабатывание isDegenerateOcrText: модель честно выдала ~18 одинаковых пустых строк таблицы «|  |  |  |  |  |» — уникальность упала <35% хотя OCR нормальный. РЕШЕНИЕ: строки чистой табличной разметки (`/^[|:\-\s+*_=~.]+$/`) НЕ считаются контентом при подсчёте уникальности; координатные префиксы перед проверкой снимаются (общий LOCAL_OCR_COORD_RE — иначе повтор фразы с разными координатами выглядел бы «уникальным»).
  2. Слишком жёсткая реакция: ВЕСЬ документ отклонялся из-за части страниц. РЕШЕНИЕ: зациклившиеся страницы ПРОПУСКАЮТСЯ (тексты и соответствующие req.files — чтобы page_urls совпадали с текстами), документ собирается из остальных; 422 — только если плохие ВСЕ страницы. В карточку дописывается модуль «ПРОПУЩЕНЫ СТРАНИЦЫ: стр. N — OCR зациклился, переснимите крупнее или используйте облачную кнопку», в recognition_method — «пропущено: 1,2», в ответе API — поле skipped_pages.
- Тесты в песочнице: табличная страница (пустая сетка + контент) больше НЕ флагается; реальный цикл с разными координатами ловится; нормальный текст не ловится; node --check OK.
- Затронут ТОЛЬКО index.js; версия остаётся 2026-08-04.22; App.js не менялся; SQL-миграций нет. Пользователю: redeploy householder-api → Выйти/Войти → распознать скан заново кнопкой «Локально» (альбаран с пустой сеткой — сложный для 3B-модели; если страницы снова будут пропущены — облачная кнопка).

**2026-08-07 (v28.5 — локальный OCR: карточка заполняется товарами/датой/итогом, чистка «голых» координат)**
- ПРОБЛЕМА-5 (скриншот + текст 2026-08-07, чек MediaMarkt Adeje): локальный OCR распознал текст хорошо, но карточка пустая — Магазин = «title [362, 86, 624, 119]MediaMarkt — text [397, 124, 593, 136]MEDIA MARKT LPGC S.A.U. ADE», Дата/Итого «—», ТОВАРЫ (0). ДВЕ причины:
  1. llama.cpp вырезает спец-токены <|ref|>/<|det|> целиком, оставляя «голые» grounding-координаты: «title [362, 86, 624, 119]Текст» — cleanLocalOcrTokens их не знал, и fallback store_name (первые 2 строки) тащил мусор в карточку. РЕШЕНИЕ: в cleanLocalOcrTokens добавлен regex координатных префиксов `(title|text|image|table|…)\s*\[{1,2}\d…,\d…\]{1,2}` (запятая обязательна — артикулы вида «item [1234]» не страдают; применяется в цикле, пока есть замены).
  2. /api/upload-ocr-text структурировал ЛЮБОЙ текст через finalizeDocumentFromPageTexts → buildDocumentSummaryPrompt, где items ЗАХАРДКОЖЕНЫ `[]` (промпт многостраничных документов) — поэтому товары/дата/итог чека не извлекались вообще. РЕШЕНИЕ: новый чековый текстовый конвейер: buildReceiptTextPrompt (полная чековая схема как vision buildReceiptPrompt — store_name/store_name_ru, дата, время, ИТОГ, ВСЕ ТОВАРЫ name/name_ru/quantity/price/total, типы документов, bill-поля subtype/provider/invoice_number/supply_address/cups/consumption, правила объектов Reykjavik→Duqe/Callao→Maria/Alcojora→Kit) + finalizeReceiptFromPageTexts (те же запасные варианты: store_name из первых строк, total regex'ом, перевод страниц, detectObjectByAddress). Маршрутизация в upload-ocr-text: ≤2 страниц → чековый конвейер, 3+ → документный (договоры/эскритуры не тронуты).
- БОНУС в cleanLocalOcrTokens: глобальная дедупликация зацикленных БЛОКОВ — длинная строка (≥15 симв.), встретившаяся в тексте >2 раз, режется (кейс: шапка чека MediaMarkt ×5 с промежутками — старое схлопывание ловило только ПОДРЯД идущие повторы). Страж isDegenerateOcrText работает на сыром тексте ДО чистки, как и раньше.
- Тесты в песочнице: координаты вырезаются, содержимое строк сохраняется, «item [1234]» цел, шапка ×5 → ×2, вырожденный текст по-прежнему ловится 422; node --check OK.
- Затронут ТОЛЬКО index.js (бэкенд); версия остаётся 2026-08-04.22; App.js не менялся (метка сборки прежняя v28.4); SQL-миграций нет. Пользователю: redeploy ТОЛЬКО householder-api → удалить битую карточку → распознать чек заново кнопкой «Локально».

**2026-08-06 (v28 — кнопка «Локально»: бесплатный OCR Unlimited-OCR на Mac пользователя)**
- ЗАВИСИМОСТЬ: на ноутбуке пользователя установлен Unlimited-OCR через llama.cpp (GGUF Q4_K_M + mmproj F16, Metal) и запущен `./build/bin/llama-server -m ./uocr/Unlimited-OCR-Q4_K_M.gguf --mmproj ./uocr/mmproj-Unlimited-OCR-F16.gguf -c 8192 --host 127.0.0.1 --port 8080` (OpenAI-совместимый API)
- Архитектура: БРАУЗЕР → llama-server 127.0.0.1:8080 напрямую (localhost — доверенный контекст, mixed content нет; llama-server отдаёт CORS-заголовки) → markdown страниц + изображения → Railway-бэкенд → карточка в базе. Облачные vision-модели не расходуются
- Backend: POST /api/upload-ocr-text (multer pages≤60, auth по token): ocr_texts (JSON-массив markdown страниц) или ocr_text → cleanLocalOcrTokens (убирает служебные <|ref|>/<|det|> и прочие <|…|> токены Unlimited-OCR) → finalizeDocumentFromPageTexts (та же JSON-сводка полей + перевод, что у многостраничного конвейера) → override docType/object/subtype/payment_status → uploadPagesToStorage(label 'local-ocr', page_urls, обложка = стр.1) → saveReceiptToDB (recognition_method 'local-uocr (unlimited-ocr, N стр.)')
- Frontend: константа LOCAL_OCR_URL='http://127.0.0.1:8080'; кнопка «🖥 Локально (Unlimited-OCR, бесплатно)» под основной кнопкой распознавания; recognizeLocal: health-check /health (4 сек) → каждая выбранная страница в /v1/chat/completions с рецептом модели (промпт '<|grounding|>Convert the document to markdown.', temperature 0, max_tokens 8192, image data-url) → FormData (pages + ocr_texts + форма) на /api/upload-ocr-text → карточка как обычно (setLastSavedReceipt + loadReceipts). Прогресс: 0–70% локальный OCR по страницам, 70–100% сервер; стадия 'local' на кнопке
- Семантика: все выбранные страницы = ОДИН документ (как «Распознать N стр.» до v27); умный разбор v27 и мульти-чек v26 локальной кнопкой НЕ используются (модель не выдаёт рамки) — для авторазбора пользоваться облачной кнопкой
- Ошибки: сервер не запущен → alert с командой запуска; если Chrome заблокирует запрос к localhost (Private Network Access) — совет открыть сайт в Safari (в тексте alert'а)
- ПРОБЛЕМА CORS/PNA (скриншот 2026-08-06): llama-server слушает 127.0.0.1:8080, но браузер с HTTPS-страницы не может до него достучаться (нет CORS-заголовков / Chrome Private Network Access) — кнопка показывала «не отвечает». РЕШЕНИЕ: uocr-proxy.py (stdlib, 127.0.0.1:8081 → 8080, добавляет Access-Control-Allow-Origin/Private-Network, обрабатывает OPTIONS); фронт перебирает LOCAL_OCR_FALLBACK_URLS=[':8081 (прокси)', ':8080 (напрямую)'] по /health и работает через первый живой
- ПРОБЛЕМА-2 (скриншот 2026-08-07): llama-server И прокси запущены (прокси проверен в песочнице: OPTIONS отдаёт ACAO:* и Access-Control-Allow-Private-Network:true), а браузер всё равно не достукивается — Safari/Chrome режут HTTP-запрос с HTTPS-страницы ещё ДО прокси (mixed content на 127.0.0.1). РЕШЕНИЕ: HTTPS-туннель cloudflared quick tunnel на ПРОКСИ: brew install cloudflared && cloudflared tunnel --url http://127.0.0.1:8081 → выдаёт https://….trycloudflare.com (https→https: ни mixed content, ни PNA; CORS даёт прокси). Фронт: ⚙ под кнопкой «Локально» → prompt для своего URL (localStorage 'localOcrUrl', пусто=авто); candidates = [свой URL, :8081, :8080]; alert перечисляет все 3 шага; метка сборки v28.2 показывает режим (авто/туннель)
- ПРОБЛЕМА-3 (скриншот 2026-08-07, чек #488): локальный OCR ЗАЦИКЛИЛСЯ на сложном фото (мелкий жёлтый чек Media Markt на столе + второй документ рядом): «(1) 1 января 2017 г.» × 30, название/дата выдуманы. Причина: в vLLM-рецепте анти-повтор = n-gram logits processor (35/128), в llama.cpp его НЕТ. РЕШЕНИЕ: 1) фронт шлёт DRY-параметры (аналог n-gram процессора): repeat_penalty 1.05, dry_multiplier 0.8, dry_base 1.75, dry_allowed_length 4, dry_sequence_breakers [
,:,кавычка,пробел] — штрафуют длинные повторы, легальные короткие (цены, «EUR») не страдают; 2) бэкенд: cleanLocalOcrTokens схлопывает подряд идущие одинаковые строки до 2; 3) isDegenerateOcrText — страж на СЫРОМ тексте (≥15 строк и уникальных <35% → 422 с советом сфотографировать крупнее/взять облачную кнопку); ВАЖНО: проверка ДО схлопывания, иначе улики исчезают. Локальная 3B-модель слабее облачной — на мелких/глянцевых/составных фото рекомендовать облачную кнопку
- ПРОБЛЕМА-4 (скриншоты 2026-08-07 09:47): локальный OCR дошёл до llama-server и отработал (лог: task 17419, ~7300 токенов, truncated=1 — цикл, т.к. на фронте стояла v28.1 БЕЗ DRY), но сохранение упало: «Локальный OCR: Unauthorized». Причина: сессии — в памяти backend (const tokens = new Map(), без TTL); редеплой householder-api (свежее index.js) перезапустил процесс → все токены стёрты, фронт с localStorage-токеном получает 401. РЕШЕНИЕ: recognizeLocal сначала проверяет /api/me (401 → «Выйдите и войдите заново», не гоняя OCR впустую), и 401 при сохранении — отдельное понятное сообщение вместо голого «Unauthorized». Пользователю: Выйти → Войти. КСТАТИ: при 64 ГБ RAM можно поднять контекст llama-server до -c 16384 (dense-документы)
- Метка сборки: под кнопкой «Локально» выводится «сборка 2026-08-06 · v28 · локальный OCR» — если её нет на сайте, фронтенд не пересобрался или закэширован (нужен redeploy householder-web + Cmd+Shift+R); на версионный watchdog (2026-08-04.22) метка не влияет
- Затронуты index.js + App.js; бэкенд без смены версии (остаётся 2026-08-04.22); SQL-миграций не требуется

**2026-08-06 (v27 — умный разбор многостраничных файлов: каждая страница в свою карточку)**
- Кейс пользователя: «Скан 3.pdf» — 3 страницы, на каждой СВОЙ документ (альбаран ENTASUR 1473,39 + фактура ENTASUR 1553,64 + подтверждение перевода 1553,64). Раньше PDF раскладывался на страницы на фронте, а кнопка «Распознать» отправляла все страницы в /api/upload-document-pages → ОДНА карточка на весь файл
- Backend: новый POST /api/classify-pages (multer pages≤60, auth по token) — classifyPagesWithGemini: страницы батчами по 8 (уменьшенные копии 1400px/q70) → gemini-2.5-flash (responseMimeType json) решает для КАЖДОЙ страницы: standalone (своя шапка + завершение: чек/фактура/альбаран/квитанция/подтверждение перевода) или continuation (часть договора/эскритуры/отчёта). Ответ {pages:[{page,standalone,kind,title}], allStandalone}. Пропущенная моделью страница = continuation (безопасный дефолт → старый путь)
- Frontend: recognizeAndSave при selectedFiles.length>1 теперь вызывает recognizeSelectedFilesSmart: 1) classify-pages (на кнопке «🔍 Анализирую страницы…»); 2) allStandalone → recognizeFilesSequentially — каждая страница отдельно в /api/upload-receipt (там же срабатывает мульти-чек разрезание v26.1, если на странице 2 чека) → ОТДЕЛЬНЫЕ карточки, прогресс/итоги — в панелях folderProgress/folderResults (переиспользованы); финальный alert со списком «стр.N: название»; 3) хотя бы одна continuation ИЛИ сбой классификатора → recognizeDocumentPages (старый путь «один документ» — договоры/эскритуры не ломаются)
- Рефакторинг: цикл «каждый файл → upload-receipt с 2 попытками» вынесен из processFolderFiles в recognizeFilesSequentially(allFiles) — общий для папки и умного разбора
- UI: подпись кнопки при нескольких файлах «📄 Распознать N стр. (AI разберёт: отдельно или как один)»; заголовки панелей «Распознавание файлов…»/«Результаты загрузки» (было «папки»)
- Ограничение: правило «все или ничего» — смешанный набор (чек + страницы договора) уйдёт старым путём одним документом; группировка смешанных наборов не реализована
- Бэкенд без смены версии (остаётся 2026-08-04.22); SQL-миграций не требуется; затронуты index.js + App.js

**2026-08-06 (v26.1 — починка детектора мульти-чеков: эвристика по доле тёмных пикселей)**
- Симптом: «не работает разделение на чеки» — скан с двумя чеками рядом (750×1152) сохранялся одним документом: первый запрос к Gemini отвечал count:1, а CV-эвристика v26 НЕ срабатывала → повторный запрос не выполнялся
- Причина: эвристика v26 смотрела на СРЕДНЮЮ яркость колонки с порогом 235. На чистом светлом скане текст разбавлен белым фоном — средняя яркость колонок 242–255, ниже порога не опускается НИГДЕ (проверено эмуляцией на реальном скане пользователя: «доля тёмных колонок (<235): 0.0»)
- Исправление (проверено на том же скане в JS с sharp — fire:true, зоны [15–64] и [75–129] из 200): сигнал = ДОЛЯ тёмных пикселей (<215) в колонке/строке; сглаживание окном 5; зона контента = сглаженная доля >0.008 и ширина ≥10%; срабатывание = две зоны с зазором ≥2.5%, центр зазора в пределах 15–85%. Проверяются ОБА профиля: колонки (чеки рядом) и строки (чеки друг под другом)
- Промпт повторного запроса смягчён из «ТОЧНО ДВА, не отвечай count:1» в честную подсказку: «возможно два чека — внимательно сравни левую/правую части; если один документ — честно ответь count:1» — исключает выдуманное разделение одиночного чека при ложном срабатывании эвристики
- Только index.js, бэкенд без смены версии (остаётся 2026-08-04.22)

**2026-08-06 (v26 — мульти-чеки: несколько чеков на одном скане распознаются и сохраняются отдельно)**
- Кейс пользователя: скан с ДВУМЯ чеками рядом (Las Delicias 15,00€ + Leroy Merlin 20,99€) распознавался как один документ
- Backend (upload-receipt, только для изображений, не PDF): detectMultipleReceipts(processedBuffer) — быстрый запрос к gemini-2.5-flash (1024 токена, temp 0): «сколько ОТДЕЛЬНЫХ чеков на изображении», JSON {count, boxes:[[ymin,xmin,ymax,xmax] 0..1000], labels}; один длинный чек не делится (шапка/футер = один документ). При count>=2: cropByNormalizedBox (sharp.extract + поле 2%, отброс рамок <8% размера) → каждый кроп: processImage → uploadToStorage (..._checkN.jpg) → recognizeWithFallback → ensureRawTextRu → те же override (docType/object/subtype/payment_status) → saveReceiptToDB (recognition_method 'multi-check i/N (model)'). Ответ: {success, multi:true, count, documents:[...], + поля первого документа для совместимости}. Сбой детектора/всех кропов → обычный путь (один документ)
- Frontend: папка — при data.multi каждый документ добавляется в результаты строкой «имя · чек k/N»; одиночная загрузка — alert «На скане найдено чеков: N — каждый сохранён отдельно», показывается первый, список обновляется
- Побочный эффект: на каждую загрузку изображения +1 быстрый вызов Gemini-детектора (~1 сек)

**2026-08-06 (v25.6 — папка: видимая конвертация PDF + авто-повтор при 502)**
- Диагноз по скриншотам консоли: распознавание папки работало, но отдельные файлы падали с «POST /api/upload-receipt net::ERR_FAILED 502 (Bad Gateway)» (разовые сбои прокси Railway; CORS-ошибка в консоли — следствие 502, не причина)
- АВТО-ПОВТОР: каждый файл — до 2 попыток с паузой 3 сек между ними; в прогрессе видно «— сбой сети, повтор…» и счётчик «🔁 повторов после сбоев сети: N». ВНИМАНИЕ: теоретически возможен дубль, если первый запрос всё же успел сохраниться на сервере — дубли видны в списке, удаляются вручную
- КОНВЕРСИЯ PDF В UI: процесс раскладки многостраничных PDF теперь отображается отдельной фазой «📄 Конвертация PDF в изображения...» — имя файла + «стр. X / Y» + полоса прогресса (convertPdfToImages/expandFilesWithPdf получили onProgress-колбэк; раньше конвертация 20+ сканов шла «вслепую» 1-2 минуты, казалось что зависло)
- Только App.js

**2026-08-06 (v25.5 — выбор папки через showDirectoryPicker)**
- Кнопка «Распознать папку» теперь двухпутевая: Chrome/Edge → window.showDirectoryPicker() (File System Access API) — системный диалог ВЫБОРА ПАПКИ, файлы внутри выбрать физически невозможно; файлы собираются рекурсивно из вложенных папок (image/*, pdf). Safari (API не поддерживает) → прежний input webkitdirectory; если пользователь всё же выбрал отдельные файлы (нет webkitRelativePath) — показывается подсказка, что надо выбрать папку целиком, но файлы всё равно обрабатываются
- Общее тело обработки вынесено в processFolderFiles(picked); handleFolderSelect — только fallback-путь
- Только App.js

**2026-08-05 (v25.4 — дефолт Kimi K3; выбор папки снова папкой)**
- Дефолтная модель распознавания: kimi-kimi-k3 (по запросу пользователя)
- Кнопка «Распознать папку»: из folder-input УБРАНЫ multiple и accept — с ними на macOS диалог позволял выбирать отдельные файлы внутри папки; с чистым webkitdirectory выбирается только ПАПКА целиком. Фильтрация по типу остаётся в handleFolderSelect (image/*, pdf). Плюс e.target.value='' — повторный выбор той же папки теперь срабатывает
- Только App.js

**2026-08-05 (v25.3 — починка распознавания: Groq снял Llama 4 Scout с поддержки)**
- ПРИЧИНА поломки «распознать папку»: модель по умолчанию groq-llama-4-scout УДАЛЕНА Groq (decommissioned — в живом /api/check-models её нет в каталоге Groq). Каждый файл получал 400 от Groq API
- Backend: DEAD_GROQ_MODELS (llama-4-scout/maverick, 3.2-vision, mixtral, gemma2) + isGroqModelAlive(resolvedId) — проверка по ЖИВОМУ списку groq.models.list() с кэшем 10 мин (самозалечивание при будущих decommission). recognizeWithGroq бросает понятную ошибку → эндпоинт уходит в recognizeWithFallback (Gemini) — распознавание работает даже с мёртвой выбранной моделью. resolveGroqModel: дефолт сменён на llama-3.3-70b-versatile
- Frontend: дефолт selectedModel 'groq-llama-4-scout' → 'gemini-2.5-flash'; мёртвые модели удалены из MODELS (llama-4-scout/maverick, 3.2-90b/11b vision, mixtral, gemma) и из GROQ_ALIASES_FRONT

**2026-08-05 (v25.2 — контрагенты Excel-фильтром, новые объекты)**
- Фильтр контрагентов в «Анализе» переведён на компонент ExcelFilter (тот же, что у фильтров списка чеков): кнопка «Контрагент ▾» → панель с поиском, «(Выделить все)», чекбоксами, «Авто-применение», «Применить»/«Очистить»; множественный выбор (bankCpFilter: string[]); счётчики движений в подписях; выбрано N → «Контрагент (N)»
- Новые объекты: Иссера, Игорь, Лиза, Алехандро — добавлены в DEFAULT_OBJECTS; загрузка /api/objects теперь ОБЪЕДИНЯЕТ таблицу objects с DEFAULT_OBJECTS (union) → объекты видны везде сразу, без SQL. Опционально для записи в БД: insert into objects (name) values ('Иссера'),('Игорь'),('Лиза'),('Алехандро') on conflict (name) do nothing;
- Только App.js, бэкенд не тронут

**2026-08-05 (v25.1 — фильтр по контрагенту + сброс фильтров в «Анализе»)**
- Выпадающий фильтр «Все контрагенты» — уникальные counterparty из загруженных движений с количеством в скобках, сортировка по убыванию частоты (bankCounterparty)
- Кнопка «✖ Сброс» — очищает ВСЕ фильтры разом (тип, даты, контрагент, поиск); видна только когда хоть один фильтр активен (hasActiveFilters)
- Только App.js, бэкенд не тронут

**2026-08-05 (v25 — догрузка выписки, фильтры/суммы в «Анализе», ручная привязка и разбитая оплата)**
- Импорт = ДОГРУЗКА: перед вставкой движения сравниваются с уже загруженными по счёту (ключ 1: entry_number; ключ 2: дата+сумма+concept) — вставляются ТОЛЬКО новые строки, существующие и их привязки не трогаются; ответ +{skipped, totalInFile}; алерт показывает «Новых/Пропущено дублей». upsert заменён на insert новых (дедуп на нашей стороне)
- Ручная привязка: POST /api/link-bank-movement {movement_id, receipt_id} (match_status 'manual', score 100) + POST /api/unlink-bank-movement {movement_id}. Разбитая оплата: несколько платежей к одной фактуре — recomputeReceiptPayment(receiptId) пересчитывает по ВСЕМ движениям с matched_receipt_id=receipt: сумма<фактуры → 'underpaid', >= → 'paid', нет привязок → null; paid_date = дата последнего платежа; bank_movement_id заполняется только при единственной привязке
- POST /api/rematch-bank — повторный прогон автопривязки (кнопка «🔁 Автопривязка»); runBankMatching: iban опционален; исключает фактуры с ЛЮБОЙ привязкой (usedIds из bank_movements) и payment_status 'paid' — иначе разбитые оплаты (bank_movement_id=null) матчились бы повторно
- «Анализ»: фильтр по дате (с/по, date inputs); поиск по ВСЕМ полям (concept, counterparty, prefix, iban, account, сумма, остаток + имя/поставщик/№ привязанной фактуры); остаток на счёте мелким шрифтом под суммой (balance); строка сумм: «Показано N из M · Σ по фильтру −out/+inc · Σ всей выписки −out/+inc»; у привязанных — ✖ отвязка и метка ✋ (manual) вместо баллов; у непривязанных платежей — кнопка «🔗 Привязать»
- Модалка выбора фактуры (linkPicker): поиск по названию/поставщику/№/сумме, сортировка — точное совпадение суммы (подсвечено зелёным) → неоплаченные → ближайшая сумма, до 50 шт; привязка одним кликом, потом loadBankMovements+loadReceipts
- Бэкенд без смены версии (остаётся 2026-08-04.22 — watchdog не трогаем); SQL-миграций не требуется

**2026-08-04 (v24 — банковские выписки: импорт Excel + автопривязка фактур к платежам во вкладке «Анализ»)**
- ТРЕБУЕТ миграцию supabase-migration-v20.sql (таблица bank_movements + receipts.bank_movement_id/paid_date; notify pgrst)
- RLS-ПРОБЛЕМА (скриншоты 2026-08-05): импорт падает с «new row violates row-level security policy for table bank_movements». Причина: банковские эндпоинты ходят через supabaseAdmin, но SUPABASE_SERVICE_ROLE_KEY в Railway НЕ задан → фактически анонимный ключ → RLS блокирует запись. РЕШЕНИЕ (двойное): 1) миграция v20 теперь содержит `alter table bank_movements disable row level security;` + grant'ы + разрешающую policy bank_movements_all (страховка, если RLS включится снова); 2) РЕКОМЕНДУЕТСЯ задать SUPABASE_SERVICE_ROLE_KEY в Railway → householder-api → Variables (Supabase → Settings → API → service_role) — service-ключ обходит RLS полностью
- Diagnostics: + v20_receipts_bank_columns, supabase_service_key_configured, bank_movements_write_test (живой insert+delete — сразу видно, блокирует ли RLS запись); withDbSchemaHint дополнен RLS-подсказкой (срабатывает по /row-level security/i)
- Миграция v20: проверочный select начинается с receipts_count (~42 у householder) — однозначно показывает, в ТОМ ли проекте выполнен SQL (у пользователя два проекта: householder и recept!)
- Бэкенд (версия 2026-08-04.22):
  - POST /api/import-bank-statement (requireAuth, upload.single('statement')): парсит выписку Ruralvía .xlsx (Nombre/IBAN в первых 8 строках; строка заголовка «Fecha de la operación/Importe»; excelDateToIso для дат; prefix/concept из «rcbo: CONTRATO…»); дедуп upsert onConflict 'iban,entry_number' (повторный импорт не затирает совпадения); после вставки — runBankMatching; ответ {imported, account, iban, autoMatched, unmatchedPayments}
  - GET /api/bank-movements — до 1000 движений, order operation_date desc
  - runBankMatching(ownerId, iban): только расходные движения (amount<0) без привязки × чеки без bank_movement_id; скоринг: сумма exact ±0.01 (гейт +50) + counterpartySim (containment токенов, NFD-strip, стоп-слова incl. sa/sl/sau/bv/inc) max(store_name/store_name_ru/provider)×30 + окно дат (чек до платежа: −2..+45д = +15; −7..+75д = +8) + strong ID (№ фактуры/договора ≥5 цифр в concept) +40; auto если strong ИЛИ (≥80 с запасом ≥10 над 2-м кандидатом). Побочный эффект: movement matched_receipt_id/match_status 'auto'/match_score/matched_at + receipt payment_status 'paid', paid_date=operation_date, bank_movement_id; в одном прогоне чек не используется дважды (best.r.bank_movement_id помечается)
  - withDbSchemaHint: подсказка миграции v20 для ошибок /bank_movements/i (v19 — для /payment_status/i)
  - diagnostics: v20_receipts_bank_columns (bank_movement_id+paid_date), v20_bank_movements_table, fix_v20_if_false
  - Unit-тест на реальной выписке movimientos-30.xlsx: 248/248 движений; авто-совпадения AXA→95б, Comunidad→88б, O2×2, Telefónica, AEAT (strong); поступления Booking/Airbnb игнорируются; платёж O2 44.42 НЕ привязан к чеку Plenitude (гейт по имени)
- Фронт:
  - Кнопка «🏦 Выписка банка» (зелёная #16a085) в тулбаре загрузки + hidden input accept .xlsx,.xls → handleStatementSelect (FormData 'statement', alert со статистикой, loadReceipts)
  - Вкладка «📊 Анализ»: stats-карточки (движения/платежи/привязано/без фактуры/неоплаченные фактуры), фильтр (все/расходы/поступления/привязанные/без пары), поиск по concept/counterparty, кнопка 🔄 (loadBankMovements); строка движения: дата | concept+prefix | сумма (красная/зелёная) | 🟢 кнопка привязанного чека (match_score, → openReceiptById открывает модалку) или ⚪ «Без фактуры»
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
- DOC_TYPE_LABELS (frontend, единый источник для фильтра «Тип», селекторов загрузки/редактирования/массовой смены): + municipality «🏛️ Мэрия», tax «💰 Налоговая», proposal «🤝 Комм. предложение"
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
- РЕШЕНИЕ — асинхронные задачи: POST /api/upload-document-pages после загрузки файлов сразу отвечает { jobId } (секунды, до любого таймаута), обработка идёт в фоне; фронтенд опрашивает GET /api/doc-job/:id каждые 4 сек. Хранилище задач — in-memory Map (single-instance Railway), TTL 2 ч, автоочистка; при перезапуске сервера задача теряется → 404 → понятное сообщение «загрузите заново"
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

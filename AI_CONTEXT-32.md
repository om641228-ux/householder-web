# Householder-Web — AI Context File (ФИНАЛЬНЫЙ)

Полный контекст проекта для AI-ассистента. Загрузите этот файл в новый чат вместе с `App.js` и `index.js` — ассистент сразу поймёт архитектуру, историю и текущее состояние.

**Дата обновления: 2026-08-16**
**ВАЖНО: работа ведётся ТОЛЬКО над проектом householder-web. Проект recept-web — отдельный, его файлы и сервисы не трогать!**

---

## v45 (2026-08-16) — Меню 📅▾: закрытие, сброс выбора, страховка частоты

- **Закрытие меню**: useEffect на `calPicker` — клик вне меню закрывает его (window click listener; кнопка 📅▾ и само меню делают `e.stopPropagation()`). В шапке меню добавлена кнопка ✕ (`setCalPicker(null)`).
- **Сброс выбора**: внизу меню кнопка «✖ Сбросить выбор (убрать из календаря)» — видна, только если у контрагента строки есть плановые платежи. `resetCalendarChoice(m)`: находит `plannedPayments` по `norm(cpKey)` (своя локальная norm — то же правило, что normCpKey: lowercase, non-alnum→space, 40 симв.), confirm, DELETE каждого, фильтр state.
- **Страховка частоты**: в `assignToCalendar` — если сервер вернул `data.item` без `freqMonths`, alert: выполнить миграцию v27 и redeploy householder-api (иначе платёж ежемесячный). Причина бага «раз в год вставляется в каждый месяц»: freq_months терялся на старом бэкенде/без миграции v27 → default 1.
- Только App.js; бэкенд без изменений. Линт: 0 ошибок, 3 прежних warning.

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

## v45.1 (2026-08-16) — Диагностика «частота не сохраняется»

- Симптом у пользователя: alert «Сервер не сохранил частоту» даже после redeploy. Причина: Railway Redeploy пересобирает тот же коммит — старый index.js игнорирует freq_months (успешный insert, freq=1 по умолчанию).
- index.js: `/api/health` теперь возвращает `build: 'v45-2026-08-16'` + список features — позволяет проверить, какая версия реально задеплоена.
- App.js: alert в `assignToCalendar` дополнительно запрашивает `/api/health` и показывает билд сервера + пошаговую инструкцию (push index.js в git → миграция v27 → redeploy).

## v45.2 (2026-08-16) — Годовые платежи не были видны

- Причина: `assignToCalendar` шлёт `start_date: m.operation_date` — страховка (апрель) с freq=12 корректно выходит только в апреле, а таймлайн был 6 мес (авг–янв) → «не отображается».
- Таймлайн расширен 6 → 12 месяцев (`tlNextMonths`, заголовок «на 12 месяцев»).
- Чип планового платежа теперь показывает частоту и ближайший месяц оплаты: `✋ Имя · ~N числа · раз в 12 мес · след: Апр 27 · сумма` (поиск next due перебором 24 мес через dueInMonth).
- Только App.js. Линт: 0 ошибок, 3 прежних warning.

## v46 (2026-08-16) — Таймлайн как выписка + объект/контрагент/фактура в плановом платеже

- **Таймлайн** перерисован в стиле строк банковской выписки: месяц-заголовок + Σ справа, строки `~09.04.2027 | **название** 🔁 частота | −сумма красным | 🟢 Фактура / ⚪ Без фактуры`, сортировка по дню.
- **Модалка «＋ Плановый платёж»**: новые поля — «Объект» (select CAL_PAYEES, как меню 📅▾), «Контрагент» (input + datalist `#planned-cp-list` из уникальных контрагентов выписки), «Фактура» (file input pdf/image → POST /api/planned-payments/upload → fileUrl/fileName; чип со ссылкой и ✕). Если объект выбран, title = `${object} — ${counterparty || title}`.
- `assignToCalendar` теперь шлёт `object_name: name`.
- manualRows + ✋-чип: `fileUrl/fileName`, ссылка «📎 фактура».
- **Backend**: ppToApi/POST принимают `object_name, file_url, file_name`; новый `POST /api/planned-payments/upload` (crmMediaMulter('file') → uploadToStorage); build `v46-2026-08-16`.
- **Миграция supabase-migration-v28-planned-object-file.sql**: `object_name text, file_url text, file_name text` + notify pgrst. ОБЯЗАТЕЛЬНА перед деплоем бэкенда.
- Линт: 0 ошибок, 3 прежних warning.

## v46.1 — Фикс загрузки фактуры планового платежа

- Баг «Файл не получен»: crmMediaMulter использует `.array(field)` → файл в `req.files[0]`, а не `req.file`. Эндпоинт `/api/planned-payments/upload` теперь берёт `(req.files && req.files[0]) || req.file`. Build `v46.1-2026-08-16`.

## v46.2 — Русские имена файлов + привязка распознанного чека к плановому платежу

- **Backend**: multer отдаёт originalname в latin1 → mojibake для кириллицы; в `/api/planned-payments/upload` имя восстанавливается `Buffer.from(name,'latin1').toString('utf8')` (с проверкой на U+FFFD). Build `v46.2-2026-08-16`.
- **Frontend**: в модалке планового платежа кнопка «🧾 Из распознанных» — пикер чеков/фактур из `receipts` (поиск по названию/сумме/номеру, до 50 строк: дата, название, сумма). Выбор сохраняет `fileUrl = 'receipt:{id}'`, `fileName = store_name`.
- Отображение: если fileUrl начинается с `receipt:` — рендерится кнопка `openReceiptById(id)` (✋-чип и строка таймлайна), иначе обычная <a>. Без новой миграции: используется file_url/file_name из v28.
- Линт: 0 ошибок, 3 прежних warning.

## v47 (2026-08-16) — Одноразовый платёж + выбор чека на странице распознанных

- **Одноразовый платёж (freq 0)** везде: CAL_FREQS = [1,2,6,12,0]; calFreqLabel(0) = 'одноразовый (только месяц начала)'; в меню 📅▾ пункт «⚡ 1 раз — одноразовый»; в селекте модалки — «одноразовый…». dueInMonth: freq 0 → diff === 0. Backend принимает freq_months 0 (`[0,1,2,6,12]`). Build `v47-2026-08-16`.
- **Выбор из распознанных — через страницу чеков**: в модалке кнопка «🧾 Выбрать из распознанных →» закрывает модалку (форма сохраняется в state), включает `plannedPickMode` и открывает вкладку 'list'. Там фиолетовый баннер-инструкция с кнопкой «← Назад к платежу без выбора», на каждой карточке — кнопка «✅ Выбрать» (рядом с чекбоксом). Выбор: fileUrl=`receipt:{id}`, fileName=название → назад на 'analysis', модалка открывается. Встроенный пикер (v46.2) и его стейты удалены.
- Линт: 0 ошибок, 3 прежних warning.

## v48 (2026-08-16) — Сворачиваемые блоки + рельса быстрого перехода (Анализ)

- **Сворачивание**: стейты `payCalCollapsed`, `bankListCollapsed`. Кнопка ▾/▸ в шапке «📅 Обязательные повторяющиеся платежи» (скрывает календарь, ✋-чипы, таймлайн) и в новой шапке «🏦 Выписка банка» (скрывает фильтры, сводку Σ и список; в свёрнутом виде показывает «скрыто строк: N · Σ …»).
- **Рельса справа (fixed, right 6, width 62)**: секция «📅 план» — 12 месяцев таймлайна (якоря `tl-{ym}` на месяцах, текущий подсвечен), секция «🏦 выписка» — месяцы из движений desc (bmMonths; январь показан как ГОД синим, якоря `bm-{ym}` на первой строке месяца через `(m, mi)` в visible.map). scrollIntoView smooth, scrollMarginTop 100.
- Только App.js. Линт: 0 ошибок, 3 прежних warning.

## v48.1 — Рельса в стиле меню «Чеки»

- Рельса перерисована точно как rail в «Чеках»: год жирным (клик → первый месяц года), месяцы под ним без года, ширина 76, скроллбар скрыт (scrollbarWidth none). Подписи «план/выписка» убраны.
- Месяцы выписки и плана объединены без дублей: `railTarget` (Map ym → `bm-`/`tl-` якорь), `railYears` desc; считаются ПОСЛЕ tlNextMonths (иначе no-use-before-define).
- Линт: 0 ошибок, 3 прежних warning.

## v48.2 — Активные значки в рельсе

- Вверху рельсы кнопки-иконки: 📅 → скролл к началу блока платежей (якорь `paycal-top`), 🏦 → к началу выписки (якорь `banklist-top`). Линт: 0 ошибок, 3 прежних warning.

## v49 (2026-08-16) — Верхние строки как таймлайн + активна/неактивна/удалить

- ✋-чипы заменены на строки в стиле таймлайна: `~16 числа | **имя** 🔁 частота · след: … | −сумма | 🟢 Фактура/⚪ Без фактуры | 🟢 Активна/⚪ Неактивна | ✕`.
- **Активность**: manualRows получили `active: p.active !== false`; неактивные — полупрозрачные (opacity .55), НЕ участвуют в календаре (`dayItems`) и таймлайне (`due`), «след:» скрыт. `togglePlannedPayment(g)` → PATCH /api/planned-payments/:id {active}.
- **Backend**: GET /api/planned-payments возвращает все записи (active desc, day asc) — раньше только active=true; новый PATCH /:id (update active → ppToApi). Build `v49-2026-08-16`.
- Линт: 0 ошибок, 3 прежних warning.

## v49.1 — Фикс «Не переключилось: Load failed»

- Причина: CORS `methods` не содержал PATCH → preflight OPTIONS падал в браузере. Исправлено: добавлен PATCH в methods; переключение переведено на POST `/api/planned-payments/:id/toggle` (общий handler togglePlannedHandler, PATCH оставлен как алиас). Build `v49.1-2026-08-16`.

## v50 (2026-08-16) — Диапазон вывода таймлайна

- Стейты `tlFrom`/`tlTo` (default: текущий месяц … +11). `tlNextMonths` строится по диапазону (cap 48 мес); `tlOptions` — 72 месяца (год-2 … +3), `tlYmLabel` = «Август 2026». Шапка таймлайна: «🗓 Таймлайн платежей с [select] по [select]» — как «с/по» в налоговых формах.
- Только App.js. Линт: 0 ошибок, 3 прежних warning.

## v51 — Σ за выбранный диапазон таймлайна

- `tlTotal`: сумма активных платежей по всем месяцам диапазона (manualRows active + dueInMonth). Выводится в шапке таймлайна справа: «Σ за период: −X EUR». Линт: 0 ошибок, 3 warning.

## v52 (2026-08-17) — Локальный Mac OCR (Apple Vision) как модель распознавания

- **Архитектура**: на Mac пользователя крутится `mac-ocr-server.py` (127.0.0.1:8787, pip3 install ocrmac; POST /ocr — сырое тело файла, ?name= для расширения; языки es/ru/en; CORS *). Фронт при выборе модели `local-mac-ocr` шлёт каждую страницу на локальный сервер → собирает тексты → POST /api/upload-document-pages с полем `ocr_texts` (JSON-массив).
- **Backend**: в upload-document-pages ветка `req.body.ocr_texts` (перед проверкой genAI) — vision пропускается, `finalizeDocumentFromPageTexts(pageTexts)`, страницы в Storage (page_urls), method `local mac-ocr Np (async)`, job-режим как обычно. Build `v52-2026-08-16`.
- **Frontend**: `LOCAL_MAC_MODEL` ('local-mac-ocr', '🖥 Mac OCR (локально, Vision)') добавлен в начало списка моделей (`modelsAll`); в recognizeDocumentPages при этой модели — локальный OCR с прогрессом, ошибка с инструкцией запуска. `LOCAL_OCR_URL = http://127.0.0.1:8787/ocr`.
- Деливерабл: mac-ocr-server.py. Линт: 0 ошибок, 3 прежних warning.

## v52.1 — Защита локального OCR от пустых сохранений

- Причина «не распознаётся локально»: старый бэкенд игнорировал ocr_texts → чек сохранялся пустым (мусор «0000…» в переводе).
- Фронт: перед локальным OCR проверяет `/api/health` build ≥ v52 (иначе ошибка с инструкцией redeploy); после OCR валидирует текст (≥10 симв./страница).
- ВНИМАНИЕ: в проекте уже был свой локальный OCR — Unlimited-OCR/llama-server (`LOCAL_OCR_FALLBACK_URLS` 8081→8080, кнопка «🖥 Локально», cloudflared-туннель, см. шапку App.js и ~стр.2930). Это ОТДЕЛЬНЫЙ механизм от local-mac-ocr (8787).

## v52.2 — 2026-08-17 — Mac OCR: Safari блокирует 127.0.0.1 (mixed content)
Симптом: mac-ocr-server.py запущен и слушает 127.0.0.1:8787, но браузер: «Локальный Mac OCR недоступен». Причина: страница приложения открыта по https, fetch на http://127.0.0.1 блокируется Safari/Chrome (mixed content / Private Network Access).
Исправлено:
1. mac-ocr-server.py `_cors()`: добавлен заголовок `Access-Control-Allow-Private-Network: true` (Chrome PNA-preflight). **Пользователь должен перекопировать файл на Mac и перезапустить сервер.**
2. App.js: константа `LOCAL_OCR_URL` → `LOCAL_MAC_OCR_DEFAULT = 'http://127.0.0.1:8787'`; новое состояние `macOcrUrl` (localStorage 'mac_ocr_url_v1') + `configureMacOcr()` (prompt, как configureLocalOcr для Unlimited-OCR). Fetch идёт на `${macOcrUrl || LOCAL_MAC_OCR_DEFAULT}/ocr?name=…`.
3. Кнопка ⚙ рядом с бейджем активной модели (видна только при selectedModel === 'local-mac-ocr').
4. Текст ошибки при недоступности теперь объясняет mixed content и даёт рецепт: `brew install cloudflared` → `cloudflared tunnel --url http://127.0.0.1:8787` → вставить https://….trycloudflare.com через ⚙. Если задан свой URL и он недоступен — отдельное сообщение.
Проверки: esbuild OK; eslint 0 errors / 3 pre-existing warnings. Бэкенд index.js не менялся (нужен уже задеплоенный build v52+).

## v52.3 — 2026-08-17 — Mac OCR: диагностика связи через туннель
Симптом: URL туннеля задан (https://….trycloudflare.com), но распознавание падает на 1-й странице: «Mac OCR недоступен по адресу …». Причины-кандидаты: туннель/cloudflared остановлен, сервер не запущен, или URL устарел (cloudflared при КАЖДОМ перезапуске выдаёт НОВЫЙ адрес).
Исправлено (только App.js):
1. `macOcrBase()` и `testMacOcr(base)` — GET `${base}/` с таймаутом 8 с (AbortController), ожидает {"status":"ok"}; возвращает {ok, detail} (HTTP-код / таймаут / message сети).
2. `configureMacOcr()`: после ввода URL сразу проверяет связь и показывает alert ✅/❌ с причиной и чек-листом.
3. recognizeDocumentPages: ветка local-mac-ocr перед постраничным циклом делает probe — понятная ошибка ДО начала работы, разные тексты для «свой URL» и «прямой 127.0.0.1».
4. Постраничный catch теперь показывает номер страницы и техническое message ошибки.
Проверки: esbuild OK; eslint 0 errors / 3 pre-existing warnings. Сервер mac-ocr-server.py не менялся (уже с PNA-заголовком из v52.2).

## v52.4 — 2026-08-17 — Mac OCR: ocrmac не установлен (PEP 668)
Скриншоты пользователя: cloudflared пишет «Unable to reach the origin service… 127.0.0.1:8787 connection refused», а запуск mac-ocr-server.py падает с «Нужен пакет ocrmac» — выше в терминале pip отказал из-за PEP 668 (externally-managed-environment, Homebrew-Python на новых macOS). Т.е. сервер НИКОГДА не слушал порт в этой сессии.
Исправлено: mac-ocr-server.py — docstring и сообщение при ImportError теперь ведут через venv:
  python3 -m venv venv && ./venv/bin/pip install ocrmac
  запуск: ./venv/bin/python mac-ocr-server.py
(альтернатива: pip3 install --user ocrmac). Код сервера не менялся. App.js не менялся (остаётся v52.3).

## v52.5 — 2026-08-17 — Mac OCR: порядок строк → мусорная структура (4.75 AED)
Симптом: через local mac-ocr чек сохраняется «Другое», Итого 4.75 AED, без даты, 0 товаров; после перераспознавания (Gemini vision) — всё верно (1171.27 EUR). Причина: Apple Vision возвращает блоки в произвольном порядке, у двухколоночной фактуры строки колонок перемешаны → LLM при финализации теряет связи метка→сумма. Бэкенд НЕ при чём: ветка ocr_texts использует ту же finalizeDocumentFromPageTexts, что и vision-пайплайн.
Исправлено в mac-ocr-server.py: sort_annotations() — группировка блоков в строки по y (порог 0.6×медианной высоты; Vision-координаты снизу-вверх → сортировка по -y), внутри строки по x, части строки склеиваются тремя пробелами (колонки сохраняют разделение). Проверено на синтетике: «TOTAL IMPORTE FACTURA:   1.171,27 €» в одной строке.
Действие пользователя: перекопировать .py на Mac и перезапустить (./venv/bin/python mac-ocr-server.py). App.js/index.js не менялись (остаются v52.3/v52).

## v52.6 — 2026-08-17 — Mac OCR: «пустой/короткий текст» после v52.5
Причина: ocrmac возвращает блоки как (text, confidence, (x, y, w, h)) — рамка ВЛОЖЕННЫМ кортежем, а sort_annotations v52.5 распаковывал плоский (a[2],a[3],a[5]) → все блоки отбрасывались → пустой текст → фронт бросал «пустой/короткий текст по странице».
Исправлено в mac-ocr-server.py: sort_annotations поддерживает оба формата (плоский len>=6 и вложенный box=a[2]); плюс страховка в do_POST — если после сортировки текст пуст, но блоки есть, используется простая склейка a[0]. Проверено на вложенном формате: строки собираются верно.
Действие пользователя: перекопировать .py и перезапустить (./venv/bin/python mac-ocr-server.py). App.js/index.js не менялись.

## v53 — 2026-08-17 — Пост-контроль валюты/итога/даты после LLM-структурирования
Симптом (local mac-ocr, ID 715): Итого 1.17 AED, даты нет — LLM обрезал «1.171,27» и выдумал валюту.
Требования пользователя: 1) испанская фактура → EUR; 2) контрольная сумма итога по строчкам.
Исправлено в index.js: enforceCurrencyAndTotal(data, rawText) — вызывается в finalizeDocumentFromPageTexts и finalizeReceiptFromPageTexts перед выставлением document_type.
- Валюта: признаки Испании (€, CIF/NIF, IGIC/IVA, FACTURA, TENERIFE и др.) → принудительно EUR.
- Итог: regex-кандидаты у слов TOTAL/IMPORTE/ИТОГО (европейский формат 1.171,27), best=max; замена, если: Σ items ≈ best (контрольная сумма, 2%), масштаб 1:1000, или итог < 1% от best. Если итога нет — Σ items.
- Дата-фолбэк: «9 de febrero de 2024» (исп. месяцы) и «Fecha… 09/02/2024».
- Маркер сборки /api/health: v53-2026-08-17.
Юнит-тесты (node): case1 (AED 1.17) → EUR 1171.27 + дата; case2 (нет итога, Σ строк 1171.27) → 1171.27; case3 (корректный результат) — не портится. node --check OK.
Действие пользователя: запушить index.js + redeploy householder-api; фронтенд не менялся (v52.3).

## v53.1 — 2026-08-17 — Кнопка «Локально» теперь = Mac OCR (Unlimited-OCR удалён)
Требование пользователя: «Замени локальную версию на Mac OCR».
Исправлено в App.js:
- Удалены: LOCAL_OCR_FALLBACK_URLS, localOcrUrl/configureLocalOcr, fileToDataUrl, ocrPageLocal, recognizeLocal (llama-server :8080/8081, uocr-proxy).
- Новая recognizeViaMacOcr(): Word-файлы → обычный путь; иначе setSelectedModel('local-mac-ocr') + recognizeDocumentPages(selectedFiles, 'local-mac-ocr').
- recognizeDocumentPages(files, modelOverride=null): effModel = modelOverride || selectedModel (ветка local-mac-ocr и formData 'model' через effModel).
- Кнопка под «Распознать и сохранить»: «🖥 Локально (Mac OCR, бесплатно)» → recognizeViaMacOcr.
- Метка сборки: «сборка 2026-08-17 · v53.1 · Mac OCR: туннель/прямой 127.0.0.1:8787 ⚙» (⚙ → configureMacOcr).
Проверки: esbuild OK; eslint 0 errors / 3 pre-existing warnings. Бэкенд не менялся (v53).

## v53.2 — 2026-08-17 — Mac OCR: зависание на «Загрузка… 8%»
Симптом: локальный OCR отработал (все 5 стр. в терминале mac-ocr-server), но фронт завис на «Загрузка… 8%» — это upload страниц на бэкенд (uploadWithProgress), встал на ~20% без watchdog и висел бесконечно (xhr.timeout=15 мин срабатывает только при полном молчании соединения).
Исправлено в App.js:
1. uploadWithProgress: сторож фазы загрузки — 2 мин без upload-прогресса → xhr.abort() + понятная ошибка (сеть/VPN/прокси, повторите). Сторож отключается на xhr.upload.onload (тело ушло — ответ сервер может готовить долго, это норма).
2. Mac OCR-путь: страницы для бэкенда жмутся ПРИНУДИТЕЛЬНО (compressImageFile(f,1600,2400,0.72,force=true)) — OCR идёт по оригиналам локально, на сервер уходят лёгкие копии для хранения/показа. compressImageFile получил 5-й параметр force.
3. pages в FormData теперь добавляются после ветки OCR (pagesToUpload).
4. Метка сборки: v53.2.
Проверки: esbuild OK; eslint 0 errors / 3 pre-existing warnings. Бэкенд не менялся (v53).

## v53.3 — 2026-08-17 — Mac OCR: товары распознаются, но не попадают в карточку (Товары 0)
Причина: Mac OCR (ветка ocr_texts в upload-document-pages) структурируется ДОКУМЕНТНЫМ промптом buildDocumentSummaryPrompt, где items жёстко «[]» — позиции чека не извлекались (чек Леруа Мерлен: товары в raw_text есть, items пуст).
Исправлено в index.js: buildDocumentSummaryPrompt — поле items теперь инструкция: для receipt/invoice извлекать КАЖДЫЙ товар (name/name_ru/quantity/price/total), строки RAEE/«взнос за отходы» — отдельными позициями, EAN-штрихкод ≠ цена; для bill — строки начислений; прочие типы — []. Маркер сборки: v53.3-2026-08-17. node --check OK.
Действие пользователя: запушить index.js + redeploy householder-api. Фронтенд не менялся (v53.2).

## v54 — 2026-08-17 — Антидубликаты при сохранении чеков
Симптом: один чек Леруа Мерлен сохранён дважды (117.75 EUR, 16 товаров; даты 12.07 и 02.07 — OCR перепутал день).
Бэкенд index.js: в saveReceiptToDB перед insert — поиск кандидатов: owner_id, total_amount ±0.02, receipt_date ±40 дней; магазин сверяется по нормализованному префиксу (8 симв.). Совпадение → throw err.code='DUPLICATE' с описанием существующей карточки (#id, дата, сумма). Обход: receiptData.allowDuplicate — выставляется во всех 7 точках сохранения из formData allow_duplicate='1'. Маркер: v54-2026-08-17.
Фронт App.js: recognizeDocumentPages и recognizeAndSave получили параметр allowDuplicate; на ошибке /дубликат/i — window.confirm «Сохранить всё равно?» → повтор с allow_duplicate=1. Работает и для async job (текст дубликата приходит через job.error). Метка: v54.
Проверки: node --check OK; esbuild OK; eslint 0 errors / 3 pre-existing warnings.
Действие пользователя: запушить index.js + App.js, redeploy ОБОИХ сервисов; существующий дубль (02.07.2025) удалить вручную.

## v54.1 — 2026-08-17 — Антидубликат: не блокировать, только ПОМЕТКА
Требование пользователя: «сохраняй все распознанные чеки, не выводи предупреждение — только пометку дубликат».
Бэкенд index.js: saveReceiptToDB больше НЕ бросает DUPLICATE — при совпадении (магазин-префикс + сумма ±0.02 + дата ±40 дн.) сохраняет всегда, добавляя в recognition_method метку «· ⚠ дубликат #ID» и duplicate_of {id,store_name,receipt_date,total_amount,currency} в ответ (не колонка БД). Маркер: v54.1-2026-08-17.
Фронт App.js: confirm-диалоги «Сохранить всё равно?» удалены; на карточке в списке — плашка «⚠ дубль» (по recognition_method содержащему «дубликат»); в панели «Сохранено» — строка «⚠️ Похоже на дубликат чека #ID …» при duplicate_of. Метка: v54.1.
Проверки: node --check OK; esbuild OK; eslint 0 errors / 3 pre-existing warnings.
Действие пользователя: запушить index.js + App.js, redeploy обоих сервисов; старые дубли удалить вручную.

## v54.2 — 2026-08-17 — Строгий фолбэк позиций товаров (Mac OCR: «Товары 0»)
Симптом: чек Леруа Мерлен через local mac-ocr — товары есть в raw_text, но items пуст (LLM вернул []).
Исправлено в index.js: extractItemsFallback(rawText) — детерминированный парсер: строка, оканчивающаяся ценой («34,99»/«5.95»), — позиция; название = текст той же строки без EAN (8–14 цифр) + до 2 предшествующих текстовых строк; служебные строки (ИТОГО/TOTAL/IVA/IGIC/ФАКТУРА/CIF/оплата/сдача…) — разделители. Подключён в finalizeDocumentFromPageTexts (только если ≥2 позиций и есть ИТОГО/TOTAL/TICKET/FACTURA; document_type 'other'→'receipt') и в finalizeReceiptFromPageTexts (≥2 позиции). Дальше работает v53-контроль суммы по строкам. Тест на тексте чека (RU/ES): 6 позиций, чистые названия, шапка не затягивается. Маркер: v54.2-2026-08-17. node --check OK.
Действие пользователя: запушить index.js + redeploy householder-api (проверить /api/health → v54.2). Фронтенд не менялся (v54.1).

## v54.2 (фронт) — 2026-08-17 — Единая система дубликатов (КОПИЯ vs ⚠ дубль)
Было ДВЕ системы: 1) давняя фронтендовая КОПИЯ/ОРИГИНАЛ — группы по ТОЧНОМУ ключу название+дата+сумма с проверкой сильных идентификаторов (contract_number/cups/invoice_number/supply_address/object + текст CUPS/числа Jaccard<0.7 → разные), самый ранний created_at = ОРИГИНАЛ, остальные = КОПИЯ, режим «показать дубликаты»; 2) моя плашка «⚠ дубль» (v54.1) по recognition_method бэкенда — дублировала первую.
Исправлено в App.js: плашка «⚠ дубль» УДАЛЕНА; пометка бэкенда «· ⚠ дубликат #ID» теперь ВЛИВАЕТ помеченную карточку в группу КОПИЯ указанного оригинала (если группы нет — создаёт пару [orig, r]). Бэкенд не менялся (остаётся v54.2 с fallback-парсером товаров и маркером). Метка: v54.2.
Проверки: esbuild OK; eslint 0 errors / 3 pre-existing warnings.
Действие пользователя: запушить App.js, redeploy фронтенда.

## v54.3 — 2026-08-17 — Точная дата из штампа чека + русские названия товаров
1) Дата: в enforceCurrencyAndTotal добавлен штамп «дата+время» подвала чека (…000929 10/01/2026 10:50). Для кассовых документов (ticket/factura simplificada/recibo/чек) он ПЕРЕКРЫВАЕТ даже дату от LLM (OCR путает день: 12.07→02.07); receipt_time заполняется, если пуст. Дальше — прежние фолбэки (исп. месяцы, Fecha…).
2) Русские названия: фолбэк-позиции (v54.2) получали name_ru=null → в карточке был испанский. Новый translateItemNames(items) — ОДИН пакетный вызов callTextChain, нумерованный список → name_ru. Вызывается в обеих точках фолбэка. Фронт уже рендерит name_ru || name (ничего не менял).
Маркер: v54.3-2026-08-17. node --check OK. Фронтенд не менялся (v54.2).
Действие пользователя: запушить index.js + redeploy householder-api (проверить /api/health → v54.3).

## v54.4 — 2026-08-17 — Пакетное распознавание: потеря качества (Mac OCR обходился)
Причина: «Распознать папку» и одиночный файл с моделью local-mac-ocr шли на /api/upload-receipt — бэкенд не знает эту модель → else-ветка recognizeWithFallback (дешёвый gemini flash) → резкая потеря качества. Локальный OCR работал только через recognizeDocumentPages (кнопка «Локально» / многостраничный режим).
Исправлено в App.js:
1. recognizeFilesSequentially: ветка local-mac-ocr — проверка /api/health (build ≥ v52) один раз в начале; для каждого файла: POST на mac-ocr-server → ocr_texts + сжатая копия (force 0.72) → upload-document-pages → pollDocJob. Те же 2 попытки/файл.
2. recognizeAndSave: при selectedModel='local-mac-ocr' (кроме режима separate) — всегда recognizeDocumentPages(files, 'local-mac-ocr'); separate уходит в mac-aware recognizeFilesSequentially.
Метка: v54.4. esbuild/eslint чисто (3 pre-existing warnings). Бэкенд не менялся (v54.3).
Действие пользователя: запушить App.js + redeploy фронтенда.

## v55 — 2026-08-17 — Макеты карточки по типу документа
Требование: разные поля для чека / фактуры / КП / договора-справки.
App.js: блок «Основная информация» заменён на типизированный (IIFE, rows по dt):
- receipt (и прочие) — как было (магазин, дата, итого, оплата, Δ и т.д.);
- invoice — «Фактура»: Продавец, № фактуры, Дата фактуры, Итого к оплате, База, Налог (IVA/IGIC + ставка), Объект, Адрес поставки, Оплата/Дата оплаты, Δ-контроль, № договора, Период;
- proposal — «Коммерческое предложение»: Поставщик, № предложения, Дата, Сумма, Действительно до (+бейдж срока), Объект, Контакт;
- contract/municipality — «Договор»/«Справка»: Документ, № договора, Дата подписания, Эмитент (provider), Сумма, Действует с/по, Объект/Адрес.
Таблица позиций: заголовок «Позиции» для invoice/proposal/bill, «Товары» для receipt; скрыта для contract/municipality/bank/tax когда пуста. Стороны (party_a/party_b) НЕ выведены — они хранятся только в detail-таблицах (contract_documents), в ответе receipts их нет (backend не трогали).
Метка: v55. esbuild/eslint чисто. Действие: запушить App.js + redeploy фронтенда.

## v55.1 (2026-08-18) — стороны и summary в карточках всех типов документов
Запрос: «Если нужно выводить стороны — скажи, расширю API → в договоре, фактуре и других документах».
**Backend (index.js, build v55.1-2026-08-18):**
- Промпт buildDocumentSummaryPrompt: party_a/party_b теперь извлекаются и для invoice/bill
  (party_a = emisor/proveedor, party_b = cliente/titular), не только contract/municipality/bank/tax.
- saveReceiptToDB record: + party_a/party_b/summary (filterRecordByColumns отсечёт без колонок;
  добавлено громкое предупреждение → supabase-migration-v29-receipt-parties.sql).
- GET /api/receipts: после выборки подмешивает party_a/party_b/summary из детальных таблиц
  contract_documents (party_a/party_b/summary) и proposals (vendor_name→party_a, notes→summary)
  для записей, где поля пусты (старые документы). Best-effort, ошибки таблиц не роняют выдачу.
**Миграция:** supabase-migration-v29-receipt-parties.sql — alter table receipts add column
if not exists party_a/party_b/summary text. Без неё всё работает, но стороны новых документов
не сохранятся в receipts (останутся в детальных таблицах и будут подмешаны в GET).
**Frontend (App.js, метка v55.1):** новые строки карточек (viewModal):
- invoice: «Покупатель» (party_b), «Суть документа» (summary);
- proposal: «Примечания» (summary);
- contract/municipality: «Сторона А / эмитент» (party_a || provider), «Сторона Б» (party_b), «Суть документа» (summary);
- bank/tax/tax_form/annual_accounts: «Сторона А», «Сторона Б», «Суть документа»;
- bill: «Титулар» (party_b). Чек (receipt) — без изменений.
Проверки: node --check OK; esbuild OK; eslint 0 ошибок / 3 прежних warning.
Деплой: оба сервиса; миграцию v29 выполнить в Supabase.

## v56 (2026-08-18) — оба контрагента полностью + MarkItDown (PDF → Markdown) перед распознаванием
Запрос: «добавь в карту распознавания договора и фактур — обоих контрагентов; добавь MarkItDown
перевод PDF в Markdown перед распознаванием» (скрин: фактура воды Adeje, emisor + RONESIA LIMITED).
**Контрагенты (index.js):** промпт party_a/party_b усилен — ПОЛНОСТЬЮ одной строкой на языке
оригинала: название + NIF/CIF + адрес. party_a = выдавший (contract/municipality/bank/tax:
arrendador/vendedor/banco/Ayuntamiento; invoice/bill: emisor/proveedor), party_b = получатель
(arrendatario/comprador/contribuyente; invoice/bill: cliente/titular). Вывод в карточках — уже из v55.1.
**MarkItDown — backend (index.js, build v56-2026-08-18):**
- pdfToMarkdown(buffer, filename): temp-файл → CLI `markitdown` (fallback `python3 -m markitdown`),
  таймаут 120с, ≥40 симв.; ENOENT → markitdownMissing, тихо уходим в vision. Requires: child_process, os.
- upload-document-pages: новая ветка ПОСЛЕ Word и ДО ocr_texts/vision — фронт прикладывает исходные
  PDF полем pages + `pdf_source_names` (JSON имён). Все PDF конвертированы → pageTexts=markdown,
  финализация без vision (метод `pdf markdown (markitdown, N док., async)`); хранение: JPEG-страницы,
  иначе сам PDF. Не вышло → PDF-источники отбрасываются, картинки идут в vision как раньше.
  `const files` → `let files`.
- Railway: нужен python3 + `pip install "markitdown[pdf]"` в образе; без него — обычный vision.
**MarkItDown — frontend (App.js, метка v56):**
- pdfSourcesRef (useRef([])) — исходные PDF; заполняется в обеих точках выбора файлов и в
  processFolderFiles (защита от устаревших). Страж: вся пачка — страницы PDF (/_p\d+\.jpg$/).
- local-mac-ocr: перед Vision-циклом — POST исходного PDF на `${macBase}/pdf-md`; все PDF дали
  текст ≥40 симв. → ocrTexts = markdown, Vision пропущен; иначе обычный /ocr по страницам.
- прочие модели: исходные PDF прикладываются в formData (pages + pdf_source_names).
**MarkItDown — mac-ocr-server.py:** мягкий импорт markitdown (_md), эндпоинт POST /pdf-md?name=
(200 {text}, 503 нет пакета, 422 нет текстового слоя → фронт уходит в Vision), GET / отдаёт
"markitdown": true/false; docstring: `./venv/bin/pip install ocrmac "markitdown[pdf]"`.
Проверки: node --check OK; esbuild OK; eslint 0 ошибок / 3 прежних warning; python ast.parse OK.
Деплой: index.js + App.js + mac-ocr-server.py (на Mac доустановить markitdown); миграций БД нет.

## v56.1 (2026-08-18) — проверка MarkItDown + цветные и информативные прогрессбары
Запрос: «markitdown[pdf] — сделай проверку работает это или нет; при загрузке и распознавании
чтобы прогрессбар показывал проценты другим цветом; при пакетной обработке — информативный прогресс бар».
**Проверка MarkItDown (в песочнице, pip install "markitdown[pdf]"):**
- CLI `markitdown file.pdf` → markdown на stdout, exit 0 — все данные тестовой фактуры (оба
  контрагента, дата, сумма) извлечены чисто; `python3 -m markitdown` — идентичный вывод (резервный
  вызов бэкенда работает); PDF без текстового слоя → 0 симв. → срабатывает страж ≥40 → fallback
  в vision/OCR. ВЫВОД: интеграция рабочая, команды вызываются именно так, как написано в коде.
**Frontend (App.js, метка v56.1):**
- Главный прогресс: процент янтарным (#ffd54f, жирный, тень) — и при загрузке, и при AI/локальном
  распознавании; цвет полосы по этапу: загрузка — синяя (rgba(66,165,245,.55)), распознавание —
  зелёная (rgba(102,187,106,.55)). Скан-оверлей: полоса синяя на загрузке/зелёная на распознавании,
  процент янтарным #ffd54f 16px 800.
- Пакетная обработка: блок folder-progress переписан на IIFE — общий % ВНУТРИ полосы (полоса 20px,
  градиент синий→зелёный; фаза конвертации — синий градиент), заголовок «Распознавание файлов —
  N из M», этап текущего файла цветом (⬆️ загрузка X% / 🤖 распознаётся AI… / ✅ готово / примечание
  о повторе), счётчики ✅/❌/🔁 и ETA: folderStartRef (старт фазы recognizing) → «⏱ прошло Nс,
  осталось ~Mм Sс» по среднему времени на файл.
Backend не менялся (остаётся v56-2026-08-18).
Проверки: esbuild OK; eslint 0 ошибок / 3 прежних warning.
Деплой: только фронтенд (App.js).

## v56.2 (2026-08-18) — многостраничный PDF с НЕСКОЛЬКИМИ фактурами: страница 2 попадала в raw_text, но не в карточку
Запрос: «исправь — распознавание работает только на первую страницу, вторую не распознает, в таблице её нет»
(скрин: чек #811, local mac-ocr 2p — стр.1 factura SF 11267 = 12,20 (2 позиции), стр.2 SF 11253 = 218,87
(5 позиций); карточка взяла только первую: итог 12,20, ПОЗИЦИИ (2)).
**Backend (index.js, build v56.2-2026-08-18):**
- Промпт buildDocumentSummaryPrompt: total_amount при нескольких фактурах = СУММА всех итогов;
  invoice_number — все номера через запятую; items — позиции СО ВСЕХ СТРАНИЦ/фактур, не только первой.
- Детерминированная страховка в finalizeDocumentFromPageTexts СТРОГО ПОСЛЕ enforceCurrencyAndTotal
  (иначе его контрольная сумма откатит склеенный итог к 218,87 — Σбаз 215,95 ≈ 218,87 в пределах 2%!):
  1) постраничный максимум ВСЕХ денежных сумм (ключевые слова ненадёжны: шапка «TOTAL IMP.…TOTAL FRA»
     оторвана от значений — проверено тестом); ≥2 разных итога и текущий total ≈ одному из них →
     total = сумме (12,20+218,87=231,07); 2) если Σitems < total*0.6 → позиции добираются
     extractItemsFallback по полному тексту, subtotal=Σбаз и tax_amount=разница (IGIC) восстанавливаются,
     translateItemNames для name_ru.
- extractItemsFallback: + отсев строк-итогов без букв («11,40 7,00 0,80 → 12,20» больше не товар).
Тесты (node): кейс пользователя 12,20→231,07 срабатывает; регрессы — одна фактура на 2 стр. и
LLM-вернул-верную-сумму — не трогаются; фолбэк-парсер даёт 7 позиций Σ215,95.
Frontend не менялся (остаётся v56.1). Деплой: только index.js.

## v56.3 (2026-08-18) — текст карточки «прыгал» с русского на испанский
Запрос: «исправь вывод в карточку — сбивается: сначала на русском, потом на испанском; сделай всё на русском».
**Backend (index.js, build v56.3-2026-08-18):**
- looksUntranslated(src, out): оригинал латиница >40 букв, а «перевод» почти без кириллицы (<5) → это эхо.
- translateRawText: все 3 точки приёма ответа (gemini/groq/openai-compat) теперь отклоняют эхо —
  провайдер считается не справившимся, идём к следующему.
- Оба финализатора (документов и чеков): при сбое/эхо — ОДНА повторная попытка через 1.5с,
  и только потом откат на оригинал (раньше страница сразу оставалась испанской → микс ru/es).
- Промпт: поле summary теперь НА РУССКОМ (названия компаний не переводить) — «Суть документа»/
  «Примечания» в карточке больше не на испанском. Имена контрагентов (party_a/party_b) остаются
  на языке оригинала осознанно — это названия/адреса.
Тесты: эхо отклоняется, настоящий перевод принимается, русский оригинал не задевается.
Frontend не менялся (v56.1). Деплой: только index.js.

## v56.4 (2026-08-18) — чистая таблица позиций (услуги+товары) + подсказка MarkItDown
Запрос: «Улучши портацию в таблицу из распознанного текста товаров и услуг, сделай проверки,
улучши промпт! Убери PDF-Jpeg, сейчас ведь PDF-MarkItDown» (скрин: нотариальная фактура —
в позициях мусор «(Пропущено, не товар)» 493,08, «Общая сумма базы», «Общая сумма удержания»,
часть названий без перевода; подсказка «PDF → JPEG»).
**Backend (index.js, build v56.4-2026-08-18):**
- Промпт items: УСЛУГИ — позиции (нотариус: diligencia/certificación/folios); ЗАПРЕЩЕНЫ строки
  итогов/сводок (SUMA DE BASES, BASE IMPONIBLE, RETENCIÓN, IVA/IGIC, TOTAL A PAGAR, «Общая сумма…»)
  и заглушки «(Пропущено, не товар)»; name_ru ОБЯЗАТЕЛЕН для каждой позиции.
- normalizeItems: фильтр junkRe (пропущено/не товар/skipped/placeholder) + summaryRe (общая сумма,
  suma de bases/total, suma y sigue, total a pagar/factura, importe total, base imponible/total,
  удержание/retención, IVA/IGIC, cuota IVA/IGIC) — с логом отброшенного; касилии форм
  (section/casilla) НЕ фильтруются. Регресс-тест: услуги и товары остаются, мусор уходит,
  касилья «Base imponible» цела.
- Финализатор документов: доперевод name_ru одним вызовом translateItemNames, если у позиций
  латинское name и name_ru без кириллицы (раньше переводились только позиции фолбэк-парсера).
**Frontend (App.js, метка v56.4):** подсказка выбора файлов «PDF → JPEG…» →
«📄 PDF → Markdown (MarkItDown; скан — OCR): ОДИН документ (лучший режим)»; заголовок фазы
пакетной конвертации → «Подготовка PDF (текст → Markdown, скан → страницы)…».
Проверки: node --check OK; esbuild OK; eslint 0 ошибок / 3 прежних warning.
Деплой: index.js + App.js.

## v56.5 (2026-08-19) — листалка страниц перед таблицей позиций
Запрос: «вставь перед таблицей пролистывайте по страницам и вывод товара на этой странице»
(скрин: документ 9 стр., «ТОВАРЫ (87)» одной простынёй).
**Backend (index.js, build v56.5-2026-08-19):**
- Промпт items: у каждой позиции поле "page" — номер страницы по маркеру «СТРАНИЦА N из M» (нет — 1).
- extractItemsFallback: трекинг curPage по маркерам страниц, позиция получает page: curPage.
  normalizeItems сохраняет page (spread ...item).
**Frontend (App.js, метка v56.5):**
- useState itemsPage + useEffect сброса на 1 при смене карточки (dep — viewModal?.id, без новых warning).
- Таблица позиций: если maxPage > 1 — перед таблицей листалка ‹ Стр. N из M › (круглые кнопки,
  disabled на краях) + «позиций на странице: X (всего Y)»; в таблице — только позиции текущей
  страницы, нумерация строк сквозная. Документы без page у позиций (старые) — таблица как раньше,
  листалка не появляется.
Проверки: node --check OK; esbuild OK; eslint 0 ошибок / 3 прежних warning.
Деплой: index.js + App.js. Старые документы — перераспознать, чтобы позиции получили страницы.

## v56.6 (2026-08-19) — синхронизация всех листалок страниц в карточке
Запрос: «синхронизируй перемещения по страницам: выбор страницы в одном из меню автоматически
перемещает на эту страницу другие меню» (в карточке 3 навигатора: галерея миниатюр «Страница N
из M», текст документа «Стр. N из 9», таблица позиций «Стр. N из M» — жили раздельно).
**Frontend (App.js, метка v56.6):** единый источник истины — modalPageIdx (0-based).
itemsPage (таблица позиций, 1-based) → алиас `modalPageIdx + 1`; docTextPage (двуязычный текст)
→ алиас `modalPageIdx`. Отдельные useState для itemsPage/docTextPage удалены; эффект сброса при
смене карточки ([viewModal?.id]) сбрасывает только modalPageIdx (алиас setDocTextPage из эффекта
убран — иначе exhaustive-deps warning). Теперь перелистывание в любом меню переключает остальные.
Backend не менялся (v56.5-2026-08-19).
Проверки: esbuild OK; eslint 0 ошибок / 3 прежних warning. Деплой: только App.js.

## v57 (2026-08-19) — разные документы в одном скане: детектор, разделение, перепроверка
Кейс: «Скан 22.pdf» — 16 страниц РАЗНЫХ банковских выписок Santander «ADEUDO POR DOMICILIACIÓN»
(разные эмитенты/номера Fra:/NUMERO DE RECIBO/даты/итоги) распознавались как ОДНА карточка #819
с нарастающей суммой. Анализ: markitdown → 0 символов (скан без текстового слоя) → OCR;
у каждой страницы своя подпись (Fra:e6325…, Fecha:…, IMPORTE … EUR).

### Backend (index.js, build v57-2026-08-19)
- `pageDocSignature(text)` → {issuer, docNum, date, total}: docNum из «Fra:e632511414536»
  (OCR-пробелы вычищаются) или «NUMERO DE RECIBO»; date из «Fecha:yyyy-mm-dd|dd/mm/yyyy»;
  total — максимум сумм «…,dd EUR/€» страницы; issuer — компания S.L./S.A./SLU.
- `splitPagesIntoDocuments(pageTexts)`: ≥2 РАЗНЫХ docNum → группы страниц; подряд идущие
  страницы с той же подписью/без подписи — продолжение предыдущего документа; иначе null.
- `verifyDocAgainstSignature(receiptData, sig, tag)` — ПЕРЕПРОВЕРКА: итог карточки расходится
  с напечатанным на странице (>1% или пустой) → исправление; пустые date/invoice_number
  заполняются из подписи (дата конвертируется в yyyy-mm-dd).
- ocr_texts-ветка /api/upload-document-pages (local mac-ocr): при docGroups.length > 1 —
  отдельный finalize + uploadPagesToStorage + saveReceiptToDB на КАЖДУЮ группу, job.result =
  { success:true, multiple:true, count, results[] }; метод «local mac-ocr multi-doc N/M (async)».
- v56.2-блок склейки итогов: ЗАПРЕЩЁН, когда страницы содержат ≥2 разных docNum
  (chunkDocNums.size >= 2 → пропуск, итог не склеивается в нарастающую сумму).
### Frontend (App.js, метка v57)
- Одиночный поток: receiptData.multiple → setLastSavedReceipt(последняя) + alert «обнаружено
  РАЗНЫХ документов: N, каждый сохранён отдельной карточкой»; loadReceipts().
- Пакетный (папка) поток: rd.multiple → каждая карточка отдельной строкой results.
### Тесты (node, на реальном OCR всех 16 страниц)
- 16/16 страниц подписаны, 16 групп; дубликат одной выписки ×2 → не дробим; текст без номеров → не дробим.
- Склейка: две фактуры SF 11267+SF 11253 → 231.07 (работает); две выписки банка → blocked.
- Перепроверка: итог 999.99 → 41.47, дата и № заполнены. node --check, esbuild, eslint (3 прежних warning) — чисто.

## v57.1 (2026-08-19) — маршрутизация PDF по текстовому слою + разделение ДО распознавания
Требование: «разделение перед распознанием PDF; есть текстовый слой → MarkItDown, нет → другой вариант».

### Frontend (App.js, метка v57.1)
- `getPdfPageTexts(pdfFile)` + `pdfPageTextsCache`: текст КАЖДОЙ страницы через pdf.js
  getTextContent (кэш по File). hasText = pages.length>0 && total ≥ 40.
- `pageDocSigClient` / `splitPagesClientText` — клиентский порт серверного детектора (Fra:/RECIBO).
- Local mac-ocr flow: probe testMacOcr перенесён ПОСЛЕ проверки текстового слоя (цифровые PDF
  обходятся без Mac-сервера). Маршрут: (а) ОДИН документ с текстовым слоем → /pdf-md MarkItDown
  на Mac (качество таблиц), при сбое — постраничные тексты pdf.js; (б) МУЛЬТИ-документ
  (splitPagesClientText > 1) → постраничные тексты, бэкенд делит и сохраняет раздельно (v57);
  (в) страницы без текста (сканы/фото) → Mac OCR точечно (смешанные пачки: слой + OCR).
  textLayerOnly → formData model='pdf-text-layer'.
- Не-local flow: pdf_source_names прикладывается ТОЛЬКО если у ВСЕХ PDF есть текстовый слой
  (иначе — сразу vision, без холостой попытки markitdown); + новое поле `pdf_page_texts`
  (постраничные тексты, порядок = порядок JPEG-страниц) для серверного разделения.
### Backend (index.js, build v57.1-2026-08-19)
- MarkItDown-ветка /api/upload-document-pages: ДО вызова markitdown — разбор pdf_page_texts;
  splitPagesIntoDocuments > 1 группы (и pageImgs.length совпал) → мульти-сохранение по группам
  (finalize + verifyDocAgainstSignature + uploadPagesToStorage на группу), job.result =
  { multiple:true, count, results[] }, метод «pdf text-layer multi-doc N/M (async)». Один
  документ → прежний markitdown-путь (markdown-качество).
- ocr_texts-ветка: srcTagL = 'pdf text-layer' при model='pdf-text-layer' (метод сохранения).
### Проверки
- node --check OK; esbuild OK; eslint — только 3 прежних exhaustive-deps warning.
- Логика разделения/склейки протестирована в v57 на реальном OCR «Скан 22.pdf» (16/16 разделено).

## v57.2 (2026-08-19) — рекомендация бесплатной модели в окне выбора модели
- Модалка «Выбор модели AI»: жёлтый баннер (сворачиваемый, freeModelTipOpen) с рекомендацией
  бесплатной модели, которой нет в списке (проверено по OpenRouter на 18.08.2026):
  📄 nvidia/nemotron-nano-12b-v2-vl:free — специализация на документах (OCRBench/DocVQA),
  20 зап/мин, 200 зап/день; альтернатива google/gemma-4-31b-it:free (262K, мультимодальная).
  Инструкция подключения: openrouter.ai → Keys → Railway Variables OPENROUTER_API_KEY →
  Redeploy → «Обновить» — бэкенд САМ подтягивает все :free vision-модели (listOpenAICompatModels).
- FALLBACK_MODELS (App.js) += gemma-4-31b-it:free, nemotron-nano-12b-v2-vl:free.
- Backend openrouter.fallbackIds += nvidia/nemotron-nano-12b-v2-vl:free; build v57.2-2026-08-19.
- eslint: 3 прежних warning; esbuild/node --check OK.

## v57.3 (2026-08-19) — разбивка альбаранов/фактур/тикетов: расширенные подписи + проверки
Кейс: «Скан 18.pdf» — 4 РАЗНЫХ альбарана Higinio Tabares e Hijos S.L. (10395/6 от 29/07/2025
641,15€; 9793/6 от 17/07/2025 38,46€; 11215/6 от 18/08/2025 766,21€; 9209/6 от 04/07/2025
144,56€) сохранялись ОДНОЙ карточкой #836 — подписи ловили только банковские Fra:/RECIBO.

### pageDocSignature (backend) — новые критерии
- Номер документа: + ключевое слово (ALBARÁN/FACTURA/TICKET + Nº) и «номер+дата на одной
  строке» шапки: \d{3,7} + до 2 серийных групп («9209/7 6 04/07/2025», OCR-склейка «1039576 29/07/2025»).
- Дата: fallback — первая dd/mm/yyyy в первых 1200 символах (шапка).
- Итог страницы: EUR-суффикс → все окна после КАЖДОГО «TOTAL» (300 символов, максимум) →
  фолбэк максимум сумм страницы (БЕЗ пробела-разделителя тысяч — «35 180,57» = DTO+IMPORTE
  склеивалось в 35180,54; лимит кандидатов 400 — итог в конце длинной таблицы).
### splitPagesIntoDocuments — проверка по датам
- Активация: ≥2 разных номера ИЛИ ≥2 разных даты страниц.
- Страница без номера приклеивается к предыдущей ТОЛЬКО если у неё нет даты или дата совпадает;
  другая дата = новый документ (стр.4 альбарана без распознанного номера больше не сливается).
- Страницы-продолжения (тот же номер/та же дата, «Suma y sigue») остаются в одной группе.
### Frontend (метка v57.3): pageDocSigClient/splitPagesClientText — зеркало серверной логики.
### Тесты (реальный OCR)
- Скан 18: 4 группы [1][2][3][4], итоги 641.15/38.46/766.21/144.56 ✓ (backend и client).
- Скан 22: 16 выписок ✓. Одна фактура на 2 стр. / тот же номер ×2 → не дробим ✓.
- node --check, esbuild OK; eslint — 3 прежних warning (экраны в regex почищены).

## v57.4 (2026-08-19) — сессии переживают redeploy: stateless HMAC-токены (fix 401 на /api/docs)
Проблема: «Сервер документов недоступен: Unauthorized» — токены жили только в in-memory Map,
любой redeploy Railway обнулял сессии всех пользователей → 401 на всех эндпоинтах.
- generateToken(userId): формат `s1.<base64url(userId.ts.rand)>.<HMAC-SHA256>`;
  секрет AUTH_SECRET → SUPABASE_SERVICE_ROLE_KEY → встроенный фолбэк.
- resolveToken(token): in-memory Map (старые токены) → проверка подписи (timingSafeEqual) →
  USERS[userId]; валидный подписанный токен кэшируется в Map (logout работает в рамках процесса).
- requireAuth, /api/login, /api/me и 5 мест с прямым tokens.get (2634, 2879, 2966, 3092, 3149)
  переведены на resolveToken. node --check OK.
- Рекомендация: задать AUTH_SECRET в Railway Variables (иначе секрет = supabase service key).
- Вкладке «Документы» дополнительно нужна миграция supabase-migration-v25-docs.sql (таблица
  doc_sections) — выполнить в Supabase SQL Editor, если не выполнена.

## v57.5 (2026-08-19) — кракозябры в именах файлов документов
Проблема: вкладка «Документы» показывала «Ð¡Ð½Ð¸Ð¼Ð¾Ðº ÑÐºÑÐ°Ð½Ð°…» — multer читает
originalname как Latin-1, UTF-8 имена ломались при сохранении.
- fixUtf8Name(name): если строка похожа на кракозябру ([ÐÑÃâ]) — перекодирует latin1→utf8
  (принимает только если результат кириллический, иначе оставляет как есть).
- POST /api/docs/:category/files: чиним имя ДО сохранения (и в Storage-пути, и в записи).
- GET /api/docs: старые записи с кракозяброй чинятся на лету при отдаче (без миграции БД).
- build v57.5-2026-08-19; node --check OK; round-trip тест: mojibake → «Снимок экрана — …» ✓.

## v57.6 (2026-08-19) — распознавание текста во вкладке «Документы»
- Backend: POST /api/docs/recognize-text (requireAuth, crmMediaMulter('pages'), ≤30 стр.) —
  страницы → extractPageTextWithGemini (vision, 3 параллельно) → translateRawText с retry/
  looksUntranslated (v56.3) → { pages: [{original, russian}] }; НИЧЕГО не сохраняет в receipts.
  Ошибка по странице → «(страница не распознана: …)», не роняет весь запрос. build v57.6.
- Frontend (DocsTab, метка v57.6): синяя кнопка 📝 на миниатюрах фото/PDF → recognizeDoc:
  файл скачивается с Storage, PDF раскрывается в JPEG-страницы (convertPdfToImages, pdf.js),
  отправляется на /api/docs/recognize-text → карточка-модалка docsOcr: слева фото/страница,
  справа текст с вкладками «🇷🇺 Перевод | Оригинал» и синхронным пагинатором «‹ Стр. N из M ›»
  (картинка и текст листаются вместе). Состояние загрузки со спиннером.
- eslint: 3 прежних warning; esbuild/node --check OK.

## v57.7 (2026-08-19) — Документы: авто-распознавание с сохранением + подпапки
### Подпапки (поле folder у attachment, jsonb — миграция БД НЕ нужна)
- DOC_FOLDERS: home → [Dude, Kit, Maria], auto → [Mercedes, Porsche, Volvo], personal → [].
- Строка чипсов «Папка: 🗂 Все | 📁 Dude | …» (фиолетовая #5856d6) с счётчиками; «All» — все файлы.
- Загрузка идёт в выбранную папку (FormData folder; backend кладёт item.folder, ≤40 симв.).
### Авто-распознавание и сохранение текста в карточке
- После addDocs все новые фото/PDF последовательно: recognizeFilePages (fetch файла из Storage,
  PDF→JPEG-страницы pdf.js, POST /api/docs/recognize-text) → saveDocOcr (PATCH) → sections state.
- Backend PATCH /api/docs/:category/files {url, ocr:{pages[]}} — пишет ocr в attachment (≤60 стр.).
- 📝 на миниатюре: если ocr уже сохранён — карточка открывается МГНОВЕННО (без повторного OCR),
  шапка «💾 сохранено в карточке»; зелёный бейдж «Т» на миниатюре = текст сохранён.
- build backend v57.7-2026-08-19, метка фронта v57.7; eslint: 3 прежних warning.

## v57.8 (2026-08-19) — увеличенный предпросмотр документа при наведении
- DocsTab: docsHover state; на миниатюре onMouseEnter/Leave (только photo/video/PDF-doc).
- Фиксированная панель справа (pointer-events:none, ~520px, maxHeight 72vh): фото → img,
  видео → video (#t=0.1), PDF → iframe со встроенным просмотрщиком браузера; в шапке имя файла.
- Метка фронта v57.8; eslint: 3 прежних warning; esbuild OK.

## v57.9 (2026-08-19) — Загрузка папки со структурой в «Документы»
**Запрос:** «организуй загрузку папки с внутренней структурой чтобы она сохранялась на Supabase» (пример: папка «Сайты» → «2» → фото).

**Backend (index.js, build v57.9-2026-08-19):**
- `POST /api/docs/:category/files` принимает поле `paths` (JSON-массив, выровнен по порядку `files`): каждый относительный путь (≤200 символов, слеши по краям обрезаны) сохраняется в карточке вложения как `item.path`.

**Frontend (App.js, label · v57.9 ·):**
- DocsTab: новый state `docPath {home,auto,personal}` — текущий путь навигации внутри структуры.
- `addDocs`: для файлов с `webkitRelativePath` строит `pathsArr` (путь без имени корневой папки + префикс текущего `docPath`) и шлёт `fd.append('paths', JSON.stringify(pathsArr))`.
- Навигация: хлебные крошки 🏠/сегменты + плитки 📁 подпапок (первый сегмент `item.path` с количеством файлов); файлы фильтруются по текущему пути (только прямые дети).
- Новая кнопка загрузки **📂** (`<input webkitdirectory directory multiple>`) рядом с 📎 — выбор папки целиком, структура сохраняется в Supabase.
- Проверки: esbuild OK; eslint — только 3 прежних exhaustive-deps warning (303, 3568, 3577).
- Требуется redeploy: householder-api (build v57.9) + householder-web (v57.9).

## v58 (2026-08-19) — Просмотр Excel прямо в «Документах»
**Запрос:** «не показывает и не открывает файл excell исправь - при нажатии он только загружается».

**Frontend (App.js, label · v58 ·):**
- Модуль SheetJS по CDN (`loadXlsx()`, jsdelivr xlsx@0.18.5) — как loadPdfJs; `isExcelName()` = xlsx/xls/xlsm/xlsb/csv/ods.
- DocsTab: Excel-файлы (📊) в docThumb открываются кликом В ПРИЛОЖЕНИИ — `openExcelDoc(m)`: fetch blob → XLSX.read → sheet_to_html по каждому листу.
- Модалка-просмотрщик: вкладки листов (если >1), HTML-таблица со стилями (.xlsx-view, zebra, границы), кнопка «⬇ Скачать», закрытие ✕/клик по фону.
- Проверки: esbuild OK; eslint — только 3 прежних warning. Backend не менялся. Redeploy: только householder-web.

## v59 (2026-08-19) — Дата документа, сортировка, управление папками, мультивыбор
**Запрос:** «добавь при распознавании дату документов и сортировку по дате документов и дате распознавания; исправь подсветку выбранной вкладки и некорректный рисунок при выборе; сделай удаление/переименование папок, перемещение файлов и выбор больше одного».

**Backend (index.js, build v59-2026-08-19):**
- `PATCH /api/docs/:category/files` расширен: {url, ocr, docDate?} / {url, docDate} (YYYY-MM-DD); {urls:[…], folder} — перемещение группы; {folderRename:{from,to}} — переименование папки; {folderDelete} — удаление папки (файлы остаются, folder снимается).
- `DELETE /api/docs/:category/files` принимает urls[] (мульти-удаление).

**Frontend (App.js, label · v59 ·):**
- `parseDocDateFromText()` — дата из OCR-текста (dd.mm.yyyy / dd/mm/yyyy / yyyy-mm-dd); сохраняется как item.docDate при авто- и ручном распознавании (saveDocOcr(cat,url,pages,docDate)).
- Под миниатюрой: 📅 дата документа (или ⇪ дата загрузки, если не распознана).
- Панель «Сортировка»: по дате документа / по дате распознавания-загрузки + направление ↑↓.
- Папки: динамический список (предустановленные ∪ реально используемые − скрытые); у каждой ✎ переименовать и ✕ удалить (файлы → «Все»); цвет активной папки унифицирован #0071e3 (был фиолетовый — «другой цвет»).
- Исправлен «некорректный рисунок»: docsHover/выбор сбрасываются при смене раздела/папки (раньше панель превью показывала картинку из другого раздела).
- Мультивыбор: кнопка «☑ Выбрать» → клик по миниатюрам выделяет (галка+рамка); панель: Переместить в… (папки / ＋ новая / без папки), 🗑 Удалить, Отмена.
- Проверки: esbuild OK; eslint — только 3 прежних warning. Redeploy: householder-api + householder-web.

## v59.1 (2026-08-20) — Фикс переименования пустых папок
**Запрос:** «Исправь не переименовывается Duqe папка» — пустая папка (0 файлов) после переименования исчезала: новое имя не было ни в файлах, ни в пресетах.

**Frontend (App.js, label · v59.1 ·):**
- Реестр папок в localStorage: `docsCustomFolders` (новые/переименованные) и `docsHiddenFolders` (скрытые пресеты) — пустые папки больше не исчезают и переживают перезагрузку.
- dynFolders = пресеты ∪ custom ∪ используемые − скрытые.
- renameDocsFolder/deleteDocsFolder работают и для пустых папок (404 с сервера не считается ошибкой); «＋ Новая папка» в мультивыборе регистрируется в реестре.
- Redeploy: только householder-web.

## v59.2 (2026-08-20) — Фикс повторного появления кракозябры в именах файлов
**Запрос:** «Снова слетели названия файлов - исправь».
**Причина:** fixUtf8Name применялся только в GET /api/docs и при загрузке; ответы POST/PATCH/DELETE возвращали сырые attachments из БД — после любой операции v59 (перемещение, переименование, удаление, сохранение OCR) старые имена с кракозяброй появлялись снова до перезагрузки.

**Backend (index.js, build v59.2-2026-08-20):**
- Общий хелпер `fixDocsAttachments()` — применён во ВСЕХ ответах docs API (GET/POST/PATCH/DELETE).

**Frontend (App.js, label · v59.2 ·):**
- `fixDocName()` в docMediaOf — клиентская страховка от кракозябры для любых (в т.ч. закэшированных) данных.
- Redeploy: householder-api + householder-web.

## v59.3 (2026-08-20) — Подсветка активных вкладок
**Запрос:** «подсвети активные кнопки вкладок» (скриншоты: активные Дома/«Все» не выделялись — глобальный button-CSS перебивал inline-стили).
**Frontend (App.js, label · v59.3 ·):**
- Класс `.docs-active-tab` с `!important` (синий фон #0071e3, белый текст, тень) — на активных разделах (Дома/Авто/Личное) и папках (Все/Duqe/…).
- Главное меню: `.tabs-inline button.active` с `!important` — активная вкладка (Загрузка/Чеки/Анализ/Налоги/CRM/Документы) тоже подсвечена синим.
- Проверки: esbuild OK; eslint — 3 прежних warning. Redeploy: только householder-web.

## v60 (2026-08-20) — Мульти-импорт выписок банка с отчётом о дубликатах
**Запрос:** «Сделай удобную выгрузку добавление - сравнение с дубликатами выписок из банка» + 6 файлов movimientos-33…38.xlsx (Ruralvía; 35 и 36 пересекаются по Nro. Apunte 1943–1947).

**Backend (index.js, build v60-2026-08-20):**
- Парсинг выписки вынесен в `importOneStatement(buffer, userId)` (догрузка без дублей по entry_number / дата+сумма+concept + автопривязка — без изменений логики).
- Старый `POST /api/import-bank-statement` сохранён (та же форма ответа).
- Новый `POST /api/import-bank-statements` (поле statements[], до 30 файлов): файлы обрабатываются ПОСЛЕДОВАТЕЛЬНО → дубликаты между файлами пачки и базой пропускаются; ответ {totals, files:[{name, account, iban, totalInFile, imported, skipped, autoMatched|error}]}.

**Frontend (App.js, label · v60 ·):**
- Кнопка «🏦 Выписки банка» принимает несколько файлов (multiple).
- Вместо alert — панель-отчёт под кнопками: итоги (файлов/новых/дублей/привязано) + по каждому файлу: строк, новых (зелёным), дублей (оранжевым), привязано (синим), либо ❌ ошибка.
- Fallback: если сервер старый (404) — файлы грузятся по одному через старый маршрут.
- Проверки: node --check OK; esbuild OK; eslint — 3 прежних warning. Redeploy: householder-api + householder-web.

## v60.1 (2026-08-20) — Фильтр по контрагенту кликом из строки
**Запрос:** «сделай фильтр по контрагенту при нажатии в строчке срабатывает фильтр и в поисковой строке — примени фильтр при нажатии еще в выписке из банка».

**Frontend (App.js, label · v60.1 ·):**
- `applyBankCpFilter(cp)` — ставит чип-фильтр «Контрагент» (bankCpFilter=[cp]) + текст в поисковой строке (bankSearch=cp), сбрасывает даты, разворачивает выписку и переходит во вкладку «📊 Анализ».
- Налоги → «Платежи из банка»: добавлена поисковая строка «🔍 Фильтр по контрагенту…» (qCpSearch, локальная фильтрация qOutVis + кнопка сброса «✕ … показано N из M»); контрагент в строке кликабелен (синий, пунктир): клик — локальный фильтр, двойной клик — открыть выписку в «Анализе» с фильтром.
- Анализ → строки выписки: клик по названию (concept) — фильтр по контрагенту (чип + поиск).
- Backend не менялся. Redeploy: только householder-web.

## v60.2 (2026-08-20) — «Выделить все / снять выделение»
**Запрос:** «добавь везде выделить все и снять выделение» (скриншот: список «Платежи из банка» с фильтром по контрагенту).

**Backend (index.js, build v60.2-2026-08-20):**
- `POST /api/bank-movement-invoice-flag` принимает movement_ids[] (до 2000) — массовая установка/снятие has_invoice одним запросом (.in).

**Frontend (App.js, label · v60.2 ·):**
- Налоги → «Платежи из банка»: кнопки «☑ Отметить все (N)» / «☐ Снять все» — действуют на ПОКАЗАННЫЕ фильтром строки (qOutVis), с confirm, optimistic UI + откат при ошибке (`bulkInvoiceFlag`).
- Документы → режим «☑ Выбрать»: кнопки «☑ Все» (выделить все файлы на экране) и «☐ Снять».
- Проверки: node --check OK; esbuild OK; eslint — 3 прежних warning. Redeploy: householder-api + householder-web.

## v60.3 (2026-08-20) — Фикс «Отметить все / Снять все» на старом бэкенде
**Запрос:** «исправь не работает выбрать все и снять выделение».
**Причина:** фронт слал bulk-формат (movement_ids[]), а на Railway был старый householder-api, который требует movement_id → 400 → откат.
**Frontend (App.js, label · v60.3 ·):** bulkInvoiceFlag — при 400/404/500 автоматически шлёт галки по одному платежу (старый формат); частичные ошибки → откат + сообщение о необходимости redeploy api.
- Redeploy: householder-web обязательно; householder-api желательно (bulk одним запросом).

## v61.1 (2026-08-20) — Формы 111/420 строго по поданным декларациям
**Запрос:** «проведи анализ поданных форм по налогам… возьми за основу эти формы» (+049 провиденция 1T-2026, modelo 111 1T-2024 justificante 1115816680711, modelo 420 1T-2025 justificante 4205586417155).

**Анализ поданных форм (см. ответ пользователю):** 420 1T-2025: cas.01 134 557,29 · 7% · cas.03/25 9 419,01 · cas.26 18 918,13 · cas.27/40 1 199,43 · cas.45 = 8 219,58 a ingresar (IBAN ES44…3722). 111 1T-2024: cas.01 6 перц. · 02 61 535,97 · 03 13 264,13 · 07 1 · 08 900,00 · 09 63,00 · 28/30 = 13 327,13. +049: 111 1T-2026 не оплачен — principal 4 919,73 + recargo 20% (983,95); при оплате в срок recargo reducido 10% → 5 411,70.

**Найденный баг:** в TAX_FORM_TEMPLATES было ДВА ключа '111' — старый шаблон «выдуманные цифры» перекрывал новый (официальные casillas + реальный пример) → приложение показывало неверный шаблон. Дубликат удалён.

**Frontend (App.js, label · v61.1 ·):**
- computeTaxRange: добавлены cas.01/07 (Nº perceptores) — numTrab/numAct.
- Черновик: полный набор полей 111 (01/02/03 + 07/08/09) + 420 (01/26/27); заполненная форма показывает casillas точно как в поданных декларациях.
- Проверки: esbuild OK; eslint — 3 прежних warning. Redeploy: только householder-web.

## v61.2 (2026-08-20) — Фикс вычета IGIC по фактурам (cas.26/27)
**Запрос:** «Это налоги без всех фактур, добавил фактуры — получил 45 000 налогов, это точно баг, перепроверь расчёт».
**Найденные проблемы и исправления:**
1. Фактуры без распознанного tax_amount ВООБЩЕ не попадали в вычет (igicFromR=Σtax_amount) — теперь для каждой привязанной фактуры без tax_amount IGIC выделяется из суммы (×7/107).
2. cas.26 (base deducible) считалась gastos/1.07 (все под 7%) — теперь Σ(total−tax) по фактурам (смешанные ставки, как в поданной 1T-2025: 18 918,13/1 199,43 ≈ 6,34%).
3. В черновик 1T-2025 добавлен эталон поданной декларации для визуальной сверки (cas.01 134 557,29 / cas.25 9 419,01 / cas.40 1 199,43 / cas.45 8 219,58).
**Ограничение (в ответе пользователю):** cas.01 = ВСЕ входящие движения банка ÷1.07 — внутренние переводы/займы завышают базу; такие кварталы править вручную в черновике (поле 420·cas.01).
- Redeploy: только householder-web.

## v61.3 (2026-08-20) — Итоги диапазона в «Платежи из банка»
**Запрос:** «выводи за выбранный диапазон — общий приход, общий расход и сумма подтвержденных фактур».
**Frontend (App.js, label · v61.3 ·):** в шапке блока (Налоги): 📥 приход +Σ (все входящие диапазона), 📤 расход −Σ (все исходящие), 📄 подтверждено Σ (исходящие с галкой/привязкой). Redeploy: только householder-web.

## v61.4 — итоги диапазона + налоги отдельной плашкой (fix «не видно итогов»)
- Проблема: строка итогов v61.3 (📥/📤/📄) терялась в шапке блока «💶 Платежи из банка» (flexWrap, мелкий текст рядом с кнопками).
- Решение: добавлена отдельная плашка на всю ширину под шапкой (background #f5f5f7, flex 1 1 100%) — приход / расход / подтверждено фактурами ВСЕГДА видны отдельной строкой.
- Туда же вывод налогов за выбранный диапазон: qRangeTax = computeTaxRange(taxQFrom, taxQTo) — IGIC (mod.420, если <0 — «к компенсации»), IRPF (mod.111), recargo/пени (если есть), итог «💰 К оплате за период». Та же методика, что «Заполнить формы из банка».
- Файлы: App.js (метка · v61.4 ·). Backend не тронут.
- Проверки: esbuild OK; eslint — только 3 прежних warning (305/3839/3848).
- Деплой: householder-web (frontend). Если итоги/налоги не видны после этого — значит на Railway старая сборка, нужен redeploy householder-web.

## v61.5 — справочная строка банка перенесена во вкладку «Налоги»
- По требованию: строка «🏦 N Движений в выписке · N Привязано автоматически · N Платежи без фактуры · N Счета без платежа в банке» убрана из вкладки «Анализ» и показывается во вкладке «Налоги», первой строкой блока «💶 Платежи из банка».
- В «Анализе» удалены ставшие ненужными matched/unmatchedOut/unpaidBills/stat.
- В IIFE «Налогов»: qBankMatched/qBankUnmatchedOut/qBankUnpaidBills + хелпер qBankStat.
- Файлы: App.js (метка · v61.5 ·). Backend не тронут. Проверки: esbuild OK; eslint — только 3 прежних warning.
- Деплой: householder-web (frontend).

## v62 — Impuesto de Sociedades (налог на прибыль) + полный календарь обязательных форм
- Проблема: считался только IGIC (420) и retenciones (111); налог на прибыль SL отсутствовал.
- computeTaxRange: isRate (default 25%, override в черновике); benefNetoQ = доходы нетто (bruto/1.07) − baseDed (расходы нетто по фактурам); isPago202 = isRate% × max(0, benefNetoQ) — аванс modelo 202. recargo/пени и grandTotal теперь включают IS. Возвращает totalIS, isRate.
- UI: плашка итогов + строка «🏛 IS прибыль (mod.202)»; модалка черновика: строка IS, поле ставки IS (25/24/21–22 подсказка), в карточке квартала прибыль нетто + аванс 202; текстовый отчёт: строка IS.
- TAX_CALENDAR: добавлены modelo 202 (20 апр / 20 окт / 20 дек), modelo 200 (до 25 июля след. года), modelo 425 (resumen anual IGIC, до 30 янв).
- TAX_GUIDE: запись «IS — Modelo 202 + 200» (ставки 25/24/21–22, перенос убытков).
- Файлы: App.js (метка · v62 ·). Backend не тронут. esbuild OK; eslint — только 3 прежних warning.
- Деплой: householder-web.

## v62.1 — авто-вычеты: налоги / Seguridad Social / зарплаты = подтверждённые расходы без фактуры
- Проблема: обязательные платежи (tes gral seg socia, AEAT/ATC, nóminas) НЕ входили в расходы без галки «есть фактура» → прибыль и налоги завышались.
- AUTO_DEDUCT_RE (модульный): seg gral/seguridad social/tgss/tesorería, agencia tributaria/aeat/hacienda/tributos/atc/impuesto/modelo N/igic/irpf/is sociedad, autónomo/mutua, nómina/salario/sueldo/cotización. autoDeductOf(m), isConfirmedExpense(m) = галка ИЛИ привязка ИЛИ авто.
- taxQuarterSums: outInv = isConfirmedExpense → налоги/соцстрах/зарплаты идут в расходы 420/IS автоматически (прямой вычет из прибыли).
- UI: строки авто-вычетов — зелёный фон, галка «📄 в расходах» + бейдж вида (🛡 Seguridad Social · 🏛 налог · 💼 зарплата · 👤 autónomo/mutua); заголовок «в расходах: N»; плашка — разбивка «в т.ч. авто: X €».
- Regex проверен на реальных контрагентах (tes gral seg socia → AUTO; cta vista/eni/mapfre/naturgy — нет).
- Файлы: App.js (метка · v62.1 ·). Backend не тронут. esbuild OK; eslint — 3 прежних warning.
- Деплой: householder-web.

## v63 — слоты запоминания выбранных платежей (варианты 1..5)
- Требование: выделить платежи → запомнить в варианте 1..5 → по нажатию на вариант показать сохранённую таблицу.
- Состояния: pmSelected (id→true), pmSlots (localStorage 'bankPaySlots' = { '1': [ids], ... }), pmSlotView (активный слот). savePmSlots пишет в localStorage.
- UI: в каждой строке платежа — галка выбора (слева, синяя, строка подсвечивается #eef4ff). Панель «💾 Варианты» над фильтром: «выбрано N на сумму», кнопки «сохранить в → 1..5» (показывают сколько уже в слоте) и «вывести из → 1..5» (активный — фиолетовый, повторное нажатие снимает), кнопка сброса «✕ вариант N», «☐ снять выбор».
- Активный слот фильтрует список (qOutSlot → qOutVis); фильтр по контрагенту работает поверх слота.
- Файлы: App.js (метка · v63 ·). Backend не тронут. esbuild OK; eslint — 3 прежних warning.
- Деплой: householder-web.

## v63.1 — «выбрать все» / «снять выделение» для слотов 1..5
- В панель «💾 Варианты» добавлены кнопки: «☑ выбрать все (N)» — выделяет все показанные (с учётом фильтра/слота) платежи в pmSelected; «☐ снять выделение» — всегда видна (раньше кнопка сброса появлялась только при выборе).
- Метка · v63.1 ·. Backend не тронут. esbuild OK; eslint — 3 прежних warning.

## v63.2 — FIX: налоги не пересчитывались при смене подтверждённых расходов
- Баг: в taxQuarterSums вычет (baseDedNet/igicSop) строился ТОЛЬКО по привязанным фактурам (matched_receipt_id); платежи с галкой «есть фактура» или авто-вычетом без привязки попадали в outInv/«подтверждено», но в вычет не входили (если была хоть одна привязанная фактура) → IGIC/IS/recargo не реагировали на галки.
- Фикс: каждый подтверждённый платёж без привязанной фактуры теперь добавляет вычет индивидуально (IGIC = сумма×7/107, база = сумма/1.07). Старый глобальный фолбэк удалён.
- Теперь любая смена галок/выделения сразу меняет IGIC (420), IS (202), recargo и «К оплате за период».
- Метка · v63.2 ·. Backend не тронут. esbuild OK; eslint — 3 прежних warning.
- Деплой: householder-web.

## v64 — накопительное автодобавление в варианты 1..5
- Новая логика: кнопки «добавлять в → 1..5» включают АКТИВНЫЙ вариант (зелёная ✔ N). Пока вариант активен: галка строки = членство в этом варианте, каждое переключение сразу пишется в localStorage (накопительно, без кнопки «сохранить»).
- «☑ все в вариант N» — добавляет все показанные (с фильтром) в активный вариант накопительно; «☐ убрать из варианта N» — удаляет показанные. Без активного варианта — прежний режим pmSelected + «сохранить в →».
- Подсветка строк и галки отражают членство в активном варианте. pmSlotHas/pmSlotToggle хелперы.
- Метка · v64 ·. Backend не тронут. esbuild OK; eslint — 3 прежних warning.
- Деплой: householder-web.

## v64.1 — FIX счётчика варианта + фильтры по столбцам
- Баг: «выбрано: 34 на 10157.59» при активном варианте показывало устаревший pmSelected (старые выборы из-под фильтров), а не реальное содержимое варианта. Теперь при активном варианте панель показывает: «✔ вариант N активен: X платежей на Y €» (считается по слоту из всех исходящих движений).
- Фильтры по столбцам: 📅 дата (подстрока, напр. 2025-06), € от / € до, + прежний контрагент. Работают совместно и поверх активного варианта; кнопка сброса «✕ дата/сумма». Состояния qDateFilter/qAmtMin/qAmtMax.
- Метка · v64.1 ·. Backend не тронут. esbuild OK; eslint — 3 прежних warning.
- Деплой: householder-web.

## v64.2 — выпадающий фильтр по контрагенту (по алфавиту)
- Рядом с текстовым фильтром контрагента добавлен select «⇅ контрагент А–Я (N)»: все контрагенты выбранного диапазона, отсортированы localeCompare('es', без учёта регистра). Выбор значения ставит его в qCpSearch (работает тот же фильтр/чип сброса).
- Метка · v64.2 ·. Backend не тронут. esbuild OK; eslint — 3 прежних warning.
- Деплой: householder-web.

## v64.3 — сортировка списка контрагентов А→Я / Я→А
- Кнопка «А→Я / Я→А» перед выпадающим фильтром контрагентов переключает направление сортировки списка (по возрастанию/по убыванию, localeCompare 'es'). Подпись списка отражает направление.
- Метка · v64.3 ·. Backend не тронут. esbuild OK; eslint — 3 прежних warning.
- Деплой: householder-web.

## v64.4 — FIX: сортировка строк таблицы по контрагенту
- Баг: кнопка А→Я/Я→А сортировала только выпадающий список, строки таблицы не менялись.
- Теперь qOutVis сортируется по контрагенту (направление кнопкой), внутри одного контрагента — по дате, новые сверху.
- Метка · v64.4 ·. Backend не тронут. esbuild OK; eslint — 3 прежних warning.
- Деплой: householder-web.

## v65 — фильтр выбранные/не выбранные + FIX добавления в вариант
- Фильтр по галке выбора: чипы «○ все / ☑ выбранные / ☐ не выбранные» (qSelFilter). При активном варианте — членство в нём, иначе pmSelected.
- FIX «добавление в папку 1 увеличивает сумму, но не добавляет»: пользователь ставил галки в pmSelected, не активировав вариант. Теперь включение варианта («добавлять в → N») сразу забирает все текущие выбранные галки в слот (накопительно) и очищает pmSelected.
- qOutVis стал let (фильтр выбора переназначает).
- Метка · v65 ·. Backend не тронут. esbuild OK; eslint — 3 прежних warning.
- Деплой: householder-web.

## v65.1 — FIX: автодобавление в вариант теперь постоянное
- Баг: активный вариант (pmSlotArm) хранился только в памяти — после перезагрузки/смены вкладки сбрасывался, галки снова копились в «выбрано» и в папку не попадали. Теперь pmSlotArm сохраняется в localStorage ('bankPaySlotArm'): включил вариант 1 один раз — галки строк ВСЕГДА пишутся в него автоматически, пока не выключишь (повторный клик по ✔ N).
- Фильтр «выбранные/не выбранные» проверен: работает по галке ВЫБОРА (при активном варианте — по членству в нём), не по галке «есть фактура».
- Метка · v65.1 ·. Backend не тронут. esbuild OK; eslint — 3 прежних warning.
- Деплой: householder-web.

## v66 — переименование папок структуры (item.path)
- Папки, пришедшие из загрузки папкой (v57.9, item.path — напр. «Новая папка», «1», «2»), раньше не переименовывались (✎ был только у folder-полей).
- Backend: PATCH /api/docs/:category/files — новая ветка {pathRename:{from,to}}: префикс пути from→to у всех items (path === from или startsWith(from + '/')), 404 если не найдена. Ответ через fixDocsAttachments.
- Frontend: renameDocsSubfolder(fn) — полный путь = curDocPath + '/' + fn; кнопка ✎ у каждого чипа подпапки в строке навигации.
- Метка App.js · v66 ·. Деплой: householder-web И householder-api (backend менялся!).

## v67 — привязка фактур: рекомендации + привязка с разницей суммы
- Кейс: платёж «cerrajeria mundo llave» 6684.95 ↔ фактура «Mundo Llave» 6684.95 не связались (51 день между датами → без бонуса, score 78 < 80).
- Backend runBankMatching: confident теперь и при (sim ≥ 0.55 && отрыв ≥ 5) — точная сумма + похожее название достаточно. sim сохраняется в scored.
- Frontend linkPicker: скоринг кандидатов (точная сумма +100, nameSim×100, близость суммы ±2%/±10%), блок «⭐ Рекомендации» (top-5, жёлтая рамка) + общий список; бейджи «сумма совпадает» / «Δ X» / «похоже по названию»; nameSim/nameTokens хелперы (Жаккар по словам ≥3 букв; mundo llave = 0.667).
- Привязка с несовпадающей суммой: кнопка «Привязать с Δ» (оранжевая) + confirm «оставить/отвязать»; в строке налогов у такой пары бейдж «Δ не совпадает» и кнопка ✖ отвязать (у привязанных раньше отвязки не было).
- Метка App.js · v67 ·, build index.js v67-2026-08-21. Деплой ОБОИХ: householder-web и householder-api. После деплоя api — нажать «повторный запуск автопривязки».

## v67.1 (2026-08-21)
- FIX: модалка привязки платежа к фактуре (linkPicker) была отрендерена ТОЛЬКО внутри вкладки «Анализ» — из «Налогов» привязать платёж было невозможно. Модалка вынесена в общий рендер `linkPickerModal` (тело компонента, после nameSim) и подключена в обеих вкладках.
- Вкладка «Налоги»: в строках платежей «не привязан» заменён на кнопку «🔗 привязать» (setLinkSearch('') + setLinkPicker(m)) — открывает ту же модалку с рекомендациями по названию/сумме и привязкой с Δ-пометкой (v67).
- ВАЖНО для пользователя: привязка срабатывает на сервере — householder-api должен быть переложен с v67 (смягчённый confident gate: sim>=0.55 && margin>=5); после деплоя нажать «Пересопоставить»; если фактура уже ошибочно привязана (карточка фактуры показывает Δ) — сначала отвязать (✖).

## v67.2 (2026-08-21)
- CRITICAL FIX: белый экран/пустое окно при нажатии «🔗 привязать» — linkPickerModal (v67.1) выполнялся как const-IIFE ДО объявления formatAmount/formatDate (строки 5726/5731) -> TDZ ReferenceError ронял весь рендер. Заменено на ленивую функцию renderLinkPicker() (возвращает null при !linkPicker), вызывается в точках рендера обеих вкладок.
- Backend runBankMatching v67.2: (a) фактура, привязанная в текущем прогоне, исключается из дальнейшего скоринга (_taken); (b) если уверенной пары по сумме нет — автопривязка ПО НАЗВАНИЮ при УНИКАЛЬНОМ кандидате sim>=0.7 (отрыв от второго >=0.05): match_status='auto_name_delta', статус оплаты считается по сумме покрытия (paid/underpaid). Повторяющиеся поставщики (eni/naturgy с множеством фактур) НЕ привязываются — неоднозначность.
- Health build: v67.2-2026-08-21. Пользователю: переложить householder-api + householder-web, нажать пересопоставление.

## v67.3 (2026-08-21)
- FIX «зависло во вкладке Анализ»: rematchBank показывал alert() ДО перезагрузки данных — Safari блокирует JS на время alert, спиннер «Загрузка движений…» выглядел как зависание. Теперь: сначала loadBankMovements+loadReceipts, потом alert. loadBankMovements получил AbortController-таймаут 20с (раньше зависший GET /api/bank-movements держал спиннер бесконечно) и возвращает null при ошибке.
- Вкладка «Налоги»: кнопка «🔄 Обновить движения» теперь показывает состояние «⏳ Загрузка…», disabled во время загрузки и alert при ошибке («проверьте redeploy householder-api»). Добавлена кнопка «🔁 Привязать фактуры» (rematchBank) прямо в блок платежей налогов.

## v67.4 (2026-08-21)
- Вкладка «Налоги»: плашки банковской статистики (qBankStat) стали АКТИВНЫМИ фильтрами по признакам (state qBankChip: null|linked|nolink|unpaid): «Движений в выписке» — сброс фильтра; «Привязано автоматически» — только платежи с matched_receipt_id; «Платежи без фактуры» — без привязки; «Счета без платежа в банке» — платежи, похожие по названию (nameSim>=0.5) на неоплаченные счета (bill/invoice без bank_movement_id и не paid). Активная плашка подсвечена синей рамкой, повторный клик сбрасывает.

## v67.5 (2026-08-21)
- Вкладка «Налоги»: плашки-фильтры теперь показывают СУММЫ затрат (исходящие платежи всей выписки) + счётчик: «Всего затраты по выписке» (сброс), «Фактуры привязанные» (matched_receipt_id), «Налог-автовычет» (!linked && autoDeductOf), «Помечены фактуры» (has_invoice БЕЗ привязанных и автовычета), «Без фактур» (нет ни привязки, ни галки, ни автовычета). Списки: qOutAll/qSumOf/qCatLinked/qCatAuto/qCatFlag/qCatNone; фильтр qBankChip: null|linked|auto|flagged|none. Старые счётчики qBankMatched/qBankUnmatchedOut оставлены (не используются в плашках).

## v67.6 (2026-08-21)
- Вкладка «Налоги»: строка поиска теперь ищет по ВСЕМ столбцам — контрагент, концепт, дата (ISO и ru-формат), сумма (сырая/форматированная, пробелы-неразрывные нормализуются), привязанная фактура (название/поставщик/сумма/№), служебные («налог авто-вычет», «есть фактура»). Плейсхолдер обновлён.

## v67.7 (2026-08-21)
- Добавление фактуры в выписку банка ИЗ КАРТОЧКИ ФАКТУРЫ: кнопка «🏦 В выписку» рядом со статусом оплаты (payNode). Спрашивает сумму (по умолчанию total_amount) и дату (по умолчанию дата фактуры), создаёт платёжное движение (amount<0, prefix='manual', account_name='Ручное добавление') СРАЗУ привязанное к фактуре (matched_receipt_id, match_status='manual', 100), затем recomputeReceiptPayment (paid/underpaid по покрытию — поддерживает разбитую оплату несколькими платежами). После — перезагрузка движений и фактур; платёж виден в «Анализе» и «Налогах» (участвует в подтверждённых расходах и расчёте IGIC/IRPF/IS).
- Backend: POST /api/bank-movements/manual {receipt_id, operation_date, amount, counterparty?, concept?}; валидации; health build v67.7-2026-08-21. ТРЕБУЕТ redeploy householder-api.

## v67.8 (2026-08-21)
- После «🏦 В выписку»: вместо alert — confirm с переходом: OK → вкладка «Налоги», диапазон кварталов устанавливается на квартал платежа (setTaxQFrom/setTaxQTo «YYYY-qT»), фильтры сбрасываются (qBankChip/qCpSearch/qSelFilter), строка платежа подсвечена жёлтым (#fff3bf + рамка, id=`mvt-row-<id>`), плавная прокрутка к ней через 700мс, подсветка гаснет через 8с (state hlMvtId).

## v67.9 (2026-08-21)
- Карточка фактуры в списке: метка «🏦 привязан к банку · сумма · N плат. · дата последнего» (по bankMovements с matched_receipt_id = id фактуры). Клик по метке — переход в «Налоги» к строке платежа через общий хелпер gotoTaxesMovement(mvId, opDate) (квартал, сброс фильтров, подсветка, прокрутка — как v67.8).

## v67.9.1 (2026-08-21)
- FIX: метка «привязан к банку» не появлялась на карточках чеков — bankMovements грузились только при входе во вкладки «Анализ»/«Налоги». loadBankMovements переведён на useCallback([token]) + отдельный useEffect [user, token, loadBankMovements] — движения грузятся сразу при входе.
- Метка «🏦 привязан к банку · сумма · N плат. · дата» добавлена и ВНУТРЬ модалки карточки (bankNode, в списках строк invoice и прочих типов, после «Дата оплаты»); клик — переход в «Налоги» к платежу (gotoTaxesMovement).

## v67.9.2 (2026-08-21)
- FIX «некорректная общая сумма расхода»: плашка «Всего затраты по выписке» считала ВСЕ исходящие движения, включая ручные платежи, добавленные кнопкой «🏦 В выписку» (их нет в банковской выписке) — сумма была завышена относительно Σ выписки. Теперь: isManualMvt (prefix='manual' / account_name='Ручное добавление'); «Всего затраты по выписке» и категории (фактуры/автовычет/помеченные/без фактур) — только по строкам выписки; ручные платежи — отдельная плашка-фильтр «✍ Ручные платежи (не из выписки)».
- Защита от дублей ручного платежа: фронт — busy-флаг 4с на addReceiptToBank; бэк — дедуп (matched_receipt_id+operation_date+amount+prefix='manual') возвращает существующий movement_id {duplicate:true}. Health build v67.9.2-2026-08-21.

## v67.9.3 (2026-08-21)
- FIX: строка «приход/расход за диапазон» и итоговая плашка показывали расход С учётом ручных платежей (−711994.15). Теперь «📤 расход» = только строки выписки (−693426.31), ручные — отдельной пометкой «✍ ручные: −…» / «(+✍ ручные …)». Расчёт налогов не затронут (ручные платежи с фактурой остаются подтверждёнными расходами).

## v67.9.4 (2026-08-21)
- Пользователь: банковская выписка — ГЛАВНЫЙ документ, ручных платежей в ней быть не может. УДАЛЕНА кнопка «🏦 В выписку» из карточки фактуры и функция addReceiptToBank — ручные строки больше не создаются (endpoint POST /api/bank-movements/manual оставлен, но не используется фронтом).
- Очистка уже созданных 4 ручных платежей (18567.84): в «Налогах» ручные строки помечены бейджем «✍ ручной» + кнопка «🗑 удалить» — DELETE /api/bank-movements/manual/:id (только prefix='manual'; строки выписки удалить нельзя — 403), фактура отвязывается через recomputeReceiptPayment. Плашка-фильтр «✍ Ручные платежи» показывает их списком.

## v67.9.5 (2026-08-22)
- FIX «снял ручное — ничего не меняется»: отвязка (✖) ручного платежа оставляла фантомную строку в списке (не из выписки). Теперь unlink-bank-movement для prefix='manual'/'Ручное добавление' УДАЛЯЕТ строку целиком ({deleted:true}), фактура отвязывается. Фронт: confirm предупреждает «ручной платёж будет удалён целиком», после — alert-подтверждение. Health build v67.9.5-2026-08-22.

## v68 (2026-08-22)
- Привязка фактуры ИЗ КАРТОЧКИ к существующему платежу выписки — БЕЗ создания строк в выписке (банк — главный документ). Кнопка «🔗 К платежу банка» в карточке (payNode, рядом со статусом оплаты) открывает renderRcLinkPicker (states rcLinkPicker/rcLinkSearch): зеркальная логика linkPicker — скоринг свободных исходящих платежей (сумма exact +100, nameSim×100, близость суммы +40/+20, дата +15/+8), ⭐ рекомендации top-5 + все свободные платежи, «Привязать»/«Привязать с Δ» с confirm при несовпадении; через тот же linkMovement (POST /api/link-bank-movement). Модалка рендерится поверх карточки (zIndex 1300).

## v68.0.1 (2026-08-22)
- FIX «остаётся ручной ввод»: (а) backend unlink/DELETE распознают ручную строку надёжнее — ИЛИ по признаку «нет iban + нет entry_number + нет import_batch» (старые вставки без prefix тоже удаляются); (б) фронт deleteManualMvt: при 404/405 (старый API) уходит через unlink; после удаления ПРОВЕРКА — если строка осталась, alert «переложите householder-api до v67.9.5+». Health build v68.0.1-2026-08-22.

## v68.1 (2026-08-22)
- Режим «Выбрать все копии» (дубликаты): кнопка теперь также включает showDuplicates + copiesFirstOrder — карточки переупорядочиваются ПО ГРУППАМ: слева все копии, справа оригинал группы, затем следующая группа (заголовки месяцев в этом режиме скрыты). «👁 Показать все» сбрасывает режим.
- Защита оригиналов при удалении: bulkDelete исключает оригинал группы из удаления, если выбрана хотя бы одна его копия; confirm сообщает «🛡 Оригиналы (N) будут сохранены».

## v68.2 (2026-08-22)
- Кнопка «⬇ Загрузить» (массовый экспорт чеков): всплывающее окно прогресса (exportProgress {done,total,files} + exportStopRef) — «загружено N из M» чеков + счётчик сохранённых файлов + полоса прогресса; кнопка «⏹ Остановить» прерывает цикл после текущего чека; финальный alert: «Остановлено: обработано X из Y · файлов Z». Работает и для выгрузки в папку (showDirectoryPicker), и для скачивания в «Загрузки».

## v68.3 (2026-08-22) — Подтверждение перед загрузкой и удалением
- Новое состояние `confirmDlg` {title, text, yesLabel, danger, onYes} + универсальное модальное окно подтверждения (zIndex 1500), рендерится перед прогресс-окном экспорта.
- «⬇ Загрузить» (handleExport) больше не запускает выгрузку сразу: открывает confirm-окно с числом выбранных файлов и режимом (EXPORT_MODE_LABELS[exportMode]); сама выгрузка перенесена в `doExport()` и стартует только по «Начать загрузку». Прогресс-окно v68.2 (загружено N из M + «⏹ Остановить») работает поверх.
- «🗑 Удалить» (bulkDelete) аналогично: сначала confirm-окно (danger, красная кнопка «Удалить N»), с сохранением защиты оригиналов дубликатов (keptOriginals, 🛡-примечание в тексте); фактическое удаление в `doBulkDelete(sel)`.
- index.js не менялся (backend v68.0.1). Футер: `· v68.3 ·`.

## v68.4 (2026-08-22) — Документы: прогресс-окно загрузки файлов/папки с остановкой
- DocsTab: новые состояния `docsUpload` {phase:'prepare'|'upload'|'ocr', percent, done, total, currentFile}, `docsXhrRef` (активный XHR), `docsStopRef` (флаг остановки).
- `addDocs` переписан: POST /api/docs/:cat/files теперь через XMLHttpRequest — `upload.onprogress` даёт процент по байтам и оценку «загружено N из M файлов»; кнопка «⏹ Остановить» делает `xhr.abort()` (фаза загрузки) или прерывает цикл (подготовка/авто-распознавание OCR).
- Модальное окно (zIndex 400) над вкладкой Документы: фаза, большой процент, «Загружено/Обработано N из M файлов · осталось K», имя текущего файла, градиентная полоса, красная кнопка «⏹ Остановить». Остановка — без alert'ов, только console.log.
- index.js не менялся. Футер: `· v68.4 ·`.

## v68.5 (2026-08-22) — Документы: авто-распознавание при загрузке УБРАНО
- Из `addDocs` удалён блок АВТО-OCR (fresh → recognizeFilePages → saveDocOcr): файлы просто сохраняются на сервер, загрузка стала быстрой.
- OCR/перевод по-прежнему доступен вручную из карточки файла (кнопка 📝, recognizeFilePages + saveDocOcr не тронуты).
- Прогресс-окно v68.4 осталось: фазы «prepare»/«upload», проценты, «загружено N из M · осталось K», «⏹ Остановить». Фаза 'ocr' из модалки убрана.
- index.js не менялся. Футер: `· v68.5 ·`.

## v68.5.1 (2026-08-22) — FIX: «Остановить» на 100% терял файлы
- Баг: на 100% байты уже переданы, но сервер ещё сохраняет файлы; abort() в этот момент обрывал запрос до ответа → файлы не появлялись.
- Теперь при percent=100 фаза → 'save' («💾 Сохранение на сервере…»), кнопка «Остановить» заменяется надписью «прерывать уже нельзя». Окно закрывается само после ответа сервера.
- Футер: `· v68.5.1 ·`.

## v68.6 (2026-08-22) — Документы: папки + вёрстка карточек
- Новая `createDocsFolder()` + кнопка «＋ Папка» (пунктирная, синяя) в строке «Папка:» — создаёт пустую папку (реестр customFolders в localStorage) и сразу переходит в неё; строка папок теперь видна всегда. Переименование (✎) и удаление (✕, файлы остаются в «Все») — как раньше.
- Режим «☑ Выбрать»: select перемещения переработан в заметную синюю кнопку-выпадайку «📁 Переместить в папку…» (неактивна, пока ничего не выбрано); «Без папки» теперь через значение `__none` (баг с пустым value исправлен).
- Вёрстка docThumb: карточка — колонка 96px, имя и дата СТАТИЧНЫ под превью (были absolute bottom:-16/-27 → наезжали на соседей); сетка gap 16/rowGap 20, paddingBottom 8. Кнопки ✕/📝/Т остались на превью (внутренний relative-wrapper).
- index.js не менялся (PATCH urls+folder/folderRename/folderDelete уже поддерживаются). Футер: `· v68.6 ·`.

## v68.7 (2026-08-22) — Документы: перемещение в дерево, строгий фильтр папки, вёрстка
- relPathOf переписан: внутри выбранной папки (curDocPath) показываются ТОЛЬКО её файлы и подпапки; файл с path === curDocPath — прямо в папке; legacy-пути «имя файла без слэша» (старый slice(1) при загрузке) считаются корнем.
- Фильтр items: файл показывается только при пустом относительном пути; любой непустой — подпапка дерева.
- Перемещение в дерево: backend PATCH принимает {urls, path} ('' — корень дерева); фронт — `moveSelectedDocsToPath`, в выпадайке «📁 Переместить» добавлены раздел «── Дерево папок ──» (🌳 все пути) и «🌳＋ Новая подпапка в текущей ветке…» (создание папки по дереву через перемещение).
- Сетка карточек: rowGap 20 → 34, gap 16 → 18 — названия и даты между строками читаются.
- index.js: health build `v68.7-2026-08-22` — нужен redeploy householder-api! Футер App: `· v68.7 ·`.

## v68.7.1 (2026-08-22) — FIX: каждый файл стал «папкой»
- Причина: item.path хранит путь ВКЛЮЧАЯ имя файла ('Kit_foto/IMG_1.jpeg'); v68.7 трактовал весь path как папку → каждый файл отображался как подпапка. Данные не пострадали — только отображение.
- relPathOf: папка файла = path без последнего сегмента; внутри папки показываются только её файлы/подпапки; allTreePaths — из dir-части.
- Backend {urls,path}: теперь сохраняет path = папка + '/' + имя файла (корень — просто имя файла). Health: v68.7.1-2026-08-22.

## v68.8 (2026-08-22) — Документы: перемещение между вкладками и их структурами
- Backend PATCH docs: новая операция {urls, moveTo:{category, folder?, path?}} — файлы вырезаются из текущего раздела и добавляются в целевой (folder или path+имя файла; без них — в корень раздела). Health: v68.8-2026-08-22.
- Фронт: moveSelectedDocsToSection; в «📁 Переместить» добавлены блоки других вкладок «── 🏠 Дома ──»: «📂 в корень раздела», его 📁 папки и 🌳 пути дерева (otherSections из sections/customFolders/DOC_FOLDERS/hiddenFolders).
- Футер: `· v68.8 ·`. Нужен redeploy ОБОИХ сервисов.

## v68.8.1 (2026-08-22) — Документы: инфо-окно при перемещении
- Новое состояние docsMove {total, target, status:'run'|'ok'|'err', msg}; модальное окно (zIndex 410, как при загрузке): «📁 Перемещение файлов…» + количество + куда + бегающая полоса; по успеху «✅ Перемещено!» (автозакрытие 1.2с), при ошибке — текст + «Понятно».
- Обёрнуты все три перемещения: moveSelectedDocs (папка), moveSelectedDocsToPath (дерево), moveSelectedDocsToSection (между вкладками).
- Футер: `· v68.8.1 ·`.

## v68.8.2 (2026-08-22) — FIX: файлы пропали из папок дерева после перемещений
- Причина: перемещение в дерево на СТАРОМ backend сохранило path БЕЗ имени файла → v68.7.1-фронт считал весь путь именем файла → файлы «уехали» из Kit_foto и др.
- dirOfDocPath: всеядно — если последний сегмент похож на файл (расширение) — папка без него; иначе весь path — папка (legacy). Используется в relPathOf, allTreePaths, otherSections.
- docsFolderOp при moveTo — полный loadDocs() (обновляются все вкладки).
- Футер: `· v68.8.2 ·`. Для перемещения МЕЖДУ вкладками ОБЯЗАТЕЛЕН redeploy householder-api (v68.8)!

## v68.9 (2026-08-22) — Документы: папки дерева чипами в строке «Папка:» (единый вид)
- topTreeFolders (первый уровень allTreePaths) выводятся чипами «📁 Имя (N)» в строке «Папка:» — как обычные папки; клик открывает ветку дерева (setDocPath), активная подсвечена; счётчик = файлы в ветке рекурсивно.
- Клик по обычному чипу папки и смена вкладки сбрасывают docPath (иначе оставалась чужая ветка).
- index.js не менялся. Футер: `· v68.9 ·`.

## v68.9.1 (2026-08-22) — ре-выдача для деплоя
- Код идентичен v68.9 (папки дерева чипами в «Папка:»); bumped только метка футера `· v68.9.1 ·`, чтобы визуально отличать свежий деплой от кэша. index.js без изменений (v68.8).

## v68.9.2 (2026-08-22) — «＋ Папка» внутри открытой ветки создаёт подпапку в ней
- Реестр пустых папок дерева `customTree` (localStorage docsCustomTree, по разделам).
- createDocsFolder: при открытом curDocPath создаёт `curDocPath/имя` в реестре и переходит внутрь; в корне — как раньше (folder-field папка).
- subFolders, topTreeFolders и выпадайка «📁 Переместить» (🌳) дополняются путями из реестра — пустые папки видны сразу.
- Футер: `· v68.9.2 ·`. index.js без изменений.

## v68.9.3 (2026-08-22) — Дерево папок: точное определение + метки вложенности
- dirOfDocItem: папка = path минус ИМЯ файла с конца (исправляет мусорные «папки» вида 'Oleg/0E5E...textClipping'); fallback — эвристика по расширению (1-15 симв.).
- Чипы: после каждой папки 1-го уровня выводятся чипы её вложенных папок: «↳ Имя · вложенная в Родитель (N)» (пунктирная рамка, меньше размером).
- treePathsAll = пути файлов + реестр пустых папок; единый список для чипов и выпадайки.
- Футер: `· v68.9.3 ·`. index.js без изменений.

## v69 (2026-08-22) — Документы: ЕДИНАЯ система папок (folder + path слиты)
- effDirOf: местоположение файла = папка из path, иначе поле folder. relPathOf/folderItems/счётчики работают по effDir — обе системы отображаются как одно дерево.
- Строка «Папка:» — единый список topFoldersAll (folder-папки + папки дерева); клик открывает через docPath; ✎/× только у folder-папок; вложенные чипы «↳ имя · вложенная в Родитель» после КАЖДОЙ папки верхнего уровня.
- «＋ Папка» внутри ЛЮБОЙ открытой папки (docPath или folder-чип) создаёт вложенную (baseDir/имя) в реестре customTree.
- Футер: `· v69 ·`. index.js без изменений (v68.8).

## v69.1 (2026-08-22) — Вложенные имена «Родитель/Дочь» у чиповых папок
- topFoldersAll: folder-папки с '/' в имени НЕ показываются чипами верхнего уровня.
- treeChildrenOf: дети = пути дерева + folder-папки с именем «Родитель/Дочь» → чип «↳ Дочь · вложенная в Родитель».
- renameDocsFolder: подсказка — вложить папку можно именем «Volvo/3». Пустые корневые 1/2/3 (созданы старой версией) чинятся: ✎ → «Volvo/3» или ✕ удалить.
- Футер: `· v69.1 ·`. index.js без изменений.

## v69.2 (2026-08-22) — Все уровни вложенности чипами + удаление/переименование вложенных папок
- treeDescendantsOf: чипы показывают ВСЕХ потомков папки (любая глубина: «↳ 1», «↳↳ 2 · вложенная в Mercedes/1»).
- renameTreeFolder/deleteTreeFolder: ✎/✕ у каждого чипа дерева (включая верхний уровень). Удаление = pathRename ветки к родителю (файлы поднимаются, не удаляются); folder-папки с вложенным именем поднимаются через folderRename; реестр customTree чистится.
- Backend pathRename: to='' разрешён (ветка → корень, path снимается). Health: v69.2-2026-08-22 — нужен redeploy householder-api!
- Футер: `· v69.2 ·`.

## v69.3 (2026-08-23) — Документы: ДРЕВОВИДНЫЙ вывод папок
- Блок «Папка:» перестроен в вертикальное дерево: строка «＋ Папка / 🗂 Все», затем каждая папка верхнего уровня — отдельная строка; вложенные выводятся ПОД ней с отступом (14px + 22px×уровень) и вертикальной линией слева, «↳ 📁 имя · вложенная в Родитель (N)».
- ✎/✕ у каждого узла: folder-папки — renameDocsFolder/deleteDocsFolder, папки дерева — renameTreeFolder/deleteTreeFolder.
- Футер: `· v69.3 ·`. index.js без изменений (v69.2).

## v69.4 (2026-08-23)
- КРИТИЧНО: renameTreeFolder/deleteTreeFolder с v69.2 лежали ВНУТРИ createDocsFolder (patch104 вставил их после открывающей скобки) — ✎/✕ у папок дерева падали с ReferenceError, вложенные папки не удалялись/не переименовывались. Вынесены на уровень компонента DocsTab.
- createDocsFolder: секция зафиксирована явно (const sec = docSection), диалог показывает РАЗДЕЛ и путь назначения («Новая ВЛОЖЕННАЯ папка / Раздел: 👤 Личное / Внутри: «Oleg»») — исключает создание не в той вкладке.
- Новая кнопка 🧹 рядом с «＋ Папка»: cleanEmptyTreeFolders — удаляет ВСЕ пустые папки-заглушки реестра docsCustomTree текущего раздела (итеративно съедает пустые цепочки вида Porsche/33/44; файлы не затрагиваются; записи с файлами/непустыми потомками сохраняются).
- index.js не менялся (health v69.2-2026-08-22). md5 App.js: 2d0036c254350210fd24d77af5dbfd2f.

## v69.5 (2026-08-23)
- ПОРЦИОННАЯ загрузка документов (addDocs переписан): партии ≤80 файлов и ≤~280 МБ (по исходным размерам), каждая — отдельный XHR POST /api/docs/:cat/files. Сервер больше не держит весь объём в RAM → папки вида 5023 файлов / 16,3 ГБ загружаются.
- Фото сжимаются just-in-time (только текущая партия в памяти браузера); paths/folder прикладываются к каждой партии; после каждой партии setSections — файлы появляются постепенно.
- Сбойная партия: 1 автоповтор через 2,5 с; ручная «Остановить» теряет только текущую партию, завершённые сохранены (alert с числом + loadDocs).
- Прогресс-модалка: общий процент по байтам всех партий + строка «Партия N из ~M»; фазы prepare/upload/save сохранены.
- index.js не менялся. md5 App.js: 69677e67b963522e5aabd5ee77c1cf02.

## v69.5.1 (2026-08-23)
- FIX: битое/нестандартное фото («Failed to load image», HEIC/повреждённый JPG) прерывало ВСЮ загрузку папки (5359 файлов) на этапе подготовки. Теперь сжатие обёрнуто в try/catch — такой файл уходит на сервер как есть, в конце alert со списком несжавшихся. md5 App.js: 9d0b8eb53c42852729b4ef9ea5845e44.

## v69.5.2 (2026-08-23)
- Версия сборки выводится прямо в окне прогресса загрузки («сборка · v69.5.2 ·») — для отлова кэшированных бандлов у пользователя.
- Броня: любая ошибка подготовки файла (не только сжатие) — файл уходит как есть, сводка в конце. md5 App.js: 878cebaa75e0263b4f3c73c18040eb37.
- Деплой-папка для выдачи: /mnt/agents/output/householder-deploy/ (App.js + index.js, без zip/txt).

## v69.6 (2026-08-23)
- Сворачиваемое дерево папок в DocsTab: видны только папки верхнего уровня; ▶/▼ раскрывает ветку на любом уровне (у узлов с детьми); ветка открытой папки разворачивается автоматически; состояние в localStorage docsTreeExpanded; кнопка «⊟ Свернуть» сбрасывает все развороты.
- Решает проблему гигантского дерева после загрузки 5359 файлов. md5 App.js: 7c66853465778193489af2b6bbe06de7.

## v69.7 (2026-08-23)
- Выгрузка выбранных чеков: «⬇ Загрузить» теперь открывает всплывающее меню — «📁 Загрузить файлы» (прежний сценарий) или «🗜 Загрузить ZIP-архив» (JSZip 3.10.1 с CDN, loadJSZip; внутри архива папка на чек, дедуп имён, режим exportMode действует на оба варианта, прогресс/«Остановить» общие через exportProgress/exportStopRef).
- md5 App.js: 50f95c5340a44bfc45b5514c79f54720.

## v69.8 (2026-08-24)
- Вариант «сжал сам → загрузил»: лимит файла 500 МБ → 1 ГБ (фронт addDocs + backend crmMediaUpload). Сервер пережимает видео только 48–300 МБ; >300 МБ грузятся как есть (ffmpeg на ГБ-файлах = OOM) — во всех 4 точках (docs, CRM, чеки).
- Подсказка в шапке Документов обновлена; при превышении 1 ГБ alert советует сжать H.265 1080p.
- ВАЖНО: оба сервиса надо передеплоить (api health: v69.8-2026-08-24). md5 App.js: 8324d53dfea5bae484945c2edb1253e4, index.js: 85aa569bfdfd3cda7fa5d6ca3f4c5467.

## v70 (2026-08-24)
- Прямая загрузка больших файлов (>1 ГБ, до 5 ГБ) в Cloudflare R2 multipart по 32 МБ, минуя память сервера: backend эндпоинты /api/docs/:cat/big/{init,sign,complete,abort} (AWS SDK v3, presigned PUT, 1ч), фронт bigUploadDoc с докачкой (localStorage bigup:cat:name:size), 3 попытки на часть, прогресс в общем окне (☁️ часть N/M).
- Файлы ≤1 ГБ — прежний путь. Backend требует Variables R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET/R2_PUBLIC_URL и пакеты @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner.
- md5 App.js: a5093654ff33371095cc663c65eaa8ae, index.js: 0a5dde2668295b1809536b517d842f6c.

## v70.1 (2026-08-24)
- Причина ошибки «The object exceeded the maximum allowed size»: это лимит Supabase Storage (~50 МБ на объект), НЕ наш сервер. Обычный порционный путь хранит файлы в Supabase, поэтому всё крупнее ~50 МБ падало.
- Фикс (только фронт, App.js): BIG_FILE_LIMIT снижен с 1 ГБ до 40 МБ — файлы >40 МБ идут напрямую в Cloudflare R2 (bigUploadDoc, части 32 МБ, докачка через localStorage). Мелкие файлы — как раньше, через сервер в Supabase.
- Бэкенд не менялся. Метки: футер и модалка «сборка · v70.1 ·». md5 App.js = 5735b00e23d0086231e12d0349e86b1e.

## v70.2 (2026-08-24)
- Симптом: прямая загрузка в R2 доходит до «часть 73/73 готова» и висит на 100% — затык на /big/complete (сборка multipart + запись в doc_sections).
- index.js: логи [big/complete] start/R2 assembled/supabase write/done/FAIL, текст ошибки с префиксом «Сборка файла:». Health: v70.2-2026-08-24.
- App.js: big/complete fetch с AbortController 120с + понятные сообщения (повтор загрузки докачает — части уже в облаке), статус «сборка файла в облаке…». Метки · v70.2 ·.

## v71 (2026-08-24)
- Публичные ссылки на файлы (принцип Dropbox): выбранные файлы Документов (кнопка «🔗 Ссылка» в режиме выбора) и Чеков (меню «⬇ Загрузить ▾» → «🔗 Поделиться ссылкой»).
- index.js: POST /api/share (requireAuth; {title, items[{url,name,kind,size}], days: 7/30/0=∞} → {url}), GET /api/share/:id — ПУБЛИЧНАЯ HTML-страница со списком файлов (escHtml, проверка expires_at, 404/410). Health: v71-2026-08-24.
- App.js: компонент ShareDialog (название, срок, создать/копировать/открыть), shareSelectedDocs (по всем загруженным разделам через docMediaOf), handleShareReceipts (photo_url/image_url выбранных чеков). Метки · v71 ·.
- ТРЕБУЕТСЯ: таблица Supabase `shares` (SQL в «SQL — таблица shares (один раз).md»).
- md5: App.js 081bdead81a33e95f909c9fa47db8902, index.js 6704bc381cdc7f6621d9808b5edb267d.

## v72 (2026-08-24)
- Бэкап проекта (только role=admin): GET /api/backup.zip — все таблицы (receipts, doc_sections, objects, shares, document_pages, bank_movements, planned_payments, proposals, contract_documents, crm_*) постранично по 1000 → tables/*.json + files-manifest.json/csv (все URL файлов из receipts.photo_url и doc_sections.attachments) + README.txt. ZIP собран встроенным zlib (crc32+deflate, без новых зависимостей; в central directory обязательно offset поле 42!).
- App.js: кнопка «📦 Бэкап» в шапке (только admin), downloadBackup → blob → downloadBlob. Метки · v72 ·. Health: v72-2026-08-24.

## v73 (2026-08-24)
- Кнопка «📦 Бэкап» ПЕРЕНЕСЕНА из шапки → панель загрузки, сразу после «🏦 Выписки банка» (admin only). Рядом «♻ Восстановить».
- Восстановление: выбор .zip бэкапа → JSZip читает tables/*.json → confirmDlg со сводкой → POST /api/restore {tables} → upsert по PK чанками 500, whitelist 12 таблиц, лишнее не удаляет. После успеха — reload страницы.
- index.js: express.json лимит 50mb → 300mb (дамп таблиц одним запросом). Health: v73-2026-08-24. Метки · v73 ·.

## v74 (2026-08-24) — АВТОРИЗАЦИЯ С РОЛЯМИ (вариант А+Б)
- Таблица app_users (SQL-файл в output): id/name/salt/pass_hash/role/sections/objects/disabled. Пароль = sha256(salt:pass).
- Роли: admin (всё) / manager (всё, кроме удаления и бэкапа) / buchhalter (финансы, без CRM, документы read-only) / viewer (только просмотр) / user (legacy хардкод — как раньше, свои чеки).
- index.js: login сначала ищет в app_users (потом хардкод USERS); dbUsersCache 60с + refreshUsersCache; resolveToken смотрит и в кэш БД; requireAuth стал async; requireRole(...); docSectionGuard; canAccessSection.
- Ограждения: /api/crm* — admin/manager (app.use); DELETE receipts, docs files POST/PATCH/DELETE, big/init|complete|abort — admin/manager; upload-receipt — viewer 403; GET /api/docs фильтрует разделы по user.sections; GET /api/receipts — legacy user → owner_id, роли с objects[] → фильтр .in('object').
- CRUD: GET/POST/DELETE /api/users (admin). Health: v74-2026-08-24.
- App.js: UsersTab (вкладка «👥 Доступ», admin): список, добавление, роли, чекбоксы разделов/объектов, disable, удаление. Навигация: «Загрузка» скрыта у viewer (useEffect-перенос на list), «CRM» у buchhalter/viewer, «👥 Доступ» только admin. DocsTab: docsReadOnly (viewer/buchhalter) — скрыты 📎/📂/☑ Выбрать/＋ Папка/🧹; visibleDocSections по user.sections. Чеки: ✏️ Редактировать скрыто у viewer; Перераспознать/Перевести скрыты у viewer; bulk 🗑 Удалить — admin/manager/user. Метки · v74 ·.

## v75 (2026-08-24) — доступ по разделам приложения
- app_users: новая колонка tabs jsonb (SQL: alter table app_users add column tabs jsonb;). Ключи: upload/list/analysis/taxes/crm/docs; NULL/[] = всё открыто.
- index.js: canAccessTab + tabGuard; /api/receipts→list, /api/crm→crm, /api/docs→docs, /api/bank-movements→analysis|taxes, /api/planned-payments→analysis, upload-receipt→upload. tabs проброшены в cache/login/CRUD. Health v75.
- App.js: UsersTab — чекбоксы «Разделы приложения»; навигация фильтруется по user.tabs; useEffect перебрасывает с закрытой вкладки на доступную. Метки · v75 ·.

## v76 (2026-08-24)
- Вход по ЛОГИНУ + ПАРОЛЮ: форма логина получила поле «Логин» (пусто = старые общие пароли admin/user1…). /api/login принимает {login, password}: с логином — строго app_users по id (без учёта регистра), без логина — старое поведение по паролю. Health v76. Метки · v76 ·.

## v77 (2026-08-24)
- Вёрстка логина: <style> в login-box — оба поля (логин/пароль) одинаковой ширины/вида.
- Доступ к разделам стал ПОУРОВНЕВЫМ: tabs теперь объект {upload/list/analysis/taxes/crm/docs: 'full'|'read'|'none'} (нет ключа = full; старый массив поддержан). UsersTab: у каждого раздела select «⛔ Нет доступа / 👁 Просмотр / ✏️ Полный доступ» (full не сохраняется — чистая запись).
- index.js: tabLevel/canAccessTab/canWriteTab + writeTabGuard; write-защита: PUT receipts (role+write list), DELETE receipts, docs write (6 эндпоинтов +writeTabGuard('docs')), CRM не-GET → write crm, bank-movements/manual → write analysis, upload-receipt → write upload. Health v77. Метки · v77 ·.

## v78 (2026-08-24) — «видит данные пользователей»
- app_users: новая колонка can_view jsonb (SQL: alter table app_users add column can_view jsonb;) — массив id пользователей, чьи чеки видны.
- index.js: receipts GET: admin — все; остальные — owner_id IN (self + can_view), плюс objects-фильтр комбинируется; legacy user — своё + can_view. can_view в cache/login/CRUD. Health v78.
- App.js: UsersTab — блок «Видит чеки пользователей» (чекбоксы всех пользователей + встроенный admin); в списке пользователей видно «видит: …». Кто добавил чек — поле «Добавил» уже было (formatOwnerName). Метки · v78 ·.


## v78.1 (2026-08-24)
- UsersTab «Видит чеки пользователей»: добавлены встроенные admin/user1…user10 (помечены «встроенный») — старые чеки записаны на них. Только фронт. Метки · v78.1 ·. md5 App.js см. вывод.

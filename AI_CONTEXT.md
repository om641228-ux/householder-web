# Householder-Web — AI Context File (ФИНАЛЬНЫЙ)

Полный контекст проекта для AI-ассистента. Загрузите этот файл в новый чат вместе с `App.js` и `index.js` — ассистент сразу поймёт архитектуру, историю и текущее состояние.

**Дата обновления: 2026-07-31**
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
| DELETE | `/api/receipts/:id` | Удаление (admin) |
| POST | `/api/bulk-delete` | Массовое удаление (admin) |
| POST | `/api/bulk-update-object` | Массовая смена объекта |
| POST | `/api/bulk-update-currency` | Массовая смена валюты |
| POST | `/api/bulk-update-type` | Массовая смена типа (body: {ids, document_type: 'receipt'|'invoice'}) |
| POST | `/api/upload-receipt` | Загрузка + распознавание (multipart/form-data: image/pdf, model, currency, docType, object, token) |
| POST | `/api/reprocess-receipt` | Перераспознавание |
| POST | `/api/export-excel` | Экспорт Excel (.xlsx) |

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
  image_url TEXT,            -- Supabase Storage public URL (jpg или pdf)
  raw_text TEXT,             -- распознанный текст, оригинал (модульная структура, см. п. 9)
  raw_text_ru TEXT,          -- ПЕРЕВОД raw_text на русский (та же структура) — ОБЯЗАТЕЛЬНАЯ колонка!
  document_type TEXT DEFAULT 'receipt',   -- 'receipt' | 'invoice'
  object TEXT DEFAULT 'other',            -- 'other','Duqe','Maria','Kit','Dubai','Tich'
  recognition_method TEXT,   -- какая модель распознавала (+ fallback info)
  recognized_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  owner_id TEXT, owner_name TEXT
);
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
- **Массовые действия** (панель при выборе): Удалить (admin), Экспорт (Все/Excel/Фото/Текст + Загрузить), Перераспознать, **Сменить объект...**, **Сменить тип...** (Чек/Фактура), **Сменить валюту...** (AED/EUR/USD/RUB), Сбросить
- **Чекбокс «Выбрать все на странице» — контролируемый:** checked по selectedReceiptIds, `indeterminate` при частичном выборе; после массовых операций галочка снимается автоматически
- **Фильтры Excel-стиль** (ExcelFilter): Год, Месяц, Тип, Объект — поиск по значениям, чекбоксы, «Авто-применение», «Применить»/«Очистить»; dropdown 240px, maxWidth 92vw, автовыравнивание у правого края
- Таймаут загрузки 180000 мс

## 12. Известные проблемы и решения

| Проблема | Решение |
|---|---|
| Нет перевода raw_text_ru | Бэкенд старый → деплой актуального index.js; колонка `raw_text_ru` в БД; старые чеки — «Перераспознать» |
| 502 Bad Gateway / CORS | auth in-memory (без fs), Railway-safe |
| `Invalid key` при upload в Storage | sanitizeFilename (Ñ, кириллица, пробелы) |
| Kimi падает на распознавании, но активен в пинге | НЕ передавать temperature; большой лимит токенов |
| Kimi "suspended due to insufficient balance" | Пополнить platform.kimi.ai → Billing (баланс общий с recept-web!) |
| gemini-1.5-flash 404 | Модель снята → default gemini-2.5-flash |
| Groq короткие имена → молчаливый fallback | GROQ_ALIASES на бэкенде |
| Railway Build failed | Root Directory (backend/frontend) в Settings сервиса |
| Railway отдаёт старую сборку | `NO_CACHE=1` + Redeploy (или Cmd+K → Deploy latest commit) |
| Браузер кэширует фронт | Жёсткое обновление Cmd+Shift+R |
| Bucket not found | SQL из supabase/setup.sql в БД householder |

## 13. Порядок деплоя

1. **Supabase (householder):** выполнить `supabase/setup.sql` (таблица + raw_text_ru + bucket + policies)
2. **Railway householder-api:** репо GitHub, Root Directory `backend`, Build `npm install`, Start `node index.js`, Variables (п. 4 — ключи Supabase ОТ ПРОЕКТА HOUSEHOLDER)
3. **Railway householder-web:** репо GitHub, Root Directory `frontend`, Build `npm run build`, Start `npx serve -s build`; в App.js `API_URL = 'https://householder-api-production.up.railway.app'`
4. Проверка: `https://householder-api-production.up.railway.app/api/check-models` → JSON со всеми провайдерами

## 14. Changelog

**2026-07-31 (текущая финальная версия)**
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

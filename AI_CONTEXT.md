# Receipt Manager — AI Context File

Этот файл содержит полный контекст проекта для AI-ассистента. Загрузите его в новый чат вместе с основными файлами — ассистент сразу поймёт архитектуру, историю и текущее состояние.
**Дата обновления: 2026-07-30**

---

## 1. Обзор проекта

Receipt Manager — веб-приложение для распознавания чеков и фактур с AI.
- **Фронтенд:** React SPA (деплой на Railway, `npx serve -s build`)
- **Бэкенд:** Node.js + Express (Railway), entry point `index.js`
- **База данных:** Supabase PostgreSQL
- **Хранилище фото:** Supabase Storage, bucket `receipt-images` (public)
- **AI-распознавание:** Gemini, Groq, OCR.space, OpenRouter, GitHub Models, Mistral, Kimi (Moonshot)

## 2. Структура проекта

```
receipt-manager/
├── backend/
│   ├── package.json        # Entry point: index.js ("main": "index.js", "start": "node index.js")
│   ├── index.js            # Главный сервер: Express, все routes, AI-распознавание, check-models
│   ├── auth-owners.js      # Авторизация (in-memory, Railway-safe) — сейчас встроена в index.js
│   ├── server.js           # Заглушка (require('./index.js'))
│   └── .env                # Переменные окружения (Railway Variables)
│
├── frontend/
│   ├── src/
│   │   ├── App.js          # Главный React-компонент (весь UI)
│   │   └── App.css         # Стили
│   ├── package.json
│   └── public/
│
└── supabase/
    └── setup.sql           # SQL: колонки + bucket + policies
```

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

## 4. Переменные окружения (Railway → backend → Variables)

| Переменная | Описание |
|---|---|
| `SUPABASE_URL` | URL проекта Supabase |
| `SUPABASE_KEY` | Anon key (или Service Role Key) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service Role Key (Storage upload) |
| `GEMINI_API_KEY` | Google AI Studio |
| `GROQ_API_KEY` | console.groq.com |
| `OCRSPACE_API_KEY` | ocr.space (бесплатный ключ) |
| `OPENROUTER_API_KEY` | openrouter.ai → Keys (модели `:free` бесплатны) |
| `GITHUB_TOKEN` | GitHub PAT (classic), доступ к GitHub Models (GPT-4o бесплатно) |
| `MISTRAL_API_KEY` | console.mistral.ai (Experiment-тариф бесплатен) |
| `MOONSHOT_API_KEY` | platform.kimi.ai → API Keys (ПЛАТНО, нужен баланс!) |
| `PORT` | 3000 (Railway подставляет сам) |
| `NO_CACHE=1` | Добавлять при проблемах с закэшированной сборкой |

Провайдер без ключа просто помечается ❌ в таблице моделей и пропускается в fallback.

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
| GET | `/api/list-gemini-models` | Статичный список Gemini (legacy) |
| GET | `/api/list-groq-models` | Статичный список Groq (legacy) |
| GET | `/api/list-ocrspace-models` | Статичный список OCR.space (legacy) |

### Health
`GET /health`, `GET /api/health`, `GET /`

## 6. Схема таблицы receipts (Supabase)

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
  raw_text TEXT,             -- распознанный текст (модульная структура, см. п. 9)
  document_type TEXT DEFAULT 'receipt',   -- 'receipt' | 'invoice'
  object TEXT DEFAULT 'other',            -- 'other','Duqe','Maria','Kit','Dubai','Tich'
  recognition_method TEXT,   -- какая модель распознавала (+ fallback info)
  recognized_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  owner_id TEXT, owner_name TEXT
);
```
Bucket: `receipt-images` (public, policies SELECT/INSERT/DELETE).
**ВАЖНО:** имена файлов в Storage санитизируются (`sanitizeFilename`): Ñ→N, кириллица убирается, пробелы→`_`. Иначе ошибка `Invalid key`.

## 7. Авторизация

- Hardcoded users (11): `admin/admin` → role admin; `user1/user1` … `user10/user10` → role user
- Токены in-memory (Map) — Railway-safe, сбрасываются при рестарте
- Передача токена: `?token=` (query), `x-token` header или body
- User видит только свои чеки (owner_id), admin — все

## 8. AI-провайдеры (критически важные детали!)

### Gemini (Google)
- **Default: `gemini-2.5-flash`** (gemini-1.5-flash снят с поддержки → 404!)
- `recognizeWithGeminiAuto` перебирает: 2.5-flash → 2.0-flash → 2.5-pro → 1.5-flash → 1.5-pro
- **Единственный провайдер с нативной поддержкой PDF** (inlineData mimeType application/pdf)
- Список моделей живьём: GET generativelanguage.googleapis.com/v1beta/models

### Groq
- **Алиасы** (GROQ_ALIASES): `llama-4-scout` → `meta-llama/llama-4-scout-17b-16e-instruct` и т.д. Короткие имена фронта без алиасов НЕ работают!
- Список живьём: `groq.models.list()`, фильтр whisper/playai/tts/guard

### OCR.space
- Engines: engine1 (Basic), engine2 (Advanced), engine3 (Handwriting)
- Сам только извлекает текст; **структурирование — через recognizeWithFallback** (Gemini → ...)
- Принимает PDF (до 3 страниц на free)

### OpenRouter (OpenAI-совместимый)
- baseURL: `https://openrouter.ai/api/v1`, headers: HTTP-Referer, X-Title
- Default: `google/gemma-4-26b-a4b-it:free`
- Список живьём: `/models`, фильтр `architecture.modality` содержит image + id кончается на `:free`

### GitHub Models (OpenAI-совместимый)
- baseURL: `https://models.github.ai/inference`, auth: Bearer GITHUB_TOKEN
- Default: `openai/gpt-4o-mini`. Работают: `openai/gpt-4o`, `meta/Llama-4-Scout-17B-16E-Instruct`
- Бесплатно: gpt-4o ~50 запр/день

### Mistral (OpenAI-совместимый)
- baseURL: `https://api.mistral.ai/v1`
- Default: `mistral-small-latest` (pixtral-12b-2409 убрали из каталога)
- Список живьём: `/models`, фильтр `capabilities.vision === true`

### Kimi / Moonshot (OpenAI-совместимый) — ОСОБЫЕ ПРАВИЛА
- baseURL: `https://api.moonshot.ai/v1` (платформа platform.kimi.ai)
- **ПЛАТНО** — нужен баланс, иначе аккаунт suspended ("insufficient balance")
- **НЕЛЬЗЯ передавать `temperature`** — она зафиксирована, передача = ошибка 400!
- `kimi-k3` (default): параметр `max_completion_tokens` (не max_tokens!), `reasoning_effort: 'low'` для OCR
- `kimi-k2.6`: `max_tokens >= 16000` (reasoning_content + content делят лимит)
- `moonshot-v1-*-vision-preview` — закрыты для новых аккаунтов (sunset)
- Фильтр списка: `/vision|kimi-k3|kimi-k2\.\d/`, исключить kimi-k2-XXXX/k2-turbo/kimi-latest

### Цепочка fallback (recognizeWithFallback)
**Gemini auto → OpenRouter → GitHub → Mistral → Kimi**
- Для PDF — только Gemini (остальные PDF не принимают)
- При fallback в ответе `warning` содержит ПРИЧИНУ ошибки исходной модели
- В `recognition_method` пишется фактическая модель: `kimi-kimi-k3 (fallback → gemini-2.5-flash)`

### Префиксы моделей (routing в upload-receipt / reprocess)
`gemini-*`, `groq-*`, `ocrspace-engineN`, `openrouter-*`, `github-*`, `mistral-*`, `kimi-*`

## 9. Распознанный текст (raw_text) — модульная структура

Промпт требует raw_text строго по модулям (НЕ JSON-массив, НЕ одна строка):
```
══════ МАГАЗИН ══════
══════ ДОКУМЕНТ ══════
══════ ТОВАРЫ ══════
1. НАЗВАНИЕ — КОЛ-ВО × ЦЕНА = СУММА
══════ СУММЫ ══════
ИТОГО: 944,96 EUR
══════ ОПЛАТА ══════
══════ ПРОЧИЙ ТЕКСТ ══════
```
- Модуля нет на чеке → модуль пропускается
- Бэкенд-страховка: raw_text массивом → склеивается построчно
- Фронт `formatRawText`: старые записи (JSON-массив/объект) разворачиваются построчно

## 10. PDF поддержка (добавлена 2026-07-23)

**Фронт (основной путь):** pdf.js 3.11.174 по CDN (cdnjs), `convertPdfToImages` рендерит страницы (до 10) в JPEG (scale 2.0) → `expandFilesWithPdf` в handleFileSelect/handleDrop/handleFolderSelect → дальше обычный конвейер, работают ВСЕ модели. Имена страниц: `имя_p1.jpg` (только латиница!).
**Бэкенд (прямая загрузка):** `application/pdf` → без sharp → Gemini нативно / OCR.space; PDF сохраняется в Storage как PDF; в карточках плашка «📄 PDF» (`isPdfUrl`).

## 11. Таблица выбора модели (фронт)

- Кнопка «Выбор модели» → модальное окно → `GET /api/check-models` (опрос ~30–40 сек)
- Таблица: ✔ | Модель | ID | Провайдер | Статус | Отклик(с)
- Статусы: ✅ Активна (кликабельна) / ❌ Не активна (серая, причина под статусом) / ➖ Не проверена
- Активные сверху (сортировка на бэкенде); кнопка 🔄 Обновить — повторный опрос
- Ошибки переведены в человекочитаемые подсказки (баланс, terms acceptance, неверный ключ)
- Алиасы Groq на фронте (GROQ_ALIASES_FRONT) — подсветка выбранной строки
- Цвета провайдеров: Gemini #4285f4, Groq #f55036, OCR.space #00a86b, OpenRouter #6366f1, GitHub #24292f, Mistral #ff7000, Kimi #8b5cf6

## 12. Известные проблемы и решения

| Проблема | Решение |
|---|---|
| 502 Bad Gateway / CORS | auth in-memory (без fs), Railway-safe |
| `Invalid key` при upload в Storage | sanitizeFilename (Ñ, кириллица, пробелы) |
| Kimi падает на распознавании, но активен в пинге | НЕ передавать temperature; max_tokens ≥ 16000 |
| Kimi "suspended due to insufficient balance" | Пополнить platform.kimi.ai → Billing (это ПЛАТНЫЙ API) |
| gemini-1.5-flash 404 | Модель снята с поддержки → default gemini-2.5-flash |
| moonshot-v1 не работают | Sunset для новых аккаунтов → kimi-k3/k2.6 |
| Groq короткие имена → молчаливый fallback | GROQ_ALIASES на бэкенде |
| Railway отдаёт старую сборку | `NO_CACHE=1` в Variables + Redeploy |
| Браузер кэширует фронт | Жёсткое обновление Cmd+Shift+R |
| Bucket not found | SQL из supabase/setup.sql, bucket `receipt-images` |

## 13. Порядок деплоя

1. **Supabase:** выполнить `supabase/setup.sql` (таблица + bucket + policies)
2. **Railway backend:** репо GitHub, Build: `npm install`, Start: `node index.js`, Variables (п. 4)
3. **Railway frontend:** репо GitHub, Build: `npm run build`, Start: `npx serve -s build`; в App.js константа `API_URL` указывает на backend
4. **GitHub:** backend — `package.json, index.js, auth-owners.js, server.js`; frontend — `src/App.js, src/App.css`
5. Проверка: открыть `https://<backend>/api/check-models` — JSON со всеми провайдерами

## 14. Changelog

**2026-07-30**
- Имена пользователей: 'Администратор' → 'Admin' (index.js USERS), user1-10 уже 'User N'
- Фильтры списка чеков → Excel-стиль (компонент ExcelFilter): поиск по значениям, чекбоксы, "(Выделить все)", "Автоматическое применение", кнопки "Применить/Очистить фильтр"
- Новые фильтры: Год и Месяц (из receipt_date/created_at), мультивыбор для Тип и Объект
- Состояния: filterYears/filterMonths/filterTypes/filterObjects — массивы, [] = без фильтра
- Компактная строка поиска
- Фикс вёрстки ExcelFilter: ширина dropdown 240px + maxWidth 92vw + overflow hidden; строка авто-применения — кастомный чекбокс cb() + nowrap + короткая подпись "Авто-применение"; кнопки сокращены до "Применить"/"Очистить" (minWidth 0, nowrap); автовыравнивание dropdown влево у правого края экрана (alignRight по getBoundingClientRect)
- Группировка карточек по годам и месяцам: sortedReceipts (дата desc по receipt_date||created_at) → пагинация → заголовки групп "Март 2026 · N шт" (React.Fragment, gridColumn '1 / -1', groupKeyOf/groupTitleOf)

**2026-07-31**
- Массовая смена типа документа: POST /api/bulk-update-type + select "Сменить тип..." (Чек/Фактура) в панели массовых действий между "Сменить объект" и "Сменить валюту"
- Фикс чекбокса "Выбрать все на странице": стал контролируемым (checked по selectedReceiptIds, indeterminate при частичном выборе) — галочка больше не зависает после массовых операций
- Возврат перевода raw_text_ru: поле сделано обязательным в промпте ("ответ без raw_text_ru невалиден"); лимиты вывода увеличены 4096 → 8192 (Gemini maxOutputTokens 8192 + temperature 0.1 явно, OpenAI-compat и Groq max_tokens 8192) — thinking-модели не обрезают перевод

**2026-07-23**
- Добавлены провайдеры: OpenRouter, GitHub Models, Mistral, Kimi (Moonshot)
- `/api/check-models` — живой опрос всех моделей vision-пингом
- Таблица выбора модели со статусами и причинами ошибок
- Цепочка fallback: Gemini → OpenRouter → GitHub → Mistral → Kimi
- Исправлено: temperature для Kimi (400), max_tokens для thinking-моделей, gemini-2.5-flash default, GROQ_ALIASES
- raw_text — модульная структура (МАГАЗИН/ДОКУМЕНТ/ТОВАРЫ/СУММЫ/ОПЛАТА/ПРОЧИЙ ТЕКСТ)
- PDF: конвертация на фронте (pdf.js CDN) + нативный приём на бэкенде
- sanitizeFilename для Storage (ошибка Invalid key)
- warning с причиной fallback в ответе upload-receipt

**2026-07-08**
- auth-owners.js → in-memory (Railway read-only fs)
- package.json → entry point index.js
- bucket receipts → receipt-images
- /health endpoints

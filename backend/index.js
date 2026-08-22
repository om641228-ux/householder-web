const express = require('express');
const cors = require('cors');
const multer = require('multer');
const sharp = require('sharp');
const FormData = require('form-data');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const ws = require('ws');
const { spawn } = require('child_process');
const os = require('os');
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const crmMediaUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } }); // CRM-медиа (v36.1): видео/аудио до 500 МБ
// Обёртка над multer: LIMIT_FILE_SIZE и прочие ошибки отдаём JSON (413/400), а не HTML-страницей Express → фронт покажет понятный текст
const crmMediaMulter = (field) => (req, res, next) => {
  crmMediaUpload.array(field)(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Файл слишком большой — максимум 500 МБ на файл' });
    return res.status(400).json({ error: 'Ошибка приёма файла: ' + err.message });
  });
};

// ========== SUPABASE with WS transport ==========
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseOptions = {
  auth: { persistSession: false },
  realtime: { transport: ws }
};

const supabase = createClient(supabaseUrl, supabaseKey || supabaseServiceKey, supabaseOptions);
const supabaseAdmin = supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey, supabaseOptions) 
  : supabase;

const BUCKET_NAME = 'receipt-images';

// ========== AI CLIENTS ==========
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

// ========== OPENAI-COMPATIBLE PROVIDERS (OpenRouter / GitHub Models / Mistral) ==========
const OPENAI_COMPAT_PROVIDERS = {
  openrouter: {
    displayName: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY || null,
    defaultModel: 'google/gemma-4-26b-a4b-it:free',
    fallbackIds: ['google/gemma-4-26b-a4b-it:free', 'qwen/qwen2.5-vl-32b-instruct:free', 'qwen/qwen2.5-vl-72b-instruct:free', 'google/gemma-4-31b-it:free', 'nvidia/nemotron-nano-12b-v2-vl:free'],
    extraHeaders: { 'HTTP-Referer': 'https://receipt-manager', 'X-Title': 'Receipt Manager' }
  },
  github: {
    displayName: 'GitHub',
    baseURL: 'https://models.github.ai/inference',
    apiKey: process.env.GITHUB_TOKEN || process.env.GITHUB_API_KEY || null,
    defaultModel: 'openai/gpt-4o-mini',
    fallbackIds: ['openai/gpt-4o-mini', 'openai/gpt-4o', 'meta/Llama-4-Scout-17B-16E-Instruct'],
    extraHeaders: {}
  },
  mistral: {
    displayName: 'Mistral',
    baseURL: 'https://api.mistral.ai/v1',
    apiKey: process.env.MISTRAL_API_KEY || null,
    defaultModel: 'mistral-small-latest',
    fallbackIds: ['mistral-small-latest', 'pixtral-12b-2409'],
    extraHeaders: {}
  },
  kimi: {
    displayName: 'Kimi',
    baseURL: 'https://api.moonshot.ai/v1',
    apiKey: process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY || null,
    // moonshot-v1-* закрыты для новых аккаунтов (sunset 31.08.2026) — дефолт kimi-k3
    defaultModel: 'kimi-k3',
    fallbackIds: ['kimi-k3', 'kimi-k2.6', 'moonshot-v1-8k-vision-preview', 'moonshot-v1-32k-vision-preview', 'moonshot-v1-128k-vision-preview'],
    extraHeaders: {}
  }
};

// ========== AUTH ==========
const USERS = {
  'admin': { id: 'admin', name: 'Admin', role: 'admin' },
  'user1': { id: 'user1', name: 'User 1', role: 'user' },
  'user2': { id: 'user2', name: 'User 2', role: 'user' },
  'user3': { id: 'user3', name: 'User 3', role: 'user' },
  'user4': { id: 'user4', name: 'User 4', role: 'user' },
  'user5': { id: 'user5', name: 'User 5', role: 'user' },
  'user6': { id: 'user6', name: 'User 6', role: 'user' },
  'user7': { id: 'user7', name: 'User 7', role: 'user' },
  'user8': { id: 'user8', name: 'User 8', role: 'user' },
  'user9': { id: 'user9', name: 'User 9', role: 'user' },
  'user10': { id: 'user10', name: 'User 10', role: 'user' },
};

const tokens = new Map();

// v57.4: сессии переживают redeploy/рестарт Railway — токен ПОДПИСАН (HMAC), а не только в памяти.
// Секрет: AUTH_SECRET (рекомендуется задать в Variables) → иначе SUPABASE_SERVICE_ROLE_KEY → встроенный.
const cryptoAuth = require('crypto');
const AUTH_SECRET = process.env.AUTH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'householder-auth-secret-v1';
const b64u = (buf) => Buffer.from(buf).toString('base64url');
function signPayload(payloadB64) {
  return cryptoAuth.createHmac('sha256', AUTH_SECRET).update(payloadB64).digest('base64url');
}
function generateToken(userId) {
  const payload = b64u(`${userId}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}`);
  return `s1.${payload}.${signPayload(payload)}`;
}
// Проверка: сначала in-memory (старые токены до рестарта), затем — по подписи
function resolveToken(token) {
  if (!token) return null;
  const mem = tokens.get(token);
  if (mem) return mem;
  const m = String(token).match(/^s1\.([A-Za-z0-9_\-]+)\.([A-Za-z0-9_\-]+)$/);
  if (!m) return null;
  const expected = signPayload(m[1]);
  const got = m[2];
  if (expected.length !== got.length || !cryptoAuth.timingSafeEqual(Buffer.from(expected), Buffer.from(got))) return null;
  let userId = null;
  try { userId = Buffer.from(m[1], 'base64url').toString('utf8').split('.')[0]; } catch (_) { return null; }
  const user = USERS[userId];
  if (!user) return null;
  tokens.set(token, user); // кэшируем — logout продолжает работать в рамках процесса
  return user;
}

function requireAuth(req, res, next) {
  const token = req.query.token || req.headers['x-token'] || req.body?.token;
  const user = resolveToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.user = user;
  next();
}

// ========== CORS ==========
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-token'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ========== HEALTH ==========
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.get('/api/health', (req, res) => res.json({ status: 'ok', build: 'v68.7.1-2026-08-22', features: ['planned-freq', 'docs', 'crm-contact-files'] }));
app.get('/', (req, res) => res.json({ status: 'Receipt Manager API', health: '/health' }));

// ========== AUTH ROUTES ==========
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  const user = USERS[password];
  if (!user) return res.status(401).json({ error: 'Неверный пароль' });
  const token = generateToken(user.id);
  tokens.set(token, user);
  res.json({ success: true, token, user });
});

app.get('/api/me', (req, res) => {
  const user = resolveToken(req.query.token);
  if (!user) return res.status(401).json({ error: 'Invalid token' });
  res.json({ success: true, user });
});

app.post('/api/logout', (req, res) => {
  const { token } = req.body;
  tokens.delete(token);
  res.json({ success: true });
});

// ========== RECEIPT PROMPT ==========
function buildReceiptPrompt(currency, docType) {
  const currencyHint = currency === 'auto' 
    ? `Определи валюту АВТОМАТИЧЕСКИ по месту и содержимому документа:
       - символы: € → EUR, $ → USD, £ → GBP, ₽/руб → RUB, د.إ/Dhs → AED
       - страна/адрес магазина: Испания/Европа → EUR, ОАЭ (Dubai, Abu Dhabi) → AED, США → USD, Россия → RUB
       - слова на чеке: "EUR", "EURO", "IVA", "IGIC" → EUR; "AED", "VAT 5%" (ОАЭ) → AED
       Верни ISO-код валюты (EUR, USD, AED, RUB, GBP...).` 
    : `Валюта: ${currency}.`;
  const docTypeHint = docType === 'auto'
    ? 'Определи тип САМ по содержимому документа.'
    : `Пользователь указал тип "${docType}" — но если по содержимому явно видно другое, укажи правильный.`;

  return `Ты — эксперт по распознаванию чеков и фактур. Проанализируй изображение и извлеки ВСЕ данные в строгом JSON формате.

ВАЖНЫЕ ПРАВИЛА:
1. Извлеки ВЕСЬ текст с чека полностью — каждую строку, каждую цифру.
2. Найди магазин (store_name), дату (receipt_date в формате YYYY-MM-DD), время (receipt_time), итоговую сумму (total_amount).
3. Найди ВСЕ товары — каждый товар это объект с: name (оригинальное название), name_ru (перевод на русский), quantity (количество), price (цена за единицу), total (общая сумма за товар). Товаров может быть 100+ — выведи КАЖДЫЙ, без пропусков и без сокращений списка.
4. ${currencyHint}
5. Если не уверен в значении — используй null, НЕ используй "Unknown" или 0 без причины.
6. Дата: если на чеке "20/03/2026" → "2026-03-20". Если "20.03.2026" → "2026-03-20".
7. Суммы: извлеки точные числа, убери символы валют.
8. Товары: если quantity не указан, используй 1.
9. Подытог (subtotal) и налог (tax_amount) — если есть на чеке.
10. Способ оплаты (payment_method) — если указан.
11. Адрес магазина (country) — если указан.

12. Тип документа (document_type) — ОБЯЗАТЕЛЬНО одно из значений:
    - "receipt" — ЧЕК: обычный кассовый чек, ticket, recibo, sales receipt без юр. реквизитов, слип оплаты в магазине/ресторане.
    - "invoice" — ФАКТУРА: на документе есть FACTURA / INVOICE / счёт-фактура, номер фактуры, налоговый номер продавца (NIF/VAT/ИНН), юридические реквизиты. FACTURA SIMPLIFICADA — это тоже "invoice".
    - "bill" — СЧЁТ/КВИТАНЦИЯ на оплату услуг: коммуналка (electricidad, agua, gas, basura), comunidad de propietarios, телефон/интернет, подписки, аренда. Заголовок "FACTURA" от провайдера услуг (Iberdrola, Endesa, Telefónica, Vodafone...) — если это периодический счёт за услуги, ставь "bill", а не "invoice".
    - "insurance" — СТРАХОВКА: полис, póliza de seguro, страховая премия, recibo de seguro.
    - "bank" — БАНКОВСКИЙ документ: выписка (extracto bancario), подтверждение перевода, SEPA-дебет, comisión bancaria.
    - "contract" — ДОГОВОР: contrato (аренда, услуги, трудовой), соглашение, дополнение к договору.
    - "municipality" — МЭРИЯ: документы муниципалитета (Ayuntamiento): informe urbanístico, licencias, notificaciones municipales, tasas/ordenanzas муниципальные.
    - "tax" — НАЛОГОВАЯ: документы налоговых органов (Agencia Tributaria/AEAT, Hacienda, налоговая Канар): IBI, IAE, declaraciones, liquidaciones, recibos de impuestos, modelo 303/130 и т.п.
    - "proposal" — КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ: presupuesto, oferta comercial, cotización, proforma — НЕ счёт к оплате (это invoice/bill), а предложение цен/условий.
    - "other" — всё остальное, что не подходит под категории выше.
    Если сомневаешься между "invoice" и "bill": разовая продажа товаров/работ от поставщика → "invoice"; периодический счёт за услуги (свет, вода, связь, comunidad) → "bill".
    ${docTypeHint}

13. raw_text — ВЕСЬ текст с документа НА ЯЗЫКЕ ОРИГИНАЛА (испанский чек → на испанском, арабский → на арабском), СТРУКТУРИРОВАННЫЙ по модулям. Это НЕ JSON-массив и НЕ одна сплошная строка. Подписи и значения — как напечатано на документе, ничего не переводи.
    МОДУЛЬ ТОВАРЫ: перечисли КАЖДУЮ товарную строку с чека, даже если их 100+. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО заменять список товаров сводками вида "(109 artículos)", "extracto", "..." или "и т.д." — такой ответ НЕВАЛИДЕН.
    Формат raw_text строго такой:

══════ МАГАЗИН ══════
Nombre: <как на документе>
Empresa: <юр. лицо как на документе>
Dirección: <адрес как на документе>
NIF: <налоговый номер как на документе>

══════ ДОКУМЕНТ ══════
Tipo: <как на документе: FACTURA SIMPLIFICADA / TICKET / INVOICE>
Número: <номер как на документе>
Fecha: <дата как на документе>
Hora: <время как на документе>

══════ ТОВАРЫ ══════
1. <название как на документе> — <кол-во> × <цена> = <сумма>
2. <название как на документе> — <кол-во> × <цена> = <сумма>

══════ СУММЫ ══════
Subtotal: <как на документе>
Impuestos: <как на документе>
TOTAL: <итог как на документе> <валюта>

══════ ОПЛАТА ══════
Forma de pago: <как на документе>
Entregado: <как на документе>
Cambio: <как на документе>

══════ ПРОЧИЙ ТЕКСТ ══════
<все остальные строки с документа на языке оригинала, не вошедшие в модули выше: реклама, примечания, реквизиты, футеры — каждая с новой строки>

14. raw_text_ru — ОБЯЗАТЕЛЬНОЕ ПОЛЕ: ПОЛНЫЙ ПЕРЕВОД raw_text на русский язык с той же модульной структурой и порядком строк. Все названия, подписи и примечания переведи; числа, даты, артикулы и реквизиты оставь без изменений. Заголовки модулей те же: ══════ МАГАЗИН ══════, ══════ ДОКУМЕНТ ══════, ══════ ТОВАРЫ ══════, ══════ СУММЫ ══════, ══════ ОПЛАТА ══════, ══════ ПРОЧИЙ ТЕКСТ ══════. Ответ БЕЗ поля raw_text_ru считается НЕВАЛИДНЫМ.
15. Для документов типа bill / insurance / bank / contract / municipality / tax / proposal дополнительно извлеки:
    - subtype — подтип услуги/документа, ОДНО из значений: electricity (luz/electricidad), water (agua), gas, internet, phone (teléfono/móvil), comunidad, rent (alquiler), waste (basura/recogida de residuos), insurance_home, insurance_car, insurance_health, tax (impuestos/tasas), other. Для receipt — null. ВАЖНО: если документ определён как invoice, но это фактура за услуги (свет, вода, интернет, мусор, связь, comunidad) — subtype заполни ОБЯЗАТЕЛЬНО.
    - provider — компания-поставщик или эмитент документа (Iberdrola, Endesa, Movistar, Mapfre, название банка...).
    - valid_from / valid_to — период действия полиса/договора или период счёта в формате YYYY-MM-DD, если указаны на документе; иначе null.
16. Коммунальные счета за воду/электричество (bill или invoice от коммунального провайдера) — дополнительно извлеки:
    - invoice_number — номер фактуры/документа (Número de factura, Nº FACTURA, DOCUMENTO).
    - contract_number — номер договора/контракта (Número de contrato, DATOS DEL CONTRATO Nº).
    - supply_address — адрес поставки КАК НАПЕЧАТАНО на документе (Dirección de suministro, DIRECCION).
    - cups — код CUPS точки поставки (только электричество, формат ES0031...); если нет — null.
    - meter_number — номер счётчика (NÚMERO CONTADOR); если нет — null.
    - consumption — потребление за период, ЧИСЛО (для света — кВт·ч, для воды — м³); если несколько строк потребления — сумма.
    - consumption_unit — "kWh" для электричества, "m3" для воды.
17. Объект недвижимости (object) — ОПРЕДЕЛИ ПО АДРЕСУ ПОСТАВКИ (supply_address) или адресу в документе:
    - адрес содержит "Reykjavik" → "Duqe"
    - адрес содержит "Callao" → "Maria"
    - адрес содержит "Alcojora" → "Kit"
    - адрес не подходит ни под одно правило (или это обычный чек из магазина) → null
18. Поставщики и подтип услуги: AQUALIA / ENTEMANSER / муниципальная вода (Servicio Municipal de Suministro de Agua) → subtype "water"; IBERDROLA / ENDESA / PODO / GEO Alternativa → subtype "electricity".
    store_name — ВСЕГДА оригинальное название компании/магазина КАК НАПЕЧАТАНО на документе (Iberdrola, Aqualia, PODO, Mercadona), БЕЗ перевода; перевод — только в store_name_ru.

ПРАВИЛА ДЛЯ raw_text:
- Модули идут строго в этом порядке, заголовок модуля — отдельная строка "══════ ИМЯ ══════"
- Если данных для модуля нет на чеке — НЕ выдумывай, пропусти модуль целиком
- raw_text — строго на языке оригинала; raw_text_ru — полный перевод на русский; обе структуры идентичны
- ОБА поля ОБЯЗАТЕЛЬНЫ: если на документе есть хоть какой-то текст, raw_text_ru должен присутствовать и содержать перевод КАЖДОЙ строки raw_text
- ЗАПРЕЩЕНО выводить raw_text и raw_text_ru как JSON-массив или одной строкой без переносов

Верни ТОЛЬКО JSON, без markdown, без объяснений:

{
  "store_name": "MediaMarkt",
  "store_name_ru": "МедиаМаркт",
  "receipt_date": "2026-03-20",
  "receipt_time": "15:14",
  "total_amount": 944.96,
  "subtotal": 944.96,
  "tax_amount": null,
  "tax_rate": null,
  "currency": "EUR",
  "payment_method": null,
  "country": "Spain",
  "document_type": "invoice",
  "subtype": null,
  "provider": null,
  "valid_from": null,
  "valid_to": null,
  "invoice_number": null,
  "contract_number": null,
  "supply_address": null,
  "cups": null,
  "meter_number": null,
  "consumption": null,
  "consumption_unit": null,
  "object": null,
  "items": [
    {
      "name": "BROTHER MFD LASER MONO",
      "name_ru": "МФУ Brother лазерное",
      "quantity": 1,
      "price": 399.00,
      "total": 399.00
    }
  ],
  "raw_text": "══════ МАГАЗИН ══════\\nNombre: MediaMarkt\\nEmpresa: MEDIA MARKT L PGC S.A.U.\\n\\n══════ ДОКУМЕНТ ══════\\nTipo: FACTURA SIMPLIFICADA\\nNúmero: FS E327-101/00110217\\n\\n══════ ТОВАРЫ ══════\\n1. BROTHER MFD LASER MONO MFCL2960DW — 1 × 399,00 = 399,00\\n\\n══════ СУММЫ ══════\\nTOTAL: 944,96 EUR",
  "raw_text_ru": "══════ МАГАЗИН ══════\\nНазвание: МедиаМаркт\\nЮр. лицо: MEDIA MARKT L PGC S.A.U.\\n\\n══════ ДОКУМЕНТ ══════\\nТип: УПРОЩЁННАЯ ФАКТУРА\\nНомер: FS E327-101/00110217\\n\\n══════ ТОВАРЫ ══════\\n1. МФУ Brother лазерное MFCL2960DW — 1 × 399,00 = 399,00\\n\\n══════ СУММЫ ══════\\nИТОГО: 944,96 EUR"
}`;
}

// ========== AI RECOGNITION ==========
// gemini-1.5-flash снят с поддержки на новых ключах (404) — используем 2.5
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

// Карта «адрес поставки → объект недвижимости» (см. AI_CONTEXT п. 9):
// Reykjavik 7 → Duqe, Callao 1 → Maria, Alcojora → Kit
const OBJECT_ADDRESS_MAP = [
  { match: /reykjavik/i, object: 'Duqe' },
  { match: /callao/i, object: 'Maria' },
  { match: /alcojora/i, object: 'Kit' }
];

// Детерминированная страховка: находим объект по адресу, даже если модель проигнорировала правило 17 промпта
function detectObjectByAddress(...texts) {
  const haystack = texts.filter(Boolean).join('\n');
  if (!haystack) return null;
  for (const { match, object } of OBJECT_ADDRESS_MAP) {
    if (match.test(haystack)) return object;
  }
  return null;
}
const GEMINI_FALLBACK_CANDIDATES = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-pro', 'gemini-1.5-flash', 'gemini-1.5-pro'];

async function recognizeWithGemini(imageBuffer, modelName, currency, docType, mimeType = 'image/jpeg') {
  if (!genAI) throw new Error('Gemini API key not configured');
  // maxOutputTokens задан явно: raw_text (оригинал) + raw_text_ru (перевод) — длинный вывод
  // (длинные чеки на 100+ товаров!), а у 2.5 thinking-токены тоже идут в этот лимит.
  const model = genAI.getGenerativeModel({
    model: modelName || DEFAULT_GEMINI_MODEL,
    generationConfig: { maxOutputTokens: 16384, temperature: 0.1 }
  });
  const prompt = buildReceiptPrompt(currency, docType);
  
  const result = await model.generateContent([
    { inlineData: { data: imageBuffer.toString('base64'), mimeType } },
    prompt
  ]);
  
  const text = result.response.text();
  return parseAIResponse(text);
}

// Gemini с автоподбором рабочей модели: перебирает кандидатов, пока одна не ответит
async function recognizeWithGeminiAuto(imageBuffer, currency, docType, mimeType = 'image/jpeg') {
  let lastError = null;
  for (const candidate of GEMINI_FALLBACK_CANDIDATES) {
    try {
      const data = await recognizeWithGemini(imageBuffer, candidate, currency, docType, mimeType);
      return { data, model: candidate };
    } catch (e) {
      console.warn(`Gemini model ${candidate} failed: ${e.message}`);
      lastError = e;
    }
  }
  throw lastError || new Error('Все модели Gemini недоступны');
}

// ========== УНИВЕРСАЛЬНОЕ РАСПОЗНАВАНИЕ (OpenAI-совместимые: OpenRouter/GitHub/Mistral) ==========
async function recognizeWithOpenAICompat(imageBuffer, modelName, currency, docType, providerKey) {
  const cfg = OPENAI_COMPAT_PROVIDERS[providerKey];
  if (!cfg) throw new Error(`Unknown provider: ${providerKey}`);
  if (!cfg.apiKey) throw new Error(`${cfg.displayName} API key not configured`);
  const base64 = imageBuffer.toString('base64');
  const prompt = buildReceiptPrompt(currency, docType);
  const model = modelName || cfg.defaultModel;

  const body = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } }
        ]
      }
    ],
    max_tokens: 16384, // запас: длинные чеки 100+ товаров — оригинал + полный перевод
    temperature: 0.1
  };
  if (providerKey === 'mistral') body.max_tokens = 8192; // предел вывода у mistral-small

  // Kimi (Moonshot): температура жёстко зафиксирована — передача значения = ошибка 400.
  // Думающим моделям нужен большой лимит: reasoning_content + content ≤ max_tokens.
  if (providerKey === 'kimi') {
    delete body.temperature;
    if (/kimi-k3/i.test(model)) {
      delete body.max_tokens; // deprecated для K3
      body.max_completion_tokens = 16384;
      body.reasoning_effort = 'low'; // для OCR достаточно — быстрее и дешевле
    } else {
      body.max_tokens = 16384;
    }
  }

  const res = await axios.post(`${cfg.baseURL}/chat/completions`, body, {
    headers: {
      'Authorization': `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
      ...cfg.extraHeaders
    },
    timeout: 280000 // длинные чеки 100+ товаров: оригинал + перевод, thinking-модели медленные
  });

  const content = res.data?.choices?.[0]?.message?.content;
  if (!content) {
    const finish = res.data?.choices?.[0]?.finish_reason;
    throw new Error(`${cfg.displayName} вернул пустой ответ (finish_reason: ${finish || 'unknown'})`);
  }
  return parseAIResponse(content);
}

// ========== ОБЩАЯ ЦЕПОЧКА FALLBACK: Gemini → OpenRouter → GitHub → Mistral → Kimi ==========
async function recognizeWithFallback(imageBuffer, currency, docType, mimeType = 'image/jpeg') {
  const errors = [];
  try {
    const auto = await recognizeWithGeminiAuto(imageBuffer, currency, docType, mimeType);
    return { data: auto.data, model: auto.model };
  } catch (e) {
    errors.push(`gemini: ${e.message}`);
  }
  // PDF нативно поддерживает только Gemini — остальные провайдеры пропускаем
  if (mimeType === 'application/pdf') {
    throw new Error(errors.join(' | ') || 'PDF: Gemini недоступен');
  }
  for (const key of ['openrouter', 'github', 'mistral', 'kimi']) {
    const cfg = OPENAI_COMPAT_PROVIDERS[key];
    if (!cfg.apiKey) { errors.push(`${key}: нет API ключа`); continue; }
    try {
      const data = await recognizeWithOpenAICompat(imageBuffer, cfg.defaultModel, currency, docType, key);
      return { data, model: `${key}-${cfg.defaultModel}` };
    } catch (e) {
      console.warn(`Fallback ${key} failed: ${e.message}`);
      errors.push(`${key}: ${e.message}`);
    }
  }
  throw new Error(errors.join(' | ') || 'Нет доступных провайдеров распознавания');
}

// ========== ГАРАНТИЯ ПЕРЕВОДА raw_text_ru ==========
// Модели (особенно kimi-k3) могут опустить raw_text_ru, несмотря на обязательность в промпте.
// Если перевода нет — делаем отдельный ДЕШЁВЫЙ текстовый запрос (без картинки) на перевод.
function buildTranslatePrompt(rawText) {
  return `Переведи текст документа на русский язык. ПРАВИЛА:
- Сохрани структуру и порядок строк ОДИН В ОДИН. Заголовки вида ══════ ИМЯ ══════ оставь без изменений (они уже на русском)
- Если текст УЖЕ на русском языке — верни его БЕЗ изменений
- Переведи все названия, подписи и примечания; числа, даты, артикулы, реквизиты, номера карт и суммы НЕ меняй
- Таблицы переводи ПОСТРОЧНО, сохраняя содержимое КАЖДОЙ ячейки. ЗАПРЕЩЕНО возвращать пустую сетку таблицы (строки из одних символов | и -) или удалять содержимое ячеек
- Верни ТОЛЬКО переведённый текст, без пояснений и markdown

ТЕКСТ:
${rawText}`;
}

// v56.3: проверка, что ответ провайдера действительно ПЕРЕВОД, а не эхо оригинала.
// Иначе карточка «прыгает»: одна страница на русском, следующая — испанский оригинал.
function looksUntranslated(src, out) {
  const cyr = (String(out || '').match(/[а-яё]/gi) || []).length;
  const latSrc = (String(src || '').match(/[a-záéíóúñü]/gi) || []).length;
  return latSrc > 40 && cyr < 5;
}

async function translateRawText(rawText) {
  const prompt = buildTranslatePrompt(rawText);
  const errors = [];

  // 1) Gemini — дешёвый и быстрый текстовый запрос
  if (genAI) {
    try {
      const m = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: { maxOutputTokens: 16384, temperature: 0.1 }
      });
      const r = await m.generateContent(prompt);
      const t = r.response.text();
      if (t && t.trim().length > 10 && !looksUntranslated(rawText, t)) return t.trim();
    } catch (e) { errors.push(`gemini: ${e.message}`); }
  }

  // 2) Groq — быстрая текстовая модель
  if (groq) {
    try {
      const r = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 8192,
        temperature: 0.1
      });
      const t = r.choices[0].message.content;
      if (t && t.trim().length > 10 && !looksUntranslated(rawText, t)) return t.trim();
    } catch (e) { errors.push(`groq: ${e.message}`); }
  }

  // 3) OpenAI-совместимые провайдеры (текстовые запросы)
  for (const key of ['openrouter', 'github', 'mistral', 'kimi']) {
    const cfg = OPENAI_COMPAT_PROVIDERS[key];
    if (!cfg || !cfg.apiKey) continue;
    try {
      const body = {
        model: cfg.defaultModel,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: key === 'mistral' ? 8192 : 16384, // длинные чеки: перевод 100+ строк
        temperature: 0.1
      };
      if (key === 'kimi') {
        delete body.temperature;
        if (/kimi-k3/i.test(cfg.defaultModel)) {
          delete body.max_tokens;
          body.max_completion_tokens = 16384;
          body.reasoning_effort = 'low';
        } else {
          body.max_tokens = 16384;
        }
      }
      const r = await axios.post(`${cfg.baseURL}/chat/completions`, body, {
        headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', ...cfg.extraHeaders },
        timeout: 180000 // перевод длинного текста (100+ строк)
      });
      const t = r.data.choices?.[0]?.message?.content;
      if (t && t.trim().length > 10 && !looksUntranslated(rawText, t)) return t.trim();
    } catch (e) { errors.push(`${key}: ${e.message}`); }
  }

  console.warn('translateRawText: все провайдеры не смогли перевести:', errors.join(' | '));
  return null;
}

// ========== МНОГОСТРАНИЧНЫЕ ДОКУМЕНТЫ: распознавание ПО СТРАНИЦАМ ==========
// Договоры, эскритуры (купля-продажа недвижимости), выписки, полисы:
// PDF длиннее LONG_PDF_PAGE_THRESHOLD страниц обрабатывается постранично
// (Gemini vision по 1-страничным PDF), вывод — модулями
// ══════ СТРАНИЦА N ══════ в raw_text и raw_text_ru.
// ТРЕБУЕТ пакет pdf-lib в backend/package.json ("pdf-lib": "^1.17.1")!

const LONG_PDF_PAGE_THRESHOLD = 2;

// pdf-lib установлен? (без него постраничный режим для PDF недоступен)
function hasPdfLib() {
  try { require.resolve('pdf-lib'); return true; } catch { return false; }
}

// Количество страниц PDF: pdf-lib → regex по меткам → 0 (неизвестно, тогда спросим Gemini)
async function getPdfPageCount(pdfBuffer) {
  try {
    const { PDFDocument } = require('pdf-lib');
    const doc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    return doc.getPageCount();
  } catch (e) {
    const matches = String(pdfBuffer.toString('latin1')).match(/\/Type\s*\/Page(?![sS\/\w])/g);
    const count = matches ? matches.length : 0;
    console.warn(`getPdfPageCount: pdf-lib недоступен (${e.message}), regex-оценка: ${count}`);
    return count; // 0 = не удалось определить
  }
}

// Последний резерв подсчёта страниц: спрашиваем Gemini (он видит весь PDF)
async function getPdfPageCountViaGemini(pdfBuffer) {
  if (!genAI) return 0;
  try {
    const m = genAI.getGenerativeModel({ model: DEFAULT_GEMINI_MODEL, generationConfig: { maxOutputTokens: 64, temperature: 0 } });
    const r = await m.generateContent([
      { inlineData: { data: pdfBuffer.toString('base64'), mimeType: 'application/pdf' } },
      'Сколько страниц в этом PDF-документе? Ответь ТОЛЬКО числом, без единого слова.'
    ]);
    const n = parseInt(String(r.response.text() || '').replace(/\D/g, ''), 10);
    return isNaN(n) ? 0 : n;
  } catch (e) {
    console.warn('getPdfPageCountViaGemini failed:', e.message);
    return 0;
  }
}

// Признак «пустой сетки»: модель выдала рамку таблицы без содержимого
// (много строк только из | _ – - + и пробелов) или подозрительно мало видимых знаков.
// Служебные строки-маркеры ("(страница без текста)" и т.п.) скелетом НЕ считаются.
function looksLikeEmptySkeleton(text) {
  const s = String(text || '').trim();
  if (!s) return true;
  if (s.startsWith('(')) return false; // служебный маркер
  const lines = s.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return true;
  const skeletonLines = lines.filter(l => l.length >= 8 && /^[|_\-—–+*\s.:]*$/.test(l)).length;
  if (skeletonLines >= 4 && skeletonLines >= lines.length * 0.5) return true;
  const visibleChars = lines.join('').replace(/[|_\-—–+*\s.:]/g, '').length;
  if (visibleChars < 40) return true; // почти пусто: повторная попытка не повредит
  return false;
}

// Текст одной страницы через Gemini vision (1-страничный PDF или изображение страницы)
// Лимит 12288: плотные страницы договоров (20+ тыс. знаков ≈ 6–7 тыс. токенов) + thinking-запас.
// Если результат похож на пустую сетку таблицы (мелкий текст не прочитался) — ОДИН повтор
// с усиленным промптом (построчное чтение таблиц, 16384 токена, temperature 0).
async function extractPageTextWithGemini(pageBuffer, mimeType, pageNum, totalPages) {
  if (!genAI) throw new Error('Постраничное распознавание требует GEMINI_API_KEY (vision по страницам)');
  const inline = { inlineData: { data: pageBuffer.toString('base64'), mimeType: mimeType || 'application/pdf' } };
  const prompt = `Это страница ${pageNum} из ${totalPages} отсканированного многостраничного документа (договор, эскритура купли-продажи, банковская выписка, полис, счёт, коммерческое предложение).
Извлеки ВЕСЬ текст этой страницы ДОСЛОВНО, на языке оригинала (НЕ переводи), сохраняя порядок строк и, по возможности, структуру (подписи полей, таблицы построчно).
ПРАВИЛА ДЛЯ ТАБЛИЦ: выпиши КАЖДУЮ строку таблицы отдельной строкой текста, перечисляя содержимое ВСЕХ ячеек через " | ". Если ячейку не удаётся прочитать — впиши [неразборчиво], но НЕ оставляй её молча пустой. ЗАПРЕЩЕНО выводить пустую рамку таблицы (строки из одних символов | и -) без содержимого. Заполнители форм — длинные ряды точек или звёздочек (........, ********) — НЕ выводи: вместо них один пробел.
Не добавляй ничего от себя: ни JSON, ни markdown, ни комментарии, ни сводки — только текст страницы.
Если на странице нет текста (чистое фото/пустая) — верни одну строку: (страница без текста)`;
  const retryPrompt = `Это страница ${pageNum} из ${totalPages} отсканированного документа с ТАБЛИЦАМИ и мелким текстом.
В предыдущей попытке содержимое таблиц потерялось (остались только ряды точек/звёздочек). Прочитай страницу МАКСИМАЛЬНО внимательно, как будто разглядываешь её по фрагментам с увеличением:
- Сначала выпиши весь текст ВНЕ таблиц (заголовки, реквизиты, подписи, даты, адреса).
- Затем КАЖДУЮ таблицу — строго построчно: одна строка таблицы = одна строка текста, ячейки через " | ", включая номера касилий, наименования и суммы. Не пропускай и не объединяй строки. Если ячейка пуста В ОРИГИНАЛЕ — так и напиши: (пусто).
- Заполнители форм — длинные ряды точек или звёздочек (............, ************) — НЕ выводи вообще: вместо них просто пробел между названием и значением.
Текст выводи на языке оригинала, без перевода, без markdown и комментариев.`;
  const mk = (maxTok, temp) => genAI.getGenerativeModel({
    model: DEFAULT_GEMINI_MODEL,
    generationConfig: { maxOutputTokens: maxTok, temperature: temp }
  });
  const result = await mk(12288, 0.1).generateContent([inline, prompt]);
  let t = (result.response.text() || '').trim();
  if (looksLikeEmptySkeleton(t)) {
    console.warn(`Страница ${pageNum}: похоже на пустую сетку (${t.length} зн.), повтор с усиленным промптом`);
    try {
      const r2 = await mk(16384, 0).generateContent([inline, retryPrompt]);
      const t2 = (r2.response.text() || '').trim();
      if (!looksLikeEmptySkeleton(t2) || t2.length > t.length) t = t2;
    } catch (e) { console.warn(`Страница ${pageNum}: повтор не удался: ${e.message}`); }
  }
  return t || '(страница без текста)';
}

// Пул параллельных задач: не более concurrency одновременно (RPM-лимиты AI-провайдеров)
async function runWithConcurrency(items, worker, concurrency = 3) {
  const results = new Array(items.length);
  let idx = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      try {
        results[i] = await worker(items[i], i);
      } catch (e) {
        console.error(`page ${i + 1} failed:`, e.message);
        results[i] = `(ошибка распознавания страницы: ${String(e.message).slice(0, 150)})`;
      }
    }
  });
  await Promise.all(lanes);
  return results;
}

// Текстовый запрос с цепочкой провайдеров (сводка полей по тексту документа)
async function callTextChain(prompt, maxTokens = 8192) {
  const errors = [];
  if (genAI) {
    try {
      const m = genAI.getGenerativeModel({ model: DEFAULT_GEMINI_MODEL, generationConfig: { maxOutputTokens: maxTokens, temperature: 0.1 } });
      const r = await m.generateContent(prompt);
      const t = r.response.text();
      if (t && t.trim().length > 2) return t.trim();
    } catch (e) { errors.push(`gemini: ${e.message}`); }
  }
  if (groq) {
    try {
      const r = await groq.chat.completions.create({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], max_tokens: Math.min(maxTokens, 8192), temperature: 0.1 });
      const t = r.choices[0].message.content;
      if (t && t.trim().length > 2) return t.trim();
    } catch (e) { errors.push(`groq: ${e.message}`); }
  }
  for (const key of ['openrouter', 'github', 'mistral', 'kimi']) {
    const cfg = OPENAI_COMPAT_PROVIDERS[key];
    if (!cfg || !cfg.apiKey) continue;
    try {
      const body = {
        model: cfg.defaultModel,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: key === 'mistral' ? 8192 : maxTokens,
        temperature: 0.1
      };
      if (key === 'kimi') {
        delete body.temperature;
        if (/kimi-k3/i.test(cfg.defaultModel)) {
          delete body.max_tokens;
          body.max_completion_tokens = maxTokens;
          body.reasoning_effort = 'low';
        }
      }
      const r = await axios.post(`${cfg.baseURL}/chat/completions`, body, {
        headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', ...cfg.extraHeaders },
        timeout: 180000
      });
      const t = r.data.choices?.[0]?.message?.content;
      if (t && t.trim().length > 2) return t.trim();
    } catch (e) { errors.push(`${key}: ${e.message}`); }
  }
  throw new Error('callTextChain: все провайдеры недоступны: ' + errors.join(' | '));
}

// Промпт JSON-сводки полей по распознанному тексту многостраничного документа
function buildDocumentSummaryPrompt(textSample) {
  return `Ты анализируешь многостраничный документ, распознанный по страницам. Это может быть: СЧЁТ за коммунальные услуги (factura de electricidad/agua/gas — consumo, CUPS, período de facturación), торговая фактура, договор (contrato de suministro, escritura de compraventa), страховой полис, банковская выписка, документ мэрии (Ayuntamiento), налоговый документ (AEAT/Hacienda), коммерческое предложение (presupuesto/oferta), официальное уведомление. Верни ТОЛЬКО JSON, без markdown и комментариев:
{
  "store_name": "краткое название документа/главного контрагента НА ЯЗЫКЕ ОРИГИНАЛА (примеры: Factura electricidad — Plenitude; Contrato de suministro — Plenitude; Escritura de compraventa — Jardines del Duque), БЕЗ перевода",
  "store_name_ru": "перевод store_name на русский",
  "receipt_date": "YYYY-MM-DD — главная дата документа (для счёта — fecha de emisión/factura; для договора — подписание)",
  "receipt_time": null,
  "total_amount": главная сумма ЧИСЛОМ (для счёта — Total factura / importe total; для сделки — precio de compraventa; для полиса — сумма полиса). ВАЖНО: если в документе НЕСКОЛЬКО фактур/накладных (на разных страницах разные номера и итоги — напр. стр.1 factura SF 11267 = 12,20, стр.2 factura SF 11253 = 218,87) — это СУММА итогов всех фактур (231,07), а не только первой, или null,
  "subtotal": null, "tax_amount": null, "tax_rate": null,
  "currency": "EUR",
  "payment_method": null, "country": null,
  "document_type": одно из [bill, invoice, contract, insurance, bank, receipt, municipality, tax, proposal, other] — bill = счёт за электричество/воду/газ/интернет (factura, informe de consumo, CUPS, lecturas); invoice = торговая фактура за товары/услуги; contract = договор/контракт (condiciones generales, contrato); insurance = страховой полис; bank = банковская выписка; receipt = кассовый чек; municipality = документ мэрии (Ayuntamiento: informe urbanístico, licencias, tasas municipales); tax = налоговая (Hacienda/AEAT: IBI, IAE, declaraciones, liquidaciones); proposal = коммерческое предложение (presupuesto, oferta comercial, cotización, proforma — предложение цен, НЕ счёт к оплате); other = прочее,
  "subtype": одно из [electricity, water, gas, internet, phone, comunidad, rent, waste, insurance_home, insurance_car, insurance_health, tax, other] или null,
  "provider": "нотариус / банк / компания-эмитент или null",
  "valid_from": "YYYY-MM-DD или null", "valid_to": "YYYY-MM-DD или null",
  "invoice_number": "номер документа/протокола (número de protocolo); если фактур в документе НЕСКОЛЬКО — ВСЕ их номера через запятую; или null",
  "contract_number": "номер договора или null",
  "supply_address": "ПОЛНЫЙ адрес недвижимости/объекта как напечатан (ищи внимательно: Dirección, Finca, sitio, Calle) или null",
  "cups": null, "meter_number": null, "consumption": null, "consumption_unit": null,
  "object": "Duqe — если адрес содержит Reykjavik; Maria — если Callao; Kit — если Alcojora; иначе null",
  "party_a": "ВЫДАВШИЙ/первая сторона ПОЛНОСТЬЮ одной строкой НА ЯЗЫКЕ ОРИГИНАЛА — название + NIF/CIF + адрес (напр. 'Ilmo. Ayto. de la Villa de Adeje, Servicio Municipal de Suministro de Agua, CALLE HERMANO PEDRO N° 15, 38670 Adeje'): для contract/municipality/bank/tax — arrendador, vendedor, banco, Ayuntamiento; для invoice/bill — emisor/proveedor (кто выставил документ); иначе null",
  "party_b": "ПОЛУЧАТЕЛЬ/вторая сторона ПОЛНОСТЬЮ одной строкой НА ЯЗЫКЕ ОРИГИНАЛА — название + NIF/CIF + адрес (напр. 'RONESIA LIMITED, CL REYKJAVIK 7, FINCA LA QUINTA, 38660 Adeje'): для contract/municipality/bank/tax — arrendatario, comprador, contribuyente; для invoice/bill — cliente/titular (кому выставлен); если в документе нет — null",
  "doc_kind": "для официальных документов: contract (договор), certificate (справка/certificado), power_of_attorney (доверенность/poder), bank_correspondence (письма/выписки банка), gov_correspondence (переписка с госорганами: AEAT, Ayuntamiento, Seguridad Social) — иначе null",
  "summary": "1-2 предложения: о чём документ (предмет договора, сумма, сроки) НА РУССКОМ (названия компаний не переводи) — или null",
  "items": [ПОЗИЦИИ ДОКУМЕНТА. Для receipt/invoice (чек, упрощённая/торговая фактура — ticket, factura simplificada) — КАЖДЫЙ товар из списка покупок СО ВСЕХ СТРАНИЦ, без пропусков (если документ содержит несколько фактур — позиции бери из КАЖДОЙ фактуры, не только с первой страницы!): {"name":"название как напечатано","name_ru":"перевод на русский","quantity":1,"price":цена за единицу ЧИСЛОМ,"total":сумма строки ЧИСЛОМ,"page":НОМЕР СТРАНИЦЫ, где напечатана позиция — по маркеру «СТРАНИЦА N из M» (маркеров нет — 1)}. Строки «Взнос за управление отходами»/RAEE/ecotasa — тоже отдельными позициями со своей суммой. УСЛУГИ — тоже позиции (нотариус: diligencia, certificación, folios, заверения — каждая со своей ценой). Штрихкод/EAN (13 цифр) рядом с товаром — НЕ цена. ЗАПРЕЩЕНО включать в items: строки ИТОГОВ и сводок (SUMA DE BASES, BASE IMPONIBLE, RETENCIÓN, IVA/IGIC, TOTAL A PAGAR, «Общая сумма…») — это не товары; и ЗАПРЕЩЕНЫ позиции-заглушки вида «(Пропущено, не товар)» — не товар просто пропусти, без записи. Поле name_ru ОБЯЗАТЕЛЬНО для каждой позиции (перевод названия на русский). Для bill — строки начислений (ENERGÍA, CARGOS, IGIC...). Для contract/bank/municipality/tax/proposal/other — пустой массив []],
  "raw_text": null, "raw_text_ru": null
}

Текст документа (фрагменты — начало и конец):

${textSample}`;
}

// ========== ГОДОВАЯ ОТЧЁТНОСТЬ (Cuentas Anuales → Registro Mercantil) — v32 ==========
// Детектор пакета годовой отчётности: баланс + отчёт о прибылях/убытках + Registro Mercantil
function looksLikeAnnualAccounts(text) {
  const t = String(text || '');
  let score = 0;
  if (/cuentas\s+anuales/i.test(t)) score += 2;
  if (/registro\s+mercantil/i.test(t)) score += 1;
  if (/balance\s+de\s+situaci[oó]n/i.test(t)) score += 2;
  if (/cuenta\s+de\s+p[ée]rdidas\s+y\s+ganancias/i.test(t)) score += 2;
  if (/casilla\s*(?:n[ºo°]\s*)?\d{4,5}/i.test(t)) score += 1;
  if (/dep[oó]sito\s+de\s+cuentas|formulaci[oó]n\s+de\s+cuentas|memoria\s+abreviada/i.test(t)) score += 1;
  // Маркеры для повторного импорта из Word: сконвертированные таблицы без заголовков форм
  if (/importe\s+neto\s+de\s+la\s+cifra\s+de\s+negocios/i.test(t)) score += 2;
  if (/activo\s+(?:no\s+)?corriente|patrimonio\s+neto/i.test(t)) score += 1;
  if (/gastos\s+de\s+personal|otros\s+gastos\s+de\s+explotaci[oó]n/i.test(t)) score += 1;
  // Modelo 200 (Impuesto sobre Sociedades) — та же механика касилий/таблиц (v33)
  if (/impuesto\s+sobre\s+sociedades/i.test(t)) score += 2;
  if (/modelo\s*200\b/i.test(t)) score += 1;
  return score >= 4;
}

// Выборка страниц с цифрами отчётности: в 20+ страничном пакете баланс и P&L — в середине,
// стандартный сэмпл «начало+конец» их не захватывает
function buildAnnualAccountsSample(pageTexts, maxLen = 22000) {
  // Финансовые листы (баланс/P&L) + идентификационные (IDA: NIF, denominación, domicilio,
  // CNAE, fechas de inicio/cierre) + titular real / presentación — всё нужно в сводке
  const re = /balance|situaci[oó]n|cuenta\s+de\s+p|activo|pasivo|patrimonio|casilla|resultado|ingresos|gastos|acreedores|deudores|efectivo|amortizaci|identificaci[oó]n|denominaci[oó]n|domicilio|cnae|titular\s+real|presentaci[oó]n\s+de\s+cuentas|fecha\s+de\s+(inicio|cierre)|[oó]rgano\s+de\s+administraci|personal\s+asalariado|liquidaci|cuota|base\s+imponible|devolver|ingresar|deducci|devengad|soportad|autoliquidaci/i;
  const picked = pageTexts
    .map((t, i) => ({ t, i }))
    .filter(p => re.test(p.t) && !/^\((ошибка|страница без текста|страница не распознана)/.test(p.t));
  const parts = [];
  let len = 0;
  for (const p of picked) {
    const chunk = `══════ СТРАНИЦА ${p.i + 1} ══════\n${p.t}`;
    if (len + chunk.length > maxLen) {
      const rest = maxLen - len;
      if (rest > 1500) parts.push(chunk.slice(0, rest));
      break;
    }
    parts.push(chunk);
    len += chunk.length;
  }
  if (!parts.length) return pageTexts.join('\n').slice(0, maxLen);
  return parts.join('\n\n');
}

// Промпт структурирования годовой отчётности:
// items = строки отчётности {section, casilla, name (ES), name_ru, total (текущий год), prev_total (прошлый год), text_value}
// + служебные строки section="ΣBANK" — ключевые итоги для сверки с банком на фронтенде
function buildAnnualAccountsPrompt(textSample) {
  return `Ты анализируешь пакет ГОДОВОЙ ОТЧЁТНОСТИ испанской компании (Cuentas Anuales для Registro Mercantil): идентификационные листы (IDA), Balance de Situación (баланс), Cuenta de Pérdidas y Ganancias (отчёт о прибылях и убытках). Это также может быть налоговая декларация MODELO 200 (Impuesto sobre Sociedades) — её страницы «Cuenta de pérdidas y ganancias» с касилиями вида 00255 разбирай так же (section "PA"; страницы liquidación — section "LIQ"; в store_name укажи "Modelo 200 {год} — {compañía}"). Текст получен OCR и может содержать ошибки — восстанавливай смысл, игнорируй дубликаты.
Верни ТОЛЬКО JSON, без markdown и комментариев.

ПРАВИЛА:
1. Каждая строка баланса и P&L — объект в items: section ("BA" — баланс, "PA" — прибыли/убытки), casilla (официальный номер касильи как напечатан, например "40100"; если номера нет — null), name (название статьи НА ИСПАНСКОМ как напечатано), name_ru (точный перевод на русский), total (сумма ТЕКУЩЕГО ejercicio ЧИСЛОМ, отрицательные — со знаком минус), prev_total (сумма ПРЕДЫДУЩЕГО ejercicio или null).
2. Идентификационные данные — строки с section "IDA": denominación social, NIF, domicilio social, CNAE, fecha de cierre, titular real — значение в text_value (total/prev_total = null).
3. В КОНЦЕ items добавь служебные строки section "ΣBANK" (для сверки с банком) — name строго из списка:
   "ejercicio" (отчётный год числом, prev_total — прошлый год), "ingresos" (casilla 40100 Importe neto cifra de negocios), "gastos_explotacion" (сумма расходов ПО МОДУЛЮ: gastos de personal + otros gastos de explotación + amortización), "resultado" (casilla 49500 Resultado del ejercicio), "efectivo" (casilla 12700 Efectivo y otros activos líquidos), "total_activo", "patrimonio_neto", "acreedores_comerciales", "deudores_comerciales". prev_total — значение прошлого года или null.
4. Испанский формат чисел: 602.122,09 → 602122.09; минус в отчётности может стоять в скобках или после числа.
5. store_name — "Cuentas Anuales {год} — {denominación}" (язык оригинала), store_name_ru — перевод. receipt_date — fecha de cierre (YYYY-MM-DD). total_amount — Resultado del ejercicio (число со знаком). valid_from/valid_to — начало и конец ejercicio. invoice_number — NIF компании. supply_address — domicilio social. provider — presentante/asesor или null.
6. document_type — СТРОГО "annual_accounts".

Верни ТОЛЬКО JSON:
{
  "store_name": "Cuentas Anuales 2025 — ISERA 2020, S.L.",
  "store_name_ru": "Годовая отчётность 2025 — ISERA 2020, S.L.",
  "receipt_date": "2025-12-31",
  "receipt_time": null,
  "total_amount": 75451.42,
  "subtotal": null, "tax_amount": null, "tax_rate": null,
  "currency": "EUR",
  "payment_method": null, "country": "Spain",
  "document_type": "annual_accounts",
  "subtype": null,
  "provider": null,
  "valid_from": "2025-01-01",
  "valid_to": "2025-12-31",
  "invoice_number": "B76825199",
  "contract_number": null,
  "supply_address": "SAN CLEMENTE 24 PLANTA 5 PUERTA A, Santa Cruz de Tenerife",
  "cups": null, "meter_number": null, "consumption": null, "consumption_unit": null,
  "object": null,
  "items": [
    { "section": "IDA", "casilla": null, "name": "Denominación social", "name_ru": "Название общества", "total": null, "prev_total": null, "text_value": "ISERA 2020, S.L." },
    { "section": "BA", "casilla": "12700", "name": "Efectivo y otros activos líquidos equivalentes", "name_ru": "Денежные средства и прочие ликвидные активы", "total": 54848.49, "prev_total": 22537.06, "text_value": null },
    { "section": "PA", "casilla": "40100", "name": "Importe neto de la cifra de negocios", "name_ru": "Чистая выручка от реализации", "total": 602122.09, "prev_total": 417510.50, "text_value": null },
    { "section": "ΣBANK", "casilla": "Σ", "name": "ingresos", "name_ru": "Доходы (сверка с банком)", "total": 602122.09, "prev_total": 417510.50, "text_value": null }
  ]
}

Текст отчётности (выборка страниц с цифрами):

${textSample}`;
}

// Страница является таблицей официальной формы (баланс / P&L), а не текстовым листом (IDA/TR)
function looksLikeFormTablePage(t) {
  const s = String(t || '');
  if (/^\((ошибка|страница без текста|страница не распознана)/.test(s)) return false;
  let score = 0;
  if (/balance\s+de\s+situaci[oó]n/i.test(s)) score += 3;
  if (/cuenta\s+de\s+p[ée]rdidas\s+y\s+ganancias/i.test(s)) score += 3;
  if (/activo\s+(?:no\s+)?corriente|patrimonio\s+neto\s+y\s+pasivo/i.test(s)) score += 2;
  if (/ejercicio\s+20\d{2}/i.test(s) && /\d{1,3}(?:\.\d{3})+,\d{2}/.test(s)) score += 2;
  if ((s.match(/\b\d{5}\b/g) || []).length >= 3) score += 2; // номера касилий
  return score >= 3;
}

// v32.1 (идея пользователя): СНАЧАЛА конвертируем разваленную OCR-таблицу формы в чистую
// Markdown-таблицу (структура!), потом переводим и разбираем ПОСТРОЧНО — перевод таблицы
// уже не рассыпается, а касильи извлекаются точнее
function buildFormTablePrompt(text) {
  return `Это OCR-текст ОДНОЙ страницы официальной испанской отчётной формы (Balance de Situación / Cuenta de Pérdidas y Ganancias). Таблица в тексте развалена: названия статей, номера касилий (5 цифр) и суммы двух лет идут не по строкам.
ЗАДАЧА: восстанови таблицу и верни её в формате Markdown.
ПРАВИЛА:
1. Сначала — шапка формы строками «Ключ: значение» (NIF, Denominación social, Unidad, код листа BA1/BA2.1/BA2.2/PA — если есть на странице).
2. Затем ОДНА Markdown-таблица: | Casilla | Partida | Notas | Ejercicio 20XX | Ejercicio 20YY | — года возьми из заголовков страницы; если столбца «Notas de la memoria» нет или он везде пуст — не добавляй его.
3. Каждая строка формы = одна строка таблицы: название статьи ТОЛЬКО на испанском как напечатано (НЕ переводи), номер касильи, суммы в испанском формате как напечатано (602.122,09; отрицательные со знаком минус).
4. Многострочные названия собери в одну строку; суммы привяжи к правильной строке по смыслу (иерархия A), B), I., II., 1., 2., a), b)...).
5. Промежуточные и итоговые строки (TOTAL ACTIVO, PATRIMONIO NETO, RESULTADO DE EXPLOTACIÓN, RESULTADO DEL EJERCICIO...) — обязательно включи с их касилиями.
6. Ничего не выдумывай: значение не читается — ячейка пустая. Точечные заполнители (........) выбрось.
7. Верни ТОЛЬКО шапку и таблицу, без пояснений и ограждающих \`\`\`.

ТЕКСТ СТРАНИЦЫ:
"""
${text}
"""`;
}

// Страховка: если модель не вернула строки ΣBANK — выводим их из распознанных касилий/названий
function ensureAnnualBankSummary(items) {
  if (!Array.isArray(items) || !items.length) return items;
  if (items.some(it => it.section === 'ΣBANK')) return items;
  const num = v => (typeof v === 'number' && !isNaN(v)) ? v : null;
  const byCasilla = {};
  const byName = [];
  for (const it of items) {
    if (it.casilla) byCasilla[String(it.casilla)] = it;
    byName.push(it);
  }
  const findByName = re => byName.find(it => re.test(String(it.name || '')));
  const row = (name, name_ru, src, extra) => {
    const total = num(src && src.total);
    if (total == null) return null;
    return { section: 'ΣBANK', casilla: 'Σ', name, name_ru, total, prev_total: num(src && src.prev_total), text_value: null, ...extra };
  };
  const gastosParts = ['40600', '40700', '40800'].map(c => num(byCasilla[c] && byCasilla[c].total)).filter(v => v != null);
  const gastosPrevParts = ['40600', '40700', '40800'].map(c => num(byCasilla[c] && byCasilla[c].prev_total)).filter(v => v != null);
  const ejercicioYear = (() => {
    const m = String(items.map(i => i.name).join(' ')).match(/20\d{2}/);
    return m ? parseInt(m[0], 10) : null;
  })();
  const derived = [
    ejercicioYear ? { section: 'ΣBANK', casilla: 'Σ', name: 'ejercicio', name_ru: 'Отчётный год', total: ejercicioYear, prev_total: ejercicioYear - 1, text_value: null } : null,
    row('ingresos', 'Доходы (сверка с банком)', byCasilla['40100'] || findByName(/cifra\s+de\s+negocios/i)),
    gastosParts.length ? { section: 'ΣBANK', casilla: 'Σ', name: 'gastos_explotacion', name_ru: 'Расходы (сверка с банком)', total: gastosParts.reduce((a, b) => a + Math.abs(b), 0), prev_total: gastosPrevParts.length ? gastosPrevParts.reduce((a, b) => a + Math.abs(b), 0) : null, text_value: null } : null,
    row('resultado', 'Результат года', byCasilla['49500'] || findByName(/resultado\s+del\s+ejercicio/i)),
    row('efectivo', 'Остаток денежных средств', byCasilla['12700'] || findByName(/efectivo/i)),
    row('total_activo', 'Итого активов', findByName(/total\s+activo/i)),
    row('patrimonio_neto', 'Собственный капитал', findByName(/patrimonio\s+neto/i)),
    row('acreedores_comerciales', 'Кредиторская задолженность', findByName(/acreedores\s+comerciales/i)),
    row('deudores_comerciales', 'Дебиторская задолженность', findByName(/deudores\s+comerciales/i))
  ].filter(Boolean);
  return derived.length ? [...items, ...derived] : items;
}

// ========== ЗАПОЛНЕННЫЕ НАЛОГОВЫЕ ФОРМЫ (AEAT / Agencia Tributaria Canaria) — v34 ==========
// Modelo 303 (IVA), 130/131 (IRPF), 111/115 (retenciones), 190/347/349/390 (resúmenes),
// IGIC 400/415/420/425 и т.п. Годовая отчётность и Modelo 200 — НЕ сюда (они annual_accounts).
function looksLikeTaxForm(text) {
  const t = String(text || '');
  let score = 0;
  if (/agencia\s+(?:estatal\s+de\s+)?(?:administraci[oó]n\s+)?tributaria|\bAEAT\b|hacienda\s+(?:estatal|canaria)|administraci[oó]n\s+de\s+hacienda/i.test(t)) score += 2;
  if (/\bmodelo\s*(?:n[ºo°]\s*)?\d{3}\b/i.test(t)) score += 2;
  if (/autoliquidaci[oó]n|declaraci[oó]n\s+(?:trimestral|anual|informativa|resumen)|liquidaci[oó]n\s+(?:del\s+)?impuesto/i.test(t)) score += 2;
  if (/\bIVA\b|valor\s+a[ñn]adido|\bIGIC\b|\bIRPF\b|retenciones?\s+(?:a\s+)?cuenta/i.test(t)) score += 1;
  if (/casilla\s*(?:n[ºo°]\s*)?\d{1,5}|\[\s*\d{1,4}\s*\]/i.test(t)) score += 1;
  if (/ejercicio\s*[:]?\s*20\d{2}|per[ií]odo\s*[:]?\s*(?:[1-4]T|0[1-9]|1[0-2])/i.test(t)) score += 1;
  if (/a\s+ingresar|a\s+devolver|a\s+compensar|cuota\s+(?:a\s+ingresar|devengada|soportada|deducible)/i.test(t)) score += 1;
  return score >= 4;
}

// Номер modelo из текста формы («Modelo 303», «MOD. 400»)
function extractModeloNumber(text) {
  const s = String(text || '');
  const m = /\bmodelo\s*(?:n[ºo°]\s*)?(\d{3})\b/i.exec(s) || /\bmod\.?\s*(\d{3})\b/i.exec(s);
  return m ? m[1] : null;
}

// Промпт структурирования налоговой формы: items = касильи {section DATOS/LIQ/RES, casilla,
// name (ES), name_ru, total, text_value} + служебные ΣBANK-строки для сверки платежа с банком
function buildTaxFormPrompt(textSample) {
  return `Ты анализируешь ЗАПОЛНЕННУЮ НАЛОГОВУЮ ФОРМУ Испании/Канарских островов (AEAT или Agencia Tributaria Canaria): Modelo 303 (IVA), 130/131 (IRPF pagos fraccionados), 111/115 (retenciones), 190/347/349/390 (declaraciones informativas/resumen anual), IGIC Modelo 400/415/420/425 и подобные — autoliquidación/declaración с касильями. Текст получен OCR и может содержать ошибки — восстанавливай смысл, игнорируй дубликаты.
Верни ТОЛЬКО JSON, без markdown и комментариев.

ПРАВИЛА:
1. Каждая ЗАПОЛНЕННАЯ касилья/строка — объект в items: section ("DATOS" — идентификация declarante и período; "LIQ" — devengación, deducciones, liquidación; "RES" — resultado), casilla (номер как напечатан; нет номера — null), name (название НА ИСПАНСКОМ как напечатано, НЕ переводи), name_ru (точный перевод), total (значение ЧИСЛОМ: суммы в евро со знаком; проценты — числом; пустые касильи НЕ включай), prev_total — null, text_value — текстовое значение (NIF, apellidos y nombre, denominación, período) вместо total.
2. В КОНЦЕ items добавь служебные строки section "ΣBANK" (для сверки платежа налога с банком) — name строго из списка: "ejercicio" (год числом), "base_imponible" (сумма баз, если есть), "cuota" (cuota devengada / a deducir — итог расчёта до resultado), "resultado" (resultado de la autoliquidación: a ingresar — со знаком ПЛЮС, a devolver/compensar — со знаком МИНУС).
3. Испанский формат чисел: 1.234,56 → 1234.56; минус может стоять в скобках или после числа.
4. store_name — "Modelo {NNN} {ejercicio} {período} — {apellidos y nombre / denominación}" (язык оригинала), store_name_ru — перевод. receipt_date — fecha de presentación, иначе последний день período (YYYY-MM-DD). total_amount — resultado (число со знаком). invoice_number — NIF declarante. valid_from/valid_to — начало и конец período. provider — "AEAT" или "Agencia Tributaria Canaria".
5. document_type — СТРОГО "tax_form". subtype — "tax".

Верни ТОЛЬКО JSON:
{
  "store_name": "Modelo 303 2026 1T — ISERA 2020, S.L.",
  "store_name_ru": "Форма 303 (НДС) 2026, 1 квартал — ISERA 2020, S.L.",
  "receipt_date": "2026-04-20",
  "receipt_time": null,
  "total_amount": 1234.56,
  "subtotal": null, "tax_amount": null, "tax_rate": null,
  "currency": "EUR",
  "payment_method": null, "country": "Spain",
  "document_type": "tax_form",
  "subtype": "tax",
  "provider": "AEAT",
  "valid_from": "2026-01-01",
  "valid_to": "2026-03-31",
  "invoice_number": "B76825199",
  "contract_number": null,
  "supply_address": null,
  "cups": null, "meter_number": null, "consumption": null, "consumption_unit": null,
  "object": null,
  "items": [
    { "section": "DATOS", "casilla": null, "name": "NIF del declarante", "name_ru": "NIF декларанта", "total": null, "prev_total": null, "text_value": "B76825199" },
    { "section": "LIQ", "casilla": "01", "name": "Base imponible — IVA devengado", "name_ru": "Налоговая база — начисленный НДС", "total": 602122.09, "prev_total": null, "text_value": null },
    { "section": "RES", "casilla": "71", "name": "Resultado — a ingresar", "name_ru": "Результат — к уплате", "total": 1234.56, "prev_total": null, "text_value": null },
    { "section": "ΣBANK", "casilla": "Σ", "name": "resultado", "name_ru": "Результат декларации (сверка с банком)", "total": 1234.56, "prev_total": null, "text_value": null }
  ]
}

Текст формы (выборка страниц):

${textSample}`;
}

// Страховка для налоговых форм: если модель не вернула ΣBANK — минимум год и resultado
function ensureTaxFormBankSummary(items, data) {
  if (!Array.isArray(items)) items = [];
  if (items.some(it => it && it.section === 'ΣBANK')) return items;
  const rows = [];
  const src = [...items.map(i => String((i && i.name) || '')), String((data && data.store_name) || '')].join(' ');
  const ym = src.match(/20\d{2}/);
  if (ym) rows.push({ section: 'ΣBANK', casilla: 'Σ', name: 'ejercicio', name_ru: 'Налоговый год', total: parseInt(ym[0], 10), prev_total: null, text_value: null });
  if (data && typeof data.total_amount === 'number') {
    rows.push({ section: 'ΣBANK', casilla: 'Σ', name: 'resultado', name_ru: 'Результат декларации (к уплате + / к возврату −)', total: data.total_amount, prev_total: null, text_value: null });
  }
  return rows.length ? [...items, ...rows] : items;
}

// ========== ПОСТРАНИЧНОЕ ХРАНЕНИЕ document_pages (v33) ==========
// Отдельная таблица: оригинал OCR/vision, рабочий текст (после конвертации в таблицу),
// перевод — для каждой страницы. Позволяет переводить/перестраивать карточку БЕЗ повторного OCR.
// Таблица создаётся миграцией v22; если её ещё нет — просто пропускаем (best-effort).
let documentPagesAvailable = null; // null = не проверяли; false = таблицы нет (миграция не выполнена)

// raw_text → [{num, text}] по маркерам «══════ СТРАНИЦА N из M ══════»
function splitRawPages(rawText) {
  const s = String(rawText || '');
  if (!s.trim()) return [];
  const re = /^══════ СТРАНИЦА (\d+) из (\d+) ══════\s*$/gm;
  const marks = [];
  let m;
  while ((m = re.exec(s)) !== null) marks.push({ num: parseInt(m[1], 10), idx: m.index, end: m.index + m[0].length });
  if (!marks.length) return [{ num: 1, text: s.trim() }];
  return marks.map((mk, i) => ({
    num: mk.num,
    text: s.slice(mk.end, i + 1 < marks.length ? marks[i + 1].idx : s.length).trim()
  }));
}

async function saveDocumentPages(receiptId, receiptData) {
  if (documentPagesAvailable === false) return;
  const workPages = splitRawPages(receiptData.raw_text);
  if (!workPages.length) return;
  const rawPages = Array.isArray(receiptData._pagesRaw) ? receiptData._pagesRaw : [];
  const ruPages = splitRawPages(receiptData.raw_text_ru);
  const ruByNum = {};
  ruPages.forEach(p => { ruByNum[p.num] = p.text; });
  const rows = workPages.map((p, i) => ({
    receipt_id: receiptId,
    page_num: p.num,
    page_kind: looksLikeFormTablePage(p.text) ? 'form_table' : (looksLikeEmptySkeleton(p.text) ? 'empty' : 'text'),
    page_text_raw: rawPages[i] || null,
    page_text: p.text,
    page_text_ru: ruByNum[p.num] || null
  }));
  const { error } = await supabaseAdmin.from('document_pages').upsert(rows, { onConflict: 'receipt_id,page_num' });
  if (error) {
    documentPagesAvailable = false;
    console.warn('document_pages недоступна (выполните supabase-migration-v22.sql):', error.message);
    return;
  }
  documentPagesAvailable = true;
  console.log(`document_pages: сохранено ${rows.length} стр. для receipt ${receiptId}`);
}

// ========== ДЕТАЛЬНЫЕ ТАБЛИЦЫ ПО ТИПАМ ДОКУМЕНТОВ (v34, миграция v23) ==========
// 1) чеки/фактуры — receipts (уже есть); 2) договоры/справки/доверенности/переписка —
// contract_documents; 3) коммерческие предложения — proposals; 4) налоговые формы —
// tax_forms. Все строки связаны receipt_id → receipts(id) ON DELETE CASCADE.
// Запись best-effort: таблицы нет (миграция не выполнена) — одно предупреждение, дальше пропуск.
const detailTablesAvailable = {}; // table -> false, когда таблицы нет в БД

async function upsertDetail(table, row) {
  if (detailTablesAvailable[table] === false) return;
  const { error } = await supabaseAdmin.from(table).upsert(row, { onConflict: 'receipt_id' });
  if (error) {
    detailTablesAvailable[table] = false;
    console.warn(`${table} недоступна (выполните supabase-migration-v23.sql):`, error.message);
  }
}

async function saveDocumentDetails(receiptId, d) {
  if (!d || typeof d !== 'object') return;
  const dt = d.document_type;
  // 2) Договоры, справки, доверенности, переписка с банками/госорганами
  const KIND_BY_TYPE = { contract: 'contract', municipality: 'gov_correspondence', bank: 'bank_correspondence', tax: 'gov_correspondence' };
  const kind = d.doc_kind || KIND_BY_TYPE[dt] || null;
  if (kind) {
    await upsertDetail('contract_documents', {
      receipt_id: receiptId,
      doc_kind: kind,
      title: d.store_name || null,
      party_a: d.party_a || null,
      party_b: d.party_b || null,
      doc_date: d.receipt_date || null,
      valid_from: d.valid_from || null,
      valid_until: d.valid_to || null,
      summary: d.summary || null,
      summary_ru: d.store_name_ru || null
    });
  }
  // 3) Коммерческие предложения (presupuesto/oferta/cotización)
  if (dt === 'proposal') {
    await upsertDetail('proposals', {
      receipt_id: receiptId,
      vendor_name: d.store_name || null,
      vendor_nif: d.invoice_number || null,
      proposal_number: d.contract_number || d.invoice_number || null,
      proposal_date: d.receipt_date || null,
      valid_until: d.valid_to || null,
      total: (typeof d.total_amount === 'number') ? d.total_amount : null,
      currency: d.currency || 'EUR',
      notes: d.summary || null
    });
  }
  // 4) Налоговые формы и годовая отчётность: касильи + итоги для сверки
  if (dt === 'tax_form' || dt === 'annual_accounts') {
    const items = Array.isArray(d.items) ? d.items : [];
    const casillas = items
      .filter(it => it && it.section !== 'ΣBANK' && (it.casilla || it.text_value))
      .map(it => ({
        section: it.section || null,
        casilla: it.casilla != null ? String(it.casilla) : null,
        name: it.name || null,
        name_ru: it.name_ru || null,
        value: (typeof it.total === 'number') ? it.total : null,
        prev_value: (typeof it.prev_total === 'number') ? it.prev_total : null,
        text_value: it.text_value || null
      }));
    const totals = {};
    for (const it of items) {
      if (it && it.section === 'ΣBANK' && it.name) totals[it.name] = (typeof it.total === 'number') ? it.total : null;
    }
    const modelo = extractModeloNumber(d.store_name) || extractModeloNumber(String(d.raw_text || '').slice(0, 6000));
    const ym = /(20\d{2})/.exec(d.store_name || '') || /(20\d{2})/.exec(d.receipt_date || '');
    await upsertDetail('tax_forms', {
      receipt_id: receiptId,
      modelo: modelo || (dt === 'annual_accounts' ? 'CUENTAS' : null),
      ejercicio: ym ? Number(ym[1]) : null,
      periodo: (() => { const pm = /([1-4]T|0[1-9]|1[0-2])\b/.exec(d.store_name || ''); return pm ? pm[1] : null; })(),
      taxpayer_nif: d.invoice_number || null,
      taxpayer_name: d.store_name || null,
      casillas,
      totals
    });
  }
}

// Разбор суммы в европейском/русском формате: "60 736,00" | "60.736,00" | "60,736.00" | "60736"
function parseAmountLike(s) {
  if (!s) return null;
  let t = String(s).replace(/[\s ]/g, '');
  const lastDot = t.lastIndexOf('.'), lastComma = t.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastComma > lastDot) t = t.replace(/\./g, '').replace(',', '.'); // 60.736,00
    else t = t.replace(/,/g, ''); // 60,736.00
  } else if (lastComma >= 0) {
    const dec = t.length - lastComma - 1;
    t = dec <= 2 ? t.replace(',', '.') : t.replace(/,/g, ''); // 60736,00 — десятичная; 60,736 — тысячи
  }
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
}

// ========== WORD/ТЕКСТ как источник распознавания (v32.3) ==========
// Цепочка пользователя: PDF → экспорт в Word из карточки → правка в Word → загрузка Word →
// распознавание ИЗ ТЕКСТА (без OCR) → представление в HTML. Поддержка: .txt, .doc/.htm (это HTML
// Word — таблицы превращаем обратно в Markdown-строки), .docx (zip: читаем word/document.xml
// через встроенный zlib — новых зависимостей не нужно).
function decodeHtmlEntities(s) {
  return String(s)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ''; } });
}

// HTML (Word MIME .doc / .htm) → текст; таблицы → Markdown-строки "| a | b | c |"
function htmlToTextWithTables(html) {
  let t = String(html);
  t = t.replace(/<!--[\s\S]*?-->/g, ' ');
  t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ');
  t = t.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  t = t.replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, ' | ');
  t = t.replace(/<\/t[dh]>/gi, ' |');
  t = t.replace(/<\/tr>/gi, '\n');
  t = t.replace(/<\/(p|div|h[1-6]|table|li|tr)>/gi, '\n');
  t = t.replace(/<[^>]+>/g, '');
  t = decodeHtmlEntities(t);
  t = t.split('\n').map(line => {
    const l = line.replace(/\s+/g, ' ').trim();
    if (!l) return '';
    if (l.includes('|') && !l.startsWith('|')) return '| ' + l;
    return l;
  }).join('\n');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

// .docx — ZIP-архив: ищем word/document.xml по центральному каталогу, распаковываем deflate
// через Node zlib; XML Word → текст с Markdown-строками таблиц
function extractTextFromDocx(buffer) {
  const zlib = require('zlib');
  let eocd = -1; // End Of Central Directory — с конца файла
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65558); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const cdCount = buffer.readUInt16LE(eocd + 10);
  let cdOff = buffer.readUInt32LE(eocd + 16);
  for (let n = 0; n < cdCount && cdOff + 46 <= buffer.length; n++) {
    if (buffer.readUInt32LE(cdOff) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(cdOff + 10);
    const compSize = buffer.readUInt32LE(cdOff + 20);
    const nameLen = buffer.readUInt16LE(cdOff + 28);
    const extraLen = buffer.readUInt16LE(cdOff + 30);
    const commentLen = buffer.readUInt16LE(cdOff + 32);
    const localOff = buffer.readUInt32LE(cdOff + 42);
    const name = buffer.slice(cdOff + 46, cdOff + 46 + nameLen).toString('utf8');
    cdOff += 46 + nameLen + extraLen + commentLen;
    if (!/word\/document\.xml$/i.test(name)) continue;
    if (buffer.readUInt32LE(localOff) !== 0x04034b50) return null;
    const lNameLen = buffer.readUInt16LE(localOff + 26);
    const lExtraLen = buffer.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = buffer.slice(dataStart, dataStart + compSize);
    let xml = null;
    try {
      xml = method === 8 ? zlib.inflateRawSync(comp).toString('utf8')
        : method === 0 ? comp.toString('utf8') : null;
    } catch (e) { return null; }
    if (!xml) return null;
    let t = xml;
    t = t.replace(/<w:tab[^>]*\/>/gi, ' ');
    t = t.replace(/<w:br[^>]*\/>/gi, '\n');
    // Сначала таблицы: конец параграфа ВНУТРИ ячейки — не перенос строки, иначе
    // каждая ячейка уедет на свою строку и таблица развалится
    t = t.replace(/<\/w:p>(?=<\/w:tc>)/gi, '');
    t = t.replace(/<\/w:tc>\s*<w:tc[^>]*>/gi, ' | ');
    t = t.replace(/<\/w:tc>/gi, ' |');
    t = t.replace(/<\/w:tr>/gi, '\n');
    t = t.replace(/<\/w:p>/gi, '\n');
    t = t.replace(/<[^>]+>/g, '');
    t = decodeHtmlEntities(t);
    return t.split('\n').map(line => {
      const l = line.replace(/[ \t]+/g, ' ').trim();
      if (!l) return '';
      if (l.includes('|') && !l.startsWith('|')) return '| ' + l;
      return l;
    }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  return null;
}

// Файл Word/текста → массив текстов страниц (деление по маркерам нашего экспорта
// «══════ СТРАНИЦА N из M ══════»; без маркеров — одна страница)
async function extractPageTextsFromWordFile(buffer, filename) {
  const ext = (String(filename || '').match(/\.([^.]+)$/) || [null, ''])[1].toLowerCase();
  let text = null;
  if (ext === 'docx') {
    try { text = extractTextFromDocx(buffer); } catch (e) { console.error('DOCX parse:', e.message); }
    if (!text) throw new Error('Не удалось прочитать .docx (файл повреждён или нестандартный архив)');
  } else {
    const raw = buffer.toString('utf8').replace(/^﻿/, '');
    text = /<html|<table|<w:|<meta\s/i.test(raw) ? htmlToTextWithTables(raw) : raw.trim();
  }
  if (!text || text.trim().length < 10) return [];
  // Служебная строка-инструкция нашего Word-экспорта (v32.3) — не часть документа, вычищаем
  text = text.replace(/^Текст, восстановленный распознаванием\..*$/gim, '').replace(/\n{3,}/g, '\n\n');
  const re = /[═=]{3,}\s*СТРАНИЦА\s+\d+\s+из\s+\d+\s*[═=]{3,}/gi;
  const marks = [];
  let m;
  while ((m = re.exec(text)) !== null) marks.push({ idx: m.index, end: m.index + m[0].length });
  if (!marks.length) return [text.trim()];
  const pages = [];
  for (let i = 0; i < marks.length; i++) {
    const body = text.slice(marks[i].end, i + 1 < marks.length ? marks[i + 1].idx : text.length).trim();
    if (body) pages.push(body);
  }
  // Преамбула до первого маркера (заголовок документа: «CUENTAS ANUALES … REGISTRO MERCANTIL») —
  // важна для детектора типа: дописываем в начало первой страницы
  const preamble = text.slice(0, marks[0].idx).trim();
  if (preamble && pages.length) pages[0] = preamble + '\n' + pages[0];
  return pages.length ? pages : [text.trim()];
}

// Маршрутизация по текстам страниц: 3+ страниц — документный конвейер;
// 1-2 страницы — чековая схема, КРОМЕ годовой отчётности и налоговых форм (v34):
// короткие формы (Modelo 130/303 на 1-2 стр.) тоже идут документным конвейером с касильями
function shouldUseDocumentPipeline(pageTexts) {
  if (pageTexts.length > 2) return true;
  const joined = pageTexts.join('\n').slice(0, 40000);
  return looksLikeAnnualAccounts(joined) || looksLikeTaxForm(joined);
}

// Сборка документа из готовых текстов страниц: перевод по страницам + модули + JSON-сводка
// ========== v54.2: строгий фолбэк извлечения ПОЗИЦИЙ чека из текста ==========
// Когда LLM вернул items: [] при явном списке товаров в тексте (Mac OCR и др.).
// Механический разбор: строка, оканчивающаяся ценой («34,99» / «5.95»), — позиция;
// название — текст той же строки (без EAN-штрихкода) + предшествующие текстовые строки.
function extractItemsFallback(rawText) {
  const lines = String(rawText || '').split('\n').map(l => l.trim()).filter(Boolean);
  const items = [];
  const priceRe = /(?:^|\s)(\d{1,6}[.,]\d{2})\s*€?\s*$/;
  const skipLine = /^(={3,}|[-–—_*]{3,}|📑|страница\s|p[aá]gina|итого|total\b|подытог|subtotal|оплата|pago\b|tarjeta|карта|наличн|efectivo|сдача|cambio|entregado|ндс|iva\b|igic|base imponible|cuota)/i;
  const notName = /итого|total|iva|igic|fecha|дата|^чек|ticket|фактур|factura|simplificada|касс|cajero|documento|\bcif\b|\bnif\b|инн|^\d{8,14}$/i;
  let pendingName = null;
  let curPage = 1; // v56.5: страница позиции — по маркерам «СТРАНИЦА N из M» в тексте
  for (const line of lines) {
    const pm = line.match(/^═{2,}\s*СТРАНИЦА\s+(\d+)\s+из\s+\d+/);
    if (pm) { curPage = parseInt(pm[1], 10) || curPage; pendingName = null; continue; }
    if (skipLine.test(line)) { pendingName = null; continue; }
    const m = line.match(priceRe);
    if (m) {
      const price = parseAmountLike(m[1]);
      const namePart = line.slice(0, m.index).replace(/\b\d{8,14}\b/g, '').replace(/\s{2,}/g, ' ').trim();
      let name = [pendingName, namePart].filter(Boolean).join(' ').replace(/\s{2,}/g, ' ').trim();
      pendingName = null;
      if (price == null || price <= 0 || price >= 1e6) continue;
      if (name.length < 3) name = namePart.length >= 3 ? namePart : null;
      if (!name || name.length < 3) continue;
      // v56.2: строка итогов «11,40 7,00 0,80 → 12,20» — не товар: в названии должна быть буква
      if (!/[a-zа-яёáéíóúñü]/i.test(name)) continue;
      if (notName.test(name) && name.length < 12) continue;
      items.push({ name: name.slice(0, 120), name_ru: null, quantity: 1, price, total: price, page: curPage });
    } else if (notName.test(line) || !/[a-zа-яёáéíóúñü]/i.test(line) || line.length < 4) {
      pendingName = null; // служебная/не текстовая строка — разделитель, шапку в название не тянем
    } else {
      // текстовая строка — кандидат в название следующей ценовой строки (склеиваем до 2 строк)
      pendingName = pendingName ? (pendingName + ' ' + line).slice(0, 140) : line;
    }
  }
  return items.slice(0, 150);
}

// v54.3: пакетный перевод названий позиций фолбэк-парсера (name_ru) — одним вызовом
async function translateItemNames(items) {
  if (!Array.isArray(items) || !items.length) return;
  try {
    const list = items.map((it, i) => `${i + 1}. ${it.name}`).join('\n');
    const ru = String(await callTextChain(
      `Переведи на русский названия товаров из чека (стройматериалы, товары для дома, продукты). ` +
      `Верни ТОЛЬКО переведённые строки: тот же порядок и нумерация («1. …»), без пояснений, названия кратко.\n${list}`
    ) || '');
    const map = new Map();
    ru.split('\n').forEach(l => {
      const m = l.match(/^\s*(\d+)[.)]\s*(.+)$/);
      if (m) map.set(Number(m[1]), m[2].trim());
    });
    items.forEach((it, i) => { const v = map.get(i + 1); if (v) it.name_ru = v.slice(0, 140); });
  } catch (e) {
    console.warn('v54.3: перевод позиций фолбэка не удался (не критично):', e.message);
  }
}

// ========== v53: пост-контроль валюты и итога по тексту документа ==========
// 1) Испанская фактура/адрес (€, CIF/NIF, IGIC/IVA, FACTURA, испанские города) → валюта EUR.
// 2) Контроль итога: LLM иногда обрезает тысячи («1.171,27 €» → 1.17) или путает валюту.
//    Ищем суммы у слов TOTAL/IMPORTE/ИТОГО прямо в тексте (европейский формат) и сверяем
//    контрольной суммой по строчкам (Σ items): сошлась с текстовым кандидатом → доверяем ему.
//    Также чиним масштаб 1:1000 и сильное занижение (итог < 1% от максимальной суммы документа).
// 3) Фолбэк даты: «9 de febrero de 2024» (исп. месяцы) и «Fecha … 09/02/2024».
function enforceCurrencyAndTotal(data, rawText) {
  if (!data || typeof data !== 'object') return data;
  const text = String(rawText || '');
  const looksSpanish = /€|\bCIF\b|\bNIF\b|\bIGIC\b|\bIVA\b|FACTURA|ESPAÑA|ESPANA|TENERIFE|SANTA CRUZ|ADEJE|MADRID|BARCELONA/i.test(text);
  if (looksSpanish && data.currency !== 'EUR') {
    if (data.currency) console.log(`v53: валюта ${data.currency} → EUR (признаки Испании в тексте)`);
    data.currency = 'EUR';
  }

  // Кандидаты итога из текста: «TOTAL A PAGAR 1.171,27 €», «Итого: …»
  const candidates = [];
  const re = /(?:total\s*a\s*pagar|total\s*importe\s*factura|importe\s*total|total\s*factura|итого|всего\s+к\s+оплате|total)\D{0,30}?(\d{1,3}(?:[. ]\d{3})+,\d{2}|\d+,\d{2}|\d+\.\d{2})/gi;
  let m;
  while ((m = re.exec(text)) !== null && candidates.length < 40) {
    const n = parseAmountLike(m[1]);
    if (n != null && n > 0 && n < 1e9) candidates.push(n);
  }
  const best = candidates.length ? Math.max(...candidates) : null; // итог фактуры — обычно самая крупная сумма
  const itemsSum = Array.isArray(data.items)
    ? data.items.reduce((sum, it) => sum + (Number(it && it.total) || 0), 0)
    : 0;
  const total = data.total_amount != null ? Number(data.total_amount) : null;
  const close = (a, b, pct) => a != null && b != null && b !== 0 && Math.abs(a - b) / b <= pct;

  if (best != null) {
    const itemsBackBest = itemsSum > 0 && close(itemsSum, best, 0.02); // контрольная сумма по строкам сошлась
    const scaleBug = total != null && (close(total * 1000, best, 0.02) || close(total, best * 1000, 0.02));
    const mismatch = total == null || (!close(total, best, 0.005) && (itemsBackBest || scaleBug || total < best / 100));
    if (mismatch) {
      console.log(`v53: итог ${total} → ${best} (${itemsBackBest ? 'контрольная сумма по строкам сошлась' : scaleBug ? 'масштаб 1:1000' : 'итог занижен в разы'})`);
      data.total_amount = best;
    }
  }
  if (data.total_amount == null && itemsSum > 0) {
    data.total_amount = Math.round(itemsSum * 100) / 100;
    console.log(`v53: итог восстановлен как сумма строк = ${data.total_amount}`);
  }

  // v54.3: штамп чека «дата+время» в подвале (…000929 10/01/2026 10:50) — самый надёжный источник даты.
  // Для кассовых документов (ticket / factura simplificada / recibo) перекрывает даже дату от LLM (OCR путает день: 12.07→02.07)
  const pad2 = (v) => String(v).padStart(2, '0');
  const stamp = text.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})\s+(\d{1,2}):(\d{2})/);
  if (stamp && /ticket|factura\s+simplificada|recibo|чек|кассов/i.test(text)) {
    const d = `${stamp[3]}-${pad2(stamp[2])}-${pad2(stamp[1])}`;
    if (Number(stamp[1]) <= 31 && Number(stamp[2]) <= 12 && data.receipt_date !== d) {
      console.log(`v54.3: дата по штампу чека ${data.receipt_date || '—'} → ${d}`);
      data.receipt_date = d;
      if (!data.receipt_time) data.receipt_time = `${pad2(stamp[4])}:${stamp[5]}`;
    }
  }
  // Дата-фолбэк
  if (!data.receipt_date) {
    const ES_MONTHS = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
    const pad = (v) => String(v).padStart(2, '0');
    const m1 = text.match(/(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+(\d{4})/i);
    const m2 = !m1 && text.match(/fecha[^0-9]{0,30}(\d{1,2})[./-](\d{1,2})[./-](\d{4})/i);
    if (m1) data.receipt_date = `${m1[3]}-${pad(ES_MONTHS[m1[2].toLowerCase()])}-${pad(m1[1])}`;
    else if (m2) data.receipt_date = `${m2[3]}-${pad(m2[2])}-${pad(m2[1])}`;
    if (data.receipt_date) console.log(`v53: дата восстановлена из текста: ${data.receipt_date}`);
  }
  return data;
}

// v57: ПОСТРАНИЧНЫЙ ДЕТЕКТОР РАЗНЫХ ДОКУМЕНТОВ В ОДНОЙ ПАЧКЕ
// (банковские выписки ADEUDO POR DOMICILIACIÓN и т.п.: 16 страниц = 16 РАЗНЫХ выписок —
// у каждой свой эмитент, номер фактуры (Fra:), номер квитанции (NUMERO DE RECIBO), дата, итог).
// Критерии перепроверки: номер документа/фактуры, дата, итог страницы.
function pageDocSignature(text) {
  const t = String(text || '');
  const sig = { issuer: null, docNum: null, date: null, total: null };
  // Номер фактуры: «Fra:e632511414536» (OCR может вставлять пробелы: «e6 32511414536»)
  let m = t.match(/\bFra\s*[:;.]?\s*([A-Za-z]?\d[\d\s]{5,}\d)/i);
  if (m) sig.docNum = m[1].replace(/\s+/g, '').toLowerCase();
  // Номер квитанции: «NUMERO DE RECIBO» → значение рядом (00494950755BBQMDRB)
  if (!sig.docNum) {
    m = t.match(/RECIBO[\s\S]{0,60}?\b(\d{6,}[A-Z0-9]{4,})\b/i);
    if (m) sig.docNum = 'rec' + m[1].toLowerCase();
  }
  // v57.3: альбаран/фактура/тикет — номер рядом с ключевым словом («FACTURA Nº A-1234», «ALBARÁN 9793/6»)
  if (!sig.docNum) {
    m = t.match(/(?:ALBAR[AÁ]N|FACTURA|ALBARAN|TICKET|FACT\.?)\s*(?:N[ºo°]?|N[ÚU]M(?:ERO)?)?\s*[:.]?\s*([A-Z]{0,4}[\s\-]?\d[\d\s\/\-]{2,}\d)/i);
    if (m) sig.docNum = m[1].replace(/\s+/g, '').toLowerCase();
  }
  // v57.3: табличная шапка альбарана — «номер + дата» на одной строке («9793/ 6 17/07/2025 1»)
  if (!sig.docNum) {
    m = t.match(/\b(\d{3,7}(?:\s*[\/\-]?\s*\d{1,2}){0,2})\s+(\d{1,2}\/\d{1,2}\/\d{4})\b/);
    if (m) {
      sig.docNum = m[1].replace(/\s+/g, '').toLowerCase();
      if (!sig.date) sig.date = m[2];
    }
  }
  // Дата документа: «Fecha:2025-11-30» или dd/mm/yyyy
  m = t.match(/Fecha\s*[:;]?\s*(\d{4}-\d{1,2}-\d{1,2})/i) || t.match(/Fecha\s*[:;]?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})/i);
  if (m) sig.date = m[1];
  // v57.3: дата страницы — первая dd/mm/yyyy в шапке (для безномерных страниц — критерий разделения)
  if (!sig.date) {
    m = t.slice(0, 1200).match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/);
    if (m) sig.date = m[1];
  }
  // Итог страницы: самая крупная сумма с EUR/€ (выписка: «IMPORTE … 41,47 EUR»)
  const reT = /(\d{1,3}(?:[.\s]\d{3})*,\d{2}|\d+,\d{2})\s*(?:EUR|€)/gi;
  let mm; const cand = [];
  while ((mm = reT.exec(t)) !== null && cand.length < 40) {
    const n = parseAmountLike(mm[1].replace(/\s/g, ''));
    if (n != null && n > 0 && n < 1e9) cand.push(n);
  }
  if (cand.length) sig.total = Math.max(...cand);
  // v57.3: итог без символа валюты — блок после слова TOTAL (альбараны: «TOTAL → 766,21»)
  if (!sig.total) {
    // Все вхождения TOTAL (шапка таблицы + блок итога): максимум сумм в окне 300 символов
    const reH = /TOTAL\b/gi;
    let mh; const candS = [];
    while ((mh = reH.exec(t)) !== null) {
      const seg = t.slice(mh.index, mh.index + 300);
      const reS = /(\d{1,3}(?:[.\s]\d{3})+,\d{2}|\d+,\d{2})/g;
      let ms;
      while ((ms = reS.exec(seg)) !== null && candS.length < 30) {
        const n = parseAmountLike(ms[1].replace(/\s/g, ''));
        if (n != null && n > 0 && n < 1e9) candS.push(n);
      }
    }
    if (candS.length) sig.total = Math.max(...candS);
  }
  // v57.3: ни EUR-суффикса, ни слова TOTAL не нашлось (OCR потерял) — максимум сумм страницы
  if (!sig.total) {
    const reA = /(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})/g;
    let ma; const candA = [];
    while ((ma = reA.exec(t)) !== null && candA.length < 400) {
      const n = parseAmountLike(ma[1].replace(/\s/g, ''));
      if (n != null && n > 0 && n < 1e9) candA.push(n);
    }
    if (candA.length) sig.total = Math.max(...candA);
  }
  // Эмитент (ENTIDAD ORDENANTE — компания S.L./S.A./SLU)
  m = t.match(/([A-ZÁÉÍÓÚÑ][\w&.'\- ]{2,45}?(?:SLU|S\.?\s?L\.?\s?U\.?|S\.?\s?L\.?|S\.?\s?A\.?))\b/i);
  if (m) sig.issuer = m[1].trim().toLowerCase().replace(/\s+/g, ' ');
  return sig;
}

// Разбиваем пачку страниц на РАЗНЫЕ документы по подписям: ≥2 страниц с РАЗНЫМИ
// номерами документов/фактур → это не один документ. Подряд идущие страницы с той же
// подписью (или без неё) — продолжение предыдущего документа. null = дробить не нужно.
function splitPagesIntoDocuments(pageTexts) {
  if (!Array.isArray(pageTexts) || pageTexts.length < 2) return null;
  const sigs = pageTexts.map(pageDocSignature);
  const distinctNums = new Set(sigs.map(sg => sg.docNum).filter(Boolean));
  const distinctDates = new Set(sigs.map(sg => sg.date).filter(Boolean));
  // Нужно минимум 2 различия: по номерам документов ИЛИ по датам страниц
  if (distinctNums.size < 2 && distinctDates.size < 2) return null;
  const groups = [];
  let lastDate = null; // дата последней подписанной страницы
  for (let i = 0; i < pageTexts.length; i++) {
    const k = sigs[i].docNum;
    const d = sigs[i].date;
    const last = groups[groups.length - 1];
    if (last && k && k === last.key) { last.pages.push(i); if (d) lastDate = d; continue; }
    // Страница без номера: продолжение предыдущего документа — НО только если даты нет
    // или она СОВПАДАЕТ; другая дата = другой документ (v57.3: альбаран без распознанного номера)
    if (last && !k && (!d || !lastDate || d === lastDate)) { last.pages.push(i); continue; }
    groups.push({ key: k, pages: [i], sig: sigs[i] });
    if (d) lastDate = d;
  }
  return groups.length >= 2 ? groups : null;
}

// Перепроверка карточки по подписи страницы: итог/дата/номер сходятся с тем,
// что реально напечатано на странице? Расхождение — исправляем по подписи.
function verifyDocAgainstSignature(receiptData, sig, logTag) {
  if (!sig) return;
  const fixes = [];
  const cur = Number(receiptData.total_amount) || 0;
  if (sig.total && (!cur || Math.abs(cur - sig.total) > Math.max(0.03, sig.total * 0.01))) {
    fixes.push(`итог ${cur || '—'} → ${sig.total}`);
    receiptData.total_amount = sig.total;
  }
  if (sig.date && !receiptData.date) {
    let d = sig.date;
    const m = d.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
    if (m) d = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    receiptData.date = d;
    fixes.push(`дата → ${d}`);
  }
  if (sig.docNum && !receiptData.invoice_number) {
    receiptData.invoice_number = sig.docNum;
    fixes.push(`№ документа → ${sig.docNum}`);
  }
  if (fixes.length) console.log(`v57 перепроверка (${logTag}): ${fixes.join('; ')}`);
}

async function finalizeDocumentFromPageTexts(pageTexts, currency, docType) {
  const pageCount = pageTexts.length;

  // Годовая отчётность (v32) и налоговые формы (v34): детект по исходным текстам страниц
  const isAnnualAccounts = looksLikeAnnualAccounts(pageTexts.join('\n').slice(0, 40000));
  const isTaxForm = !isAnnualAccounts && looksLikeTaxForm(pageTexts.join('\n').slice(0, 40000));
  const isFormDoc = isAnnualAccounts || isTaxForm;

  // v32.1: страницы-формы (баланс/P&L) СНАЧАЛА конвертируем в Markdown-таблицы,
  // затем переводим и разбираем построчно — таблица не рассыпается в точки
  let effTexts = pageTexts;
  if (isFormDoc) {
    effTexts = await runWithConcurrency(pageTexts, async (t) => {
      if (!looksLikeFormTablePage(t)) return t;
      try {
        let tbl = String(await callTextChain(buildFormTablePrompt(t.slice(0, 12000))) || '').trim();
        tbl = tbl.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
        return tbl.includes('|') ? tbl : t;
      } catch (e) {
        console.error('Конвертация страницы формы в таблицу не удалась:', e.message);
        return t;
      }
    }, 3);
    console.log(`${isAnnualAccounts ? 'Годовая отчётность' : 'Налоговая форма'}: в таблицы сконвертировано ${effTexts.filter((t, i) => t !== pageTexts[i]).length}/${pageCount} стр.`);
  }

  const raw_text = effTexts.map((t, i) => `══════ СТРАНИЦА ${i + 1} из ${pageCount} ══════\n${t}`).join('\n\n');

  // Перевод каждой страницы — текстовая цепочка (3 параллельно)
  const ruTexts = await runWithConcurrency(effTexts, async (t) => {
    if (/^\((ошибка|страница без текста|страница не распознана)/.test(t)) return t;
    // v56.3: «перевод»-эхо (без кириллицы) не принимаем; при сбое — одна повторная попытка
    // через 1.5с, и только потом — оригинал (иначе вывод «прыгает»: русский → испанский)
    let ru = await translateRawText(t);
    if (!ru || looksUntranslated(t, ru) || (looksLikeEmptySkeleton(ru) && !looksLikeEmptySkeleton(t))) {
      await new Promise(r => setTimeout(r, 1500));
      ru = await translateRawText(t);
    }
    // Перевод недоступен или похож на пустую сетку при содержательном оригинале —
    // показываем сам оригинал: содержимое важнее языка
    if (!ru || looksUntranslated(t, ru) || (looksLikeEmptySkeleton(ru) && !looksLikeEmptySkeleton(t))) return t;
    return ru;
  }, 3);
  const raw_text_ru = ruTexts.map((t, i) => `══════ СТРАНИЦА ${i + 1} из ${pageCount} ══════\n${t}`).join('\n\n');

  // JSON-сводка полей (начало + конец документа; для годовой отчётности — страницы с балансом/P&L,
  // уже сконвертированные в таблицы — касильи извлекаются точнее)
  const sample = isFormDoc
    ? buildAnnualAccountsSample(effTexts)
    : `${raw_text.slice(0, 12000)}\n\n…(середина документа опущена)…\n\n${raw_text.slice(-5000)}`;
  let data;
  try {
    data = parseAIResponse(await callTextChain(
      isAnnualAccounts ? buildAnnualAccountsPrompt(sample)
        : isTaxForm ? buildTaxFormPrompt(sample)
        : buildDocumentSummaryPrompt(sample)
    ));
  } catch (e) {
    console.error('Сводка документа не удалась:', e.message);
    data = parseAIResponse('{}');
  }
  if (isAnnualAccounts) {
    data.document_type = 'annual_accounts';
    data.items = ensureAnnualBankSummary(data.items);
  } else if (isTaxForm) {
    data.document_type = 'tax_form';
    if (!data.subtype) data.subtype = 'tax';
    data.items = ensureTaxFormBankSummary(data.items, data);
  }
  data.raw_text = raw_text;
  data.raw_text_ru = raw_text_ru;
  if (!data.object) data.object = detectObjectByAddress(data.supply_address, raw_text);
  if (!Array.isArray(data.items)) data.items = [];
  // v54.2: строгий фолбэк — LLM не извлёк позиции, а в тексте явный список товаров
  if (data.items.length === 0) {
    const fb = extractItemsFallback(raw_text);
    if (fb.length >= 2 && /итого|total|ticket|factura|recibo/i.test(raw_text)) {
      data.items = fb;
      if (!data.document_type || data.document_type === 'other') data.document_type = 'receipt';
      console.log(`v54.2: позиции восстановлены фолбэк-парсером (${fb.length} шт.)`);
      await translateItemNames(data.items);
    }
  }
  // Запасной вариант названия: первые содержательные строки первой страницы
  // (сводка могла вернуть store_name=null, если текст страниц частично пуст)
  if (!data.store_name) {
    const firstLines = String(pageTexts[0] || '').split('\n')
      .map(l => l.trim())
      .filter(l => l.length >= 4 && !l.startsWith('(') && !/^[|_\-—–+\s.:═]*$/.test(l))
      .slice(0, 2);
    if (firstLines.length) data.store_name = firstLines.join(' — ').slice(0, 90);
  }
  // Запасной вариант суммы: ищем "Общая сумма / Итого / Total ..." в полном тексте документа
  if (data.total_amount == null) {
    const m = String(raw_text).match(/(?:общая\s+сумма|итого|всего\s+к\s+оплате|suma\s+total|importe\s+total|total\s+(?:a\s+pagar|factura|presupuesto)|precio\s+de\s+compraventa|total)\s*[:.\-]?\s*(\d[\d\s ]*[.,]\d{1,2}|\d[\d\s ]{1,12}\d)/i);
    if (m) {
      const n = parseAmountLike(m[1]);
      if (n != null && n > 0 && n < 1e9) data.total_amount = n;
    }
  }
  enforceCurrencyAndTotal(data, raw_text);

  // v56.2: документ содержит НЕСКОЛЬКО фактур (по одной на страницу) — LLM часто берёт только первую
  // (симптом: на 2-й странице своя фактура, а в карточке её позиций и итога нет).
  // 1) Итог = СУММА итогов разных фактур (постраничный максимум, дубликаты-итоги склеиваем).
  // 2) Позиции добираем фолбэк-парсером по ПОЛНОМУ тексту, если сумма строк далека от итога.
  // Блок СТРОГО ПОСЛЕ enforceCurrencyAndTotal: иначе его контрольная сумма откатит склеенный итог.
  {
    const chunks = String(raw_text).split(/═{2,}\s*СТРАНИЦА\s+\d+\s+из\s+\d+\s*═{2,}/);
    const chunkMax = chunks.map(ch => {
      // Все денежные суммы страницы (12,20 / 1.171,27 / 218.87); итог фактуры — самая крупная
      // (ключевые слова ненадёжны: в табличной шапке «TOTAL IMP. … TOTAL FRA» слово оторвано от цифры)
      const cand = [];
      const reT = /(\d{1,3}(?:[. ]\d{3})+,\d{2}|\d+,\d{2}|\d+\.\d{2})/g;
      let mm;
      while ((mm = reT.exec(ch)) !== null && cand.length < 60) {
        const n = parseAmountLike(mm[1]);
        if (n != null && n > 0 && n < 1e9) cand.push(n);
      }
      return cand.length ? Math.max(...cand) : null;
    }).filter(n => n != null && n > 0);
    const nearN = (a, b) => Math.abs(a - b) <= Math.max(0.03, b * 0.01);
    const uniq = [];
    chunkMax.forEach(n => { if (!uniq.some(u => nearN(u, n))) uniq.push(n); });
    const cur = Number(data.total_amount) || 0;
    const sumAll = Math.round(uniq.reduce((a, b) => a + b, 0) * 100) / 100;
    const chunkDocNums = new Set(chunks.map(c => pageDocSignature(c).docNum).filter(Boolean));
    if (chunkDocNums.size >= 2) {
      console.log(`v57: на страницах ${chunkDocNums.size} РАЗНЫХ номеров документов/фактур — склейка итогов в нарастающую сумму ЗАПРЕЩЕНА`);
    } else if (uniq.length >= 2 && cur > 0 && !nearN(cur, sumAll) && uniq.some(u => nearN(u, cur))) {
      console.log(`v56.2: в документе ${uniq.length} разных фактур (${uniq.join(' + ')}) — итог ${cur} → ${sumAll}`);
      data.total_amount = sumAll;
    }
    const itemsSum = (Array.isArray(data.items) ? data.items : []).reduce((sum, it) => sum + (Number(it && it.total) || 0), 0);
    if (Number(data.total_amount) > 0 && itemsSum > 0 && itemsSum < Number(data.total_amount) * 0.6) {
      const fb2 = extractItemsFallback(raw_text);
      const fb2Sum = fb2.reduce((sum, it) => sum + (Number(it.total) || 0), 0);
      if (fb2.length > data.items.length && fb2Sum > itemsSum) {
        console.log(`v56.2: позиции добраны со всех страниц: было ${data.items.length} (Σ${itemsSum.toFixed(2)}) → стало ${fb2.length} (Σ${fb2Sum.toFixed(2)})`);
        data.items = fb2;
        if (data.subtotal == null && fb2Sum > 0) {
          data.subtotal = Math.round(fb2Sum * 100) / 100;
          const tax = Math.round((Number(data.total_amount) - fb2Sum) * 100) / 100;
          if (tax > 0 && data.tax_amount == null) data.tax_amount = tax;
        }
        await translateItemNames(data.items);
      }
    }
  }
  // v56.4: доперевод названий позиций — модель иногда возвращает name_ru не для всех строк
  // (в таблице микс: часть по-русски, часть на испанском)
  if (Array.isArray(data.items) && data.items.some(it => it && it.name && !it.section && /[a-záéíóúñü]/i.test(String(it.name)) && !/[а-яё]/i.test(String(it.name_ru || '')))) {
    await translateItemNames(data.items);
  }
  if (docType && docType !== 'auto') data.document_type = docType;
  else if (!data.store_name && !data.receipt_date) data.document_type = 'other';
  data._pagesRaw = pageTexts; // v33: исходные тексты vision/OCR (до табличной конвертации) → document_pages
  return data;
}

// ========== ЧЕК/ФАКТУРА из готового OCR-текста (локальный OCR, v28.5) ==========
// В отличие от buildDocumentSummaryPrompt (многостраничные документы, items: []),
// здесь извлекаем ТОВАРЫ, дату, итог и все чековые поля — как vision-промпт buildReceiptPrompt.
function buildReceiptTextPrompt(text, currency, docType) {
  const currencyHint = currency === 'auto'
    ? `Определи валюту АВТОМАТИЧЕСКИ: символы € → EUR, $ → USD, £ → GBP, ₽/руб → RUB, د.إ/Dhs → AED;
       страна/адрес: Испания/Европа → EUR, ОАЭ → AED, США → USD, Россия → RUB; слова "IVA"/"IGIC" → EUR.
       Верни ISO-код валюты.`
    : `Валюта: ${currency}.`;
  const docTypeHint = docType === 'auto'
    ? 'Определи тип САМ по содержимому документа.'
    : `Пользователь указал тип "${docType}" — но если по содержимому явно видно другое, укажи правильный.`;

  return `Ты — эксперт по распознаванию чеков и фактур. Ниже дан ТЕКСТ документа, полученный OCR.
Текст может содержать ошибки OCR и случайные повторы фрагментов — игнорируй дубликаты, восстанавливай смысл.
Извлеки ВСЕ данные в строгом JSON формате.

ВАЖНЫЕ ПРАВИЛА:
1. Найди магазин (store_name — ВСЕГДА оригинальное название как напечатано, без перевода; перевод — в store_name_ru), дату (receipt_date в формате YYYY-MM-DD), время (receipt_time), итоговую сумму (total_amount).
2. Найди ВСЕ товары — каждый товар это объект: name (оригинал), name_ru (перевод на русский), quantity (количество, если не указано — 1), price (цена за единицу), total (сумма за товар). Выведи КАЖДЫЙ товар, без пропусков.
3. ${currencyHint}
4. Если не уверен в значении — используй null, НЕ используй "Unknown" или 0 без причины.
5. Дата: "20/03/2026" или "20.03.2026" → "2026-03-20". Суммы — точные числа без символов валют.
6. Подытог (subtotal), налог (tax_amount), способ оплаты (payment_method), страна (country) — если есть.
7. document_type — ОБЯЗАТЕЛЬНО одно из значений:
   - "receipt" — кассовый чек, ticket, recibo, слип оплаты без юр. реквизитов.
   - "invoice" — фактура: FACTURA / INVOICE, номер фактуры, NIF/VAT продавца. FACTURA SIMPLIFICADA — тоже "invoice".
   - "bill" — периодический счёт за услуги: коммуналка (electricidad, agua, gas, basura), comunidad, телефон/интернет, подписки, аренда (даже если заголовок FACTURA — Iberdrola, Endesa, Telefónica...).
   - "insurance" — страховка (póliza, recibo de seguro). "bank" — банковская выписка/перевод/комиссия.
   - "contract" — договор. "municipality" — документы мэрии (Ayuntamiento). "tax" — налоговая (AEAT/Hacienda: IBI, IAE, modelo 303...).
   - "proposal" — коммерческое предложение (presupuesto, oferta, cotización). "other" — всё остальное.
   ${docTypeHint}
8. Для bill / insurance / bank / contract / municipality / tax / proposal дополнительно:
   - subtype — одно из: electricity, water, gas, internet, phone, comunidad, rent, waste, insurance_home, insurance_car, insurance_health, tax, other. Для receipt — null. AQUALIA / муниципальная вода → water; IBERDROLA / ENDESA / PODO / GEO Alternativa → electricity.
   - provider — компания-поставщик/эмитент. valid_from / valid_to — период действия/счёта YYYY-MM-DD или null.
   - invoice_number — номер фактуры/документа; contract_number — номер договора; supply_address — адрес поставки как напечатан; cups — код CUPS (ES0031...) или null; meter_number — номер счётчика или null; consumption — потребление ЧИСЛОМ или null; consumption_unit — "kWh"/"m3" или null.
9. Объект недвижимости (object) по адресу поставки: "Reykjavik" → "Duqe"; "Callao" → "Maria"; "Alcojora" → "Kit"; обычный чек из магазина → null.

ТЕКСТ ДОКУМЕНТА:
"""
${text}
"""

Верни ТОЛЬКО JSON, без markdown, без объяснений:
{
  "store_name": "MediaMarkt",
  "store_name_ru": "МедиаМаркт",
  "receipt_date": "2026-03-20",
  "receipt_time": "15:14",
  "total_amount": 944.96,
  "subtotal": null,
  "tax_amount": null,
  "tax_rate": null,
  "currency": "EUR",
  "payment_method": null,
  "country": "Spain",
  "document_type": "invoice",
  "subtype": null,
  "provider": null,
  "valid_from": null,
  "valid_to": null,
  "invoice_number": "FS E327-10/00110217",
  "contract_number": null,
  "supply_address": null,
  "cups": null,
  "meter_number": null,
  "consumption": null,
  "consumption_unit": null,
  "object": null,
  "items": [
    { "name": "BROTHER MFD LASER MONO", "name_ru": "МФУ Brother лазерное", "quantity": 1, "price": 399.00, "total": 399.00 }
  ]
}`;
}

// Карточка чека/фактуры из готовых OCR-текстов страниц (v28.5):
// чековая схема (с товарами) + те же запасные варианты, что у документного конвейера
async function finalizeReceiptFromPageTexts(pageTexts, currency, docType) {
  const pageCount = pageTexts.length;
  const raw_text = pageCount > 1
    ? pageTexts.map((t, i) => `══════ СТРАНИЦА ${i + 1} из ${pageCount} ══════\n${t}`).join('\n\n')
    : pageTexts[0];

  const ruTexts = await runWithConcurrency(pageTexts, async (t) => {
    // v56.3: «перевод»-эхо (без кириллицы) не принимаем; при сбое — одна повторная попытка
    let ru = await translateRawText(t);
    if (!ru || looksUntranslated(t, ru) || (looksLikeEmptySkeleton(ru) && !looksLikeEmptySkeleton(t))) {
      await new Promise(r => setTimeout(r, 1500));
      ru = await translateRawText(t);
    }
    if (!ru || looksUntranslated(t, ru) || (looksLikeEmptySkeleton(ru) && !looksLikeEmptySkeleton(t))) return t;
    return ru;
  }, 3);
  const raw_text_ru = pageCount > 1
    ? ruTexts.map((t, i) => `══════ СТРАНИЦА ${i + 1} из ${pageCount} ══════\n${t}`).join('\n\n')
    : ruTexts[0];

  let data;
  try {
    data = parseAIResponse(await callTextChain(buildReceiptTextPrompt(raw_text.slice(0, 16000), currency, docType)));
  } catch (e) {
    console.error('Структурирование чека из OCR-текста не удалось:', e.message);
    data = parseAIResponse('{}');
  }
  if (!data || typeof data !== 'object') data = {};
  data.raw_text = raw_text;
  data.raw_text_ru = raw_text_ru;
  if (!data.object) data.object = detectObjectByAddress(data.supply_address, raw_text);
  if (!Array.isArray(data.items)) data.items = [];
  // v54.2: строгий фолбэк — LLM не извлёк позиции, а в тексте явный список товаров
  if (data.items.length === 0) {
    const fb = extractItemsFallback(raw_text);
    if (fb.length >= 2) {
      data.items = fb;
      console.log(`v54.2: позиции восстановлены фолбэк-парсером (${fb.length} шт.)`);
      await translateItemNames(data.items);
    }
  }
  if (!data.store_name) {
    const firstLines = String(pageTexts[0] || '').split('\n')
      .map(l => l.trim())
      .filter(l => l.length >= 4 && !l.startsWith('(') && !/^[|_\-—–+\s.:═]*$/.test(l))
      .slice(0, 2);
    if (firstLines.length) data.store_name = firstLines.join(' — ').slice(0, 90);
  }
  if (data.total_amount == null) {
    const m = String(raw_text).match(/(?:общая\s+сумма|итого|всего\s+к\s+оплате|suma\s+total|importe\s+total|total\s+(?:a\s+pagar|factura|presupuesto)|total)\s*[:.\-]?\s*(\d[\d\s ]*[.,]\d{1,2}|\d[\d\s ]{1,12}\d)/i);
    if (m) {
      const n = parseAmountLike(m[1]);
      if (n != null && n > 0 && n < 1e9) data.total_amount = n;
    }
  }
  enforceCurrencyAndTotal(data, raw_text);
  if (docType && docType !== 'auto') data.document_type = docType;
  else if (!data.document_type) data.document_type = 'receipt';
  return data;
}

// Общая сборка многостраничного документа из буферов страниц (PDF-страницы или изображения):
// каждая страница — отдельный vision-запрос, затем общая финализация.
// Если передан userId — все страницы также сохраняются в Storage (page_urls).
// onProgress('vision'|'translate') — колбэк прогресса для асинхронных задач
async function assembleDocumentFromPages(pageBuffers, mimeTypes, currency, docType, userId = null, onProgress = null) {
  console.log(`Постраничный режим: документ ${pageBuffers.length} стр.`);
  const pageTexts = await runWithConcurrency(pageBuffers, async (buf, i) => {
    try {
      return await extractPageTextWithGemini(buf, mimeTypes[i] || 'application/pdf', i + 1, pageBuffers.length);
    } finally {
      if (onProgress) onProgress('vision');
    }
  }, 3);
  const data = await finalizeDocumentFromPageTexts(pageTexts, currency, docType, onProgress ? () => onProgress('translate') : null);
  if (userId) {
    data.page_urls = await uploadPagesToStorage(pageBuffers, mimeTypes, userId);
    console.log(`Страницы сохранены в Storage: ${data.page_urls.length}/${pageBuffers.length}`);
  }
  return data;
}

// Текст ДИАПАЗОНА страниц из целого PDF (режим без pdf-lib: Gemini видит весь документ,
// мы просим страницы N–M; каждая страница в ответе — с заголовком ═══ Страница K ═══)
// Возвращает { text, truncated }: truncated=true, если ответ обрезан лимитом токенов
// (плотные договоры: 3 страницы по 20+ тыс. знаков могут не влезть даже в 24576 токенов).
async function extractPageRangeTextWithGemini(pdfBuffer, fromPage, toPage, totalPages) {
  if (!genAI) throw new Error('Постраничное распознавание требует GEMINI_API_KEY');
  const model = genAI.getGenerativeModel({
    model: DEFAULT_GEMINI_MODEL,
    generationConfig: { maxOutputTokens: 24576, temperature: 0.1 }
  });
  const prompt = `Это отсканированный документ из ${totalPages} страниц.
Извлеки ДОСЛОВНО весь текст СТРАНИЦ С ${fromPage} ПО ${toPage} включительно, на языке оригинала (НЕ переводи), сохраняя порядок строк.
Каждую страницу начинай со строки-заголовка СТРОГО вида: ═══ Страница K ═══   (K — номер страницы).
Не добавляй JSON, markdown, комментарии или сводки — только текст страниц.
Если какая-то страница без текста (фото/пустая) — под её заголовком напиши: (страница без текста)`;
  const result = await model.generateContent([
    { inlineData: { data: pdfBuffer.toString('base64'), mimeType: 'application/pdf' } },
    prompt
  ]);
  const cand = result.response.candidates && result.response.candidates[0];
  const truncated = !!cand && cand.finishReason === 'MAX_TOKENS';
  let text = '';
  try { text = (result.response.text() || '').trim(); } catch (e) { text = ''; }
  return { text, truncated };
}

// Разбор ответов диапазонов на отдельные страницы по заголовкам ═══ Страница K ═══
function splitRangeTextsToPages(rangeTexts, pageCount) {
  const pages = new Array(pageCount).fill(null);
  for (const text of rangeTexts) {
    if (!text) continue;
    const re = /═══\s*Страница\s+(\d+)\s*═══/gi;
    const marks = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      marks.push({ page: parseInt(m[1], 10), bodyStart: re.lastIndex, markStart: m.index });
    }
    for (let i = 0; i < marks.length; i++) {
      const p = marks[i].page;
      const bodyEnd = i + 1 < marks.length ? marks[i + 1].markStart : text.length;
      const body = text.slice(marks[i].bodyStart, bodyEnd).trim();
      if (p >= 1 && p <= pageCount && !pages[p - 1] && body) pages[p - 1] = body;
    }
  }
  return pages.map(t => t || '(страница не распознана)');
}

// Постраничный режим БЕЗ pdf-lib: целый PDF → текст диапазонами по 3 страницы.
// Плотные документы (договоры по 18–25 тыс. знаков на страницу, напр. контракты Plenitude)
// могут не помещаться в лимит вывода → диапазон обрезается, последние страницы теряются.
// Поэтому: все страницы, которые не распознались ИЛИ попали в обрезанный/упавший диапазон,
// дозапрашиваются ПО ОДНОЙ — гарантия, что ни одна страница не потеряна.
async function recognizeLongPdfByPageRanges(pdfBuffer, pageCount, currency, docType) {
  const RANGE = 3;
  console.log(`Постраничный режим без pdf-lib: ${pageCount} стр., диапазоны по ${RANGE}`);
  const ranges = [];
  for (let from = 1; from <= pageCount; from += RANGE) ranges.push([from, Math.min(pageCount, from + RANGE - 1)]);
  const rangeResults = await runWithConcurrency(ranges, (r) => extractPageRangeTextWithGemini(pdfBuffer, r[0], r[1], pageCount), 3);
  const pageTexts = splitRangeTextsToPages(rangeResults.map(r => (r && r.text) || ''), pageCount);

  // Дозапрос по одной странице: нерозпознанные + все страницы обрезанных/упавших диапазонов
  const retryPages = new Set();
  rangeResults.forEach((r, i) => {
    if (!r || r.truncated || typeof r === 'string') {
      for (let p = ranges[i][0]; p <= ranges[i][1]; p++) retryPages.add(p);
    }
  });
  pageTexts.forEach((t, i) => { if (t === '(страница не распознана)') retryPages.add(i + 1); });

  if (retryPages.size) {
    const list = [...retryPages];
    console.log(`Дозапрос страниц по одной (${list.length}): ${list.join(', ')}`);
    const singles = await runWithConcurrency(list, (p) => extractPageRangeTextWithGemini(pdfBuffer, p, p, pageCount), 3);
    list.forEach((p, i) => {
      const s = singles[i];
      let t = (s && s.text) || (typeof s === 'string' ? s : '');
      // 1) пробуем стандартный разбор по заголовку ═══ Страница K ═══
      const parsed = splitRangeTextsToPages([t], pageCount);
      if (parsed[p - 1] && parsed[p - 1] !== '(страница не распознана)') {
        pageTexts[p - 1] = parsed[p - 1];
        return;
      }
      // 2) запасной вариант: модель не поставила заголовок — срезаем его сами и берём весь текст
      t = t.replace(/^\s*═══\s*Страница\s+\d+\s*═══\s*/i, '').trim();
      if (t && !/^\(ошибка/.test(t)) pageTexts[p - 1] = t;
    });
  }
  return finalizeDocumentFromPageTexts(pageTexts, currency, docType);
}

// Постраничный режим для целого PDF: разбиваем на 1-страничные и отдаём сборщику.
// userId — чтобы сохранить каждую страницу в Storage (page_urls)
async function recognizeLongPdfByPages(pdfBuffer, currency, docType, userId = null) {
  const { PDFDocument } = require('pdf-lib');
  const src = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const pageCount = src.getPageCount();

  const pageBuffers = [];
  for (let i = 0; i < pageCount; i++) {
    const sub = await PDFDocument.create();
    const [page] = await sub.copyPages(src, [i]);
    sub.addPage(page);
    pageBuffers.push(Buffer.from(await sub.save()));
  }
  return assembleDocumentFromPages(pageBuffers, pageBuffers.map(() => 'application/pdf'), currency, docType, userId);
}

// Если у результата распознавания нет перевода — дозапрашиваем его отдельно
async function ensureRawTextRu(data) {
  if (!data || !data.raw_text || data.raw_text_ru) return data;
  if (/^Recognition failed/i.test(String(data.raw_text))) return data;
  try {
    const ru = await translateRawText(data.raw_text);
    if (ru) data.raw_text_ru = ru;
  } catch (e) {
    console.warn('ensureRawTextRu failed:', e.message);
  }
  return data;
}

// Алиасы: короткие имена фронта → реальные ID моделей в Groq API
const GROQ_ALIASES = {
  'llama-4-scout': 'meta-llama/llama-4-scout-17b-16e-instruct',
  'llama-4-maverick': 'meta-llama/llama-4-maverick-17b-128e-instruct',
  'llama-3.2-90b': 'llama-3.2-90b-vision-preview',
  'llama-3.2-11b': 'llama-3.2-11b-vision-preview',
  'llama-3.3-70b': 'llama-3.3-70b-versatile',
  'llama-3.1-8b': 'llama-3.1-8b-instant',
  'mixtral': 'mixtral-8x7b-32768',
  'gemma': 'gemma2-9b-it'
};

function resolveGroqModel(model) {
  const raw = String(model || '').replace(/^groq-/, '');
  return GROQ_ALIASES[raw] || raw || 'llama-3.3-70b-versatile';
}

// Модели, снятые Groq с поддержки (decommissioned): llama-4-scout/maverick, 3.2-vision, mixtral, gemma.
// Выбор такой модели раньше убивал распознавание (400 от Groq). Теперь проверяем по ЖИВОМУ списку.
const DEAD_GROQ_MODELS = new Set([
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'llama-3.2-90b-vision-preview',
  'llama-3.2-11b-vision-preview',
  'mixtral-8x7b-32768',
  'gemma2-9b-it'
]);

// Кэш живого списка моделей Groq (10 мин) — самозалечивание при будущих decommission
let groqLiveCache = { at: 0, ids: null };
async function isGroqModelAlive(resolvedId) {
  if (!groq) return false;
  if (DEAD_GROQ_MODELS.has(resolvedId)) return false;
  try {
    if (!groqLiveCache.ids || Date.now() - groqLiveCache.at > 10 * 60 * 1000) {
      const list = await groq.models.list();
      groqLiveCache = { at: Date.now(), ids: new Set((list.data || []).map(m => m.id)) };
    }
    return groqLiveCache.ids.has(resolvedId);
  } catch {
    return true; // список недоступен — не мешаем, дальше сработает endpoint-fallback
  }
}

async function recognizeWithGroq(imageBuffer, modelName, currency, docType) {
  if (!groq) throw new Error('Groq API key not configured');
  const resolvedModel = resolveGroqModel(modelName);
  // Модель снята с поддержки Groq (например llama-4-scout) → сразу бросаем понятную ошибку,
  // эндпоинт поймает её и уйдёт в recognizeWithFallback (Gemini) — распознавание не сломается
  if (!(await isGroqModelAlive(resolvedModel))) {
    throw new Error(`Модель ${resolvedModel} снята с поддержки Groq (decommissioned) — выбери другую модель в меню`);
  }
  const base64 = imageBuffer.toString('base64');
  const prompt = buildReceiptPrompt(currency, docType);

  const response = await groq.chat.completions.create({
    model: resolvedModel,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } }
        ]
      }
    ],
    max_tokens: 8192, // запас: оригинал + полный перевод raw_text
    temperature: 0.1
  });

  return parseAIResponse(response.choices[0].message.content);
}

async function recognizeWithOCRSpace(imageBuffer, engine, currency, docType, mimeType = 'image/jpeg') {
  const apiKey = process.env.OCRSPACE_API_KEY;
  if (!apiKey) throw new Error('OCR.space API key not configured');
  
  const isPdf = mimeType === 'application/pdf';
  const form = new FormData();
  form.append('apikey', apiKey);
  form.append('language', 'eng');
  form.append('isOverlayRequired', 'false');
  form.append('file', imageBuffer, { filename: isPdf ? 'receipt.pdf' : 'receipt.jpg', contentType: mimeType });
  form.append('scale', 'true');
  form.append('OCREngine', engine === 'engine2' ? '2' : engine === 'engine3' ? '3' : '1');
  
  const res = await axios.post('https://api.ocr.space/parse/image', form, {
    headers: form.getHeaders(),
    timeout: 60000
  });
  
  const parsed = res.data?.ParsedResults?.[0]?.ParsedText || '';
  if (!parsed) throw new Error('OCR.space returned empty text');
  
  const { data } = await recognizeWithFallback(imageBuffer, currency, docType, mimeType);
  return data;
}

// ЗАЩИТА ОТ ЗАГЛУШЕК: длинные чеки (100+ товаров) модели «сжимают» модуль ТОВАРЫ
// до строки вида "(109 artículos — extracto...)". Если так — пересобираем модуль
// из распознанного массива items, который парсится отдельно.
function rebuildItemsModule(text, items, useRu) {
  if (!text || !Array.isArray(items) || items.length === 0) return text;
  const moduleRegex = /(══════\s*ТОВАРЫ\s*══════\s*\n)([\s\S]*?)(?=\n\s*══════|$)/;
  const m = String(text).match(moduleRegex);
  if (!m) return text;
  const body = (m[2] || '').trim();
  const hasNumbered = /^\s*\d+[.)]\s/m.test(body);
  const looksPlaceholder = /art[ií]culos|extracto|resumen|arriba|и т\.д|\.\.\./i.test(body);
  if (hasNumbered && !looksPlaceholder) return text; // список на месте — не трогаем
  const lines = items.map((it, i) => {
    const name = useRu ? (it.name_ru || it.name) : (it.name || it.name_ru);
    const qty = it.quantity ?? 1;
    const price = it.price ?? it.total ?? '';
    const total = it.total ?? '';
    return `${i + 1}. ${name} — ${qty} × ${price} = ${total}`;
  });
  return String(text).replace(moduleRegex, `$1${lines.join('\n')}\n`);
}

function parseAIResponse(text) {
  let jsonStr = text;
  
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1];
  
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonMatch) jsonStr = jsonMatch[0];
  
  try {
    const data = JSON.parse(jsonStr);
    
    const result = {
      store_name: data.store_name || data.store || data.merchant_name || null,
      store_name_ru: data.store_name_ru || data.store_ru || null,
      receipt_date: normalizeDate(data.receipt_date || data.date || data.purchase_date),
      receipt_time: data.receipt_time || data.time || null,
      total_amount: parseAmount(data.total_amount || data.total || data.amount),
      subtotal: parseAmount(data.subtotal || data.sub_total),
      tax_amount: parseAmount(data.tax_amount || data.tax || data.vat),
      tax_rate: data.tax_rate || data.vat_rate || null,
      currency: data.currency || 'AED',
      payment_method: data.payment_method || data.payment || null,
      country: data.country || data.address || null,
      document_type: (() => {
      const raw = String(data.document_type || data.doc_type || data.type || '').toLowerCase().trim();
      if (['receipt', 'invoice', 'bill', 'insurance', 'bank', 'contract', 'municipality', 'tax', 'proposal', 'annual_accounts', 'tax_form', 'other'].includes(raw)) return raw;
      return /invoice|factura|фактур/i.test(raw) ? 'invoice' : 'receipt';
    })(),
      subtype: (() => {
        const raw = String(data.subtype || data.service_type || '').toLowerCase().trim();
        const SUBTYPES = ['electricity', 'water', 'gas', 'internet', 'phone', 'comunidad', 'rent', 'waste', 'insurance_home', 'insurance_car', 'insurance_health', 'tax', 'other'];
        return SUBTYPES.includes(raw) ? raw : null;
      })(),
      provider: data.provider || data.supplier || data.issuer || null,
      valid_from: normalizeDate(data.valid_from || data.start_date || data.period_from),
      valid_to: normalizeDate(data.valid_to || data.expiry_date || data.end_date || data.period_to || data.due_date),
      // Поля коммунальных счетов (вода/свет) — правило 16 промпта
      invoice_number: data.invoice_number || data.factura_number || data.document_number || null,
      contract_number: data.contract_number || data.contract || data.contrato || null,
      supply_address: data.supply_address || data.direccion_suministro || data.service_address || null,
      cups: data.cups || null,
      meter_number: data.meter_number || data.contador || null,
      consumption: parseAmount(data.consumption ?? data.consumo),
      consumption_unit: (() => {
        const u = String(data.consumption_unit || data.unit || '').toLowerCase().trim().replace('³', '3').replace(/квт[·.]?ч/, 'kwh');
        if (['kwh', 'kw/h', 'квтч'].includes(u)) return 'kWh';
        if (['m3', 'м3', 'cubic'].includes(u)) return 'm3';
        return null;
      })(),
      // Объект по адресу (правило 17): AI + детерминированная страховка по карте адресов
      object: (() => {
        const aiObject = data.object ? String(data.object).trim() : null;
        const validObjects = OBJECT_ADDRESS_MAP.map(o => o.object);
        if (aiObject && validObjects.includes(aiObject)) return aiObject;
        return detectObjectByAddress(data.supply_address || '', data.raw_text || '');
      })(),
      items: normalizeItems(data.items || data.products || data.goods || []),
      // v34: реквизиты официальных документов (договоры/справки/доверенности/переписка)
      // → детальная таблица contract_documents; в receipts НЕ сохраняются (отсекаются маппингом)
      party_a: data.party_a || null,
      party_b: data.party_b || null,
      doc_kind: (() => {
        const raw = String(data.doc_kind || '').toLowerCase().trim();
        return ['contract', 'certificate', 'power_of_attorney', 'bank_correspondence', 'gov_correspondence'].includes(raw) ? raw : null;
      })(),
      summary: data.summary || data.document_summary || null,
      raw_text: Array.isArray(data.raw_text)
        ? data.raw_text.map(x => String(x)).join('\n')
        : (data.raw_text || data.full_text || data.text || jsonStr),
      raw_text_ru: Array.isArray(data.raw_text_ru)
        ? data.raw_text_ru.map(x => String(x)).join('\n')
        : (data.raw_text_ru || data.raw_text_translation || null)
    };

    // Если модель «сжала» модуль ТОВАРЫ до заглушки "(109 artículos...)" — пересобираем из items
    result.raw_text = rebuildItemsModule(result.raw_text, result.items, false);
    if (result.raw_text_ru) result.raw_text_ru = rebuildItemsModule(result.raw_text_ru, result.items, true);

    return result;
  } catch (e) {
    console.error('JSON parse error:', e, 'Text:', text.substring(0, 500));
    return {
      store_name: null,
      store_name_ru: null,
      receipt_date: null,
      receipt_time: null,
      total_amount: null,
      subtotal: null,
      tax_amount: null,
      tax_rate: null,
      currency: 'AED',
      payment_method: null,
      country: null,
      items: [],
      raw_text: text
    };
  }
}

function normalizeDate(dateStr) {
  if (!dateStr) return null;
  const str = String(dateStr).trim();
  
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  
  const ddmmyyyy = str.match(/^(\d{1,2})[\/\.](\d{1,2})[\/\.](\d{4})$/);
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  
  return null;
}

function parseAmount(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return val;
  const cleaned = String(val).replace(/[^\d.,]/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  // v56.4: выкидываем мусорные «позиции»: заглушки модели («(Пропущено, не товар)») и строки
  // ИТОГОВ документа (suma de bases, retención, IVA/IGIC), ошибочно попавшие в таблицу.
  // Касилии налоговых форм/годовой отчётности (section/casilla) НЕ трогаем — там такие названия легальны.
  const junkRe = /пропущено|не\s*товар|skipped|omitid|placeholder/i;
  const summaryRe = /^(общая\s+сумма|suma(\s+de)?\s+(bases?|total)|suma\s+y\s+sigue|total\s+(a\s+pagar|factura|importe|fra)|importe\s+total|base\s+(imponible|total)|удержани|retenci[oó]n|iva\b|igic\b|налог|cuota\s+(iva|igic))/i;
  const cleaned = items.filter(item => {
    if (!item || typeof item !== 'object') return false;
    if (item.section || item.casilla) return true; // касильи форм — не трогаем
    const nm = String(item.name || item.description || item.product || '').trim();
    if (junkRe.test(nm) || summaryRe.test(nm)) {
      console.log(`v56.4: «позиция» отброшена (не товар/услуга): «${nm.slice(0, 60)}»`);
      return false;
    }
    return true;
  });
  return cleaned.map(item => ({
    // Доп. поля (section/casilla/prev_total/text_value — годовая отчётность v32) сохраняем как есть
    ...item,
    name: item.name || item.description || item.product || item.title || 'Unknown item',
    name_ru: item.name_ru || item.name || null,
    quantity: parseFloat(item.quantity || item.qty || item.count || 1) || 1,
    price: parseAmount(item.price || item.unit_price || item.cost),
    total: parseAmount(item.total ?? item.amount ?? item.sum ?? (item.price != null ? item.price * (item.quantity || 1) : null)),
    prev_total: parseAmount(item.prev_total ?? item.previous_year ?? item.prev) ?? null
  }));
}

// ========== IMAGE PROCESSING ==========
async function processImage(buffer) {
  const metadata = await sharp(buffer).metadata();
  let processed = buffer;
  
  if (metadata.width > 2000 || metadata.height > 3000 || buffer.length > 2 * 1024 * 1024) {
    processed = await sharp(buffer)
      .resize(1800, 2700, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85, progressive: true })
      .toBuffer();
  }
  
  return processed;
}

// ========== UPLOAD TO STORAGE ==========
// Supabase Storage принимает в ключах только латиницу — чистим Ñ, кириллицу, пробелы
function sanitizeFilename(name, contentType) {
  const m = String(name || '').match(/\.[^.]+$/);
  const ext = m ? m[0].toLowerCase() : '';
  const base = String(name || 'file')
    .replace(/\.[^.]+$/, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // Ñ→N, á→a
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'file';
  const finalExt = ext || (contentType === 'application/pdf' ? '.pdf' : '.jpg');
  return base + finalExt;
}

async function uploadToStorage(buffer, filename, userId, contentType = 'image/jpeg') {
  const folder = userId || 'anonymous';
  const safeName = sanitizeFilename(filename, contentType);
  const path = `${folder}/${Date.now()}_${safeName}`;
  
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .upload(path, buffer, { contentType, upsert: false });
  
  if (error) throw error;
  
  const { data: urlData } = supabaseAdmin.storage
    .from(BUCKET_NAME)
    .getPublicUrl(path);
  
  return urlData.publicUrl;
}

// Загрузка ВСЕХ страниц документа в Storage (3 параллельно).
// Ошибка одной страницы не роняет весь процесс — она просто пропускается.
async function uploadPagesToStorage(pageBuffers, mimeTypes, userId, label = 'doc') {
  const uploaded = await runWithConcurrency(pageBuffers, async (buf, i) => {
    try {
      const isPdf = (mimeTypes[i] || '') === 'application/pdf';
      const name = `${label}_p${String(i + 1).padStart(2, '0')}.${isPdf ? 'pdf' : 'jpg'}`;
      return await uploadToStorage(buf, name, userId, isPdf ? 'application/pdf' : 'image/jpeg');
    } catch (e) {
      console.error(`Страница ${i + 1}: ошибка загрузки в Storage:`, e.message);
      return null;
    }
  }, 3);
  return uploaded.filter(Boolean);
}

// ========== UNIVERSAL SAVE — фильтрует только существующие колонки ==========
let knownColumns = null;

async function getTableColumns() {
  if (knownColumns) return knownColumns;
  
  try {
    // Получаем информацию о колонках через RPC или пробную вставку
    const { data, error } = await supabaseAdmin
      .from('receipts')
      .select('*')
      .limit(1);
    
    if (error) throw error;
    
    if (data && data.length > 0) {
      knownColumns = Object.keys(data[0]);
    } else {
      // Пустая таблица — пробуем вставить минимальный объект
      const testInsert = { store_name: null, raw_text: null };
      const { error: insertError } = await supabaseAdmin
        .from('receipts')
        .insert([testInsert]);
      
      if (insertError) {
        // Если ошибка о колонке — извлекаем из сообщения
        const colMatch = insertError.message?.match(/column ["']?(\w+)["']?/);
        if (colMatch) {
          const badCol = colMatch[1];
          delete testInsert[badCol];
        }
      }
      
      // Удаляем тестовую запись
      await supabaseAdmin.from('receipts').delete().eq('store_name', null);
      
      // Повторяем пока не получим список колонок
      const { data: freshData } = await supabaseAdmin.from('receipts').select('*').limit(1);
      knownColumns = freshData && freshData.length > 0 ? Object.keys(freshData[0]) : [
        'id', 'store_name', 'store_name_ru', 'receipt_date', 'receipt_time',
        'total_amount', 'subtotal', 'tax_amount', 'tax_rate', 'currency',
        'country', 'payment_method',
        'items', 'image_url', 'page_urls', 'raw_text', 'raw_text_ru', 'document_type', 'object',
        'subtype', 'payment_status', 'provider', 'valid_from', 'valid_to', 'meta', 'related_id', 'object_id',
        'invoice_number', 'contract_number', 'supply_address', 'cups', 'meter_number',
        'consumption', 'consumption_unit', 'bank_movement_id', 'paid_date',
        'recognition_method', 'recognized_at', 'created_at', 'owner_id', 'owner_name'
      ];
    }
  } catch (e) {
    console.warn('Could not detect columns, using fallback list:', e.message);
    knownColumns = [
      'id', 'store_name', 'store_name_ru', 'receipt_date', 'receipt_time',
      'total_amount', 'subtotal', 'tax_amount', 'tax_rate', 'currency',
      'country', 'payment_method',
      'items', 'image_url', 'page_urls', 'raw_text', 'raw_text_ru', 'document_type', 'object',
      'subtype', 'payment_status', 'provider', 'valid_from', 'valid_to', 'meta', 'related_id', 'object_id',
      'invoice_number', 'contract_number', 'supply_address', 'cups', 'meter_number',
      'consumption', 'consumption_unit', 'bank_movement_id', 'paid_date',
      'recognition_method', 'recognized_at', 'created_at', 'owner_id', 'owner_name'
    ];
  }
  
  return knownColumns;
}

function filterRecordByColumns(record, columns) {
  // Громкое предупреждение, если перевод есть, но колонки raw_text_ru нет в БД — иначе теряется молча
  if (record.raw_text_ru && !columns.includes('raw_text_ru')) {
    console.warn('ВНИМАНИЕ: колонка raw_text_ru отсутствует в таблице receipts — перевод НЕ сохранён! Выполните: alter table receipts add column if not exists raw_text_ru text;');
  }
  // То же для сторон документа: без колонок party_a/party_b/summary (миграция v29) они молча отбрасываются
  if ((record.party_a || record.party_b || record.summary) && !columns.includes('party_a')) {
    console.warn('ВНИМАНИЕ: колонки party_a/party_b/summary отсутствуют в таблице receipts — стороны НЕ сохранены! Выполните supabase-migration-v29-receipt-parties.sql');
  }
  // То же для статуса оплаты: без колонки payment_status (миграция v19) статус молча отбрасывается
  if (record.payment_status && !columns.includes('payment_status')) {
    console.warn('ВНИМАНИЕ: колонка payment_status отсутствует в таблице receipts — статус оплаты НЕ сохранён! Выполните: alter table receipts add column if not exists payment_status text;');
  }
  const filtered = {};
  for (const [key, value] of Object.entries(record)) {
    if (columns.includes(key)) {
      filtered[key] = value;
    } else {
      console.log(`Skipping unknown column: ${key}`);
    }
  }
  return filtered;
}

// Статус оплаты: только три значения (to_pay — к оплате, paid — оплачено, underpaid — недоплачено), иначе null
function sanitizePaymentStatus(raw) {
  const v = String(raw || '').toLowerCase().trim();
  return ['to_pay', 'paid', 'underpaid'].includes(v) ? v : null;
}

async function saveReceiptToDB(receiptData, imageUrl, user, recognitionMethod) {
  const columns = await getTableColumns();
  
  const record = {
    store_name: receiptData.store_name,
    store_name_ru: receiptData.store_name_ru,
    receipt_date: receiptData.receipt_date,
    receipt_time: receiptData.receipt_time,
    total_amount: receiptData.total_amount,
    subtotal: receiptData.subtotal,
    tax_amount: receiptData.tax_amount,
    tax_rate: receiptData.tax_rate,
    currency: receiptData.currency,
    country: receiptData.country,
    payment_method: receiptData.payment_method,
    items: receiptData.items,
    image_url: imageUrl,
    page_urls: Array.isArray(receiptData.page_urls) && receiptData.page_urls.length ? receiptData.page_urls : null,
    raw_text: receiptData.raw_text,
    raw_text_ru: receiptData.raw_text_ru || null,
    document_type: receiptData.docType || 'receipt',
    subtype: receiptData.subtype || null,
    payment_status: receiptData.payment_status || null,
    provider: receiptData.provider || null,
    // v55.1: стороны и краткая суть документа (миграция v29; без колонок фильтр отсечёт)
    party_a: receiptData.party_a || null,
    party_b: receiptData.party_b || null,
    summary: receiptData.summary || null,
    valid_from: receiptData.valid_from || null,
    valid_to: receiptData.valid_to || null,
    invoice_number: receiptData.invoice_number || null,
    contract_number: receiptData.contract_number || null,
    supply_address: receiptData.supply_address || null,
    cups: receiptData.cups || null,
    meter_number: receiptData.meter_number || null,
    consumption: receiptData.consumption ?? null,
    consumption_unit: receiptData.consumption_unit || null,
    object: receiptData.object || 'other',
    recognition_method: recognitionMethod,
    recognized_at: new Date().toISOString(),
    owner_id: user?.id || null,
    owner_name: user?.name || null
  };
  
  // v54.1: антидубликат — тот же магазин (префикс названия), та же сумма (±0.02) и дата ±40 дней
  // (OCR может перепутать день: 12.07 → 02.07). НЕ блокируем: сохраняем всегда,
  // только ПОМЕТКА — в recognition_method («⚠ дубликат #ID») и duplicate_of в ответе фронту.
  let dupFound = null;
  if (record.total_amount != null && record.receipt_date && record.store_name) {
    try {
      const d0 = new Date(record.receipt_date);
      if (!isNaN(d0)) {
        const dayMs = 86400000;
        const from = new Date(d0.getTime() - 40 * dayMs).toISOString().slice(0, 10);
        const to = new Date(d0.getTime() + 40 * dayMs).toISOString().slice(0, 10);
        let q = supabaseAdmin.from('receipts')
          .select('id, store_name, receipt_date, total_amount, currency')
          .gte('receipt_date', from).lte('receipt_date', to)
          .gte('total_amount', record.total_amount - 0.02).lte('total_amount', record.total_amount + 0.02)
          .limit(10);
        if (record.owner_id) q = q.eq('owner_id', record.owner_id);
        const { data: cands } = await q;
        const norm = (v) => String(v || '').toLowerCase().replace(/[^a-zа-яёáéíóúñ0-9]/gi, '');
        const mine = norm(record.store_name);
        const dup = (cands || []).find(c => {
          const theirs = norm(c.store_name);
          if (!theirs) return false;
          const a = mine.slice(0, 10), b = theirs.slice(0, 10);
          return a.startsWith(b.slice(0, 8)) || b.startsWith(a.slice(0, 8));
        });
        if (dup) {
          dupFound = dup;
          record.recognition_method = `${record.recognition_method || ''} · ⚠ дубликат #${dup.id}`.trim();
          console.log(`Антидубликат: новая карточка помечена как дубликат #${dup.id} (${dup.store_name}, ${dup.receipt_date}, ${dup.total_amount})`);
        }
      }
    } catch (e) {
      console.warn('Антидубликат: проверка не удалась (не блокируем):', e.message);
    }
  }

  const filteredRecord = filterRecordByColumns(record, columns);
  
  const { data, error } = await supabaseAdmin
    .from('receipts')
    .insert([filteredRecord])
    .select()
    .single();

  if (error) throw error;
  if (dupFound) data.duplicate_of = dupFound; // не колонка БД — только полезная нагрузка ответа
  // v33: постраничное хранение (document_pages) — best-effort, на сохранение чека не влияет
  try { await saveDocumentPages(data.id, receiptData); } catch (e) { console.warn('document_pages:', e.message); }
  try { await saveDocumentDetails(data.id, receiptData); } catch (e) { console.warn('document details:', e.message); }
  return data;
}

// ========== UPLOAD RECEIPT ==========
// ========== МУЛЬТИ-ЧЕКИ НА ОДНОМ СКАНЕ ==========
// На одном изображении может быть НЕСКОЛЬКО чеков (скан с двумя чеками рядом).
// Быстрый детектор на gemini-2.5-flash возвращает рамки; каждая область вырезается
// и проходит обычный конвейер распознавания отдельно → отдельный документ в базе.
// CV-эвристика БЕЗ AI: ищем две широкие зоны текста, разделённые пустым зазором
// посередине изображения — признак двух чеков рядом (или друг под другом) на скане.
// Сигнал — ДОЛЯ тёмных пикселей (<215) в колонке/строке, а не средняя яркость:
// на чистом светлом скане текст разбавлен белым и средняя яркость почти не падает,
// но тёмные точки текста всё равно присутствуют. Проверено на реальном скане:
// левая зона 8–32% ширины, зазор ~5%, правая зона 38–65%.
function hasCentralContentGap(profile) {
  const N = profile.length;
  const minZone = Math.round(N * 0.10);   // зона контента ≥10% длины профиля
  const minGap  = Math.max(3, Math.round(N * 0.025)); // зазор ≥2.5%
  // сглаживание окном 5 — сливает микро-пустоты внутри текста чека
  const sm = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0, c = 0;
    for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < N) { s += profile[j]; c++; } }
    sm[i] = s / c;
  }
  const zones = [];
  let start = -1;
  for (let i = 0; i < N; i++) {
    if (sm[i] > 0.008) { if (start < 0) start = i; }
    else if (start >= 0) { zones.push([start, i - 1]); start = -1; }
  }
  if (start >= 0) zones.push([start, N - 1]);
  const big = zones.filter(z => z[1] - z[0] + 1 >= minZone);
  for (let i = 0; i < big.length - 1; i++) {
    const gs = big[i][1] + 1, ge = big[i + 1][0] - 1;
    const gw = ge - gs + 1;
    const center = (gs + ge) / 2;
    if (gw >= minGap && center >= N * 0.15 && center <= N * 0.85) return true;
  }
  return false;
}

async function suspectSideBySideLayout(imageBuffer) {
  try {
    const W = 200, H = 260;
    const { data } = await sharp(imageBuffer)
      .resize(W, H, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const col = new Float64Array(W), row = new Float64Array(H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (data[y * W + x] < 215) { col[x]++; row[y]++; }
      }
    }
    for (let x = 0; x < W; x++) col[x] /= H;
    for (let y = 0; y < H; y++) row[y] /= W;
    return hasCentralContentGap(col) || hasCentralContentGap(row); // рядом ИЛИ друг под другом
  } catch {
    return false;
  }
}

async function askGeminiForReceiptBoxes(imageBuffer, mimeType, force) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { maxOutputTokens: 1024, temperature: 0, responseMimeType: 'application/json' }
  });
  const prompt = force
    ? `Посмотри на это изображение ЕЩЁ РАЗ, очень внимательно. Анализ структуры страницы показывает: на скане ВОЗМОЖНО лежат ДВА отдельных чека/фактуры рядом (слева и справа или один под другим), разделённые пустым полем — у каждого своя шапка магазина, свой список товаров и свой ИТОГ.
Внимательно сравни левую и правую (верхнюю и нижнюю) части: у них разные названия магазинов и разные итоговые суммы?
Если это действительно ДВА отдельных документа — верни рамку каждого СТРОГО в JSON:
{"count": N, "boxes": [[ymin, xmin, ymax, xmax], ...], "labels": ["кратко: магазин 1", "магазин 2"]}
Координаты — целые числа 0..1000 (нормализованные), по одной рамке на каждый чек, с небольшим запасом по краям.
Но если это ОДИН документ (шапка, товары и футер одного чека, просто с полями или в несколько колонок) — честно ответь {"count": 1}. Не выдумывай разделение.`
    : `На изображении может быть ОДИН документ или НЕСКОЛЬКО отдельных чеков/фактур.
Типичный случай нескольких: скан страницы, на которой ДВА чека лежат рядом (один слева, другой справа, между ними белое поле) или один под другим — у них разные магазины и разные итоги.
ВАЖНО: один длинный чек — это ОДИН документ (шапку, фискальный блок и футер одного чека не делить).
Определи количество ОТДЕЛЬНЫХ чеков/фактур и верни СТРОГО JSON без пояснений:
{"count": 1}
или, если отдельных документов несколько:
{"count": N, "boxes": [[ymin, xmin, ymax, xmax], ...], "labels": ["кратко: магазин 1", "магазин 2"]}
Координаты — целые числа 0..1000 (нормализованные к размеру изображения), по одной рамке на каждый отдельный чек, с небольшим запасом по краям.`;
  const result = await model.generateContent([
    { inlineData: { data: imageBuffer.toString('base64'), mimeType } },
    prompt
  ]);
  const text = result.response.text();
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  const parsed = JSON.parse(m[0]);
  const count = parseInt(parsed.count, 10) || 1;
  if (count < 2 || !Array.isArray(parsed.boxes) || parsed.boxes.length < 2) return null;
  return { count, boxes: parsed.boxes.slice(0, count), labels: Array.isArray(parsed.labels) ? parsed.labels : [] };
}

async function detectMultipleReceipts(imageBuffer, mimeType = 'image/jpeg') {
  if (!genAI) return null;
  try {
    const first = await askGeminiForReceiptBoxes(imageBuffer, mimeType, false);
    if (first) return first;
    // Gemini ответил «один документ» — но если CV-эвристика видит две зоны текста,
    // разделённые пустым зазором (два чека рядом/друг под другом) — переспрашиваем
    // с подсказкой (честной: Gemini всё ещё может ответить count:1)
    if (await suspectSideBySideLayout(imageBuffer)) {
      console.log('Мульти-чек: эвристика видит две зоны текста — повторный запрос детектора с подсказкой');
      return await askGeminiForReceiptBoxes(imageBuffer, mimeType, true);
    }
    return null;
  } catch (e) {
    console.warn('detectMultipleReceipts:', e.message);
    return null; // детектор не сработал — обычный путь (один документ)
  }
}

// Вырезать область по нормализованным координатам 0..1000 (с полем 2% по краям)
async function cropByNormalizedBox(imageBuffer, box) {
  const meta = await sharp(imageBuffer).metadata();
  const W = meta.width, H = meta.height;
  if (!W || !H || !Array.isArray(box) || box.length < 4) return null;
  const [ymin, xmin, ymax, xmax] = box.map(v => Math.max(0, Math.min(1000, Number(v) || 0)));
  const padX = Math.round(W * 0.02), padY = Math.round(H * 0.02);
  const left = Math.max(0, Math.round(xmin / 1000 * W) - padX);
  const top = Math.max(0, Math.round(ymin / 1000 * H) - padY);
  const right = Math.min(W, Math.round(xmax / 1000 * W) + padX);
  const bottom = Math.min(H, Math.round(ymax / 1000 * H) + padY);
  const width = right - left, height = bottom - top;
  // слишком мелкая рамка — это не отдельный чек, а артефакт детектора
  if (width < W * 0.08 || height < H * 0.08) return null;
  return sharp(imageBuffer).extract({ left, top, width, height }).jpeg({ quality: 92 }).toBuffer();
}

app.post('/api/upload-receipt', upload.single('image'), async (req, res) => {
  try {
    const token = req.query.token || req.body.token;
    const user = resolveToken(token);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    
    if (!req.file) return res.status(400).json({ error: 'No image provided' });
    
    const model = req.body.model || DEFAULT_GEMINI_MODEL;
    const currency = req.body.currency || 'auto';
    const docType = req.body.docType || 'receipt';
    const object = req.body.object || 'other';
    const subtypeOverride = req.body.subtype && req.body.subtype !== 'auto' ? req.body.subtype : null;
    const paymentStatusOverride = sanitizePaymentStatus(req.body.payment_status);
    
    const isPdf = req.file.mimetype === 'application/pdf' || /\.pdf$/i.test(req.file.originalname || '');

    // WORD/ТЕКСТ как источник (v32.3): PDF → Word → правка → распознавание ИЗ ТЕКСТА (без OCR)
    const fname = req.file.originalname || '';
    const isWordLike = /\.(docx?|html?|txt)$/i.test(fname)
      || /wordprocessingml|msword|text\/(html|plain)/.test(req.file.mimetype || '');
    if (isWordLike) {
      const pageTexts = await extractPageTextsFromWordFile(req.file.buffer, fname);
      if (!pageTexts.length) return res.status(400).json({ error: 'Не удалось извлечь текст из файла (пустой или неподдерживаемый формат)' });
      console.log(`Word/text-импорт: ${fname} → страниц: ${pageTexts.length}`);
      let rd = shouldUseDocumentPipeline(pageTexts)
        ? await finalizeDocumentFromPageTexts(pageTexts, currency, docType)
        : await finalizeReceiptFromPageTexts(pageTexts, currency, docType);
      rd = await ensureRawTextRu(rd);
      rd.docType = docType === 'auto' ? (rd.document_type || 'other') : docType;
      rd.object = (object && object !== 'other') ? object : (rd.object || 'other');
      if (subtypeOverride) rd.subtype = subtypeOverride;
      if (paymentStatusOverride) rd.payment_status = paymentStatusOverride;
      const fileUrl = await uploadToStorage(req.file.buffer, fname, user.id, req.file.mimetype || 'application/octet-stream');
      if (req.body.allow_duplicate === '1') rd.allowDuplicate = true;
      const savedW = await saveReceiptToDB(rd, fileUrl, user, `word/text import (${pageTexts.length} стр.)`);
      return res.json({
        success: true, id: savedW.id, ...savedW, image_url: fileUrl,
        warning: `Импорт из Word/текста (${pageTexts.length} стр.) — распознавание по тексту, без OCR`
      });
    }

    const mimeType = isPdf ? 'application/pdf' : 'image/jpeg';
    const processedBuffer = isPdf ? req.file.buffer : await processImage(req.file.buffer);

    // МУЛЬТИ-ЧЕК: если на скане/фото несколько чеков — вырезаем каждый,
    // распознаём и сохраняем как ОТДЕЛЬНЫЕ документы
    if (!isPdf) {
      try {
        const multi = await detectMultipleReceipts(processedBuffer, mimeType);
        if (multi && multi.count >= 2) {
          console.log(`Мульти-чек: на изображении найдено документов: ${multi.count}`);
          const savedDocs = [];
          for (let i = 0; i < multi.boxes.length; i++) {
            try {
              const crop = await cropByNormalizedBox(processedBuffer, multi.boxes[i]);
              if (!crop) continue;
              const cropProcessed = await processImage(crop);
              const cropUrl = await uploadToStorage(cropProcessed, `${req.file.originalname || 'scan'}_check${i + 1}.jpg`, user.id, 'image/jpeg');
              const auto = await recognizeWithFallback(cropProcessed, currency, docType, 'image/jpeg');
              let rd = auto.data;
              rd = await ensureRawTextRu(rd);
              rd.docType = docType === 'auto' ? (rd.document_type || 'receipt') : docType;
              rd.object = (object && object !== 'other') ? object : (rd.object || 'other');
              if (subtypeOverride) rd.subtype = subtypeOverride;
              if (paymentStatusOverride) rd.payment_status = paymentStatusOverride;
              if (req.body.allow_duplicate === '1') rd.allowDuplicate = true;
              const saved = await saveReceiptToDB(rd, cropUrl, user, `multi-check ${i + 1}/${multi.boxes.length} (${auto.model})`);
              savedDocs.push({ id: saved.id, ...saved, image_url: cropUrl });
            } catch (e) {
              console.error(`Мульти-чек #${i + 1} не распознан:`, e.message);
            }
          }
          if (savedDocs.length) {
            return res.json({
              success: true,
              multi: true,
              count: savedDocs.length,
              documents: savedDocs,
              id: savedDocs[0].id,
              ...savedDocs[0],
              warning: `На изображении найдено чеков: ${multi.boxes.length} — сохранено отдельно: ${savedDocs.length}`
            });
          }
          // все кропы упали — идём обычным путём (один документ)
        }
      } catch (e) {
        console.warn('Мульти-чек детектор:', e.message);
      }
    }

    const imageUrl = await uploadToStorage(processedBuffer, req.file.originalname, user.id, mimeType);
    
    let receiptData;
    let recognitionMethod = model;
    let fallback = false;
    let recognizeErrorMsg = null;

    // Многостраничный PDF (договор/эскритура/выписка/полис) — режим «по страницам»
    let pdfPageCount = isPdf ? await getPdfPageCount(processedBuffer) : 0;
    if (isPdf && !pdfPageCount) pdfPageCount = await getPdfPageCountViaGemini(processedBuffer);

    try {
      if (pdfPageCount > LONG_PDF_PAGE_THRESHOLD) {
        if (hasPdfLib()) {
          // Основной путь: разрезаем PDF и распознаём каждую страницу отдельно (+ страницы в Storage)
          receiptData = await recognizeLongPdfByPages(processedBuffer, currency, docType, user.id);
          recognitionMethod = `page-by-page ${pdfPageCount}p (gemini vision)`;
        } else {
          // Без pdf-lib: Gemini читает целый PDF, текст запрашиваем диапазонами по 5 страниц
          receiptData = await recognizeLongPdfByPageRanges(processedBuffer, pdfPageCount, currency, docType);
          recognitionMethod = `page-by-page ${pdfPageCount}p ranges (gemini, pdf-lib отсутствует)`;
        }
      } else if (isPdf && !model.startsWith('gemini') && !model.startsWith('ocrspace')) {
        // Vision-модели Groq/OpenRouter/GitHub/Mistral/Kimi НЕ читают PDF — используем цепочку с Gemini
        const auto = await recognizeWithFallback(processedBuffer, currency, docType, mimeType);
        receiptData = auto.data;
        recognitionMethod = `${model} (pdf → ${auto.model})`;
      } else if (model.startsWith('gemini')) {
        receiptData = await recognizeWithGemini(processedBuffer, model, currency, docType, mimeType);
      } else if (model.startsWith('groq')) {
        receiptData = await recognizeWithGroq(processedBuffer, model, currency, docType);
      } else if (model.startsWith('ocrspace')) {
        const engine = model.replace('ocrspace-', '');
        receiptData = await recognizeWithOCRSpace(processedBuffer, engine, currency, docType, mimeType);
      } else if (model.startsWith('openrouter-')) {
        receiptData = await recognizeWithOpenAICompat(processedBuffer, model.replace(/^openrouter-/, ''), currency, docType, 'openrouter');
      } else if (model.startsWith('github-')) {
        receiptData = await recognizeWithOpenAICompat(processedBuffer, model.replace(/^github-/, ''), currency, docType, 'github');
      } else if (model.startsWith('mistral-')) {
        receiptData = await recognizeWithOpenAICompat(processedBuffer, model.replace(/^mistral-/, ''), currency, docType, 'mistral');
      } else if (model.startsWith('kimi-')) {
        receiptData = await recognizeWithOpenAICompat(processedBuffer, model.replace(/^kimi-/, ''), currency, docType, 'kimi');
      } else {
        const auto = await recognizeWithFallback(processedBuffer, currency, docType, mimeType);
        receiptData = auto.data;
        recognitionMethod = auto.model;
      }
    } catch (recognizeError) {
      console.error('Recognition error:', recognizeError);
      recognizeErrorMsg = recognizeError.response?.data?.error?.message || recognizeError.message;
      try {
        const auto = await recognizeWithFallback(processedBuffer, currency, docType, mimeType);
        receiptData = auto.data;
        recognitionMethod = `${model} (fallback → ${auto.model})`;
        fallback = true;
      } catch (fallbackError) {
        receiptData = {
          store_name: null,
          store_name_ru: null,
          receipt_date: null,
          receipt_time: null,
          total_amount: null,
          subtotal: null,
          tax_amount: null,
          tax_rate: null,
          currency: currency === 'auto' ? 'AED' : currency,
          payment_method: null,
          country: null,
          items: [],
          raw_text: `Recognition failed. Model: ${model}. Error: ${recognizeError.message}`
        };
        recognitionMethod = `${model} (failed)`;
      }
    }
    
    // Гарантия перевода: если модель опустила raw_text_ru — дозапрашиваем перевод отдельно
    receiptData = await ensureRawTextRu(receiptData);

    // При docType='auto' берём тип, определённый AI по содержимому документа
    receiptData.docType = docType === 'auto' ? (receiptData.document_type || 'receipt') : docType;
    // Объект: если пользователь явно выбрал в форме — его выбор; иначе объект из AI (правило 17, адрес поставки)
    receiptData.object = (object && object !== 'other') ? object : (receiptData.object || 'other');
    // Ручной выбор подтипа на форме загрузки перекрывает определённый AI
    if (subtypeOverride) receiptData.subtype = subtypeOverride;
    // Статус оплаты — только ручной выбор на форме загрузки (AI его не определяет)
    if (paymentStatusOverride) receiptData.payment_status = paymentStatusOverride;
    if (req.body.allow_duplicate === '1') receiptData.allowDuplicate = true;

    const saved = await saveReceiptToDB(receiptData, imageUrl, user, recognitionMethod);
    
    res.json({
      success: true,
      id: saved.id,
      ...saved,
      image_url: imageUrl,
      warning: fallback
        ? `Распознавание выполнено через fallback модель. Причина: ${String(recognizeErrorMsg || 'неизвестно').slice(0, 200)}`
        : null
    });
    
  } catch (e) {
    console.error('Upload error:', e);
    res.status(500).json({ error: e.message || 'Internal server error' });
  }
});

// ========== CLASSIFY PAGES (каждая страница — отдельный документ или части одного?) ==========
// Gemini смотрит весь набор страниц и для КАЖДОЙ решает: standalone (чек/фактура/
// альбаран/подтверждение перевода — есть своя шапка и завершение) или continuation
// (страница договора/эскритуры/отчёта). Если ВСЕ страницы standalone — фронт сохраняет
// каждую в свою карточку; иначе — старый путь «страницы одного документа».
async function classifyPagesWithGemini(pageBuffers, mimeTypes) {
  if (!genAI) throw new Error('GEMINI_API_KEY не задан');
  const BATCH = 8; // страниц в одном запросе — чтобы не раздувать контекст
  const out = [];
  for (let from = 0; from < pageBuffers.length; from += BATCH) {
    const batch = pageBuffers.slice(from, from + BATCH);
    const model = genAI.getGenerativeModel({
      model: DEFAULT_GEMINI_MODEL,
      generationConfig: { maxOutputTokens: 2048, temperature: 0, responseMimeType: 'application/json' }
    });
    const prompt = `Тебе переданы ${batch.length} страниц (это страницы ${from + 1}–${from + batch.length} общего набора), в порядке следования.
Для КАЖДОЙ страницы определи: это САМОСТОЯТЕЛЬНЫЙ завершённый документ или ЧАСТЬ многостраничного документа.
Самостоятельный (standalone=true): у страницы есть СОБСТВЕННАЯ шапка (продавец/организация/логотип) И завершение (итог/total/подпись/футер) — чек, фактура, альбаран, квитанция, подтверждение банковского перевода, одностраничный акт.
Часть документа (standalone=false): страница договора/эскритуры/отчёта — нет собственной шапки или нет завершения, текст начинается/обрывается «с середины», нумерация страниц сквозная.
Верни СТРОГО JSON без пояснений:
{"pages":[{"page":${from + 1},"standalone":true,"kind":"receipt|invoice|delivery_note|bank_confirmation|contract|other","title":"2-4 слова: магазин/тип"},{"page":${from + 2},"standalone":false,...},...]}
Номера page — АБСОЛЮТНЫЕ (${from + 1}..${from + batch.length}), ровно по одной записи на каждую переданную страницу.`;
    const parts = batch.map((buf, i) => ({ inlineData: { data: buf.toString('base64'), mimeType: mimeTypes[from + i] || 'image/jpeg' } }));
    const result = await model.generateContent([...parts, prompt]);
    const text = result.response.text();
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('classify-pages: модель вернула не-JSON');
    const parsed = JSON.parse(m[0]);
    const pages = Array.isArray(parsed.pages) ? parsed.pages : [];
    for (const p of pages) {
      out.push({
        page: parseInt(p.page, 10),
        standalone: !!p.standalone,
        kind: String(p.kind || 'other'),
        title: String(p.title || '')
      });
    }
  }
  // Нормализация: ровно одна запись на страницу; пропущенную моделью страницу считаем
  // ЧАСТЬЮ документа (standalone=false) — безопасный дефолт: старый путь «один документ»
  const byPage = new Map(out.filter(p => p.page >= 1).map(p => [p.page, p]));
  const normalized = [];
  for (let i = 1; i <= pageBuffers.length; i++) {
    normalized.push(byPage.get(i) || { page: i, standalone: false, kind: 'other', title: '' });
  }
  return normalized;
}

app.post('/api/classify-pages', upload.array('pages', 60), async (req, res) => {
  try {
    const token = req.query.token || req.body.token;
    const user = resolveToken(token);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No page files provided' });
    const buffers = [];
    const mimes = [];
    for (const f of files) {
      const isPdf = f.mimetype === 'application/pdf' || /\.pdf$/i.test(f.originalname || '');
      // для классификации достаточно уменьшенной копии — быстрее и дешевле
      buffers.push(isPdf ? f.buffer : await sharp(f.buffer)
        .resize(1400, 1400, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 70 }).toBuffer());
      mimes.push(isPdf ? 'application/pdf' : 'image/jpeg');
    }
    const pages = await classifyPagesWithGemini(buffers, mimes);
    const allStandalone = pages.length > 1 && pages.every(p => p.standalone);
    console.log(`classify-pages: ${pages.length} стр., allStandalone=${allStandalone} (${pages.map(p => `${p.page}:${p.standalone ? 'doc' : 'part'}`).join(' ')})`);
    res.json({ success: true, pages, allStandalone });
  } catch (e) {
    console.error('classify-pages error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ========== UPLOAD OCR TEXT (текст распознан ЛОКАЛЬНЫМ OCR на машине пользователя) ==========
// Кнопка «Локально» на фронте: браузер прогоняет страницы через Unlimited-OCR
// (llama-server пользователя, 127.0.0.1:8080 — бесплатно, без облака) и присылает
// markdown-текст каждой страницы + сами изображения. Бэкенд чистит служебные токены
// Unlimited-OCR и собирает карточку тем же конвейером (finalizeDocumentFromPageTexts:
// JSON-сводка полей + перевод), сохраняет как обычный документ.
// Общий regex «голых» координат grounding (v28.5): чистка и страж используют один шаблон
const LOCAL_OCR_COORD_RE = /\b(?:title|sub_title|subtitle|text|image|img|table|figure|chart|caption|header|footer|footnote|code|formula|equation|list|item|section|paragraph|page|line|word|logo|stamp|barcode|qrcode|doc_title)\s*\[{1,2}\s*\d[\d\s,.]*,[\d\s,.]*\]{1,2}/gi;
function cleanLocalOcrTokens(text) {
  if (!text) return '';
  let t = String(text);
  t = t.replace(/<\|ref\|>([\s\S]*?)<\|\/ref\|>/g, '$1'); // <|ref|>текст<|/ref|> → оставить текст
  t = t.replace(/<\|det\|>[\s\S]*?<\|\/det\|>/g, '');     // координатные блоки — выбросить целиком
  t = t.replace(/<\|[^|]+\|>/g, '');                      // прочие служебные токены модели
  // «Голые» координаты grounding (v28.5): llama.cpp вырезает спец-токены, остаётся
  // "title [362, 86, 624, 119]MediaMarkt" — убираем префикс "<тип> [числа]", текст сохраняем
  let prevT;
  do { prevT = t; t = t.replace(LOCAL_OCR_COORD_RE, ''); } while (t !== prevT);
  t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  // Схлопывание зациклившихся повторов: подряд идущие одинаковые строки — не больше двух
  const lines = t.split('\n');
  const out = [];
  let prev = null, dups = 0;
  for (const line of lines) {
    const key = line.trim();
    if (key && key === prev) {
      dups++;
      if (dups > 1) continue; // третью и дальше копию строки выбрасываем
    } else {
      dups = 0;
      if (key) prev = key;
    }
    out.push(line);
  }
  // Зацикленные БЛОКИ (v28.5): длинная строка (>=15 симв.), встретившаяся в тексте >2 раз, режется
  // (кейс: шапка чека MediaMarkt продублирована моделью 5 раз с промежутками)
  const seen = {};
  return out.map(l => l.trimEnd()).filter(l => {
    const s = l.trim();
    if (!s || s.length < 15) return true;
    seen[s] = (seen[s] || 0) + 1;
    return seen[s] <= 2;
  }).join('\n').trim();
}

// Признак «мусорного» OCR: модель зациклилась — почти все строки одинаковые
// (кейс 2026-08-07: «(1) 1 января 2017 г.» × 30 на фото чека Media Markt)
// v28.6: НЕ считаем контентом строки чистой табличной разметки («|---|», «|  |  |») —
// табличный документ (альбаран с пустой сеткой) законно даёт много одинаковых пустых строк;
// координатные префиксы снимаем, чтобы повтор фразы с разными координатами тоже ловился
function isDegenerateOcrText(t) {
  const lines = String(t).replace(LOCAL_OCR_COORD_RE, '').split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 3)
    .filter(l => !/^[|:\-\s+*_=~.]+$/.test(l));
  if (lines.length < 15) return false;
  const uniq = new Set(lines).size;
  return uniq / lines.length < 0.35;
}

app.post('/api/upload-ocr-text', upload.array('pages', 60), async (req, res) => {
  try {
    const token = req.query.token || req.body.token;
    const user = resolveToken(token);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    // Тексты страниц: ocr_texts (JSON-массив) или одиночный ocr_text
    let rawTexts = [];
    try { rawTexts = JSON.parse(req.body.ocr_texts || '[]'); } catch { rawTexts = []; }
    if ((!Array.isArray(rawTexts) || !rawTexts.length) && req.body.ocr_text) rawTexts = [req.body.ocr_text];
    if (!Array.isArray(rawTexts)) rawTexts = [];
    // Защита от карточки-мусора: проверяем СЫРОЙ текст ДО схлопывания повторов
    // (иначе схлопывание уничтожит «улики» зацикливания)
    // v28.6: зациклившиеся страницы ПРОПУСКАЕМ, а не отклоняем весь документ;
    // 422 — только если плохие ВСЕ страницы
    const badPages = rawTexts
      .map((t, i) => isDegenerateOcrText(String(t || '').replace(/<\|det\|>[\s\S]*?<\|\/det\|>/g, '')) ? i + 1 : 0)
      .filter(Boolean);
    // v33: дожим мусорных страниц облачным зрением — если локальный OCR дал
    // пустоту/звёздочки/повторы, а страница прислана файлом, пробуем Gemini.
    if (badPages.length && cloud?.enabled && Array.isArray(req.files) && req.files.length) {
      const fileByPage = {};
      for (const f of req.files) { const m = /(\d+)/.exec(f.originalname || ''); if (m) fileByPage[Number(m[1])] = f; }
      const retryResults = await runWithConcurrency(badPages, 2, async (pn) => {
        const f = (req.files.length === rawTexts.length ? req.files[pn - 1] : null) || fileByPage[pn];
        if (!f || !f.buffer) return null;
        if (f.mimetype === 'application/pdf' || /\.pdf$/i.test(f.originalname || '')) return null;
        try {
          const txt = await extractPageTextWithGemini(f.buffer, f.mimetype || 'image/jpeg', pn, rawTexts.length);
          return txt && !isDegenerateOcrText(txt) ? { pn, txt } : null;
        } catch { return null; }
      });
      const recovered = retryResults.filter(Boolean);
      if (recovered.length) {
        for (const r of recovered) rawTexts[r.pn - 1] = r.txt;
        const recSet = new Set(recovered.map(r => r.pn));
        const stillBad = badPages.filter(pn => !recSet.has(pn));
        badPages.splice(0, badPages.length, ...stillBad);
        console.log(`upload-ocr-text: облако восстановило стр. ${recovered.map(r => r.pn).join(', ')}`);
      }
    }
    if (badPages.length && badPages.length === rawTexts.length) {
      return res.status(422).json({
        error: `Локальный OCR зациклился на стр. ${badPages.join(', ')} — в тексте одни повторы. ` +
          'Сфотографируйте документ крупнее (чек — во весь кадр), при хорошем свете и без лишних предметов рядом, ' +
          'или используйте облачную кнопку распознавания.'
      });
    }
    if (badPages.length) {
      console.warn(`upload-ocr-text: стр. ${badPages.join(', ')} пропущены (OCR зациклился), осталось ${rawTexts.length - badPages.length}`);
      const badSet = new Set(badPages);
      rawTexts = rawTexts.filter((_, i) => !badSet.has(i + 1));
      if (Array.isArray(req.files)) req.files = req.files.filter((_, i) => !badSet.has(i + 1));
    }
    const pageTexts = rawTexts.map(t => cleanLocalOcrTokens(t)).filter(Boolean);
    if (!pageTexts.length) {
      return res.status(400).json({ error: 'Пустой OCR-текст — локальная модель ничего не вернула' });
    }

    const currency = req.body.currency || 'auto';
    const docType = req.body.docType || 'auto';
    const object = req.body.object || 'other';
    const subtypeOverride = req.body.subtype && req.body.subtype !== 'auto' ? req.body.subtype : null;
    const paymentStatusOverride = sanitizePaymentStatus(req.body.payment_status);

    // Карточка из текстов (v28.5): 1-2 страницы — почти всегда чек/фактура → чековая схема
    // С ТОВАРАМИ; 3+ страниц (или отчётность/налоговая форма, v34) — документный конвейер
    const receiptData = shouldUseDocumentPipeline(pageTexts)
      ? await finalizeDocumentFromPageTexts(pageTexts, currency, docType)
      : await finalizeReceiptFromPageTexts(pageTexts, currency, docType);
    receiptData.docType = docType === 'auto' ? (receiptData.document_type || 'receipt') : docType;
    receiptData.object = (object && object !== 'other') ? object : (receiptData.object || 'other');
    if (subtypeOverride) receiptData.subtype = subtypeOverride;
    if (paymentStatusOverride) receiptData.payment_status = paymentStatusOverride;
    // Пометка в тексте карточки о пропущенных страницах (v28.6)
    if (badPages.length) {
      const skipNote = `\n\n══════ ПРОПУЩЕНЫ СТРАНИЦЫ ══════\nСтр. ${badPages.join(', ')}: локальный OCR зациклился (одни повторы) — страница не вошла в карточку. Переснимите её крупнее или распознайте облачной кнопкой.`;
      receiptData.raw_text = (receiptData.raw_text || '') + skipNote;
      receiptData.raw_text_ru = (receiptData.raw_text_ru || '') + skipNote;
    }

    // Изображения страниц в Storage (фото документа в карточке + page_urls)
    const files = req.files || [];
    let imageUrl = null;
    if (files.length) {
      const pageBuffers = [];
      const mimeTypes = [];
      for (const f of files) {
        const isPdf = f.mimetype === 'application/pdf' || /\.pdf$/i.test(f.originalname || '');
        pageBuffers.push(isPdf ? f.buffer : await processImage(f.buffer));
        mimeTypes.push(isPdf ? 'application/pdf' : 'image/jpeg');
      }
      const urls = await uploadPagesToStorage(pageBuffers, mimeTypes, user.id, 'local-ocr');
      receiptData.page_urls = urls;
      imageUrl = urls[0] || null;
    }

    const methodLabel = `local-uocr (unlimited-ocr, ${pageTexts.length} стр.` +
      (badPages.length ? `, пропущено: ${badPages.join(',')}` : '') + ')';
    if (req.body.allow_duplicate === '1') receiptData.allowDuplicate = true;
    const saved = await saveReceiptToDB(receiptData, imageUrl, user, methodLabel);
    res.json({ success: true, id: saved.id, ...saved, image_url: imageUrl, skipped_pages: badPages });
  } catch (e) {
    console.error('upload-ocr-text error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ========== UPLOAD DOCUMENT PAGES (несколько файлов = страницы ОДНОГО документа) ==========
// Фронт отправляет все выбранные файлы как 'pages' — они собираются в один документ
// с модулями ══════ СТРАНИЦА N ══════ (тот же конвейер, что у длинных PDF)
// ========== АСИНХРОННЫЕ ЗАДАЧИ (многостраничные документы) ==========
// ПРИЧИНА: прокси Railway жёстко обрывает HTTP-запросы дольше ~5 минут (фронтенд получает
// «Ошибка сети» на 92%), а документ в 20+ плотных страниц обрабатывается 10–15 минут
// (vision + перевод каждой страницы). Поэтому POST сразу возвращает jobId, обработка
// идёт в фоне, фронтенд опрашивает GET /api/doc-job/:id каждые 4 сек.
const docJobs = new Map(); // id -> { status, stage, visionDone, translateDone, pagesTotal, result, error, createdAt }
function createDocJob(pagesTotal) {
  const id = require('crypto').randomUUID();
  docJobs.set(id, { status: 'processing', stage: 'vision', visionDone: 0, translateDone: 0, pagesTotal, createdAt: Date.now() });
  return id;
}
// Чистка завершённых/зависших задач (TTL 2 часа)
setInterval(() => {
  const now = Date.now();
  for (const [id, j] of docJobs) { if (now - j.createdAt > 2 * 3600 * 1000) docJobs.delete(id); }
}, 600000).unref();

app.get('/api/doc-job/:id', (req, res) => {
  const user = resolveToken(req.query.token);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const job = docJobs.get(req.params.id);
  if (!job) return res.status(404).json({ status: 'error', error: 'Задача не найдена (сервер перезапускался) — загрузите документ заново' });
  res.json(job);
});

// ========== PDF → MARKDOWN через MarkItDown (v56) ==========
// Цифровые PDF (фактуры/счета с текстовым слоем) идут в распознавание по ТЕКСТУ,
// без vision/OCR — точнее (таблицы, реквизиты, оба контрагента) и бесплатно.
// Нужен CLI: pip install "markitdown[pdf]" (на Railway — python3 + пакет в образе).
// CLI нет — возвращаем null, вызывающий код уходит в обычный vision-конвейер.
let markitdownMissing = false;

function runMarkitdownCli(tmpPath) {
  return new Promise((resolve) => {
    if (markitdownMissing) return resolve(null);
    const attempt = (cmd, args, isFallback) => {
      let proc;
      try { proc = spawn(cmd, args, { timeout: 120000 }); } catch (_) { return resolve(null); }
      let out = ''; let killed = false;
      proc.stdout.on('data', d => {
        out += d.toString();
        if (out.length > 3000000 && !killed) { killed = true; try { proc.kill(); } catch (_) {} }
      });
      proc.stderr.on('data', () => {});
      proc.on('error', (e) => {
        if (e.code === 'ENOENT' && !isFallback) return attempt('python3', ['-m', 'markitdown', tmpPath], true);
        if (e.code === 'ENOENT') {
          markitdownMissing = true;
          console.warn('markitdown не найден (pip install "markitdown[pdf]") — PDF идут через vision');
        }
        resolve(null);
      });
      proc.on('close', (code) => resolve(code === 0 && out.trim().length >= 40 ? out.trim() : null));
    };
    attempt('markitdown', [tmpPath], false);
  });
}

async function pdfToMarkdown(buffer, filename) {
  try {
    const tmp = path.join(os.tmpdir(), `markitdown-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
    fs.writeFileSync(tmp, buffer);
    const md = await runMarkitdownCli(tmp);
    try { fs.unlinkSync(tmp); } catch (_) {}
    if (md) console.log(`MarkItDown: «${filename}» → ${md.length} симв. markdown`);
    return md;
  } catch (e) {
    console.warn('pdfToMarkdown:', e.message);
    return null;
  }
}

app.post('/api/upload-document-pages', upload.array('pages', 60), async (req, res) => {
  try {
    const token = req.query.token || req.body.token;
    const user = resolveToken(token);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    let files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No page files provided' });

    const currency = req.body.currency || 'auto';
    const docType = req.body.docType || 'auto';
    const object = req.body.object || 'other';
    const subtypeOverride = req.body.subtype && req.body.subtype !== 'auto' ? req.body.subtype : null;
    const paymentStatusOverride = sanitizePaymentStatus(req.body.payment_status);

    // WORD/ТЕКСТ (v32.3): OCR не нужен — страницы извлекаем из текста файла
    const isWordFile = f => /\.(docx?|html?|txt)$/i.test(f.originalname || '') || /wordprocessingml|msword|text\/(html|plain)/.test(f.mimetype || '');
    const wordFiles = files.filter(isWordFile);
    if (wordFiles.length) {
      if (wordFiles.length !== files.length) return res.status(400).json({ error: 'Файлы Word/текста загружайте отдельно от изображений и PDF' });
      const pageTexts = [];
      for (const f of files) pageTexts.push(...await extractPageTextsFromWordFile(f.buffer, f.originalname));
      if (!pageTexts.length) return res.status(400).json({ error: 'Не удалось извлечь текст из файла Word/текста' });
      console.log(`Word/text-импорт (document-pages): ${files.map(f => f.originalname).join(', ')} → страниц: ${pageTexts.length}`);
      const jobIdW = createDocJob(pageTexts.length);
      res.json({ success: true, jobId: jobIdW, async: true });
      const jobW = docJobs.get(jobIdW);
      const t0w = Date.now();
      try {
        const receiptData = await finalizeDocumentFromPageTexts(pageTexts, currency, docType);
        receiptData.docType = docType === 'auto' ? (receiptData.document_type || 'other') : docType;
        receiptData.object = (object && object !== 'other') ? object : (receiptData.object || 'other');
        if (subtypeOverride) receiptData.subtype = subtypeOverride;
        if (paymentStatusOverride) receiptData.payment_status = paymentStatusOverride;
        const fileUrl = await uploadToStorage(files[0].buffer, files[0].originalname, user.id, files[0].mimetype || 'application/octet-stream');
        if (req.body.allow_duplicate === '1') receiptData.allowDuplicate = true;
        const saved = await saveReceiptToDB(receiptData, fileUrl, user, `word/text import (${pageTexts.length} стр., async)`);
        jobW.status = 'done';
        jobW.result = { success: true, id: saved.id, ...saved, image_url: fileUrl };
        console.log(`Задача ${jobIdW}: Word-документ ${pageTexts.length} стр. готов за ${Math.round((Date.now() - t0w) / 1000)}с`);
      } catch (e) {
        console.error(`Задача ${jobIdW} (word) упала:`, e);
        jobW.status = 'error';
        jobW.error = e.message;
      }
      return;
    }

    // PDF → MARKDOWN (v56): фронт приложил исходные PDF (их имена — в pdf_source_names).
    // Пробуем MarkItDown; если КАЖДЫЙ PDF дал markdown — vision не нужен, идём по тексту.
    let pdfSourceNames = [];
    try { pdfSourceNames = JSON.parse(req.body.pdf_source_names || '[]'); } catch (_) { pdfSourceNames = []; }
    if (pdfSourceNames.length) {
      const srcSet = new Set(pdfSourceNames);
      const pdfSrcs = files.filter(f => srcSet.has(f.originalname));
      const pageImgs = files.filter(f => !srcSet.has(f.originalname));
      // v57.1: РАЗДЕЛЕНИЕ ДО РАСПОЗНАВАНИЯ — фронт прислал постраничные тексты текстового слоя.
      // Если страницы — РАЗНЫЕ документы (разные № фактур/квитанций, даты, итоги) — делим сразу,
      // каждый документ финализируем и сохраняем ОТДЕЛЬНОЙ карточкой (без vision и markitdown)
      let pdfPageTexts = null;
      try {
        const ppt = JSON.parse(req.body.pdf_page_texts || 'null');
        if (Array.isArray(ppt) && ppt.length && ppt.every(t => t && String(t).trim().length >= 10)) pdfPageTexts = ppt.map(String);
      } catch (_) { pdfPageTexts = null; }
      const docGroupsM = (pdfPageTexts && pageImgs.length === pdfPageTexts.length) ? splitPagesIntoDocuments(pdfPageTexts) : null;
      if (docGroupsM && docGroupsM.length > 1) {
        console.log(`v57.1: PDF с текстовым слоем — ${pdfPageTexts.length} стр. = ${docGroupsM.length} РАЗНЫХ документов → отдельные карточки (markitdown/vision не нужны)`);
        const jobIdS = createDocJob(pdfPageTexts.length);
        res.json({ success: true, jobId: jobIdS, async: true });
        const jobS = docJobs.get(jobIdS);
        const t0s = Date.now();
        try {
          const bufsS = []; const mimesS = [];
          for (const f of pageImgs) {
            const isPdf = f.mimetype === 'application/pdf' || /\.pdf$/i.test(f.originalname || '');
            bufsS.push(isPdf ? f.buffer : await processImage(f.buffer));
            mimesS.push(isPdf ? 'application/pdf' : 'image/jpeg');
          }
          const results = [];
          for (let gi = 0; gi < docGroupsM.length; gi++) {
            const g = docGroupsM[gi];
            jobS.stage = 'translate';
            const rd = await finalizeDocumentFromPageTexts(g.pages.map(pi => pdfPageTexts[pi]), currency, docType, () => { jobS.translateDone++; });
            rd.docType = docType === 'auto' ? (rd.document_type || 'other') : docType;
            rd.object = (object && object !== 'other') ? object : (rd.object || 'other');
            if (subtypeOverride) rd.subtype = subtypeOverride;
            if (paymentStatusOverride) rd.payment_status = paymentStatusOverride;
            rd.page_urls = await uploadPagesToStorage(g.pages.map(pi => bufsS[pi]), g.pages.map(pi => mimesS[pi]), user.id);
            const imgS = rd.page_urls[0] || null;
            if (req.body.allow_duplicate === '1') rd.allowDuplicate = true;
            verifyDocAgainstSignature(rd, g.sig, `док. ${gi + 1}/${docGroupsM.length}`);
            const sv = await saveReceiptToDB(rd, imgS, user, `pdf text-layer multi-doc ${gi + 1}/${docGroupsM.length} (async)`);
            results.push({ success: true, id: sv.id, ...sv, image_url: imgS });
          }
          jobS.status = 'done';
          jobS.result = { success: true, multiple: true, count: results.length, results };
          console.log(`Задача ${jobIdS}: text-layer multi-doc — ${results.length} карточек за ${Math.round((Date.now() - t0s) / 1000)}с`);
        } catch (e) {
          console.error(`Задача ${jobIdS} (text-layer split) упала:`, e);
          jobS.status = 'error';
          jobS.error = e.message;
        }
        return;
      }
      const mdTexts = [];
      let allOk = pdfSrcs.length > 0;
      for (const f of pdfSrcs) {
        const md = await pdfToMarkdown(f.buffer, f.originalname);
        if (md && md.trim().length >= 40) mdTexts.push(md); else { allOk = false; break; }
      }
      if (allOk && mdTexts.length) {
        console.log(`MarkItDown-импорт: ${pdfSrcs.map(f => f.originalname).join(', ')} → ${mdTexts.length} док. (vision пропущен)`);
        const jobIdM = createDocJob(mdTexts.length);
        res.json({ success: true, jobId: jobIdM, async: true });
        const jobM = docJobs.get(jobIdM);
        const t0m = Date.now();
        try {
          const receiptData = await finalizeDocumentFromPageTexts(mdTexts, currency, docType, () => { jobM.stage = 'translate'; jobM.translateDone++; });
          receiptData.docType = docType === 'auto' ? (receiptData.document_type || 'other') : docType;
          receiptData.object = (object && object !== 'other') ? object : (receiptData.object || 'other');
          if (subtypeOverride) receiptData.subtype = subtypeOverride;
          if (paymentStatusOverride) receiptData.payment_status = paymentStatusOverride;
          // Страницы для просмотра: JPEG-страницы, если есть; иначе сам PDF
          const storeFiles = pageImgs.length ? pageImgs : pdfSrcs;
          const bufs = []; const mimes = [];
          for (const f of storeFiles) {
            const isPdf = f.mimetype === 'application/pdf' || /\.pdf$/i.test(f.originalname || '');
            bufs.push(isPdf ? f.buffer : await processImage(f.buffer));
            mimes.push(isPdf ? 'application/pdf' : 'image/jpeg');
          }
          receiptData.page_urls = await uploadPagesToStorage(bufs, mimes, user.id);
          const imageUrl = receiptData.page_urls[0] || null;
          if (req.body.allow_duplicate === '1') receiptData.allowDuplicate = true;
          const saved = await saveReceiptToDB(receiptData, imageUrl, user, `pdf markdown (markitdown, ${mdTexts.length} док., async)`);
          jobM.status = 'done';
          jobM.result = { success: true, id: saved.id, ...saved, image_url: imageUrl };
          console.log(`Задача ${jobIdM}: markitdown ${mdTexts.length} док. готов за ${Math.round((Date.now() - t0m) / 1000)}с`);
        } catch (e) {
          console.error(`Задача ${jobIdM} (markitdown) упала:`, e);
          jobM.status = 'error';
          jobM.error = e.message;
        }
        return;
      }
      // MarkItDown недоступен/не справился — PDF-источники убираем, страницы-картинки идут в vision как обычно
      console.log('MarkItDown не сработал (нет CLI или скан без текстового слоя) — обычный vision-конвейер');
      files = pageImgs;
      if (!files.length) files = pdfSrcs; // крайний случай: только PDF без картинок — отдаём PDF в vision
    }

    // ЛОКАЛЬНЫЙ MAC OCR (v52): фронт прислал готовые тексты страниц (ocr_texts, JSON-массив) — vision не нужен,
    // текст структурируем обычной финализацией; страницы сохраняем в Storage как обычно
    if (req.body.ocr_texts) {
      let pageTexts = null;
      try { pageTexts = JSON.parse(req.body.ocr_texts); } catch (_) { pageTexts = null; }
      if (!Array.isArray(pageTexts) || !pageTexts.length || pageTexts.some(t => !t || !String(t).trim())) {
        return res.status(400).json({ error: 'Локальный OCR не вернул текст по страницам — проверьте mac-ocr-server на Mac' });
      }
      const pageBuffersL = [];
      const mimeTypesL = [];
      for (const f of files) {
        const isPdf = f.mimetype === 'application/pdf' || /\.pdf$/i.test(f.originalname || '');
        pageBuffersL.push(isPdf ? f.buffer : await processImage(f.buffer));
        mimeTypesL.push(isPdf ? 'application/pdf' : 'image/jpeg');
      }
      const srcTagL = String(req.body.model || '') === 'pdf-text-layer' ? 'pdf text-layer' : 'local mac-ocr';
      const jobIdL = createDocJob(pageTexts.length);
      res.json({ success: true, jobId: jobIdL, async: true });
      const jobL = docJobs.get(jobIdL);
      const t0l = Date.now();
      try {
        const textsL = pageTexts.map(String);
        // v57: в пачке могут быть РАЗНЫЕ документы (банковские выписки: у каждой страницы
        // свой номер фактуры/квитанции, дата, итог) — разбиваем и сохраняем ОТДЕЛЬНЫМИ карточками
        const docGroupsL = splitPagesIntoDocuments(textsL);
        if (docGroupsL && docGroupsL.length > 1) {
          console.log(`v57: пачка ${textsL.length} стр. — это ${docGroupsL.length} РАЗНЫХ документов (разные номера/даты/итоги страниц) — отдельные карточки`);
          const results = [];
          for (let gi = 0; gi < docGroupsL.length; gi++) {
            const g = docGroupsL[gi];
            jobL.stage = 'translate';
            const rd = await finalizeDocumentFromPageTexts(g.pages.map(pi => textsL[pi]), currency, docType, () => { jobL.translateDone++; });
            rd.docType = docType === 'auto' ? (rd.document_type || 'other') : docType;
            rd.object = (object && object !== 'other') ? object : (rd.object || 'other');
            if (subtypeOverride) rd.subtype = subtypeOverride;
            if (paymentStatusOverride) rd.payment_status = paymentStatusOverride;
            rd.page_urls = await uploadPagesToStorage(g.pages.map(pi => pageBuffersL[pi]), g.pages.map(pi => mimeTypesL[pi]), user.id);
            const imgG = rd.page_urls[0] || await uploadToStorage(pageBuffersL[g.pages[0]], files[g.pages[0]].originalname, user.id, mimeTypesL[g.pages[0]]);
            if (req.body.allow_duplicate === '1') rd.allowDuplicate = true;
            verifyDocAgainstSignature(rd, g.sig, `док. ${gi + 1}/${docGroupsL.length}`);
            const sv = await saveReceiptToDB(rd, imgG, user, `${srcTagL} multi-doc ${gi + 1}/${docGroupsL.length} (async)`);
            results.push({ success: true, id: sv.id, ...sv, image_url: imgG });
          }
          jobL.status = 'done';
          jobL.result = { success: true, multiple: true, count: results.length, results };
          console.log(`Задача ${jobIdL}: multi-doc — ${results.length} карточек за ${Math.round((Date.now() - t0l) / 1000)}с`);
          return;
        }
        const receiptData = await finalizeDocumentFromPageTexts(textsL, currency, docType, () => { jobL.stage = 'translate'; jobL.translateDone++; });
        receiptData.docType = docType === 'auto' ? (receiptData.document_type || 'other') : docType;
        receiptData.object = (object && object !== 'other') ? object : (receiptData.object || 'other');
        if (subtypeOverride) receiptData.subtype = subtypeOverride;
        if (paymentStatusOverride) receiptData.payment_status = paymentStatusOverride;
        receiptData.page_urls = await uploadPagesToStorage(pageBuffersL, mimeTypesL, user.id);
        const imageUrl = receiptData.page_urls[0] || await uploadToStorage(pageBuffersL[0], files[0].originalname, user.id, mimeTypesL[0]);
        if (req.body.allow_duplicate === '1') receiptData.allowDuplicate = true;
        const saved = await saveReceiptToDB(receiptData, imageUrl, user, `${srcTagL} ${pageTexts.length}p (async)`);
        jobL.status = 'done';
        jobL.result = { success: true, id: saved.id, ...saved, image_url: imageUrl };
        console.log(`Задача ${jobIdL}: local mac-ocr ${pageTexts.length} стр. готов за ${Math.round((Date.now() - t0l) / 1000)}с`);
      } catch (e) {
        console.error(`Задача ${jobIdL} (local mac-ocr) упала:`, e);
        jobL.status = 'error';
        jobL.error = e.message;
      }
      return;
    }

    if (!genAI) return res.status(500).json({ error: 'Постраничное распознавание требует GEMINI_API_KEY на бэкенде' });

    // Подготовка страниц: изображения сжимаем как обычно, PDF-страницы — как есть
    const pageBuffers = [];
    const mimeTypes = [];
    for (const f of files) {
      const isPdf = f.mimetype === 'application/pdf' || /\.pdf$/i.test(f.originalname || '');
      pageBuffers.push(isPdf ? f.buffer : await processImage(f.buffer));
      mimeTypes.push(isPdf ? 'application/pdf' : 'image/jpeg');
    }

    // Асинхронный режим: сразу отвечаем jobId (быстро, до таймаута прокси), обработка — в фоне
    const jobId = createDocJob(files.length);
    res.json({ success: true, jobId, async: true });
    const job = docJobs.get(jobId);
    const t0 = Date.now();

    try {
      // Распознаём страницы и сохраняем КАЖДУЮ в Storage (page_urls)
      const receiptData = await assembleDocumentFromPages(pageBuffers, mimeTypes, currency, docType, user.id, (stage) => {
        if (stage === 'vision') job.visionDone++;
        else if (stage === 'translate') { job.stage = 'translate'; job.translateDone++; }
      });
      job.stage = 'finalize';
      const recognitionMethod = `page-by-page ${files.length}f (gemini vision, async)`;
      receiptData.docType = docType === 'auto' ? (receiptData.document_type || 'other') : docType;
      receiptData.object = (object && object !== 'other') ? object : (receiptData.object || 'other');
      if (subtypeOverride) receiptData.subtype = subtypeOverride;
      if (paymentStatusOverride) receiptData.payment_status = paymentStatusOverride;

      // Обложка документа — первая страница (уже загружена вместе со всеми; повторно не грузим)
      const pageUrls = Array.isArray(receiptData.page_urls) ? receiptData.page_urls : [];
      const imageUrl = pageUrls[0] || await uploadToStorage(pageBuffers[0], files[0].originalname, user.id, mimeTypes[0]);

      if (req.body.allow_duplicate === '1') receiptData.allowDuplicate = true;
      const saved = await saveReceiptToDB(receiptData, imageUrl, user, recognitionMethod);
      job.status = 'done';
      job.result = { success: true, id: saved.id, ...saved, image_url: imageUrl };
      console.log(`Задача ${jobId}: документ ${files.length} стр. готов за ${Math.round((Date.now() - t0) / 1000)}с`);
    } catch (e) {
      console.error(`Задача ${jobId} упала:`, e);
      job.status = 'error';
      job.error = e.message;
    }
  } catch (e) {
    console.error('upload-document-pages error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ========== REPROCESS ==========
app.post('/api/reprocess-receipt', requireAuth, async (req, res) => {
  try {
    const { receiptId, model } = req.body;
    const { data: receipt } = await supabaseAdmin
      .from('receipts')
      .select('image_url')
      .eq('id', receiptId)
      .single();
    
    if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
    
    const imageRes = await axios.get(receipt.image_url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(imageRes.data);
    const mimeType = /\.pdf(\?|$)/i.test(receipt.image_url || '') ? 'application/pdf' : 'image/jpeg';
    
    const currency = req.body.currency || 'auto';
    const docType = req.body.docType || 'auto';
    
    // Многостраничный PDF (договор/эскритура/выписка/полис) — режим «по страницам»
    const isPdfDoc = mimeType === 'application/pdf';
    let pdfPageCount = isPdfDoc ? await getPdfPageCount(buffer) : 0;
    if (isPdfDoc && !pdfPageCount) pdfPageCount = await getPdfPageCountViaGemini(buffer);

    let receiptData;
    let pageModeMethod = null;
    if (pdfPageCount > LONG_PDF_PAGE_THRESHOLD) {
      if (hasPdfLib()) {
        receiptData = await recognizeLongPdfByPages(buffer, currency, docType, req.user?.id);
        pageModeMethod = `page-by-page ${pdfPageCount}p (gemini vision)`;
      } else {
        receiptData = await recognizeLongPdfByPageRanges(buffer, pdfPageCount, currency, docType);
        pageModeMethod = `page-by-page ${pdfPageCount}p ranges (gemini, pdf-lib отсутствует)`;
      }
    } else if (isPdfDoc && !model.startsWith('gemini') && !model.startsWith('ocrspace')) {
      // Vision-модели Groq/OpenRouter/GitHub/Mistral/Kimi НЕ читают PDF — цепочка с Gemini
      const auto = await recognizeWithFallback(buffer, currency, docType, mimeType);
      receiptData = auto.data;
      pageModeMethod = `${model} (pdf → ${auto.model})`;
    } else if (model.startsWith('gemini')) {
      receiptData = await recognizeWithGemini(buffer, model, currency, docType, mimeType);
    } else if (model.startsWith('groq')) {
      receiptData = await recognizeWithGroq(buffer, model, currency, docType);
    } else if (model.startsWith('openrouter-')) {
      receiptData = await recognizeWithOpenAICompat(buffer, model.replace(/^openrouter-/, ''), currency, docType, 'openrouter');
    } else if (model.startsWith('github-')) {
      receiptData = await recognizeWithOpenAICompat(buffer, model.replace(/^github-/, ''), currency, docType, 'github');
    } else if (model.startsWith('mistral-')) {
      receiptData = await recognizeWithOpenAICompat(buffer, model.replace(/^mistral-/, ''), currency, docType, 'mistral');
    } else if (model.startsWith('kimi-')) {
      receiptData = await recognizeWithOpenAICompat(buffer, model.replace(/^kimi-/, ''), currency, docType, 'kimi');
    } else {
      const auto = await recognizeWithFallback(buffer, currency, docType, mimeType);
      receiptData = auto.data;
    }

    // Гарантия перевода: если модель опустила raw_text_ru — дозапрашиваем перевод отдельно
    receiptData = await ensureRawTextRu(receiptData);

    const columns = await getTableColumns();
    const updateRecord = {
      store_name: receiptData.store_name,
      store_name_ru: receiptData.store_name_ru,
      receipt_date: receiptData.receipt_date,
      receipt_time: receiptData.receipt_time,
      total_amount: receiptData.total_amount,
      subtotal: receiptData.subtotal,
      tax_amount: receiptData.tax_amount,
      tax_rate: receiptData.tax_rate,
      currency: receiptData.currency,
      country: receiptData.country,
      payment_method: receiptData.payment_method,
      items: receiptData.items,
      raw_text: receiptData.raw_text,
      raw_text_ru: receiptData.raw_text_ru || null,
      document_type: docType === 'auto' ? (receiptData.document_type || 'receipt') : docType,
      subtype: receiptData.subtype || null,
      provider: receiptData.provider || null,
      valid_from: receiptData.valid_from || null,
      valid_to: receiptData.valid_to || null,
      invoice_number: receiptData.invoice_number || null,
      contract_number: receiptData.contract_number || null,
      supply_address: receiptData.supply_address || null,
      cups: receiptData.cups || null,
      meter_number: receiptData.meter_number || null,
      consumption: receiptData.consumption ?? null,
      consumption_unit: receiptData.consumption_unit || null,
      recognition_method: pageModeMethod || model,
      recognized_at: new Date().toISOString()
    };
    // Объект по адресу поставки (правило 17): обновляем только если AI смог определить
    if (receiptData.object) updateRecord.object = receiptData.object;
    // Страницы документа в Storage: обновляем, только если постраничный режим их сохранил
    if (Array.isArray(receiptData.page_urls) && receiptData.page_urls.length) updateRecord.page_urls = receiptData.page_urls;
    const filteredUpdate = filterRecordByColumns(updateRecord, columns);
    
    const { data, error } = await supabaseAdmin
      .from('receipts')
      .update(filteredUpdate)
      .eq('id', receiptId)
      .select()
      .single();
    
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== DIAGNOSTICS ==========
// Открой в браузере: https://householder-api-production.up.railway.app/api/diagnostics
// Сразу видно: какая версия кода задеплоена, есть ли колонка raw_text_ru, какие ключи настроены
app.get('/api/diagnostics', async (req, res) => {
  try {
    const columns = await getTableColumns();
    res.json({
      version: '2026-08-04.22 (банковские выписки: импорт Excel, автопривязка фактур к платежам, вкладка Анализ)',
      raw_text_ru_column: columns.includes('raw_text_ru'),
      fix_if_false: 'alter table receipts add column if not exists raw_text_ru text;',
      v13_page_urls_column: columns.includes('page_urls'),
      fix_v13_if_false: 'alter table receipts add column if not exists page_urls jsonb;',
      v7_columns: ['subtype', 'provider', 'valid_from', 'valid_to', 'meta', 'related_id', 'object_id'].every(c => columns.includes(c)),
      fix_v7_if_false: 'Выполни supabase-migration-v7.sql в Supabase SQL Editor',
      v9_columns: ['invoice_number', 'contract_number', 'supply_address', 'cups', 'meter_number', 'consumption', 'consumption_unit'].every(c => columns.includes(c)),
      fix_v9_if_false: 'Выполни supabase-migration-v9.sql в Supabase SQL Editor',
      v19_payment_status_column: columns.includes('payment_status'),
      fix_v19_if_false: 'alter table receipts add column if not exists payment_status text; (или выполни supabase-migration-v19.sql)',
      v20_receipts_bank_columns: ['bank_movement_id', 'paid_date'].every(c => columns.includes(c)),
      fix_v20_if_false: 'Выполни supabase-migration-v20.sql в Supabase SQL Editor (ПРОЕКТ householder!)',
      supabase_service_key_configured: !!supabaseServiceKey,
      fix_service_key_if_false: 'Railway → householder-api → Variables → SUPABASE_SERVICE_ROLE_KEY = service_role key из Supabase → Settings → API (обходит RLS полностью)',
      // Живой тест: реально пишем и удаляем строку — сразу видно, блокирует ли RLS запись
      bank_movements_write_test: await (async () => {
        try {
          const probe = await supabaseAdmin.from('bank_movements')
            .insert({ owner_id: '__diagnostics__', amount: 0, concept: '__write_test__' })
            .select('id').single();
          if (probe.error) return 'ОШИБКА: ' + probe.error.message;
          await supabaseAdmin.from('bank_movements').delete().eq('id', probe.data.id);
          return 'ok';
        } catch (e) { return 'ОШИБКА: ' + e.message; }
      })(),
      pdf_lib: hasPdfLib(),
      fix_pdf_lib_if_false: 'Добавь "pdf-lib": "^1.17.1" в dependencies backend/package.json и задеплой',
      providers_configured: {
        gemini: !!process.env.GEMINI_API_KEY,
        groq: !!process.env.GROQ_API_KEY,
        ocrspace: !!process.env.OCRSPACE_API_KEY,
        openrouter: !!process.env.OPENROUTER_API_KEY,
        github: !!(process.env.GITHUB_TOKEN || process.env.GITHUB_API_KEY),
        mistral: !!process.env.MISTRAL_API_KEY,
        kimi: !!(process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY)
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== TRANSLATE EXISTING RECEIPT (без перераспознавания) ==========
app.post('/api/translate-receipt', requireAuth, async (req, res) => {
  try {
    const { receiptId } = req.body;
    const { data: receipt } = await supabaseAdmin
      .from('receipts')
      .select('id, raw_text, raw_text_ru')
      .eq('id', receiptId)
      .single();

    if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
    if (!receipt.raw_text) return res.status(400).json({ error: 'У чека нет распознанного текста' });

    const ru = await translateRawText(receipt.raw_text);
    if (!ru) return res.status(502).json({ error: 'Не удалось перевести: все провайдеры недоступны (проверьте ключи/баланс)' });

    // Перевод возвращаем ВСЕГДА. Сохраняем, только если колонка существует —
    // иначе честно говорим saved:false, чтобы фронт показал предупреждение
    const columns = await getTableColumns();
    if (!columns.includes('raw_text_ru')) {
      console.warn('ВНИМАНИЕ: колонка raw_text_ru отсутствует — перевод НЕ сохранён! alter table receipts add column if not exists raw_text_ru text;');
      return res.json({ success: true, id: receiptId, raw_text_ru: ru, saved: false,
        warning: 'Перевод показан, но НЕ сохранён в базу: нет колонки raw_text_ru. Выполните в Supabase: alter table receipts add column if not exists raw_text_ru text;' });
    }

    const { error } = await supabaseAdmin
      .from('receipts')
      .update({ raw_text_ru: ru })
      .eq('id', receiptId);
    if (error) throw error;

    res.json({ success: true, id: receiptId, raw_text_ru: ru, saved: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== LIST RECEIPTS ==========
app.get('/api/receipts', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    let query = supabaseAdmin.from('receipts').select('*').order('created_at', { ascending: false });
    
    if (user.role !== 'admin') {
      query = query.eq('owner_id', user.id);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    const rows = data || [];
    // v55.1: стороны и summary договоров/фактур/КП исторически лежат в детальных таблицах
    // (contract_documents/proposals) — подмешиваем в ответ для карточек. Best-effort:
    // ошибки таблиц не роняют выдачу (миграция v23 могла не выполняться).
    try {
      const byId = {};
      rows.forEach(r => { if (r && r.id != null) byId[r.id] = r; });
      const ids = rows.filter(r => r && r.id != null && (!r.party_a || !r.party_b || !r.summary)).map(r => r.id);
      if (ids.length) {
        const { data: docs } = await supabaseAdmin.from('contract_documents')
          .select('receipt_id, party_a, party_b, summary').in('receipt_id', ids);
        (docs || []).forEach(d => {
          const r = byId[d.receipt_id];
          if (!r) return;
          if (!r.party_a && d.party_a) r.party_a = d.party_a;
          if (!r.party_b && d.party_b) r.party_b = d.party_b;
          if (!r.summary && d.summary) r.summary = d.summary;
        });
        const { data: props } = await supabaseAdmin.from('proposals')
          .select('receipt_id, vendor_name, notes').in('receipt_id', ids);
        (props || []).forEach(p => {
          const r = byId[p.receipt_id];
          if (!r) return;
          if (!r.party_a && p.vendor_name) r.party_a = p.vendor_name;
          if (!r.summary && p.notes) r.summary = p.notes;
        });
      }
    } catch (e) { console.warn('receipts details merge (не критично):', e.message); }
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== DELETE RECEIPT ==========
app.delete('/api/receipts/:id', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    
    const { error } = await supabaseAdmin.from('receipts').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== UPDATE RECEIPT (редактирование полей документа) ==========
app.put('/api/receipts/:id', requireAuth, async (req, res) => {
  try {
    const EDITABLE = ['store_name', 'store_name_ru', 'receipt_date', 'receipt_time',
      'total_amount', 'subtotal', 'tax_amount', 'currency', 'country', 'payment_method',
      'object', 'document_type', 'subtype', 'payment_status', 'provider', 'valid_from', 'valid_to',
      'invoice_number', 'contract_number', 'supply_address', 'cups', 'meter_number',
      'consumption', 'consumption_unit',
      'related_id', 'meta', 'object_id', 'page_urls'];
    const updates = {};
    for (const k of EDITABLE) {
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, k)) updates[k] = req.body[k];
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Нет полей для обновления' });
    const columns = await getTableColumns();
    const { data, error } = await supabaseAdmin
      .from('receipts')
      .update(filterRecordByColumns(updates, columns))
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ receipt: data });
  } catch (e) {
    res.status(500).json({ error: withDbSchemaHint(e.message) });
  }
});

// ========== OBJECTS (дома / недвижимость) ==========
// GET — список объектов; если таблицы objects ещё нет (миграция v7 не выполнена) — fallback на distinct receipts.object
app.get('/api/objects', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('objects').select('*').order('name');
    if (error) throw error;
    res.json({ objects: data, source: 'table' });
  } catch (e) {
    try {
      const { data } = await supabaseAdmin.from('receipts').select('object');
      const names = [...new Set((data || []).map(r => r.object).filter(Boolean))].sort();
      res.json({
        objects: names.map(name => ({ id: null, name })),
        source: 'receipts',
        migration_needed: 'Выполни supabase-migration-v7.sql — тогда появятся адреса, заметки и привязка object_id'
      });
    } catch (e2) {
      res.status(500).json({ error: e2.message });
    }
  }
});

// POST — добавить объект (дом)
app.post('/api/objects', requireAuth, async (req, res) => {
  try {
    const { name, address, notes } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Поле name обязательно' });
    const { data, error } = await supabaseAdmin
      .from('objects')
      .insert([{ name: String(name).trim(), address: address || null, notes: notes || null }])
      .select()
      .single();
    if (error) throw error;
    res.json({ object: data });
  } catch (e) {
    res.status(500).json({
      error: e.message,
      hint: 'Если ошибка про отсутствие таблицы — выполни supabase-migration-v7.sql в Supabase'
    });
  }
});

// ========== CRM (v33): контрагенты, контакты, задачи с таймлайном исполнения ==========
// Таблицы: supabase-migration-v21-crm.sql (crm_counterparties, crm_contacts, crm_tasks).
// CRM — общая для всех пользователей (командное пространство): читают все авторизованные,
// owner_id = создатель записи. Права на смену статуса проверяются по имени (req.user.name):
//   done           — только исполнитель (assignee); пустой assignee = любой;
//   confirm/return — только постановщик (created_by); admin может всё.
// Фронт работает в camelCase — маппинг в snake_case здесь, на входе/выходе.
const CRM_MIGRATION_HINT = 'Если ошибка про отсутствие таблицы/колонки — выполни supabase-migration-v21-crm.sql, supabase-migration-v22-crm-photos.sql и supabase-migration-v23-crm-cp-files.sql в SQL Editor проекта householder (Supabase)';

// ========== CRM: СЕРВЕРНОЕ СЖАТИЕ ВИДЕО (v37.5) ==========
// Safari игнорирует битрейт MediaRecorder — большие видео (>49 МБ) жмём ffmpeg на сервере.
// ТРЕБУЕТ пакет "ffmpeg-static" в dependencies package.json бэкенда (householder-api).
let ffmpegStaticPath = null;
try { ffmpegStaticPath = require('ffmpeg-static'); } catch (e) { /* пакет не установлен — будет понятная ошибка */ }

function ffmpegRun(args) {
  const { execFile } = require('child_process');
  return new Promise((resolve, reject) => {
    execFile(ffmpegStaticPath, args, { timeout: 10 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      // ffmpeg -i без выходного файла завершается с кодом 1 — это норма, stderr с метаданными нам и нужен
      if (err && !stderr) return reject(new Error((err.message || 'ffmpeg error').slice(-500)));
      resolve({ stdout: stdout || '', stderr: stderr || '', code: err ? err.code : 0 });
    });
  });
}

async function compressVideoBuffer(buffer) {
  if (!ffmpegStaticPath) throw new Error('На сервере нет ffmpeg: добавь "ffmpeg-static": "^5.2.0" в dependencies package.json бэкенда (householder-api) и сделай redeploy');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const tag = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const inPath = path.join(os.tmpdir(), `crmin_${tag}.video`);
  const outPath = path.join(os.tmpdir(), `crmout_${tag}.mp4`);
  try {
    fs.writeFileSync(inPath, buffer);
    // Длительность — из stderr «ffmpeg -i»
    let duration = 0;
    const probe = await ffmpegRun(['-i', inPath]);
    const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(probe.stderr || '');
    if (m) duration = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
    const audioBps = 96000;
    let vbps = duration > 0 ? Math.floor((45 * 8 * 1024 * 1024) / duration * 0.9 - audioBps) : 800000;
    if (vbps < 200000) vbps = 200000;
    if (vbps > 4000000) vbps = 4000000;
    // -nostats -loglevel error: без них ffmpeg спамит прогрессом в stderr и execFile
    // падает по maxBuffer на длинных роликах — раньше это давало молчаливый ENOENT при чтении результата
    const encode = (w, vb) => ffmpegRun(['-y', '-i', inPath,
      '-nostats', '-loglevel', 'error',
      '-vf', `scale=min(${w}\\,iw):-2`,
      '-c:v', 'libx264', '-preset', 'veryfast',
      '-b:v', String(vb), '-maxrate', String(Math.floor(vb * 1.5)), '-bufsize', String(vb * 2),
      '-c:a', 'aac', '-b:a', String(audioBps), '-movflags', '+faststart', outPath]);
    const runEncode = async (w, vb) => {
      try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (e) {}
      const r = await encode(w, vb);
      if (!fs.existsSync(outPath)) {
        const why = ((r.stderr || '').trim().split('\n').pop() || '').slice(-300);
        throw new Error(`ffmpeg не смог обработать видео${why ? `: ${why}` : ' (неизвестная ошибка кодека)'}`);
      }
      return fs.readFileSync(outPath);
    };
    let out = await runEncode(960, vbps);
    if (out.length > 49 * 1024 * 1024) {
      // второй, более жёсткий проход (очень длинные ролики)
      out = await runEncode(640, Math.max(150000, Math.floor(vbps / 2)));
    }
    if (out.length > 50 * 1024 * 1024) {
      throw new Error(`даже серверное сжатие дало ${(out.length / 1024 / 1024).toFixed(0)} МБ — ролик слишком длинный для лимита хранилища (~50 МБ)`);
    }
    console.log(`CRM video: серверное сжатие ${(buffer.length / 1024 / 1024).toFixed(0)} МБ → ${(out.length / 1024 / 1024).toFixed(1)} МБ`);
    return out;
  } finally {
    try { fs.unlinkSync(inPath); } catch (e) {}
    try { fs.unlinkSync(outPath); } catch (e) {}
  }
}
const crmCpToApi = (r) => r && ({
  id: r.id, name: r.name, type: r.type || 'client',
  phone: r.phone || '', email: r.email || '', address: r.address || '', comment: r.comment || '',
  attachments: Array.isArray(r.attachments) ? r.attachments : [],
  createdAt: r.created_at ? Date.parse(r.created_at) : null
});
const crmContactToApi = (r) => r && ({
  id: r.id, counterpartyId: r.counterparty_id || '', name: r.name, position: r.position || '',
  phone: r.phone || '', email: r.email || '', comment: r.comment || '',
  attachments: Array.isArray(r.attachments) ? r.attachments : [],
  createdAt: r.created_at ? Date.parse(r.created_at) : null
});
const crmTaskToApi = (r) => r && ({
  id: r.id, title: r.title, description: r.description || '',
  counterpartyId: r.counterparty_id || '', contactId: r.contact_id || '',
  assignee: r.assignee || '', createdBy: r.created_by || '',
  dueDate: r.due_date || '', priority: r.priority || 'normal', status: r.status || 'open',
  doneAt: r.done_at ? Date.parse(r.done_at) : null, closedAt: r.closed_at ? Date.parse(r.closed_at) : null,
  timeline: Array.isArray(r.timeline) ? r.timeline : [],
  photosBefore: Array.isArray(r.photos_before) ? r.photos_before : [],
  photosAfter: Array.isArray(r.photos_after) ? r.photos_after : [],
  createdAt: r.created_at ? Date.parse(r.created_at) : null
});

// GET /api/crm — все три раздела одним запросом (контрагенты + контакты + задачи)
app.get('/api/crm', requireAuth, async (req, res) => {
  try {
    const [cps, contacts, tasks] = await Promise.all([
      supabaseAdmin.from('crm_counterparties').select('*').order('name'),
      supabaseAdmin.from('crm_contacts').select('*').order('name'),
      supabaseAdmin.from('crm_tasks').select('*').order('created_at', { ascending: false })
    ]);
    if (cps.error) throw cps.error;
    if (contacts.error) throw contacts.error;
    if (tasks.error) throw tasks.error;
    res.json({
      counterparties: (cps.data || []).map(crmCpToApi),
      contacts: (contacts.data || []).map(crmContactToApi),
      tasks: (tasks.data || []).map(crmTaskToApi)
    });
  } catch (e) {
    res.status(500).json({ error: e.message, hint: CRM_MIGRATION_HINT });
  }
});

// ---- CRM: контрагенты ----
app.post('/api/crm/counterparties', requireAuth, async (req, res) => {
  try {
    const { name, type, phone, email, address, comment } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Поле name обязательно' });
    const { data, error } = await supabaseAdmin
      .from('crm_counterparties')
      .insert([{ owner_id: req.user.id, name: String(name).trim(), type: type || 'client', phone: phone || null, email: email || null, address: address || null, comment: comment || null }])
      .select()
      .single();
    if (error) throw error;
    res.json({ counterparty: crmCpToApi(data) });
  } catch (e) {
    res.status(500).json({ error: e.message, hint: CRM_MIGRATION_HINT });
  }
});

app.put('/api/crm/counterparties/:id', requireAuth, async (req, res) => {
  try {
    const FIELDS = ['name', 'type', 'phone', 'email', 'address', 'comment'];
    const updates = {};
    for (const k of FIELDS) {
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, k)) updates[k] = req.body[k] === '' ? null : req.body[k];
    }
    if (updates.name !== undefined && !String(updates.name || '').trim()) return res.status(400).json({ error: 'Поле name обязательно' });
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Нет полей для обновления' });
    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin.from('crm_counterparties').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ counterparty: crmCpToApi(data) });
  } catch (e) {
    res.status(500).json({ error: e.message, hint: CRM_MIGRATION_HINT });
  }
});

app.delete('/api/crm/counterparties/:id', requireAuth, async (req, res) => {
  try {
    // контакты и задачи отвязываются сами: FK ON DELETE SET NULL (миграция v21)
    const { error } = await supabaseAdmin.from('crm_counterparties').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message, hint: CRM_MIGRATION_HINT });
  }
});

// ---- CRM: контакты ----
// ---- Файлы контрагента (миграция supabase-migration-v23-crm-cp-files.sql): ----
// attachments — jsonb [{url, kind: photo|video|audio, name, ts, actor}] в Storage (папка crm_cp/).
// CRM — командное пространство: добавлять/удалять файлы может любой авторизованный пользователь.
// POST /api/crm/counterparties/:id/files — multipart/form-data, поле files (количество не ограничено)
app.post('/api/crm/counterparties/:id/files', requireAuth, crmMediaMulter('files'), async (req, res) => {
  try {
    const { data: cp, error: e0 } = await supabaseAdmin.from('crm_counterparties').select('*').eq('id', req.params.id).single();
    if (e0 || !cp) return res.status(404).json({ error: 'Контрагент не найден' });
    const userName = req.user.name || req.user.id;
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'Нет файлов: передайте поле files (multipart/form-data)' });
    const items = [];
    let lastErr = null;
    for (const f of files) {
      try {
        const mt = f.mimetype || '';
        const mkind = /^image\//.test(mt) ? 'photo' : /^video\//.test(mt) ? 'video' : /^audio\//.test(mt) ? 'audio' : (mt === 'application/pdf' || /^text\//.test(mt) || /\.(pdf|txt|md|csv)$/i.test(f.originalname || '')) ? 'doc' : null;
        if (!mkind) continue;
        let buf = f.buffer, ct = mt;
        if (mkind === 'photo') { buf = await processImage(f.buffer); ct = 'image/jpeg'; }
        if (mkind === 'video' && f.size > 48 * 1024 * 1024) { buf = await compressVideoBuffer(f.buffer); ct = 'video/mp4'; }
        if (mkind === 'doc' && !ct) ct = /\.pdf$/i.test(f.originalname || '') ? 'application/pdf' : 'text/plain';
        const url = await uploadToStorage(buf, f.originalname || 'file', 'crm_cp', ct);
        items.push({ url, kind: mkind, name: f.originalname || '', ts: Date.now(), actor: userName });
      } catch (e) { console.error('CRM cp file skip:', e.message); lastErr = e.message; }
    }
    if (!items.length) return res.status(400).json({ error: 'Не удалось загрузить ни одного файла (нужны фото, видео, аудио, текст или PDF)' + (lastErr ? `. Причина: ${lastErr}` : '') });
    const cur = Array.isArray(cp.attachments) ? cp.attachments : [];
    const { data, error } = await supabaseAdmin.from('crm_counterparties')
      .update({ attachments: [...cur, ...items], updated_at: new Date().toISOString() })
      .eq('id', cp.id).select().single();
    if (error) throw error;
    res.json({ counterparty: crmCpToApi(data) });
  } catch (e) {
    res.status(500).json({ error: e.message, hint: CRM_MIGRATION_HINT });
  }
});

// DELETE /api/crm/counterparties/:id/files — body {url}
app.delete('/api/crm/counterparties/:id/files', requireAuth, async (req, res) => {
  try {
    const url = req.body && req.body.url;
    if (!url) return res.status(400).json({ error: 'Передайте url файла' });
    const { data: cp, error: e0 } = await supabaseAdmin.from('crm_counterparties').select('*').eq('id', req.params.id).single();
    if (e0 || !cp) return res.status(404).json({ error: 'Контрагент не найден' });
    const cur = Array.isArray(cp.attachments) ? cp.attachments : [];
    const next = cur.filter(u => (typeof u === 'string' ? u : u && u.url) !== url);
    if (next.length === cur.length) return res.status(404).json({ error: 'Файл не найден у контрагента' });
    const { data, error } = await supabaseAdmin.from('crm_counterparties')
      .update({ attachments: next, updated_at: new Date().toISOString() })
      .eq('id', cp.id).select().single();
    if (error) throw error;
    res.json({ counterparty: crmCpToApi(data) });
  } catch (e) {
    res.status(500).json({ error: e.message, hint: CRM_MIGRATION_HINT });
  }
});

// POST /api/crm/contacts/:id/files — файлы контакта (v38): фото/видео/аудио/текст/PDF, поле files
app.post('/api/crm/contacts/:id/files', requireAuth, crmMediaMulter('files'), async (req, res) => {
  try {
    const { data: ct, error: e0 } = await supabaseAdmin.from('crm_contacts').select('*').eq('id', req.params.id).single();
    if (e0 || !ct) return res.status(404).json({ error: 'Контакт не найден' });
    const userName = req.user.name || req.user.id;
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'Нет файлов: передайте поле files (multipart/form-data)' });
    const items = [];
    let lastErr = null;
    for (const f of files) {
      try {
        const mt = f.mimetype || '';
        const mkind = /^image\//.test(mt) ? 'photo' : /^video\//.test(mt) ? 'video' : /^audio\//.test(mt) ? 'audio' : (mt === 'application/pdf' || /^text\//.test(mt) || /\.(pdf|txt|md|csv)$/i.test(f.originalname || '')) ? 'doc' : null;
        if (!mkind) continue;
        let buf = f.buffer, ct2 = mt;
        if (mkind === 'photo') { buf = await processImage(f.buffer); ct2 = 'image/jpeg'; }
        if (mkind === 'video' && f.size > 48 * 1024 * 1024) { buf = await compressVideoBuffer(f.buffer); ct2 = 'video/mp4'; }
        if (mkind === 'doc' && !ct2) ct2 = /\.pdf$/i.test(f.originalname || '') ? 'application/pdf' : 'text/plain';
        const url = await uploadToStorage(buf, f.originalname || 'file', 'crm_contacts', ct2);
        items.push({ url, kind: mkind, name: f.originalname || '', ts: Date.now(), actor: userName });
      } catch (e) { console.error('CRM contact file skip:', e.message); lastErr = e.message; }
    }
    if (!items.length) return res.status(400).json({ error: 'Не удалось загрузить ни одного файла (нужны фото, видео, аудио, текст или PDF)' + (lastErr ? `. Причина: ${lastErr}` : '') });
    const cur = Array.isArray(ct.attachments) ? ct.attachments : [];
    const { data, error } = await supabaseAdmin.from('crm_contacts')
      .update({ attachments: [...cur, ...items], updated_at: new Date().toISOString() })
      .eq('id', ct.id).select().single();
    if (error) throw error;
    res.json({ contact: crmContactToApi(data) });
  } catch (e) {
    res.status(500).json({ error: e.message, hint: CRM_MIGRATION_HINT });
  }
});

// DELETE /api/crm/contacts/:id/files — body {url}
app.delete('/api/crm/contacts/:id/files', requireAuth, async (req, res) => {
  try {
    const url = req.body && req.body.url;
    if (!url) return res.status(400).json({ error: 'Передайте url файла' });
    const { data: ct, error: e0 } = await supabaseAdmin.from('crm_contacts').select('*').eq('id', req.params.id).single();
    if (e0 || !ct) return res.status(404).json({ error: 'Контакт не найден' });
    const cur = Array.isArray(ct.attachments) ? ct.attachments : [];
    const next = cur.filter(u => (typeof u === 'string' ? u : u && u.url) !== url);
    if (next.length === cur.length) return res.status(404).json({ error: 'Файл не найден у контакта' });
    const { data, error } = await supabaseAdmin.from('crm_contacts')
      .update({ attachments: next, updated_at: new Date().toISOString() })
      .eq('id', ct.id).select().single();
    if (error) throw error;
    res.json({ contact: crmContactToApi(data) });
  } catch (e) {
    res.status(500).json({ error: e.message, hint: CRM_MIGRATION_HINT });
  }
});

// v57.5: multer читает originalname как Latin-1 — русские имена превращаются в «Ð¡Ð½Ð¸Ð¼Ð¾Ðº».
// Перекодируем обратно в UTF-8, если строка похожа на такую кракозябру.
function fixUtf8Name(name) {
  if (!name || typeof name !== 'string') return name;
  if (!/[ÐÑÃâ]/.test(name)) return name;
  try {
    const fixed = Buffer.from(name, 'latin1').toString('utf8');
    return /[\u0400-\u04FF]/.test(fixed) ? fixed : name;
  } catch (_) { return name; }
}

// v59.2: чиним кракозябру в именах для ЛЮБОГО ответа docs API (GET/POST/PATCH/DELETE)
const fixDocsAttachments = (arr) => (Array.isArray(arr) ? arr : []).map(it => (it && typeof it === 'object' && it.name) ? { ...it, name: fixUtf8Name(it.name) } : it);

// ========== ДОКУМЕНТЫ (v40): разделы home/auto/personal, файлы любых типов ==========
const DOC_CATEGORIES = ['home', 'auto', 'personal'];
const DOCS_MIGRATION_HINT = 'Если ошибка про отсутствие таблицы — выполни supabase-migration-v25-docs.sql в SQL Editor проекта householder (Supabase)';

// GET /api/docs — все разделы с файлами (командное пространство, как CRM)
app.get('/api/docs', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('doc_sections').select('*');
    if (error) throw error;
    const sections = { home: [], auto: [], personal: [] };
    (data || []).forEach(r => {
      if (!sections[r.category]) return;
      const arr = Array.isArray(r.attachments) ? r.attachments : [];
      // v57.5: старые записи с кракозяброй в name чиним на лету (без миграции данных)
      sections[r.category] = fixDocsAttachments(arr); // v59.2: общий хелпер
    });
    res.json({ sections });
  } catch (e) {
    res.status(500).json({ error: e.message, hint: DOCS_MIGRATION_HINT });
  }
});

// POST /api/docs/:category/files — multipart/form-data, поле files (любые типы, ≤500 МБ на файл)
app.post('/api/docs/:category/files', requireAuth, crmMediaMulter('files'), async (req, res) => {
  try {
    const cat = String(req.params.category || '');
    if (!DOC_CATEGORIES.includes(cat)) return res.status(400).json({ error: 'Неизвестный раздел (нужен home, auto или personal)' });
    const userName = req.user.name || req.user.id;
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'Нет файлов: передайте поле files (multipart/form-data)' });
    // v57.9: структура загружаемой папки — относительные пути файлов (JSON-массив в поле paths)
    let pathsArr = [];
    try { pathsArr = JSON.parse(req.body.paths || '[]'); } catch (_) { pathsArr = []; }
    const items = [];
    let lastErr = null;
    let fIdx = 0;
    for (const f of files) {
      const relPath = String(pathsArr[fIdx] || '').trim().slice(0, 200).replace(/^\/+|\/+$/g, '');
      fIdx++;
      try {
        const mt = f.mimetype || '';
        const mkind = /^image\//.test(mt) ? 'photo' : /^video\//.test(mt) ? 'video' : /^audio\//.test(mt) ? 'audio'
          : (mt === 'application/pdf' || /^text\//.test(mt) || /\.(pdf|txt|md|csv)$/i.test(f.originalname || '')) ? 'doc' : 'file';
        let buf = f.buffer, ct = mt || 'application/octet-stream';
        if (mkind === 'photo') { buf = await processImage(f.buffer); ct = 'image/jpeg'; }
        if (mkind === 'video' && f.size > 48 * 1024 * 1024) { buf = await compressVideoBuffer(f.buffer); ct = 'video/mp4'; }
        const fixedName = fixUtf8Name(f.originalname || 'file');
        const url = await uploadToStorage(buf, fixedName, `docs/${cat}`, ct);
        const folder = String(req.body.folder || '').trim().slice(0, 40);
        const item = { url, kind: mkind, name: fixedName, ts: Date.now(), actor: userName };
        if (folder) item.folder = folder; // v57.7: подпапка раздела (Дома: Dude/Kit/Maria; Авто: Mercedes/Porsche/Volvo)
        if (relPath) item.path = relPath; // v57.9: путь внутри загруженной папки (вложенные подпапки сохраняются)
        items.push(item);
      } catch (e) { console.error('Docs file skip:', e.message); lastErr = e.message; }
    }
    if (!items.length) return res.status(400).json({ error: 'Не удалось загрузить ни одного файла' + (lastErr ? `. Причина: ${lastErr}` : '') });
    const { data: row } = await supabaseAdmin.from('doc_sections').select('*').eq('category', cat).maybeSingle();
    const cur = row && Array.isArray(row.attachments) ? row.attachments : [];
    const { data, error } = await supabaseAdmin.from('doc_sections')
      .upsert({ category: cat, attachments: [...cur, ...items], updated_at: new Date().toISOString() }, { onConflict: 'category' })
      .select().single();
    if (error) throw error;
    res.json({ category: cat, attachments: fixDocsAttachments(data.attachments) }); // v59.2: имена без кракозябры во всех ответах
  } catch (e) {
    res.status(500).json({ error: e.message, hint: DOCS_MIGRATION_HINT });
  }
});

// POST /api/docs/recognize-text (v57.6): распознавание текста файла из вкладки «Документы» —
// страницы (поле pages: фото/JPEG или PDF) → vision OCR + перевод, БЕЗ сохранения в receipts.
// Ответ: { pages: [{ original, russian }] }
app.post('/api/docs/recognize-text', requireAuth, crmMediaMulter('pages'), async (req, res) => {
  try {
    if (!genAI) return res.status(500).json({ error: 'Распознавание текста требует GEMINI_API_KEY на бэкенде' });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'Нет файлов: передайте поле pages (multipart/form-data)' });
    if (files.length > 30) return res.status(400).json({ error: `Слишком много страниц (${files.length}) — максимум 30 за раз` });
    const texts = await runWithConcurrency(files, async (f, i) => {
      try {
        const mt = f.mimetype || 'image/jpeg';
        const buf = mt === 'application/pdf' ? f.buffer : await processImage(f.buffer);
        return await extractPageTextWithGemini(buf, mt, i + 1, files.length);
      } catch (e) {
        console.error(`docs recognize-text: страница ${i + 1} не распознана:`, e.message);
        return `(страница не распознана: ${e.message})`;
      }
    }, 3);
    const rus = await runWithConcurrency(texts, async (t) => {
      if (/^\((ошибка|страница без текста|страница не распознана)/.test(t)) return t;
      let ru = await translateRawText(t);
      if (!ru || looksUntranslated(t, ru)) {
        await new Promise(r => setTimeout(r, 1500));
        ru = await translateRawText(t);
      }
      return (!ru || looksUntranslated(t, ru)) ? t : ru;
    }, 3);
    res.json({ success: true, pages: texts.map((t, i) => ({ original: t, russian: rus[i] })) });
  } catch (e) {
    console.error('docs recognize-text error:', e);
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/docs/:category/files — операции над файлами/папками раздела:
//  {url, ocr:{pages}, docDate?}        — распознанный текст (v57.7) + дата документа (v59)
//  {url, docDate}                      — только дата документа (v59)
//  {urls:[…], folder:'X'}              — переместить файлы в подпапку (v59, мультивыбор; '' — убрать из папки)
//  {folderRename:{from,to}}            — переименовать подпапку (v59)
//  {folderDelete:'X'}                  — удалить подпапку: файлы остаются, поле folder снимается (v59)
app.patch('/api/docs/:category/files', requireAuth, async (req, res) => {
  try {
    const cat = String(req.params.category || '');
    if (!DOC_CATEGORIES.includes(cat)) return res.status(400).json({ error: 'Неизвестный раздел (нужен home, auto или personal)' });
    const body = req.body || {};
    const { data: row, error: e0 } = await supabaseAdmin.from('doc_sections').select('*').eq('category', cat).maybeSingle();
    if (e0) throw e0;
    const cur = row && Array.isArray(row.attachments) ? row.attachments : [];
    const objIt = (it) => (it && typeof it === 'object');
    let next = cur;

    if (Array.isArray(body.urls) && typeof body.path === 'string' && typeof body.folder !== 'string') {
      // v68.7: перемещение группы файлов в папку СТРУКТУРЫ (item.path); '' — в корень дерева
      const set = new Set(body.urls.slice(0, 500).map(String));
      const tp = body.path.trim().slice(0, 200).replace(/^\/+|\/+$/g, '');
      let cnt = 0;
      next = cur.map(it => {
        if (!objIt(it) || !set.has(it.url)) return it;
        cnt++;
        const o = { ...it };
        // v68.7.1: path хранится ВКЛЮЧАЯ имя файла — к папке дописываем имя
        const fn = String(it.name || '').trim() || decodeURIComponent(String(it.url || '').split('/').pop() || 'file');
        if (tp) o.path = tp + '/' + fn;
        else o.path = fn; // корень дерева — путь = просто имя файла
        return o;
      });
      if (!cnt) return res.status(404).json({ error: 'Файлы не найдены в разделе' });
    } else if (Array.isArray(body.urls) && typeof body.folder === 'string') {
      // v59: перемещение группы файлов в подпапку
      const set = new Set(body.urls.slice(0, 500).map(String));
      const folder = body.folder.trim().slice(0, 40);
      let cnt = 0;
      next = cur.map(it => {
        if (!objIt(it) || !set.has(it.url)) return it;
        cnt++;
        const o = { ...it };
        if (folder) o.folder = folder; else delete o.folder;
        return o;
      });
      if (!cnt) return res.status(404).json({ error: 'Файлы не найдены в разделе' });
    } else if (body.pathRename && typeof body.pathRename.from === 'string') {
      // v66: переименование папки внутри загруженной СТРУКТУРЫ (item.path): префикс from → to
      const from = body.pathRename.from.trim().slice(0, 200).replace(/^\/+|\/+$/g, '');
      const to = String(body.pathRename.to || '').trim().slice(0, 200).replace(/^\/+|\/+$/g, '');
      if (!from || !to) return res.status(400).json({ error: 'Передайте pathRename {from, to}' });
      if (from === to) return res.status(400).json({ error: 'Имя не изменилось' });
      let rcnt = 0;
      next = cur.map(it => {
        if (!objIt(it) || typeof it.path !== 'string') return it;
        const ip = it.path.replace(/^\/+|\/+$/g, '');
        if (ip === from || ip.startsWith(from + '/')) {
          rcnt++;
          return { ...it, path: to + ip.slice(from.length) };
        }
        return it;
      });
      if (!rcnt) return res.status(404).json({ error: 'Папка структуры не найдена' });
    } else if (body.folderRename && typeof body.folderRename.from === 'string') {
      // v59: переименование подпапки
      const from = body.folderRename.from.trim().slice(0, 40);
      const to = String(body.folderRename.to || '').trim().slice(0, 40);
      if (!from || !to) return res.status(400).json({ error: 'Передайте folderRename {from, to}' });
      if (from === to) return res.status(400).json({ error: 'Имя не изменилось' });
      next = cur.map(it => (objIt(it) && it.folder === from) ? { ...it, folder: to } : it);
    } else if (typeof body.folderDelete === 'string') {
      // v59: удаление подпапки (файлы НЕ удаляются — попадают в «Все»)
      const f = body.folderDelete.trim().slice(0, 40);
      next = cur.map(it => {
        if (!objIt(it) || it.folder !== f) return it;
        const o = { ...it };
        delete o.folder;
        return o;
      });
    } else {
      // v57.7/v59: OCR-текст и/или дата документа
      const url = body.url;
      const ocr = body.ocr;
      const docDate = (typeof body.docDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.docDate)) ? body.docDate : null;
      if (!url) return res.status(400).json({ error: 'Передайте url файла' });
      const hasOcr = ocr && Array.isArray(ocr.pages) && ocr.pages.length;
      if (!hasOcr && !docDate) return res.status(400).json({ error: 'Передайте ocr {pages:[…]} и/или docDate (YYYY-MM-DD)' });
      let found = false;
      next = cur.map(it => {
        const iu = typeof it === 'string' ? it : it && it.url;
        if (iu !== url || !objIt(it)) return it;
        found = true;
        const o = { ...it };
        if (hasOcr) o.ocr = { pages: ocr.pages.slice(0, 60), ts: Date.now() };
        if (docDate) o.docDate = docDate;
        return o;
      });
      if (!found) return res.status(404).json({ error: 'Файл не найден в разделе' });
    }
    const { data, error } = await supabaseAdmin.from('doc_sections')
      .upsert({ category: cat, attachments: next, updated_at: new Date().toISOString() }, { onConflict: 'category' })
      .select().single();
    if (error) throw error;
    res.json({ category: cat, attachments: fixDocsAttachments(data.attachments) }); // v59.2: имена без кракозябры во всех ответах
  } catch (e) {
    res.status(500).json({ error: e.message, hint: DOCS_MIGRATION_HINT });
  }
});

// DELETE /api/docs/:category/files — body {url}
app.delete('/api/docs/:category/files', requireAuth, async (req, res) => {
  try {
    const cat = String(req.params.category || '');
    if (!DOC_CATEGORIES.includes(cat)) return res.status(400).json({ error: 'Неизвестный раздел (нужен home, auto или personal)' });
    const b = req.body || {};
    const urls = Array.isArray(b.urls) ? b.urls.map(String).slice(0, 500) : (b.url ? [String(b.url)] : []); // v59: urls[] — мультивыбор
    if (!urls.length) return res.status(400).json({ error: 'Передайте url файла (или массив urls)' });
    const delSet = new Set(urls);
    const { data: row, error: e0 } = await supabaseAdmin.from('doc_sections').select('*').eq('category', cat).maybeSingle();
    if (e0) throw e0;
    const cur = row && Array.isArray(row.attachments) ? row.attachments : [];
    const next = cur.filter(u => !delSet.has(typeof u === 'string' ? u : u && u.url));
    if (next.length === cur.length) return res.status(404).json({ error: 'Файл не найден в разделе' });
    const { data, error } = await supabaseAdmin.from('doc_sections')
      .upsert({ category: cat, attachments: next, updated_at: new Date().toISOString() }, { onConflict: 'category' })
      .select().single();
    if (error) throw error;
    res.json({ category: cat, attachments: fixDocsAttachments(data.attachments) }); // v59.2: имена без кракозябры во всех ответах
  } catch (e) {
    res.status(500).json({ error: e.message, hint: DOCS_MIGRATION_HINT });
  }
});

// ========== ПЛАНОВЫЕ ПЛАТЕЖИ (v41): ручные записи календаря обязательных платежей ==========
const ppToApi = (r) => r && ({
  id: r.id, title: r.title, category: r.category || 'other',
  amount: r.amount != null ? Number(r.amount) : null,
  dayOfMonth: r.day_of_month != null ? Number(r.day_of_month) : null,
  freqMonths: r.freq_months != null ? Number(r.freq_months) : 1,
  counterparty: r.counterparty || '', startDate: r.start_date || '',
  objectName: r.object_name || '', fileUrl: r.file_url || '', fileName: r.file_name || '',
  note: r.note || '', active: r.active !== false,
  createdAt: r.created_at ? Date.parse(r.created_at) : null
});

app.get('/api/planned-payments', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('planned_payments').select('*').order('active', { ascending: false }).order('day_of_month', { ascending: true });
    if (error) throw error;
    res.json({ items: (data || []).map(ppToApi) });
  } catch (e) {
    res.status(500).json({ error: e.message, hint: 'Выполни supabase-migration-v26-planned-payments.sql в SQL Editor проекта householder' });
  }
});

app.post('/api/planned-payments', requireAuth, async (req, res) => {
  try {
    const { title, category, amount, day_of_month, note, freq_months, counterparty, start_date, object_name, file_url, file_name } = req.body || {};
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'Поле title обязательно' });
    const day = Math.max(1, Math.min(31, parseInt(day_of_month, 10) || 1));
    const { data, error } = await supabaseAdmin.from('planned_payments')
      .insert([{ owner_id: req.user.id, title: String(title).trim(), category: category || 'other', amount: amount != null && amount !== '' ? Number(amount) : null, day_of_month: day, note: note || null, freq_months: [0, 1, 2, 6, 12].includes(Number(freq_months)) ? Number(freq_months) : 1, counterparty: counterparty || null, start_date: start_date || null, object_name: object_name || null, file_url: file_url || null, file_name: file_name || null }])
      .select().single();
    if (error) throw error;
    res.json({ item: ppToApi(data) });
  } catch (e) {
    res.status(500).json({ error: e.message, hint: 'Выполни supabase-migration-v26-planned-payments.sql в SQL Editor проекта householder' });
  }
});

// Переключение активности планового платежа (v49): POST toggle (CORS-safe) + PATCH
const togglePlannedHandler = async (req, res) => {
  try {
    const { active } = req.body || {};
    const { data, error } = await supabaseAdmin.from('planned_payments').update({ active: active !== false }).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ item: ppToApi(data) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
app.post('/api/planned-payments/:id/toggle', requireAuth, togglePlannedHandler);
app.patch('/api/planned-payments/:id', requireAuth, togglePlannedHandler);

// Загрузка файла фактуры к плановому платежу (v46): multipart/form-data, поле file
app.post('/api/planned-payments/upload', requireAuth, crmMediaMulter('file'), async (req, res) => {
  try {
    const f = (req.files && req.files[0]) || req.file;
    if (!f) return res.status(400).json({ error: 'Файл не получен' });
    // multer отдаёт originalname в latin1 — восстанавливаем UTF-8 (русские имена файлов)
    let origName = f.originalname || 'factura';
    try { const dec = Buffer.from(origName, 'latin1').toString('utf8'); if (!dec.includes('�')) origName = dec; } catch (_) {}
    const url = await uploadToStorage(f.buffer, origName, req.user.id, f.mimetype || 'application/octet-stream');
    res.json({ url, name: origName });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/planned-payments/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabaseAdmin.from('planned_payments').update({ active: false }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/crm/contacts', requireAuth, async (req, res) => {
  try {
    const { counterparty_id, name, position, phone, email, comment } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Поле name обязательно' });
    const { data, error } = await supabaseAdmin
      .from('crm_contacts')
      .insert([{ owner_id: req.user.id, counterparty_id: counterparty_id || null, name: String(name).trim(), position: position || null, phone: phone || null, email: email || null, comment: comment || null }])
      .select()
      .single();
    if (error) throw error;
    res.json({ contact: crmContactToApi(data) });
  } catch (e) {
    res.status(500).json({ error: e.message, hint: CRM_MIGRATION_HINT });
  }
});

app.put('/api/crm/contacts/:id', requireAuth, async (req, res) => {
  try {
    const FIELDS = ['counterparty_id', 'name', 'position', 'phone', 'email', 'comment'];
    const updates = {};
    for (const k of FIELDS) {
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, k)) updates[k] = req.body[k] === '' ? null : req.body[k];
    }
    if (updates.name !== undefined && !String(updates.name || '').trim()) return res.status(400).json({ error: 'Поле name обязательно' });
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Нет полей для обновления' });
    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin.from('crm_contacts').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ contact: crmContactToApi(data) });
  } catch (e) {
    res.status(500).json({ error: e.message, hint: CRM_MIGRATION_HINT });
  }
});

app.delete('/api/crm/contacts/:id', requireAuth, async (req, res) => {
  try {
    // задачи отвязываются сами: FK crm_tasks.contact_id ON DELETE SET NULL (миграция v21)
    const { error } = await supabaseAdmin.from('crm_contacts').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message, hint: CRM_MIGRATION_HINT });
  }
});

// ---- CRM: задачи ----
app.post('/api/crm/tasks', requireAuth, async (req, res) => {
  try {
    const { title, description, counterparty_id, contact_id, assignee, due_date, priority } = req.body || {};
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'Поле title обязательно' });
    const userName = req.user.name || req.user.id;
    const row = {
      owner_id: req.user.id,
      title: String(title).trim(),
      description: description || null,
      counterparty_id: counterparty_id || null,
      contact_id: contact_id || null,
      assignee: assignee ? String(assignee).trim() : null,
      created_by: userName,
      due_date: due_date || null,
      priority: priority || 'normal',
      status: 'open',
      timeline: [{ ts: Date.now(), actor: userName, action: 'created', note: due_date ? `Срок: ${due_date}` : '' }]
    };
    const { data, error } = await supabaseAdmin.from('crm_tasks').insert([row]).select().single();
    if (error) throw error;
    res.json({ task: crmTaskToApi(data) });
  } catch (e) {
    res.status(500).json({ error: e.message, hint: CRM_MIGRATION_HINT });
  }
});

app.put('/api/crm/tasks/:id', requireAuth, async (req, res) => {
  try {
    const { data: t, error: e0 } = await supabaseAdmin.from('crm_tasks').select('*').eq('id', req.params.id).single();
    if (e0 || !t) return res.status(404).json({ error: 'Задача не найдена' });
    const userName = req.user.name || req.user.id;
    if (t.created_by !== userName && t.assignee !== userName && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Редактировать может постановщик или исполнитель задачи' });
    }
    const FIELDS = ['title', 'description', 'counterparty_id', 'contact_id', 'assignee', 'due_date', 'priority'];
    const updates = {};
    for (const k of FIELDS) {
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, k)) updates[k] = req.body[k] === '' ? null : req.body[k];
    }
    if (updates.title !== undefined && !String(updates.title || '').trim()) return res.status(400).json({ error: 'Поле title обязательно' });
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Нет полей для обновления' });
    updates.timeline = [...(Array.isArray(t.timeline) ? t.timeline : []), { ts: Date.now(), actor: userName, action: 'edited', note: '' }];
    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin.from('crm_tasks').update(updates).eq('id', t.id).select().single();
    if (error) throw error;
    res.json({ task: crmTaskToApi(data) });
  } catch (e) {
    res.status(500).json({ error: e.message, hint: CRM_MIGRATION_HINT });
  }
});

// Действие со статусом: done (исполнитель) / confirm, return (постановщик) / comment (все).
// Каждое действие дописывает событие в timeline — это и есть таймлайн исполнения.
app.post('/api/crm/tasks/:id/action', requireAuth, async (req, res) => {
  try {
    const { action, note } = req.body || {};
    const userName = req.user.name || req.user.id;
    const { data: t, error: e0 } = await supabaseAdmin.from('crm_tasks').select('*').eq('id', req.params.id).single();
    if (e0 || !t) return res.status(404).json({ error: 'Задача не найдена' });

    const ev = { ts: Date.now(), actor: userName, action, note: (note || '').trim() };
    const nowIso = new Date().toISOString();
    let patch = null;

    if (action === 'done') {
      if (t.status !== 'open') return res.status(409).json({ error: 'Задача не в статусе «В работе»' });
      if (t.assignee && t.assignee !== userName && req.user.role !== 'admin') {
        return res.status(403).json({ error: `Отметить выполненной может только исполнитель: ${t.assignee}` });
      }
      patch = { status: 'pending_confirm', done_at: nowIso };
    } else if (action === 'confirm') {
      if (t.status !== 'pending_confirm') return res.status(409).json({ error: 'Задача не ждёт подтверждения' });
      if (t.created_by !== userName && req.user.role !== 'admin') {
        return res.status(403).json({ error: `Подтвердить закрытие может только постановщик: ${t.created_by}` });
      }
      patch = { status: 'closed', closed_at: nowIso };
    } else if (action === 'return') {
      if (t.status !== 'pending_confirm') return res.status(409).json({ error: 'Задача не ждёт подтверждения' });
      if (t.created_by !== userName && req.user.role !== 'admin') {
        return res.status(403).json({ error: `Вернуть на доработку может только постановщик: ${t.created_by}` });
      }
      if (!ev.note) return res.status(400).json({ error: 'Напишите, что нужно исправить (комментарий обязателен)' });
      patch = { status: 'open' };
    } else if (action === 'comment') {
      if (!ev.note) return res.status(400).json({ error: 'Пустой комментарий' });
      patch = {};
    } else {
      return res.status(400).json({ error: 'Неизвестное действие: ' + action });
    }

    patch.timeline = [...(Array.isArray(t.timeline) ? t.timeline : []), ev];
    patch.updated_at = nowIso;
    const { data, error } = await supabaseAdmin.from('crm_tasks').update(patch).eq('id', t.id).select().single();
    if (error) throw error;
    res.json({ task: crmTaskToApi(data) });
  } catch (e) {
    res.status(500).json({ error: e.message, hint: CRM_MIGRATION_HINT });
  }
});

app.delete('/api/crm/tasks/:id', requireAuth, async (req, res) => {
  try {
    const { data: t, error: e0 } = await supabaseAdmin.from('crm_tasks').select('*').eq('id', req.params.id).single();
    if (e0 || !t) return res.status(404).json({ error: 'Задача не найдена' });
    const userName = req.user.name || req.user.id;
    if (t.created_by !== userName && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Удалить задачу может только постановщик' });
    }
    const { error } = await supabaseAdmin.from('crm_tasks').delete().eq('id', t.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message, hint: CRM_MIGRATION_HINT });
  }
});

// ========== CRM: ФОТООТЧЁТ ЗАДАЧИ (миграция supabase-migration-v22-crm-photos.sql) ==========
// photos_before / photos_after — jsonb-массивы URL в Storage (bucket receipt-images, папка crm/).
// Добавлять/удалять фото может постановщик или исполнитель; у закрытой задачи отчёт заморожен.
// Каждая операция дописывает событие в timeline (action: photo | photo_del).
// POST /api/crm/tasks/:id/photos?kind=before|after — multipart/form-data, поле photos (фото/видео/аудио, количество не ограничено, ≤500 МБ на файл)
app.post('/api/crm/tasks/:id/photos', requireAuth, crmMediaMulter('photos'), async (req, res) => {
  try {
    const kind = req.query.kind === 'after' ? 'after' : 'before';
    const col = kind === 'after' ? 'photos_after' : 'photos_before';
    const { data: t, error: e0 } = await supabaseAdmin.from('crm_tasks').select('*').eq('id', req.params.id).single();
    if (e0 || !t) return res.status(404).json({ error: 'Задача не найдена' });
    const userName = req.user.name || req.user.id;
    if (t.created_by !== userName && t.assignee !== userName && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Добавлять фото может постановщик или исполнитель задачи' });
    }
    if (t.status === 'closed') return res.status(409).json({ error: 'Задача закрыта — фотоотчёт изменить нельзя' });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'Нет файлов: передайте поле photos (multipart/form-data)' });
    const items = [];
    let lastErr = null;
    for (const f of files) {
      try {
        const mt = f.mimetype || '';
        const mkind = /^image\//.test(mt) ? 'photo' : /^video\//.test(mt) ? 'video' : /^audio\//.test(mt) ? 'audio' : (mt === 'application/pdf' || /^text\//.test(mt) || /\.(pdf|txt|md|csv)$/i.test(f.originalname || '')) ? 'doc' : null;
        if (!mkind) continue;
        let buf = f.buffer, ct = mt;
        if (mkind === 'photo') { buf = await processImage(f.buffer); ct = 'image/jpeg'; }
        if (mkind === 'video' && f.size > 48 * 1024 * 1024) { buf = await compressVideoBuffer(f.buffer); ct = 'video/mp4'; }
        if (mkind === 'doc' && !ct) ct = /\.pdf$/i.test(f.originalname || '') ? 'application/pdf' : 'text/plain';
        const url = await uploadToStorage(buf, `${kind}_${f.originalname || 'file'}`, 'crm', ct);
        items.push({ url, kind: mkind, name: f.originalname || '', ts: Date.now(), actor: userName });
      } catch (e) { console.error('CRM media skip:', e.message); lastErr = e.message; }
    }
    if (!items.length) return res.status(400).json({ error: 'Не удалось загрузить ни одного файла (нужны фото, видео, аудио, текст или PDF)' + (lastErr ? `. Причина: ${lastErr}` : '') });
    const nP = items.filter(u => u.kind === 'photo').length;
    const nV = items.filter(u => u.kind === 'video').length;
    const nA = items.filter(u => u.kind === 'audio').length;
    const parts = [];
    if (nP) parts.push(`фото +${nP}`);
    if (nV) parts.push(`видео +${nV}`);
    if (nA) parts.push(`аудио +${nA}`);
    const nD = items.filter(u => u.kind === 'doc').length;
    if (nD) parts.push(`документы +${nD}`);
    const cur = Array.isArray(t[col]) ? t[col] : [];
    const patch = {
      [col]: [...cur, ...items],
      timeline: [...(Array.isArray(t.timeline) ? t.timeline : []), { ts: Date.now(), actor: userName, action: 'photo', note: `Медиа «${kind === 'after' ? 'после' : 'до'}»: ${parts.join(', ')}` }],
      updated_at: new Date().toISOString()
    };
    const { data, error } = await supabaseAdmin.from('crm_tasks').update(patch).eq('id', t.id).select().single();
    if (error) throw error;
    res.json({ task: crmTaskToApi(data) });
  } catch (e) {
    res.status(500).json({ error: e.message, hint: CRM_MIGRATION_HINT });
  }
});

// DELETE /api/crm/tasks/:id/photos — body {kind: before|after, url}
app.delete('/api/crm/tasks/:id/photos', requireAuth, async (req, res) => {
  try {
    const kind = (req.body && req.body.kind) === 'after' ? 'after' : 'before';
    const col = kind === 'after' ? 'photos_after' : 'photos_before';
    const url = req.body && req.body.url;
    if (!url) return res.status(400).json({ error: 'Передайте url фото' });
    const { data: t, error: e0 } = await supabaseAdmin.from('crm_tasks').select('*').eq('id', req.params.id).single();
    if (e0 || !t) return res.status(404).json({ error: 'Задача не найдена' });
    const userName = req.user.name || req.user.id;
    if (t.created_by !== userName && t.assignee !== userName && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Удалять фото может постановщик или исполнитель задачи' });
    }
    if (t.status === 'closed') return res.status(409).json({ error: 'Задача закрыта — фотоотчёт изменить нельзя' });
    const cur = Array.isArray(t[col]) ? t[col] : [];
    const next = cur.filter(u => (typeof u === 'string' ? u : u && u.url) !== url);
    if (next.length === cur.length) return res.status(404).json({ error: 'Фото не найдено в отчёте задачи' });
    const patch = {
      [col]: next,
      timeline: [...(Array.isArray(t.timeline) ? t.timeline : []), { ts: Date.now(), actor: userName, action: 'photo_del', note: `Фото «${kind === 'after' ? 'после' : 'до'}»` }],
      updated_at: new Date().toISOString()
    };
    const { data, error } = await supabaseAdmin.from('crm_tasks').update(patch).eq('id', t.id).select().single();
    if (error) throw error;
    res.json({ task: crmTaskToApi(data) });
  } catch (e) {
    res.status(500).json({ error: e.message, hint: CRM_MIGRATION_HINT });
  }
});

// ========== BULK DELETE ==========
app.post('/api/bulk-delete', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    
    const { ids } = req.body;
    const { error } = await supabaseAdmin.from('receipts').delete().in('id', ids);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== BULK UPDATE OBJECT ==========
app.post('/api/bulk-update-object', requireAuth, async (req, res) => {
  try {
    const { ids, object } = req.body;
    const { error } = await supabaseAdmin.from('receipts').update({ object }).in('id', ids);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== BULK UPDATE CURRENCY ==========
app.post('/api/bulk-update-currency', requireAuth, async (req, res) => {
  try {
    const { ids, currency } = req.body;
    const { error } = await supabaseAdmin.from('receipts').update({ currency }).in('id', ids);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== BULK UPDATE DOCUMENT TYPE ==========
app.post('/api/bulk-update-type', requireAuth, async (req, res) => {
  try {
    const { ids, document_type } = req.body;
    const ALLOWED_TYPES = ['receipt', 'invoice', 'bill', 'insurance', 'bank', 'contract', 'municipality', 'tax', 'proposal', 'annual_accounts', 'tax_form', 'other'];
    if (!ALLOWED_TYPES.includes(document_type)) {
      return res.status(400).json({ error: `document_type должен быть одним из: ${ALLOWED_TYPES.join(', ')}` });
    }
    const { error } = await supabaseAdmin.from('receipts').update({ document_type }).in('id', ids);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== BULK UPDATE SUBTYPE (подтип услуги: вода, электричество, интернет, мусор...) ==========
app.post('/api/bulk-update-subtype', requireAuth, async (req, res) => {
  try {
    const { ids, subtype } = req.body;
    const ALLOWED_SUBTYPES = ['electricity', 'water', 'gas', 'internet', 'phone', 'comunidad', 'rent', 'waste', 'insurance_home', 'insurance_car', 'insurance_health', 'tax', 'other'];
    if (!ALLOWED_SUBTYPES.includes(subtype)) {
      return res.status(400).json({ error: `subtype должен быть одним из: ${ALLOWED_SUBTYPES.join(', ')}` });
    }
    const { error } = await supabaseAdmin.from('receipts').update({ subtype }).in('id', ids);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== BULK UPDATE PAYMENT STATUS (к оплате / оплачено / недоплачено; null — очистить) ==========
app.post('/api/bulk-update-payment-status', requireAuth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'Нет id документов' });
    // Допустимы три значения; null/пустое — очистка статуса
    const status = req.body.payment_status == null || req.body.payment_status === ''
      ? null
      : sanitizePaymentStatus(req.body.payment_status);
    if (req.body.payment_status && !status) {
      return res.status(400).json({ error: 'payment_status должен быть одним из: to_pay, paid, underpaid (или пусто — очистить)' });
    }
    const { error } = await supabaseAdmin.from('receipts').update({ payment_status: status }).in('id', ids);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: withDbSchemaHint(e.message) });
  }
});

// Подсказка к ошибкам Supabase про отсутствующие объекты схемы («... in the schema cache»):
// либо не выполнена миграция, либо PostgREST держит старый кэш после ALTER/CREATE TABLE
function withDbSchemaHint(msg) {
  let m = String(msg || '');
  if (/payment_status/i.test(m)) {
    m += ' | РЕШЕНИЕ: выполни supabase-migration-v19.sql в Supabase SQL Editor (ПРОЕКТ householder!): alter table receipts add column if not exists payment_status text; — и затем: notify pgrst, \'reload schema\';';
  }
  if (/has_invoice/i.test(m)) {
    m += ' | РЕШЕНИЕ: выполни supabase-migration-v21.sql в Supabase SQL Editor (ПРОЕКТ householder!): alter table bank_movements add column if not exists has_invoice boolean not null default false; — и затем: notify pgrst, \'reload schema\';';
  }
  if (/bank_movements/i.test(m)) {
    m += ' | РЕШЕНИЕ: выполни supabase-migration-v20.sql в Supabase SQL Editor (ПРОЕКТ householder!) — таблица bank_movements + колонки receipts.bank_movement_id/paid_date; затем: notify pgrst, \'reload schema\';';
  }
  if (/row-level security/i.test(m)) {
    m += ' | РЕШЕНИЕ (RLS): в таблице включена Row-Level Security. Выполни supabase-migration-v20.sql ЦЕЛИКОМ в SQL Editor проекта householder (там есть alter table bank_movements disable row level security + разрешающая policy) — проверь проект по SUPABASE_URL в Railway → householder-api → Variables. Лучшее долгосрочное решение: добавь в Railway → householder-api → Variables переменную SUPABASE_SERVICE_ROLE_KEY (Supabase → Settings → API → service_role key) — с ней бэкенд обходит RLS полностью.';
  }
  return m;
}

// ========== БАНКОВСКИЕ ВЫПИСКИ: импорт Excel + автопривязка фактур к платежам (v24) ==========
// Формат выписки Ruralvía/Caja Rural (.xlsx): строки-метаданные (Nombre, IBAN),
// строка заголовков (Fecha de la operación | Fecha valor | Tipo movimiento | Importe | Saldo | Nro. Apunte),
// далее движения. Importe < 0 — платёж, > 0 — поступление. Nro. Apunte + IBAN — ключ дедупликации.

// Стоп-слова для нормализации контрагентов (юр. формы и предлоги не несут смысла)
const CP_STOPWORDS = new Set(['de', 'del', 'la', 'el', 'y', 'en', 'los', 'las', 'the', 'of', 'por', 'para', 'con',
  'sa', 'sl', 'sau', 'slu', 'slne', 'scp', 'bv', 'inc', 'gmbh', 'srl', 'llc', 'co', 'sociedad', 'anonima', 'limitada']);

// Токены имени контрагента: нижний регистр, без акцентов/пунктуации, без стоп-слов
function counterpartyTokens(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9а-яё\s]/gi, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && !CP_STOPWORDS.has(t));
}

// Похожесть имён: доля общих токенов от КОРОТКОГО имени (containment) —
// «o2 fibra telefonica» vs «Telefónica» = 1.0, «Plenitude» vs «plenitude energy solutions» = 1.0
function counterpartySim(a, b) {
  const ta = new Set(counterpartyTokens(a));
  const tb = new Set(counterpartyTokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

// «rcbo.o2 fibra - telefonica de espana sau» → { prefix: 'rcbo', concept: 'o2 fibra - ...' }
// «cuotas tes.gral.seg. socia» → { prefix: 'cuotas', concept: 'tes.gral.seg. socia' }
function parseMovementConcept(tipoMovimiento) {
  const raw = String(tipoMovimiento || '').trim();
  const m = raw.match(/^([a-zñ]{1,8})\s*[.:]\s*(.+)$/i);
  if (m) return { prefix: m[1].toLowerCase(), concept: m[2].trim() };
  const m2 = raw.match(/^([a-zñ]{2,8})\s+(.+)$/i);
  if (m2) return { prefix: m2[1].toLowerCase(), concept: m2[2].trim() };
  return { prefix: '', concept: raw };
}

// Дата из Excel: Date-объект (cellDates), серийное число (25569 = 1970-01-01) или строка dd.mm.yyyy
function excelDateToIso(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && isFinite(v)) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const d = new Date(v);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  const m = String(v).match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

// Автопривязка: платёжные движения (amount<0) без пары ↔ фактуры без bank_movement_id.
// Баллы: сумма до цента — ворота (+50); имя (маx по названию/переводу/поставщику) до +30;
// дата (счёт до платежа, окно −7…+75 дн) до +15; № фактуры/договора в концепте +40.
// Авто: strong-ID, либо ≥80 баллов с отрывом ≥10 от второго кандидата. Побочный эффект: receipt → 🟢 paid + paid_date.
async function runBankMatching(ownerId, iban) {
  let mvQuery = supabaseAdmin.from('bank_movements')
    .select('*').is('matched_receipt_id', null).lt('amount', 0);
  if (iban) mvQuery = mvQuery.eq('iban', iban);
  const { data: movements, error: e1 } = await mvQuery;
  if (e1) throw e1;
  if (!movements || !movements.length) return { matched: 0, candidates: 0 };

  const { data: receiptsRaw, error: e2 } = await supabaseAdmin.from('receipts')
    .select('id, store_name, store_name_ru, provider, receipt_date, total_amount, invoice_number, contract_number, payment_status')
    .is('bank_movement_id', null).not('total_amount', 'is', null);
  if (e2) throw e2;
  // Исключаем фактуры, у которых уже есть ЛЮБАЯ привязка (matched_receipt_id в движениях) —
  // важно для разбитой оплаты: там bank_movement_id = null, но привязки уже есть
  const { data: usedLinks } = await supabaseAdmin.from('bank_movements')
    .select('matched_receipt_id').not('matched_receipt_id', 'is', null);
  const usedIds = new Set((usedLinks || []).map(l => l.matched_receipt_id));
  const receipts = (receiptsRaw || []).filter(r => !usedIds.has(r.id) && r.payment_status !== 'paid');

  let matched = 0;
  for (const mv of movements) {
    const amt = Math.abs(Number(mv.amount));
    const opDate = mv.operation_date ? new Date(mv.operation_date) : null;
    const conceptText = `${mv.concept || ''} ${mv.counterparty || ''}`;
    const conceptDigits = conceptText.replace(/\D/g, '');
    const scored = [];
    for (const r of receipts || []) {
      if (r.bank_movement_id || r._taken) continue; // уже привязана в этом прогоне
      const rAmt = Math.abs(Number(r.total_amount));
      if (!isFinite(rAmt) || Math.abs(rAmt - amt) > 0.011) continue; // сумма — обязательные ворота
      let score = 50;
      const sim = Math.max(
        counterpartySim(conceptText, r.store_name),
        counterpartySim(conceptText, r.store_name_ru),
        counterpartySim(conceptText, r.provider)
      );
      score += Math.round(30 * sim);
      if (opDate && r.receipt_date) {
        const days = Math.round((opDate.getTime() - new Date(r.receipt_date).getTime()) / 86400000);
        if (days >= -2 && days <= 45) score += 15;
        else if (days >= -7 && days <= 75) score += 8;
      }
      const strong = [r.invoice_number, r.contract_number].filter(Boolean)
        .some(n => { const d = String(n).replace(/\D/g, ''); return d.length >= 5 && conceptDigits.includes(d); });
      if (strong) score += 40;
      scored.push({ r, score: Math.min(100, score), strong, sim });
    }
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    const second = scored[1];
    // v67: достаточно и «точная сумма + похожее название» (sim ≥ 0.55) — случай «cerrajeria mundo llave» ↔ «Mundo Llave» (51 день → без бонуса за дату)
    const confident = best && (best.strong
      || (best.score >= 80 && (!second || best.score - second.score >= 10))
      || (best.sim >= 0.55 && (!second || best.score - second.score >= 5)));
    // v67.2: сумма не совпала — автопривязка по НАЗВАНИЮ, только если кандидат УНИКАЛЕН (sim >= 0.7).
    // Повторяющиеся платежи одному поставщику (eni, naturgy...) дают несколько одинаковых sim -> НЕ привязываем.
    let namePick = null;
    if (!confident) {
      const nameCands = [];
      for (const r of receipts || []) {
        if (r.bank_movement_id || r._taken) continue;
        const sim = Math.max(
          counterpartySim(conceptText, r.store_name),
          counterpartySim(conceptText, r.store_name_ru),
          counterpartySim(conceptText, r.provider)
        );
        if (sim >= 0.7) nameCands.push({ r, sim });
      }
      nameCands.sort((a, b) => b.sim - a.sim);
      if (nameCands.length && (!nameCands[1] || nameCands[0].sim - nameCands[1].sim >= 0.05)) namePick = nameCands[0];
    }
    if (confident || namePick) {
      const pick = confident ? best : { r: namePick.r, score: Math.round(namePick.sim * 100), strong: false, sim: namePick.sim };
      const byName = !confident;
      const now = new Date().toISOString();
      const { error: ue1 } = await supabaseAdmin.from('bank_movements')
        .update({ matched_receipt_id: pick.r.id, match_status: byName ? 'auto_name_delta' : 'auto', match_score: pick.score, matched_at: now })
        .eq('id', mv.id);
      if (ue1) { console.error('match: обновление движения не удалось:', ue1.message); continue; }
      // Статус оплаты: если сумма отличается — считаем покрытие по всем привязанным платежам
      let payStatus = 'paid';
      if (byName) {
        const { data: linked } = await supabaseAdmin.from('bank_movements')
          .select('amount').eq('matched_receipt_id', pick.r.id);
        const paidSum = (linked || []).reduce((acc, l) => acc + Math.abs(Number(l.amount) || 0), 0);
        payStatus = paidSum + 0.011 >= Math.abs(Number(pick.r.total_amount) || 0) ? 'paid' : 'underpaid';
      }
      const { error: ue2 } = await supabaseAdmin.from('receipts')
        .update({ bank_movement_id: mv.id, payment_status: payStatus, paid_date: mv.operation_date })
        .eq('id', pick.r.id);
      if (ue2) console.error('match: обновление фактуры не удалось:', ue2.message);
      pick.r.bank_movement_id = mv.id; pick.r._taken = true; // в этом прогоне фактура уже занята
      matched++;
      console.log(`match${byName ? ' (по названию, Δ!)' : ''}: «${mv.concept}» ${mv.amount} ↔ чек #${pick.r.id} (${pick.score} баллов)`);
    }
  }
  return { matched, candidates: movements.length };
}

// v60: общий импорт ОДНОЙ выписки (buffer .xlsx Ruralvía) → {account, iban, totalInFile, imported, skipped, autoMatched, unmatchedPayments}
async function importOneStatement(buffer, userId) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

    // Метаданные счёта в первых строках: Nombre / IBAN
    let accountName = null, iban = null;
    for (const row of grid.slice(0, 8)) {
      const c0 = String(row && row[0] || '').trim().toLowerCase();
      if (c0 === 'nombre') accountName = String(row[1] || '').trim() || null;
      if (c0 === 'iban') iban = String(row[1] || '').replace(/\s+/g, '') || null;
    }
    // Строка заголовков таблицы движений
    const hdrIdx = grid.findIndex(row => Array.isArray(row)
      && row.some(c => /fecha de la operaci/i.test(String(c || '')))
      && row.some(c => /importe/i.test(String(c || ''))));
    if (hdrIdx < 0) throw new Error('Не найден заголовок таблицы («Fecha de la operación» / «Importe») — похоже, это не выписка формата Ruralvía');
    const hdr = grid[hdrIdx].map(c => String(c || '').trim().toLowerCase());
    const col = (re) => hdr.findIndex(h => re.test(h));
    const cOp = col(/fecha de la operaci/), cVal = col(/fecha valor/), cTipo = col(/tipo/),
      cImp = col(/importe/), cSaldo = col(/saldo/), cAp = col(/apunte/);

    const batchId = crypto.randomUUID();
    const rows = [];
    for (let i = hdrIdx + 1; i < grid.length; i++) {
      const row = grid[i];
      if (!Array.isArray(row)) continue;
      const opDate = excelDateToIso(cOp >= 0 ? row[cOp] : null);
      const amount = cImp >= 0 ? Number(row[cImp]) : NaN;
      const tipo = cTipo >= 0 ? String(row[cTipo] || '').trim() : '';
      if (!opDate || !isFinite(amount) || !tipo) continue;
      const { prefix, concept } = parseMovementConcept(tipo);
      rows.push({
        owner_id: userId || null,
        iban, account_name: accountName,
        operation_date: opDate,
        value_date: excelDateToIso(cVal >= 0 ? row[cVal] : null),
        prefix, concept,
        counterparty: counterpartyTokens(concept).slice(0, 6).join(' ') || null,
        amount,
        balance: cSaldo >= 0 && row[cSaldo] != null && isFinite(Number(row[cSaldo])) ? Number(row[cSaldo]) : null,
        entry_number: cAp >= 0 && row[cAp] != null ? (parseInt(row[cAp], 10) || null) : null,
        import_batch: batchId
      });
    }
    if (!rows.length) throw new Error('В файле не найдено ни одного движения');

    // ДОГРУЗКА: сравниваем с уже загруженными движениями этого счёта и вставляем ТОЛЬКО новые.
    // Ключ 1: (iban, entry_number = Nro. Apunte). Ключ 2 (если апунте нет): дата + сумма + concept.
    // Существующие строки (и их привязки к фактурам) не трогаем вообще.
    const { data: existingRows } = await supabaseAdmin.from('bank_movements')
      .select('entry_number, operation_date, amount, concept')
      .eq('iban', iban || '');
    const existingKeys = new Set((existingRows || []).filter(e => e.entry_number != null).map(e => String(e.entry_number)));
    const existingSigs = new Set((existingRows || []).map(e =>
      `${e.operation_date}|${(Number(e.amount) || 0).toFixed(2)}|${String(e.concept || '').slice(0, 80)}`));
    const newRows = rows.filter(r =>
      r.entry_number != null
        ? !existingKeys.has(String(r.entry_number))
        : !existingSigs.has(`${r.operation_date}|${(Number(r.amount) || 0).toFixed(2)}|${String(r.concept || '').slice(0, 80)}`));
    const skipped = rows.length - newRows.length;

    let written = 0;
    for (let i = 0; i < newRows.length; i += 200) {
      const chunk = newRows.slice(i, i + 200);
      const { error } = await supabaseAdmin.from('bank_movements').insert(chunk);
      if (error) throw error;
      written += chunk.length;
    }

    const matchRes = await runBankMatching(userId, iban);
    console.log(`Выписка ${accountName || iban}: новых ${written}, пропущено дублей ${skipped}, автопривязка ${matchRes.matched}/${matchRes.candidates}`);
    return {
      imported: written, skipped, totalInFile: rows.length, account: accountName, iban,
      autoMatched: matchRes.matched, unmatchedPayments: matchRes.candidates - matchRes.matched
    };
}

// Импорт ОДНОЙ выписки .xlsx (Ruralvía): парсинг → догрузка без дублей → автопривязка
app.post('/api/import-bank-statement', requireAuth, upload.single('statement'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Нет файла выписки (.xlsx)' });
    const r = await importOneStatement(req.file.buffer, req.user?.id);
    res.json({ success: true, ...r });
  } catch (e) {
    res.status(500).json({ error: withDbSchemaHint(e.message) });
  }
});

// v60: Импорт НЕСКОЛЬКИХ выписок разом (поле statements, до 30 файлов) —
// каждый файл сравнивается с базой и с уже обработанными файлами пачки (дубликаты пропускаются).
// Ответ: { success, totals:{files, imported, skipped, autoMatched}, files:[{name, account, iban, totalInFile, imported, skipped, autoMatched} | {name, error}] }
app.post('/api/import-bank-statements', requireAuth, upload.array('statements', 30), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'Нет файлов: передайте поле statements (multipart/form-data)' });
    const results = [];
    const totals = { files: 0, imported: 0, skipped: 0, autoMatched: 0 };
    for (const f of files) {
      const name = fixUtf8Name(f.originalname || 'statement.xlsx');
      try {
        const r = await importOneStatement(f.buffer, req.user?.id); // последовательно: догрузка видит предыдущие файлы пачки
        results.push({ name, ...r });
        totals.files++;
        totals.imported += r.imported;
        totals.skipped += r.skipped;
        totals.autoMatched += r.autoMatched;
      } catch (e) {
        console.error(`Выписка «${name}»:`, e.message);
        results.push({ name, error: e.message });
      }
    }
    res.json({ success: true, totals, files: results });
  } catch (e) {
    res.status(500).json({ error: withDbSchemaHint(e.message) });
  }
});

// Список движений для вкладки «Анализ» (фронт обогащает данными чеков на своей стороне)
app.get('/api/bank-movements', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('bank_movements')
      .select('*')
      .order('operation_date', { ascending: false })
      .order('entry_number', { ascending: false })
      .limit(1000);
    if (error) throw error;
    res.json({ movements: data || [] });
  } catch (e) {
    res.status(500).json({ error: withDbSchemaHint(e.message) });
  }
});

// Пересчёт статуса оплаты фактуры по ВСЕМ привязанным к ней движениям (авто + ручные).
// Поддерживает разбитую оплату: одна фактура ← несколько платежей.
// Сумма платежей < суммы фактуры → 'underpaid'; >= → 'paid'; привязок нет → статус снимается.
async function recomputeReceiptPayment(receiptId) {
  try {
    const { data: r } = await supabaseAdmin.from('receipts')
      .select('id, total_amount').eq('id', receiptId).single();
    if (!r) return;
    const { data: linked } = await supabaseAdmin.from('bank_movements')
      .select('id, amount, operation_date').eq('matched_receipt_id', receiptId);
    const list = linked || [];
    const paidSum = list.reduce((s, m) => s + Math.abs(Number(m.amount) || 0), 0);
    const total = Math.abs(Number(r.total_amount) || 0);
    const lastDate = list.map(m => m.operation_date).filter(Boolean).sort().pop() || null;
    const patch = {
      paid_date: list.length ? lastDate : null,
      bank_movement_id: list.length === 1 ? list[0].id : null
    };
    if (!list.length) patch.payment_status = null;
    else if (total > 0 && paidSum + 0.01 < total) patch.payment_status = 'underpaid';
    else patch.payment_status = 'paid';
    await supabaseAdmin.from('receipts').update(patch).eq('id', receiptId);
  } catch (e) {
    console.error('recomputeReceiptPayment:', e.message);
  }
}

// Ручная привязка движения к фактуре (вкладка «Анализ»). Повторная привязка других
// движений к той же фактуре = разбитая оплата — статус пересчитается по сумме.
app.post('/api/link-bank-movement', requireAuth, async (req, res) => {
  try {
    const { movement_id, receipt_id } = req.body || {};
    if (!movement_id || !receipt_id) return res.status(400).json({ error: 'Нужны movement_id и receipt_id' });
    const { data: mv } = await supabaseAdmin.from('bank_movements')
      .select('id, matched_receipt_id').eq('id', movement_id).single();
    if (!mv) return res.status(404).json({ error: 'Движение не найдено' });
    const { error } = await supabaseAdmin.from('bank_movements')
      .update({ matched_receipt_id: receipt_id, match_status: 'manual', match_score: 100, matched_at: new Date().toISOString() })
      .eq('id', movement_id);
    if (error) throw error;
    if (mv.matched_receipt_id && mv.matched_receipt_id !== receipt_id) await recomputeReceiptPayment(mv.matched_receipt_id);
    await recomputeReceiptPayment(receipt_id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: withDbSchemaHint(e.message) });
  }
});

// v67.7: ручное добавление фактуры в выписку банка (из карточки фактуры).
// Создаёт платёжное движение (amount<0) и СРАЗУ привязывает его к фактуре.
// Поддерживает разбитую оплату: можно добавить несколько платежей к одной фактуре.
app.post('/api/bank-movements/manual', requireAuth, async (req, res) => {
  try {
    const { receipt_id, operation_date, amount, counterparty, concept } = req.body || {};
    if (!receipt_id) return res.status(400).json({ error: 'Нужен receipt_id' });
    const amt = Math.abs(Number(amount));
    if (!isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Некорректная сумма' });
    const opDate = String(operation_date || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opDate)) return res.status(400).json({ error: 'Дата в формате ГГГГ-ММ-ДД' });
    const { data: rc } = await supabaseAdmin.from('receipts')
      .select('id, store_name, store_name_ru, provider, total_amount, invoice_number').eq('id', receipt_id).single();
    if (!rc) return res.status(404).json({ error: 'Фактура не найдена' });
    const row = {
      owner_id: req.user?.id || null,
      iban: null,
      account_name: 'Ручное добавление',
      operation_date: opDate,
      value_date: opDate,
      prefix: 'manual',
      concept: concept || `Оплата фактуры ${rc.invoice_number || ''} ${rc.store_name || ''}`.trim(),
      counterparty: (counterparty || rc.store_name || rc.provider || '').slice(0, 120) || null,
      amount: -amt,
      balance: null,
      entry_number: null,
      import_batch: null,
      matched_receipt_id: receipt_id,
      match_status: 'manual',
      match_score: 100,
      matched_at: new Date().toISOString()
    };
    // v67.9.2: защита от дублей — тот же ручной платёж (фактура+дата+сумма) уже есть
    const { data: dup } = await supabaseAdmin.from('bank_movements')
      .select('id').eq('matched_receipt_id', receipt_id).eq('operation_date', opDate)
      .eq('amount', -amt).eq('prefix', 'manual').limit(1);
    if (dup && dup.length) return res.json({ success: true, movement_id: dup[0].id, duplicate: true });
    const { data: ins, error } = await supabaseAdmin.from('bank_movements').insert(row).select('id').single();
    if (error) throw error;
    await recomputeReceiptPayment(receipt_id);
    res.json({ success: true, movement_id: ins.id });
  } catch (e) {
    res.status(500).json({ error: withDbSchemaHint(e.message) });
  }
});

// v67.9.4: удаление РУЧНОГО платежа (созданного ошибочно «из карточки фактуры»).
// Выписка банка — главный документ: ручных строк в ней быть не должно.
// Удаляет только движения prefix='manual', фактуру отвязывает и пересчитывает статус.
app.delete('/api/bank-movements/manual/:id', requireAuth, async (req, res) => {
  try {
    const { data: mv } = await supabaseAdmin.from('bank_movements')
      .select('id, prefix, account_name, matched_receipt_id').eq('id', req.params.id).single();
    if (!mv) return res.status(404).json({ error: 'Движение не найдено' });
    const { data: full } = await supabaseAdmin.from('bank_movements')
      .select('iban, entry_number, import_batch').eq('id', req.params.id).single();
    const looksManual = mv.prefix === 'manual' || mv.account_name === 'Ручное добавление'
      || (full && !full.iban && full.entry_number == null && !full.import_batch);
    if (!looksManual) {
      return res.status(403).json({ error: 'Удалять можно только ручные платежи — строки банковской выписки не трогаем' });
    }
    const oldReceipt = mv.matched_receipt_id;
    const { error } = await supabaseAdmin.from('bank_movements').delete().eq('id', mv.id);
    if (error) throw error;
    if (oldReceipt) await recomputeReceiptPayment(oldReceipt);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: withDbSchemaHint(e.message) });
  }
});

// Отвязка движения от фактуры
app.post('/api/unlink-bank-movement', requireAuth, async (req, res) => {
  try {
    const { movement_id } = req.body || {};
    if (!movement_id) return res.status(400).json({ error: 'Нужен movement_id' });
    const { data: mv } = await supabaseAdmin.from('bank_movements')
      .select('id, matched_receipt_id, prefix, account_name, iban, entry_number, import_batch').eq('id', movement_id).single();
    if (!mv) return res.status(404).json({ error: 'Движение не найдено' });
    const oldReceipt = mv.matched_receipt_id;
    // v67.9.5/v68.0.1: ручной платёж — это НЕ строка банковской выписки; отвязка = удаление строки целиком.
    // Признак ручной: явный prefix/account_name ИЛИ нет ни IBAN, ни Nro.Apunte, ни пакета импорта.
    if (mv.prefix === 'manual' || mv.account_name === 'Ручное добавление' || (!mv.iban && mv.entry_number == null && !mv.import_batch)) {
      const { error: de } = await supabaseAdmin.from('bank_movements').delete().eq('id', movement_id);
      if (de) throw de;
      if (oldReceipt) await recomputeReceiptPayment(oldReceipt);
      return res.json({ success: true, deleted: true });
    }
    const { error } = await supabaseAdmin.from('bank_movements')
      .update({ matched_receipt_id: null, match_status: 'unmatched', match_score: null, matched_at: null })
      .eq('id', movement_id);
    if (error) throw error;
    if (oldReceipt) await recomputeReceiptPayment(oldReceipt);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: withDbSchemaHint(e.message) });
  }
});

// Галка «есть фактура на этот платёж» (вкладка «Налоги», v30)
// Требует supabase-migration-v21.sql (колонка bank_movements.has_invoice)
app.post('/api/bank-movement-invoice-flag', requireAuth, async (req, res) => {
  try {
    const { movement_id, movement_ids, has_invoice } = req.body || {};
    // v60.2: массовая установка/снятие галки «есть фактура» (movement_ids[], до 2000)
    if (Array.isArray(movement_ids) && movement_ids.length) {
      const ids = movement_ids.slice(0, 2000);
      const { error } = await supabaseAdmin.from('bank_movements')
        .update({ has_invoice: !!has_invoice })
        .in('id', ids);
      if (error) throw error;
      return res.json({ success: true, updated: ids.length });
    }
    if (!movement_id) return res.status(400).json({ error: 'Нужен movement_id (или массив movement_ids)' });
    const { error } = await supabaseAdmin.from('bank_movements')
      .update({ has_invoice: !!has_invoice })
      .eq('id', movement_id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: withDbSchemaHint(e.message) });
  }
});

// Повторный запуск автопривязки (по кнопке во фронте — после загрузки новых фактур)
app.post('/api/rematch-bank', requireAuth, async (req, res) => {
  try {
    const matchRes = await runBankMatching(req.user?.id, req.body?.iban || undefined);
    res.json({ success: true, autoMatched: matchRes.matched, unmatchedPayments: matchRes.candidates - matchRes.matched });
  } catch (e) {
    res.status(500).json({ error: withDbSchemaHint(e.message) });
  }
});

// ========== EXPORT EXCEL ==========
app.post('/api/export-excel', requireAuth, async (req, res) => {
  try {
    const { receiptIds } = req.body;
    let query = supabaseAdmin.from('receipts').select('*');
    if (receiptIds && receiptIds.length > 0) {
      query = query.in('id', receiptIds);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    
    const rows = (data || []).map(r => {
      const items = Array.isArray(r.items) ? r.items : [];
      const itemsText = items.map(i => `${i.name_ru || i.name} x${i.quantity} = ${i.total}`).join('; ');
      return {
        ID: r.id,
        Магазин: r.store_name_ru || r.store_name,
        Дата: r.receipt_date,
        Время: r.receipt_time,
        Сумма: r.total_amount,
        Валюта: r.currency,
        Тип: r.document_type,
        Объект: r.object,
        Товары: itemsText,
        Метод: r.recognition_method,
        Добавил: r.owner_name,
        Создан: r.created_at
      };
    });
    
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Receipts');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=receipts.xlsx');
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== LIST MODELS ==========
app.get('/api/list-gemini-models', async (req, res) => {
  if (!genAI) return res.json({ models: [] });
  res.json({
    models: [
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
      { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }
    ]
  });
});

app.get('/api/list-groq-models', async (req, res) => {
  if (!groq) return res.json({ models: [] });
  res.json({
    models: [
      { id: 'llama-3.2-90b-vision-preview', name: 'Llama 3.2 90B Vision' },
      { id: 'llama-3.2-11b-vision-preview', name: 'Llama 3.2 11B Vision' },
      { id: 'llama-4-scout', name: 'Llama 4 Scout' },
      { id: 'llama-4-maverick', name: 'Llama 4 Maverick' }
    ]
  });
});

app.get('/api/list-ocrspace-models', async (req, res) => {
  res.json({
    models: [
      { id: 'engine1', name: 'Engine 1 (Basic)' },
      { id: 'engine2', name: 'Engine 2 (Advanced)' },
      { id: 'engine3', name: 'Engine 3 (Handwriting)' }
    ]
  });
});

// ========== MODEL CHECKER (опрос моделей AI) ==========
const FALLBACK_GEMINI_IDS = [
  'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash',
  'gemini-2.0-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro'
];

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ]);
}

function prettifyModelName(id) {
  return String(id).split('/').pop()
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      try { results[i] = await fn(items[i]); }
      catch (e) { results[i] = { error: e.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function checkGeminiModels() {
  if (!genAI) {
    return FALLBACK_GEMINI_IDS.map(id => ({
      name: id, displayName: prettifyModelName(id), provider: 'Gemini',
      active: false, ms: null, error: 'GEMINI_API_KEY не задан'
    }));
  }
  let ids = FALLBACK_GEMINI_IDS;
  try {
    const res = await axios.get(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}&pageSize=100`,
      { timeout: 15000 }
    );
    const listed = (res.data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace(/^models\//, ''))
      .filter(id => /gemini/i.test(id) && !/embedding|aqa/i.test(id));
    if (listed.length > 0) ids = listed;
  } catch (e) {
    console.warn('Gemini models list failed, using fallback list:', e.message);
  }
  return mapWithConcurrency(ids, 4, async (id) => {
    const t0 = Date.now();
    try {
      const model = genAI.getGenerativeModel({ model: id, generationConfig: { maxOutputTokens: 8 } });
      await withTimeout(model.generateContent('Reply with OK'), 12000);
      return { name: id, displayName: prettifyModelName(id), provider: 'Gemini', active: true, ms: Date.now() - t0, error: null };
    } catch (e) {
      return { name: id, displayName: prettifyModelName(id), provider: 'Gemini', active: false, ms: null, error: String(e.message || 'error').slice(0, 120) };
    }
  });
}

async function checkGroqModels() {
  const FALLBACK_GROQ = Object.values(GROQ_ALIASES);
  if (!groq) {
    return FALLBACK_GROQ.map(id => ({
      name: 'groq-' + id, displayName: prettifyModelName(id), provider: 'Groq',
      active: false, ms: null, error: 'GROQ_API_KEY не задан'
    }));
  }
  let ids = FALLBACK_GROQ;
  try {
    const list = await groq.models.list();
    const listed = (list.data || [])
      .map(m => m.id)
      .filter(id => id && !/whisper|playai|tts|guard|prompt-guard/i.test(id));
    if (listed.length > 0) ids = listed;
  } catch (e) {
    console.warn('Groq models list failed, using fallback list:', e.message);
  }
  return mapWithConcurrency(ids, 3, async (id) => {
    const t0 = Date.now();
    try {
      await withTimeout(groq.chat.completions.create({
        model: id,
        messages: [{ role: 'user', content: 'Reply with OK' }],
        max_tokens: 4
      }), 12000);
      return { name: 'groq-' + id, displayName: prettifyModelName(id), provider: 'Groq', active: true, ms: Date.now() - t0, error: null };
    } catch (e) {
      return { name: 'groq-' + id, displayName: prettifyModelName(id), provider: 'Groq', active: false, ms: null, error: String(e.message || 'error').slice(0, 120) };
    }
  });
}

async function checkOCRSpaceModels() {
  const engines = [
    { name: 'ocrspace-engine1', displayName: 'OCR.space Engine 1 (Basic)', engine: '1' },
    { name: 'ocrspace-engine2', displayName: 'OCR.space Engine 2 (Advanced)', engine: '2' },
    { name: 'ocrspace-engine3', displayName: 'OCR.space Engine 3 (Handwriting)', engine: '3' }
  ];
  if (!process.env.OCRSPACE_API_KEY) {
    return engines.map(e => ({ ...e, provider: 'OCR.space', active: false, ms: null, error: 'OCRSPACE_API_KEY не задан' }));
  }
  let tiny;
  try {
    tiny = await sharp({ create: { width: 80, height: 30, channels: 3, background: '#ffffff' } }).jpeg({ quality: 70 }).toBuffer();
  } catch (e) {
    tiny = Buffer.from('ping');
  }
  return mapWithConcurrency(engines, 3, async (eng) => {
    const t0 = Date.now();
    try {
      const form = new FormData();
      form.append('apikey', process.env.OCRSPACE_API_KEY);
      form.append('language', 'eng');
      form.append('file', tiny, { filename: 'ping.jpg', contentType: 'image/jpeg' });
      form.append('OCREngine', eng.engine);
      const res = await withTimeout(
        axios.post('https://api.ocr.space/parse/image', form, { headers: form.getHeaders(), timeout: 30000 }),
        35000
      );
      const ok = res.data && !res.data.IsErroredOnProcessing;
      return {
        name: eng.name, displayName: eng.displayName, provider: 'OCR.space',
        active: !!ok, ms: ok ? Date.now() - t0 : null,
        error: ok ? null : String((res.data && res.data.ErrorMessage && res.data.ErrorMessage[0]) || 'OCR error').slice(0, 120)
      };
    } catch (e) {
      return { name: eng.name, displayName: eng.displayName, provider: 'OCR.space', active: false, ms: null, error: String(e.message || 'error').slice(0, 120) };
    }
  });
}

// ========== CHECK: OpenAI-совместимые провайдеры (vision-пинг тестовой картинкой) ==========
async function listOpenAICompatModels(key) {
  const cfg = OPENAI_COMPAT_PROVIDERS[key];
  try {
    const res = await axios.get(`${cfg.baseURL}/models`, {
      headers: { 'Authorization': `Bearer ${cfg.apiKey}`, ...cfg.extraHeaders },
      timeout: 15000
    });
    const data = res.data?.data || [];
    if (key === 'openrouter') {
      const free = data
        .filter(m => (m.architecture?.modality || '').includes('image') && m.id.endsWith(':free'))
        .map(m => m.id);
      return free.length ? free : cfg.fallbackIds;
    }
    if (key === 'mistral') {
      const vis = data.filter(m => m.capabilities?.vision === true).map(m => m.id);
      return vis.length ? vis : cfg.fallbackIds;
    }
    if (key === 'kimi') {
      // vision-модели: kimi-k3, kimi-k2.x (2.5/2.6/2.7), moonshot-v1-*-vision-preview;
      // исключаем снятые с поддержки kimi-k2-0711/0905/turbo
      const vis = data.map(m => m.id)
        .filter(id => /vision|kimi-k3|kimi-k2\.\d/i.test(id))
        .filter(id => !/kimi-k2-\d|k2-turbo|kimi-latest|thinking-preview/i.test(id));
      return vis.length ? vis : cfg.fallbackIds;
    }
    // github: OpenAI-стиль списка, фильтруем по известным vision-моделям
    const vis = data.map(m => m.id).filter(id => /4o|4\.1|vision|llama-4|multimodal|pixtral|mistral-small|grok/i.test(id));
    return vis.length ? vis : cfg.fallbackIds;
  } catch (e) {
    console.warn(`${key} models list failed: ${e.message}`);
    return cfg.fallbackIds;
  }
}

async function checkOpenAICompatProvider(key) {
  const cfg = OPENAI_COMPAT_PROVIDERS[key];
  const provider = cfg.displayName;
  const ids = await listOpenAICompatModels(key);

  if (!cfg.apiKey) {
    return ids.map(id => ({
      name: `${key}-${id}`, displayName: prettifyModelName(id.replace(':free', ' (Free)')), provider,
      active: false, ms: null, error: `${provider} API key не задан`
    }));
  }

  let tinyB64 = null;
  try {
    tinyB64 = (await sharp({ create: { width: 80, height: 30, channels: 3, background: '#ffffff' } }).jpeg({ quality: 70 }).toBuffer()).toString('base64');
  } catch (e) {}

  return mapWithConcurrency(ids.slice(0, 10), 3, async (id) => {
    const t0 = Date.now();
    const displayName = prettifyModelName(id.replace(':free', ' (Free)'));
    try {
      const content = [
        { type: 'text', text: 'Describe this image in one word.' }
      ];
      if (tinyB64) content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${tinyB64}` } });
      await withTimeout(axios.post(`${cfg.baseURL}/chat/completions`, {
        model: id,
        messages: [{ role: 'user', content }],
        max_tokens: 8
      }, {
        headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', ...cfg.extraHeaders },
        timeout: 25000
      }), 30000);
      return { name: `${key}-${id}`, displayName, provider, active: true, ms: Date.now() - t0, error: null };
    } catch (e) {
      let msg = String(e.response?.data?.error?.message || e.message || 'error');
      // Человекочитаемые подсказки для типовых ошибок
      if (/suspended due to insufficient balance/i.test(msg)) {
        msg = `Недостаточно средств: пополните баланс на platform.moonshot.ai (Billing → Recharge)`;
      } else if (/requires terms acceptance/i.test(msg)) {
        msg = `Требуется принять условия модели в консоли провайдера`;
      } else if (/invalid api key|incorrect api key|unauthorized/i.test(msg)) {
        msg = `Неверный API ключ ${provider} — проверьте переменную в Railway`;
      }
      return { name: `${key}-${id}`, displayName, provider, active: false, ms: null, error: msg.slice(0, 140) };
    }
  });
}

app.get('/api/check-models', async (req, res) => {
  try {
    const [geminiModels, groqModels, ocrModels, openrouterModels, githubModels, mistralModels, kimiModels] = await Promise.all([
      checkGeminiModels().catch(() => []),
      checkGroqModels().catch(() => []),
      checkOCRSpaceModels().catch(() => []),
      checkOpenAICompatProvider('openrouter').catch(() => []),
      checkOpenAICompatProvider('github').catch(() => []),
      checkOpenAICompatProvider('mistral').catch(() => []),
      checkOpenAICompatProvider('kimi').catch(() => [])
    ]);
    // Активные сверху, внутри — по имени
    const sortModels = arr => [...arr].sort((a, b) =>
      ((b.active === true) - (a.active === true)) || a.name.localeCompare(b.name)
    );
    res.json({
      checked_at: new Date().toISOString(),
      models: [
        ...sortModels(ocrModels),
        ...sortModels(geminiModels),
        ...sortModels(groqModels),
        ...sortModels(openrouterModels),
        ...sortModels(githubModels),
        ...sortModels(mistralModels),
        ...sortModels(kimiModels)
      ]
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== START ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Receipt Manager API running on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
});
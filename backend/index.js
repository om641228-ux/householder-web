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
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

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
    fallbackIds: ['google/gemma-4-26b-a4b-it:free', 'qwen/qwen2.5-vl-32b-instruct:free', 'qwen/qwen2.5-vl-72b-instruct:free', 'google/gemma-4-31b-it:free'],
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

function generateToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function requireAuth(req, res, next) {
  const token = req.query.token || req.headers['x-token'] || req.body?.token;
  if (!token || !tokens.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.user = tokens.get(token);
  next();
}

// ========== CORS ==========
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-token'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ========== HEALTH ==========
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.json({ status: 'Receipt Manager API', health: '/health' }));

// ========== AUTH ROUTES ==========
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  const user = USERS[password];
  if (!user) return res.status(401).json({ error: 'Неверный пароль' });
  const token = generateToken();
  tokens.set(token, user);
  res.json({ success: true, token, user });
});

app.get('/api/me', (req, res) => {
  const token = req.query.token;
  const user = tokens.get(token);
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
  return `Переведи текст чека на русский язык. ПРАВИЛА:
- Сохрани структуру и порядок строк ОДИН В ОДИН. Заголовки вида ══════ ИМЯ ══════ оставь без изменений (они уже на русском)
- Переведи все названия, подписи и примечания; числа, даты, артикулы, реквизиты, номера карт и суммы НЕ меняй
- Верни ТОЛЬКО переведённый текст, без пояснений и markdown

ТЕКСТ:
${rawText}`;
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
      if (t && t.trim().length > 10) return t.trim();
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
      if (t && t.trim().length > 10) return t.trim();
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
      if (t && t.trim().length > 10) return t.trim();
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

// Текст одной страницы через Gemini vision (1-страничный PDF или изображение страницы)
// Лимит 12288: плотные страницы договоров (20+ тыс. знаков ≈ 6–7 тыс. токенов) + thinking-запас
async function extractPageTextWithGemini(pageBuffer, mimeType, pageNum, totalPages) {
  if (!genAI) throw new Error('Постраничное распознавание требует GEMINI_API_KEY (vision по страницам)');
  const model = genAI.getGenerativeModel({
    model: DEFAULT_GEMINI_MODEL,
    generationConfig: { maxOutputTokens: 12288, temperature: 0.1 }
  });
  const prompt = `Это страница ${pageNum} из ${totalPages} отсканированного многостраничного документа (договор, эскритура купли-продажи, банковская выписка, полис).
Извлеки ВЕСЬ текст этой страницы ДОСЛОВНО, на языке оригинала (НЕ переводи), сохраняя порядок строк и, по возможности, структуру (подписи полей, таблицы построчно).
Не добавляй ничего от себя: ни JSON, ни markdown, ни комментарии, ни сводки — только текст страницы.
Если на странице нет текста (чистое фото/пустая) — верни одну строку: (страница без текста)`;
  const result = await model.generateContent([
    { inlineData: { data: pageBuffer.toString('base64'), mimeType: mimeType || 'application/pdf' } },
    prompt
  ]);
  const t = (result.response.text() || '').trim();
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
  return `Ты анализируешь многостраничный документ, распознанный по страницам. Это может быть: СЧЁТ за коммунальные услуги (factura de electricidad/agua/gas — consumo, CUPS, período de facturación), торговая фактура, договор (contrato de suministro, escritura de compraventa), страховой полис, банковская выписка, официальное уведомление. Верни ТОЛЬКО JSON, без markdown и комментариев:
{
  "store_name": "краткое название документа/главного контрагента НА ЯЗЫКЕ ОРИГИНАЛА (примеры: Factura electricidad — Plenitude; Contrato de suministro — Plenitude; Escritura de compraventa — Jardines del Duque), БЕЗ перевода",
  "store_name_ru": "перевод store_name на русский",
  "receipt_date": "YYYY-MM-DD — главная дата документа (для счёта — fecha de emisión/factura; для договора — подписание)",
  "receipt_time": null,
  "total_amount": главная сумма ЧИСЛОМ (для счёта — Total factura / importe total; для сделки — precio de compraventa; для полиса — сумма полиса) или null,
  "subtotal": null, "tax_amount": null, "tax_rate": null,
  "currency": "EUR",
  "payment_method": null, "country": null,
  "document_type": одно из [bill, invoice, contract, insurance, bank, receipt, other] — bill = счёт за электричество/воду/газ/интернет (factura, informe de consumo, CUPS, lecturas); invoice = торговая фактура за товары/услуги; contract = договор/контракт (condiciones generales, contrato); insurance = страховой полис; bank = банковская выписка; receipt = кассовый чек; other = прочее,
  "subtype": одно из [electricity, water, gas, internet, phone, comunidad, rent, waste, insurance_home, insurance_car, insurance_health, tax, other] или null,
  "provider": "нотариус / банк / компания-эмитент или null",
  "valid_from": "YYYY-MM-DD или null", "valid_to": "YYYY-MM-DD или null",
  "invoice_number": "номер документа/протокола (número de protocolo) или null",
  "contract_number": "номер договора или null",
  "supply_address": "ПОЛНЫЙ адрес недвижимости/объекта как напечатан (ищи внимательно: Dirección, Finca, sitio, Calle) или null",
  "cups": null, "meter_number": null, "consumption": null, "consumption_unit": null,
  "object": "Duqe — если адрес содержит Reykjavik; Maria — если Callao; Kit — если Alcojora; иначе null",
  "items": [],
  "raw_text": null, "raw_text_ru": null
}

Текст документа (фрагменты — начало и конец):

${textSample}`;
}

// Сборка документа из готовых текстов страниц: перевод по страницам + модули + JSON-сводка
async function finalizeDocumentFromPageTexts(pageTexts, currency, docType) {
  const pageCount = pageTexts.length;
  const raw_text = pageTexts.map((t, i) => `══════ СТРАНИЦА ${i + 1} из ${pageCount} ══════\n${t}`).join('\n\n');

  // Перевод каждой страницы — текстовая цепочка (3 параллельно)
  const ruTexts = await runWithConcurrency(pageTexts, async (t) => {
    if (/^\((ошибка|страница без текста|страница не распознана)/.test(t)) return t;
    return (await translateRawText(t)) || '(перевод недоступен)';
  }, 3);
  const raw_text_ru = ruTexts.map((t, i) => `══════ СТРАНИЦА ${i + 1} из ${pageCount} ══════\n${t}`).join('\n\n');

  // JSON-сводка полей (начало + конец документа)
  const sample = `${raw_text.slice(0, 12000)}\n\n…(середина документа опущена)…\n\n${raw_text.slice(-5000)}`;
  let data;
  try {
    data = parseAIResponse(await callTextChain(buildDocumentSummaryPrompt(sample)));
  } catch (e) {
    console.error('Сводка документа не удалась:', e.message);
    data = parseAIResponse('{}');
  }
  data.raw_text = raw_text;
  data.raw_text_ru = raw_text_ru;
  if (!data.object) data.object = detectObjectByAddress(data.supply_address, raw_text);
  if (!Array.isArray(data.items)) data.items = [];
  if (docType && docType !== 'auto') data.document_type = docType;
  else if (!data.store_name && !data.receipt_date) data.document_type = 'other';
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
  return GROQ_ALIASES[raw] || raw || 'meta-llama/llama-4-scout-17b-16e-instruct';
}

async function recognizeWithGroq(imageBuffer, modelName, currency, docType) {
  if (!groq) throw new Error('Groq API key not configured');
  const base64 = imageBuffer.toString('base64');
  const prompt = buildReceiptPrompt(currency, docType);
  
  const response = await groq.chat.completions.create({
    model: resolveGroqModel(modelName),
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
      if (['receipt', 'invoice', 'bill', 'insurance', 'bank', 'contract', 'municipality', 'tax', 'proposal', 'other'].includes(raw)) return raw;
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
  return items.map(item => ({
    name: item.name || item.description || item.product || item.title || 'Unknown item',
    name_ru: item.name_ru || item.name || null,
    quantity: parseFloat(item.quantity || item.qty || item.count || 1) || 1,
    price: parseAmount(item.price || item.unit_price || item.cost),
    total: parseAmount(item.total || item.amount || item.sum || (item.price * item.quantity))
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
        'subtype', 'provider', 'valid_from', 'valid_to', 'meta', 'related_id', 'object_id',
        'invoice_number', 'contract_number', 'supply_address', 'cups', 'meter_number',
        'consumption', 'consumption_unit',
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
      'subtype', 'provider', 'valid_from', 'valid_to', 'meta', 'related_id', 'object_id',
      'invoice_number', 'contract_number', 'supply_address', 'cups', 'meter_number',
      'consumption', 'consumption_unit',
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
    object: receiptData.object || 'other',
    recognition_method: recognitionMethod,
    recognized_at: new Date().toISOString(),
    owner_id: user?.id || null,
    owner_name: user?.name || null
  };
  
  const filteredRecord = filterRecordByColumns(record, columns);
  
  const { data, error } = await supabaseAdmin
    .from('receipts')
    .insert([filteredRecord])
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

// ========== UPLOAD RECEIPT ==========
app.post('/api/upload-receipt', upload.single('image'), async (req, res) => {
  try {
    const token = req.query.token || req.body.token;
    const user = tokens.get(token);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    
    if (!req.file) return res.status(400).json({ error: 'No image provided' });
    
    const model = req.body.model || DEFAULT_GEMINI_MODEL;
    const currency = req.body.currency || 'auto';
    const docType = req.body.docType || 'receipt';
    const object = req.body.object || 'other';
    const subtypeOverride = req.body.subtype && req.body.subtype !== 'auto' ? req.body.subtype : null;
    
    const isPdf = req.file.mimetype === 'application/pdf' || /\.pdf$/i.test(req.file.originalname || '');
    const mimeType = isPdf ? 'application/pdf' : 'image/jpeg';
    const processedBuffer = isPdf ? req.file.buffer : await processImage(req.file.buffer);
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
  const user = tokens.get(req.query.token);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const job = docJobs.get(req.params.id);
  if (!job) return res.status(404).json({ status: 'error', error: 'Задача не найдена (сервер перезапускался) — загрузите документ заново' });
  res.json(job);
});

app.post('/api/upload-document-pages', upload.array('pages', 60), async (req, res) => {
  try {
    const token = req.query.token || req.body.token;
    const user = tokens.get(token);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No page files provided' });

    const currency = req.body.currency || 'auto';
    const docType = req.body.docType || 'auto';
    const object = req.body.object || 'other';
    const subtypeOverride = req.body.subtype && req.body.subtype !== 'auto' ? req.body.subtype : null;
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

      // Обложка документа — первая страница (уже загружена вместе со всеми; повторно не грузим)
      const pageUrls = Array.isArray(receiptData.page_urls) ? receiptData.page_urls : [];
      const imageUrl = pageUrls[0] || await uploadToStorage(pageBuffers[0], files[0].originalname, user.id, mimeTypes[0]);

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
      version: '2026-08-03.17 (новые типы документов: мэрия, налоговая, коммерческое предложение)',
      raw_text_ru_column: columns.includes('raw_text_ru'),
      fix_if_false: 'alter table receipts add column if not exists raw_text_ru text;',
      v13_page_urls_column: columns.includes('page_urls'),
      fix_v13_if_false: 'alter table receipts add column if not exists page_urls jsonb;',
      v7_columns: ['subtype', 'provider', 'valid_from', 'valid_to', 'meta', 'related_id', 'object_id'].every(c => columns.includes(c)),
      fix_v7_if_false: 'Выполни supabase-migration-v7.sql в Supabase SQL Editor',
      v9_columns: ['invoice_number', 'contract_number', 'supply_address', 'cups', 'meter_number', 'consumption', 'consumption_unit'].every(c => columns.includes(c)),
      fix_v9_if_false: 'Выполни supabase-migration-v9.sql в Supabase SQL Editor',
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
    res.json(data || []);
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
      'object', 'document_type', 'subtype', 'provider', 'valid_from', 'valid_to',
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
    res.status(500).json({ error: e.message });
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
    const ALLOWED_TYPES = ['receipt', 'invoice', 'bill', 'insurance', 'bank', 'contract', 'municipality', 'tax', 'proposal', 'other'];
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
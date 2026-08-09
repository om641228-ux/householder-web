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
  return `Переведи текст документа на русский язык. ПРАВИЛА:
- Сохрани структуру и порядок строк ОДИН В ОДИН. Заголовки вида ══════ ИМЯ ══════ оставь без изменений (они уже на русском)
- Если текст УЖЕ на русском языке — верни его БЕЗ изменений
- Переведи все названия, подписи и примечания; числа, даты, артикулы, реквизиты, номера карт и суммы НЕ меняй
- Таблицы переводи ПОСТРОЧНО, сохраняя содержимое КАЖДОЙ ячейки. ЗАПРЕЩЕНО возвращать пустую сетку таблицы (строки из одних символов | и -) или удалять содержимое ячеек
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

// Признак «пустой сетки»: модель выдала рамку таблицы без содержимого
// (много строк только из | _ – - + и пробелов) или подозрительно мало видимых знаков.
// Служебные строки-маркеры ("(страница без текста)" и т.п.) скелетом НЕ считаются.
function looksLikeEmptySkeleton(text) {
  const s = String(text || '').trim();
  if (!s) return true;
  if (s.startsWith('(')) return false; // служебный маркер
  const lines = s.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return true;
  const skeletonLines = lines.filter(l => l.length >= 8 && /^[|_\-—–+\s.:]*$/.test(l)).length;
  if (skeletonLines >= 4 && skeletonLines >= lines.length * 0.5) return true;
  const visibleChars = lines.join('').replace(/[|_\-—–+\s.:]/g, '').length;
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
ПРАВИЛА ДЛЯ ТАБЛИЦ: выпиши КАЖДУЮ строку таблицы отдельной строкой текста, перечисляя содержимое ВСЕХ ячеек через " | ". Если ячейку не удаётся прочитать — впиши [неразборчиво], но НЕ оставляй её молча пустой. ЗАПРЕЩЕНО выводить пустую рамку таблицы (строки из одних символов | и -) без содержимого.
Не добавляй ничего от себя: ни JSON, ни markdown, ни комментарии, ни сводки — только текст страницы.
Если на странице нет текста (чистое фото/пустая) — верни одну строку: (страница без текста)`;
  const retryPrompt = `Это страница ${pageNum} из ${totalPages} отсканированного документа с ТАБЛИЦАМИ и мелким текстом.
В предыдущей попытке содержимое таблиц потерялось. Прочитай страницу МАКСИМАЛЬНО внимательно, как будто разглядываешь её по фрагментам с увеличением:
- Сначала выпиши весь текст ВНЕ таблиц (заголовки, реквизиты, подписи, даты, адреса).
- Затем КАЖДУЮ таблицу — строго построчно: одна строка таблицы = одна строка текста, ячейки через " | ", включая номера, наименования, количества, цены и суммы. Не пропускай и не объединяй строки. Если ячейка пуста В ОРИГИНАЛЕ — так и напиши: (пусто).
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
  "total_amount": главная сумма ЧИСЛОМ (для счёта — Total factura / importe total; для сделки — precio de compraventa; для полиса — сумма полиса) или null,
  "subtotal": null, "tax_amount": null, "tax_rate": null,
  "currency": "EUR",
  "payment_method": null, "country": null,
  "document_type": одно из [bill, invoice, contract, insurance, bank, receipt, municipality, tax, proposal, other] — bill = счёт за электричество/воду/газ/интернет (factura, informe de consumo, CUPS, lecturas); invoice = торговая фактура за товары/услуги; contract = договор/контракт (condiciones generales, contrato); insurance = страховой полис; bank = банковская выписка; receipt = кассовый чек; municipality = документ мэрии (Ayuntamiento: informe urbanístico, licencias, tasas municipales); tax = налоговая (Hacienda/AEAT: IBI, IAE, declaraciones, liquidaciones); proposal = коммерческое предложение (presupuesto, oferta comercial, cotización, proforma — предложение цен, НЕ счёт к оплате); other = прочее,
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
  return score >= 4;
}

// Выборка страниц с цифрами отчётности: в 20+ страничном пакете баланс и P&L — в середине,
// стандартный сэмпл «начало+конец» их не захватывает
function buildAnnualAccountsSample(pageTexts, maxLen = 22000) {
  const re = /balance|situaci[oó]n|cuenta\s+de\s+p|activo|pasivo|patrimonio|casilla|resultado|ingresos|gastos|acreedores|deudores|efectivo|amortizaci/i;
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
  return `Ты анализируешь пакет ГОДОВОЙ ОТЧЁТНОСТИ испанской компании (Cuentas Anuales для Registro Mercantil): идентификационные листы (IDA), Balance de Situación (баланс), Cuenta de Pérdidas y Ganancias (отчёт о прибылях и убытках). Текст получен OCR и может содержать ошибки — восстанавливай смысл, игнорируй дубликаты.
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

// Сборка документа из готовых текстов страниц: перевод по страницам + модули + JSON-сводка
async function finalizeDocumentFromPageTexts(pageTexts, currency, docType) {
  const pageCount = pageTexts.length;

  // Годовая отчётность (v32): детект по исходным текстам страниц
  const isAnnualAccounts = looksLikeAnnualAccounts(pageTexts.join('\n').slice(0, 40000));

  // v32.1: страницы-формы (баланс/P&L) СНАЧАЛА конвертируем в Markdown-таблицы,
  // затем переводим и разбираем построчно — таблица не рассыпается в точки
  let effTexts = pageTexts;
  if (isAnnualAccounts) {
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
    console.log(`Годовая отчётность: в таблицы сконвертировано ${effTexts.filter((t, i) => t !== pageTexts[i]).length}/${pageCount} стр.`);
  }

  const raw_text = effTexts.map((t, i) => `══════ СТРАНИЦА ${i + 1} из ${pageCount} ══════\n${t}`).join('\n\n');

  // Перевод каждой страницы — текстовая цепочка (3 параллельно)
  const ruTexts = await runWithConcurrency(effTexts, async (t) => {
    if (/^\((ошибка|страница без текста|страница не распознана)/.test(t)) return t;
    const ru = await translateRawText(t);
    // Перевод недоступен или похож на пустую сетку при содержательном оригинале —
    // показываем сам оригинал: содержимое важнее языка
    if (!ru || (looksLikeEmptySkeleton(ru) && !looksLikeEmptySkeleton(t))) return t;
    return ru;
  }, 3);
  const raw_text_ru = ruTexts.map((t, i) => `══════ СТРАНИЦА ${i + 1} из ${pageCount} ══════\n${t}`).join('\n\n');

  // JSON-сводка полей (начало + конец документа; для годовой отчётности — страницы с балансом/P&L,
  // уже сконвертированные в таблицы — касильи извлекаются точнее)
  const sample = isAnnualAccounts
    ? buildAnnualAccountsSample(effTexts)
    : `${raw_text.slice(0, 12000)}\n\n…(середина документа опущена)…\n\n${raw_text.slice(-5000)}`;
  let data;
  try {
    data = parseAIResponse(await callTextChain(
      isAnnualAccounts ? buildAnnualAccountsPrompt(sample) : buildDocumentSummaryPrompt(sample)
    ));
  } catch (e) {
    console.error('Сводка документа не удалась:', e.message);
    data = parseAIResponse('{}');
  }
  if (isAnnualAccounts) {
    data.document_type = 'annual_accounts';
    data.items = ensureAnnualBankSummary(data.items);
  }
  data.raw_text = raw_text;
  data.raw_text_ru = raw_text_ru;
  if (!data.object) data.object = detectObjectByAddress(data.supply_address, raw_text);
  if (!Array.isArray(data.items)) data.items = [];
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
  if (docType && docType !== 'auto') data.document_type = docType;
  else if (!data.store_name && !data.receipt_date) data.document_type = 'other';
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
    const ru = await translateRawText(t);
    if (!ru || (looksLikeEmptySkeleton(ru) && !looksLikeEmptySkeleton(t))) return t;
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
      if (['receipt', 'invoice', 'bill', 'insurance', 'bank', 'contract', 'municipality', 'tax', 'proposal', 'annual_accounts', 'other'].includes(raw)) return raw;
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
    const user = tokens.get(token);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    
    if (!req.file) return res.status(400).json({ error: 'No image provided' });
    
    const model = req.body.model || DEFAULT_GEMINI_MODEL;
    const currency = req.body.currency || 'auto';
    const docType = req.body.docType || 'receipt';
    const object = req.body.object || 'other';
    const subtypeOverride = req.body.subtype && req.body.subtype !== 'auto' ? req.body.subtype : null;
    const paymentStatusOverride = sanitizePaymentStatus(req.body.payment_status);
    
    const isPdf = req.file.mimetype === 'application/pdf' || /\.pdf$/i.test(req.file.originalname || '');
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
    const user = tokens.get(token);
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
    const user = tokens.get(token);
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
    // С ТОВАРАМИ; 3+ страниц — документный конвейер (сводка полей без позиций)
    const receiptData = pageTexts.length <= 2
      ? await finalizeReceiptFromPageTexts(pageTexts, currency, docType)
      : await finalizeDocumentFromPageTexts(pageTexts, currency, docType);
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
    const paymentStatusOverride = sanitizePaymentStatus(req.body.payment_status);
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
      scored.push({ r, score: Math.min(100, score), strong });
    }
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    const second = scored[1];
    const confident = best && (best.strong || (best.score >= 80 && (!second || best.score - second.score >= 10)));
    if (confident) {
      const now = new Date().toISOString();
      const { error: ue1 } = await supabaseAdmin.from('bank_movements')
        .update({ matched_receipt_id: best.r.id, match_status: 'auto', match_score: best.score, matched_at: now })
        .eq('id', mv.id);
      if (ue1) { console.error('match: обновление движения не удалось:', ue1.message); continue; }
      const { error: ue2 } = await supabaseAdmin.from('receipts')
        .update({ bank_movement_id: mv.id, payment_status: 'paid', paid_date: mv.operation_date })
        .eq('id', best.r.id);
      if (ue2) console.error('match: обновление фактуры не удалось:', ue2.message);
      best.r.bank_movement_id = mv.id; // в этом прогоне фактура уже занята
      matched++;
      console.log(`match: «${mv.concept}» ${mv.amount} ↔ чек #${best.r.id} (${best.score} баллов)`);
    }
  }
  return { matched, candidates: movements.length };
}

// Импорт выписки .xlsx (Ruralvía): парсинг → upsert по (iban, entry_number) → автопривязка
app.post('/api/import-bank-statement', requireAuth, upload.single('statement'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Нет файла выписки (.xlsx)' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
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
    if (hdrIdx < 0) return res.status(400).json({ error: 'Не найден заголовок таблицы («Fecha de la operación» / «Importe») — похоже, это не выписка формата Ruralvía' });
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
        owner_id: req.user?.id || null,
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
    if (!rows.length) return res.status(400).json({ error: 'В файле не найдено ни одного движения' });

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

    const matchRes = await runBankMatching(req.user?.id, iban);
    console.log(`Выписка ${accountName || iban}: новых ${written}, пропущено дублей ${skipped}, автопривязка ${matchRes.matched}/${matchRes.candidates}`);
    res.json({
      success: true, imported: written, skipped, totalInFile: rows.length, account: accountName, iban,
      autoMatched: matchRes.matched, unmatchedPayments: matchRes.candidates - matchRes.matched
    });
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

// Отвязка движения от фактуры
app.post('/api/unlink-bank-movement', requireAuth, async (req, res) => {
  try {
    const { movement_id } = req.body || {};
    if (!movement_id) return res.status(400).json({ error: 'Нужен movement_id' });
    const { data: mv } = await supabaseAdmin.from('bank_movements')
      .select('id, matched_receipt_id').eq('id', movement_id).single();
    if (!mv) return res.status(404).json({ error: 'Движение не найдено' });
    const oldReceipt = mv.matched_receipt_id;
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
    const { movement_id, has_invoice } = req.body || {};
    if (!movement_id) return res.status(400).json({ error: 'Нужен movement_id' });
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
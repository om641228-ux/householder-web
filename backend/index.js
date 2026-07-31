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
3. Найди ВСЕ товары — каждый товар это объект с: name (оригинальное название), name_ru (перевод на русский), quantity (количество), price (цена за единицу), total (общая сумма за товар).
4. ${currencyHint}
5. Если не уверен в значении — используй null, НЕ используй "Unknown" или 0 без причины.
6. Дата: если на чеке "20/03/2026" → "2026-03-20". Если "20.03.2026" → "2026-03-20".
7. Суммы: извлеки точные числа, убери символы валют.
8. Товары: если quantity не указан, используй 1.
9. Подытог (subtotal) и налог (tax_amount) — если есть на чеке.
10. Способ оплаты (payment_method) — если указан.
11. Адрес магазина (country) — если указан.

12. Тип документа (document_type) — ОБЯЗАТЕЛЬНО одно из двух значений:
    - "invoice" — ФАКТУРА: на документе есть FACTURA / INVOICE / счёт-фактура, номер фактуры, налоговый номер продавца (NIF/VAT/ИНН), юридические реквизиты. FACTURA SIMPLIFICADA — это тоже "invoice".
    - "receipt" — ЧЕК: обычный кассовый чек, ticket, recibo, sales receipt без юр. реквизитов.
    ${docTypeHint}

13. raw_text — ВЕСЬ текст с документа НА ЯЗЫКЕ ОРИГИНАЛА (испанский чек → на испанском, арабский → на арабском), СТРУКТУРИРОВАННЫЙ по модулям. Это НЕ JSON-массив и НЕ одна сплошная строка. Подписи и значения — как напечатано на документе, ничего не переводи. Формат raw_text строго такой:

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

14. raw_text_ru — ПОЛНЫЙ ПЕРЕВОД raw_text на русский язык с той же модульной структурой и порядком строк. Все названия, подписи и примечания переведи; числа, даты, артикулы и реквизиты оставь без изменений. Заголовки модулей те же: ══════ МАГАЗИН ══════, ══════ ДОКУМЕНТ ══════, ══════ ТОВАРЫ ══════, ══════ СУММЫ ══════, ══════ ОПЛАТА ══════, ══════ ПРОЧИЙ ТЕКСТ ══════.

ПРАВИЛА ДЛЯ raw_text:
- Модули идут строго в этом порядке, заголовок модуля — отдельная строка "══════ ИМЯ ══════"
- Если данных для модуля нет на чеке — НЕ выдумывай, пропусти модуль целиком
- raw_text — строго на языке оригинала; raw_text_ru — полный перевод на русский; обе структуры идентичны
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
const GEMINI_FALLBACK_CANDIDATES = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-pro', 'gemini-1.5-flash', 'gemini-1.5-pro'];

async function recognizeWithGemini(imageBuffer, modelName, currency, docType, mimeType = 'image/jpeg') {
  if (!genAI) throw new Error('Gemini API key not configured');
  const model = genAI.getGenerativeModel({ model: modelName || DEFAULT_GEMINI_MODEL });
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
    max_tokens: 4096,
    temperature: 0.1
  };

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
    timeout: 180000
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
    max_tokens: 4096,
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
      document_type: /invoice|factura|фактур/i.test(String(data.document_type || data.doc_type || data.type || '')) ? 'invoice' : 'receipt',
      items: normalizeItems(data.items || data.products || data.goods || []),
      raw_text: Array.isArray(data.raw_text)
        ? data.raw_text.map(x => String(x)).join('\n')
        : (data.raw_text || data.full_text || data.text || jsonStr),
      raw_text_ru: Array.isArray(data.raw_text_ru)
        ? data.raw_text_ru.map(x => String(x)).join('\n')
        : (data.raw_text_ru || data.raw_text_translation || null)
    };
    
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
        'items', 'image_url', 'raw_text', 'raw_text_ru', 'document_type', 'object',
        'recognition_method', 'recognized_at', 'created_at', 'owner_id', 'owner_name'
      ];
    }
  } catch (e) {
    console.warn('Could not detect columns, using fallback list:', e.message);
    knownColumns = [
      'id', 'store_name', 'store_name_ru', 'receipt_date', 'receipt_time',
      'total_amount', 'subtotal', 'tax_amount', 'tax_rate', 'currency',
      'items', 'image_url', 'raw_text', 'raw_text_ru', 'document_type', 'object',
      'recognition_method', 'recognized_at', 'created_at', 'owner_id', 'owner_name'
    ];
  }
  
  return knownColumns;
}

function filterRecordByColumns(record, columns) {
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
    raw_text: receiptData.raw_text,
    raw_text_ru: receiptData.raw_text_ru || null,
    document_type: receiptData.docType || 'receipt',
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
    
    const isPdf = req.file.mimetype === 'application/pdf' || /\.pdf$/i.test(req.file.originalname || '');
    const mimeType = isPdf ? 'application/pdf' : 'image/jpeg';
    const processedBuffer = isPdf ? req.file.buffer : await processImage(req.file.buffer);
    const imageUrl = await uploadToStorage(processedBuffer, req.file.originalname, user.id, mimeType);
    
    let receiptData;
    let recognitionMethod = model;
    let fallback = false;
    let recognizeErrorMsg = null;
    
    try {
      if (model.startsWith('gemini')) {
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
    
    // При docType='auto' берём тип, определённый AI по содержимому документа
    receiptData.docType = docType === 'auto' ? (receiptData.document_type || 'receipt') : docType;
    receiptData.object = object;
    
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
    
    let receiptData;
    if (model.startsWith('gemini')) {
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
      recognition_method: model,
      recognized_at: new Date().toISOString()
    };
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
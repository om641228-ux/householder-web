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

// ========== AUTH ==========
const USERS = {
  'admin': { id: 'admin', name: 'Администратор', role: 'admin' },
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
    ? 'Определи валюту из чека (AED, EUR, USD, RUB и т.д.).' 
    : `Валюта: ${currency}.`;

  return `Ты — эксперт по распознаванию чеков и фактур. Проанализируй изображение и извлеки ВСЕ данные в строгом JSON формате.

ВАЖНЫЕ ПРАВИЛА:
1. Извлеки ВСЕ текст с чека полностью — каждую строку, каждую цифру.
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
12. raw_text — ВЕСЬ текст с чека, сохранив структуру строк.

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
  "items": [
    {
      "name": "BROTHER MFD LASER MONO",
      "name_ru": "МФУ Brother лазерное",
      "quantity": 1,
      "price": 399.00,
      "total": 399.00
    }
  ],
  "raw_text": "полный текст чека..."
}`;
}

// ========== AI RECOGNITION ==========
async function recognizeWithGemini(imageBuffer, modelName, currency, docType) {
  if (!genAI) throw new Error('Gemini API key not configured');
  const model = genAI.getGenerativeModel({ model: modelName || 'gemini-1.5-flash' });
  const prompt = buildReceiptPrompt(currency, docType);
  
  const result = await model.generateContent([
    { inlineData: { data: imageBuffer.toString('base64'), mimeType: 'image/jpeg' } },
    prompt
  ]);
  
  const text = result.response.text();
  return parseAIResponse(text);
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

async function recognizeWithOCRSpace(imageBuffer, engine, currency, docType) {
  const apiKey = process.env.OCRSPACE_API_KEY;
  if (!apiKey) throw new Error('OCR.space API key not configured');
  
  const form = new FormData();
  form.append('apikey', apiKey);
  form.append('language', 'eng');
  form.append('isOverlayRequired', 'false');
  form.append('file', imageBuffer, { filename: 'receipt.jpg', contentType: 'image/jpeg' });
  form.append('scale', 'true');
  form.append('OCREngine', engine === 'engine2' ? '2' : engine === 'engine3' ? '3' : '1');
  
  const res = await axios.post('https://api.ocr.space/parse/image', form, {
    headers: form.getHeaders(),
    timeout: 60000
  });
  
  const parsed = res.data?.ParsedResults?.[0]?.ParsedText || '';
  if (!parsed) throw new Error('OCR.space returned empty text');
  
  return recognizeWithGemini(imageBuffer, 'gemini-1.5-flash', currency, docType);
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
      items: normalizeItems(data.items || data.products || data.goods || []),
      raw_text: data.raw_text || data.full_text || data.text || jsonStr
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
async function uploadToStorage(buffer, filename, userId) {
  const folder = userId || 'anonymous';
  const path = `${folder}/${Date.now()}_${filename}`;
  
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .upload(path, buffer, { contentType: 'image/jpeg', upsert: false });
  
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
        'items', 'image_url', 'raw_text', 'document_type', 'object',
        'recognition_method', 'recognized_at', 'created_at', 'owner_id', 'owner_name'
      ];
    }
  } catch (e) {
    console.warn('Could not detect columns, using fallback list:', e.message);
    knownColumns = [
      'id', 'store_name', 'store_name_ru', 'receipt_date', 'receipt_time',
      'total_amount', 'subtotal', 'tax_amount', 'tax_rate', 'currency',
      'items', 'image_url', 'raw_text', 'document_type', 'object',
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
    
    const model = req.body.model || 'gemini-1.5-flash';
    const currency = req.body.currency || 'auto';
    const docType = req.body.docType || 'receipt';
    const object = req.body.object || 'other';
    
    const processedBuffer = await processImage(req.file.buffer);
    const imageUrl = await uploadToStorage(processedBuffer, req.file.originalname, user.id);
    
    let receiptData;
    let recognitionMethod = model;
    let fallback = false;
    
    try {
      if (model.startsWith('gemini')) {
        receiptData = await recognizeWithGemini(processedBuffer, model, currency, docType);
      } else if (model.startsWith('groq')) {
        receiptData = await recognizeWithGroq(processedBuffer, model, currency, docType);
      } else if (model.startsWith('ocrspace')) {
        const engine = model.replace('ocrspace-', '');
        receiptData = await recognizeWithOCRSpace(processedBuffer, engine, currency, docType);
      } else {
        receiptData = await recognizeWithGemini(processedBuffer, 'gemini-1.5-flash', currency, docType);
      }
    } catch (recognizeError) {
      console.error('Recognition error:', recognizeError);
      try {
        receiptData = await recognizeWithGemini(processedBuffer, 'gemini-1.5-flash', currency, docType);
        recognitionMethod = `${model} (fallback → gemini-1.5-flash)`;
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
    
    receiptData.docType = docType;
    receiptData.object = object;
    
    const saved = await saveReceiptToDB(receiptData, imageUrl, user, recognitionMethod);
    
    res.json({
      success: true,
      id: saved.id,
      ...saved,
      image_url: imageUrl,
      warning: fallback ? 'Распознавание выполнено через fallback модель' : null
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
    
    const currency = req.body.currency || 'auto';
    const docType = req.body.docType || 'receipt';
    
    let receiptData;
    if (model.startsWith('gemini')) {
      receiptData = await recognizeWithGemini(buffer, model, currency, docType);
    } else if (model.startsWith('groq')) {
      receiptData = await recognizeWithGroq(buffer, model, currency, docType);
    } else {
      receiptData = await recognizeWithGemini(buffer, 'gemini-1.5-flash', currency, docType);
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
    .replace(/[-_.]/g, ' ')
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

app.get('/api/check-models', async (req, res) => {
  try {
    const [geminiModels, groqModels, ocrModels] = await Promise.all([
      checkGeminiModels().catch(() => []),
      checkGroqModels().catch(() => []),
      checkOCRSpaceModels().catch(() => [])
    ]);
    res.json({
      checked_at: new Date().toISOString(),
      models: [...ocrModels, ...geminiModels, ...groqModels]
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
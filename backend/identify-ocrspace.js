const FormData = require('form-data');
const sharp = require('sharp');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  try {
    const { image, currency, model } = req.body;
    
    console.log('\n' + '='.repeat(60));
    console.log('🔍 OCR.SPACE ЗАПРОС');
    console.log('='.repeat(60));
    console.log('💰 Валюта (по умолчанию):', currency || 'AED');
    
    if (!image) {
      return res.status(400).json({ success: false, error: 'Нет изображения' });
    }

    const API_KEY = process.env.OCRSPACE_API_KEY || 'K89156518988957';
    const API_URL = 'https://api.ocr.space/parse/image';

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    
    console.log('📐 Размер изображения:', base64Data.length, 'байт (base64)');

    // === ПРЕДОБРАБОТКА ИЗОБРАЖЕНИЯ ===
    console.log('🔧 Предобработка изображения...');
    
    const imageBuffer = Buffer.from(base64Data, 'base64');
    const metadata = await sharp(imageBuffer).metadata();
    console.log('   Исходный размер:', metadata.width, 'x', metadata.height);

    const optimizedImage = await sharp(imageBuffer)
      .rotate()
      .resize({
        width: 1500,
        height: 4000,
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: 92, progressive: true })
      .toBuffer();
    
    let finalBase64 = optimizedImage.toString('base64');
    const processedMetadata = await sharp(optimizedImage).metadata();
    console.log('   После обработки:', processedMetadata.width, 'x', processedMetadata.height);
    console.log('   Размер после:', finalBase64.length, 'байт');
    console.log('   📉 Сжатие:', ((1 - finalBase64.length / base64Data.length) * 100).toFixed(1) + '%');

    if (finalBase64.length > 1000000) {
      console.log('⚠️  Слишком большое, сжимаем сильнее...');
      const smallerImage = await sharp(optimizedImage)
        .resize({ width: 1200, height: 3000, fit: 'inside' })
        .jpeg({ quality: 80 })
        .toBuffer();
      finalBase64 = smallerImage.toString('base64');
      console.log('   Новый размер:', finalBase64.length, 'байт');
    }

    const imageWithPrefix = `data:image/jpeg;base64,${finalBase64}`;

    // === OCR.SPACE С ENGINE 2 ===
    const formData = new FormData();
    formData.append('apikey', API_KEY);
    formData.append('base64Image', imageWithPrefix);
    formData.append('language', 'eng');
    formData.append('isOverlayRequired', 'false');
    formData.append('detectOrientation', 'true');
    formData.append('OCREngine', '2');
    formData.append('scale', 'true');
    formData.append('isTable', 'true');

    console.log('🚀 Отправка запроса к OCR.Space (Engine 2)...');

    const { default: fetch } = await import('node-fetch');

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { ...formData.getHeaders() },
      body: formData
    });

    const result = await response.json();
    
    if (!response.ok || result.IsErroredOnProcessing) {
      console.error('❌ OCR.Space error:', result);
      throw new Error(result.ErrorMessage?.[0] || 'OCR.Space API error');
    }

    console.log('📥 Получен ответ от OCR.Space');
    
    const parsedResult = result.ParsedResults?.[0];
    const fullText = parsedResult?.ParsedText || '';
    
    console.log('\n📝 ПОЛНЫЙ ТЕКСТ ЧЕКА:');
    console.log('─'.repeat(60));
    console.log(fullText);
    console.log('─'.repeat(60));

    // Парсим текст
    let data = parseReceiptText(fullText, currency || 'AED');
    
    console.log('\n🔍 После парсинга:');
    console.log('   Магазин:', data.store_name_ru || data.store_name);
    console.log('   Итого:', data.total, data.currency);
    console.log('   Товаров:', data.items.length);

    // Если товаров мало или итог 0 - используем AI
    if (data.items.length < 3 || data.total === 0) {
      console.log('\n⚠️  Парсинг слабый, используем AI для улучшения...');
      
      try {
        const aiData = await enhanceWithAI(fullText, data.currency, model);
        if (aiData && aiData.items && aiData.items.length > 0) {
          // Сохраняем автоопределенную валюту
          aiData.currency = data.currency;
          data = aiData;
          console.log('✅ AI улучшил распознавание!');
          console.log('   Товаров после AI:', data.items.length);
          console.log('   Итого после AI:', data.total);
        }
      } catch (aiErr) {
        console.log('⚠️  AI не смог помочь:', aiErr.message);
      }
    }
    
    console.log('\n✅ Распознавание завершено:');
    console.log('   Магазин:', data.store_name_ru || data.store_name);
    console.log('   Дата:', data.date);
    console.log('   Итого:', data.total, data.currency);
    console.log('   Налог:', data.tax);
    console.log('   Товаров:', data.items.length);
    console.log('='.repeat(60) + '\n');
    
    res.json({ success: true, data: data, provider: 'OCR.Space + AI' });
  } catch (err) {
    console.error('\n❌ ОШИБКА:', err.message);
    res.status(500).json({ 
      success: false, 
      error: err.message, 
      data: { 
        store_name: 'Error', 
        store_name_ru: 'Ошибка', 
        total: 0, 
        currency: req.body?.currency || 'AED', 
        items: [] 
      } 
    });
  }
};

// === УЛУЧШЕННОЕ ОПРЕДЕЛЕНИЕ ВАЛЮТЫ ===
function detectCurrency(fullText) {
  // Приоритет 1: Явные символы и слова
  if (fullText.includes('AED') || fullText.includes('د.إ') || 
      /DIRHAM|DIRHAMS/i.test(fullText) || 
      /DUBAI|UAE|UNITED ARAB EMIRATES/i.test(fullText)) {
    return 'AED';
  }
  
  if (fullText.includes('€') || /EURO|EUR\b/i.test(fullText) ||
      /GERMANY|FRANCE|ITALY|SPAIN/i.test(fullText)) {
    return 'EUR';
  }
  
  if (fullText.includes('$') || /USD\b|DOLLAR/i.test(fullText) ||
      /USA|UNITED STATES|NEW YORK/i.test(fullText)) {
    return 'USD';
  }
  
  if (fullText.includes('₽') || /RUB|RUBLE|РУБ/i.test(fullText) ||
      /MOSCOW|RUSSIA|РОССИЯ|МОСКВА/i.test(fullText)) {
    return 'RUB';
  }
  
  // Приоритет 2: Формат чисел
  const numbers = fullText.match(/\d+[.,]\d{2}/g) || [];
  if (numbers.length > 0) {
    const commaCount = numbers.filter(n => n.includes(',')).length;
    const dotCount = numbers.filter(n => n.includes('.')).length;
    if (commaCount > dotCount) return 'EUR';
  }
  
  return 'AED';
}

// === ПАРСИНГ ТЕКСТА ===
function parseReceiptText(fullText, defaultCurrency) {
  const data = {
    store_name: '',
    store_name_ru: '',
    date: null,
    time: null,
    total: 0,
    subtotal: 0,
    tax: 0,
    tax_rate: null,
    currency: detectCurrency(fullText),
    country: null,
    items: [],
    payment_method: null,
    payment_amount: 0
  };

  const lines = fullText.split('\n').map(l => l.trim()).filter(l => l);

  // Магазин
  if (lines.length > 0) {
    data.store_name = lines[0];
    data.store_name_ru = translateToRussian(lines[0]);
  }

  // Дата
  const dateMatch = fullText.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
  if (dateMatch) {
    const [, d, m, y] = dateMatch;
    const year = y.length === 2 ? '20' + y : y;
    data.date = `${year}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  
  const timeMatch = fullText.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (timeMatch) data.time = `${timeMatch[1].padStart(2,'0')}:${timeMatch[2]}`;

  // Итоговая сумма
  const totalPatterns = [
    /(?:GRAND\s*)?TOTAL[:\s]*[A-Z]{0,3}\s*([\d,.]+)/i,
    /ИТОГО[:\s]*([\d,.]+)/i,
    /ВСЕГО[:\s]*([\d,.]+)/i,
    /TOTAL\s*DUE[:\s]*([\d,.]+)/i
  ];
  
  for (const pattern of totalPatterns) {
    const match = fullText.match(pattern);
    if (match) {
      data.total = parseFloat(match[1].replace(/,/g, ''));
      break;
    }
  }

  // Налог VAT
  const vatMatch = fullText.match(/(?:VAT|НДС|TAX)[^\d]*(\d+)?%?[:\s]*[A-Z]{0,3}\s*([\d,.]+)/i);
  if (vatMatch) {
    if (vatMatch[1]) data.tax_rate = vatMatch[1] + '%';
    data.tax = parseFloat(vatMatch[2].replace(/,/g, ''));
  }

  // Subtotal
  const subMatch = fullText.match(/(?:SUBTOTAL|SUB\s*TOTAL|Total before VAT)[:\s]*[A-Z]{0,3}\s*([\d,.]+)/i);
  if (subMatch) {
    data.subtotal = parseFloat(subMatch[1].replace(/,/g, ''));
  }

  // Товары - паттерн 1: "название x кол-во цена сумма"
  const pattern1 = /^(.+?)\s+(\d+)\s*[xX×]\s*([\d,.]+)\s+([\d,.]+)/gm;
  let match;
  while ((match = pattern1.exec(fullText)) !== null) {
    const [, name, qty, price, total] = match;
    if (isProductLine(name)) {
      data.items.push({
        name: name.trim(),
        name_ru: translateToRussian(name.trim()),
        quantity: parseInt(qty),
        price: parseFloat(price.replace(/,/g, '')),
        total: parseFloat(total.replace(/,/g, ''))
      });
    }
  }

  // Паттерн 2: "название  кол-во  цена  сумма"
  if (data.items.length === 0) {
    const pattern2 = /^(.+?)\s{2,}(\d+)\s+([\d,.]+)\s+([\d,.]+)\s*$/gm;
    while ((match = pattern2.exec(fullText)) !== null) {
      const [, name, qty, price, total] = match;
      if (isProductLine(name)) {
        data.items.push({
          name: name.trim(),
          name_ru: translateToRussian(name.trim()),
          quantity: parseInt(qty),
          price: parseFloat(price.replace(/,/g, '')),
          total: parseFloat(total.replace(/,/g, ''))
        });
      }
    }
  }

  // Паттерн 3: "название цена"
  if (data.items.length === 0) {
    const pattern3 = /^(.+?)\s+([\d]{1,4}[.,]\d{2})\s*$/gm;
    while ((match = pattern3.exec(fullText)) !== null) {
      const [, name, price] = match;
      if (isProductLine(name)) {
        const p = parseFloat(price.replace(/,/g, ''));
        data.items.push({
          name: name.trim(),
          name_ru: translateToRussian(name.trim()),
          quantity: 1,
          price: p,
          total: p
        });
      }
    }
  }

  // Страна
  if (/DUBAI|UAE|UNITED ARAB/i.test(fullText)) data.country = 'UAE';
  else if (/RUSSIA|РОССИЯ|МОСКВА/i.test(fullText)) data.country = 'RU';
  else if (/GERMANY|FRANCE|ITALY/i.test(fullText)) data.country = 'EU';

  return data;
}

function isProductLine(name) {
  if (!name || name.length < 2 || name.length > 100) return false;
  
  const excluded = [
    'total', 'subtotal', 'итого', 'всего', 'vat', 'ндс', 'tax', 'налог',
    'cash', 'card', 'visa', 'mastercard', 'payment', 'change', 'сдача',
    'receipt', 'чек', 'date', 'дата', 'time', 'время', 'thank', 'спасибо',
    'address', 'адрес', 'tel', 'phone', 'тел', 'www', 'http', 'email',
    'order', 'delivery', 'prepayment', 'amounts in', 'all amounts',
    'manager', 'driver', 'order accepted', 'delivery time', 'order delivered'
  ];
  
  const lower = name.toLowerCase();
  return !excluded.some(e => lower.includes(e));
}

// === AI УЛУЧШЕНИЕ ===
async function enhanceWithAI(text, currency, model) {
  const prompt = `You are a receipt OCR expert. Parse this receipt text and extract structured data.

RECEIPT TEXT:
${text}

Return ONLY valid JSON:
{
  "store_name": "Store name",
  "store_name_ru": "Название на русском",
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "total": 0.00,
  "subtotal": 0.00,
  "tax": 0.00,
  "tax_rate": "5%",
  "currency": "${currency}",
  "items": [
    {"name": "Product", "name_ru": "Товар", "quantity": 1, "price": 0.00, "total": 0.00}
  ]
}

RULES:
1. Extract ALL products with quantities, prices, totals
2. VAT/TAX as separate item if present
3. TOTAL from "TOTAL" line
4. Translate names to Russian
5. Return ONLY JSON, no markdown`;

  if (process.env.GEMINI_API_KEY) {
    try {
      console.log('   🤖 Используем Gemini...');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const aiModel = genAI.getGenerativeModel({ model: model || 'gemini-3.5-flash' });
      
      const result = await aiModel.generateContent(prompt);
      let aiText = result.response.text();
      aiText = aiText.replace(/```json/gi, '').replace(/```/g, '').trim();
      
      const start = aiText.indexOf('{');
      const end = aiText.lastIndexOf('}');
      if (start !== -1 && end !== -1) {
        const data = JSON.parse(aiText.substring(start, end + 1));
        if (data.items && data.items.length > 0) {
          data.provider = 'Gemini';
          return data;
        }
      }
    } catch (e) {
      console.log('   ⚠️  Gemini error:', e.message);
    }
  }

  if (process.env.GROQ_API_KEY) {
    try {
      console.log('   ⚡ Используем Groq...');
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      
      const completion = await groq.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        temperature: 0.1,
        max_tokens: 4096
      });

      let aiText = completion.choices[0]?.message?.content || '';
      aiText = aiText.replace(/```json/gi, '').replace(/```/g, '').trim();
      
      const start = aiText.indexOf('{');
      const end = aiText.lastIndexOf('}');
      if (start !== -1 && end !== -1) {
        const data = JSON.parse(aiText.substring(start, end + 1));
        if (data.items && data.items.length > 0) {
          data.provider = 'Groq';
          return data;
        }
      }
    } catch (e) {
      console.log('   ⚠️  Groq error:', e.message);
    }
  }

  return null;
}

function translateToRussian(text) {
  if (!text) return '';
  const translations = {
    'Pickled Cabbage': 'Маринованная капуста',
    'Pickled Herring with Potato': 'Маринованная сельдь с картофелем',
    'Mini Chebureki': 'Мини чебуреки',
    'Borscht': 'Борщ',
    'Beetroot Soup': 'Свекольный суп',
    'Okroshka': 'Окрошка',
    'Summer Soup': 'Летний суп',
    'Beef Cutlets': 'Говяжьи котлеты',
    'Fish Cutlets': 'Рыбные котлеты',
    'Horseradish Jar': 'Баночка хрена',
    'Plastic Bag': 'Пластиковый пакет',
    'Coca-Cola': 'Кока-Кола'
  };
  return translations[text] || text;
}
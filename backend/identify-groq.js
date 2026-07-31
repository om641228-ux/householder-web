const Groq = require('groq-sdk');
const sharp = require('sharp');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  try {
    const { image, model, currency } = req.body;
    
    console.log('\n' + '='.repeat(60));
    console.log(' GROQ ЗАПРОС НА РАСПОЗНАВАНИЕ');
    console.log('='.repeat(60));
    console.log('📌 Модель:', model || 'meta-llama/llama-4-scout-17b-16e-instruct');
    console.log('💰 Валюта:', currency || 'AED');
    
    if (!image) {
      return res.status(400).json({ success: false, error: 'Нет изображения' });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ success: false, error: 'GROQ_API_KEY не установлен' });
    }

    const groq = new Groq({ apiKey });
    
    // Удаляем data:image префикс
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    
    console.log('📐 Размер изображения:', base64Data.length, 'байт (base64)');

    // === ПРЕДОБРАБОТКА ИЗОБРАЖЕНИЯ ===
    console.log('🔧 Предобработка изображения...');
    
    // Конвертируем base64 в буфер
    const imageBuffer = Buffer.from(base64Data, 'base64');
    
    // Получаем информацию об изображении
    const metadata = await sharp(imageBuffer).metadata();
    console.log('   Исходный размер:', metadata.width, 'x', metadata.height);

    // Оптимизируем изображение с помощью sharp
    const optimizedImage = await sharp(imageBuffer)
      .rotate() // Автоповорот по EXIF
      .resize({
        width: 1024, // Максимальная ширина
        height: 2048, // Максимальная высота (для длинных чеков)
        fit: 'inside', // Сохраняем пропорции
        withoutEnlargement: true // Не увеличиваем если меньше
      })
      .jpeg({ 
        quality: 85, // Качество JPEG
        progressive: true 
      })
      .toBuffer();
    
    // Конвертируем обратно в base64
    const processedBase64 = optimizedImage.toString('base64');
    
    const processedMetadata = await sharp(optimizedImage).metadata();
    console.log('   После обработки:', processedMetadata.width, 'x', processedMetadata.height);
    console.log('   Размер после:', processedBase64.length, 'байт');
    console.log('   📉 Сжатие:', ((1 - processedBase64.length / base64Data.length) * 100).toFixed(1) + '%');

    // === ОПРЕДЕЛЕНИЕ МОДЕЛИ ===
    const visionModels = [
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'meta-llama/llama-4-maverick-17b-128e-instruct',
      'meta-llama/llama-3.2-90b-vision-preview',
      'meta-llama/llama-3.2-11b-vision-preview',
    ];

    const isVisionModel = model && visionModels.includes(model);
    const groqModel = isVisionModel ? model : 'meta-llama/llama-4-scout-17b-16e-instruct';
    
    if (!isVisionModel) {
      console.log('️ Модель', model, 'не поддерживает vision!');
      console.log('🔄 Используем:', groqModel);
    } else {
      console.log('✅ Модель поддерживает vision:', groqModel);
    }

    const prompt = `You are a receipt OCR expert. Extract EVERY line from this receipt/invoice with EXACT numbers.

CRITICAL RULES:
- Quantities are usually SMALL (1-10), NOT 100 or 1000
- Read carefully: quantity × unit_price = line_total
- Extract the FINAL TOTAL from receipt (TOTAL DUE/TOTAL/ИТОГО)
- Include TAX/VAT as separate items
- Extract ALL products, do not skip any

Return ONLY valid JSON:
{
  "store_name": "Original store name",
  "store_name_ru": "Название магазина на русском",
  "date": "2024-01-15",
  "time": "14:30",
  "total": 359.50,
  "subtotal": 263.48,
  "tax": 96.02,
  "tax_rate": "5%",
  "currency": "${currency || 'AED'}",
  "country": "UAE",
  "items": [
    {"name": "Product", "name_ru": "Товар", "quantity": 2, "price": 79.12, "total": 158.24}
  ],
  "payment_method": "card",
  "payment_amount": 359.50,
  "cashier": null
}

IMPORTANT:
1. Extract ALL products with EXACT quantity (usually 1-10), unit price, and total
2. Extract TAX/VAT lines as items: {"name": "VAT 5%", "name_ru": "НДС 5%", "quantity": 1, "price": 96.02, "total": 96.02}
3. Extract FINAL TOTAL → "total" field (from TOTAL DUE/TOTAL line)
4. Extract SUBTOTAL → "subtotal" field
5. Extract TAX amount → "tax" field
6. Translate ALL names to Russian (name_ru), keep original names too (name)
7. Detect currency from symbols (€, $, £, د.إ, руб, AED) or store location
8. Return ONLY JSON, no markdown, no explanations

EXAMPLE for UAE receipt:
- If you see "VAT 5%: 18.81" → add as item
- If you see "TOTAL: 395.00" → this is "total"
- Currency should be "AED" for UAE receipts`;

    console.log('🚀 Отправка запроса к Groq...');
    console.log('   Модель:', groqModel);

    const completion = await groq.chat.completions.create({
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { 
            type: "image_url", 
            image_url: { 
              url: `data:image/jpeg;base64,${processedBase64}`
            } 
          }
        ]
      }],
      model: groqModel,
      temperature: 0.1,
      max_tokens: 4096
    });

    let text = completion.choices[0]?.message?.content || '';
    console.log('\n Получен ответ:', text.length, 'символов');
    
    text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    
    if (jsonStart === -1 || jsonEnd === -1) {
      throw new Error('JSON не найден в ответе');
    }
    
    const data = JSON.parse(text.substring(jsonStart, jsonEnd + 1));
    
    if (!data.items || !Array.isArray(data.items)) data.items = [];
    if (!data.currency) data.currency = currency || 'AED';
    
    console.log('\n✅ Распознавание завершено:');
    console.log('   Магазин:', data.store_name_ru || data.store_name);
    console.log('   Итого:', data.total, data.currency);
    console.log('   Налог:', data.tax);
    console.log('   Товаров:', data.items.length);
    console.log('='.repeat(60) + '\n');
    
    res.json({ success: true, data: data, model: groqModel, provider: 'Groq' });
  } catch (err) {
    console.error('\n❌ ОШИБКА Groq:', err.message);
    console.error('='.repeat(60) + '\n');
    
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
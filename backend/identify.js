const { GoogleGenerativeAI } = require('@google/generative-ai');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  try {
    const { image, model } = req.body;
    if (!image) return res.status(400).json({ success: false, error: 'Нет изображения' });

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const aiModel = genAI.getGenerativeModel({ 
      model: model || 'gemini-3.5-flash',
      generationConfig: { 
        temperature: 0.1, 
        maxOutputTokens: 4000 
      }
    });

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

    // ИСПРАВЛЕНО: убраны пробелы в ключах JSON
    const prompt = `You are a receipt OCR expert. Extract ALL information, translate to Russian, and detect currency.
Return ONLY valid JSON:
{
  "store_name": "Original store name",
  "store_name_ru": "Название магазина на русском",
  "date": "2024-01-15",
  "time": "14:30",
  "total": 45.99,
  "currency": "EUR",
  "country": "Spain",
  "items": [
    { "name": "Original product name", "name_ru": "Название на русском", "quantity": 2, "price": 10.50, "total": 21.00 }
  ],
  "payment_method": "card",
  "cashier": "Anna"
}
CURRENCY DETECTION RULES:
If receipt is from UAE/Dubai → use "AED"
If receipt is from USA → use "USD"
If receipt is from UK → use "GBP"
If receipt is from Spain/Europe → use "EUR"
If receipt is from Russia → use "RUB"
Detect country from store name, address, phone format, VAT format
RULES:
Extract EVERY item
Translate ALL names to Russian (store_name_ru, name_ru)
Keep original names too (store_name, name)
Detect currency from symbols (€, $, £, د.إ, руб)
Use null for unknown fields
Return ONLY JSON, no markdown`;

    const result = await aiModel.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Data,
          mimeType: 'image/jpeg'
        }
      }
    ]);
    
    const response = result.response;
    let text = response.text();
    
    // ИСПРАВЛЕНО: правильное удаление markdown (три обратных апострофа)
    text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    
    let jsonStart = text.indexOf('{');
    let jsonEnd = text.lastIndexOf('}');
    
    if (jsonStart === -1 || jsonEnd === -1) {
      throw new Error('No JSON found');
    }
    
    const jsonString = text.substring(jsonStart, jsonEnd + 1);
    let data;
    
    try {
      data = JSON.parse(jsonString);
    } catch (parseError) {
      console.error('JSON Parse Error:', parseError);
      data = {
        store_name: 'Unrecognized',
        store_name_ru: 'Не распознано',
        date: null,
        time: null,
        total: 0,
        currency: 'EUR',
        country: null,
        items: [],
        payment_method: null,
        cashier: null
      };
    }
    
    if (!data.items || !Array.isArray(data.items)) {
      data.items = [];
    }
    
    // Определение валюты по умолчанию если не распознана
    if (!data.currency) {
      if (data.store_name && (data.store_name.toLowerCase().includes('dubai') || data.store_name.toLowerCase().includes('uae'))) {
        data.currency = 'AED';
      } else {
        data.currency = 'EUR';
      }
    }
    
    res.json({
      success: true,
      text: `${data.store_name}|${data.date || ''}|${data.time || ''}`,
      data: data,
      raw_text: text
    });
  } catch (err) {
    console.error('AI Error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      data: {
        store_name: 'Error',
        store_name_ru: 'Ошибка',
        date: null,
        time: null,
        total: 0,
        currency: 'EUR',
        country: null,
        items: [],
        payment_method: null,
        cashier: null
      }
    });
  }
};
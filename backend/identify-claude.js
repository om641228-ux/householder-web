const Anthropic = require('@anthropic-ai/sdk');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  try {
    const { image, model, currency } = req.body;
    
    console.log('\n' + '='.repeat(60));
    console.log('🔍 CLAUDE ЗАПРОС НА РАСПОЗНАВАНИЕ');
    console.log('='.repeat(60));
    console.log('📌 Модель:', model || 'claude-sonnet-4-20250514');
    console.log('💰 Валюта:', currency || 'AED');
    
    if (!image) {
      return res.status(400).json({ success: false, error: 'Нет изображения' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ 
        success: false, 
        error: 'ANTHROPIC_API_KEY не установлен' 
      });
    }

    const anthropic = new Anthropic({ apiKey });
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

    const claudeModel = model || 'claude-sonnet-4-20250514';
    
    const prompt = `You are a receipt OCR expert. Extract EVERY line from this receipt with EXACT numbers.

CRITICAL:
- Quantities are usually SMALL (1-10), NOT 100
- Read carefully: quantity × price = total
- Extract FINAL TOTAL from receipt
- Include TAX/VAT as separate items

Return ONLY valid JSON:
{
  "store_name": "Store name",
  "store_name_ru": "Название на русском",
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
  "payment_amount": 359.50
}

RULES:
1. ALL products with EXACT quantity (1-10), price, total
2. TAX/VAT as item
3. TOTAL → "total" field
4. SUBTOTAL → "subtotal"
5. TAX amount → "tax"
6. Translate to Russian, keep original
7. Return ONLY JSON`;

    console.log('🚀 Отправка запроса к Claude API...');
    console.log('   Модель:', claudeModel);
    console.log('   Размер изображения:', base64Data.length, 'байт');

    const response = await anthropic.messages.create({
      model: claudeModel,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: base64Data
              }
            }
          ]
        }
      ]
    });

    let text = response.content[0]?.text || '';
    console.log('\n Получен ответ от Claude:');
    console.log('   Длина:', text.length, 'символов');
    
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
    
    res.json({ success: true, data: data, model: claudeModel, provider: 'Claude' });
  } catch (err) {
    console.error('\n❌ ОШИБКА Claude API:', err.message);
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
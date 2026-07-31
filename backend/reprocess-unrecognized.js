const Groq = require('groq-sdk');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const supabase = require('./supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  try {
    const { receiptId, model } = req.body;
    
    console.log('\n' + '='.repeat(60));
    console.log('🔄 ПЕРЕРАСПОЗНАВАНИЕ ЧЕКА');
    console.log('='.repeat(60));
    console.log('📌 receiptId:', receiptId);
    console.log('📌 Модель:', model || 'не указана');
    
    if (!receiptId) {
      return res.status(400).json({ success: false, error: 'Нет ID чека' });
    }

    // Получаем чек из базы
    const { data: receipt, error: fetchError } = await supabase
      .from('receipts')
      .select('*')
      .eq('id', receiptId)
      .single();

    if (fetchError || !receipt) {
      return res.status(404).json({ success: false, error: 'Чек не найден' });
    }

    if (!receipt.image_url) {
      return res.status(400).json({ success: false, error: 'Нет изображения' });
    }

    console.log('📄 Чек:', receipt.store_name_ru || receipt.store_name);

    // Скачиваем изображение
    const imageUrl = receipt.image_url;
    let base64Image = null;

    if (imageUrl.startsWith('http')) {
      const imageResponse = await fetch(imageUrl);
      const imageBuffer = await imageResponse.arrayBuffer();
      base64Image = 'data:image/jpeg;base64,' + Buffer.from(imageBuffer).toString('base64');
    } else if (imageUrl.startsWith('/uploads/')) {
      const fs = require('fs');
      const path = require('path');
      const imagePath = path.join(__dirname, '..', imageUrl);
      if (fs.existsSync(imagePath)) {
        base64Image = 'data:image/jpeg;base64,' + fs.readFileSync(imagePath).toString('base64');
      }
    }

    if (!base64Image) {
      return res.status(400).json({ success: false, error: 'Не удалось загрузить изображение' });
    }

    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
    const currency = receipt.currency || 'AED';

    // Определяем провайдера по названию модели
    const isClaudeModel = model && model.includes('claude');
    const isGroqModel = model && (model.includes('llama') || model.includes('qwen') || model.includes('gpt-oss') || model.includes('groq'));
    const isGeminiModel = model && model.includes('gemini');

    let identifyData = null;

    console.log('🤖 Провайдер:', isClaudeModel ? 'Claude' : isGroqModel ? 'Groq' : isGeminiModel ? 'Gemini' : 'Gemini (по умолчанию)');

    if (isClaudeModel) {
      // === CLAUDE API ===
      console.log('🎨 Используем Claude API...');
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY не установлен');

      const anthropic = new Anthropic({ apiKey });

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
  "currency": "${currency}",
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

      const claudeModel = model || 'claude-sonnet-4-0';

      const response = await anthropic.messages.create({
        model: claudeModel,
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
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
      text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
      
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) throw new Error('Claude: JSON не найден');
      
      identifyData = JSON.parse(text.substring(jsonStart, jsonEnd + 1));
      
    } else if (isGroqModel) {
      // === GROQ API ===
      console.log('⚡ Используем Groq API...');
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) throw new Error('GROQ_API_KEY не установлен');

      const groq = new Groq({ apiKey });

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
  "currency": "${currency}",
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

      const groqModel = model || 'meta-llama/llama-4-scout-17b-16e-instruct';

      const completion = await groq.chat.completions.create({
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Data}` } }
          ]
        }],
        model: groqModel,
        temperature: 0.1,
        max_tokens: 4096
      });

      let text = completion.choices[0]?.message?.content || '';
      text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
      
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) throw new Error('Groq: JSON не найден');
      
      identifyData = JSON.parse(text.substring(jsonStart, jsonEnd + 1));
      
    } else {
      // === GEMINI API (по умолчанию) ===
      console.log('🤖 Используем Gemini API...');
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('GEMINI_API_KEY не установлен');

      const genAI = new GoogleGenerativeAI(apiKey);
      const aiModel = genAI.getGenerativeModel({ model: model || 'gemini-3.5-flash' });

      const prompt = `Extract ALL info from receipt. Return JSON:
{"store_name":"","store_name_ru":"","date":"","time":"","total":0,"subtotal":0,"tax":0,"tax_rate":"","currency":"${currency}","items":[{"name":"","name_ru":"","quantity":1,"price":0,"total":0}],"payment_method":"","payment_amount":0}
Include TAX/VAT as items. Return ONLY JSON.`;

      const result = await aiModel.generateContent([
        prompt, 
        { inlineData: { data: base64Data, mimeType: 'image/jpeg' } }
      ]);
      
      let text = result.response.text().replace(/```json/gi, '').replace(/```/g, '').trim();
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) throw new Error('Gemini: JSON не найден');
      
      identifyData = JSON.parse(text.substring(jsonStart, jsonEnd + 1));
    }

    if (!identifyData.items) identifyData.items = [];
    if (!identifyData.currency) identifyData.currency = currency;

    console.log('\n✅ Перераспознавание завершено:');
    console.log('   Магазин:', identifyData.store_name_ru || identifyData.store_name);
    console.log('   Итого:', identifyData.total, identifyData.currency);
    console.log('   Налог:', identifyData.tax);
    console.log('   Товаров:', identifyData.items.length);
    console.log('='.repeat(60) + '\n');

    // Обновляем чек в базе
    const { error: updateError } = await supabase
      .from('receipts')
      .update({
        store_name: identifyData.store_name || receipt.store_name,
        store_name_ru: identifyData.store_name_ru || receipt.store_name_ru,
        receipt_date: identifyData.date || receipt.receipt_date,
        receipt_time: identifyData.time || receipt.receipt_time,
        total_amount: identifyData.total || receipt.total_amount,
        subtotal: identifyData.subtotal || receipt.subtotal,
        tax_amount: identifyData.tax || receipt.tax_amount,
        tax_rate: identifyData.tax_rate || receipt.tax_rate,
        currency: identifyData.currency || receipt.currency,
        items: identifyData.items,
        payment_method: identifyData.payment_method || receipt.payment_method,
        payment_amount: identifyData.payment_amount || receipt.payment_amount,
        recognized_at: new Date().toISOString(),
        recognition_method: `reprocess:${model || 'default'}`
      })
      .eq('id', receiptId);

    if (updateError) throw updateError;

    res.json({ 
      success: true, 
      message: 'Чек перераспознан',
      data: identifyData,
      model: model,
      recognized_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('\n❌ ОШИБКА перераспознавания:', err.message);
    console.error('='.repeat(60) + '\n');
    res.status(500).json({ success: false, error: err.message });
  }
};
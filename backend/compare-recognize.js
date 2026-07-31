const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const supabase = require('./supabase');
const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  try {
    const { image, currency, docType } = req.body;
    
    console.log('\n' + '='.repeat(60));
    console.log('🔍 СРАВНИТЕЛЬНОЕ РАСПОЗНАВАНИЕ');
    console.log('='.repeat(60));
    console.log('💰 Валюта:', currency || 'AED');
    console.log('📄 Тип:', docType || 'receipt');
    
    if (!image) {
      return res.status(400).json({ success: false, error: 'Нет изображения' });
    }

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

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

    // === ЗАПУСКАЕМ ОБЕ МОДЕЛИ ПАРАЛЛЕЛЬНО ===
    console.log('\n🚀 Запуск Gemini и Groq параллельно...');
    
    const [geminiResult, groqResult] = await Promise.allSettled([
      recognizeWithGemini(base64Data, prompt, currency),
      recognizeWithGroq(base64Data, prompt, currency)
    ]);

    const geminiData = geminiResult.status === 'fulfilled' ? geminiResult.value : null;
    const groqData = groqResult.status === 'fulfilled' ? groqResult.value : null;

    console.log('\n📊 Результаты:');
    console.log('   Gemini:', geminiData ? `✅ ${geminiData.items?.length || 0} товаров, итого: ${geminiData.total}` : '❌ Ошибка');
    console.log('   Groq:', groqData ? `✅ ${groqData.items?.length || 0} товаров, итого: ${groqData.total}` : '❌ Ошибка');

    // === СРАВНЕНИЕ И ВЫБОР ЛУЧШЕГО ===
    const comparison = compareResults(geminiData, groqData);
    
    console.log('\n🏆 Победитель:', comparison.winner);
    console.log('   Причина:', comparison.reason);
    
    const bestData = comparison.bestData;

    // === СОХРАНЕНИЕ В БАЗУ ===
    let imageUrl = null;
    if (image) {
      try {
        const buffer = Buffer.from(base64Data, 'base64');
        const filename = `receipt-${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
        const uploadsDir = path.join(__dirname, '../uploads');
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
        fs.writeFileSync(path.join(uploadsDir, filename), buffer);

        const { error: uploadError } = await supabase.storage.from('receipts').upload(filename, buffer, { contentType: 'image/jpeg', upsert: false });
        if (!uploadError) {
          const { data: { publicUrl } } = supabase.storage.from('receipts').getPublicUrl(filename);
          imageUrl = publicUrl;
        }
      } catch (imgErr) {
        console.error('❌ Error saving image:', imgErr);
      }
    }

    const parseDate = (d) => {
      if (!d) return null;
      if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.split(' ')[0];
      const m = d.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
      if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
      try { const dt = new Date(d); if (!isNaN(dt.getTime())) return dt.toISOString().split('T')[0]; } catch {}
      return null;
    };

    const parseTime = (t) => {
      if (!t) return null;
      if (/^\d{2}:\d{2}:\d{2}/.test(t)) return t;
      if (/^\d{1,2}:\d{2}/.test(t)) return t.padStart(8, '0');
      return null;
    };

    const { data: savedData, error: saveError } = await supabase.from('receipts').insert([{
      store_name: bestData.store_name || null,
      store_name_ru: bestData.store_name_ru || null,
      receipt_date: parseDate(bestData.date),
      receipt_time: parseTime(bestData.time),
      total_amount: bestData.total || null,
      subtotal: bestData.subtotal || null,
      tax_amount: bestData.tax || null,
      tax_rate: bestData.tax_rate || null,
      currency: bestData.currency || currency || 'AED',
      country: bestData.country || null,
      payment_method: bestData.payment_method || null,
      payment_amount: bestData.payment_amount || null,
      items: bestData.items || [],
      image_url: imageUrl,
      document_type: docType || 'receipt',
      recognized_at: new Date().toISOString(),
      recognition_method: `compare:${comparison.winner}`,
      gemini_items_count: geminiData?.items?.length || 0,
      groq_items_count: groqData?.items?.length || 0
    }]).select().single();

    if (saveError) throw saveError;

    console.log('\n✅ Сохранено в базу!');
    console.log('='.repeat(60) + '\n');

    res.json({
      success: true,
      comparison: comparison,
      gemini: geminiData,
      groq: groqData,
      saved: savedData
    });
  } catch (err) {
    console.error('\n❌ ОШИБКА:', err.message);
    console.error('='.repeat(60) + '\n');
    res.status(500).json({ success: false, error: err.message });
  }
};

// === РАСПОЗНАВАНИЕ ЧЕРЕЗ GEMINI ===
async function recognizeWithGemini(base64Data, prompt, currency) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY не установлен');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });

  const result = await model.generateContent([
    prompt,
    { inlineData: { data: base64Data, mimeType: 'image/jpeg' } }
  ]);

  let text = result.response.text().replace(/```json/gi, '').replace(/```/g, '').trim();
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) throw new Error('Gemini: JSON не найден');
  
  const data = JSON.parse(text.substring(jsonStart, jsonEnd + 1));
  if (!data.items) data.items = [];
  if (!data.currency) data.currency = currency || 'AED';
  
  return data;
}

// === РАСПОЗНАВАНИЕ ЧЕРЕЗ GROQ ===
async function recognizeWithGroq(base64Data, prompt, currency) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY не установлен');

  const groq = new Groq({ apiKey });

  const completion = await groq.chat.completions.create({
    messages: [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Data}` } }
      ]
    }],
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    temperature: 0.1,
    max_tokens: 4096
  });

  let text = completion.choices[0]?.message?.content || '';
  text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) throw new Error('Groq: JSON не найден');
  
  const data = JSON.parse(text.substring(jsonStart, jsonEnd + 1));
  if (!data.items) data.items = [];
  if (!data.currency) data.currency = currency || 'AED';
  
  return data;
}

// === СРАВНЕНИЕ РЕЗУЛЬТАТОВ ===
function compareResults(gemini, groq) {
  // Если одна модель не сработала - берем другую
  if (!gemini && groq) return { winner: 'Groq', reason: 'Gemini не сработала', bestData: groq };
  if (gemini && !groq) return { winner: 'Gemini', reason: 'Groq не сработала', bestData: gemini };
  if (!gemini && !groq) return { winner: 'none', reason: 'Обе модели не сработали', bestData: null };

  const geminiItems = gemini.items?.length || 0;
  const groqItems = groq.items?.length || 0;
  const geminiTotal = parseFloat(gemini.total) || 0;
  const groqTotal = parseFloat(groq.total) || 0;
  const geminiTax = parseFloat(gemini.tax) || 0;
  const groqTax = parseFloat(groq.tax) || 0;

  // Считаем "качество" каждой модели
  let geminiScore = 0;
  let groqScore = 0;

  // Больше товаров = лучше (но не слишком много)
  if (geminiItems > 0 && geminiItems <= 50) geminiScore += geminiItems * 10;
  if (groqItems > 0 && groqItems <= 50) groqScore += groqItems * 10;

  // Наличие итоговой суммы
  if (geminiTotal > 0) geminiScore += 50;
  if (groqTotal > 0) groqScore += 50;

  // Наличие налога
  if (geminiTax > 0) geminiScore += 20;
  if (groqTax > 0) groqScore += 20;

  // Наличие названия магазина
  if (gemini.store_name) geminiScore += 10;
  if (groq.store_name) groqScore += 10;

  // Наличие даты
  if (gemini.date) geminiScore += 10;
  if (groq.date) groqScore += 10;

  console.log(`   Gemini score: ${geminiScore} (товаров: ${geminiItems}, итого: ${geminiTotal}, налог: ${geminiTax})`);
  console.log(`   Groq score: ${groqScore} (товаров: ${groqItems}, итого: ${groqTotal}, налог: ${groqTax})`);

  if (geminiScore > groqScore) {
    return { winner: 'Gemini', reason: `Score: ${geminiScore} vs ${groqScore}`, bestData: gemini, scores: { gemini: geminiScore, groq: groqScore } };
  } else if (groqScore > geminiScore) {
    return { winner: 'Groq', reason: `Score: ${groqScore} vs ${geminiScore}`, bestData: groq, scores: { gemini: geminiScore, groq: groqScore } };
  } else {
    // При равенстве берем ту у которой больше товаров
    if (geminiItems >= groqItems) {
      return { winner: 'Gemini', reason: `Равный счет, больше товаров: ${geminiItems}`, bestData: gemini, scores: { gemini: geminiScore, groq: groqScore } };
    } else {
      return { winner: 'Groq', reason: `Равный счет, больше товаров: ${groqItems}`, bestData: groq, scores: { gemini: geminiScore, groq: groqScore } };
    }
  }
}
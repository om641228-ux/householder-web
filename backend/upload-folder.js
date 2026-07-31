const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const supabase = require('./supabase');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'receipt-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  },
  limits: { 
    fileSize: 10 * 1024 * 1024,  // 10MB max file size
    files: 1000  // УВЕЛИЧЕНО С 100 ДО 1000 ФАЙЛОВ
  }
});

const parseDate = (dateStr) => {
  if (!dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.split(' ')[0];
  }
  const match = dateStr.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch (e) {}
  return null;
};

const parseTime = (timeStr) => {
  if (!timeStr) return null;
  if (/^\d{2}:\d{2}:\d{2}/.test(timeStr)) {
    return timeStr;
  }
  if (/^\d{1,2}:\d{2}/.test(timeStr)) {
    return timeStr.padStart(8, '0');
  }
  return null;
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  upload.array('receipts', 1000)(req, res, async (uploadErr) => {
    if (uploadErr) {
      console.error('Upload error:', uploadErr);
      return res.status(400).json({ 
        success: false, 
        error: uploadErr.message,
        message: 'Ошибка загрузки. Превышен лимит файлов или размер.'
      });
    }

    const files = req.files;
    const model = req.body && req.body.model ? req.body.model : 'gemini-3.5-flash';

    console.log('Received files:', files ? files.length : 0);
    console.log('Model:', model);

    if (!files || files.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Файлы не загружены',
        message: 'Проверьте что выбраны изображения'
      });
    }

    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const aiModel = genAI.getGenerativeModel({ 
        model: model,
        generationConfig: { 
          temperature: 0.1, 
          maxOutputTokens: 4000 
        }
      });

      const results = [];
      
      const prompt = `You are a receipt OCR expert. Extract ALL information and translate to Russian.

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
    {"name": "Original product name", "name_ru": "Название на русском", "quantity": 2, "price": 10.50, "total": 21.00}
  ],
  "payment_method": "card",
  "cashier": "Anna"
}

CURRENCY DETECTION RULES:
- If receipt is from UAE/Dubai → use "AED"
- If receipt is from USA → use "USD"
- If receipt is from UK → use "GBP"
- If receipt is from Spain/Europe → use "EUR"
- If receipt is from Russia → use "RUB"

RULES:
- Extract EVERY item
- Translate ALL names to Russian
- Keep original names too
- Use null for unknown fields
- Return ONLY JSON, no markdown`;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        console.log(`Processing file ${i + 1}/${files.length}: ${file.originalname}`);

        try {
          const imageBuffer = fs.readFileSync(file.path);
          const base64Image = imageBuffer.toString('base64');

          const result = await aiModel.generateContent([
            prompt,
            {
              inlineData: {
                data: base64Image,
                mimeType: file.mimetype
              }
            }
          ]);

          const response = result.response;
          let text = response.text();
          text = text.replace(/```json/g, '').replace(/```/g, '').trim();
          
          let jsonStart = text.indexOf('{');
          let jsonEnd = text.lastIndexOf('}');
          
          let data;
          if (jsonStart !== -1 && jsonEnd !== -1) {
            const jsonString = text.substring(jsonStart, jsonEnd + 1);
            try {
              data = JSON.parse(jsonString);
            } catch (parseErr) {
              console.error('JSON parse error:', parseErr);
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
          } else {
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

          if (!data.currency) {
            if (data.store_name && (data.store_name.toLowerCase().includes('dubai') || data.store_name.toLowerCase().includes('uae'))) {
              data.currency = 'AED';
            } else {
              data.currency = 'EUR';
            }
          }

          const formattedDate = parseDate(data.date);
          const formattedTime = parseTime(data.time);

          let imageUrl = null;
          try {
            const filename = `receipt-${Date.now()}-${i}.jpg`;
            const uploadsDir = path.join(__dirname, '../uploads');
            if (!fs.existsSync(uploadsDir)) {
              fs.mkdirSync(uploadsDir, { recursive: true });
            }
            const imagePath = path.join(uploadsDir, filename);
            fs.writeFileSync(imagePath, base64Image, 'base64');
            imageUrl = `/uploads/${filename}`;
          } catch (imgErr) {
            console.error('Error saving image:', imgErr);
          }

          const { data: savedData, error: saveError } = await supabase
            .from('receipts')
            .insert([{
              store_name: data.store_name || null,
              store_name_ru: data.store_name_ru || null,
              receipt_date: formattedDate,
              receipt_time: formattedTime,
              total_amount: data.total || null,
              currency: data.currency || 'EUR',
              country: data.country || null,
              payment_method: data.payment_method || null,
              cashier: data.cashier || null,
              items: data.items || [],
              image_url: imageUrl,
              raw_text: text
            }])
            .select()
            .single();

          try {
            fs.unlinkSync(file.path);
          } catch (e) {}

          results.push({
            filename: file.originalname,
            success: true,
            store: data.store_name,
            store_ru: data.store_name_ru,
            total: data.total,
            currency: data.currency,
            items: data.items.length,
            savedId: savedData?.id,
            error: null
          });

        } catch (fileError) {
          console.error(`Error processing ${file.originalname}:`, fileError);
          
          try {
            if (file.path) fs.unlinkSync(file.path);
          } catch (e) {}

          results.push({
            filename: file.originalname,
            success: false,
            error: fileError.message
          });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const totalAmount = results
        .filter(r => r.success && r.total)
        .reduce((sum, r) => sum + parseFloat(r.total || 0), 0);

      res.json({ 
        success: true, 
        message: `Обработано ${results.length} файлов`,
        results: results,
        summary: {
          total: results.length,
          success: successCount,
          failed: results.length - successCount,
          totalAmount: totalAmount.toFixed(2)
        }
      });

    } catch (error) {
      console.error('Batch processing error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
};
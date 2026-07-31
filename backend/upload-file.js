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
  limits: { fileSize: 10 * 1024 * 1024 }
});

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  upload.single('receipt')(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ success: false, error: uploadErr.message });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Файл не загружен' });
    }

    try {
      const { model } = req.body;
      const imageBuffer = fs.readFileSync(req.file.path);
      const base64Image = imageBuffer.toString('base64');

      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const aiModel = genAI.getGenerativeModel({ 
        model: model || 'gemini-3.5-flash',
        generationConfig: { 
          temperature: 0.1, 
          maxOutputTokens: 4000 
        }
      });

      const prompt = `You are a receipt OCR expert. Extract ALL information and translate to Russian.

Return ONLY valid JSON:
{
  "store_name": "Original store name",
  "store_name_ru": "Название магазина на русском",
  "date": "2024-01-15",
  "time": "14:30",
  "total": 45.99,
  "items": [
    {"name": "Original product name", "name_ru": "Название на русском", "quantity": 2, "price": 10.50, "total": 21.00}
  ],
  "payment_method": "card",
  "cashier": "Anna"
}

RULES:
- Extract EVERY item
- Translate ALL names to Russian (store_name_ru, name_ru)
- Keep original names too (store_name, name)
- Use null for unknown fields
- Prices in EUR
- Return ONLY JSON, no markdown`;

      const result = await aiModel.generateContent([
        prompt,
        {
          inlineData: {
            data: base64Image,
            mimeType: req.file.mimetype
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
          items: [],
          payment_method: null,
          cashier: null
        };
      }

      if (!data.items || !Array.isArray(data.items)) {
        data.items = [];
      }

      // Сохраняем в базу
      const { data: savedData, error: saveError } = await supabase
        .from('receipts')
        .insert([{
          store_name: data.store_name || null,
          store_name_ru: data.store_name_ru || null,
          receipt_date: data.date || null,
          receipt_time: data.time || null,
          total_amount: data.total || null,
          payment_method: data.payment_method || null,
          cashier: data.cashier || null,
          items: data.items || [],
          image_url: `/uploads/${req.file.filename}`,
          raw_text: text
        }])
        .select()
        .single();

      if (saveError) {
        console.error('Save error:', saveError);
      }

      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {}

      res.json({ 
        success: true, 
        message: 'Файл обработан и сохранен',
        data: data,
        savedId: savedData?.id
      });

    } catch (error) {
      console.error('Processing error:', error);
      
      try {
        if (req.file && req.file.path) {
          fs.unlinkSync(req.file.path);
        }
      } catch (e) {}
      
      res.status(500).json({ success: false, error: error.message });
    }
  });
};
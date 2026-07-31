const supabase = require('./supabase');
const fs = require('fs');
const path = require('path');

const parseDate = (dateStr) => {
  if (!dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr.split(' ')[0];
  const match = dateStr.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) return date.toISOString().split('T')[0];
  } catch (e) {}
  return null;
};

const parseTime = (timeStr) => {
  if (!timeStr) return null;
  if (/^\d{2}:\d{2}:\d{2}/.test(timeStr)) return timeStr;
  if (/^\d{1,2}:\d{2}/.test(timeStr)) return timeStr.padStart(8, '0');
  return null;
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  try {
    const { receipt, image, docType, recognitionMethod, recognizedAt, object } = req.body;
    console.log('Saving document:', { store: receipt.store_name, type: docType || 'receipt', object: object || null });

    let imageUrl = null;

    if (image) {
      try {
        const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const filename = `receipt-${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
        
        const uploadsDir = path.join(__dirname, '../uploads');
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
        fs.writeFileSync(path.join(uploadsDir, filename), buffer);

        const { data: uploadData, error: uploadError } = await supabase
          .storage.from('receipts').upload(filename, buffer, { contentType: 'image/jpeg', upsert: false });

        if (uploadError) {
          console.error('❌ Supabase upload error:', uploadError);
        } else {
          const { data: { publicUrl } } = supabase.storage.from('receipts').getPublicUrl(filename);
          imageUrl = publicUrl;
          console.log('✅ Supabase URL:', publicUrl);
        }
      } catch (imgErr) {
        console.error('❌ Error saving image:', imgErr);
      }
    }

    const formattedDate = parseDate(receipt.date);
    const formattedTime = parseTime(receipt.time);
    // ДАТА РАСПОЗНАВАНИЯ: берём с устройства (если прислал фронт и значение валидно), иначе серверное время
    let recognizedAtFinal = new Date().toISOString();
    if (recognizedAt && !isNaN(new Date(recognizedAt).getTime())) {
      recognizedAtFinal = new Date(recognizedAt).toISOString();
    }
    // МЕТОД/МОДЕЛЬ РАСПОЗНАВАНИЯ: из фронта (например "Groq: meta-llama/...") или из самого чека
    const recognitionMethodFinal = recognitionMethod || receipt.recognition_method || null;

    const { data, error } = await supabase
      .from('receipts')
      .insert([{
        store_name: receipt.store_name || null,
        store_name_ru: receipt.store_name_ru || null,
        receipt_date: formattedDate,
        receipt_time: formattedTime,
        total_amount: receipt.total || null,
        subtotal: receipt.subtotal || null,
        tax_amount: receipt.tax || null,
        tax_rate: receipt.tax_rate || null,
        currency: receipt.currency || 'AED',
        country: receipt.country || null,
        payment_method: receipt.payment_method || null,
        payment_amount: receipt.payment_amount || null,
        cashier: receipt.cashier || null,
        items: receipt.items || [],
        image_url: imageUrl,
        raw_text: receipt.raw_text || null,
        document_type: docType || 'receipt',
        recognized_at: recognizedAtFinal, // дата распознавания
        recognition_method: recognitionMethodFinal, // провайдер + модель
        object: object || null, // ОБЪЕКТ (проект)
        owner_id: req.userId || null, // КТО ДОБАВИЛ (id) — из авторизации
        owner_name: req.userName || null // КТО ДОБАВИЛ (имя) — для вывода в карточке
      }])
      .select().single();

    if (error) throw error;

    res.json({ success: true, data });
  } catch (err) {
    console.error('Save Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
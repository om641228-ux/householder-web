// Обновление объекта (проекта) у чека — по аналогии с update-receipt-currency.js
const supabase = require('./supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { receiptId, object } = req.body;
    if (!receiptId) {
      return res.status(400).json({ success: false, error: 'Не указан receiptId' });
    }

    const { data, error } = await supabase
      .from('receipts')
      .update({ object: object || null })
      .eq('id', receiptId)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, data });
  } catch (err) {
    console.error('update-receipt-object error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

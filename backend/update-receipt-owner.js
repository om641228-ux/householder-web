// Смена владельца чека (только админ) — пишет owner_id и owner_name в Supabase.
const supabase = require('./supabase');
const authOwners = require('./auth-owners');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { receiptId, ownerId } = req.body;
    if (!receiptId) {
      return res.status(400).json({ success: false, error: 'Не указан receiptId' });
    }

    // имя пользователя по id (из списка аккаунтов auth-owners)
    const ownerName = ownerId ? authOwners.nameById(ownerId) : null;

    const { data, error } = await supabase
      .from('receipts')
      .update({ owner_id: ownerId || null, owner_name: ownerName })
      .eq('id', receiptId)
      .select()
      .single();

    if (error) throw error;

    // ✅ дублируем в карту владельцев — чтобы пользователь сразу видел свои чеки (фильтрация работает и без колонки)
    try { authOwners.setOwner(receiptId, ownerId || null); } catch (e) {}

    res.json({ success: true, data });
  } catch (err) {
    console.error('update-receipt-owner error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

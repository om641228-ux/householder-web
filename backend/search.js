const supabase = require('./supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { q, type, store, minAmount, maxAmount } = req.query;
    let query = supabase.from('receipts').select('*');

    if (type) query = query.eq('document_type', type);
    if (store) query = query.ilike('store_name', `%${store}%`);
    if (minAmount) query = query.gte('total_amount', parseFloat(minAmount));
    if (maxAmount) query = query.lte('total_amount', parseFloat(maxAmount));
    if (q) query = query.or(`store_name.ilike.%${q}%,raw_text.ilike.%${q}%`);

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
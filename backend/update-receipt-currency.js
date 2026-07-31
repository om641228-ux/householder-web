const supabase = require('./supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  try {
    const { receiptId, currency } = req.body;
    
    console.log('\n' + '='.repeat(60));
    console.log('💱 ОБНОВЛЕНИЕ ВАЛЮТЫ ЧЕКА');
    console.log('='.repeat(60));
    console.log('📌 receiptId:', receiptId);
    console.log('💰 Новая валюта:', currency);
    
    if (!receiptId) {
      return res.status(400).json({ success: false, error: 'Нет ID чека' });
    }
    
    if (!currency) {
      return res.status(400).json({ success: false, error: 'Нет валюты' });
    }

    const { data: receipt, error: fetchError } = await supabase
      .from('receipts')
      .select('*')
      .eq('id', receiptId)
      .single();

    if (fetchError || !receipt) {
      return res.status(404).json({ success: false, error: 'Чек не найден' });
    }

    const { error: updateError } = await supabase
      .from('receipts')
      .update({ currency: currency })
      .eq('id', receiptId);

    if (updateError) throw updateError;

    console.log('✅ Валюта обновлена:', currency);
    console.log('='.repeat(60) + '\n');

    res.json({ 
      success: true, 
      message: 'Валюта обновлена',
      receiptId: receiptId,
      currency: currency
    });
  } catch (err) {
    console.error('\n❌ ОШИБКА обновления валюты:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};
const XLSX = require('xlsx');
const supabase = require('./supabase');
const authOwners = require('./auth-owners');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  try {
    const { receiptIds } = req.body;
    let query = supabase.from('receipts').select('*');
    if (receiptIds && receiptIds.length > 0) query = query.in('id', receiptIds);
    let { data: receipts, error } = await query.order('receipt_date', { ascending: false });
    if (error) throw error;
    // ✅ не-админ экспортирует только свои чеки
    if (req.userRole && req.userRole !== 'admin') {
      receipts = authOwners.filterOwned(receipts, req.userId);
    }
    if (!receipts || receipts.length === 0) return res.status(404).json({ success: false, error: 'Не найдено' });

    const fmt = (v) => parseFloat(v || 0).toFixed(2).replace('.', ',');
    const excelData = [];
    let rowNum = 1;

    receipts.forEach(r => {
      const items = r.items || [];
      let calcTotal = 0;
      items.forEach(it => {
        calcTotal += parseFloat(it.total) || 0;
        excelData.push({
          '№': rowNum++, 'Дата чека': r.receipt_date || '-', 'Время': r.receipt_time || '-',
          'Дата распознавания': r.recognized_at ? new Date(r.recognized_at).toLocaleDateString('ru-RU') : '-',
          'Тип': r.document_type === 'invoice' ? 'Фактура' : 'Чек',
          'Магазин (RU)': r.store_name_ru || r.store_name || '-', 'Магазин': r.store_name || '-',
          'Страна': r.country || '-', 'Товар (RU)': it.name_ru || '-', 'Товар': it.name || '-',
          'Кол-во': it.quantity || 1, 'Цена': fmt(it.price), 'Сумма': fmt(it.total), 'Валюта': r.currency || 'EUR'
        });
      });
      if (items.length === 0) {
        excelData.push({ '№': rowNum++, 'Дата чека': r.receipt_date || '-', 'Время': r.receipt_time || '-', 'Дата распознавания': r.recognized_at ? new Date(r.recognized_at).toLocaleDateString('ru-RU') : '-', 'Тип': r.document_type === 'invoice' ? 'Фактура' : 'Чек', 'Магазин (RU)': r.store_name_ru || r.store_name || '-', 'Магазин': r.store_name || '-', 'Страна': r.country || '-', 'Товар (RU)': '-', 'Товар': '-', 'Кол-во': 1, 'Цена': '0,00', 'Сумма': '0,00', 'Валюта': r.currency || 'EUR' });
      }
      const receiptTotal = parseFloat(r.total_amount) || 0;
      excelData.push({ '№': '', 'Дата чека': '', 'Время': '', 'Дата распознавания': '', 'Тип': '', 'Магазин (RU)': 'ИТОГО:', 'Магазин': '', 'Страна': '', 'Товар (RU)': `${items.length} позиций`, 'Товар': '', 'Кол-во': '', 'Цена': '', 'Сумма': '', 'Итого (расчет)': fmt(calcTotal), 'Итого (чек)': fmt(receiptTotal), 'Разница': fmt(calcTotal - receiptTotal), 'Валюта': r.currency || 'EUR' });
      excelData.push({ '№': '', 'Дата чека': '', 'Время': '', 'Дата распознавания': '', 'Тип': '', 'Магазин (RU)': '', 'Магазин': '', 'Страна': '', 'Товар (RU)': '', 'Товар': '', 'Кол-во': '', 'Цена': '', 'Сумма': '', 'Итого (расчет)': '', 'Итого (чек)': '', 'Разница': '', 'Валюта': '' });
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);
    ws['!cols'] = [{wch:5},{wch:12},{wch:10},{wch:15},{wch:10},{wch:35},{wch:35},{wch:10},{wch:45},{wch:45},{wch:8},{wch:12},{wch:12},{wch:8},{wch:14},{wch:12},{wch:12},{wch:8}];
    XLSX.utils.book_append_sheet(wb, ws, 'Детализация');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="receipts.xlsx"');
    res.send(buffer);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
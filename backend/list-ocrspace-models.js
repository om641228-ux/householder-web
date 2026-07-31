module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // OCR.space имеет 3 движка (нет API для списка, хардкод)
  const allModels = [
    { id: 'ocrspace-engine1', name: 'OCR.space Engine 1 (Basic, fast)', status: 'ok' },
    { id: 'ocrspace-engine2', name: 'OCR.space Engine 2 (Advanced, receipts)', status: 'ok' },
    { id: 'ocrspace-engine3', name: 'OCR.space Engine 3 (Handwriting, tables)', status: 'ok' },
  ];

  res.json({ models: allModels });
};
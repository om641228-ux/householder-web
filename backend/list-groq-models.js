const Groq = require('groq-sdk');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.json({ models: [] });
    }

    const groq = new Groq({ apiKey });
    const modelsList = await groq.models.list();

    if (!modelsList.data || modelsList.data.length === 0) {
      return res.json({ models: [] });
    }

    // ВСЕ модели Groq
    const allModels = modelsList.data.map(m => ({
      id: m.id,
      name: m.name || m.id,
      status: 'ok'
    }));

    res.json({ models: allModels });
  } catch (err) {
    console.error('Groq models error:', err);
    res.json({ models: [] });
  }
};
const fetch = require('node-fetch');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.json({
        models: [
          { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', status: 'ok' },
          { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', status: 'ok' },
          { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', status: 'ok' },
          { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview', status: 'ok' },
          { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', status: 'ok' },
          { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', status: 'ok' },
          { id: 'gemini-3-pro-image', name: 'Gemini 3 Pro Image', status: 'ok' },
          { id: 'gemini-3.1-flash-image', name: 'Gemini 3.1 Flash Image', status: 'ok' },
          { id: 'gemini-flash-latest', name: 'Gemini Flash Latest', status: 'ok' },
          { id: 'gemini-pro-latest', name: 'Gemini Pro Latest', status: 'ok' },
        ]
      });
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await response.json();

    if (!data.models) {
      return res.json({ models: [] });
    }

    // ВСЕ модели с generateContent (поддерживают изображения)
    const allModels = data.models
      .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
      .map(m => ({
        id: m.name.replace('models/', ''),
        name: m.displayName || m.name.replace('models/', ''),
        status: 'ok'
      }));

    res.json({ models: allModels });
  } catch (err) {
    console.error('Gemini models error:', err);
    res.json({ models: [] });
  }
};
const Groq = require('groq-sdk');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  try {
    const results = [];

    // === 1. ТЕСТИРУЕМ GEMINI МОДЕЛИ ===
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (geminiApiKey) {
      try {
        const modelsResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiApiKey}`);
        const modelsData = await modelsResponse.json();

        if (modelsData.models) {
          const geminiModels = modelsData.models
            .filter(model => 
              model.supportedGenerationMethods && 
              model.supportedGenerationMethods.includes('generateContent') &&
              model.name.includes('gemini')
            )
            .map(model => model.name.replace('models/', ''));

          console.log(`Found ${geminiModels.length} Gemini models`);

          for (const modelName of geminiModels) {
            try {
              const testResponse = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    contents: [{ parts: [{ text: 'Say "OK"' }] }]
                  })
                }
              );
              
              const testData = await testResponse.json();
              
              if (testResponse.ok && testData.candidates) {
                results.push({
                  name: modelName,
                  provider: 'Gemini',
                  status: 'ok',
                  message: '✅ Доступна'
                });
              } else {
                results.push({
                  name: modelName,
                  provider: 'Gemini',
                  status: 'error',
                  message: testData.error?.message || '❌ Ошибка'
                });
              }
            } catch (err) {
              results.push({
                name: modelName,
                provider: 'Gemini',
                status: 'error',
                message: '❌ Нет подключения'
              });
            }
          }
        }
      } catch (err) {
        console.error('Gemini models error:', err);
      }
    }

    // === 2. ТЕСТИРУЕМ GROQ МОДЕЛИ ===
    const groqApiKey = process.env.GROQ_API_KEY;
    if (groqApiKey) {
      try {
        const groq = new Groq({ apiKey: groqApiKey });
        
        // Актуальные модели Groq для распознавания чеков
        const groqModelsToTest = [
          'llama-3.3-70b-versatile',      // Лучшая для OCR
          'llama-3.1-70b-versatile',      // Отличная для OCR
          'llama-3.1-8b-instant',         // Быстрая
          'qwen/qwen3-32b',               // Хорошая альтернатива
        ];
        
        console.log(`Testing ${groqModelsToTest.length} Groq models...`);

        for (const modelName of groqModelsToTest) {
          try {
            const testResponse = await groq.chat.completions.create({
              messages: [
                {
                  role: "user",
                  content: "Say OK"
                }
              ],
              model: modelName,
              max_tokens: 10
            });

            if (testResponse.choices && testResponse.choices.length > 0) {
              results.push({
                name: modelName,
                provider: 'Groq',
                status: 'ok',
                message: '✅ Groq (бесплатно)'
              });
              console.log(`✅ ${modelName}`);
            }
          } catch (err) {
            console.log(`❌ ${modelName}: ${err.message}`);
            results.push({
              name: modelName,
              provider: 'Groq',
              status: 'error',
              message: '❌ Ошибка'
            });
          }
        }
      } catch (err) {
        console.error('Groq initialization error:', err);
      }
    }

    // Сортируем: сначала рабочие, потом по провайдеру и имени
    results.sort((a, b) => {
      if (a.status === 'ok' && b.status !== 'ok') return -1;
      if (a.status !== 'ok' && b.status === 'ok') return 1;
      if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
      return a.name.localeCompare(b.name);
    });

    res.json({ 
      success: true, 
      totalModels: results.length,
      workingModels: results.filter(r => r.status === 'ok').length,
      results: results 
    });
  } catch (err) {
    console.error('List models error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
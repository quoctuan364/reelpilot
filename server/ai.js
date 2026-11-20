'use strict';

function buildOfflineMetadata({ topic, script, tone, language }) {
  const seed = String(topic || script || 'Mẹo tối ưu quy trình làm video ngắn').trim();
  const firstSentence = seed.split(/[.!?\n]/).map(s => s.trim()).filter(Boolean)[0] || seed;
  const shortCore = firstSentence.slice(0, 68);
  const isEn = language === 'en';

  const tonePrefix = {
    viral: isEn ? 'Stop scrolling:' : 'Đừng bỏ qua:',
    educational: isEn ? 'Quick Guide:' : 'Hướng dẫn nhanh:',
    sales: isEn ? 'Save hours with' : 'Tiết kiệm hàng giờ với',
    story: isEn ? 'Behind the scenes:' : 'Góc nhìn thực tế:'
  }[tone] || (isEn ? 'Must know:' : 'Mẹo hay:');

  const rawTitle = `${tonePrefix} ${shortCore}`.slice(0, 88);
  const title = rawTitle.includes('#Shorts') ? rawTitle : `${rawTitle} #Shorts`;

  const description = isEn
    ? `${seed}\n\nSave this clip to apply later and follow for daily automation workflows.`
    : `${seed}\n\nLưu lại để áp dụng ngay cho kênh của bạn và theo dõi để xem thêm các quy trình tự động hóa thực tế mỗi ngày.`;

  const asciiSeed = seed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();

  const keywords = asciiSeed
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4)
    .slice(0, 4)
    .map(w => `#${w}`);

  const baseTags = isEn
    ? ['#Shorts', '#Reels', '#ContentCreator', '#Automation', '#Productivity']
    : ['#Shorts', '#Reels', '#TuDongHoa', '#LamVideoNgan', '#ContentCreator'];

  const hashtags = Array.from(new Set([...baseTags, ...keywords])).slice(0, 8).join(' ');

  return {
    title,
    description,
    hashtags,
    hookTip: isEn
      ? 'Keep the first 2.5 seconds visual and place bold captions inside the 9:16 safe zone.'
      : 'Giữ 3 giây đầu đi thẳng vào kết quả, đặt chữ lớn trong vùng an toàn 9:16 để tăng tỷ lệ xem hết.',
    source: 'offline_preview'
  };
}

async function generateReelMetadata({ topic = '', script = '', tone = 'viral', language = 'vi' }, settings = {}) {
  const apiKey = (settings.gemini_api_key || process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return buildOfflineMetadata({ topic, script, tone, language });
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const langLabel = language === 'en' ? 'English' : 'Vietnamese';

  const prompt = [
    `You are a short-form video growth strategist for YouTube Shorts and Facebook Reels.`,
    `Write metadata in ${langLabel} with tone "${tone}".`,
    `Topic: ${topic || '(not specified)'}`,
    `Script/Notes: ${script || '(not specified)'}`,
    `Return ONLY valid JSON with keys:`,
    `- "title": catchy Shorts title <= 95 chars, include "#Shorts" at the end`,
    `- "description": engaging 2-4 line caption with a clear call-to-action`,
    `- "hashtags": space-separated 6-8 relevant hashtags starting with #`,
    `- "hookTip": one concise 1-sentence retention tip for the first 3 seconds`
  ].join('\n');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        responseMimeType: 'application/json'
      }
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || `Gemini API lỗi HTTP ${res.status}`);
  }

  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = JSON.parse(rawText);

  return {
    title: String(parsed.title || '').trim().slice(0, 100),
    description: String(parsed.description || '').trim(),
    hashtags: String(parsed.hashtags || '').trim(),
    hookTip: String(parsed.hookTip || '').trim(),
    source: 'gemini'
  };
}

module.exports = {
  generateReelMetadata,
  buildOfflineMetadata
};

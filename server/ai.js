'use strict';

function stripDiacritics(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd');
}

function formatSrtTimestamp(sec) {
  const totalMs = Math.max(0, Math.round(Number(sec || 0) * 1000));
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function buildSrtFromScenes(scenes = []) {
  let cursor = 0;
  return scenes.map((scene, idx) => {
    const dur = Math.max(2, Number(scene.durationSec || 4.5));
    const start = cursor;
    const end = cursor + dur;
    cursor = end;
    const text = String(scene.subtitle || scene.narration || '').trim();
    return `${idx + 1}\n${formatSrtTimestamp(start)} --> ${formatSrtTimestamp(end)}\n${text}`;
  }).join('\n\n') + '\n';
}

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

  const asciiSeed = stripDiacritics(seed).toLowerCase();
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

function buildOfflineVideoPlan({ topic, tone = 'viral', language = 'vi' }) {
  const meta = buildOfflineMetadata({ topic, script: '', tone, language });
  const cleanTopic = String(topic || 'Tự động hóa video ngắn').trim();
  const isEn = language === 'en';

  const scenes = isEn
    ? [
        {
          narration: `Stop wasting hours doing ${cleanTopic} manually.`,
          subtitle: `STOP DOING IT MANUALLY!`,
          searchQuery: 'person typing laptop dark studio',
          durationSec: 4
        },
        {
          narration: `Step one: break your idea into fast 3-second visual hooks.`,
          subtitle: `STEP 1: 3-SECOND HOOK`,
          searchQuery: 'smartphone video editing vertical',
          durationSec: 5
        },
        {
          narration: `Step two: automate captions, B-roll footage, and multi-platform publishing.`,
          subtitle: `STEP 2: AUTOMATE WORKFLOW`,
          searchQuery: 'coding computer screen technology',
          durationSec: 5.5
        },
        {
          narration: `Save this video and follow for more practical automation tips!`,
          subtitle: `SAVE & FOLLOW FOR MORE`,
          searchQuery: 'modern workspace desk minimal',
          durationSec: 4.5
        }
      ]
    : [
        {
          narration: `Đừng tốn hàng giờ làm thủ công chủ đề ${cleanTopic} nữa!`,
          subtitle: `ĐỪNG LÀM THỦ CÔNG NỮA!`,
          searchQuery: 'person typing laptop dark desk',
          durationSec: 4
        },
        {
          narration: `Bước 1: Chốt ngay câu mở đầu 3 giây đi thẳng vào kết quả thực tế.`,
          subtitle: `BƯỚC 1: HOOK 3 GIÂY ĐẦU`,
          searchQuery: 'smartphone content creator studio',
          durationSec: 5
        },
        {
          narration: `Bước 2: Tự động lấy cảnh nền 9:16, gắn phụ đề chữ lớn và lên lịch đăng.`,
          subtitle: `BƯỚC 2: TỰ ĐỘNG DỰNG & ĐĂNG`,
          searchQuery: 'coding laptop technology neon',
          durationSec: 5.5
        },
        {
          narration: `Lưu lại video này và theo dõi kênh để xem thêm mẹo tự động hóa mỗi ngày!`,
          subtitle: `LƯU LẠI & THEO DÕI KÊNH`,
          searchQuery: 'minimalist desk setup night',
          durationSec: 4.5
        }
      ];

  return {
    ...meta,
    scenes,
    source: 'offline_preview'
  };
}

async function callGeminiJson(prompt, apiKey) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
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
  return JSON.parse(rawText);
}

async function generateReelMetadata({ topic = '', script = '', tone = 'viral', language = 'vi' }, settings = {}) {
  const apiKey = (settings.gemini_api_key || process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return buildOfflineMetadata({ topic, script, tone, language });
  }

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

  const parsed = await callGeminiJson(prompt, apiKey);
  return {
    title: String(parsed.title || '').trim().slice(0, 100),
    description: String(parsed.description || '').trim(),
    hashtags: String(parsed.hashtags || '').trim(),
    hookTip: String(parsed.hookTip || '').trim(),
    source: 'gemini'
  };
}

async function generateFullVideoPlan({ topic = '', tone = 'viral', language = 'vi', sceneCount = 4 }, settings = {}) {
  const apiKey = (settings.gemini_api_key || process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return buildOfflineVideoPlan({ topic, tone, language });
  }

  const langLabel = language === 'en' ? 'English' : 'Vietnamese';
  const count = Math.min(6, Math.max(3, Number(sceneCount) || 4));
  const prompt = [
    `You are a faceless vertical 9:16 video producer for YouTube Shorts and Facebook Reels.`,
    `Topic: "${topic}"`,
    `Language for title/description/narration/subtitle: ${langLabel}. Tone: ${tone}.`,
    `Return ONLY valid JSON with keys:`,
    `- "title": catchy Shorts title <= 95 chars ending with "#Shorts"`,
    `- "description": engaging 2-3 line caption with CTA`,
    `- "hashtags": 6-8 space-separated hashtags`,
    `- "hookTip": 1 sentence retention tip`,
    `- "scenes": array of exactly ${count} objects, each with:`,
    `   - "narration": natural spoken sentence (10-18 words) in ${langLabel}`,
    `   - "subtitle": punchy 4-8 word overlay caption in ${langLabel}`,
    `   - "searchQuery": 2-4 simple ENGLISH keywords to search vertical stock footage on Pexels (e.g. "laptop coding night")`,
    `   - "durationSec": number between 3.5 and 6`
  ].join('\n');

  const parsed = await callGeminiJson(prompt, apiKey);
  const scenes = Array.isArray(parsed.scenes) && parsed.scenes.length
    ? parsed.scenes.map(s => ({
        narration: String(s.narration || '').trim(),
        subtitle: String(s.subtitle || s.narration || '').trim(),
        searchQuery: String(s.searchQuery || 'technology workspace').trim(),
        durationSec: Math.min(8, Math.max(2.5, Number(s.durationSec) || 4.5))
      }))
    : buildOfflineVideoPlan({ topic, tone, language }).scenes;

  return {
    title: String(parsed.title || `${topic} #Shorts`).trim().slice(0, 100),
    description: String(parsed.description || '').trim(),
    hashtags: String(parsed.hashtags || '#Shorts #Reels').trim(),
    hookTip: String(parsed.hookTip || '').trim(),
    scenes,
    source: 'gemini'
  };
}

module.exports = {
  generateReelMetadata,
  generateFullVideoPlan,
  buildOfflineMetadata,
  buildOfflineVideoPlan,
  buildSrtFromScenes
};

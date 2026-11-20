'use strict';

const fs = require('node:fs');
const db = require('./db');
const publishers = require('./publishers');
const videoPipeline = require('./video-pipeline');

let running = false;
let pollTimer = null;
let updateOffset = 0;
let botUsername = '';
let lastError = '';

async function tgCall(token, method, payload = {}) {
  const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.description || `Telegram API HTTP ${res.status}`);
  }
  return data.result;
}

async function sendTelegramMessage(token, chatId, text, replyMarkup = null) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return tgCall(token, 'sendMessage', payload);
}

async function sendTelegramVideoIfExists(token, chatId, videoPath, caption) {
  if (!videoPath || !fs.existsSync(videoPath)) return false;
  const stat = fs.statSync(videoPath);
  if (stat.size > 48 * 1024 * 1024) return false; // Telegram Bot API 50MB limit

  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('caption', caption.slice(0, 1000));
  const blob = new Blob([fs.readFileSync(videoPath)], { type: 'video/mp4' });
  form.append('video', blob, 'reelpilot-preview.mp4');

  const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendVideo`, {
    method: 'POST',
    body: form
  });
  const data = await res.json().catch(() => ({}));
  return Boolean(res.ok && data.ok);
}

function escapeTg(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function handleTextCommand(token, message, settings) {
  const chatId = String(message.chat?.id || '');
  const text = String(message.text || '').trim();
  if (!chatId || !text) return;

  const ownerChatId = String(settings.telegram_chat_id || '').trim();
  if (ownerChatId && ownerChatId !== chatId) {
    return; // Ignore unauthorized Telegram users
  }

  if (text.startsWith('/start') || text.startsWith('/help')) {
    const lockNote = ownerChatId
      ? '✅ Bot đã khóa riêng cho tài khoản của bạn.'
      : `ℹ️ <b>Chat ID của bạn:</b> <code>${chatId}</code>\nHãy dán mã này vào ô <i>Owner Chat ID</i> trong ReelPilot để chỉ riêng bạn ra lệnh được.`;

    await sendTelegramMessage(token, chatId, [
      '<b>🎬 ReelPilot Studio v2.0 — Điều khiển từ điện thoại</b>',
      '',
      'Các lệnh hỗ trợ:',
      '• <code>/make &lt;chủ đề&gt;</code> — Tự tạo kịch bản, tìm cảnh 9:16, dựng video &amp; gửi về duyệt',
      '• <code>/status</code> — Xem trạng thái API &amp; số lượng lịch đăng',
      '• <code>/queue</code> — Xem 5 video gần nhất trong hàng đợi',
      '',
      lockNote
    ].join('\n'));
    return;
  }

  if (text.startsWith('/status')) {
    const stats = db.getStats();
    const safe = db.getSafeSettings();
    const ff = videoPipeline.detectFfmpeg(settings.ffmpeg_path);
    await sendTelegramMessage(token, chatId, [
      '<b>📊 Trạng thái ReelPilot Studio</b>',
      `• Chế độ: <b>${safe.mode === 'live' ? 'LIVE (Đăng thật)' : 'DRY-RUN (Chạy thử)'}</b>`,
      `• YouTube Shorts: ${safe.connections.youtubeConnected ? '✅ Đã nối' : '⚪ Chưa nối'}`,
      `• FB Page Reels: ${safe.connections.facebookConnected ? '✅ Đã nối' : '⚪ Chưa nối'}`,
      `• Pexels 9:16: ${safe.connections.pexelsConfigured ? '✅ Sẵn sàng' : '⚪ Chưa có key'}`,
      `• FFmpeg Render: ${ff.available ? '✅ Sẵn sàng' : '⚪ Chưa cài'}`,
      `• Hàng đợi: <b>${stats.scheduled}</b> lên lịch · <b>${stats.published}</b> đã đăng · <b>${stats.draft}</b> nháp`
    ].join('\n'));
    return;
  }

  if (text.startsWith('/queue')) {
    const posts = db.listPosts().slice(0, 5);
    if (!posts.length) {
      await sendTelegramMessage(token, chatId, 'Hàng đợi hiện đang trống.');
      return;
    }
    const lines = posts.map((p, i) => `${i + 1}. [${p.status.toUpperCase()}] ${escapeTg(p.title)}`);
    await sendTelegramMessage(token, chatId, `<b>📋 5 bài gần nhất:</b>\n${lines.join('\n')}`);
    return;
  }

  if (text.startsWith('/make')) {
    const topic = text.replace(/^\/make(@\w+)?/i, '').trim();
    if (!topic) {
      await sendTelegramMessage(token, chatId, 'Cú pháp đúng: <code>/make 3 mẹo tiết kiệm pin laptop</code>');
      return;
    }
    await sendTelegramMessage(token, chatId, `⏳ Đang chạy Auto-Video Pipeline cho chủ đề:\n<i>"${escapeTg(topic)}"</i>...`);
    try {
      const { job, post, plan } = await videoPipeline.runAutoVideoPipeline({
        topic,
        language: 'vi',
        tone: 'viral',
        platforms: ['youtube', 'facebook'],
        sourceChannel: 'telegram',
        autoPublish: false
      });

      if (job.videoPath) {
        await sendTelegramVideoIfExists(token, chatId, job.videoPath, post.title);
      }

      const scenesSummary = (plan.scenes || [])
        .map((s, idx) => `${idx + 1}. ${escapeTg(s.subtitle)} (${s.durationSec}s)`)
        .join('\n');

      await sendTelegramMessage(
        token,
        chatId,
        [
          `<b>✅ Đã tạo xong (${job.renderMode === 'rendered_mp4' ? 'Video 1080×1920 .MP4' : 'Storyboard + .SRT'})</b>`,
          `<b>Tiêu đề:</b> ${escapeTg(post.title)}`,
          `<b>Hashtags:</b> ${escapeTg(post.hashtags)}`,
          '',
          `<b>Các cảnh (${plan.scenes?.length || 0}):</b>`,
          scenesSummary,
          '',
          'Chọn hành động bên dưới:'
        ].join('\n'),
        {
          inline_keyboard: [
            [
              { text: '✅ Duyệt & Đăng Ngay', callback_data: `pub:${post.id}` },
              { text: '⏰ Hẹn +1 Giờ', callback_data: `sched60:${post.id}` }
            ],
            [{ text: '🗑 Xóa Nháp', callback_data: `del:${post.id}` }]
          ]
        }
      );
    } catch (err) {
      await sendTelegramMessage(token, chatId, `❌ Lỗi tạo video: ${escapeTg(err.message)}`);
    }
  }
}

async function handleCallbackQuery(token, cb, settings) {
  const chatId = String(cb.message?.chat?.id || '');
  const ownerChatId = String(settings.telegram_chat_id || '').trim();
  if (ownerChatId && ownerChatId !== chatId) return;

  const [action, postId] = String(cb.data || '').split(':');
  await tgCall(token, 'answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});

  if (!postId) return;
  if (action === 'pub') {
    await sendTelegramMessage(token, chatId, '🚀 Đang kích hoạt đăng lên YouTube Shorts & Facebook Page Reels...');
    try {
      const updated = await publishers.publishPost(postId);
      const links = [updated.youtubeUrl, updated.facebookUrl].filter(Boolean).join('\n');
      await sendTelegramMessage(
        token,
        chatId,
        updated.status === 'published'
          ? `✅ <b>Đăng thành công${updated.dryRun ? ' (DRY-RUN)' : ''}!</b>\n${escapeTg(links)}`
          : `❌ <b>Đăng gặp lỗi:</b> ${escapeTg(updated.lastError)}`
      );
    } catch (err) {
      await sendTelegramMessage(token, chatId, `❌ Lỗi: ${escapeTg(err.message)}`);
    }
  } else if (action === 'sched60') {
    const targetIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.updatePost(postId, { status: 'scheduled', scheduledAt: targetIso });
    await sendTelegramMessage(token, chatId, '⏰ Đã hẹn tự động đăng sau 1 giờ!');
  } else if (action === 'del') {
    db.deletePost(postId);
    await sendTelegramMessage(token, chatId, '🗑 Đã xóa bản nháp khỏi hàng đợi.');
  }
}

async function pollOnce() {
  if (!running) return;
  const settings = db.getAllSettingsRaw();
  const token = settings.telegram_bot_token;
  if (!token || settings.telegram_enabled !== '1') {
    stopTelegramBot();
    return;
  }

  try {
    const updates = await tgCall(token, 'getUpdates', {
      offset: updateOffset,
      timeout: 0,
      allowed_updates: ['message', 'callback_query']
    });
    lastError = '';
    for (const u of updates || []) {
      updateOffset = Math.max(updateOffset, Number(u.update_id) + 1);
      if (u.message) {
        await handleTextCommand(token, u.message, settings);
      } else if (u.callback_query) {
        await handleCallbackQuery(token, u.callback_query, settings);
      }
    }
  } catch (err) {
    lastError = err.message;
  }

  if (running) {
    pollTimer = setTimeout(pollOnce, 3000);
    pollTimer.unref();
  }
}

async function testTelegramBot(tokenOverride) {
  const token = (tokenOverride || db.getAllSettingsRaw().telegram_bot_token || '').trim();
  if (!token) return { ok: false, message: 'Chưa nhập Telegram Bot Token.' };
  try {
    const me = await tgCall(token, 'getMe');
    botUsername = me.username ? `@${me.username}` : me.first_name || 'Bot';
    return { ok: true, username: botUsername, message: `Đã kết nối Telegram Bot: ${botUsername}` };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

async function startTelegramBot() {
  const settings = db.getAllSettingsRaw();
  if (!settings.telegram_bot_token) {
    return { running: false, error: 'Chưa có Telegram Bot Token.' };
  }
  const check = await testTelegramBot(settings.telegram_bot_token);
  if (!check.ok) {
    lastError = check.message;
    return { running: false, error: check.message };
  }
  stopTelegramBot();
  running = true;
  lastError = '';
  db.addLog({
    platform: 'telegram',
    level: 'success',
    message: `Telegram Bot ${botUsername} đã bật chế độ lắng nghe lệnh từ điện thoại.`
  });
  pollOnce();
  return getTelegramStatus();
}

function stopTelegramBot() {
  running = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function getTelegramStatus() {
  return {
    running,
    botUsername,
    lastError
  };
}

module.exports = {
  startTelegramBot,
  stopTelegramBot,
  testTelegramBot,
  getTelegramStatus
};

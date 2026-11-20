'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('./db');

const YT_AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const YT_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YT_UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const YT_CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true';

function buildYouTubeAuthUrl(settings) {
  if (!settings.yt_client_id || !settings.yt_client_secret) {
    throw new Error('Vui lòng nhập YouTube Client ID và Client Secret trước khi kết nối.');
  }
  const params = new URLSearchParams({
    client_id: settings.yt_client_id,
    redirect_uri: settings.yt_redirect_uri || 'http://localhost:4330/api/oauth/youtube/callback',
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly'
    ].join(' '),
    access_type: 'offline',
    prompt: 'consent'
  });
  return `${YT_AUTH_BASE}?${params.toString()}`;
}

async function exchangeYouTubeCode(code, settings) {
  const body = new URLSearchParams({
    code,
    client_id: settings.yt_client_id,
    client_secret: settings.yt_client_secret,
    redirect_uri: settings.yt_redirect_uri || 'http://localhost:4330/api/oauth/youtube/callback',
    grant_type: 'authorization_code'
  });

  const res = await fetch(YT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `OAuth đổi mã thất bại (HTTP ${res.status})`);
  }

  const expiry = String(Date.now() + (Number(data.expires_in) || 3500) * 1000);
  const patch = {
    yt_access_token: data.access_token,
    yt_token_expiry: expiry
  };
  if (data.refresh_token) {
    patch.yt_refresh_token = data.refresh_token;
  }

  // Fetch connected channel display title
  try {
    const chRes = await fetch(YT_CHANNELS_URL, {
      headers: { Authorization: `Bearer ${data.access_token}` }
    });
    const chData = await chRes.json().catch(() => ({}));
    const title = chData.items?.[0]?.snippet?.title;
    if (title) patch.yt_channel_name = title;
  } catch {
    // Non-fatal
  }

  db.saveSettings(patch);
  db.addLog({
    platform: 'youtube',
    level: 'success',
    message: `Kết nối OAuth YouTube thành công${patch.yt_channel_name ? `: ${patch.yt_channel_name}` : ''}.`
  });
  return patch;
}

async function ensureYouTubeAccessToken(settings) {
  const expiry = Number(settings.yt_token_expiry || 0);
  if (settings.yt_access_token && Date.now() < expiry - 60000) {
    return settings.yt_access_token;
  }
  if (!settings.yt_refresh_token) {
    if (settings.yt_access_token) return settings.yt_access_token;
    throw new Error('Chưa kết nối tài khoản YouTube OAuth 2.0 (thiếu refresh_token).');
  }

  const body = new URLSearchParams({
    client_id: settings.yt_client_id,
    client_secret: settings.yt_client_secret,
    refresh_token: settings.yt_refresh_token,
    grant_type: 'refresh_token'
  });

  const res = await fetch(YT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'Làm mới YouTube access_token thất bại.');
  }

  const newExpiry = String(Date.now() + (Number(data.expires_in) || 3500) * 1000);
  db.saveSettings({
    yt_access_token: data.access_token,
    yt_token_expiry: newExpiry
  });
  return data.access_token;
}

function buildFullCaption(post) {
  const parts = [];
  if (post.description) parts.push(post.description.trim());
  if (post.hashtags) parts.push(post.hashtags.trim());
  return parts.join('\n\n').trim();
}

function getMimeType(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mkv') return 'video/x-matroska';
  return 'video/mp4';
}

async function publishToYouTube(post, settings, isDryRun) {
  if (isDryRun) {
    const fakeId = `dryyt_${crypto.randomUUID().slice(0, 8)}`;
    const url = `https://youtube.com/shorts/${fakeId}`;
    db.addLog({
      postId: post.id,
      platform: 'youtube',
      level: 'info',
      message: `[DRY-RUN] Khởi tạo phiên upload YouTube Data API v3 cho "${post.title}" (${post.videoFilename || 'demo.mp4'}).`
    });
    db.addLog({
      postId: post.id,
      platform: 'youtube',
      level: 'success',
      message: `[DRY-RUN] Giả lập đăng YouTube Shorts thành công -> ${url}`
    });
    return { videoId: fakeId, url };
  }

  if (!post.videoPath || !fs.existsSync(post.videoPath)) {
    throw new Error('Không tìm thấy file video cục bộ để tải lên YouTube.');
  }

  const accessToken = await ensureYouTubeAccessToken(settings);
  const fileBuffer = fs.readFileSync(post.videoPath);
  const mimeType = getMimeType(post.videoPath);
  const fullDesc = buildFullCaption(post);
  const title = post.title.includes('#Shorts')
    ? post.title.slice(0, 100)
    : `${post.title.slice(0, 91)} #Shorts`;

  const metadata = {
    snippet: {
      title,
      description: fullDesc.includes('#Shorts') ? fullDesc : `${fullDesc}\n#Shorts`.trim(),
      categoryId: '22'
    },
    status: {
      privacyStatus: ['public', 'unlisted', 'private'].includes(post.privacy) ? post.privacy : 'public',
      selfDeclaredMadeForKids: false
    }
  };

  db.addLog({
    postId: post.id,
    platform: 'youtube',
    level: 'info',
    message: `Khởi tạo phiên Resumable Upload YouTube (${(fileBuffer.length / (1024 * 1024)).toFixed(2)} MB)...`
  });

  const initRes = await fetch(YT_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(fileBuffer.length),
      'X-Upload-Content-Type': mimeType
    },
    body: JSON.stringify(metadata)
  });

  const uploadUrl = initRes.headers.get('location');
  if (!initRes.ok || !uploadUrl) {
    const errBody = await initRes.text().catch(() => '');
    throw new Error(`YouTube init upload lỗi (HTTP ${initRes.status}): ${errBody.slice(0, 200)}`);
  }

  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': mimeType,
      'Content-Length': String(fileBuffer.length)
    },
    body: fileBuffer
  });

  const uploaded = await putRes.json().catch(() => ({}));
  if (!putRes.ok || !uploaded.id) {
    throw new Error(uploaded.error?.message || `YouTube upload binary lỗi (HTTP ${putRes.status})`);
  }

  const url = `https://youtube.com/shorts/${uploaded.id}`;
  db.addLog({
    postId: post.id,
    platform: 'youtube',
    level: 'success',
    message: `Đăng YouTube Shorts thành công -> ${url}`
  });
  return { videoId: uploaded.id, url };
}

async function publishToFacebookReels(post, settings, isDryRun) {
  if (isDryRun) {
    const fakeId = `dryfb_${crypto.randomUUID().slice(0, 8)}`;
    const url = `https://www.facebook.com/reel/${fakeId}`;
    db.addLog({
      postId: post.id,
      platform: 'facebook',
      level: 'info',
      message: `[DRY-RUN] Meta Graph API (${settings.fb_api_version || 'v21.0'}): Phase 1 start -> Phase 2 rupload -> Phase 3 finish.`
    });
    db.addLog({
      postId: post.id,
      platform: 'facebook',
      level: 'success',
      message: `[DRY-RUN] Giả lập đăng Facebook Page Reel thành công -> ${url}`
    });
    return { videoId: fakeId, url };
  }

  if (!settings.fb_page_id || !settings.fb_page_access_token) {
    throw new Error('Thiếu Facebook Page ID hoặc Page Access Token trong phần Cài đặt.');
  }
  if (!post.videoPath || !fs.existsSync(post.videoPath)) {
    throw new Error('Không tìm thấy file video cục bộ để tải lên Facebook Reels.');
  }

  const ver = settings.fb_api_version || 'v21.0';
  const pageId = encodeURIComponent(settings.fb_page_id);
  const token = settings.fb_page_access_token;
  const fileBuffer = fs.readFileSync(post.videoPath);
  const reelsEndpoint = `https://graph.facebook.com/${ver}/${pageId}/video_reels`;

  db.addLog({
    postId: post.id,
    platform: 'facebook',
    level: 'info',
    message: `Bắt đầu phiên Facebook Reels Upload (${(fileBuffer.length / (1024 * 1024)).toFixed(2)} MB)...`
  });

  // Phase 1: Start
  const startRes = await fetch(reelsEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      upload_phase: 'start',
      access_token: token
    })
  });
  const startData = await startRes.json().catch(() => ({}));
  if (!startRes.ok || !startData.video_id) {
    throw new Error(startData.error?.message || `Facebook Phase 1 (start) lỗi HTTP ${startRes.status}`);
  }

  const videoId = startData.video_id;
  const uploadUrl = startData.upload_url || `https://rupload.facebook.com/video-upload/${ver}/${videoId}`;

  // Phase 2: Binary Upload
  const upRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${token}`,
      offset: '0',
      file_size: String(fileBuffer.length)
    },
    body: fileBuffer
  });
  const upData = await upRes.json().catch(() => ({}));
  if (!upRes.ok || upData.error) {
    throw new Error(upData.error?.message || `Facebook Phase 2 (upload) lỗi HTTP ${upRes.status}`);
  }

  // Phase 3: Finish & Publish
  const caption = `${post.title}\n\n${buildFullCaption(post)}`.trim();
  const finishParams = new URLSearchParams({
    upload_phase: 'finish',
    video_id: videoId,
    video_state: 'PUBLISHED',
    description: caption,
    access_token: token
  });

  const finRes = await fetch(`${reelsEndpoint}?${finishParams.toString()}`, {
    method: 'POST'
  });
  const finData = await finRes.json().catch(() => ({}));
  if (!finRes.ok || finData.error || finData.success === false) {
    throw new Error(finData.error?.message || `Facebook Phase 3 (finish) lỗi HTTP ${finRes.status}`);
  }

  const url = `https://www.facebook.com/reel/${videoId}`;
  db.addLog({
    postId: post.id,
    platform: 'facebook',
    level: 'success',
    message: `Đăng Facebook Page Reel thành công -> ${url}`
  });
  return { videoId, url };
}

async function publishPost(postId) {
  const post = db.getPostById(postId);
  if (!post) throw new Error('Không tìm thấy bài đăng.');

  const settings = db.getAllSettingsRaw();
  const isDryRun = settings.mode === 'dry_run' || post.dryRun;

  db.updatePost(post.id, { status: 'publishing', lastError: '' });

  const errors = [];
  const updates = {
    dryRun: isDryRun
  };

  for (const platform of post.platforms) {
    try {
      if (platform === 'youtube') {
        const res = await publishToYouTube(post, settings, isDryRun);
        updates.youtubeVideoId = res.videoId;
        updates.youtubeUrl = res.url;
      } else if (platform === 'facebook') {
        const res = await publishToFacebookReels(post, settings, isDryRun);
        updates.facebookVideoId = res.videoId;
        updates.facebookUrl = res.url;
      }
    } catch (err) {
      errors.push(`[${platform.toUpperCase()}] ${err.message}`);
      db.addLog({
        postId: post.id,
        platform,
        level: 'error',
        message: err.message
      });
    }
  }

  if (errors.length === 0) {
    updates.status = 'published';
    updates.publishedAt = new Date().toISOString();
    updates.lastError = '';
  } else {
    updates.status = 'failed';
    updates.lastError = errors.join(' | ');
  }

  return db.updatePost(post.id, updates);
}

async function testConnections() {
  const settings = db.getAllSettingsRaw();
  const result = {
    mode: settings.mode,
    gemini: { ok: false, message: 'Chưa cấu hình GEMINI_API_KEY (đang dùng chế độ gợi ý offline).' },
    youtube: { ok: false, message: 'Chưa kết nối tài khoản Google / YouTube OAuth.' },
    facebook: { ok: false, message: 'Chưa cấu hình Facebook Page ID & Page Access Token.' }
  };

  if (settings.gemini_api_key || process.env.GEMINI_API_KEY) {
    result.gemini = { ok: true, message: 'Đã lưu Gemini API Key (sẵn sàng gọi gemini-2.5-flash).' };
  }

  if (settings.yt_refresh_token || settings.yt_access_token) {
    try {
      const token = await ensureYouTubeAccessToken(settings);
      const res = await fetch(YT_CHANNELS_URL, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.items?.[0]) {
        const name = data.items[0].snippet?.title || 'YouTube Channel';
        db.saveSettings({ yt_channel_name: name });
        result.youtube = { ok: true, message: `Đã kết nối kênh YouTube: ${name}` };
      } else {
        result.youtube = { ok: false, message: data.error?.message || `YouTube API trả về HTTP ${res.status}` };
      }
    } catch (err) {
      result.youtube = { ok: false, message: err.message };
    }
  }

  if (settings.fb_page_id && settings.fb_page_access_token) {
    try {
      const ver = settings.fb_api_version || 'v21.0';
      const url = `https://graph.facebook.com/${ver}/${encodeURIComponent(settings.fb_page_id)}?fields=id,name&access_token=${encodeURIComponent(settings.fb_page_access_token)}`;
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.name) {
        db.saveSettings({ fb_page_name: data.name });
        result.facebook = { ok: true, message: `Đã kết nối Fanpage: ${data.name} (ID: ${data.id})` };
      } else {
        result.facebook = { ok: false, message: data.error?.message || `Meta Graph API trả về HTTP ${res.status}` };
      }
    } catch (err) {
      result.facebook = { ok: false, message: err.message };
    }
  }

  db.addLog({
    platform: 'system',
    level: 'info',
    message: `Kiểm tra kết nối: YT=${result.youtube.ok ? 'OK' : 'OFF'}, FB=${result.facebook.ok ? 'OK' : 'OFF'}, Gemini=${result.gemini.ok ? 'OK' : 'OFF'}`
  });

  return result;
}

module.exports = {
  buildYouTubeAuthUrl,
  exchangeYouTubeCode,
  publishPost,
  testConnections
};

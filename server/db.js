'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const BROLL_DIR = path.join(UPLOADS_DIR, 'broll');
const DB_PATH = path.join(DATA_DIR, 'reelpilot.sqlite');

fs.mkdirSync(BROLL_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    hashtags TEXT NOT NULL DEFAULT '',
    video_filename TEXT NOT NULL DEFAULT '',
    video_path TEXT NOT NULL DEFAULT '',
    video_size INTEGER NOT NULL DEFAULT 0,
    platforms TEXT NOT NULL DEFAULT '["youtube","facebook"]',
    privacy TEXT NOT NULL DEFAULT 'public',
    scheduled_at TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    dry_run INTEGER NOT NULL DEFAULT 1,
    youtube_video_id TEXT NOT NULL DEFAULT '',
    youtube_url TEXT NOT NULL DEFAULT '',
    facebook_video_id TEXT NOT NULL DEFAULT '',
    facebook_url TEXT NOT NULL DEFAULT '',
    last_error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT
  );

  CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    post_id TEXT,
    platform TEXT NOT NULL DEFAULT 'system',
    level TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pipeline_jobs (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'vi',
    tone TEXT NOT NULL DEFAULT 'viral',
    source_channel TEXT NOT NULL DEFAULT 'web',
    status TEXT NOT NULL DEFAULT 'queued',
    render_mode TEXT NOT NULL DEFAULT 'storyboard',
    plan_json TEXT NOT NULL DEFAULT '{}',
    srt_content TEXT NOT NULL DEFAULT '',
    video_filename TEXT NOT NULL DEFAULT '',
    video_path TEXT NOT NULL DEFAULT '',
    post_id TEXT,
    error_message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const DEFAULT_SETTINGS = {
  mode: 'dry_run',
  gemini_api_key: '',
  pexels_api_key: '',
  ffmpeg_path: 'ffmpeg',
  telegram_bot_token: '',
  telegram_chat_id: '',
  telegram_enabled: '0',
  yt_client_id: '',
  yt_client_secret: '',
  yt_redirect_uri: 'http://localhost:4330/api/oauth/youtube/callback',
  yt_refresh_token: '',
  yt_access_token: '',
  yt_token_expiry: '0',
  yt_channel_name: '',
  fb_page_id: '',
  fb_page_access_token: '',
  fb_page_name: '',
  fb_api_version: 'v21.0'
};

const SECRET_KEYS = new Set([
  'gemini_api_key',
  'pexels_api_key',
  'telegram_bot_token',
  'yt_client_secret',
  'yt_refresh_token',
  'yt_access_token',
  'fb_page_access_token'
]);

function genId(prefix) {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function getAllSettingsRaw() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    out[row.key] = row.value;
  }
  return out;
}

function maskSecret(val) {
  if (!val) return '';
  if (val.length <= 8) return '••••••••';
  return `${val.slice(0, 4)}••••${val.slice(-4)}`;
}

function getSafeSettings() {
  const raw = getAllSettingsRaw();
  const masked = { ...raw };
  for (const key of SECRET_KEYS) {
    masked[key] = raw[key] ? maskSecret(raw[key]) : '';
  }
  return {
    ...masked,
    connections: {
      geminiConfigured: Boolean(raw.gemini_api_key || process.env.GEMINI_API_KEY),
      pexelsConfigured: Boolean(raw.pexels_api_key || process.env.PEXELS_API_KEY),
      telegramConfigured: Boolean(raw.telegram_bot_token),
      telegramEnabled: raw.telegram_enabled === '1',
      youtubeOAuthReady: Boolean(raw.yt_client_id && raw.yt_client_secret),
      youtubeConnected: Boolean(raw.yt_refresh_token || raw.yt_access_token),
      facebookConnected: Boolean(raw.fb_page_id && raw.fb_page_access_token)
    }
  };
}

function saveSettings(partial) {
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  for (const [key, value] of Object.entries(partial || {})) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    const strVal = String(value ?? '').trim();
    if (SECRET_KEYS.has(key) && (strVal === '' || strVal.includes('••••'))) {
      continue;
    }
    upsert.run(key, strVal);
  }
  return getAllSettingsRaw();
}

function clearSettingKey(key) {
  if (!(key in DEFAULT_SETTINGS)) return;
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

function hydratePost(row) {
  if (!row) return null;
  let platforms = ['youtube', 'facebook'];
  try {
    platforms = JSON.parse(row.platforms || '[]');
  } catch {
    platforms = ['youtube'];
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    hashtags: row.hashtags,
    videoFilename: row.video_filename,
    videoPath: row.video_path,
    videoSize: Number(row.video_size || 0),
    platforms,
    privacy: row.privacy || 'public',
    scheduledAt: row.scheduled_at || null,
    status: row.status,
    dryRun: Boolean(row.dry_run),
    youtubeVideoId: row.youtube_video_id || '',
    youtubeUrl: row.youtube_url || '',
    facebookVideoId: row.facebook_video_id || '',
    facebookUrl: row.facebook_url || '',
    lastError: row.last_error || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at || null
  };
}

function listPosts() {
  const rows = db.prepare(`
    SELECT * FROM posts
    ORDER BY
      CASE status
        WHEN 'publishing' THEN 0
        WHEN 'scheduled' THEN 1
        WHEN 'failed' THEN 2
        WHEN 'draft' THEN 3
        ELSE 4
      END,
      COALESCE(scheduled_at, updated_at) DESC
  `).all();
  return rows.map(hydratePost);
}

function getPostById(id) {
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  return hydratePost(row);
}

function createPost(data) {
  const now = new Date().toISOString();
  const id = genId('reel');
  const platforms = Array.isArray(data.platforms) && data.platforms.length
    ? data.platforms.filter(p => p === 'youtube' || p === 'facebook')
    : ['youtube'];
  const status = data.status || (data.scheduledAt ? 'scheduled' : 'draft');

  db.prepare(`
    INSERT INTO posts (
      id, title, description, hashtags, video_filename, video_path, video_size,
      platforms, privacy, scheduled_at, status, dry_run, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    String(data.title || 'Video Reel mới').trim(),
    String(data.description || '').trim(),
    String(data.hashtags || '').trim(),
    String(data.videoFilename || '').trim(),
    String(data.videoPath || '').trim(),
    Number(data.videoSize || 0),
    JSON.stringify(platforms),
    String(data.privacy || 'public'),
    data.scheduledAt ? String(data.scheduledAt) : null,
    status,
    data.dryRun === false ? 0 : 1,
    now,
    now
  );
  return getPostById(id);
}

function updatePost(id, patch) {
  const existing = getPostById(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const next = {
    title: patch.title !== undefined ? String(patch.title).trim() : existing.title,
    description: patch.description !== undefined ? String(patch.description).trim() : existing.description,
    hashtags: patch.hashtags !== undefined ? String(patch.hashtags).trim() : existing.hashtags,
    videoFilename: patch.videoFilename !== undefined ? String(patch.videoFilename) : existing.videoFilename,
    videoPath: patch.videoPath !== undefined ? String(patch.videoPath) : existing.videoPath,
    videoSize: patch.videoSize !== undefined ? Number(patch.videoSize) : existing.videoSize,
    platforms: Array.isArray(patch.platforms) ? patch.platforms : existing.platforms,
    privacy: patch.privacy !== undefined ? String(patch.privacy) : existing.privacy,
    scheduledAt: patch.scheduledAt !== undefined ? patch.scheduledAt : existing.scheduledAt,
    status: patch.status !== undefined ? String(patch.status) : existing.status,
    dryRun: patch.dryRun !== undefined ? (patch.dryRun ? 1 : 0) : (existing.dryRun ? 1 : 0),
    youtubeVideoId: patch.youtubeVideoId !== undefined ? String(patch.youtubeVideoId) : existing.youtubeVideoId,
    youtubeUrl: patch.youtubeUrl !== undefined ? String(patch.youtubeUrl) : existing.youtubeUrl,
    facebookVideoId: patch.facebookVideoId !== undefined ? String(patch.facebookVideoId) : existing.facebookVideoId,
    facebookUrl: patch.facebookUrl !== undefined ? String(patch.facebookUrl) : existing.facebookUrl,
    lastError: patch.lastError !== undefined ? String(patch.lastError) : existing.lastError,
    publishedAt: patch.publishedAt !== undefined ? patch.publishedAt : existing.publishedAt
  };

  db.prepare(`
    UPDATE posts SET
      title = ?, description = ?, hashtags = ?, video_filename = ?, video_path = ?,
      video_size = ?, platforms = ?, privacy = ?, scheduled_at = ?, status = ?,
      dry_run = ?, youtube_video_id = ?, youtube_url = ?, facebook_video_id = ?,
      facebook_url = ?, last_error = ?, updated_at = ?, published_at = ?
    WHERE id = ?
  `).run(
    next.title,
    next.description,
    next.hashtags,
    next.videoFilename,
    next.videoPath,
    next.videoSize,
    JSON.stringify(next.platforms),
    next.privacy,
    next.scheduledAt,
    next.status,
    next.dryRun,
    next.youtubeVideoId,
    next.youtubeUrl,
    next.facebookVideoId,
    next.facebookUrl,
    next.lastError,
    now,
    next.publishedAt,
    id
  );
  return getPostById(id);
}

function deletePost(id) {
  const existing = getPostById(id);
  if (!existing) return false;
  db.prepare('DELETE FROM posts WHERE id = ?').run(id);
  return true;
}

function getDueScheduledPosts(nowIso = new Date().toISOString()) {
  const rows = db.prepare(`
    SELECT * FROM posts
    WHERE status = 'scheduled'
      AND scheduled_at IS NOT NULL
      AND scheduled_at <= ?
    ORDER BY scheduled_at ASC
  `).all(nowIso);
  return rows.map(hydratePost);
}

function hydrateJob(row) {
  if (!row) return null;
  let plan = {};
  try {
    plan = JSON.parse(row.plan_json || '{}');
  } catch {
    plan = {};
  }
  return {
    id: row.id,
    topic: row.topic,
    language: row.language,
    tone: row.tone,
    sourceChannel: row.source_channel,
    status: row.status,
    renderMode: row.render_mode,
    plan,
    srtContent: row.srt_content || '',
    videoFilename: row.video_filename || '',
    videoPath: row.video_path || '',
    postId: row.post_id || null,
    errorMessage: row.error_message || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function createPipelineJob({ topic, language = 'vi', tone = 'viral', sourceChannel = 'web' }) {
  const id = genId('job');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO pipeline_jobs (id, topic, language, tone, source_channel, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)
  `).run(id, String(topic || '').trim(), language, tone, sourceChannel, now, now);
  return getPipelineJobById(id);
}

function getPipelineJobById(id) {
  const row = db.prepare('SELECT * FROM pipeline_jobs WHERE id = ?').get(id);
  return hydrateJob(row);
}

function updatePipelineJob(id, patch) {
  const ex = getPipelineJobById(id);
  if (!ex) return null;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE pipeline_jobs SET
      status = ?, render_mode = ?, plan_json = ?, srt_content = ?,
      video_filename = ?, video_path = ?, post_id = ?, error_message = ?, updated_at = ?
    WHERE id = ?
  `).run(
    patch.status !== undefined ? patch.status : ex.status,
    patch.renderMode !== undefined ? patch.renderMode : ex.renderMode,
    patch.plan !== undefined ? JSON.stringify(patch.plan) : JSON.stringify(ex.plan),
    patch.srtContent !== undefined ? String(patch.srtContent) : ex.srtContent,
    patch.videoFilename !== undefined ? String(patch.videoFilename) : ex.videoFilename,
    patch.videoPath !== undefined ? String(patch.videoPath) : ex.videoPath,
    patch.postId !== undefined ? patch.postId : ex.postId,
    patch.errorMessage !== undefined ? String(patch.errorMessage) : ex.errorMessage,
    now,
    id
  );
  return getPipelineJobById(id);
}

function listPipelineJobs(limit = 20) {
  const rows = db.prepare(`
    SELECT * FROM pipeline_jobs
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
  return rows.map(hydrateJob);
}

function deletePipelineJob(id) {
  db.prepare('DELETE FROM pipeline_jobs WHERE id = ?').run(id);
}

function addLog({ postId = null, platform = 'system', level = 'info', message }) {
  const id = genId('log');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO logs (id, post_id, platform, level, message, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, postId, platform, level, String(message || ''), now);
  return { id, postId, platform, level, message, createdAt: now };
}

function listLogs(limit = 80) {
  return db.prepare(`
    SELECT id, post_id AS postId, platform, level, message, created_at AS createdAt
    FROM logs
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}

function getStats() {
  const posts = listPosts();
  const counts = { total: posts.length, scheduled: 0, published: 0, failed: 0, draft: 0 };
  for (const p of posts) {
    if (p.status === 'scheduled') counts.scheduled++;
    else if (p.status === 'published') counts.published++;
    else if (p.status === 'failed') counts.failed++;
    else if (p.status === 'draft') counts.draft++;
  }
  return counts;
}

function seedInitialDataIfEmpty() {
  const existing = db.prepare('SELECT COUNT(*) AS cnt FROM posts').get();
  if (existing && Number(existing.cnt) > 0) return;

  const in2Hours = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  createPost({
    title: '3 Mẹo Tự Động Hóa Video Ngắn 9:16 Trong 60 Giây #Shorts',
    description: 'Quy trình tạo phụ đề chuẩn nhịp và tự động lên lịch đăng đồng thời YouTube Shorts + Facebook Page Reels bằng ReelPilot Studio.',
    hashtags: '#Shorts #Reels #Automation #CreatorTools #CapCut',
    videoFilename: 'demo-automation-9x16.mp4',
    videoPath: '',
    videoSize: 14820400,
    platforms: ['youtube', 'facebook'],
    privacy: 'public',
    scheduledAt: in2Hours,
    status: 'scheduled',
    dryRun: true
  });

  const publishedDemo = createPost({
    title: 'Cách Lên Lịch Đăng Reels Hàng Loạt Không Cần Trả Phí SaaS #Shorts',
    description: 'Chạy trực tiếp trên máy cá nhân với Node.js + SQLite WAL, tích hợp API chính thức YouTube Data API v3 và Meta Graph API.',
    hashtags: '#Shorts #YouTubeShorts #FacebookReels #NodeJS #Productivity',
    videoFilename: 'demo-scheduler-sample.mp4',
    videoPath: '',
    videoSize: 11240000,
    platforms: ['youtube', 'facebook'],
    privacy: 'public',
    scheduledAt: yesterday,
    status: 'published',
    dryRun: true
  });

  updatePost(publishedDemo.id, {
    youtubeVideoId: 'dryrun_yt_001',
    youtubeUrl: 'https://youtube.com/shorts/dryrun_yt_001',
    facebookVideoId: 'dryrun_fb_001',
    facebookUrl: 'https://www.facebook.com/reel/dryrun_fb_001',
    publishedAt: yesterday
  });

  addLog({
    postId: publishedDemo.id,
    platform: 'system',
    level: 'success',
    message: '[DRY-RUN] Khởi tạo kho dữ liệu mẫu ReelPilot Studio v2.0 (SQLite WAL).'
  });
}

seedInitialDataIfEmpty();

module.exports = {
  DATA_DIR,
  UPLOADS_DIR,
  BROLL_DIR,
  DB_PATH,
  getAllSettingsRaw,
  getSafeSettings,
  saveSettings,
  clearSettingKey,
  listPosts,
  getPostById,
  createPost,
  updatePost,
  deletePost,
  getDueScheduledPosts,
  createPipelineJob,
  getPipelineJobById,
  updatePipelineJob,
  listPipelineJobs,
  deletePipelineJob,
  addLog,
  listLogs,
  getStats
};

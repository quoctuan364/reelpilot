'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'reelpilot.sqlite');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

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
`);

const DEFAULT_SETTINGS = {
  mode: 'dry_run',
  gemini_api_key: '',
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

function addLog({ postId = null, platform = 'system', level = 'info', message }) {
  const id = genId('log');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO logs (id, post_id, platform, level, message, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, postId, platform, level, String(message || ''), now);
  return { id, postId, platform, level, message, createdAt: now };
}

function listLogs(limit = 60) {
  const rows = db.prepare(`
    SELECT id, post_id AS postId, platform, level, message, created_at AS createdAt
    FROM logs
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
  return rows;
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
    message: '[DRY-RUN] Khởi tạo kho dữ liệu mẫu ReelPilot Studio (SQLite WAL).'
  });
}

seedInitialDataIfEmpty();

module.exports = {
  DATA_DIR,
  UPLOADS_DIR,
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
  addLog,
  listLogs,
  getStats
};

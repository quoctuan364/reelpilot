'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('./db');
const ai = require('./ai');
const publishers = require('./publishers');

const PORT = Number(process.env.PORT) || 4330;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAX_VIDEO_BYTES = 250 * 1024 * 1024; // 250 MB

const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.mkv']);

function sendJson(res, status, data) {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > 2 * 1024 * 1024) {
        reject(new Error('JSON payload vượt quá 2MB'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('JSON không hợp lệ'));
      }
    });
    req.on('error', reject);
  });
}

function handleVideoUpload(req, res) {
  const rawName = decodeURIComponent(String(req.headers['x-file-name'] || 'video.mp4'));
  const ext = path.extname(rawName).toLowerCase() || '.mp4';
  if (!VIDEO_EXTS.has(ext)) {
    return sendJson(res, 400, { error: 'Chỉ hỗ trợ định dạng video .mp4, .mov, .webm, .mkv' });
  }

  const safeBase = path.basename(rawName, ext)
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'reel';
  const storedName = `${Date.now()}-${crypto.randomUUID().slice(0, 6)}-${safeBase}${ext}`;
  const fullPath = path.join(db.UPLOADS_DIR, storedName);

  const outStream = fs.createWriteStream(fullPath);
  let bytes = 0;
  let aborted = false;

  req.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > MAX_VIDEO_BYTES) {
      aborted = true;
      outStream.destroy();
      fs.unlink(fullPath, () => {});
      sendJson(res, 413, { error: 'File video vượt quá giới hạn 250MB.' });
      req.destroy();
      return;
    }
    outStream.write(chunk);
  });

  req.on('end', () => {
    if (aborted) return;
    outStream.end(() => {
      if (bytes === 0) {
        fs.unlink(fullPath, () => {});
        return sendJson(res, 400, { error: 'File video rỗng.' });
      }
      db.addLog({
        platform: 'system',
        level: 'info',
        message: `Đã nạp video "${rawName}" (${(bytes / (1024 * 1024)).toFixed(2)} MB) vào thư mục cục bộ.`
      });
      sendJson(res, 201, {
        videoFilename: storedName,
        originalName: rawName,
        videoPath: fullPath,
        videoSize: bytes,
        previewUrl: `/api/media/${encodeURIComponent(storedName)}`
      });
    });
  });

  req.on('error', () => {
    aborted = true;
    outStream.destroy();
    fs.unlink(fullPath, () => {});
  });
}

function serveMediaFile(req, res, filename) {
  const safeName = path.basename(filename);
  const fullPath = path.join(db.UPLOADS_DIR, safeName);
  if (!fullPath.startsWith(db.UPLOADS_DIR) || !fs.existsSync(fullPath)) {
    res.writeHead(404);
    res.end('Video not found');
    return;
  }

  const stat = fs.statSync(fullPath);
  const ext = path.extname(safeName).toLowerCase();
  const contentType = ext === '.mov' ? 'video/quicktime' : ext === '.webm' ? 'video/webm' : 'video/mp4';
  const range = req.headers.range;

  if (range) {
    const match = range.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': contentType
      });
      fs.createReadStream(fullPath, { start, end }).pipe(res);
      return;
    }
  }

  res.writeHead(200, {
    'Content-Length': stat.size,
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes'
  });
  fs.createReadStream(fullPath).pipe(res);
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const fullPath = path.resolve(PUBLIC_DIR, rel);
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': STATIC_MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

let schedulerRunning = false;

async function runSchedulerTick() {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    const duePosts = db.getDueScheduledPosts(new Date().toISOString());
    for (const post of duePosts) {
      db.addLog({
        postId: post.id,
        platform: 'system',
        level: 'info',
        message: `Bộ lập lịch kích hoạt đăng tự động bài "${post.title}".`
      });
      await publishers.publishPost(post.id);
    }
  } catch (err) {
    db.addLog({
      platform: 'system',
      level: 'error',
      message: `Lỗi bộ lập lịch: ${err.message}`
    });
  } finally {
    schedulerRunning = false;
  }
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url || '/', `http://localhost:${PORT}`);
  const pathname = parsed.pathname;
  const method = req.method || 'GET';

  try {
    if (pathname === '/api/bootstrap' && method === 'GET') {
      return sendJson(res, 200, {
        stats: db.getStats(),
        settings: db.getSafeSettings(),
        posts: db.listPosts(),
        logs: db.listLogs(60)
      });
    }

    if (pathname === '/api/upload-video' && method === 'POST') {
      return handleVideoUpload(req, res);
    }

    const mediaMatch = pathname.match(/^\/api\/media\/([^/]+)$/);
    if (mediaMatch && method === 'GET') {
      return serveMediaFile(req, res, decodeURIComponent(mediaMatch[1]));
    }

    if (pathname === '/api/posts' && method === 'GET') {
      return sendJson(res, 200, { posts: db.listPosts(), stats: db.getStats() });
    }

    if (pathname === '/api/posts' && method === 'POST') {
      const body = await readJsonBody(req);
      const settings = db.getAllSettingsRaw();
      const post = db.createPost({
        ...body,
        dryRun: body.dryRun !== undefined ? Boolean(body.dryRun) : settings.mode === 'dry_run'
      });
      db.addLog({
        postId: post.id,
        platform: 'system',
        level: 'info',
        message: `Đã tạo bài "${post.title}" (${post.status === 'scheduled' ? `lên lịch ${post.scheduledAt}` : post.status}).`
      });
      if (body.publishNow) {
        const published = await publishers.publishPost(post.id);
        return sendJson(res, 201, { post: published, stats: db.getStats() });
      }
      return sendJson(res, 201, { post, stats: db.getStats() });
    }

    const postPublishMatch = pathname.match(/^\/api\/posts\/([^/]+)\/publish-now$/);
    if (postPublishMatch && method === 'POST') {
      const id = decodeURIComponent(postPublishMatch[1]);
      const updated = await publishers.publishPost(id);
      return sendJson(res, 200, { post: updated, stats: db.getStats() });
    }

    const postIdMatch = pathname.match(/^\/api\/posts\/([^/]+)$/);
    if (postIdMatch) {
      const id = decodeURIComponent(postIdMatch[1]);
      if (method === 'PUT' || method === 'PATCH') {
        const body = await readJsonBody(req);
        const updated = db.updatePost(id, body);
        if (!updated) return sendJson(res, 404, { error: 'Không tìm thấy bài đăng' });
        return sendJson(res, 200, { post: updated, stats: db.getStats() });
      }
      if (method === 'DELETE') {
        const existing = db.getPostById(id);
        if (!existing) return sendJson(res, 404, { error: 'Không tìm thấy bài đăng' });
        db.deletePost(id);
        db.addLog({
          platform: 'system',
          level: 'info',
          message: `Đã xóa bài "${existing.title}" khỏi hàng đợi.`
        });
        return sendJson(res, 200, { deleted: true, id, stats: db.getStats() });
      }
    }

    if (pathname === '/api/ai/generate' && method === 'POST') {
      const body = await readJsonBody(req);
      const settings = db.getAllSettingsRaw();
      const result = await ai.generateReelMetadata(body, settings);
      db.addLog({
        platform: 'ai',
        level: 'success',
        message: `Đã sinh tiêu đề & hashtag (${result.source === 'gemini' ? 'Gemini 2.5 Flash' : 'Chế độ Offline Preview'}).`
      });
      return sendJson(res, 200, result);
    }

    if (pathname === '/api/settings' && method === 'GET') {
      return sendJson(res, 200, { settings: db.getSafeSettings() });
    }

    if (pathname === '/api/settings' && method === 'PUT') {
      const body = await readJsonBody(req);
      db.saveSettings(body);
      db.addLog({
        platform: 'system',
        level: 'info',
        message: `Đã cập nhật cấu hình hệ thống (Chế độ: ${db.getAllSettingsRaw().mode === 'live' ? 'Đăng thật Live' : 'Chạy thử Dry-Run'}).`
      });
      return sendJson(res, 200, { settings: db.getSafeSettings() });
    }

    if (pathname === '/api/test-connections' && method === 'POST') {
      const report = await publishers.testConnections();
      return sendJson(res, 200, { report, settings: db.getSafeSettings() });
    }

    if (pathname === '/api/oauth/youtube/start' && method === 'GET') {
      const settings = db.getAllSettingsRaw();
      const url = publishers.buildYouTubeAuthUrl(settings);
      return sendJson(res, 200, { url });
    }

    if (pathname === '/api/oauth/youtube/callback' && method === 'GET') {
      const code = parsed.searchParams.get('code');
      const errParam = parsed.searchParams.get('error');
      if (errParam || !code) {
        res.writeHead(302, { Location: `/?oauth=youtube_error&msg=${encodeURIComponent(errParam || 'missing_code')}` });
        res.end();
        return;
      }
      await publishers.exchangeYouTubeCode(code, db.getAllSettingsRaw());
      res.writeHead(302, { Location: '/?oauth=youtube_ok' });
      res.end();
      return;
    }

    if (pathname === '/api/logs' && method === 'GET') {
      return sendJson(res, 200, { logs: db.listLogs(80) });
    }

    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { error: `API không tồn tại: ${method} ${pathname}` });
    }

    return serveStatic(req, res, pathname);
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Internal Server Error' });
  }
});

const schedulerTimer = setInterval(runSchedulerTick, 15000);
schedulerTimer.unref();

server.listen(PORT, '127.0.0.1', () => {
  console.log('======================================================');
  console.log('  ReelPilot Studio v1.0 is running!');
  console.log(`  Local URL : http://localhost:${PORT}`);
  console.log(`  SQLite DB : ${db.DB_PATH} (WAL Mode)`);
  console.log('======================================================');
});

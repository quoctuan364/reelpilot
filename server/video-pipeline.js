'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const db = require('./db');
const ai = require('./ai');
const publishers = require('./publishers');

function detectFfmpeg(ffmpegPath = 'ffmpeg') {
  const bin = (ffmpegPath || 'ffmpeg').trim();
  try {
    const res = spawnSync(bin, ['-version'], { encoding: 'utf8', timeout: 4000 });
    if (res.status === 0) {
      const firstLine = String(res.stdout || '').split('\n')[0] || 'ffmpeg detected';
      return { available: true, binary: bin, version: firstLine.trim() };
    }
  } catch {
    // Not available
  }
  return {
    available: false,
    binary: bin,
    version: 'Chưa cài FFmpeg (chạy: winget install Gyan.FFmpeg)'
  };
}

async function fetchPexelsPortraitClip(query, apiKey, destPath) {
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=3`;
  const res = await fetch(url, {
    headers: { Authorization: apiKey }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Pexels API HTTP ${res.status}`);
  }
  const videos = data.videos || [];
  for (const vid of videos) {
    const files = (vid.video_files || [])
      .filter(f => f.link && String(f.file_type || '').includes('mp4'))
      .sort((a, b) => Math.abs((a.width || 0) - 1080) - Math.abs((b.width || 0) - 1080));
    if (files.length) {
      const dl = await fetch(files[0].link);
      if (dl.ok) {
        const buf = Buffer.from(await dl.arrayBuffer());
        fs.writeFileSync(destPath, buf);
        return {
          path: destPath,
          pexelsUrl: vid.url || '',
          width: files[0].width || 1080,
          height: files[0].height || 1920
        };
      }
    }
  }
  return null;
}

function generateWindowsVoiceover(narrationText, outputWavPath) {
  if (process.platform !== 'win32') return false;
  const cleanText = String(narrationText || '').replace(/[\r\n]+/g, ' ').replace(/'/g, "''").trim();
  if (!cleanText) return false;

  const psScript = [
    'Add-Type -AssemblyName System.Speech;',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
    `$s.SetOutputToWaveFile('${outputWavPath.replace(/'/g, "''")}');`,
    `$s.Speak('${cleanText}');`,
    '$s.Dispose();'
  ].join(' ');

  try {
    const res = spawnSync('powershell.exe', ['-NoProfile', '-Command', psScript], {
      encoding: 'utf8',
      timeout: 25000
    });
    return res.status === 0 && fs.existsSync(outputWavPath) && fs.statSync(outputWavPath).size > 1024;
  } catch {
    return false;
  }
}

function renderMp4WithFfmpeg({ clipItems, srtPath, audioPath, outputPath, ffmpegPath = 'ffmpeg' }) {
  const bin = (ffmpegPath || 'ffmpeg').trim();
  const tempDir = path.dirname(outputPath);
  const segPaths = [];

  for (let i = 0; i < clipItems.length; i++) {
    const item = clipItems[i];
    const segOut = path.join(tempDir, `${path.basename(outputPath, '.mp4')}_seg${i}.mp4`);
    const dur = String(Math.max(2, Number(item.durationSec || 4.5)));
    const r = spawnSync(bin, [
      '-y',
      '-stream_loop', '-1',
      '-i', item.clipPath,
      '-t', dur,
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30',
      '-an',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'veryfast',
      segOut
    ], { encoding: 'utf8', timeout: 60000 });

    if (r.status !== 0) {
      throw new Error(`FFmpeg scale cảnh ${i + 1} lỗi: ${(r.stderr || '').slice(-180)}`);
    }
    segPaths.push(segOut);
  }

  const concatListPath = path.join(tempDir, `${path.basename(outputPath, '.mp4')}_list.txt`);
  fs.writeFileSync(
    concatListPath,
    segPaths.map(p => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'),
    'utf8'
  );

  const escapedSrt = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  const subtitleFilter = `subtitles='${escapedSrt}':force_style='FontName=Arial,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=75'`;

  const args = ['-y', '-f', 'concat', '-safe', '0', '-i', concatListPath];
  if (audioPath && fs.existsSync(audioPath)) {
    args.push('-i', audioPath, '-map', '0:v:0', '-map', '1:a:0', '-shortest');
  }
  args.push(
    '-vf', subtitleFilter,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    outputPath
  );

  const finalRes = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000 });

  // Cleanup temp segment files
  for (const p of segPaths) {
    try { fs.unlinkSync(p); } catch {}
  }
  try { fs.unlinkSync(concatListPath); } catch {}

  if (finalRes.status !== 0 || !fs.existsSync(outputPath)) {
    throw new Error(`FFmpeg ghép video lỗi: ${(finalRes.stderr || '').slice(-220)}`);
  }
  return fs.statSync(outputPath).size;
}

async function runAutoVideoPipeline({
  topic,
  tone = 'viral',
  language = 'vi',
  platforms = ['youtube', 'facebook'],
  sourceChannel = 'web',
  autoPublish = false
}) {
  const cleanTopic = String(topic || '').trim();
  if (!cleanTopic) throw new Error('Vui lòng nhập chủ đề để hệ thống tự dựng video.');

  const settings = db.getAllSettingsRaw();
  const job = db.createPipelineJob({ topic: cleanTopic, language, tone, sourceChannel });

  db.addLog({
    platform: sourceChannel === 'telegram' ? 'telegram' : 'pipeline',
    level: 'info',
    message: `Bắt đầu Auto-Video Pipeline (${job.id}) cho chủ đề: "${cleanTopic}".`
  });

  try {
    // 1. Scripting
    db.updatePipelineJob(job.id, { status: 'scripting' });
    const plan = await ai.generateFullVideoPlan({ topic: cleanTopic, tone, language }, settings);
    const srtContent = ai.buildSrtFromScenes(plan.scenes);
    const srtPath = path.join(db.UPLOADS_DIR, `${job.id}.srt`);
    fs.writeFileSync(srtPath, srtContent, 'utf8');

    // 2. Fetch Pexels 9:16 B-roll if configured
    db.updatePipelineJob(job.id, { status: 'fetching_media', plan, srtContent });
    const pexelsKey = (settings.pexels_api_key || process.env.PEXELS_API_KEY || '').trim();
    const fetchedClips = [];

    if (pexelsKey) {
      for (let i = 0; i < plan.scenes.length; i++) {
        const sc = plan.scenes[i];
        const clipDest = path.join(db.BROLL_DIR, `${job.id}_scene${i + 1}.mp4`);
        try {
          const clip = await fetchPexelsPortraitClip(sc.searchQuery, pexelsKey, clipDest);
          if (clip) {
            sc.pexelsUrl = clip.pexelsUrl;
            fetchedClips.push({ clipPath: clip.path, durationSec: sc.durationSec });
          }
        } catch (err) {
          db.addLog({
            platform: 'pexels',
            level: 'warn',
            message: `Không tải được cảnh ${i + 1} (${sc.searchQuery}): ${err.message}`
          });
        }
      }
      db.addLog({
        platform: 'pexels',
        level: 'info',
        message: `Pexels API: đã tải ${fetchedClips.length}/${plan.scenes.length} cảnh nền dọc 9:16.`
      });
    }

    // 3. Render with FFmpeg if both FFmpeg & clips exist
    const ff = detectFfmpeg(settings.ffmpeg_path);
    let finalVideoFilename = `${job.id}-storyboard.mp4`;
    let finalVideoPath = '';
    let finalVideoSize = 0;
    let renderMode = 'storyboard';

    if (ff.available && fetchedClips.length > 0) {
      db.updatePipelineJob(job.id, { status: 'rendering', plan });
      const outFile = `${job.id}.mp4`;
      const outPath = path.join(db.UPLOADS_DIR, outFile);
      const wavPath = path.join(db.BROLL_DIR, `${job.id}_voice.wav`);
      const fullNarration = plan.scenes.map(s => s.narration).join(' ');
      const hasVoice = generateWindowsVoiceover(fullNarration, wavPath);

      finalVideoSize = renderMp4WithFfmpeg({
        clipItems: fetchedClips,
        srtPath,
        audioPath: hasVoice ? wavPath : null,
        outputPath: outPath,
        ffmpegPath: settings.ffmpeg_path
      });
      finalVideoFilename = outFile;
      finalVideoPath = outPath;
      renderMode = 'rendered_mp4';

      try { if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath); } catch {}
      db.addLog({
        platform: 'pipeline',
        level: 'success',
        message: `FFmpeg render thành công video 1080×1920 (${(finalVideoSize / (1024 * 1024)).toFixed(2)} MB): ${outFile}`
      });
    } else {
      db.addLog({
        platform: 'pipeline',
        level: 'info',
        message: `Chế độ Storyboard + .SRT (gắn Pexels API Key + cài FFmpeg để xuất .MP4 1080×1920 tự động).`
      });
    }

    // 4. Create Post in Queue
    let post = db.createPost({
      title: plan.title,
      description: plan.description,
      hashtags: plan.hashtags,
      videoFilename: finalVideoFilename,
      videoPath: finalVideoPath,
      videoSize: finalVideoSize,
      platforms,
      privacy: 'public',
      status: 'draft',
      dryRun: settings.mode !== 'live' || renderMode !== 'rendered_mp4'
    });

    if (autoPublish) {
      post = await publishers.publishPost(post.id);
    }

    const updatedJob = db.updatePipelineJob(job.id, {
      status: autoPublish ? (post.status === 'published' ? 'published' : 'failed') : 'ready_for_review',
      renderMode,
      plan,
      srtContent,
      videoFilename: finalVideoFilename,
      videoPath: finalVideoPath,
      postId: post.id
    });

    return { job: updatedJob, post, plan };
  } catch (err) {
    db.updatePipelineJob(job.id, {
      status: 'failed',
      errorMessage: err.message
    });
    db.addLog({
      platform: 'pipeline',
      level: 'error',
      message: `Auto-Video Pipeline (${job.id}) lỗi: ${err.message}`
    });
    throw err;
  }
}

module.exports = {
  detectFfmpeg,
  runAutoVideoPipeline
};

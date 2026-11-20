(() => {
  'use strict';

  const VIEW_META = {
    pipeline: {
      heading: 'Auto-Video Pipeline — Tự Kiếm Cảnh, Dựng Video & Đăng',
      subtitle: 'Nhập chủ đề (hoặc nhắn /make trên Telegram từ điện thoại) để tự tạo kịch bản, .SRT, video 9:16 và xuất bản YT/FB.'
    },
    composer: {
      heading: 'Tạo & Lên Lịch Video Ngắn 9:16 Thủ Công',
      subtitle: 'Kéo thả video dọc có sẵn, sinh tiêu đề/hashtag bằng Gemini AI và hẹn giờ đăng tự động.'
    },
    queue: {
      heading: 'Hàng Đợi & Lịch Sử Đăng Video',
      subtitle: 'Theo dõi trạng thái YouTube Shorts & Facebook Page Reels, kích hoạt đăng ngay hoặc quản lý lịch hẹn.'
    },
    connections: {
      heading: 'Kết Nối API, Telegram Mobile & FFmpeg',
      subtitle: 'Cấu hình Telegram Bot, Pexels B-Roll, FFmpeg, YouTube Data API v3, Meta Graph API và chế độ Dry-Run / Live.'
    },
    logs: {
      heading: 'Nhật Ký Hoạt Động, Telegram & Scheduler',
      subtitle: 'Theo dõi chi tiết từng bước dựng video, lệnh Telegram, mô phỏng Dry-Run và phản hồi API.'
    }
  };

  const state = {
    activeView: 'pipeline',
    queueFilter: 'all',
    settings: null,
    ffmpeg: { available: false, version: '' },
    telegram: { running: false, botUsername: '', lastError: '' },
    stats: { total: 0, scheduled: 0, published: 0, failed: 0, draft: 0 },
    posts: [],
    jobs: [],
    logs: [],
    uploadedVideo: null
  };

  const $ = (id) => document.getElementById(id);

  const el = {
    navBtns: Array.from(document.querySelectorAll('.nav-btn')),
    navJobCount: $('navJobCount'),
    navQueueCount: $('navQueueCount'),
    sideModePill: $('sideModePill'),
    sideTgPill: $('sideTgPill'),
    sideYtPill: $('sideYtPill'),
    sideFbPill: $('sideFbPill'),
    sideMediaPill: $('sideMediaPill'),
    statScheduled: $('statScheduled'),
    statPublished: $('statPublished'),
    viewHeading: $('viewHeading'),
    viewSubtitle: $('viewSubtitle'),
    btnQuickModeToggle: $('btnQuickModeToggle'),
    btnRefreshAll: $('btnRefreshAll'),
    views: {
      pipeline: $('viewPipeline'),
      composer: $('viewComposer'),
      queue: $('viewQueue'),
      connections: $('viewConnections'),
      logs: $('viewLogs')
    },
    pipelineEngineBadge: $('pipelineEngineBadge'),
    pipelineForm: $('pipelineForm'),
    pipeTopicInput: $('pipeTopicInput'),
    pipeToneSelect: $('pipeToneSelect'),
    pipeLangSelect: $('pipeLangSelect'),
    pipeChkYt: $('pipeChkYt'),
    pipeChkFb: $('pipeChkFb'),
    pipeAutoPublish: $('pipeAutoPublish'),
    btnRunPipeline: $('btnRunPipeline'),
    pipelineJobsList: $('pipelineJobsList'),
    dropzone: $('dropzone'),
    videoFileInput: $('videoFileInput'),
    dropzoneEmpty: $('dropzoneEmpty'),
    btnPickVideo: $('btnPickVideo'),
    videoPreviewWrap: $('videoPreviewWrap'),
    videoPreviewPlayer: $('videoPreviewPlayer'),
    uploadedFileName: $('uploadedFileName'),
    btnReplaceVideo: $('btnReplaceVideo'),
    videoMetaText: $('videoMetaText'),
    uploadProgressBox: $('uploadProgressBox'),
    uploadProgressBar: $('uploadProgressBar'),
    uploadProgressLabel: $('uploadProgressLabel'),
    aiSourceBadge: $('aiSourceBadge'),
    aiTopicInput: $('aiTopicInput'),
    aiToneSelect: $('aiToneSelect'),
    aiLangSelect: $('aiLangSelect'),
    btnGenerateAi: $('btnGenerateAi'),
    aiHookTip: $('aiHookTip'),
    postForm: $('postForm'),
    postTitle: $('postTitle'),
    postDescription: $('postDescription'),
    postHashtags: $('postHashtags'),
    chkYoutube: $('chkYoutube'),
    chkFacebook: $('chkFacebook'),
    postPrivacy: $('postPrivacy'),
    postScheduleAt: $('postScheduleAt'),
    quickTimeBtns: Array.from(document.querySelectorAll('.btn-chip[data-plus-min]')),
    btnPublishNow: $('btnPublishNow'),
    btnSchedulePost: $('btnSchedulePost'),
    btnResetForm: $('btnResetForm'),
    queueFilterTabs: Array.from(document.querySelectorAll('#queueFilterTabs .tab-btn')),
    queueList: $('queueList'),
    cfgMode: $('cfgMode'),
    cfgGeminiKey: $('cfgGeminiKey'),
    cfgTgToken: $('cfgTgToken'),
    cfgTgChatId: $('cfgTgChatId'),
    cfgTgStatus: $('cfgTgStatus'),
    btnToggleTelegram: $('btnToggleTelegram'),
    cfgPexelsKey: $('cfgPexelsKey'),
    cfgFfmpegPath: $('cfgFfmpegPath'),
    cfgFfmpegStatus: $('cfgFfmpegStatus'),
    ffmpegHelpText: $('ffmpegHelpText'),
    cfgYtClientId: $('cfgYtClientId'),
    cfgYtClientSecret: $('cfgYtClientSecret'),
    cfgYtRedirectUri: $('cfgYtRedirectUri'),
    cfgYtStatus: $('cfgYtStatus'),
    btnConnectYoutube: $('btnConnectYoutube'),
    cfgFbPageId: $('cfgFbPageId'),
    cfgFbToken: $('cfgFbToken'),
    cfgFbVersion: $('cfgFbVersion'),
    cfgFbStatus: $('cfgFbStatus'),
    btnSaveSettings: $('btnSaveSettings'),
    btnTestConnections: $('btnTestConnections'),
    testResultText: $('testResultText'),
    btnReloadLogs: $('btnReloadLogs'),
    logsList: $('logsList'),
    toastRoot: $('toastRoot')
  };

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(message, tone = 'emerald') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    if (tone === 'amber') toast.style.borderLeftColor = 'var(--accent-amber)';
    if (tone === 'error') toast.style.borderLeftColor = 'var(--accent-yt)';
    toast.textContent = message;
    el.toastRoot.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.2s ease';
      setTimeout(() => toast.remove(), 220);
    }, 3200);
  }

  async function api(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('vi-VN', {
      hour12: false,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function formatBytes(bytes) {
    if (!bytes) return 'Storyboard';
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
  }

  function switchView(view) {
    state.activeView = view;
    el.navBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
    Object.entries(el.views).forEach(([k, sec]) => sec.classList.toggle('active', k === view));
    const meta = VIEW_META[view] || VIEW_META.pipeline;
    el.viewHeading.textContent = meta.heading;
    el.viewSubtitle.textContent = meta.subtitle;
    if (view === 'logs') reloadLogs();
  }

  function renderSidebarAndSettings() {
    const s = state.settings;
    if (!s) return;
    const isLive = s.mode === 'live';
    const conn = s.connections || {};
    const ffReady = Boolean(state.ffmpeg?.available);
    const tgRunning = Boolean(state.telegram?.running);

    el.sideModePill.textContent = isLive ? 'LIVE' : 'DRY-RUN';
    el.sideModePill.className = `pill ${isLive ? 'pill-emerald' : 'pill-amber'}`;
    el.btnQuickModeToggle.textContent = isLive ? 'Chế độ: Đăng thật (LIVE)' : 'Chế độ: Dry-Run (An toàn)';

    el.sideTgPill.textContent = tgRunning ? (state.telegram.botUsername || 'Đang nghe') : (conn.telegramConfigured ? 'Sẵn sàng' : 'Tắt');
    el.sideTgPill.className = `pill ${tgRunning ? 'pill-emerald' : (conn.telegramConfigured ? 'pill-amber' : 'pill-muted')}`;

    el.sideYtPill.textContent = conn.youtubeConnected ? (s.yt_channel_name || 'Đã nối') : 'Chưa nối';
    el.sideYtPill.className = `pill ${conn.youtubeConnected ? 'pill-emerald' : 'pill-muted'}`;

    el.sideFbPill.textContent = conn.facebookConnected ? (s.fb_page_name || 'Đã nối') : 'Chưa nối';
    el.sideFbPill.className = `pill ${conn.facebookConnected ? 'pill-emerald' : 'pill-muted'}`;

    const fullAutoRender = ffReady && conn.pexelsConfigured;
    el.sideMediaPill.textContent = fullAutoRender ? 'Full MP4' : 'Storyboard';
    el.sideMediaPill.className = `pill ${fullAutoRender ? 'pill-emerald' : 'pill-amber'}`;

    el.pipelineEngineBadge.textContent = fullAutoRender
      ? 'Full Auto Render (Pexels + FFmpeg 1080×1920)'
      : 'Chế độ Storyboard + .SRT (gắn Pexels & FFmpeg để xuất .MP4)';
    el.pipelineEngineBadge.className = `pill ${fullAutoRender ? 'pill-emerald' : 'pill-amber'}`;

    el.aiSourceBadge.textContent = conn.geminiConfigured ? 'Gemini 2.5 Flash' : 'Offline Preview AI';
    el.aiSourceBadge.className = `pill ${conn.geminiConfigured ? 'pill-emerald' : 'pill-amber'}`;

    el.navJobCount.textContent = String(state.jobs.length || 0);
    el.navQueueCount.textContent = String(state.stats.total || 0);
    el.statScheduled.textContent = String(state.stats.scheduled || 0);
    el.statPublished.textContent = String(state.stats.published || 0);

    // Settings inputs
    el.cfgMode.value = s.mode || 'dry_run';
    el.cfgGeminiKey.placeholder = s.gemini_api_key ? `Đã lưu (${s.gemini_api_key})` : 'AIzaSy... (nhập Gemini API Key)';

    el.cfgTgToken.placeholder = s.telegram_bot_token ? `Đã lưu (${s.telegram_bot_token})` : '123456:ABC-DEF...';
    el.cfgTgChatId.value = s.telegram_chat_id || '';
    el.cfgTgStatus.textContent = tgRunning ? `Đang nghe (${state.telegram.botUsername || 'Bot'})` : 'Đang tắt';
    el.cfgTgStatus.className = `pill ${tgRunning ? 'pill-emerald' : 'pill-muted'}`;
    el.btnToggleTelegram.textContent = tgRunning ? 'Tắt lắng nghe Telegram Bot' : 'Bật lắng nghe Telegram Bot';

    el.cfgPexelsKey.placeholder = s.pexels_api_key ? `Đã lưu (${s.pexels_api_key})` : 'Lấy miễn phí tại pexels.com/api';
    el.cfgFfmpegPath.value = s.ffmpeg_path || 'ffmpeg';
    el.cfgFfmpegStatus.textContent = ffReady ? 'FFmpeg OK' : 'Chưa cài FFmpeg';
    el.cfgFfmpegStatus.className = `pill ${ffReady ? 'pill-emerald' : 'pill-amber'}`;
    if (el.ffmpegHelpText) {
      el.ffmpegHelpText.innerHTML = ffReady
        ? `Đã nhận diện: <code>${escapeHtml(state.ffmpeg.version.slice(0, 72))}</code>`
        : 'Máy chưa có FFmpeg. Mở Terminal chạy <code>winget install Gyan.FFmpeg</code> rồi mở lại server.';
    }

    el.cfgYtClientId.value = s.yt_client_id || '';
    el.cfgYtClientSecret.placeholder = s.yt_client_secret ? `Đã lưu (${s.yt_client_secret})` : 'GOCSPX-...';
    el.cfgYtRedirectUri.value = s.yt_redirect_uri || 'http://localhost:4330/api/oauth/youtube/callback';
    el.cfgYtStatus.textContent = conn.youtubeConnected ? `Đã nối: ${s.yt_channel_name || 'YouTube'}` : 'Chưa nối';
    el.cfgYtStatus.className = `pill ${conn.youtubeConnected ? 'pill-emerald' : 'pill-muted'}`;

    el.cfgFbPageId.value = s.fb_page_id || '';
    el.cfgFbToken.placeholder = s.fb_page_access_token ? `Đã lưu (${s.fb_page_access_token})` : 'EAAG...';
    el.cfgFbVersion.value = s.fb_api_version || 'v21.0';
    el.cfgFbStatus.textContent = conn.facebookConnected ? `Đã nối: ${s.fb_page_name || s.fb_page_id}` : 'Chưa nối';
    el.cfgFbStatus.className = `pill ${conn.facebookConnected ? 'pill-emerald' : 'pill-muted'}`;
  }

  function renderPipelineJobs() {
    if (!state.jobs.length) {
      el.pipelineJobsList.innerHTML = `
        <div class="panel" style="text-align:center;color:var(--text-muted);padding:26px;">
          Chưa có video tự động nào. Hãy nhập 1 chủ đề phía trên rồi bấm <strong>Chạy Tự Động Hóa</strong> (hoặc nhắn <code>/make chủ đề</code> từ Telegram).
        </div>`;
      return;
    }

    el.pipelineJobsList.innerHTML = state.jobs.map(job => {
      const plan = job.plan || {};
      const scenes = Array.isArray(plan.scenes) ? plan.scenes : [];
      const modePill = job.renderMode === 'rendered_mp4'
        ? '<span class="pill pill-emerald">MP4 1080×1920</span>'
        : '<span class="pill pill-amber">STORYBOARD + .SRT</span>';
      const srcPill = job.sourceChannel === 'telegram'
        ? '<span class="pill pill-fb">TỪ TELEGRAM</span>'
        : '<span class="pill pill-muted">TỪ WEB</span>';

      return `
        <article class="queue-card">
          <div class="queue-card-main">
            <div class="queue-card-top">
              ${modePill}
              ${srcPill}
              <span class="pill pill-muted">${escapeHtml(job.status.toUpperCase())}</span>
            </div>
            <div class="queue-card-title">${escapeHtml(plan.title || job.topic)}</div>
            <div class="queue-card-desc">${escapeHtml(plan.hashtags || '')}</div>
            <div class="queue-card-meta">
              <span>Chủ đề: ${escapeHtml(job.topic)}</span>
              <span>Lúc: ${formatDateTime(job.createdAt)}</span>
            </div>
            ${scenes.length ? `
              <div class="scenes-grid">
                ${scenes.map((sc, idx) => `
                  <div class="scene-chip">
                    <div class="scene-chip-head">
                      <span>CẢNH ${idx + 1}</span>
                      <span>${sc.durationSec || 4.5}s</span>
                    </div>
                    <div><strong>${escapeHtml(sc.subtitle)}</strong></div>
                    <div class="scene-chip-query">Pexels: ${escapeHtml(sc.searchQuery)}</div>
                  </div>
                `).join('')}
              </div>` : ''}
            ${job.errorMessage ? `<div class="queue-error">${escapeHtml(job.errorMessage)}</div>` : ''}
          </div>
          <div class="queue-card-actions">
            ${job.srtContent ? `<a class="btn-secondary" style="text-decoration:none;" href="/api/pipeline/srt/${encodeURIComponent(job.id)}">Tải .SRT</a>` : ''}
            ${job.postId ? `<button type="button" class="btn-emerald" data-job-publish="${escapeHtml(job.postId)}">Duyệt &amp; Đăng Ngay</button>` : ''}
            <button type="button" class="btn-danger" data-job-delete="${escapeHtml(job.id)}">Xóa</button>
          </div>
        </article>
      `;
    }).join('');
  }

  function renderQueue() {
    const filtered = state.posts.filter(p => state.queueFilter === 'all' || p.status === state.queueFilter);
    if (!filtered.length) {
      el.queueList.innerHTML = `
        <div class="panel" style="text-align:center;color:var(--text-muted);padding:28px;">
          Không có video nào trong mục này.
        </div>`;
      return;
    }

    const statusBadge = (status, dryRun) => {
      const map = {
        scheduled: ['pill-amber', 'ĐÃ LÊN LỊCH'],
        published: ['pill-emerald', dryRun ? 'ĐÃ ĐĂNG (DRY-RUN)' : 'ĐÃ ĐĂNG LIVE'],
        publishing: ['pill-fb', 'ĐANG TẢI LÊN...'],
        failed: ['pill-yt', 'LỖI ĐĂNG'],
        draft: ['pill-muted', 'CHỜ DUYỆT / NHÁP']
      };
      const [cls, label] = map[status] || ['pill-muted', status.toUpperCase()];
      return `<span class="pill ${cls}">${label}</span>`;
    };

    el.queueList.innerHTML = filtered.map(post => {
      const platBadges = (post.platforms || []).map(p =>
        p === 'youtube'
          ? '<span class="pill pill-yt">YouTube Shorts</span>'
          : '<span class="pill pill-fb">FB Page Reels</span>'
      ).join('');

      const links = [];
      if (post.youtubeUrl) {
        links.push(`<a href="${escapeHtml(post.youtubeUrl)}" target="_blank" rel="noopener noreferrer">YouTube: ${escapeHtml(post.youtubeUrl)}</a>`);
      }
      if (post.facebookUrl) {
        links.push(`<a href="${escapeHtml(post.facebookUrl)}" target="_blank" rel="noopener noreferrer">Facebook: ${escapeHtml(post.facebookUrl)}</a>`);
      }

      return `
        <article class="queue-card" data-post-id="${escapeHtml(post.id)}">
          <div class="queue-card-main">
            <div class="queue-card-top">
              ${statusBadge(post.status, post.dryRun)}
              ${platBadges}
            </div>
            <div class="queue-card-title">${escapeHtml(post.title)}</div>
            <div class="queue-card-desc">${escapeHtml(post.description || post.hashtags || 'Không có mô tả')}</div>
            <div class="queue-card-meta">
              <span>File: ${escapeHtml(post.videoFilename || 'Chưa gắn file')} (${formatBytes(post.videoSize)})</span>
              <span>Hẹn giờ: ${formatDateTime(post.scheduledAt)}</span>
              ${post.publishedAt ? `<span>Hoàn tất: ${formatDateTime(post.publishedAt)}</span>` : ''}
            </div>
            ${links.length ? `<div class="queue-card-links">${links.join('')}</div>` : ''}
            ${post.lastError ? `<div class="queue-error">Lỗi: ${escapeHtml(post.lastError)}</div>` : ''}
          </div>
          <div class="queue-card-actions">
            ${post.status !== 'published' ? `<button type="button" class="btn-emerald" data-action="publish" data-id="${escapeHtml(post.id)}">Đăng ngay</button>` : ''}
            <button type="button" class="btn-danger" data-action="delete" data-id="${escapeHtml(post.id)}">Xóa</button>
          </div>
        </article>
      `;
    }).join('');
  }

  function renderLogs() {
    if (!state.logs.length) {
      el.logsList.innerHTML = '<div style="color:var(--text-muted);padding:16px;">Chưa có nhật ký hoạt động nào.</div>';
      return;
    }
    const levelClass = (lvl) => {
      if (lvl === 'success') return 'pill-emerald';
      if (lvl === 'error') return 'pill-yt';
      if (lvl === 'warn') return 'pill-amber';
      return 'pill-muted';
    };
    el.logsList.innerHTML = state.logs.map(log => `
      <div class="log-row">
        <span class="log-time">${formatDateTime(log.createdAt)}</span>
        <span class="pill pill-muted">${escapeHtml(String(log.platform || 'system').toUpperCase())}</span>
        <span class="pill ${levelClass(log.level)}">${escapeHtml(String(log.level || 'info').toUpperCase())}</span>
        <span>${escapeHtml(log.message)}</span>
      </div>
    `).join('');
  }

  async function bootstrap() {
    const data = await api('/api/bootstrap');
    state.stats = data.stats || state.stats;
    state.settings = data.settings || state.settings;
    state.ffmpeg = data.ffmpeg || state.ffmpeg;
    state.telegram = data.telegram || state.telegram;
    state.posts = data.posts || [];
    state.jobs = data.jobs || [];
    state.logs = data.logs || [];
    renderSidebarAndSettings();
    renderPipelineJobs();
    renderQueue();
    renderLogs();
  }

  async function reloadLogs() {
    const data = await api('/api/logs');
    state.logs = data.logs || [];
    renderLogs();
  }

  async function uploadVideoFile(file) {
    if (!file) return;
    el.uploadProgressBox.classList.remove('hidden');
    el.uploadProgressBar.style.width = '45%';
    el.uploadProgressLabel.textContent = `Đang nạp "${file.name}" (${formatBytes(file.size)})...`;

    try {
      const res = await fetch('/api/upload-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name)
        },
        body: file
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      state.uploadedVideo = data;
      el.uploadProgressBar.style.width = '100%';
      el.dropzoneEmpty.classList.add('hidden');
      el.videoPreviewWrap.classList.remove('hidden');
      el.videoPreviewPlayer.src = data.previewUrl;
      el.uploadedFileName.textContent = data.originalName || data.videoFilename;
      el.videoMetaText.textContent = `${data.originalName} · ${formatBytes(data.videoSize)}`;
      showToast(`Đã nạp video "${file.name}" thành công`);
      await reloadLogs();
    } catch (err) {
      showToast(`Lỗi tải video: ${err.message}`, 'error');
    } finally {
      setTimeout(() => el.uploadProgressBox.classList.add('hidden'), 500);
      el.videoFileInput.value = '';
    }
  }

  function resetComposerForm() {
    el.postForm.reset();
    el.chkYoutube.checked = true;
    el.chkFacebook.checked = true;
    el.aiTopicInput.value = '';
    el.aiHookTip.classList.add('hidden');
    state.uploadedVideo = null;
    el.videoPreviewPlayer.removeAttribute('src');
    el.videoPreviewWrap.classList.add('hidden');
    el.dropzoneEmpty.classList.remove('hidden');
    el.videoMetaText.textContent = 'Chưa chọn video';
  }

  function collectPostPayload({ publishNow = false } = {}) {
    const platforms = [];
    if (el.chkYoutube.checked) platforms.push('youtube');
    if (el.chkFacebook.checked) platforms.push('facebook');
    if (!platforms.length) throw new Error('Hãy chọn ít nhất 1 nền tảng.');
    const title = el.postTitle.value.trim();
    if (!title) throw new Error('Vui lòng nhập tiêu đề video.');

    const schedVal = el.postScheduleAt.value;
    const scheduledAt = schedVal ? new Date(schedVal).toISOString() : null;
    const status = publishNow ? 'publishing' : (scheduledAt ? 'scheduled' : 'draft');

    return {
      title,
      description: el.postDescription.value.trim(),
      hashtags: el.postHashtags.value.trim(),
      videoFilename: state.uploadedVideo?.videoFilename || 'demo-9x16.mp4',
      videoPath: state.uploadedVideo?.videoPath || '',
      videoSize: state.uploadedVideo?.videoSize || 0,
      platforms,
      privacy: el.postPrivacy.value,
      scheduledAt,
      status,
      publishNow
    };
  }

  async function submitPost(publishNow) {
    try {
      const payload = collectPostPayload({ publishNow });
      const res = await api('/api/posts', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      await bootstrap();
      resetComposerForm();
      if (publishNow) {
        const ok = res.post?.status === 'published';
        showToast(ok ? `Đã đăng bài "${res.post.title}"!` : `Lỗi: ${res.post?.lastError}`, ok ? 'emerald' : 'error');
      } else {
        showToast(payload.scheduledAt ? 'Đã thêm video vào Lịch Hẹn!' : 'Đã lưu Bản Nháp!');
      }
      switchView('queue');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function bindEvents() {
    el.navBtns.forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
    el.btnRefreshAll.addEventListener('click', () => bootstrap().then(() => showToast('Đã làm mới dữ liệu')));

    el.btnQuickModeToggle.addEventListener('click', async () => {
      const nextMode = state.settings?.mode === 'live' ? 'dry_run' : 'live';
      const res = await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ mode: nextMode })
      });
      state.settings = res.settings;
      renderSidebarAndSettings();
      showToast(
        nextMode === 'live' ? 'Đã chuyển sang chế độ ĐĂNG THẬT (LIVE)' : 'Đã chuyển về chế độ CHẠY THỬ (DRY-RUN)',
        nextMode === 'live' ? 'emerald' : 'amber'
      );
    });

    // Auto-Video Pipeline form
    el.pipelineForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const topic = el.pipeTopicInput.value.trim();
      if (!topic) return;
      const platforms = [];
      if (el.pipeChkYt.checked) platforms.push('youtube');
      if (el.pipeChkFb.checked) platforms.push('facebook');
      if (!platforms.length) {
        showToast('Chọn ít nhất 1 nền tảng (YouTube hoặc Facebook).', 'amber');
        return;
      }

      el.btnRunPipeline.disabled = true;
      el.btnRunPipeline.textContent = 'Đang chạy dây chuyền...';
      try {
        const res = await api('/api/pipeline/run', {
          method: 'POST',
          body: JSON.stringify({
            topic,
            tone: el.pipeToneSelect.value,
            language: el.pipeLangSelect.value,
            platforms,
            autoPublish: el.pipeAutoPublish.checked
          })
        });
        el.pipeTopicInput.value = '';
        await bootstrap();
        showToast(
          res.job?.renderMode === 'rendered_mp4'
            ? 'Đã dựng xong video MP4 1080×1920 + phụ đề .SRT!'
            : 'Đã tạo xong kịch bản, 4 cảnh B-Roll & file phụ đề .SRT!'
        );
      } catch (err) {
        showToast(`Lỗi Pipeline: ${err.message}`, 'error');
      } finally {
        el.btnRunPipeline.disabled = false;
        el.btnRunPipeline.textContent = 'Chạy Tự Động Hóa';
      }
    });

    el.pipelineJobsList.addEventListener('click', async (e) => {
      const pubBtn = e.target.closest('button[data-job-publish]');
      if (pubBtn) {
        pubBtn.disabled = true;
        pubBtn.textContent = 'Đang đăng...';
        try {
          const res = await api(`/api/posts/${encodeURIComponent(pubBtn.dataset.jobPublish)}/publish-now`, { method: 'POST' });
          await bootstrap();
          const ok = res.post?.status === 'published';
          showToast(ok ? 'Đã duyệt & đăng bài thành công!' : `Lỗi đăng: ${res.post?.lastError}`, ok ? 'emerald' : 'error');
        } catch (err) {
          showToast(err.message, 'error');
        }
        return;
      }
      const delBtn = e.target.closest('button[data-job-delete]');
      if (delBtn) {
        await api(`/api/pipeline/jobs/${encodeURIComponent(delBtn.dataset.jobDelete)}`, { method: 'DELETE' });
        await bootstrap();
        showToast('Đã xóa lịch sử job.');
      }
    });

    // Video upload drag & drop
    el.btnPickVideo.addEventListener('click', () => el.videoFileInput.click());
    el.btnReplaceVideo.addEventListener('click', () => el.videoFileInput.click());
    el.videoFileInput.addEventListener('change', (e) => uploadVideoFile(e.target.files?.[0]));

    el.dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.dropzone.classList.add('dragover');
    });
    el.dropzone.addEventListener('dragleave', () => el.dropzone.classList.remove('dragover'));
    el.dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      el.dropzone.classList.remove('dragover');
      uploadVideoFile(e.dataTransfer?.files?.[0]);
    });

    // Manual Composer AI
    el.btnGenerateAi.addEventListener('click', async () => {
      const topic = el.aiTopicInput.value.trim() || el.postTitle.value.trim();
      if (!topic) {
        showToast('Hãy nhập chủ đề trước khi bấm AI Viết Tiêu Đề.', 'amber');
        el.aiTopicInput.focus();
        return;
      }
      el.btnGenerateAi.disabled = true;
      el.btnGenerateAi.textContent = 'Đang viết...';
      try {
        const res = await api('/api/ai/generate', {
          method: 'POST',
          body: JSON.stringify({
            topic,
            script: el.postDescription.value.trim(),
            tone: el.aiToneSelect.value,
            language: el.aiLangSelect.value
          })
        });
        el.postTitle.value = res.title || '';
        el.postDescription.value = res.description || '';
        el.postHashtags.value = res.hashtags || '';
        if (res.hookTip) {
          el.aiHookTip.textContent = `Gợi ý Hook 3s (${res.source === 'gemini' ? 'Gemini 2.5 Flash' : 'Offline Preview'}): ${res.hookTip}`;
          el.aiHookTip.classList.remove('hidden');
        }
        showToast('Đã điền tự động Tiêu đề, Mô tả & Hashtag!');
      } catch (err) {
        showToast(`Lỗi AI: ${err.message}`, 'error');
      } finally {
        el.btnGenerateAi.disabled = false;
        el.btnGenerateAi.textContent = 'AI Viết Tiêu Đề';
      }
    });

    el.quickTimeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const mins = Number(btn.dataset.plusMin || 15);
        const dt = new Date(Date.now() + mins * 60000);
        el.postScheduleAt.value = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      });
    });

    el.postForm.addEventListener('submit', (e) => {
      e.preventDefault();
      submitPost(false);
    });
    el.btnPublishNow.addEventListener('click', () => submitPost(true));
    el.btnResetForm.addEventListener('click', resetComposerForm);

    // Queue
    el.queueFilterTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        state.queueFilter = tab.dataset.filter;
        el.queueFilterTabs.forEach(t => t.classList.toggle('active', t === tab));
        renderQueue();
      });
    });

    el.queueList.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const id = btn.dataset.id;
      const action = btn.dataset.action;

      try {
        if (action === 'delete') {
          await api(`/api/posts/${encodeURIComponent(id)}`, { method: 'DELETE' });
          await bootstrap();
          showToast('Đã xóa bài khỏi hàng đợi.');
        } else if (action === 'publish') {
          btn.disabled = true;
          btn.textContent = 'Đang đăng...';
          const res = await api(`/api/posts/${encodeURIComponent(id)}/publish-now`, { method: 'POST' });
          await bootstrap();
          const ok = res.post?.status === 'published';
          showToast(ok ? 'Đăng bài thành công!' : `Lỗi: ${res.post?.lastError}`, ok ? 'emerald' : 'error');
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Settings & Telegram Toggle
    el.btnSaveSettings.addEventListener('click', async () => {
      try {
        const res = await api('/api/settings', {
          method: 'PUT',
          body: JSON.stringify({
            mode: el.cfgMode.value,
            gemini_api_key: el.cfgGeminiKey.value.trim(),
            telegram_bot_token: el.cfgTgToken.value.trim(),
            telegram_chat_id: el.cfgTgChatId.value.trim(),
            pexels_api_key: el.cfgPexelsKey.value.trim(),
            ffmpeg_path: el.cfgFfmpegPath.value.trim() || 'ffmpeg',
            yt_client_id: el.cfgYtClientId.value.trim(),
            yt_client_secret: el.cfgYtClientSecret.value.trim(),
            yt_redirect_uri: el.cfgYtRedirectUri.value.trim(),
            fb_page_id: el.cfgFbPageId.value.trim(),
            fb_page_access_token: el.cfgFbToken.value.trim(),
            fb_api_version: el.cfgFbVersion.value.trim() || 'v21.0'
          })
        });
        state.settings = res.settings;
        state.ffmpeg = res.ffmpeg || state.ffmpeg;
        state.telegram = res.telegram || state.telegram;
        el.cfgGeminiKey.value = '';
        el.cfgTgToken.value = '';
        el.cfgPexelsKey.value = '';
        el.cfgYtClientSecret.value = '';
        el.cfgFbToken.value = '';
        renderSidebarAndSettings();
        showToast('Đã lưu toàn bộ cấu hình vào SQLite!');
      } catch (err) {
        showToast(`Lỗi lưu cấu hình: ${err.message}`, 'error');
      }
    });

    el.btnToggleTelegram.addEventListener('click', async () => {
      try {
        if (el.cfgTgToken.value.trim() || el.cfgTgChatId.value.trim()) {
          await api('/api/settings', {
            method: 'PUT',
            body: JSON.stringify({
              telegram_bot_token: el.cfgTgToken.value.trim(),
              telegram_chat_id: el.cfgTgChatId.value.trim()
            })
          });
          el.cfgTgToken.value = '';
        }
        const nextEnable = !state.telegram?.running;
        const res = await api('/api/telegram/toggle', {
          method: 'POST',
          body: JSON.stringify({ enabled: nextEnable })
        });
        state.telegram = res.telegram;
        state.settings = res.settings;
        renderSidebarAndSettings();
        if (res.telegram.error) {
          showToast(`Telegram Bot: ${res.telegram.error}`, 'error');
        } else {
          showToast(res.telegram.running ? `Đã bật Telegram Bot ${res.telegram.botUsername}` : 'Đã tắt Telegram Bot');
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    el.btnConnectYoutube.addEventListener('click', async () => {
      try {
        await api('/api/settings', {
          method: 'PUT',
          body: JSON.stringify({
            yt_client_id: el.cfgYtClientId.value.trim(),
            yt_client_secret: el.cfgYtClientSecret.value.trim(),
            yt_redirect_uri: el.cfgYtRedirectUri.value.trim()
          })
        });
        const res = await api('/api/oauth/youtube/start');
        if (res.url) window.open(res.url, '_blank', 'noopener');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    el.btnTestConnections.addEventListener('click', async () => {
      el.btnTestConnections.disabled = true;
      el.testResultText.textContent = 'Đang kiểm tra kết nối...';
      try {
        const res = await api('/api/test-connections', { method: 'POST' });
        state.settings = res.settings;
        state.ffmpeg = res.ffmpeg || state.ffmpeg;
        state.telegram = res.telegram || state.telegram;
        renderSidebarAndSettings();
        const r = res.report;
        el.testResultText.textContent = `YT: ${r.youtube.ok ? 'OK' : 'Off'} · FB: ${r.facebook.ok ? 'OK' : 'Off'} · TG: ${r.telegram.ok ? 'OK' : 'Off'} · Pexels: ${r.pexels.ok ? 'OK' : 'Off'} · FFmpeg: ${r.ffmpeg.available ? 'OK' : 'Chưa cài'}`;
        showToast('Đã hoàn tất kiểm tra toàn bộ API & FFmpeg.');
      } catch (err) {
        el.testResultText.textContent = `Lỗi: ${err.message}`;
      } finally {
        el.btnTestConnections.disabled = false;
      }
    });

    el.btnReloadLogs.addEventListener('click', () => reloadLogs().then(() => showToast('Đã tải lại nhật ký')));
  }

  document.addEventListener('DOMContentLoaded', async () => {
    bindEvents();
    const params = new URLSearchParams(window.location.search);
    if (params.get('oauth') === 'youtube_ok') {
      showToast('Kết nối tài khoản YouTube OAuth thành công!');
      window.history.replaceState({}, '', '/');
    } else if (params.get('oauth') === 'youtube_error') {
      showToast(`Lỗi kết nối YouTube OAuth: ${params.get('msg') || 'unknown'}`, 'error');
      window.history.replaceState({}, '', '/');
    }
    await bootstrap();
  });
})();

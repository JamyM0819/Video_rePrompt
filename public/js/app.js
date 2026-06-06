(function () {
  'use strict';

  // ── DOM elements ──
  const uploadSection = document.getElementById('uploadSection');
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseBtn');
  const uploadError = document.getElementById('uploadError');
  const recentAnalyses = document.getElementById('recentAnalyses');
  const recentList = document.getElementById('recentList');
  const recentManageBtn = document.getElementById('recentManageBtn');
  const recentManageBar = document.getElementById('recentManageBar');
  const recentSelectAll = document.getElementById('recentSelectAll');
  const recentSelectedHint = document.getElementById('recentSelectedHint');
  const recentMaxCount = document.getElementById('recentMaxCount');
  const recentDeleteBtn = document.getElementById('recentDeleteBtn');
  const recentManageDoneBtn = document.getElementById('recentManageDoneBtn');

  const tabFile = document.getElementById('tabFile');
  const tabUrl = document.getElementById('tabUrl');
  const filePanel = document.getElementById('filePanel');
  const urlPanel = document.getElementById('urlPanel');
  const urlInput = document.getElementById('urlInput');
  const urlSubmitBtn = document.getElementById('urlSubmitBtn');
  const clearCacheBtn = document.getElementById('clearCacheBtn');
  const customPromptInput = document.getElementById('customPromptInput');
  const customPromptSubmit = document.getElementById('customPromptSubmit');
  const promptHistory = document.getElementById('promptHistory');

  const progressSection = document.getElementById('progressSection');
  const progressBar = document.getElementById('progressBar');
  const progressLabel = document.getElementById('progressLabel');
  const progressDetail = document.getElementById('progressDetail');
  const progressLog = document.getElementById('progressLog');

  const rangeSection = document.getElementById('rangeSection');
  const rangeCount = document.getElementById('rangeCount');
  const rangeStart = document.getElementById('rangeStart');
  const rangeEnd = document.getElementById('rangeEnd');
  const rangeFill = document.getElementById('rangeFill');
  const rangeLabelStart = document.getElementById('rangeLabelStart');
  const rangeLabelEnd = document.getElementById('rangeLabelEnd');
  const rangeConfirmBtn = document.getElementById('rangeConfirmBtn');
  const rangeStartNum = document.getElementById('rangeStartNum');
  const rangeEndNum = document.getElementById('rangeEndNum');
  const rangeSelectedCount = document.getElementById('rangeSelectedCount');
  const filmstrip = document.getElementById('filmstrip');

  const resultsSection = document.getElementById('resultsSection');
  const resultsTitle = document.getElementById('resultsTitle');
  const resultsMeta = document.getElementById('resultsMeta');
  const shotsTimeline = document.getElementById('shotsTimeline');
  const copyAllBtn = document.getElementById('copyAllBtn');
  const copyAllBtn2 = document.getElementById('copyAllBtn2');
  const exportBtn = document.getElementById('exportBtn');
  const exportBtn2 = document.getElementById('exportBtn2');
  const headerToolbar = document.getElementById('headerToolbar');

  const errorSection = document.getElementById('errorSection');
  const errorMessage = document.getElementById('errorMessage');
  const retryBtn = document.getElementById('retryBtn');

  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxClose = document.getElementById('lightboxClose');

  let pollTimer = null;
  let progressAnimTimer = null;
  let currentJobId = null;
  let currentJobStatus = null;
  let cameFromResults = false;   // track navigation for back button in toolbar

  // ── Version display ──
  fetch('/api/version').then(r => r.json()).then(v => {
    document.getElementById('versionLine').textContent = `v${v.version} · ${v.hash}`;
  }).catch(() => {});

  // ── Session restore: resume on page refresh ──
  const savedJobId = sessionStorage.getItem('jobId');
  const savedStatus = sessionStorage.getItem('jobStatus');
  if (savedJobId && savedStatus) {
    currentJobId = savedJobId;
    currentJobStatus = savedStatus;
    uploadSection.classList.add('hidden');
    if (savedStatus === 'awaiting_range') {
      // Jump to range selector
      progressSection.classList.add('hidden');
      rangeSection.classList.remove('hidden');
      fetch('/api/jobs/' + savedJobId).then(r => {
        if (!r.ok) { resetToUpload(); return; }
        return r.json();
      }).then(job => {
        if (!job) return;
        if (job.sceneData) showRangeSelector(job.sceneData);
        else resetToUpload();
      }).catch(() => resetToUpload());
    } else if (savedStatus === 'done') {
      // Jump to results
      progressSection.classList.add('hidden');
      rangeSection.classList.add('hidden');
      fetch('/api/jobs/' + savedJobId).then(r => {
        if (!r.ok) { resetToUpload(); showError('任务已过期（服务重启后内存清空），请重新上传。'); return; }
        return r.json();
      }).then(job => {
        if (!job) return;
        if (job.results) showResults(job);
        else resetToUpload();
      }).catch(() => resetToUpload());
    } else {
      // In progress — resume polling
      progressSection.classList.remove('hidden');
      startDetectAnim();
      setToolbar([{type:'history'},{text:'返回首页',onClick:resetToUpload}]);
      pollJob(savedJobId);
    }
  } else {
    // Home page — show history
    setToolbar([{type:'history'}]);
    renderRecentAnalyses();
    renderPromptHistory();
  }

  let manageMode = false;

  // Load saved max count from localStorage
  function getMaxRecentCount() {
    const v = parseInt(localStorage.getItem('maxRecentCount'));
    return (v >= 1 && v <= 20) ? v : 6;
  }
  function setMaxRecentCount(n) {
    localStorage.setItem('maxRecentCount', n);
  }

  async function renderRecentAnalyses() {
    try {
      let recents = JSON.parse(localStorage.getItem('recentJobs') || '[]');
      const maxCount = getMaxRecentCount();
      if (recents.length > maxCount) recents = recents.slice(0, maxCount);
      if (recents.length === 0) {
        recentAnalyses.classList.add('hidden');
        return;
      }
      recentAnalyses.classList.remove('hidden');
      recentList.innerHTML = '';

      // Verify which jobs still exist on server, mark expired ones
      const checkResults = await Promise.allSettled(
        recents.map(r => fetch('/api/jobs/' + r.jobId).then(res => ({ jobId: r.jobId, alive: res.ok })))
      );
      const aliveMap = new Map();
      checkResults.forEach(r => {
        if (r.status === 'fulfilled' && r.value) aliveMap.set(r.value.jobId, r.value.alive);
      });

      recents.forEach(r => {
        const card = document.createElement('div');
        card.className = 'recent-card' + (manageMode ? ' delete-mode' : '');
        card.dataset.jobId = r.jobId;
        const isAlive = aliveMap.get(r.jobId) !== false;
        card.innerHTML =
          '<input type="checkbox" class="recent-delete-check"' + (manageMode ? '' : ' style="display:none"') + '>' +
          '<div class="recent-card-name">' + escapeHtml(r.name || '未知视频') + '</div>' +
          '<div class="recent-card-meta">' + (r.shotCount || '?') + ' 个镜头</div>' +
          (isAlive
            ? '<div class="recent-card-status">已完成</div>'
            : '<div class="recent-card-status" style="background:rgba(247,74,92,0.15);color:var(--error)">已过期</div>');
        card.addEventListener('click', (e) => {
          if (e.target.tagName === 'INPUT') return;
          if (manageMode) {
            const cb = card.querySelector('.recent-delete-check');
            cb.checked = !cb.checked;
            updateManageSelection();
          } else if (isAlive) {
            switchToJob(r.jobId);
          } else {
            alert('该任务已在服务端过期（重启后内存清空），请重新上传视频分析。');
          }
        });
        recentList.appendChild(card);
      });

      // Show/hide management UI
      recentManageBtn.classList.toggle('hidden', manageMode);
      recentManageBar.classList.toggle('hidden', !manageMode);
      if (manageMode) {
        recentMaxCount.value = maxCount;
        updateManageSelection();
      }
    } catch { recentAnalyses.classList.add('hidden'); }
  }

  function updateManageSelection() {
    const all = recentList.querySelectorAll('.recent-delete-check');
    const checked = recentList.querySelectorAll('.recent-delete-check:checked');
    recentSelectAll.checked = all.length > 0 && checked.length === all.length;
    recentSelectAll.indeterminate = checked.length > 0 && checked.length < all.length;
    recentSelectedHint.textContent = checked.length > 0 ? `已选 ${checked.length} 项` : '';
  }

  function enterManageMode() {
    manageMode = true;
    renderRecentAnalyses();
  }

  function exitManageMode() {
    manageMode = false;
    // Save max count
    const n = parseInt(recentMaxCount.value);
    if (n >= 1 && n <= 20) {
      setMaxRecentCount(n);
      // Trim localStorage if count reduced
      let recents = JSON.parse(localStorage.getItem('recentJobs') || '[]');
      if (recents.length > n) {
        recents = recents.slice(0, n);
        localStorage.setItem('recentJobs', JSON.stringify(recents));
      }
    }
    renderRecentAnalyses();
  }

  async function deleteSelectedRecents() {
    const checked = [...recentList.querySelectorAll('.recent-delete-check:checked')];
    if (checked.length === 0) return;
    if (!confirm('确定要删除选中的 ' + checked.length + ' 条记录吗？\n\n这将同时清除服务端缓存（视频文件、分析结果等），不可恢复。')) return;

    const jobIds = checked.map(cb => cb.closest('.recent-card').dataset.jobId);

    // Remove from localStorage
    let recents = JSON.parse(localStorage.getItem('recentJobs') || '[]');
    recents = recents.filter(r => !jobIds.includes(r.jobId));
    localStorage.setItem('recentJobs', JSON.stringify(recents));

    // Delete server-side cache
    await fetch('/api/delete-jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobIds }),
    }).catch(() => {});

    exitManageMode();
  }

  // ── Prompt history ──
  function getPromptHistory() {
    try { return JSON.parse(localStorage.getItem('promptHistory') || '[]'); } catch { return []; }
  }

  function savePromptHistory(text) {
    if (!text || !text.trim()) return;
    const trimmed = text.trim();
    let h = getPromptHistory().filter(p => p !== trimmed);
    h.unshift(trimmed);
    if (h.length > 10) h = h.slice(0, 10);
    localStorage.setItem('promptHistory', JSON.stringify(h));
    renderPromptHistory();
  }

  function deletePromptHistory(text) {
    let h = getPromptHistory().filter(p => p !== text);
    localStorage.setItem('promptHistory', JSON.stringify(h));
    renderPromptHistory();
  }

  function renderPromptHistory() {
    const h = getPromptHistory();
    if (h.length === 0) {
      promptHistory.classList.add('hidden');
      return;
    }
    promptHistory.classList.remove('hidden');
    promptHistory.innerHTML = '';
    h.forEach(text => {
      const chip = document.createElement('span');
      chip.className = 'prompt-chip';
      const span = document.createElement('span');
      span.className = 'prompt-chip-text';
      span.textContent = text;
      span.title = text;
      const del = document.createElement('span');
      del.className = 'prompt-chip-del';
      del.textContent = '✕';
      del.title = '删除此条';
      del.addEventListener('click', (e) => { e.stopPropagation(); deletePromptHistory(text); });
      chip.appendChild(span);
      chip.appendChild(del);
      chip.addEventListener('click', () => {
        customPromptInput.value = text;
        customPromptInput.focus();
      });
      promptHistory.appendChild(chip);
    });
  }

  // "添加" 按钮 — 把当前 textarea 内容保存为历史气泡
  customPromptSubmit.addEventListener('click', () => {
    const val = customPromptInput.value.trim();
    if (val) { savePromptHistory(val); customPromptInput.value = ''; }
  });
  // Ctrl+Enter / Cmd+Enter 也可以添加
  customPromptInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      const val = customPromptInput.value.trim();
      if (val) { savePromptHistory(val); customPromptInput.value = ''; }
    }
  });

  // Wire up management buttons
  recentManageBtn.addEventListener('click', enterManageMode);
  recentManageDoneBtn.addEventListener('click', exitManageMode);
  recentDeleteBtn.addEventListener('click', deleteSelectedRecents);
  recentSelectAll.addEventListener('change', () => {
    const checked = recentSelectAll.checked;
    recentList.querySelectorAll('.recent-delete-check').forEach(cb => { cb.checked = checked; });
    updateManageSelection();
  });

  function saveSession(jobId, status) {
    currentJobId = jobId;
    currentJobStatus = status;
    sessionStorage.setItem('jobId', jobId);
    sessionStorage.setItem('jobStatus', status);
  }

  // Save completed job info for recent analyses on home page
  function saveRecent(jobId, name, shotCount) {
    try {
      let recents = JSON.parse(localStorage.getItem('recentJobs') || '[]');
      recents = recents.filter(r => r.jobId !== jobId);
      recents.unshift({ jobId, name, shotCount, time: Date.now() });
      const maxCount = getMaxRecentCount();
      if (recents.length > maxCount) recents = recents.slice(0, maxCount);
      localStorage.setItem('recentJobs', JSON.stringify(recents));
    } catch {}
  }

  function deleteRecent(jobId) {
    try {
      let recents = JSON.parse(localStorage.getItem('recentJobs') || '[]');
      recents = recents.filter(r => r.jobId !== jobId);
      localStorage.setItem('recentJobs', JSON.stringify(recents));
    } catch {}
  }

  function clearSession() {
    sessionStorage.removeItem('jobId');
    sessionStorage.removeItem('jobStatus');
    currentJobId = null;
    currentJobStatus = null;
  }

  // Note: localStorage history is NOT cleared on reset; only session is.

  // ── Tab switching ──
  tabFile.addEventListener('click', () => {
    tabFile.classList.add('active'); tabUrl.classList.remove('active');
    filePanel.classList.remove('hidden'); urlPanel.classList.add('hidden');
    uploadError.classList.add('hidden');
  });
  tabUrl.addEventListener('click', () => {
    tabUrl.classList.add('active'); tabFile.classList.remove('active');
    urlPanel.classList.remove('hidden'); filePanel.classList.add('hidden');
    uploadError.classList.add('hidden');
  });

  // ── Drag & drop ──
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => { dropZone.classList.remove('drag-over'); });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault(); dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
  dropZone.addEventListener('click', (e) => {
    if (e.target === browseBtn || browseBtn.contains(e.target)) return;
    fileInput.click();
  });
  browseBtn.addEventListener('click', (e) => { e.stopPropagation(); });
  fileInput.addEventListener('change', () => { const f = fileInput.files[0]; if (f) handleFile(f); });

  // ── URL submit ──
  urlSubmitBtn.addEventListener('click', handleUrlSubmit);
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleUrlSubmit(); });

  // ── Buttons ──
  copyAllBtn.addEventListener('click', copyAllDescriptions);
  copyAllBtn2.addEventListener('click', copyAllDescriptions);
  exportBtn.addEventListener('click', exportToFile);
  exportBtn2.addEventListener('click', exportToFile);
  clearCacheBtn.addEventListener('click', clearCache);
  retryBtn.addEventListener('click', resetToUpload);

  // ── Lightbox ──
  lightboxClose.addEventListener('click', closeLightbox);
  lightbox.querySelector('.lightbox-backdrop').addEventListener('click', closeLightbox);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });

  // ── Range slider sync ──
  function updateRangeFill() {
    const min = parseInt(rangeStart.min), max = parseInt(rangeStart.max);
    const s = parseInt(rangeStart.value), e = parseInt(rangeEnd.value);
    const left = max > min ? ((s - min) / (max - min)) * 100 : 0;
    const right = max > min ? ((e - min) / (max - min)) * 100 : 100;
    rangeFill.style.left = left + '%';
    rangeFill.style.width = (right - left) + '%';
    rangeLabelStart.textContent = '镜头 ' + s;
    rangeLabelEnd.textContent = '镜头 ' + e;
    rangeConfirmBtn.textContent = '分析镜头 ' + s + ' ~ ' + e + '（共 ' + (e - s + 1) + ' 个）';
    if (parseInt(rangeStartNum.value) !== s) rangeStartNum.value = s;
    if (parseInt(rangeEndNum.value) !== e) rangeEndNum.value = e;
    rangeSelectedCount.textContent = e - s + 1;

    // Highlight filmstrip
    updateFilmstrip(s, e);
  }

  function setRangeFromNums() {
    let s = parseInt(rangeStartNum.value), e = parseInt(rangeEndNum.value);
    const max = parseInt(rangeStart.max);
    if (isNaN(s) || s < 1) s = 1;
    if (isNaN(e) || e > max) e = max;
    if (s > e) { const t = s; s = e; e = t; }
    rangeStart.value = s; rangeEnd.value = e;
    updateRangeFill();
  }

  rangeStart.addEventListener('input', () => {
    const s = parseInt(rangeStart.value), e = parseInt(rangeEnd.value);
    if (s >= e) rangeEnd.value = Math.min(parseInt(rangeEnd.max), s + 1);
    updateRangeFill();
  });
  rangeEnd.addEventListener('input', () => {
    const s = parseInt(rangeStart.value), e = parseInt(rangeEnd.value);
    if (e <= s) rangeStart.value = Math.max(1, e - 1);
    updateRangeFill();
  });
  rangeStartNum.addEventListener('change', setRangeFromNums);
  rangeEndNum.addEventListener('change', setRangeFromNums);
  rangeStartNum.addEventListener('keydown', (e) => { if (e.key === 'Enter') setRangeFromNums(); });
  rangeEndNum.addEventListener('keydown', (e) => { if (e.key === 'Enter') setRangeFromNums(); });

  rangeConfirmBtn.addEventListener('click', () => {
    const s = parseInt(rangeStart.value) - 1, e = parseInt(rangeEnd.value) - 1;
    rangeSection.classList.add('hidden');
    progressSection.classList.remove('hidden');

    // Fresh progress bar for analysis phase
    progressLog.innerHTML = '';
    setProgress(0, '开始处理...', '镜头 ' + (s + 1) + ' ~ ' + (e + 1) + '（共 ' + (e - s + 1) + ' 个）');
    fetch('/api/commit-range', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: currentJobId, startShot: s, endShot: e, customPrompt: getPromptHistory().join('\n') }),
    }).then(r => r.json()).then(data => {
      if (data.error) { showError(data.error); return; }
      saveSession(currentJobId, 'extracting');
      setToolbar([{type:'history'},{text:'返回首页',onClick:resetToUpload}]);
      // Reset log view for fresh analysis phase
      progressLog.innerHTML = '';
      pollJob(currentJobId);
    }).catch(e => showError(e.message));
  });

  // ── Toolbar ──

  function getJobHistory() {
    try { return JSON.parse(localStorage.getItem('jobHistory') || '[]'); } catch { return []; }
  }

  function addToHistory(jobId) {
    let h = getJobHistory().filter(id => id !== jobId);
    h.unshift(jobId);
    if (h.length > 10) h = h.slice(0, 10);
    localStorage.setItem('jobHistory', JSON.stringify(h));
  }

  function removeFromHistory(jobId) {
    const h = getJobHistory().filter(id => id !== jobId);
    localStorage.setItem('jobHistory', JSON.stringify(h));
    deleteRecent(jobId);
  }

  function loadJobList() {
    return fetch('/api/jobs').then(r => r.json()).catch(() => []);
  }

  function setToolbar(buttons) {
    headerToolbar.innerHTML = '';
    buttons.forEach(def => {
      if (def.type === 'history') {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:relative';
        const btn = document.createElement('button');
        btn.textContent = '📋 历史';
        btn.className = 'tb-btn';
        const dropdown = document.createElement('div');
        dropdown.style.cssText = 'position:absolute;top:100%;right:0;margin-top:4px;min-width:280px;max-width:360px;background:#1a1d27;border:1px solid #2a2d3a;border-radius:8px;padding:4px 0;z-index:100;display:none;max-height:360px;overflow-y:auto;box-shadow:0 4px 16px rgba(0,0,0,0.4)';

        const buildDropdown = async () => {
          dropdown.innerHTML = '<div style="padding:10px 14px;color:#8b8fa7;font-size:0.78rem">加载中...</div>';
          const jobs = await loadJobList();

          if (jobs.length === 0) {
            dropdown.innerHTML = '<div style="padding:10px 14px;color:#8b8fa7;font-size:0.8rem">暂无历史记录</div>';
            return;
          }

          const statusMap = {done:'✅',awaiting_range:'⏸',detecting_scenes:'🔍',extracting:'📸',extracting_frames:'📸',extracting_thumbs:'📸',analyzing:'🤖',downloading:'⬇',error:'❌',received:'📥'};

          dropdown.innerHTML = '';
          jobs.forEach(job => {
            const isCurrent = job.jobId === currentJobId;
            const icon = statusMap[job.status] || '⏳';
            const name = job.videoName || job.jobId.slice(0,8);
            const summary = job.shotRange ? ` (${job.shotRange})` : job.totalShots ? ` (${job.totalShots}镜头)` : '';

            const row = document.createElement('div');
            row.style.cssText = 'padding:8px 14px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:0.8rem';
            if (isCurrent) row.style.background = 'rgba(74,108,247,0.1)';

            const left = document.createElement('div');
            left.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e4e6f0';
            left.textContent = (isCurrent ? '● ' : '') + icon + ' ' + name + summary;

            const del = document.createElement('button');
            del.textContent = '✕';
            del.style.cssText = 'background:none;border:none;color:#8b8fa7;cursor:pointer;font-size:0.9rem;padding:0 4px;flex-shrink:0';
            del.title = '删除此记录';
            del.addEventListener('click', (e) => {
              e.stopPropagation();
              removeFromHistory(job.jobId);
              buildDropdown();
            });

            row.addEventListener('mouseenter', () => { if (!isCurrent) row.style.background = '#242734'; });
            row.addEventListener('mouseleave', () => { if (!isCurrent) row.style.background = ''; });
            row.addEventListener('click', () => {
              dropdown.style.display = 'none';
              if (job.jobId === currentJobId) return;
              switchToJob(job.jobId);
            });

            row.appendChild(left);
            row.appendChild(del);
            dropdown.appendChild(row);
          });
        };

        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (dropdown.style.display === 'block') { dropdown.style.display = 'none'; return; }
          buildDropdown();
          dropdown.style.display = 'block';
        });

        document.addEventListener('click', () => { dropdown.style.display = 'none'; });
        wrap.appendChild(btn);
        wrap.appendChild(dropdown);
        headerToolbar.appendChild(wrap);
      } else {
        const btn = document.createElement('button');
        btn.textContent = def.text;
        btn.className = 'tb-btn' + (def.primary ? ' primary' : '');
        btn.addEventListener('click', def.onClick);
        headerToolbar.appendChild(btn);
      }
    });
  }

  async function switchToJob(jobId) {
    // Save current state, then load the other job
    uploadSection.classList.add('hidden');
    progressSection.classList.remove('hidden');
    setProgress(0, '加载中...', '');
    clearToolbar();

    try {
      const res = await fetch('/api/jobs/' + jobId);
      if (!res.ok) {
        // Job expired on server — show as expired in recent list, don't delete
        progressSection.classList.add('hidden');
        errorSection.classList.remove('hidden');
        errorMessage.textContent = '该任务已在服务端过期（重启后内存清空），无法恢复。请重新上传视频分析。';
        setToolbar([{type:'history'},{text:'返回首页',onClick:resetToUpload}]);
        return;
      }
      const job = await res.json();
      currentJobId = job.jobId;

      if (job.status === 'awaiting_range' && job.sceneData) {
        progressSection.classList.add('hidden');
        showRangeSelector(job.sceneData);
      } else if (job.status === 'done' && job.results) {
        progressSection.classList.add('hidden');
        showResults(job);
      } else if (job.status === 'error') {
        showError(job.error || '处理失败');
      } else {
        // In progress
        setToolbar([{type:'history'},{text:'返回首页',onClick:resetToUpload}]);
        startDetectAnim();
        pollJob(jobId);
      }
    } catch {
      removeFromHistory(jobId);
      resetToUpload();
    }
  }

  function clearToolbar() { headerToolbar.innerHTML = ''; }
  function handleFile(file) {
    uploadError.classList.add('hidden');
    const allowed = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!allowed.includes(ext)) { showUploadError('不支持的文件格式：' + ext + '，支持 ' + allowed.join(', ')); return; }
    if (file.size > 2 * 1024 * 1024 * 1024) { showUploadError('文件过大，最大支持 2GB'); return; }
    startUpload(file);
  }

  function showUploadError(msg) { uploadError.textContent = msg; uploadError.classList.remove('hidden'); }

  function startUpload(file) {
    uploadSection.classList.add('hidden'); resultsSection.classList.add('hidden'); errorSection.classList.add('hidden');
    progressSection.classList.remove('hidden');
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    setProgress(0, '上传中...', `文件: ${file.name} (${sizeMB} MB)`);
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const upMB = (e.loaded / 1024 / 1024).toFixed(1), totMB = (e.total / 1024 / 1024).toFixed(1);
        if (e.loaded >= e.total) {
          setProgress(12, '文件已接收，准备分析...', totMB + ' MB — 等待服务端确认');
        } else {
          setProgress(Math.round((e.loaded / e.total) * 12), '上传中...', '已传输 ' + upMB + ' / ' + totMB + ' MB');
        }
      }
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { const d = JSON.parse(xhr.responseText); saveSession(d.jobId, 'received'); addToHistory(d.jobId); setToolbar([{type:'history'},{text:'返回首页',onClick:resetToUpload}]); startDetectAnim(); pollJob(d.jobId); } catch { showError('解析响应失败'); }
      } else {
        try { showError(JSON.parse(xhr.responseText).error || '上传失败 (HTTP ' + xhr.status + ')'); } catch { showError('上传失败 (HTTP ' + xhr.status + ')'); }
      }
    });
    xhr.addEventListener('error', () => showError('网络错误'));
    xhr.addEventListener('abort', () => showError('上传已取消'));
    const fd = new FormData(); fd.append('video', file);
    xhr.open('POST', '/api/analyze');
    xhr.send(fd);
  }

  // ── URL handling ──
  function handleUrlSubmit() {
    const url = urlInput.value.trim(); uploadError.classList.add('hidden');
    if (!url) { showUploadError('请输入视频链接'); return; }
    try { new URL(url); } catch { showUploadError('无效的链接格式'); return; }
    startUrlAnalysis(url);
  }

  async function startUrlAnalysis(url) {
    uploadSection.classList.add('hidden'); resultsSection.classList.add('hidden'); errorSection.classList.add('hidden');
    progressSection.classList.remove('hidden');
    setProgress(0, '正在下载视频...', '');
    urlSubmitBtn.disabled = true; urlSubmitBtn.classList.add('btn-loading');
    try {
      const res = await fetch('/api/analyze-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || '请求失败 (HTTP ' + res.status + ')'); }
      const { jobId } = await res.json();
      saveSession(jobId, 'downloading'); startDetectAnim(); pollJob(jobId);
    } catch (e) { showError(e.message); urlSubmitBtn.disabled = false; urlSubmitBtn.classList.remove('btn-loading'); }
  }

  // ── Polling ──
  function pollJob(jobId) {
    if (pollTimer) clearInterval(pollTimer);
    let lastLogLen = 0;
    let phase = 'unknown'; // 'detect' or 'analyze' — tracks which bar we're on
    pollTimer = setInterval(async () => {
      try {
        const res = await fetch('/api/jobs/' + jobId);
        if (!res.ok) throw new Error('获取任务状态失败');
        const job = await res.json();

        // Show new backend log lines
        if (job.log && job.log.length > lastLogLen) {
          for (let i = lastLogLen; i < job.log.length; i++) {
            const line = document.createElement('div');
            line.className = 'log-line';
            line.textContent = job.log[i];
            progressLog.appendChild(line);
          }
          lastLogLen = job.log.length;
          progressLog.scrollTop = progressLog.scrollHeight;
        }

        switch (job.status) {
          // ── Detection phase bar ──
          case 'received': setProgress(3, '已接收', ''); break;
          case 'downloading': setProgress(3, '下载视频...', (job.progress || {}).downloaded ? job.progress.downloaded : ''); break;
          case 'detecting_scenes': break; // animated by startDetectAnim
          case 'extracting_thumbs':
            phase = 'detect';
            stopDetectAnim();
            { const p = job.progress; setProgress(10 + Math.round((p.current / (p.total || 1)) * 88), '抽取缩略图...', p.current + ' / ' + p.total); }
            break;
          case 'awaiting_range':
            saveSession(job.jobId, 'awaiting_range');
            stopDetectAnim();
            clearInterval(pollTimer); pollTimer = null;
            progressSection.classList.add('hidden');
            if (job.sceneData) showRangeSelector(job.sceneData);
            break;

          // ── Analysis phase bar (resets to 0 when user confirms range) ──
          case 'extracting': case 'extracting_frames':
            stopDetectAnim();
            { const p = job.progress; setProgress(Math.round((p.current / (p.total || 1)) * 15), '抽取音频片段...', p.current + ' / ' + p.total); }
            break;
          case 'analyzing':
            { const p = job.progress; setProgress(15 + Math.round((p.current / (p.total || 1)) * 82), 'AI 分析画面与台词...', p.current + ' / ' + p.total); }
            break;
          case 'done':
            saveSession(job.jobId, 'done');
            if (job.results) saveRecent(job.jobId, job.results.videoFile || '未知', job.results.totalShots);
            stopDetectAnim();
            clearInterval(pollTimer); pollTimer = null;
            setProgress(100, '分析完成！', '');
            setTimeout(() => showResults(job), 300);
            break;
          case 'error':
            stopDetectAnim();
            clearInterval(pollTimer); pollTimer = null;
            showError(job.error || '处理失败');
            break;
        }
      } catch (err) {
        stopDetectAnim();
        clearInterval(pollTimer); pollTimer = null;
        showError(err.message);
      }
    }, 1500);
  }

  function setProgress(pct, label, detail) {
    progressBar.style.width = pct + '%';
    progressLabel.textContent = label;
    progressDetail.textContent = detail;
  }

  // ── Animated progress for detect phase ──
  function startDetectAnim() {
    stopDetectAnim();
    progressBar.classList.add('breathing');
    let tick = 0; const start = Date.now();
    progressAnimTimer = setInterval(() => {
      tick++;
      const elapsed = Math.floor((Date.now() - start) / 1000);
      // Slow creep 3% → 12% over ~60s, never backward
      const pct = Math.min(3 + tick * 0.15, 12);
      setProgress(Math.round(pct), '检测镜头切换' + '.'.repeat((tick % 3) + 1), '已耗时 ' + elapsed + ' 秒');
    }, 300);
  }

  function stopDetectAnim() {
    progressBar.classList.remove('breathing');
    if (progressAnimTimer) { clearInterval(progressAnimTimer); progressAnimTimer = null; }
  }

  // ── Range selector ──
  function showRangeSelector(sceneData) {
    const total = sceneData.totalShots;
    rangeCount.textContent = total;
    [rangeStart, rangeStartNum].forEach(el => { el.min = 1; el.max = total; el.value = 1; });
    [rangeEnd, rangeEndNum].forEach(el => { el.min = 1; el.max = total; el.value = Math.min(total, 10); });
    rangeSelectedCount.textContent = Math.min(total, 10);

    // Build filmstrip
    filmstrip.innerHTML = '';
    const thumbBase = sceneData.thumbBase || '/api/frames/' + currentJobId + '/';
    for (let i = 0; i < total; i++) {
      const item = document.createElement('div');
      item.className = 'filmstrip-item';
      item.dataset.index = i + 1;
      item.innerHTML =
        '<img src="' + thumbBase + i + '" alt="镜头 ' + (i + 1) + '" loading="lazy"' +
        ' onerror="this.outerHTML=\'<div style=width:120px;height:68px;display:flex;align-items:center;justify-content:center;background:var(--border);color:var(--text-secondary);font-size:0.75rem;border-radius:4px>↓</div>\'">' +
        '<div class="filmstrip-item-label">镜头 ' + (i + 1) + '</div>';
      item.addEventListener('click', () => {
        rangeStart.value = i + 1;
        rangeEnd.value = i + 1;
        updateRangeFill();
      });
      filmstrip.appendChild(item);
    }

    updateRangeFill();
    rangeSection.classList.remove('hidden');
    rangeSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const btns = [{type:'history'},{text:'返回首页',onClick:resetToUpload}];
    if (cameFromResults) {
      btns.splice(1, 0, {text:'← 返回结果',primary:true,onClick:backToResults});
    }
    setToolbar(btns);
  }

  function backToResults() {
    rangeSection.classList.add('hidden');
    cameFromResults = false;
    fetch('/api/jobs/' + currentJobId).then(r => r.json()).then(job => {
      if (job.results) showResults(job);
      else resetToUpload();
    }).catch(() => resetToUpload());
  }

  function updateFilmstrip(startIdx, endIdx) {
    const items = filmstrip.querySelectorAll('.filmstrip-item');
    items.forEach(item => {
      const idx = parseInt(item.dataset.index);
      if (idx >= startIdx && idx <= endIdx) {
        item.classList.add('selected');
      } else {
        item.classList.remove('selected');
      }
    });
  }
  function showResults(job) {
    progressSection.classList.add('hidden');
    resultsSection.classList.remove('hidden');
    const r = job.results;
    resultsTitle.textContent = r.videoFile || '分析结果';
    resultsMeta.textContent = r.shotRange ? `镜头 ${r.shotRange}（共 ${r.totalShots} 个）` : `${r.totalShots} 个镜头`;
    resultsMeta.textContent += r.hasAudio ? ' · 含台词识别' : '';
    if (r.duration) resultsMeta.textContent += ' · ' + formatDuration(r.duration);

    shotsTimeline.innerHTML = '';
    r.shots.forEach((shot) => {
      const card = document.createElement('div');
      card.className = 'shot-card';
      const time = formatTimecode(shot.startTime) + ' - ' + formatTimecode(shot.endTime);
      let html = '<div class="shot-thumb"><img src="' + shot.framePath + '" alt="Shot ' + (shot.index + 1) + '" loading="lazy"><span class="shot-time-badge">' + time + '</span></div>';
      html += '<div class="shot-body"><div class="shot-index">镜头 ' + (shot.index + 1) + ' · ' + formatDuration(shot.duration) + '</div>';
      html += '<div class="shot-section-label">画面</div><p class="shot-desc">' + escapeHtml(shot.description) + '</p>';
      if (shot.audioDescription) {
        html += '<div class="shot-section-label audio-label">台词</div><p class="shot-audio-desc">' + escapeHtml(shot.audioDescription) + '</p>';
      } else {
        html += '<div class="shot-section-label audio-label" style="opacity:0.5">台词</div><p class="shot-audio-desc" style="opacity:0.5;color:var(--text-secondary);font-style:italic">无台词</p>';
      }
      html += '</div>';
      card.innerHTML = html;
      card.querySelector('.shot-thumb').addEventListener('click', () => openLightbox(shot.framePath));
      shotsTimeline.appendChild(card);
    });
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

    setToolbar([
      {type:'history'},
      {text:'分析其他镜头',onClick:backToRange},
      {text:'分析新视频',primary:true,onClick:resetToUpload},
    ]);

    // Remember for home page
    if (r) saveRecent(job.jobId, r.videoFile || '未知', r.totalShots);
  }

  function backToRange() {
    resultsSection.classList.add('hidden');
    cameFromResults = true;

    fetch('/api/jobs/' + currentJobId).then(r => r.json()).then(job => {
      if (!job.sceneData) { resetToUpload(); return; }

      // Check if frames are missing — if so, re-extract
      const testImg = new Image();
      testImg.onload = () => showRangeSelector(job.sceneData);
      testImg.onerror = () => {
        // Frames missing, trigger re-extraction
        progressSection.classList.remove('hidden');
        setProgress(0, '抽取缩略图...', '');
        setToolbar([{type:'history'},{text:'返回首页',onClick:resetToUpload}]);
        fetch('/api/re-extract-frames/' + currentJobId, { method: 'POST' })
          .then(r => r.json()).then(data => {
            if (data.error) { showError(data.error); return; }
            saveSession(currentJobId, 'detecting_scenes');
            startDetectAnim();
            pollJob(currentJobId);
          }).catch(e => showError(e.message));
      };
      testImg.src = (job.sceneData.thumbBase || '/api/frames/' + currentJobId + '/') + '0';
    }).catch(() => resetToUpload());
  }

  // ── Copy / Export ──
  function copyAllDescriptions() {
    const lines = [...shotsTimeline.querySelectorAll('.shot-card')].map(card => {
      const t = card.querySelector('.shot-time-badge'), d = card.querySelector('.shot-desc'), a = card.querySelector('.shot-audio-desc');
      let text = '[' + (t ? t.textContent : '') + ']\n' + (d ? d.textContent : '');
      if (a) text += '\n[台词] ' + a.textContent;
      return text;
    });
    navigator.clipboard.writeText(lines.join('\n\n')).then(() => {
      [copyAllBtn, copyAllBtn2].forEach(b => { b.textContent = '已复制！'; b.classList.add('copied'); setTimeout(() => { b.textContent = '复制全部描述'; b.classList.remove('copied'); }, 2000); });
    }).catch(() => alert('复制失败'));
  }

  function exportToFile() {
    // Use server-side export to get proper UTF-8 Content-Disposition for Chinese filenames
    if (!currentJobId) return alert('任务已过期，请重新分析');
    const link = document.createElement('a');
    link.href = '/api/export/' + currentJobId;
    link.download = ''; // server sets the filename via Content-Disposition
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // ── Clear cache ──
  function clearCache() {
    if (!confirm('确定要清除所有缓存吗？\n\n将删除所有已上传的视频、分析结果和任务记录。')) return;
    clearCacheBtn.textContent = '清理中...'; clearCacheBtn.disabled = true;
    fetch('/api/clear-cache', { method: 'POST' }).then(r => r.json()).then(data => {
      const parts = []; if (data.results) Object.values(data.results).forEach(v => parts.push(v));
      localStorage.removeItem('recentJobs');
      recentAnalyses.classList.add('hidden');
      alert('清理完成：\n' + parts.join('\n'));
    }).catch(e => alert('清理失败：' + e.message)).finally(() => { clearCacheBtn.textContent = '清除缓存'; clearCacheBtn.disabled = false; });
  }

  // ── Lightbox ──
  function openLightbox(src) { lightboxImg.src = src; lightbox.classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
  function closeLightbox() { lightbox.classList.add('hidden'); document.body.style.overflow = ''; }

  // ── Error ──
  function showError(msg) { stopDetectAnim(); progressSection.classList.add('hidden'); rangeSection.classList.add('hidden'); errorSection.classList.remove('hidden'); errorMessage.textContent = msg; }
  function resetToUpload() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    stopDetectAnim();
    clearSession();
    location.reload();
  }

  // ── Utilities ──
  function formatTimecode(s) { const m = Math.floor(s / 60), sec = Math.floor(s % 60); return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0'); }
  function formatDuration(s) { if (s < 60) return Math.round(s) + '秒'; return Math.floor(s / 60) + '分' + Math.round(s % 60) + '秒'; }
  function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
})();

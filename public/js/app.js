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
  const recentDeleteBtn = document.getElementById('recentDeleteBtn');
  const recentManageDoneBtn = document.getElementById('recentManageDoneBtn');
  const recentPerPage = document.getElementById('recentPerPage');
  const recentSortMode = document.getElementById('recentSortMode');
  const recentPagination = document.getElementById('recentPagination');

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
  const rangeConfirmBtn = document.getElementById('rangeConfirmBtn');
  const filmstrip = document.getElementById('filmstrip');

  const resultsSection = document.getElementById('resultsSection');
  const resultsTitle = document.getElementById('resultsTitle');
  const resultsMeta = document.getElementById('resultsMeta');
  const shotsTimeline = document.getElementById('shotsTimeline');
  const resultsTopPager = document.getElementById('resultsTopPager');
  const resultsBottomPager = document.getElementById('resultsBottomPager');
  const copyAllBtn = document.getElementById('copyAllBtn');
  const exportBtn = document.getElementById('exportBtn');
  const headerToolbar = document.getElementById('headerToolbar');

  const errorSection = document.getElementById('errorSection');
  const errorMessage = document.getElementById('errorMessage');
  const retryBtn = document.getElementById('retryBtn');

  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxVideo = document.getElementById('lightboxVideo');
  const lightboxClose = document.getElementById('lightboxClose');

  let pollTimer = null;
  let progressAnimTimer = null;
  let currentJobId = null;
  let currentJobStatus = null;
  let selectedSet = new Set();
  let cameFromResults = false;
  let manageMode = false;
  let recentPage = 0;
  let recentPerPageCount = 20;
  let allRecents = [];

  // ── Config panel ──
  const configToggle = document.getElementById('configToggle');
  const configBody = document.getElementById('configBody');
  const cfgVisionSave = document.getElementById('cfgVisionSave');
  const cfgAudioSave = document.getElementById('cfgAudioSave');
  const configStatus = document.getElementById('configStatus');
  function setConfigStatus(text, cls) {
    if (!configStatus) return;
    configStatus.textContent = text;
    if (cls != null) configStatus.className = cls;
  }
  const cfgCustomVision = document.getElementById('cfgVisionProviderCustom');
  const cfgCustomAudio = document.getElementById('cfgAudioProviderCustom');

  const cfgFields = {
    VISION_PROVIDER: document.getElementById('cfgVisionProvider'),
    VISION_BASE_URL: document.getElementById('cfgVisionBaseUrl'),
    VISION_API_KEY: document.getElementById('cfgVisionApiKey'),
    VISION_MODEL: document.getElementById('cfgVisionModel'),
    AUDIO_PROVIDER: document.getElementById('cfgAudioProvider'),
    AUDIO_BASE_URL: document.getElementById('cfgAudioBaseUrl'),
    AUDIO_API_KEY: document.getElementById('cfgAudioApiKey'),
    AUDIO_MODEL: document.getElementById('cfgAudioModel'),
    VISION_CONCURRENCY: document.getElementById('cfgVisionConcurrency'),
    VISION_MAX_TOKENS: document.getElementById('cfgVisionMaxTokens'),
    AUDIO_CONCURRENCY: document.getElementById('cfgAudioConcurrency'),
  };

  // Resolve effective provider value (custom input or select)
  function getProviderValue(selectEl, customEl) {
    return selectEl.value === '__custom__' ? customEl.value.trim() || '__custom__' : selectEl.value;
  }

  function toggleCustomInput(selectEl, customEl) {
    const isCustom = selectEl.value === '__custom__';
    customEl.classList.toggle('hidden', !isCustom);
    if (isCustom) customEl.focus();
  }
  cfgFields.VISION_PROVIDER.addEventListener('change', function () {
    toggleCustomInput(this, cfgCustomVision);
    const preset = VISION_PRESETS[this.value];
    if (preset) {
      cfgFields.VISION_BASE_URL.value = preset.baseUrl || '';
      cfgFields.VISION_MODEL.value = preset.model || '';
    }
  });
  cfgFields.AUDIO_PROVIDER.addEventListener('change', function () {
    toggleCustomInput(this, cfgCustomAudio);
    const preset = AUDIO_PRESETS[this.value];
    if (preset) {
      cfgFields.AUDIO_BASE_URL.value = preset.baseUrl || '';
      cfgFields.AUDIO_MODEL.value = preset.model || '';
    }
  });

  // Build a flat payload resolving custom provider inputs
  function buildConfigPayload() {
    const p = {};
    Object.keys(cfgFields).forEach(k => {
      if (k === 'VISION_PROVIDER') p[k] = getProviderValue(cfgFields.VISION_PROVIDER, cfgCustomVision);
      else if (k === 'AUDIO_PROVIDER') p[k] = getProviderValue(cfgFields.AUDIO_PROVIDER, cfgCustomAudio);
      else p[k] = cfgFields[k].value;
    });
    return p;
  }

  function loadConfigFromLocal() {
    try {
      const saved = JSON.parse(localStorage.getItem('appConfig') || '{}');
      Object.keys(cfgFields).forEach(k => {
        if (saved[k] !== undefined && saved[k] !== null && saved[k] !== '') {
          cfgFields[k].value = saved[k];
        }
      });
      // Restore custom provider inputs
      if (saved.VISION_PROVIDER && !VISION_PRESETS[saved.VISION_PROVIDER]) {
        cfgFields.VISION_PROVIDER.value = '__custom__';
        cfgCustomVision.value = saved.VISION_PROVIDER;
        cfgCustomVision.classList.remove('hidden');
      }
      if (saved.AUDIO_PROVIDER && !AUDIO_PRESETS[saved.AUDIO_PROVIDER]) {
        cfgFields.AUDIO_PROVIDER.value = '__custom__';
        cfgCustomAudio.value = saved.AUDIO_PROVIDER;
        cfgCustomAudio.classList.remove('hidden');
      }
    } catch {}
  }

  function saveConfigToLocal() {
    const payload = buildConfigPayload();
    localStorage.setItem('appConfig', JSON.stringify(payload));
    return payload;
  }

  configToggle.addEventListener('click', () => {
    configBody.classList.toggle('hidden');
    if (!configBody.classList.contains('hidden')) {
      visionSnapshot = fieldSnap('VISION');
      audioSnapshot = fieldSnap('AUDIO');
      refreshBtns();
      configToggle.textContent = '⚙ 收起配置';
    } else {
      configToggle.textContent = '⚙ 接口配置';
    }
  });

  // Initial state — panel starts expanded
  configToggle.textContent = '⚙ 收起配置';

  // ── Per-panel save + dirty tracking ──
  const VISION_FIELD_KEYS = ['VISION_PROVIDER', 'VISION_BASE_URL', 'VISION_API_KEY', 'VISION_MODEL', 'VISION_CONCURRENCY', 'VISION_MAX_TOKENS'];
  const AUDIO_FIELD_KEYS = ['AUDIO_PROVIDER', 'AUDIO_BASE_URL', 'AUDIO_API_KEY', 'AUDIO_MODEL', 'AUDIO_CONCURRENCY'];

  let visionSnapshot = '';
  let audioSnapshot = '';

  function fieldSnap(type) {
    const keys = type === 'VISION' ? VISION_FIELD_KEYS : AUDIO_FIELD_KEYS;
    const extra = type === 'VISION' ? cfgCustomVision.value : cfgCustomAudio.value;
    return keys.map(k => cfgFields[k].value).join('|') + '|' + extra;
  }

  function isDirty(type) {
    return fieldSnap(type) !== (type === 'VISION' ? visionSnapshot : audioSnapshot);
  }

  function setBtnClean(btn) {
    btn.classList.remove('dirty');
    btn.textContent = '✓ 已保存';
    btn.disabled = true;
  }

  function setBtnDirty(btn) {
    btn.classList.add('dirty');
    btn.textContent = btn === cfgVisionSave ? '保存视觉配置' : '保存音频配置';
    btn.disabled = false;
  }

  function refreshBtns() {
    isDirty('VISION') ? setBtnDirty(cfgVisionSave) : setBtnClean(cfgVisionSave);
    isDirty('AUDIO') ? setBtnDirty(cfgAudioSave) : setBtnClean(cfgAudioSave);
  }

  // Hook field changes → refresh buttons
  [...VISION_FIELD_KEYS, ...AUDIO_FIELD_KEYS].forEach(k => {
    cfgFields[k].addEventListener('input', refreshBtns);
    cfgFields[k].addEventListener('change', refreshBtns);
  });
  cfgCustomVision.addEventListener('input', refreshBtns);
  cfgCustomAudio.addEventListener('input', refreshBtns);

  // Save & sync snapshot
  async function savePanel(type) {
    const btn = type === 'VISION' ? cfgVisionSave : cfgAudioSave;
    btn.disabled = true;
    btn.textContent = '保存中...';
    try {
      savePreset(type);
      saveConfigToLocal();
      const payload = buildConfigPayload();
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const result = await res.json();
      setConfigStatus('✓ 已生效' + (result.active ? ' — ' + result.active.VISION_MODEL + ' / ' + result.active.AUDIO_MODEL : ''), 'config-status');
      // Update snapshot so the button becomes clean
      if (type === 'VISION') visionSnapshot = fieldSnap('VISION');
      else audioSnapshot = fieldSnap('AUDIO');
      setBtnClean(btn);
    } catch (e) {
      setConfigStatus('✕ ' + e.message, 'config-status error');
      btn.disabled = false;
    }
  }

  cfgVisionSave.addEventListener('click', () => savePanel('VISION'));
  cfgAudioSave.addEventListener('click', () => savePanel('AUDIO'));

  // Provider presets — auto-fill Base URL & Model when switching provider
  const VISION_PRESETS = {
    dashscope:  { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-max' },
    openai:     { baseUrl: 'https://api.openai.com/v1',                     model: 'gpt-4o' },
    anthropic:  { baseUrl: 'https://api.anthropic.com/v1',                  model: 'claude-sonnet-4-20250514' },
    google:     { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' },
    custom:     { baseUrl: '', model: '' },
  };
  const AUDIO_PRESETS = {
    dashscope:  { baseUrl: 'https://dashscope.aliyuncs.com', model: 'qwen3-asr-flash' },
    openai:     { baseUrl: 'https://api.openai.com/v1',       model: 'whisper-1' },
    custom:     { baseUrl: '', model: '' },
    none:       { baseUrl: '', model: '' },
  };

  // ── Config presets: separate vision / audio chips ──
  const cfgVisionPresets = document.getElementById('cfgVisionPresets');
  const cfgAudioPresets = document.getElementById('cfgAudioPresets');

  function getPresets(type) {
    try { return JSON.parse(localStorage.getItem('pre_' + type) || '[]'); } catch { return []; }
  }
  function setPresets(type, arr) {
    localStorage.setItem('pre_' + type, JSON.stringify(arr));
  }
  async function savePresetsToServer() {
    try {
      const data = {
        VISION: getPresets('VISION').map(p => { const c={...p}; delete c._l; delete c._t; return c; }),
        AUDIO: getPresets('AUDIO').map(p => { const c={...p}; delete c._l; delete c._t; return c; }),
      };
      await fetch('/api/config-presets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    } catch {}
  }
  async function loadPresetsFromServer() {
    try {
      const res = await fetch('/api/config-presets');
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.VISION && Array.isArray(data.VISION)) {
        const enr = data.VISION.map((p,i) => ({ ...p, _l: (p.PROVIDER||'?').slice(0,12)+'/'+(p.MODEL||'').slice(0,20), _t: Date.now()-i*1000 }));
        setPresets('VISION', enr);
      }
      if (data && data.AUDIO && Array.isArray(data.AUDIO)) {
        const enr = data.AUDIO.map((p,i) => ({ ...p, _l: (p.PROVIDER||'?').slice(0,12)+'/'+(p.MODEL||'').slice(0,20), _t: Date.now()-i*1000 }));
        setPresets('AUDIO', enr);
      }
      renderPresets('VISION');
      renderPresets('AUDIO');
    } catch {}
  }

  // Build a single-side preset from current form values
  function buildPreset(type) {
    if (type === 'VISION') return {
      PROVIDER: getProviderValue(cfgFields.VISION_PROVIDER, cfgCustomVision),
      BASE_URL: cfgFields.VISION_BASE_URL.value,
      API_KEY: cfgFields.VISION_API_KEY.value,
      MODEL: cfgFields.VISION_MODEL.value,
      CONCURRENCY: cfgFields.VISION_CONCURRENCY.value,
      MAX_TOKENS: cfgFields.VISION_MAX_TOKENS.value,
    };
    return {
      PROVIDER: getProviderValue(cfgFields.AUDIO_PROVIDER, cfgCustomAudio),
      BASE_URL: cfgFields.AUDIO_BASE_URL.value,
      API_KEY: cfgFields.AUDIO_API_KEY.value,
      MODEL: cfgFields.AUDIO_MODEL.value,
      CONCURRENCY: cfgFields.AUDIO_CONCURRENCY.value,
    };
  }

  function savePreset(type) {
    const preset = buildPreset(type);
    preset._l = (preset.PROVIDER||'?').slice(0,12) + '/' + (preset.MODEL||'').slice(0,20);
    preset._t = Date.now();
    const key = type === 'VISION' ? (preset.PROVIDER+'|||'+preset.MODEL) : (preset.PROVIDER+'|||'+preset.MODEL);
    let arr = getPresets(type).filter(p => (p.PROVIDER+'|||'+p.MODEL) !== key);
    arr.unshift(preset);
    if (arr.length > 6) arr = arr.slice(0, 6);
    setPresets(type, arr);
    savePresetsToServer();
    renderPresets(type);
  }

  async function deletePreset(type, i) {
    let arr = getPresets(type); arr.splice(i, 1);
    setPresets(type, arr);
    await savePresetsToServer();
    renderPresets(type);
  }

  function applyPreset(type, i) {
    const preset = getPresets(type)[i]; if (!preset) return;
    const prefix = type === 'VISION' ? 'VISION' : 'AUDIO';
    if (type === 'VISION') {
      if (preset.PROVIDER && VISION_PRESETS[preset.PROVIDER]) {
        cfgFields.VISION_PROVIDER.value = preset.PROVIDER;
        cfgCustomVision.classList.add('hidden');
      } else if (preset.PROVIDER) {
        cfgFields.VISION_PROVIDER.value = '__custom__';
        cfgCustomVision.value = preset.PROVIDER;
        cfgCustomVision.classList.remove('hidden');
      }
      if (preset.BASE_URL != null) cfgFields.VISION_BASE_URL.value = preset.BASE_URL;
      if (preset.API_KEY != null) cfgFields.VISION_API_KEY.value = preset.API_KEY;
      if (preset.MODEL != null) cfgFields.VISION_MODEL.value = preset.MODEL;
      if (preset.CONCURRENCY != null) cfgFields.VISION_CONCURRENCY.value = preset.CONCURRENCY;
      if (preset.MAX_TOKENS != null) cfgFields.VISION_MAX_TOKENS.value = preset.MAX_TOKENS;
    } else {
      if (preset.PROVIDER && AUDIO_PRESETS[preset.PROVIDER]) {
        cfgFields.AUDIO_PROVIDER.value = preset.PROVIDER;
        cfgCustomAudio.classList.add('hidden');
      } else if (preset.PROVIDER === 'none') {
        cfgFields.AUDIO_PROVIDER.value = 'none';
        cfgCustomAudio.classList.add('hidden');
      } else if (preset.PROVIDER) {
        cfgFields.AUDIO_PROVIDER.value = '__custom__';
        cfgCustomAudio.value = preset.PROVIDER;
        cfgCustomAudio.classList.remove('hidden');
      }
      if (preset.BASE_URL != null) cfgFields.AUDIO_BASE_URL.value = preset.BASE_URL;
      if (preset.API_KEY != null) cfgFields.AUDIO_API_KEY.value = preset.API_KEY;
      if (preset.MODEL != null) cfgFields.AUDIO_MODEL.value = preset.MODEL;
      if (preset.CONCURRENCY != null) cfgFields.AUDIO_CONCURRENCY.value = preset.CONCURRENCY;
    }
    setConfigStatus('✓ 已加载' + (type === 'VISION' ? '视觉' : '音频') + '预设', 'config-status');
    // Preset has changed form values → button should light up
    setBtnDirty(type === 'VISION' ? cfgVisionSave : cfgAudioSave);
  }

  function renderPresets(type) {
    const presets = getPresets(type);
    const el = type === 'VISION' ? cfgVisionPresets : cfgAudioPresets;
    if (presets.length === 0) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    el.classList.remove('hidden');
    el.innerHTML = '';
    presets.forEach((p, i) => {
      const chip = document.createElement('div');
      chip.className = 'preset-chip';
      chip.title = p.PROVIDER + '/' + p.MODEL;
      const lb = document.createElement('span'); lb.className = 'preset-chip-label'; lb.textContent = (type === 'VISION' ? '视' : '音') + (i + 1);
      const nm = document.createElement('span'); nm.className = 'preset-chip-name'; nm.textContent = p._l;
      const dl = document.createElement('span'); dl.className = 'preset-chip-del'; dl.textContent = '✕';
      dl.addEventListener('click', e => { e.stopPropagation(); deletePreset(type, i); });
      chip.addEventListener('click', () => applyPreset(type, i));
      chip.appendChild(lb); chip.appendChild(nm); chip.appendChild(dl);
      el.appendChild(chip);
    });
  }

  // ── Test connection buttons ──

  async function testConnection(endpoint, btn, resultEl, providerValue, baseUrl, apiKey, model) {
    btn.disabled = true;
    btn.textContent = '测试中...';
    resultEl.classList.add('hidden');
    resultEl.className = 'config-test-result hidden';
    try {
      const payload = {};
      if (endpoint === 'vision') {
        // Resolve provider for vision
        const vp = getProviderValue(cfgFields.VISION_PROVIDER, cfgCustomVision);
        payload.VISION_PROVIDER = vp;
        payload.VISION_BASE_URL = baseUrl.value;
        payload.VISION_API_KEY = apiKey.value;
        payload.VISION_MODEL = model.value;
      } else {
        const ap = getProviderValue(cfgFields.AUDIO_PROVIDER, cfgCustomAudio);
        payload.AUDIO_PROVIDER = ap;
        payload.AUDIO_BASE_URL = baseUrl.value;
        payload.AUDIO_API_KEY = apiKey.value;
        payload.AUDIO_MODEL = model.value;
      }

      const res = await fetch('/api/test-' + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.ok) {
        const latency = data.latency != null ? ' · ' + data.latency + 'ms' : '';
        const hint = data.hint || '';
        resultEl.textContent = '✓ 可达 (HTTP ' + data.status + latency + hint + ')';
        resultEl.className = 'config-test-result ok';
      } else {
        resultEl.textContent = '✕ ' + (data.error || 'HTTP ' + data.status);
        resultEl.className = 'config-test-result fail';
      }
    } catch (e) {
      resultEl.textContent = '✕ ' + e.message;
      resultEl.className = 'config-test-result fail';
    }
    resultEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = '测试连接';
  }

  document.getElementById('cfgVisionTest').addEventListener('click', () => {
    testConnection(
      'vision',
      document.getElementById('cfgVisionTest'),
      document.getElementById('cfgVisionTestResult'),
      cfgFields.VISION_PROVIDER, cfgFields.VISION_BASE_URL, cfgFields.VISION_API_KEY, cfgFields.VISION_MODEL
    );
  });
  document.getElementById('cfgAudioTest').addEventListener('click', () => {
    testConnection(
      'audio',
      document.getElementById('cfgAudioTest'),
      document.getElementById('cfgAudioTestResult'),
      cfgFields.AUDIO_PROVIDER, cfgFields.AUDIO_BASE_URL, cfgFields.AUDIO_API_KEY, cfgFields.AUDIO_MODEL
    );
  });

  // Load config from localStorage first (fast), then fill blanks from server
  loadConfigFromLocal();

  // Full async init: server config → fill blanks → presets → snapshots
  (async () => {
    // 1. Pull active config from server to fill any blank fields
    try {
      const serverCfg = await fetch('/api/config').then(r => r.json());
      Object.keys(cfgFields).forEach(k => {
        if (!cfgFields[k].value && serverCfg[k] && serverCfg[k] !== '***') {
          cfgFields[k].value = serverCfg[k];
        }
      });
      // Provider select: if server has a known provider, set it
      if (serverCfg.VISION_PROVIDER && VISION_PRESETS[serverCfg.VISION_PROVIDER]) {
        cfgFields.VISION_PROVIDER.value = serverCfg.VISION_PROVIDER;
        const preset = VISION_PRESETS[serverCfg.VISION_PROVIDER];
        if (!cfgFields.VISION_BASE_URL.value) cfgFields.VISION_BASE_URL.value = preset.baseUrl || '';
        if (!cfgFields.VISION_MODEL.value) cfgFields.VISION_MODEL.value = preset.model || '';
        cfgCustomVision.classList.add('hidden');
      }
      if (serverCfg.AUDIO_PROVIDER && AUDIO_PRESETS[serverCfg.AUDIO_PROVIDER]) {
        cfgFields.AUDIO_PROVIDER.value = serverCfg.AUDIO_PROVIDER;
        const preset = AUDIO_PRESETS[serverCfg.AUDIO_PROVIDER];
        if (!cfgFields.AUDIO_BASE_URL.value) cfgFields.AUDIO_BASE_URL.value = preset.baseUrl || '';
        if (!cfgFields.AUDIO_MODEL.value) cfgFields.AUDIO_MODEL.value = preset.model || '';
        cfgCustomAudio.classList.add('hidden');
      }
      saveConfigToLocal();
    } catch { /* server not ready */ }

    // 2. Load presets from server
    await loadPresetsFromServer();

    // 3. If still no presets, auto-create from current form values
    if (getPresets('VISION').length === 0 || getPresets('AUDIO').length === 0) {
      try {
        if (getPresets('VISION').length === 0) {
          const p = buildPreset('VISION');
          p._l = (p.PROVIDER||'?').slice(0,12)+'/'+(p.MODEL||'').slice(0,20);
          p._t = Date.now();
          setPresets('VISION', [p]);
        }
        if (getPresets('AUDIO').length === 0) {
          const p = buildPreset('AUDIO');
          p._l = (p.PROVIDER||'?').slice(0,12)+'/'+(p.MODEL||'').slice(0,20);
          p._t = Date.now();
          setPresets('AUDIO', [p]);
        }
        await savePresetsToServer();
      } catch {}
    }
    renderPresets('VISION');
    renderPresets('AUDIO');

    // 4. Take initial snapshots for dirty tracking AFTER all loading
    visionSnapshot = fieldSnap('VISION');
    audioSnapshot = fieldSnap('AUDIO');
    refreshBtns();
  })();

  // ── Version display ──
  fetch('/api/version').then(r => r.json()).then(v => {
    document.getElementById('versionLine').textContent = 'v' + v.version + ' ' + v.hash;
  }).catch(() => {});

  // ── Session restore ──
  const savedJobId = sessionStorage.getItem('jobId');
  const savedStatus = sessionStorage.getItem('jobStatus');
  if (savedJobId && savedStatus) {
    currentJobId = savedJobId;
    currentJobStatus = savedStatus;
    uploadSection.classList.add('hidden');
    if (savedStatus === 'awaiting_range') {
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
      progressSection.classList.add('hidden');
      rangeSection.classList.add('hidden');
      fetch('/api/jobs/' + savedJobId).then(r => {
        if (!r.ok) { resetToUpload(); showError('任务已过期，请重新上传。'); return; }
        return r.json();
      }).then(job => {
        if (!job) return;
        if (job.results) showResults(job);
        else resetToUpload();
      }).catch(() => resetToUpload());
    } else {
      progressSection.classList.remove('hidden');
      startDetectAnim();
      setToolbar([{text:'返回首页',onClick:resetToUpload}]);
      pollJob(savedJobId);
    }
  } else {
    setToolbar([]);
    renderRecentAnalyses();
    renderPromptHistory();
  }

  // ── Recent analyses with pagination ──

  function getSavedPerPage() {
    const v = parseInt(localStorage.getItem('recentPerPage'));
    return (v >= 1 && v <= 100) ? v : 20;
  }

  function getSavedSortMode() {
    return localStorage.getItem('recentSortMode') || 'mtime';
  }

  async function renderRecentAnalyses() {
    try {
      // 1. Load localStorage recents
      let stored = JSON.parse(localStorage.getItem('recentJobs') || '[]');

      // 2. Sync from server — discover missing jobs and get timestamps
      const serverJobs = await fetch('/api/jobs').then(r => r.json()).catch(() => []);
      const serverMap = new Map();
      serverJobs.forEach(j => {
        serverMap.set(j.jobId, {
          jobId: j.jobId,
          name: j.videoName || '未知视频',
          shotCount: j.totalShots || 0,
          status: j.status,
          shotRange: j.shotRange || null,
          mode: j.mode || null,
          createdAt: j.createdAt || 0,
          savedAt: j.savedAt || j.createdAt || 0,
        });
      });

      // Merge: add server jobs missing from localStorage
      const storedIds = new Set(stored.map(r => r.jobId));
      serverJobs.forEach(j => {
        if (!storedIds.has(j.jobId)) {
          stored.push({
            jobId: j.jobId,
            name: j.videoName || '未知视频',
            shotCount: j.totalShots || 0,
            time: j.createdAt || Date.now(),
          });
        }
      });

      // Enrich stored entries with server timestamps and real-time status
      stored = stored.map(r => {
        const srv = serverMap.get(r.jobId);
        const alive = !!srv;
        const createdAt = srv ? srv.createdAt : (r.time || 0);
        const mtime = srv ? srv.savedAt : (r.time || 0);
        const status = srv ? srv.status : 'expired';
        const shotRange = srv ? srv.shotRange : null;
        return { ...r, alive, status, shotRange, mode: srv ? srv.mode : null, createdAt, mtime: Math.max(mtime, createdAt) };
      });

      // Remove dead entries (no server record) — not saving yet but filter from display
      // Actually keep them to show "expired" status
      allRecents = stored;

      if (stored.length === 0) {
        recentAnalyses.classList.add('hidden');
        return;
      }

      // Sync cleaned list back to localStorage
      const clean = stored.filter(r => r.alive).map(r => ({
        jobId: r.jobId, name: r.name, shotCount: r.shotCount, time: r.createdAt
      }));
      localStorage.setItem('recentJobs', JSON.stringify(clean));

      recentPerPageCount = getSavedPerPage();
      recentPerPage.value = recentPerPageCount;
      recentSortMode.value = getSavedSortMode();

      // Sort
      const sortMode = getSavedSortMode();
      const sorted = stored.slice().sort((a, b) => {
        if (sortMode === 'mtime') return (b.mtime || 0) - (a.mtime || 0);
        return (b.createdAt || 0) - (a.createdAt || 0);
      });

      const totalPages = Math.ceil(sorted.length / recentPerPageCount);
      if (recentPage >= totalPages) recentPage = totalPages - 1;
      if (recentPage < 0) recentPage = 0;

      const pageRecents = sorted.slice(recentPage * recentPerPageCount, (recentPage + 1) * recentPerPageCount);

      recentAnalyses.classList.remove('hidden');
      recentList.innerHTML = '';

      pageRecents.forEach(r => {
        const card = document.createElement('div');
        card.className = 'recent-card' + (manageMode ? ' delete-mode' : '');
        card.dataset.jobId = r.jobId;
        const thumbUrl = '/api/jobs/' + r.jobId + '/thumb';
        const displayTime = getSavedSortMode() === 'added' ? r.createdAt : r.mtime;
        card.innerHTML =
          '<input type="checkbox" class="recent-delete-check"' + (manageMode ? '' : ' style="display:none"') + '>' +
          '<img class="recent-card-thumb" src="' + thumbUrl + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' +
          '<div class="recent-card-body">' +
          '<div class="recent-card-name">' + escapeHtml(r.name || '未知视频') + '</div>' +
          '<div class="recent-card-meta">' + (r.shotCount || '?') + ' 个镜头' + (r.shotRange ? '（' + r.shotRange + '）' : '') + ' · ' + formatDate(displayTime) + '</div>' +
          (r.mode ? '<span class="mode-badge mode-badge-' + r.mode + '">' + (r.mode === 'video' ? '动态' : '单帧') + '</span>' : '') + ' ' +
          getStatusBadge(r.status) +
          '</div>';
        card.addEventListener('click', (e) => {
          if (e.target.tagName === 'INPUT') return;
          if (manageMode) {
            const cb = card.querySelector('.recent-delete-check');
            cb.checked = !cb.checked;
            updateManageSelection();
          } else if (r.alive) {
            switchToJob(r.jobId);
          } else {
            alert('该任务已在服务端过期，请重新上传视频分析。');
          }
        });
        recentList.appendChild(card);
      });

      renderPagination(totalPages);

      recentManageBtn.classList.toggle('hidden', manageMode);
      recentManageBar.classList.toggle('hidden', !manageMode);
      recentPerPage.parentElement.style.display = manageMode ? 'none' : '';
      if (manageMode) updateManageSelection();
    } catch { recentAnalyses.classList.add('hidden'); }
  }

  function renderPagination(totalPages) {
    if (totalPages <= 1) {
      recentPagination.classList.add('hidden');
      return;
    }
    recentPagination.classList.remove('hidden');
    recentPagination.innerHTML = '';

    const create = (label, page, active, disabled) => {
      const btn = document.createElement('button');
      btn.className = 'pg-btn' + (active ? ' pg-btn-active' : '');
      btn.textContent = label;
      if (disabled) btn.disabled = true;
      else btn.addEventListener('click', () => { recentPage = page; renderRecentAnalyses(); });
      return btn;
    };

    recentPagination.appendChild(create('«', 0, false, recentPage === 0));
    recentPagination.appendChild(create('‹', recentPage - 1, false, recentPage === 0));

    const pages = [];
    let start = Math.max(0, recentPage - 3);
    let end = Math.min(totalPages - 1, recentPage + 3);
    if (end - start < 6) {
      if (start === 0) end = Math.min(totalPages - 1, start + 6);
      else if (end === totalPages - 1) start = Math.max(0, end - 6);
    }
    if (start > 0) {
      pages.push(0);
      if (start > 1) pages.push('...');
    }
    for (let i = start; i <= end; i++) pages.push(i);
    if (end < totalPages - 1) {
      if (end < totalPages - 2) pages.push('...');
      pages.push(totalPages - 1);
    }

    pages.forEach(p => {
      if (p === '...') {
        const span = document.createElement('span');
        span.className = 'pg-ellipsis';
        span.textContent = '…';
        recentPagination.appendChild(span);
      } else {
        recentPagination.appendChild(create(String(p + 1), p, p === recentPage, false));
      }
    });

    recentPagination.appendChild(create('›', recentPage + 1, false, recentPage >= totalPages - 1));
    recentPagination.appendChild(create('»', totalPages - 1, false, recentPage >= totalPages - 1));
  }

  function updateManageSelection() {
    const all = recentList.querySelectorAll('.recent-delete-check');
    const checked = recentList.querySelectorAll('.recent-delete-check:checked');
    recentSelectAll.checked = all.length > 0 && checked.length === all.length;
    recentSelectAll.indeterminate = checked.length > 0 && checked.length < all.length;
    recentSelectedHint.textContent = checked.length > 0 ? '已选 ' + checked.length + ' 项' : '';
  }

  function enterManageMode() { manageMode = true; renderRecentAnalyses(); }
  function exitManageMode() { manageMode = false; renderRecentAnalyses(); }

  async function deleteSelectedRecents() {
    const checked = [].slice.call(recentList.querySelectorAll('.recent-delete-check:checked'));
    if (checked.length === 0) return;
    if (!confirm('确定要删除选中的 ' + checked.length + ' 条记录吗？\n\n这将同时清除服务端缓存（视频文件、分析结果等），不可恢复。')) return;

    const jobIds = checked.map(cb => cb.closest('.recent-card').dataset.jobId);

    let recents = JSON.parse(localStorage.getItem('recentJobs') || '[]');
    recents = recents.filter(r => jobIds.indexOf(r.jobId) === -1);
    localStorage.setItem('recentJobs', JSON.stringify(recents));

    await fetch('/api/delete-jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobIds }),
    }).catch(() => {});

    recentPage = 0;
    exitManageMode();
  }

  recentManageBtn.addEventListener('click', enterManageMode);
  recentManageDoneBtn.addEventListener('click', exitManageMode);
  recentDeleteBtn.addEventListener('click', deleteSelectedRecents);
  recentSelectAll.addEventListener('change', () => {
    const checked = recentSelectAll.checked;
    recentList.querySelectorAll('.recent-delete-check').forEach(cb => { cb.checked = checked; });
    updateManageSelection();
  });
  recentList.addEventListener('change', (e) => {
    if (e.target.classList.contains('recent-delete-check')) updateManageSelection();
  });

  recentPerPage.addEventListener('change', () => {
    recentPerPageCount = parseInt(recentPerPage.value);
    localStorage.setItem('recentPerPage', recentPerPageCount);
    recentPage = 0;
    renderRecentAnalyses();
  });

  recentSortMode.addEventListener('change', () => {
    localStorage.setItem('recentSortMode', recentSortMode.value);
    recentPage = 0;
    renderRecentAnalyses();
  });

  // ── Prompt history ──
  function getPromptHistory() {
    try { return JSON.parse(localStorage.getItem('promptHistory') || '[]'); } catch { return []; }
  }

  function getPromptPresets() {
    try { return JSON.parse(localStorage.getItem('promptPresets') || '[]'); } catch { return []; }
  }

  function savePromptPreset(text) {
    if (!text || !text.trim()) return;
    const trimmed = text.trim();
    let presets = getPromptPresets();
    if (presets.indexOf(trimmed) !== -1) return; // already saved
    presets.push(trimmed);
    if (presets.length > 20) presets = presets.slice(-20);
    localStorage.setItem('promptPresets', JSON.stringify(presets));
    renderPromptHistory();
  }

  function deletePromptPreset(text) {
    let presets = getPromptPresets().filter(p => p !== text);
    localStorage.setItem('promptPresets', JSON.stringify(presets));
    renderPromptHistory();
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
    const presets = getPromptPresets();
    const history = getPromptHistory().filter(p => presets.indexOf(p) === -1);
    if (presets.length === 0 && history.length === 0) { promptHistory.classList.add('hidden'); return; }
    promptHistory.classList.remove('hidden');
    promptHistory.innerHTML = '';

    const makeChip = (text, isPinned) => {
      const chip = document.createElement('span');
      chip.className = 'prompt-chip' + (isPinned ? ' prompt-chip-pinned' : '');
      const pin = document.createElement('span');
      pin.className = 'prompt-chip-pin';
      pin.title = isPinned ? '取消固定' : '固定为预设';
      pin.textContent = isPinned ? '📌' : '📌';
      pin.style.opacity = isPinned ? '1' : '0.3';
      pin.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isPinned) deletePromptPreset(text);
        else savePromptPreset(text);
      });
      const span = document.createElement('span');
      span.className = 'prompt-chip-text';
      span.textContent = text;
      span.title = text;
      const del = document.createElement('span');
      del.className = 'prompt-chip-del';
      del.textContent = '✕';
      del.title = '删除此条';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isPinned) deletePromptPreset(text);
        else deletePromptHistory(text);
      });
      chip.appendChild(pin);
      chip.appendChild(span);
      chip.appendChild(del);
      chip.addEventListener('click', () => {
        customPromptInput.value = text;
        customPromptInput.focus();
      });
      return chip;
    };

    presets.forEach(text => promptHistory.appendChild(makeChip(text, true)));
    history.forEach(text => promptHistory.appendChild(makeChip(text, false)));
  }

  customPromptSubmit.addEventListener('click', () => {
    const val = customPromptInput.value.trim();
    if (val) { savePromptHistory(val); customPromptInput.value = ''; }
  });
  customPromptInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      const val = customPromptInput.value.trim();
      if (val) { savePromptHistory(val); customPromptInput.value = ''; }
    }
  });

  // ── Session & recents ──
  function saveSession(jobId, status) {
    currentJobId = jobId; currentJobStatus = status;
    sessionStorage.setItem('jobId', jobId);
    sessionStorage.setItem('jobStatus', status);
  }

  function saveRecent(jobId, name, shotCount) {
    try {
      let recents = JSON.parse(localStorage.getItem('recentJobs') || '[]');
      recents = recents.filter(r => r.jobId !== jobId);
      recents.unshift({ jobId, name, shotCount, time: Date.now() });
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
    sessionStorage.removeItem('jobStartTime');
    currentJobId = null;
    currentJobStatus = null;
  }

  // ── Mode chip switcher ──
  document.querySelectorAll('.mode-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.mode-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      chip.querySelector('input').checked = true;
    });
  });

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
  let dragCounter = 0;
  dropZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => {
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dropZone.classList.remove('drag-over');
    }
  });
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropZone.classList.remove('drag-over');
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

  // ── Export split button ──
  window.__exportFormat = 'txt';

  // Floating FAB — show when results section is visible and user scrolls past it
  var exportFab = document.getElementById('exportFab');
  window.addEventListener('scroll', function() {
    if (!resultsSection.classList.contains('hidden')) {
      var rect = resultsSection.getBoundingClientRect();
      // Show FAB when results header is above viewport
      exportFab.style.display = rect.top < 0 ? 'inline-flex' : 'none';
    } else {
      exportFab.style.display = 'none';
    }
  });

  window.toggleExportMenu = function(arrow, e) {
    e.stopPropagation();
    var popup = arrow.parentElement.querySelector('.export-format-popup');
    var wasHidden = popup.classList.contains('hidden');
    // close all popups
    document.querySelectorAll('.export-format-popup').forEach(function(p) { p.classList.add('hidden'); });
    if (wasHidden) popup.classList.remove('hidden');
  };

  window.pickExportFormat = function(e) {
    var item = e.target.closest('.export-format-item');
    if (!item) return;
    e.stopPropagation();
    window.__exportFormat = item.dataset.format;
    document.querySelectorAll('.export-format-popup').forEach(function(popup) {
      popup.querySelectorAll('.export-format-item').forEach(function(i) { i.classList.remove('active'); });
      var t = popup.querySelector('[data-format="' + window.__exportFormat + '"]');
      if (t) t.classList.add('active');
      popup.classList.add('hidden');
    });
    // Immediate download
    window.doExport();
  };

  window.doExport = function() {
    if (!currentJobId) { alert('任务已过期，请重新分析'); return; }
    var link = document.createElement('a');
    link.href = '/api/export/' + currentJobId + '?format=' + window.__exportFormat;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  document.addEventListener('click', function(e) {
    // Close popup only if click is outside any export-split-btn
    if (!e.target.closest('.export-split-btn')) {
      document.querySelectorAll('.export-format-popup').forEach(function(p) { p.classList.add('hidden'); });
    }
  });

  copyAllBtn.addEventListener('click', copyAllDescriptions);
  clearCacheBtn.addEventListener('click', clearCache);
  retryBtn.addEventListener('click', resetToUpload);

  clearCacheBtn.addEventListener('click', clearCache);
  retryBtn.addEventListener('click', resetToUpload);

  // ── Log viewer ──
  const viewLogBtn = document.getElementById('viewLogBtn');
  const logViewer = document.getElementById('logViewer');
  const logViewerContent = document.getElementById('logViewerContent');
  const logViewerClose = document.getElementById('logViewerClose');
  const logFileSelect = document.getElementById('logFileSelect');
  const logRefreshBtn = document.getElementById('logRefreshBtn');

  async function loadLogFiles() {
    try {
      const res = await fetch('/api/logs/files');
      const data = await res.json();
      logFileSelect.innerHTML = (data.files || []).map(f => `<option value="${f}">${f.replace('.log','')}</option>`).join('');
    } catch {}
  }

  async function loadLogContent() {
    logViewerContent.textContent = '加载中...';
    try {
      const file = logFileSelect.value;
      const res = file
        ? await fetch('/api/logs/file/' + file + '?n=500')
        : await fetch('/api/logs/tail?n=500');
      const data = await res.json();
      logViewerContent.textContent = (data.lines || []).join('\n') || '(空)';
      logViewerContent.scrollTop = logViewerContent.scrollHeight;
    } catch (e) {
      logViewerContent.textContent = '加载失败: ' + e.message;
    }
  }

  viewLogBtn.addEventListener('click', async () => {
    logViewer.classList.remove('hidden');
    await loadLogFiles();
    loadLogContent();
  });
  logViewerClose.addEventListener('click', () => logViewer.classList.add('hidden'));
  logViewer.querySelector('.log-viewer-backdrop').addEventListener('click', () => logViewer.classList.add('hidden'));
  logFileSelect.addEventListener('change', loadLogContent);
  logRefreshBtn.addEventListener('click', loadLogContent);
  logClearBtn.addEventListener('click', async () => {
    if (!confirm('确定要清除今天的后台日志吗？此操作不可恢复。')) return;
    const file = logFileSelect.value || 'today';
    try {
      const res = await fetch('/api/logs' + (file ? '/' + file : ''), { method: 'DELETE' });
      const data = await res.json();
      if (data.ok) {
        logViewerContent.textContent = '(已清除)';
        loadLogContent();
      } else {
        alert('清除失败');
      }
    } catch (e) { alert('清除失败: ' + e.message); }
  });

  // ── Lightbox ──
  lightboxClose.addEventListener('click', closeLightbox);
  lightbox.querySelector('.lightbox-backdrop').addEventListener('click', closeLightbox);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });

  // Persist min shot duration
  const minShotDuration = document.getElementById('minShotDuration');
  const savedMinShot = localStorage.getItem('minShotDuration');
  if (savedMinShot) minShotDuration.value = savedMinShot;
  minShotDuration.addEventListener('change', () => {
    localStorage.setItem('minShotDuration', minShotDuration.value);
  });

  // ── Range selection ──
  function refreshConfirmBtn() {
    const setCount = selectedSet.size;
    rangeConfirmBtn.textContent = '分析 ' + setCount + ' 个镜头';
    updateFilmstripFromSet();
  }

  rangeConfirmBtn.addEventListener('click', async () => {
    const sorted = [...selectedSet].sort((a, b) => a - b);
    if (sorted.length === 0) return;
    const label = sorted.length === 1
      ? '镜头 ' + sorted[0]
      : sorted.length + ' 个镜头';
    rangeSection.classList.add('hidden');
    progressSection.classList.remove('hidden');
    progressLog.innerHTML = '';
    setProgress(0, '开始处理...', label);
    const doCommit = async (jid) => {
      const res = await fetch('/api/commit-range', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: jid, selectedIndices: sorted.map(i => i - 1), customPrompt: getPromptHistory().join('\n'), minShotDuration: parseFloat(document.getElementById('minShotDuration').value) || 1.0, mode: document.querySelector('input[name="analysisMode"]:checked').value }),
      });
      return res.json();
    };

    // If re-analyzing from results, clone first so original results are preserved
    if (cameFromResults) {
      const cloneRes = await fetch('/api/clone-job/' + currentJobId, { method: 'POST' }).then(r => r.json());
      if (!cloneRes.jobId) { showError('克隆任务失败'); return; }
      currentJobId = cloneRes.jobId;
      addToHistory(currentJobId);
    }

    doCommit(currentJobId).then(data => {
      if (data.error) { showError(data.error); return; }
      saveSession(currentJobId, 'extracting');
      setToolbar([{text:'返回首页',onClick:resetToUpload}]);
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
  function setToolbar(buttons) {
    headerToolbar.innerHTML = '';
    buttons.forEach(def => {
      const btn = document.createElement('button');
      btn.textContent = def.text;
      btn.className = 'tb-btn' + (def.primary ? ' primary' : '');
      btn.addEventListener('click', def.onClick);
      headerToolbar.appendChild(btn);
    });
  }

  function clearToolbar() { headerToolbar.innerHTML = ''; }

  async function switchToJob(jobId) {
    uploadSection.classList.add('hidden');
    rangeSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
    errorSection.classList.add('hidden');
    progressSection.classList.remove('hidden');
    setProgress(0, '加载中...', '');
    clearToolbar();
    try {
      const res = await fetch('/api/jobs/' + jobId);
      if (!res.ok) {
        progressSection.classList.add('hidden');
        errorSection.classList.remove('hidden');
        errorMessage.textContent = '该任务已在服务端过期，无法恢复。请重新上传视频分析。';
        setToolbar([{text:'返回首页',onClick:resetToUpload}]);
        return;
      }
      const job = await res.json();
      currentJobId = job.jobId;
      if (job.status === 'awaiting_range' && job.sceneData) {
        saveSession(jobId, 'awaiting_range');
        progressSection.classList.add('hidden');
        showRangeSelector(job.sceneData);
      } else if (job.status === 'done' && job.results) {
        saveSession(jobId, 'done');
        progressSection.classList.add('hidden');
        showResults(job);
      } else if (job.status === 'error') {
        showError(job.error || '处理失败');
      } else {
        saveSession(jobId, job.status);
        setToolbar([{text:'返回首页',onClick:resetToUpload}]);
        startDetectAnim();
        pollJob(jobId);
      }
    } catch { removeFromHistory(jobId); resetToUpload(); }
  }

  function handleFile(file) {
    uploadError.classList.add('hidden');
    const allowed = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (allowed.indexOf(ext) === -1) { showUploadError('不支持的文件格式：' + ext + '，支持 ' + allowed.join(', ')); return; }
    if (file.size > 2 * 1024 * 1024 * 1024) { showUploadError('文件过大，最大支持 2GB'); return; }
    startUpload(file);
  }

  function showUploadError(msg) { uploadError.textContent = msg; uploadError.classList.remove('hidden'); }

  function startUpload(file) {
    uploadSection.classList.add('hidden'); resultsSection.classList.add('hidden'); errorSection.classList.add('hidden');
    progressSection.classList.remove('hidden');
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    setProgress(0, '上传中...', '文件: ' + file.name + ' (' + sizeMB + ' MB)');
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const upMB = (e.loaded / 1024 / 1024).toFixed(1), totMB = (e.total / 1024 / 1024).toFixed(1);
        if (e.loaded >= e.total) setProgress(12, '文件已接收，准备分析...', totMB + ' MB');
        else setProgress(Math.round((e.loaded / e.total) * 12), '上传中...', '已传输 ' + upMB + ' / ' + totMB + ' MB');
      }
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { const d = JSON.parse(xhr.responseText); saveSession(d.jobId, 'received'); addToHistory(d.jobId); setToolbar([{text:'返回首页',onClick:resetToUpload}]); sessionStorage.removeItem('jobStartTime'); startDetectAnim(); pollJob(d.jobId); } catch { showError('解析响应失败'); }
      } else {
        try { showError(JSON.parse(xhr.responseText).error || '上传失败 (HTTP ' + xhr.status + ')'); } catch { showError('上传失败 (HTTP ' + xhr.status + ')'); }
      }
    });
    xhr.addEventListener('error', () => showError('网络错误'));
    xhr.addEventListener('abort', () => showError('上传已取消'));
    const fd = new FormData(); fd.append('video', file);
    const minDur = document.getElementById('minShotDuration').value || '1.0';
    xhr.open('POST', '/api/analyze?minShotDuration=' + minDur);
    xhr.send(fd);
  }

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
      saveSession(jobId, 'downloading'); sessionStorage.removeItem('jobStartTime'); startDetectAnim(); pollJob(jobId);
    } catch (e) { showError(e.message); urlSubmitBtn.disabled = false; urlSubmitBtn.classList.remove('btn-loading'); }
  }

  // ── Polling ──
  function pollJob(jobId) {
    if (pollTimer) clearInterval(pollTimer);
    let lastLogLen = 0;
    pollTimer = setInterval(async () => {
      try {
        const res = await fetch('/api/jobs/' + jobId);
        if (!res.ok) throw new Error('获取任务状态失败');
        const job = await res.json();
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
          case 'received': setProgress(3, '已接收', ''); break;
          case 'downloading': setProgress(3, '下载视频...', (job.progress || {}).downloaded ? job.progress.downloaded : ''); break;
          case 'detecting_scenes': break;
          case 'extracting_thumbs':
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
            renderRecentAnalyses();
            setTimeout(() => showResults(job), 300);
            break;
          case 'error':
            stopDetectAnim();
            clearInterval(pollTimer); pollTimer = null;
            renderRecentAnalyses();
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

  function setProgress(pct, label, detail) { progressBar.style.width = pct + '%'; progressLabel.textContent = label; progressDetail.textContent = detail; }

  function startDetectAnim() {
    stopDetectAnim();
    progressBar.classList.add('breathing');
    // Use session-stored job start time so elapsed doesn't reset on navigation
    const start = Number(sessionStorage.getItem('jobStartTime')) || Date.now();
    if (!sessionStorage.getItem('jobStartTime')) {
      sessionStorage.setItem('jobStartTime', start);
    }
    let tick = Math.max(0, Math.floor((Date.now() - start) / 300));
    progressAnimTimer = setInterval(() => {
      tick++;
      const elapsed = Math.floor((Date.now() - start) / 1000);
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
    selectedSet.clear();
    for (let j = 1; j <= Math.min(total, 10); j++) selectedSet.add(j);
    filmstrip.innerHTML = '';
    const thumbBase = sceneData.thumbBase || '/api/frames/' + currentJobId + '/';
    const previewBase = sceneData.previewBase || '/api/preview-clips/' + currentJobId + '/';
    for (let i = 0; i < total; i++) {
      const item = document.createElement('div');
      item.className = 'filmstrip-item';
      item.dataset.index = i + 1;
      item.innerHTML =
        '<img class="filmstrip-thumb-img" src="' + thumbBase + i + '" alt="镜头 ' + (i + 1) + '" loading="lazy"' +
        ' onerror="this.outerHTML=\'<div style=width:120px;height:68px;display:flex;align-items:center;justify-content:center;background:var(--border);color:var(--text-secondary);font-size:0.75rem;border-radius:4px>&darr;</div>\'">' +
        '<button class="filmstrip-play-btn" title="预览视频片段"><svg width="14" height="14" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"/></svg></button>' +
        '<div class="filmstrip-item-label">镜头 ' + (i + 1) + '</div>';

      item.addEventListener('click', (e) => {
        const clicked = i + 1;
        if (e.ctrlKey) {
          if (selectedSet.has(clicked)) {
            selectedSet.delete(clicked);
          } else {
            selectedSet.add(clicked);
          }
        } else if (e.shiftKey) {
          const sorted = selectedSet.size > 0 ? [...selectedSet].sort((a, b) => a - b) : [clicked];
          const s = Math.min(sorted[0], clicked), e = Math.max(sorted[sorted.length - 1], clicked);
          selectedSet.clear();
          for (let j = s; j <= e; j++) selectedSet.add(j);
        } else {
          selectedSet.clear();
          selectedSet.add(clicked);
        }
        refreshConfirmBtn();
      });
      item.querySelector('.filmstrip-thumb-img').addEventListener('dblclick', (e) => {
        e.stopPropagation();
        openLightbox(thumbBase + i);
      });
      item.querySelector('.filmstrip-play-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        openLightbox(null, previewBase + i);
      });
      filmstrip.appendChild(item);
    }
    refreshConfirmBtn();
    rangeSection.classList.remove('hidden');
    rangeSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const btns = [{text:'返回首页',onClick:resetToUpload}];
    if (cameFromResults) btns.splice(1, 0, {text:'← 返回结果',primary:true,onClick:backToResults});
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

  function updateFilmstripFromSet() {
    filmstrip.querySelectorAll('.filmstrip-item').forEach(item => {
      const idx = parseInt(item.dataset.index);
      item.classList.toggle('selected', selectedSet.has(idx));
    });
  }

  function foldableRange(text) {
    if (text.length <= 20) return document.createTextNode(text);
    const span = document.createElement('span');
    span.className = 'foldable-range';
    span.textContent = text.slice(0, 18) + '…';
    const arrow = document.createElement('span');
    arrow.className = 'foldable-arrow';
    arrow.textContent = ' ▸';
    arrow.title = '展开全部';
    span.appendChild(arrow);
    function closeBubble() {
      const b = document.querySelector('.range-bubble');
      if (b) b.remove();
      document.removeEventListener('click', closeBubble);
    }
    arrow.addEventListener('click', (e) => {
      e.stopPropagation();
      const existing = document.querySelector('.range-bubble');
      if (existing) { existing.remove(); return; }
      const bubble = document.createElement('div');
      bubble.className = 'range-bubble';
      bubble.textContent = text;
      bubble.addEventListener('click', (ev) => { ev.stopPropagation(); closeBubble(); });
      arrow.appendChild(bubble);
      setTimeout(() => document.addEventListener('click', closeBubble), 0);
    });
    return span;
  }

  function showResults(job) {
    progressSection.classList.add('hidden');
    resultsSection.classList.remove('hidden');
    const r = job.results;
    resultsTitle.textContent = r.videoFile || '分析结果';
    const rangeText = r.shotRange ? '镜头 ' + r.shotRange + '（共 ' + r.totalShots + ' 个）' : r.totalShots + ' 个镜头';
    resultsMeta.replaceChildren(foldableRange(rangeText));
    const extra = [];
    if (r.hasAudio) extra.push('含台词识别');
    extra.push('模式: ' + (r.mode === 'video' ? '视频动态' : '单帧推演'));
    if (r.duration) extra.push(formatDuration(r.duration));
    if (r.totalWallMs) extra.push('耗时 ' + (r.totalWallMs / 1000).toFixed(0) + 's');
    if (extra.length) resultsMeta.appendChild(document.createTextNode(' . ' + extra.join(' . ')));

    // Show active API config in subtle style
    fetch('/api/config').then(cr => cr.json()).then(cfg => {
      let line = document.getElementById('resultsConfigLine');
      if (!line) {
        line = document.createElement('div');
        line.id = 'resultsConfigLine';
        line.style.cssText = 'font-size:0.7rem;color:var(--text-secondary);opacity:0.45;margin-top:6px;font-family:monospace';
        resultsMeta.parentElement.appendChild(line);
      }
      line.textContent = '视觉: ' + cfg.VISION_PROVIDER + '/' + cfg.VISION_MODEL +
                         '    音频: ' + cfg.AUDIO_PROVIDER + '/' + cfg.AUDIO_MODEL +
                         (r.audioMs ? ' · 台词耗时 ' + formatMs(r.audioMs) : '');
    }).catch(() => {});

    shotsTimeline.innerHTML = '';
    r.shots.forEach((shot) => {
      const card = document.createElement('div');
      card.className = 'shot-card';
      const time = formatTimecode(shot.startTime) + ' - ' + formatTimecode(shot.endTime);
      const previewPath = '/api/preview-clips/' + currentJobId + '/' + shot.index;
      let html = '<div class="shot-thumb shot-thumb-video">' +
        '<img src="' + shot.framePath + '" alt="Shot ' + (shot.index + 1) + '" loading="lazy">' +
        '<div class="play-overlay"><svg width="24" height="24" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"/></svg></div>' +
        '<span class="shot-time-badge">' + time + '</span></div>';
      html += '<div class="shot-body"><div class="shot-index">镜头 ' + (shot.index + 1) + ' . ' + formatDuration(shot.duration) + '<span class="shot-timing">视觉 ' + formatMs(shot.visionMs) + ' . 音频 ' + formatMs(shot.audioMs) + ' . ' + formatCompletedAt(shot.completedAt) + '</span></div>';
      html += '<div class="shot-section-label">画面</div><p class="shot-desc">' + escapeHtml(shot.description) + '</p>';
      if (shot.audioDescription) {
        html += '<div class="shot-section-label audio-label">台词</div><p class="shot-audio-desc">' + escapeHtml(shot.audioDescription) + '</p>';
      } else {
        html += '<div class="shot-section-label audio-label" style="opacity:0.5">台词</div><p class="shot-audio-desc" style="opacity:0.5;color:var(--text-secondary);font-style:italic">无台词</p>';
      }
      html += '</div>';
      card.innerHTML = html;
      card.querySelector('.shot-thumb').addEventListener('click', () => openLightbox(shot.framePath, previewPath));
      shotsTimeline.appendChild(card);

      // Also append clean prompt to a hidden textarea for easy copy
      const clean = document.createElement('textarea');
      clean.className = 'shot-clean-prompt';
      clean.readOnly = true;
      clean.value = shot.description +
        (shot.audioDescription ? '\n\n[台词] ' + shot.audioDescription : '');
      const copyBtn = document.createElement('button');
      copyBtn.className = 'shot-copy-btn';
      copyBtn.textContent = '复制提示词';
      copyBtn.addEventListener('click', () => {
        clean.select();
        document.execCommand('copy');
        copyBtn.textContent = '已复制'; copyBtn.classList.add('copied');
        setTimeout(() => { copyBtn.textContent = '复制提示词'; copyBtn.classList.remove('copied'); }, 1500);
      });
      card.querySelector('.shot-body').appendChild(clean);
      card.querySelector('.shot-body').appendChild(copyBtn);
    });
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setToolbar([{text:'分析其他镜头',onClick:backToRange},{text:'分析新视频',primary:true,onClick:resetToUpload}]);
    if (r) saveRecent(job.jobId, r.videoFile || '未知', r.totalShots);
    fetch('/api/jobs/' + currentJobId + '/siblings').then(rs => rs.json()).then(sr => renderPagers(sr.siblings, sr.pos));
  }

  function renderPagers(siblings, pos) {
    if (!siblings || siblings.length <= 1) {
      resultsTopPager.innerHTML = resultsBottomPager.innerHTML = '';
      return;
    }
    const prev = pos > 0 ? siblings[pos - 1] : null;
    const next = pos < siblings.length - 1 ? siblings[pos + 1] : null;
    const html = (() => {
      let h = '<div class="page-nav">';
      h += prev
        ? '<button class="page-nav-btn" data-goto="' + prev.jobId + '">◂ ' + (prev.shotRange || '?') + '</button>'
        : '<span class="page-nav-btn disabled">◂ 无</span>';
      h += '<span class="page-nav-pos">' + (pos + 1) + ' / ' + siblings.length + '</span>';
      h += next
        ? '<button class="page-nav-btn" data-goto="' + next.jobId + '">' + (next.shotRange || '?') + ' ▸</button>'
        : '<span class="page-nav-btn disabled">无 ▸</span>';
      h += '</div>';
      return h;
    })();
    resultsTopPager.innerHTML = resultsBottomPager.innerHTML = html;
    [resultsTopPager, resultsBottomPager].forEach(el => {
      el.querySelectorAll('.page-nav-btn[data-goto]').forEach(btn => {
        btn.addEventListener('click', () => {
          const jid = btn.dataset.goto;
          currentJobId = jid;
          fetch('/api/jobs/' + jid).then(r => r.json()).then(job => {
            if (job.results) showResults(job);
          });
        });
      });
    });
  }

  function backToRange() {
    resultsSection.classList.add('hidden');
    cameFromResults = true;
    fetch('/api/jobs/' + currentJobId).then(r => r.json()).then(job => {
      if (!job.sceneData) { resetToUpload(); return; }
      const testImg = new Image();
      testImg.onload = () => showRangeSelector(job.sceneData);
      testImg.onerror = () => {
        progressSection.classList.remove('hidden');
        setProgress(0, '抽取缩略图...', '');
        setToolbar([{text:'返回首页',onClick:resetToUpload}]);
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

  function copyAllDescriptions() {
    const lines = [].slice.call(shotsTimeline.querySelectorAll('.shot-card')).map(card => {
      const d = card.querySelector('.shot-desc'), a = card.querySelector('.shot-audio-desc');
      let text = d ? d.textContent : '';
      if (a && a.textContent !== '无台词') text += '\n\n[台词] ' + a.textContent;
      return text;
    });
    navigator.clipboard.writeText(lines.join('\n\n')).then(() => {
      copyAllBtn.textContent = '已复制！'; copyAllBtn.classList.add('copied');
      setTimeout(() => { copyAllBtn.textContent = '复制全部描述'; copyAllBtn.classList.remove('copied'); }, 2000);
    }).catch(() => alert('复制失败'));
  }

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

  function openLightbox(src, videoSrc) {
    if (videoSrc) {
      lightboxImg.style.display = 'none';
      lightboxVideo.style.display = '';
      lightboxVideo.querySelector('source') && lightboxVideo.querySelector('source').remove();
      const srcEl = document.createElement('source');
      srcEl.src = videoSrc;
      srcEl.type = 'video/mp4';
      lightboxVideo.appendChild(srcEl);
      lightboxVideo.load();
      lightboxVideo.play().catch(() => {});
    } else {
      lightboxVideo.style.display = 'none';
      lightboxVideo.pause();
      lightboxVideo.querySelector('source') && lightboxVideo.querySelector('source').remove();
      lightboxImg.style.display = '';
      lightboxImg.src = src;
    }
    lightbox.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
  function closeLightbox() {
    lightbox.classList.add('hidden');
    document.body.style.overflow = '';
    lightboxVideo.pause();
    lightboxVideo.querySelector('source') && lightboxVideo.querySelector('source').remove();
  }

  function showError(msg) { stopDetectAnim(); progressSection.classList.add('hidden'); rangeSection.classList.add('hidden'); errorSection.classList.remove('hidden'); errorMessage.textContent = msg; }

  function resetToUpload() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    stopDetectAnim();
    clearSession();
    location.reload();
  }

  function formatTimecode(s) { const m = Math.floor(s / 60), sec = Math.floor(s % 60); return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0'); }
  function formatMs(ms) { if (!ms || ms <= 0) return '…'; if (ms < 1000) return ms + 'ms'; return (ms / 1000).toFixed(1) + 's'; }
  function formatCompletedAt(ts) { if (!ts) return ''; const d = new Date(ts); return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0') + ':' + d.getSeconds().toString().padStart(2,'0'); }
  function formatDuration(s) { if (s < 60) return Math.round(s) + '秒'; return Math.floor(s / 60) + '分' + Math.round(s % 60) + '秒'; }
  function formatDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function getStatusBadge(status) {
    const map = {
      done:              { label: '分析完成', cls: 'status-done' },
      awaiting_range:    { label: '等待分析', cls: 'status-pending' },
      extracting:        { label: '抽取中',   cls: 'status-running' },
      extracting_frames: { label: '抽取中',   cls: 'status-running' },
      extracting_thumbs: { label: '抽取缩略图', cls: 'status-running' },
      analyzing:         { label: '分析中',   cls: 'status-running' },
      detecting_scenes:  { label: '检测镜头中', cls: 'status-running' },
      downloading:       { label: '下载中',   cls: 'status-running' },
      received:          { label: '排队中',   cls: 'status-running' },
      error:             { label: '处理失败', cls: 'status-error' },
      expired:           { label: '已过期',   cls: 'status-expired' },
    };
    const m = map[status] || { label: status, cls: 'status-running' };
    return '<div class="recent-card-status ' + m.cls + '">' + m.label + '</div>';
  }

  function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t || ''; return d.innerHTML; }
})();

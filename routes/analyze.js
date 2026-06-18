const fs = require('fs');
const path = require('path');
const { Router } = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const config = require('../utils/config');
const overrides = require('../utils/overrides');
const logger = require('../utils/logger');
const { detectOnly, runRange } = require('../services/pipeline');
const { downloadVideo } = require('../services/downloadVideo');

const router = Router();

const { execSync } = require('child_process');

// Get git hash for version display
function getGitHash() {
  try { return execSync('git rev-parse --short HEAD', { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
}

// In-memory job store: Map<jobId, jobState>
const jobStore = new Map();

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const jobId = req._jobId;
    const dir = path.join(config.UPLOAD_DIR, jobId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Keep original extension
    const ext = path.extname(file.originalname) || '.mp4';
    cb(null, `video${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (config.ALLOWED_MIMETYPES.includes(file.mimetype) || config.ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件格式: ${file.mimetype} (${ext})。请上传 ${config.ALLOWED_EXTENSIONS.join('、')} 格式的视频文件`));
    }
  },
});

// Helper: update job with partial data, handle logLine accumulation
function mergeJob(jobId, partial) {
  const current = jobStore.get(jobId);
  if (!current) return;
  if (partial.logLine) {
    if (!current.log) current.log = [];
    current.log.push(`[${new Date().toLocaleTimeString('zh-CN', {hour12:false})}] ${partial.logLine}`);
    delete partial.logLine;
  }
  Object.assign(current, partial);
  // Persist to disk when done
  if (current.status === 'done' && current.results) {
    current.savedAt = Date.now();
    saveJobToDisk(current);
  }
}

// Write job to outputs/jobId/result.json for persistence across restarts
function saveJobToDisk(job) {
  try {
    const dir = path.join(config.OUTPUT_DIR, job.jobId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = {
      jobId: job.jobId,
      videoName: job.videoName,
      status: 'done',
      results: job.results,
      sceneData: job.sceneData,
      log: job.log,
      createdAt: job.createdAt,
      savedAt: Date.now(),
    };
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(data), 'utf-8');
  } catch (e) { logger.error('[saveJob] Failed:', e.message); }
}

// Reload jobs from disk on startup
function loadSavedJobs() {
  let count = 0;
  try {
    if (!fs.existsSync(config.OUTPUT_DIR)) return 0;
    const dirs = fs.readdirSync(config.OUTPUT_DIR);
    for (const dir of dirs) {
      try {
        const filePath = path.join(config.OUTPUT_DIR, dir, 'result.json');
        if (!fs.existsSync(filePath)) continue;
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (jobStore.has(data.jobId)) continue; // already loaded
        data.savedAt = data.savedAt || data.createdAt;
        jobStore.set(data.jobId, data);
        count++;
      } catch (e) { /* skip corrupt files */ }
    }
  } catch (e) { /* skip */ }
  return count;
}

// ── Config overrides ──
router.get('/config', (req, res) => {
  res.json({
    VISION_PROVIDER: overrides.get('VISION_PROVIDER') || config.VISION_PROVIDER,
    VISION_BASE_URL: overrides.get('VISION_BASE_URL') || config.VISION_BASE_URL,
    VISION_API_KEY: overrides.get('VISION_API_KEY') ? '***' : (config.VISION_API_KEY ? '***' : ''),
    VISION_MODEL: overrides.get('VISION_MODEL') || config.VISION_MODEL,
    AUDIO_PROVIDER: overrides.get('AUDIO_PROVIDER') || config.AUDIO_PROVIDER,
    AUDIO_BASE_URL: overrides.get('AUDIO_BASE_URL') || config.AUDIO_BASE_URL,
    AUDIO_API_KEY: overrides.get('AUDIO_API_KEY') ? '***' : (config.AUDIO_API_KEY ? '***' : ''),
    AUDIO_MODEL: overrides.get('AUDIO_MODEL') || config.AUDIO_MODEL,
    VISION_CONCURRENCY: overrides.get('VISION_CONCURRENCY') || 5,
    VISION_MAX_TOKENS: overrides.get('VISION_MAX_TOKENS') || 1024,
    AUDIO_CONCURRENCY: overrides.get('AUDIO_CONCURRENCY') || 3,
  });
});

router.post('/config', (req, res) => {
  const { VISION_PROVIDER, VISION_BASE_URL, VISION_API_KEY, VISION_MODEL,
    AUDIO_PROVIDER, AUDIO_BASE_URL, AUDIO_API_KEY, AUDIO_MODEL, VISION_CONCURRENCY, VISION_MAX_TOKENS, AUDIO_CONCURRENCY } = req.body;
  const fields = { VISION_PROVIDER, VISION_BASE_URL, VISION_API_KEY, VISION_MODEL,
    AUDIO_PROVIDER, AUDIO_BASE_URL, AUDIO_API_KEY, AUDIO_MODEL, VISION_CONCURRENCY, VISION_MAX_TOKENS, AUDIO_CONCURRENCY };
  overrides.apply(fields);
  logger.info('[config] Updated:', Object.keys(fields).filter(k => overrides.get(k)).join(', '));
  res.json({ ok: true, overrides: overrides.getAll(), active: {
    VISION_PROVIDER: overrides.get('VISION_PROVIDER') || config.VISION_PROVIDER,
    VISION_BASE_URL: overrides.get('VISION_BASE_URL') || config.VISION_BASE_URL,
    VISION_MODEL: overrides.get('VISION_MODEL') || config.VISION_MODEL,
    AUDIO_PROVIDER: overrides.get('AUDIO_PROVIDER') || config.AUDIO_PROVIDER,
    AUDIO_BASE_URL: overrides.get('AUDIO_BASE_URL') || config.AUDIO_BASE_URL,
    AUDIO_MODEL: overrides.get('AUDIO_MODEL') || config.AUDIO_MODEL,
  }});
});

// ── Config presets (service-side storage, cross-browser) ──
const PRESETS_FILE = path.join(config.OUTPUT_DIR, '.config-presets.json');

router.get('/config-presets', (req, res) => {
  try {
    if (fs.existsSync(PRESETS_FILE)) {
      res.json(JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf-8')));
    } else {
      res.json([]);
    }
  } catch { res.json([]); }
});

router.post('/config-presets', (req, res) => {
  try {
    const dir = path.dirname(PRESETS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PRESETS_FILE, JSON.stringify(req.body, null, 2) + '\n', 'utf-8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Test connection endpoints ──

const https = require('https');
const http = require('http');

function resolveCfg(k) { return overrides.get(k) || config[k]; }

function testConnection(baseUrl, apiKey, model) {
  const apiUrl = new URL(baseUrl.replace(/\/?$/, '/') + 'chat/completions');
  const transport = apiUrl.protocol === 'https:' ? https : http;

  return new Promise((resolve) => {
    const payload = JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1,
      stream: false,
    });
    const start = Date.now();
    const req = transport.request(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c.toString(); });
      res.on('end', () => {
        // Any response (2xx/4xx) = server reachable. Only 5xx/timeout = failure
        if (res.statusCode < 500) {
          const hints = {
            200: '', 201: '', 202: '',
            400: ' (服务可达，请求参数不匹配 — 需实际分析时验证)',
            401: ' (Key 无效)',
            403: ' (无权限)',
            404: ' (服务可达，此模型不支持文本对话 — 需实际分析时验证)',
            429: ' (请求频率限制)',
          };
          const hint = hints[res.statusCode] || '';
          resolve({ ok: true, status: res.statusCode, latency: Date.now() - start, hint });
        } else {
          resolve({ ok: false, status: res.statusCode, error: data.slice(0, 200) });
        }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: '超时 (15s)' }); });
    req.write(payload);
    req.end();
  });
}

router.post('/test-vision', async (req, res) => {
  const cfg = {
    baseUrl: req.body.VISION_BASE_URL || resolveCfg('VISION_BASE_URL'),
    apiKey: req.body.VISION_API_KEY || resolveCfg('VISION_API_KEY'),
    model: req.body.VISION_MODEL || resolveCfg('VISION_MODEL'),
  };
  if (!cfg.apiKey) return res.json({ ok: false, error: 'API Key 未设置' });
  const result = await testConnection(cfg.baseUrl, cfg.apiKey, cfg.model);
  res.json(result);
});

router.post('/test-audio', async (req, res) => {
  const provider = req.body.AUDIO_PROVIDER || resolveCfg('AUDIO_PROVIDER');
  if (provider === 'none') return res.json({ ok: true, status: 200, note: '音频已关闭' });
  const baseUrlRaw = req.body.AUDIO_BASE_URL || resolveCfg('AUDIO_BASE_URL');
  // DashScope audio uses the OpenAI-compatible endpoint
  const baseUrl = provider === 'dashscope'
    ? baseUrlRaw.replace(/\/?$/, '/') + 'compatible-mode/v1'
    : baseUrlRaw;
  const apiKey = req.body.AUDIO_API_KEY || resolveCfg('AUDIO_API_KEY');
  const model = req.body.AUDIO_MODEL || resolveCfg('AUDIO_MODEL');
  if (!apiKey) return res.json({ ok: false, error: 'API Key 未设置' });
  const result = await testConnection(baseUrl, apiKey, model);
  res.json(result);
});

// Inject jobId before multer processes the file
router.post('/analyze', (req, res, next) => {
  req._jobId = uuidv4();
  next();
}, upload.single('video'), (req, res) => {
  const jobId = req._jobId;

  if (!req.file) {
    return res.status(400).json({ error: 'No video file provided' });
  }

  const videoPath = req.file.path;
  // Multer may mangle non-ASCII filenames — try to decode
  let videoName = req.file.originalname;
  try { videoName = Buffer.from(videoName, 'latin1').toString('utf8'); } catch {}
  const maxShots = parseInt(req.query.maxShots) || undefined;

  const job = {
    jobId,
    status: 'received',
    progress: { stage: 'received' },
    results: null,
    error: null,
    createdAt: Date.now(),
    videoName,
  };

  jobStore.set(jobId, job);

  // Phase 1: detect scenes only, then wait for user range selection
  const minShotDuration = req.query.minShotDuration;
  setImmediate(() => {
    detectOnly(videoPath, jobId, mergeJob, maxShots, minShotDuration);
  });

  res.json({ jobId, status: 'received' });
});

// Phase 2: user has selected a shot range, now extract + analyze
router.post('/commit-range', async (req, res) => {
  const { jobId, startShot, endShot, customPrompt, minShotDuration, mode } = req.body;

  const job = jobStore.get(jobId);
  if (!job) {
    return res.status(404).json({ error: '任务已过期或不存在' });
  }
  if (job.status !== 'awaiting_range' && job.status !== 'done') {
    return res.status(400).json({ error: '任务状态不正确，请重新上传' });
  }

  const s = parseInt(startShot);
  const e = parseInt(endShot);
  if (isNaN(s) || isNaN(e) || s < 0 || e < 0 || s > e) {
    return res.status(400).json({ error: '无效的镜头范围' });
  }

  // Find video path in uploads
  let videoPath;
  try {
    const upDir = path.join(config.UPLOAD_DIR, jobId);
    const videoFiles = fs.readdirSync(upDir);
    videoPath = path.join(upDir, videoFiles[0]);
  } catch {
    return res.status(400).json({ error: '视频文件已被清理，请重新上传后再分析。' });
  }

  job.status = 'extracting';
  job.progress = { stage: 'extracting_frames', current: 0, total: e - s + 1 };

  res.json({ jobId, status: 'extracting' });

  setImmediate(() => {
    runRange(videoPath, jobId, mergeJob, s, e, job.videoName, customPrompt, minShotDuration, mode);
  });
});

// Analyze from URL: download video, then detect scenes, wait for range
router.post('/analyze-url', async (req, res) => {
  const { url, maxShots: _ms, minShotDuration } = req.body;
  const maxShots = parseInt(_ms) || undefined;

  if (!url) {
    return res.status(400).json({ error: 'No video URL provided' });
  }

  // Basic URL validation
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const jobId = uuidv4();

  const job = {
    jobId,
    status: 'downloading',
    progress: { stage: 'downloading' },
    results: null,
    error: null,
    createdAt: Date.now(),
    videoName: url.split('/').pop() || 'video',
  };

  jobStore.set(jobId, job);

  // Send response immediately
  res.json({ jobId, status: 'downloading' });

  // Download and then pipeline
  setImmediate(async () => {
    try {
      jobStore.get(jobId).status = 'downloading';
      jobStore.get(jobId).progress = { stage: 'downloading' };

      const result = await downloadVideo(url, jobId, config.UPLOAD_DIR);

      jobStore.get(jobId).videoName = result.filename;
      jobStore.get(jobId).progress = {
        stage: 'downloading',
        downloaded: Math.round(result.size / 1024 / 1024 * 10) / 10 + ' MB',
      };

      // Phase 1: detect scenes, then wait for range
      await detectOnly(result.path, jobId, mergeJob, maxShots, minShotDuration);
    } catch (err) {
      jobStore.get(jobId).status = 'error';
      jobStore.get(jobId).error = 'Download failed: ' + err.message;
    }
  });
});

// Get job status/results
// Serve a thumbnail for recent cards (must be before /jobs/:jobId to match first)
router.get('/jobs/:jobId/thumb', (req, res) => {
  const dir = path.join(config.OUTPUT_DIR, req.params.jobId);
  try {
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Not found' });
    const files = fs.readdirSync(dir).filter(f => /^frame_\d+\.jpg$/.test(f)).sort();
    if (files.length === 0) return res.status(404).json({ error: 'No frames' });
    res.sendFile(path.resolve(path.join(dir, files[0])));
  } catch { res.status(404).json({ error: 'Not found' }); }
});

router.get('/jobs/:jobId', (req, res) => {
  let job = jobStore.get(req.params.jobId);

  // If not in memory, try to load from disk
  if (!job) {
    const resultPath = path.join(config.OUTPUT_DIR, req.params.jobId, 'result.json');
    if (fs.existsSync(resultPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
        data.savedAt = data.savedAt || data.createdAt;
        jobStore.set(data.jobId, data);
        job = data;
      } catch {}
    }
  }

  // If still not found, check for partially-detected job (frames exist, no result.json)
  if (!job) {
    const outDir = path.join(config.OUTPUT_DIR, req.params.jobId);
    const framePath = path.join(outDir, 'frame_0.jpg');
    if (fs.existsSync(framePath)) {
      const stat = fs.statSync(outDir);
      const files = fs.readdirSync(outDir).filter(f => /^frame_\d+\.jpg$/.test(f)).sort();
      job = {
        jobId: req.params.jobId,
        status: 'awaiting_range',
        sceneData: {
          totalShots: files.length,
          thumbBase: '/api/frames/' + req.params.jobId + '/',
          shots: files.map((f, i) => ({
            index: i,
            startTime: 0,
            endTime: 0,
            duration: 0,
          })),
        },
        createdAt: stat.birthtimeMs || stat.ctimeMs,
        savedAt: stat.mtimeMs,
      };
    }
  }

  if (!job) {
    return res.status(404).json({ error: 'Job not found or expired' });
  }
  res.json(job);
});

// Serve extracted frame image
router.get('/frames/:jobId/:index', (req, res) => {
  const { jobId, index } = req.params;
  const framePath = path.join(config.OUTPUT_DIR, jobId, `frame_${index}.jpg`);

  if (!fs.existsSync(framePath)) {
    return res.status(404).json({ error: 'Frame not found' });
  }

  res.sendFile(path.resolve(framePath));
});

// Serve video clip (for video mode preview)
router.get('/clips/:jobId/:index', (req, res) => {
  const { jobId, index } = req.params;
  const clipPath = path.join(config.OUTPUT_DIR, jobId, `clip_${index}.mp4`);

  if (!fs.existsSync(clipPath)) {
    return res.status(404).json({ error: 'Clip not found' });
  }

  // Support range requests for HTML5 video seeking
  const stat = fs.statSync(clipPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = (end - start) + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4',
    });

    const stream = fs.createReadStream(clipPath, { start, end });
    stream.pipe(res);
    stream.on('error', () => res.status(500).json({ error: 'Stream error' }));
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(clipPath).pipe(res);
  }
});

// Export markdown file (solves CJK filename encoding with blob downloads)
router.get('/export/:jobId', (req, res) => {
  const job = jobStore.get(req.params.jobId);
  if (!job || !job.results) return res.status(404).json({ error: '任务不存在' });

  const r = job.results;
  const videoName = (job.videoName || job.results.videoFile || 'video').replace(/\.\w{2,5}$/, '').slice(0, 20);

  const lines = [];
  (r.shots || []).forEach((shot, i) => {
    if (shot.description) lines.push(shot.description);
    if (shot.audioDescription) lines.push('\n[台词] ' + shot.audioDescription);
    if (i < r.shots.length - 1) lines.push('');
  });

  const content = '﻿' + lines.join('\n');
  const filename = encodeURIComponent(videoName + '_提示词.txt');

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
  res.send(Buffer.from(content, 'utf-8'));
});

// Re-extract all frame thumbnails for a job (for when frames are missing)
router.post('/re-extract-frames/:jobId', async (req, res) => {
  const job = jobStore.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: '任务不存在' });

  let videoPath;
  try {
    const videoFiles = fs.readdirSync(path.join(config.UPLOAD_DIR, job.jobId));
    videoPath = path.join(config.UPLOAD_DIR, job.jobId, videoFiles[0]);
  } catch {
    return res.status(400).json({ error: '视频文件已被清理，请重新上传后再分析。' });
  }

  res.json({ ok: true });

  setImmediate(() => {
    detectOnly(videoPath, job.jobId, mergeJob, undefined, req.query.minShotDuration);
  });
});

// Get all active jobs summary (for navigation history)
router.get('/jobs', (req, res) => {
  // Load all result.json jobs into memory
  try {
    if (fs.existsSync(config.OUTPUT_DIR)) {
      const dirs = fs.readdirSync(config.OUTPUT_DIR);
      for (const dir of dirs) {
        try {
          const filePath = path.join(config.OUTPUT_DIR, dir, 'result.json');
          if (!fs.existsSync(filePath)) continue;
          if (jobStore.has(dir)) continue;
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          data.savedAt = data.savedAt || data.createdAt;
          jobStore.set(data.jobId, data);
        } catch {}
      }
    }
  } catch {}

  const jobs = [];
  const seen = new Set();
  for (const [id, job] of jobStore) {
    seen.add(id);
    jobs.push({
      jobId: id,
      videoName: job.videoName || '未知',
      status: job.status,
      totalShots: job.sceneData?.totalShots || job.results?.totalShots || 0,
      shotRange: job.results?.shotRange || null,
      mode: job.results?.mode || null,
      createdAt: job.createdAt,
      savedAt: job.savedAt || job.createdAt,
    });
  }

  // Also include directories with frames but no result.json (scene detected, not yet analyzed)
  try {
    if (fs.existsSync(config.OUTPUT_DIR)) {
      const dirs = fs.readdirSync(config.OUTPUT_DIR);
      for (const dir of dirs) {
        if (seen.has(dir)) continue;
        const framePath = path.join(config.OUTPUT_DIR, dir, 'frame_0.jpg');
        if (!fs.existsSync(framePath)) continue;
        const stat = fs.statSync(path.join(config.OUTPUT_DIR, dir));
        // Try to get video filename from uploads
        let videoName = '未分析';
        try {
          const upDir = path.join(config.UPLOAD_DIR, dir);
          if (fs.existsSync(upDir)) {
            const vf = fs.readdirSync(upDir).filter(f => /\.(mp4|mov|avi|mkv|webm)$/i.test(f));
            if (vf.length) videoName = vf[0];
          }
        } catch {}
        // Count frames
        const files = fs.readdirSync(path.join(config.OUTPUT_DIR, dir)).filter(f => /^frame_\d+\.jpg$/.test(f));
        jobs.push({
          jobId: dir,
          videoName,
          status: 'awaiting_range',
          totalShots: files.length,
          shotRange: null,
          createdAt: stat.birthtimeMs || stat.ctimeMs,
          savedAt: stat.mtimeMs,
        });
      }
    }
  } catch {}

  jobs.sort((a, b) => b.createdAt - a.createdAt);
  res.json(jobs);
});

// Clear cache: delete all uploads and outputs
router.post('/clear-cache', (req, res) => {
  const dirs = [config.UPLOAD_DIR, config.OUTPUT_DIR];
  const results = {};

  for (const dir of dirs) {
    try {
      if (fs.existsSync(dir)) {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          const entryPath = path.join(dir, entry);
          if (fs.statSync(entryPath).isDirectory()) {
            fs.rmSync(entryPath, { recursive: true, force: true });
          }
        }
        results[path.basename(dir)] = `已清理 ${entries.length} 个缓存`;
      } else {
        results[path.basename(dir)] = '目录不存在';
      }
    } catch (err) {
      results[path.basename(dir)] = `清理失败: ${err.message}`;
    }
  }

  // Also clear job store
  const jobCount = jobStore.size;
  jobStore.clear();
  results.jobs = `已清理 ${jobCount} 个任务记录`;

  res.json({ ok: true, results });
});

// Version info — reads file fresh each request, no caching
router.get('/version', (req, res) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
  res.json({ version: pkg.version, hash: getGitHash() });
});

// Batch delete saved jobs — full cleanup (uploads + outputs + memory)
router.post('/delete-jobs', (req, res) => {
  const { jobIds } = req.body;
  if (!Array.isArray(jobIds)) return res.status(400).json({ error: '需要 jobIds 数组' });
  let deleted = 0;
  for (const jid of jobIds) {
    // Remove entire output directory (frames, audio, result.json, etc.)
    try {
      const outDir = path.join(config.OUTPUT_DIR, jid);
      if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
    } catch {}
    // Remove entire upload directory (video file)
    try {
      const upDir = path.join(config.UPLOAD_DIR, jid);
      if (fs.existsSync(upDir)) fs.rmSync(upDir, { recursive: true, force: true });
    } catch {}
    // Remove from memory
    if (jobStore.has(jid)) { jobStore.delete(jid); deleted++; }
  }
  res.json({ ok: true, deleted });
});

// ── Log endpoints ──
const logUtil = require('../utils/logger');

// GET /api/logs/tail — return last N lines of today's log
router.get('/logs/tail', (req, res) => {
  const lines = parseInt(req.query.n) || 100;
  res.json({ lines: logUtil.tail(Math.min(lines, 500)) });
});

// GET /api/logs/files — list available log files
router.get('/logs/files', (req, res) => {
  res.json({ files: logUtil.listFiles() });
});

// GET /api/logs/file/:name — read a specific log file
router.get('/logs/file/:name', (req, res) => {
  const lines = parseInt(req.query.n) || 200;
  res.json({ lines: logUtil.readFile(req.params.name, Math.min(lines, 1000)) });
});

// DELETE /api/logs — clear today's log
router.delete('/logs', (req, res) => {
  const ok = logUtil.clear();
  res.json({ ok });
});

// DELETE /api/logs/:name — delete a specific log file
router.delete('/logs/:name', (req, res) => {
  const ok = logUtil.deleteFile(req.params.name);
  res.json({ ok });
});

module.exports = { router, jobStore, loadSavedJobs };

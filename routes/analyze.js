const fs = require('fs');
const path = require('path');
const { Router } = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const config = require('../utils/config');
const { detectOnly, runRange } = require('../services/pipeline');
const { downloadVideo } = require('../services/downloadVideo');

const router = Router();

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
}

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
  setImmediate(() => {
    detectOnly(videoPath, jobId, mergeJob, maxShots);
  });

  res.json({ jobId, status: 'received' });
});

// Phase 2: user has selected a shot range, now extract + analyze
router.post('/commit-range', async (req, res) => {
  const { jobId, startShot, endShot } = req.body;

  const job = jobStore.get(jobId);
  if (!job) {
    return res.status(404).json({ error: '任务已过期或不存在' });
  }
  if (job.status !== 'awaiting_range') {
    return res.status(400).json({ error: '任务状态不正确，请重新上传' });
  }

  const s = parseInt(startShot);
  const e = parseInt(endShot);
  if (isNaN(s) || isNaN(e) || s < 0 || e < 0 || s > e) {
    return res.status(400).json({ error: '无效的镜头范围' });
  }

  // Find video path in uploads
  const videoFiles = fs.readdirSync(path.join(config.UPLOAD_DIR, jobId));
  const videoPath = path.join(config.UPLOAD_DIR, jobId, videoFiles[0]);

  job.status = 'extracting';
  job.progress = { stage: 'extracting_frames', current: 0, total: e - s + 1 };

  res.json({ jobId, status: 'extracting' });

  setImmediate(() => {
    runRange(videoPath, jobId, mergeJob, s, e, job.videoName);
  });
});

// Analyze from URL: download video, then detect scenes, wait for range
router.post('/analyze-url', async (req, res) => {
  const { url, maxShots: _ms } = req.body;
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
      await detectOnly(result.path, jobId, mergeJob, maxShots);
    } catch (err) {
      jobStore.get(jobId).status = 'error';
      jobStore.get(jobId).error = 'Download failed: ' + err.message;
    }
  });
});

// Get job status/results
router.get('/jobs/:jobId', (req, res) => {
  const job = jobStore.get(req.params.jobId);
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

// Export markdown file (solves CJK filename encoding with blob downloads)
router.get('/export/:jobId', (req, res) => {
  const job = jobStore.get(req.params.jobId);
  if (!job || !job.results) return res.status(404).json({ error: '任务不存在' });

  const r = job.results;
  const videoName = (job.videoName || job.results.videoFile || 'video').replace(/\.\w{2,5}$/, '').slice(0, 20);

  const lines = ['# 视频镜头分析报告\n'];
  lines.push(`> 共 ${r.totalShots} 个镜头\n`);
  (r.shots || []).forEach((shot, i) => {
    const t0 = shot.startTime, t1 = shot.endTime;
    const tc = `${String(Math.floor(t0/60)).padStart(2,'0')}:${String(Math.floor(t0%60)).padStart(2,'0')} - ${String(Math.floor(t1/60)).padStart(2,'0')}:${String(Math.floor(t1%60)).padStart(2,'0')}`;
    lines.push('## 镜头 ' + (i + 1) + '  `' + tc + '`\n');
    lines.push('### 画面\n' + (shot.description || '') + '\n');
    if (shot.audioDescription) lines.push('### 台词\n' + shot.audioDescription + '\n');
    lines.push('---\n');
  });

  const content = '﻿' + lines.join('\n');
  const filename = encodeURIComponent(videoName + '_分析.md');

  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
  res.send(Buffer.from(content, 'utf-8'));
});

// Re-extract all frame thumbnails for a job (for when frames are missing)
router.post('/re-extract-frames/:jobId', async (req, res) => {
  const job = jobStore.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: '任务不存在' });

  const videoFiles = fs.readdirSync(path.join(config.UPLOAD_DIR, job.jobId));
  const videoPath = path.join(config.UPLOAD_DIR, job.jobId, videoFiles[0]);

  res.json({ ok: true });

  setImmediate(() => {
    detectOnly(videoPath, job.jobId, mergeJob, undefined);
  });
});

// Get all active jobs summary (for navigation history)
router.get('/jobs', (req, res) => {
  const jobs = [];
  for (const [id, job] of jobStore) {
    jobs.push({
      jobId: id,
      videoName: job.videoName || '未知',
      status: job.status,
      totalShots: job.sceneData?.totalShots || job.results?.totalShots || 0,
      shotRange: job.results?.shotRange || null,
      createdAt: job.createdAt,
    });
  }
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

module.exports = { router, jobStore };

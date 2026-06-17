const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const { router, jobStore, loadSavedJobs } = require('./routes/analyze');
const config = require('./utils/config');
const logger = require('./utils/logger');

const app = express();
app.use(express.json({ limit: '10mb' }));

// Serve static frontend files — disable cache for development
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  },
}));

// Increase request timeout for large uploads
app.use((req, res, next) => {
  req.setTimeout(10 * 60 * 1000); // 10 minutes
  res.setTimeout(10 * 60 * 1000);
  next();
});

// API routes
app.use('/api', router);

// Multer / file upload error handler
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: '文件过大，最大支持 2GB。请尝试压缩后重新上传。' });
  }
  if (err.message && err.message.includes('Unsupported')) {
    return res.status(400).json({ error: err.message });
  }
  logger.error('[server] Error:', err);
  res.status(500).json({ error: '服务器内部错误，请重试' });
});

// Startup checks
async function checkDependencies() {
  const checks = [];

  // Check ffmpeg
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(config.FFMPEG_PATH, ['-version'], { stdio: 'ignore' });
      proc.on('close', (c) => c === 0 ? resolve() : reject(new Error('ffmpeg not found')));
      proc.on('error', reject);
    });
    checks.push('ffmpeg: OK');
  } catch {
    logger.info('ERROR: ffmpeg not found. Install ffmpeg and set FFMPEG_PATH if needed.');
    process.exit(1);
  }

  // Check ffprobe
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(config.FFPROBE_PATH, ['-version'], { stdio: 'ignore' });
      proc.on('close', (c) => c === 0 ? resolve() : reject(new Error('ffprobe not found')));
      proc.on('error', reject);
    });
    checks.push('ffprobe: OK');
  } catch {
    logger.error('ERROR: ffprobe not found. Install ffmpeg (includes ffprobe) and set FFPROBE_PATH if needed.');
    process.exit(1);
  }

  // Check Python + scenedetect
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(config.PYTHON_PATH, ['-c', 'import scenedetect'], { stdio: 'ignore' });
      proc.on('close', (c) => c === 0 ? resolve() : reject(new Error('scenedetect not installed')));
      proc.on('error', reject);
    });
    checks.push('scenedetect: OK');
  } catch {
    logger.warn('WARNING: PySceneDetect not installed. Will fallback to ffmpeg scdet or uniform sampling.');
    logger.warn('  Install with: pip install scenedetect');
  }

  // Read overrides to show effective config
  const overrides = require('./utils/overrides');
  const visionProvider = overrides.get('VISION_PROVIDER') || config.VISION_PROVIDER;
  const visionModel = overrides.get('VISION_MODEL') || config.VISION_MODEL;
  const visionKey = overrides.get('VISION_API_KEY') || config.VISION_API_KEY;
  const audioProvider = overrides.get('AUDIO_PROVIDER') || config.AUDIO_PROVIDER;
  const audioModel = overrides.get('AUDIO_MODEL') || config.AUDIO_MODEL;
  const audioKey = overrides.get('AUDIO_API_KEY') || config.AUDIO_API_KEY;
  const overridden = overrides.getAll();
  const overriddenKeys = Object.keys(overridden).filter(k => k !== 'VISION_API_KEY' && k !== 'AUDIO_API_KEY');

  if (visionKey) {
    const tag = overrides.get('VISION_PROVIDER') ? '[前端]' : '[env]';
    checks.push(`视觉${tag}: ${visionProvider}/${visionModel}`);
  } else {
    logger.warn('WARNING: VISION_API_KEY not set.');
  }

  if (audioProvider === 'none') {
    checks.push('音频: 已关闭');
  } else if (audioKey) {
    const tag = overrides.get('AUDIO_PROVIDER') ? '[前端]' : '[env]';
    checks.push(`音频${tag}: ${audioProvider}/${audioModel}`);
  } else {
    logger.warn('WARNING: AUDIO_API_KEY not set.');
  }

  if (overriddenKeys.length > 0) {
    logger.info('[config] 前端覆盖生效:', overriddenKeys.join(', '));
  }

  logger.info('Dependency checks:', checks.join(', '));
}

// Start server
const port = config.PORT;

checkDependencies().then(() => {
  const savedCount = loadSavedJobs();
  if (savedCount > 0) logger.info(`Reloaded ${savedCount} saved jobs from disk`);

  const server = app.listen(port, () => {
    logger.info(`Video rePrompt server running at http://localhost:${port}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    logger.info('\nShutting down...');
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
});

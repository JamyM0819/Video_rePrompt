const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const { router, jobStore, loadSavedJobs } = require('./routes/analyze');
const config = require('./utils/config');
const { startCleanupInterval, cleanupAll } = require('./utils/cleanup');

const app = express();
app.use(express.json({ limit: '10mb' }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

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
  console.error('[server] Error:', err.message || err);
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
    console.error('ERROR: ffmpeg not found. Install ffmpeg and set FFMPEG_PATH if needed.');
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
    console.error('ERROR: ffprobe not found. Install ffmpeg (includes ffprobe) and set FFPROBE_PATH if needed.');
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
    console.warn('WARNING: PySceneDetect not installed. Will fallback to ffmpeg scdet or uniform sampling.');
    console.warn('  Install with: pip install scenedetect');
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
    console.warn('WARNING: VISION_API_KEY not set.');
  }

  if (audioProvider === 'none') {
    checks.push('音频: 已关闭');
  } else if (audioKey) {
    const tag = overrides.get('AUDIO_PROVIDER') ? '[前端]' : '[env]';
    checks.push(`音频${tag}: ${audioProvider}/${audioModel}`);
  } else {
    console.warn('WARNING: AUDIO_API_KEY not set.');
  }

  if (overriddenKeys.length > 0) {
    console.log('[config] 前端覆盖生效:', overriddenKeys.join(', '));
  }

  console.log('Dependency checks:', checks.join(', '));
}

// Start server
const port = config.PORT;

checkDependencies().then(() => {
  const savedCount = loadSavedJobs();
  if (savedCount > 0) console.log(`Reloaded ${savedCount} saved jobs from disk`);

  const cleanupTimer = startCleanupInterval(jobStore);

  const server = app.listen(port, () => {
    console.log(`Video rePrompt server running at http://localhost:${port}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\nShutting down...');
    clearInterval(cleanupTimer);
    cleanupAll(jobStore);
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
});

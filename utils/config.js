const path = require('path');
const os = require('os');
const fs = require('fs');

// Try to load .env from multiple locations
try { require('dotenv').config(); } catch {}
try { require('dotenv').config({ path: path.join(os.homedir(), '.claude', '.env') }); } catch {}
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch {}

// Fallback: try to extract DashScope key from vision.js if nothing set
function getDefaultKey() {
  if (process.env.DASHSCOPE_API_KEY) return process.env.DASHSCOPE_API_KEY;
  try {
    const visionPath = path.join(os.homedir(), '.claude', 'vision.js');
    const content = fs.readFileSync(visionPath, 'utf-8');
    const match = content.match(/const\s+API_KEY\s*=\s*[^|]+\|\|\s*["']([^"']+)["']/);
    if (match) return match[1];
  } catch {}
  return null;
}

const PROJECT_ROOT = path.join(__dirname, '..');

const VISION_PROVIDER = process.env.VISION_PROVIDER || 'dashscope';

const visionConfig = {
  dashscope: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: getDefaultKey() || '',
    model: 'qwen-vl-max',
  },
  openai: {
    baseUrl: process.env.VISION_BASE_URL || 'http://localhost:11434/v1',
    apiKey: process.env.VISION_API_KEY || 'ollama',
    model: process.env.VISION_MODEL || 'llama3.2-vision',
  },
};

const VISION_ACTIVE = visionConfig[VISION_PROVIDER] || visionConfig.dashscope;

const AUDIO_PROVIDER = process.env.AUDIO_PROVIDER || 'dashscope';

const audioConfig = {
  dashscope: {
    baseUrl: 'https://dashscope.aliyuncs.com',
    apiKey: getDefaultKey() || '',
    model: 'qwen3-asr-flash',
  },
  openai: {
    baseUrl: process.env.AUDIO_BASE_URL || 'http://localhost:8080/v1',
    apiKey: process.env.AUDIO_API_KEY || '',
    model: process.env.AUDIO_MODEL || 'whisper-1',
  },
  none: { baseUrl: '', apiKey: '', model: '' },
};

const AUDIO_ACTIVE = audioConfig[AUDIO_PROVIDER] || audioConfig.none;

module.exports = {
  PORT: process.env.PORT || 3000,
  UPLOAD_DIR: path.join(PROJECT_ROOT, 'uploads'),
  OUTPUT_DIR: path.join(PROJECT_ROOT, 'outputs'),
  MAX_FILE_SIZE: 2 * 1024 * 1024 * 1024,
  MAX_SHOTS: 100,
  MIN_SHOT_DURATION: 1.0,
  FALLBACK_INTERVAL: 5.0,
  JOB_TTL_MS: 60 * 60 * 1000,
  ALLOWED_MIMETYPES: [
    'video/mp4', 'video/quicktime', 'video/x-msvideo',
    'video/x-matroska', 'video/webm',
  ],
  ALLOWED_EXTENSIONS: ['.mp4', '.mov', '.avi', '.mkv', '.webm'],

  VISION_PROMPT: [
    '输出一段可直接用于图片生成的视觉提示词，中文，纯描述：',
    '内容包括主体（人物或物体）及其动作、场景和环境、光线与色彩、构图与镜头，',
    '面部情绪清晰可见时才写，看不清则跳过。',
    '具体细致，关注手部、口部、眼神等身体部位的细微行为，不要只概括为站立或移动。',
    '不要以"这个画面""该镜头"等词开头，不要任何评价或分析，只输出描述本身。',
  ].join(' '),

  VISION_PROVIDER,
  VISION_BASE_URL: VISION_ACTIVE.baseUrl,
  VISION_API_KEY: VISION_ACTIVE.apiKey,
  VISION_MODEL: VISION_ACTIVE.model,

  AUDIO_PROVIDER,
  AUDIO_BASE_URL: AUDIO_ACTIVE.baseUrl,
  AUDIO_API_KEY: AUDIO_ACTIVE.apiKey,
  AUDIO_MODEL: AUDIO_ACTIVE.model,

  FFMPEG_PATH: process.env.FFMPEG_PATH || 'ffmpeg',
  FFPROBE_PATH: process.env.FFPROBE_PATH || 'ffprobe',
  PYTHON_PATH: process.env.PYTHON_PATH || 'python',
};

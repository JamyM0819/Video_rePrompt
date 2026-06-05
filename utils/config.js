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

// ── 视觉模型配置 ──
// 通过环境变量切换，支持两种模式：
//
// 模式 1 — 阿里云 DashScope（默认）
//   VISION_PROVIDER=dashscope（或留空）
//   VISION_API_KEY=sk-xxx
//   默认模型: qwen-vl-max
//
// 模式 2 — OpenAI 兼容接口（Ollama / vLLM / OpenAI / Groq / 等）
//   VISION_PROVIDER=openai
//   VISION_BASE_URL=http://localhost:11434/v1     （你的 API 地址）
//   VISION_API_KEY=ollama（或你的 key）
//   VISION_MODEL=llama3.2-vision（或你用的模型名）
//
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

// ── 音频模型配置 ──
// 支持三种模式：
//
// 模式 1 — 阿里云 DashScope（默认，千问音频）
//   AUDIO_PROVIDER=dashscope（或留空）
//   默认模型: qwen-audio-turbo-latest
//
// 模式 2 — OpenAI 兼容接口（Whisper API / 本地 Whisper 等）
//   AUDIO_PROVIDER=openai
//   AUDIO_BASE_URL=http://localhost:8080/v1
//   AUDIO_API_KEY=xxx
//   AUDIO_MODEL=whisper-1
//
// 模式 3 — 跳过音频
//   AUDIO_PROVIDER=none

const AUDIO_PROVIDER = process.env.AUDIO_PROVIDER || 'dashscope';

const audioConfig = {
  dashscope: {
    // DashScope 原生 multimodal API（非 OpenAI 兼容格式）
    baseUrl: 'https://dashscope.aliyuncs.com',
    apiKey: getDefaultKey() || '',
    model: 'qwen3-asr-flash',
  },
  openai: {
    // OpenAI Whisper 兼容接口
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
    '请用中文详细描述这个视频画面的内容，作为通用的视觉参考。',
    '包括：画面中的主体（人物或物体）及其动作、场景和环境、',
    '光线与色彩调性、构图与镜头语言、以及整体的氛围和情绪。',
    '请具体、细致地描述，避免笼统和模糊的表达。',
  ].join(' '),

  // ── 视觉模型配置（统一入口）──
  VISION_PROVIDER,
  VISION_BASE_URL: VISION_ACTIVE.baseUrl,
  VISION_API_KEY: VISION_ACTIVE.apiKey,
  VISION_MODEL: VISION_ACTIVE.model,

  // ── 音频模型配置（统一入口）──
  AUDIO_PROVIDER,
  AUDIO_BASE_URL: AUDIO_ACTIVE.baseUrl,
  AUDIO_API_KEY: AUDIO_ACTIVE.apiKey,
  AUDIO_MODEL: AUDIO_ACTIVE.model,

  FFMPEG_PATH: process.env.FFMPEG_PATH || 'ffmpeg',
  FFPROBE_PATH: process.env.FFPROBE_PATH || 'ffprobe',
  PYTHON_PATH: process.env.PYTHON_PATH || 'python',
};

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const config = require('../utils/config');
const overrides = require('../utils/overrides');

function cfg(key) {
  const v = overrides.get(key);
  return (v != null && v !== '') ? v : config[key];
}

const AUDIO_PROMPT = ''; // qwen3-asr-flash doesn't need a text prompt — ASR is automatic

/**
 * Transcribe speech from an audio segment.
 * Dispatches to the correct API based on AUDIO_PROVIDER config.
 */
async function describeAudio(audioPath) {
  if (cfg('AUDIO_PROVIDER') === 'none') {
    return '[音频分析已关闭]';
  }

  try {
    const provider = cfg('AUDIO_PROVIDER');
    let text;
    if (provider === 'openai') {
      text = await transcribeOpenAI(audioPath);
    } else if (provider === 'baidu') {
      text = await transcribeBaidu(audioPath);
    } else {
      // dashscope (default) — Qwen3-ASR-Flash via OpenAI-compatible chat/completions
      text = await transcribeDashScope(audioPath);
    }

    const noSpeech = text.length < 3 || /^(无|没有|无语音|无对话|无内容|无声音|\[无语音\])$/.test(text);
    if (!text || text.trim() === '' || noSpeech) {
      return '[未检测到语音内容]';
    }
    return text.trim();
  } catch (err) {
    console.error('[audioDescribe] Failed:', err.message);
    return '[语音识别失败]';
  }
}

// ── DashScope Qwen3-ASR-Flash (OpenAI-compatible chat/completions, synchronous) ──

function transcribeDashScope(audioPath) {
  return new Promise((resolve, reject) => {
    const fileData = fs.readFileSync(audioPath);
    const ext = path.extname(audioPath).toLowerCase().replace('.', '');
    const mimeMap = { mp3: 'mpeg', wav: 'wav', m4a: 'mp4', flac: 'flac' };
    const mime = mimeMap[ext] || 'mpeg';

    // qwen3-asr-flash requires content array with ONLY the audio part (no text alongside)
    const payload = JSON.stringify({
      model: cfg('AUDIO_MODEL'),
      messages: [{
        role: 'user',
        content: [
          { type: 'audio', audio: `data:audio/${mime};base64,${fileData.toString('base64')}` },
        ],
      }],
    });

    // Use the OpenAI-compatible endpoint
    const apiUrl = new URL(cfg('AUDIO_BASE_URL').replace(/\/?$/, '/') +
      'compatible-mode/v1/chat/completions');
    const transport = apiUrl.protocol === 'https:' ? https : http;

    const req = transport.request(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg('AUDIO_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      timeout: 90000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c.toString(); });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
        try {
          const text = JSON.parse(data)?.choices?.[0]?.message?.content;
          resolve(text || '[未检测到语音内容]');
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(payload);
    req.end();
  });
}

// ── 百度短语音识别 ──

const { spawn } = require('child_process');

function convertToPcm(inputPath) {
  return new Promise((resolve, reject) => {
    // Convert to PCM WAV: 16bit, 16kHz, mono
    const outPath = inputPath.replace(/\.\w+$/, '') + '_pcm.wav';
    const proc = spawn(config.FFMPEG_PATH || 'ffmpeg', [
      '-i', inputPath,
      '-acodec', 'pcm_s16le',
      '-ac', '1',
      '-ar', '16000',
      '-y',
      outPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code === 0 && fs.existsSync(outPath)) {
        resolve(outPath);
      } else {
        reject(new Error('PCM conversion failed: ' + stderr.slice(-200)));
      }
    });
    proc.on('error', reject);
  });
}

function transcribeBaidu(audioPath) {
  return new Promise(async (resolve, reject) => {
    try {
      // Convert to PCM first
      const pcmPath = await convertToPcm(audioPath);
      const pcmData = fs.readFileSync(pcmPath);
      // Clean up temp file
      try { fs.unlinkSync(pcmPath); } catch {}

      const payload = JSON.stringify({
        format: 'pcm',
        rate: 16000,
        dev_pid: 1537,     // 1537 = 普通话 (标准版), 80001 = 极速版
        channel: 1,
        cuid: 'video-reprompt',
        token: cfg('AUDIO_API_KEY'),
        len: pcmData.length,
        speech: pcmData.toString('base64'),
      });

      const apiUrl = new URL(cfg('AUDIO_BASE_URL'));
      const transport = apiUrl.protocol === 'https:' ? https : http;

      const req = transport.request(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 60000,
      }, (res) => {
        let data = '';
        res.on('data', c => { data += c.toString(); });
        res.on('end', () => {
          if (res.statusCode >= 400) {
            return reject(new Error('百度 HTTP ' + res.statusCode + ': ' + data.slice(0, 200)));
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.err_no === 0) {
              const text = (parsed.result || []).join('');
              resolve(text || '[未检测到语音内容]');
            } else {
              reject(new Error('百度 err_no=' + parsed.err_no + ': ' + (parsed.err_msg || 'unknown')));
            }
          } catch (e) {
            reject(new Error('百度响应解析失败: ' + data.slice(0, 200)));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('百度超时')); });
      req.write(payload);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

// ── OpenAI 兼容 Whisper API ──

function transcribeOpenAI(audioPath) {
  return new Promise((resolve, reject) => {
    const boundary = '----WhisperBoundary' + Date.now();
    const fileData = fs.readFileSync(audioPath);
    const filename = path.basename(audioPath);

    const parts = [];
    const addPart = (name, value, filename, contentType) => {
      parts.push(Buffer.from(`--${boundary}\r\n`));
      let header = `Content-Disposition: form-data; name="${name}"`;
      if (filename) header += `; filename="${filename}"`;
      header += '\r\n';
      if (contentType) header += `Content-Type: ${contentType}\r\n`;
      header += '\r\n';
      parts.push(Buffer.from(header));
      parts.push(typeof value === 'string' ? Buffer.from(value) : value);
      parts.push(Buffer.from('\r\n'));
    };

    addPart('model', cfg('AUDIO_MODEL'));
    addPart('file', fileData, filename, 'audio/mpeg');
    addPart('language', 'zh');
    addPart('response_format', 'text');
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    const apiUrl = new URL(cfg('AUDIO_BASE_URL').replace(/\/?$/, '/') + 'audio/transcriptions');
    const transport = apiUrl.protocol === 'https:' ? https : http;

    const req = transport.request(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg('AUDIO_API_KEY')}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      timeout: 90000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c.toString(); });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
        const text = data.trim();
        resolve(text || '[未检测到语音内容]');
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

/**
 * Transcribe all audio segments sequentially.
 * Never throws — failures become placeholder strings.
 */
async function describeAllAudio(audioPaths, onProgress, customPrompt) {
  if (!audioPaths || audioPaths.length === 0) return [];

  if (cfg('AUDIO_PROVIDER') === 'none') {
    console.log('[audioDescribe] Audio analysis disabled (AUDIO_PROVIDER=none)');
    return audioPaths.map(() => '[音频分析已关闭]');
  }

  console.log(`[audioDescribe] Active: ${cfg('AUDIO_PROVIDER')}/${cfg('AUDIO_MODEL')} @ ${cfg('AUDIO_BASE_URL')}`);

  const concurrency = parseInt(cfg('AUDIO_CONCURRENCY') || cfg('VISION_CONCURRENCY')) || 3;
  const results = new Array(audioPaths.length);
  const timings = new Array(audioPaths.length);
  const completedAt = new Array(audioPaths.length);
  let done = 0;

  console.log(`[audioDescribe] Transcribing ${audioPaths.length} segments (concurrency=${concurrency})...`);

  const worker = async (index) => {
    const t0 = Date.now();
    results[index] = await describeAudio(audioPaths[index]);
    timings[index] = Date.now() - t0;
    completedAt[index] = Date.now();
    done++;
    console.log(`[audioDescribe] Segment ${index + 1}/${audioPaths.length}: done (${timings[index]}ms)`);
    if (onProgress) onProgress(done - 1);
  };

  for (let i = 0; i < audioPaths.length; i += concurrency) {
    const batch = [];
    for (let j = i; j < Math.min(i + concurrency, audioPaths.length); j++) {
      batch.push(worker(j));
    }
    await Promise.all(batch);
  }

  console.log(`[audioDescribe] Done: ${results.length} segments`);
  return { results, timings, completedAt };
}

module.exports = { describeAudio, describeAllAudio };

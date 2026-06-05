const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const config = require('../utils/config');

const AUDIO_PROMPT = '转写下面音频中的对话，只输出转写文字，无对话就输出"无语音"。';

/**
 * Transcribe speech from an audio segment.
 * Dispatches to the correct API based on AUDIO_PROVIDER config.
 */
async function describeAudio(audioPath) {
  if (config.AUDIO_PROVIDER === 'none') {
    return '[音频分析已关闭]';
  }

  try {
    let text;
    if (config.AUDIO_PROVIDER === 'openai') {
      text = await transcribeOpenAI(audioPath);
    } else {
      // dashscope (default)
      text = await transcribeDashScope(audioPath);
    }

    // Check if result looks like "no speech" (very short / common phrases)
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

// ── DashScope 原生 multimodal API ──

function transcribeDashScope(audioPath) {
  return new Promise((resolve, reject) => {
    const fileData = fs.readFileSync(audioPath);
    const ext = path.extname(audioPath).toLowerCase().replace('.', '');
    const mimeMap = { mp3: 'mpeg', wav: 'wav', m4a: 'mp4', flac: 'flac' };
    const mime = mimeMap[ext] || 'mpeg';

    const payload = JSON.stringify({
      model: config.AUDIO_MODEL,
      input: {
        messages: [{
          role: 'user',
          content: [
            { text: AUDIO_PROMPT },
            { audio: `data:audio/${mime};base64,${fileData.toString('base64')}` },
          ],
        }],
      },
      parameters: {},
    });

    const apiUrl = new URL(config.AUDIO_BASE_URL.replace(/\/?$/, '/') +
      'api/v1/services/aigc/multimodal-generation/generation');
    const transport = apiUrl.protocol === 'https:' ? https : http;

    const req = transport.request(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.AUDIO_API_KEY}`,
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
          const text = JSON.parse(data)?.output?.choices?.[0]?.message?.content?.[0]?.text;
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

// ── OpenAI 兼容 Whisper API ──

function transcribeOpenAI(audioPath) {
  return new Promise((resolve, reject) => {
    const boundary = '----WhisperBoundary' + Date.now();
    const fileData = fs.readFileSync(audioPath);
    const filename = path.basename(audioPath);

    // Build multipart/form-data body
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

    addPart('model', config.AUDIO_MODEL);
    addPart('file', fileData, filename, 'audio/mpeg');
    addPart('language', 'zh');
    addPart('response_format', 'text');
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    const apiUrl = new URL(config.AUDIO_BASE_URL.replace(/\/?$/, '/') + 'audio/transcriptions');
    const transport = apiUrl.protocol === 'https:' ? https : http;

    const req = transport.request(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.AUDIO_API_KEY}`,
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
        // Whisper text response is plain text (response_format: text)
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
async function describeAllAudio(audioPaths, onProgress) {
  if (!audioPaths || audioPaths.length === 0) return [];

  if (config.AUDIO_PROVIDER === 'none') {
    console.log('[audioDescribe] Audio analysis disabled (AUDIO_PROVIDER=none)');
    return audioPaths.map(() => '[音频分析已关闭]');
  }

  console.log(`[audioDescribe] Transcribing ${audioPaths.length} segments via ${config.AUDIO_PROVIDER}...`);

  const results = [];
  for (let i = 0; i < audioPaths.length; i++) {
    const text = await describeAudio(audioPaths[i]);
    results.push(text);
    if (onProgress) onProgress(i);
  }

  console.log(`[audioDescribe] Done: ${results.length} segments`);
  return results;
}

module.exports = { describeAudio, describeAllAudio };

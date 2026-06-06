const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const config = require('../utils/config');
const overrides = require('../utils/overrides');

// Resolve config value: override takes precedence over default
function cfg(key) {
  const v = overrides.get(key);
  return (v != null && v !== '') ? v : config[key];
}

/**
 * Describe a single frame image using vision AI.
 * Supports both DashScope and OpenAI-compatible APIs via config.
 */
async function describeFrame(framePath, customPrompt) {
  const prompt = config.VISION_PROMPT + (customPrompt ? '\n\n【附加要求】' + customPrompt : '');

  try {
    return await callVisionAPI(framePath, prompt);
  } catch (err) {
    console.error(`[vision] Failed:`, err.message);
    // Retry once
    try {
      await new Promise(r => setTimeout(r, 2000));
      return await callVisionAPI(framePath, prompt);
    } catch (retryErr) {
      console.error(`[vision] Retry also failed:`, retryErr.message);
      return `[分析失败: ${retryErr.message}]`;
    }
  }
}

function callVisionAPI(framePath, prompt) {
  return new Promise((resolve, reject) => {
    const imageUrl = encodeImage(framePath);
    const payload = JSON.stringify({
      model: cfg('VISION_MODEL'),
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: prompt },
        ],
      }],
      stream: false,
      max_tokens: 1024,
    });

    const apiUrl = new URL(cfg('VISION_BASE_URL').replace(/\/?$/, '/') + 'chat/completions');
    const transport = apiUrl.protocol === 'https:' ? https : http;

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    };

    // DashScope uses Bearer, OpenAI-compatible also uses Bearer
    const apiKey = cfg('VISION_API_KEY');
    if (apiKey) {
      headers['Authorization'] = 'Bearer ' + apiKey;
    }

    const req = transport.request(apiUrl, {
      method: 'POST',
      headers,
      timeout: 60000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c.toString(); });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`API ${res.statusCode}: ${data.slice(0, 300)}`));
        }
        try {
          const content = JSON.parse(data)?.choices?.[0]?.message?.content || data;
          resolve(content);
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Vision API timeout')); });
    req.write(payload);
    req.end();
  });
}

function encodeImage(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Frame not found: ${resolved}`);
  }
  const ext = path.extname(resolved).toLowerCase().replace('.', '');
  const mimeMap = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', gif: 'gif', webp: 'webp', bmp: 'bmp' };
  const mime = mimeMap[ext] || 'jpeg';
  const data = fs.readFileSync(resolved);
  return `data:image/${mime};base64,${data.toString('base64')}`;
}

/**
 * Describe all frames sequentially with retry.
 * Never throws — individual failures become error strings.
 */
async function describeAllFrames(framePaths, onProgress, customPrompt) {
  const results = [];
  const timings = [];
  for (let i = 0; i < framePaths.length; i++) {
    if (i === 0) console.log(`[vision] Active: ${cfg('VISION_PROVIDER')}/${cfg('VISION_MODEL')} @ ${cfg('VISION_BASE_URL')}`);
    console.log(`[vision] Frame ${i + 1}/${framePaths.length}: sending to API...`);
    const t0 = Date.now();
    results.push(await describeFrame(framePaths[i], customPrompt));
    const ms = Date.now() - t0;
    timings.push(ms);
    console.log(`[vision] Frame ${i + 1}/${framePaths.length}: done (${results[i].length} chars, ${ms}ms)`);
    if (onProgress) onProgress(i);
  }
  return { results, timings };
}

module.exports = { describeFrame, describeAllFrames };

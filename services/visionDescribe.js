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
      max_tokens: parseInt(cfg('VISION_MAX_TOKENS')) || 1024,
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
      timeout: 120000,
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
 * Describe a shot using 3 frames (start, middle, end) to capture temporal changes.
 */
async function describeShot(frames, customPrompt) {
  if (frames.length === 1) return describeFrame(frames[0], customPrompt);

  let prompt = config.VISION_PROMPT;
  prompt += '\n\n以上是同一个镜头的3张截图，按时间顺序排列[start → middle → end]。请描述这个镜头的完整动态过程：人物的动作变化、情绪变化、镜头运动、以及任何画面的连续转变。不要分开描述每张图，而是作为一个连续的时间段来描述。';
  if (customPrompt) prompt += '\n\n【附加要求】' + customPrompt;

  try {
    return await callVisionMultiAPI(frames, prompt);
  } catch (err) {
    console.error(`[vision] Multi-frame failed:`, err.message);
    try {
      await new Promise(r => setTimeout(r, 2000));
      return await callVisionMultiAPI(frames, prompt);
    } catch (retryErr) {
      console.error(`[vision] Multi-frame retry also failed:`, retryErr.message);
      return `[分析失败: ${retryErr.message}]`;
    }
  }
}

function callVisionMultiAPI(framePaths, prompt) {
  return new Promise((resolve, reject) => {
    const content = framePaths.map(fp => ({
      type: 'image_url',
      image_url: { url: encodeImage(fp) },
    }));
    content.push({ type: 'text', text: prompt });

    const payload = JSON.stringify({
      model: cfg('VISION_MODEL'),
      messages: [{ role: 'user', content }],
      stream: false,
      max_tokens: parseInt(cfg('VISION_MAX_TOKENS')) || 1536,
    });

    const apiUrl = new URL(cfg('VISION_BASE_URL').replace(/\/?$/, '/') + 'chat/completions');
    const transport = apiUrl.protocol === 'https:' ? https : http;

    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
    const apiKey = cfg('VISION_API_KEY');
    if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;

    const req = transport.request(apiUrl, {
      method: 'POST', headers, timeout: 120000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c.toString(); });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`API ${res.statusCode}: ${data.slice(0, 300)}`));
        try {
          resolve(JSON.parse(data)?.choices?.[0]?.message?.content || data);
        } catch (e) { resolve(data); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Vision API timeout')); });
    req.write(payload);
    req.end();
  });
}
const VIDEO_PROMPT = [
  '这是一个完整镜头的视频片段。请描述：',
  '- 人物的动作变化过程（从什么变成什么）',
  '- 情绪变化过程',
  '- 镜头是否在运动（如果有，推拉摇移跟？）',
  '- 该镜头在讲述什么情节',
  '请当作一个连续的时间段来描述，不要逐帧列举。',
].join('\n');

/**
 * Describe a shot using video clip mode (video_url).
 */
async function describeVideoClip(clipPath, customPrompt) {
  let prompt = VIDEO_PROMPT;
  if (customPrompt) prompt += '\n\n【附加要求】' + customPrompt;

  try {
    return await callVideoAPI(clipPath, prompt);
  } catch (err) {
    console.error(`[vision-video] Failed:`, err.message);
    try {
      await new Promise(r => setTimeout(r, 2000));
      return await callVideoAPI(clipPath, prompt);
    } catch (retryErr) {
      console.error(`[vision-video] Retry also failed:`, retryErr.message);
      return `[视频分析失败: ${retryErr.message}]`;
    }
  }
}

function callVideoAPI(clipPath, prompt) {
  return new Promise((resolve, reject) => {
    const resolved = path.resolve(clipPath);
    const ext = path.extname(resolved).toLowerCase().replace('.', '');
    const mimeMap = { mp4: 'mp4', webm: 'webm', mov: 'quicktime', avi: 'avi', mkv: 'x-matroska' };
    const mime = mimeMap[ext] || 'mp4';
    const data = fs.readFileSync(resolved);
    const videoUrl = `data:video/${mime};base64,${data.toString('base64')}`;

    console.log(`[vision-video] Sending clip: ${path.basename(clipPath)} (${(data.length/1024/1024).toFixed(1)}MB)`);

    const payload = JSON.stringify({
      model: cfg('VISION_MODEL'),
      messages: [{
        role: 'user',
        content: [
          { type: 'video_url', video_url: { url: videoUrl } },
          { type: 'text', text: prompt },
        ],
      }],
      stream: false,
      max_tokens: parseInt(cfg('VISION_MAX_TOKENS')) || 1536,
    });

    const apiUrl = new URL(cfg('VISION_BASE_URL').replace(/\/?$/, '/') + 'chat/completions');
    const transport = apiUrl.protocol === 'https:' ? https : http;

    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
    const apiKey = cfg('VISION_API_KEY');
    if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;

    const req = transport.request(apiUrl, {
      method: 'POST', headers, timeout: 180000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c.toString(); });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`Video API ${res.statusCode}: ${data.slice(0, 300)}`));
        try {
          resolve(JSON.parse(data)?.choices?.[0]?.message?.content || data);
        } catch (e) { resolve(data); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Video API timeout')); });
    req.write(payload);
    req.end();
  });
}

/**
 * Describe all shots in video mode.
 */
async function describeAllVideoClips(clipPaths, onProgress, customPrompt) {
  const results = new Array(clipPaths.length);
  let done = 0;

  console.log(`[vision-video] Starting ${clipPaths.length} video clips...`);

  const workers = [];
  for (let i = 0; i < clipPaths.length; i++) {
    workers.push((async (idx) => {
      results[idx] = await describeVideoClip(clipPaths[idx], customPrompt);
      done++;
      console.log(`[vision-video] Clip ${idx + 1}/${clipPaths.length}: done (${results[idx].length} chars)`);
      if (onProgress) onProgress(done - 1);
    })(i));
  }
  await Promise.all(workers);

  return results;
}

async function describeAllFrames(framePaths, onProgress, customPrompt) {
  const concurrency = parseInt(cfg('VISION_CONCURRENCY')) || 5;
  const results = new Array(framePaths.length);
  const timings = new Array(framePaths.length);
  const completedAt = new Array(framePaths.length);
  let next = 0;
  let done = 0;

  console.log(`[vision] Active: ${cfg('VISION_PROVIDER')}/${cfg('VISION_MODEL')} @ ${cfg('VISION_BASE_URL')}`);
  console.log(`[vision] Starting ${framePaths.length} frames (concurrency=${concurrency})...`);

  const worker = async () => {
    while (next < framePaths.length) {
      const i = next++;
      const t0 = Date.now();
      results[i] = await describeFrame(framePaths[i], customPrompt);
      timings[i] = Date.now() - t0;
      completedAt[i] = Date.now();
      done++;
      console.log(`[vision] Frame ${i + 1}/${framePaths.length}: done (${results[i].length} chars, ${timings[i]}ms)`);
      if (onProgress) onProgress(done - 1);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, framePaths.length) }, () => worker()));

  return { results, timings, completedAt };
}

module.exports = { describeFrame, describeAllFrames, describeAllVideoClips };

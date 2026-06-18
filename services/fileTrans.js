/**
 * DashScope FileTrans — upload full audio to OSS, submit async ASR,
 * poll until complete, return word-level timestamps.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const config = require('../utils/config');
const overrides = require('../utils/overrides');
const logger = require('../utils/logger');

const BASE = 'https://dashscope.aliyuncs.com/api/v1';
const MODEL = 'qwen3-asr-flash-filetrans';

function apiKey() { return overrides.get('AUDIO_API_KEY') || config.AUDIO_API_KEY; }

function apiReq(method, urlStr, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const url = new URL(urlStr);
    const t = url.protocol === 'https:' ? https : http;
    const headers = {
    'Authorization': `Bearer ${apiKey()}`,
    'X-DashScope-Async': 'enable',
    ...(extraHeaders || {}),
  };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    const r = t.request(url, { method, headers, timeout: 120000 }, (resp) => {
      let d = '';
      resp.on('data', c => d += c.toString());
      resp.on('end', () => {
        try { resolve({ status: resp.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: resp.statusCode, body: d }); }
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('Timeout')); });
    if (payload) r.write(payload);
    r.end();
  });
}

// ── OSS Upload ──

async function uploadToOSS(filePath) {
  const ext = path.extname(filePath);
  const polRes = await apiReq('GET', `${BASE}/uploads?action=getPolicy&model=${MODEL}`, null);
  if (polRes.status !== 200 || !polRes.body?.data) throw new Error('getPolicy failed');
  const pol = polRes.body.data;

  const ossKey = `${pol.upload_dir}/${Date.now()}_audio${ext}`;
  const fileData = fs.readFileSync(filePath);
  const boundary = '----Boundary' + Math.random().toString(36).slice(2);
  const parts = [];

  const addField = (name, value) => {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  };
  addField('OSSAccessKeyId', pol.oss_access_key_id);
  addField('Signature', pol.signature);
  addField('policy', pol.policy);
  addField('x-oss-object-acl', 'private');
  addField('x-oss-forbid-overwrite', 'true');
  addField('key', ossKey);
  addField('success_action_status', '200');
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio${ext}"\r\nContent-Type: audio/mpeg\r\n\r\n`));
  parts.push(fileData);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(parts);

  const upResult = await new Promise((resolve, reject) => {
    const url = new URL(pol.upload_host);
    const r = (url.protocol === 'https:' ? https : http).request(url, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
      timeout: 120000,
    }, (resp) => { let d = ''; resp.on('data', c => d += c.toString()); resp.on('end', () => resolve({ status: resp.statusCode })); });
    r.on('error', reject);
    r.write(body);
    r.end();
  });
  if (upResult.status !== 200) throw new Error('OSS upload returned ' + upResult.status);
  return `oss://${ossKey}`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Transcribe ──

async function transcribeFileTrans(audioPath) {
  const key = apiKey();
  if (!key) throw new Error('AUDIO_API_KEY not set');
  if (!fs.existsSync(audioPath)) throw new Error('Audio not found: ' + audioPath);

  const t0 = Date.now();
  logger.info(`[filetrans] Uploading ${path.basename(audioPath)} (${(fs.statSync(audioPath).size / 1024).toFixed(0)}KB)...`);

  const tUp = Date.now();
  const ossUrl = await uploadToOSS(audioPath);
  logger.info(`[filetrans] OSS upload: ${Date.now() - tUp}ms`);

  const sub = await apiReq('POST', `${BASE}/services/audio/asr/transcription`, {
    model: MODEL,
    input: { file_url: ossUrl },
    parameters: { channel_id: [0], enable_words: true, enable_itn: false },
  }, { 'X-DashScope-OssResourceResolve': 'enable' });

  if (sub.status !== 200 || !sub.body?.output?.task_id) {
    throw new Error('Submit failed: ' + JSON.stringify(sub.body).slice(0, 300));
  }
  const taskId = sub.body.output.task_id;
  logger.info(`[filetrans] Task: ${taskId}`);

  let polls = 0, pollResult;
  while (true) {
    polls++;
    await new Promise(r => setTimeout(r, 2000));
    pollResult = await apiReq('GET', `${BASE}/tasks/${taskId}`, null);
    const status = pollResult.body?.output?.task_status;
    if (status === 'SUCCEEDED' || status === 'FAILED') break;
  }
  if (pollResult.body.output.task_status !== 'SUCCEEDED') {
    throw new Error('Task failed: ' + JSON.stringify(pollResult.body).slice(0, 300));
  }
  logger.info(`[filetrans] Poll done: ${polls} polls, ${Date.now() - tUp}ms`);

  const tUrl = pollResult.body.output.result?.transcription_url;
  if (!tUrl) throw new Error('No transcription_url');

  // Download with retry (DNS can fail intermittently)
  let transcript, lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await sleep(1000 * attempt);
    try {
      transcript = await new Promise((resolve, reject) => {
        const u = new URL(tUrl);
        const req = (u.protocol === 'https:' ? https : http).get(u, (resp) => {
          let d = '';
          resp.on('data', c => d += c.toString());
          resp.on('end', () => resolve(JSON.parse(d)));
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Download timeout')); });
      });
      break; // success
    } catch (e) {
      lastErr = e;
      logger.warn(`[filetrans] Download attempt ${attempt + 1}/5 failed: ${e.message}`);
    }
  }
  if (!transcript) throw lastErr || new Error('Download failed after 5 attempts');

  const sents = transcript?.transcripts?.[0]?.sentences || [];
  const wordCount = sents.reduce((n, s) => n + (s.words?.length || 0), 0);
  logger.info(`[filetrans] Done: ${sents.length} sentences, ${wordCount} words — ${Date.now() - t0}ms (${pollResult.body.usage?.seconds || '?'}s billed)`);

  return {
    sentences: sents,
    wordCount,
    fullText: sents.map(s => s.text).join(''),
    timing: { uploadMs: tUp - t0, pollMs: Date.now() - tUp, totalMs: Date.now() - t0, polls },
    usage: pollResult.body.usage,
  };
}

/**
 * Split sentences into comma-delimited phrases, each with time range.
 * A split occurs at any word whose punctuation is ',' or '，' or '、'.
 */
function splitByComma(sentences) {
  const phrases = [];
  sentences.forEach(sent => {
    if (!sent.words || sent.words.length === 0) return;
    let start = 0;
    for (let i = 0; i < sent.words.length; i++) {
      const punc = sent.words[i].punctuation || '';
      if (punc === '，' || punc === ',' || punc === '、') {
        // End phrase at this word
        phrases.push({
          text: sent.words.slice(start, i + 1).map(w => w.text).join('') + punc,
          startSec: sent.words[start].begin_time / 1000,
          endSec: sent.words[i].end_time / 1000,
        });
        start = i + 1;
      }
    }
    // Remaining words after last comma
    if (start < sent.words.length) {
      phrases.push({
        text: sent.words.slice(start).map(w => w.text).join(''),
        startSec: sent.words[start].begin_time / 1000,
        endSec: sent.words[sent.words.length - 1].end_time / 1000,
      });
    }
  });
  return phrases;
}

/**
 * Assign comma-phrases to shots by time overlap.
 * Each phrase goes to every shot it overlaps with.
 */
function assignToShots(sentences, scenes) {
  if (!sentences || sentences.length === 0) return scenes.map(() => '');
  if (!scenes || scenes.length === 0) return [];

  const phrases = splitByComma(sentences);
  const results = scenes.map(() => '');

  phrases.forEach(ph => {
    for (let i = 0; i < scenes.length; i++) {
      const sceneStart = scenes[i].startTime;
      const sceneEnd = scenes[i].endTime;
      const overlap = Math.min(sceneEnd, ph.endSec) - Math.max(sceneStart, ph.startSec);
      if (overlap > 0) {
        if (results[i]) results[i] += ph.text;
        else results[i] = ph.text;
      }
      if (sceneStart > ph.endSec) break;
    }
  });

  return results.map(r => r.trim() || '');
}

module.exports = { transcribeFileTrans, assignToShots };

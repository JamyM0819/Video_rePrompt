const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Known video platforms that don't serve direct video links
const PLATFORM_URLS = {
  'bilibili.com': 'B站链接不是直链视频。请先用工具下载视频到本地，再通过"上传文件"分析。',
  'b23.tv': 'B站短链接不是直链视频。请先用工具下载视频到本地，再通过"上传文件"分析。',
  'youtube.com': 'YouTube 链接不是直链视频。请先用工具下载视频到本地，再通过"上传文件"分析。',
  'youtu.be': 'YouTube 短链接不是直链视频。请先用工具下载视频到本地，再通过"上传文件"分析。',
  'vimeo.com': 'Vimeo 链接不是直链视频。请先用工具下载视频到本地，再通过"上传文件"分析。',
  'douyin.com': '抖音链接不是直链视频。请先用工具下载视频到本地，再通过"上传文件"分析。',
  'tiktok.com': 'TikTok 链接不是直链视频。请先用工具下载视频到本地，再通过"上传文件"分析。',
};

/**
 * Download a video from a URL to the uploads directory.
 * Only supports direct video URLs (ending in .mp4, .mov, etc.).
 */
async function downloadVideo(url, jobId, uploadDir) {
  const parsed = new URL(url);

  // Check if it's a known video platform (not a direct video link)
  const hostname = parsed.hostname.toLowerCase();
  for (const [domain, msg] of Object.entries(PLATFORM_URLS)) {
    if (hostname.includes(domain)) {
      throw new Error(msg);
    }
  }

  const transport = parsed.protocol === 'https:' ? https : http;

  // Extract filename from URL path
  let filename = path.basename(parsed.pathname);
  if (!filename || filename === '/') filename = 'video.mp4';
  // Ensure it has a video-like extension
  if (!/\.(mp4|mov|avi|mkv|webm|flv|ts|m4v|wmv)$/i.test(filename)) {
    throw new Error(
      '该链接看起来不是直链视频（不以 .mp4 等视频扩展名结尾）。\n\n' +
      '请提供直接指向视频文件的链接，或先将视频下载到本地后通过"上传文件"按钮上传。'
    );
  }

  const destDir = path.join(uploadDir, jobId);
  fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, filename);

  return new Promise((resolve, reject) => {
    const doRequest = (urlStr, redirectCount) => {
      if (redirectCount > 5) {
        return reject(new Error('重定向次数过多，下载失败'));
      }

      const req = transport.get(urlStr, {
        timeout: 300000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      }, (res) => {
        // Handle redirects
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          const location = res.headers.location;
          if (location) {
            return doRequest(new URL(location, urlStr).href, redirectCount + 1);
          }
        }

        if (res.statusCode >= 400) {
          return reject(new Error(`下载失败: HTTP ${res.statusCode}`));
        }

        // Check Content-Type — must be video
        const contentType = (res.headers['content-type'] || '').toLowerCase();
        const videoTypes = ['video/', 'application/octet-stream', 'binary/octet-stream'];
        const isVideoContentType = videoTypes.some(t => contentType.startsWith(t));

        if (contentType && !isVideoContentType) {
          return reject(new Error(
            `该链接返回的不是视频（Content-Type: ${contentType}），而是一个网页或其它内容。\n\n` +
            '请提供直接指向 .mp4 等视频文件的链接，或先将视频下载到本地后上传。'
          ));
        }

        const totalSize = parseInt(res.headers['content-length'], 10) || 0;
        if (totalSize > 0 && totalSize < 1024) {
          return reject(new Error('下载的文件太小（不足 1KB），不是有效的视频文件'));
        }

        const file = fs.createWriteStream(destPath);
        let downloaded = 0;
        let firstChunk = null;

        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (!firstChunk) firstChunk = chunk.slice(0, 512);
          file.write(chunk);
        });

        res.on('end', () => {
          file.end();

          // Validate downloaded content is actually a video (not HTML/JSON/text)
          if (firstChunk) {
            const header = Buffer.from(firstChunk).toString('utf-8', 0, 512).trim().toLowerCase();

            // Check for HTML/XML markers (with possible leading whitespace/BOM)
            if (
              header.startsWith('<!doctype') ||
              header.startsWith('<html') ||
              header.startsWith('<?xml') ||
              header.includes('<html') ||
              header.includes('<!doctype')
            ) {
              file.close();
              try { fs.unlinkSync(destPath); } catch {}
              return reject(new Error(
                '下载到的是网页内容，不是视频文件。该链接可能是一个视频平台页面而非直链视频。\n\n' +
                '请提供直接指向 .mp4 文件的链接，或先下载到本地后上传。'
              ));
            }

            // Check for JSON (API response)
            if (header.startsWith('{') || header.startsWith('[')) {
              file.close();
              try { fs.unlinkSync(destPath); } catch {}
              return reject(new Error('下载到的是 JSON 数据，不是视频文件。该链接不是一个直链视频。'));
            }

            // Check for common video signatures
            // MP4 starts with ftyp, AVI with RIFF, WebM with \x1a\x45\xdf\xa3, MKV with \x1a\x45\xdf\xa3
            const raw = Buffer.from(firstChunk);
            const hasVideoSig =
              (raw[4] === 0x66 && raw[5] === 0x74 && raw[6] === 0x79 && raw[7] === 0x70) || // ftyp (MP4)
              (raw[0] === 0x52 && raw[1] === 0x49 && raw[2] === 0x46 && raw[3] === 0x46) || // RIFF (AVI)
              (raw[0] === 0x1a && raw[1] === 0x45 && raw[2] === 0xdf && raw[3] === 0xa3) || // EBML (WebM/MKV)
              (raw[0] === 0x00 && raw[1] === 0x00 && raw[2] === 0x00);                     // Some MP4 variants

            if (!hasVideoSig && !contentType.startsWith('video/')) {
              file.close();
              try { fs.unlinkSync(destPath); } catch {}
              return reject(new Error(
                '下载的文件不像是视频格式。可能原因：\n' +
                '1. 该链接指向的是网页而非直链视频\n' +
                '2. 需要 cookie 或特殊请求头才能访问\n' +
                '3. 链接已过期\n\n' +
                '请尝试先将视频下载到本地，再通过"上传文件"功能分析。'
              ));
            }
          }

          if (totalSize > 0 && downloaded < totalSize * 0.99) {
            return reject(new Error('下载不完整，请重试'));
          }
          if (downloaded === 0) {
            return reject(new Error('下载的文件为空'));
          }
          resolve({ path: destPath, filename, size: downloaded });
        });

        res.on('error', (err) => { file.close(); reject(err); });
        file.on('error', reject);
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('下载超时')); });
    };

    doRequest(url, 0);
  });
}

module.exports = { downloadVideo };

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const youtubedl = require('youtube-dl-exec');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory API key store (use a DB in production)
const apiKeys = new Map();
// Rate limit store for API key generation
const keyGenerationRates = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// ── Format info cache (avoids repeated slow yt-dlp calls) ──
const formatCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
function getCachedInfo(url) {
  const entry = formatCache.get(url);
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry.data;
  return null;
}
function setCachedInfo(url, data) {
  formatCache.set(url, { data, ts: Date.now() });
  // Evict old entries
  if (formatCache.size > 200) {
    const oldest = formatCache.keys().next().value;
    formatCache.delete(oldest);
  }
}
const MAX_KEYS_PER_WINDOW = 5;

app.use(cors());
app.use(express.json());

// ═══════════════════════════════════════
//  MIDDLEWARE: Optional API Key Auth
// ═══════════════════════════════════════
function optionalAuth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key && !apiKeys.has(key)) {
    return res.status(401).json({ status: 'error', text: 'Invalid API key.' });
  }
  req.apiUser = key ? apiKeys.get(key) : null;
  next();
}

// Headless Scraper for Cloud Storage Links (Terabox/Diskwala)
async function extractCloudVideo(url) {
  let browser;
  try {
    console.log(`[PUPPETEER-STEALTH] Launching headless browser for ${url}`);
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--disable-web-security',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });
    const page = await browser.newPage();
    
    // Removed mobile user agent - Diskwala hides videos on mobile and forces an app download
    // await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36');
    // await page.setViewport({ width: 412, height: 915 });

    let mediaUrl = null;
    
    await page.setRequestInterception(true);
    page.on('request', request => request.continue());

    page.on('response', async response => {
      try {
        const respUrl = response.url();
        const contentType = response.headers()['content-type'] || '';
        if ((contentType.includes('video/') || respUrl.includes('.mp4') || respUrl.includes('.m3u8')) && !respUrl.includes('blob:')) {
          if (!mediaUrl) mediaUrl = respUrl;
        }
      } catch (e) {}
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Wait for JS challenges / ads / video elements to resolve (reduced from 8s)
    await new Promise(r => setTimeout(r, 4000));

    // If media already intercepted during page load, return early
    if (mediaUrl) {
      await browser.close();
      return mediaUrl;
    }
    
    // Check main page and all iframes
    if (!mediaUrl) {
      // First check DOM for YouTube embeds
      const embedUrl = await page.evaluate(() => {
        const iframes = Array.from(document.querySelectorAll('iframe'));
        for (const f of iframes) {
          if (f.src && (f.src.includes('youtube.com/embed/') || f.src.includes('youtu.be/'))) {
            return f.src;
          }
        }
        return null;
      });

      if (embedUrl) {
        let videoId = '';
        if (embedUrl.includes('/embed/')) {
          videoId = embedUrl.split('/embed/')[1].split('?')[0];
        } else if (embedUrl.includes('youtu.be/')) {
          videoId = embedUrl.split('youtu.be/')[1].split('?')[0];
        }
        if (videoId) {
          mediaUrl = `https://www.youtube.com/watch?v=${videoId}`;
          console.log(`[PUPPETEER] Found wrapped YouTube video via DOM: ${mediaUrl}`);
        }
      }

      // Then check cross-origin frames for raw video tags
      if (!mediaUrl) {
        for (const frame of page.frames()) {
          try {
            const src = await frame.evaluate(() => {
              const vid = document.querySelector('video');
              if (vid && vid.src && !vid.src.includes('blob:')) return vid.src;
              return null;
            });
            if (src) {
              mediaUrl = src;
              break;
            }
          } catch (e) {}
        }
      }
    }

    await browser.close();
    return mediaUrl;
  } catch (err) {
    console.error(`[PUPPETEER] Error:`, err.message);
    if (browser) await browser.close();
    throw err;
  }
}

function checkCloudStorage(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.includes('diskwala.com')) {
      return { isCloud: true, unsupported: true, reason: 'Diskwala no longer hosts web videos. These links only work inside the Diskwala app.' };
    }
    if (host.includes('terabox.com') || host.includes('nephobox.com') || host.includes('4funbox.com') ||
        host.includes('teraboxapp.com') || host.includes('1024tera.com') || host.includes('freeterabox.com')) {
      return { isCloud: true };
    }
    return { isCloud: false };
  } catch (e) {
    return { isCloud: false };
  }
}

// ═══════════════════════════════════════
//  POST /api/key — Generate API Key
// ═══════════════════════════════════════
app.post('/api/key', (req, res) => {
  const { name } = req.body;
  const username = name || 'Anonymous';

  if (username !== 'destopadmin') {
    const now = Date.now();
    let userRate = keyGenerationRates.get(username);
    
    if (!userRate) {
      userRate = { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS };
      keyGenerationRates.set(username, userRate);
    }
    
    if (now > userRate.resetTime) {
      userRate.count = 0;
      userRate.resetTime = now + RATE_LIMIT_WINDOW_MS;
    }
    
    if (userRate.count >= MAX_KEYS_PER_WINDOW) {
      return res.status(429).json({ 
        status: 'error', 
        text: 'Rate limit exceeded for API key generation. Please try again later.' 
      });
    }
    
    userRate.count++;
  }

  const key = 'dp_' + crypto.randomBytes(24).toString('hex');
  const created = new Date().toISOString();
  apiKeys.set(key, { name: username, created, requests: 0 });
  console.log(`[+] API Key generated: ${key.slice(0, 12)}... for "${username}"`);
  res.json({ status: 'success', key, name: username, created });
});

// ═══════════════════════════════════════
//  POST /api/info — Get Media Info
// ═══════════════════════════════════════
app.post('/api/info', optionalAuth, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ status: 'error', text: 'Missing URL.' });

  console.log(`[INFO] Fetching info for: ${url}`);
  
  const cloudData = checkCloudStorage(url);
  if (cloudData.unsupported) {
    return res.status(400).json({ status: 'error', text: cloudData.reason });
  }
  const isCloudStorage = cloudData.isCloud;
  
  if (isCloudStorage) {
    return res.json({
      status: 'success',
      title: 'Cloud Video',
      thumbnail: '',
      duration: 0,
      uploader: 'Cloud Storage',
      description: 'Video hosted on a cloud storage platform.',
      webpage_url: url
    });
  }

  try {
    let info = getCachedInfo(url);
    if (!info) {
      info = await youtubedl(url, {
        dumpSingleJson: true,
        noWarnings: true,
        skipDownload: true,
        noPlaylist: true,
        noCheckCertificates: true,
        socketTimeout: 10
      });
      setCachedInfo(url, info);
    }

    res.json({
      status: 'success',
      title: info.title || 'Unknown',
      thumbnail: info.thumbnail || info.thumbnails?.[info.thumbnails.length - 1]?.url || '',
      duration: info.duration || 0,
      uploader: info.uploader || info.channel || '',
      description: (info.description || '').slice(0, 300),
      webpage_url: info.webpage_url || url
    });
  } catch (err) {
    console.error('[-] Info error:', err.message);
    res.status(400).json({ status: 'error', text: 'Could not fetch media info.' });
  }
});

// ═══════════════════════════════════════
//  Helper: Process yt-dlp info into formats response
// ═══════════════════════════════════════
function processFormatsResponse(info, res) {
  const videoFormats = [];
  const audioFormats = [];
  const seen = new Set();

  (info.formats || []).forEach(f => {
    if (!f.url || !f.url.startsWith('http')) return;

    if (f.vcodec && f.vcodec !== 'none') {
      const label = `${f.height || '?'}p`;
      const key = `${f.height}-${f.ext}`;
      if (!seen.has(key)) {
        seen.add(key);
        videoFormats.push({
          format_id: f.format_id,
          ext: f.ext,
          height: f.height || 0,
          label,
          filesize: f.filesize || f.filesize_approx || null,
          vcodec: f.vcodec,
          acodec: f.acodec,
          url: (f.acodec && f.acodec !== 'none') ? f.url : null
        });
      }
    }

    if (f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none')) {
      const label = `${Math.round(f.abr) || '?'}kbps`;
      const ext = f.ext === 'm4a' || f.ext === 'webm' ? f.ext : 'mp3';
      const key = `audio-${Math.round(f.abr)}-${ext}`;
      if (!seen.has(key)) {
        seen.add(key);
        audioFormats.push({
          format_id: f.format_id,
          ext: ext,
          abr: f.abr || 0,
          label,
          filesize: f.filesize || f.filesize_approx || null,
          acodec: f.acodec
        });
      }
    }
  });

  videoFormats.sort((a, b) => (b.height || 0) - (a.height || 0));
  audioFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0));

  return res.json({
    status: 'success',
    title: info.title || '',
    thumbnail: info.thumbnail || info.thumbnails?.[info.thumbnails.length - 1]?.url || '',
    duration: info.duration || 0,
    video: videoFormats,
    audio: audioFormats
  });
}

// ═══════════════════════════════════════
//  POST /api/formats — List Qualities
// ═══════════════════════════════════════
app.post('/api/formats', optionalAuth, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ status: 'error', text: 'Missing URL.' });

  console.log(`[FORMATS] Listing formats for: ${url}`);
  
  const cloudData = checkCloudStorage(url);
  if (cloudData.unsupported) {
    return res.status(400).json({ status: 'error', text: cloudData.reason });
  }
  const isCloudStorage = cloudData.isCloud;

  try {
    if (isCloudStorage) {
      console.log(`[FORMATS] Cloud storage detected. Trying yt-dlp first, then Puppeteer...`);
      // Try yt-dlp first (it supports terabox natively now)
      try {
        const cloudInfo = await youtubedl(url, {
          dumpSingleJson: true,
          noWarnings: true,
          skipDownload: true,
          noPlaylist: true,
          socketTimeout: 15
        });
        if (cloudInfo && cloudInfo.formats && cloudInfo.formats.length > 0) {
          console.log(`[FORMATS] yt-dlp succeeded for cloud link`);
          // Process like a normal link — fall through below
          return processFormatsResponse(cloudInfo, res);
        }
      } catch (ytErr) {
        console.log(`[FORMATS] yt-dlp failed for cloud link: ${ytErr.message}. Falling back to Puppeteer...`);
      }
      // Fallback: Puppeteer extraction
      try {
        const streamUrl = await extractCloudVideo(url);
        if (streamUrl) {
          return res.json({
            status: 'success',
            title: 'Cloud Video',
            thumbnail: '',
            duration: 0,
            video: [{ format_id: 'cloud_direct', label: 'Max Quality', ext: 'mp4', filesize: null }],
            audio: [],
            cloudUrl: streamUrl
          });
        }
      } catch (puppErr) {
        console.log(`[FORMATS] Puppeteer also failed: ${puppErr.message}`);
      }
      return res.json({
        status: 'success',
        title: 'Cloud Video',
        thumbnail: '',
        duration: 0,
        video: [{ format_id: 'max', label: 'Max Quality', ext: 'mp4', filesize: null }],
        audio: []
      });
    }

    // Check cache first
    let info = getCachedInfo(url);
    if (!info) {
      console.log(`[FORMATS] Cache miss, calling yt-dlp...`);
      info = await youtubedl(url, {
        dumpSingleJson: true,
        noWarnings: true,
        skipDownload: true,
        noPlaylist: true,
        noCheckCertificates: true,
        socketTimeout: 10
      });
      setCachedInfo(url, info);
    } else {
      console.log(`[FORMATS] Cache hit!`);
    }

    return processFormatsResponse(info, res);
  } catch (err) {
    console.error('[-] Formats error:', err.message);
    res.status(400).json({ status: 'error', text: 'Could not list formats.' });
  }
});

// ═══════════════════════════════════════
//  POST /api/json — Download Video Stream
// ═══════════════════════════════════════
app.post('/api/json', optionalAuth, async (req, res) => {
  let { url, videoQuality, format_id } = req.body;
  if (!url) return res.status(400).json({ status: 'error', text: 'Missing URL.' });

  console.log(`[DOWNLOAD] ${url} (Quality: ${videoQuality || 'max'}, Format: ${format_id || 'auto'})`);

  const lower = url.toLowerCase();
  const cloudData = checkCloudStorage(url);
  if (cloudData.unsupported) {
    return res.status(400).json({ status: 'error', text: cloudData.reason });
  }
  let isCloudStorage = cloudData.isCloud;

  try {
    if (isCloudStorage) {
      console.log(`[DOWNLOAD] Attempting Puppeteer extraction for cloud link...`);
      const streamUrl = await extractCloudVideo(url);
      if (streamUrl) {
        if (streamUrl.includes('youtube.com') || streamUrl.includes('youtu.be')) {
          console.log(`[+] Cloud link unwrapped to YouTube: ${streamUrl}`);
          // Update URL and continue to yt-dlp handling below
          url = streamUrl;
        } else {
          if (req.apiUser) req.apiUser.requests++;
          console.log(`[+] Cloud Stream URL extracted successfully`);
          return res.json({
            status: 'redirect',
            url: streamUrl,
            title: 'Cloud Video Download',
            ext: 'mp4'
          });
        }
      } else {
        return res.status(400).json({ status: 'error', text: 'Could not extract direct stream URL. Try opening the link in your browser.' });
      }
    }

    const lowerStr = url.toLowerCase(); // Re-evaluate in case url was unwrapped

    if (format_id && format_id !== 'max' && format_id !== 'auto') {
      // If a specific format is requested, just dump that format
      const output = await youtubedl(url, {
        dumpJson: true,
        noWarnings: true,
        format: format_id
      });
      if (output && output.url) {
        if (req.apiUser) req.apiUser.requests++;
        return res.json({
          status: 'redirect',
          url: output.url,
          title: output.title || 'video',
          ext: output.ext || 'mp4'
        });
      }
    }

    // Handle qualities
    let formatStr = 'best'; // Default max pre-muxed
    let requiresMerge = false;

    if (videoQuality === '1080p' || videoQuality === '1080') {
      formatStr = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';
      requiresMerge = true;
    } else if (videoQuality === '720p' || videoQuality === '720') {
      formatStr = 'bestvideo[height<=720]+bestaudio/best[height<=720]/best';
      requiresMerge = true;
    } else if (videoQuality === '480p' || videoQuality === '480') {
      formatStr = 'best[height<=480]';
    } else if (videoQuality === '360p' || videoQuality === '360') {
      formatStr = 'best[height<=360]';
    } else if (videoQuality === 'audio') {
      formatStr = 'bestaudio/best';
    } else {
      // max quality
      formatStr = 'bestvideo+bestaudio/best';
      requiresMerge = true;
    }

    if (requiresMerge && lowerStr.includes('youtube')) {
      // For high quality youtube, we proxy the stream through our server to merge with ffmpeg
      if (req.apiUser) req.apiUser.requests++;
      const proxyUrl = `http://localhost:${PORT}/api/stream?url=${encodeURIComponent(url)}&format=${encodeURIComponent(formatStr)}`;
      
      return res.json({
        status: 'redirect',
        url: proxyUrl,
        title: 'High_Quality_Video',
        ext: 'mp4'
      });
    }

    // Direct extraction for lower qualities or non-youtube
    const output = await youtubedl(url, {
      dumpJson: true,
      noWarnings: true,
      noPlaylist: true,
      format: formatStr
    });

    if (output && output.url) {
      if (req.apiUser) req.apiUser.requests++;
      return res.json({
        status: 'redirect',
        url: output.url,
        title: output.title || 'video',
        ext: output.ext || 'mp4'
      });
    }

    res.status(400).json({ status: 'error', text: 'Could not extract stream URL.' });
  } catch (err) {
    console.error('[-] Download error:', err.message);
    res.status(400).json({ status: 'error', text: 'Failed to process link.' });
  }
});

// ═══════════════════════════════════════
//  GET /api/stream — Merge Video+Audio via FFmpeg
// ═══════════════════════════════════════
app.get('/api/stream', async (req, res) => {
  const { url, format } = req.query;
  if (!url) return res.status(400).send('Missing URL');

  const formatStr = format || 'bestvideo+bestaudio/best';
  console.log(`[STREAM] Request for ${url} with format ${formatStr}`);

  try {
    const ffmpegPath = require('ffmpeg-static');
    const { spawn } = require('child_process');

    // Get cached info or fetch new (fast if cached)
    let info = getCachedInfo(url);
    if (!info) {
      console.log(`[STREAM] Cache miss, fetching info...`);
      info = await youtubedl(url, {
        dumpSingleJson: true,
        noWarnings: true,
        skipDownload: true,
        noPlaylist: true,
        noCheckCertificates: true,
        socketTimeout: 10
      });
      setCachedInfo(url, info);
    } else {
      console.log(`[STREAM] Cache hit!`);
    }

    const formats = info.formats || [];
    let videoUrl = null;
    let audioUrl = null;
    let isAudioOnly = false;

    if (formatStr.includes('+')) {
      // Merged format like "313+bestaudio/best"
      const mainPart = formatStr.split('/')[0]; // "313+bestaudio"
      const [videoFmtId, audioFmtPart] = mainPart.split('+');

      // Find video URL by format_id
      const videoFormat = formats.find(f => f.format_id === videoFmtId && f.url);
      if (videoFormat) videoUrl = videoFormat.url;

      // Find best audio URL
      if (audioFmtPart === 'bestaudio') {
        const audioFormats = formats.filter(f =>
          f.acodec && f.acodec !== 'none' &&
          (!f.vcodec || f.vcodec === 'none') &&
          f.url && f.url.startsWith('http')
        );
        audioFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0));
        if (audioFormats.length > 0) audioUrl = audioFormats[0].url;
      } else {
        const audioFormat = formats.find(f => f.format_id === audioFmtPart && f.url);
        if (audioFormat) audioUrl = audioFormat.url;
      }
    } else {
      // Single format (audio-only or pre-muxed)
      isAudioOnly = true;
      const singleFormat = formats.find(f => f.format_id === formatStr && f.url);
      if (singleFormat) {
        audioUrl = singleFormat.url;
      } else {
        // Fallback: try bestaudio
        const audioFormats = formats.filter(f =>
          f.acodec && f.acodec !== 'none' &&
          (!f.vcodec || f.vcodec === 'none') &&
          f.url && f.url.startsWith('http')
        );
        audioFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0));
        if (audioFormats.length > 0) audioUrl = audioFormats[0].url;
      }
    }

    console.log(`[STREAM] videoUrl: ${videoUrl ? 'found' : 'none'}, audioUrl: ${audioUrl ? 'found' : 'none'}`);

    // Set headers
    if (isAudioOnly || !videoUrl) {
      res.setHeader('Content-Disposition', `attachment; filename="audio_${Date.now()}.mp4"`);
      res.setHeader('Content-Type', 'audio/mp4');
    } else {
      res.setHeader('Content-Disposition', `attachment; filename="video_${Date.now()}.mp4"`);
      res.setHeader('Content-Type', 'video/mp4');
    }

    let ffmpegArgs;

    if (videoUrl && audioUrl) {
      // MERGE video + audio with ffmpeg — the key fix for "no audio"
      console.log(`[STREAM] Merging video + audio with ffmpeg...`);
      ffmpegArgs = [
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-i', videoUrl,
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-i', audioUrl,
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-movflags', 'frag_keyframe+empty_moov+faststart',
        '-f', 'mp4',
        'pipe:1'
      ];
    } else if (videoUrl) {
      // Video only (rare fallback)
      ffmpegArgs = [
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-i', videoUrl,
        '-c', 'copy',
        '-movflags', 'frag_keyframe+empty_moov+faststart',
        '-f', 'mp4',
        'pipe:1'
      ];
    } else if (audioUrl) {
      // Audio only
      ffmpegArgs = [
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-i', audioUrl,
        '-c:a', 'aac',
        '-movflags', 'frag_keyframe+empty_moov+faststart',
        '-f', 'mp4',
        'pipe:1'
      ];
    } else {
      return res.status(400).send('Could not find stream URLs for the requested format.');
    }

    const child = spawn(ffmpegPath, ffmpegArgs);

    child.stdout.pipe(res);

    child.stderr.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('Error') || msg.includes('error')) {
        console.error(`[FFMPEG] ${msg.trim()}`);
      }
    });

    child.on('close', (code) => {
      console.log(`[STREAM] FFmpeg finished with code ${code}`);
      if (!res.writableEnded) res.end();
    });

    child.on('error', (err) => {
      console.error(`[STREAM] FFmpeg spawn error:`, err.message);
      if (!res.headersSent) res.status(500).send('FFmpeg error');
    });

    req.on('close', () => {
      child.kill('SIGTERM');
    });

  } catch (err) {
    console.error('[-] Stream error:', err.message);
    if (!res.headersSent) res.status(500).send('Error: ' + err.message);
  }
});

// ═══════════════════════════════════════
//  POST /api/audio — Download Audio Only
// ═══════════════════════════════════════
app.post('/api/audio', optionalAuth, async (req, res) => {
  let { url, format_id } = req.body;
  if (!url) return res.status(400).json({ status: 'error', text: 'Missing URL.' });

  console.log(`[AUDIO] ${url}`);
  
  const cloudData = checkCloudStorage(url);
  if (cloudData.unsupported) {
    return res.status(400).json({ status: 'error', text: cloudData.reason });
  }
  const isCloudStorage = cloudData.isCloud;

  try {
    if (isCloudStorage) {
      console.log(`[AUDIO] Attempting Puppeteer extraction for cloud link...`);
      const streamUrl = await extractCloudVideo(url);
      if (streamUrl) {
        if (streamUrl.includes('youtube.com') || streamUrl.includes('youtu.be')) {
          console.log(`[+] Cloud link unwrapped to YouTube: ${streamUrl}`);
          url = streamUrl;
        } else {
          if (req.apiUser) req.apiUser.requests++;
          return res.json({
            status: 'redirect',
            url: streamUrl,
            title: 'Cloud Audio',
            ext: 'mp4'
          });
        }
      } else {
        return res.status(400).json({ status: 'error', text: 'Could not extract audio stream.' });
      }
    }
    const output = await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      skipDownload: true
    });

    let streamUrl = null;
    let ext = 'mp3';

    if (format_id && format_id !== 'max' && format_id !== 'auto' && output.formats) {
      const selected = output.formats.find(f => f.format_id === format_id);
      if (selected && selected.url) {
        streamUrl = selected.url;
        ext = selected.ext || 'mp3';
      }
    }

    if (!streamUrl && output.formats) {
      const audios = output.formats.filter(f => f.url && f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'));
      if (audios.length > 0) {
        audios.sort((a, b) => (b.abr || 0) - (a.abr || 0));
        streamUrl = audios[0].url;
        ext = audios[0].ext || 'mp3';
      } else {
        const anyAudio = output.formats.filter(f => f.url && f.acodec && f.acodec !== 'none');
        if (anyAudio.length > 0) {
          anyAudio.sort((a, b) => (b.abr || 0) - (a.abr || 0));
          streamUrl = anyAudio[0].url;
          ext = anyAudio[0].ext || 'mp3';
        }
      }
    }

    if (!streamUrl) {
      streamUrl = output.url;
      if (!streamUrl && output.requested_downloads?.length > 0) {
        streamUrl = output.requested_downloads[0].url;
      }
    }

    if (streamUrl) {
      return res.json({
        status: 'redirect',
        url: streamUrl,
        title: output.title || 'audio',
        ext: ext
      });
    }
    res.status(400).json({ status: 'error', text: 'Could not extract audio stream.' });
  } catch (err) {
    console.error('[-] Audio error:', err.message);
    res.status(400).json({ status: 'error', text: 'Failed to extract audio.' });
  }
});

// ═══════════════════════════════════════
//  POST /api/image — Get Thumbnail / Image
// ═══════════════════════════════════════
app.post('/api/image', optionalAuth, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ status: 'error', text: 'Missing URL.' });

  console.log(`[IMAGE] ${url}`);
  
  const isCloudStorage = checkCloudStorage(url);
  if (isCloudStorage) {
    return res.json({
      status: 'success',
      title: 'Cloud Video',
      images: []
    });
  }

  try {
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      skipDownload: true
    });

    const thumbnails = (info.thumbnails || [])
      .filter(t => t.url)
      .map(t => ({
        url: t.url,
        width: t.width || 0,
        height: t.height || 0,
        id: t.id || ''
      }));

    if (info.thumbnail) {
      thumbnails.push({ url: info.thumbnail, width: 0, height: 0, id: 'default' });
    }

    res.json({
      status: 'success',
      title: info.title || '',
      thumbnails: thumbnails.filter((t, i, arr) => arr.findIndex(x => x.url === t.url) === i)
    });
  } catch (err) {
    console.error('[-] Image error:', err.message);
    res.status(400).json({ status: 'error', text: 'Could not extract images.' });
  }
});

// ═══════════════════════════════════════
//  Server Initialization
// ═══════════════════════════════════════

app.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║  🏴‍☠️  DESTOPIAN VIDEO SERVER v2.0             ║');
  console.log(`  ║  🚀 Running at http://localhost:${PORT}           ║`);
  console.log('  ║  📡 API:  POST /api/json  /api/formats       ║');
  console.log('  ║          POST /api/audio /api/image /api/key  ║');
  console.log('  ║  🌐 Web App: http://localhost:' + PORT + '/            ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
});

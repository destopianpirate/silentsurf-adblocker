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

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    // Wait for JS challenges / ads / video elements to resolve
    await new Promise(r => setTimeout(r, 8000));
    
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
    if (host.includes('terabox.com') || host.includes('nephobox.com') || host.includes('4funbox.com')) return { isCloud: true };
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
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      skipDownload: true
    });

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
      console.log(`[FORMATS] Cloud storage detected. Bypassing yt-dlp...`);
      return res.json({
        status: 'success',
        title: 'Cloud Video',
        thumbnail: '',
        duration: 0,
        video: [{ format_id: 'max', label: 'Max Quality', ext: 'mp4', filesize: null }],
        audio: []
      });
    }
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      skipDownload: true
    });

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
            acodec: f.acodec
          });
        }
      }

      if (f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none')) {
        const label = `${f.abr || '?'}kbps`;
        const key = `audio-${f.abr}-${f.ext}`;
        if (!seen.has(key)) {
          seen.add(key);
          audioFormats.push({
            format_id: f.format_id,
            ext: f.ext,
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

    res.json({
      status: 'success',
      title: info.title || '',
      thumbnail: info.thumbnail || info.thumbnails?.[info.thumbnails.length - 1]?.url || '',
      duration: info.duration || 0,
      video: videoFormats,
      audio: audioFormats
    });
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
//  GET /api/stream — Proxy and Merge High Quality Streams
// ═══════════════════════════════════════
app.get('/api/stream', (req, res) => {
  const { url, format } = req.query;
  if (!url) return res.status(400).send('Missing URL');

  console.log(`[STREAM] Proxying stream for ${url} with format ${format}`);

  // We set headers for a generic mp4 download
  res.setHeader('Content-Disposition', `attachment; filename="video_${Date.now()}.mp4"`);
  res.setHeader('Content-Type', 'video/mp4');

  try {
    const ffmpegPath = require('ffmpeg-static');
    
    // We spawn yt-dlp directly instead of youtube-dl-exec to pipe stdout
    const { spawn } = require('child_process');
    const ytDlpPath = require('youtube-dl-exec').constants.YOUTUBE_DL_PATH;
    
    const args = [
      '-o', '-', 
      '-f', format || 'bestvideo+bestaudio/best', 
      '--ffmpeg-location', ffmpegPath,
      '--merge-output-format', 'mp4',
      '--no-playlist',
      '--no-warnings',
      url
    ];

    const child = spawn(ytDlpPath, args);

    child.stdout.pipe(res);
    
    child.stderr.on('data', (data) => {
      // yt-dlp outputs progress to stderr
      // console.log(data.toString());
    });

    child.on('close', (code) => {
      console.log(`[STREAM] Proxy finished with code ${code}`);
      res.end();
    });

    req.on('close', () => {
      child.kill();
    });
  } catch (err) {
    console.error('[-] Stream proxy error:', err);
    if (!res.headersSent) res.status(500).send('Error proxying stream');
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

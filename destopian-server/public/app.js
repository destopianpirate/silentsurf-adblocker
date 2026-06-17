/* ═══════════════════════════════════════════════════
   DESTOPIAN GRABBER — Web App Logic
   ═══════════════════════════════════════════════════ */

(function () {
  'use strict';

  const API_BASE = window.location.origin;

  // ── Tab Navigation ──
  const tabs = document.querySelectorAll('.nav-tab');
  const sections = document.querySelectorAll('.section');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      sections.forEach(s => s.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('section-' + tab.dataset.section).classList.add('active');
    });
  });

  // ── Helpers ──
  function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
  }

  function formatDuration(sec) {
    if (!sec) return '';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function showEl(id) { document.getElementById(id).style.display = ''; }
  function hideEl(id) { document.getElementById(id).style.display = 'none'; }

  async function apiPost(endpoint, body) {
    const res = await fetch(API_BASE + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return res.json();
  }

  // ═══════════════════════════════════
  //  VIDEO DOWNLOADER
  // ═══════════════════════════════════
  const fetchBtn = document.getElementById('fetchBtn');
  const videoUrlInput = document.getElementById('videoUrl');

  fetchBtn.addEventListener('click', async () => {
    const url = videoUrlInput.value.trim();
    if (!url) return;

    hideEl('resultCard'); hideEl('errorCard'); showEl('loader');
    hideEl('previewContainer');
    document.getElementById('previewPlayer').pause();

    try {
      const data = await apiPost('/api/formats', { url });

      hideEl('loader');

      if (data.status === 'error') {
        document.getElementById('errorMsg').textContent = data.text;
        showEl('errorCard');
        return;
      }

      // Populate result
      document.getElementById('resultThumb').src = data.thumbnail || '';
      document.getElementById('resultTitle').textContent = data.title || 'Untitled';
      document.getElementById('resultMeta').textContent = formatDuration(data.duration);

      // Video formats
      const vGrid = document.getElementById('videoFormats');
      vGrid.innerHTML = '';
      (data.video || []).forEach(f => {
        const wrapper = document.createElement('div');
        wrapper.className = 'format-wrapper';

        const btn = document.createElement('button');
        btn.className = 'format-btn';
        btn.title = 'Download';
        btn.innerHTML = `
          <span class="fmt-quality">${f.label}</span>
          <span class="fmt-ext">${f.ext}</span>
          ${f.filesize ? `<span class="fmt-size">${formatSize(f.filesize)}</span>` : ''}
        `;
        btn.addEventListener('click', () => downloadFormat(url, f.format_id, data.title));

        const previewBtn = document.createElement('button');
        previewBtn.className = 'btn-preview';
        previewBtn.title = 'Preview';
        previewBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
        previewBtn.addEventListener('click', () => previewFormat(url, f.format_id, data.title));

        wrapper.appendChild(btn);
        wrapper.appendChild(previewBtn);
        vGrid.appendChild(wrapper);
      });

      if ((data.video || []).length === 0) {
        // Add a "Best" fallback button
        const wrapper = document.createElement('div');
        wrapper.className = 'format-wrapper';

        const btn = document.createElement('button');
        btn.className = 'format-btn';
        btn.title = 'Download';
        btn.innerHTML = '<span class="fmt-quality">Best Quality</span><span class="fmt-ext">auto</span>';
        btn.addEventListener('click', () => downloadFormat(url, null, data.title));

        const previewBtn = document.createElement('button');
        previewBtn.className = 'btn-preview';
        previewBtn.title = 'Preview';
        previewBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
        previewBtn.addEventListener('click', () => previewFormat(url, null, data.title));

        wrapper.appendChild(btn);
        wrapper.appendChild(previewBtn);
        vGrid.appendChild(wrapper);
      }

      // Audio formats
      const aGrid = document.getElementById('audioFormats');
      aGrid.innerHTML = '';
      (data.audio || []).forEach(f => {
        const btn = document.createElement('button');
        btn.className = 'format-btn';
        btn.innerHTML = `
          <span class="fmt-quality">${f.label}</span>
          <span class="fmt-ext">${f.ext}</span>
          ${f.filesize ? `<span class="fmt-size">${formatSize(f.filesize)}</span>` : ''}
        `;
        btn.addEventListener('click', () => downloadAudioFormat(url, f.format_id, data.title));
        aGrid.appendChild(btn);
      });

      showEl('resultCard');
    } catch (e) {
      hideEl('loader');
      document.getElementById('errorMsg').textContent = 'Network error. Is the server running?';
      showEl('errorCard');
    }
  });

  videoUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fetchBtn.click();
  });

  async function downloadFormat(url, formatId, title) {
    try {
      const body = { url };
      if (formatId) body.format_id = formatId;
      const data = await apiPost('/api/json', body);

      if (data.status === 'redirect' && data.url) {
        const a = document.createElement('a');
        a.href = data.url;
        a.download = (title || 'video') + '.' + (data.ext || 'mp4');
        a.target = '_blank';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        alert('Error: ' + (data.text || 'Could not download.'));
      }
    } catch (e) {
      alert('Download failed: ' + e.message);
    }
  }

  async function downloadAudioFormat(url, formatId, title) {
    try {
      const body = { url };
      if (formatId) body.format_id = formatId;
      const data = await apiPost('/api/audio', body);

      if (data.status === 'redirect' && data.url) {
        const a = document.createElement('a');
        a.href = data.url;
        a.download = (title || 'audio') + '.' + (data.ext || 'mp3');
        a.target = '_blank';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        alert('Error: ' + (data.text || 'Could not download audio.'));
      }
    } catch (e) {
      alert('Download failed: ' + e.message);
    }
  }

  async function previewFormat(url, formatId, title) {
    try {
      showEl('loader');
      const body = { url };
      if (formatId) body.format_id = formatId;
      const data = await apiPost('/api/json', body);
      hideEl('loader');

      if (data.status === 'redirect' && data.url) {
        showEl('previewContainer');
        const player = document.getElementById('previewPlayer');
        player.src = data.url;
        player.play();
        player.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        alert('Error: ' + (data.text || 'Could not preview.'));
      }
    } catch (e) {
      hideEl('loader');
      alert('Preview failed: ' + e.message);
    }
  }

  // ═══════════════════════════════════
  //  AUDIO TAB
  // ═══════════════════════════════════
  const audioFetchBtn = document.getElementById('audioFetchBtn');
  const audioUrlInput = document.getElementById('audioUrl');

  audioFetchBtn.addEventListener('click', async () => {
    const url = audioUrlInput.value.trim();
    if (!url) return;

    hideEl('audioResultCard'); hideEl('audioErrorCard'); showEl('audioLoader');

    try {
      const data = await apiPost('/api/formats', { url });
      hideEl('audioLoader');

      if (data.status === 'error') {
        document.getElementById('audioErrorMsg').textContent = data.text;
        showEl('audioErrorCard');
        return;
      }

      document.getElementById('audioResultThumb').src = data.thumbnail || '';
      document.getElementById('audioResultTitle').textContent = data.title || 'Untitled';
      document.getElementById('audioResultMeta').textContent = formatDuration(data.duration);

      const grid = document.getElementById('audioFormatsList');
      grid.innerHTML = '';

      // Audio-only formats
      (data.audio || []).forEach(f => {
        const btn = document.createElement('button');
        btn.className = 'format-btn';
        btn.innerHTML = `
          <span class="fmt-quality">${f.label}</span>
          <span class="fmt-ext">${f.ext}</span>
          ${f.filesize ? `<span class="fmt-size">${formatSize(f.filesize)}</span>` : ''}
        `;
        btn.addEventListener('click', () => downloadAudioFormat(url, f.format_id, data.title));
        grid.appendChild(btn);
      });

      if ((data.audio || []).length === 0) {
        const btn = document.createElement('button');
        btn.className = 'format-btn';
        btn.innerHTML = '<span class="fmt-quality">Best</span><span class="fmt-ext">auto</span>';
        btn.addEventListener('click', () => downloadAudioFormat(url, null, data.title));
        grid.appendChild(btn);
      }

      showEl('audioResultCard');
    } catch (e) {
      hideEl('audioLoader');
      document.getElementById('audioErrorMsg').textContent = 'Network error.';
      showEl('audioErrorCard');
    }
  });

  audioUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') audioFetchBtn.click();
  });

  // ═══════════════════════════════════
  //  IMAGE TAB
  // ═══════════════════════════════════
  const imageFetchBtn = document.getElementById('imageFetchBtn');
  const imageUrlInput = document.getElementById('imageUrl');

  imageFetchBtn.addEventListener('click', async () => {
    const url = imageUrlInput.value.trim();
    if (!url) return;

    hideEl('imageResultCard'); hideEl('imageErrorCard'); showEl('imageLoader');

    try {
      const data = await apiPost('/api/image', { url });
      hideEl('imageLoader');

      if (data.status === 'error') {
        document.getElementById('imageErrorMsg').textContent = data.text;
        showEl('imageErrorCard');
        return;
      }

      document.getElementById('imageResultTitle').textContent = (data.title || 'Thumbnails') + ' — ' + (data.thumbnails || []).length + ' images found';

      const grid = document.getElementById('thumbGrid');
      grid.innerHTML = '';

      (data.thumbnails || []).forEach((t, i) => {
        const item = document.createElement('a');
        item.className = 'thumb-item';
        item.href = t.url;
        item.target = '_blank';
        item.download = `thumbnail_${i + 1}.jpg`;
        item.innerHTML = `
          <img src="${t.url}" alt="Thumbnail ${i + 1}" loading="lazy">
          <span class="thumb-label">${t.width ? t.width + '×' + t.height : 'Download'}</span>
        `;
        grid.appendChild(item);
      });

      showEl('imageResultCard');
    } catch (e) {
      hideEl('imageLoader');
      document.getElementById('imageErrorMsg').textContent = 'Network error.';
      showEl('imageErrorCard');
    }
  });

  imageUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') imageFetchBtn.click();
  });

  // ═══════════════════════════════════
  //  API KEY GENERATION
  // ═══════════════════════════════════
  const genKeyBtn = document.getElementById('generateKeyBtn');
  const apiNameInput = document.getElementById('apiName');

  genKeyBtn.addEventListener('click', async () => {
    try {
      const data = await apiPost('/api/key', { name: apiNameInput.value.trim() });
      if (data.status === 'success') {
        document.getElementById('apiKeyValue').textContent = data.key;
        showEl('apiKeyResult');
      }
    } catch (e) {
      alert('Failed to generate key.');
    }
  });

  apiNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') genKeyBtn.click();
  });

  document.getElementById('copyKeyBtn').addEventListener('click', () => {
    const key = document.getElementById('apiKeyValue').textContent;
    navigator.clipboard.writeText(key).then(() => {
      const btn = document.getElementById('copyKeyBtn');
      btn.innerHTML = '✓';
      setTimeout(() => {
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
      }, 1500);
    });
  });

})();

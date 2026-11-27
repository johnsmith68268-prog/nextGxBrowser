    const dialGrid = document.getElementById('dialGrid');
    const addModal = document.getElementById('addModal');
    const quickNotesInput = document.getElementById('quickNotesInput');

    function escapeHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    const TILE_BRANDS = [
      {
        match: (h) => h === 'music.youtube.com',
        edge: '#ff1f4b',
        tint: 'rgba(255, 31, 75, 0.22)',
        tintHover: 'rgba(255, 31, 75, 0.34)',
        svg: '<svg viewBox="0 0 24 24" width="26" height="26"><circle cx="12" cy="12" r="10.5" fill="#ff0033"/><circle cx="12" cy="12" r="4.8" fill="none" stroke="#fff" stroke-width="1.35"/><polygon points="10.4,9.3 15.2,12 10.4,14.7" fill="#fff"/></svg>'
      },
      {
        match: (h) => h === 'youtube.com' || h.endsWith('.youtube.com') || h === 'youtu.be',
        edge: '#ff2b2b',
        tint: 'rgba(255, 36, 36, 0.22)',
        tintHover: 'rgba(255, 36, 36, 0.34)',
        svg: '<svg viewBox="0 0 24 24" width="27" height="27"><rect x="1.5" y="4.5" width="21" height="15" rx="4.5" fill="#ff0000"/><polygon points="10,8.8 16.2,12 10,15.2" fill="#fff"/></svg>'
      },
      {
        match: (h) => h === 'github.com' || h.endsWith('.github.com'),
        edge: '#a78bfa',
        tint: 'rgba(167, 139, 250, 0.18)',
        tintHover: 'rgba(167, 139, 250, 0.30)',
        svg: '<svg viewBox="0 0 24 24" width="25" height="25" fill="#f3f4f6"><path d="M12 1.8a10.2 10.2 0 0 0-3.22 19.88c.51.09.7-.22.7-.49v-1.73c-2.84.62-3.44-1.37-3.44-1.37-.46-1.18-1.14-1.49-1.14-1.49-.93-.64.07-.62.07-.62 1.03.07 1.57 1.06 1.57 1.06.91 1.57 2.4 1.12 2.98.85.09-.66.36-1.12.65-1.38-2.27-.26-4.65-1.14-4.65-5.05 0-1.12.4-2.03 1.05-2.74-.1-.26-.46-1.3.1-2.7 0 0 .86-.28 2.81 1.04a9.78 9.78 0 0 1 5.12 0c1.95-1.32 2.81-1.04 2.81-1.04.56 1.4.2 2.44.1 2.7.65.71 1.05 1.62 1.05 2.74 0 3.92-2.39 4.79-4.66 5.04.37.32.7.94.7 1.9v2.81c0 .27.18.59.7.49A10.2 10.2 0 0 0 12 1.8z"/></svg>'
      },
      {
        match: (h) => h === 'chatgpt.com' || h === 'chat.openai.com' || h.endsWith('.openai.com'),
        edge: '#10a37f',
        tint: 'rgba(16, 163, 127, 0.22)',
        tintHover: 'rgba(16, 163, 127, 0.34)',
        svg: '<svg viewBox="0 0 24 24" width="26" height="26"><circle cx="12" cy="12" r="10.5" fill="#10a37f"/><g fill="none" stroke="#fff" stroke-width="1.35" stroke-linecap="round"><path d="M10.27 13V7.6A2.4 2.4 0 0 1 14.94 8.3"/><path d="M10.27 13V7.6A2.4 2.4 0 0 1 14.94 8.3" transform="rotate(60 12 12)"/><path d="M10.27 13V7.6A2.4 2.4 0 0 1 14.94 8.3" transform="rotate(120 12 12)"/><path d="M10.27 13V7.6A2.4 2.4 0 0 1 14.94 8.3" transform="rotate(180 12 12)"/><path d="M10.27 13V7.6A2.4 2.4 0 0 1 14.94 8.3" transform="rotate(240 12 12)"/><path d="M10.27 13V7.6A2.4 2.4 0 0 1 14.94 8.3" transform="rotate(300 12 12)"/></g></svg>'
      },
      {
        match: (h) => h === 'twitch.tv' || h.endsWith('.twitch.tv'),
        edge: '#9146ff',
        tint: 'rgba(145, 70, 255, 0.22)',
        tintHover: 'rgba(145, 70, 255, 0.34)',
        svg: '<svg viewBox="0 0 24 24" width="25" height="25"><path d="M4.2 2L2.8 5.8v14.4h5V22h3l2-1.8h3.5L21 15.6V2H4.2z" fill="#9146ff"/><polygon points="6,4 19,4 19,14.5 16,17.5 12.5,17.5 10.5,19.5 10.5,17.5 6,17.5" fill="#fff"/><rect x="10" y="7.5" width="2" height="5" fill="#9146ff"/><rect x="15" y="7.5" width="2" height="5" fill="#9146ff"/></svg>'
      },
      {
        match: (h) => h === 'reddit.com' || h.endsWith('.reddit.com'),
        edge: '#ff4500',
        tint: 'rgba(255, 69, 0, 0.22)',
        tintHover: 'rgba(255, 69, 0, 0.34)',
        svg: '<svg viewBox="0 0 24 24" width="26" height="26"><circle cx="12" cy="12" r="10.5" fill="#ff4500"/><circle cx="9.2" cy="12.6" r="1.2" fill="#fff"/><circle cx="14.8" cy="12.6" r="1.2" fill="#fff"/><path d="M9 15.6c.8.7 2 1 3 1s2.2-.3 3-1" fill="none" stroke="#fff" stroke-width="1.35" stroke-linecap="round"/><path d="M12 8.2l1.2-3 2.5.6" fill="none" stroke="#fff" stroke-width="1.25" stroke-linecap="round"/><circle cx="16.5" cy="6" r="1.2" fill="#fff"/><ellipse cx="12" cy="13.2" rx="5.5" ry="4" fill="none" stroke="#fff" stroke-width="1.3"/></svg>'
      },
      {
        match: (h) => h === 'soundcloud.com' || h.endsWith('.soundcloud.com'),
        edge: '#ff6a00',
        tint: 'rgba(255, 106, 0, 0.22)',
        tintHover: 'rgba(255, 106, 0, 0.34)',
        svg: '<svg viewBox="0 0 24 24" width="27" height="27"><path d="M11 17.5h7.6a3.1 3.1 0 0 0 .4-6.17A4.6 4.6 0 0 0 10 9.6v7.9h1z" fill="#ff5500"/><path d="M7.5 11v6.5M5.3 12.6v4.9M3.2 13.8v3.7" stroke="#ff5500" stroke-width="1.7" stroke-linecap="round"/></svg>'
      },
      {
        match: (h) => h === 'google.com' || h === 'www.google.com',
        edge: '#4285f4',
        tint: 'rgba(66, 133, 244, 0.20)',
        tintHover: 'rgba(66, 133, 244, 0.32)',
        svg: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>'
      },
      {
        match: (h) => h === 'spotify.com' || h.endsWith('.spotify.com'),
        edge: '#1db954',
        tint: 'rgba(29, 185, 84, 0.22)',
        tintHover: 'rgba(29, 185, 84, 0.34)',
        svg: '<svg viewBox="0 0 24 24" width="26" height="26"><circle cx="12" cy="12" r="10.5" fill="#1db954"/><path d="M7 9.4c3.5-1 7-.8 10 .5M7.5 12.5c3-.8 6-.6 8.5.4M8.2 15.5c2.2-.6 4.5-.5 6.5.3" fill="none" stroke="#0b0c10" stroke-width="1.8" stroke-linecap="round"/></svg>'
      },
      {
        match: (h) => h === 'discord.com' || h.endsWith('.discord.com'),
        edge: '#5865f2',
        tint: 'rgba(88, 101, 242, 0.22)',
        tintHover: 'rgba(88, 101, 242, 0.34)',
        svg: '<svg viewBox="0 0 24 24" width="26" height="26"><rect x="2" y="2" width="20" height="20" rx="5.5" fill="#5865f2"/><path d="M16.5 8.1a10.4 10.4 0 0 0-2.6-.8l-.3.7a9.7 9.7 0 0 0-3.2 0l-.3-.7a10.4 10.4 0 0 0-2.6.8C5.9 10.5 5.4 12.9 5.6 15.2a10.6 10.6 0 0 0 3.2 1.6l.6-1a6.8 6.8 0 0 1-1-.5l.2-.2a7.5 7.5 0 0 0 6.8 0l.2.2a6.8 6.8 0 0 1-1 .5l.6 1a10.6 10.6 0 0 0 3.2-1.6c.3-2.7-.5-5.1-1.9-7.1z" fill="#fff"/><circle cx="9.8" cy="12.6" r="1.2" fill="#5865f2"/><circle cx="14.2" cy="12.6" r="1.2" fill="#5865f2"/></svg>'
      },
      {
        match: (h) => h === 'gemini.google.com',
        edge: '#8b7cf6',
        tint: 'rgba(139, 124, 246, 0.22)',
        tintHover: 'rgba(139, 124, 246, 0.34)',
        svg: '<svg viewBox="0 0 24 24" width="25" height="25"><defs><linearGradient id="ntGem" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#4285f4"/><stop offset="55%" stop-color="#9b72cb"/><stop offset="100%" stop-color="#d96570"/></linearGradient></defs><path d="M12 2C12 7.5 16.5 12 22 12C16.5 12 12 16.5 12 22C12 16.5 7.5 12 2 12C7.5 12 12 7.5 12 2Z" fill="url(#ntGem)"/></svg>'
      },
      {
        match: (h) => h === 'claude.ai' || h.endsWith('.claude.ai'),
        edge: '#d97757',
        tint: 'rgba(217, 119, 87, 0.22)',
        tintHover: 'rgba(217, 119, 87, 0.34)',
        svg: '<svg viewBox="0 0 24 24" width="25" height="25"><g stroke="#d97757" stroke-width="2" stroke-linecap="round"><line x1="12" y1="3" x2="12" y2="21"/><line x1="12" y1="3" x2="12" y2="21" transform="rotate(36 12 12)"/><line x1="12" y1="3" x2="12" y2="21" transform="rotate(72 12 12)"/><line x1="12" y1="3" x2="12" y2="21" transform="rotate(108 12 12)"/><line x1="12" y1="3" x2="12" y2="21" transform="rotate(144 12 12)"/></g><circle cx="12" cy="12" r="2.2" fill="#d97757"/></svg>'
      },
      {
        match: (h) => h === 'whatsapp.com' || h.endsWith('.whatsapp.com'),
        edge: '#25d366',
        tint: 'rgba(37, 211, 102, 0.22)',
        tintHover: 'rgba(37, 211, 102, 0.34)',
        svg: '<svg viewBox="0 0 24 24" width="25" height="25"><path d="M12 2.5a9.5 9.5 0 0 0-8.2 14.3L2.5 21.5l4.9-1.3A9.5 9.5 0 1 0 12 2.5z" fill="#25d366"/><path d="M9.6 8c-.4-.1-.9.1-1.3.5-.5.6-.7 1.4-.4 2.3.8 2.2 2.9 4.4 5.1 5.3.9.4 1.8.2 2.4-.3.4-.4.6-.9.5-1.3-.1-.3-.4-.5-.8-.7l-1.3-.6c-.3-.2-.6-.1-.8.2l-.6.7c-.2.2-.5.2-.8.1-.8-.4-1.6-1.2-2-2-.1-.3-.1-.6.1-.8l.7-.6c.3-.2.4-.5.2-.8l-.6-1.3c-.2-.4-.4-.7-.7-.7z" fill="#fff"/></svg>'
      }
    ];

    const FALLBACK_TINTS = [
      { edge: '#8b5cf6', tint: 'rgba(139, 92, 246, 0.18)', tintHover: 'rgba(139, 92, 246, 0.28)' },
      { edge: '#3b82f6', tint: 'rgba(59, 130, 246, 0.18)', tintHover: 'rgba(59, 130, 246, 0.28)' },
      { edge: '#10b981', tint: 'rgba(16, 185, 129, 0.18)', tintHover: 'rgba(16, 185, 129, 0.28)' },
      { edge: '#f59e0b', tint: 'rgba(245, 158, 11, 0.18)', tintHover: 'rgba(245, 158, 11, 0.28)' },
      { edge: '#ec4899', tint: 'rgba(236, 72, 153, 0.18)', tintHover: 'rgba(236, 72, 153, 0.28)' },
      { edge: '#06b6d4', tint: 'rgba(6, 182, 212, 0.18)', tintHover: 'rgba(6, 182, 212, 0.28)' }
    ];

    function parseHostForTile(rawUrl) {
      try {
        const s = String(rawUrl || '').trim();
        const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
        return u.hostname.replace(/^www\./i, '').toLowerCase();
      } catch (_) {
        return '';
      }
    }

    function updateNewTabClock() {
      const timeEl = document.getElementById('ntClockTime');
      const dateEl = document.getElementById('ntClockDate');
      if (!timeEl || !dateEl) return;
      const now = new Date();
      timeEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      dateEl.textContent = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    }
    updateNewTabClock();
    const clockTimerId = setInterval(updateNewTabClock, 15000);
    window.addEventListener('pagehide', () => clearInterval(clockTimerId), { once: true });

    const SAFE_WALLPAPER_CSS_URL_RE =
      /^(?:file:\/\/\/[^\s"'()\\<>`]+\.(?:png|jpe?g|webp|gif)(?:\?t=\d+)?|data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+)$/i;
    function sanitizeWallpaperCssUrl(rawUrl) {
      if (typeof rawUrl !== 'string') return '';
      const trimmed = rawUrl.trim();
      if (!trimmed || /[\u0000-\u001f\u007f"'()\\]/.test(trimmed)) return '';
      return SAFE_WALLPAPER_CSS_URL_RE.test(trimmed) ? trimmed : '';
    }

    function buildSiteFaviconCandidate(rawUrl, host) {
      try {
        const s = String(rawUrl || '').trim();
        const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${host}`);
        if (u.protocol === 'https:' || u.protocol === 'http:') {
          return `${u.origin}/favicon.ico`;
        }
      } catch (_) {}
      return '';
    }

    function renderDials(list) {
      dialGrid.innerHTML = '';
      (list || []).forEach((item, idx) => {
        const card = document.createElement('div');
        card.className = 'dial-tile';
        const host = parseHostForTile(item.url);
        const brand = TILE_BRANDS.find((b) => host && b.match(host)) || null;
        const palette = brand || FALLBACK_TINTS[idx % FALLBACK_TINTS.length];
        card.style.setProperty('--tile-edge', palette.edge);
        card.style.setProperty('--tile-tint', palette.tint);
        card.style.setProperty('--tile-tint-hover', palette.tintHover);
        card.title = item.url || item.title || '';

        const editBtn = document.createElement('button');
        editBtn.className = 'tile-edit';
        editBtn.title = 'Edit';
        editBtn.textContent = '✎';
        const delBtn = document.createElement('button');
        delBtn.className = 'tile-del';
        delBtn.title = 'Remove';
        delBtn.textContent = '✕';

        const iconWrap = document.createElement('span');
        iconWrap.className = 'tile-icon';
        if (brand && brand.svg) {
          iconWrap.innerHTML = brand.svg;
        } else {
          const mono = document.createElement('span');
          mono.className = 'tile-monogram';
          mono.textContent = (item.title || host || '?').trim().charAt(0).toUpperCase();
          const favSrc = host ? buildSiteFaviconCandidate(item.url, host) : '';
          if (favSrc) {
            const img = document.createElement('img');
            img.alt = '';
            img.loading = 'lazy';
            img.addEventListener('error', () => img.replaceWith(mono));
            img.src = favSrc;
            iconWrap.appendChild(img);
          } else {
            iconWrap.appendChild(mono);
          }
        }

        const titleEl = document.createElement('span');
        titleEl.className = 'tile-title';
        titleEl.textContent = item.title || host || item.url || '';

        card.append(editBtn, delBtn, iconWrap, titleEl);
        card.addEventListener('click', async (e) => {
          if (e.target.closest('.tile-del')) {
            e.stopPropagation();
            const removed = { title: item.title, url: item.url };
            const updated = await window.gxNewTabAPI.removeSpeedDial(item.id);
            renderDials(updated);
            showDialUndo(removed);
            return;
          }
          if (e.target.closest('.tile-edit')) {
            e.stopPropagation();
            editingDialId = item.id;
            document.getElementById('addDialTitle').textContent = 'Edit Speed Dial';
            document.getElementById('dialTitleInput').value = item.title || '';
            document.getElementById('dialUrlInput').value = item.url || '';
            document.querySelector('#addDialForm button[type="submit"]').textContent = 'Save';
            addModal.classList.add('open');
            document.getElementById('dialTitleInput').focus();
            return;
          }
          window.gxNewTabAPI.navigate(item.url);
        });
        dialGrid.appendChild(card);
      });

      const addCard = document.createElement('div');
      addCard.className = 'dial-tile add-tile';
      addCard.textContent = '+';
      addCard.title = 'Add site to Speed Dial';
      addCard.addEventListener('click', () => { resetDialForm(); addModal.classList.add('open'); });
      dialGrid.appendChild(addCard);
    }

    let editingDialId = null;
    function resetDialForm() {
      editingDialId = null;
      document.getElementById('addDialTitle').textContent = 'Add Speed Dial';
      document.querySelector('#addDialForm button[type="submit"]').textContent = 'Add';
      const titleInp = document.getElementById('dialTitleInput');
      const urlInp = document.getElementById('dialUrlInput');
      if (titleInp) titleInp.value = '';
      if (urlInp) urlInp.value = '';
    }

    // Market audit bug #24: undo bar for a just-deleted Speed Dial.
    let dialUndoTimer = null;
    function showDialUndo(removed) {
      const bar = document.getElementById('dialUndoBar');
      const text = document.getElementById('dialUndoText');
      const undoBtn = document.getElementById('btnDialUndo');
      if (!bar || !removed) return;
      clearTimeout(dialUndoTimer);
      text.textContent = `Removed “${removed.title || removed.url}”`;
      bar.hidden = false;
      undoBtn.onclick = async () => {
        clearTimeout(dialUndoTimer);
        bar.hidden = true;
        if (window.gxNewTabAPI) {
          const updated = await window.gxNewTabAPI.addSpeedDial({ title: removed.title, url: removed.url });
          renderDials(updated);
        }
      };
      dialUndoTimer = setTimeout(() => {
        bar.hidden = true;
      }, 5000);
    }

    document.getElementById('btnCancelModal').addEventListener('click', () => {
      addModal.classList.remove('open');
      resetDialForm();
    });
    addModal.addEventListener('click', (e) => {
      if (e.target === addModal) {
        addModal.classList.remove('open');
        resetDialForm();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && addModal.classList.contains('open')) {
        addModal.classList.remove('open');
        resetDialForm();
      }
    });

    document.getElementById('addDialForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('dialTitleInput').value.trim();
      const url = document.getElementById('dialUrlInput').value.trim();
      if (title && url && window.gxNewTabAPI) {
        const updated = editingDialId
          ? await window.gxNewTabAPI.updateSpeedDial(editingDialId, { title, url })
          : await window.gxNewTabAPI.addSpeedDial({ title, url });
        renderDials(updated);
        addModal.classList.remove('open');
        resetDialForm();
        e.target.reset();
      }
    });

    document.getElementById('searchForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = document.getElementById('searchInput').value.trim();
      if (q && window.gxNewTabAPI) {
        window.gxNewTabAPI.navigate(q);
      }
    });

    const btnNewTabCorner = document.getElementById('btnNewTabCorner');
    if (btnNewTabCorner) {
      btnNewTabCorner.addEventListener('click', () => {
        if (window.gxNewTabAPI) {
          window.gxNewTabAPI.navigate('nextgx://corner');
        }
      });
    }

    let noteTimer = null;
    quickNotesInput.addEventListener('input', () => {
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => {
        if (window.gxNewTabAPI) window.gxNewTabAPI.saveNote(quickNotesInput.value);
      }, 400);
    });

    const VALID_WALLPAPER_PRESETS = new Set([
      'obsidian-wave',
      'midnight-alpine',
      'crimson-eclipse',
      'cyber-dusk',
      'violet-aurora',
      'emerald-nebula',
      'gx-violet',
      'crimson',
      'cyan',
      'emerald',
      'magenta',
      'amber',
      'lime',
      'ice'
    ]);
    const WALLPAPER_MAX_BYTES = 5 * 1024 * 1024;
    const wallpaperLayer = document.getElementById('wallpaperLayer');
    const btnWallpaperToggle = document.getElementById('btnWallpaperToggle');
    const wallpaperPanel = document.getElementById('wallpaperPanel');
    const btnCloseWallpaperPanel = document.getElementById('btnCloseWallpaperPanel');
    const btnWallpaperAuto = document.getElementById('btnWallpaperAuto');
    const btnWallpaperNone = document.getElementById('btnWallpaperNone');
    const wallpaperFileInput = document.getElementById('wallpaperFileInput');
    const wpCustomEmpty = document.getElementById('wpCustomEmpty');
    const wpCustomFilled = document.getElementById('wpCustomFilled');
    const wpCustomPreview = document.getElementById('wpCustomPreview');
    const wpCustomBadge = document.getElementById('wpCustomBadge');
    const btnWallpaperChooseEmpty = document.getElementById('btnWallpaperChooseEmpty');
    const btnWallpaperUseCustom = document.getElementById('btnWallpaperUseCustom');
    const btnWallpaperChange = document.getElementById('btnWallpaperChange');
    const btnWallpaperRemove = document.getElementById('btnWallpaperRemove');
    const wpErrorMsg = document.getElementById('wpErrorMsg');

    let currentTheme = 'gx-violet';
    let currentWallpaper = { type: 'preset', preset: '', file: '' };
    let cachedCustomFile = '';
    let cachedCustomDataUrl = '';
    let wallpaperSyncSeq = 0;
    let isPrivateMode = false;

    function showWallpaperError(msg) {
      if (!wpErrorMsg) return;
      if (!msg) {
        wpErrorMsg.textContent = '';
        wpErrorMsg.classList.add('hidden');
        return;
      }
      wpErrorMsg.textContent = msg;
      wpErrorMsg.classList.remove('hidden');
    }

    function setWallpaperPanelOpen(open) {
      if (!wallpaperPanel || !btnWallpaperToggle) return;
      const next = Boolean(open);
      wallpaperPanel.classList.toggle('hidden', !next);
      btnWallpaperToggle.classList.toggle('open', next);
      btnWallpaperToggle.setAttribute('aria-expanded', next ? 'true' : 'false');
      if (!next) showWallpaperError('');
    }

    function applyWallpaperUI() {
      if (isPrivateMode) return;
      const wp = currentWallpaper || { type: 'preset', preset: '', file: '' };
      const type = wp.type === 'custom' || wp.type === 'none' || wp.type === 'preset' ? wp.type : 'preset';
      const safeCustomUrl = sanitizeWallpaperCssUrl(cachedCustomDataUrl);
      const hasCustomImg = Boolean(wp.file && safeCustomUrl);
      const effectiveMode = type === 'custom' && !hasCustomImg ? 'preset' : type;
      const explicitPreset = VALID_WALLPAPER_PRESETS.has(wp.preset) ? wp.preset : '';

      document.body.setAttribute('data-wallpaper-mode', effectiveMode);

      if (effectiveMode === 'custom' && safeCustomUrl) {
        document.body.removeAttribute('data-wallpaper-preset');
        if (wallpaperLayer) wallpaperLayer.style.backgroundImage = `url("${safeCustomUrl}")`;
      } else {
        if (wallpaperLayer) wallpaperLayer.style.backgroundImage = '';
        if (effectiveMode === 'preset' && explicitPreset) {
          document.body.setAttribute('data-wallpaper-preset', explicitPreset);
        } else {
          document.body.removeAttribute('data-wallpaper-preset');
        }
      }

      const activePreset = effectiveMode === 'preset' ? (explicitPreset || currentTheme) : '';
      const isAutoPreset = effectiveMode === 'preset' && !explicitPreset;

      if (btnWallpaperAuto) {
        btnWallpaperAuto.classList.toggle('active', isAutoPreset);
      }
      document.querySelectorAll('[data-wp-preset]').forEach((btn) => {
        btn.classList.toggle('active', effectiveMode === 'preset' && btn.dataset.wpPreset === activePreset);
      });
      if (btnWallpaperNone) {
        btnWallpaperNone.classList.toggle('active', effectiveMode === 'none');
      }

      if (wpCustomEmpty && wpCustomFilled) {
        wpCustomEmpty.classList.toggle('hidden', hasCustomImg);
        wpCustomFilled.classList.toggle('hidden', !hasCustomImg);
        wpCustomFilled.classList.toggle('active', effectiveMode === 'custom');
      }
      if (wpCustomPreview && hasCustomImg) {
        wpCustomPreview.style.backgroundImage = `url("${safeCustomUrl}")`;
      }
      if (wpCustomBadge) {
        wpCustomBadge.textContent = effectiveMode === 'custom' ? 'Active' : 'Saved';
      }
      if (btnWallpaperUseCustom) {
        btnWallpaperUseCustom.classList.toggle('hidden', effectiveMode === 'custom');
      }
    }

    async function syncWallpaperFromSettings(wp, providedDataUrl) {
      const syncSeq = ++wallpaperSyncSeq;
      const next = wp && typeof wp === 'object' ? wp : { type: 'preset', preset: '', file: '' };
      currentWallpaper = {
        type: next.type === 'custom' || next.type === 'none' || next.type === 'preset' ? next.type : 'preset',
        preset: typeof next.preset === 'string' ? next.preset : '',
        file: typeof next.file === 'string' ? next.file : ''
      };

      if (typeof providedDataUrl === 'string') {
        cachedCustomFile = currentWallpaper.file;
        cachedCustomDataUrl = currentWallpaper.file ? providedDataUrl : '';
      } else if (!currentWallpaper.file) {
        cachedCustomFile = '';
        cachedCustomDataUrl = '';
      } else if (currentWallpaper.file !== cachedCustomFile && window.gxNewTabAPI?.getWallpaperImage) {
        const requestedFile = currentWallpaper.file;
        try {
          const loaded = await window.gxNewTabAPI.getWallpaperImage();
          if (syncSeq !== wallpaperSyncSeq || currentWallpaper.file !== requestedFile) {
            return;
          }
          cachedCustomFile = requestedFile;
          cachedCustomDataUrl = typeof loaded === 'string' ? loaded : '';
        } catch (_) {
          if (syncSeq !== wallpaperSyncSeq || currentWallpaper.file !== requestedFile) {
            return;
          }
          cachedCustomDataUrl = '';
        }
      }
      applyWallpaperUI();
    }

    async function persistWallpaper(partial) {
      showWallpaperError('');
      const nextWp = {
        ...currentWallpaper,
        ...partial
      };
      currentWallpaper = nextWp;
      applyWallpaperUI();
      if (window.gxNewTabAPI?.updateSettings) {
        const updated = await window.gxNewTabAPI.updateSettings({ wallpaper: nextWp });
        if (updated?.wallpaper) {
          await syncWallpaperFromSettings(updated.wallpaper);
        }
      }
    }

    if (btnWallpaperToggle) {
      btnWallpaperToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        setWallpaperPanelOpen(wallpaperPanel.classList.contains('hidden'));
      });
    }
    if (btnCloseWallpaperPanel) {
      btnCloseWallpaperPanel.addEventListener('click', () => setWallpaperPanelOpen(false));
    }
    document.addEventListener('click', (e) => {
      if (!wallpaperPanel || wallpaperPanel.classList.contains('hidden')) return;
      if (wallpaperPanel.contains(e.target) || btnWallpaperToggle?.contains(e.target)) return;
      setWallpaperPanelOpen(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && wallpaperPanel && !wallpaperPanel.classList.contains('hidden')) {
        setWallpaperPanelOpen(false);
      }
    });

    if (btnWallpaperAuto) {
      btnWallpaperAuto.addEventListener('click', () => {
        persistWallpaper({ type: 'preset', preset: '' });
      });
    }

    document.querySelectorAll('[data-wp-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.wpPreset;
        if (!VALID_WALLPAPER_PRESETS.has(preset)) return;
        persistWallpaper({ type: 'preset', preset });
      });
    });

    if (btnWallpaperNone) {
      btnWallpaperNone.addEventListener('click', () => {
        persistWallpaper({ type: 'none' });
      });
    }

    const triggerWallpaperFilePicker = () => {
      showWallpaperError('');
      if (wallpaperFileInput) {
        wallpaperFileInput.value = '';
        wallpaperFileInput.click();
      }
    };

    if (btnWallpaperChooseEmpty) btnWallpaperChooseEmpty.addEventListener('click', triggerWallpaperFilePicker);
    if (btnWallpaperChange) btnWallpaperChange.addEventListener('click', triggerWallpaperFilePicker);

    const applySavedCustomWallpaper = () => {
      if (currentWallpaper.file && cachedCustomDataUrl) {
        persistWallpaper({ type: 'custom' });
      }
    };
    if (btnWallpaperUseCustom) btnWallpaperUseCustom.addEventListener('click', applySavedCustomWallpaper);
    if (wpCustomPreview) wpCustomPreview.addEventListener('click', applySavedCustomWallpaper);

    if (btnWallpaperRemove) {
      btnWallpaperRemove.addEventListener('click', async () => {
        showWallpaperError('');
        if (!window.gxNewTabAPI?.removeCustomWallpaper) return;
        const res = await window.gxNewTabAPI.removeCustomWallpaper();
        cachedCustomFile = '';
        cachedCustomDataUrl = '';
        if (res?.settings?.wallpaper) {
          await syncWallpaperFromSettings(res.settings.wallpaper, '');
        } else {
          await syncWallpaperFromSettings({ ...currentWallpaper, type: 'preset', file: '' }, '');
        }
      });
    }

    if (wallpaperFileInput) {
      wallpaperFileInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        showWallpaperError('');

        const extMatch = /\.(png|jpe?g|webp|gif)$/i.test(file.name || '');
        const mimeMatch = /^image\/(png|jpeg|webp|gif)$/i.test(file.type || '');
        if (!extMatch && !mimeMatch) {
          showWallpaperError('Unsupported format. Please choose a PNG, JPG, WebP, or GIF image.');
          return;
        }
        if (file.size > WALLPAPER_MAX_BYTES) {
          showWallpaperError('Image is too large. Maximum wallpaper size is 5 MB.');
          return;
        }
        if (!window.gxNewTabAPI?.saveCustomWallpaper) return;

        try {
          const buf = await file.arrayBuffer();
          const res = await window.gxNewTabAPI.saveCustomWallpaper({
            name: file.name,
            type: file.type,
            bytes: new Uint8Array(buf)
          });
          if (!res || !res.ok) {
            showWallpaperError(res?.error || 'Could not save wallpaper image.');
            return;
          }
          await syncWallpaperFromSettings(res.settings?.wallpaper, res.dataUrl || '');
        } catch (_) {
          showWallpaperError('Could not read the selected image file.');
        }
      });
    }

    function applyStartPagePrefs(s) {
      if (!s || typeof s !== 'object') return;
      document.body.classList.toggle('sp-hide-clock', s.startPageShowClock === false);
      document.body.classList.toggle('sp-hide-search', s.startPageShowSearch === false);
      document.body.classList.toggle('sp-hide-dial', s.startPageShowSpeedDial === false);
      document.body.classList.toggle('sp-hide-add', s.startPageShowAddButton === false);
      document.body.classList.toggle('sp-hide-names', s.startPageShowNames === false);
      document.body.classList.toggle('sp-bigger-tiles', Boolean(s.startPageBiggerTiles));
      document.body.classList.toggle('sp-hide-suggestions', s.startPageShowSuggestions === false);
    }

    function applyTheme(theme) {
      currentTheme = theme || 'gx-violet';
      document.documentElement.setAttribute('data-theme', currentTheme);
      applyWallpaperUI();
    }

    function renderSystemStats(system) {
      if (!system) return;
      const el = document.getElementById('sdRamReport');
      if (!el) return;
      el.textContent = `RAM: ${system.browserRamMB} MB`;
    }

    const IGNORED_SUGGESTION_HOST_RE =
      /^(accounts?|myaccount|one\.google|signin|login|auth|sso|oauth|consent|payments?|billing|checkout|id|localhost|127\.0\.0\.1)(\.|$)/i;

    function formatSuggestionLabel(host) {
      const parts = String(host || '').split('.').filter(Boolean);
      if (parts.length >= 3 && parts[1].length <= 3 && parts[parts.length - 1].length <= 3) {
        return parts.slice(-3).join('.');
      }
      if (parts.length >= 3 && /^(en|m|mobile|web|app|www)$/i.test(parts[0])) {
        return parts.slice(1).join('.');
      }
      return host;
    }

    function renderSuggestions(historyList, speedDialList) {
      const sec = document.getElementById('suggestionsSection');
      const grid = document.getElementById('suggestionsGrid');
      if (!sec || !grid) return;
      const dialHosts = new Set(
        (Array.isArray(speedDialList) ? speedDialList : [])
          .map((d) => parseHostForTile(d.url))
          .filter(Boolean)
      );
      const seen = new Set();
      const picks = [];
      const sorted = [...(Array.isArray(historyList) ? historyList : [])]
        .sort((a, b) => (Number(b.visitCount) || 1) - (Number(a.visitCount) || 1) || (b.visitedAt || 0) - (a.visitedAt || 0));

      for (const item of sorted) {
        if (!item || !item.url) continue;
        try {
          const u = new URL(item.url);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
          const host = u.hostname.replace(/^www\./, '').toLowerCase();
          if (!host || IGNORED_SUGGESTION_HOST_RE.test(host) || seen.has(host) || dialHosts.has(host)) continue;
          seen.add(host);
          picks.push({ host, label: formatSuggestionLabel(host), url: u.origin });
          if (picks.length >= 4) break;
        } catch (_) {}
      }

      if (!picks.length) {
        sec.classList.add('hidden');
        grid.innerHTML = '';
        return;
      }

      sec.classList.remove('hidden');
      grid.innerHTML = '';
      picks.forEach((p) => {
        const chip = document.createElement('div');
        chip.className = 'suggestion-chip';
        chip.title = p.url;

        const iconWrap = document.createElement('span');
        iconWrap.className = 'suggestion-chip-icon';
        const brand = TILE_BRANDS.find((b) => b.match(p.host)) || null;
        if (brand && brand.svg) {
          iconWrap.innerHTML = brand.svg.replace(/width="\d+" height="\d+"/, 'width="16" height="16"');
        } else {
          const letter = document.createElement('span');
          letter.className = 'suggestion-chip-letter';
          letter.textContent = p.label.charAt(0).toUpperCase();
          const favSrc = buildSiteFaviconCandidate(p.url, p.host);
          if (favSrc) {
            const img = document.createElement('img');
            img.alt = '';
            img.loading = 'lazy';
            img.addEventListener('error', () => img.replaceWith(letter));
            img.src = favSrc;
            iconWrap.appendChild(img);
          } else {
            iconWrap.appendChild(letter);
          }
        }

        const label = document.createElement('span');
        label.className = 'suggestion-chip-label';
        label.textContent = p.label;

        chip.append(iconWrap, label);
        chip.addEventListener('click', () => {
          window.gxNewTabAPI?.navigate(p.url);
        });
        grid.appendChild(chip);
      });
    }

    const btnToggleNotes = document.getElementById('btnToggleNotes');
    const btnCloseNotes = document.getElementById('btnCloseNotes');
    const notesPopover = document.getElementById('notesPopover');
    if (btnToggleNotes && notesPopover) {
      btnToggleNotes.addEventListener('click', () => {
        const willOpen = notesPopover.classList.contains('hidden');
        notesPopover.classList.toggle('hidden', !willOpen);
        btnToggleNotes.classList.toggle('active', willOpen);
        if (willOpen) quickNotesInput?.focus();
      });
    }
    if (btnCloseNotes && notesPopover) {
      btnCloseNotes.addEventListener('click', () => {
        notesPopover.classList.add('hidden');
        btnToggleNotes?.classList.remove('active');
      });
    }

    async function init() {
      const params = new URLSearchParams(window.location.search);
      const initialTheme = params.get('theme');
      if (initialTheme) {
        applyTheme(initialTheme);
      }

      if (window.gxNewTabAPI?.onSettingsUpdate) {
        window.gxNewTabAPI.onSettingsUpdate((s) => {
          if (s && s.theme) applyTheme(s.theme);
          if (s) applyStartPagePrefs(s);
          if (s && s.wallpaper && !isPrivateMode) {
            syncWallpaperFromSettings(s.wallpaper);
          }
        });
      }

      if (params.get('incognito') === '1') {
        isPrivateMode = true;
        document.documentElement.setAttribute('data-incognito', 'true');
        document.body.classList.add('private-mode');
        document.title = 'Private Browsing — nextGx';
        document.getElementById('searchInput').placeholder = 'Search privately...';
        if (window.gxNewTabAPI?.getSettings) {
          window.gxNewTabAPI.getSettings().then((s) => {
            applyTheme(s?.theme);
            // [FIXUP-6] Hide the third-party-cookies card when the user
            // allows third-party cookies (default is 'block-incognito').
            if (s && s.thirdPartyCookies === 'allow') {
              document.getElementById('tpCookiesCard')?.classList.add('hidden');
            }
          }).catch(() => {});
        }
        return;
      }
      if (!window.gxNewTabAPI) return;
      const [data, historyList] = await Promise.all([
        window.gxNewTabAPI.getInitialData(),
        window.gxNewTabAPI.getHistory ? window.gxNewTabAPI.getHistory().catch(() => []) : Promise.resolve([])
      ]);
      if (data.settings?.theme) {
        applyTheme(data.settings.theme);
      }
      if (data.settings) {
        applyStartPagePrefs(data.settings);
      }
      await syncWallpaperFromSettings(data.settings?.wallpaper, data.wallpaperDataUrl || '');
      renderDials(data.speedDial);
      renderSuggestions(historyList, data.speedDial);
      if (data.adblock) {
        const blkEl = document.getElementById('sdBlockedCount');
        if (blkEl) blkEl.innerHTML = `<strong>${data.adblock.totalBlocked || 0}</strong> Blocked`;
      }
      if (data.system) {
        renderSystemStats(data.system);
      }
      if (window.gxNewTabAPI?.onSystemStats) {
        window.gxNewTabAPI.onSystemStats((stats) => renderSystemStats(stats));
      }
      if (data.notes && data.notes[0]) {
        quickNotesInput.value = data.notes[0].text || '';
      }
    }
    init();
  

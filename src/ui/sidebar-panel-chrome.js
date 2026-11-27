    const SIDEBAR_PANEL_DEFAULT_WIDTH = 380;
    const SIDEBAR_PANEL_MIN_WIDTH = 260;
    const SIDEBAR_PANEL_MAX_WIDTH = 1600;

    const SERVICE_LOGOS = {
      'https://www.youtube.com': `<svg viewBox="0 0 24 24" width="18" height="18"><rect x="2" y="5" width="20" height="14" rx="4.5" fill="#ff0000"/><polygon points="10,9 16,12 10,15" fill="#fff"/></svg>`,
      'https://music.youtube.com': `<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="10" fill="#ff0033"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="#fff" stroke-width="1.3"/><polygon points="10.5,9.5 15,12 10.5,14.5" fill="#fff"/></svg>`,
      'https://open.spotify.com': `<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="10" fill="#1db954"/><path d="M7 9.5c3.5-1 7-.8 10 .5M7.5 12.5c3-.8 6-.6 8.5.4M8.2 15.5c2.2-.6 4.5-.5 6.5.3" fill="none" stroke="#0b0c10" stroke-width="1.7" stroke-linecap="round"/></svg>`,
      'https://music.apple.com': `<svg viewBox="0 0 24 24" width="18" height="18"><rect x="2" y="2" width="20" height="20" rx="5" fill="#fa243c"/><path d="M15 7v8.2a2.2 2.2 0 1 1-1.5-2.1V9.2l-4 1v5a2.2 2.2 0 1 1-1.5-2.1V8.4L15 7z" fill="#fff"/></svg>`,
      'https://soundcloud.com': `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M11 17h7.5a3 3 0 0 0 .4-5.97A4.5 4.5 0 0 0 10 9.5V17h1z" fill="#ff5500"/><path d="M7.5 11v6M5.5 12.5v4.5M3.5 13.5v3.5" stroke="#ff5500" stroke-width="1.6" stroke-linecap="round"/></svg>`,
      'https://www.deezer.com': `<svg viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="15" width="3.5" height="3" fill="#a238ff"/><rect x="8" y="12" width="3.5" height="6" fill="#c084fc"/><rect x="13" y="9" width="3.5" height="9" fill="#00e5ff"/><rect x="18" y="6" width="3.5" height="12" fill="#10b981"/></svg>`,
      'https://listen.tidal.com': `<svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><polygon points="6,8 9,11 6,14 3,11"/><polygon points="12,8 15,11 12,14 9,11"/><polygon points="18,8 21,11 18,14 15,11"/><polygon points="12,14 15,17 12,20 9,17"/></svg>`,
      'https://www.twitch.tv': `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4.5 2L3 6v14h5v2h3l2-2h3.5L21 15.5V2H4.5z" fill="#9146ff"/><polygon points="6,4 19,4 19,14.5 16,17.5 12.5,17.5 10.5,19.5 10.5,17.5 6,17.5" fill="#fff"/><rect x="10" y="7.5" width="2" height="5" fill="#9146ff"/><rect x="15" y="7.5" width="2" height="5" fill="#9146ff"/></svg>`,
      'https://chatgpt.com': `<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="10" fill="#10a37f"/><g fill="none" stroke="#fff" stroke-width="1.35" stroke-linecap="round"><path d="M10.27 13V7.6A2.4 2.4 0 0 1 14.94 8.3"/><path d="M10.27 13V7.6A2.4 2.4 0 0 1 14.94 8.3" transform="rotate(60 12 12)"/><path d="M10.27 13V7.6A2.4 2.4 0 0 1 14.94 8.3" transform="rotate(120 12 12)"/><path d="M10.27 13V7.6A2.4 2.4 0 0 1 14.94 8.3" transform="rotate(180 12 12)"/><path d="M10.27 13V7.6A2.4 2.4 0 0 1 14.94 8.3" transform="rotate(240 12 12)"/><path d="M10.27 13V7.6A2.4 2.4 0 0 1 14.94 8.3" transform="rotate(300 12 12)"/></g></svg>`,
      'https://claude.ai': `<svg viewBox="0 0 24 24" width="18" height="18"><g stroke="#d97757" stroke-width="2" stroke-linecap="round"><line x1="12" y1="3" x2="12" y2="21"/><line x1="12" y1="3" x2="12" y2="21" transform="rotate(36 12 12)"/><line x1="12" y1="3" x2="12" y2="21" transform="rotate(72 12 12)"/><line x1="12" y1="3" x2="12" y2="21" transform="rotate(108 12 12)"/><line x1="12" y1="3" x2="12" y2="21" transform="rotate(144 12 12)"/></g><circle cx="12" cy="12" r="2.2" fill="#d97757"/></svg>`,
      'https://gemini.google.com': `<svg viewBox="0 0 24 24" width="18" height="18"><defs><linearGradient id="nxGeminiGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#4285f4"/><stop offset="55%" stop-color="#9b72cb"/><stop offset="100%" stop-color="#d96570"/></linearGradient></defs><path d="M12 2C12 7.5 16.5 12 22 12C16.5 12 12 16.5 12 22C12 16.5 7.5 12 2 12C7.5 12 12 7.5 12 2Z" fill="url(#nxGeminiGrad)"/></svg>`,
      'https://www.perplexity.ai': `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#20b8cd" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M6.5 8.5V4l5.5 4.5L17.5 4v4.5"/><path d="M4.5 8.5h15v7h-2.5m-10 0H4.5v-7"/><path d="M12 8.5l-5.5 5.5v6l5.5-4.5 5.5 4.5v-6L12 8.5z"/></svg>`,
      'https://web.whatsapp.com': `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 2.5a9.5 9.5 0 0 0-8.2 14.3L2.5 21.5l4.9-1.3A9.5 9.5 0 1 0 12 2.5z" fill="#25d366"/><path d="M9.6 8.0c-.4-.1-.9.1-1.3.5-.5.6-.7 1.4-.4 2.3.8 2.2 2.9 4.4 5.1 5.3.9.4 1.8.2 2.4-.3.4-.4.6-.9.5-1.3-.1-.3-.4-.5-.8-.7l-1.3-.6c-.3-.2-.6-.1-.8.2l-.6.7c-.2.2-.5.2-.8.1-.8-.4-1.6-1.2-2-2-.1-.3-.1-.6.1-.8l.7-.6c.3-.2.4-.5.2-.8l-.6-1.3c-.2-.4-.4-.7-.7-.7z" fill="#fff"/></svg>`,
      'https://discord.com/app': `<svg viewBox="0 0 24 24" width="18" height="18"><rect x="2" y="2" width="20" height="20" rx="5" fill="#5865f2"/><path d="M16.5 8.1a10.4 10.4 0 0 0-2.6-.8l-.3.7a9.7 9.7 0 0 0-3.2 0l-.3-.7a10.4 10.4 0 0 0-2.6.8C5.9 10.5 5.4 12.9 5.6 15.2a10.6 10.6 0 0 0 3.2 1.6l.6-1a6.8 6.8 0 0 1-1-.5l.2-.2a7.5 7.5 0 0 0 6.8 0l.2.2a6.8 6.8 0 0 1-1 .5l.6 1a10.6 10.6 0 0 0 3.2-1.6c.3-2.7-.5-5.1-1.9-7.1z" fill="#fff"/><circle cx="9.8" cy="12.6" r="1.2" fill="#5865f2"/><circle cx="14.2" cy="12.6" r="1.2" fill="#5865f2"/></svg>`
    };

    const INTERNAL_PANEL_ICONS = {
      player: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="color:var(--nx-accent-bright);"><circle cx="12" cy="12" r="9"/><polygon points="10 8.5 16 12 10 15.5 10 8.5" fill="currentColor" stroke="none"/></svg>`
    };

    let sidebarPanelState = {
      open: false,
      activeKey: null,
      title: '',
      serviceUrl: '',
      currentUrl: '',
      isInternal: false,
      isLoading: false,
      pinned: false,
      width: SIDEBAR_PANEL_DEFAULT_WIDTH
    };
    let isResizingSidebarPanel = false;
    let maxEffectiveWidth = SIDEBAR_PANEL_MAX_WIDTH;
    let sidebarResizeStartX = 0;
    let sidebarResizeStartWidth = SIDEBAR_PANEL_DEFAULT_WIDTH;
    let activeSidebarPointerId = null;

    const sidebarPanel = document.getElementById('sidebarPanel');
    const sidebarPanelIcon = document.getElementById('sidebarPanelIcon');
    const sidebarPanelTitle = document.getElementById('sidebarPanelTitle');
    const btnSidebarWide = document.getElementById('btnSidebarWide');
    const btnSidebarPin = document.getElementById('btnSidebarPin');
    const btnSidebarReload = document.getElementById('btnSidebarReload');
    const btnSidebarOpenTab = document.getElementById('btnSidebarOpenTab');
    const btnSidebarClose = document.getElementById('btnSidebarClose');
    const sidebarPanelResizer = document.getElementById('sidebarPanelResizer');

    function clampWidth(rawWidth) {
      const num = Number(rawWidth);
      if (!Number.isFinite(num)) return SIDEBAR_PANEL_DEFAULT_WIDTH;
      return Math.max(SIDEBAR_PANEL_MIN_WIDTH, Math.min(SIDEBAR_PANEL_MAX_WIDTH, Math.round(num)));
    }

    function clampEffectiveWidth(rawWidth) {
      const base = clampWidth(rawWidth);
      const cap =
        typeof maxEffectiveWidth === 'number' && Number.isFinite(maxEffectiveWidth) && maxEffectiveWidth >= 240
          ? Math.min(SIDEBAR_PANEL_MAX_WIDTH, Math.floor(maxEffectiveWidth))
          : SIDEBAR_PANEL_MAX_WIDTH;
      return Math.min(base, cap);
    }

    function applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme || 'gx-violet');
    }

    function applySettings(s) {
      if (!s || typeof s !== 'object') return;
      if (s.theme) applyTheme(s.theme);
      window.gxSounds?.setConfig({
        enabled: s.uiSoundsEnabled !== false,
        volume: typeof s.uiSoundsVolume === 'number' ? s.uiSoundsVolume : 0.35
      });
      if (!isResizingSidebarPanel && typeof s.sidebarPanelWidth === 'number') {
        sidebarPanelState.width = clampWidth(s.sidebarPanelWidth);
      }
      if (typeof s.sidebarPanelPinned === 'boolean') {
        sidebarPanelState.pinned = Boolean(s.sidebarPanelPinned);
        renderPanelChrome();
      }
    }

    function renderPanelChrome() {
      const pinned = Boolean(sidebarPanelState.pinned);
      if (sidebarPanel) {
        sidebarPanel.classList.toggle('pinned', pinned);
      }
      if (sidebarPanelIcon) {
        sidebarPanelIcon.innerHTML =
          (sidebarPanelState.activeKey && INTERNAL_PANEL_ICONS[sidebarPanelState.activeKey]) ||
          (sidebarPanelState.serviceUrl && SERVICE_LOGOS[sidebarPanelState.serviceUrl]) ||
          '';
      }
      if (sidebarPanelTitle) {
        sidebarPanelTitle.textContent = sidebarPanelState.title || sidebarPanelState.activeKey || 'Service';
      }
      if (btnSidebarOpenTab) {
        btnSidebarOpenTab.classList.toggle('hidden', Boolean(sidebarPanelState.isInternal));
      }
      if (btnSidebarPin) {
        btnSidebarPin.classList.toggle('pinned', pinned);
        btnSidebarPin.classList.toggle('active', pinned);
        btnSidebarPin.setAttribute('aria-pressed', pinned ? 'true' : 'false');
        btnSidebarPin.title = pinned ? 'Unpin panel (float over page)' : 'Pin panel beside tab';
      }
      if (btnSidebarWide) {
        const wideTarget = Math.max(520, Math.round(maxEffectiveWidth * 0.94));
        const isWide = (sidebarPanelState.width || SIDEBAR_PANEL_DEFAULT_WIDTH) >= wideTarget - 40;
        btnSidebarWide.classList.toggle('active', isWide);
        btnSidebarWide.title = isWide ? 'Restore compact width (380px)' : 'Expand panel (70% width)';
      }
      if (btnSidebarReload) {
        btnSidebarReload.classList.toggle('spinning', Boolean(sidebarPanelState.isLoading));
      }
    }

    function applySidebarPanelState(nextState) {
      if (!nextState || typeof nextState !== 'object') return;
      if (typeof nextState.maxWidth === 'number' && Number.isFinite(nextState.maxWidth) && nextState.maxWidth >= 240) {
        maxEffectiveWidth = Math.min(SIDEBAR_PANEL_MAX_WIDTH, Math.floor(nextState.maxWidth));
      }
      const resolvedWidth = isResizingSidebarPanel
        ? clampEffectiveWidth(sidebarPanelState.width)
        : clampWidth(nextState.width ?? sidebarPanelState.width);
      sidebarPanelState = {
        ...sidebarPanelState,
        ...nextState,
        width: resolvedWidth,
        pinned: Boolean(nextState.pinned ?? sidebarPanelState.pinned),
        open: Boolean(nextState.open && nextState.activeKey)
      };
      renderPanelChrome();
    }

    if (btnSidebarWide) {
      btnSidebarWide.addEventListener('click', async () => {
        window.gxSounds?.playClick();
        const wideTarget = clampEffectiveWidth(Math.round(maxEffectiveWidth * 0.94));
        const isWide = (sidebarPanelState.width || SIDEBAR_PANEL_DEFAULT_WIDTH) >= wideTarget - 40;
        const target = isWide ? SIDEBAR_PANEL_DEFAULT_WIDTH : wideTarget;
        sidebarPanelState.width = target;
        const state = await window.gxAPI.setSidebarWidth(target, { persist: true });
        applySidebarPanelState(state);
      });
    }

    btnSidebarPin.addEventListener('click', async () => {
      window.gxSounds?.playClick();
      const state = await window.gxAPI.toggleSidebarPin();
      applySidebarPanelState(state);
    });

    btnSidebarReload.addEventListener('click', async () => {
      window.gxSounds?.playClick();
      const state = await window.gxAPI.reloadSidebarPanel();
      applySidebarPanelState(state);
    });

    btnSidebarOpenTab.addEventListener('click', async () => {
      window.gxSounds?.playTabOpen();
      await window.gxAPI.openSidebarPanelInNewTab();
    });

    btnSidebarClose.addEventListener('click', async () => {
      window.gxSounds?.playClick();
      const state = await window.gxAPI.closeSidebarPanel();
      applySidebarPanelState(state);
    });

    function beginSidebarPanelResize(screenX, pointerId = null) {
      if (isResizingSidebarPanel) return;
      isResizingSidebarPanel = true;
      window.gxAPI.setSidebarResizing?.(true);
      sidebarResizeStartWidth = clampEffectiveWidth(sidebarPanelState.width);
      sidebarResizeStartX = typeof screenX === 'number' ? screenX : sidebarResizeStartWidth;
      activeSidebarPointerId = pointerId;
      sidebarPanelResizer.classList.add('dragging');
      sidebarPanel.classList.add('resizing');
      if (pointerId !== null && sidebarPanelResizer.setPointerCapture) {
        try {
          sidebarPanelResizer.setPointerCapture(pointerId);
        } catch (_) {}
      }
    }

    let pendingResizeWidth = null;
    let resizeRafId = 0;

    function flushSidebarPanelResize() {
      resizeRafId = 0;
      if (pendingResizeWidth === null) return;
      const w = pendingResizeWidth;
      pendingResizeWidth = null;
      window.gxAPI.setSidebarWidth(w, { persist: false });
    }

    function updateSidebarPanelResize(screenX) {
      if (!isResizingSidebarPanel || typeof screenX !== 'number') return;
      const delta = screenX - sidebarResizeStartX;
      const nextWidth = clampEffectiveWidth(sidebarResizeStartWidth + delta);
      if (nextWidth !== sidebarPanelState.width) {
        sidebarPanelState.width = nextWidth;
        pendingResizeWidth = nextWidth;
        if (!resizeRafId) {
          resizeRafId = requestAnimationFrame(flushSidebarPanelResize);
        }
      }
    }

    function endSidebarPanelResize() {
      if (!isResizingSidebarPanel) return;
      isResizingSidebarPanel = false;
      if (resizeRafId) {
        cancelAnimationFrame(resizeRafId);
        resizeRafId = 0;
      }
      pendingResizeWidth = null;
      sidebarPanelResizer.classList.remove('dragging');
      sidebarPanel.classList.remove('resizing');
      if (activeSidebarPointerId !== null && sidebarPanelResizer.releasePointerCapture) {
        try {
          sidebarPanelResizer.releasePointerCapture(activeSidebarPointerId);
        } catch (_) {}
      }
      activeSidebarPointerId = null;
      const finalWidth = clampEffectiveWidth(sidebarPanelState.width);
      sidebarPanelState.width = finalWidth;
      window.gxAPI.setSidebarWidth(finalWidth, { persist: true });
      window.gxAPI.setSidebarResizing?.(false);
    }

    let lastSidebarResizerPointerDownAt = 0;

    sidebarPanelResizer.addEventListener('dblclick', (e) => {
      e.preventDefault();
      sidebarPanelState.width = 380;
      window.gxAPI.setSidebarWidth(380, { persist: true });
    });

    sidebarPanelResizer.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      const now = Date.now();
      if (now - lastSidebarResizerPointerDownAt < 400) {
        lastSidebarResizerPointerDownAt = 0;
        sidebarPanelState.width = 380;
        window.gxAPI.setSidebarWidth(380, { persist: true });
        return;
      }
      lastSidebarResizerPointerDownAt = now;
      beginSidebarPanelResize(e.screenX, e.pointerId);
    });

    sidebarPanelResizer.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || isResizingSidebarPanel) return;
      e.preventDefault();
      beginSidebarPanelResize(e.screenX, null);
    });

    window.addEventListener('pointermove', (e) => {
      if (!isResizingSidebarPanel) return;
      updateSidebarPanelResize(e.screenX);
    });

    window.addEventListener('mousemove', (e) => {
      if (!isResizingSidebarPanel) return;
      updateSidebarPanelResize(e.screenX);
    });

    window.addEventListener('pointerup', () => {
      if (isResizingSidebarPanel) endSidebarPanelResize();
    });

    window.addEventListener('pointercancel', () => {
      if (isResizingSidebarPanel) endSidebarPanelResize();
    });

    window.addEventListener('mouseup', () => {
      if (isResizingSidebarPanel) endSidebarPanelResize();
    });

    (function init() {
      const params = new URLSearchParams(window.location.search);
      if (params.get('incognito') === '1') {
        document.documentElement.setAttribute('data-incognito', 'true');
      }
      const initialTheme = params.get('theme');
      if (initialTheme) applyTheme(initialTheme);

      window.gxAPI?.onSettingsUpdate?.((s) => applySettings(s));
      window.gxAPI?.onSidebarUpdate?.((state) => applySidebarPanelState(state));

      window.gxAPI?.getSettings?.().then((s) => applySettings(s)).catch(() => {});
      window.gxAPI?.getSidebarState?.().then((state) => applySidebarPanelState(state)).catch(() => {});
    })();
  

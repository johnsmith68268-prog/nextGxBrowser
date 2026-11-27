    function applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme || 'gx-violet');
    }

    (function initThemeSync() {
      const params = new URLSearchParams(window.location.search);
      if (params.get('incognito') === '1') {
        document.documentElement.setAttribute('data-incognito', 'true');
      }
      const initialTheme = params.get('theme');
      if (initialTheme) applyTheme(initialTheme);
      window.gxAPI?.getSettings?.().then((s) => applyTheme(s?.theme)).catch(() => { });
      window.gxAPI?.onSettingsUpdate?.((s) => {
        if (s && s.theme) applyTheme(s.theme);
      });
    })();

    let currentShieldOrigin = '';
    let currentShieldUrl = '';
    let lastShieldSiteInfo = null;
    let currentTabCtx = null;
    let currentRailCtx = null;
    let currentGroupCtx = null;
    let currentWorkspaceCtx = null;
    let currentWorkspaceMode = null;
    let currentBmFolderName = '';
    // [TABS-W2] Gap 1.5 — tracks whether the chrome window has been told a
    // permission prompt is open, so the omnibox chip can be cleared on close.
    let lastPromptNotifiedOpen = false;
    // [TABS-W2] Gap 8.1 — tab search popover state (payload tabs, filtered
    // by the popover's own input; keyboard selection index).
    let tsTabs = [];
    let tsSelected = 0;
    let currentProfilesData = null;
    let profInlineMode = null; // null | { type: 'add', color } | { type: 'rename', profile, color } | { type: 'delete', profile }
    const PROFILE_COLOR_CHOICES = [
      { id: 'gx-violet', label: 'Violet' },
      { id: 'cyan', label: 'Cyan' },
      { id: 'emerald', label: 'Emerald' },
      { id: 'crimson', label: 'Crimson' },
      { id: 'magenta', label: 'Magenta' },
      { id: 'amber', label: 'Amber' },
      { id: 'lime', label: 'Lime' },
      { id: 'ice', label: 'Ice' }
    ];

    function escapeHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    const MENU_STYLE_KINDS = new Set([
      'menu',
      'tab-context',
      'rail-context',
      'address-context',
      'bookmark-folder',
      'extensions-dropdown',
      'screenshot',
      'split-menu'
    ]);

    let activePopoverKind = null;
    let activeViewId = null;
    let currentAddrCtx = null;
    let popoverOpenSeq = 0;
    let lastReportedSize = { kind: null, width: 0, height: 0 };
    let settleTimer = null;
    let viewMutationObserver = null;
    let isMeasuringPopover = false;

    function resetPopoverOnClose() {
      // Chrome parity (worker A): a share picker closed without an explicit
      // Share/Cancel (outside click, Escape) cancels the display-media
      // request; a permission prompt closed the same way stores no decision
      // (main resolves it as denied via onPermissionPopoverClosed).
      const closingKind = activePopoverKind;
      if (closingKind === 'share-picker' && currentShareRequestId && !sharePickerResponded) {
        sharePickerResponded = true;
        window.gxAPI.respondPermissionPrompt?.({
          displayMediaRequestId: currentShareRequestId,
          decision: 'cancel'
        });
      }
      currentShareRequestId = '';
      sharePickerResponded = false;
      stopPermPreview();
      popoverOpenSeq += 1;
      activePopoverKind = null;
      activeViewId = null;
      currentShieldOrigin = '';
      currentShieldUrl = '';
      lastShieldSiteInfo = null;
      currentTabCtx = null;
      currentRailCtx = null;
      currentAddrCtx = null;
      currentGroupCtx = null;
      currentWorkspaceCtx = null;
      currentWorkspaceMode = null;
      currentBmFolderName = '';
      currentProfilesData = null;
      profInlineMode = null;
      lastReportedSize = { kind: null, width: 0, height: 0 };
      clearTimeout(settleTimer);
      settleTimer = null;
      if (viewMutationObserver) {
        viewMutationObserver.disconnect();
        viewMutationObserver = null;
      }
      document.body.removeAttribute('data-popover-kind');
      showOnly(null);
    }

    function showOnly(viewId) {
      [
        'view-menu',
        // [TABS-W2] 'view-permissions' removed — the old lock popover is
        // unreachable (the lock button opens the renderer site-info bubble).
        'view-permission-prompt',
        'view-share-picker',
        'view-screenshot',
        'view-split-menu',
        'view-downloads',
        'view-shield',
        'view-site-info',
        'view-zoom-bubble',
        'view-tab-context',
        'view-rail-context',
        'view-address-context',
        'view-group-context',
        'view-workspace-context',
        'view-bookmark-folder',
        'view-extensions-dropdown',
        'view-profiles',
        // [TABS-W2]
        'view-bookmark-bubble',
        'view-qr-code',
        'view-reading-list',
        'view-tab-search',
        'view-omnibox-suggest'
      ].forEach((id) => {
        // M-1: never let one missing view kill the whole popover handler.
        const el = document.getElementById(id);
        if (el) el.classList.toggle('hidden', id !== viewId);
      });
    }

    function measureAndResizePopover(kind, viewId, { force = false } = {}) {
      if (!window.gxAPI?.resizePopover || isMeasuringPopover) return;
      if (!kind || !viewId) return;
      const viewEl = document.getElementById(viewId);
      if (!viewEl || viewEl.classList.contains('hidden')) return;

      isMeasuringPopover = true;
      try {
        const bodyStyle = window.getComputedStyle(document.body);
        const padX =
          (parseFloat(bodyStyle.paddingLeft) || 0) +
          (parseFloat(bodyStyle.paddingRight) || 0) +
          (parseFloat(bodyStyle.borderLeftWidth) || 0) +
          (parseFloat(bodyStyle.borderRightWidth) || 0);
        const padY =
          (parseFloat(bodyStyle.paddingTop) || 0) +
          (parseFloat(bodyStyle.paddingBottom) || 0) +
          (parseFloat(bodyStyle.borderTopWidth) || 0) +
          (parseFloat(bodyStyle.borderBottomWidth) || 0);

        const innerLists = Array.from(viewEl.querySelectorAll('.pop-scroll-list')).filter(
          (el) => !el.classList.contains('ts-list')
        );
        const prevViewMaxH = viewEl.style.maxHeight;
        const prevViewOverflowY = viewEl.style.overflowY;
        const prevViewWidth = viewEl.style.width;
        const prevListStyles = innerLists.map((el) => ({
          el,
          maxHeight: el.style.maxHeight,
          overflowY: el.style.overflowY,
          flex: el.style.flex
        }));

        viewEl.style.maxHeight = 'none';
        viewEl.style.overflowY = 'visible';
        for (const item of prevListStyles) {
          item.el.style.maxHeight = 'none';
          item.el.style.overflowY = 'visible';
          item.el.style.flex = '0 0 auto';
        }

        const isMenuStyle = MENU_STYLE_KINDS.has(kind);
        let targetW = null;
        if (isMenuStyle) {
          viewEl.style.width = 'max-content';
          const rectW = viewEl.getBoundingClientRect().width;
          const naturalViewW = Math.max(viewEl.scrollWidth, Math.ceil(rectW));
          viewEl.style.width = prevViewWidth;
          targetW = Math.ceil(naturalViewW + padX + 4);
        } else {
          let overflowW = Math.max(0, viewEl.scrollWidth - viewEl.clientWidth);
          for (const row of viewEl.querySelectorAll('.perm-row, .shield-actions, .dl-mini-top')) {
            overflowW = Math.max(overflowW, row.scrollWidth - row.clientWidth);
          }
          if (overflowW > 1) {
            const currentW = window.innerWidth || Math.ceil(viewEl.getBoundingClientRect().width + padX);
            targetW = Math.ceil(currentW + overflowW);
          }
        }

        const rectH = viewEl.getBoundingClientRect().height;
        const naturalViewH = Math.max(viewEl.scrollHeight, Math.ceil(rectH));

        viewEl.style.maxHeight = prevViewMaxH;
        viewEl.style.overflowY = prevViewOverflowY;
        for (const item of prevListStyles) {
          item.el.style.maxHeight = item.maxHeight;
          item.el.style.overflowY = item.overflowY;
          item.el.style.flex = item.flex;
        }

        const contentH = Math.ceil(naturalViewH + padY + 4);

        if (contentH > 0 && (!isMenuStyle || (targetW && targetW > 0))) {
          const sameWidth =
            targetW === null
              ? true
              : typeof lastReportedSize.width === 'number' &&
              Math.abs(lastReportedSize.width - targetW) <= 1;
          const sameAsLast =
            !force &&
            lastReportedSize.kind === kind &&
            sameWidth &&
            Math.abs(lastReportedSize.height - contentH) <= 1;
          if (!sameAsLast) {
            const nextPayload =
              targetW !== null ? { kind, width: targetW, height: contentH } : { kind, height: contentH };
            lastReportedSize = {
              kind,
              width:
                targetW !== null
                  ? targetW
                  : lastReportedSize.kind === kind
                    ? lastReportedSize.width
                    : null,
              height: contentH
            };
            window.gxAPI.resizePopover(nextPayload);
          }
        }
      } finally {
        isMeasuringPopover = false;
      }
    }

    function observeActiveView(kind, viewId) {
      if (viewMutationObserver) {
        viewMutationObserver.disconnect();
        viewMutationObserver = null;
      }
      const viewEl = document.getElementById(viewId);
      if (!viewEl || typeof MutationObserver !== 'function') return;
      viewMutationObserver = new MutationObserver(() => {
        if (isMeasuringPopover || activePopoverKind !== kind || activeViewId !== viewId) return;
        requestAnimationFrame(() => {
          if (activePopoverKind === kind && activeViewId === viewId) {
            measureAndResizePopover(kind, viewId);
          }
        });
      });
      viewMutationObserver.observe(viewEl, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }

    function fitPopoverToView(kind, viewId, { reset = false } = {}) {
      if (!window.gxAPI?.resizePopover) return;
      activePopoverKind = kind;
      activeViewId = viewId;
      document.body.setAttribute('data-popover-kind', kind || '');
      if (reset) {
        lastReportedSize = { kind: null, width: 0, height: 0 };
        observeActiveView(kind, viewId);
      }

      requestAnimationFrame(() => {
        if (activePopoverKind !== kind || activeViewId !== viewId) return;
        measureAndResizePopover(kind, viewId, { force: reset });
        requestAnimationFrame(() => {
          if (activePopoverKind === kind && activeViewId === viewId) {
            measureAndResizePopover(kind, viewId);
          }
        });
      });

      if (document.fonts && document.fonts.ready) {
        document.fonts.ready
          .then(() => {
            if (activePopoverKind === kind && activeViewId === viewId) {
              measureAndResizePopover(kind, viewId);
            }
          })
          .catch(() => { });
      }

      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        if (activePopoverKind === kind && activeViewId === viewId) {
          measureAndResizePopover(kind, viewId);
        }
      }, 45);
    }

    const SAFE_DATA_FAVICON_RE =
      /^data:image\/(?:png|jpeg|jpg|webp|gif|x-icon|vnd\.microsoft\.icon);base64,[a-z0-9+/=]+$/i;
    function sanitizeUiFaviconUrl(rawUrl) {
      if (typeof rawUrl !== 'string') return '';
      const trimmed = rawUrl.trim();
      if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return '';
      if (/^data:/i.test(trimmed)) {
        if (trimmed.length > 32768) return '';
        return SAFE_DATA_FAVICON_RE.test(trimmed) ? trimmed : '';
      }
      if (trimmed.length > 2048) return '';
      try {
        const u = new URL(trimmed);
        if (u.protocol === 'https:' || u.protocol === 'http:') return u.toString();
      } catch (_) {}
      return '';
    }

    function getBookmarkFaviconUrl(bm) {
      if (bm && typeof bm.favicon === 'string') {
        const fav = sanitizeUiFaviconUrl(bm.favicon);
        if (fav) return fav;
      }
      if (bm && typeof bm.url === 'string') {
        try {
          const u = new URL(bm.url);
          if (u.protocol === 'http:' || u.protocol === 'https:') {
            return `${u.origin}/favicon.ico`;
          }
        } catch (_) { }
      }
      return '';
    }

    function renderBookmarkFolderItems(folderName, items) {
      currentBmFolderName = folderName || '';
      const titleEl = document.getElementById('bmFolderPopTitle');
      const listEl = document.getElementById('bmFolderPopList');
      if (titleEl) titleEl.textContent = currentBmFolderName || 'Folder';
      if (!listEl) return;
      listEl.innerHTML = '';

      const list = Array.isArray(items) ? items : [];
      if (!list.length) {
        listEl.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px 6px;">Folder is empty.</div>';
        return;
      }

      for (const bm of list) {
        const btn = document.createElement('button');
        btn.className = 'menu-item bm-folder-item';
        btn.type = 'button';
        btn.setAttribute('role', 'menuitem');
        btn.title = `${bm.title || bm.url}\n${bm.url || ''}`;

        const iconWrap = document.createElement('span');
        iconWrap.className = 'bm-pop-icon';
        iconWrap.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--muted);"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8"/></svg>`;
        const fallbackSvg = iconWrap.firstElementChild;

        const favUrl = getBookmarkFaviconUrl(bm);
        if (favUrl) {
          const img = document.createElement('img');
          img.className = 'bm-pop-favicon hidden';
          img.alt = '';
          img.addEventListener('load', () => {
            if (img.naturalWidth > 0) {
              img.classList.remove('hidden');
              if (fallbackSvg) fallbackSvg.classList.add('hidden');
            }
          });
          img.addEventListener('error', () => img.remove());
          img.src = favUrl;
          iconWrap.appendChild(img);
        }

        const label = document.createElement('span');
        label.className = 'bm-pop-label';
        label.textContent = bm.title || bm.url || 'Bookmark';

        btn.appendChild(iconWrap);
        btn.appendChild(label);

        btn.addEventListener('click', () => {
          window.gxAPI.closePopover();
          if (bm.url) window.gxAPI.navigate(bm.url);
        });
        btn.addEventListener('auxclick', (e) => {
          if (e.button === 1 && bm.url) {
            window.gxAPI.closePopover();
            window.gxAPI.createTab({ url: bm.url, active: false });
          }
        });

        listEl.appendChild(btn);
      }
    }

    // [TABS-W2] QR Code encoder (gap 9.4) — compact port of Project Nayuki's
    // qrcodegen (MIT License, https://www.nayuki.io/page/qr-code-generator-library),
    // byte mode, EC level M, versions 1–10. Local only: no library, no network.
    // Returns { version, size, mask, modules } (modules[y][x] booleans) or null
    // when the text is too long for version 10-M (213 bytes).
    const QR_M_ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
    const QR_M_NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
    const QR_MASK_PATTERNS = [
      (x, y) => (x + y) % 2,
      (x, y) => y % 2,
      (x, y) => x % 3,
      (x, y) => (x + y) % 3,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2,
      (x, y) => ((x * y) % 2) + ((x * y) % 3),
      (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2,
      (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2
    ];

    function qrGetBit(x, i) {
      return ((x >>> i) & 1) !== 0;
    }

    function qrRsMultiply(x, y) {
      let z = 0;
      for (let i = 7; i >= 0; i--) {
        z = (z << 1) ^ ((z >> 7) * 0x11d);
        z ^= ((y >> i) & 1) * x;
      }
      return z;
    }

    function qrRsDivisor(degree) {
      const result = new Array(degree).fill(0);
      result[degree - 1] = 1;
      let root = 1;
      for (let i = 0; i < degree; i++) {
        for (let j = 0; j < degree; j++) {
          result[j] = qrRsMultiply(result[j], root);
          if (j + 1 < degree) result[j] ^= result[j + 1];
        }
        root = qrRsMultiply(root, 0x02);
      }
      return result;
    }

    function qrRsRemainder(data, divisor) {
      const result = new Array(divisor.length).fill(0);
      for (const b of data) {
        const factor = b ^ result.shift();
        result.push(0);
        for (let i = 0; i < divisor.length; i++) result[i] ^= qrRsMultiply(divisor[i], factor);
      }
      return result;
    }

    function qrNumRawDataModules(ver) {
      let result = (16 * ver + 128) * ver + 64;
      if (ver >= 2) {
        const numAlign = Math.floor(ver / 7) + 2;
        result -= (25 * numAlign - 10) * numAlign - 55;
        if (ver >= 7) result -= 36;
      }
      return result;
    }

    function qrNumDataCodewords(ver) {
      return (
        Math.floor(qrNumRawDataModules(ver) / 8) -
        QR_M_ECC_PER_BLOCK[ver] * QR_M_NUM_BLOCKS[ver]
      );
    }

    function qrAlignmentPositions(ver) {
      if (ver === 1) return [];
      const numAlign = Math.floor(ver / 7) + 2;
      const step = Math.floor((ver * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
      const size = ver * 4 + 17;
      const result = [];
      for (let i = 0; i < numAlign - 1; i++) result.push(size - 7 - i * step);
      result.push(6);
      return result.reverse();
    }

    function qrFinderPenaltyCountPatterns(runHistory) {
      const n = runHistory[1];
      const core =
        n > 0 &&
        runHistory[2] === n &&
        runHistory[4] === n &&
        runHistory[5] === n &&
        runHistory[3] === n * 3;
      return (
        (core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0) +
        (core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0)
      );
    }

    function qrFinderPenaltyAddHistory(currentRunLength, runHistory, size) {
      if (runHistory[0] === 0) currentRunLength += size;
      runHistory.unshift(currentRunLength);
      runHistory.pop();
    }

    function qrFinderPenaltyTerminateAndCount(currentRunColor, currentRunLength, runHistory, size) {
      if (currentRunColor) {
        qrFinderPenaltyAddHistory(currentRunLength, runHistory, size);
        currentRunLength = 0;
      }
      currentRunLength += size;
      qrFinderPenaltyAddHistory(currentRunLength, runHistory, size);
      return qrFinderPenaltyCountPatterns(runHistory);
    }

    function qrPenaltyScore(modules, size) {
      let result = 0;
      for (let y = 0; y < size; y++) {
        let runColor = false;
        let runX = 0;
        const runHistory = [0, 0, 0, 0, 0, 0, 0];
        for (let x = 0; x < size; x++) {
          if (modules[y][x] === runColor) {
            runX++;
            if (runX === 5) result += 3;
            else if (runX > 5) result += 1;
          } else {
            qrFinderPenaltyAddHistory(runX, runHistory, size);
            if (!runColor) result += qrFinderPenaltyCountPatterns(runHistory) * 40;
            runColor = modules[y][x];
            runX = 1;
          }
        }
        result += qrFinderPenaltyTerminateAndCount(runColor, runX, runHistory, size) * 40;
      }
      for (let x = 0; x < size; x++) {
        let runColor = false;
        let runY = 0;
        const runHistory = [0, 0, 0, 0, 0, 0, 0];
        for (let y = 0; y < size; y++) {
          if (modules[y][x] === runColor) {
            runY++;
            if (runY === 5) result += 3;
            else if (runY > 5) result += 1;
          } else {
            qrFinderPenaltyAddHistory(runY, runHistory, size);
            if (!runColor) result += qrFinderPenaltyCountPatterns(runHistory) * 40;
            runColor = modules[y][x];
            runY = 1;
          }
        }
        result += qrFinderPenaltyTerminateAndCount(runColor, runY, runHistory, size) * 40;
      }
      for (let y = 0; y < size - 1; y++) {
        for (let x = 0; x < size - 1; x++) {
          if (
            modules[y][x] === modules[y][x + 1] &&
            modules[y][x] === modules[y + 1][x] &&
            modules[y][x] === modules[y + 1][x + 1]
          ) {
            result += 3;
          }
        }
      }
      let dark = 0;
      for (const row of modules) for (const cell of row) if (cell) dark++;
      const total = size * size;
      const k = Math.floor((Math.abs(dark * 20 - total * 10) + total - 1) / total) - 1;
      result += k * 10;
      return result;
    }

    function qrEncodeMatrix(text) {
      const bytes = new TextEncoder().encode(text);
      let version = -1;
      for (let ver = 1; ver <= 10; ver++) {
        const countBits = ver <= 9 ? 8 : 16;
        if (4 + countBits + bytes.length * 8 <= qrNumDataCodewords(ver) * 8) {
          version = ver;
          break;
        }
      }
      if (version === -1) return null;
      const size = version * 4 + 17;
      const countBits = version <= 9 ? 8 : 16;
      const dataCapacityBits = qrNumDataCodewords(version) * 8;

      const bits = [];
      const appendBits = (val, len) => {
        for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
      };
      appendBits(0x4, 4); // Byte mode
      appendBits(bytes.length, countBits);
      for (const b of bytes) appendBits(b, 8);
      appendBits(0, Math.min(4, dataCapacityBits - bits.length));
      appendBits(0, (((-bits.length % 8) + 8) % 8));
      let padByte = 0xec;
      while (bits.length < dataCapacityBits) {
        appendBits(padByte, 8);
        padByte = padByte === 0xec ? 0x11 : 0xec;
      }
      const dataCodewords = [];
      for (let i = 0; i < bits.length; i += 8) {
        let b = 0;
        for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
        dataCodewords.push(b);
      }

      const numBlocks = QR_M_NUM_BLOCKS[version];
      const blockEccLen = QR_M_ECC_PER_BLOCK[version];
      const rawCodewords = Math.floor(qrNumRawDataModules(version) / 8);
      const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
      const shortBlockLen = Math.floor(rawCodewords / numBlocks);
      const rsDiv = qrRsDivisor(blockEccLen);
      const blocks = [];
      let k = 0;
      for (let i = 0; i < numBlocks; i++) {
        const datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
        const dat = dataCodewords.slice(k, k + datLen);
        k += dat.length;
        const ecc = qrRsRemainder(dat, rsDiv);
        let block = dat.slice();
        if (i < numShortBlocks) block.push(0);
        block = block.concat(ecc);
        blocks.push(block);
      }
      const allCodewords = [];
      for (let i = 0; i < blocks[0].length; i++) {
        for (let j = 0; j < blocks.length; j++) {
          if (i === shortBlockLen - blockEccLen && j < numShortBlocks) continue;
          allCodewords.push(blocks[j][i]);
        }
      }

      const modules = Array.from({ length: size }, () => new Array(size).fill(false));
      const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));
      const setFunction = (x, y, dark) => {
        if (x < 0 || y < 0 || x >= size || y >= size) return;
        modules[y][x] = dark;
        isFunction[y][x] = true;
      };
      for (let i = 0; i < size; i++) {
        setFunction(6, i, i % 2 === 0);
        setFunction(i, 6, i % 2 === 0);
      }
      const drawFinder = (cx, cy) => {
        for (let dy = -4; dy <= 4; dy++) {
          for (let dx = -4; dx <= 4; dx++) {
            const dist = Math.max(Math.abs(dx), Math.abs(dy));
            setFunction(cx + dx, cy + dy, dist !== 2 && dist !== 4);
          }
        }
      };
      drawFinder(3, 3);
      drawFinder(size - 4, 3);
      drawFinder(3, size - 4);
      const alignPos = qrAlignmentPositions(version);
      for (let i = 0; i < alignPos.length; i++) {
        for (let j = 0; j < alignPos.length; j++) {
          if (
            (i === 0 && j === 0) ||
            (i === 0 && j === alignPos.length - 1) ||
            (i === alignPos.length - 1 && j === 0)
          ) {
            continue;
          }
          const cx = alignPos[i];
          const cy = alignPos[j];
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
            }
          }
        }
      }
      const drawFormat = (mask) => {
        const data = (0 << 3) | mask; // Ecc.MEDIUM format bits = 0
        let rem = data;
        for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
        const fmtBits = ((data << 10) | rem) ^ 0x5412;
        for (let i = 0; i <= 5; i++) setFunction(8, i, qrGetBit(fmtBits, i));
        setFunction(8, 7, qrGetBit(fmtBits, 6));
        setFunction(8, 8, qrGetBit(fmtBits, 7));
        setFunction(7, 8, qrGetBit(fmtBits, 8));
        for (let i = 9; i < 15; i++) setFunction(14 - i, 8, qrGetBit(fmtBits, i));
        for (let i = 0; i < 8; i++) setFunction(size - 1 - i, 8, qrGetBit(fmtBits, i));
        for (let i = 8; i < 15; i++) setFunction(8, size - 15 + i, qrGetBit(fmtBits, i));
        setFunction(8, size - 8, true);
      };
      const drawVersion = () => {
        if (version < 7) return;
        let rem = version;
        for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
        const verBits = (version << 12) | rem;
        for (let i = 0; i < 18; i++) {
          const bit = qrGetBit(verBits, i);
          const a = size - 11 + (i % 3);
          const b = Math.floor(i / 3);
          setFunction(a, b, bit);
          setFunction(b, a, bit);
        }
      };
      drawFormat(0);
      drawVersion();
      let bitIdx = 0;
      for (let r = size - 1; r >= 1; r -= 2) {
        let right = r;
        if (right <= 6) right -= 1;
        for (let vert = 0; vert < size; vert++) {
          for (let j = 0; j < 2; j++) {
            const x = right - j;
            const upward = ((right + 1) & 2) === 0;
            const y = upward ? size - 1 - vert : vert;
            if (!isFunction[y][x] && bitIdx < allCodewords.length * 8) {
              modules[y][x] = qrGetBit(allCodewords[bitIdx >> 3], 7 - (bitIdx & 7));
              bitIdx++;
            }
          }
        }
      }
      const applyMask = (mask) => {
        const fn = QR_MASK_PATTERNS[mask];
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            if (fn(x, y) === 0 && !isFunction[y][x]) modules[y][x] = !modules[y][x];
          }
        }
      };
      let bestMask = 0;
      let bestPenalty = Infinity;
      for (let m = 0; m < 8; m++) {
        applyMask(m);
        drawFormat(m);
        const penalty = qrPenaltyScore(modules, size);
        if (penalty < bestPenalty) {
          bestMask = m;
          bestPenalty = penalty;
        }
        applyMask(m); // Undo (XOR)
      }
      applyMask(bestMask);
      drawFormat(bestMask);
      return { version, size, mask: bestMask, modules };
    }

    function renderQrCodeView(payload) {
      const url = typeof payload?.url === 'string' ? payload.url : '';
      const urlEl = document.getElementById('qrUrlText');
      if (urlEl) urlEl.textContent = url;
      const canvas = document.getElementById('qrCanvas');
      if (!canvas) return;
      const ctx2d = canvas.getContext('2d');
      if (!ctx2d) return;
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      ctx2d.fillStyle = '#ffffff';
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);
      const qr = url ? qrEncodeMatrix(url) : null;
      if (!qr) {
        ctx2d.fillStyle = '#333';
        ctx2d.font = '13px system-ui, sans-serif';
        ctx2d.textAlign = 'center';
        ctx2d.fillText('URL too long for a QR code', canvas.width / 2, canvas.height / 2);
        return;
      }
      const quiet = 4;
      const scale = canvas.width / (qr.size + quiet * 2);
      ctx2d.fillStyle = '#000000';
      for (let y = 0; y < qr.size; y++) {
        for (let x = 0; x < qr.size; x++) {
          if (qr.modules[y][x]) {
            ctx2d.fillRect(
              Math.round((x + quiet) * scale),
              Math.round((y + quiet) * scale),
              Math.ceil(scale),
              Math.ceil(scale)
            );
          }
        }
      }
    }

    // [TABS-W2] Bookmark bubble (gap 7.4) + Reading list view (gap 8.8).
    let currentBmBubble = null;

    function renderBookmarkBubble(payload) {
      const url = typeof payload?.url === 'string' ? payload.url : '';
      const titleInput = document.getElementById('bmBubbleName');
      const folderSelect = document.getElementById('bmBubbleFolder');
      const removeBtn = document.getElementById('btnBmBubbleRemove');
      const titleEl = document.getElementById('bmBubbleTitle');
      if (!titleInput || !folderSelect) return;
      currentBmBubble = {
        url,
        title: typeof payload?.title === 'string' ? payload.title : url,
        favicon: typeof payload?.favicon === 'string' ? payload.favicon : '',
        isBookmarked: Boolean(payload?.isBookmarked),
        id: null,
        folder: ''
      };
      titleInput.value = currentBmBubble.title;
      if (titleEl) {
        titleEl.textContent = currentBmBubble.isBookmarked ? 'Edit bookmark' : 'Bookmark added';
      }
      if (removeBtn) removeBtn.classList.toggle('hidden', !currentBmBubble.isBookmarked);
      folderSelect.innerHTML = '';
      const addOpt = (value, label) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        folderSelect.appendChild(opt);
      };
      addOpt('', 'Bookmarks bar');
      addOpt('Other bookmarks', 'Other bookmarks');
      return window.gxAPI
        .getBookmarks()
        .then((list) => {
          const items = Array.isArray(list) ? list : [];
          const existing = items.find(
            (b) => b && typeof b.url === 'string' && b.url.replace(/\/$/, '') === url.replace(/\/$/, '')
          );
          if (existing) {
            currentBmBubble.id = existing.id || null;
            currentBmBubble.folder = typeof existing.folder === 'string' ? existing.folder : '';
            if (typeof existing.title === 'string' && existing.title) {
              titleInput.value = existing.title;
              currentBmBubble.title = existing.title;
            }
          }
          const folders = [];
          for (const b of items) {
            const f = typeof b?.folder === 'string' ? b.folder.trim() : '';
            if (f && f !== 'Other bookmarks' && !folders.includes(f)) folders.push(f);
          }
          for (const f of folders) addOpt(f, f);
          // Existing bookmark: show its real folder ('' = Bookmarks bar).
          // New bookmark: default to "Other bookmarks" (Chrome parity).
          const desiredFolder = currentBmBubble.id ? currentBmBubble.folder : 'Other bookmarks';
          folderSelect.value = desiredFolder;
          if (folderSelect.value !== desiredFolder) {
            folderSelect.value = currentBmBubble.id ? '' : 'Other bookmarks';
          }
          requestAnimationFrame(() => {
            titleInput.focus();
            titleInput.select();
          });
        })
        .catch(() => {
          folderSelect.value = 'Other bookmarks';
        });
    }

    async function renderReadingList() {
      const listEl = document.getElementById('rlList');
      const countEl = document.getElementById('rlCount');
      if (!listEl) return;
      let items = [];
      try {
        items = (await window.gxAPI.getReadingList()) || [];
      } catch (_) {
        items = [];
      }
      if (countEl) countEl.textContent = items.length ? `${items.length}` : '';
      listEl.innerHTML = '';
      if (!items.length) {
        listEl.innerHTML =
          '<div style="font-size:12px;color:var(--muted);padding:10px 4px;">Nothing saved yet — right-click a tab and choose “Add tab to reading list”.</div>';
        return;
      }
      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'rl-row';
        const favUrl = getBookmarkFaviconUrl(item);
        row.innerHTML = `
          <button type="button" class="rl-open" title="${escapeHtml(item.url || '')}">
            <span class="rl-icon">${favUrl ? `<img src="${escapeHtml(favUrl)}" alt="" />` : '📖'}</span>
            <span class="rl-text">
              <span class="rl-title">${escapeHtml(item.title || item.url || 'Untitled')}</span>
              <span class="rl-url">${escapeHtml(item.url || '')}</span>
            </span>
          </button>
          <button type="button" class="rl-mark" title="${item.read ? 'Mark as unread' : 'Mark as read'}">${item.read ? '✓ Read' : 'Mark read'}</button>
          <button type="button" class="rl-remove" title="Remove from reading list">✕</button>
        `;
        row.querySelector('.rl-open').addEventListener('click', () => {
          window.gxAPI.closePopover();
          window.gxAPI.createTab({ url: item.url, active: true });
        });
        row.querySelector('.rl-mark').addEventListener('click', async () => {
          await window.gxAPI.markReadingListRead(item.id, !item.read);
          renderReadingList();
        });
        row.querySelector('.rl-remove').addEventListener('click', async () => {
          await window.gxAPI.removeReadingList(item.id);
          renderReadingList();
        });
        listEl.appendChild(row);
      }
    }

    // [TABS-W2] Gap 8.1 — tab search popover: rows are the recency-sorted
    // tabs from the payload; the popover's own input filters them, Enter /
    // click switches, per-row ✕ closes the tab and drops the row.
    function getTsFilteredRows() {
      const q = (document.getElementById('tsInput')?.value || '').trim().toLowerCase();
      if (!q) return tsTabs;
      return tsTabs.filter(
        (t) =>
          (t.title || '').toLowerCase().includes(q) || (t.url || '').toLowerCase().includes(q)
      );
    }

    function renderTsList() {
      const listEl = document.getElementById('tsList');
      if (!listEl) return;
      const rows = getTsFilteredRows();
      listEl.innerHTML = '';
      if (!rows.length) {
        listEl.innerHTML =
          '<div style="font-size:12px;color:var(--muted);padding:10px 4px;">No matching tabs</div>';
        return;
      }
      tsSelected = Math.max(0, Math.min(tsSelected, rows.length - 1));
      for (let i = 0; i < rows.length; i++) {
        const t = rows[i];
        const row = document.createElement('div');
        row.className = 'rl-row' + (i === tsSelected ? ' selected' : '');
        // Market audit bug #33: a dead favicon img was hidden by an inline
        // onerror with no fallback (empty icon slot), and the raw
        // "nextgx://newtab" URL in title spilled a native tooltip below the
        // popover. Build with DOM APIs: failed icons fall back to the globe,
        // and internal URLs get no raw-scheme tooltip.
        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'rl-open';
        // Fix2-shell (item 8): the row already shows title + URL clamped
        // with ellipsis, and a native tooltip for a raw internal URL
        // ("nextgx://newtab") spills below the popover bounds (audit #33),
        // so internal URLs get no tooltip. External URLs keep the standard
        // hover tooltip — the visible text is clamped, so it cannot spill.
        const isInternal = !t.url || /^nextgx:\/\//i.test(t.url);
        if (!isInternal) openBtn.title = t.url;
        // The favicon img now lives inside the .rl-icon wrapper, so the
        // 16 px slot sizing actually applies; a dead icon is replaced by
        // the globe inside the same slot instead of leaving an empty or
        // broken slot.
        const iconWrap = document.createElement('span');
        iconWrap.className = 'rl-icon';
        const globeEl = document.createElement('span');
        globeEl.textContent = '🌐';
        const safeTsFav = sanitizeUiFaviconUrl(t.favicon);
        if (safeTsFav) {
          const img = document.createElement('img');
          img.alt = '';
          img.addEventListener('error', () => {
            img.replaceWith(globeEl);
          });
          img.src = safeTsFav;
          iconWrap.appendChild(img);
        } else {
          iconWrap.appendChild(globeEl);
        }
        const textEl = document.createElement('span');
        textEl.className = 'rl-text';
        const titleEl = document.createElement('span');
        titleEl.className = 'rl-title';
        titleEl.textContent = t.title || 'Start Page';
        const urlEl = document.createElement('span');
        urlEl.className = 'rl-url';
        urlEl.textContent = (t.url || '') + (t.groupName ? ` — ${t.groupName}` : '');
        textEl.appendChild(titleEl);
        textEl.appendChild(urlEl);
        openBtn.appendChild(iconWrap);
        openBtn.appendChild(textEl);
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'rl-remove';
        removeBtn.title = 'Close tab';
        removeBtn.textContent = '✕';
        row.appendChild(openBtn);
        row.appendChild(removeBtn);
        row.querySelector('.rl-open').addEventListener('click', () => {
          window.gxAPI.closePopover();
          window.gxAPI.switchTab(t.id);
        });
        row.querySelector('.rl-open').addEventListener('mouseenter', () => {
          tsSelected = i;
          listEl.querySelectorAll('.rl-row').forEach((r, j) =>
            r.classList.toggle('selected', j === i)
          );
        });
        row.querySelector('.rl-remove').addEventListener('click', (e) => {
          e.stopPropagation();
          window.gxAPI.closeTab(t.id);
          tsTabs = tsTabs.filter((x) => x.id !== t.id);
          renderTsList();
        });
        listEl.appendChild(row);
      }
    }

    function renderTabSearch(payload) {
      const input = document.getElementById('tsInput');
      if (!input) return;
      tsTabs = Array.isArray(payload?.tabs) ? payload.tabs.slice() : [];
      tsSelected = 0;
      input.value = '';
      if (!input.dataset.wired) {
        input.dataset.wired = '1';
        input.addEventListener('input', () => {
          tsSelected = 0;
          renderTsList();
        });
        input.addEventListener('keydown', (e) => {
          const rows = getTsFilteredRows();
          if (e.key === 'Escape') {
            e.preventDefault();
            window.gxAPI.closePopover();
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!rows.length) return;
            tsSelected =
              e.key === 'ArrowDown'
                ? (tsSelected + 1) % rows.length
                : (tsSelected - 1 + rows.length) % rows.length;
            renderTsList();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const row = rows[tsSelected] || rows[0];
            if (row) {
              window.gxAPI.closePopover();
              window.gxAPI.switchTab(row.id);
            }
          }
        });
      }
      renderTsList();
      requestAnimationFrame(() => input.focus());
    }

    // [TABS-W2] Gap 3.7 — omnibox suggestions popover: rows are the
    // history matches from the payload. mousedown (not click): the chrome
    // omnibox blurs when the popover is pressed and its blur handler closes
    // this popover — mousedown fires first, so the navigation still lands.
    function renderOmniboxSuggest(payload) {
      const listEl = document.getElementById('osList');
      if (!listEl) return;
      const suggestions = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
      const selectedIdx = typeof payload?.selectedIndex === 'number' ? payload.selectedIndex : -1;
      listEl.innerHTML = '';

      const SEARCH_SVG =
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.5" y1="15.5" x2="20.5" y2="20.5"/></svg>';
      const GLOBE_SVG =
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8"/></svg>';

      let lastSection = '';
      for (let i = 0; i < suggestions.length; i++) {
        const m = suggestions[i];
        const sec = m.section || 'history';
        if (sec !== lastSection) {
          lastSection = sec;
          const head = document.createElement('div');
          head.className = 'os-header';
          head.textContent = sec === 'suggestions' ? 'Suggestions' : 'History';
          listEl.appendChild(head);
        }

        const row = document.createElement('div');
        row.className = i === selectedIdx ? 'os-row selected' : 'os-row';

        const iconWrap = document.createElement('span');
        iconWrap.className = 'os-icon-wrap';
        const safeOsFav = sanitizeUiFaviconUrl(m.favicon);
        if (m.type === 'search') {
          iconWrap.innerHTML = SEARCH_SVG;
        } else if (safeOsFav) {
          const img = document.createElement('img');
          img.className = 'os-favicon';
          img.alt = '';
          const iconEl = document.createElement('span');
          iconEl.className = 'os-icon-wrap';
          iconEl.innerHTML = GLOBE_SVG;
          img.addEventListener('error', () => {
            img.replaceWith(iconEl);
          });
          img.src = safeOsFav;
          iconWrap.appendChild(img);
        } else {
          iconWrap.innerHTML = GLOBE_SVG;
        }

        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'os-open';
        openBtn.title = m.url || m.title || '';

        const textEl = document.createElement('span');
        textEl.className = 'os-inline-text';
        const titleEl = document.createElement('span');
        titleEl.className = 'os-title';
        titleEl.textContent = m.title || m.url || '';
        const subEl = document.createElement('span');
        subEl.className = 'os-sub';
        subEl.textContent = m.type === 'search' ? (m.subtitle || 'Search') : (m.displayUrl || m.url || '');
        textEl.appendChild(titleEl);
        textEl.appendChild(subEl);

        openBtn.appendChild(iconWrap);
        openBtn.appendChild(textEl);
        row.appendChild(openBtn);

        if (m.switchTabId) {
          const swBtn = document.createElement('button');
          swBtn.type = 'button';
          swBtn.className = 'os-switch-btn';
          swBtn.textContent = 'Switch to tab';
          swBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            window.gxAPI.closePopover();
            window.gxAPI.switchTab(m.switchTabId);
          });
          row.appendChild(swBtn);
        }

        row.addEventListener('mouseenter', () => {
          listEl.querySelectorAll('.os-row.selected').forEach((r) => r.classList.remove('selected'));
          row.classList.add('selected');
        });
        openBtn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          window.gxAPI.closePopover();
          window.gxAPI.navigate(m.url);
        });
        listEl.appendChild(row);
      }
    }

    function renderShieldPopover(siteInfo, stats) {
      if (siteInfo) lastShieldSiteInfo = siteInfo;
      const info = siteInfo || lastShieldSiteInfo || {};
      const hasSite = Boolean(currentShieldOrigin);
      const globalAdsOn =
        typeof stats?.enabled === 'boolean' ? stats.enabled : Boolean(info.globalEnabled);
      const trackersOn =
        globalAdsOn &&
        (typeof stats?.trackerBlockEnabled === 'boolean'
          ? stats.trackerBlockEnabled
          : Boolean(info.trackerBlockEnabled));
      const allowlisted = Boolean(hasSite && info.allowlisted);

      const siteCount = hasSite
        ? Number(stats?.perSite?.[currentShieldOrigin] ?? info.blockedCount ?? 0)
        : 0;
      const sessionCount = Number(stats?.sessionBlocked ?? 0);

      document.getElementById('shieldOriginText').textContent =
        currentShieldOrigin || currentShieldUrl || 'Internal Page';
      document.getElementById('shieldSiteCount').textContent = String(siteCount);
      document.getElementById('shieldSessionCount').textContent = String(sessionCount);

      const statusEl = document.getElementById('shieldStatusText');
      const iconEl = document.getElementById('shieldPopIcon');
      const siteChk = document.getElementById('chkShieldSiteEnabled');
      const siteSub = document.getElementById('shieldSiteSub');
      const globalChk = document.getElementById('chkShieldGlobalEnabled');
      const globalSub = document.getElementById('shieldGlobalSub');
      const reloadBtn = document.getElementById('btnShieldReload');

      if (!hasSite) {
        statusEl.textContent = 'nextGx Privacy Shield';
        iconEl.style.color = globalAdsOn ? 'var(--accent-bright)' : 'var(--muted)';
        siteChk.disabled = true;
        siteChk.checked = false;
        siteSub.textContent = 'Not applicable to internal pages';
        // Market audit bug #23: the button was already disabled here, but
        // with no explanation it read as a dead button. Say why.
        reloadBtn.disabled = true;
        reloadBtn.title = 'Reload is not available on internal pages';
      } else if (!globalAdsOn) {
        statusEl.textContent = 'Shield paused globally';
        iconEl.style.color = 'var(--warning)';
        siteChk.disabled = true;
        siteChk.checked = false;
        siteSub.textContent = 'Turn on global blocking below first';
        reloadBtn.disabled = false;
      } else if (allowlisted) {
        statusEl.textContent = 'Paused on this site';
        iconEl.style.color = 'var(--warning)';
        siteChk.disabled = false;
        siteChk.checked = false;
        siteSub.textContent = 'Ads & trackers allowed on this origin';
        reloadBtn.disabled = false;
      } else {
        statusEl.textContent = 'Shield active on this site';
        iconEl.style.color = 'var(--success)';
        siteChk.disabled = false;
        siteChk.checked = true;
        siteSub.textContent = 'Applies immediately to this origin';
        reloadBtn.disabled = false;
      }

      if (!reloadBtn.disabled) reloadBtn.title = 'Reload this site';
      globalChk.checked = globalAdsOn;
      globalSub.textContent = `Trackers: ${trackersOn ? 'On' : 'Off'}`;
    }

    // --- [FIXUP-1] Site-info bubble (Chrome parity gaps 3.3/3.4) + zoom
    // bubble (3.5), moved from the renderer. Same contents/behaviour as
    // worker B's panels: elided-URL display is the renderer's job (the
    // omnibox), here we show the origin; connection state, cookie count +
    // Clear, cert row with the honest "not available" note, 6 per-site
    // permission rows wired to the store, "Site settings" → nextgx://privacy.
    const SITE_INFO_PERMS = [
      { key: 'camera', label: 'Camera' },
      { key: 'microphone', label: 'Microphone' },
      { key: 'geolocation', label: 'Location' },
      { key: 'notifications', label: 'Notifications' },
      { key: 'clipboard-read', label: 'Clipboard' },
      { key: 'screen-share', label: 'Screen sharing' }
    ];
    let currentSiteInfoOrigin = '';
    let currentSiteInfoUrl = '';

    function renderSiteInfoPermRows(origin, perms) {
      const container = document.getElementById('siteInfoPermRows');
      if (!container) return;
      container.innerHTML = '';
      for (const { key, label } of SITE_INFO_PERMS) {
        const row = document.createElement('div');
        row.className = 'site-info-perm-row';
        const name = document.createElement('span');
        name.textContent = label;
        const select = document.createElement('select');
        select.className = 'perm-select';
        select.setAttribute('aria-label', `${label} permission for this site`);
        for (const [val, text] of [['ask', 'Ask'], ['allow', 'Allow'], ['block', 'Block']]) {
          const opt = document.createElement('option');
          opt.value = val;
          opt.textContent = text;
          if ((perms[key] || 'ask') === val) opt.selected = true;
          select.appendChild(opt);
        }
        select.addEventListener('change', async () => {
          const updated = await window.gxAPI.setSitePermission(origin, key, select.value);
          if (updated) renderSiteInfoPermRows(origin, updated);
        });
        row.appendChild(name);
        row.appendChild(select);
        container.appendChild(row);
      }
    }

    async function refreshSiteInfoCookieCount(origin) {
      const countEl = document.getElementById('siteInfoCookieCount');
      if (!countEl) return;
      if (!origin || !/^https?:\/\//i.test(origin)) {
        countEl.textContent = '';
        return;
      }
      try {
        const list = await window.gxAPI.getCookies({ origin });
        const n = Array.isArray(list) ? list.length : 0;
        countEl.textContent = `${n} cookie${n === 1 ? '' : 's'}`;
      } catch (_) {
        countEl.textContent = '';
      }
    }

    async function renderSiteInfoPopover(payload) {
      const url = payload?.url || '';
      const origin = payload?.origin || '';
      const secState = payload?.securityState || (url.startsWith('https://') ? 'secure' : url.startsWith('http://') ? 'insecure' : 'neutral');
      currentSiteInfoOrigin = origin;
      currentSiteInfoUrl = url;
      const isHttps = secState === 'secure';
      const isInsecure = secState === 'insecure';
      const statusEl = document.getElementById('siteInfoStatus');
      const iconEl = document.getElementById('siteInfoIcon');
      const originEl = document.getElementById('siteInfoOrigin');
      const certEl = document.getElementById('siteInfoCert');
      if (statusEl) {
        statusEl.textContent = isHttps
          ? 'Connection is secure'
          : isInsecure
            ? (payload?.hasCertBypass ? 'Certificate warning bypassed (not secure)' : 'Your connection to this site is not secure')
            : 'Internal browser page';
      }
      if (iconEl) {
        iconEl.className = `site-info-icon-badge ${isHttps ? 'secure' : isInsecure ? 'insecure' : 'neutral'}`;
        iconEl.innerHTML = isHttps
          ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
          : isInsecure
            ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
            : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
      }
      if (originEl) originEl.textContent = origin || url;
      if (certEl) certEl.textContent = '';
      renderSiteInfoPermRows(origin, {});
      // Fill in live data (permissions, cookies, certificate) without
      // blocking the open; re-fit once it lands.
      try {
        const perms = await window.gxAPI.getSitePermissions(origin);
        if (perms && currentSiteInfoOrigin === origin && activePopoverKind === 'site-info') {
          renderSiteInfoPermRows(origin, perms);
          fitPopoverToView('site-info', 'view-site-info');
        }
      } catch (_) { }
      refreshSiteInfoCookieCount(origin);
      if (isHttps && certEl) {
        try {
          const cert = await window.gxAPI.getSiteCertificate();
          if (currentSiteInfoOrigin !== origin || activePopoverKind !== 'site-info') return;
          if (cert && cert.available) {
            const parts = [];
            if (cert.subjectName) parts.push(`Issued to ${cert.subjectName}`);
            if (cert.issuerName) parts.push(`by ${cert.issuerName}`);
            if (cert.validExpiry) {
              parts.push(`valid until ${new Date(cert.validExpiry * 1000).toLocaleDateString()}`);
            }
            certEl.textContent = parts.length ? parts.join(' · ') : 'Certificate details unavailable.';
          } else {
            // Honest fallback: Electron does not expose certificate details here.
            certEl.textContent = 'Certificate details are not available in this build.';
          }
          fitPopoverToView('site-info', 'view-site-info');
        } catch (_) {
          certEl.textContent = 'Certificate details are not available in this build.';
        }
      }
    }

    // --- Chrome parity (worker A): permission prompt preview + devices ---
    let permPreviewStream = null;
    let permPreviewSeq = 0;

    function stopPermPreview() {
      permPreviewSeq += 1;
      if (permPreviewStream) {
        try {
          permPreviewStream.getTracks().forEach((t) => t.stop());
        } catch (_) { }
        permPreviewStream = null;
      }
      const video = document.getElementById('permPreviewVideo');
      if (video) video.srcObject = null;
    }

    function populatePermSelect(selectId, devices, kind, fallbackLabel) {
      const sel = document.getElementById(selectId);
      if (!sel) return;
      sel.innerHTML = '';
      const list = Array.isArray(devices) ? devices : [];
      if (list.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = `No ${kind === 'camera' ? 'camera' : 'microphone'} found`;
        sel.appendChild(opt);
        sel.disabled = true;
        return;
      }
      sel.disabled = false;
      for (const d of list) {
        const opt = document.createElement('option');
        opt.value = d.deviceId || '';
        opt.textContent = d.label || `${fallbackLabel} ${sel.options.length + 1}`;
        sel.appendChild(opt);
      }
      // Default to the first device; the stored choice (if any) is applied by
      // the tab preload, this picker only records a fresh user choice.
      // NOTE: deviceIds are salted per origin/profile, so the LABEL is what
      // the tab preload matches on — record both.
      const first = list[0];
      if (first) {
        if (first.deviceId) currentPermPromptDevices[kind] = first.deviceId;
        if (first.label) currentPermPromptDevices[`${kind}Label`] = first.label;
      }
    }

    async function startPermDevices(keys) {
      const seq = ++permPreviewSeq;
      const wantVideo = keys.includes('camera');
      const wantAudio = keys.includes('microphone');
      if (!wantVideo && !wantAudio) return;
      try {
        // A live grant unlocks device labels for enumerateDevices() — without
        // it, labels AND deviceIds come back empty. The popover is a trusted
        // internal UI page, so main grants it media (see permissions.js).
        const stream = await navigator.mediaDevices.getUserMedia({
          video: wantVideo,
          audio: wantAudio
        });
        if (seq !== permPreviewSeq) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        permPreviewStream = stream;
        if (wantVideo) {
          const video = document.getElementById('permPreviewVideo');
          if (video) video.srcObject = stream;
        }
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (seq !== permPreviewSeq) return;
        populatePermSelect(
          'permCameraSelect',
          devices.filter((d) => d.kind === 'videoinput'),
          'camera',
          'Camera'
        );
        populatePermSelect(
          'permMicSelect',
          devices.filter((d) => d.kind === 'audioinput'),
          'microphone',
          'Microphone'
        );
        // Mic-only prompts need no live preview: release the mic right away;
        // the labels stay available for this origin once granted.
        if (!wantVideo) {
          try {
            stream.getAudioTracks().forEach((t) => t.stop());
          } catch (_) { }
          if (permPreviewStream === stream) permPreviewStream = null;
        }
        fitPopoverToView('permission-prompt', 'view-permission-prompt');
      } catch (_) {
        // Preview unavailable (no camera, denied, etc.): the prompt stays
        // usable without a preview or device choice.
        if (seq === permPreviewSeq) stopPermPreview();
      }
    }

    async function switchPermPreviewCamera(deviceId) {
      if (!deviceId) return;
      const seq = ++permPreviewSeq;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceId } }
        });
        if (seq !== permPreviewSeq) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (permPreviewStream) {
          try {
            permPreviewStream.getTracks().forEach((t) => t.stop());
          } catch (_) { }
        }
        permPreviewStream = stream;
        const video = document.getElementById('permPreviewVideo');
        if (video) video.srcObject = stream;
      } catch (_) {
        if (seq === permPreviewSeq) permPreviewSeq += 1;
      }
    }

    // --- Chrome parity (worker A): screen-share picker ---
    let currentShareRequestId = '';
    let currentShareData = null;
    let currentShareTab = 'tab';
    let currentShareSelection = null;
    let sharePickerResponded = false;

    function respondSharePicker(decision, source) {
      if (!currentShareRequestId || sharePickerResponded) return;
      sharePickerResponded = true;
      const reqId = currentShareRequestId;
      const tabAudio = document.getElementById('chkShareTabAudio')?.checked !== false;
      window.gxAPI.respondPermissionPrompt?.({
        displayMediaRequestId: reqId,
        decision,
        source: source || null,
        tabAudio
      });
    }

    function updateShareFooter() {
      const confirmBtn = document.getElementById('btnShareConfirm');
      if (!confirmBtn) return;
      confirmBtn.disabled = !currentShareSelection;
      if (currentShareSelection && currentShareTab === 'tab') {
        const audioOn = document.getElementById('chkShareTabAudio')?.checked !== false;
        confirmBtn.textContent = audioOn ? 'Share with Audio' : 'Share';
      } else {
        confirmBtn.textContent = 'Share';
      }
    }

    function renderShareGrid() {
      const grid = document.getElementById('shareGrid');
      if (!grid) return;
      grid.innerHTML = '';
      const data = currentShareData || {};
      const items =
        currentShareTab === 'tab'
          ? (data.tabs || []).map((t) => ({
            kind: 'tab',
            id: t.tabId,
            tabId: t.tabId,
            name: t.title || 'Tab',
            sub: t.url || '',
            thumbnail: t.thumbnail || ''
          }))
          : currentShareTab === 'window'
            ? (data.windows || []).map((w) => ({
              kind: 'window',
              id: w.id,
              name: w.name || 'Window',
              sub: '',
              thumbnail: w.thumbnail || ''
            }))
            : (data.screens || []).map((s) => ({
              kind: 'screen',
              id: s.id,
              name: s.name || 'Screen',
              sub: '',
              thumbnail: s.thumbnail || ''
            }));
      if (items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'share-empty';
        empty.textContent =
          currentShareTab === 'tab'
            ? 'No tabs available to share'
            : currentShareTab === 'window'
              ? 'No windows available to share'
              : 'No screens available to share';
        grid.appendChild(empty);
        return;
      }
      for (const item of items) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'share-card';
        const isSelected =
          currentShareSelection &&
          currentShareSelection.kind === item.kind &&
          String(currentShareSelection.id) === String(item.id);
        if (isSelected) card.classList.add('selected');
        const thumb = document.createElement('div');
        thumb.className = 'share-thumb';
        if (item.thumbnail) {
          const img = document.createElement('img');
          img.alt = '';
          img.src = item.thumbnail;
          img.addEventListener('error', () => {
            thumb.innerHTML = '';
            const fallback = document.createElement('span');
            fallback.className = 'share-thumb-empty';
            fallback.textContent = item.kind === 'tab' ? '▣' : item.kind === 'window' ? '▢' : '▭';
            thumb.appendChild(fallback);
          });
          thumb.appendChild(img);
        } else {
          const fallback = document.createElement('span');
          fallback.className = 'share-thumb-empty';
          fallback.textContent = item.kind === 'tab' ? '▣' : item.kind === 'window' ? '▢' : '▭';
          thumb.appendChild(fallback);
        }
        const name = document.createElement('div');
        name.className = 'share-card-name';
        name.textContent = item.name;
        card.appendChild(thumb);
        card.appendChild(name);
        if (item.sub) {
          const sub = document.createElement('div');
          sub.className = 'share-card-sub';
          sub.textContent = item.sub;
          card.appendChild(sub);
        }
        card.addEventListener('click', () => {
          currentShareSelection = { kind: item.kind, id: item.id, tabId: item.tabId };
          renderShareGrid();
          updateShareFooter();
        });
        grid.appendChild(card);
      }
    }

    function renderSharePicker(payload) {
      currentShareRequestId = payload?.requestId || '';
      currentShareData = {
        screens: Array.isArray(payload?.screens) ? payload.screens : [],
        windows: Array.isArray(payload?.windows) ? payload.windows : [],
        tabs: Array.isArray(payload?.tabs) ? payload.tabs : []
      };
      currentShareSelection = null;
      sharePickerResponded = false;
      // Default to the Tab tab (like Chrome); fall back to Window/Screen
      // when there are no tabs to share.
      currentShareTab =
        currentShareData.tabs.length > 0
          ? 'tab'
          : currentShareData.windows.length > 0
            ? 'window'
            : 'screen';
      const titleEl = document.getElementById('shareTitle');
      if (titleEl) {
        titleEl.textContent = `Choose what to share with ${payload?.host || payload?.origin || 'this site'}`;
      }
      document.querySelectorAll('[data-share-tab]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.shareTab === currentShareTab);
      });
      document
        .getElementById('shareTabAudioRow')
        ?.classList.toggle('hidden', currentShareTab !== 'tab');
      document
        .getElementById('shareAudioNote')
        ?.classList.toggle('hidden', currentShareTab === 'tab');
      renderShareGrid();
      updateShareFooter();
    }

    window.gxAPI.onPopoverData(async (data) => {
      if (!data || data.closed) {
        // [TABS-W2] Gap 1.5 — prompt closed: clear the omnibox chip.
        if (lastPromptNotifiedOpen) {
          lastPromptNotifiedOpen = false;
          window.gxAPI.notifyPermissionPromptState?.({ open: false });
        }
        resetPopoverOnClose();
        return;
      }
      const openSeq = ++popoverOpenSeq;
      const { kind, payload } = data;
      // [TABS-W2] Gap 1.5 — a different popover replaced the prompt: the
      // chip must go too (the closed:true path above does not fire here).
      if (lastPromptNotifiedOpen && kind !== 'permission-prompt') {
        lastPromptNotifiedOpen = false;
        window.gxAPI.notifyPermissionPromptState?.({ open: false });
      }

      if (kind === 'menu') {
        showOnly('view-menu');
        document.getElementById('zoomPct').textContent = `${payload?.zoomPercent || 100}%`;
        fitPopoverToView('menu', 'view-menu', { reset: true });
      } else if (kind === 'screenshot') {
        showOnly('view-screenshot');
        fitPopoverToView('screenshot', 'view-screenshot', { reset: true });
      } else if (kind === 'downloads') {
        showOnly('view-downloads');
        fitPopoverToView('downloads', 'view-downloads', { reset: true });
        const list = await window.gxAPI.getDownloads();
        if (openSeq !== popoverOpenSeq || activePopoverKind !== 'downloads') return;
        renderMiniDownloads(list);
        fitPopoverToView('downloads', 'view-downloads');
      } else if (kind === 'shield') {
        showOnly('view-shield');
        currentShieldOrigin = payload?.origin || '';
        currentShieldUrl = payload?.url || '';
        fitPopoverToView('shield', 'view-shield', { reset: true });
        const [siteInfo, stats] = await Promise.all([
          window.gxAPI.getAdblockSite(currentShieldOrigin),
          window.gxAPI.getAdblockStats()
        ]);
        if (openSeq !== popoverOpenSeq || activePopoverKind !== 'shield') return;
        renderShieldPopover(siteInfo, stats);
        fitPopoverToView('shield', 'view-shield');
      } else if (kind === 'site-info') {
        // [FIXUP-1] Chrome parity gaps 3.3/3.4. The renderer opens this from
        // the lock icon; the popover view sits above the tab WebContentsView
        // so the whole bubble is visible.
        showOnly('view-site-info');
        fitPopoverToView('site-info', 'view-site-info', { reset: true });
        await renderSiteInfoPopover(payload || {});
        if (openSeq !== popoverOpenSeq || activePopoverKind !== 'site-info') return;
        fitPopoverToView('site-info', 'view-site-info');
      } else if (kind === 'zoom-bubble') {
        // [FIXUP-1] Chrome parity gap 3.5. The renderer opens this from the
        // omnibox magnifier with the current zoom percent in the payload.
        showOnly('view-zoom-bubble');
        const zoomValEl = document.getElementById('zoomBubbleValue');
        if (zoomValEl) zoomValEl.textContent = `${payload?.zoomPercent || 100}%`;
        fitPopoverToView('zoom-bubble', 'view-zoom-bubble', { reset: true });
      } else if (kind === 'tab-context') {
        const ctxType = payload?.contextType || 'tab';
        if (ctxType === 'group') {
          showOnly('view-group-context');
          currentGroupCtx = payload || null;
          renderGroupContextMenu(currentGroupCtx);
          fitPopoverToView('tab-context', 'view-group-context', { reset: true });
        } else if (ctxType === 'workspace' || ctxType === 'workspace-create') {
          showOnly('view-workspace-context');
          currentWorkspaceMode = ctxType;
          currentWorkspaceCtx = payload || null;
          renderWorkspaceContextMenu(ctxType, currentWorkspaceCtx);
          fitPopoverToView('tab-context', 'view-workspace-context', { reset: true });
          if (ctxType === 'workspace-create') {
            const wsInput = document.getElementById('wsCtxNameInput');
            if (wsInput) {
              requestAnimationFrame(() => wsInput.focus());
            }
          }
        } else {
          showOnly('view-tab-context');
          currentTabCtx = payload || null;
          const pinLabel = document.getElementById('tabCtxPinLabel');
          const splitBtn = document.getElementById('btnTabCtxSplit');
          const splitLabel = document.getElementById('tabCtxSplitLabel');
          const splitSwapBtn = document.getElementById('btnTabCtxSplitSwap');
          const hibernateBtn = document.getElementById('btnTabCtxHibernate');
          const popOutBtn = document.getElementById('btnTabCtxPopOutVideo');
          const popOutLabel = document.getElementById('tabCtxPopOutLabel');
          const closeOthersBtn = document.getElementById('btnTabCtxCloseOthers');
          if (pinLabel) {
            pinLabel.textContent = currentTabCtx?.pinned ? 'Unpin Tab' : 'Pin Tab';
          }
          if (splitSwapBtn) {
            const showSwap = Boolean(currentTabCtx?.isSplitPane && currentTabCtx?.splitVisible);
            splitSwapBtn.classList.toggle('hidden', !showSwap);
          }
          if (splitBtn && splitLabel) {
            const isVisibleSplitPane = Boolean(currentTabCtx?.isSplitPane && currentTabCtx?.splitVisible);
            if (isVisibleSplitPane) {
              splitLabel.textContent = 'Separate Split View (Un-split)';
              splitBtn.title = 'Break split view and keep both tabs open separately';
            } else if (currentTabCtx?.splitVisible) {
              splitLabel.textContent = 'Split with this tab';
              splitBtn.title =
                currentTabCtx.splitFocusedPane === 'left'
                  ? 'Replace the right split pane with this tab'
                  : 'Replace the left split pane with this tab';
            } else if (currentTabCtx?.isActive) {
              splitLabel.textContent = 'Open Split View';
              splitBtn.title = 'Open Split View picker alongside this tab';
            } else {
              splitLabel.textContent = 'Merge into Split View';
              splitBtn.title = 'Open active tab and this tab side by side';
            }
          }
          if (hibernateBtn) {
            const isVisibleSplitPane = Boolean(currentTabCtx?.isSplitPane && currentTabCtx?.splitVisible);
            const cannotHibernate = Boolean(currentTabCtx?.isActive || currentTabCtx?.sleeping || isVisibleSplitPane);
            hibernateBtn.disabled = cannotHibernate;
            hibernateBtn.title = currentTabCtx?.sleeping
              ? 'Tab is already hibernated'
              : currentTabCtx?.isActive
                ? 'Active tab cannot be hibernated'
                : isVisibleSplitPane
                  ? 'Split view pane cannot be hibernated'
                  : 'Suspend tab to save memory';
          }
          if (popOutBtn) {
            const canPopOut = Boolean((currentTabCtx?.hasPlayingVideo || currentTabCtx?.pipActive) && !currentTabCtx?.sleeping);
            popOutBtn.disabled = !canPopOut;
            if (popOutLabel) {
              popOutLabel.textContent = currentTabCtx?.pipActive && canPopOut ? 'Exit Pop-out Video' : 'Pop out video';
            }
            popOutBtn.title = !canPopOut
              ? 'Play a video in this tab to pop out'
              : currentTabCtx?.pipActive
                ? 'Return popped-out video to this tab'
                : currentTabCtx?.videoTitle
                  ? `Pop out "${currentTabCtx.videoTitle}" (Picture-in-Picture)`
                  : 'Pop out video (Picture-in-Picture)';
          }
          if (closeOthersBtn) {
            closeOthersBtn.disabled =
              typeof currentTabCtx?.canCloseOthers === 'boolean'
                ? !currentTabCtx.canCloseOthers
                : Number(currentTabCtx?.totalTabs || 1) <= 1;
          }
          // [TABS-W2] Gap 8.2 — dynamic labels/disabled states for the new
          // tab-menu entries (mute label, move-to-window, close-to-right).
          const muteLabel = document.getElementById('tabCtxMuteLabel');
          if (muteLabel) {
            muteLabel.textContent = currentTabCtx?.muted ? 'Unmute site' : 'Mute site';
          }
          const moveWindowBtn = document.getElementById('btnTabCtxMoveWindow');
          if (moveWindowBtn) {
            const singleTab = Number(currentTabCtx?.totalTabs || 1) <= 1;
            moveWindowBtn.disabled = singleTab;
            moveWindowBtn.title = singleTab
              ? 'Cannot move the only tab to a new window'
              : 'Move this tab to a new window';
          }
          const closeRightBtn = document.getElementById('btnTabCtxCloseRight');
          if (closeRightBtn) {
            closeRightBtn.disabled = Number(currentTabCtx?.tabsToRight || 0) <= 0;
          }
          const readingListBtn = document.getElementById('btnTabCtxReadingList');
          if (readingListBtn) {
            const url = String(currentTabCtx?.url || '');
            readingListBtn.disabled = !/^https?:\/\//i.test(url);
            readingListBtn.title = readingListBtn.disabled
              ? 'Only web pages can be added to the reading list'
              : 'Save this page to your reading list';
          }
          renderTabContextGroupAndWorkspaceSections(currentTabCtx);
          fitPopoverToView('tab-context', 'view-tab-context', { reset: true });
        }
      } else if (kind === 'rail-context') {
        // Market audit bug #30: sidebar rail context menu.
        showOnly('view-rail-context');
        currentRailCtx = payload || null;
        const openLabel = document.getElementById('railCtxOpenLabel');
        if (openLabel) {
          openLabel.textContent = currentRailCtx?.title
            ? `Open ${currentRailCtx.title}`
            : 'Open panel';
        }
        // Fix2-shell (item 9): Pin/Unpin reflects the panel's current
        // pinned state; hidden when the item cannot be pinned.
        const pinBtn = document.getElementById('btnRailCtxPin');
        const pinLabel = document.getElementById('railCtxPinLabel');
        if (pinBtn) pinBtn.classList.toggle('hidden', !currentRailCtx?.canPin);
        if (pinLabel) {
          pinLabel.textContent = currentRailCtx?.pinned ? 'Unpin panel' : 'Pin panel';
        }
        fitPopoverToView('rail-context', 'view-rail-context', { reset: true });
      } else if (kind === 'address-context') {
        // M-1: address-bar context menu view. Payload (when a sender exists)
        // mirrors the native menu in src/main/context-menu.js:
        // editFlags {canUndo,canCut,canCopy,canPaste,canSelectAll},
        // clipboardText, hasClipboardText, pasteAndGoLabel.
        showOnly('view-address-context');
        currentAddrCtx = payload || null;
        const addrFlags = payload?.editFlags || {};
        const setAddrDisabled = (id, enabled) => {
          const el = document.getElementById(id);
          if (el) el.disabled = !enabled;
        };
        setAddrDisabled('btnAddrCtxUndo', addrFlags.canUndo);
        setAddrDisabled('btnAddrCtxCut', addrFlags.canCut);
        setAddrDisabled('btnAddrCtxCopy', addrFlags.canCopy);
        setAddrDisabled('btnAddrCtxPaste', addrFlags.canPaste || payload?.hasClipboardText);
        setAddrDisabled('btnAddrCtxPasteGo', Boolean(payload?.clipboardText));
        setAddrDisabled('btnAddrCtxSelectAll', addrFlags.canSelectAll);
        const pasteGoLabel = document.getElementById('addrCtxPasteGoLabel');
        if (pasteGoLabel) {
          pasteGoLabel.textContent = payload?.pasteAndGoLabel || 'Paste and go';
        }
        fitPopoverToView('address-context', 'view-address-context', { reset: true });
      } else if (kind === 'permission-prompt') {
        currentPermPromptReqId = payload?.requestId || '';
        currentPermPromptDevices = {};
        stopPermPreview();
        showOnly('view-permission-prompt');
        const hostEl = document.getElementById('permPromptHost');
        const descEl = document.getElementById('permPromptDesc');
        const iconEl = document.getElementById('permPromptIcon');
        const incogEl = document.getElementById('permPromptIncognitoNote');
        const linesEl = document.getElementById('permPromptLines');
        const labels = Array.isArray(payload?.labels) && payload.labels.length ? payload.labels : ['Site permission'];
        const keys = Array.isArray(payload?.keys) ? payload.keys : [];
        const rawHost = String(payload?.host || payload?.origin || 'This site').replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
        const cleanHost = rawHost.replace(/^www\.(?=[^.]+\.)/i, '') || rawHost;
        if (hostEl) hostEl.textContent = cleanHost;
        const singleDescMap = {
          notifications: 'wants to show notifications',
          camera: 'wants to use your camera',
          microphone: 'wants to use your microphone',
          geolocation: 'wants to know your location',
          'screen-share': 'wants to share your screen',
          'clipboard-read': 'wants to read text and images from your clipboard'
        };
        if (descEl) {
          if (keys.length === 1 && singleDescMap[keys[0]]) {
            descEl.textContent = singleDescMap[keys[0]];
          } else {
            descEl.textContent = `wants to use your ${labels.join(' & ').toLowerCase()}`;
          }
        }
        if (iconEl) {
          const primaryKey = keys[0] || '';
          const iconSvgMap = {
            notifications:
              '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
            camera:
              '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
            microphone:
              '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
            geolocation:
              '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
            'clipboard-read':
              '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>'
          };
          iconEl.innerHTML =
            iconSvgMap[primaryKey] ||
            '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';
        }
        if (linesEl) {
          linesEl.innerHTML = '';
          const lineText = {
            camera: 'Use your camera',
            microphone: 'Use your microphone',
            geolocation: 'Use your location',
            notifications: 'Show notifications',
            'screen-share': 'Share your screen',
            'clipboard-read': 'See text and images copied to the clipboard'
          };
          if (keys.length > 1) {
            for (const k of keys) {
              const row = document.createElement('span');
              row.textContent = `• ${lineText[k] || k}`;
              linesEl.appendChild(row);
            }
          }
        }
        if (incogEl) incogEl.classList.toggle('hidden', !payload?.incognito);
        const variant = payload?.variant === 'simple' ? 'simple' : 'media';
        document.getElementById('permPromptBtnsMedia')?.classList.toggle('hidden', variant !== 'media');
        document.getElementById('permPromptBtnsSimple')?.classList.toggle('hidden', variant !== 'simple');
        const showPreview = keys.includes('camera');
        const showMic = keys.includes('microphone');
        document.getElementById('permPreviewWrap')?.classList.toggle('hidden', !showPreview);
        document.getElementById('permMicWrap')?.classList.toggle('hidden', !showMic);
        fitPopoverToView('permission-prompt', 'view-permission-prompt', { reset: true });
        // [TABS-W2] Gap 1.5 — tell the chrome window a prompt is open so it
        // can render the omnibox chip ("Use microphone?" etc.).
        lastPromptNotifiedOpen = true;
        window.gxAPI.notifyPermissionPromptState?.({
          open: true,
          origin: payload?.origin || '',
          host: payload?.host || payload?.origin || '',
          keys,
          labels
        });
        if (showPreview || showMic) startPermDevices(keys);
      } else if (kind === 'split-menu') {
        showOnly('view-split-menu');
        renderSplitMenuPopover(payload || {});
        fitPopoverToView('split-menu', 'view-split-menu', { reset: true });
      } else if (kind === 'share-picker') {
        showOnly('view-share-picker');
        renderSharePicker(payload || {});
        fitPopoverToView('share-picker', 'view-share-picker', { reset: true });
      } else if (kind === 'bookmark-folder') {
        showOnly('view-bookmark-folder');
        renderBookmarkFolderItems(payload?.folder || '', payload?.items || []);
        fitPopoverToView('bookmark-folder', 'view-bookmark-folder', { reset: true });
      } else if (kind === 'extensions-dropdown') {
        showOnly('view-extensions-dropdown');
        renderExtensionsDropdown(payload?.rows || payload?.extensions || []);
        fitPopoverToView('extensions-dropdown', 'view-extensions-dropdown', { reset: true });
      } else if (kind === 'profiles') {
        showOnly('view-profiles');
        profInlineMode = null;
        if (payload && Array.isArray(payload.profiles)) {
          renderProfilesPopover(payload);
        }
        fitPopoverToView('profiles', 'view-profiles', { reset: true });
        if (window.gxAPI?.listProfiles) {
          const fresh = await window.gxAPI.listProfiles();
          if (openSeq !== popoverOpenSeq || activePopoverKind !== 'profiles') return;
          renderProfilesPopover(fresh);
          fitPopoverToView('profiles', 'view-profiles');
        }
      } else if (kind === 'bookmark-bubble') {
        // [TABS-W2] Gap 7.4
        showOnly('view-bookmark-bubble');
        await renderBookmarkBubble(payload || {});
        if (openSeq !== popoverOpenSeq || activePopoverKind !== 'bookmark-bubble') return;
        fitPopoverToView('bookmark-bubble', 'view-bookmark-bubble', { reset: true });
      } else if (kind === 'qr-code') {
        // [TABS-W2] Gap 9.4
        showOnly('view-qr-code');
        renderQrCodeView(payload || {});
        fitPopoverToView('qr-code', 'view-qr-code', { reset: true });
      } else if (kind === 'reading-list') {
        // [TABS-W2] Gap 8.8
        showOnly('view-reading-list');
        await renderReadingList();
        if (openSeq !== popoverOpenSeq || activePopoverKind !== 'reading-list') return;
        fitPopoverToView('reading-list', 'view-reading-list', { reset: true });
      } else if (kind === 'tab-search') {
        // [TABS-W2] Gap 8.1
        showOnly('view-tab-search');
        renderTabSearch(payload || {});
        fitPopoverToView('tab-search', 'view-tab-search', { reset: true });
      } else if (kind === 'omnibox-suggest' || kind === 'omnibox-suggest-alt') {
        // [TABS-W2] Gap 3.7 — the renderer alternates the two kinds so
        // re-opening with fresh matches never toggles the popover closed
        // (popovers.js closes a popover re-opened with the same kind).
        showOnly('view-omnibox-suggest');
        renderOmniboxSuggest(payload || {});
        fitPopoverToView(kind, 'view-omnibox-suggest', { reset: true });
      }
    });

    const PUZZLE_FALLBACK_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4c-1.1 0-2 .9-2 2v3.8h1.5c1.5 0 2.7 1.2 2.7 2.7S5 16.2 3.5 16.2H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.5 1.2-2.7 2.7-2.7s2.7 1.2 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5a2.5 2.5 0 0 0 0-5z"/></svg>`;

    function renderExtensionsDropdown(items) {
      const listEl = document.getElementById('extDropdownList');
      const countEl = document.getElementById('extDropdownCount');
      if (!listEl) return;
      listEl.innerHTML = '';

      const rows = Array.isArray(items) ? items : [];
      if (countEl) {
        countEl.textContent = rows.length ? `${rows.length}` : '';
      }

      if (!rows.length) {
        listEl.innerHTML = `<div class="ext-dd-empty" id="extDropdownEmpty">No extensions installed</div>`;
        return;
      }

      for (const ext of rows) {
        if (!ext || !ext.id) continue;
        const isEnabled = ext.enabled !== false;
        const isPinned = Boolean(ext.pinned);
        const hasPopup = Boolean(ext.hasPopup);

        const rowEl = document.createElement('div');
        rowEl.className = `ext-dd-row${isEnabled ? '' : ' disabled'}`;
        rowEl.dataset.extId = ext.id;

        const mainBtn = document.createElement('button');
        mainBtn.type = 'button';
        mainBtn.className = 'ext-dd-main';
        mainBtn.disabled = !isEnabled;
        mainBtn.title = !isEnabled
          ? `${ext.name || 'Extension'} (Disabled)`
          : hasPopup
            ? `Open ${ext.name || 'Extension'}`
            : `${ext.name || 'Extension'} — No popup`;

        const iconWrap = document.createElement('span');
        iconWrap.className = 'ext-dd-icon';
        if (ext.iconDataUrl) {
          const img = document.createElement('img');
          img.className = 'ext-dd-icon-img';
          img.alt = '';
          img.src = ext.iconDataUrl;
          img.addEventListener('error', () => {
            iconWrap.innerHTML = PUZZLE_FALLBACK_SVG;
          });
          iconWrap.appendChild(img);
        } else {
          iconWrap.innerHTML = PUZZLE_FALLBACK_SVG;
        }

        const infoEl = document.createElement('div');
        infoEl.className = 'ext-dd-info';

        const nameRow = document.createElement('div');
        nameRow.className = 'ext-dd-name-row';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'ext-dd-name';
        nameSpan.textContent = ext.name || 'Unnamed Extension';
        nameRow.appendChild(nameSpan);

        if (ext.version) {
          const verSpan = document.createElement('span');
          verSpan.className = 'ext-dd-version';
          verSpan.textContent = ext.version;
          nameRow.appendChild(verSpan);
        }

        infoEl.appendChild(nameRow);

        if (!isEnabled) {
          const metaRow = document.createElement('div');
          metaRow.className = 'ext-dd-meta';
          const pill = document.createElement('span');
          pill.className = 'ext-dd-pill disabled';
          pill.textContent = 'Disabled';
          metaRow.appendChild(pill);
          infoEl.appendChild(metaRow);
        }

        mainBtn.appendChild(iconWrap);
        mainBtn.appendChild(infoEl);

        if (isEnabled) {
          mainBtn.addEventListener('click', () => {
            window.gxAPI.triggerMenuAction(`extension-popup:${ext.id}`);
          });
        }

        const pinBtn = document.createElement('button');
        pinBtn.type = 'button';
        pinBtn.className = `ext-dd-pin-btn${isPinned && isEnabled ? ' pinned' : ''}`;
        pinBtn.dataset.pinId = ext.id;
        pinBtn.disabled = !isEnabled;
        pinBtn.title = !isEnabled
          ? 'Enable extension to pin'
          : isPinned
            ? 'Unpin from toolbar'
            : 'Pin to toolbar';
        pinBtn.setAttribute('aria-label', pinBtn.title);
        pinBtn.setAttribute('aria-pressed', isPinned && isEnabled ? 'true' : 'false');
        pinBtn.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="${isPinned && isEnabled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`;

        if (isEnabled) {
          pinBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const act = isPinned ? `extension-unpin:${ext.id}` : `extension-pin:${ext.id}`;
            window.gxAPI.triggerMenuAction(act);
          });
        }

        rowEl.appendChild(mainBtn);
        rowEl.appendChild(pinBtn);
        listEl.appendChild(rowEl);
      }
    }

    document.getElementById('btnManageExtensions').addEventListener('click', () => {
      window.gxAPI.triggerMenuAction('extensions');
    });

    function buildProfileSwatchesHtml(selectedColor) {
      return PROFILE_COLOR_CHOICES.map(
        (c) =>
          `<button type="button" class="prof-swatch${c.id === selectedColor ? ' active' : ''}" data-profile-color="${c.id}" data-swatch-color="${c.id}" title="${c.label}" aria-label="${c.label}"></button>`
      ).join('');
    }

    function renderProfileInlineArea() {
      const area = document.getElementById('profInlineArea');
      if (!area) return;
      area.innerHTML = '';
      if (!profInlineMode) return;

      if (profInlineMode.type === 'add' || profInlineMode.type === 'rename') {
        const isAdd = profInlineMode.type === 'add';
        const target = profInlineMode.profile || null;
        const selectedColor = profInlineMode.color || target?.color || 'cyan';
        const box = document.createElement('div');
        box.className = 'prof-inline-box';
        box.innerHTML = `
          <div class="prof-inline-title nx-heading">${isAdd ? 'New Profile' : 'Rename Profile'}</div>
          <form id="profInlineForm" class="ctx-input-row" style="padding:0;">
            <input type="text" id="profInlineNameInput" class="ctx-input" maxlength="40" placeholder="Profile name..." value="${escapeHtml(isAdd ? '' : target?.name || '')}" autocomplete="off" />
            <button type="submit" class="ctx-submit-btn">${isAdd ? 'Create' : 'Save'}</button>
          </form>
          <div class="prof-swatches" id="profInlineSwatches">${buildProfileSwatchesHtml(selectedColor)}</div>
          <div id="profInlineError" class="ctx-error hidden"></div>
          <div class="prof-inline-actions">
            <button type="button" class="mini-btn" id="btnProfInlineCancel">Cancel</button>
          </div>
        `;
        area.appendChild(box);

        box.querySelectorAll('.prof-swatch').forEach((sw) => {
          sw.addEventListener('click', () => {
            profInlineMode.color = sw.dataset.swatchColor;
            box.querySelectorAll('.prof-swatch').forEach((b) => {
              b.classList.toggle('active', b.dataset.swatchColor === profInlineMode.color);
            });
          });
        });

        box.querySelector('#btnProfInlineCancel').addEventListener('click', () => {
          profInlineMode = null;
          renderProfileInlineArea();
          fitPopoverToView('profiles', 'view-profiles');
        });

        box.querySelector('#profInlineForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const inp = box.querySelector('#profInlineNameInput');
          const errEl = box.querySelector('#profInlineError');
          const name = inp ? inp.value.trim() : '';
          if (!name) {
            if (errEl) {
              errEl.textContent = 'Profile name cannot be empty.';
              errEl.classList.remove('hidden');
              fitPopoverToView('profiles', 'view-profiles');
            }
            return;
          }
          const res = isAdd
            ? await window.gxAPI.createProfile({ name, color: profInlineMode.color })
            : await window.gxAPI.renameProfile(target.id, { name, color: profInlineMode.color });
          if (!res || !res.ok) {
            if (errEl) {
              errEl.textContent = res?.error || 'Action failed.';
              errEl.classList.remove('hidden');
              fitPopoverToView('profiles', 'view-profiles');
            }
            return;
          }
          profInlineMode = null;
          const fresh = await window.gxAPI.listProfiles();
          renderProfilesPopover(fresh);
          fitPopoverToView('profiles', 'view-profiles');
        });

        const inp = box.querySelector('#profInlineNameInput');
        if (inp) requestAnimationFrame(() => inp.focus());
      } else if (profInlineMode.type === 'delete') {
        const target = profInlineMode.profile;
        if (!target || target.id === 'default') {
          profInlineMode = null;
          return;
        }
        const box = document.createElement('div');
        box.className = 'prof-inline-box danger';
        box.innerHTML = `
          <div class="prof-inline-title nx-heading">Delete "${escapeHtml(target.name)}"?</div>
          <div class="prof-inline-copy">This permanently deletes this profile's local cookies, cache, history, bookmarks, passwords, and settings.</div>
          <div id="profInlineError" class="ctx-error hidden"></div>
          <div class="prof-inline-actions">
            <button type="button" class="mini-btn" id="btnProfDeleteCancel">Cancel</button>
            <button type="button" class="prof-danger-btn" id="btnProfDeleteConfirm">Confirm Delete</button>
          </div>
        `;
        area.appendChild(box);

        box.querySelector('#btnProfDeleteCancel').addEventListener('click', () => {
          profInlineMode = null;
          renderProfileInlineArea();
          fitPopoverToView('profiles', 'view-profiles');
        });

        box.querySelector('#btnProfDeleteConfirm').addEventListener('click', async () => {
          const btn = box.querySelector('#btnProfDeleteConfirm');
          btn.disabled = true;
          const res = await window.gxAPI.deleteProfile(target.id);
          if (!res || !res.ok) {
            btn.disabled = false;
            const errEl = box.querySelector('#profInlineError');
            if (errEl) {
              errEl.textContent = res?.error || 'Could not delete profile.';
              errEl.classList.remove('hidden');
              fitPopoverToView('profiles', 'view-profiles');
            }
            return;
          }
          profInlineMode = null;
          const fresh = await window.gxAPI.listProfiles();
          renderProfilesPopover(fresh);
          fitPopoverToView('profiles', 'view-profiles');
        });
      }
    }

    function renderProfilesPopover(data) {
      currentProfilesData = data || null;
      const listEl = document.getElementById('profList');
      const countEl = document.getElementById('profCount');
      const noticeEl = document.getElementById('profWindowNotice');
      if (!listEl) return;
      listEl.innerHTML = '';

      const profiles = Array.isArray(data?.profiles) ? data.profiles : [];
      const activeId = data?.activeId || 'default';
      const windowProfileId = data?.windowProfileId || activeId;

      if (countEl) countEl.textContent = profiles.length ? `${profiles.length}` : '';

      if (noticeEl) {
        if (windowProfileId !== activeId) {
          const winProf = profiles.find((p) => p.id === windowProfileId);
          const actProf = profiles.find((p) => p.id === activeId);
          noticeEl.textContent = `This window uses ${winProf?.name || 'Default'}. Active profile for new windows: ${actProf?.name || 'Default'}.`;
          noticeEl.classList.remove('hidden');
        } else {
          noticeEl.classList.add('hidden');
        }
      }

      for (const prof of profiles) {
        if (!prof || !prof.id) continue;
        const isActive = prof.id === activeId;
        const isThisWindow = prof.id === windowProfileId;
        const isDefault = prof.id === 'default';

        const row = document.createElement('div');
        row.className = `prof-row${isActive ? ' is-active' : ''}`;
        row.dataset.profileId = prof.id;

        const mainBtn = document.createElement('button');
        mainBtn.type = 'button';
        mainBtn.className = 'prof-main-btn';
        const openProfileIds = Array.isArray(data?.openProfileIds) ? data.openProfileIds : [];
        const hasOpenWindow = openProfileIds.includes(prof.id);
        mainBtn.title = isThisWindow
          ? `${prof.name} (This window)`
          : hasOpenWindow
            ? `Focus the window already open in ${prof.name} — its tabs are exactly as you left them`
            : `Switch to ${prof.name} (opens a new window with its saved tabs)`;

        const metaParts = [];
        if (isActive) metaParts.push('Active');
        if (isThisWindow) metaParts.push('This window');
        else if (hasOpenWindow) metaParts.push('Open — click to focus');
        if (isDefault) metaParts.push('Default');

        mainBtn.innerHTML = `
          <span class="prof-avatar" data-profile-color="${escapeHtml(prof.color || 'gx-violet')}">${escapeHtml(prof.avatar || prof.name?.charAt(0)?.toUpperCase() || 'P')}</span>
          <span class="prof-info">
            <span class="prof-name-line">
              <span class="prof-name">${escapeHtml(prof.name)}</span>
              ${isActive
            ? `<span class="prof-check" title="Active profile"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>`
            : ''
          }
            </span>
            <span class="prof-meta">${escapeHtml(metaParts.join(' • ') || 'Click to switch')}</span>
          </span>
        `;

        mainBtn.addEventListener('click', async () => {
          window.gxAPI.closePopover();
          if (isActive && isThisWindow) return;
          await window.gxAPI.switchProfile(prof.id);
        });

        const actions = document.createElement('div');
        actions.className = 'prof-row-actions';

        const renameBtn = document.createElement('button');
        renameBtn.type = 'button';
        renameBtn.className = 'prof-icon-btn';
        renameBtn.title = `Rename ${prof.name}`;
        renameBtn.setAttribute('aria-label', `Rename ${prof.name}`);
        renameBtn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
        renameBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          profInlineMode = { type: 'rename', profile: prof, color: prof.color || 'gx-violet' };
          renderProfileInlineArea();
          fitPopoverToView('profiles', 'view-profiles');
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'prof-icon-btn danger';
        deleteBtn.disabled = isDefault;
        deleteBtn.title = isDefault ? 'Default profile cannot be deleted' : `Delete ${prof.name}`;
        deleteBtn.setAttribute('aria-label', deleteBtn.title);
        deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>`;
        if (!isDefault) {
          deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            profInlineMode = { type: 'delete', profile: prof };
            renderProfileInlineArea();
            fitPopoverToView('profiles', 'view-profiles');
          });
        }

        actions.appendChild(renameBtn);
        actions.appendChild(deleteBtn);
        row.appendChild(mainBtn);
        row.appendChild(actions);
        listEl.appendChild(row);
      }

      renderProfileInlineArea();
    }

    document.getElementById('btnProfAdd').addEventListener('click', async () => {
      // UX phase: the ONE shared "New Profile" modal lives in the shell.
      window.gxAPI.closePopover();
      if (typeof window.gxAPI.openCreateProfileModal === 'function') {
        await window.gxAPI.openCreateProfileModal();
        return;
      }
      // Fallback (old preload): the inline box in this popover.
      const profiles = Array.isArray(currentProfilesData?.profiles) ? currentProfilesData.profiles : [];
      const used = new Set(profiles.map((p) => p.color));
      const nextColor =
        PROFILE_COLOR_CHOICES.find((c) => !used.has(c.id))?.id ||
        PROFILE_COLOR_CHOICES[profiles.length % PROFILE_COLOR_CHOICES.length].id;
      profInlineMode = { type: 'add', color: nextColor };
      renderProfileInlineArea();
      fitPopoverToView('profiles', 'view-profiles');
    });

    document.getElementById('btnProfManageSettings').addEventListener('click', () => {
      window.gxAPI.triggerMenuAction('settings');
    });

    window.gxAPI.onProfilesUpdate?.((data) => {
      if (
        activePopoverKind === 'profiles' &&
        !document.getElementById('view-profiles').classList.contains('hidden')
      ) {
        renderProfilesPopover(data);
        fitPopoverToView('profiles', 'view-profiles');
      }
    });

    function renderTabContextGroupAndWorkspaceSections(ctx) {
      const grpSec = document.getElementById('tabCtxGroupSection');
      const wsSec = document.getElementById('tabCtxWorkspaceSection');
      if (grpSec) {
        grpSec.innerHTML = '';
        grpSec.classList.add('hidden');
      }
      if (wsSec) {
        wsSec.innerHTML = '';
        wsSec.classList.add('hidden');
      }
      if (!ctx || !ctx.id || ctx.pinned) return;

      const tabId = ctx.id;
      const groups = (Array.isArray(ctx.groups) ? ctx.groups : []).filter(
        (g) => g && g.id && (typeof g.tabCount !== 'number' || g.tabCount > 0)
      );
      const currentGroupId = ctx.groupId || null;

      if (grpSec) {
        const sep = document.createElement('div');
        sep.className = 'sep';
        grpSec.appendChild(sep);

        if (!currentGroupId) {
          const newGrpBtn = document.createElement('button');
          newGrpBtn.type = 'button';
          newGrpBtn.className = 'menu-item';
          newGrpBtn.setAttribute('role', 'menuitem');
          newGrpBtn.innerHTML = `
            <span class="menu-left">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 9v6M9 12h6"/></svg>
              Add to New Group
            </span>
          `;
          newGrpBtn.addEventListener('click', () => {
            window.gxAPI.closePopover();
            window.gxAPI.createTabGroup({ tabIds: [tabId] });
          });
          grpSec.appendChild(newGrpBtn);

          if (groups.length > 0) {
            const lbl = document.createElement('div');
            lbl.className = 'ctx-section-label';
            lbl.textContent = 'Add to Group';
            grpSec.appendChild(lbl);

            for (const g of groups) {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'menu-item';
              btn.setAttribute('role', 'menuitem');
              btn.innerHTML = `
                <span class="menu-left">
                  <span class="ctx-color-dot" data-group-color="${escapeHtml(g.color || 'group-1')}"></span>
                  ${escapeHtml(g.name || 'Group')}
                </span>
              `;
              btn.addEventListener('click', () => {
                window.gxAPI.closePopover();
                window.gxAPI.addTabToGroup(tabId, g.id);
              });
              grpSec.appendChild(btn);
            }
          }
        } else {
          const removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.className = 'menu-item';
          removeBtn.setAttribute('role', 'menuitem');
          removeBtn.innerHTML = `
            <span class="menu-left">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              Remove from Group
            </span>
          `;
          removeBtn.addEventListener('click', () => {
            window.gxAPI.closePopover();
            window.gxAPI.removeTabFromGroup(tabId);
          });
          grpSec.appendChild(removeBtn);

          const ungroupBtn = document.createElement('button');
          ungroupBtn.type = 'button';
          ungroupBtn.className = 'menu-item danger';
          ungroupBtn.setAttribute('role', 'menuitem');
          ungroupBtn.title = ctx.groupName ? `Ungroup "${ctx.groupName}" (keeps all tabs)` : 'Ungroup (keeps all tabs)';
          ungroupBtn.innerHTML = `
            <span class="menu-left">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M9 12h6"/></svg>
              Ungroup
            </span>
          `;
          ungroupBtn.addEventListener('click', () => {
            window.gxAPI.closePopover();
            window.gxAPI.ungroupTabGroup(currentGroupId);
          });
          grpSec.appendChild(ungroupBtn);

          const otherGroups = groups.filter((g) => g && g.id !== currentGroupId);
          if (otherGroups.length > 0) {
            const lbl = document.createElement('div');
            lbl.className = 'ctx-section-label';
            lbl.textContent = 'Move to Group';
            grpSec.appendChild(lbl);

            for (const g of otherGroups) {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'menu-item';
              btn.setAttribute('role', 'menuitem');
              btn.innerHTML = `
                <span class="menu-left">
                  <span class="ctx-color-dot" data-group-color="${escapeHtml(g.color || 'group-1')}"></span>
                  ${escapeHtml(g.name || 'Group')}
                </span>
              `;
              btn.addEventListener('click', () => {
                window.gxAPI.closePopover();
                window.gxAPI.addTabToGroup(tabId, g.id);
              });
              grpSec.appendChild(btn);
            }
          }
        }

        grpSec.classList.remove('hidden');
      }

      if (wsSec && !ctx.windowIncognito) {
        const workspaces = Array.isArray(ctx.workspaces) ? ctx.workspaces : [];
        const tabWsId = ctx.workspaceId || 'default';
        const otherWorkspaces = workspaces.filter((w) => w && w.id !== tabWsId);
        if (otherWorkspaces.length > 0) {
          const sep = document.createElement('div');
          sep.className = 'sep';
          wsSec.appendChild(sep);

          const lbl = document.createElement('div');
          lbl.className = 'ctx-section-label';
          lbl.textContent = 'Move to Workspace';
          wsSec.appendChild(lbl);

          for (const ws of otherWorkspaces) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'menu-item';
            btn.setAttribute('role', 'menuitem');
            btn.innerHTML = `
              <span class="menu-left">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>
                ${escapeHtml(ws.name || 'Workspace')}
              </span>
            `;
            btn.addEventListener('click', () => {
              window.gxAPI.closePopover();
              window.gxAPI.moveTabToWorkspace(tabId, ws.id);
            });
            wsSec.appendChild(btn);
          }

          wsSec.classList.remove('hidden');
        }
      }
    }

    function renderGroupContextMenu(payload) {
      const group = payload?.group || null;
      const tabCount = Number(payload?.tabCount || 0);
      const countEl = document.getElementById('grpCtxCount');
      const inputEl = document.getElementById('grpCtxNameInput');
      const errEl = document.getElementById('grpCtxError');
      const collapseLabel = document.getElementById('grpCtxCollapseLabel');

      if (countEl) countEl.textContent = `${tabCount} ${tabCount === 1 ? 'tab' : 'tabs'}`;
      if (inputEl) inputEl.value = group?.name || '';
      if (errEl) {
        errEl.textContent = '';
        errEl.classList.add('hidden');
      }
      if (collapseLabel) {
        collapseLabel.textContent = group?.collapsed ? 'Expand Group' : 'Collapse Group';
      }
      const activeColor = group?.color || 'group-1';
      document.querySelectorAll('#grpCtxSwatches .ctx-swatch').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.groupColor === activeColor);
      });
    }

    function renderWorkspaceContextMenu(mode, payload) {
      const titleEl = document.getElementById('wsCtxTitle');
      const countEl = document.getElementById('wsCtxCount');
      const inputEl = document.getElementById('wsCtxNameInput');
      const submitBtn = document.getElementById('wsCtxSubmitBtn');
      const errEl = document.getElementById('wsCtxError');
      const manageEl = document.getElementById('wsCtxManageActions');
      const switchBtn = document.getElementById('btnWsCtxSwitch');
      const deleteBtn = document.getElementById('btnWsCtxDelete');
      const deleteHint = document.getElementById('wsCtxDeleteHint');

      if (errEl) {
        errEl.textContent = '';
        errEl.classList.add('hidden');
      }

      if (mode === 'workspace-create') {
        if (titleEl) titleEl.textContent = 'New Workspace';
        if (countEl) countEl.textContent = '';
        if (inputEl) {
          inputEl.value = '';
          inputEl.placeholder = 'Workspace name...';
        }
        if (submitBtn) submitBtn.textContent = 'Create';
        if (manageEl) manageEl.classList.add('hidden');
        return;
      }

      const ws = payload?.workspace || {};
      const isDefault = Boolean(payload?.isDefault || ws.id === 'default');
      const isActive = Boolean(payload?.isActive);
      const tabCount = Number(payload?.tabCount || 0);

      if (titleEl) titleEl.textContent = isDefault ? 'Default Workspace' : 'Workspace';
      if (countEl) countEl.textContent = `${tabCount} ${tabCount === 1 ? 'tab' : 'tabs'}`;
      if (inputEl) {
        inputEl.value = ws.name || '';
        inputEl.placeholder = 'Workspace name';
      }
      if (submitBtn) submitBtn.textContent = 'Save';
      if (manageEl) manageEl.classList.remove('hidden');
      if (switchBtn) switchBtn.classList.toggle('hidden', isActive);
      if (deleteBtn) {
        deleteBtn.disabled = isDefault;
        deleteBtn.title = isDefault
          ? 'Built-in Default workspace cannot be deleted'
          : 'Delete workspace and move its tabs to Default';
      }
      if (deleteHint) {
        deleteHint.textContent = isDefault ? 'Built-in' : 'Tabs to Default';
      }
    }

    document.getElementById('grpCtxRenameForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const groupId = currentGroupCtx?.group?.id;
      const inputEl = document.getElementById('grpCtxNameInput');
      const errEl = document.getElementById('grpCtxError');
      if (!groupId || !inputEl) return;
      const name = inputEl.value.trim();
      if (!name) {
        if (errEl) {
          errEl.textContent = 'Group name cannot be empty.';
          errEl.classList.remove('hidden');
          fitPopoverToView('tab-context', 'view-group-context');
        }
        return;
      }
      await window.gxAPI.updateTabGroup(groupId, { name });
      window.gxAPI.closePopover();
    });

    document.querySelectorAll('#grpCtxSwatches .ctx-swatch').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const groupId = currentGroupCtx?.group?.id;
        const color = btn.dataset.groupColor;
        if (!groupId || !color) return;
        document.querySelectorAll('#grpCtxSwatches .ctx-swatch').forEach((b) => {
          b.classList.toggle('active', b.dataset.groupColor === color);
        });
        if (currentGroupCtx?.group) currentGroupCtx.group.color = color;
        await window.gxAPI.updateTabGroup(groupId, { color });
      });
    });

    document.getElementById('btnGrpCtxToggleCollapse').addEventListener('click', () => {
      const groupId = currentGroupCtx?.group?.id;
      if (!groupId) return;
      window.gxAPI.closePopover();
      window.gxAPI.toggleTabGroupCollapse(groupId);
    });

    document.getElementById('btnGrpCtxNewTab').addEventListener('click', () => {
      const groupId = currentGroupCtx?.group?.id;
      if (!groupId) return;
      window.gxAPI.closePopover();
      window.gxAPI.createTabInGroup(groupId);
    });

    document.getElementById('btnGrpCtxUngroup').addEventListener('click', () => {
      const groupId = currentGroupCtx?.group?.id;
      if (!groupId) return;
      window.gxAPI.closePopover();
      window.gxAPI.ungroupTabGroup(groupId);
    });

    document.getElementById('wsCtxForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const inputEl = document.getElementById('wsCtxNameInput');
      const errEl = document.getElementById('wsCtxError');
      if (!inputEl) return;
      const name = inputEl.value.trim();
      if (!name) {
        if (errEl) {
          errEl.textContent = 'Workspace name cannot be empty.';
          errEl.classList.remove('hidden');
          fitPopoverToView('tab-context', 'view-workspace-context');
        }
        return;
      }
      if (currentWorkspaceMode === 'workspace-create') {
        const res = await window.gxAPI.createWorkspace({ name, switchTo: true });
        if (res && res.ok === false && errEl) {
          errEl.textContent = res.error || 'Could not create workspace.';
          errEl.classList.remove('hidden');
          fitPopoverToView('tab-context', 'view-workspace-context');
          return;
        }
        window.gxAPI.closePopover();
      } else {
        const wsId = currentWorkspaceCtx?.workspace?.id;
        if (!wsId) return;
        const res = await window.gxAPI.renameWorkspace(wsId, name);
        if (res && res.ok === false && errEl) {
          errEl.textContent = res.error || 'Could not rename workspace.';
          errEl.classList.remove('hidden');
          fitPopoverToView('tab-context', 'view-workspace-context');
          return;
        }
        window.gxAPI.closePopover();
      }
    });

    document.getElementById('btnWsCtxSwitch').addEventListener('click', () => {
      const wsId = currentWorkspaceCtx?.workspace?.id;
      if (!wsId) return;
      window.gxAPI.closePopover();
      window.gxAPI.switchWorkspace(wsId);
    });

    document.getElementById('btnWsCtxDelete').addEventListener('click', () => {
      const btn = document.getElementById('btnWsCtxDelete');
      const wsId = currentWorkspaceCtx?.workspace?.id;
      if (!wsId || btn.disabled) return;
      window.gxAPI.closePopover();
      window.gxAPI.deleteWorkspace(wsId);
    });

    document.querySelectorAll('[data-tab-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled || !currentTabCtx || !currentTabCtx.id) return;
        const tabId = currentTabCtx.id;
        const act = btn.dataset.tabAct;
        window.gxAPI.closePopover();
        if (act === 'duplicate') {
          window.gxAPI.duplicateTab(tabId);
        } else if (act === 'reload') {
          window.gxAPI.reload(tabId);
        } else if (act === 'pin') {
          window.gxAPI.pinTab(tabId);
        } else if (act === 'split') {
          const isVisibleSplitPane = Boolean(currentTabCtx.isSplitPane && currentTabCtx.splitVisible);
          if (isVisibleSplitPane) {
            window.gxAPI.exitSplit();
          } else if (currentTabCtx.splitVisible) {
            window.gxAPI.startSplit({ tabId });
          } else if (currentTabCtx.isActive) {
            window.gxAPI.startSplit({ openPicker: true });
          } else {
            window.gxAPI.mergeSplitTabs({ rightTabId: tabId, focusPane: 'right' });
          }
        } else if (act === 'split-swap') {
          window.gxAPI.swapSplitPanes();
        } else if (act === 'hibernate') {
          window.gxAPI.sleepTab(tabId);
        } else if (act === 'pop-out-video') {
          window.gxAPI.popOutVideo(tabId);
        } else if (act === 'close') {
          window.gxAPI.closeTab(tabId);
        } else if (act === 'close-others') {
          window.gxAPI.closeOtherTabs(tabId);
        } else if (act === 'new-tab-right') {
          // [TABS-W2] Gap 8.2 — insert right after the tab that was clicked.
          const idx = typeof currentTabCtx.index === 'number' ? currentTabCtx.index : -1;
          window.gxAPI.createTab({
            url: 'nextgx://newtab',
            active: true,
            insertIndex: idx >= 0 ? idx + 1 : undefined
          });
        } else if (act === 'move-to-new-window') {
          // [TABS-W2] Gap 8.2
          window.gxAPI.moveTabToNewWindow(tabId);
        } else if (act === 'mute') {
          // [TABS-W2] Gap 8.2 / 8.6 — toggles mute for the tab's site.
          window.gxAPI.muteTab(tabId);
        } else if (act === 'reading-list') {
          // [TABS-W2] Gap 8.8 — main resolves title/URL from the tab.
          window.gxAPI.addReadingList({ tabId });
        } else if (act === 'close-right') {
          // [TABS-W2] Gap 8.2
          window.gxAPI.closeTabsToRight(tabId);
        }
      });
    });

    // Split View Control Popover (Merge two tabs, Reverse Left/Right, Separate/Un-split)
    let currentSplitMenuPayload = null;
    function renderSplitMenuPopover(payload) {
      currentSplitMenuPayload = payload || {};
      const split = payload?.split && payload.split.visible ? payload.split : null;
      const activeTabId = payload?.activeTabId || null;
      const tabs = Array.isArray(payload?.tabs) ? payload.tabs : [];
      const tabById = new Map(tabs.map((t) => [t.id, t]));

      const statusEl = document.getElementById('splitMenuStatus');
      const activeSec = document.getElementById('splitMenuActiveSection');
      const inactiveSec = document.getElementById('splitMenuInactiveSection');
      const headingEl = document.getElementById('splitMenuTabsHeading');
      const listEl = document.getElementById('splitMenuTabList');
      const tabsWrap = document.getElementById('splitMenuTabsWrap');

      if (statusEl) statusEl.textContent = split ? 'ACTIVE' : 'OFF';
      if (activeSec) activeSec.classList.toggle('hidden', !split);
      if (inactiveSec) inactiveSec.classList.toggle('hidden', Boolean(split));

      if (split) {
        const leftTab = tabById.get(split.leftTabId);
        const rightTab = tabById.get(split.rightTabId);
        const leftTitleEl = document.getElementById('splitLeftTitle');
        const rightTitleEl = document.getElementById('splitRightTitle');
        const leftChip = document.getElementById('btnSplitFocusLeft');
        const rightChip = document.getElementById('btnSplitFocusRight');
        if (leftTitleEl) leftTitleEl.textContent = leftTab?.title || 'Left Tab';
        if (rightTitleEl) rightTitleEl.textContent = rightTab?.title || 'Right Tab';
        if (leftChip) leftChip.classList.toggle('focused', split.focusedPane !== 'right');
        if (rightChip) rightChip.classList.toggle('focused', split.focusedPane === 'right');
      }

      const candidateTabs = split
        ? tabs.filter((t) => t && t.id !== split.leftTabId && t.id !== split.rightTabId)
        : tabs.filter((t) => t && t.id !== activeTabId);

      const topSep = document.getElementById('splitMenuTabsTopSep');
      if (topSep) topSep.classList.toggle('hidden', !split);
      if (headingEl) {
        headingEl.textContent = split
          ? 'Switch inactive pane to open tab'
          : 'Select an open tab to split with';
      }
      if (listEl) {
        listEl.innerHTML = '';
        if (candidateTabs.length === 0) {
          if (tabsWrap) tabsWrap.classList.toggle('hidden', Boolean(split));
          if (!split) {
            const note = document.createElement('div');
            note.className = 'split-empty-note';
            note.textContent = 'Open another tab to merge two tabs side by side.';
            listEl.appendChild(note);
          }
        } else {
          if (tabsWrap) tabsWrap.classList.remove('hidden');
          const GLOBE_FALLBACK =
            '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" style="flex-shrink:0;opacity:0.7;"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8"/></svg>';
          for (const t of candidateTabs) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'split-tab-item';
            btn.title = t.url || t.title || '';
            const safeSplitFav = sanitizeUiFaviconUrl(t.favicon);
            if (safeSplitFav) {
              const img = document.createElement('img');
              img.className = 'split-tab-fav';
              img.alt = '';
              img.src = safeSplitFav;
              img.addEventListener('error', () => {
                const span = document.createElement('span');
                span.innerHTML = GLOBE_FALLBACK;
                img.replaceWith(span.firstChild);
              });
              btn.appendChild(img);
            } else {
              const span = document.createElement('span');
              span.innerHTML = GLOBE_FALLBACK;
              btn.appendChild(span.firstChild);
            }
            const name = document.createElement('span');
            name.className = 'split-tab-name';
            name.textContent = t.title || t.url || 'Untitled Tab';
            btn.appendChild(name);
            btn.addEventListener('click', () => {
              window.gxAPI.closePopover();
              if (split) {
                window.gxAPI.startSplit({ tabId: t.id });
              } else {
                window.gxAPI.mergeSplitTabs({ leftTabId: activeTabId, rightTabId: t.id, focusPane: 'right' });
              }
            });
            listEl.appendChild(btn);
          }
        }
      }
    }

    document.getElementById('btnSplitWithNewTab')?.addEventListener('click', () => {
      window.gxAPI.closePopover();
      window.gxAPI.startSplit({ openPicker: false });
    });
    document.getElementById('btnSplitSwapPanes')?.addEventListener('click', () => {
      window.gxAPI.closePopover();
      window.gxAPI.swapSplitPanes();
    });
    document.getElementById('btnSplitQuickSwap')?.addEventListener('click', () => {
      window.gxAPI.closePopover();
      window.gxAPI.swapSplitPanes();
    });
    document.getElementById('btnSplitSeparate')?.addEventListener('click', () => {
      window.gxAPI.closePopover();
      window.gxAPI.exitSplit();
    });
    document.getElementById('btnSplitResetRatio')?.addEventListener('click', () => {
      window.gxAPI.closePopover();
      window.gxAPI.setSplitRatio(0.5, { persist: true });
    });
    document.getElementById('btnSplitFocusLeft')?.addEventListener('click', () => {
      window.gxAPI.closePopover();
      window.gxAPI.focusSplitPane('left');
    });
    document.getElementById('btnSplitFocusRight')?.addEventListener('click', () => {
      window.gxAPI.closePopover();
      window.gxAPI.focusSplitPane('right');
    });
    document.getElementById('btnSplitCloseLeft')?.addEventListener('click', () => {
      const leftId = currentSplitMenuPayload?.split?.leftTabId;
      window.gxAPI.closePopover();
      if (leftId) window.gxAPI.closeTab(leftId);
    });
    document.getElementById('btnSplitCloseRight')?.addEventListener('click', () => {
      const rightId = currentSplitMenuPayload?.split?.rightTabId;
      window.gxAPI.closePopover();
      if (rightId) window.gxAPI.closeTab(rightId);
    });

    // Market audit bug #30: rail context menu actions.
    document.querySelectorAll('[data-rail-act]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (btn.disabled || !currentRailCtx || !currentRailCtx.key) return;
        const act = btn.dataset.railAct;
        const key = currentRailCtx.key;
        window.gxAPI.closePopover();
        if (act === 'open') {
          window.gxAPI.openSidebarPanel(key);
        } else if (act === 'pin') {
          // Fix2-shell (item 9): flip the panel's pinned state through the
          // settings the shell already applies, then open the panel so the
          // new state is visible (openSidebarPanel is idempotent — it opens,
          // never toggles — so this cannot close an open panel).
          await window.gxAPI.updateSettings({ sidebarPanelPinned: !currentRailCtx.pinned });
          window.gxAPI.openSidebarPanel(key);
        } else if (act === 'hide') {
          // Hide the rail icon via the same settings the Customize Dock
          // drawer writes; the shell re-applies visibility on update.
          await window.gxAPI.updateSettings({ sidebarItems: { [key]: false } });
        } else if (act === 'customize') {
          window.gxAPI.openLeftTool('sidebarSetup');
        }
      });
    });

    // M-1: address-bar context menu actions. Paste-and-go and Edit search
    // engines use existing gxAPI channels (same targets as the native menu in
    // src/main/context-menu.js). The edit actions (undo/cut/copy/paste/
    // select-all) operate on the address-bar input in the chrome window, and
    // no popover->chrome edit IPC channel exists yet -- they dismiss the menu
    // only. The native menu still serves those actions today; a future
    // 'contextmenu:chrome-edit' IPC channel (preload + main) would complete
    // this popover path.
    document.querySelectorAll('[data-addr-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const act = btn.dataset.addrAct;
        window.gxAPI.closePopover();
        if (act === 'paste-and-go') {
          const text = (currentAddrCtx?.clipboardText || '').trim();
          if (text) window.gxAPI.navigate(text);
        } else if (act === 'edit-search-engines') {
          window.gxAPI.triggerMenuAction('settings');
        }
      });
    });

    let currentPermPromptReqId = '';
    let currentPermPromptDevices = {};
    const respondPermPrompt = (decision) => {
      if (!currentPermPromptReqId) return;
      const reqId = currentPermPromptReqId;
      currentPermPromptReqId = '';
      const devices = { ...currentPermPromptDevices };
      currentPermPromptDevices = {};
      // Release the preview camera/mic NOW (synchronously, before main
      // resolves the page's getUserMedia) so the page's stream never races
      // the preview for exclusive hardware access.
      stopPermPreview();
      window.gxAPI.respondPermissionPrompt?.({ requestId: reqId, decision, devices });
    };
    document.getElementById('btnPermPromptAlways')?.addEventListener('click', () => respondPermPrompt('allow-always'));
    document.getElementById('btnPermPromptOnce')?.addEventListener('click', () => respondPermPrompt('allow-once'));
    document.getElementById('btnPermPromptBlock')?.addEventListener('click', () => respondPermPrompt('block'));
    document.getElementById('btnPermPromptSimpleAllow')?.addEventListener('click', () => respondPermPrompt('allow-always'));
    document.getElementById('btnPermPromptSimpleBlock')?.addEventListener('click', () => respondPermPrompt('block'));
    // Gap 1.4: ✕ dismisses with NO decision stored (main resolves the
    // in-flight request as denied and the site asks again next time).
    document.getElementById('btnPermPromptClose')?.addEventListener('click', () => {
      currentPermPromptReqId = '';
      currentPermPromptDevices = {};
      window.gxAPI.closePopover?.();
    });
    document.getElementById('permCameraSelect')?.addEventListener('change', (e) => {
      const id = e.target.value || '';
      const label = e.target.options[e.target.selectedIndex]?.textContent || '';
      if (id) currentPermPromptDevices.camera = id;
      else delete currentPermPromptDevices.camera;
      if (label) currentPermPromptDevices.cameraLabel = label;
      else delete currentPermPromptDevices.cameraLabel;
      if (id) switchPermPreviewCamera(id);
    });
    document.getElementById('permMicSelect')?.addEventListener('change', (e) => {
      const id = e.target.value || '';
      const label = e.target.options[e.target.selectedIndex]?.textContent || '';
      if (id) currentPermPromptDevices.microphone = id;
      else delete currentPermPromptDevices.microphone;
      if (label) currentPermPromptDevices.microphoneLabel = label;
      else delete currentPermPromptDevices.microphoneLabel;
    });

    // Chrome parity (worker A): screen-share picker controls.
    document.querySelectorAll('[data-share-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!currentShareRequestId) return;
        currentShareTab = btn.dataset.shareTab;
        currentShareSelection = null;
        document.querySelectorAll('[data-share-tab]').forEach((b) => {
          b.classList.toggle('active', b === btn);
        });
        document
          .getElementById('shareTabAudioRow')
          ?.classList.toggle('hidden', currentShareTab !== 'tab');
        document
          .getElementById('shareAudioNote')
          ?.classList.toggle('hidden', currentShareTab === 'tab');
        renderShareGrid();
        updateShareFooter();
      });
    });
    document.getElementById('chkShareTabAudio')?.addEventListener('change', () => updateShareFooter());
    document.getElementById('btnShareCancel')?.addEventListener('click', () => {
      respondSharePicker('cancel');
    });
    document.getElementById('btnShareConfirm')?.addEventListener('click', () => {
      if (!currentShareSelection) return;
      respondSharePicker('share', currentShareSelection);
    });

    // [TABS-W2] Bookmark bubble buttons (gap 7.4): Done saves the name /
    // folder (add or update via the bookmark store), Remove deletes it.
    document.getElementById('btnBmBubbleDone')?.addEventListener('click', async () => {
      if (!currentBmBubble || !currentBmBubble.url) return;
      const nameEl = document.getElementById('bmBubbleName');
      const folderEl = document.getElementById('bmBubbleFolder');
      const title = (nameEl?.value || '').trim() || currentBmBubble.url;
      const folder = folderEl?.value || '';
      if (currentBmBubble.id) {
        await window.gxAPI.updateBookmark({ id: currentBmBubble.id, title, folder });
      } else {
        await window.gxAPI.addBookmark({
          title,
          url: currentBmBubble.url,
          folder,
          favicon: currentBmBubble.favicon || ''
        });
      }
      currentBmBubble = null;
      window.gxAPI.closePopover();
    });
    document.getElementById('btnBmBubbleRemove')?.addEventListener('click', async () => {
      if (currentBmBubble?.id) await window.gxAPI.removeBookmark(currentBmBubble.id);
      currentBmBubble = null;
      window.gxAPI.closePopover();
    });
    // [TABS-W2] QR code buttons (gap 9.4): copy the page URL, close the view.
    document.getElementById('btnQrCopy')?.addEventListener('click', async () => {
      const url = document.getElementById('qrUrlText')?.textContent || '';
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
      } catch (_) {
        const ta = document.createElement('textarea');
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
        } catch (_) { }
        ta.remove();
      }
      window.gxAPI.closePopover();
    });
    document.getElementById('btnQrClose')?.addEventListener('click', () => window.gxAPI.closePopover());

    document.addEventListener('keydown', (e) => {
      if (
        document.activeElement &&
        (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')
      ) {
        return;
      }
      const tabCtxView = document.getElementById('view-tab-context');
      const addrCtxView = document.getElementById('view-address-context');
      const grpCtxView = document.getElementById('view-group-context');
      const wsCtxView = document.getElementById('view-workspace-context');
      const bmFolderView = document.getElementById('view-bookmark-folder');
      const mainMenuView = document.getElementById('view-menu');
      const shotView = document.getElementById('view-screenshot');
      const extDdView = document.getElementById('view-extensions-dropdown');
      const profView = document.getElementById('view-profiles');
      const railCtxView = document.getElementById('view-rail-context');
      const activeMenu =
        tabCtxView && !tabCtxView.classList.contains('hidden')
          ? tabCtxView
          : addrCtxView && !addrCtxView.classList.contains('hidden')
            ? addrCtxView
            : grpCtxView && !grpCtxView.classList.contains('hidden')
              ? grpCtxView
              : wsCtxView && !wsCtxView.classList.contains('hidden')
                ? wsCtxView
                : bmFolderView && !bmFolderView.classList.contains('hidden')
                  ? bmFolderView
                  : mainMenuView && !mainMenuView.classList.contains('hidden')
                    ? mainMenuView
                    : shotView && !shotView.classList.contains('hidden')
                      ? shotView
                      : extDdView && !extDdView.classList.contains('hidden')
                        ? extDdView
                        : profView && !profView.classList.contains('hidden')
                          ? profView
                          : railCtxView && !railCtxView.classList.contains('hidden')
                            ? railCtxView
                            : null;
      if (!activeMenu) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = Array.from(
        activeMenu.querySelectorAll('.menu-item:not(:disabled), .ext-dd-main:not(:disabled), .prof-main-btn:not(:disabled)')
      );
      if (!items.length) return;
      e.preventDefault();
      const idx = items.indexOf(document.activeElement);
      const nextIdx =
        e.key === 'ArrowDown'
          ? (idx + 1) % items.length
          : (idx <= 0 ? items.length - 1 : idx - 1);
      items[nextIdx].focus();
    });

    document.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        if (act === 'screenshot-area') {
          window.gxAPI.startAreaScreenshot();
        } else if (act === 'reading-list') {
          // [TABS-W2] Gap 8.8 — swap the menu for the reading-list view (right-aligned to main window).
          window.gxAPI.openPopover({
            kind: 'reading-list',
            x: 9999,
            y: 90,
            width: 330,
            height: 380
          });
        } else if (act === 'delete-browsing-data') {
          // [TABS-W2] Gap 9.9 — the Privacy page holds the clear-data card.
          window.gxAPI.closePopover();
          window.gxAPI.createTab({ url: 'nextgx://privacy', active: true });
        } else if (act === 'bookmark-current') {
          // [TABS-W2] Gap 7.4 — fetch live active tab if state hasn't pushed yet.
          Promise.resolve(lastMenuActiveTab || window.gxAPI.getState?.().then((s) => s?.activeTab)).then((active) => {
            if (!active || !active.url || /^nextgx:\/\//i.test(active.url)) return;
            window.gxAPI.openPopover({
              kind: 'bookmark-bubble',
              x: 9999,
              y: 90,
              width: 320,
              height: 240,
              payload: {
                url: active.url,
                title: active.title || active.url,
                favicon: active.favicon || '',
                isBookmarked: Boolean(active.isBookmarked)
              }
            });
          });
        } else {
          window.gxAPI.triggerMenuAction(act);
        }
      });
    });

    document.getElementById('btnZoomIn').addEventListener('click', async () => {
      const pct = await window.gxAPI.setZoom('in');
      document.getElementById('zoomPct').textContent = `${pct}%`;
    });
    document.getElementById('btnZoomOut').addEventListener('click', async () => {
      const pct = await window.gxAPI.setZoom('out');
      document.getElementById('zoomPct').textContent = `${pct}%`;
    });
    document.getElementById('btnZoomReset').addEventListener('click', async () => {
      const pct = await window.gxAPI.setZoom('reset');
      document.getElementById('zoomPct').textContent = `${pct}%`;
    });
    document.getElementById('btnFs').addEventListener('click', () => {
      window.gxAPI.closePopover();
      window.gxAPI.toggleFullscreen();
    });

    // [TABS-W2] Latest active tab while the ⋮ menu is open — feeds the
    // bookmark bubble (gap 7.4) without a main-side round trip.
    let lastMenuActiveTab = null;
    window.gxAPI.onStateUpdate?.((state) => {
      if (state?.activeTab) lastMenuActiveTab = state.activeTab;
      if (activePopoverKind === 'menu' && state?.activeTab && typeof state.activeTab.zoomPercent === 'number') {
        const zoomEl = document.getElementById('zoomPct');
        if (zoomEl) zoomEl.textContent = `${state.activeTab.zoomPercent}%`;
      }
    });

    document.getElementById('btnShotArea').addEventListener('click', () => window.gxAPI.startAreaScreenshot());
    document.getElementById('btnShotFull').addEventListener('click', () => window.gxAPI.captureScreenshot());

    document.getElementById('btnOpenDlPage').addEventListener('click', () => {
      window.gxAPI.triggerMenuAction('downloads');
    });

    function formatPopBytes(bytes) {
      const n = Number(bytes) || 0;
      if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
      if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
      if (n >= 1024) return `${Math.round(n / 1024)} KB`;
      return `${n} B`;
    }

    function formatPopEta(sec) {
      const s = Math.max(0, Math.round(Number(sec) || 0));
      if (!s) return '';
      if (s < 60) return `${s}s left`;
      const m = Math.floor(s / 60);
      const r = s % 60;
      return `${m}m ${r}s left`;
    }

    function renderMiniDownloads(list) {
      const el = document.getElementById('popDlList');
      el.innerHTML = '';
      const recent = (list || []).slice(0, 6);
      if (!recent.length) {
        el.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:10px 4px;">No recent downloads.</div>';
        return;
      }
      for (const d of recent) {
        const isDone = d.state === 'completed';
        const isActive = d.state === 'progressing' || d.state === 'paused';
        const isPaused = d.state === 'paused' || Boolean(d.isPaused);
        const hasTotal = Number(d.totalBytes) > 0;
        const pct = hasTotal ? Math.min(100, Math.round((d.receivedBytes / d.totalBytes) * 100)) : isDone ? 100 : null;
        const statusLabel = pct !== null ? `${d.state} (${pct}%)` : `${d.state} (${Math.round((d.receivedBytes || 0) / 1024)} KB)`;
        const sizeStr = hasTotal
          ? `${formatPopBytes(d.receivedBytes)} / ${formatPopBytes(d.totalBytes)}`
          : formatPopBytes(d.receivedBytes);
        const speedStr = d.state === 'progressing' && d.speedBytesPerSec > 0 ? `${formatPopBytes(d.speedBytesPerSec)}/s` : '';
        const etaStr = d.state === 'progressing' ? formatPopEta(d.etaSeconds) : '';

        const leftMeta = isActive
          ? [pct !== null ? `${pct}%` : 'Downloading', sizeStr, speedStr].filter(Boolean).join(' · ')
          : isDone
            ? `Completed · ${sizeStr}`
            : `${d.state || 'Stopped'}`;
        const rightMeta = isPaused ? 'Paused' : etaStr;

        const card = document.createElement('div');
        card.className = isActive ? 'dl-mini-card active' : 'dl-mini-card';
        card.innerHTML = `
          <div class="dl-mini-top">
            <span class="dl-name" title="${escapeHtml(d.filename)}">${escapeHtml(d.filename)}</span>
            <span class="dl-mini-actions">
              ${isActive
            ? `<button class="mini-btn toggle-pause-btn">${isPaused ? 'Resume' : 'Pause'}</button>
                   <button class="mini-btn cancel-btn">✕</button>`
            : `<button class="mini-btn folder-btn" ${isDone && d.savePath ? '' : 'disabled'} title="Show in folder">📁</button>
                   <button class="mini-btn open-btn" ${isDone && d.savePath ? '' : 'disabled'}>Open</button>`
          }
            </span>
          </div>
          <div style="font-size:10.5px;color:var(--muted);">${escapeHtml(statusLabel)}</div>
          ${isActive
            ? `<div class="dl-mini-progress-track"><div class="dl-mini-progress-fill ${isPaused ? '' : (pct !== null ? 'flowing' : 'indeterminate')}" style="width:${pct !== null ? pct : 42}%;"></div></div>`
            : ''}
          <div class="dl-mini-meta">
            <span>${escapeHtml(leftMeta)}</span>
            <span>${escapeHtml(rightMeta)}</span>
          </div>
        `;
        const openBtn = card.querySelector('.open-btn');
        if (openBtn) {
          openBtn.addEventListener('click', () => {
            if (isDone && d.savePath) window.gxAPI.openDownloadItem(d.savePath);
          });
        }
        const folderBtn = card.querySelector('.folder-btn');
        if (folderBtn) {
          folderBtn.addEventListener('click', () => {
            if (isDone && d.savePath) window.gxAPI.showDownloadInFolder(d.savePath);
          });
        }
        const pauseBtn = card.querySelector('.toggle-pause-btn');
        if (pauseBtn) {
          pauseBtn.addEventListener('click', () => {
            if (isPaused) window.gxAPI.resumeDownload(d.id);
            else window.gxAPI.pauseDownload(d.id);
          });
        }
        const cancelBtn = card.querySelector('.cancel-btn');
        if (cancelBtn) {
          cancelBtn.addEventListener('click', () => {
            window.gxAPI.cancelDownload(d.id);
          });
        }
        el.appendChild(card);
      }
    }

    window.gxAPI.onDownloadsUpdate((list) => {
      if (
        activePopoverKind === 'downloads' &&
        !document.getElementById('view-downloads').classList.contains('hidden')
      ) {
        renderMiniDownloads(list);
        fitPopoverToView('downloads', 'view-downloads');
      }
    });

    document.getElementById('chkShieldSiteEnabled').addEventListener('change', async (e) => {
      if (!currentShieldOrigin) return;
      const seq = popoverOpenSeq;
      const siteInfo = await window.gxAPI.setAdblockSite(currentShieldOrigin, e.target.checked);
      if (seq !== popoverOpenSeq || activePopoverKind !== 'shield') return;
      const stats = await window.gxAPI.getAdblockStats();
      if (seq !== popoverOpenSeq || activePopoverKind !== 'shield') return;
      renderShieldPopover(siteInfo, stats);
      fitPopoverToView('shield', 'view-shield');
    });

    document.getElementById('chkShieldGlobalEnabled').addEventListener('change', async (e) => {
      const seq = popoverOpenSeq;
      const stats = await window.gxAPI.toggleAdblock(e.target.checked);
      if (seq !== popoverOpenSeq || activePopoverKind !== 'shield') return;
      const siteInfo = await window.gxAPI.getAdblockSite(currentShieldOrigin);
      if (seq !== popoverOpenSeq || activePopoverKind !== 'shield') return;
      renderShieldPopover(siteInfo, stats);
      fitPopoverToView('shield', 'view-shield');
    });

    document.getElementById('btnShieldReload').addEventListener('click', () => {
      if (!currentShieldOrigin) return;
      window.gxAPI.closePopover();
      window.gxAPI.reload();
    });

    document.getElementById('btnShieldSettings').addEventListener('click', () => {
      window.gxAPI.triggerMenuAction('settings');
    });

    // [FIXUP-1] Site-info bubble buttons (gaps 3.3/3.4).
    document.getElementById('btnSiteInfoClose').addEventListener('click', () => {
      window.gxAPI.closePopover();
    });

    document.getElementById('btnSiteInfoClearCookies').addEventListener('click', async () => {
      if (!currentSiteInfoOrigin) return;
      await window.gxAPI.clearSiteCookies(currentSiteInfoOrigin);
      refreshSiteInfoCookieCount(currentSiteInfoOrigin);
    });

    document.getElementById('btnSiteInfoSettings').addEventListener('click', () => {
      window.gxAPI.closePopover();
      window.gxAPI.createTab({ url: 'nextgx://privacy', active: true });
    });

    // [FIXUP-1] Zoom bubble buttons (gap 3.5). 'tabs:zoom' returns the new
    // percent, so the label stays in sync with the live zoom.
    const zoomBubbleValueEl = () => document.getElementById('zoomBubbleValue');
    document.getElementById('btnZoomBubbleOut').addEventListener('click', async () => {
      const pct = await window.gxAPI.setZoom('out');
      const el = zoomBubbleValueEl();
      if (el && typeof pct === 'number') el.textContent = `${pct}%`;
    });
    document.getElementById('btnZoomBubbleIn').addEventListener('click', async () => {
      const pct = await window.gxAPI.setZoom('in');
      const el = zoomBubbleValueEl();
      if (el && typeof pct === 'number') el.textContent = `${pct}%`;
    });
    document.getElementById('btnZoomBubbleReset').addEventListener('click', async () => {
      const pct = await window.gxAPI.setZoom('reset');
      const el = zoomBubbleValueEl();
      if (el && typeof pct === 'number') el.textContent = `${pct}%`;
    });

    window.gxAPI.onAdblockUpdate((stats) => {
      if (
        activePopoverKind === 'shield' &&
        !document.getElementById('view-shield').classList.contains('hidden')
      ) {
        renderShieldPopover(lastShieldSiteInfo, stats);
        fitPopoverToView('shield', 'view-shield');
      }
    });

    window.gxAPI.onBookmarksUpdate?.((list) => {
      const bmView = document.getElementById('view-bookmark-folder');
      if (
        activePopoverKind === 'bookmark-folder' &&
        bmView &&
        !bmView.classList.contains('hidden') &&
        currentBmFolderName
      ) {
        const items =
          currentBmFolderName === 'All Bookmarks'
            ? (list || []).filter(Boolean)
            : (list || []).filter(
              (b) => b && typeof b.folder === 'string' && b.folder.trim() === currentBmFolderName
            );
        if (!items.length) {
          window.gxAPI.closePopover();
        } else {
          renderBookmarkFolderItems(currentBmFolderName, items);
          fitPopoverToView('bookmark-folder', 'view-bookmark-folder');
        }
      }
    });
  

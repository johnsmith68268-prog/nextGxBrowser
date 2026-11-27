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
      window.gxAPI?.getSettings?.().then((s) => applyTheme(s?.theme)).catch(() => {});
      window.gxAPI?.onSettingsUpdate?.((s) => {
        if (s && s.theme) applyTheme(s.theme);
      });
    })();

    const bgImgDim = document.getElementById('bgImgDim');
    const bgImgClear = document.getElementById('bgImgClear');
    const cropPrompt = document.getElementById('cropPrompt');
    const box = document.getElementById('selectionBox');
    const sizeBadge = document.getElementById('sizeBadge');
    const snapActions = document.getElementById('snapActions');

    let rect = null; // { x, y, width, height }
    let dragMode = null; // 'create' | 'move' | handle name ('nw','n','ne','e','se','s','sw','w')
    let anchorX = 0;
    let anchorY = 0;
    let startRect = null;

    function resetSelection() {
      rect = null;
      dragMode = null;
      box.style.display = 'none';
      snapActions.style.display = 'none';
      cropPrompt.classList.remove('hidden');
      bgImgClear.style.clipPath = 'inset(100% 100% 100% 100%)';
    }

    function renderRect({ showActions = false } = {}) {
      if (!rect || rect.width < 2 || rect.height < 2) {
        box.style.display = 'none';
        snapActions.style.display = 'none';
        bgImgClear.style.clipPath = 'inset(100% 100% 100% 100%)';
        return;
      }

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const x = Math.max(0, Math.min(vw - 2, Math.round(rect.x)));
      const y = Math.max(0, Math.min(vh - 2, Math.round(rect.y)));
      const w = Math.max(2, Math.min(vw - x, Math.round(rect.width)));
      const h = Math.max(2, Math.min(vh - y, Math.round(rect.height)));

      cropPrompt.classList.add('hidden');
      box.style.display = 'block';
      box.style.left = x + 'px';
      box.style.top = y + 'px';
      box.style.width = w + 'px';
      box.style.height = h + 'px';
      sizeBadge.textContent = `${w} × ${h}`;

      const rightInset = Math.max(0, vw - (x + w));
      const bottomInset = Math.max(0, vh - (y + h));
      bgImgClear.style.clipPath = `inset(${y}px ${rightInset}px ${bottomInset}px ${x}px)`;

      if (showActions && w >= 8 && h >= 8) {
        snapActions.style.display = 'flex';
        const actW = snapActions.offsetWidth || 268;
        const actH = snapActions.offsetHeight || 36;
        const left = Math.max(10, Math.min(vw - actW - 10, x + w - actW));
        const belowY = y + h + 10;
        const top = belowY + actH <= vh - 10 ? belowY : Math.max(58, y - actH - 10);
        snapActions.style.left = Math.round(left) + 'px';
        snapActions.style.top = Math.round(top) + 'px';
      } else {
        snapActions.style.display = 'none';
      }
    }

    function getScaledPayload(mode) {
      if (!rect || rect.width < 4 || rect.height < 4) return null;
      const scaleX = bgImgDim.naturalWidth ? bgImgDim.naturalWidth / window.innerWidth : 1;
      const scaleY = bgImgDim.naturalHeight ? bgImgDim.naturalHeight / window.innerHeight : 1;
      return {
        mode,
        x: rect.x * scaleX,
        y: rect.y * scaleY,
        width: rect.width * scaleX,
        height: rect.height * scaleY
      };
    }

    window.gxAPI.onScreenshotCaptured(({ dataUrl }) => {
      if (dataUrl) {
        bgImgDim.src = dataUrl;
        bgImgClear.src = dataUrl;
        resetSelection();
      }
    });

    window.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('#snapTopbar, #snapActions')) return;

      const handleEl = e.target.closest('.handle');
      if (handleEl && rect) {
        dragMode = handleEl.dataset.handle;
        anchorX = e.clientX;
        anchorY = e.clientY;
        startRect = { ...rect };
        renderRect({ showActions: false });
        return;
      }

      if (e.target === box && rect) {
        dragMode = 'move';
        anchorX = e.clientX;
        anchorY = e.clientY;
        startRect = { ...rect };
        renderRect({ showActions: false });
        return;
      }

      dragMode = 'create';
      anchorX = e.clientX;
      anchorY = e.clientY;
      rect = { x: anchorX, y: anchorY, width: 0, height: 0 };
      renderRect({ showActions: false });
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragMode) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const cx = Math.max(0, Math.min(vw, e.clientX));
      const cy = Math.max(0, Math.min(vh, e.clientY));

      if (dragMode === 'create') {
        rect = {
          x: Math.min(anchorX, cx),
          y: Math.min(anchorY, cy),
          width: Math.abs(cx - anchorX),
          height: Math.abs(cy - anchorY)
        };
      } else if (dragMode === 'move' && startRect) {
        const dx = cx - anchorX;
        const dy = cy - anchorY;
        rect = {
          x: Math.max(0, Math.min(vw - startRect.width, startRect.x + dx)),
          y: Math.max(0, Math.min(vh - startRect.height, startRect.y + dy)),
          width: startRect.width,
          height: startRect.height
        };
      } else if (startRect) {
        let left = startRect.x;
        let top = startRect.y;
        let right = startRect.x + startRect.width;
        let bottom = startRect.y + startRect.height;

        if (dragMode.includes('w')) left = Math.min(right - 12, cx);
        if (dragMode.includes('e')) right = Math.max(left + 12, cx);
        if (dragMode.includes('n')) top = Math.min(bottom - 12, cy);
        if (dragMode.includes('s')) bottom = Math.max(top + 12, cy);

        rect = { x: left, y: top, width: right - left, height: bottom - top };
      }

      renderRect({ showActions: false });
    });

    window.addEventListener('mouseup', () => {
      if (!dragMode) return;
      dragMode = null;
      startRect = null;
      if (!rect || rect.width < 8 || rect.height < 8) {
        resetSelection();
        return;
      }
      renderRect({ showActions: true });
    });

    document.getElementById('btnSnapCancel').addEventListener('click', () => {
      window.gxAPI.cancelAreaScreenshot();
    });

    document.getElementById('btnSnapCopy').addEventListener('click', () => {
      const payload = getScaledPayload('copy');
      if (payload) window.gxAPI.finishAreaScreenshot(payload);
    });

    document.getElementById('btnSnapCapture').addEventListener('click', () => {
      const payload = getScaledPayload('save');
      if (payload) window.gxAPI.finishAreaScreenshot(payload);
    });

    document.getElementById('btnCaptureVisible').addEventListener('click', () => {
      window.gxAPI.finishAreaScreenshot({ mode: 'visible' });
    });

    document.getElementById('btnCaptureFull').addEventListener('click', () => {
      window.gxAPI.finishAreaScreenshot({ mode: 'full' });
    });

    document.getElementById('btnSavePdf').addEventListener('click', () => {
      window.gxAPI.savePageAsPdf?.();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        window.gxAPI.cancelAreaScreenshot();
      } else if (e.key === 'Enter' && rect && rect.width >= 8 && rect.height >= 8) {
        const payload = getScaledPayload('save');
        if (payload) window.gxAPI.finishAreaScreenshot(payload);
      }
    });
  

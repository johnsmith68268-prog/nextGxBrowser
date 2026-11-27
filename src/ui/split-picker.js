    (function () {
      const params = new URLSearchParams(window.location.search);
      const theme = params.get('theme');
      if (theme) document.documentElement.setAttribute('data-theme', theme);

      const listEl = document.getElementById('pickerTabList');
      const countEl = document.getElementById('pickerCount');
      const searchInput = document.getElementById('pickerSearchInput');
      const searchForm = document.getElementById('pickerSearchForm');
      let allOpenTabs = [];

      const GLOBE_SVG =
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" style="opacity:0.7;"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8"/></svg>';

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

      function cleanDisplayUrl(url) {
        if (!url) return '';
        if (url === 'nextgx://newtab') return 'Start Page';
        return String(url).replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
      }

      function renderTabs(filterText = '') {
        const q = String(filterText || '').trim().toLowerCase();
        const filtered = q
          ? allOpenTabs.filter((t) =>
              String(t.title || '').toLowerCase().includes(q) ||
              String(t.url || '').toLowerCase().includes(q)
            )
          : allOpenTabs;

        countEl.textContent = `${filtered.length} ${filtered.length === 1 ? 'tab' : 'tabs'}`;
        listEl.innerHTML = '';

        if (filtered.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'picker-empty';
          empty.textContent = q
            ? `No open tabs match "${filterText}". Press Enter to search or navigate to "${filterText}", or click "Open New Tab" below.`
            : 'No other open tabs in this workspace yet. Type a URL above or click "Open New Tab" below.';
          listEl.appendChild(empty);
          return;
        }

        for (const t of filtered) {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'tab-row';

          const favWrap = document.createElement('span');
          favWrap.className = 'tab-fav-wrap';
          const safeFav = sanitizeUiFaviconUrl(t.favicon);
          if (safeFav) {
            const img = document.createElement('img');
            img.className = 'tab-fav';
            img.alt = '';
            img.src = safeFav;
            img.addEventListener('error', () => { favWrap.innerHTML = GLOBE_SVG; });
            favWrap.appendChild(img);
          } else {
            favWrap.innerHTML = GLOBE_SVG;
          }

          const info = document.createElement('div');
          info.className = 'tab-info';
          const titleEl = document.createElement('div');
          titleEl.className = 'tab-title';
          titleEl.textContent = t.title || cleanDisplayUrl(t.url) || 'Tab';
          const urlEl = document.createElement('div');
          urlEl.className = 'tab-url';
          urlEl.textContent = cleanDisplayUrl(t.url);
          info.appendChild(titleEl);
          info.appendChild(urlEl);

          const pill = document.createElement('span');
          pill.className = 'tab-open-pill';
          pill.textContent = 'Open here';

          row.appendChild(favWrap);
          row.appendChild(info);
          row.appendChild(pill);

          row.addEventListener('click', () => {
            window.gxSplitPickerAPI?.pickTab(t.id);
          });
          listEl.appendChild(row);
        }
      }

      async function loadOpenTabs() {
        if (!window.gxSplitPickerAPI?.getSplitPickerData) return;
        try {
          const data = await window.gxSplitPickerAPI.getSplitPickerData();
          if (data?.theme) {
            document.documentElement.setAttribute('data-theme', data.theme);
          }
          allOpenTabs = Array.isArray(data?.openTabs) ? data.openTabs : [];
          renderTabs(searchInput.value);
        } catch (_) {}
      }

      searchInput.addEventListener('input', () => renderTabs(searchInput.value));
      searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const val = searchInput.value.trim();
        if (!val) return;
        const q = val.toLowerCase();
        const filtered = allOpenTabs.filter(
          (t) =>
            String(t.title || '').toLowerCase().includes(q) ||
            String(t.url || '').toLowerCase().includes(q)
        );
        if (filtered.length > 0 && !/^(?:https?:\/\/|nextgx:\/\/)/i.test(val)) {
          window.gxSplitPickerAPI?.pickTab(filtered[0].id);
        } else {
          window.gxSplitPickerAPI?.navigateUrl(val);
        }
      });

      document.getElementById('btnOpenNewTab').addEventListener('click', () => {
        window.gxSplitPickerAPI?.openNewTab();
      });
      document.getElementById('btnCancelSplit').addEventListener('click', () => {
        window.gxSplitPickerAPI?.cancelSplit();
      });
      document.getElementById('btnSwapSide').addEventListener('click', () => {
        window.gxSplitPickerAPI?.swapSplitPanes();
      });

      window.addEventListener('focus', loadOpenTabs);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) loadOpenTabs();
      });
      loadOpenTabs();
    })();
  

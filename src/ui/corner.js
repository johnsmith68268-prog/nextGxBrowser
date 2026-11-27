    const statusPill = document.getElementById('cornerStatusPill');
    const statusText = document.getElementById('cornerStatusText');
    const btnRefresh = document.getElementById('btnCornerRefresh');
    const btnRefreshLabel = document.getElementById('btnCornerRefreshLabel');
    const offlineBanner = document.getElementById('cornerOfflineBanner');
    const bannerTitle = document.getElementById('cornerBannerTitle');
    const bannerSub = document.getElementById('cornerBannerSub');
    const btnRetry = document.getElementById('btnCornerRetry');
    const searchInput = document.getElementById('cornerSearchInput');

    const newsSection = document.getElementById('section-news');
    const releasesSection = document.getElementById('section-releases');
    const dealsSection = document.getElementById('section-deals');

    const newsGrid = document.getElementById('newsGrid');
    const releasesGrid = document.getElementById('releasesGrid');
    const dealsGrid = document.getElementById('dealsGrid');
    const storefrontsStrip = document.getElementById('storefrontsStrip');

    const newsCountEl = document.getElementById('newsCount');
    const releasesCountEl = document.getElementById('releasesCount');
    const dealsCountEl = document.getElementById('dealsCount');
    const newsMetaEl = document.getElementById('newsMeta');
    const releasesMetaEl = document.getElementById('releasesMeta');
    const dealsMetaEl = document.getElementById('dealsMeta');
    const updatedInfoEl = document.getElementById('cornerUpdatedInfo');
    const feedPillsEl = document.getElementById('cornerFeedPills');

    let latestPayload = null;
    let activeFilter = 'all';
    let searchQuery = '';

    function escapeHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function safeExternalUrl(rawUrl) {
      if (typeof rawUrl !== 'string') return '';
      const trimmed = rawUrl.trim();
      if (!trimmed) return '';
      try {
        const u = new URL(trimmed);
        if (u.protocol === 'http:' || u.protocol === 'https:') {
          return u.toString();
        }
      } catch (_) {}
      return '';
    }

    function formatItemDate(item) {
      const ts = Number(item?.publishedAt);
      if (Number.isFinite(ts) && ts > 0) {
        const diffMs = Date.now() - ts;
        if (diffMs >= 0 && diffMs < 60 * 1000) return 'Just now';
        if (diffMs >= 0 && diffMs < 60 * 60 * 1000) {
          return `${Math.max(1, Math.floor(diffMs / 60000))}m ago`;
        }
        if (diffMs >= 0 && diffMs < 24 * 60 * 60 * 1000) {
          return `${Math.floor(diffMs / 3600000)}h ago`;
        }
        try {
          return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        } catch (_) {}
      }
      return item?.dateLabel || (item?.curated ? 'Curated' : '');
    }

    function formatFullTimestamp(ts) {
      const n = Number(ts);
      if (!Number.isFinite(n) || n <= 0) return '';
      try {
        return new Date(n).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      } catch (_) {
        return '';
      }
    }

    function openExternalLink(rawUrl) {
      const safe = safeExternalUrl(rawUrl);
      if (!safe) return;
      window.gxSounds?.playTabOpen();
      if (window.gxCornerAPI && typeof window.gxCornerAPI.openLink === 'function') {
        window.gxCornerAPI.openLink(safe).catch(() => {});
      } else {
        window.open(safe, '_blank', 'noopener,noreferrer');
      }
    }

    function getFallbackIconSvg(section) {
      if (section === 'releases') {
        return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
      }
      if (section === 'deals') {
        return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`;
      }
      return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4M8 10v4"/><circle cx="15.5" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="13" r="1" fill="currentColor" stroke="none"/></svg>`;
    }

    function buildThumbFallbackEl(item, section) {
      const wrap = document.createElement('div');
      wrap.className = 'thumb-fallback';
      wrap.innerHTML = `
        <div class="thumb-fallback-ring" aria-hidden="true">${getFallbackIconSvg(section)}</div>
        <span class="thumb-fallback-label">${escapeHtml(item.source || 'GX Corner')}</span>
      `;
      return wrap;
    }

    function buildCardElement(item, section) {
      const safeUrl = safeExternalUrl(item.url);
      const card = document.createElement('a');
      card.className = 'corner-card';
      card.href = safeUrl || '#';
      card.target = '_blank';
      card.rel = 'noopener noreferrer';
      card.dataset.section = section;
      if (item.curated) card.dataset.curated = 'true';

      card.addEventListener('click', (e) => {
        e.preventDefault();
        openExternalLink(safeUrl);
      });

      const thumb = document.createElement('div');
      thumb.className = section === 'news' ? 'card-thumb' : 'card-thumb short';

      const safeThumb = safeExternalUrl(item.thumbnail);
      if (safeThumb) {
        const img = document.createElement('img');
        img.src = safeThumb;
        img.alt = item.title || 'Article thumbnail';
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        img.addEventListener('error', () => {
          img.remove();
          thumb.insertBefore(buildThumbFallbackEl(item, section), thumb.firstChild);
        });
        thumb.appendChild(img);
      } else {
        thumb.appendChild(buildThumbFallbackEl(item, section));
      }

      const badges = document.createElement('div');
      badges.className = 'card-overlay-badges';
      let leftBadgeHtml = '';
      if (item.tag) {
        const upperTag = String(item.tag).toUpperCase();
        const tagCls = upperTag.includes('FREE')
          ? 'is-free'
          : upperTag.includes('DEAL') || upperTag.includes('BUNDLE')
          ? 'is-deal'
          : '';
        leftBadgeHtml = `<span class="card-badge ${tagCls}">${escapeHtml(item.tag)}</span>`;
      } else if (section === 'releases') {
        leftBadgeHtml = `<span class="card-badge">${escapeHtml(item.dateLabel || 'Release')}</span>`;
      } else {
        leftBadgeHtml = '<span></span>';
      }
      const rightBadgeHtml = item.curated
        ? `<span class="card-badge is-curated">Curated</span>`
        : `<span class="card-badge">Live RSS</span>`;
      badges.innerHTML = `${leftBadgeHtml}${rightBadgeHtml}`;
      thumb.appendChild(badges);
      card.appendChild(thumb);

      const body = document.createElement('div');
      body.className = 'card-body';

      const dateText = formatItemDate(item);
      const fullDateTitle = formatFullTimestamp(item.publishedAt);
      const platforms = Array.isArray(item.platforms) ? item.platforms : [];
      const platformsHtml = platforms.length
        ? `<div class="platform-list">${platforms
            .map((p) => `<span class="platform-chip">${escapeHtml(p)}</span>`)
            .join('')}</div>`
        : '';

      body.innerHTML = `
        <div class="card-meta">
          <span class="card-source">${escapeHtml(item.source || 'Gaming Feed')}</span>
          <span class="card-date" title="${escapeHtml(fullDateTitle || dateText)}">${escapeHtml(dateText)}</span>
        </div>
        <h3 class="card-title">${escapeHtml(item.title)}</h3>
        ${item.summary ? `<p class="card-summary">${escapeHtml(item.summary)}</p>` : ''}
        <div class="card-footer">
          ${platformsHtml}
          <span class="card-open-hint">Open in new tab ↗</span>
        </div>
      `;
      card.appendChild(body);
      return card;
    }

    function matchesSearch(item) {
      if (!searchQuery) return true;
      const hay = [
        item?.title,
        item?.summary,
        item?.source,
        item?.tag,
        item?.dateLabel,
        Array.isArray(item?.platforms) ? item.platforms.join(' ') : ''
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(searchQuery);
    }

    function renderGrid(container, items, section) {
      container.innerHTML = '';
      const filtered = (Array.isArray(items) ? items : []).filter(matchesSearch);
      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'filter-empty';
        empty.innerHTML = `
          <span>No matching items for "${escapeHtml(searchQuery)}".</span>
          <button type="button" class="btn" data-clear-search="1">Clear filter</button>
        `;
        const clearBtn = empty.querySelector('[data-clear-search]');
        if (clearBtn) {
          clearBtn.addEventListener('click', () => {
            searchQuery = '';
            if (searchInput) searchInput.value = '';
            renderPayload(latestPayload);
          });
        }
        container.appendChild(empty);
        return 0;
      }
      for (const item of filtered) {
        container.appendChild(buildCardElement(item, section));
      }
      return filtered.length;
    }

    function renderStorefronts(storefronts) {
      storefrontsStrip.innerHTML = '';
      const list = (Array.isArray(storefronts) ? storefronts : []).filter((sf) => {
        if (!searchQuery) return true;
        return `${sf.name} ${sf.tagline} ${sf.badge}`.toLowerCase().includes(searchQuery);
      });
      storefrontsStrip.classList.toggle('hidden', list.length === 0);
      for (const sf of list) {
        const safeUrl = safeExternalUrl(sf.url);
        if (!safeUrl) continue;
        const a = document.createElement('a');
        a.className = 'storefront-card';
        a.href = safeUrl;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.innerHTML = `
          <div class="storefront-info">
            <span class="storefront-name">${escapeHtml(sf.name)}</span>
            <span class="storefront-tagline">${escapeHtml(sf.tagline)}</span>
          </div>
          <span class="storefront-badge">${escapeHtml(sf.badge || 'STORE')}</span>
        `;
        a.addEventListener('click', (e) => {
          e.preventDefault();
          openExternalLink(safeUrl);
        });
        storefrontsStrip.appendChild(a);
      }
    }

    function renderStatus(payload) {
      const mode = payload?.mode || 'offline';
      const isRefreshing = Boolean(payload?.isRefreshing);
      const isOfflineFallback = Boolean(payload?.isOfflineFallback);
      const lastRefreshFailed = Boolean(payload?.lastRefreshFailed);

      statusPill.classList.remove('is-live', 'is-offline', 'is-refreshing');
      if (isRefreshing) {
        statusPill.classList.add('is-refreshing');
        statusText.textContent = 'Refreshing RSS feeds...';
      } else if (mode === 'live' || mode === 'cached') {
        statusPill.classList.add('is-live');
        const tsLabel = formatFullTimestamp(payload.fetchedAt);
        statusText.textContent = tsLabel ? `Updated ${tsLabel}` : 'Live RSS active';
      } else {
        statusPill.classList.add('is-offline');
        statusText.textContent = mode === 'offline-cached' ? 'Offline (cached)' : 'Offline — curated picks';
      }

      btnRefresh.disabled = isRefreshing;
      btnRefresh.classList.toggle('is-spinning', isRefreshing);
      btnRefreshLabel.textContent = isRefreshing ? 'Refreshing...' : (isOfflineFallback || lastRefreshFailed ? 'Retry' : 'Refresh');

      if (btnRetry) {
        btnRetry.disabled = isRefreshing;
        btnRetry.textContent = isRefreshing ? 'Retrying...' : 'Retry';
      }

      const showBanner = !isRefreshing && (isOfflineFallback || lastRefreshFailed || mode === 'offline' || mode === 'offline-cached');
      offlineBanner.classList.toggle('hidden', !showBanner);
      if (showBanner) {
        bannerTitle.textContent = payload.statusMessage || 'Offline — showing curated picks';
        if (mode === 'offline-cached') {
          const tsLabel = formatFullTimestamp(payload.fetchedAt);
          bannerSub.textContent = tsLabel
            ? `Couldn't reach live RSS feeds right now. Displaying your cached headlines from ${tsLabel}.`
            : "Couldn't reach live RSS feeds right now. Displaying your cached headlines.";
        } else {
          bannerSub.textContent =
            "Live gaming RSS feeds couldn't be reached right now. Showing curated gaming hubs, release calendar picks, and storefronts instead.";
        }
      }

      const updatedTs = formatFullTimestamp(payload.fetchedAt);
      updatedInfoEl.textContent = updatedTs
        ? `Last live RSS update: ${updatedTs} • Auto-refreshes every 30 min • Links open in new tabs`
        : 'Curated offline picks active • Auto-refreshes when online • Links open in new tabs';

      feedPillsEl.innerHTML = '';
      const statuses = Array.isArray(payload.feedStatus) ? payload.feedStatus : [];
      for (const fs of statuses) {
        const pill = document.createElement('span');
        pill.className = `feed-pill ${fs.ok ? 'ok' : 'err'}`;
        pill.textContent = fs.ok ? `${fs.name} (${fs.count})` : `${fs.name} (offline)`;
        pill.title = fs.ok ? `Loaded ${fs.count} items from ${fs.name}` : fs.error || 'Feed unreachable';
        feedPillsEl.appendChild(pill);
      }
    }

    function applySectionFilterVisibility() {
      newsSection.classList.toggle('hidden', activeFilter !== 'all' && activeFilter !== 'news');
      releasesSection.classList.toggle('hidden', activeFilter !== 'all' && activeFilter !== 'releases');
      dealsSection.classList.toggle('hidden', activeFilter !== 'all' && activeFilter !== 'deals');
    }

    function renderPayload(payload) {
      if (!payload || typeof payload !== 'object') return;
      latestPayload = payload;
      renderStatus(payload);

      const sections = payload.sections || { news: [], releases: [], deals: [] };
      const shownNews = renderGrid(newsGrid, sections.news, 'news');
      const shownReleases = renderGrid(releasesGrid, sections.releases, 'releases');
      renderStorefronts(payload.storefronts);
      const shownDeals = renderGrid(dealsGrid, sections.deals, 'deals');

      newsCountEl.textContent = String(shownNews);
      releasesCountEl.textContent = String(shownReleases);
      dealsCountEl.textContent = String(shownDeals);

      const hasLiveNews = Array.isArray(sections.news) && sections.news.some((i) => i && !i.curated);
      newsMetaEl.textContent = hasLiveNews
        ? 'Live gaming RSS headlines'
        : 'Curated gaming news hubs (offline fallback)';
      const hasLiveReleases = Array.isArray(sections.releases) && sections.releases.some((i) => i && !i.curated);
      releasesMetaEl.textContent = hasLiveReleases
        ? 'Live launch coverage + curated release calendar'
        : 'Curated release calendar picks';
      const hasLiveDeals = Array.isArray(sections.deals) && sections.deals.some((i) => i && !i.curated);
      dealsMetaEl.textContent = hasLiveDeals
        ? 'Live deals + storefront freebies'
        : 'Storefronts & curated deals / free games';

      applySectionFilterVisibility();
    }

    async function triggerRefresh() {
      if (!window.gxCornerAPI || typeof window.gxCornerAPI.refresh !== 'function') return;
      window.gxSounds?.playClick();
      try {
        const updated = await window.gxCornerAPI.refresh();
        if (updated) renderPayload(updated);
      } catch (_) {}
    }

    btnRefresh.addEventListener('click', triggerRefresh);
    btnRetry.addEventListener('click', triggerRefresh);

    document.querySelectorAll('#sectionFilterTabs .filter-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.gxSounds?.playClick();
        activeFilter = btn.dataset.filter || 'all';
        document.querySelectorAll('#sectionFilterTabs .filter-tab-btn').forEach((b) => {
          b.classList.toggle('active', b === btn);
        });
        applySectionFilterVisibility();
      });
    });

    searchInput.addEventListener('input', (e) => {
      searchQuery = (e.target.value || '').trim().toLowerCase();
      if (latestPayload) renderPayload(latestPayload);
    });

    function applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme || 'gx-violet');
    }

    function syncSoundsConfig(s) {
      if (!s || typeof s !== 'object') return;
      window.gxSounds?.setConfig({
        enabled: s.uiSoundsEnabled !== false,
        volume: typeof s.uiSoundsVolume === 'number' ? s.uiSoundsVolume : 0.35
      });
    }

    async function init() {
      const params = new URLSearchParams(window.location.search);
      if (params.get('incognito') === '1') {
        document.documentElement.setAttribute('data-incognito', 'true');
      }
      const initialTheme = params.get('theme');
      if (initialTheme) {
        applyTheme(initialTheme);
      }

      if (window.gxCornerAPI?.onSettingsUpdate) {
        window.gxCornerAPI.onSettingsUpdate((s) => {
          if (s && s.theme) applyTheme(s.theme);
          syncSoundsConfig(s);
        });
      }

      if (window.gxCornerAPI?.onUpdate) {
        window.gxCornerAPI.onUpdate((data) => {
          renderPayload(data);
        });
      }

      if (window.gxCornerAPI?.getSettings) {
        window.gxCornerAPI
          .getSettings()
          .then((s) => {
            if (s && s.theme) applyTheme(s.theme);
            syncSoundsConfig(s);
          })
          .catch(() => {});
      }

      if (window.gxCornerAPI?.getData) {
        try {
          const initialData = await window.gxCornerAPI.getData();
          renderPayload(initialData);
        } catch (_) {
          statusText.textContent = 'Unable to load hub';
        }
      }
    }

    init();
  

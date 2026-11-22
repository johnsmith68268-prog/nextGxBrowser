const mainContainer = document.getElementById('mainContainer');
const pageHeaderTitle = document.getElementById('pageHeaderTitle');
const globalSearchInput = document.getElementById('globalSearchInput');
const topRightActions = document.getElementById('topRightActions');

let currentPage = 'history';
let searchQuery = '';
let dlFilterCat = 'all';
let renderSeq = 0;
let lastHistoryRenderKey = '';
let lastDownloadsRenderKey = '';
let lastBookmarksRenderKey = '';
let lastCookiesRenderKey = '';
let lastPrivacyRenderKey = '';
let pendingSettingsScrollTarget = '';
let settingsCookies = [];
let cookieRefreshSeq = 0;

const SVG_GLOBE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-secondary);flex-shrink:0;"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8"/></svg>`;
const SVG_DOWNLOAD = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
const SVG_STAR = `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" style="color:var(--accent-bright);flex-shrink:0;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
const SVG_FOLDER = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent-bright);flex-shrink:0;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
const SVG_SHIELD = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
const SVG_MUSIC = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
const SVG_PUZZLE = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4c-1.1 0-2 .9-2 2v3.8h1.5c1.5 0 2.7 1.2 2.7 2.7S5 16.2 3.5 16.2H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.5 1.2-2.7 2.7-2.7s2.7 1.2 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5a2.5 2.5 0 0 0 0-5z"/></svg>`;

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function switchPage(page) {
  currentPage = page;
  window.location.hash = page;
  lastHistoryRenderKey = '';
  lastDownloadsRenderKey = '';
  lastBookmarksRenderKey = '';
  lastCookiesRenderKey = '';
  lastPrivacyRenderKey = '';
  if (page !== 'bookmarks') {
    editingBookmarkId = null;
    editingBookmarkError = '';
    renamingFolderName = null;
    renamingFolderError = '';
    addingBookmarkError = '';
    bookmarksIoBanner = null;
  }
  if (page !== 'passwords') {
    passwordsIoBanner = null;
    passwordsExportConfirmOpen = false;
    editingPasswordId = null;
    editingPasswordError = '';
    revealedPasswordIds.clear();
    pwGenState.error = '';
    pwGenState.feedback = '';
  }
  if (page !== 'settings') {
    settingsProfileCreateOpen = false;
    settingsProfileRenamingId = null;
    settingsProfileDeletingId = null;
    settingsProfileError = '';
  }

  document.querySelectorAll('.nav-link').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  const titles = {
    history: 'Browsing History',
    downloads: 'Pro Download Manager',
    bookmarks: 'Bookmarks',
    passwords: 'Passwords & Autofill',
    privacy: 'Privacy & Security',
    extensions: 'Extensions',
    settings: 'nextGx Settings'
  };
  pageHeaderTitle.textContent = titles[page] || 'Settings';
  document.title = titles[page] ? `${titles[page]} — nextGx` : 'nextGx System Settings & Manager';
  globalSearchInput.placeholder = `Search ${titles[page] || ''}...`;

  renderCurrentPage();
}

document.querySelectorAll('.nav-link').forEach((btn) => {
  btn.addEventListener('click', () => switchPage(btn.dataset.page));
});

globalSearchInput.addEventListener('input', (e) => {
  searchQuery = e.target.value.trim().toLowerCase();
  renderCurrentPage();
});

async function renderCurrentPage() {
  if (!window.gxChromePagesAPI) return;
  topRightActions.innerHTML = '';

  if (currentPage === 'history') await renderHistoryPage({ force: true });
  else if (currentPage === 'downloads') await renderDownloadsPage({ force: true });
  else if (currentPage === 'bookmarks') await renderBookmarksPage({ force: true });
  else if (currentPage === 'passwords') await renderPasswordsPage();
  else if (currentPage === 'privacy') await renderPrivacyPage({ force: true });
  else if (currentPage === 'extensions') await renderExtensionsPage();
  else if (currentPage === 'settings') await renderSettingsPage();
}

// 1. HISTORY (Recently Closed + Today / Yesterday / Older Grouping + Visit Counts + Favicons + Time Range Clear)
let historyVisibleLimit = 100;
let lastHistorySearchKey = '';

async function renderHistoryPage({ force = true } = {}) {
  const seq = ++renderSeq;
  const [list, closedTabs] = await Promise.all([
    window.gxChromePagesAPI.getHistory(),
    window.gxChromePagesAPI.getClosedTabs ? window.gxChromePagesAPI.getClosedTabs() : Promise.resolve([])
  ]);
  if (seq !== renderSeq || currentPage !== 'history') return;
  if (searchQuery !== lastHistorySearchKey) {
    lastHistorySearchKey = searchQuery;
    historyVisibleLimit = 100;
  }

  const renderKey = JSON.stringify({
    day: new Date().toDateString(),
    q: searchQuery,
    limit: historyVisibleLimit,
    closed: closedTabs || [],
    history: list || []
  });
  if (!force && renderKey === lastHistoryRenderKey) return;
  lastHistoryRenderKey = renderKey;
  const prevScrollY = force ? 0 : window.scrollY;

  topRightActions.innerHTML = `
    <div class="nx-segmented" id="histClearRange">
      <button class="seg-btn" data-range="hour">Clear 1h</button>
      <button class="seg-btn" data-range="day">Clear 24h</button>
      <button class="seg-btn" data-range="week">Clear 7d</button>
    </div>
    <button class="btn danger" id="btnClearAllHistory">Clear All</button>
  `;

  topRightActions.querySelectorAll('[data-range]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await window.gxChromePagesAPI.clearHistory(btn.dataset.range);
      renderHistoryPage();
    });
  });

  document.getElementById('btnClearAllHistory').addEventListener('click', async () => {
    await window.gxChromePagesAPI.clearHistory('all');
    renderHistoryPage();
  });

  const filteredClosed = (closedTabs || []).filter(
    (t) =>
      !searchQuery ||
      (t.title && t.title.toLowerCase().includes(searchQuery)) ||
      (t.url && t.url.toLowerCase().includes(searchQuery))
  );

  let closedRowsHtml = '';
  for (const item of filteredClosed) {
    const timeStr = item.closedAt
      ? new Date(item.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';
    const favHtml = item.favicon
      ? `<img src="${escapeHtml(item.favicon)}" width="16" height="16" style="border-radius:3px;flex-shrink:0;" onerror="this.style.display='none'" />`
      : SVG_GLOBE;
    closedRowsHtml += `
      <div class="card-row closed-tab-row" data-id="${escapeHtml(item.id)}" data-url="${escapeHtml(item.url)}">
        <span style="color:var(--text-secondary);font-size:12px;min-width:65px;">${escapeHtml(timeStr)}</span>
        ${favHtml}
        <div class="row-info">
          <div class="row-title reopen-closed-link" data-id="${escapeHtml(item.id)}" data-url="${escapeHtml(item.url)}">${escapeHtml(item.title)}</div>
          <div class="row-sub">${escapeHtml(item.url)}</div>
        </div>
        <button class="btn primary reopen-closed-btn" data-id="${escapeHtml(item.id)}" data-url="${escapeHtml(item.url)}">Reopen</button>
      </div>
    `;
  }

  const closedSectionHtml = `
    <div class="section-card">
      <div class="card-header">
        <h2 class="nx-heading">Recently Closed (${filteredClosed.length})</h2>
        ${
          (closedTabs || []).length > 0
            ? `<button class="btn danger" id="btnClearClosedTabs">Clear All</button>`
            : ''
        }
      </div>
      ${closedRowsHtml || `<div class="empty-state" style="padding:22px;">No recently closed tabs.</div>`}
    </div>
  `;

  const filtered = (list || []).filter(
    (h) =>
      !searchQuery ||
      (h.title && h.title.toLowerCase().includes(searchQuery)) ||
      (h.url && h.url.toLowerCase().includes(searchQuery))
  );

  let historyHtml = '';
  if (!filtered.length) {
    historyHtml = `<div class="section-card"><div class="empty-state">Your browsing history appears here.</div></div>`;
  } else {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayMs = startOfToday.getTime();
    const yesterdayMs = todayMs - 24 * 3600 * 1000;

    const visibleItems = filtered.slice(0, historyVisibleLimit);
    const remainingCount = Math.max(0, filtered.length - visibleItems.length);
    const groups = { Today: [], Yesterday: [], Older: [] };
    for (const item of visibleItems) {
      const t = item.visitedAt || 0;
      if (t >= todayMs) groups.Today.push(item);
      else if (t >= yesterdayMs) groups.Yesterday.push(item);
      else groups.Older.push(item);
    }

    for (const [label, items] of Object.entries(groups)) {
      if (!items.length) continue;
      let rowsHtml = '';
      for (const item of items) {
        const timeStr = new Date(item.visitedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const favHtml = item.favicon
          ? `<img src="${escapeHtml(item.favicon)}" width="16" height="16" style="border-radius:3px;flex-shrink:0;" onerror="this.style.display='none'" />`
          : SVG_GLOBE;
        const visitCount = Math.max(1, Number(item.visitCount) || 1);
        const visitLabel = `${visitCount} ${visitCount === 1 ? 'visit' : 'visits'}`;
        rowsHtml += `
          <div class="card-row history-item-row" data-id="${escapeHtml(item.id)}">
            <span style="color:var(--text-secondary);font-size:12px;min-width:65px;">${escapeHtml(timeStr)}</span>
            ${favHtml}
            <div class="row-info">
              <div class="row-title open-link" data-url="${escapeHtml(item.url)}">${escapeHtml(item.title)}</div>
              <div class="row-sub">${escapeHtml(item.url)}</div>
            </div>
            <span class="visit-count-badge" style="font-size:11.5px;color:var(--text-secondary);background:var(--bg-input);border:1px solid var(--border);padding:3px 9px;border-radius:999px;flex-shrink:0;">${escapeHtml(visitLabel)}</span>
            <button class="btn danger del-item">Delete</button>
          </div>
        `;
      }
      historyHtml += `
        <div class="section-card">
          <div class="card-header"><h2 class="nx-heading">${escapeHtml(label)} (${items.length})</h2></div>
          ${rowsHtml}
        </div>
      `;
    }
    if (remainingCount > 0) {
      historyHtml += `
        <div style="display:flex;justify-content:center;padding:8px 0 20px;">
          <button type="button" class="btn" id="btnLoadMoreHistory">Show more history (${remainingCount} remaining)</button>
        </div>
      `;
    }
  }

  mainContainer.innerHTML = closedSectionHtml + historyHtml;
  if (!force && prevScrollY > 0) window.scrollTo(0, prevScrollY);

  const btnLoadMoreHistory = document.getElementById('btnLoadMoreHistory');
  if (btnLoadMoreHistory) {
    btnLoadMoreHistory.addEventListener('click', () => {
      historyVisibleLimit += 100;
      renderHistoryPage({ force: true });
    });
  }

  const btnClearClosed = document.getElementById('btnClearClosedTabs');
  if (btnClearClosed) {
    btnClearClosed.addEventListener('click', async () => {
      await window.gxChromePagesAPI.clearClosedTabs();
      renderHistoryPage();
    });
  }

  const handleReopenClosed = async (id, url) => {
    if (!url) return;
    if (id && window.gxChromePagesAPI.removeClosedTab) {
      await window.gxChromePagesAPI.removeClosedTab(id);
    }
    await window.gxChromePagesAPI.createTab({ url, active: true });
    renderHistoryPage();
  };

  mainContainer.querySelectorAll('.reopen-closed-btn, .reopen-closed-link').forEach((el) => {
    el.addEventListener('click', () => handleReopenClosed(el.dataset.id, el.dataset.url));
  });

  mainContainer.querySelectorAll('.open-link').forEach((el) => {
    el.addEventListener('click', () => window.gxChromePagesAPI.navigate(el.dataset.url));
  });

  mainContainer.querySelectorAll('.del-item').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.closest('.card-row').dataset.id;
      await window.gxChromePagesAPI.removeHistoryItem(id);
      renderHistoryPage();
    });
  });
}

// 2. PRO DOWNLOAD MANAGER
async function renderDownloadsPage({ force = true } = {}) {
  const seq = ++renderSeq;
  const list = await window.gxChromePagesAPI.getDownloads();
  if (seq !== renderSeq || currentPage !== 'downloads') return;

  const renderKey = JSON.stringify({
    cat: dlFilterCat,
    q: searchQuery,
    list: list || []
  });
  if (!force && renderKey === lastDownloadsRenderKey) return;
  lastDownloadsRenderKey = renderKey;
  const prevScrollY = force ? 0 : window.scrollY;
  topRightActions.innerHTML = `
    <div class="nx-segmented" id="dlCatSeg">
      <button class="seg-btn ${dlFilterCat === 'all' ? 'active' : ''}" data-cat="all">All</button>
      <button class="seg-btn ${dlFilterCat === 'media' ? 'active' : ''}" data-cat="media">Media</button>
      <button class="seg-btn ${dlFilterCat === 'documents' ? 'active' : ''}" data-cat="documents">Documents</button>
      <button class="seg-btn ${dlFilterCat === 'archives' ? 'active' : ''}" data-cat="archives">Archives</button>
      <button class="seg-btn ${dlFilterCat === 'apps' ? 'active' : ''}" data-cat="apps">Apps</button>
    </div>
    <button class="btn" id="btnClearDl">Clear All</button>
  `;

  topRightActions.querySelectorAll('[data-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      dlFilterCat = btn.dataset.cat;
      renderDownloadsPage();
    });
  });

  document.getElementById('btnClearDl').addEventListener('click', async () => {
    await window.gxChromePagesAPI.clearDownloads();
    renderDownloadsPage();
  });

  const filtered = (list || []).filter(
    (d) =>
      (dlFilterCat === 'all' || d.category === dlFilterCat) &&
      (!searchQuery || (d.filename && d.filename.toLowerCase().includes(searchQuery)))
  );

  if (!filtered.length) {
    mainContainer.innerHTML = `<div class="section-card"><div class="empty-state">No downloads in this category.</div></div>`;
    return;
  }

  let rowsHtml = '';
  for (const d of filtered) {
    const pct = d.totalBytes > 0 ? Math.min(100, Math.round((d.receivedBytes / d.totalBytes) * 100)) : 100;
    const isProgressing = d.state === 'progressing';
    const isPaused = d.state === 'paused' || d.isPaused;
    const speedStr = isProgressing && d.speedBytesPerSec > 0 ? `• ${formatBytes(d.speedBytesPerSec)}/s` : '';
    const etaStr = isProgressing && d.etaSeconds > 0 ? `• ${d.etaSeconds}s remaining` : '';

    rowsHtml += `
      <div class="card-row" data-id="${escapeHtml(d.id)}">
        <div class="ext-icon">${SVG_DOWNLOAD}</div>
        <div class="row-info">
          <div class="row-title open-file" data-path="${escapeHtml(d.savePath)}">${escapeHtml(d.filename)}</div>
          <div class="row-sub">
            ${escapeHtml(d.state.toUpperCase())} • ${formatBytes(d.receivedBytes)} / ${formatBytes(d.totalBytes)} (${pct}%) ${speedStr} ${etaStr}
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width:${pct}%"></div>
          </div>
        </div>
        <div style="display:flex;gap:6px;">
          ${isProgressing && !isPaused ? `<button class="btn pause-dl">Pause</button>` : ''}
          ${isPaused ? `<button class="btn primary resume-dl">Resume</button>` : ''}
          ${isProgressing || isPaused ? `<button class="btn danger cancel-dl">Cancel</button>` : ''}
          <button class="btn show-folder" data-path="${escapeHtml(d.savePath)}">Show in Folder</button>
          <button class="btn danger remove-dl">Remove</button>
        </div>
      </div>
    `;
  }

  mainContainer.innerHTML = `<div class="section-card"><div class="card-header"><h2 class="nx-heading">Downloads (${filtered.length})</h2></div>${rowsHtml}</div>`;
  if (!force && prevScrollY > 0) window.scrollTo(0, prevScrollY);

  mainContainer.querySelectorAll('.open-file').forEach((el) => {
    el.addEventListener('click', () => window.gxChromePagesAPI.openDownloadItem(el.dataset.path));
  });
  mainContainer.querySelectorAll('.show-folder').forEach((btn) => {
    btn.addEventListener('click', () => window.gxChromePagesAPI.showDownloadInFolder(btn.dataset.path));
  });
  mainContainer.querySelectorAll('.pause-dl').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.closest('.card-row').dataset.id;
      await window.gxChromePagesAPI.pauseDownload(id);
      renderDownloadsPage();
    });
  });
  mainContainer.querySelectorAll('.resume-dl').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.closest('.card-row').dataset.id;
      await window.gxChromePagesAPI.resumeDownload(id);
      renderDownloadsPage();
    });
  });
  mainContainer.querySelectorAll('.cancel-dl').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.closest('.card-row').dataset.id;
      await window.gxChromePagesAPI.cancelDownload(id);
      renderDownloadsPage();
    });
  });
  mainContainer.querySelectorAll('.remove-dl').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.closest('.card-row').dataset.id;
      await window.gxChromePagesAPI.removeDownload(id);
      renderDownloadsPage();
    });
  });
}

// 3. BOOKMARKS (Add, Edit Name/URL/Folder, Remove, Folder Grouping & Rename)
let editingBookmarkId = null;
let editingBookmarkError = '';
let addingBookmarkOpen = false;
let addingBookmarkError = '';
let renamingFolderName = null;
let renamingFolderError = '';
let bookmarksIoBanner = null;

function getBookmarkFaviconUrl(bm) {
  if (bm && typeof bm.favicon === 'string') {
    const fav = bm.favicon.trim();
    if (/^(https?:\/\/|data:image\/)/i.test(fav)) return fav;
  }
  if (bm && typeof bm.url === 'string') {
    try {
      const u = new URL(bm.url);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        return `${u.origin}/favicon.ico`;
      }
    } catch (_) {}
  }
  return '';
}

function buildBookmarkIconHtml(bm) {
  const favUrl = getBookmarkFaviconUrl(bm);
  const imgHtml = favUrl
    ? `<img class="bm-favicon-img hidden" data-fav-src="${escapeHtml(favUrl)}" alt="" />`
    : '';
  return `<span class="bm-favicon-wrap"><span class="bm-fallback-svg">${SVG_STAR}</span>${imgHtml}</span>`;
}

function bindBookmarkFavicons(root) {
  root.querySelectorAll('.bm-favicon-img[data-fav-src]').forEach((img) => {
    const wrap = img.closest('.bm-favicon-wrap');
    const fallback = wrap ? wrap.querySelector('.bm-fallback-svg') : null;
    img.addEventListener('load', () => {
      if (img.naturalWidth > 0) {
        img.classList.remove('hidden');
        if (fallback) fallback.classList.add('hidden');
      }
    });
    img.addEventListener('error', () => img.remove());
    img.src = img.dataset.favSrc;
  });
}

function renderBookmarkRowHtml(bm) {
  if (editingBookmarkId === bm.id) {
    return `
      <div class="card-row bm-editing" data-id="${escapeHtml(bm.id)}">
        <form class="bm-edit-form" data-id="${escapeHtml(bm.id)}">
          <div class="bm-edit-grid">
            <label class="bm-edit-field">
              <span class="bm-field-label">Name</span>
              <input type="text" class="input-box bm-edit-title" value="${escapeHtml(bm.title)}" placeholder="Bookmark name" required />
            </label>
            <label class="bm-edit-field">
              <span class="bm-field-label">URL</span>
              <input type="text" class="input-box bm-edit-url" value="${escapeHtml(bm.url)}" placeholder="https://example.com" required />
            </label>
            <label class="bm-edit-field">
              <span class="bm-field-label">Folder</span>
              <input type="text" class="input-box bm-edit-folder" list="bmFolderSuggestions" value="${escapeHtml(bm.folder || '')}" placeholder="None (Bookmarks Bar)" />
            </label>
          </div>
          <div class="bm-edit-footer">
            <span class="bm-form-error">${escapeHtml(editingBookmarkError)}</span>
            <div class="bm-actions">
              <button type="button" class="btn cancel-edit-bm">Cancel</button>
              <button type="submit" class="btn primary save-edit-bm">Save</button>
            </div>
          </div>
        </form>
      </div>
    `;
  }

  return `
    <div class="card-row bookmark-item-row" data-id="${escapeHtml(bm.id)}">
      ${buildBookmarkIconHtml(bm)}
      <div class="row-info">
        <div class="row-title open-bm" data-url="${escapeHtml(bm.url)}">${escapeHtml(bm.title)}</div>
        <div class="row-sub">${escapeHtml(bm.url)}</div>
      </div>
      <div class="bm-actions">
        <button type="button" class="btn edit-bm">Edit</button>
        <button type="button" class="btn danger del-bm">Remove</button>
      </div>
    </div>
  `;
}

async function renderBookmarksPage({ force = true } = {}) {
  const seq = ++renderSeq;
  const list = (await window.gxChromePagesAPI.getBookmarks()) || [];
  if (seq !== renderSeq || currentPage !== 'bookmarks') return;

  const renderKey = JSON.stringify({
    q: searchQuery,
    list,
    addingBookmarkOpen,
    editingBookmarkId,
    renamingFolderName,
    addingBookmarkError,
    editingBookmarkError,
    renamingFolderError,
    bookmarksIoBanner
  });
  if (!force && renderKey === lastBookmarksRenderKey) return;
  lastBookmarksRenderKey = renderKey;

  const allFolders = [];
  const seenFolders = new Set();
  for (const bm of list) {
    const f = typeof bm?.folder === 'string' ? bm.folder.trim() : '';
    if (f && !seenFolders.has(f)) {
      seenFolders.add(f);
      allFolders.push(f);
    }
  }

  if (editingBookmarkId && !list.some((b) => b && b.id === editingBookmarkId)) {
    editingBookmarkId = null;
    editingBookmarkError = '';
  }
  if (renamingFolderName && !seenFolders.has(renamingFolderName)) {
    renamingFolderName = null;
    renamingFolderError = '';
  }

  topRightActions.innerHTML = `
    <button type="button" class="btn" id="btnImportBookmarksHtml">Import HTML</button>
    <button type="button" class="btn" id="btnExportBookmarksHtml">Export HTML</button>
    <button type="button" class="btn primary" id="btnToggleAddBookmark">${addingBookmarkOpen ? 'Close' : '+ Add Bookmark'}</button>
  `;

  document.getElementById('btnImportBookmarksHtml').addEventListener('click', async () => {
    if (!window.gxChromePagesAPI.importBookmarksHtml) return;
    const res = await window.gxChromePagesAPI.importBookmarksHtml();
    if (!res || res.canceled) return;
    if (!res.ok) {
      bookmarksIoBanner = {
        kind: 'error',
        title: 'Bookmarks import failed',
        detail: res.error || 'Could not import bookmarks from HTML file.'
      };
    } else {
      bookmarksIoBanner = {
        kind: 'success',
        title: `Imported ${res.added} ${res.added === 1 ? 'bookmark' : 'bookmarks'}`,
        detail: `${res.skipped || 0} duplicate(s) skipped${res.fileName ? ` from ${res.fileName}` : ''}.`
      };
    }
    renderBookmarksPage({ force: true });
  });

  document.getElementById('btnExportBookmarksHtml').addEventListener('click', async () => {
    if (!window.gxChromePagesAPI.exportBookmarksHtml) return;
    const res = await window.gxChromePagesAPI.exportBookmarksHtml();
    if (!res || res.canceled) return;
    if (!res.ok) {
      bookmarksIoBanner = {
        kind: 'error',
        title: 'Bookmarks export failed',
        detail: res.error || 'Could not export bookmarks.'
      };
    } else {
      bookmarksIoBanner = {
        kind: 'success',
        title: `Exported ${res.count} ${res.count === 1 ? 'bookmark' : 'bookmarks'}`,
        detail: res.fileName ? `Saved Netscape HTML file: ${res.fileName}` : 'Saved Netscape HTML bookmarks file.'
      };
    }
    renderBookmarksPage({ force: true });
  });

  document.getElementById('btnToggleAddBookmark').addEventListener('click', () => {
    addingBookmarkOpen = !addingBookmarkOpen;
    addingBookmarkError = '';
    renderBookmarksPage();
  });

  const bmBannerHtml = bookmarksIoBanner
    ? `
      <div class="ext-banner ${escapeHtml(bookmarksIoBanner.kind || 'info')}" id="bookmarksIoBanner" role="status">
        <div>
          <div class="ext-banner-title">${escapeHtml(bookmarksIoBanner.title)}</div>
          ${bookmarksIoBanner.detail ? `<div class="ext-banner-detail">${escapeHtml(bookmarksIoBanner.detail)}</div>` : ''}
        </div>
        <button type="button" class="btn" id="btnDismissBookmarksBanner">Dismiss</button>
      </div>
    `
    : '';

  const datalistHtml = `
    <datalist id="bmFolderSuggestions">
      ${allFolders.map((f) => `<option value="${escapeHtml(f)}"></option>`).join('')}
    </datalist>
  `;

  const addCardHtml = addingBookmarkOpen
    ? `
      <div class="section-card bm-add-card">
        <div class="card-header">
          <h2 class="nx-heading">Add Bookmark</h2>
        </div>
        <div class="card-row bm-editing">
          <form id="bmAddForm" class="bm-edit-form">
            <div class="bm-edit-grid">
              <label class="bm-edit-field">
                <span class="bm-field-label">Name</span>
                <input type="text" id="bmAddTitle" class="input-box" placeholder="e.g. GitHub" required />
              </label>
              <label class="bm-edit-field">
                <span class="bm-field-label">URL</span>
                <input type="text" id="bmAddUrl" class="input-box" placeholder="https://github.com" required />
              </label>
              <label class="bm-edit-field">
                <span class="bm-field-label">Folder</span>
                <input type="text" id="bmAddFolder" class="input-box" list="bmFolderSuggestions" placeholder="Optional (blank for Bar)" />
              </label>
            </div>
            <div class="bm-edit-footer">
              <span class="bm-form-error" id="bmAddError">${escapeHtml(addingBookmarkError)}</span>
              <div class="bm-actions">
                <button type="button" class="btn" id="btnCancelAddBookmark">Cancel</button>
                <button type="submit" class="btn primary">Add Bookmark</button>
              </div>
            </div>
          </form>
        </div>
      </div>
    `
    : '';

  const filtered = list.filter((b) => {
    if (!searchQuery) return true;
    const hay = `${b.title || ''} ${b.url || ''} ${b.folder || ''}`.toLowerCase();
    return hay.includes(searchQuery);
  });

  let sectionsHtml = '';
  if (!filtered.length) {
    const emptyMsg = !list.length
      ? 'No bookmarks saved yet. Click the star in the address bar or use "+ Add Bookmark".'
      : `No bookmarks match "${escapeHtml(searchQuery)}".`;
    sectionsHtml = `<div class="section-card"><div class="empty-state">${emptyMsg}</div></div>`;
  } else {
    const rootItems = [];
    const folderMap = new Map();
    for (const bm of filtered) {
      const f = typeof bm.folder === 'string' ? bm.folder.trim() : '';
      if (!f) {
        rootItems.push(bm);
      } else {
        if (!folderMap.has(f)) folderMap.set(f, []);
        folderMap.get(f).push(bm);
      }
    }

    if (rootItems.length) {
      sectionsHtml += `
        <div class="section-card" data-folder-group="">
          <div class="card-header">
            <h2 class="nx-heading">Bookmarks Bar (${rootItems.length})</h2>
          </div>
          ${rootItems.map(renderBookmarkRowHtml).join('')}
        </div>
      `;
    }

    for (const [folderName, items] of folderMap.entries()) {
      const isRenaming = renamingFolderName === folderName;
      const headerHtml = isRenaming
        ? `
          <form class="bm-folder-rename-form" data-old-folder="${escapeHtml(folderName)}">
            ${SVG_FOLDER}
            <input type="text" class="input-box bm-rename-folder-input" value="${escapeHtml(folderName)}" placeholder="Folder name" style="padding:5px 10px;font-size:12.5px;min-width:180px;" required />
            <button type="submit" class="btn primary">Save</button>
            <button type="button" class="btn cancel-rename-folder">Cancel</button>
            ${renamingFolderError ? `<span class="bm-form-error">${escapeHtml(renamingFolderError)}</span>` : ''}
          </form>
        `
        : `
          <div class="bm-folder-title-wrap">
            ${SVG_FOLDER}
            <h2 class="nx-heading">${escapeHtml(folderName)} (${items.length})</h2>
          </div>
          <button type="button" class="btn rename-folder-btn" data-folder="${escapeHtml(folderName)}">Rename Folder</button>
        `;

      sectionsHtml += `
        <div class="section-card" data-folder-group="${escapeHtml(folderName)}">
          <div class="card-header">${headerHtml}</div>
          ${items.map(renderBookmarkRowHtml).join('')}
        </div>
      `;
    }
  }

  mainContainer.innerHTML = bmBannerHtml + datalistHtml + addCardHtml + sectionsHtml;
  bindBookmarkFavicons(mainContainer);

  const btnDismissBmBanner = document.getElementById('btnDismissBookmarksBanner');
  if (btnDismissBmBanner) {
    btnDismissBmBanner.addEventListener('click', () => {
      bookmarksIoBanner = null;
      renderBookmarksPage({ force: true });
    });
  }

  const addForm = document.getElementById('bmAddForm');
  if (addForm) {
    const titleInp = document.getElementById('bmAddTitle');
    if (titleInp) titleInp.focus();

    document.getElementById('btnCancelAddBookmark').addEventListener('click', () => {
      addingBookmarkOpen = false;
      addingBookmarkError = '';
      renderBookmarksPage();
    });

    addForm.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        addingBookmarkOpen = false;
        addingBookmarkError = '';
        renderBookmarksPage();
      }
    });

    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('bmAddTitle').value.trim();
      const url = document.getElementById('bmAddUrl').value.trim();
      const folder = document.getElementById('bmAddFolder').value.trim();
      const res = await window.gxChromePagesAPI.addBookmark({ title, url, folder });
      if (!res || !res.ok) {
        addingBookmarkError = res?.error || 'Please enter a valid URL.';
        const errEl = document.getElementById('bmAddError');
        if (errEl) errEl.textContent = addingBookmarkError;
        return;
      }
      addingBookmarkOpen = false;
      addingBookmarkError = '';
      renderBookmarksPage();
    });
  }

  mainContainer.querySelectorAll('.open-bm').forEach((el) => {
    el.addEventListener('click', () => window.gxChromePagesAPI.navigate(el.dataset.url));
  });

  mainContainer.querySelectorAll('.edit-bm').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.card-row');
      editingBookmarkId = row?.dataset.id || null;
      editingBookmarkError = '';
      renamingFolderName = null;
      renamingFolderError = '';
      renderBookmarksPage();
    });
  });

  mainContainer.querySelectorAll('.del-bm').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.card-row')?.dataset.id;
      if (!id) return;
      await window.gxChromePagesAPI.removeBookmark(id);
      renderBookmarksPage();
    });
  });

  const editForm = mainContainer.querySelector('.bm-edit-form[data-id]');
  if (editForm) {
    const titleInp = editForm.querySelector('.bm-edit-title');
    if (titleInp) {
      titleInp.focus();
      titleInp.select();
    }

    const cancelEdit = () => {
      editingBookmarkId = null;
      editingBookmarkError = '';
      renderBookmarksPage();
    };

    editForm.querySelector('.cancel-edit-bm')?.addEventListener('click', cancelEdit);
    editForm.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cancelEdit();
    });

    editForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = editForm.dataset.id;
      const title = editForm.querySelector('.bm-edit-title').value.trim();
      const url = editForm.querySelector('.bm-edit-url').value.trim();
      const folder = editForm.querySelector('.bm-edit-folder').value.trim();
      const res = await window.gxChromePagesAPI.updateBookmark({ id, title, url, folder });
      if (!res || !res.ok) {
        editingBookmarkError = res?.error || 'Please enter a valid URL.';
        const errEl = editForm.querySelector('.bm-form-error');
        if (errEl) errEl.textContent = editingBookmarkError;
        return;
      }
      editingBookmarkId = null;
      editingBookmarkError = '';
      renderBookmarksPage();
    });
  }

  mainContainer.querySelectorAll('.rename-folder-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      renamingFolderName = btn.dataset.folder || null;
      renamingFolderError = '';
      editingBookmarkId = null;
      editingBookmarkError = '';
      renderBookmarksPage();
    });
  });

  const renameForm = mainContainer.querySelector('.bm-folder-rename-form');
  if (renameForm) {
    const inp = renameForm.querySelector('.bm-rename-folder-input');
    if (inp) {
      inp.focus();
      inp.select();
    }

    const cancelRename = () => {
      renamingFolderName = null;
      renamingFolderError = '';
      renderBookmarksPage();
    };

    renameForm.querySelector('.cancel-rename-folder')?.addEventListener('click', cancelRename);
    renameForm.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cancelRename();
    });

    renameForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const oldName = renameForm.dataset.oldFolder;
      const newName = inp ? inp.value.trim() : '';
      const res = await window.gxChromePagesAPI.renameBookmarkFolder(oldName, newName);
      if (!res || !res.ok) {
        renamingFolderError = res?.error || 'Folder name cannot be empty.';
        renderBookmarksPage();
        return;
      }
      renamingFolderName = null;
      renamingFolderError = '';
      renderBookmarksPage();
    });
  }
}

// 4. PASSWORDS & AUTOFILL
let passwordsIoBanner = null;
let passwordsExportConfirmOpen = false;
let editingPasswordId = null;
let editingPasswordError = '';
const revealedPasswordIds = new Set();
const pwLookupById = new Map();
const pwGenState = {
  length: 16,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
  value: '',
  error: '',
  feedback: ''
};

const PW_MASK_PLACEHOLDER = '••••••••••••';

function renderPasswordRowHtml(pw) {
  if (editingPasswordId === pw.id) {
    return `
      <div class="card-row bm-editing pw-editing-row" data-id="${escapeHtml(pw.id)}">
        <form class="bm-edit-form pw-edit-form" data-id="${escapeHtml(pw.id)}">
          <div class="bm-edit-grid">
            <label class="bm-edit-field">
              <span class="bm-field-label">Website</span>
              <input type="text" class="input-box pw-edit-site" value="${escapeHtml(pw.site)}" placeholder="e.g. github.com" required />
            </label>
            <label class="bm-edit-field">
              <span class="bm-field-label">Username / Email</span>
              <input type="text" class="input-box pw-edit-username" value="${escapeHtml(pw.username)}" placeholder="Username" required />
            </label>
            <label class="bm-edit-field">
              <span class="bm-field-label">Password</span>
              <div class="pw-field-wrap">
                <input type="password" class="input-box pw-edit-password" value="" placeholder="Password" autocomplete="new-password" required />
                <button type="button" class="btn toggle-edit-pw">Show</button>
              </div>
            </label>
          </div>
          <div class="bm-edit-footer">
            <span class="bm-form-error pw-edit-error">${escapeHtml(editingPasswordError)}</span>
            <div class="bm-actions">
              <button type="button" class="btn cancel-edit-pw">Cancel</button>
              <button type="submit" class="btn primary save-edit-pw">Save</button>
            </div>
          </div>
        </form>
      </div>
    `;
  }

  const isRevealed = revealedPasswordIds.has(pw.id);
  return `
    <div class="card-row pw-entry-row" data-id="${escapeHtml(pw.id)}">
      <div class="row-info">
        <div class="row-title" style="cursor:default;">${escapeHtml(pw.site)}</div>
        <div class="row-sub">Username: <strong>${escapeHtml(pw.username)}</strong></div>
      </div>
      <div class="pw-row-actions">
        <input
          type="${isRevealed ? 'text' : 'password'}"
          value="${isRevealed ? escapeHtml(pw.password) : PW_MASK_PLACEHOLDER}"
          readonly
          class="input-box pw-masked-input pw-field"
          aria-label="Saved password for ${escapeHtml(pw.site)}"
        />
        <button type="button" class="btn toggle-pw" aria-pressed="${isRevealed ? 'true' : 'false'}">${isRevealed ? 'Hide' : 'Show'}</button>
        <button type="button" class="btn copy-pw">Copy</button>
        <button type="button" class="btn edit-pw">Edit</button>
        <button type="button" class="btn danger del-pw">Delete</button>
      </div>
    </div>
  `;
}

async function renderPasswordsPage() {
  const seq = ++renderSeq;
  const [listRaw, encStatus] = await Promise.all([
    window.gxChromePagesAPI.getPasswords(),
    window.gxChromePagesAPI.getPasswordEncryptionStatus
      ? window.gxChromePagesAPI.getPasswordEncryptionStatus().catch(() => ({ available: true }))
      : Promise.resolve({ available: true })
  ]);
  const list = listRaw || [];
  if (seq !== renderSeq || currentPage !== 'passwords') return;
  const encryptionWarningHtml =
    encStatus && encStatus.available === false
      ? `
        <div class="io-banner warning" role="alert" style="margin-bottom:14px;">
          <div class="io-banner-body">
            <div class="io-banner-title">OS Keyring Encryption Unavailable</div>
            <div class="io-banner-detail">Your operating system encryption service (safeStorage) is currently unavailable. Newly saved passwords may be stored unencrypted until OS keyring support is enabled.</div>
          </div>
        </div>
      `
      : '';

  pwLookupById.clear();
  for (const pw of list) {
    if (pw && pw.id) pwLookupById.set(pw.id, pw);
  }
  if (editingPasswordId && !pwLookupById.has(editingPasswordId)) {
    editingPasswordId = null;
    editingPasswordError = '';
  }
  for (const id of Array.from(revealedPasswordIds)) {
    if (!pwLookupById.has(id)) revealedPasswordIds.delete(id);
  }

  topRightActions.innerHTML = `
    <button type="button" class="btn" id="btnImportPasswordsCsv">Import CSV</button>
    <button type="button" class="btn" id="btnExportPasswordsCsv">Export CSV</button>
  `;

  document.getElementById('btnImportPasswordsCsv').addEventListener('click', async () => {
    if (!window.gxChromePagesAPI.importPasswordsCsv) return;
    const res = await window.gxChromePagesAPI.importPasswordsCsv();
    if (!res || res.canceled) return;
    if (!res.ok) {
      passwordsIoBanner = {
        kind: 'error',
        title: 'Password import failed',
        detail: res.error || 'Could not import passwords from CSV file.'
      };
    } else {
      passwordsIoBanner = {
        kind: 'success',
        title: `Imported ${res.added} ${res.added === 1 ? 'password' : 'passwords'}`,
        detail: `${res.skipped || 0} duplicate(s) skipped${res.invalid ? `, ${res.invalid} invalid row(s) ignored` : ''}${res.fileName ? ` from ${res.fileName}` : ''}. Encrypted via OS safeStorage.`
      };
    }
    renderPasswordsPage();
  });

  document.getElementById('btnExportPasswordsCsv').addEventListener('click', () => {
    passwordsExportConfirmOpen = true;
    passwordsIoBanner = null;
    renderPasswordsPage();
  });

  const filtered = list.filter(
    (p) =>
      !searchQuery ||
      (p.site && p.site.toLowerCase().includes(searchQuery)) ||
      (p.username && p.username.toLowerCase().includes(searchQuery))
  );

  const rowsHtml = filtered.map(renderPasswordRowHtml).join('');

  const exportWarningHtml = passwordsExportConfirmOpen
    ? `
      <div class="ext-banner warning" id="pwExportWarningBanner" role="alert">
        <div>
          <div class="ext-banner-title">Security Warning — Unencrypted Plaintext Password Export</div>
          <div class="ext-banner-detail">
            Exporting passwords to CSV saves all ${list.length} saved ${list.length === 1 ? 'login' : 'logins'} in this profile as <strong>unencrypted plaintext</strong> (<code>url,username,password</code>). Anyone who can read this file will be able to see your passwords. Store it securely and delete it when done.
          </div>
          <div class="pw-warning-actions">
            <button type="button" class="btn danger-solid" id="btnConfirmExportPasswordsCsv">I Understand — Export Plaintext CSV</button>
            <button type="button" class="btn" id="btnCancelExportPasswordsCsv">Cancel</button>
          </div>
        </div>
      </div>
    `
    : '';

  const pwBannerHtml = passwordsIoBanner
    ? `
      <div class="ext-banner ${escapeHtml(passwordsIoBanner.kind || 'info')}" id="passwordsIoBanner" role="status">
        <div>
          <div class="ext-banner-title">${escapeHtml(passwordsIoBanner.title)}</div>
          ${passwordsIoBanner.detail ? `<div class="ext-banner-detail">${escapeHtml(passwordsIoBanner.detail)}</div>` : ''}
        </div>
        <button type="button" class="btn" id="btnDismissPasswordsBanner">Dismiss</button>
      </div>
    `
    : '';

  const generatorCardHtml = `
    <div class="section-card" id="pwGeneratorCard">
      <div class="card-header">
        <h2 class="nx-heading">Password Generator</h2>
        <span class="priv-status-pill accent">crypto.randomBytes</span>
      </div>
      <div class="pw-gen-body">
        <div class="pw-gen-output-row">
          <input
            type="text"
            id="pwGenOutput"
            class="input-box pw-gen-output"
            value="${escapeHtml(pwGenState.value)}"
            placeholder="Click Generate to create a strong password"
            readonly
            autocomplete="off"
            spellcheck="false"
            aria-label="Generated password"
          />
          <button type="button" class="btn primary" id="btnPwGenerate">Generate</button>
          <button type="button" class="btn" id="btnPwUseGenerated"${pwGenState.value ? '' : ' disabled'}>Use this password</button>
        </div>
        <div class="pw-gen-length-row">
          <label class="pw-gen-length-label" for="pwGenLengthRange">Length</label>
          <input
            type="range"
            id="pwGenLengthRange"
            class="nx-range"
            min="8"
            max="64"
            step="1"
            value="${pwGenState.length}"
            aria-label="Password length slider"
          />
          <input
            type="number"
            id="pwGenLengthNum"
            class="input-box pw-gen-length-num"
            min="8"
            max="64"
            value="${pwGenState.length}"
            aria-label="Password length"
          />
        </div>
        <div class="pw-gen-charsets" role="group" aria-label="Character sets">
          <label class="pw-charset-opt">
            <input type="checkbox" id="pwGenLower" ${pwGenState.lowercase ? 'checked' : ''} />
            <span>Lowercase (a-z)</span>
          </label>
          <label class="pw-charset-opt">
            <input type="checkbox" id="pwGenUpper" ${pwGenState.uppercase ? 'checked' : ''} />
            <span>Uppercase (A-Z)</span>
          </label>
          <label class="pw-charset-opt">
            <input type="checkbox" id="pwGenDigits" ${pwGenState.digits ? 'checked' : ''} />
            <span>Digits (0-9)</span>
          </label>
          <label class="pw-charset-opt">
            <input type="checkbox" id="pwGenSymbols" ${pwGenState.symbols ? 'checked' : ''} />
            <span>Symbols (!@#$...)</span>
          </label>
        </div>
        <div class="bm-form-error${pwGenState.error ? '' : ' hidden'}" id="pwGenError" role="alert">${escapeHtml(pwGenState.error)}</div>
        <div class="pw-gen-feedback${pwGenState.feedback ? '' : ' hidden'}" id="pwGenFeedback" role="status">${escapeHtml(pwGenState.feedback)}</div>
      </div>
    </div>
  `;

  mainContainer.innerHTML = `
    ${encryptionWarningHtml}
    ${exportWarningHtml}
    ${pwBannerHtml}
    ${generatorCardHtml}
    <div class="section-card">
      <div class="card-header">
        <h2 class="nx-heading">Add Website Login (Auto-Fills on Matching Sites)</h2>
      </div>
      <form id="pwAddForm" class="card-row" style="gap:10px;flex-wrap:wrap;">
        <input type="text" id="inpSite" class="input-box" placeholder="Website (e.g. github.com)" required style="flex:1;min-width:160px;" />
        <input type="text" id="inpUser" class="input-box" placeholder="Username / Email" required style="flex:1;min-width:160px;" />
        <div class="pw-field-wrap">
          <input type="password" id="inpPass" class="input-box" placeholder="Password" autocomplete="new-password" required />
          <button type="button" class="btn" id="btnToggleAddPass">Show</button>
        </div>
        <button type="submit" class="btn primary">Save</button>
      </form>
    </div>

    <div class="section-card">
      <div class="card-header">
        <h2 class="nx-heading">Saved Logins (${filtered.length})</h2>
      </div>
      ${rowsHtml || '<div class="empty-state">Logins you save or submit on websites appear here and auto-fill automatically.</div>'}
    </div>
  `;

  const btnCancelPwExport = document.getElementById('btnCancelExportPasswordsCsv');
  if (btnCancelPwExport) {
    btnCancelPwExport.addEventListener('click', () => {
      passwordsExportConfirmOpen = false;
      renderPasswordsPage();
    });
  }

  const btnConfirmPwExport = document.getElementById('btnConfirmExportPasswordsCsv');
  if (btnConfirmPwExport) {
    btnConfirmPwExport.addEventListener('click', async () => {
      if (!window.gxChromePagesAPI.exportPasswordsCsv) return;
      btnConfirmPwExport.disabled = true;
      const res = await window.gxChromePagesAPI.exportPasswordsCsv();
      passwordsExportConfirmOpen = false;
      if (!res || res.canceled) {
        renderPasswordsPage();
        return;
      }
      if (!res.ok) {
        passwordsIoBanner = {
          kind: 'error',
          title: 'Password export failed',
          detail: res.error || 'Could not export passwords.'
        };
      } else {
        passwordsIoBanner = {
          kind: 'warning',
          title: `Exported ${res.count} ${res.count === 1 ? 'password' : 'passwords'} (plaintext CSV)`,
          detail: `${res.fileName ? `Saved to ${res.fileName}. ` : ''}Remember to protect or delete this unencrypted file after use.`
        };
      }
      renderPasswordsPage();
    });
  }

  const btnDismissPwBanner = document.getElementById('btnDismissPasswordsBanner');
  if (btnDismissPwBanner) {
    btnDismissPwBanner.addEventListener('click', () => {
      passwordsIoBanner = null;
      renderPasswordsPage();
    });
  }

  // Password Generator bindings
  const genRange = document.getElementById('pwGenLengthRange');
  const genNum = document.getElementById('pwGenLengthNum');
  const genLower = document.getElementById('pwGenLower');
  const genUpper = document.getElementById('pwGenUpper');
  const genDigits = document.getElementById('pwGenDigits');
  const genSymbols = document.getElementById('pwGenSymbols');
  const genOutput = document.getElementById('pwGenOutput');
  const genErr = document.getElementById('pwGenError');
  const genFeedback = document.getElementById('pwGenFeedback');
  const btnPwGenerate = document.getElementById('btnPwGenerate');
  const btnPwUse = document.getElementById('btnPwUseGenerated');

  const syncGenLength = (rawVal) => {
    const parsed = Math.round(Number(rawVal));
    const clamped = Number.isFinite(parsed) ? Math.max(8, Math.min(64, parsed)) : 16;
    pwGenState.length = clamped;
    if (genRange) genRange.value = String(clamped);
    if (genNum) genNum.value = String(clamped);
  };

  if (genRange) {
    genRange.addEventListener('input', (e) => syncGenLength(e.target.value));
  }
  if (genNum) {
    genNum.addEventListener('input', (e) => {
      const n = Number(e.target.value);
      if (Number.isFinite(n) && n >= 8 && n <= 64) {
        pwGenState.length = Math.round(n);
        if (genRange) genRange.value = String(pwGenState.length);
      }
    });
    genNum.addEventListener('change', (e) => syncGenLength(e.target.value));
  }
  if (genLower) genLower.addEventListener('change', (e) => { pwGenState.lowercase = e.target.checked; });
  if (genUpper) genUpper.addEventListener('change', (e) => { pwGenState.uppercase = e.target.checked; });
  if (genDigits) genDigits.addEventListener('change', (e) => { pwGenState.digits = e.target.checked; });
  if (genSymbols) genSymbols.addEventListener('change', (e) => { pwGenState.symbols = e.target.checked; });

  if (btnPwGenerate) {
    btnPwGenerate.addEventListener('click', async () => {
      if (!window.gxChromePagesAPI.generatePassword) return;
      syncGenLength(genNum ? genNum.value : pwGenState.length);
      pwGenState.feedback = '';
      if (genFeedback) {
        genFeedback.textContent = '';
        genFeedback.classList.add('hidden');
      }
      const res = await window.gxChromePagesAPI.generatePassword({
        length: pwGenState.length,
        lowercase: pwGenState.lowercase,
        uppercase: pwGenState.uppercase,
        digits: pwGenState.digits,
        symbols: pwGenState.symbols
      });
      if (!res || !res.ok) {
        pwGenState.error = res?.error || 'Could not generate password.';
        pwGenState.value = '';
        if (genOutput) genOutput.value = '';
        if (btnPwUse) btnPwUse.disabled = true;
        if (genErr) {
          genErr.textContent = pwGenState.error;
          genErr.classList.remove('hidden');
        }
        return;
      }
      pwGenState.error = '';
      pwGenState.value = res.password || '';
      if (genErr) {
        genErr.textContent = '';
        genErr.classList.add('hidden');
      }
      if (genOutput) genOutput.value = pwGenState.value;
      if (btnPwUse) btnPwUse.disabled = !pwGenState.value;
    });
  }

  if (btnPwUse) {
    btnPwUse.addEventListener('click', () => {
      if (!pwGenState.value) return;
      const editPassInp = mainContainer.querySelector('.pw-edit-form .pw-edit-password');
      if (editPassInp) {
        editPassInp.value = pwGenState.value;
        editPassInp.type = 'text';
        const toggleBtn = editPassInp.closest('.pw-field-wrap')?.querySelector('.toggle-edit-pw');
        if (toggleBtn) toggleBtn.textContent = 'Hide';
        editPassInp.focus();
        pwGenState.feedback = 'Filled into the open Edit Login form.';
      } else {
        const addPassInp = document.getElementById('inpPass');
        if (addPassInp) {
          addPassInp.value = pwGenState.value;
          addPassInp.type = 'text';
          const toggleBtn = document.getElementById('btnToggleAddPass');
          if (toggleBtn) toggleBtn.textContent = 'Hide';
          addPassInp.focus();
          pwGenState.feedback = 'Filled into the Add Website Login form.';
        }
      }
      if (genFeedback && pwGenState.feedback) {
        genFeedback.textContent = pwGenState.feedback;
        genFeedback.classList.remove('hidden');
      }
    });
  }

  const btnToggleAddPass = document.getElementById('btnToggleAddPass');
  if (btnToggleAddPass) {
    btnToggleAddPass.addEventListener('click', () => {
      const inp = document.getElementById('inpPass');
      if (!inp) return;
      const isPw = inp.type === 'password';
      inp.type = isPw ? 'text' : 'password';
      btnToggleAddPass.textContent = isPw ? 'Hide' : 'Show';
    });
  }

  document.getElementById('pwAddForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const site = document.getElementById('inpSite').value.trim();
    const username = document.getElementById('inpUser').value.trim();
    const password = document.getElementById('inpPass').value;
    if (!site || !username || !password) return;
    await window.gxChromePagesAPI.addPassword({ site, username, password });
    pwGenState.feedback = '';
    renderPasswordsPage();
  });

  // Saved entry row controls: Show/Hide, main-process Copy, inline Edit, Delete
  mainContainer.querySelectorAll('.toggle-pw').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.card-row');
      const id = row?.dataset.id;
      const inp = row?.querySelector('.pw-field');
      if (!id || !inp) return;
      const isHidden = inp.type === 'password';
      if (isHidden) {
        const entry = pwLookupById.get(id);
        inp.type = 'text';
        inp.value = entry ? entry.password : '';
        btn.textContent = 'Hide';
        btn.setAttribute('aria-pressed', 'true');
        revealedPasswordIds.add(id);
      } else {
        inp.type = 'password';
        inp.value = PW_MASK_PLACEHOLDER;
        btn.textContent = 'Show';
        btn.setAttribute('aria-pressed', 'false');
        revealedPasswordIds.delete(id);
      }
    });
  });

  mainContainer.querySelectorAll('.copy-pw').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.card-row')?.dataset.id;
      if (!id || !window.gxChromePagesAPI.copyPassword) return;
      const res = await window.gxChromePagesAPI.copyPassword(id);
      if (res && res.ok) {
        btn.textContent = 'Copied!';
        clearTimeout(btn._copyResetTimer);
        btn._copyResetTimer = setTimeout(() => {
          btn.textContent = 'Copy';
        }, 1800);
      }
    });
  });

  mainContainer.querySelectorAll('.edit-pw').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('.card-row')?.dataset.id;
      if (!id) return;
      editingPasswordId = id;
      editingPasswordError = '';
      renderPasswordsPage();
    });
  });

  mainContainer.querySelectorAll('.del-pw').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.card-row')?.dataset.id;
      if (!id) return;
      revealedPasswordIds.delete(id);
      if (editingPasswordId === id) {
        editingPasswordId = null;
        editingPasswordError = '';
      }
      await window.gxChromePagesAPI.removePassword(id);
      renderPasswordsPage();
    });
  });

  const pwEditForm = mainContainer.querySelector('.pw-edit-form[data-id]');
  if (pwEditForm) {
    const editId = pwEditForm.dataset.id;
    const entry = pwLookupById.get(editId);
    const siteInp = pwEditForm.querySelector('.pw-edit-site');
    const userInp = pwEditForm.querySelector('.pw-edit-username');
    const passInp = pwEditForm.querySelector('.pw-edit-password');
    const toggleEditBtn = pwEditForm.querySelector('.toggle-edit-pw');

    // Populate password value via JS property rather than HTML attribute
    if (passInp && entry) {
      passInp.value = entry.password || '';
    }
    if (siteInp) {
      siteInp.focus();
      siteInp.select();
    }

    if (toggleEditBtn && passInp) {
      toggleEditBtn.addEventListener('click', () => {
        const isPw = passInp.type === 'password';
        passInp.type = isPw ? 'text' : 'password';
        toggleEditBtn.textContent = isPw ? 'Hide' : 'Show';
      });
    }

    const cancelEdit = () => {
      editingPasswordId = null;
      editingPasswordError = '';
      renderPasswordsPage();
    };

    pwEditForm.querySelector('.cancel-edit-pw')?.addEventListener('click', cancelEdit);
    pwEditForm.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cancelEdit();
    });

    pwEditForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const site = siteInp ? siteInp.value.trim() : '';
      const username = userInp ? userInp.value.trim() : '';
      const password = passInp ? passInp.value : '';
      const res = await window.gxChromePagesAPI.updatePassword({
        id: editId,
        site,
        username,
        password
      });
      if (!res || !res.ok) {
        editingPasswordError = res?.error || 'Could not update password.';
        const errEl = pwEditForm.querySelector('.pw-edit-error');
        if (errEl) errEl.textContent = editingPasswordError;
        return;
      }
      editingPasswordId = null;
      editingPasswordError = '';
      pwGenState.feedback = '';
      renderPasswordsPage();
    });
  }
}

// 4b. PRIVACY & SECURITY DASHBOARD
const PRIVACY_PERMISSION_LABELS = {
  camera: 'Camera',
  microphone: 'Microphone',
  geolocation: 'Location',
  notifications: 'Notifications'
};

function navigateToSettingsTarget(elementId) {
  pendingSettingsScrollTarget = elementId || '';
  switchPage('settings');
}

async function renderPrivacyPage({ force = true } = {}) {
  const seq = ++renderSeq;
  const [dash, cookiesList] = await Promise.all([
    window.gxChromePagesAPI.getPrivacyDashboard
      ? window.gxChromePagesAPI.getPrivacyDashboard()
      : Promise.resolve(null),
    window.gxChromePagesAPI.getCookies
      ? window.gxChromePagesAPI.getCookies()
      : Promise.resolve([])
  ]);
  if (seq !== renderSeq || currentPage !== 'privacy' || !dash) return;

  const cookiesCount = Array.isArray(cookiesList) ? cookiesList.length : 0;
  const renderKey = JSON.stringify({
    q: searchQuery,
    dash,
    cookiesCount
  });
  if (!force && renderKey === lastPrivacyRenderKey) return;
  lastPrivacyRenderKey = renderKey;
  const prevScrollY = force ? 0 : window.scrollY;

  topRightActions.innerHTML = `
    <button type="button" class="btn" id="btnRefreshPrivacy">Refresh</button>
    <button type="button" class="btn primary" id="btnPrivacyOpenSettings">Privacy Settings</button>
  `;

  document.getElementById('btnRefreshPrivacy').addEventListener('click', () => {
    renderPrivacyPage({ force: true });
  });
  document.getElementById('btnPrivacyOpenSettings').addEventListener('click', () => {
    switchPage('settings');
  });

  const profile = dash.profile || { id: 'default', name: 'Default', avatar: 'D', color: 'gx-violet' };
  const isIncognito = Boolean(dash.isIncognito);
  const ad = dash.adblock || {
    enabled: false,
    trackerBlockEnabled: false,
    sessionBlocked: 0,
    totalBlocked: 0,
    recentBlocked: [],
    perSite: {}
  };
  const adblockSites = dash.adblockSites && typeof dash.adblockSites === 'object' ? dash.adblockSites : {};
  const sitePermissions = Array.isArray(dash.sitePermissions) ? dash.sitePermissions : [];
  const trackedKeys = Array.isArray(dash.trackedPermissionKeys) && dash.trackedPermissionKeys.length
    ? dash.trackedPermissionKeys
    : ['camera', 'microphone', 'geolocation', 'notifications'];
  const settings = dash.settings || {};
  const security = dash.security || {};

  const adblockOn = Boolean(ad.enabled);
  const trackerOn = Boolean(adblockOn && ad.trackerBlockEnabled);
  const encryptionAvailable = Boolean(security.passwordEncryptionAvailable);
  const restoreSessionOn = settings.restoreSession !== false;
  const autoSleepOn = settings.autoSleepEnabled !== false;
  const autoSleepMins = Number(settings.autoSleepMinutes || 10);
  const historyCount = Number(security.historyCount || 0);
  const savedPasswordsCount = Number(security.savedPasswordsCount || 0);

  // Merge per-site blocked counts (from adblock:stats.perSite) with per-profile allowlist overrides (from adblock:get-sites)
  const siteMap = new Map();
  for (const [origin, count] of Object.entries(ad.perSite || {})) {
    if (!origin) continue;
    siteMap.set(origin, {
      origin,
      count: Number(count) || 0,
      allowlisted: false
    });
  }
  for (const [origin, entry] of Object.entries(adblockSites)) {
    if (!origin) continue;
    const isAllowlisted = typeof entry === 'boolean' ? entry === false : Boolean(entry && entry.enabled === false);
    const existing = siteMap.get(origin);
    if (existing) {
      existing.allowlisted = isAllowlisted;
    } else if (isAllowlisted) {
      siteMap.set(origin, {
        origin,
        count: 0,
        allowlisted: true
      });
    }
  }

  const perSiteRows = Array.from(siteMap.values())
    .filter((item) => !searchQuery || item.origin.toLowerCase().includes(searchQuery))
    .sort((a, b) => b.count - a.count || a.origin.localeCompare(b.origin));

  let perSiteHtml = '';
  if (!perSiteRows.length) {
    perSiteHtml = `
      <div class="card-row">
        <div class="nx-empty-inline" style="width:100%;">
          <div class="nx-empty-inline-left">
            <div class="nx-empty-icon" aria-hidden="true">${SVG_SHIELD}</div>
            <span class="nx-empty-copy">${
              searchQuery
                ? `No blocked or allowlisted sites match "${escapeHtml(searchQuery)}".`
                : 'No ads or trackers blocked in this session yet. Blocked sites and allowlist overrides will appear here.'
            }</span>
          </div>
        </div>
      </div>
    `;
  } else {
    for (const item of perSiteRows) {
      const statusPill = !adblockOn
        ? '<span class="priv-status-pill warn">Global Off</span>'
        : item.allowlisted
        ? '<span class="priv-status-pill warn">Paused (Allowlisted)</span>'
        : '<span class="priv-status-pill on">Protected</span>';
      const toggleBtnLabel = item.allowlisted ? 'Re-enable' : 'Pause on site';
      const nextEnabled = item.allowlisted ? 'true' : 'false';
      perSiteHtml += `
        <div class="card-row priv-adblock-site-row" data-origin="${escapeHtml(item.origin)}">
          <div class="row-info">
            <div class="row-title" style="cursor:default;">${escapeHtml(item.origin)}</div>
            <div class="row-sub">${
              item.allowlisted
                ? 'Blocking is paused on this origin for this profile'
                : 'Ads &amp; trackers filtered on this origin'
            }</div>
          </div>
          <div class="priv-checklist-right">
            <span class="priv-site-count">${item.count} blocked</span>
            ${statusPill}
            <button
              type="button"
              class="btn priv-toggle-site-adblock"
              data-origin="${escapeHtml(item.origin)}"
              data-next-enabled="${nextEnabled}"
              ${adblockOn ? '' : 'disabled title="Enable the global Ad Blocker first"'}
            >${toggleBtnLabel}</button>
          </div>
        </div>
      `;
    }
  }

  // Recent blocked requests (real items from adblock:stats.recentBlocked)
  const recentBlocked = (Array.isArray(ad.recentBlocked) ? ad.recentBlocked : []).filter((r) => {
    if (!searchQuery) return true;
    const hay = `${r.host || ''} ${r.origin || ''} ${r.category || ''} ${r.type || ''}`.toLowerCase();
    return hay.includes(searchQuery);
  });

  let recentHtml = '';
  if (!recentBlocked.length) {
    recentHtml = `<div class="empty-state" style="padding:20px;">${
      searchQuery
        ? `No recent blocked requests match "${escapeHtml(searchQuery)}".`
        : 'No blocked requests recorded in this session yet.'
    }</div>`;
  } else {
    for (const r of recentBlocked) {
      const timeStr = r.time
        ? new Date(r.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : '';
      const cat = r.category === 'tracker' ? 'Tracker' : 'Ad';
      const catCls = r.category === 'tracker' ? 'warn' : 'accent';
      recentHtml += `
        <div class="priv-recent-row">
          <div style="min-width:0;flex:1;">
            <div class="priv-recent-host">${escapeHtml(r.host || 'unknown')}</div>
            ${r.origin ? `<div class="row-sub" style="margin-top:1px;">From ${escapeHtml(r.origin)}</div>` : ''}
          </div>
          <div class="priv-recent-meta">
            <span class="priv-status-pill ${catCls}">${cat}</span>
            ${r.type ? `<span>${escapeHtml(r.type)}</span>` : ''}
            ${timeStr ? `<span class="nx-mono">${escapeHtml(timeStr)}</span>` : ''}
          </div>
        </div>
      `;
    }
  }

  // Real Site Permissions Overview (from site_permissions.json for this profile)
  const filteredPermissions = sitePermissions.filter((entry) => {
    if (!searchQuery) return true;
    const permText = trackedKeys
      .map((k) => `${PRIVACY_PERMISSION_LABELS[k] || k} ${entry.permissions?.[k] || 'ask'}`)
      .join(' ');
    return `${entry.origin} ${permText}`.toLowerCase().includes(searchQuery);
  });

  let permissionsHtml = '';
  if (!filteredPermissions.length) {
    permissionsHtml = `
      <div class="card-row">
        <div class="nx-empty-inline" style="width:100%;">
          <div class="nx-empty-inline-left">
            <div class="nx-empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </div>
            <span class="nx-empty-copy">${
              searchQuery
                ? `No site permissions match "${escapeHtml(searchQuery)}".`
                : 'No site-specific permissions saved for this profile yet. Camera, microphone, location, and notification choices you set from the address bar lock icon appear here.'
            }</span>
          </div>
        </div>
      </div>
    `;
  } else {
    for (const entry of filteredPermissions) {
      const perms = entry.permissions || {};
      const chipsHtml = trackedKeys
        .map((key) => {
          const val = perms[key] || 'ask';
          const chipCls = val === 'allow' ? 'is-allow' : val === 'block' ? 'is-block' : '';
          const label = PRIVACY_PERMISSION_LABELS[key] || key;
          return `
            <label class="priv-perm-chip ${chipCls}">
              <span>${escapeHtml(label)}</span>
              <select
                class="priv-perm-select"
                data-origin="${escapeHtml(entry.origin)}"
                data-perm-key="${escapeHtml(key)}"
                aria-label="${escapeHtml(label)} permission for ${escapeHtml(entry.origin)}"
              >
                <option value="ask"${val === 'ask' ? ' selected' : ''}>Ask</option>
                <option value="allow"${val === 'allow' ? ' selected' : ''}>Allow</option>
                <option value="block"${val === 'block' ? ' selected' : ''}>Block</option>
              </select>
            </label>
          `;
        })
        .join('');

      permissionsHtml += `
        <div class="card-row priv-perm-row" data-origin="${escapeHtml(entry.origin)}">
          <div class="priv-perm-top">
            <div class="row-info">
              <div class="row-title" style="cursor:default;">${escapeHtml(entry.origin)}</div>
            </div>
            <button type="button" class="btn danger priv-reset-site-perms" data-origin="${escapeHtml(entry.origin)}">Reset Site</button>
          </div>
          <div class="priv-perm-grid">${chipsHtml}</div>
        </div>
      `;
    }
  }

  mainContainer.innerHTML = `
    <div class="priv-profile-bar" id="privProfileBar">
      <div class="priv-profile-left">
        <span class="prof-webui-avatar" data-profile-color="${escapeHtml(profile.color || 'gx-violet')}">${escapeHtml(profile.avatar || profile.name?.charAt(0)?.toUpperCase() || 'D')}</span>
        <div>
          <div class="priv-profile-title">
            <span>Profile: ${escapeHtml(profile.name || 'Default')}</span>
            <span class="prof-webui-badge current-win">Active Window Profile</span>
            ${isIncognito ? '<span class="prof-webui-badge active">Private Window</span>' : ''}
          </div>
          <div class="priv-profile-sub">Permissions, ad-block allowlist, cookies, history, and saved logins reflect this profile. Aggregate blocked counts are browser-wide.</div>
        </div>
      </div>
    </div>

    <div class="priv-kpi-grid" id="privKpiGrid">
      <div class="priv-kpi-card accent">
        <span class="priv-kpi-label">Blocked Lifetime</span>
        <strong class="priv-kpi-value" id="privTotalBlocked">${Number(ad.totalBlocked || 0)}</strong>
        <span class="priv-kpi-sub">Total ads &amp; trackers blocked</span>
      </div>
      <div class="priv-kpi-card">
        <span class="priv-kpi-label">Blocked This Session</span>
        <strong class="priv-kpi-value" id="privSessionBlocked">${Number(ad.sessionBlocked || 0)}</strong>
        <span class="priv-kpi-sub">Across ${Object.keys(ad.perSite || {}).length} active ${Object.keys(ad.perSite || {}).length === 1 ? 'origin' : 'origins'}</span>
      </div>
      <div class="priv-kpi-card">
        <span class="priv-kpi-label">Ad Blocker</span>
        <div class="priv-kpi-toggle-row">
          <strong class="priv-kpi-value" style="font-size:20px;" id="privAdblockStateText">${adblockOn ? 'On' : 'Off'}</strong>
          <label class="nx-switch" title="Toggle built-in ad blocker">
            <input type="checkbox" id="privAdblockToggle" ${adblockOn ? 'checked' : ''} />
            <span class="nx-slider"></span>
          </label>
        </div>
        <span class="priv-kpi-sub">Network + cosmetic filter rules</span>
      </div>
      <div class="priv-kpi-card">
        <span class="priv-kpi-label">Tracker Blocking</span>
        <div class="priv-kpi-toggle-row">
          <strong class="priv-kpi-value" style="font-size:20px;" id="privTrackerStateText">${trackerOn ? 'On' : 'Off'}</strong>
          <label class="nx-switch" title="Toggle analytics & tracker blocking">
            <input type="checkbox" id="privTrackerToggle" ${trackerOn ? 'checked' : ''} ${adblockOn ? '' : 'disabled'} />
            <span class="nx-slider"></span>
          </label>
        </div>
        <span class="priv-kpi-sub">${adblockOn ? 'Analytics, telemetry &amp; pixels' : 'Requires Ad Blocker enabled'}</span>
      </div>
    </div>

    <div class="section-card" id="privPerSiteCard">
      <div class="card-header">
        <h2 class="nx-heading">Per-Site Ad &amp; Tracker Breakdown (${perSiteRows.length})</h2>
        <span style="font-size:12px;color:var(--text-secondary);">Top sites this session + allowlist</span>
      </div>
      ${perSiteHtml}
    </div>

    <div class="section-card" id="privPermissionsCard">
      <div class="card-header">
        <h2 class="nx-heading">Site Permissions Overview (${filteredPermissions.length})</h2>
        <span style="font-size:12px;color:var(--text-secondary);">Camera, Microphone, Location &amp; Notifications</span>
      </div>
      ${permissionsHtml}
    </div>

    <div class="section-card" id="privPostureCard">
      <div class="card-header">
        <h2 class="nx-heading">Security Posture Checklist</h2>
        <span style="font-size:12px;color:var(--text-secondary);">Real on/off state — no synthetic scores</span>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title" style="cursor:default;">Built-in Ad Blocker</div>
          <div class="row-sub">Blocks known ad domains, ad URL patterns, and cosmetic ad containers</div>
        </div>
        <div class="priv-checklist-right">
          <span class="priv-status-pill ${adblockOn ? 'on' : 'warn'}">${adblockOn ? 'On' : 'Off'}</span>
          <label class="nx-switch">
            <input type="checkbox" id="privCheckAdblock" ${adblockOn ? 'checked' : ''} />
            <span class="nx-slider"></span>
          </label>
        </div>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title" style="cursor:default;">Analytics &amp; Tracker Blocking</div>
          <div class="row-sub">Blocks telemetry, session replay, and analytics scripts while Ad Blocker is enabled</div>
        </div>
        <div class="priv-checklist-right">
          <span class="priv-status-pill ${trackerOn ? 'on' : 'warn'}">${trackerOn ? 'On' : 'Off'}</span>
          <label class="nx-switch">
            <input type="checkbox" id="privCheckTracker" ${trackerOn ? 'checked' : ''} ${adblockOn ? '' : 'disabled'} />
            <span class="nx-slider"></span>
          </label>
        </div>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title" style="cursor:default;">Password Encryption at Rest (OS Keyring)</div>
          <div class="row-sub">${
            encryptionAvailable
              ? `Electron safeStorage encryption is available and active (${savedPasswordsCount} saved ${savedPasswordsCount === 1 ? 'login' : 'logins'} in this profile).`
              : `OS keyring encryption is unavailable in this environment (safeStorage returned false; ${savedPasswordsCount} saved ${savedPasswordsCount === 1 ? 'login' : 'logins'} stored without OS encryption).`
          }</div>
        </div>
        <div class="priv-checklist-right">
          <span class="priv-status-pill ${encryptionAvailable ? 'on' : 'warn'}" id="privEncryptionStatus">${encryptionAvailable ? 'Available' : 'Unavailable'}</span>
          <button type="button" class="btn" id="btnPrivManagePasswords">Passwords</button>
        </div>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title" style="cursor:default;">Private Browsing Windows</div>
          <div class="row-sub">${
            isIncognito
              ? 'Currently browsing in an ephemeral Private window (history and session not saved).'
              : 'Ephemeral, history-isolated Private windows are available (Ctrl+Shift+N).'
          }</div>
        </div>
        <div class="priv-checklist-right">
          <span class="priv-status-pill ${isIncognito ? 'accent' : 'on'}">${isIncognito ? 'Active' : 'Available'}</span>
          <button type="button" class="btn" id="btnPrivNewIncognito">Open Private Window</button>
        </div>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title" style="cursor:default;">Session Restore on Startup</div>
          <div class="row-sub">${
            restoreSessionOn
              ? 'On — previous tabs are saved to disk and restored on launch.'
              : 'Off — browser starts fresh on nextgx://newtab without restoring prior tabs.'
          }</div>
        </div>
        <div class="priv-checklist-right">
          <span class="priv-status-pill ${restoreSessionOn ? 'accent' : ''}">${restoreSessionOn ? 'On' : 'Off'}</span>
          <label class="nx-switch">
            <input type="checkbox" id="privCheckRestoreSession" ${restoreSessionOn ? 'checked' : ''} />
            <span class="nx-slider"></span>
          </label>
        </div>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title" style="cursor:default;">Automatic Tab Hibernation (Auto-Sleep)</div>
          <div class="row-sub">${
            autoSleepOn
              ? `On — idle background tabs hibernate after ${autoSleepMins} ${autoSleepMins === 1 ? 'minute' : 'minutes'}.`
              : 'Off — background tabs stay awake until manually hibernated.'
          }</div>
        </div>
        <div class="priv-checklist-right">
          <span class="priv-status-pill ${autoSleepOn ? 'on' : ''}">${autoSleepOn ? `On (${autoSleepMins}m)` : 'Off'}</span>
          <label class="nx-switch">
            <input type="checkbox" id="privCheckAutoSleep" ${autoSleepOn ? 'checked' : ''} />
            <span class="nx-slider"></span>
          </label>
          <button type="button" class="btn" id="btnPrivConfigSleep">Configure</button>
        </div>
      </div>
    </div>

    <div class="section-card" id="privClearDataCard">
      <div class="card-header">
        <h2 class="nx-heading">Clear Browsing Data &amp; Site Storage</h2>
      </div>
      <div class="card-row" style="flex-wrap:wrap;">
        <div class="row-info" style="min-width:220px;">
          <div class="row-title" style="cursor:default;">Stored Data for ${escapeHtml(profile.name || 'Default')}</div>
          <div class="row-sub">${cookiesCount} ${cookiesCount === 1 ? 'cookie' : 'cookies'} stored • ${historyCount} history ${historyCount === 1 ? 'entry' : 'entries'}</div>
        </div>
        <div class="io-actions-group">
          <button type="button" class="btn danger" id="btnPrivGoClearData">Clear Browsing Data</button>
          <button type="button" class="btn" id="btnPrivGoCookies">Manage Cookies</button>
          <button type="button" class="btn" id="btnPrivGoHistory">History</button>
        </div>
      </div>
    </div>

    <div class="section-card" id="privRecentBlockedCard">
      <div class="card-header">
        <h2 class="nx-heading">Recent Blocked Requests (${recentBlocked.length})</h2>
        <span style="font-size:12px;color:var(--text-secondary);">Last 25 blocked requests this session</span>
      </div>
      ${recentHtml}
    </div>
  `;

  if (!force && prevScrollY > 0) window.scrollTo(0, prevScrollY);

  const handleAdblockToggle = async (checked) => {
    await window.gxChromePagesAPI.toggleAdblock(Boolean(checked));
    renderPrivacyPage({ force: true });
  };
  const handleTrackerToggle = async (checked) => {
    if (window.gxChromePagesAPI.toggleTrackerBlock) {
      await window.gxChromePagesAPI.toggleTrackerBlock(Boolean(checked));
    } else {
      await window.gxChromePagesAPI.updateSettings({ trackerBlockEnabled: Boolean(checked) });
    }
    renderPrivacyPage({ force: true });
  };

  document.getElementById('privAdblockToggle')?.addEventListener('change', (e) => handleAdblockToggle(e.target.checked));
  document.getElementById('privCheckAdblock')?.addEventListener('change', (e) => handleAdblockToggle(e.target.checked));
  document.getElementById('privTrackerToggle')?.addEventListener('change', (e) => handleTrackerToggle(e.target.checked));
  document.getElementById('privCheckTracker')?.addEventListener('change', (e) => handleTrackerToggle(e.target.checked));

  mainContainer.querySelectorAll('.priv-toggle-site-adblock').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const origin = btn.dataset.origin;
      const nextEnabled = btn.dataset.nextEnabled === 'true';
      if (!origin || !window.gxChromePagesAPI.setAdblockSite) return;
      await window.gxChromePagesAPI.setAdblockSite(origin, nextEnabled);
      renderPrivacyPage({ force: true });
    });
  });

  mainContainer.querySelectorAll('.priv-perm-select').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const origin = sel.dataset.origin;
      const key = sel.dataset.permKey;
      if (!origin || !key || !window.gxChromePagesAPI.setSitePermission) return;
      await window.gxChromePagesAPI.setSitePermission(origin, key, sel.value);
      renderPrivacyPage({ force: true });
    });
  });

  mainContainer.querySelectorAll('.priv-reset-site-perms').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const origin = btn.dataset.origin;
      if (!origin || !window.gxChromePagesAPI.clearSitePermission) return;
      await window.gxChromePagesAPI.clearSitePermission(origin);
      renderPrivacyPage({ force: true });
    });
  });

  document.getElementById('privCheckRestoreSession')?.addEventListener('change', async (e) => {
    await window.gxChromePagesAPI.updateSettings({ restoreSession: e.target.checked });
    renderPrivacyPage({ force: true });
  });

  document.getElementById('privCheckAutoSleep')?.addEventListener('change', async (e) => {
    await window.gxChromePagesAPI.updateSettings({ autoSleepEnabled: e.target.checked });
    renderPrivacyPage({ force: true });
  });

  document.getElementById('btnPrivManagePasswords')?.addEventListener('click', () => {
    switchPage('passwords');
  });

  document.getElementById('btnPrivNewIncognito')?.addEventListener('click', () => {
    window.gxChromePagesAPI.createTab({ incognito: true });
  });

  document.getElementById('btnPrivConfigSleep')?.addEventListener('click', () => {
    navigateToSettingsTarget('setAutoSleepChk');
  });

  document.getElementById('btnPrivGoClearData')?.addEventListener('click', () => {
    navigateToSettingsTarget('settingsClearDataRow');
  });

  document.getElementById('btnPrivGoCookies')?.addEventListener('click', () => {
    navigateToSettingsTarget('cookiesSettingsCard');
  });

  document.getElementById('btnPrivGoHistory')?.addEventListener('click', () => {
    switchPage('history');
  });
}

// 5. EXTENSIONS
let extStatusBanner = null;

async function renderExtensionsPage() {
  const seq = ++renderSeq;
  const [settings, userExts, adStats] = await Promise.all([
    window.gxChromePagesAPI.getSettings ? window.gxChromePagesAPI.getSettings() : Promise.resolve({}),
    window.gxChromePagesAPI.getExtensions(),
    window.gxChromePagesAPI.getAdblockStats()
  ]);
  if (seq !== renderSeq || currentPage !== 'extensions') return;
  const devMode = settings?.extensionsDevMode !== false;
  const isIncognito = document.documentElement.getAttribute('data-incognito') === 'true';

  topRightActions.innerHTML = `
    <span style="color:var(--text-secondary);">Developer Mode</span>
    <label class="nx-switch">
      <input type="checkbox" id="extDevModeToggle" ${devMode ? 'checked' : ''} />
      <span class="nx-slider"></span>
    </label>
    <button class="btn primary" id="btnLoadUnpacked"${devMode ? '' : ' disabled title="Enable Developer Mode to load unpacked extensions" style="opacity:0.45;cursor:not-allowed;"'}>+ Load Unpacked</button>
    ${devMode ? '' : '<span id="extDevModeHint" style="color:var(--text-secondary);font-size:11.5px;">Enable Developer Mode to load unpacked extensions</span>'}
  `;

  const devModeToggle = document.getElementById('extDevModeToggle');
  if (devModeToggle) {
    devModeToggle.addEventListener('change', async (e) => {
      if (window.gxChromePagesAPI.updateSettings) {
        await window.gxChromePagesAPI.updateSettings({ extensionsDevMode: e.target.checked });
      }
      renderExtensionsPage();
    });
  }

  const loadBtn = document.getElementById('btnLoadUnpacked');
  if (loadBtn && devMode) {
    loadBtn.addEventListener('click', async () => {
      loadBtn.disabled = true;
      loadBtn.textContent = 'Loading...';
      try {
        const res = await window.gxChromePagesAPI.loadUnpackedExtension();
        if (!res) {
          extStatusBanner = {
            kind: 'error',
            title: 'Failed to load unpacked extension',
            detail: 'No response was returned from the browser extension loader.'
          };
        } else if (res.canceled) {
          // User closed the directory picker without choosing a folder.
        } else if (!res.ok) {
          extStatusBanner = {
            kind: 'error',
            title: 'Failed to load unpacked extension',
            detail: res.error || 'Unknown error while loading extension.'
          };
        } else if (Array.isArray(res.warnings) && res.warnings.length > 0) {
          extStatusBanner = {
            kind: 'warning',
            title: `Loaded "${res.extension?.name || 'Extension'}" with compatibility warnings`,
            detail: res.incognitoNotice
              ? 'Loaded into standard browser windows (Electron cannot load extensions into temporary Private sessions). Unsupported Chrome APIs/warnings reported by Chromium:'
              : 'Electron supports a subset of Chrome Extension APIs. Chromium reported the following warnings while loading:',
            items: res.warnings
          };
        } else {
          extStatusBanner = {
            kind: 'success',
            title: `Loaded "${res.extension?.name || 'Extension'}"`,
            detail: res.incognitoNotice
              ? 'Loaded into standard browser windows (Electron cannot load extensions into temporary Private sessions).'
              : `Version ${res.extension?.version || '1.0'} is active in standard browser tabs.`
          };
        }
      } catch (err) {
        extStatusBanner = {
          kind: 'error',
          title: 'Failed to load unpacked extension',
          detail: err?.message || String(err)
        };
      }
      renderExtensionsPage();
    });
  }

  let bannersHtml = '';
  if (isIncognito) {
    bannersHtml += `
      <div class="ext-banner info" id="extIncognitoNotice">
        <div>
          <div class="ext-banner-title">Private Window Session Notice</div>
          <div class="ext-banner-detail">Electron does not allow loading extensions into temporary Private sessions. Extensions loaded or toggled here apply to standard browser windows.</div>
        </div>
      </div>
    `;
  }
  bannersHtml += `
    <div class="ext-banner info" id="extCompatibilityNotice">
      <div>
        <div class="ext-banner-title">What Works &amp; Electron Extension Limits</div>
        <div class="ext-banner-detail">
          <strong>Supported:</strong> Unpacked MV2/MV3 extensions, toolbar action popups (open from the Extensions toolbar dropdown or pin directly to the toolbar), content scripts, background service workers, and storage.<br />
          <strong>Electron Limits:</strong> Unsupported Chrome permission APIs (<code>contextMenus</code>, <code>sidePanel</code>, <code>webNavigation</code>, <code>notifications</code>, <code>privacy</code>) log non-fatal warnings and are unavailable in Electron; theme extensions do not restyle nextGx's custom UI; extensions do not load in Private windows.
        </div>
      </div>
    </div>
  `;
  if (extStatusBanner) {
    const itemsHtml =
      Array.isArray(extStatusBanner.items) && extStatusBanner.items.length
        ? `<ul class="ext-banner-list">${extStatusBanner.items
            .map((w) => `<li>${escapeHtml(w)}</li>`)
            .join('')}</ul>`
        : '';
    bannersHtml += `
      <div class="ext-banner ${escapeHtml(extStatusBanner.kind || 'info')}" id="extStatusBanner" role="status">
        <div>
          <div class="ext-banner-title">${escapeHtml(extStatusBanner.title)}</div>
          ${extStatusBanner.detail ? `<div class="ext-banner-detail">${escapeHtml(extStatusBanner.detail)}</div>` : ''}
          ${itemsHtml}
        </div>
        <button class="btn" id="btnDismissExtBanner" type="button">Dismiss</button>
      </div>
    `;
  }

  const builtInCards = [
    {
      searchText: 'nextgx privacy shield built-in ad blocker tracker',
      html: `
        <div class="ext-card">
          <div class="ext-top">
            <div class="ext-icon">${SVG_SHIELD}</div>
            <div class="row-info">
              <div style="font-weight:600;font-size:14.5px;">nextGx Privacy Shield <span style="font-size:11px;color:var(--text-secondary);">3.0.0</span></div>
              <div class="row-sub" style="white-space:normal;margin-top:4px;">Blocks intrusive ads, popups & analytics trackers at the Chromium network layer (${adStats?.totalBlocked || 0} blocked).</div>
            </div>
          </div>
          <div class="ext-bottom">
            <span style="font-size:11.5px;color:var(--success);font-weight:600;">Built-in System Module</span>
            <label class="nx-switch">
              <input type="checkbox" id="extAdblockToggle" ${adStats?.enabled !== false ? 'checked' : ''} />
              <span class="nx-slider"></span>
            </label>
          </div>
        </div>
      `
    },
    {
      searchText: 'nextgx media ai overlay built-in youtube music spotify apple soundcloud chatgpt',
      html: `
        <div class="ext-card">
          <div class="ext-top">
            <div class="ext-icon">${SVG_MUSIC}</div>
            <div class="row-info">
              <div style="font-weight:600;font-size:14.5px;">nextGx Media & AI Overlay <span style="font-size:11px;color:var(--text-secondary);">3.0.0</span></div>
              <div class="row-sub" style="white-space:normal;margin-top:4px;">Floating overlay dock with dropdown switcher for YouTube Music, Spotify, Apple Music, SoundCloud & ChatGPT.</div>
            </div>
          </div>
          <div class="ext-bottom">
            <span style="font-size:11.5px;color:var(--success);font-weight:600;">Built-in System Module</span>
            <label class="nx-switch">
              <input type="checkbox" checked disabled />
              <span class="nx-slider"></span>
            </label>
          </div>
        </div>
      `
    }
  ];

  const builtInHtml = builtInCards
    .filter((c) => !searchQuery || c.searchText.includes(searchQuery))
    .map((c) => c.html)
    .join('');

  const filteredUserExts = (userExts || []).filter((ext) => {
    if (!searchQuery) return true;
    const hay = `${ext.name || ''} ${ext.description || ''} ${ext.id || ''} ${ext.path || ''}`.toLowerCase();
    return hay.includes(searchQuery);
  });

  let userExtsHtml = '';
  for (const ext of filteredUserExts) {
    const isEnabled = ext.enabled !== false;
    const mvLabel = ext.manifestVersion ? `MV${ext.manifestVersion}` : '';
    const devMetaHtml = devMode
      ? `
        <div class="ext-dev-meta">
          <div>ID: ${escapeHtml(ext.id)}</div>
          ${ext.path ? `<div>Source: ${escapeHtml(ext.path)}</div>` : ''}
        </div>
      `
      : '';
    const warningsHtml =
      Array.isArray(ext.warnings) && ext.warnings.length
        ? `<div class="ext-note warning">${escapeHtml(ext.warnings.join(' • '))}</div>`
        : '';
    const lastErrorHtml = ext.lastError
      ? `<div class="ext-note error">${escapeHtml(ext.lastError)}</div>`
      : '';

    userExtsHtml += `
      <div class="ext-card user-ext-card ${isEnabled ? '' : 'disabled'}" data-id="${escapeHtml(ext.id)}">
        <div class="ext-top">
          <div class="ext-icon">${SVG_PUZZLE}</div>
          <div class="row-info">
            <div style="font-weight:600;font-size:14.5px;">${escapeHtml(ext.name)} <span style="font-size:11px;color:var(--text-secondary);">${escapeHtml(ext.version || '1.0')}</span></div>
            ${ext.description ? `<div class="row-sub" style="white-space:normal;margin-top:4px;">${escapeHtml(ext.description)}</div>` : ''}
            <div class="ext-meta-badges">
              <span class="ext-pill ${isEnabled ? 'active' : ''}">${isEnabled ? 'Active' : 'Disabled'}</span>
              ${mvLabel ? `<span class="ext-pill mv">${escapeHtml(mvLabel)}</span>` : ''}
              <span class="ext-pill">Unpacked</span>
            </div>
            ${devMetaHtml}
            ${warningsHtml}
            ${lastErrorHtml}
          </div>
        </div>
        <div class="ext-bottom">
          <div class="ext-actions">
            <button class="btn danger remove-ext" data-id="${escapeHtml(ext.id)}">Remove</button>
            ${devMode && ext.path ? `<button class="btn reload-ext" data-id="${escapeHtml(ext.id)}">Reload</button>` : ''}
          </div>
          <label class="nx-switch" title="${isEnabled ? 'Disable extension' : 'Enable extension'}">
            <input type="checkbox" class="toggle-ext" data-id="${escapeHtml(ext.id)}" ${isEnabled ? 'checked' : ''} />
            <span class="nx-slider"></span>
          </label>
        </div>
      </div>
    `;
  }

  const gridHtml =
    builtInHtml || userExtsHtml
      ? `<div class="ext-grid">${builtInHtml}${userExtsHtml}</div>`
      : `<div class="section-card"><div class="empty-state">No extensions match "${escapeHtml(searchQuery)}".</div></div>`;

  mainContainer.innerHTML = `${bannersHtml}${gridHtml}`;

  const btnDismiss = document.getElementById('btnDismissExtBanner');
  if (btnDismiss) {
    btnDismiss.addEventListener('click', () => {
      extStatusBanner = null;
      renderExtensionsPage();
    });
  }

  const toggle = document.getElementById('extAdblockToggle');
  if (toggle) {
    toggle.addEventListener('change', async (e) => {
      await window.gxChromePagesAPI.toggleAdblock(e.target.checked);
    });
  }

  mainContainer.querySelectorAll('.toggle-ext').forEach((chk) => {
    chk.addEventListener('change', async () => {
      const id = chk.dataset.id;
      const desired = chk.checked;
      chk.disabled = true;
      try {
        const res = await window.gxChromePagesAPI.toggleExtension(id, desired);
        if (!res || !res.ok) {
          chk.checked = !desired;
          extStatusBanner = {
            kind: 'error',
            title: `Failed to ${desired ? 'enable' : 'disable'} extension`,
            detail: res?.error || 'Unknown error while updating extension state.'
          };
        } else if (desired && Array.isArray(res.warnings) && res.warnings.length) {
          extStatusBanner = {
            kind: 'warning',
            title: `Enabled "${res.extension?.name || 'Extension'}" with compatibility warnings`,
            detail: 'Chromium reported the following warnings while loading:',
            items: res.warnings
          };
        } else {
          extStatusBanner = null;
        }
      } catch (err) {
        chk.checked = !desired;
        extStatusBanner = {
          kind: 'error',
          title: `Failed to ${desired ? 'enable' : 'disable'} extension`,
          detail: err?.message || String(err)
        };
      }
      renderExtensionsPage();
    });
  });

  mainContainer.querySelectorAll('.reload-ext').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      btn.disabled = true;
      try {
        const res = await window.gxChromePagesAPI.reloadExtension(id);
        if (!res || !res.ok) {
          extStatusBanner = {
            kind: 'error',
            title: 'Failed to reload extension',
            detail: res?.error || 'Unknown error while reloading extension.'
          };
        } else if (Array.isArray(res.warnings) && res.warnings.length) {
          extStatusBanner = {
            kind: 'warning',
            title: `Reloaded "${res.extension?.name || 'Extension'}" with compatibility warnings`,
            detail: 'Chromium reported the following warnings while loading:',
            items: res.warnings
          };
        } else {
          extStatusBanner = {
            kind: 'success',
            title: `Reloaded "${res.extension?.name || 'Extension'}"`,
            detail: `Version ${res.extension?.version || '1.0'} reloaded from disk.`
          };
        }
      } catch (err) {
        extStatusBanner = {
          kind: 'error',
          title: 'Failed to reload extension',
          detail: err?.message || String(err)
        };
      }
      renderExtensionsPage();
    });
  });

  mainContainer.querySelectorAll('.remove-ext').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await window.gxChromePagesAPI.removeExtension(btn.dataset.id);
      extStatusBanner = null;
      renderExtensionsPage();
    });
  });
}

// 6. SETTINGS
let cookieFilterText = '';
let settingsProfilesData = null;
let settingsProfileBanner = null;
let settingsProfileCreateOpen = false;
let settingsProfileCreateColor = 'cyan';
let settingsProfileRenamingId = null;
let settingsProfileRenameColor = 'gx-violet';
let settingsProfileDeletingId = null;
let settingsProfileError = '';
let settingsIoBanner = null;

const WEBUI_PROFILE_COLORS = [
  { id: 'gx-violet', label: 'Violet' },
  { id: 'cyan', label: 'Cyan' },
  { id: 'emerald', label: 'Emerald' },
  { id: 'crimson', label: 'Crimson' },
  { id: 'magenta', label: 'Magenta' },
  { id: 'amber', label: 'Amber' },
  { id: 'lime', label: 'Lime' },
  { id: 'ice', label: 'Ice' }
];

function buildWebuiProfileSwatchesHtml(selectedColor, attrName) {
  return WEBUI_PROFILE_COLORS.map(
    (c) =>
      `<button type="button" class="prof-webui-swatch${c.id === selectedColor ? ' active' : ''}" data-profile-color="${c.id}" data-${attrName}="${c.id}" title="${c.label}" aria-label="${c.label}"></button>`
  ).join('');
}

function renderSettingsProfilesSection() {
  const container = document.getElementById('profilesSettingsBody');
  if (!container) return;

  const data = settingsProfilesData || { activeId: 'default', windowProfileId: 'default', profiles: [] };
  const profiles = Array.isArray(data.profiles) ? data.profiles : [];
  const activeId = data.activeId || 'default';
  const windowProfileId = data.windowProfileId || activeId;

  const bannerHtml = settingsProfileBanner
    ? `
      <div class="card-row">
        <div class="ext-banner ${escapeHtml(settingsProfileBanner.kind || 'info')}" style="margin-bottom:0;width:100%;" role="status">
          <div>
            <div class="ext-banner-title">${escapeHtml(settingsProfileBanner.title)}</div>
            ${settingsProfileBanner.detail ? `<div class="ext-banner-detail">${escapeHtml(settingsProfileBanner.detail)}</div>` : ''}
          </div>
          <button type="button" class="btn" id="btnDismissProfileBanner">Dismiss</button>
        </div>
      </div>
    `
    : '';

  const createFormHtml = settingsProfileCreateOpen
    ? `
      <div class="card-row bm-editing">
        <form id="settingsCreateProfileForm" class="prof-webui-form">
          <div class="prof-webui-form-row">
            <input type="text" id="inpNewProfileName" class="input-box" placeholder="Profile name (e.g. Work, Gaming)" maxlength="40" required style="min-width:220px;flex:1;" />
            <div class="prof-webui-swatches" id="newProfileSwatches">${buildWebuiProfileSwatchesHtml(settingsProfileCreateColor, 'new-prof-color')}</div>
            <button type="submit" class="btn primary">Create Profile</button>
            <button type="button" class="btn" id="btnCancelNewProfile">Cancel</button>
          </div>
          ${settingsProfileError ? `<div class="bm-form-error">${escapeHtml(settingsProfileError)}</div>` : ''}
        </form>
      </div>
    `
    : '';

  let rowsHtml = '';
  for (const prof of profiles) {
    if (!prof || !prof.id) continue;
    const isDefault = prof.id === 'default';
    const isActive = prof.id === activeId;
    const isThisWindow = prof.id === windowProfileId;

    if (settingsProfileRenamingId === prof.id) {
      rowsHtml += `
        <div class="card-row bm-editing" data-profile-id="${escapeHtml(prof.id)}">
          <form class="prof-webui-form settings-rename-profile-form" data-profile-id="${escapeHtml(prof.id)}">
            <div class="prof-webui-form-row">
              <input type="text" class="input-box settings-rename-profile-input" value="${escapeHtml(prof.name)}" maxlength="40" required style="min-width:200px;flex:1;" />
              <div class="prof-webui-swatches">${buildWebuiProfileSwatchesHtml(settingsProfileRenameColor, 'rename-prof-color')}</div>
              <button type="submit" class="btn primary">Save</button>
              <button type="button" class="btn cancel-rename-profile">Cancel</button>
            </div>
            ${settingsProfileError ? `<div class="bm-form-error">${escapeHtml(settingsProfileError)}</div>` : ''}
          </form>
        </div>
      `;
      continue;
    }

    if (settingsProfileDeletingId === prof.id && !isDefault) {
      rowsHtml += `
        <div class="card-row" data-profile-id="${escapeHtml(prof.id)}">
          <div class="prof-webui-confirm">
            <div class="prof-webui-confirm-copy">
              <strong>Delete "${escapeHtml(prof.name)}"?</strong> Permanently removes its local cookies, cache, history, bookmarks, passwords, and settings.
            </div>
            <div class="io-actions-group">
              <button type="button" class="btn cancel-delete-profile">Cancel</button>
              <button type="button" class="btn danger-solid confirm-delete-profile" data-profile-id="${escapeHtml(prof.id)}">Confirm Delete</button>
            </div>
          </div>
        </div>
      `;
      continue;
    }

    const badges = [];
    if (isActive) badges.push('<span class="prof-webui-badge active">Active</span>');
    if (isThisWindow) badges.push('<span class="prof-webui-badge current-win">This Window</span>');
    if (isDefault) badges.push('<span class="prof-webui-badge">Built-in</span>');

    rowsHtml += `
      <div class="card-row settings-profile-row" data-profile-id="${escapeHtml(prof.id)}">
        <span class="prof-webui-avatar" data-profile-color="${escapeHtml(prof.color || 'gx-violet')}">${escapeHtml(prof.avatar || prof.name?.charAt(0)?.toUpperCase() || 'P')}</span>
        <div class="row-info">
          <div class="row-title" style="cursor:default;">
            ${escapeHtml(prof.name)}
            <span class="prof-webui-badges">${badges.join('')}</span>
          </div>
          <div class="row-sub">${isDefault ? 'Default profile — uses main browser data directory' : `Isolated local storage & session partition (persist:profile-${escapeHtml(prof.id)})`}</div>
        </div>
        <div class="io-actions-group">
          <button type="button" class="btn ${isActive ? '' : 'primary'} switch-profile-btn" data-profile-id="${escapeHtml(prof.id)}">${isActive ? 'Open Window' : 'Switch'}</button>
          <button type="button" class="btn rename-profile-btn" data-profile-id="${escapeHtml(prof.id)}">Rename</button>
          <button type="button" class="btn danger delete-profile-btn" data-profile-id="${escapeHtml(prof.id)}"${isDefault ? ' disabled title="Default profile cannot be deleted"' : ''}>Delete</button>
        </div>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="card-row">
      <div class="row-info">
        <div class="row-sub" style="margin-top:0;">Local-only profiles with isolated cookies, history, bookmarks, passwords, theme, and sidebar layout. Switching opens a new window in the selected profile.</div>
      </div>
    </div>
    ${bannerHtml}
    ${createFormHtml}
    ${rowsHtml || '<div class="empty-state" style="padding:20px;">No profiles found.</div>'}
  `;

  const btnDismiss = document.getElementById('btnDismissProfileBanner');
  if (btnDismiss) {
    btnDismiss.addEventListener('click', () => {
      settingsProfileBanner = null;
      renderSettingsProfilesSection();
    });
  }

  const createForm = document.getElementById('settingsCreateProfileForm');
  if (createForm) {
    const inp = document.getElementById('inpNewProfileName');
    if (inp) inp.focus();

    createForm.querySelectorAll('[data-new-prof-color]').forEach((sw) => {
      sw.addEventListener('click', () => {
        settingsProfileCreateColor = sw.dataset.newProfColor;
        createForm.querySelectorAll('[data-new-prof-color]').forEach((b) => {
          b.classList.toggle('active', b.dataset.newProfColor === settingsProfileCreateColor);
        });
      });
    });

    document.getElementById('btnCancelNewProfile')?.addEventListener('click', () => {
      settingsProfileCreateOpen = false;
      settingsProfileError = '';
      renderSettingsProfilesSection();
    });

    createForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = inp ? inp.value.trim() : '';
      if (!name) {
        settingsProfileError = 'Profile name cannot be empty.';
        renderSettingsProfilesSection();
        return;
      }
      const res = await window.gxChromePagesAPI.createProfile({
        name,
        color: settingsProfileCreateColor
      });
      if (!res || !res.ok) {
        settingsProfileError = res?.error || 'Could not create profile.';
        renderSettingsProfilesSection();
        return;
      }
      settingsProfileCreateOpen = false;
      settingsProfileError = '';
      settingsProfileBanner = {
        kind: 'success',
        title: `Created profile "${res.profile?.name || name}"`,
        detail: 'Click Switch to open a window in this profile.'
      };
      settingsProfilesData = await window.gxChromePagesAPI.listProfiles();
      renderSettingsProfilesSection();
    });
  }

  const renameForm = container.querySelector('.settings-rename-profile-form');
  if (renameForm) {
    const inp = renameForm.querySelector('.settings-rename-profile-input');
    if (inp) {
      inp.focus();
      inp.select();
    }
    renameForm.querySelectorAll('[data-rename-prof-color]').forEach((sw) => {
      sw.addEventListener('click', () => {
        settingsProfileRenameColor = sw.dataset.renameProfColor;
        renameForm.querySelectorAll('[data-rename-prof-color]').forEach((b) => {
          b.classList.toggle('active', b.dataset.renameProfColor === settingsProfileRenameColor);
        });
      });
    });
    renameForm.querySelector('.cancel-rename-profile')?.addEventListener('click', () => {
      settingsProfileRenamingId = null;
      settingsProfileError = '';
      renderSettingsProfilesSection();
    });
    renameForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = renameForm.dataset.profileId;
      const name = inp ? inp.value.trim() : '';
      if (!name) {
        settingsProfileError = 'Profile name cannot be empty.';
        renderSettingsProfilesSection();
        return;
      }
      const res = await window.gxChromePagesAPI.renameProfile(id, {
        name,
        color: settingsProfileRenameColor
      });
      if (!res || !res.ok) {
        settingsProfileError = res?.error || 'Could not rename profile.';
        renderSettingsProfilesSection();
        return;
      }
      settingsProfileRenamingId = null;
      settingsProfileError = '';
      settingsProfileBanner = {
        kind: 'success',
        title: `Updated profile "${res.profile?.name || name}"`
      };
      settingsProfilesData = await window.gxChromePagesAPI.listProfiles();
      renderSettingsProfilesSection();
    });
  }

  container.querySelectorAll('.switch-profile-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.profileId;
      if (!id) return;
      const res = await window.gxChromePagesAPI.switchProfile(id);
      if (res && res.ok) {
        settingsProfileBanner = {
          kind: 'info',
          title: `Switched active profile to "${res.profile?.name || id}"`,
          detail: 'Opened a new browser window in this profile. Existing tabs remain in their current window.'
        };
        settingsProfilesData = await window.gxChromePagesAPI.listProfiles();
        renderSettingsProfilesSection();
      }
    });
  });

  container.querySelectorAll('.rename-profile-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.profileId;
      const target = profiles.find((p) => p.id === id);
      if (!target) return;
      settingsProfileCreateOpen = false;
      settingsProfileDeletingId = null;
      settingsProfileRenamingId = id;
      settingsProfileRenameColor = target.color || 'gx-violet';
      settingsProfileError = '';
      renderSettingsProfilesSection();
    });
  });

  container.querySelectorAll('.delete-profile-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.profileId;
      if (!id || id === 'default') return;
      settingsProfileCreateOpen = false;
      settingsProfileRenamingId = null;
      settingsProfileDeletingId = id;
      settingsProfileError = '';
      renderSettingsProfilesSection();
    });
  });

  container.querySelectorAll('.cancel-delete-profile').forEach((btn) => {
    btn.addEventListener('click', () => {
      settingsProfileDeletingId = null;
      renderSettingsProfilesSection();
    });
  });

  container.querySelectorAll('.confirm-delete-profile').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.profileId;
      if (!id || id === 'default') return;
      btn.disabled = true;
      const res = await window.gxChromePagesAPI.deleteProfile(id);
      settingsProfileDeletingId = null;
      if (!res || !res.ok) {
        settingsProfileBanner = {
          kind: 'error',
          title: 'Could not delete profile',
          detail: res?.error || 'Unknown error.'
        };
      } else {
        settingsProfileBanner = {
          kind: 'success',
          title: 'Profile deleted',
          detail: 'Profile data directory and isolated session storage were removed.'
        };
      }
      settingsProfilesData = await window.gxChromePagesAPI.listProfiles();
      renderSettingsProfilesSection();
    });
  });
}

function validateHomepageInput(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed || /^(?:nextgx|gx|chrome):\/\/newtab\/?$/i.test(trimmed)) {
    return { ok: true, url: '' };
  }
  if (/^(javascript|data|vbscript|file|chrome|nextgx|gx|about|ftp|mailto|blob):/i.test(trimmed)) {
    return { ok: false, error: 'Please enter a valid http(s) URL (or leave empty for Start Page).' };
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) {
      return { ok: false, error: 'Please enter a valid http(s) URL (or leave empty for Start Page).' };
    }
    return { ok: true, url: withScheme };
  } catch (_) {
    return { ok: false, error: 'Please enter a valid http(s) URL (or leave empty for Start Page).' };
  }
}

function renderCookieDomainsList(force = true) {
  const container = document.getElementById('cookieDomainsContainer');
  const totalBadge = document.getElementById('totalCookieCountBadge');
  const clearAllBtn = document.getElementById('btnClearAllCookies');
  const clearAllConfirmWrap = document.getElementById('clearAllCookiesConfirm');
  if (!container) return;

  const domainMap = new Map();
  for (const c of settingsCookies) {
    const dom = String(c.domain || '')
      .trim()
      .toLowerCase()
      .replace(/^\.+/, '') || '(unknown)';
    domainMap.set(dom, (domainMap.get(dom) || 0) + 1);
  }

  const activeQuery = (cookieFilterText || searchQuery || '').trim().toLowerCase();
  const entries = Array.from(domainMap.entries())
    .filter(([dom]) => !activeQuery || dom.includes(activeQuery))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const renderKey = JSON.stringify({
    total: settingsCookies.length,
    q: activeQuery,
    entries
  });
  if (!force && renderKey === lastCookiesRenderKey) return;
  lastCookiesRenderKey = renderKey;

  if (totalBadge) {
    totalBadge.textContent = `${settingsCookies.length} ${settingsCookies.length === 1 ? 'cookie' : 'cookies'}`;
  }
  if (clearAllBtn) {
    clearAllBtn.disabled = settingsCookies.length === 0;
  }
  if (settingsCookies.length === 0 && clearAllConfirmWrap) {
    clearAllConfirmWrap.style.display = 'none';
    if (clearAllBtn) clearAllBtn.style.display = '';
  }

  if (!entries.length) {
    container.innerHTML = `<div class="empty-state" style="padding:24px;">${
      settingsCookies.length === 0 ? 'No cookies stored.' : 'No domains match your filter.'
    }</div>`;
    return;
  }

  let rowsHtml = '';
  for (const [domain, count] of entries) {
    rowsHtml += `
      <div class="card-row cookie-domain-row" data-domain="${escapeHtml(domain)}">
        <div class="row-info">
          <div class="row-title" style="cursor:default;">${escapeHtml(domain)}</div>
          <div class="row-sub">${count} ${count === 1 ? 'cookie' : 'cookies'}</div>
        </div>
        <button class="btn danger clear-site-cookies-btn" data-domain="${escapeHtml(domain)}">Clear</button>
      </div>
    `;
  }
  container.innerHTML = rowsHtml;

  container.querySelectorAll('.clear-site-cookies-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const domain = btn.dataset.domain;
      if (!domain) return;
      await window.gxChromePagesAPI.clearSiteCookies(domain);
      await refreshSettingsCookies({ force: true });
    });
  });
}

async function refreshSettingsCookies({ force = false } = {}) {
  if (currentPage !== 'settings' || !window.gxChromePagesAPI?.getCookies) return;
  const seq = ++cookieRefreshSeq;
  const list = await window.gxChromePagesAPI.getCookies();
  if (seq !== cookieRefreshSeq || currentPage !== 'settings') return;
  settingsCookies = Array.isArray(list) ? list : [];
  renderCookieDomainsList(force);
}

async function renderSettingsPage() {
  const seq = ++renderSeq;
  const [s, sys, ad, allCookies, adblockSites, profData] = await Promise.all([
    window.gxChromePagesAPI.getSettings(),
    window.gxChromePagesAPI.getSystemStats(),
    window.gxChromePagesAPI.getAdblockStats(),
    window.gxChromePagesAPI.getCookies ? window.gxChromePagesAPI.getCookies() : Promise.resolve([]),
    window.gxChromePagesAPI.getAdblockSites ? window.gxChromePagesAPI.getAdblockSites() : Promise.resolve({}),
    window.gxChromePagesAPI.listProfiles ? window.gxChromePagesAPI.listProfiles() : Promise.resolve(null)
  ]);
  if (seq !== renderSeq || currentPage !== 'settings') return;
  settingsProfilesData = profData;

  settingsCookies = Array.isArray(allCookies) ? allCookies : [];
  const masterAdblockOn = ad ? ad.enabled !== false : s.adblockEnabled !== false;
  const trackersActive = Boolean(
    masterAdblockOn &&
      (typeof ad?.trackerBlockEnabled === 'boolean'
        ? ad.trackerBlockEnabled
        : s.trackerBlockEnabled !== false)
  );
  const pausedOrigins = Object.entries(adblockSites && typeof adblockSites === 'object' ? adblockSites : {})
    .filter(([, entry]) => (typeof entry === 'boolean' ? entry === false : entry && entry.enabled === false))
    .map(([origin]) => origin)
    .sort((a, b) => a.localeCompare(b));

  const pausedSitesHtml = pausedOrigins.length
    ? `
      <div class="card-row" style="flex-direction:column;align-items:stretch;gap:8px;">
        <div class="row-info">
          <div class="row-title" style="cursor:default;">Paused Sites (Allowlist)</div>
          <div class="row-sub">Blocking is turned off on these origins</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${pausedOrigins
            .map(
              (origin) => `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 10px;background:var(--bg-input);border:1px solid var(--border);border-radius:7px;">
              <span style="font-size:12.5px;word-break:break-all;">${escapeHtml(origin)}</span>
              <button class="btn reenable-adblock-site" data-origin="${escapeHtml(origin)}">Re-enable</button>
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    `
    : '';

  const soundsEnabled = s.uiSoundsEnabled !== false;
  const soundsVolPct = Math.round(
    Math.max(0, Math.min(1, typeof s.uiSoundsVolume === 'number' ? s.uiSoundsVolume : 0.35)) * 100
  );
  const autoSleepEnabled = s.autoSleepEnabled !== false;
  const autoSleepMins = Number(s.autoSleepMinutes || 10);

  const settingsIoBannerHtml = settingsIoBanner
    ? `
      <div class="card-row">
        <div class="ext-banner ${escapeHtml(settingsIoBanner.kind || 'info')}" id="settingsIoBanner" style="margin-bottom:0;width:100%;" role="status">
          <div>
            <div class="ext-banner-title">${escapeHtml(settingsIoBanner.title)}</div>
            ${settingsIoBanner.detail ? `<div class="ext-banner-detail">${escapeHtml(settingsIoBanner.detail)}</div>` : ''}
          </div>
          <button type="button" class="btn" id="btnDismissSettingsIoBanner">Dismiss</button>
        </div>
      </div>
    `
    : '';

  mainContainer.innerHTML = `
    <div class="section-card" id="profilesSettingsCard">
      <div class="card-header">
        <h2 class="nx-heading">Profiles (Local)</h2>
        <button type="button" class="btn primary" id="btnSettingsAddProfile">+ Add Profile</button>
      </div>
      <div id="profilesSettingsBody"></div>
    </div>

    <div class="section-card">
      <div class="card-header"><h2 class="nx-heading">Appearance, Sound & Behavior</h2></div>
      <div class="card-row" style="flex-wrap:wrap;align-items:flex-start;">
        <div class="row-info" style="min-width:180px;">
          <div class="row-title">nextGx Theme</div>
          <div class="row-sub">Choose your browser accent</div>
        </div>
        <div class="nx-segmented theme-seg-wrap" id="setThemeSeg">
          <button type="button" class="seg-btn ${s.theme === 'gx-violet' ? 'active' : ''}" data-theme="gx-violet"><span class="theme-dot gx-violet"></span>nextGx Violet</button>
          <button type="button" class="seg-btn ${s.theme === 'crimson' ? 'active' : ''}" data-theme="crimson"><span class="theme-dot crimson"></span>Crimson</button>
          <button type="button" class="seg-btn ${s.theme === 'cyan' ? 'active' : ''}" data-theme="cyan"><span class="theme-dot cyan"></span>Cyber Cyan</button>
          <button type="button" class="seg-btn ${s.theme === 'emerald' ? 'active' : ''}" data-theme="emerald"><span class="theme-dot emerald"></span>Emerald</button>
          <button type="button" class="seg-btn ${s.theme === 'magenta' ? 'active' : ''}" data-theme="magenta"><span class="theme-dot magenta"></span>Magenta</button>
          <button type="button" class="seg-btn ${s.theme === 'amber' ? 'active' : ''}" data-theme="amber"><span class="theme-dot amber"></span>Amber</button>
          <button type="button" class="seg-btn ${s.theme === 'lime' ? 'active' : ''}" data-theme="lime"><span class="theme-dot lime"></span>Lime</button>
          <button type="button" class="seg-btn ${s.theme === 'ice' ? 'active' : ''}" data-theme="ice"><span class="theme-dot ice"></span>Ice</button>
        </div>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Show Bookmarks Bar</div>
          <div class="row-sub">Display a slim bookmarks strip beneath the address bar</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setBookmarksBarChk" ${s.showBookmarksBar !== false ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Show GX Corner in Sidebar Rail</div>
          <div class="row-sub">Quick-launch gaming news, upcoming releases, deals &amp; free games (nextgx://corner)</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setGxCornerRailChk" ${s.sidebarItems?.gxCorner !== false ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
      <div class="card-row sounds-settings-row">
        <div class="sounds-row-top">
          <div class="row-info">
            <div class="row-title">GX Sound Effects</div>
            <div class="row-sub">Subtle clicks, tab open/close, panel & notification sounds</div>
          </div>
          <div class="nx-segmented" id="setSoundsModeSeg" role="radiogroup" aria-label="GX Sound Effects">
            <button type="button" class="seg-btn ${soundsEnabled ? 'active' : ''}" data-sounds-mode="gx" aria-pressed="${soundsEnabled ? 'true' : 'false'}">GX default</button>
            <button type="button" class="seg-btn ${!soundsEnabled ? 'active' : ''}" data-sounds-mode="off" aria-pressed="${!soundsEnabled ? 'true' : 'false'}">Off</button>
          </div>
        </div>
        <div class="sounds-volume-row ${soundsEnabled ? '' : 'is-disabled'}" id="setSoundsVolumeRow">
          <label class="sounds-vol-label" for="setSoundsVolumeSlider">Volume</label>
          <input
            type="range"
            id="setSoundsVolumeSlider"
            class="nx-range"
            min="0"
            max="100"
            step="1"
            value="${soundsVolPct}"
            ${soundsEnabled ? '' : 'disabled'}
            aria-label="GX sounds volume"
          />
          <span class="sounds-vol-value nx-mono" id="setSoundsVolumeVal">${soundsVolPct}%</span>
        </div>
        <div class="nx-empty-inline ${soundsEnabled ? 'hidden' : ''}" id="setSoundsOffState" role="status">
          <div class="nx-empty-inline-left">
            <div class="nx-empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            </div>
            <span class="nx-empty-copy">Sounds are off — turn them on to hear GX sounds</span>
          </div>
          <button type="button" class="btn primary" id="btnEnableSounds">Turn on GX sounds</button>
        </div>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Close Browser Window on Last Tab</div>
          <div class="row-sub">Closes the window when you close the final remaining tab</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setCloseLastTabChk" ${s.closeWindowOnLastTab !== false ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Force Dark Appearance on Websites</div>
          <div class="row-sub">Automatically applies dark mode to bright pages</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setDarkWebChk" ${s.forceDarkWeb ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
    </div>

    <div class="section-card">
      <div class="card-header"><h2 class="nx-heading">Startup & Homepage</h2></div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Restore previous session on startup</div>
          <div class="row-sub">Reopen tabs from your last browsing session when nextGx Browser launches</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setRestoreSessionChk" ${s.restoreSession !== false ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
      <div class="card-row" style="flex-wrap:wrap;">
        <div class="row-info" style="min-width:220px;">
          <div class="row-title">Homepage</div>
          <div class="row-sub">Page opened by the toolbar Home button (leave empty for Speed Dial / nextgx://newtab)</div>
          <div class="settings-form-msg" id="setHomepageMsg" style="display:none;"></div>
        </div>
        <form id="setHomepageForm" class="settings-homepage-form">
          <input
            type="text"
            id="setHomepageInput"
            class="input-box settings-homepage-input"
            placeholder="nextgx://newtab (Speed Dial)"
            value="${escapeHtml(s.homepageUrl || '')}"
            autocomplete="off"
            spellcheck="false"
          />
          <button type="submit" class="btn primary" id="btnSaveHomepage">Save</button>
          <button type="button" class="btn" id="btnResetHomepage"${s.homepageUrl ? '' : ' disabled'}>Reset</button>
        </form>
      </div>
    </div>

    <div class="section-card">
      <div class="card-header"><h2 class="nx-heading">Search Engine</h2></div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Default Address Bar Search Engine</div>
        </div>
        <div class="nx-segmented" id="setSearchSeg">
          <button class="seg-btn ${s.searchEngine === 'google' ? 'active' : ''}" data-engine="google">Google</button>
          <button class="seg-btn ${s.searchEngine === 'duckduckgo' ? 'active' : ''}" data-engine="duckduckgo">DuckDuckGo</button>
          <button class="seg-btn ${s.searchEngine === 'bing' ? 'active' : ''}" data-engine="bing">Bing</button>
        </div>
      </div>
    </div>

    <div class="section-card">
      <div class="card-header"><h2 class="nx-heading">Privacy Shield & Security</h2></div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Privacy &amp; Security Dashboard</div>
          <div class="row-sub">View live blocked ads &amp; trackers breakdown, per-site permissions, and security posture (nextgx://privacy)</div>
        </div>
        <button type="button" class="btn primary" id="btnOpenPrivacyDashboard">Open Dashboard</button>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">nextGx Built-in Ad Blocker</div>
          <div class="row-sub">Blocks ad networks & cosmetic ad slots — Blocked ${ad?.sessionBlocked || 0} this session (${ad?.totalBlocked || 0} lifetime)</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setAdblockChk" ${masterAdblockOn ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Block Analytics & Trackers</div>
          <div class="row-sub">Blocks analytics, telemetry, session replay & tracking pixels while the ad blocker is on</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setTrackerBlockChk" ${trackersActive ? 'checked' : ''} ${masterAdblockOn ? '' : 'disabled'} />
          <span class="nx-slider"></span>
        </label>
      </div>
      ${pausedSitesHtml}
      <div class="card-row" id="settingsClearDataRow" style="flex-wrap:wrap;">
        <div class="row-info">
          <div class="row-title">Clear Browsing Data & Cache</div>
          <div class="row-sub">Select data types to remove from your browser</div>
          <div style="display:flex;gap:16px;margin-top:8px;font-size:12.5px;color:var(--text-primary);">
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
              <input type="checkbox" id="chkSetClearCache" checked /> Cache
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
              <input type="checkbox" id="chkSetClearHistory" checked /> Browsing History
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
              <input type="checkbox" id="chkSetClearCookies" checked /> Cookies & Site Data
            </label>
          </div>
        </div>
        <button class="btn danger" id="btnSetClearData">Clear Data Now</button>
      </div>
    </div>

    <div class="section-card" id="cookiesSettingsCard">
      <div class="card-header" style="flex-wrap:wrap;">
        <h2 class="nx-heading">Cookies & Site Data (<span id="totalCookieCountBadge">${settingsCookies.length}</span>)</h2>
        <div style="display:flex;align-items:center;gap:10px;">
          <input
            type="text"
            id="cookieSearchInput"
            class="input-box"
            placeholder="Filter cookies by domain..."
            value="${escapeHtml(cookieFilterText)}"
            style="width:220px;padding:6px 10px;font-size:12.5px;"
          />
          <button class="btn danger" id="btnClearAllCookies">Clear All Cookies</button>
          <span id="clearAllCookiesConfirm" style="display:none;align-items:center;gap:6px;">
            <span style="font-size:12px;color:var(--text-secondary);">Confirm?</span>
            <button class="btn danger" id="btnConfirmClearAllCookies">Yes, Clear All</button>
            <button class="btn" id="btnCancelClearAllCookies">Cancel</button>
          </span>
        </div>
      </div>
      <div id="cookieDomainsContainer"></div>
    </div>

    <div class="section-card">
      <div class="card-header"><h2 class="nx-heading">Performance & 8 GB Memory Saver</h2></div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Auto-Memory Saver (Background Tab Hibernation)</div>
          <div class="row-sub">Browser RAM: ${sys?.browserRamMB || '--'} MB • System RAM: ${sys?.usedSysMB || '--'} / ${sys?.totalSysMB || '--'} MB</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setAutoSleepChk" ${s.autoSleepEnabled !== false ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Suspend idle background tabs after</div>
          <div class="row-sub">Active, pinned, and audio-playing tabs are never hibernated</div>
        </div>
        <div class="nx-segmented ${autoSleepEnabled ? '' : 'is-disabled'}" id="setAutoSleepMinsSeg" role="radiogroup" aria-label="Idle tab hibernation delay" aria-disabled="${autoSleepEnabled ? 'false' : 'true'}">
          <button type="button" class="seg-btn ${autoSleepMins === 2 ? 'active' : ''}" data-mins="2" aria-pressed="${autoSleepMins === 2 ? 'true' : 'false'}" ${autoSleepEnabled ? '' : 'disabled'}>2m</button>
          <button type="button" class="seg-btn ${autoSleepMins === 5 ? 'active' : ''}" data-mins="5" aria-pressed="${autoSleepMins === 5 ? 'true' : 'false'}" ${autoSleepEnabled ? '' : 'disabled'}>5m</button>
          <button type="button" class="seg-btn ${autoSleepMins === 10 ? 'active' : ''}" data-mins="10" aria-pressed="${autoSleepMins === 10 ? 'true' : 'false'}" ${autoSleepEnabled ? '' : 'disabled'}>10m</button>
          <button type="button" class="seg-btn ${autoSleepMins === 20 ? 'active' : ''}" data-mins="20" aria-pressed="${autoSleepMins === 20 ? 'true' : 'false'}" ${autoSleepEnabled ? '' : 'disabled'}>20m</button>
        </div>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Hibernate all inactive background tabs now</div>
        </div>
        <button class="btn primary" id="btnSetSleepNow">Hibernate Background Tabs</button>
      </div>
    </div>

    <div class="section-card" id="settingsImportExportCard">
      <div class="card-header"><h2 class="nx-heading">Backup &amp; Restore Settings</h2></div>
      ${settingsIoBannerHtml}
      <div class="card-row" style="flex-wrap:wrap;">
        <div class="row-info" style="min-width:220px;">
          <div class="row-title">Export or Import Settings (JSON)</div>
          <div class="row-sub">Exports active profile settings (theme, sidebar layout, search engine, privacy &amp; performance options). Import validates keys and types against defaults.</div>
        </div>
        <div class="io-actions-group">
          <button type="button" class="btn" id="btnExportSettingsJson">Export JSON</button>
          <button type="button" class="btn primary" id="btnImportSettingsJson">Import JSON</button>
        </div>
      </div>
    </div>

    <div class="section-card">
      <div class="card-header"><h2 class="nx-heading">About nextGx Browser</h2></div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">nextGx Browser v3.0.0 (64-bit) — Powered by Chromium Engine v156.0.8078.100</div>
          <div class="row-sub">Designed for Linux & Windows (Microsoft Store MSIX Ready)</div>
        </div>
      </div>
    </div>
  `;

  renderSettingsProfilesSection();
  renderCookieDomainsList(true);

  const btnSettingsAddProfile = document.getElementById('btnSettingsAddProfile');
  if (btnSettingsAddProfile) {
    btnSettingsAddProfile.addEventListener('click', () => {
      const existing = Array.isArray(settingsProfilesData?.profiles) ? settingsProfilesData.profiles : [];
      const used = new Set(existing.map((p) => p.color));
      settingsProfileCreateColor =
        WEBUI_PROFILE_COLORS.find((c) => !used.has(c.id))?.id ||
        WEBUI_PROFILE_COLORS[existing.length % WEBUI_PROFILE_COLORS.length].id;
      settingsProfileCreateOpen = !settingsProfileCreateOpen;
      settingsProfileRenamingId = null;
      settingsProfileDeletingId = null;
      settingsProfileError = '';
      renderSettingsProfilesSection();
    });
  }

  const btnDismissSettingsIoBanner = document.getElementById('btnDismissSettingsIoBanner');
  if (btnDismissSettingsIoBanner) {
    btnDismissSettingsIoBanner.addEventListener('click', () => {
      settingsIoBanner = null;
      renderSettingsPage();
    });
  }

  const btnExportSettingsJson = document.getElementById('btnExportSettingsJson');
  if (btnExportSettingsJson) {
    btnExportSettingsJson.addEventListener('click', async () => {
      if (!window.gxChromePagesAPI.exportSettingsJson) return;
      const res = await window.gxChromePagesAPI.exportSettingsJson();
      if (!res || res.canceled) return;
      if (!res.ok) {
        settingsIoBanner = {
          kind: 'error',
          title: 'Settings export failed',
          detail: res.error || 'Could not export settings.'
        };
      } else {
        settingsIoBanner = {
          kind: 'success',
          title: 'Settings exported',
          detail: res.fileName ? `Saved JSON settings file: ${res.fileName}` : 'Saved JSON settings file.'
        };
      }
      renderSettingsPage();
    });
  }

  const btnImportSettingsJson = document.getElementById('btnImportSettingsJson');
  if (btnImportSettingsJson) {
    btnImportSettingsJson.addEventListener('click', async () => {
      if (!window.gxChromePagesAPI.importSettingsJson) return;
      const res = await window.gxChromePagesAPI.importSettingsJson();
      if (!res || res.canceled) return;
      if (!res.ok) {
        settingsIoBanner = {
          kind: 'error',
          title: 'Settings import failed',
          detail: res.error || 'Could not import settings.'
        };
      } else {
        settingsIoBanner = {
          kind: 'success',
          title: `Imported ${res.appliedCount} setting(s)`,
          detail: `${res.ignoredCount || 0} unknown or invalid key(s) ignored${res.fileName ? ` from ${res.fileName}` : ''}. Applied immediately.`
        };
      }
      renderSettingsPage();
    });
  }

  const cookieSearchInput = document.getElementById('cookieSearchInput');
  if (cookieSearchInput) {
    cookieSearchInput.addEventListener('input', (e) => {
      cookieFilterText = e.target.value;
      renderCookieDomainsList(true);
    });
  }

  const btnClearAllCookies = document.getElementById('btnClearAllCookies');
  const clearAllConfirmWrap = document.getElementById('clearAllCookiesConfirm');
  const btnConfirmClearAll = document.getElementById('btnConfirmClearAllCookies');
  const btnCancelClearAll = document.getElementById('btnCancelClearAllCookies');

  if (btnClearAllCookies && clearAllConfirmWrap) {
    btnClearAllCookies.addEventListener('click', () => {
      if (settingsCookies.length === 0) return;
      btnClearAllCookies.style.display = 'none';
      clearAllConfirmWrap.style.display = 'inline-flex';
    });
    btnCancelClearAll.addEventListener('click', () => {
      clearAllConfirmWrap.style.display = 'none';
      btnClearAllCookies.style.display = '';
    });
    btnConfirmClearAll.addEventListener('click', async () => {
      await window.gxChromePagesAPI.clearAllCookies();
      clearAllConfirmWrap.style.display = 'none';
      btnClearAllCookies.style.display = '';
      await refreshSettingsCookies({ force: true });
    });
  }

  mainContainer.querySelectorAll('#setThemeSeg .seg-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const theme = btn.dataset.theme;
      applyTheme(theme);
      await window.gxChromePagesAPI.updateSettings({ theme });
    });
  });

  mainContainer.querySelectorAll('#setSearchSeg .seg-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await window.gxChromePagesAPI.updateSettings({ searchEngine: btn.dataset.engine });
      renderSettingsPage();
    });
  });

  document.getElementById('setBookmarksBarChk').addEventListener('change', (e) => {
    window.gxChromePagesAPI.updateSettings({ showBookmarksBar: e.target.checked });
  });

  const setGxCornerRailChk = document.getElementById('setGxCornerRailChk');
  if (setGxCornerRailChk) {
    setGxCornerRailChk.addEventListener('change', (e) => {
      window.gxChromePagesAPI.updateSettings({ sidebarItems: { gxCorner: e.target.checked } });
    });
  }

  const applySoundsEnabledChoice = async (enabled) => {
    const slider = document.getElementById('setSoundsVolumeSlider');
    const vol = slider ? Math.max(0, Math.min(1, Number(slider.value) / 100)) : 0.35;
    syncSoundsConfig({ uiSoundsEnabled: enabled, uiSoundsVolume: vol });
    syncSoundsSettingsControls({ uiSoundsEnabled: enabled, uiSoundsVolume: vol });
    await window.gxChromePagesAPI.updateSettings({ uiSoundsEnabled: enabled });
    if (enabled) window.gxSounds?.playClick();
  };

  mainContainer.querySelectorAll('#setSoundsModeSeg .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      applySoundsEnabledChoice(btn.dataset.soundsMode !== 'off');
    });
  });

  const btnEnableSounds = document.getElementById('btnEnableSounds');
  if (btnEnableSounds) {
    btnEnableSounds.addEventListener('click', () => {
      applySoundsEnabledChoice(true);
    });
  }

  const soundsVolSlider = document.getElementById('setSoundsVolumeSlider');
  const soundsVolVal = document.getElementById('setSoundsVolumeVal');
  if (soundsVolSlider) {
    let volSaveTimer = null;
    soundsVolSlider.addEventListener('input', (e) => {
      const pct = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0)));
      const vol = pct / 100;
      if (soundsVolVal) soundsVolVal.textContent = `${pct}%`;
      window.gxSounds?.setConfig({ volume: vol });
      clearTimeout(volSaveTimer);
      volSaveTimer = setTimeout(() => {
        window.gxChromePagesAPI.updateSettings({ uiSoundsVolume: vol });
      }, 120);
    });
    soundsVolSlider.addEventListener('change', async (e) => {
      clearTimeout(volSaveTimer);
      const pct = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0)));
      const vol = pct / 100;
      if (soundsVolVal) soundsVolVal.textContent = `${pct}%`;
      window.gxSounds?.setConfig({ volume: vol });
      await window.gxChromePagesAPI.updateSettings({ uiSoundsVolume: vol });
      window.gxSounds?.playClick();
    });
  }
  document.getElementById('setCloseLastTabChk').addEventListener('change', (e) => {
    window.gxChromePagesAPI.updateSettings({ closeWindowOnLastTab: e.target.checked });
  });
  document.getElementById('setDarkWebChk').addEventListener('change', (e) => {
    window.gxChromePagesAPI.updateSettings({ forceDarkWeb: e.target.checked });
  });

  const setRestoreSessionChk = document.getElementById('setRestoreSessionChk');
  if (setRestoreSessionChk) {
    setRestoreSessionChk.addEventListener('change', (e) => {
      window.gxChromePagesAPI.updateSettings({ restoreSession: e.target.checked });
    });
  }

  const homepageForm = document.getElementById('setHomepageForm');
  const homepageInput = document.getElementById('setHomepageInput');
  const homepageMsg = document.getElementById('setHomepageMsg');
  const btnResetHomepage = document.getElementById('btnResetHomepage');

  const showHomepageMsg = (text, kind) => {
    if (!homepageMsg) return;
    if (!text) {
      homepageMsg.textContent = '';
      homepageMsg.className = 'settings-form-msg';
      homepageMsg.style.display = 'none';
      return;
    }
    homepageMsg.textContent = text;
    homepageMsg.className = `settings-form-msg ${kind || ''}`.trim();
    homepageMsg.style.display = 'block';
  };

  if (homepageInput) {
    homepageInput.addEventListener('input', () => {
      showHomepageMsg('');
    });
  }

  if (homepageForm && homepageInput) {
    homepageForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const check = validateHomepageInput(homepageInput.value);
      if (!check.ok) {
        showHomepageMsg(check.error, 'error');
        return;
      }
      const updated = await window.gxChromePagesAPI.updateSettings({ homepageUrl: check.url });
      const savedUrl =
        updated && typeof updated.homepageUrl === 'string' ? updated.homepageUrl : check.url;
      homepageInput.value = savedUrl;
      if (btnResetHomepage) btnResetHomepage.disabled = !savedUrl;
      showHomepageMsg(
        savedUrl ? `Homepage saved: ${savedUrl}` : 'Homepage reset to Speed Dial (nextgx://newtab).',
        'success'
      );
    });
  }

  if (btnResetHomepage && homepageInput) {
    btnResetHomepage.addEventListener('click', async () => {
      const updated = await window.gxChromePagesAPI.updateSettings({ homepageUrl: '' });
      const savedUrl = updated && typeof updated.homepageUrl === 'string' ? updated.homepageUrl : '';
      homepageInput.value = savedUrl;
      btnResetHomepage.disabled = !savedUrl;
      showHomepageMsg('Homepage reset to Speed Dial (nextgx://newtab).', 'success');
    });
  }
  document.getElementById('btnOpenPrivacyDashboard')?.addEventListener('click', () => {
    switchPage('privacy');
  });

  const setTrackerChk = document.getElementById('setTrackerBlockChk');
  document.getElementById('setAdblockChk').addEventListener('change', async (e) => {
    const stats = await window.gxChromePagesAPI.toggleAdblock(e.target.checked);
    if (setTrackerChk && stats) {
      setTrackerChk.disabled = !stats.enabled;
      setTrackerChk.checked = Boolean(stats.trackerBlockEnabled);
    }
  });
  if (setTrackerChk) {
    setTrackerChk.addEventListener('change', (e) => {
      if (window.gxChromePagesAPI.toggleTrackerBlock) {
        window.gxChromePagesAPI.toggleTrackerBlock(e.target.checked);
      } else {
        window.gxChromePagesAPI.updateSettings({ trackerBlockEnabled: e.target.checked });
      }
    });
  }
  mainContainer.querySelectorAll('.reenable-adblock-site').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const origin = btn.dataset.origin;
      if (!origin || !window.gxChromePagesAPI.setAdblockSite) return;
      await window.gxChromePagesAPI.setAdblockSite(origin, true);
      renderSettingsPage();
    });
  });
  document.getElementById('setAutoSleepChk').addEventListener('change', (e) => {
    syncAutoSleepSegmentDisabled(e.target.checked);
    window.gxChromePagesAPI.updateSettings({ autoSleepEnabled: e.target.checked });
  });
  mainContainer.querySelectorAll('#setAutoSleepMinsSeg .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const mins = Number(btn.dataset.mins);
      mainContainer.querySelectorAll('#setAutoSleepMinsSeg .seg-btn').forEach((b) => {
        const isActive = Number(b.dataset.mins) === mins;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
      window.gxChromePagesAPI.updateSettings({ autoSleepMinutes: mins });
    });
  });
  document.getElementById('btnSetClearData').addEventListener('click', async () => {
    const cache = document.getElementById('chkSetClearCache')?.checked ?? true;
    const history = document.getElementById('chkSetClearHistory')?.checked ?? true;
    const cookies = document.getElementById('chkSetClearCookies')?.checked ?? false;
    await window.gxChromePagesAPI.clearBrowsingData({ cache, cookies, history });
    document.getElementById('btnSetClearData').textContent = 'Cleared!';
    if (cookies) {
      await refreshSettingsCookies({ force: true });
    }
  });
  document.getElementById('btnSetSleepNow').addEventListener('click', async () => {
    await window.gxChromePagesAPI.sleepBackgroundTabs();
    renderSettingsPage();
  });

  if (pendingSettingsScrollTarget) {
    const targetId = pendingSettingsScrollTarget;
    pendingSettingsScrollTarget = '';
    const el = document.getElementById(targetId);
    if (el) {
      const highlightEl = el.closest('.card-row') || el;
      requestAnimationFrame(() => {
        highlightEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        highlightEl.classList.add('settings-highlight-flash');
        setTimeout(() => highlightEl.classList.remove('settings-highlight-flash'), 1600);
      });
    }
  }
}

function refreshVisiblePage() {
  if (!window.gxChromePagesAPI) return;
  if (currentPage === 'history') {
    renderHistoryPage({ force: false });
  } else if (currentPage === 'settings') {
    refreshSettingsCookies({ force: false });
  } else if (currentPage === 'privacy') {
    renderPrivacyPage({ force: false });
  } else if (currentPage === 'downloads') {
    renderDownloadsPage({ force: false });
  } else if (currentPage === 'bookmarks') {
    if (!addingBookmarkOpen && !renamingFolderName && !editingBookmarkId) {
      renderBookmarksPage({ force: false });
    }
  }
}

function syncSoundsConfig(s) {
  if (!s || typeof s !== 'object') return;
  const cfg = {};
  if (typeof s.uiSoundsEnabled === 'boolean') cfg.enabled = s.uiSoundsEnabled;
  if (typeof s.uiSoundsVolume === 'number' && Number.isFinite(s.uiSoundsVolume)) {
    cfg.volume = Math.max(0, Math.min(1, s.uiSoundsVolume));
  }
  window.gxSounds?.setConfig(cfg);
}

function syncAutoSleepSegmentDisabled(enabled) {
  const seg = document.getElementById('setAutoSleepMinsSeg');
  if (!seg) return;
  const isOn = Boolean(enabled);
  seg.classList.toggle('is-disabled', !isOn);
  seg.setAttribute('aria-disabled', isOn ? 'false' : 'true');
  seg.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.disabled = !isOn;
  });
}

function syncSoundsSettingsControls(s) {
  if (!s || typeof s !== 'object') return;
  if (typeof s.uiSoundsEnabled === 'boolean') {
    const enabled = s.uiSoundsEnabled;
    document.querySelectorAll('#setSoundsModeSeg .seg-btn').forEach((btn) => {
      const isActive = (btn.dataset.soundsMode !== 'off') === enabled;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    const volSlider = document.getElementById('setSoundsVolumeSlider');
    if (volSlider) volSlider.disabled = !enabled;
    const volRow = document.getElementById('setSoundsVolumeRow');
    if (volRow) volRow.classList.toggle('is-disabled', !enabled);
    const offState = document.getElementById('setSoundsOffState');
    if (offState) offState.classList.toggle('hidden', enabled);
  }
  if (typeof s.uiSoundsVolume === 'number' && Number.isFinite(s.uiSoundsVolume)) {
    const pct = Math.round(Math.max(0, Math.min(1, s.uiSoundsVolume)) * 100);
    const volSlider = document.getElementById('setSoundsVolumeSlider');
    if (volSlider && document.activeElement !== volSlider) {
      volSlider.value = String(pct);
    }
    const volVal = document.getElementById('setSoundsVolumeVal');
    if (volVal) volVal.textContent = `${pct}%`;
  }
}

function applyTheme(theme) {
  const resolved = theme || 'gx-violet';
  document.documentElement.setAttribute('data-theme', resolved);
  document.querySelectorAll('#setThemeSeg .seg-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === resolved);
  });
}

function initThemeSync() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('incognito') === '1') {
    document.documentElement.setAttribute('data-incognito', 'true');
  }
  const initialTheme = params.get('theme');
  if (initialTheme) {
    applyTheme(initialTheme);
  }
  if (window.gxChromePagesAPI?.getSettings) {
    window.gxChromePagesAPI
      .getSettings()
      .then((s) => {
        applyTheme(s?.theme);
        syncSoundsConfig(s);
      })
      .catch(() => {});
  }
  if (window.gxChromePagesAPI?.onSettingsUpdate) {
    window.gxChromePagesAPI.onSettingsUpdate((s) => {
      if (s && s.theme) applyTheme(s.theme);
      syncSoundsConfig(s);
      syncSoundsSettingsControls(s);
      const bmChk = document.getElementById('setBookmarksBarChk');
      if (bmChk && s && typeof s.showBookmarksBar === 'boolean') {
        bmChk.checked = s.showBookmarksBar;
      }
      const cornerRailChk = document.getElementById('setGxCornerRailChk');
      if (cornerRailChk && s && s.sidebarItems && typeof s.sidebarItems.gxCorner === 'boolean') {
        cornerRailChk.checked = s.sidebarItems.gxCorner;
      }
      const closeLastChk = document.getElementById('setCloseLastTabChk');
      if (closeLastChk && s && typeof s.closeWindowOnLastTab === 'boolean') {
        closeLastChk.checked = s.closeWindowOnLastTab;
      }
      const darkWebChk = document.getElementById('setDarkWebChk');
      if (darkWebChk && s && typeof s.forceDarkWeb === 'boolean') {
        darkWebChk.checked = s.forceDarkWeb;
      }
      const autoSleepChk = document.getElementById('setAutoSleepChk');
      if (s && typeof s.autoSleepEnabled === 'boolean') {
        if (autoSleepChk) autoSleepChk.checked = s.autoSleepEnabled;
        syncAutoSleepSegmentDisabled(s.autoSleepEnabled);
      }
      if (s && typeof s.autoSleepMinutes === 'number' && Number.isFinite(s.autoSleepMinutes)) {
        document.querySelectorAll('#setAutoSleepMinsSeg .seg-btn').forEach((btn) => {
          const isActive = Number(btn.dataset.mins) === Number(s.autoSleepMinutes);
          btn.classList.toggle('active', isActive);
          btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
      }
      const restoreChk = document.getElementById('setRestoreSessionChk');
      if (restoreChk && s && typeof s.restoreSession === 'boolean') {
        restoreChk.checked = s.restoreSession;
      }
      const homeInp = document.getElementById('setHomepageInput');
      if (homeInp && s && typeof s.homepageUrl === 'string' && document.activeElement !== homeInp) {
        homeInp.value = s.homepageUrl;
        const resetBtn = document.getElementById('btnResetHomepage');
        if (resetBtn) {
          resetBtn.disabled = !s.homepageUrl;
        }
      }
      if (s && typeof s.searchEngine === 'string') {
        document.querySelectorAll('#setSearchSeg .seg-btn').forEach((btn) => {
          btn.classList.toggle('active', btn.dataset.engine === s.searchEngine);
        });
      }
      if (currentPage === 'privacy') {
        renderPrivacyPage({ force: false });
      }
    });
  }
  if (window.gxChromePagesAPI?.onBookmarksUpdate) {
    window.gxChromePagesAPI.onBookmarksUpdate((list) => {
      if (currentPage !== 'bookmarks') return;
      if (addingBookmarkOpen || renamingFolderName) return;
      if (editingBookmarkId) {
        const stillExists = Array.isArray(list) && list.some((b) => b && b.id === editingBookmarkId);
        if (stillExists) return;
        editingBookmarkId = null;
        editingBookmarkError = '';
      }
      renderBookmarksPage({ force: false });
    });
  }
  if (window.gxChromePagesAPI?.onHistoryUpdate) {
    window.gxChromePagesAPI.onHistoryUpdate(() => {
      if (currentPage === 'history') {
        renderHistoryPage({ force: false });
      } else if (currentPage === 'privacy') {
        renderPrivacyPage({ force: false });
      }
    });
  }
  if (window.gxChromePagesAPI?.onCookiesUpdate) {
    window.gxChromePagesAPI.onCookiesUpdate(() => {
      if (currentPage === 'settings') {
        refreshSettingsCookies({ force: false });
      } else if (currentPage === 'privacy') {
        renderPrivacyPage({ force: false });
      }
    });
  }
  if (window.gxChromePagesAPI?.onPermissionsUpdate) {
    window.gxChromePagesAPI.onPermissionsUpdate(() => {
      if (currentPage === 'privacy') {
        renderPrivacyPage({ force: true });
      }
    });
  }
  if (window.gxChromePagesAPI?.onDownloadsUpdate) {
    window.gxChromePagesAPI.onDownloadsUpdate(() => {
      if (currentPage === 'downloads') {
        renderDownloadsPage({ force: false });
      }
    });
  }
  if (window.gxChromePagesAPI?.onProfilesUpdate) {
    window.gxChromePagesAPI.onProfilesUpdate((data) => {
      settingsProfilesData = data;
      if (currentPage === 'settings' && !settingsProfileCreateOpen && !settingsProfileRenamingId && !settingsProfileDeletingId) {
        renderSettingsProfilesSection();
      } else if (currentPage === 'privacy') {
        renderPrivacyPage({ force: false });
      }
    });
  }
  if (window.gxChromePagesAPI?.onPasswordsUpdate) {
    window.gxChromePagesAPI.onPasswordsUpdate(() => {
      if (currentPage === 'passwords') {
        if (!editingPasswordId) {
          renderPasswordsPage();
        }
      } else if (currentPage === 'privacy') {
        renderPrivacyPage({ force: false });
      }
    });
  }
  if (window.gxChromePagesAPI?.onAdblockUpdate) {
    window.gxChromePagesAPI.onAdblockUpdate((stats) => {
      if (!stats) return;
      if (currentPage === 'privacy') {
        renderPrivacyPage({ force: false });
        return;
      }
      if (currentPage !== 'settings') return;
      const adChk = document.getElementById('setAdblockChk');
      const trChk = document.getElementById('setTrackerBlockChk');
      if (adChk && typeof stats.enabled === 'boolean') adChk.checked = stats.enabled;
      if (trChk) {
        if (typeof stats.enabled === 'boolean') trChk.disabled = !stats.enabled;
        if (typeof stats.trackerBlockEnabled === 'boolean') {
          trChk.checked = Boolean(stats.enabled !== false && stats.trackerBlockEnabled);
        }
      }
    });
  }
  if (window.gxChromePagesAPI?.onPageShown) {
    window.gxChromePagesAPI.onPageShown(() => {
      refreshVisiblePage();
    });
  }
  window.addEventListener('focus', () => {
    refreshVisiblePage();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshVisiblePage();
    }
  });
}

initThemeSync();

window.addEventListener('hashchange', () => {
  const hash = window.location.hash.replace('#', '');
  if (hash && hash !== currentPage) switchPage(hash);
});

const initialHash = window.location.hash.replace('#', '') || 'history';
switchPage(initialHash);

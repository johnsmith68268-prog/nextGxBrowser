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
  if (page !== 'bookmarks') {
    editingBookmarkId = null;
    editingBookmarkError = '';
    renamingFolderName = null;
    renamingFolderError = '';
    addingBookmarkError = '';
  }

  document.querySelectorAll('.nav-link').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  const titles = {
    history: 'Browsing History',
    downloads: 'Pro Download Manager',
    bookmarks: 'Bookmarks',
    passwords: 'Passwords & Autofill',
    extensions: 'Extensions',
    settings: 'nextGx Settings'
  };
  pageHeaderTitle.textContent = titles[page] || 'Settings';
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
  else if (currentPage === 'extensions') await renderExtensionsPage();
  else if (currentPage === 'settings') await renderSettingsPage();
}

// 1. HISTORY (Recently Closed + Today / Yesterday / Older Grouping + Visit Counts + Favicons + Time Range Clear)
async function renderHistoryPage({ force = true } = {}) {
  const seq = ++renderSeq;
  const [list, closedTabs] = await Promise.all([
    window.gxChromePagesAPI.getHistory(),
    window.gxChromePagesAPI.getClosedTabs ? window.gxChromePagesAPI.getClosedTabs() : Promise.resolve([])
  ]);
  if (seq !== renderSeq || currentPage !== 'history') return;

  const renderKey = JSON.stringify({
    day: new Date().toDateString(),
    q: searchQuery,
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

    const groups = { Today: [], Yesterday: [], Older: [] };
    for (const item of filtered) {
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
  }

  mainContainer.innerHTML = closedSectionHtml + historyHtml;
  if (!force && prevScrollY > 0) window.scrollTo(0, prevScrollY);

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
    renamingFolderError
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
    <button type="button" class="btn primary" id="btnToggleAddBookmark">${addingBookmarkOpen ? 'Close' : '+ Add Bookmark'}</button>
  `;

  document.getElementById('btnToggleAddBookmark').addEventListener('click', () => {
    addingBookmarkOpen = !addingBookmarkOpen;
    addingBookmarkError = '';
    renderBookmarksPage();
  });

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

  mainContainer.innerHTML = datalistHtml + addCardHtml + sectionsHtml;
  bindBookmarkFavicons(mainContainer);

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
async function renderPasswordsPage() {
  const seq = ++renderSeq;
  const list = await window.gxChromePagesAPI.getPasswords();
  if (seq !== renderSeq || currentPage !== 'passwords') return;
  const filtered = (list || []).filter(
    (p) =>
      !searchQuery ||
      (p.site && p.site.toLowerCase().includes(searchQuery)) ||
      (p.username && p.username.toLowerCase().includes(searchQuery))
  );

  let rowsHtml = '';
  for (const pw of filtered) {
    rowsHtml += `
      <div class="card-row" data-id="${escapeHtml(pw.id)}">
        <div class="row-info">
          <div class="row-title">${escapeHtml(pw.site)}</div>
          <div class="row-sub">Username: <strong>${escapeHtml(pw.username)}</strong></div>
        </div>
        <input type="password" value="${escapeHtml(pw.password)}" readonly class="input-box pw-field" style="width:150px;" />
        <button class="btn toggle-pw">Show</button>
        <button class="btn copy-pw" data-pw="${escapeHtml(pw.password)}">Copy</button>
        <button class="btn danger del-pw">Delete</button>
      </div>
    `;
  }

  mainContainer.innerHTML = `
    <div class="section-card">
      <div class="card-header">
        <h2 class="nx-heading">Add Website Login (Auto-Fills on Matching Sites)</h2>
      </div>
      <form id="pwAddForm" class="card-row" style="gap:10px;">
        <input type="text" id="inpSite" class="input-box" placeholder="Website (e.g. github.com)" required style="flex:1" />
        <input type="text" id="inpUser" class="input-box" placeholder="Username / Email" required style="flex:1" />
        <input type="password" id="inpPass" class="input-box" placeholder="Password" required style="flex:1" />
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

  document.getElementById('pwAddForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await window.gxChromePagesAPI.addPassword({
      site: document.getElementById('inpSite').value.trim(),
      username: document.getElementById('inpUser').value.trim(),
      password: document.getElementById('inpPass').value
    });
    renderPasswordsPage();
  });

  mainContainer.querySelectorAll('.toggle-pw').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const inp = e.target.closest('.card-row').querySelector('.pw-field');
      const isPw = inp.type === 'password';
      inp.type = isPw ? 'text' : 'password';
      btn.textContent = isPw ? 'Hide' : 'Show';
    });
  });

  mainContainer.querySelectorAll('.copy-pw').forEach((btn) => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.pw || '');
      btn.textContent = 'Copied!';
    });
  });

  mainContainer.querySelectorAll('.del-pw').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.closest('.card-row').dataset.id;
      await window.gxChromePagesAPI.removePassword(id);
      renderPasswordsPage();
    });
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
              <div style="font-weight:600;font-size:14.5px;">nextGx Privacy Shield <span style="font-size:11px;color:var(--text-secondary);">2.5.0</span></div>
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
              <div style="font-weight:600;font-size:14.5px;">nextGx Media & AI Overlay <span style="font-size:11px;color:var(--text-secondary);">2.5.0</span></div>
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
  const [s, sys, ad, allCookies, adblockSites] = await Promise.all([
    window.gxChromePagesAPI.getSettings(),
    window.gxChromePagesAPI.getSystemStats(),
    window.gxChromePagesAPI.getAdblockStats(),
    window.gxChromePagesAPI.getCookies ? window.gxChromePagesAPI.getCookies() : Promise.resolve([]),
    window.gxChromePagesAPI.getAdblockSites ? window.gxChromePagesAPI.getAdblockSites() : Promise.resolve({})
  ]);
  if (seq !== renderSeq || currentPage !== 'settings') return;

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

  mainContainer.innerHTML = `
    <div class="section-card">
      <div class="card-header"><h2 class="nx-heading">Appearance, Sound & Behavior</h2></div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">nextGx Theme</div>
          <div class="row-sub">Choose your browser accent</div>
        </div>
        <div class="nx-segmented" id="setThemeSeg">
          <button class="seg-btn ${s.theme === 'gx-violet' ? 'active' : ''}" data-theme="gx-violet"><span class="theme-dot gx-violet"></span>nextGx Violet</button>
          <button class="seg-btn ${s.theme === 'crimson' ? 'active' : ''}" data-theme="crimson"><span class="theme-dot crimson"></span>Crimson</button>
          <button class="seg-btn ${s.theme === 'cyan' ? 'active' : ''}" data-theme="cyan"><span class="theme-dot cyan"></span>Cyber Cyan</button>
          <button class="seg-btn ${s.theme === 'emerald' ? 'active' : ''}" data-theme="emerald"><span class="theme-dot emerald"></span>Emerald</button>
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
          <div class="row-title">UI Sound Effects</div>
          <div class="row-sub">Subtle sounds on tab open/close and clicks</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setSoundsChk" ${s.uiSoundsEnabled !== false ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
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
      <div class="card-row" style="flex-wrap:wrap;">
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
          <div class="row-title">Hibernate all inactive background tabs now</div>
        </div>
        <button class="btn primary" id="btnSetSleepNow">Hibernate Background Tabs</button>
      </div>
    </div>

    <div class="section-card">
      <div class="card-header"><h2 class="nx-heading">About nextGx Browser</h2></div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">nextGx Browser v2.5.0 (64-bit) — Powered by Chromium Engine v156.0.8078.100</div>
          <div class="row-sub">Designed for Linux & Windows (Microsoft Store MSIX Ready)</div>
        </div>
      </div>
    </div>
  `;

  renderCookieDomainsList(true);

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
  document.getElementById('setSoundsChk').addEventListener('change', (e) => {
    window.gxChromePagesAPI.updateSettings({ uiSoundsEnabled: e.target.checked });
  });
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
    window.gxChromePagesAPI.updateSettings({ autoSleepEnabled: e.target.checked });
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
}

function refreshVisiblePage() {
  if (!window.gxChromePagesAPI) return;
  if (currentPage === 'history') {
    renderHistoryPage({ force: false });
  } else if (currentPage === 'settings') {
    refreshSettingsCookies({ force: false });
  } else if (currentPage === 'downloads') {
    renderDownloadsPage({ force: false });
  } else if (currentPage === 'bookmarks') {
    if (!addingBookmarkOpen && !renamingFolderName && !editingBookmarkId) {
      renderBookmarksPage({ force: false });
    }
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
    window.gxChromePagesAPI.getSettings().then((s) => applyTheme(s?.theme)).catch(() => {});
  }
  if (window.gxChromePagesAPI?.onSettingsUpdate) {
    window.gxChromePagesAPI.onSettingsUpdate((s) => {
      if (s && s.theme) applyTheme(s.theme);
      const bmChk = document.getElementById('setBookmarksBarChk');
      if (bmChk && s && typeof s.showBookmarksBar === 'boolean') {
        bmChk.checked = s.showBookmarksBar;
      }
      const soundsChk = document.getElementById('setSoundsChk');
      if (soundsChk && s && typeof s.uiSoundsEnabled === 'boolean') {
        soundsChk.checked = s.uiSoundsEnabled;
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
      if (autoSleepChk && s && typeof s.autoSleepEnabled === 'boolean') {
        autoSleepChk.checked = s.autoSleepEnabled;
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
      }
    });
  }
  if (window.gxChromePagesAPI?.onCookiesUpdate) {
    window.gxChromePagesAPI.onCookiesUpdate(() => {
      if (currentPage === 'settings') {
        refreshSettingsCookies({ force: false });
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
  if (window.gxChromePagesAPI?.onAdblockUpdate) {
    window.gxChromePagesAPI.onAdblockUpdate((stats) => {
      if (!stats || currentPage !== 'settings') return;
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

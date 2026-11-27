const mainContainer = document.getElementById('mainContainer');
const pageHeaderTitle = document.getElementById('pageHeaderTitle');
const globalSearchInput = document.getElementById('globalSearchInput');
const topRightActions = document.getElementById('topRightActions');

let currentPage = 'history';
const VALID_SETTINGS_TABS = new Set([
  'appearance',
  'gx',
  'video',
  'autofill',
  'privacy',
  'search',
  'default-browser',
  'startup',
  'languages',
  'downloads',
  'accessibility',
  'system',
  'reset',
  'about'
]);
const SETTINGS_TAB_ALIASES = {
  all: 'appearance',
  performance: 'gx',
  'search-startup': 'search',
  defaultbrowser: 'default-browser',
  onstartup: 'startup',
  profiles: 'appearance'
};
let settingsSubTab = 'appearance';
let cookieShowAll = false;
let searchQuery = '';
let dlFilterCat = 'all';
// [Wave2-D] Downloads page search (gap 7.3): local filter on top of the
// global search box; applied in the DOM so typing never loses focus.
let dlSearchText = '';
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

function applySettingsCategoryAndSearch() {
  if (currentPage !== 'settings') return;
  const q = (searchQuery || '').trim().toLowerCase();
  const cards = mainContainer.querySelectorAll('.section-card[data-settings-cat]');
  let visibleCards = 0;
  cards.forEach((card) => {
    const cat = card.dataset.settingsCat || 'system';
    const rows = card.querySelectorAll('.card-row');
    if (q) {
      let matchedRows = 0;
      const headerText = (card.querySelector('.card-header')?.textContent || '').toLowerCase();
      const headerHit = headerText.includes(q);
      rows.forEach((row) => {
        const text = (row.textContent || '').toLowerCase();
        const hit = headerHit || text.includes(q);
        row.style.display = hit ? '' : 'none';
        if (hit) matchedRows += 1;
      });
      const showCard = headerHit || matchedRows > 0;
      card.style.display = showCard ? '' : 'none';
      if (showCard) visibleCards += 1;
    } else {
      rows.forEach((row) => { row.style.display = ''; });
      const showCard = settingsSubTab === 'all' || cat === settingsSubTab;
      card.style.display = showCard ? '' : 'none';
      if (showCard) visibleCards += 1;
    }
  });
  let emptyEl = document.getElementById('settingsSearchEmpty');
  if (q && visibleCards === 0) {
    if (!emptyEl) {
      emptyEl = document.createElement('div');
      emptyEl.id = 'settingsSearchEmpty';
      emptyEl.className = 'section-card';
      const contentWrap = mainContainer.querySelector('.settings-gx-content') || mainContainer;
      contentWrap.appendChild(emptyEl);
    }
    emptyEl.innerHTML = `<div class="nx-empty-state"><div class="nx-empty-art" aria-hidden="true">🔍</div><div class="nx-empty-title">No settings match "${escapeHtml(searchQuery)}"</div><div class="nx-empty-copy">Try searching for theme, wallpaper, ad blocker, search engine, downloads, proxy, or webrtc.</div></div>`;
    emptyEl.style.display = '';
  } else if (emptyEl) {
    emptyEl.style.display = 'none';
  }
}

function switchPage(rawPage) {
  const rawStr = String(rawPage || '').trim().toLowerCase();
  let page = rawStr;
  if (rawStr.startsWith('settings/')) {
    page = 'settings';
    const rawSub = rawStr.slice('settings/'.length);
    const mapped = SETTINGS_TAB_ALIASES[rawSub] || rawSub;
    if (VALID_SETTINGS_TABS.has(mapped)) {
      settingsSubTab = mapped;
    }
  }
  const VALID_PAGES = new Set(['history', 'downloads', 'bookmarks', 'passwords', 'privacy', 'extensions', 'settings']);
  if (!VALID_PAGES.has(page)) page = 'settings';

  // Clear cross-page search query when moving between pages.
  if (currentPage !== page) {
    searchQuery = '';
    if (globalSearchInput) globalSearchInput.value = '';
  }
  currentPage = page;
  window.location.hash = page === 'settings' ? `settings/${settingsSubTab}` : page;
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
  if (page !== 'history') {
    histSelected.clear();
    closeHistEntryMenu();
  }
  if (page !== 'passwords') {
    passwordsIoBanner = null;
    passwordsExportConfirmOpen = false;
    editingPasswordId = null;
    editingPasswordError = '';
    revealedPasswordIds.clear();
    pwGenState.error = '';
    pwGenState.feedback = '';
    addrFormOpen = false;
    addrEditingId = null;
    addrFormError = '';
    cardFormOpen = false;
    cardEditingId = null;
    cardFormError = '';
  }
  if (page !== 'settings') {
    settingsProfileCreateOpen = false;
    settingsProfileRenamingId = null;
    settingsProfileDeletingId = null;
    settingsProfileError = '';
  }

  document.body.dataset.activePage = page;
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
  if (currentPage === 'settings') {
    // Instant synchronous DOM filter — zero IPC thrash, never wipes active inputs!
    applySettingsCategoryAndSearch();
    return;
  }
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
// [Wave2-D] History By-group view (gap 7.1) + multi-select/bulk delete +
// per-entry menu (gap 7.2). Selection survives re-renders via this Set.
let histViewMode = 'date'; // 'date' | 'group'
let histSelected = new Set();
let histMenuEntryId = null;

// [Wave2-D] Registrable-domain (eTLD+1) heuristic for By-group view. Small
// public-suffix list; rough grouping — sub-domains of one site land together,
// unrelated sites sharing a suffix do not. Mirrors the ipc.js helper.
const HIST_TWO_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.jp',
  'co.kr', 'co.nz', 'com.br', 'com.cn', 'co.in', 'co.za', 'com.mx', 'com.tw',
  'com.hk', 'co.il', 'com.sg', 'com.ar', 'com.co', 'com.pl', 'co.th'
]);

function histRegistrableDomain(rawUrl) {
  try {
    const u = new URL(rawUrl || '');
    if (!/^https?:$/.test(u.protocol)) return 'nextGx pages';
    const h = u.hostname.toLowerCase();
    // Market audit bug #22: IP hosts must not be registrable-domain shortened
    // ("127.0.0.1" became "0.1"). Return the full IP as the group label.
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h === 'localhost' || h.startsWith('[')) return h;
    const parts = h.split('.').filter(Boolean);
    if (parts.length <= 2) return h;
    const lastTwo = parts.slice(-2).join('.');
    if (HIST_TWO_LABEL_SUFFIXES.has(lastTwo) && parts.length >= 3) return parts.slice(-3).join('.');
    return lastTwo;
  } catch (_) {
    return 'Other pages';
  }
}

function histRowHtml(item, timeStr) {
  const favHtml = item.favicon
    ? `<img src="${escapeHtml(item.favicon)}" width="16" height="16" style="border-radius:3px;flex-shrink:0;" onerror="this.style.display='none'" />`
    : SVG_GLOBE;
  const visitCount = Math.max(1, Number(item.visitCount) || 1);
  const visitLabel = `${visitCount} ${visitCount === 1 ? 'visit' : 'visits'}`;
  const checked = histSelected.has(item.id) ? ' checked' : '';
  return `
    <div class="card-row history-item-row" data-id="${escapeHtml(item.id)}">
      <input type="checkbox" class="hist-select" data-id="${escapeHtml(item.id)}"${checked} aria-label="Select history entry" style="accent-color:var(--accent);flex-shrink:0;" />
      <span style="color:var(--text-secondary);font-size:12px;min-width:65px;">${escapeHtml(timeStr)}</span>
      ${favHtml}
      <div class="row-info">
        <div class="row-title row-title--clamp2 open-link" data-url="${escapeHtml(item.url)}" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
        <div class="row-sub">${escapeHtml(item.url)}</div>
      </div>
      <span class="visit-count-badge" style="font-size:11.5px;color:var(--text-secondary);background:var(--bg-input);border:1px solid var(--border);padding:3px 9px;border-radius:999px;flex-shrink:0;">${escapeHtml(visitLabel)}</span>
      <button type="button" class="btn hist-entry-menu-btn" data-id="${escapeHtml(item.id)}" aria-label="More actions" aria-haspopup="menu">⋮</button>
    </div>
  `;
}

function closeHistEntryMenu() {
  const menu = document.getElementById('histEntryMenu');
  if (menu) menu.remove();
  histMenuEntryId = null;
}

function openHistEntryMenu(btn, entryId) {
  closeHistEntryMenu();
  histMenuEntryId = entryId;
  const rect = btn.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.id = 'histEntryMenu';
  menu.setAttribute('role', 'menu');
  menu.style.cssText = 'position:fixed;z-index:60;min-width:210px;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;box-shadow:var(--nx-shadow-lg);padding:5px;';
  menu.innerHTML = `
    <button type="button" class="btn hist-menu-item" data-action="open" style="display:block;width:100%;text-align:left;border:none;background:transparent;box-shadow:none;">Open in new tab</button>
    <button type="button" class="btn hist-menu-item" data-action="copy" style="display:block;width:100%;text-align:left;border:none;background:transparent;box-shadow:none;">Copy link address</button>
    <button type="button" class="btn danger hist-menu-item" data-action="remove" style="display:block;width:100%;text-align:left;border:none;background:transparent;box-shadow:none;">Remove from history</button>
  `;
  document.body.appendChild(menu);
  const menuW = menu.offsetWidth;
  const menuH = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(rect.right - menuW, window.innerWidth - menuW - 8))}px`;
  menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - menuH - 8)}px`;
  menu.querySelectorAll('.hist-menu-item').forEach((item) => {
    item.addEventListener('click', async () => {
      const action = item.dataset.action;
      const row = mainContainer.querySelector(`.history-item-row[data-id="${CSS.escape(entryId)}"] .open-link`);
      const url = row?.dataset.url || '';
      // Market audit bug A3: the menu used to stay open after "Remove from
      // history" (the remove branch skipped closeHistEntryMenu, and the
      // re-render only replaces mainContainer while the menu lives on
      // document.body). Every menu action dismisses the menu now.
      if (action === 'open' && url) {
        closeHistEntryMenu();
        await window.gxChromePagesAPI.createTab({ url, active: true });
      } else if (action === 'copy' && url) {
        try {
          await navigator.clipboard.writeText(url);
          item.textContent = 'Copied!';
        } catch (_) {}
        // Let the "Copied!" feedback be seen, then dismiss.
        setTimeout(closeHistEntryMenu, 600);
      } else if (action === 'remove') {
        closeHistEntryMenu();
        await window.gxChromePagesAPI.removeHistoryItem(entryId);
        histSelected.delete(entryId);
        renderHistoryPage();
      } else {
        closeHistEntryMenu();
      }
    });
  });
}

function syncHistorySelectionUI() {
  const bar = document.getElementById('histBulkBar');
  if (bar) {
    bar.style.display = histSelected.size ? 'flex' : 'none';
    const countEl = document.getElementById('histBulkCount');
    if (countEl) countEl.textContent = `${histSelected.size} selected`;
  }
  mainContainer.querySelectorAll('.hist-select').forEach((chk) => {
    chk.checked = histSelected.has(chk.dataset.id);
  });
}

document.addEventListener('click', (e) => {
  if (e.target.closest && (e.target.closest('#histEntryMenu') || e.target.closest('.hist-entry-menu-btn'))) return;
  closeHistEntryMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeHistEntryMenu();
});

async function renderHistoryPage({ force = true } = {}) {
  const seq = ++renderSeq;
  const [list, closedTabs] = await Promise.all([
    window.gxChromePagesAPI.getHistory(),
    window.gxChromePagesAPI.getClosedTabs ? window.gxChromePagesAPI.getClosedTabs() : Promise.resolve([])
  ]);
  if (seq !== renderSeq || currentPage !== 'history') return;
  // Market audit bug #6 (stale bulk bar): the selection used to survive a
  // history clear, so a "1 selected" bar floated over an empty list.
  // Prune selected ids that are no longer in the fetched history.
  if (histSelected.size) {
    const liveIds = new Set((list || []).map((h) => h && h.id));
    for (const id of [...histSelected]) {
      if (!liveIds.has(id)) histSelected.delete(id);
    }
  }
  if (searchQuery !== lastHistorySearchKey) {
    lastHistorySearchKey = searchQuery;
    historyVisibleLimit = 100;
  }

  const renderKey = JSON.stringify({
    day: new Date().toDateString(),
    q: searchQuery,
    view: histViewMode,
    limit: historyVisibleLimit,
    sel: [...histSelected].sort(),
    closed: closedTabs || [],
    history: list || []
  });
  if (!force && renderKey === lastHistoryRenderKey) return;
  lastHistoryRenderKey = renderKey;
  const prevScrollY = force ? 0 : window.scrollY;

  topRightActions.innerHTML = `
    <div class="nx-segmented" id="histViewSeg" role="radiogroup" aria-label="History view">
      <button class="seg-btn ${histViewMode === 'date' ? 'active' : ''}" data-view="date">By date</button>
      <button class="seg-btn ${histViewMode === 'group' ? 'active' : ''}" data-view="group">By group</button>
    </div>
    <div class="nx-segmented" id="histClearRange">
      <button class="seg-btn" data-range="hour">Clear 1h</button>
      <button class="seg-btn" data-range="day">Clear 24h</button>
      <button class="seg-btn" data-range="week">Clear 7d</button>
    </div>
    <button class="btn danger" id="btnClearAllHistory">Clear All</button>
  `;

  topRightActions.querySelectorAll('#histViewSeg [data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      histViewMode = btn.dataset.view === 'group' ? 'group' : 'date';
      renderHistoryPage();
    });
  });

  topRightActions.querySelectorAll('[data-range]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await window.gxChromePagesAPI.clearHistory(btn.dataset.range);
      // Market audit bug #6: a clear wipes the entries the bulk bar refers
      // to, so drop the selection with them (pruning in renderHistoryPage
      // is the backstop; this makes the bar hide immediately).
      histSelected.clear();
      renderHistoryPage();
    });
  });

  document.getElementById('btnClearAllHistory').addEventListener('click', async () => {
    await window.gxChromePagesAPI.clearHistory('all');
    histSelected.clear();
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
    // UX phase: illustrated empty state with an action, not a bare sentence.
    historyHtml = `<div class="section-card"><div class="nx-empty-state">
      <div class="nx-empty-art" aria-hidden="true">◷</div>
      <div class="nx-empty-title">No history yet</div>
      <div class="nx-empty-copy">Pages you visit will appear here, grouped by date. Start browsing and your history will fill in.</div>
      <button type="button" class="btn primary" id="btnEmptyHistoryBrowse">Browse the web</button>
    </div></div>`;
  } else {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayMs = startOfToday.getTime();
    const yesterdayMs = todayMs - 24 * 3600 * 1000;

    const visibleItems = filtered.slice(0, historyVisibleLimit);
    const remainingCount = Math.max(0, filtered.length - visibleItems.length);
    const timeStrFor = (item) =>
      new Date(item.visitedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (histViewMode === 'group') {
      // [Wave2-D] By group (gap 7.1): local grouping by website domain
      // (registrable domain). Groups sort by most recent visit.
      const groupMap = new Map();
      for (const item of visibleItems) {
        const domain = histRegistrableDomain(item.url);
        if (!groupMap.has(domain)) groupMap.set(domain, []);
        groupMap.get(domain).push(item);
      }
      const sortedGroups = [...groupMap.entries()].sort(
        (a, b) =>
          Math.max(...b[1].map((i) => i.visitedAt || 0)) - Math.max(...a[1].map((i) => i.visitedAt || 0))
      );
      historyHtml += `<div style="font-size:12px;color:var(--text-secondary);margin:0 2px 12px;">Grouped by website domain.</div>`;
      for (const [domain, items] of sortedGroups) {
        items.sort((a, b) => (b.visitedAt || 0) - (a.visitedAt || 0));
        const totalVisits = items.reduce((n, i) => n + Math.max(1, Number(i.visitCount) || 1), 0);
        const rowsHtml = items.map((item) => histRowHtml(item, timeStrFor(item))).join('');
        historyHtml += `
          <div class="section-card">
            <div class="card-header">
              <h2 class="nx-heading">${escapeHtml(domain)} (${items.length})</h2>
              <span style="font-size:12px;color:var(--text-secondary);">${totalVisits} ${totalVisits === 1 ? 'visit' : 'visits'}</span>
            </div>
            ${rowsHtml}
          </div>
        `;
      }
    } else {
      const groups = { Today: [], Yesterday: [], Older: [] };
      for (const item of visibleItems) {
        const t = item.visitedAt || 0;
        if (t >= todayMs) groups.Today.push(item);
        else if (t >= yesterdayMs) groups.Yesterday.push(item);
        else groups.Older.push(item);
      }

      for (const [label, items] of Object.entries(groups)) {
        if (!items.length) continue;
        const rowsHtml = items.map((item) => histRowHtml(item, timeStrFor(item))).join('');
        historyHtml += `
          <div class="section-card">
            <div class="card-header"><h2 class="nx-heading">${escapeHtml(label)} (${items.length})</h2></div>
            ${rowsHtml}
          </div>
        `;
      }
    }
    if (remainingCount > 0) {
      historyHtml += `
        <div style="display:flex;justify-content:center;padding:8px 0 20px;">
          <button type="button" class="btn" id="btnLoadMoreHistory">Show more history (${remainingCount} remaining)</button>
        </div>
      `;
    }
  }

  // [Wave2-D] Bulk-selection bar (gap 7.2): appears when entries are checked.
  const bulkBarHtml = `
    <div id="histBulkBar" style="display:${histSelected.size ? 'flex' : 'none'};align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 16px;margin-bottom:20px;background:var(--bg-card);border:1px solid var(--accent);border-radius:12px;">
      <span id="histBulkCount" style="font-size:13px;font-weight:600;">${histSelected.size} selected</span>
      <span style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="btn" id="btnHistSelectAll">Select all on page</button>
        <button type="button" class="btn" id="btnHistClearSelection">Cancel</button>
        <button type="button" class="btn danger" id="btnHistBulkDelete">Delete selected</button>
      </span>
    </div>
  `;

  mainContainer.innerHTML = closedSectionHtml + bulkBarHtml + historyHtml;
  if (!force && prevScrollY > 0) window.scrollTo(0, prevScrollY);

  document.getElementById('btnEmptyHistoryBrowse')?.addEventListener('click', () => {
    window.gxChromePagesAPI.createTab({ url: 'nextgx://newtab', active: true });
  });

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

  // [Wave2-D] Multi-select checkboxes (gap 7.2) + per-entry ⋮ menu.
  mainContainer.querySelectorAll('.hist-select').forEach((chk) => {
    chk.addEventListener('change', () => {
      if (chk.checked) histSelected.add(chk.dataset.id);
      else histSelected.delete(chk.dataset.id);
      syncHistorySelectionUI();
    });
  });

  mainContainer.querySelectorAll('.hist-entry-menu-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (histMenuEntryId === id) {
        closeHistEntryMenu();
        return;
      }
      openHistEntryMenu(btn, id);
    });
  });

  document.getElementById('btnHistSelectAll')?.addEventListener('click', () => {
    mainContainer.querySelectorAll('.history-item-row').forEach((row) => {
      if (row.dataset.id) histSelected.add(row.dataset.id);
    });
    syncHistorySelectionUI();
  });

  document.getElementById('btnHistClearSelection')?.addEventListener('click', () => {
    histSelected.clear();
    syncHistorySelectionUI();
  });

  document.getElementById('btnHistBulkDelete')?.addEventListener('click', async () => {
    const ids = [...histSelected];
    if (!ids.length) return;
    const btn = document.getElementById('btnHistBulkDelete');
    if (btn) btn.disabled = true;
    try {
      for (const id of ids) {
        await window.gxChromePagesAPI.removeHistoryItem(id);
        histSelected.delete(id);
      }
    } finally {
      // Market audit bug #6: always drop the (now deleted) selection and
      // re-render, even if one remove failed, so the bar cannot stick
      // around claiming entries are still selected.
      histSelected.clear();
      renderHistoryPage();
    }
  });
}

// 2. PRO DOWNLOAD MANAGER
// Market audit bugs #7/#21: the page re-fetches on every 'downloads:update'
// broadcast, which is correct but racy while a download is progressing
// (the fetch can land before storage has the newest tick). Accept the
// broadcast payload as the list when one is supplied, so a progress /
// completion broadcast updates the rows even if the fetch would lag.
async function renderDownloadsPage({ force = true, list: listOverride = null } = {}) {
  const seq = ++renderSeq;
  const list = Array.isArray(listOverride)
    ? listOverride
    : await window.gxChromePagesAPI.getDownloads();
  if (seq !== renderSeq || currentPage !== 'downloads') return;

  const renderKey = JSON.stringify({
    cat: dlFilterCat,
    q: searchQuery,
    dlq: dlSearchText,
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

  const dlQ = dlSearchText.trim().toLowerCase();
  const filtered = (list || []).filter(
    (d) =>
      (dlFilterCat === 'all' || d.category === dlFilterCat) &&
      (!searchQuery || (d.filename && d.filename.toLowerCase().includes(searchQuery))) &&
      (!dlQ || `${d.filename || ''} ${d.url || ''}`.toLowerCase().includes(dlQ))
  );

  if (!filtered.length) {
    mainContainer.innerHTML = `
      <div class="section-card">
        <div class="card-header" style="flex-wrap:wrap;">
          <h2 class="nx-heading">Downloads (0)</h2>
          <input
            type="text"
            id="dlSearchInput"
            class="input-box"
            placeholder="Search downloads..."
            value="${escapeHtml(dlSearchText)}"
            style="width:230px;padding:6px 10px;font-size:12.5px;"
            aria-label="Search downloads"
          />
        </div>
        <div class="nx-empty-state">
          <div class="nx-empty-art" aria-hidden="true">↓</div>
          <div class="nx-empty-title">${dlSearchText ? 'No downloads match your search' : 'No downloads yet'}</div>
          <div class="nx-empty-copy">${dlSearchText ? `Nothing downloaded matches "${escapeHtml(dlSearchText)}".` : 'Files you download will appear here with speed, progress and pause / resume controls.'}</div>
          ${dlSearchText ? '' : '<button type="button" class="btn primary" id="btnEmptyDownloadsBrowse">Browse the web</button>'}
        </div>
      </div>
    `;
    document.getElementById('btnEmptyDownloadsBrowse')?.addEventListener('click', () => {
      window.gxChromePagesAPI.createTab({ url: 'nextgx://newtab', active: true });
    });
    const emptyDlSearch = document.getElementById('dlSearchInput');
    if (emptyDlSearch) {
      emptyDlSearch.addEventListener('input', (e) => {
        dlSearchText = e.target.value;
        renderDownloadsPage();
        const again = document.getElementById('dlSearchInput');
        if (again) {
          again.focus();
          again.setSelectionRange(again.value.length, again.value.length);
        }
      });
    }
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
      <div class="card-row dl-item-row" data-id="${escapeHtml(d.id)}" data-dl-search="${escapeHtml(`${d.filename || ''} ${d.url || ''}`.toLowerCase())}">
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

  mainContainer.innerHTML = `
    <div class="section-card">
      <div class="card-header" style="flex-wrap:wrap;">
        <h2 class="nx-heading" id="dlCountHeading">Downloads (${filtered.length})</h2>
        <input
          type="text"
          id="dlSearchInput"
          class="input-box"
          placeholder="Search downloads..."
          value="${escapeHtml(dlSearchText)}"
          style="width:230px;padding:6px 10px;font-size:12.5px;"
          aria-label="Search downloads"
        />
      </div>
      ${rowsHtml}
    </div>
  `;
  if (!force && prevScrollY > 0) window.scrollTo(0, prevScrollY);

  // [Wave2-D] Downloads search (gap 7.3): filter rows in place so the input
  // keeps focus while typing.
  const applyDlSearchFilter = () => {
    const q = dlSearchText.trim().toLowerCase();
    let visible = 0;
    mainContainer.querySelectorAll('.dl-item-row').forEach((row) => {
      const hay = row.dataset.dlSearch || '';
      const show = !q || hay.includes(q);
      row.style.display = show ? '' : 'none';
      if (show) visible += 1;
    });
    const heading = document.getElementById('dlCountHeading');
    if (heading) heading.textContent = `Downloads (${visible})`;
  };
  const dlSearchInput = document.getElementById('dlSearchInput');
  if (dlSearchInput) {
    dlSearchInput.addEventListener('input', (e) => {
      dlSearchText = e.target.value;
      applyDlSearchFilter();
    });
    if (dlSearchText) applyDlSearchFilter();
  }

  mainContainer.querySelectorAll('.open-file').forEach((el) => {
    el.addEventListener('click', () => window.gxChromePagesAPI.openDownloadItem(el.dataset.path));
  });
  mainContainer.querySelectorAll('.show-folder').forEach((btn) => {
    btn.addEventListener('click', () => window.gxChromePagesAPI.showDownloadInFolder(btn.dataset.path));
  });
  mainContainer.querySelectorAll('.pause-dl').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.dl-item-row')?.dataset.id;
      if (!id) return;
      await window.gxChromePagesAPI.pauseDownload(id);
      renderDownloadsPage();
    });
  });
  mainContainer.querySelectorAll('.resume-dl').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.dl-item-row')?.dataset.id;
      if (!id) return;
      await window.gxChromePagesAPI.resumeDownload(id);
      renderDownloadsPage();
    });
  });
  mainContainer.querySelectorAll('.cancel-dl').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.dl-item-row')?.dataset.id;
      if (!id) return;
      await window.gxChromePagesAPI.cancelDownload(id);
      renderDownloadsPage();
    });
  });
  mainContainer.querySelectorAll('.remove-dl').forEach((btn) => {
    btn.addEventListener('click', async () => {
      // Market audit bug #7: use the bound button (not e.target, which can
      // be a child node if the button gains an icon) and remove the row
      // optimistically so the click always has visible effect; re-render
      // from storage afterwards, and restore on failure.
      const row = btn.closest('.dl-item-row');
      const id = row?.dataset.id;
      if (!id) return;
      row.style.opacity = '0.4';
      btn.disabled = true;
      try {
        await window.gxChromePagesAPI.removeDownload(id);
      } catch (_) {
        renderDownloadsPage();
        return;
      }
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
        <div class="row-title row-title--clamp2 open-bm" data-url="${escapeHtml(bm.url)}" title="${escapeHtml(bm.title)}">${escapeHtml(bm.title)}</div>
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
    // UX phase: illustrated empty state with an action.
    sectionsHtml = `<div class="section-card"><div class="nx-empty-state">
      <div class="nx-empty-art" aria-hidden="true">☆</div>
      <div class="nx-empty-title">${!list.length ? 'No bookmarks yet' : 'No bookmarks match your search'}</div>
      <div class="nx-empty-copy">${!list.length ? 'Save a site with the star in the address bar, or add one here — it will show up on the New Tab page and bookmarks bar.' : `No bookmarks match "${escapeHtml(searchQuery)}".`}</div>
      ${!list.length ? '<button type="button" class="btn primary" id="btnEmptyBookmarkAdd">Add a bookmark</button>' : ''}
    </div></div>`;
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

  document.getElementById('btnEmptyBookmarkAdd')?.addEventListener('click', () => {
    document.getElementById('btnToggleAddBookmark')?.click();
  });

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

// [Wave2-D] Autofill management (gaps 6.2/6.3): addresses + payment methods.
// Lists are fetched with the passwords page; card numbers are never shown in
// full (only brand + last 4 digits) and are encrypted at rest.
let addrList = [];
let cardList = [];
let addrFormOpen = false;
let addrEditingId = null;
let addrFormError = '';
let cardFormOpen = false;
let cardEditingId = null;
let cardFormError = '';

function formatAddressSummary(a) {
  const parts = [a.addressLine1, a.addressLine2, a.city, a.region, a.postalCode, a.country]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);
  return parts.join(', ');
}

function renderAddressRowHtml(a) {
  if (addrEditingId === a.id) {
    const field = (label, name, value, extra = '') =>
      `<label class="bm-edit-field"><span class="bm-field-label">${label}</span><input type="text" class="input-box addr-edit-${name}" value="${escapeHtml(value || '')}" ${extra} /></label>`;
    return `
      <div class="card-row bm-editing" data-id="${escapeHtml(a.id)}">
        <form class="bm-edit-form addr-edit-form" data-id="${escapeHtml(a.id)}">
          <div class="bm-edit-grid">
            ${field('Label', 'label', a.label)}
            ${field('Full name', 'fullName', a.fullName)}
            ${field('Organization', 'organization', a.organization)}
            ${field('Street address', 'addressLine1', a.addressLine1)}
            ${field('Address line 2', 'addressLine2', a.addressLine2)}
            ${field('City', 'city', a.city)}
            ${field('Region / State', 'region', a.region)}
            ${field('Postal code', 'postalCode', a.postalCode)}
            ${field('Country', 'country', a.country)}
            ${field('Phone', 'phone', a.phone)}
            ${field('Email', 'email', a.email)}
          </div>
          <div class="bm-edit-footer">
            <span class="bm-form-error addr-edit-error">${escapeHtml(addrFormError)}</span>
            <div class="bm-actions">
              <button type="button" class="btn cancel-edit-addr">Cancel</button>
              <button type="submit" class="btn primary save-edit-addr">Save</button>
            </div>
          </div>
        </form>
      </div>
    `;
  }
  const contact = [a.phone, a.email].filter(Boolean).join(' · ');
  return `
    <div class="card-row addr-entry-row" data-id="${escapeHtml(a.id)}">
      <div class="row-info">
        <div class="row-title" style="cursor:default;">${escapeHtml(a.fullName || a.label || 'Address')}${a.label ? ` <span style="color:var(--text-secondary);font-weight:400;">(${escapeHtml(a.label)})</span>` : ''}</div>
        <div class="row-sub">${escapeHtml(formatAddressSummary(a) || 'No street address saved')}</div>
        ${contact ? `<div class="row-sub">${escapeHtml(contact)}</div>` : ''}
      </div>
      <div class="pw-row-actions">
        <button type="button" class="btn edit-addr">Edit</button>
        <button type="button" class="btn danger del-addr">Delete</button>
      </div>
    </div>
  `;
}

function renderCardRowHtml(c) {
  if (cardEditingId === c.id) {
    return `
      <div class="card-row bm-editing" data-id="${escapeHtml(c.id)}">
        <form class="bm-edit-form card-edit-form" data-id="${escapeHtml(c.id)}">
          <div class="bm-edit-grid">
            <label class="bm-edit-field">
              <span class="bm-field-label">Label</span>
              <input type="text" class="input-box card-edit-label" value="${escapeHtml(c.label || '')}" placeholder="e.g. Personal Visa" />
            </label>
            <label class="bm-edit-field">
              <span class="bm-field-label">Cardholder name</span>
              <input type="text" class="input-box card-edit-name" value="${escapeHtml(c.cardholderName || '')}" required />
            </label>
            <label class="bm-edit-field">
              <span class="bm-field-label">Card number (blank = keep •••• ${escapeHtml(c.last4 || '')})</span>
              <input type="text" class="input-box card-edit-number" value="" placeholder="•••• •••• •••• ${escapeHtml(c.last4 || '')}" inputmode="numeric" autocomplete="cc-number" />
            </label>
            <label class="bm-edit-field">
              <span class="bm-field-label">Expiry month</span>
              <input type="number" class="input-box card-edit-month" value="${escapeHtml(String(c.expiryMonth || ''))}" min="1" max="12" required />
            </label>
            <label class="bm-edit-field">
              <span class="bm-field-label">Expiry year</span>
              <input type="number" class="input-box card-edit-year" value="${escapeHtml(String(c.expiryYear || ''))}" min="2026" max="2046" required />
            </label>
          </div>
          <div class="bm-edit-footer">
            <span class="bm-form-error card-edit-error">${escapeHtml(cardFormError)}</span>
            <div class="bm-actions">
              <button type="button" class="btn cancel-edit-card">Cancel</button>
              <button type="submit" class="btn primary save-edit-card">Save</button>
            </div>
          </div>
        </form>
      </div>
    `;
  }
  const exp = c.expiryMonth && c.expiryYear ? `Expires ${String(c.expiryMonth).padStart(2, '0')}/${c.expiryYear}` : '';
  return `
    <div class="card-row card-entry-row" data-id="${escapeHtml(c.id)}">
      <div class="row-info">
        <div class="row-title" style="cursor:default;">${escapeHtml(c.brand || 'Card')} •••• •••• •••• ${escapeHtml(c.last4 || '')}${c.label ? ` <span style="color:var(--text-secondary);font-weight:400;">(${escapeHtml(c.label)})</span>` : ''}</div>
        <div class="row-sub">${escapeHtml(c.cardholderName || '')}${exp ? ` · ${escapeHtml(exp)}` : ''}</div>
      </div>
      <div class="pw-row-actions">
        <button type="button" class="btn edit-card">Edit</button>
        <button type="button" class="btn danger del-card">Delete</button>
      </div>
    </div>
  `;
}

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
  // Passkeys (software authenticator) — worker C, gap 4.2. Fetched with the
  // passwords so the Passkeys card below renders in the same pass.
  const [listRaw, encStatus, passkeysRaw, pkEncStatus, addrRaw, cardsRaw] = await Promise.all([
    window.gxChromePagesAPI.getPasswords(),
    window.gxChromePagesAPI.getPasswordEncryptionStatus
      ? window.gxChromePagesAPI.getPasswordEncryptionStatus().catch(() => ({ available: true }))
      : Promise.resolve({ available: true }),
    window.gxChromePagesAPI.getPasskeys
      ? window.gxChromePagesAPI.getPasskeys().catch(() => [])
      : Promise.resolve([]),
    window.gxChromePagesAPI.getPasskeyEncryptionStatus
      ? window.gxChromePagesAPI.getPasskeyEncryptionStatus().catch(() => ({ available: true }))
      : Promise.resolve({ available: true }),
    // [Wave2-D] Autofill (gaps 6.2/6.3): addresses + payment methods.
    window.gxChromePagesAPI.getAddresses
      ? window.gxChromePagesAPI.getAddresses().catch(() => [])
      : Promise.resolve([]),
    window.gxChromePagesAPI.getPaymentMethods
      ? window.gxChromePagesAPI.getPaymentMethods().catch(() => [])
      : Promise.resolve([])
  ]);
  addrList = Array.isArray(addrRaw) ? addrRaw : [];
  cardList = Array.isArray(cardsRaw) ? cardsRaw : [];
  const passkeysList = Array.isArray(passkeysRaw) ? passkeysRaw : [];
  const passkeysFiltered = passkeysList.filter(
    (p) =>
      !searchQuery ||
      (p.rpId && p.rpId.toLowerCase().includes(searchQuery)) ||
      (p.rpName && p.rpName.toLowerCase().includes(searchQuery)) ||
      (p.username && p.username.toLowerCase().includes(searchQuery))
  );
  const passkeysRowsHtml = passkeysFiltered
    .map((pk) => {
      const created = pk.createdAt ? new Date(pk.createdAt).toLocaleDateString() : '';
      const label = pk.rpName && pk.rpName !== pk.rpId ? `${pk.rpName} (${pk.rpId})` : pk.rpId;
      return `
    <div class="card-row pk-entry-row" data-id="${escapeHtml(pk.id)}">
      <div class="row-info">
        <div class="row-title" style="cursor:default;">${escapeHtml(label || pk.rpId || 'Passkey')}</div>
        <div class="row-sub">Username: <strong>${escapeHtml(pk.username || pk.displayName || '')}</strong>${created ? ` · Created ${escapeHtml(created)}` : ''}</div>
        <div class="row-sub">Passkey · ES256 · Sign-ins: ${Number(pk.counter || 0)}</div>
      </div>
      <div class="pw-row-actions">
        <button type="button" class="btn danger del-pk">Delete</button>
      </div>
    </div>
  `;
    })
    .join('');
  const passkeysEncWarningHtml =
    pkEncStatus && pkEncStatus.available === false
      ? `<div class="io-banner-detail" style="margin-bottom:10px;">OS keyring encryption is unavailable, so passkey private keys are stored unencrypted in this profile until OS keyring support is enabled.</div>`
      : '';
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

  // [Wave2-D] Autofill (gaps 6.2/6.3): addresses + payment methods cards.
  const addrFiltered = addrList.filter(
    (a) =>
      !searchQuery ||
      [a.label, a.fullName, a.organization, a.addressLine1, a.city, a.region, a.postalCode, a.country, a.phone, a.email]
        .join(' ')
        .toLowerCase()
        .includes(searchQuery)
  );
  const cardFiltered = cardList.filter(
    (c) =>
      !searchQuery ||
      [c.label, c.cardholderName, c.brand, c.last4].join(' ').toLowerCase().includes(searchQuery)
  );

  const addrAddFormHtml = addrFormOpen
    ? `
      <div class="card-row bm-editing">
        <form id="addrAddForm" class="bm-edit-form">
          <div class="bm-edit-grid">
            <label class="bm-edit-field"><span class="bm-field-label">Label</span><input type="text" id="addrAddLabel" class="input-box" placeholder="e.g. Home" /></label>
            <label class="bm-edit-field"><span class="bm-field-label">Full name</span><input type="text" id="addrAddFullName" class="input-box" placeholder="Full name" required /></label>
            <label class="bm-edit-field"><span class="bm-field-label">Organization</span><input type="text" id="addrAddOrganization" class="input-box" placeholder="Company (optional)" /></label>
            <label class="bm-edit-field"><span class="bm-field-label">Street address</span><input type="text" id="addrAddLine1" class="input-box" placeholder="Street and number" /></label>
            <label class="bm-edit-field"><span class="bm-field-label">Address line 2</span><input type="text" id="addrAddLine2" class="input-box" placeholder="Apartment, suite (optional)" /></label>
            <label class="bm-edit-field"><span class="bm-field-label">City</span><input type="text" id="addrAddCity" class="input-box" placeholder="City" /></label>
            <label class="bm-edit-field"><span class="bm-field-label">Region / State</span><input type="text" id="addrAddRegion" class="input-box" placeholder="Region" /></label>
            <label class="bm-edit-field"><span class="bm-field-label">Postal code</span><input type="text" id="addrAddPostal" class="input-box" placeholder="Postal code" /></label>
            <label class="bm-edit-field"><span class="bm-field-label">Country</span><input type="text" id="addrAddCountry" class="input-box" placeholder="Country" /></label>
            <label class="bm-edit-field"><span class="bm-field-label">Phone</span><input type="text" id="addrAddPhone" class="input-box" placeholder="Phone (optional)" /></label>
            <label class="bm-edit-field"><span class="bm-field-label">Email</span><input type="text" id="addrAddEmail" class="input-box" placeholder="Email (optional)" /></label>
          </div>
          <div class="bm-edit-footer">
            <span class="bm-form-error" id="addrAddError">${escapeHtml(addrFormError)}</span>
            <div class="bm-actions">
              <button type="button" class="btn" id="btnCancelAddAddr">Cancel</button>
              <button type="submit" class="btn primary">Save address</button>
            </div>
          </div>
        </form>
      </div>
    `
    : '';

  const addrCardHtml = `
    <div class="section-card" id="addressesCard">
      <div class="card-header">
        <h2 class="nx-heading">Addresses (${addrFiltered.length})</h2>
        <button type="button" class="btn primary" id="btnToggleAddAddr">${addrFormOpen ? 'Close' : '+ Add address'}</button>
      </div>
      <div class="card-row">
        <div class="row-sub" style="margin-top:0;">Saved addresses fill shipping and billing forms on websites. Stored locally in this profile.</div>
      </div>
      ${addrAddFormHtml}
      ${addrFiltered.map(renderAddressRowHtml).join('') || '<div class="empty-state">No addresses saved yet.</div>'}
    </div>
  `;

  const cardAddFormHtml = cardFormOpen
    ? `
      <div class="card-row bm-editing">
        <form id="cardAddForm" class="bm-edit-form">
          <div class="bm-edit-grid">
            <label class="bm-edit-field"><span class="bm-field-label">Label</span><input type="text" id="cardAddLabel" class="input-box" placeholder="e.g. Personal Visa" /></label>
            <label class="bm-edit-field"><span class="bm-field-label">Cardholder name</span><input type="text" id="cardAddName" class="input-box" placeholder="Name on card" required /></label>
            <label class="bm-edit-field"><span class="bm-field-label">Card number</span><input type="text" id="cardAddNumber" class="input-box" placeholder="1234 5678 9012 3456" inputmode="numeric" autocomplete="cc-number" required /></label>
            <label class="bm-edit-field"><span class="bm-field-label">Expiry month</span><input type="number" id="cardAddMonth" class="input-box" placeholder="MM" min="1" max="12" required /></label>
            <label class="bm-edit-field"><span class="bm-field-label">Expiry year</span><input type="number" id="cardAddYear" class="input-box" placeholder="YYYY" min="2026" max="2046" required /></label>
          </div>
          <div class="bm-edit-footer">
            <span class="bm-form-error" id="cardAddError">${escapeHtml(cardFormError)}</span>
            <div class="bm-actions">
              <button type="button" class="btn" id="btnCancelAddCard">Cancel</button>
              <button type="submit" class="btn primary">Save card</button>
            </div>
          </div>
        </form>
      </div>
    `
    : '';

  const cardCardHtml = `
    <div class="section-card" id="paymentMethodsCard">
      <div class="card-header">
        <h2 class="nx-heading">Payment methods (${cardFiltered.length})</h2>
        <button type="button" class="btn primary" id="btnToggleAddCard">${cardFormOpen ? 'Close' : '+ Add card'}</button>
      </div>
      <div class="card-row">
        <div class="row-sub" style="margin-top:0;">Card numbers are encrypted with the OS keyring when available and are never shown in full. Form fill on web pages arrives with the autofill engine update.</div>
      </div>
      ${cardAddFormHtml}
      ${cardFiltered.map(renderCardRowHtml).join('') || '<div class="empty-state">No payment methods saved yet.</div>'}
    </div>
  `;

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

    ${addrCardHtml}
    ${cardCardHtml}

    <div class="section-card" id="passkeysCard">
      <div class="card-header">
        <h2 class="nx-heading">Passkeys (${passkeysFiltered.length})</h2>
        <span class="priv-status-pill accent">Software authenticator</span>
      </div>
      ${passkeysEncWarningHtml}
      ${passkeysRowsHtml || '<div class="empty-state">No passkeys yet. When a site offers "Sign in with a passkey", nextGx will create one here — no security key or Windows Hello needed. Passkeys never sync to a Google account.</div>'}
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

  // Passkey row controls: two-step Delete confirm so a misclick cannot destroy an unrecoverable private key
  mainContainer.querySelectorAll('.del-pk').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.card-row')?.dataset.id;
      if (!id || !window.gxChromePagesAPI.deletePasskey) return;
      if (btn.dataset.confirmDelete !== '1') {
        btn.dataset.confirmDelete = '1';
        btn.textContent = 'Confirm delete?';
        btn.classList.add('danger-solid');
        clearTimeout(btn._confirmTimer);
        btn._confirmTimer = setTimeout(() => {
          btn.dataset.confirmDelete = '';
          btn.textContent = 'Delete';
          btn.classList.remove('danger-solid');
        }, 4500);
        return;
      }
      clearTimeout(btn._confirmTimer);
      btn.disabled = true;
      await window.gxChromePagesAPI.deletePasskey(id);
      renderPasswordsPage();
    });
  });

  // [Wave2-D] Addresses (gap 6.3): add / edit / delete.
  document.getElementById('btnToggleAddAddr')?.addEventListener('click', () => {
    addrFormOpen = !addrFormOpen;
    addrFormError = '';
    addrEditingId = null;
    renderPasswordsPage();
  });
  document.getElementById('btnCancelAddAddr')?.addEventListener('click', () => {
    addrFormOpen = false;
    addrFormError = '';
    renderPasswordsPage();
  });
  const addrAddForm = document.getElementById('addrAddForm');
  if (addrAddForm) {
    addrAddForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!window.gxChromePagesAPI.addAddress) return;
      const val = (id) => document.getElementById(id)?.value.trim() || '';
      const res = await window.gxChromePagesAPI.addAddress({
        label: val('addrAddLabel'),
        fullName: val('addrAddFullName'),
        organization: val('addrAddOrganization'),
        addressLine1: val('addrAddLine1'),
        addressLine2: val('addrAddLine2'),
        city: val('addrAddCity'),
        region: val('addrAddRegion'),
        postalCode: val('addrAddPostal'),
        country: val('addrAddCountry'),
        phone: val('addrAddPhone'),
        email: val('addrAddEmail')
      });
      if (!res || res.ok === false) {
        addrFormError = res?.error || 'Could not save address.';
        const errEl = document.getElementById('addrAddError');
        if (errEl) errEl.textContent = addrFormError;
        return;
      }
      addrFormOpen = false;
      addrFormError = '';
      renderPasswordsPage();
    });
  }
  mainContainer.querySelectorAll('.edit-addr').forEach((btn) => {
    btn.addEventListener('click', () => {
      addrEditingId = btn.closest('.card-row')?.dataset.id || null;
      addrFormError = '';
      addrFormOpen = false;
      renderPasswordsPage();
    });
  });
  mainContainer.querySelectorAll('.del-addr').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.card-row')?.dataset.id;
      if (!id || !window.gxChromePagesAPI.removeAddress) return;
      await window.gxChromePagesAPI.removeAddress(id);
      renderPasswordsPage();
    });
  });
  const addrEditForm = mainContainer.querySelector('.addr-edit-form[data-id]');
  if (addrEditForm) {
    const q = (name) => addrEditForm.querySelector(`.addr-edit-${name}`);
    addrEditForm.querySelector('.cancel-edit-addr')?.addEventListener('click', () => {
      addrEditingId = null;
      addrFormError = '';
      renderPasswordsPage();
    });
    addrEditForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!window.gxChromePagesAPI.updateAddress) return;
      const res = await window.gxChromePagesAPI.updateAddress({
        id: addrEditForm.dataset.id,
        label: q('label')?.value.trim() || '',
        fullName: q('fullName')?.value.trim() || '',
        organization: q('organization')?.value.trim() || '',
        addressLine1: q('addressLine1')?.value.trim() || '',
        addressLine2: q('addressLine2')?.value.trim() || '',
        city: q('city')?.value.trim() || '',
        region: q('region')?.value.trim() || '',
        postalCode: q('postalCode')?.value.trim() || '',
        country: q('country')?.value.trim() || '',
        phone: q('phone')?.value.trim() || '',
        email: q('email')?.value.trim() || ''
      });
      if (!res || res.ok === false) {
        addrFormError = res?.error || 'Could not update address.';
        const errEl = addrEditForm.querySelector('.addr-edit-error');
        if (errEl) errEl.textContent = addrFormError;
        return;
      }
      addrEditingId = null;
      addrFormError = '';
      renderPasswordsPage();
    });
  }

  // [Wave2-D] Payment methods (gap 6.2): add / edit / delete.
  document.getElementById('btnToggleAddCard')?.addEventListener('click', () => {
    cardFormOpen = !cardFormOpen;
    cardFormError = '';
    cardEditingId = null;
    renderPasswordsPage();
  });
  document.getElementById('btnCancelAddCard')?.addEventListener('click', () => {
    cardFormOpen = false;
    cardFormError = '';
    renderPasswordsPage();
  });
  const cardAddForm = document.getElementById('cardAddForm');
  if (cardAddForm) {
    cardAddForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!window.gxChromePagesAPI.addPaymentMethod) return;
      const val = (id) => document.getElementById(id)?.value.trim() || '';
      const res = await window.gxChromePagesAPI.addPaymentMethod({
        label: val('cardAddLabel'),
        cardholderName: val('cardAddName'),
        number: val('cardAddNumber'),
        expiryMonth: Number(val('cardAddMonth')),
        expiryYear: Number(val('cardAddYear'))
      });
      if (!res || res.ok === false) {
        cardFormError = res?.error || 'Could not save card.';
        const errEl = document.getElementById('cardAddError');
        if (errEl) errEl.textContent = cardFormError;
        return;
      }
      cardFormOpen = false;
      cardFormError = '';
      renderPasswordsPage();
    });
  }
  mainContainer.querySelectorAll('.edit-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      cardEditingId = btn.closest('.card-row')?.dataset.id || null;
      cardFormError = '';
      cardFormOpen = false;
      renderPasswordsPage();
    });
  });
  mainContainer.querySelectorAll('.del-card').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.card-row')?.dataset.id;
      if (!id || !window.gxChromePagesAPI.removePaymentMethod) return;
      await window.gxChromePagesAPI.removePaymentMethod(id);
      renderPasswordsPage();
    });
  });
  const cardEditForm = mainContainer.querySelector('.card-edit-form[data-id]');
  if (cardEditForm) {
    const q = (name) => cardEditForm.querySelector(`.card-edit-${name}`);
    cardEditForm.querySelector('.cancel-edit-card')?.addEventListener('click', () => {
      cardEditingId = null;
      cardFormError = '';
      renderPasswordsPage();
    });
    cardEditForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!window.gxChromePagesAPI.updatePaymentMethod) return;
      const payload = {
        id: cardEditForm.dataset.id,
        label: q('label')?.value.trim() || '',
        cardholderName: q('name')?.value.trim() || '',
        expiryMonth: Number(q('month')?.value),
        expiryYear: Number(q('year')?.value)
      };
      const numVal = q('number')?.value.trim() || '';
      if (numVal) payload.number = numVal;
      const res = await window.gxChromePagesAPI.updatePaymentMethod(payload);
      if (!res || res.ok === false) {
        cardFormError = res?.error || 'Could not update card.';
        const errEl = cardEditForm.querySelector('.card-edit-error');
        if (errEl) errEl.textContent = cardFormError;
        return;
      }
      cardEditingId = null;
      cardFormError = '';
      renderPasswordsPage();
    });
  }

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
  notifications: 'Notifications',
  'clipboard-read': 'Clipboard',
  'screen-share': 'Screen sharing'
};

// [Wave2-D] Site settings defaults (gap 5.12) + Safety Check (gap 5.8).
const SITE_DEFAULT_PERMISSION_LABELS = {
  camera: 'Camera',
  microphone: 'Microphone',
  geolocation: 'Location',
  notifications: 'Notifications',
  'clipboard-read': 'Clipboard',
  'screen-share': 'Screen sharing'
};
let safetyCheckResults = null;
let safetyCheckRunAt = 0;

function computeSafetyCheck(dash, full, extList) {
  const ad = dash.adblock || {};
  const adblockOn = Boolean(ad.enabled);
  const trackerOn = Boolean(adblockOn && ad.trackerBlockEnabled);
  const tpMode = full.thirdPartyCookies || 'block-incognito';
  const encryptionAvailable = Boolean(dash.security && dash.security.passwordEncryptionAvailable);
  const exts = Array.isArray(extList) ? extList : [];
  const warned = exts.filter((e) => Array.isArray(e.warnings) && e.warnings.length);
  const results = [];
  results.push({
    id: 'adblock',
    label: 'Ad blocker',
    detail: adblockOn ? 'On — ads and trackers are filtered at the network layer.' : 'Off — ads and trackers are not being blocked.',
    status: adblockOn ? 'pass' : 'attention',
    action: adblockOn ? null : { id: 'adblock-on', label: 'Turn on' }
  });
  results.push({
    id: 'tracker',
    label: 'Tracker blocking',
    detail: trackerOn
      ? 'On — analytics, telemetry and tracking pixels are blocked.'
      : adblockOn
        ? 'Off — analytics and trackers are allowed through.'
        : 'Off — needs the ad blocker to be on.',
    status: trackerOn ? 'pass' : 'attention',
    action: !trackerOn && adblockOn ? { id: 'tracker-on', label: 'Turn on' } : null
  });
  results.push({
    id: 'cookies',
    label: 'Third-party cookies',
    detail:
      tpMode === 'block'
        ? 'Blocked — sites cannot use cookies from other sites.'
        : tpMode === 'block-incognito'
          ? 'Blocked in Private windows — allowed in regular windows.'
          : 'Allowed — sites can use cookies from other sites.',
    status: tpMode === 'allow' ? 'attention' : 'pass',
    action: tpMode === 'allow' ? { id: 'tp-incognito', label: 'Block in Private windows' } : null
  });
  results.push({
    id: 'encryption',
    label: 'Password encryption at rest',
    detail: encryptionAvailable
      ? 'On — saved passwords are encrypted with the OS keyring.'
      : 'Unavailable — the OS keyring is not reachable, so saved passwords are stored unencrypted.',
    status: encryptionAvailable ? 'pass' : 'attention',
    action: null
  });
  results.push({
    id: 'extensions',
    label: 'Extensions',
    detail:
      warned.length > 0
        ? `${warned.length} ${warned.length === 1 ? 'extension has' : 'extensions have'} compatibility warnings: ${warned.map((e) => e.name || e.id).join(', ')}.`
        : `${exts.length} ${exts.length === 1 ? 'extension' : 'extensions'} installed, no warnings reported.`,
    status: warned.length > 0 ? 'attention' : 'info',
    action: null
  });
  results.push({
    id: 'passwords',
    label: 'Saved logins',
    detail: `${Number(dash.security?.savedPasswordsCount || 0)} saved ${Number(dash.security?.savedPasswordsCount || 0) === 1 ? 'login' : 'logins'} in this profile.`,
    status: 'info',
    action: null
  });
  return results;
}

function navigateToSettingsTarget(elementId) {
  pendingSettingsScrollTarget = elementId || '';
  switchPage('settings');
}

async function renderPrivacyPage({ force = true } = {}) {
  const seq = ++renderSeq;
  // [Wave2-D] Full settings + extensions feed the Safety Check, third-party
  // cookie control and site-permission defaults below.
  const [dash, cookiesList, fullSettings, extList] = await Promise.all([
    window.gxChromePagesAPI.getPrivacyDashboard
      ? window.gxChromePagesAPI.getPrivacyDashboard()
      : Promise.resolve(null),
    window.gxChromePagesAPI.getCookies
      ? window.gxChromePagesAPI.getCookies()
      : Promise.resolve([]),
    window.gxChromePagesAPI.getSettings
      ? window.gxChromePagesAPI.getSettings().catch(() => ({}))
      : Promise.resolve({}),
    window.gxChromePagesAPI.getExtensions
      ? window.gxChromePagesAPI.getExtensions().catch(() => [])
      : Promise.resolve([])
  ]);
  if (seq !== renderSeq || currentPage !== 'privacy' || !dash) return;

  const cookiesCount = Array.isArray(cookiesList) ? cookiesList.length : 0;
  const full = fullSettings && typeof fullSettings === 'object' ? fullSettings : {};
  const renderKey = JSON.stringify({
    q: searchQuery,
    dash,
    cookiesCount,
    tp: full.thirdPartyCookies,
    defaults: full.sitePermissionDefaults,
    safety: safetyCheckResults
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
    // [Wave2-D] Per-site cookie counts (gap 5.12): match stored cookie
    // domains against each permission origin's host.
    const cookieCountByOrigin = {};
    const cookieDomains = (Array.isArray(cookiesList) ? cookiesList : [])
      .map((c) => String(c.domain || '').trim().toLowerCase().replace(/^\.+/, ''))
      .filter(Boolean);
    for (const entry of filteredPermissions) {
      let host = '';
      try {
        host = new URL(entry.origin).hostname.toLowerCase();
      } catch (_) {}
      if (!host) continue;
      cookieCountByOrigin[entry.origin] = cookieDomains.filter(
        (d) => d === host || host.endsWith(`.${d}`)
      ).length;
    }

    for (const entry of filteredPermissions) {
      const perms = entry.permissions || {};
      // [Wave2-D] Recent-activity summary (gap 5.12), Chrome-style.
      const allowedList = trackedKeys
        .filter((k) => (perms[k] || 'ask') === 'allow')
        .map((k) => PRIVACY_PERMISSION_LABELS[k] || k);
      const blockedList = trackedKeys
        .filter((k) => (perms[k] || 'ask') === 'block')
        .map((k) => PRIVACY_PERMISSION_LABELS[k] || k);
      const recentSummary = `Allowed: ${allowedList.join(', ') || '—'} · Blocked: ${blockedList.join(', ') || '—'}`;
      const siteCookieCount = cookieCountByOrigin[entry.origin] || 0;
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
              <div class="row-sub">Recent activity: ${escapeHtml(recentSummary)}${siteCookieCount ? ` · ${siteCookieCount} ${siteCookieCount === 1 ? 'cookie' : 'cookies'} stored` : ''}</div>
            </div>
            <button type="button" class="btn danger priv-reset-site-perms" data-origin="${escapeHtml(entry.origin)}">Reset Site</button>
          </div>
          <div class="priv-perm-grid">${chipsHtml}</div>
        </div>
      `;
    }
  }

  // [Wave2-D] Safety Check (gap 5.8), site defaults + third-party cookies (5.9/5.12).
  const safetyPassed = safetyCheckResults ? safetyCheckResults.filter((r) => r.status === 'pass').length : 0;
  const safetyAttention = safetyCheckResults ? safetyCheckResults.filter((r) => r.status === 'attention').length : 0;
  const safetyRowsHtml = safetyCheckResults
    ? safetyCheckResults
        .map(
          (r) => `
      <div class="card-row">
        <div class="row-info">
          <div class="row-title" style="cursor:default;">${escapeHtml(r.label)}</div>
          <div class="row-sub">${escapeHtml(r.detail)}</div>
        </div>
        <div class="priv-checklist-right">
          <span class="priv-status-pill ${r.status === 'pass' ? 'on' : r.status === 'attention' ? 'warn' : ''}">${
            r.status === 'pass' ? 'Looks good' : r.status === 'attention' ? 'Needs attention' : 'Info'
          }</span>
          ${r.action ? `<button type="button" class="btn safety-action" data-action="${escapeHtml(r.action.id)}">${escapeHtml(r.action.label)}</button>` : ''}
        </div>
      </div>
    `
        )
        .join('')
    : '';
  const safetyCardHtml = `
    <div class="section-card" id="safetyCheckCard">
      <div class="card-header">
        <h2 class="nx-heading">Safety Check</h2>
        <button type="button" class="btn primary" id="btnRunSafetyCheck">Run Safety Check</button>
      </div>
      ${
        safetyCheckResults
          ? `
      <div class="card-row">
        <div class="row-info">
          <div class="row-title" style="cursor:default;">${safetyPassed} passed · ${safetyAttention} need${safetyAttention === 1 ? 's' : ''} attention</div>
          <div class="row-sub">Checked locally — nothing is sent to Google or any server. Last run ${escapeHtml(new Date(safetyCheckRunAt).toLocaleTimeString())}.</div>
        </div>
      </div>
      ${safetyRowsHtml}`
          : `
      <div class="card-row">
        <div class="row-info">
          <div class="row-sub" style="margin-top:0;">A quick local audit: ad blocker, tracker blocking, third-party cookies, password encryption and extensions. Nothing leaves this browser.</div>
        </div>
      </div>`
      }
    </div>
  `;

  const siteDefaults = full.sitePermissionDefaults && typeof full.sitePermissionDefaults === 'object' ? full.sitePermissionDefaults : {};
  const siteDefaultsRowsHtml = Object.entries(SITE_DEFAULT_PERMISSION_LABELS)
    .map(([key, label]) => {
      const val = siteDefaults[key] === 'block' ? 'block' : 'ask';
      return `
    <div class="card-row">
      <div class="row-info">
        <div class="row-title" style="cursor:default;">${escapeHtml(label)}</div>
        <div class="row-sub">${val === 'ask' ? `Sites can ask to use your ${escapeHtml(label.toLowerCase())}` : `Sites cannot use your ${escapeHtml(label.toLowerCase())}`}</div>
      </div>
      <select class="priv-perm-select site-default-select" data-perm-key="${escapeHtml(key)}" aria-label="${escapeHtml(label)} default">
        <option value="ask"${val === 'ask' ? ' selected' : ''}>Sites can ask</option>
        <option value="block"${val === 'block' ? ' selected' : ''}>Don&apos;t allow</option>
      </select>
    </div>`;
    })
    .join('');
  const siteDefaultsCardHtml = `
    <div class="section-card" id="siteDefaultsCard">
      <div class="card-header">
        <h2 class="nx-heading">Site settings — defaults for new sites</h2>
        <button type="button" class="btn" id="btnViewSiteData">View permissions and data stored across sites</button>
      </div>
      <div class="card-row">
        <div class="row-sub" style="margin-top:0;">These defaults apply to sites you haven&apos;t set a choice for yet. A per-site choice above always wins.</div>
      </div>
      ${siteDefaultsRowsHtml}
    </div>
  `;

  const tpMode = full.thirdPartyCookies || 'block-incognito';
  const tpOption = (value, title, sub) => `
    <label class="card-row" style="cursor:pointer;">
      <div class="row-info">
        <div class="row-title" style="cursor:pointer;">${title}</div>
        <div class="row-sub">${sub}</div>
      </div>
      <input type="radio" name="tpCookies" value="${value}" ${tpMode === value ? 'checked' : ''} style="accent-color:var(--accent);flex-shrink:0;" />
    </label>`;
  const tpCookiesCardHtml = `
    <div class="section-card" id="thirdPartyCookiesCard">
      <div class="card-header"><h2 class="nx-heading">Third-party cookies</h2></div>
      ${tpOption('allow', 'Allow third-party cookies', 'Sites can use cookies from other sites.')}
      ${tpOption('block-incognito', 'Block third-party cookies in Incognito mode', 'Third-party cookies are blocked in Private windows.')}
      ${tpOption('block', 'Block third-party cookies', 'Sites can&apos;t use cookies from other sites. Some sites may break.')}
      <div class="card-row"><div class="row-sub" style="margin-top:0;">Blocking works at the network level: cookie headers from other sites are stripped before they are sent or stored.</div></div>
    </div>
  `;

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

    ${safetyCardHtml}

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

    ${siteDefaultsCardHtml}
    ${tpCookiesCardHtml}

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

  // [Wave2-D] Safety Check (gap 5.8): local audit, re-runnable.
  document.getElementById('btnRunSafetyCheck')?.addEventListener('click', () => {
    safetyCheckResults = computeSafetyCheck(dash, full, extList);
    safetyCheckRunAt = Date.now();
    renderPrivacyPage({ force: true });
  });
  mainContainer.querySelectorAll('.safety-action').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;
      if (action === 'adblock-on') {
        await window.gxChromePagesAPI.toggleAdblock(true);
      } else if (action === 'tracker-on') {
        if (window.gxChromePagesAPI.toggleTrackerBlock) {
          await window.gxChromePagesAPI.toggleTrackerBlock(true);
        } else {
          await window.gxChromePagesAPI.updateSettings({ trackerBlockEnabled: true });
        }
      } else if (action === 'tp-incognito') {
        await window.gxChromePagesAPI.updateSettings({ thirdPartyCookies: 'block-incognito' });
      }
      safetyCheckResults = null;
      renderPrivacyPage({ force: true });
    });
  });

  // [Wave2-D] Site settings defaults (gap 5.12). Send only the changed key;
  // the storage layer merges it onto the current map, so two quick changes
  // in a row compose instead of clobbering each other.
  mainContainer.querySelectorAll('.site-default-select').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const key = sel.dataset.permKey;
      if (!key) return;
      await window.gxChromePagesAPI.updateSettings({
        sitePermissionDefaults: { [key]: sel.value === 'block' ? 'block' : 'ask' }
      });
      renderPrivacyPage({ force: true });
    });
  });
  document.getElementById('btnViewSiteData')?.addEventListener('click', () => {
    navigateToSettingsTarget('cookiesSettingsCard');
  });

  // [Wave2-D] Third-party cookies (gap 5.9): wired to the session cookie
  // controls (network-level blocking) via settings:update.
  mainContainer.querySelectorAll('input[name="tpCookies"]').forEach((radio) => {
    radio.addEventListener('change', async () => {
      await window.gxChromePagesAPI.updateSettings({ thirdPartyCookies: radio.value });
      renderPrivacyPage({ force: true });
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
    <button class="btn" id="btnLoadPacked"${devMode ? '' : ' disabled title="Enable Developer Mode to load .crx/.zip extensions" style="opacity:0.45;cursor:not-allowed;"'}>+ Load .crx / .zip</button>
    ${devMode ? '' : '<span id="extDevModeHint" style="color:var(--text-secondary);font-size:11.5px;">Enable Developer Mode to load extensions</span>'}
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

  const handleExtLoadResult = (res, label) => {
    if (!res) {
      extStatusBanner = {
        kind: 'error',
        title: `Failed to load ${label}`,
        detail: 'No response was returned from the browser extension loader.'
      };
    } else if (res.canceled) {
      // User closed picker
    } else if (!res.ok) {
      extStatusBanner = {
        kind: 'error',
        title: `Failed to load ${label}`,
        detail: res.error || 'Unknown error while loading extension.'
      };
    } else if (Array.isArray(res.warnings) && res.warnings.length > 0) {
      extStatusBanner = {
        kind: 'warning',
        title: `Loaded "${res.extension?.name || 'Extension'}" with compatibility notes`,
        detail: res.incognitoNotice
          ? 'Loaded into standard browser windows (Electron cannot load extensions into temporary Private sessions).'
          : 'Extension loaded cleanly with the following compatibility notes:',
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
  };

  const loadBtn = document.getElementById('btnLoadUnpacked');
  if (loadBtn && devMode) {
    loadBtn.addEventListener('click', async () => {
      loadBtn.disabled = true;
      loadBtn.textContent = 'Loading...';
      try {
        const res = await window.gxChromePagesAPI.loadUnpackedExtension();
        handleExtLoadResult(res, 'unpacked extension');
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

  const loadPackedBtn = document.getElementById('btnLoadPacked');
  if (loadPackedBtn && devMode && typeof window.gxChromePagesAPI.loadPackedExtension === 'function') {
    loadPackedBtn.addEventListener('click', async () => {
      loadPackedBtn.disabled = true;
      loadPackedBtn.textContent = 'Unpacking...';
      try {
        const res = await window.gxChromePagesAPI.loadPackedExtension();
        handleExtLoadResult(res, 'packed extension (.crx/.zip)');
      } catch (err) {
        extStatusBanner = {
          kind: 'error',
          title: 'Failed to load packed extension',
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
            <label class="nx-switch" title="Always on — the Media & AI Overlay is a core part of nextGx and cannot be turned off">
              <input type="checkbox" checked disabled />
              <span class="nx-slider"></span>
            </label>
          </div>
          <div class="row-sub" style="margin-top:6px;">Always on — a core part of nextGx, so it cannot be turned off.</div>
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
    // [Wave2-D] Details (gap 10.1): ID, source path, version and manifest
    // version, available whether or not Developer mode is on. When dev mode
    // is on the card already shows ID + Source above, so the panel only adds
    // the version line there (no duplicated rows).
    const detailsHtml = `
      <div class="ext-details" data-id="${escapeHtml(ext.id)}" style="display:none;">
        <div class="ext-dev-meta">
          ${devMode ? '' : `<div>ID: ${escapeHtml(ext.id)}</div>`}
          ${devMode || !ext.path ? '' : `<div>Source: ${escapeHtml(ext.path)}</div>`}
          <div>Version: ${escapeHtml(ext.version || '1.0')}${mvLabel ? ` · ${escapeHtml(mvLabel)}` : ''} · Unpacked extension</div>
        </div>
      </div>
    `;

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
        ${detailsHtml}
        <div class="ext-bottom">
          <div class="ext-actions">
            <button class="btn ext-details-btn" data-id="${escapeHtml(ext.id)}">Details</button>
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

  // Market audit bug #28: this card used to duplicate the full 18-row
  // keyboard-shortcuts list from Settings, even though extensions define no
  // custom shortcuts in nextGx yet. Keep only a short pointer to the
  // canonical list in Settings instead of a second copy.
  const shortcutsCardHtml = `
    <div class="section-card" id="extShortcutsCard">
      <div class="card-header">
        <h2 class="nx-heading">Keyboard shortcuts</h2>
        <button type="button" class="btn" id="btnExtShortcutsSettings">See all shortcuts in Settings</button>
      </div>
      <div class="card-row" style="padding:12px 20px;">
        <div class="row-info">
          <div class="row-title" style="cursor:default;font-weight:400;">Extensions don&apos;t define custom shortcuts in nextGx yet.</div>
          <div class="row-sub">The browser shortcuts (new tab, tab search, split view…) live in Settings.</div>
        </div>
      </div>
    </div>
  `;

  mainContainer.innerHTML = `${bannersHtml}${shortcutsCardHtml}${gridHtml}`;

  const btnExtShortcuts = document.getElementById('btnExtShortcutsSettings');
  if (btnExtShortcuts) {
    btnExtShortcuts.addEventListener('click', () => switchPage('settings'));
  }

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

  // [Wave2-D] Details toggle (gap 10.1).
  mainContainer.querySelectorAll('.ext-details-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const panel = mainContainer.querySelector(`.ext-details[data-id="${CSS.escape(btn.dataset.id)}"]`);
      if (!panel) return;
      const isOpen = panel.style.display !== 'none';
      panel.style.display = isOpen ? 'none' : 'block';
      btn.textContent = isOpen ? 'Details' : 'Hide details';
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
  const openProfileIds = Array.isArray(data.openProfileIds) ? data.openProfileIds : [];

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
          <button type="button" class="btn ${isThisWindow ? '' : 'primary'} switch-profile-btn" data-profile-id="${escapeHtml(prof.id)}"${isThisWindow ? ' disabled title="This is the current window"' : ''}>${isThisWindow ? 'Current Window' : (openProfileIds.includes(prof.id) ? 'Focus Window' : 'Switch')}</button>
          <button type="button" class="btn rename-profile-btn" data-profile-id="${escapeHtml(prof.id)}">Rename</button>
          <button type="button" class="btn danger delete-profile-btn" data-profile-id="${escapeHtml(prof.id)}"${isDefault ? ' disabled title="Default profile cannot be deleted"' : ''}>Delete</button>
        </div>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="card-row">
      <div class="row-info">
        <div class="row-sub" style="margin-top:0;">Local-only profiles with isolated cookies, history, bookmarks, passwords, theme, and sidebar layout. If a profile already has a window open, switching focuses that window and restores its tabs — it never opens a duplicate window.</div>
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
          detail: res.focusedExisting
            ? 'Focused the window already open in this profile — its tabs are exactly as you left them.'
            : 'Opened a new browser window in this profile and restored its saved tabs. Existing tabs remain in their current window.'
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
    btn.addEventListener('click', async () => {
      const id = btn.dataset.profileId;
      if (!id || id === 'default') return;
      const target = profiles.find((pr) => pr.id === id);
      const confirmed = await showWebuiConfirmModal({
        title: `Delete "${target?.name || id}"?`,
        body: 'This permanently removes its local cookies, cache, history, bookmarks, passwords, and settings. This cannot be undone.',
        confirmLabel: 'Delete Profile',
        danger: true
      });
      if (!confirmed) return;
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


// UX phase: one proper confirm modal for destructive WebUI actions
// (profile delete, …). Centred overlay with backdrop dim, Esc/backdrop
// cancels, focus starts on Cancel so Enter cannot delete by accident.
function showWebuiConfirmModal({ title, body, confirmLabel = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'nx-webui-modal-backdrop';
    overlay.innerHTML = `
      <div class="nx-webui-modal" role="alertdialog" aria-modal="true" aria-label="${escapeHtml(title || 'Confirm')}">
        <h2 class="nx-heading" style="font-size:16px;">${escapeHtml(title || 'Are you sure?')}</h2>
        <p class="nx-webui-modal-body">${escapeHtml(body || '')}</p>
        <div class="nx-webui-modal-actions">
          <button type="button" class="btn nx-webui-modal-cancel">Cancel</button>
          <button type="button" class="btn ${danger ? 'danger-solid' : 'primary'} nx-webui-modal-confirm">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;
    const done = (value) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        done(false);
      }
    };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) done(false);
    });
    overlay.querySelector('.nx-webui-modal-cancel').addEventListener('click', () => done(false));
    overlay.querySelector('.nx-webui-modal-confirm').addEventListener('click', () => done(true));
    document.body.appendChild(overlay);
    overlay.querySelector('.nx-webui-modal-cancel').focus();
  });
}

// Market audit bug #24 — Speed Dial delete confirm (shared helper).
// The live delete site is the new tab page (src/ui/newtab.html), which
// already shows an undo bar after a delete ("Removed …" + Undo, 5 s).
// This helper is the WebUI-side confirm-then-delete used wherever a Speed
// Dial is removed from chrome-webui code, and the pattern newtab should
// follow if its undo bar is ever replaced: confirm first, then remove,
// then offer restore. It is deliberately API-agnostic: pass the remove /
// restore calls for the page you are on (gxNewTabAPI.removeSpeedDial /
// addSpeedDial on the new tab page, gxChromePagesAPI equivalents if a
// WebUI page ever manages dials). Returns true when the dial was removed.
// WIRING NEEDED (newtab.html, not this file — owned by another agent):
// in the `.tile-del` click handler, replace the direct
// `removeSpeedDial(item.id)` + `showDialUndo(removed)` with
// `await requestSpeedDialDelete({ title: item.title, url: item.url,
// remove: () => window.gxNewTabAPI.removeSpeedDial(item.id),
// restore: () => window.gxNewTabAPI.addSpeedDial({ title: item.title,
// url: item.url }) })` and re-render from its returned list; keep
// showDialUndo as the undo step after a confirmed delete.
async function requestSpeedDialDelete({ title, url, remove, restore, onRemoved } = {}) {
  const label = title || url || 'this Speed Dial tile';
  const confirmed = await showWebuiConfirmModal({
    title: 'Remove Speed Dial?',
    body: `Remove “${label}” from your Speed Dial? You can undo this right after deleting it.`,
    confirmLabel: 'Remove',
    danger: true
  });
  if (!confirmed) return false;
  const updated = typeof remove === 'function' ? await remove() : null;
  if (typeof onRemoved === 'function') onRemoved(updated);
  // Undo hook for the caller: restore re-adds the tile. Callers that
  // already show an undo bar (newtab's showDialUndo) should pass the
  // removed tile there instead of calling restore directly.
  requestSpeedDialDelete.lastRemoved = { title, url, restore };
  return true;
}
let searchEngineFormOpen = false;
let searchEngineEditingId = null;
let searchEngineError = '';
let langAddSelected = 'es-ES';
let aboutVersionInfo = null;
let defaultBrowserMsg = '';
let defaultBrowserMsgKind = '';
let resetConfirmOpen = false;
let clearDataRange = 'hour';
let clearDataMsg = '';

const SEARCH_ENGINE_DEFAULTS = [
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=%s', keyword: '', siteSearch: false, builtin: true },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=%s', keyword: 'bing', siteSearch: false, builtin: true },
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', keyword: 'ddg', siteSearch: false, builtin: true },
  { id: 'brave', name: 'Brave', url: 'https://search.brave.com/search?q=%s', keyword: 'brave', siteSearch: false, builtin: true },
  { id: 'ecosia', name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s', keyword: 'ecosia', siteSearch: false, builtin: true }
];

const PREFERRED_LANGUAGE_OPTIONS = [
  ['en-US', 'English (United States)'],
  ['en-GB', 'English (United Kingdom)'],
  ['bn-BD', 'Bengali (Bangladesh)'],
  ['hi-IN', 'Hindi (India)'],
  ['es-ES', 'Spanish (Spain)'],
  ['es-MX', 'Spanish (Mexico)'],
  ['fr-FR', 'French (France)'],
  ['de-DE', 'German (Germany)'],
  ['pt-BR', 'Portuguese (Brazil)'],
  ['ar-EG', 'Arabic (Egypt)'],
  ['zh-CN', 'Chinese (Simplified)'],
  ['ja-JP', 'Japanese'],
  ['ko-KR', 'Korean'],
  ['ru-RU', 'Russian'],
  ['it-IT', 'Italian'],
  ['nl-NL', 'Dutch'],
  ['tr-TR', 'Turkish'],
  ['vi-VN', 'Vietnamese'],
  ['id-ID', 'Indonesian'],
  ['ms-MY', 'Malay'],
  ['ur-PK', 'Urdu (Pakistan)'],
  ['fa-IR', 'Persian (Iran)'],
  ['uk-UA', 'Ukrainian'],
  ['pl-PL', 'Polish']
];

function languageDisplayName(tag) {
  const found = PREFERRED_LANGUAGE_OPTIONS.find(([t]) => t === tag);
  return found ? found[1] : tag;
}

function validateSearchEngineInput(name, url, keyword, engines, excludeId) {
  const cleanName = String(name || '').trim();
  if (!cleanName) return { ok: false, error: 'Engine name cannot be empty.' };
  const cleanUrl = String(url || '').trim();
  if (!/^https?:\/\//i.test(cleanUrl)) return { ok: false, error: 'URL template must start with http:// or https://.' };
  if (!cleanUrl.includes('%s')) return { ok: false, error: 'URL template must contain %s where the search terms go.' };
  try {
    const test = new URL(cleanUrl.replace('%s', 'test'));
    if (!test.hostname) return { ok: false, error: 'URL template is not a valid web address.' };
  } catch (_) {
    return { ok: false, error: 'URL template is not a valid web address.' };
  }
  const cleanKeyword = String(keyword || '').trim().toLowerCase().replace(/\s+/g, '');
  if (cleanKeyword) {
    const clash = (engines || []).some(
      (e) => e && e.id !== excludeId && typeof e.keyword === 'string' && e.keyword.toLowerCase() === cleanKeyword
    );
    if (clash) return { ok: false, error: `Keyword "${cleanKeyword}" is already used by another engine.` };
  }
  return { ok: true, name: cleanName, url: cleanUrl, keyword: cleanKeyword };
}

// [Wave2-D] Search engine manager card (gap 5.2): editable engine list,
// site search entries, default picker, shortcut mode.
function renderSearchEngineCardHtml(s) {
  const engines = Array.isArray(s.searchEngines) ? s.searchEngines : [];
  const defaultId = s.searchEngine || 'google';
  const defaultEngines = engines.filter((e) => !e.siteSearch);
  const siteEngines = engines.filter((e) => e.siteSearch);

  const engineRow = (e) => {
    const isDefault = e.id === defaultId;
    if (searchEngineEditingId === e.id) {
      return `
      <div class="card-row bm-editing" data-id="${escapeHtml(e.id)}">
        <form class="bm-edit-form search-engine-edit-form" data-id="${escapeHtml(e.id)}">
          <div class="bm-edit-grid">
            <label class="bm-edit-field">
              <span class="bm-field-label">Name</span>
              <input type="text" class="input-box se-edit-name" value="${escapeHtml(e.name)}" required />
            </label>
            <label class="bm-edit-field">
              <span class="bm-field-label">URL template (%s = search terms)</span>
              <input type="text" class="input-box se-edit-url" value="${escapeHtml(e.url)}" required />
            </label>
            <label class="bm-edit-field">
              <span class="bm-field-label">Shortcut keyword</span>
              <input type="text" class="input-box se-edit-keyword" value="${escapeHtml(e.keyword || '')}" placeholder="e.g. ddg" />
            </label>
          </div>
          <div class="bm-edit-footer">
            <span class="bm-form-error se-edit-error">${escapeHtml(searchEngineError)}</span>
            <div class="bm-actions">
              <button type="button" class="btn cancel-edit-se">Cancel</button>
              <button type="submit" class="btn primary save-edit-se">Save</button>
            </div>
          </div>
        </form>
      </div>`;
    }
    return `
      <div class="card-row" data-id="${escapeHtml(e.id)}">
        <div class="row-info">
          <div class="row-title" style="cursor:default;">${escapeHtml(e.name)}${isDefault ? ' <span class="priv-status-pill accent" style="margin-left:6px;">Default</span>' : ''}</div>
          <div class="row-sub">${escapeHtml(e.url)}${e.keyword ? ` · Keyword: ${escapeHtml(e.keyword)}` : ''}</div>
        </div>
        <div class="pw-row-actions">
          ${!e.siteSearch && !isDefault ? `<button type="button" class="btn se-make-default" data-id="${escapeHtml(e.id)}">Make default</button>` : ''}
          <button type="button" class="btn se-edit" data-id="${escapeHtml(e.id)}">Edit</button>
          ${!isDefault ? `<button type="button" class="btn danger se-remove" data-id="${escapeHtml(e.id)}">Remove</button>` : ''}
        </div>
      </div>`;
  };

  const addFormHtml = searchEngineFormOpen
    ? `
      <div class="card-row bm-editing">
        <form id="searchEngineAddForm" class="bm-edit-form">
          <div class="bm-edit-grid">
            <label class="bm-edit-field">
              <span class="bm-field-label">Name</span>
              <input type="text" id="seAddName" class="input-box" placeholder="e.g. Wikipedia" required />
            </label>
            <label class="bm-edit-field">
              <span class="bm-field-label">URL template (%s = search terms)</span>
              <input type="text" id="seAddUrl" class="input-box" placeholder="https://en.wikipedia.org/w/index.php?search=%s" required />
            </label>
            <label class="bm-edit-field">
              <span class="bm-field-label">Shortcut keyword</span>
              <input type="text" id="seAddKeyword" class="input-box" placeholder="e.g. wiki" />
            </label>
          </div>
          <div class="bm-edit-footer">
            <span class="bm-form-error" id="seAddError">${escapeHtml(searchEngineError)}</span>
            <div class="bm-actions" style="align-items:center;">
              <label style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;cursor:pointer;">
                <input type="checkbox" id="seAddSiteSearch" style="accent-color:var(--accent);" /> Site search only (keyword only, never the default)
              </label>
              <button type="button" class="btn" id="btnCancelAddEngine">Cancel</button>
              <button type="submit" class="btn primary">Add engine</button>
            </div>
          </div>
        </form>
      </div>
    `
    : '';

  const shortcutMode = s.searchShortcutMode === 'tab' ? 'tab' : 'space-or-tab';
  return `
    <div class="section-card" id="searchEngineCard">
      <div class="card-header">
        <h2 class="nx-heading">Search Engine</h2>
        <span style="display:flex;gap:8px;">
          <button type="button" class="btn" id="btnRestoreSearchDefaults">Restore defaults</button>
          <button type="button" class="btn primary" id="btnToggleAddEngine">${searchEngineFormOpen ? 'Close' : '+ Add search engine'}</button>
        </span>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Default search engine</div>
          <div class="row-sub">Address bar searches use the default engine. Type a keyword, then a space, then your query to search with a site search engine.</div>
        </div>
      </div>
      ${defaultEngines.map(engineRow).join('') || '<div class="empty-state">No search engines configured.</div>'}
      <div class="card-header" style="border-top:1px solid var(--border);">
        <h2 class="nx-heading">Site search</h2>
        <span style="font-size:12px;color:var(--text-secondary);">Keyword only</span>
      </div>
      ${siteEngines.map(engineRow).join('') || '<div class="empty-state" style="padding:20px;">No site search engines yet. Add one with a keyword above.</div>'}
      ${addFormHtml}
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Keyboard shortcut to search</div>
          <div class="row-sub">How a site search keyword is triggered from the address bar</div>
        </div>
        <div class="nx-segmented" id="setSearchShortcutSeg">
          <button type="button" class="seg-btn ${shortcutMode === 'space-or-tab' ? 'active' : ''}" data-mode="space-or-tab">Space or Tab</button>
          <button type="button" class="seg-btn ${shortcutMode === 'tab' ? 'active' : ''}" data-mode="tab">Tab</button>
        </div>
      </div>
    </div>
  `;
}

function bindSearchEngineCard(s) {
  const engines = Array.isArray(s.searchEngines) ? s.searchEngines : [];
  // [Wave2-D] saveEngines always transforms the LIVE engine list (fresh
  // settings read): two quick edits in a row must not clobber each other
  // (a render-time snapshot would resurrect a just-removed engine).
  const saveEngines = async (transform) => {
    const fresh = (await window.gxChromePagesAPI.getSettings?.()) || {};
    const live = Array.isArray(fresh.searchEngines) ? fresh.searchEngines : engines;
    const nextList = transform(live);
    await window.gxChromePagesAPI.updateSettings({ searchEngines: nextList });
    renderSettingsPage();
  };

  mainContainer.querySelectorAll('.se-make-default').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await window.gxChromePagesAPI.updateSettings({ searchEngine: btn.dataset.id });
      renderSettingsPage();
    });
  });

  mainContainer.querySelectorAll('.se-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      searchEngineEditingId = btn.dataset.id;
      searchEngineError = '';
      searchEngineFormOpen = false;
      renderSettingsPage();
    });
  });

  mainContainer.querySelectorAll('.se-remove').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await saveEngines((live) => live.filter((e) => e.id !== btn.dataset.id));
    });
  });

  document.getElementById('btnToggleAddEngine')?.addEventListener('click', () => {
    searchEngineFormOpen = !searchEngineFormOpen;
    searchEngineError = '';
    searchEngineEditingId = null;
    renderSettingsPage();
  });
  document.getElementById('btnCancelAddEngine')?.addEventListener('click', () => {
    searchEngineFormOpen = false;
    searchEngineError = '';
    renderSettingsPage();
  });
  document.getElementById('btnRestoreSearchDefaults')?.addEventListener('click', async () => {
    searchEngineEditingId = null;
    searchEngineFormOpen = false;
    searchEngineError = '';
    await window.gxChromePagesAPI.updateSettings({
      searchEngines: JSON.parse(JSON.stringify(SEARCH_ENGINE_DEFAULTS)),
      searchEngine: 'google'
    });
    renderSettingsPage();
  });

  mainContainer.querySelectorAll('#setSearchShortcutSeg .seg-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await window.gxChromePagesAPI.updateSettings({ searchShortcutMode: btn.dataset.mode });
      renderSettingsPage();
    });
  });

  const addForm = document.getElementById('searchEngineAddForm');
  if (addForm) {
    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('seAddName')?.value || '';
      const url = document.getElementById('seAddUrl')?.value || '';
      const keyword = document.getElementById('seAddKeyword')?.value || '';
      const siteSearch = document.getElementById('seAddSiteSearch')?.checked || false;
      const check = validateSearchEngineInput(name, url, keyword, engines, null);
      if (!check.ok) {
        searchEngineError = check.error;
        const errEl = document.getElementById('seAddError');
        if (errEl) errEl.textContent = check.error;
        return;
      }
      const idBase = check.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'custom';
      let id = idBase;
      let n = 2;
      while (engines.some((x) => x.id === id)) {
        id = `${idBase}-${n}`;
        n += 1;
      }
      await saveEngines((live) => [
        ...live,
        { id, name: check.name, url: check.url, keyword: check.keyword, siteSearch, builtin: false }
      ]);
      searchEngineFormOpen = false;
      searchEngineError = '';
    });
  }

  const editForm = mainContainer.querySelector('.search-engine-edit-form[data-id]');
  if (editForm) {
    editForm.querySelector('.cancel-edit-se')?.addEventListener('click', () => {
      searchEngineEditingId = null;
      searchEngineError = '';
      renderSettingsPage();
    });
    editForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = editForm.dataset.id;
      const target = engines.find((x) => x.id === id);
      if (!target) return;
      const name = editForm.querySelector('.se-edit-name')?.value || '';
      const url = editForm.querySelector('.se-edit-url')?.value || '';
      const keyword = editForm.querySelector('.se-edit-keyword')?.value || '';
      const check = validateSearchEngineInput(name, url, keyword, engines, id);
      if (!check.ok) {
        searchEngineError = check.error;
        const errEl = editForm.querySelector('.se-edit-error');
        if (errEl) errEl.textContent = check.error;
        return;
      }
      await saveEngines((live) =>
        live.map((x) =>
          x.id === id ? { ...x, name: check.name, url: check.url, keyword: check.keyword } : x
        )
      );
      searchEngineEditingId = null;
      searchEngineError = '';
    });
  }
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

  const activeQuery = (cookieFilterText || '').trim().toLowerCase();
  const entries = Array.from(domainMap.entries())
    .filter(([dom]) => !activeQuery || dom.includes(activeQuery))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const renderKey = JSON.stringify({
    total: settingsCookies.length,
    q: activeQuery,
    showAll: cookieShowAll,
    entriesCount: entries.length
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

  const MAX_COOKIE_PREVIEW = 10;
  const visibleEntries = cookieShowAll || activeQuery ? entries : entries.slice(0, MAX_COOKIE_PREVIEW);
  let rowsHtml = '';
  for (const [domain, count] of visibleEntries) {
    rowsHtml += `
      <div class="card-row cookie-domain-row" data-domain="${escapeHtml(domain)}">
        <div class="row-info">
          <div class="row-title">${escapeHtml(domain)}</div>
          <div class="row-sub">${count} ${count === 1 ? 'cookie' : 'cookies'}</div>
        </div>
        <button class="btn danger clear-site-cookies-btn" data-domain="${escapeHtml(domain)}">Clear</button>
      </div>
    `;
  }
  if (!activeQuery && entries.length > MAX_COOKIE_PREVIEW) {
    rowsHtml += `
      <div class="card-row" style="justify-content:center;">
        <button type="button" class="btn" id="btnToggleCookiesShowAll">
          ${cookieShowAll ? 'Show fewer domains' : `Show all ${entries.length} domains`}
        </button>
      </div>
    `;
  }
  container.innerHTML = rowsHtml;

  document.getElementById('btnToggleCookiesShowAll')?.addEventListener('click', () => {
    cookieShowAll = !cookieShowAll;
    renderCookieDomainsList(true);
  });

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
  const [s, sys, ad, allCookies, adblockSites, profData, versionInfo] = await Promise.all([
    window.gxChromePagesAPI.getSettings(),
    window.gxChromePagesAPI.getSystemStats(),
    window.gxChromePagesAPI.getAdblockStats(),
    window.gxChromePagesAPI.getCookies ? window.gxChromePagesAPI.getCookies() : Promise.resolve([]),
    window.gxChromePagesAPI.getAdblockSites ? window.gxChromePagesAPI.getAdblockSites() : Promise.resolve({}),
    window.gxChromePagesAPI.listProfiles ? window.gxChromePagesAPI.listProfiles() : Promise.resolve(null),
    // [Wave2-D] About page version (gap 5.14).
    window.gxChromePagesAPI.getAppVersion
      ? window.gxChromePagesAPI.getAppVersion().catch(() => null)
      : Promise.resolve(null)
  ]);
  if (seq !== renderSeq || currentPage !== 'settings') return;
  settingsProfilesData = profData;
  if (versionInfo) aboutVersionInfo = versionInfo;

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

  // [Wave2-D] Search engine manager (gap 5.2) + startup options (gap 5.3).
  const searchEngineCardHtml = renderSearchEngineCardHtml(s);
  const startupMode = s.startupMode || (s.restoreSession !== false ? 'restore' : 'newtab');
  const startupRadio = (value, title, sub) => `
    <label class="card-row" style="cursor:pointer;">
      <div class="row-info">
        <div class="row-title" style="cursor:pointer;">${title}</div>
        <div class="row-sub">${sub}</div>
      </div>
      <input type="radio" name="startupMode" value="${value}" ${startupMode === value ? 'checked' : ''} style="accent-color:var(--accent);flex-shrink:0;" />
    </label>`;
  const startupUrlsHtml =
    startupMode === 'urls'
      ? `
    <div class="card-row" style="flex-direction:column;align-items:stretch;gap:10px;">
      <div class="row-info">
        <div class="row-title">Pages to open on startup</div>
        <div class="row-sub">Each page opens in its own tab when nextGx launches</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${(s.startupUrls || [])
          .map(
            (u, i) => `
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:12.5px;flex:1;word-break:break-all;">${escapeHtml(u)}</span>
            <button type="button" class="btn danger startup-url-remove" data-index="${i}">Remove</button>
          </div>`
          )
          .join('') || '<div class="row-sub">No pages yet — add one below.</div>'}
      </div>
      <form id="startupAddUrlForm" style="display:flex;gap:8px;flex-wrap:wrap;">
        <input type="text" id="startupAddUrlInput" class="input-box" placeholder="https://example.com" style="flex:1;min-width:220px;" autocomplete="off" spellcheck="false" />
        <button type="submit" class="btn primary">Add page</button>
      </form>
      <span class="settings-form-msg error" id="startupAddUrlError"></span>
    </div>`
      : '';

  // [Wave2-D] Languages (gap 5.4) + Downloads settings (gap 5.5) cards.
  const languages = Array.isArray(s.preferredLanguages) ? s.preferredLanguages : ['en-US'];
  const languagesCardHtml = `
    <div class="section-card" id="languagesSettingsCard">
      <div class="card-header"><h2 class="nx-heading">Languages</h2></div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Preferred languages</div>
          <div class="row-sub">Websites show content in these languages when available, and spell check uses them</div>
        </div>
      </div>
      ${languages
        .map(
          (tag) => `
      <div class="card-row" style="padding:9px 20px;">
        <div class="row-info">
          <div class="row-title" style="cursor:default;font-weight:400;">${escapeHtml(languageDisplayName(tag))}</div>
          <div class="row-sub">${escapeHtml(tag)}</div>
        </div>
        <button type="button" class="btn danger lang-remove" data-tag="${escapeHtml(tag)}"${languages.length <= 1 ? ' disabled title="Keep at least one language"' : ''}>Remove</button>
      </div>`
        )
        .join('')}
      <div class="card-row" style="flex-wrap:wrap;">
        <div class="row-info" style="min-width:180px;">
          <div class="row-title">Add a language</div>
        </div>
        <form id="langAddForm" style="display:flex;gap:8px;flex-wrap:wrap;">
          <select id="langAddSelect" class="priv-perm-select" style="padding:7px 10px;">
            ${PREFERRED_LANGUAGE_OPTIONS.filter(([tag]) => !languages.includes(tag))
              .map(([tag, name]) => `<option value="${escapeHtml(tag)}"${tag === langAddSelected ? ' selected' : ''}>${escapeHtml(name)}</option>`)
              .join('')}
          </select>
          <button type="submit" class="btn primary">Add language</button>
        </form>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Check spelling as you type</div>
          <div class="row-sub">Underline misspelled words in text fields, using your preferred languages</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setSpellcheckChk" ${s.spellcheckEnabled !== false ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
      <div class="card-row">
        <div class="row-sub" style="margin-top:0;">Google Translate isn&apos;t available in nextGx — it needs a Google service.</div>
      </div>
    </div>
  `;

  const downloadsCardHtml = `
    <div class="section-card" id="downloadsSettingsCard">
      <div class="card-header"><h2 class="nx-heading">Downloads</h2></div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Download location</div>
          <div class="row-sub">${escapeHtml(s.downloadPath || 'System default (Downloads folder)')}</div>
        </div>
        <div class="io-actions-group">
          <button type="button" class="btn primary" id="btnChangeDownloadPath">Change…</button>
          ${s.downloadPath ? '<button type="button" class="btn" id="btnResetDownloadPath">Use default</button>' : ''}
        </div>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Ask where to save each file before downloading</div>
          <div class="row-sub">Show a save dialog for every download</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setDownloadAskWhereChk" ${s.downloadAskWhere ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Show downloads when they&apos;re done</div>
          <div class="row-sub">Open the downloads list when a download finishes</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setDownloadShowDoneChk" ${s.downloadShowWhenDone !== false ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
    </div>
  `;

  // [Wave2-D] About (gap 5.14): live version from the app when available.
  const aboutTitle = aboutVersionInfo
    ? `nextGx Browser v${aboutVersionInfo.app} (64-bit) — Electron ${aboutVersionInfo.electron} · Chromium ${aboutVersionInfo.chrome}`
    : 'nextGx Browser v3.0.0 (64-bit) — Powered by Chromium Engine v156.0.8078.100';

  // UX phase: keyboard-shortcuts help, right in Settings (same real
  // shortcut map as the Extensions page card — see shortcuts.js).
  const settingsShortcutRows = [
    ['New tab', 'Ctrl+T'],
    ['Reopen closed tab', 'Ctrl+Shift+T'],
    ['New window', 'Ctrl+N'],
    ['New Private window', 'Ctrl+Shift+N'],
    ['Close tab', 'Ctrl+W'],
    ['Reload page', 'Ctrl+R / F5'],
    ['Focus address bar', 'Ctrl+L'],
    ['Bookmark this page', 'Ctrl+D'],
    ['History', 'Ctrl+H'],
    ['Downloads', 'Ctrl+J'],
    ['Find in page', 'Ctrl+F'],
    ['Print', 'Ctrl+P'],
    ['Zoom reset / in / out', 'Ctrl+0 / Ctrl++ / Ctrl+−'],
    ['Fullscreen', 'F11'],
    ['Developer tools', 'F12'],
    ['Search tabs', 'Ctrl+Shift+A'],
    ['Switch tabs', 'Ctrl+Tab'],
    ['Reading mode', 'Alt+Shift+R'],
    // Market audit bug #34: two shortcuts were crammed into one chip.
    ['Split view divider: resize (when focused)', '← →'],
    ['Split view divider: centre (when focused)', 'Home'],
    ['Close panel / drawer', 'Esc']
  ];
  const SHADER_LABELS = {
    none: 'Off',
    grayscale: 'Grayscale',
    sepia: 'Sepia',
    warm: 'Warm',
    cool: 'Cool',
    'high-contrast': 'High Contrast',
    vignette: 'Vignette',
    night: 'Night'
  };
  const VIDEO_FX_LABELS = {
    off: 'Off',
    sharp: 'Sharp',
    vivid: 'Vivid',
    cinema: 'Cinema'
  };
  const SIDEBAR_ITEM_LABELS = [
    ['gxCorner', 'GX Corner'],
    ['player', 'Media Player'],
    ['gxControl', 'GX Control'],
    ['gxCleaner', 'GX Cleaner'],
    ['youtube', 'YouTube'],
    ['ytMusic', 'YT Music'],
    ['spotify', 'Spotify'],
    ['twitch', 'Twitch'],
    ['discord', 'Discord'],
    ['chatgpt', 'ChatGPT'],
    ['claude', 'Claude'],
    ['gemini', 'Gemini'],
    ['perplexity', 'Perplexity'],
    ['whatsapp', 'WhatsApp'],
    ['appleMusic', 'Apple Music'],
    ['soundcloud', 'SoundCloud'],
    ['deezer', 'Deezer'],
    ['tidal', 'Tidal']
  ];
  const sidebarDockGridHtml = SIDEBAR_ITEM_LABELS.map(([key, label]) => {
    const checked = s.sidebarItems && key in s.sidebarItems ? Boolean(s.sidebarItems[key]) : false;
    return `<label class="sidebar-dock-item"><span>${escapeHtml(label)}</span><input type="checkbox" class="sidebar-dock-chk" data-sidebar-key="${escapeHtml(key)}" ${checked ? 'checked' : ''} /></label>`;
  }).join('');

  const settingsSubnavTabs = [
    ['appearance', 'Appearance', false, '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/></svg>'],
    ['gx', 'GX Features', true, '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>'],
    ['video', 'Video', false, '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="2" y="5" width="15" height="14" rx="2"/><polygon points="17 10 22 7 22 17 17 14"/></svg>'],
    ['---'],
    ['autofill', 'Autofill & Passwords', false, '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3"/></svg>'],
    ['privacy', 'Privacy & Security', false, '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>'],
    ['search', 'Search Engine', false, '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>'],
    ['default-browser', 'Default Browser', false, '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 0 0 0 18M12 3a14 14 0 0 1 0 18"/></svg>'],
    ['startup', 'On Startup', false, '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>'],
    ['---'],
    ['languages', 'Languages', false, '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M4 5h10M9 3v2m1.048 9.5A18.022 18.022 0 0 1 6.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"/></svg>'],
    ['downloads', 'Downloads', false, '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'],
    ['accessibility', 'Accessibility', false, '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="5" r="2"/><path d="M4 9h16M12 9v12M8 21l4-6 4 6"/></svg>'],
    ['system', 'System', false, '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.66 0-1.25.4-1.51 1z"/></svg>'],
    ['reset', 'Reset Settings', false, '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>'],
    ['---'],
    ['about', 'About nextGx', false, '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="9"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>']
  ];
  const settingsHeroHtml = `
    <div class="settings-gx-hero">
      <nav class="settings-gx-topnav" aria-label="Browser pages">
        <button type="button" class="settings-gx-toplink" data-jump-page="history">History</button>
        <button type="button" class="settings-gx-toplink" data-jump-page="downloads">Downloads</button>
        <span class="settings-gx-toplink active" aria-current="page">Settings</span>
        <button type="button" class="settings-gx-toplink" data-jump-page="bookmarks">Bookmarks</button>
        <button type="button" class="settings-gx-toplink" data-jump-page="extensions">Extensions</button>
      </nav>
      <div class="settings-gx-searchbar">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
        <input type="text" id="settingsHeroSearchInput" placeholder="Search settings" value="${escapeHtml(searchQuery)}" autocomplete="off" />
      </div>
    </div>
  `;
  const settingsSubnavHtml = `
    <div class="settings-subnav" role="tablist" aria-label="Settings categories">
      ${settingsSubnavTabs
        .map((entry) => {
          if (entry[0] === '---') return '<div class="settings-subnav-sep" role="separator"></div>';
          const [id, label, isGx, icon] = entry;
          return `<button type="button" role="tab" class="settings-tab-pill ${isGx ? 'gx-pill' : ''} ${settingsSubTab === id ? 'active' : ''}" data-settings-tab="${id}" aria-selected="${settingsSubTab === id ? 'true' : 'false'}">${icon}<span>${label}</span></button>`;
        })
        .join('')}
    </div>
  `;

  const CURATED_WALLPAPERS = [
    ['obsidian-wave', 'Obsidian Wave', 'assets/default-wallpaper.jpg'],
    ['midnight-alpine', 'Midnight Alpine', 'assets/wallpapers/midnight-alpine.jpg'],
    ['crimson-eclipse', 'Crimson Eclipse', 'assets/wallpapers/crimson-eclipse.jpg'],
    ['cyber-dusk', 'Cyber Dusk', 'assets/wallpapers/cyber-dusk.jpg'],
    ['violet-aurora', 'Violet Aurora', 'assets/wallpapers/violet-aurora.jpg'],
    ['emerald-nebula', 'Emerald Nebula', 'assets/wallpapers/emerald-nebula.jpg']
  ];
  const activeWpKey = s.wallpaper?.type === 'preset' ? (s.wallpaper.preset || 'obsidian-wave') : '';
  const settingsWallpapersCardHtml = `
    <div class="section-card" id="settingsWallpapersCard" data-settings-cat="appearance">
      <div class="card-header">
        <h2 class="nx-heading">Wallpapers</h2>
        <label class="nx-switch" title="Enable Start Page Wallpaper">
          <input type="checkbox" id="setWallpaperEnabledChk" ${s.wallpaper?.type !== 'none' ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
      <div class="card-row" style="flex-direction:column;align-items:stretch;gap:12px;">
        <div class="set-wp-grid" id="setWallpaperGrid">
          ${CURATED_WALLPAPERS.map(
            ([key, label, img]) =>
              `<button type="button" class="set-wp-thumb ${s.wallpaper?.type === 'preset' && activeWpKey === key ? 'active' : ''}" data-set-wp="${key}" style="background-image:url('${img}')" title="${label}"><span>${label}</span></button>`
          ).join('')}
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <input type="file" id="setWallpaperFileInput" class="hidden" accept=".png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif" />
          <button type="button" class="btn primary" id="btnSetAddWallpaper">Add your wallpaper</button>
          <span class="row-sub" id="setWallpaperMsg">${s.wallpaper?.type === 'custom' ? 'Custom wallpaper active' : 'Pick a curated wallpaper or upload your own (up to 5 MB)'}</span>
        </div>
      </div>
    </div>
  `;

  const settingsStartPageCardHtml = `
    <div class="section-card" id="settingsStartPageCard" data-settings-cat="appearance">
      <div class="card-header"><h2 class="nx-heading">Start Page</h2></div>
      <div class="card-row">
        <div class="row-info"><div class="row-title">Show minimal clock &amp; date</div><div class="row-sub">Display the clean clock header above the Start Page search bar</div></div>
        <label class="nx-switch"><input type="checkbox" id="setSpClockChk" ${s.startPageShowClock !== false ? 'checked' : ''} /><span class="nx-slider"></span></label>
      </div>
      <div class="card-row">
        <div class="row-info"><div class="row-title">Hide search box</div><div class="row-sub">Hide the search bar on the Start Page</div></div>
        <label class="nx-switch"><input type="checkbox" id="setSpHideSearchChk" ${s.startPageShowSearch === false ? 'checked' : ''} /><span class="nx-slider"></span></label>
      </div>
      <div class="card-row">
        <div class="row-info"><div class="row-title">Hide Speed Dial</div><div class="row-sub">Keep only the wallpaper and search box on the Start Page</div></div>
        <label class="nx-switch"><input type="checkbox" id="setSpHideDialChk" ${s.startPageShowSpeedDial === false ? 'checked' : ''} /><span class="nx-slider"></span></label>
      </div>
      <div class="card-row">
        <div class="row-info"><div class="row-title">Hide &ldquo;Add a site&rdquo; button</div><div class="row-sub">Hide the + tile at the end of Speed Dial</div></div>
        <label class="nx-switch"><input type="checkbox" id="setSpHideAddChk" ${s.startPageShowAddButton === false ? 'checked' : ''} /><span class="nx-slider"></span></label>
      </div>
      <div class="card-row">
        <div class="row-info"><div class="row-title">Show Speed Dial names</div><div class="row-sub">Display site names beneath brand icons</div></div>
        <label class="nx-switch"><input type="checkbox" id="setSpNamesChk" ${s.startPageShowNames !== false ? 'checked' : ''} /><span class="nx-slider"></span></label>
      </div>
      <div class="card-row">
        <div class="row-info"><div class="row-title">Use bigger Speed Dial tiles</div><div class="row-sub">Switch to larger 5-column Speed Dial cards</div></div>
        <label class="nx-switch"><input type="checkbox" id="setSpBiggerChk" ${s.startPageBiggerTiles ? 'checked' : ''} /><span class="nx-slider"></span></label>
      </div>
      <div class="card-row">
        <div class="row-info"><div class="row-title">Show Speed Dial suggestions</div><div class="row-sub">Show clean frequently visited quick-access chips beneath Speed Dial</div></div>
        <label class="nx-switch"><input type="checkbox" id="setSpSuggestionsChk" ${s.startPageShowSuggestions !== false ? 'checked' : ''} /><span class="nx-slider"></span></label>
      </div>
    </div>
  `;

  const settingsShortcutsHtml = `
    <div class="section-card" id="settingsShortcutsCard" data-settings-cat="gx">
      <div class="card-header"><h2 class="nx-heading">Keyboard shortcuts</h2></div>
      <div class="card-row" style="flex-wrap:wrap;">
        ${settingsShortcutRows
          .map(
            ([label, keys]) =>
              `<span class="nx-shortcut-row"><span class="nx-shortcut-label">${escapeHtml(label)}</span><kbd class="nx-kbd">${escapeHtml(keys)}</kbd></span>`
          )
          .join('')}
      </div>
    </div>
  `;

  const settingsThemesCardHtml = `
    <div class="section-card" id="settingsThemesCard" data-settings-cat="appearance">
      <div class="card-header"><h2 class="nx-heading">Themes</h2></div>
      <div class="card-row" style="flex-wrap:wrap;align-items:flex-start;">
        <div class="row-info" style="min-width:180px;">
          <div class="row-title">nextGx Theme</div>
          <div class="row-sub">Choose your browser accent &amp; chrome glow</div>
        </div>
        <div class="nx-segmented theme-seg-wrap" id="setThemeSeg">
          <button type="button" class="seg-btn theme-card ${s.theme === 'gx-violet' ? 'active' : ''}" data-theme="gx-violet"><span class="theme-preview gx-violet" aria-hidden="true"></span><span class="theme-card-label"><span class="theme-dot gx-violet"></span>nextGx Violet</span></button>
          <button type="button" class="seg-btn theme-card ${s.theme === 'crimson' ? 'active' : ''}" data-theme="crimson"><span class="theme-preview crimson" aria-hidden="true"></span><span class="theme-card-label"><span class="theme-dot crimson"></span>Crimson</span></button>
          <button type="button" class="seg-btn theme-card ${s.theme === 'cyan' ? 'active' : ''}" data-theme="cyan"><span class="theme-preview cyan" aria-hidden="true"></span><span class="theme-card-label"><span class="theme-dot cyan"></span>Cyber Cyan</span></button>
          <button type="button" class="seg-btn theme-card ${s.theme === 'emerald' ? 'active' : ''}" data-theme="emerald"><span class="theme-preview emerald" aria-hidden="true"></span><span class="theme-card-label"><span class="theme-dot emerald"></span>Emerald</span></button>
          <button type="button" class="seg-btn theme-card ${s.theme === 'magenta' ? 'active' : ''}" data-theme="magenta"><span class="theme-preview magenta" aria-hidden="true"></span><span class="theme-card-label"><span class="theme-dot magenta"></span>Magenta</span></button>
          <button type="button" class="seg-btn theme-card ${s.theme === 'amber' ? 'active' : ''}" data-theme="amber"><span class="theme-preview amber" aria-hidden="true"></span><span class="theme-card-label"><span class="theme-dot amber"></span>Amber</span></button>
          <button type="button" class="seg-btn theme-card ${s.theme === 'lime' ? 'active' : ''}" data-theme="lime"><span class="theme-preview lime" aria-hidden="true"></span><span class="theme-card-label"><span class="theme-dot lime"></span>Lime</span></button>
          <button type="button" class="seg-btn theme-card ${s.theme === 'ice' ? 'active' : ''}" data-theme="ice"><span class="theme-preview ice" aria-hidden="true"></span><span class="theme-card-label"><span class="theme-dot ice"></span>Ice</span></button>
        </div>
      </div>
    </div>
  `;

  const settingsVideoCardHtml = `
    <div class="section-card" id="videoSettingsCard" data-settings-cat="video">
      <div class="card-header"><h2 class="nx-heading">Video Pop-Out &amp; Enhancement</h2></div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Enable video pop-out (Picture-in-Picture)</div>
          <div class="row-sub">Detach playing videos into a floating always-on-top window from the toolbar or tab menu</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setVideoPopOutChk" ${s.videoPopOutEnabled !== false ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Video enhance (filter)</div>
          <div class="row-sub">Contrast / saturation filter on videos — applies live across open tabs</div>
        </div>
        <select id="setVideoEnhancePreset" class="priv-perm-select" style="padding:7px 10px;">
          ${Object.entries(VIDEO_FX_LABELS).map(([p, label]) => `<option value="${p}"${(s.videoEnhancePreset || 'off') === p ? ' selected' : ''}>${label}</option>`).join('')}
        </select>
      </div>
    </div>
  `;

  const settingsAutofillCardHtml = `
    <div class="section-card" id="autofillSettingsCard" data-settings-cat="autofill">
      <div class="card-header"><h2 class="nx-heading">Autofill &amp; Passwords</h2></div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Password Manager</div>
          <div class="row-sub">View, edit, generate, import, or export saved website logins</div>
        </div>
        <button type="button" class="btn primary" data-jump-page="passwords">Open Passwords &rarr;</button>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Payment Methods</div>
          <div class="row-sub">Manage encrypted saved cards for faster checkout autofill</div>
        </div>
        <button type="button" class="btn" data-jump-page="passwords">Manage Cards &rarr;</button>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Addresses &amp; More</div>
          <div class="row-sub">Manage saved shipping and contact addresses</div>
        </div>
        <button type="button" class="btn" data-jump-page="passwords">Manage Addresses &rarr;</button>
      </div>
    </div>
  `;

  if (s.accessibilityFocusHighlight) {
    document.documentElement.dataset.focusHighlight = 'true';
  } else {
    delete document.documentElement.dataset.focusHighlight;
  }

  mainContainer.innerHTML = `
    ${settingsHeroHtml}
    <div class="settings-gx-shell">
      ${settingsSubnavHtml}
      <div class="settings-gx-content">

    ${settingsThemesCardHtml}
    ${settingsWallpapersCardHtml}

    <div class="section-card section-card--gx" id="gxFeaturesCard" data-settings-cat="gx">
      <div class="card-header"><h2 class="nx-heading">GX Features, Sounds &amp; Mods</h2></div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Panic button</div>
          <div class="row-sub">Instantly hides all tabs and shows a neutral Start page — Ctrl+Shift+P, press again to restore</div>
        </div>
        <button type="button" class="btn danger" id="btnGxPanicNow">Panic now</button>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Shaders</div>
          <div class="row-sub">CSS filter over web pages — applies live to open and newly opened tabs</div>
        </div>
        <select id="setShaderPreset" class="priv-perm-select" style="padding:7px 10px;">
          ${Object.entries(SHADER_LABELS).map(([p, label]) => `<option value="${p}"${(s.shaderPreset || 'none') === p ? ' selected' : ''}>${label}</option>`).join('')}
        </select>
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
          <input type="range" id="setSoundsVolumeSlider" class="nx-range" min="0" max="100" step="1" value="${soundsVolPct}" ${soundsEnabled ? '' : 'disabled'} aria-label="GX sounds volume" />
          <span class="sounds-vol-value nx-mono" id="setSoundsVolumeVal">${soundsVolPct}%</span>
        </div>
        <div class="nx-empty-inline ${soundsEnabled ? 'hidden' : ''}" id="setSoundsOffState" role="status">
          <div class="nx-empty-inline-left">
            <span class="nx-empty-copy">Sounds are off — turn them on to hear GX sounds</span>
          </div>
          <button type="button" class="btn primary" id="btnEnableSounds">Turn on GX sounds</button>
        </div>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Keyboard sounds</div>
          <div class="row-sub">Subtle click on key presses, works independently of UI sound effects</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setKeyboardSoundsChk" ${s.keyboardSoundsEnabled ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Background music</div>
          <div class="row-sub">Ambient music preference — requires a local Mod pack with audio files</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setBackgroundMusicChk" ${s.backgroundMusicEnabled ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
      <div class="card-row">
        <div class="row-sub" id="gxSoundsNote">Checking sound pack status…</div>
      </div>
      <div class="card-row" style="flex-direction:column;align-items:stretch;gap:10px;">
        <div class="row-info">
          <div class="row-title">GX Mods — local packs only</div>
          <div class="row-sub">A pack is a local folder with a mod.json (theme + wallpaper + optional audio). No online store.</div>
          <div class="settings-form-msg" id="gxModMsg" style="display:none;"></div>
        </div>
        <div id="gxModsList"><div class="row-sub">Loading packs…</div></div>
        <div><button type="button" class="btn primary" id="btnLoadGxMod">Load a Mod pack folder…</button></div>
      </div>
    </div>

    <div class="section-card section-card--gx" data-settings-cat="gx">
      <div class="card-header"><h2 class="nx-heading">GX Performance, Limiters &amp; Memory Saver</h2></div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">GX RAM Limiter</div>
          <div class="row-sub">Automatically hibernates background tabs when browser RAM exceeds ${Number(s.gxRamLimitMB) || 4096} MB</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <input type="range" id="setGxRamLimitRange" class="nx-range" min="1024" max="16384" step="512" value="${Number(s.gxRamLimitMB) || 4096}" style="width:120px;" />
          <span class="nx-mono" id="setGxRamLimitVal" style="font-size:12px;min-width:56px;">${Number(s.gxRamLimitMB) || 4096} MB</span>
          <label class="nx-switch">
            <input type="checkbox" id="setGxRamLimiterChk" ${s.gxRamLimiterEnabled ? 'checked' : ''} />
            <span class="nx-slider"></span>
          </label>
        </div>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">GX CPU Limiter</div>
          <div class="row-sub">Throttle background tab CPU usage to ${Number(s.gxCpuLimitPercent) || 50}%</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <input type="range" id="setGxCpuLimitRange" class="nx-range" min="25" max="100" step="5" value="${Number(s.gxCpuLimitPercent) || 50}" style="width:120px;" />
          <span class="nx-mono" id="setGxCpuLimitVal" style="font-size:12px;min-width:40px;">${Number(s.gxCpuLimitPercent) || 50}%</span>
          <label class="nx-switch">
            <input type="checkbox" id="setGxCpuLimiterChk" ${s.gxCpuLimiterEnabled ? 'checked' : ''} />
            <span class="nx-slider"></span>
          </label>
        </div>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Battery saver</div>
          <div class="row-sub">Hibernates background tabs sooner (2m cap), slows stats polling, and reduces UI motion</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setBatterySaverChk" ${s.batterySaverEnabled ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
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
          <div class="row-sub">Active, split-view, pinned, and audio-playing tabs are never hibernated</div>
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
          <div class="row-sub" id="setSleepNowFeedback">${sys?.sleepingTabsCount || 0} background ${sys?.sleepingTabsCount === 1 ? 'tab' : 'tabs'} hibernated · ${sys?.activeTabsCount || 0} active</div>
        </div>
        <button class="btn primary" id="btnSetSleepNow">Hibernate Background Tabs</button>
      </div>
    </div>

    <div class="section-card" id="profilesSettingsCard" data-settings-cat="profiles">
      <div class="card-header">
        <h2 class="nx-heading">Profiles (Local)</h2>
        <button type="button" class="btn primary" id="btnSettingsAddProfile">+ Add Profile</button>
      </div>
      <div id="profilesSettingsBody"></div>
    </div>

    ${settingsVideoCardHtml}
    ${settingsAutofillCardHtml}
    ${settingsStartPageCardHtml}

    <div class="section-card" data-settings-cat="appearance">
      <div class="card-header"><h2 class="nx-heading">Appearance, Sidebar &amp; Behavior</h2></div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Show sidebar</div>
          <div class="row-sub">Display the left quick-access sidebar rail</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setShowSidebarChk" ${s.showSidebar !== false ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Colorize sidebar icons using primary color</div>
          <div class="row-sub">Tint sidebar icons to match your active theme accent</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setColorizeSidebarChk" ${s.colorizeSidebarIcons ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Reduce animations</div>
          <div class="row-sub">Minimize UI transitions and glowing motion effects across the shell</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setReduceAnimationsChk" ${s.reduceAnimations ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Address bar search suggestions</div>
          <div class="row-sub">Show live suggestions and history matches while typing in the address bar</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setAddressSuggestChk" ${s.addressBarSuggestions !== false ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Default page zoom</div>
          <div class="row-sub">Preferred default zoom level for pages</div>
        </div>
        <select id="setDefaultZoomSel" class="priv-perm-select" style="padding:6px 10px;">
          ${[75, 80, 90, 100, 110, 125, 150, 175, 200]
            .map((z) => `<option value="${z}"${Number(s.defaultPageZoom || 100) === z ? ' selected' : ''}>${z}%</option>`)
            .join('')}
        </select>
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
          <div class="row-title">Show Home Button</div>
          <div class="row-sub">Show a Home button in the toolbar that opens your homepage</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setHomeButtonChk" ${s.showHomeButton !== false ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Show Tab Search Button</div>
          <div class="row-sub">Show the tab search button (Ctrl+Shift+A) at the top of the tab strip</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setTabSearchChk" ${s.showTabSearchButton !== false ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Ctrl+Tab switches between the 2 most recent tabs</div>
          <div class="row-sub">Off switches through tabs in strip order, like Chrome&apos;s default</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setCtrlTabMruChk" ${s.ctrlTabMru ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Tab Hover Preview Card</div>
          <div class="row-sub">Show a preview card with the page title and address when hovering a tab</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setTabHoverChk" ${s.tabHoverPreview !== false ? 'checked' : ''} />
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
      <div class="card-row" style="flex-direction:column;align-items:stretch;gap:10px;">
        <div class="row-info">
          <div class="row-title">Sidebar Dock Services &amp; Tools</div>
          <div class="row-sub">Toggle which services and GX tools appear on the left sidebar rail</div>
        </div>
        <div class="sidebar-dock-grid">${sidebarDockGridHtml}</div>
      </div>
    </div>

    <div class="section-card" data-settings-cat="startup">
      <div class="card-header"><h2 class="nx-heading">On Startup</h2></div>
      ${startupRadio('newtab', 'Open the new tab page', 'Start with a fresh Speed Dial page')}
      ${startupRadio('restore', 'Continue where you left off', 'Reopen tabs from your last browsing session when nextGx launches')}
      ${startupRadio('urls', 'Open a specific page or set of pages', 'Open the pages below every time nextGx launches')}
      ${startupUrlsHtml}
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Run when my computer starts</div>
          <div class="row-sub">Automatically launch nextGx Browser when you sign in to Windows</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setRunOnStartupChk" ${s.runOnStartup ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
    </div>

    <div class="section-card" data-settings-cat="startup">
      <div class="card-header"><h2 class="nx-heading">Homepage</h2></div>
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

    ${searchEngineCardHtml.replace('class="section-card"', 'class="section-card" data-settings-cat="search"')}
    ${languagesCardHtml.replace('class="section-card"', 'class="section-card" data-settings-cat="languages"')}
    ${downloadsCardHtml.replace('class="section-card"', 'class="section-card" data-settings-cat="downloads"')}

    <div class="section-card" id="defaultBrowserSettingsCard" data-settings-cat="default-browser">
      <div class="card-header"><h2 class="nx-heading">Default Browser</h2></div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Default browser</div>
          <div class="row-sub">Make nextGx Browser the default browser for web links</div>
          <div class="settings-form-msg ${defaultBrowserMsgKind}" id="setDefaultBrowserMsg" style="display:${defaultBrowserMsg ? 'block' : 'none'};">${escapeHtml(defaultBrowserMsg)}</div>
        </div>
        <button type="button" class="btn primary" id="btnSetDefaultBrowser">Make default</button>
      </div>
    </div>

    <div class="section-card" data-settings-cat="privacy">
      <div class="card-header"><h2 class="nx-heading">Privacy Shield &amp; Security</h2></div>
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
          <div class="row-sub">Blocks ad networks, YouTube ads &amp; cosmetic ad slots — Blocked ${ad?.sessionBlocked || 0} this session (${ad?.totalBlocked || 0} lifetime)</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setAdblockChk" ${masterAdblockOn ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Block Analytics &amp; Trackers</div>
          <div class="row-sub">Blocks analytics, telemetry, session replay &amp; tracking pixels while the ad blocker is on</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setTrackerBlockChk" ${trackersActive ? 'checked' : ''} ${masterAdblockOn ? '' : 'disabled'} />
          <span class="nx-slider"></span>
        </label>
      </div>
      ${pausedSitesHtml}
      <div class="card-row" id="settingsClearDataRow" style="flex-wrap:wrap;">
        <div class="row-info" style="min-width:260px;">
          <div class="row-title">Delete Browsing Data</div>
          <div class="row-sub">The time range applies to browsing history. Cookies and cache are always cleared for all time.</div>
          <div style="display:flex;gap:8px;align-items:center;margin-top:10px;">
            <label for="setClearRangeSel" style="font-size:12.5px;font-weight:600;">Time range</label>
            <select id="setClearRangeSel" class="priv-perm-select" style="padding:6px 10px;">
              <option value="hour"${clearDataRange === 'hour' ? ' selected' : ''}>Last hour</option>
              <option value="day"${clearDataRange === 'day' ? ' selected' : ''}>Last 24 hours</option>
              <option value="week"${clearDataRange === 'week' ? ' selected' : ''}>Last 7 days</option>
              <option value="month"${clearDataRange === 'month' ? ' selected' : ''}>Last 4 weeks</option>
              <option value="all"${clearDataRange === 'all' ? ' selected' : ''}>All time</option>
            </select>
          </div>
          <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:12.5px;color:var(--text-primary);">
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
              <input type="checkbox" id="chkSetClearHistory" style="accent-color:var(--accent);" checked /> Browsing history
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
              <input type="checkbox" id="chkSetClearCookies" style="accent-color:var(--accent);" checked /> Cookies &amp; site data
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
              <input type="checkbox" id="chkSetClearCache" style="accent-color:var(--accent);" checked /> Cached images &amp; files
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
              <input type="checkbox" id="chkSetClearDownloads" style="accent-color:var(--accent);" /> Download history
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
              <input type="checkbox" id="chkSetClearPasswords" style="accent-color:var(--accent);" /> Saved passwords
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
              <input type="checkbox" id="chkSetClearAutofill" style="accent-color:var(--accent);" /> Autofill form data
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
              <input type="checkbox" id="chkSetClearSiteSettings" style="accent-color:var(--accent);" /> Site settings
            </label>
          </div>
          <div class="settings-form-msg success" id="setClearDataMsg" style="display:${clearDataMsg ? 'block' : 'none'};">${escapeHtml(clearDataMsg)}</div>
        </div>
        <button class="btn danger" id="btnSetClearData">Clear Data Now</button>
      </div>
    </div>

    <div class="section-card" id="cookiesSettingsCard" data-settings-cat="privacy">
      <div class="card-header" style="flex-wrap:wrap;">
        <h2 class="nx-heading">Cookies &amp; Site Data (<span id="totalCookieCountBadge">${settingsCookies.length}</span>)</h2>
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

    <div class="section-card" id="accessibilitySettingsCard" data-settings-cat="accessibility">
      <div class="card-header"><h2 class="nx-heading">Accessibility</h2></div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Caret browsing (F7)</div>
          <div class="row-sub">Saved preference (Chromium caret mode)</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setCaretBrowsingChk" ${s.accessibilityCaretBrowsing ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Highlight the focused item</div>
          <div class="row-sub">Show a strong high-contrast outline around the item keyboard focus is on</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setFocusHighlightChk" ${s.accessibilityFocusHighlight ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Copied to clipboard confirmations</div>
          <div class="row-sub">Show a confirmation toast when copying links, passwords, or screenshots</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setCopiedToastChk" ${s.copiedToastEnabled !== false ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
    </div>

    <div class="section-card" id="systemSettingsCard" data-settings-cat="system">
      <div class="card-header"><h2 class="nx-heading">System &amp; Network</h2></div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Continue running background apps when nextGx is closed</div>
          <div class="row-sub">Saved preference for background keep-alive</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setBackgroundAppsChk" ${s.runBackgroundApps ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Use graphics acceleration when available</div>
          <div class="row-sub">Applies at startup via Chromium GPU flag — restart nextGx to take effect</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setGpuChk" ${s.gpuAcceleration !== false ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Use DNS-over-HTTPS instead of system DNS</div>
          <div class="row-sub">Encrypts DNS lookups for stronger network privacy</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setDnsOverHttpsChk" ${s.dnsOverHttps ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Open your computer&apos;s proxy settings</div>
          <div class="row-sub">Configure system-wide network proxy in Windows Settings</div>
        </div>
        <button type="button" class="btn" id="btnOpenProxySettings">Open proxy settings</button>
      </div>
      <div class="card-row" style="flex-direction:column;align-items:stretch;gap:10px;">
        <div class="row-info">
          <div class="row-title">WebRTC IP Handling Policy</div>
          <div class="row-sub">Control how WebRTC exposes local and public network interfaces</div>
        </div>
        <div class="set-radio-list" id="setWebrtcPolicyGroup">
          ${[
            ['default', 'Use any suitable network interface (recommended)'],
            ['default_public_and_private_interfaces', 'Use default public and private network interfaces only'],
            ['default_public_interface_only', 'Use default public network interfaces only'],
            ['disable_non_proxied_udp', 'Disable non-proxied UDP']
          ]
            .map(
              ([val, label]) =>
                `<label class="set-radio-opt"><input type="radio" name="webrtcPolicy" value="${val}" ${(s.webrtcPolicy || 'default') === val ? 'checked' : ''} /><span>${label}</span></label>`
            )
            .join('')}
        </div>
      </div>
    </div>

    ${settingsShortcutsHtml}

    <div class="section-card" id="resetSettingsCard" data-settings-cat="reset">
      <div class="card-header"><h2 class="nx-heading">Reset Settings</h2></div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Reset settings</div>
          <div class="row-sub">Restore settings to their original defaults. Your bookmarks, history, passwords and extensions stay untouched.</div>
        </div>
        <span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          ${resetConfirmOpen
            ? `<span style="font-size:12px;color:var(--text-secondary);">Are you sure?</span>
          <button type="button" class="btn danger-solid" id="btnConfirmResetSettings">Yes, reset settings</button>
          <button type="button" class="btn" id="btnCancelResetSettings">Cancel</button>`
            : `<button type="button" class="btn danger" id="btnResetSettings">Restore settings to their original defaults</button>`}
        </span>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">First-Run Setup Wizard</div>
          <div class="row-sub">Re-run the interactive theme, preset, sidebar &amp; default browser setup experience</div>
        </div>
        <button type="button" class="btn" id="btnLaunchOnboarding">Launch Setup Wizard</button>
      </div>
    </div>

    <div class="section-card" id="settingsImportExportCard" data-settings-cat="reset">
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

    <div class="section-card" id="aboutSettingsCard" data-settings-cat="about">
      <div class="card-header"><h2 class="nx-heading">About nextGx Browser</h2></div>
      <div class="card-row" style="gap:16px;">
        <img src="assets/nextgx-emblem.png" alt="nextGx" width="44" height="44" style="border-radius:10px;flex-shrink:0;" />
        <div class="row-info">
          <div class="row-title">${escapeHtml(aboutTitle)}</div>
          <div class="row-sub">Designed for Windows &amp; Linux · Built-in AdGuard MV3 Shield, Media Dock &amp; Memory Saver</div>
        </div>
      </div>
      <div class="card-row" style="flex-wrap:wrap;gap:12px;">
        <div class="row-info" style="min-width:240px;">
          <div class="row-title">Software Updates (GitHub Releases + SHA256)</div>
          <div class="row-sub" id="aboutUpdateStatus">Checking update status…</div>
          <div id="aboutUpdateProgressWrap" style="display:none;margin-top:8px;width:100%;max-width:360px;height:6px;border-radius:999px;background:rgba(255,255,255,0.08);overflow:hidden;">
            <div id="aboutUpdateProgressFill" style="height:100%;width:0%;background:linear-gradient(90deg,var(--accent),var(--accent-bright));transition:width 200ms ease;"></div>
          </div>
        </div>
        <button type="button" class="btn primary" id="btnAboutUpdateAction">Check for updates</button>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Automatically check for updates when online</div>
          <div class="row-sub">Quietly checks GitHub Releases on launch, every 6 hours, and when reconnecting to the internet</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setAutoCheckUpdatesChk" ${s.autoCheckUpdates !== false ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Automatically download &amp; prepare updates</div>
          <div class="row-sub">Downloads &amp; SHA256-verifies new versions in the background so updates apply automatically on restart</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setAutoDownloadUpdatesChk" ${s.autoDownloadUpdates !== false ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
    </div>
      </div>
    </div>
  `;

  renderSettingsProfilesSection();
  renderCookieDomainsList(true);

  const btnSettingsAddProfile = document.getElementById('btnSettingsAddProfile');
  if (btnSettingsAddProfile) {
    btnSettingsAddProfile.addEventListener('click', async () => {
      // UX phase: the ONE shared "New Profile" modal lives in the shell.
      if (typeof window.gxChromePagesAPI?.openCreateProfileModal === 'function') {
        const res = await window.gxChromePagesAPI.openCreateProfileModal();
        if (res && res.ok) return;
      }
      // Fallback (Private window or old preload): the inline form in this page.
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

  // [Wave2-D] Search engine manager (gap 5.2).
  bindSearchEngineCard(s);

  document.getElementById('setBookmarksBarChk').addEventListener('change', (e) => {
    window.gxChromePagesAPI.updateSettings({ showBookmarksBar: e.target.checked });
  });

  // [Wave2-D] Appearance toggles (gap 5.1): stored here, read by the main
  // window UI (worker E).
  const bindSettingsToggle = (id, key) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', (e) => {
        window.gxChromePagesAPI.updateSettings({ [key]: e.target.checked });
      });
    }
  };
  bindSettingsToggle('setHomeButtonChk', 'showHomeButton');
  bindSettingsToggle('setTabSearchChk', 'showTabSearchButton');
  bindSettingsToggle('setCtrlTabMruChk', 'ctrlTabMru');
  bindSettingsToggle('setTabHoverChk', 'tabHoverPreview');
  bindSettingsToggle('setCaretBrowsingChk', 'accessibilityCaretBrowsing');
  bindSettingsToggle('setFocusHighlightChk', 'accessibilityFocusHighlight');
  bindSettingsToggle('setBackgroundAppsChk', 'runBackgroundApps');
  bindSettingsToggle('setGpuChk', 'gpuAcceleration');

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

  // Settings sub-category tabs + GX limiters + full sidebar dock grid
  mainContainer.querySelectorAll('.settings-tab-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      settingsSubTab = pill.dataset.settingsTab || 'appearance';
      searchQuery = '';
      const heroSearchEl = document.getElementById('settingsHeroSearchInput');
      if (heroSearchEl) heroSearchEl.value = '';
      if (globalSearchInput) globalSearchInput.value = '';
      mainContainer.querySelectorAll('.settings-tab-pill').forEach((p) => {
        const on = p.dataset.settingsTab === settingsSubTab;
        p.classList.toggle('active', on);
        p.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      window.location.hash = `settings/${settingsSubTab}`;
      applySettingsCategoryAndSearch();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  mainContainer.querySelectorAll('.sidebar-dock-chk').forEach((chk) => {
    chk.addEventListener('change', async () => {
      const key = chk.dataset.sidebarKey;
      if (!key) return;
      const fresh = (await window.gxChromePagesAPI.getSettings?.()) || s;
      const nextItems = { ...(fresh.sidebarItems || {}), [key]: chk.checked };
      await window.gxChromePagesAPI.updateSettings({ sidebarItems: nextItems });
    });
  });

  const setGxRamLimitRange = document.getElementById('setGxRamLimitRange');
  const setGxRamLimitVal = document.getElementById('setGxRamLimitVal');
  if (setGxRamLimitRange) {
    setGxRamLimitRange.addEventListener('input', () => {
      if (setGxRamLimitVal) setGxRamLimitVal.textContent = `${setGxRamLimitRange.value} MB`;
    });
    setGxRamLimitRange.addEventListener('change', () => {
      window.gxChromePagesAPI.updateSettings({ gxRamLimitMB: Number(setGxRamLimitRange.value) });
    });
  }
  bindSettingsToggle('setGxRamLimiterChk', 'gxRamLimiterEnabled');

  const setGxCpuLimitRange = document.getElementById('setGxCpuLimitRange');
  const setGxCpuLimitVal = document.getElementById('setGxCpuLimitVal');
  if (setGxCpuLimitRange) {
    setGxCpuLimitRange.addEventListener('input', () => {
      if (setGxCpuLimitVal) setGxCpuLimitVal.textContent = `${setGxCpuLimitRange.value}%`;
    });
    setGxCpuLimitRange.addEventListener('change', () => {
      window.gxChromePagesAPI.updateSettings({ gxCpuLimitPercent: Number(setGxCpuLimitRange.value) });
    });
  }
  bindSettingsToggle('setGxCpuLimiterChk', 'gxCpuLimiterEnabled');

  document.getElementById('setFocusHighlightChk')?.addEventListener('change', (e) => {
    if (e.target.checked) document.documentElement.dataset.focusHighlight = 'true';
    else delete document.documentElement.dataset.focusHighlight;
  });

  // [Fix2 integration] GX Features card: Panic, Shaders, video enhance,
  // battery saver, keyboard sounds / background music, local Mod packs.
  const btnGxPanicNow = document.getElementById('btnGxPanicNow');
  if (btnGxPanicNow) {
    const syncPanicBtn = async () => {
      if (!window.gxChromePagesAPI.getPanicState) return;
      try {
        const pst = await window.gxChromePagesAPI.getPanicState();
        btnGxPanicNow.textContent = pst && pst.active ? `Restore tabs (${pst.tabCount || 0})` : 'Panic now';
      } catch (_) {}
    };
    syncPanicBtn();
    btnGxPanicNow.addEventListener('click', async () => {
      if (window.gxChromePagesAPI.togglePanic) await window.gxChromePagesAPI.togglePanic();
      else if (window.gxChromePagesAPI.triggerPanic) await window.gxChromePagesAPI.triggerPanic();
      syncPanicBtn();
    });
  }
  const setShaderPreset = document.getElementById('setShaderPreset');
  if (setShaderPreset) {
    setShaderPreset.addEventListener('change', (e) => {
      window.gxChromePagesAPI.updateSettings({ shaderPreset: e.target.value });
    });
  }
  const setVideoEnhancePreset = document.getElementById('setVideoEnhancePreset');
  if (setVideoEnhancePreset) {
    setVideoEnhancePreset.addEventListener('change', (e) => {
      window.gxChromePagesAPI.updateSettings({ videoEnhancePreset: e.target.value });
    });
  }
  bindSettingsToggle('setBatterySaverChk', 'batterySaverEnabled');
  bindSettingsToggle('setKeyboardSoundsChk', 'keyboardSoundsEnabled');
  bindSettingsToggle('setBackgroundMusicChk', 'backgroundMusicEnabled');
  const gxSoundsNote = document.getElementById('gxSoundsNote');
  if (gxSoundsNote && window.gxChromePagesAPI.getSoundsStatus) {
    window.gxChromePagesAPI.getSoundsStatus().then((st) => {
      if (st && st.note) gxSoundsNote.textContent = st.note;
    }).catch(() => {
      gxSoundsNote.textContent = 'Sound status unavailable.';
    });
  }
  const showGxModMsg = (text, kind = 'error') => {
    const el = document.getElementById('gxModMsg');
    if (!el) return;
    if (!text) { el.style.display = 'none'; el.textContent = ''; return; }
    el.className = `settings-form-msg ${kind}`;
    el.textContent = text;
    el.style.display = 'block';
  };
  const renderGxModsList = async () => {
    const listEl = document.getElementById('gxModsList');
    if (!listEl || !window.gxChromePagesAPI.getGxModStatus) return;
    try {
      const st = await window.gxChromePagesAPI.getGxModStatus();
      const packs = (st && st.packs) || [];
      listEl.innerHTML = packs.length
        ? packs.map((p) => `
          <div class="gxmod-item-row">
            <div class="row-info">
              <div class="row-title">${escapeHtml(p.name || p.id)}</div>
              <div class="row-sub">${escapeHtml(p.theme || '')}${st.activeId === p.id ? ' • Active' : ''}</div>
            </div>
            <div style="display:flex;gap:6px;">
              <button type="button" class="btn" data-gxmod-apply="${escapeHtml(p.id)}"${st.activeId === p.id ? ' disabled' : ''}>Apply</button>
              <button type="button" class="btn danger" data-gxmod-remove="${escapeHtml(p.id)}">Remove</button>
            </div>
          </div>`).join('')
        : '<div class="row-sub">No Mod packs loaded yet.</div>';
      listEl.querySelectorAll('[data-gxmod-apply]').forEach((b) => {
        b.addEventListener('click', async () => {
          const res = await window.gxChromePagesAPI.applyGxMod(b.dataset.gxmodApply);
          if (res && !res.ok && res.error) {
            showGxModMsg(res.error, 'error');
            return;
          }
          renderSettingsPage();
        });
      });
      listEl.querySelectorAll('[data-gxmod-remove]').forEach((b) => {
        b.addEventListener('click', async () => {
          await window.gxChromePagesAPI.removeGxMod(b.dataset.gxmodRemove);
          renderSettingsPage();
        });
      });
    } catch {
      listEl.innerHTML = '<div class="row-sub">Could not load Mod packs.</div>';
    }
  };
  renderGxModsList();
  const btnLoadGxMod = document.getElementById('btnLoadGxMod');
  if (btnLoadGxMod) {
    btnLoadGxMod.addEventListener('click', async () => {
      if (!window.gxChromePagesAPI.loadGxMod) return;
      showGxModMsg('');
      const res = await window.gxChromePagesAPI.loadGxMod();
      if (res && res.ok) {
        renderSettingsPage();
      } else if (res && !res.canceled && res.error) {
        showGxModMsg(res.error, 'error');
      }
    });
  }

  // [Wave2-D] On startup (gap 5.3): 3 options + specific-pages editor.
  mainContainer.querySelectorAll('input[name="startupMode"]').forEach((radio) => {
    radio.addEventListener('change', async () => {
      await window.gxChromePagesAPI.updateSettings({ startupMode: radio.value });
      renderSettingsPage();
    });
  });
  mainContainer.querySelectorAll('.startup-url-remove').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const idx = Number(btn.dataset.index);
      // [Wave2-D] Read fresh settings so a quick remove+add can't lose an entry.
      const fresh = (await window.gxChromePagesAPI.getSettings?.()) || {};
      const next = (fresh.startupUrls || []).filter((_, i) => i !== idx);
      await window.gxChromePagesAPI.updateSettings({ startupUrls: next });
      renderSettingsPage();
    });
  });
  const startupAddUrlForm = document.getElementById('startupAddUrlForm');
  if (startupAddUrlForm) {
    startupAddUrlForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('startupAddUrlInput');
      const errEl = document.getElementById('startupAddUrlError');
      const check = validateHomepageInput(input ? input.value : '');
      if (!check.ok) {
        if (errEl) errEl.textContent = check.error;
        return;
      }
      // [Wave2-D] Read fresh settings so a quick add+add can't lose an entry.
      const fresh = (await window.gxChromePagesAPI.getSettings?.()) || {};
      await window.gxChromePagesAPI.updateSettings({
        startupUrls: [...(fresh.startupUrls || []), check.url]
      });
      renderSettingsPage();
    });
  }

  // [Wave2-D] Languages (gap 5.4).
  mainContainer.querySelectorAll('.lang-remove').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tag = btn.dataset.tag;
      // [Wave2-D] Fresh read: two quick removes must not resurrect each other.
      const fresh = (await window.gxChromePagesAPI.getSettings?.()) || {};
      const next = (Array.isArray(fresh.preferredLanguages) ? fresh.preferredLanguages : []).filter((t) => t !== tag);
      if (!next.length) return;
      await window.gxChromePagesAPI.updateSettings({ preferredLanguages: next });
      renderSettingsPage();
    });
  });
  const langAddForm = document.getElementById('langAddForm');
  if (langAddForm) {
    langAddForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const sel = document.getElementById('langAddSelect');
      const tag = sel ? sel.value : '';
      if (!tag) return;
      langAddSelected = tag;
      // [Wave2-D] Fresh read: two quick adds must not lose the first language.
      const fresh = (await window.gxChromePagesAPI.getSettings?.()) || {};
      const current = Array.isArray(fresh.preferredLanguages) ? fresh.preferredLanguages : [];
      if (current.includes(tag)) return;
      await window.gxChromePagesAPI.updateSettings({ preferredLanguages: [...current, tag] });
      renderSettingsPage();
    });
    document.getElementById('langAddSelect')?.addEventListener('change', (e) => {
      langAddSelected = e.target.value;
    });
  }
  document.getElementById('setSpellcheckChk')?.addEventListener('change', (e) => {
    window.gxChromePagesAPI.updateSettings({ spellcheckEnabled: e.target.checked });
  });

  // [Wave2-D] Downloads settings (gap 5.5).
  document.getElementById('btnChangeDownloadPath')?.addEventListener('click', async () => {
    if (!window.gxChromePagesAPI.chooseDownloadLocation) return;
    const res = await window.gxChromePagesAPI.chooseDownloadLocation();
    if (!res || res.canceled || !res.path) return;
    await window.gxChromePagesAPI.updateSettings({ downloadPath: res.path });
    renderSettingsPage();
  });
  document.getElementById('btnResetDownloadPath')?.addEventListener('click', async () => {
    await window.gxChromePagesAPI.updateSettings({ downloadPath: '' });
    renderSettingsPage();
  });
  document.getElementById('setDownloadAskWhereChk')?.addEventListener('change', (e) => {
    window.gxChromePagesAPI.updateSettings({ downloadAskWhere: e.target.checked });
  });
  document.getElementById('setDownloadShowDoneChk')?.addEventListener('change', (e) => {
    window.gxChromePagesAPI.updateSettings({ downloadShowWhenDone: e.target.checked });
  });

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
  // [Wave2-D] Delete browsing data (gap 5.11): time range + data-type list.
  document.getElementById('setClearRangeSel')?.addEventListener('change', (e) => {
    clearDataRange = e.target.value;
  });
  document.getElementById('btnSetClearData').addEventListener('click', async () => {
    const cache = document.getElementById('chkSetClearCache')?.checked ?? true;
    const history = document.getElementById('chkSetClearHistory')?.checked ?? true;
    const cookies = document.getElementById('chkSetClearCookies')?.checked ?? false;
    const downloads = document.getElementById('chkSetClearDownloads')?.checked ?? false;
    const passwords = document.getElementById('chkSetClearPasswords')?.checked ?? false;
    const autofill = document.getElementById('chkSetClearAutofill')?.checked ?? false;
    const siteSettings = document.getElementById('chkSetClearSiteSettings')?.checked ?? false;
    const btn = document.getElementById('btnSetClearData');
    if (btn) btn.disabled = true;
    const res = await window.gxChromePagesAPI.clearBrowsingData({
      cache,
      cookies,
      history,
      range: clearDataRange,
      downloads,
      passwords,
      autofill,
      siteSettings
    });
    const picked = [];
    if (history) picked.push('history');
    if (cookies) picked.push('cookies');
    if (cache) picked.push('cache');
    if (downloads) picked.push('download history');
    if (passwords) picked.push('saved passwords');
    if (autofill) picked.push('autofill data');
    if (siteSettings) picked.push('site settings');
    clearDataMsg = res
      ? `Cleared ${picked.length ? picked.join(', ') : 'nothing selected'}${history ? ` (${clearDataRange === 'all' ? 'all time' : clearDataRange})` : ''}.`
      : 'Clear failed — please try again.';
    if (btn) btn.disabled = false;
    const msgEl = document.getElementById('setClearDataMsg');
    if (msgEl) {
      msgEl.textContent = clearDataMsg;
      msgEl.style.display = 'block';
    }
    if (cookies) {
      await refreshSettingsCookies({ force: true });
    }
  });

  // [Wave2-D] Default browser + Reset settings (gap 5.14).
  document.getElementById('btnSetDefaultBrowser')?.addEventListener('click', async () => {
    if (!window.gxChromePagesAPI.setDefaultBrowser) return;
    const res = await window.gxChromePagesAPI.setDefaultBrowser();
    if (res && res.ok) {
      defaultBrowserMsg = 'nextGx is now the default browser for web links.';
      defaultBrowserMsgKind = 'success';
    } else {
      defaultBrowserMsg = res?.error
        ? `Could not set as default browser: ${res.error}`
        : 'Could not set as default browser. Check your system settings and try again.';
      defaultBrowserMsgKind = 'error';
    }
    const msgEl = document.getElementById('setDefaultBrowserMsg');
    if (msgEl) {
      msgEl.textContent = defaultBrowserMsg;
      msgEl.className = `settings-form-msg ${defaultBrowserMsgKind}`;
      msgEl.style.display = 'block';
    }
  });
  document.getElementById('btnResetSettings')?.addEventListener('click', () => {
    resetConfirmOpen = true;
    renderSettingsPage();
  });
  document.getElementById('btnCancelResetSettings')?.addEventListener('click', () => {
    resetConfirmOpen = false;
    renderSettingsPage();
  });
  document.getElementById('btnConfirmResetSettings')?.addEventListener('click', async () => {
    if (!window.gxChromePagesAPI.resetSettings) return;
    resetConfirmOpen = false;
    defaultBrowserMsg = '';
    clearDataMsg = '';
    await window.gxChromePagesAPI.resetSettings();
    renderSettingsPage();
  });
  document.getElementById('btnSetSleepNow').addEventListener('click', async () => {
    const fb = document.getElementById('setSleepNowFeedback');
    if (window.gxChromePagesAPI.hibernateNow) {
      const res = await window.gxChromePagesAPI.hibernateNow();
      if (fb && res) {
        fb.textContent = `Hibernated ${res.sleptCount || 0} tab(s) · RAM ${res.afterMB || '--'} MB (${res.savedMB > 0 ? `freed ${res.savedMB} MB` : 'measuring…'})`;
      }
      return;
    }
    await window.gxChromePagesAPI.sleepBackgroundTabs();
    renderSettingsPage();
  });

  applySettingsCategoryAndSearch();

  if (pendingSettingsScrollTarget) {
    const targetId = pendingSettingsScrollTarget;
    pendingSettingsScrollTarget = '';
    const el = document.getElementById(targetId);
    if (el) {
      const parentCard = el.closest('.section-card[data-settings-cat]');
      if (parentCard && parentCard.style.display === 'none') {
        settingsSubTab = parentCard.dataset.settingsCat || 'appearance';
        mainContainer.querySelectorAll('.settings-tab-pill').forEach((p) => {
          const on = p.dataset.settingsTab === settingsSubTab;
          p.classList.toggle('active', on);
          p.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        applySettingsCategoryAndSearch();
      }
      const highlightEl = el.closest('.card-row') || el;
      requestAnimationFrame(() => {
        highlightEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        highlightEl.classList.add('settings-highlight-flash');
        setTimeout(() => highlightEl.classList.remove('settings-highlight-flash'), 1600);
      });
    }
  }

  // Bind Opera GX Settings hero navigation, inline search & newly added Appearance/StartPage/System controls
  mainContainer.querySelectorAll('[data-jump-page]').forEach((btn) => {
    btn.addEventListener('click', () => switchPage(btn.dataset.jumpPage));
  });
  const heroSearch = document.getElementById('settingsHeroSearchInput');
  if (heroSearch) {
    heroSearch.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim().toLowerCase();
      if (globalSearchInput) globalSearchInput.value = e.target.value;
      applySettingsCategoryAndSearch();
    });
  }
  const bindSetBool = (id, key, invert = false) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', async (e) => {
      await window.gxChromePagesAPI.updateSettings({ [key]: invert ? !e.target.checked : e.target.checked });
    });
  };
  bindSetBool('setSpClockChk', 'startPageShowClock');
  bindSetBool('setSpHideSearchChk', 'startPageShowSearch', true);
  bindSetBool('setSpHideDialChk', 'startPageShowSpeedDial', true);
  bindSetBool('setSpHideAddChk', 'startPageShowAddButton', true);
  bindSetBool('setSpNamesChk', 'startPageShowNames');
  bindSetBool('setSpBiggerChk', 'startPageBiggerTiles');
  bindSetBool('setSpSuggestionsChk', 'startPageShowSuggestions');
  bindSetBool('setShowSidebarChk', 'showSidebar');
  bindSetBool('setColorizeSidebarChk', 'colorizeSidebarIcons');
  bindSetBool('setReduceAnimationsChk', 'reduceAnimations');
  bindSetBool('setAddressSuggestChk', 'addressBarSuggestions');
  bindSetBool('setRunOnStartupChk', 'runOnStartup');
  bindSetBool('setDnsOverHttpsChk', 'dnsOverHttps');
  bindSetBool('setVideoPopOutChk', 'videoPopOutEnabled');
  bindSetBool('setCopiedToastChk', 'copiedToastEnabled');
  bindSetBool('setAutoCheckUpdatesChk', 'autoCheckUpdates');
  bindSetBool('setAutoDownloadUpdatesChk', 'autoDownloadUpdates');

  let liveUpdaterState = null;
  const renderAboutUpdater = (st) => {
    liveUpdaterState = st || null;
    const statusEl = document.getElementById('aboutUpdateStatus');
    const progWrap = document.getElementById('aboutUpdateProgressWrap');
    const progFill = document.getElementById('aboutUpdateProgressFill');
    const actionBtn = document.getElementById('btnAboutUpdateAction');
    if (!statusEl || !actionBtn) return;
    const stateName = st?.status || 'idle';
    if (progWrap) progWrap.style.display = stateName === 'downloading' ? 'block' : 'none';
    if (progFill) progFill.style.width = `${Number(st?.progressPercent) || 0}%`;

    if (stateName === 'checking') {
      statusEl.textContent = 'Checking GitHub Releases for updates…';
      actionBtn.textContent = 'Checking…';
      actionBtn.disabled = true;
    } else if (stateName === 'up-to-date') {
      statusEl.textContent = `nextGx Browser is up to date (v${st.currentVersion || ''})`;
      actionBtn.textContent = 'Check for updates';
      actionBtn.disabled = false;
    } else if (stateName === 'available') {
      statusEl.textContent = `New version v${st.latestVersion || ''} is available!`;
      actionBtn.textContent = `Download v${st.latestVersion || ''}`;
      actionBtn.disabled = false;
    } else if (stateName === 'downloading') {
      const speedTxt = st.speedBytesPerSec > 0 ? ` · ${formatBytes(st.speedBytesPerSec)}/s` : '';
      statusEl.textContent = `Downloading v${st.latestVersion || ''} — ${st.progressPercent || 0}% (${formatBytes(st.receivedBytes || 0)} / ${formatBytes(st.totalBytes || 0)}${speedTxt})`;
      actionBtn.textContent = 'Downloading…';
      actionBtn.disabled = true;
    } else if (stateName === 'downloaded') {
      statusEl.textContent = st.canSilentInstall
        ? `v${st.latestVersion || ''} downloaded & SHA256-verified — ready to install.`
        : `v${st.latestVersion || ''} downloaded & SHA256-verified — click to open folder.`;
      actionBtn.textContent = st.canSilentInstall ? 'Restart & Update' : 'Open Update Package';
      actionBtn.disabled = false;
    } else if (stateName === 'error') {
      statusEl.textContent = st.error || 'Update check failed.';
      actionBtn.textContent = 'Retry check';
      actionBtn.disabled = false;
    } else {
      statusEl.textContent = `Current version: v${st?.currentVersion || ''} — automatic background checks active.`;
      actionBtn.textContent = 'Check for updates';
      actionBtn.disabled = false;
    }
  };

  document.getElementById('btnAboutUpdateAction')?.addEventListener('click', async () => {
    const stateName = liveUpdaterState?.status;
    if (stateName === 'downloaded') {
      await window.gxChromePagesAPI?.installUpdate?.({ relaunch: true });
    } else if (stateName === 'available') {
      renderAboutUpdater({ ...liveUpdaterState, status: 'downloading', progressPercent: 0 });
      const next = await window.gxChromePagesAPI?.downloadUpdate?.();
      renderAboutUpdater(next);
    } else {
      renderAboutUpdater({ ...liveUpdaterState, status: 'checking' });
      const next = await window.gxChromePagesAPI?.checkForUpdates?.({ manual: true });
      renderAboutUpdater(next);
    }
  });

  if (window.gxChromePagesAPI?.getUpdaterState) {
    window.gxChromePagesAPI.getUpdaterState().then(renderAboutUpdater).catch(() => { });
  }
  if (!window._nxAboutUpdaterListenerAttached && window.gxChromePagesAPI?.onUpdaterState) {
    window._nxAboutUpdaterListenerAttached = true;
    window.gxChromePagesAPI.onUpdaterState((st) => {
      if (currentPage === 'settings') renderAboutUpdater(st);
    });
  }

  document.getElementById('setDefaultZoomSel')?.addEventListener('change', async (e) => {
    await window.gxChromePagesAPI.updateSettings({ defaultPageZoom: Number(e.target.value) || 100 });
  });
  document.getElementById('setWallpaperEnabledChk')?.addEventListener('change', async (e) => {
    const cur = s.wallpaper || { type: 'preset', preset: 'obsidian-wave', file: '' };
    await window.gxChromePagesAPI.updateSettings({
      wallpaper: e.target.checked
        ? { ...cur, type: cur.file ? 'custom' : 'preset', preset: cur.preset || 'obsidian-wave' }
        : { ...cur, type: 'none' }
    });
  });
  mainContainer.querySelectorAll('[data-set-wp]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const preset = btn.dataset.setWp;
      mainContainer.querySelectorAll('[data-set-wp]').forEach((b) => b.classList.toggle('active', b === btn));
      const chk = document.getElementById('setWallpaperEnabledChk');
      if (chk) chk.checked = true;
      const cur = s.wallpaper || { type: 'preset', preset: '', file: '' };
      await window.gxChromePagesAPI.updateSettings({ wallpaper: { ...cur, type: 'preset', preset } });
    });
  });
  const setWpFile = document.getElementById('setWallpaperFileInput');
  document.getElementById('btnSetAddWallpaper')?.addEventListener('click', () => {
    if (setWpFile) {
      setWpFile.value = '';
      setWpFile.click();
    }
  });
  setWpFile?.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file || !window.gxChromePagesAPI?.saveCustomWallpaper) return;
    const msgEl = document.getElementById('setWallpaperMsg');
    try {
      const buf = await file.arrayBuffer();
      const res = await window.gxChromePagesAPI.saveCustomWallpaper({
        name: file.name,
        type: file.type,
        bytes: new Uint8Array(buf)
      });
      if (msgEl) msgEl.textContent = res?.ok ? 'Custom wallpaper applied!' : (res?.error || 'Could not save wallpaper.');
    } catch (_) {
      if (msgEl) msgEl.textContent = 'Could not read image file.';
    }
  });
  document.getElementById('btnOpenProxySettings')?.addEventListener('click', () => {
    window.gxChromePagesAPI?.openProxySettings?.();
  });
  document.querySelectorAll('input[name="webrtcPolicy"]').forEach((rad) => {
    rad.addEventListener('change', async () => {
      if (rad.checked) {
        await window.gxChromePagesAPI.updateSettings({ webrtcPolicy: rad.value });
      }
    });
  });
  document.getElementById('btnLaunchOnboarding')?.addEventListener('click', () => {
    window.gxChromePagesAPI?.openOnboarding?.();
  });
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
  } else if (currentPage === 'passwords') {
    if (!editingPasswordId && !addrFormOpen && !cardFormOpen) {
      renderPasswordsPage();
    }
  } else if (currentPage === 'extensions') {
    renderExtensionsPage();
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
      // [Wave2-D] Sync the settings-page toggles added in this round.
      const syncToggle = (id, key) => {
        const el = document.getElementById(id);
        if (el && s && typeof s[key] === 'boolean') el.checked = s[key];
      };
      syncToggle('setHomeButtonChk', 'showHomeButton');
      syncToggle('setTabSearchChk', 'showTabSearchButton');
      syncToggle('setCtrlTabMruChk', 'ctrlTabMru');
      syncToggle('setTabHoverChk', 'tabHoverPreview');
      syncToggle('setSpellcheckChk', 'spellcheckEnabled');
      syncToggle('setDownloadAskWhereChk', 'downloadAskWhere');
      syncToggle('setDownloadShowDoneChk', 'downloadShowWhenDone');
      syncToggle('setCaretBrowsingChk', 'accessibilityCaretBrowsing');
      syncToggle('setFocusHighlightChk', 'accessibilityFocusHighlight');
      syncToggle('setBackgroundAppsChk', 'runBackgroundApps');
      syncToggle('setGpuChk', 'gpuAcceleration');
      syncToggle('setBatterySaverChk', 'batterySaverEnabled');
      syncToggle('setKeyboardSoundsChk', 'keyboardSoundsEnabled');
      syncToggle('setBackgroundMusicChk', 'backgroundMusicEnabled');
      syncToggle('setGxRamLimiterChk', 'gxRamLimiterEnabled');
      syncToggle('setGxCpuLimiterChk', 'gxCpuLimiterEnabled');
      const shaderSel = document.getElementById('setShaderPreset');
      if (shaderSel && s && typeof s.shaderPreset === 'string') shaderSel.value = s.shaderPreset;
      const vidSel = document.getElementById('setVideoEnhancePreset');
      if (vidSel && s && typeof s.videoEnhancePreset === 'string') vidSel.value = s.videoEnhancePreset;
      if (s && typeof s.accessibilityFocusHighlight === 'boolean') {
        if (s.accessibilityFocusHighlight) document.documentElement.dataset.focusHighlight = 'true';
        else delete document.documentElement.dataset.focusHighlight;
      }
      const homeInp = document.getElementById('setHomepageInput');
      if (homeInp && s && typeof s.homepageUrl === 'string' && document.activeElement !== homeInp) {
        homeInp.value = s.homepageUrl;
        const resetBtn = document.getElementById('btnResetHomepage');
        if (resetBtn) {
          resetBtn.disabled = !s.homepageUrl;
        }
      }
      // Note: the search-engine list, startup radios and language list are
      // re-rendered by renderSettingsPage on change; they are not live-synced
      // here, so typing in their forms is never interrupted.
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
    window.gxChromePagesAPI.onDownloadsUpdate((data) => {
      if (currentPage === 'downloads') {
        // Market audit bug #21: pass the broadcast payload through so
        // progress/completion ticks update the rows live instead of
        // relying only on a re-fetch after each tick.
        renderDownloadsPage({ force: false, list: Array.isArray(data) ? data : null });
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
        if (!editingPasswordId && !addrFormOpen && !cardFormOpen) {
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

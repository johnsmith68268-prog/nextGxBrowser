const SIDEBAR_ICON_WIDTH = 50;
const TOP_CHROME_HEIGHT = 82;
const FIND_BAR_HEIGHT = 38;
const LEFT_TOOL_WIDTH = 340;
const RIGHT_DRAWER_WIDTH = 360;

let currentState = { tabs: [], activeTabId: null, activeTab: null };
let settingsState = {};
let cachedDownloads = [];
let activeDlCategory = 'all';

let activeLeftWebKind = null;
let leftWebPanelWidth = 420;

let activeLeftTool = null;
let activeRightDrawer = null;
let findBarOpen = false;

const currentServiceUrlByKind = {
  music: 'https://music.youtube.com',
  ai: 'https://chatgpt.com',
  twitch: 'https://www.twitch.tv',
  whatsapp: 'https://web.whatsapp.com',
  discord: 'https://discord.com/app'
};

const tabsContainer = document.getElementById('tabsContainer');
const addressForm = document.getElementById('addressForm');
const addressInput = document.getElementById('addressInput');
const incognitoIndicator = document.getElementById('incognitoIndicator');
const btnBookmarkStar = document.getElementById('btnBookmarkStar');
const btnReaderMode = document.getElementById('btnReaderMode');
const btnSiteSecurity = document.getElementById('btnSiteSecurity');
const secNotSecureLabel = document.getElementById('secNotSecureLabel');
const topBlockedCount = document.getElementById('topBlockedCount');
const topToast = document.getElementById('topToast');

const btnBack = document.getElementById('btnBack');
const btnForward = document.getElementById('btnForward');
const btnReload = document.getElementById('btnReload');

const leftToolDrawer = document.getElementById('leftToolDrawer');
const leftToolTitle = document.getElementById('leftToolTitle');

const rightDrawer = document.getElementById('rightDrawer');
const rightDrawerTitle = document.getElementById('rightDrawerTitle');
const findBar = document.getElementById('findBar');
const findInput = document.getElementById('findInput');

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function showToast(msg) {
  if (!topToast) return;
  topToast.textContent = msg;
  topToast.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => topToast.classList.add('hidden'), 2800);
}

function syncLayoutOffsets() {
  let left = SIDEBAR_ICON_WIDTH;
  if (activeLeftTool) {
    left += LEFT_TOOL_WIDTH;
  }

  let right = 0;
  if (activeRightDrawer) {
    right = RIGHT_DRAWER_WIDTH;
  }

  const top = TOP_CHROME_HEIGHT + (findBarOpen ? FIND_BAR_HEIGHT : 0);

  window.gxAPI.setLayoutOffsets({
    left,
    top,
    right,
    bottom: 0
  });
}

// 1. RENDER TABS & TOP BAR (Zero Emojis — Crisp SVGs only)
function renderTabs(state) {
  currentState = state;
  tabsContainer.innerHTML = '';

  const musicDot = document.getElementById('sidebarMusicDot');
  if (musicDot) {
    musicDot.classList.toggle('hidden', !state.leftWebAudioPlaying);
  }

  for (const tab of state.tabs) {
    const el = document.createElement('div');
    el.className = [
      'nx-tab',
      tab.id === state.activeTabId ? 'active' : '',
      tab.pinned ? 'pinned' : '',
      tab.incognito ? 'incognito' : '',
      tab.sleeping ? 'sleeping' : ''
    ]
      .filter(Boolean)
      .join(' ');

    el.title = `${tab.title}\n${tab.url}`;

    const iconHtml = tab.favicon
      ? `<img class="tab-favicon" src="${escapeHtml(tab.favicon)}" alt="" onerror="this.style.display='none'" />`
      : `<svg class="tab-favicon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8"/></svg>`;

    const audioSvg = tab.audible
      ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#c77dff" stroke-width="2" style="flex-shrink:0;"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`
      : '';

    const sleepSvg = tab.sleeping
      ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#8e95a9" stroke-width="2" style="flex-shrink:0;"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`
      : '';

    const closeSvg = `<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 2l8 8M10 2l-8 8"/></svg>`;

    if (tab.pinned) {
      el.innerHTML = iconHtml;
    } else {
      el.innerHTML = `
        ${iconHtml}
        ${audioSvg}
        ${sleepSvg}
        <span class="tab-title">${escapeHtml(tab.title || 'Start Page')}</span>
        <button class="tab-close-btn" title="Close (Ctrl+W)">${closeSvg}</button>
      `;
    }

    el.addEventListener('click', (e) => {
      if (e.target.closest('.tab-close-btn')) {
        e.stopPropagation();
        window.gxSounds?.playTabClose();
        window.gxAPI.closeTab(tab.id);
        return;
      }
      window.gxSounds?.playClick();
      window.gxAPI.closePopover();
      window.gxAPI.switchTab(tab.id);
    });

    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        window.gxSounds?.playTabClose();
        window.gxAPI.closeTab(tab.id);
      }
    });

    tabsContainer.appendChild(el);
  }

  const active = state.activeTab;
  if (active) {
    btnBack.disabled = !active.canGoBack;
    btnForward.disabled = !active.canGoForward;
    btnReload.classList.toggle('spinning', Boolean(active.isLoading));
    btnReload.title = active.isLoading ? 'Stop loading' : 'Reload (Ctrl+R)';

    if (document.activeElement !== addressInput) {
      addressInput.value = active.url === 'nextgx://newtab' ? '' : active.url;
    }

    btnSiteSecurity.classList.toggle('insecure', Boolean(active.isHttpInsecure));
    secNotSecureLabel.classList.toggle('hidden', !active.isHttpInsecure);

    incognitoIndicator.classList.toggle('hidden', !active.incognito);
    btnBookmarkStar.classList.toggle('active', Boolean(active.isBookmarked));
    btnReaderMode.classList.toggle('active', Boolean(active.readerMode));
  }

  if (activeLeftTool === 'gxControl') {
    renderPerformanceTabList();
  }
}

// Workspace Pills
document.querySelectorAll('.ws-pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    window.gxSounds?.playClick();
    const ws = pill.dataset.ws;
    document.querySelectorAll('.ws-pill').forEach((p) => p.classList.toggle('active', p.dataset.ws === ws));
    window.gxAPI.updateSettings({ workspace: ws });
    showToast(`Switched to ${ws} Workspace`);
  });
});

// Top Bar Events
document.getElementById('btnNewTab').addEventListener('click', () => {
  window.gxSounds?.playTabOpen();
  window.gxAPI.createTab({ url: 'nextgx://newtab', active: true });
});

document.getElementById('btnBrandHome').addEventListener('click', () => {
  window.gxSounds?.playClick();
  window.gxAPI.goHome();
});

document.getElementById('btnHome').addEventListener('click', () => {
  window.gxSounds?.playClick();
  window.gxAPI.goHome();
});

btnBack.addEventListener('click', () => {
  window.gxSounds?.playClick();
  window.gxAPI.goBack();
});
btnForward.addEventListener('click', () => {
  window.gxSounds?.playClick();
  window.gxAPI.goForward();
});
btnReload.addEventListener('click', () => {
  window.gxSounds?.playClick();
  if (currentState.activeTab?.isLoading) {
    window.gxAPI.stopLoading();
  } else {
    window.gxAPI.reload();
  }
});

addressForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const val = addressInput.value.trim();
  if (val) {
    window.gxAPI.closePopover();
    window.gxAPI.navigate(val);
    addressInput.blur();
  }
});

addressInput.addEventListener('focus', () => addressInput.select());

btnSiteSecurity.addEventListener('click', () => {
  window.gxSounds?.playClick();
  const rect = btnSiteSecurity.getBoundingClientRect();
  const active = currentState.activeTab || {};
  window.gxAPI.openPopover({
    kind: 'permissions',
    x: rect.left,
    y: TOP_CHROME_HEIGHT + 2,
    width: 310,
    height: 275,
    payload: {
      origin: active.origin || '',
      url: active.url || '',
      isSecure: Boolean(active.isSecure),
      isHttpInsecure: Boolean(active.isHttpInsecure)
    }
  });
});

btnBookmarkStar.addEventListener('click', async () => {
  window.gxSounds?.playClick();
  const res = await window.gxAPI.toggleBookmark();
  showToast(res.added ? 'Saved to Bookmarks' : 'Removed from Bookmarks');
});

btnReaderMode.addEventListener('click', async () => {
  window.gxSounds?.playClick();
  const active = await window.gxAPI.toggleReaderMode();
  showToast(active ? 'Reader View Enabled' : 'Reader View Off');
});

document.getElementById('btnScreenshot').addEventListener('click', () => {
  window.gxSounds?.playClick();
  const rect = document.getElementById('btnScreenshot').getBoundingClientRect();
  window.gxAPI.openPopover({
    kind: 'screenshot',
    x: rect.right - 220,
    y: TOP_CHROME_HEIGHT + 2,
    width: 220,
    height: 92
  });
});

document.getElementById('btnTopDownloads').addEventListener('click', () => {
  window.gxSounds?.playClick();
  const rect = document.getElementById('btnTopDownloads').getBoundingClientRect();
  window.gxAPI.openPopover({
    kind: 'downloads',
    x: rect.right - 310,
    y: TOP_CHROME_HEIGHT + 2,
    width: 310,
    height: 360
  });
});

document.getElementById('btnChromeMenu').addEventListener('click', () => {
  window.gxSounds?.playClick();
  const rect = document.getElementById('btnChromeMenu').getBoundingClientRect();
  window.gxAPI.openPopover({
    kind: 'menu',
    x: rect.right - 265,
    y: TOP_CHROME_HEIGHT + 2,
    width: 265,
    height: 510,
    payload: { zoomPercent: currentState.activeTab?.zoomPercent || 100 }
  });
});

document.getElementById('btnAddressShield').addEventListener('click', () => {
  window.gxSounds?.playPanelOpen();
  openRightDrawer('easySetup');
});

// Window Controls
document.getElementById('btnWinMin').addEventListener('click', () => window.gxAPI.minimizeWindow());
document.getElementById('btnWinMax').addEventListener('click', () => window.gxAPI.maximizeWindow());
document.getElementById('btnWinClose').addEventListener('click', () => window.gxAPI.closeWindow());

const MUSIC_LOGOS = {
  'https://music.youtube.com': `<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="10" fill="#ff0033"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="#fff" stroke-width="1.3"/><polygon points="10.5,9.5 15,12 10.5,14.5" fill="#fff"/></svg>`,
  'https://open.spotify.com': `<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="10" fill="#1db954"/><path d="M7 9.5c3.5-1 7-.8 10 .5M7.5 12.5c3-.8 6-.6 8.5.4M8.2 15.5c2.2-.6 4.5-.5 6.5.3" fill="none" stroke="#0b0c10" stroke-width="1.7" stroke-linecap="round"/></svg>`,
  'https://music.apple.com': `<svg viewBox="0 0 24 24" width="18" height="18"><rect x="2" y="2" width="20" height="20" rx="5" fill="#fa243c"/><path d="M15 7v8.2a2.2 2.2 0 1 1-1.5-2.1V9.2l-4 1v5a2.2 2.2 0 1 1-1.5-2.1V8.4L15 7z" fill="#fff"/></svg>`,
  'https://soundcloud.com': `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M11 17h7.5a3 3 0 0 0 .4-5.97A4.5 4.5 0 0 0 10 9.5V17h1z" fill="#ff5500"/><path d="M7.5 11v6M5.5 12.5v4.5M3.5 13.5v3.5" stroke="#ff5500" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  'https://www.deezer.com': `<svg viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="15" width="3.5" height="3" fill="#a238ff"/><rect x="8" y="12" width="3.5" height="6" fill="#c084fc"/><rect x="13" y="9" width="3.5" height="9" fill="#00e5ff"/><rect x="18" y="6" width="3.5" height="12" fill="#10b981"/></svg>`,
  'https://listen.tidal.com': `<svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><polygon points="6,8 9,11 6,14 3,11"/><polygon points="12,8 15,11 12,14 9,11"/><polygon points="18,8 21,11 18,14 15,11"/><polygon points="12,14 15,17 12,20 9,17"/></svg>`
};

function updateSidebarMusicLogo(url) {
  const btn = document.querySelector('[data-web-panel="music"]');
  if (!btn) return;
  const logoHtml = MUSIC_LOGOS[url] || MUSIC_LOGOS['https://music.youtube.com'];
  btn.innerHTML = `${logoHtml}<span class="sb-audio-dot ${currentState.leftWebAudioPlaying ? '' : 'hidden'}" id="sidebarMusicDot"></span>`;
}

// 2. LEFT OVERLAY DOCK (Music Player / AI / Twitch — Floats ON TOP of Webpages!)
function toggleLeftWebPanel(kind) {
  window.gxSounds?.playPanelOpen();
  window.gxAPI.closePopover();

  if (activeLeftWebKind === kind) {
    activeLeftWebKind = null;
    document.querySelectorAll('[data-web-panel]').forEach((btn) => btn.classList.remove('active'));
    window.gxAPI.setLeftWebPanel({ visible: false });
    return;
  }

  activeLeftTool = null;
  leftToolDrawer.classList.add('hidden');
  document.querySelectorAll('[data-left-tool]').forEach((b) => b.classList.remove('active'));
  syncLayoutOffsets();

  activeLeftWebKind = kind;
  document.querySelectorAll('[data-web-panel]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.webPanel === kind);
  });

  const targetUrl = currentServiceUrlByKind[kind] || 'https://music.youtube.com';
  window.gxAPI.setLeftWebPanel({
    visible: true,
    kind,
    url: targetUrl,
    width: leftWebPanelWidth
  });
}

document.querySelectorAll('[data-web-panel]').forEach((btn) => {
  btn.addEventListener('click', () => toggleLeftWebPanel(btn.dataset.webPanel));
});

// 3. LEFT SYSTEM DRAWER (Memory Optimizer, Cleaner, Customize Dock)
const LEFT_TOOL_TITLES = {
  gxControl: 'Memory & CPU Optimizer',
  gxCleaner: 'Instant Privacy Cleaner',
  sidebarSetup: 'Customize Dock'
};

function openLeftTool(toolName) {
  window.gxSounds?.playPanelOpen();
  window.gxAPI.closePopover();
  if (activeLeftTool === toolName) {
    closeLeftTool();
    return;
  }
  if (activeLeftWebKind) {
    activeLeftWebKind = null;
    document.querySelectorAll('[data-web-panel]').forEach((btn) => btn.classList.remove('active'));
    window.gxAPI.setLeftWebPanel({ visible: false });
  }

  activeLeftTool = toolName;
  leftToolTitle.textContent = LEFT_TOOL_TITLES[toolName] || 'System';
  leftToolDrawer.classList.remove('hidden');

  document.querySelectorAll('[data-left-tool]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.leftTool === toolName);
  });

  document.querySelectorAll('#leftToolDrawer .tool-body').forEach((el) => {
    el.classList.toggle('hidden', el.id !== `left-tool-${toolName}`);
  });

  if (toolName === 'gxControl') loadPerformancePanel();
  syncLayoutOffsets();
}

function closeLeftTool() {
  activeLeftTool = null;
  leftToolDrawer.classList.add('hidden');
  document.querySelectorAll('[data-left-tool]').forEach((btn) => btn.classList.remove('active'));
  syncLayoutOffsets();
}

document.querySelectorAll('[data-left-tool]').forEach((btn) => {
  btn.addEventListener('click', () => openLeftTool(btn.dataset.leftTool));
});

document.getElementById('btnCloseLeftTool').addEventListener('click', closeLeftTool);

function applySidebarVisibility(sidebarItems = {}) {
  document.querySelectorAll('[data-sidebar-item]').forEach((el) => {
    const key = el.dataset.sidebarItem;
    const visible = sidebarItems[key] !== false;
    el.classList.toggle('hidden', !visible);
  });
  document.querySelectorAll('[data-sb-toggle]').forEach((chk) => {
    const key = chk.dataset.sbToggle;
    chk.checked = sidebarItems[key] !== false;
  });
}

document.querySelectorAll('[data-sb-toggle]').forEach((chk) => {
  chk.addEventListener('change', async () => {
    const key = chk.dataset.sbToggle;
    const updated = await window.gxAPI.updateSettings({
      sidebarItems: { [key]: chk.checked }
    });
    applySidebarVisibility(updated.sidebarItems);
  });
});

document.getElementById('btnRunCleaner').addEventListener('click', async () => {
  const statusEl = document.getElementById('cleanerStatusText');
  statusEl.textContent = 'Optimizing cache & clearing selected data...';
  await window.gxAPI.clearBrowsingData({
    cache: document.getElementById('chkCleanCache').checked,
    cookies: document.getElementById('chkCleanCookies').checked,
    history: document.getElementById('chkCleanHistory').checked
  });
  statusEl.textContent = 'Cleaned! Memory & cache optimized.';
  showToast('Browser Cache & Data Cleaned');
});

// 4. RIGHT DRAWER (Control Center & Extensions)
const RIGHT_DRAWER_TITLES = {
  easySetup: 'nextGx Control Center',
  extensions: 'Extensions'
};

function openRightDrawer(panelName) {
  window.gxSounds?.playPanelOpen();
  window.gxAPI.closePopover();
  if (activeRightDrawer === panelName) {
    closeRightDrawer();
    return;
  }
  activeRightDrawer = panelName;
  rightDrawerTitle.textContent = RIGHT_DRAWER_TITLES[panelName] || 'Control Center';
  rightDrawer.classList.remove('hidden');

  document.querySelectorAll('#rightDrawer .tool-body').forEach((el) => {
    el.classList.toggle('hidden', el.id !== `right-panel-${panelName}`);
  });

  if (panelName === 'easySetup') loadEasySetupPanel();
  syncLayoutOffsets();
}

function closeRightDrawer() {
  activeRightDrawer = null;
  rightDrawer.classList.add('hidden');
  syncLayoutOffsets();
}

document.getElementById('btnEasySetup').addEventListener('click', () => openRightDrawer('easySetup'));
document.getElementById('btnTopExtensions').addEventListener('click', () => {
  window.gxSounds?.playClick();
  window.gxAPI.createTab({ url: 'nextgx://extensions', active: true });
});
document.getElementById('btnCloseRightDrawer').addEventListener('click', closeRightDrawer);

document.getElementById('btnOpenFullSettings').addEventListener('click', () => {
  closeRightDrawer();
  window.gxAPI.createTab({ url: 'nextgx://settings', active: true });
});
document.getElementById('btnOpenFullExtensions').addEventListener('click', () => {
  closeRightDrawer();
  window.gxAPI.createTab({ url: 'nextgx://extensions', active: true });
});

// Find Bar
function openFindBar() {
  findBarOpen = true;
  findBar.classList.remove('hidden');
  syncLayoutOffsets();
  findInput.focus();
  findInput.select();
}

function closeFindBar() {
  findBarOpen = false;
  findBar.classList.add('hidden');
  window.gxAPI.stopFindInPage();
  syncLayoutOffsets();
}

findInput.addEventListener('input', () => {
  const txt = findInput.value.trim();
  if (txt) window.gxAPI.findInPage(txt, true);
  else window.gxAPI.stopFindInPage();
});

findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') window.gxAPI.findInPage(findInput.value.trim(), !e.shiftKey);
  else if (e.key === 'Escape') closeFindBar();
});

document.getElementById('btnFindNext').addEventListener('click', () => window.gxAPI.findInPage(findInput.value.trim(), true));
document.getElementById('btnFindPrev').addEventListener('click', () => window.gxAPI.findInPage(findInput.value.trim(), false));
document.getElementById('btnFindClose').addEventListener('click', closeFindBar);

// 5. PERFORMANCE & MEMORY OPTIMIZER
async function loadPerformancePanel() {
  const stats = await window.gxAPI.getSystemStats();
  renderSystemStats(stats);
  renderPerformanceTabList();
}

function renderSystemStats(stats) {
  if (!stats) return;
  const ramEl = document.getElementById('perfBrowserRam');
  if (ramEl) {
    ramEl.textContent = `${stats.browserRamMB} MB`;
    const pct = Math.min(100, Math.round((stats.browserRamMB / 2048) * 100));
    document.getElementById('perfBrowserRamBar').style.width = `${pct}%`;
    document.getElementById('perfSysRamText').textContent =
      `System RAM: ${stats.usedSysMB} / ${stats.totalSysMB} MB (${stats.sysRamPercent}%)`;
    document.getElementById('perfCpuPercent').textContent = `${stats.cpuPercent}%`;
    document.getElementById('perfCpuBar').style.width = `${Math.max(4, stats.cpuPercent)}%`;
    document.getElementById('perfTabCounts').textContent =
      `Active Tabs: ${stats.activeTabsCount} • Hibernated: ${stats.sleepingTabsCount}`;
  }
}

function renderPerformanceTabList() {
  const container = document.getElementById('perfTabsList');
  if (!container) return;
  container.innerHTML = '';
  for (const tab of currentState.tabs) {
    const isCurrent = tab.id === currentState.activeTabId;
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `
      <div class="row-main">
        <div class="row-title">${escapeHtml(tab.title)}</div>
        <div class="row-sub">${isCurrent ? 'Active Tab' : tab.sleeping ? 'Hibernated (0 MB Renderer)' : 'Background Tab'}</div>
      </div>
      ${
        !isCurrent && !tab.sleeping
          ? `<button class="mini-action-btn accent sleep-one">Hibernate</button>`
          : ''
      }
    `;
    row.addEventListener('click', (e) => {
      if (e.target.closest('.sleep-one')) {
        e.stopPropagation();
        window.gxAPI.sleepTab(tab.id);
        return;
      }
      window.gxAPI.switchTab(tab.id);
    });
    container.appendChild(row);
  }
}

document.getElementById('btnSleepBackgroundTabs').addEventListener('click', async () => {
  const res = await window.gxAPI.sleepBackgroundTabs();
  showToast(`Hibernated ${res.sleptCount || 0} background tab(s)`);
  loadPerformancePanel();
});

document.getElementById('chkAutoSleep').addEventListener('change', (e) => {
  window.gxAPI.updateSettings({ autoSleepEnabled: e.target.checked });
});

document.querySelectorAll('#autoSleepSegments .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const mins = Number(btn.dataset.mins);
    document.querySelectorAll('#autoSleepSegments .seg-btn').forEach((b) =>
      b.classList.toggle('active', Number(b.dataset.mins) === mins)
    );
    window.gxAPI.updateSettings({ autoSleepMinutes: mins });
  });
});

// 6. CONTROL CENTER
async function loadEasySetupPanel() {
  const adStats = await window.gxAPI.getAdblockStats();
  renderAdblockStats(adStats);
  const s = await window.gxAPI.getSettings();
  document.getElementById('chkForceDarkWeb').checked = Boolean(s.forceDarkWeb);
  document.getElementById('chkUiSounds').checked = s.uiSoundsEnabled !== false;
  document.getElementById('chkCloseLastTab').checked = s.closeWindowOnLastTab !== false;
  document.querySelectorAll('#searchEngineSegments .seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.engine === (s.searchEngine || 'google'));
  });
}

function renderAdblockStats(stats) {
  if (!stats) return;
  topBlockedCount.textContent = String(stats.sessionBlocked ?? 0);
  const sessEl = document.getElementById('adPanelSessionCount');
  const totEl = document.getElementById('adPanelTotalCount');
  if (sessEl) sessEl.textContent = String(stats.sessionBlocked ?? 0);
  if (totEl) totEl.textContent = String(stats.totalBlocked ?? 0);

  if (typeof stats.enabled === 'boolean') {
    document.getElementById('chkAdblockEnabled').checked = stats.enabled;
  }

  const listEl = document.getElementById('recentBlockedList');
  if (!listEl) return;
  listEl.innerHTML = '';
  const recent = stats.recentBlocked || [];
  if (!recent.length) {
    listEl.innerHTML = `<div class="card-sub">No trackers blocked in this session yet.</div>`;
    return;
  }
  for (const item of recent) {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `
      <div class="row-main">
        <div class="row-title">${escapeHtml(item.host)}</div>
        <div class="row-sub">Blocked ${escapeHtml(item.type || 'tracker')}</div>
      </div>
    `;
    listEl.appendChild(row);
  }
}

document.getElementById('chkAdblockEnabled').addEventListener('change', async (e) => {
  const stats = await window.gxAPI.toggleAdblock(e.target.checked);
  renderAdblockStats(stats);
  showToast(e.target.checked ? 'Privacy Shield Enabled' : 'Privacy Shield Paused');
});

document.getElementById('chkForceDarkWeb').addEventListener('change', async (e) => {
  await window.gxAPI.updateSettings({ forceDarkWeb: e.target.checked });
  window.gxAPI.reload();
});

document.getElementById('chkUiSounds').addEventListener('change', async (e) => {
  window.gxSounds?.setConfig({ enabled: e.target.checked });
  await window.gxAPI.updateSettings({ uiSoundsEnabled: e.target.checked });
  if (e.target.checked) window.gxSounds?.playClick();
});

document.getElementById('chkCloseLastTab').addEventListener('change', async (e) => {
  await window.gxAPI.updateSettings({ closeWindowOnLastTab: e.target.checked });
});

document.querySelectorAll('[data-theme-choice]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    window.gxSounds?.playClick();
    const theme = btn.dataset.themeChoice;
    document.documentElement.setAttribute('data-theme', theme);
    await window.gxAPI.updateSettings({ theme });
  });
});

document.querySelectorAll('#searchEngineSegments .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    window.gxSounds?.playClick();
    const engine = btn.dataset.engine;
    document.querySelectorAll('#searchEngineSegments .seg-btn').forEach((b) =>
      b.classList.toggle('active', b.dataset.engine === engine)
    );
    window.gxAPI.updateSettings({ searchEngine: engine });
  });
});

// IPC Listeners
window.gxAPI.onStateUpdate((state) => renderTabs(state));
window.gxAPI.onAdblockUpdate((stats) => renderAdblockStats(stats));
window.gxAPI.onDownloadsUpdate((list) => {
  cachedDownloads = list || [];
  const hasActive = cachedDownloads.some((d) => d.state === 'progressing');
  document.getElementById('dlActiveDot').classList.toggle('hidden', !hasActive);
});
window.gxAPI.onSystemStats((stats) => renderSystemStats(stats));

window.gxAPI.onLeftDockUpdate((data) => {
  if (data?.url && data?.kind === 'music') {
    currentServiceUrlByKind.music = data.url;
    updateSidebarMusicLogo(data.url);
  }
  if (!data?.visible) {
    activeLeftWebKind = null;
    document.querySelectorAll('[data-web-panel]').forEach((btn) => btn.classList.remove('active'));
  }
});

window.gxAPI.onToast((msg) => {
  if (msg && msg.includes('Screenshot')) window.gxSounds?.playShutter();
  showToast(msg);
});

window.gxAPI.onShortcutAction((action) => {
  if (action === 'focus-address-bar') {
    addressInput.focus();
    addressInput.select();
  } else if (action === 'toggle-bookmark') {
    window.gxAPI.toggleBookmark();
  } else if (action === 'open-find') {
    openFindBar();
  }
});

// Startup Initialization
(async () => {
  const params = new URLSearchParams(window.location.search);
  const isPrivateWin = params.get('incognito') === '1';
  if (isPrivateWin) {
    document.documentElement.setAttribute('data-incognito', 'true');
    const brandText = document.querySelector('.nx-brand-text');
    if (brandText) brandText.innerHTML = 'next<strong>Gx</strong> Private';
    incognitoIndicator.classList.remove('hidden');
  }

  settingsState = await window.gxAPI.getSettings();
  if (!isPrivateWin) {
    document.documentElement.setAttribute('data-theme', settingsState.theme || 'gx-violet');
  }
  leftWebPanelWidth = settingsState.leftPanelWidth || 420;

  window.gxSounds?.setConfig({
    enabled: settingsState.uiSoundsEnabled !== false,
    volume: typeof settingsState.uiSoundsVolume === 'number' ? settingsState.uiSoundsVolume : 0.35
  });

  currentServiceUrlByKind.music = settingsState.musicServiceUrl || 'https://music.youtube.com';
  updateSidebarMusicLogo(currentServiceUrlByKind.music);

  document.querySelectorAll('.ws-pill').forEach((p) => {
    p.classList.toggle('active', p.dataset.ws === (settingsState.workspace || 'Personal'));
  });

  applySidebarVisibility(settingsState.sidebarItems || {});

  const adStats = await window.gxAPI.getAdblockStats();
  renderAdblockStats(adStats);

  cachedDownloads = await window.gxAPI.getDownloads();
  const hasActive = cachedDownloads.some((d) => d.state === 'progressing');
  document.getElementById('dlActiveDot').classList.toggle('hidden', !hasActive);
})();

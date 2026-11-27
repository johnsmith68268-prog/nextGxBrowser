const SIDEBAR_ICON_WIDTH = 50;
const RAIL_EXPANDED_WIDTH = 184;
const IS_DRAWER_OVERLAY = new URLSearchParams(window.location.search).get('overlay') === '1';
if (IS_DRAWER_OVERLAY && document.body) {
  document.body.classList.add('is-drawer-overlay');
}
const TOP_CHROME_HEIGHT = 82;
const BOOKMARKS_BAR_HEIGHT = 30;
const FIND_BAR_HEIGHT = 38;
const LEFT_TOOL_WIDTH = 340;
const RIGHT_DRAWER_WIDTH = 360;
const SIDEBAR_PANEL_DEFAULT_WIDTH = 380;
const SIDEBAR_PANEL_MIN_WIDTH = 260;
const SIDEBAR_PANEL_MAX_WIDTH = 1600;
const SPLIT_DIVIDER_WIDTH = 6;
const SPLIT_MIN_RATIO = 0.2;
const SPLIT_MAX_RATIO = 0.8;
const SPLIT_DEFAULT_RATIO = 0.5;

let currentState = {
  windowIncognito: false,
  activeWorkspaceId: 'default',
  workspaces: [],
  groups: [],
  tabs: [],
  activeTabId: null,
  activeTab: null,
  split: null
};
let settingsState = {};
// [TABS-W2] Gap 8.2/8.6 — mute state per tab id. Main owns the truth and
// pushes it via 'tabs:mute-state'; the renderer keeps a mirror for the
// speaker icon and the tab-menu label.
const tabMuteMap = new Map();
// [TABS-W2] Gap 8.1 — last-active timestamps for tab-search recency ordering.
const tabLastSeen = new Map();
// [TABS-W2] Gap 1.5 — the permission prompt currently open (omnibox chip).
let activePermPrompt = null;
// [TABS-W2] Gap 3.7 — cached history for omnibox suggestions (local only).
let historyCache = null;
let historyCacheAt = 0;
let lastAdblockStats = null;
let lastSystemStats = null;
let cachedDownloads = [];
let cachedBookmarks = [];
let activeDlCategory = 'all';

let activeLeftTool = null;
let activeRightDrawer = null;
// Fix2-shell A2: mirrors the rail's expanded class (setRailExpanded) so
// syncLayoutOffsets can shift the drawer/panel offset without touching the
// const nxSidebarEl before it is initialised.
let railExpandedState = false;
let findBarOpen = false;
let bookmarksBarVisible = true;
let openBookmarkFolderName = null;

let sidebarPanelState = {
  open: false,
  activeKey: null,
  title: '',
  serviceUrl: '',
  currentUrl: '',
  isLoading: false,
  pinned: false,
  width: SIDEBAR_PANEL_DEFAULT_WIDTH,
  loadedKeys: [],
  audibleKeys: []
};
let isResizingSidebarPanel = false;

const topChrome = document.getElementById('topChrome');
const titlebarEl = document.querySelector('.nx-titlebar');
const workspacePills = document.getElementById('workspacePills');
const workspacePillsList = document.getElementById('workspacePillsList');
const btnAddWorkspace = document.getElementById('btnAddWorkspace');
const bookmarksBar = document.getElementById('bookmarksBar');
const bookmarksBarItems = document.getElementById('bookmarksBarItems');
const btnBookmarksManager = document.getElementById('btnBookmarksManager');
const tabsStrip = document.getElementById('tabsStrip');
const btnGxCornerTab = document.getElementById('btnGxCornerTab');
const tabsContainer = document.getElementById('tabsContainer');
const btnNewTab = document.getElementById('btnNewTab');
const btnTabsScrollLeft = document.getElementById('btnTabsScrollLeft');
const btnTabsScrollRight = document.getElementById('btnTabsScrollRight');
const addressForm = document.getElementById('addressForm');
const addressInput = document.getElementById('addressInput');
const incognitoIndicator = document.getElementById('incognitoIndicator');
const btnBookmarkStar = document.getElementById('btnBookmarkStar');
const btnReaderMode = document.getElementById('btnReaderMode');
const btnSplitView = document.getElementById('btnSplitView');
const btnPopOutVideo = document.getElementById('btnPopOutVideo');
const viewportPlaceholder = document.getElementById('viewportPlaceholder');
const splitDivider = document.getElementById('splitDivider');
const btnProfileMenu = document.getElementById('btnProfileMenu');
const profileAvatarLetter = document.getElementById('profileAvatarLetter');
const btnSiteSecurity = document.getElementById('btnSiteSecurity');
const secNotSecureLabel = document.getElementById('secNotSecureLabel');
const topBlockedCount = document.getElementById('topBlockedCount');
const topToast = document.getElementById('topToast');

const RELOAD_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>';
const STOP_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const LOCK_ICON_PATHS =
  '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>';
const WARN_ICON_PATHS =
  '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>';

const btnBack = document.getElementById('btnBack');
const btnForward = document.getElementById('btnForward');
const btnReload = document.getElementById('btnReload');

const leftToolDrawer = document.getElementById('leftToolDrawer');
const leftToolTitle = document.getElementById('leftToolTitle');

const sidebarPanel = document.getElementById('sidebarPanel');
const sidebarPanelIcon = document.getElementById('sidebarPanelIcon');
const sidebarPanelTitle = document.getElementById('sidebarPanelTitle');
const btnSidebarPin = document.getElementById('btnSidebarPin');
const btnSidebarReload = document.getElementById('btnSidebarReload');
const btnSidebarOpenTab = document.getElementById('btnSidebarOpenTab');
const btnSidebarClose = document.getElementById('btnSidebarClose');
const sidebarPanelResizer = document.getElementById('sidebarPanelResizer');
const sidebarResizeBadge = document.getElementById('sidebarResizeBadge');

function showSidebarResizeBadge(width, clientX) {
  if (!sidebarResizeBadge) return;
  sidebarResizeBadge.textContent = `${width} px`;
  sidebarResizeBadge.style.left = `${Math.max(80, clientX || 200)}px`;
  sidebarResizeBadge.style.top = '118px';
  sidebarResizeBadge.classList.remove('hidden');
}

function hideSidebarResizeBadgeSoon() {
  if (!sidebarResizeBadge) return;
  clearTimeout(hideSidebarResizeBadgeSoon._timer);
  hideSidebarResizeBadgeSoon._timer = setTimeout(() => {
    sidebarResizeBadge.classList.add('hidden');
  }, 700);
}

const rightDrawer = document.getElementById('rightDrawer');
const rightDrawerTitle = document.getElementById('rightDrawerTitle');
const findBar = document.getElementById('findBar');
const findInput = document.getElementById('findInput');
const findMatchCount = document.getElementById('findMatchCount');
const zoomValueText = document.getElementById('zoomValueText');
const btnZoomIndicator = document.getElementById('btnZoomIndicator');
const zoomIndicatorText = document.getElementById('zoomIndicatorText');
let lastFindQuery = '';

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

// [URLBAR-3.1] Minimalist Opera GX / Safari omnibox elision: when unfocused,
// show only the clean domain (e.g. "youtube.com", stripping protocol, "www.",
// and path/query clutter). Clicking/focusing the omnibox reveals the full URL.
function elideUrlForDisplay(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const u = new URL(rawUrl);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return u.host.replace(/^www\.(?=[^.]+\.)/i, '');
    }
  } catch (_) { }
  // Non-web schemes (nextgx://, chrome-extension://, about:blank, …) show as-is.
  return rawUrl;
}

function getActiveTabFullUrl() {
  const url = currentState.activeTab?.url || '';
  return url === 'nextgx://newtab' ? '' : url;
}

function showToast(msg, { sound = true, actionLabel = null, onAction = null } = {}) {
  if (!topToast) return;
  if (sound) window.gxSounds?.playNotification();
  topToast.textContent = '';
  const label = document.createElement('span');
  label.textContent = msg;
  topToast.appendChild(label);
  if (actionLabel && typeof onAction === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nx-toast-action';
    btn.textContent = actionLabel;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      topToast.classList.add('hidden');
      onAction();
    });
    topToast.appendChild(btn);
  }
  topToast.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => topToast.classList.add('hidden'), 5000);
}

function clampSidebarPanelWidth(rawWidth) {
  const num = Number(rawWidth);
  if (!Number.isFinite(num)) return SIDEBAR_PANEL_DEFAULT_WIDTH;
  return Math.max(SIDEBAR_PANEL_MIN_WIDTH, Math.min(SIDEBAR_PANEL_MAX_WIDTH, Math.round(num)));
}

function getEffectiveSidebarPanelWidth(rawWidth) {
  const base = clampSidebarPanelWidth(rawWidth);
  const contentWidth = window.innerWidth || 0;
  if (!contentWidth) return base;
  const rightOffset = activeRightDrawer ? RIGHT_DRAWER_WIDTH : 0;
  const maxAvail = Math.max(240, Math.floor(contentWidth - SIDEBAR_ICON_WIDTH - rightOffset - 160));
  return Math.min(base, maxAvail, Math.floor(contentWidth * 0.75));
}

function syncLayoutOffsets() {
  if (IS_DRAWER_OVERLAY) return;
  // Fix2-shell A2: an expanded rail is a 184 px absolute overlay, so an
  // open left drawer / pinned sidebar panel must start at its edge, not at
  // the collapsed 50 px edge — otherwise the drawer slides underneath the
  // rail (audit A2) and the webview would start under the drawer. The CSS
  // sibling rules in styles.css move the drawer/panel; this keeps the
  // native view offset in step. A floating (unpinned) panel is an overlay
  // and needs no offset change.
  const railShift = railExpandedState ? RAIL_EXPANDED_WIDTH - SIDEBAR_ICON_WIDTH : 0;
  const railWidth = SIDEBAR_ICON_WIDTH + railShift;
  let left = SIDEBAR_ICON_WIDTH;
  if (activeLeftTool) {
    left += LEFT_TOOL_WIDTH + railShift;
  } else if (sidebarPanelState.open && sidebarPanelState.pinned) {
    left += getEffectiveSidebarPanelWidth(sidebarPanelState.width) + railShift;
  } else {
    left += railShift;
  }

  let right = 0;
  if (activeRightDrawer) {
    right = RIGHT_DRAWER_WIDTH;
  }

  const top =
    TOP_CHROME_HEIGHT +
    (bookmarksBarVisible ? BOOKMARKS_BAR_HEIGHT : 0) +
    (findBarOpen ? FIND_BAR_HEIGHT : 0);

  window.gxAPI.setLayoutOffsets({
    left,
    railWidth,
    top,
    right,
    bottom: 0,
    gxControlOpen: activeLeftTool === 'gxControl'
  });
  updateSplitDividerLayout();
  requestAnimationFrame(() => updateSplitDividerLayout());
}

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
    } catch (_) { }
  }
  return '';
}

function updateBookmarkFolderButtonsState() {
  if (!bookmarksBarItems) return;
  bookmarksBarItems.querySelectorAll('.bm-bar-folder').forEach((btn) => {
    btn.classList.toggle('open', Boolean(openBookmarkFolderName && btn.dataset.bmFolder === openBookmarkFolderName));
  });
}

function applyBookmarksBarVisibility(visible) {
  const next = Boolean(visible);
  bookmarksBarVisible = next;
  if (bookmarksBar) bookmarksBar.classList.toggle('hidden', !next);
  if (topChrome) topChrome.classList.toggle('has-bookmarks-bar', next);
  if (!next && openBookmarkFolderName) {
    openBookmarkFolderName = null;
    updateBookmarkFolderButtonsState();
    window.gxAPI.closePopover();
  }
  syncLayoutOffsets();
}

function renderBookmarksBar(list) {
  cachedBookmarks = Array.isArray(list) ? list : [];
  if (!bookmarksBarItems) return;
  bookmarksBarItems.innerHTML = '';

  if (!cachedBookmarks.length) {
    const empty = document.createElement('span');
    empty.className = 'bm-bar-empty';
    empty.textContent = 'No bookmarks yet — click the star to save a page';
    bookmarksBarItems.appendChild(empty);
    if (openBookmarkFolderName) {
      openBookmarkFolderName = null;
      window.gxAPI.closePopover();
    }
    return;
  }

  const folderGroups = new Map();
  for (const bm of cachedBookmarks) {
    if (!bm || !bm.url) continue;
    const folder = typeof bm.folder === 'string' ? bm.folder.trim() : '';
    if (folder) {
      if (!folderGroups.has(folder)) folderGroups.set(folder, []);
      folderGroups.get(folder).push(bm);
    }
  }

  // [TABS-W2] Gap 7.5 — "All Bookmarks" is a virtual folder, not a real one.
  if (
    openBookmarkFolderName &&
    openBookmarkFolderName !== 'All Bookmarks' &&
    !folderGroups.has(openBookmarkFolderName)
  ) {
    openBookmarkFolderName = null;
    window.gxAPI.closePopover();
  }

  const renderedFolders = new Set();

  for (const bm of cachedBookmarks) {
    if (!bm || !bm.url) continue;
    const folder = typeof bm.folder === 'string' ? bm.folder.trim() : '';

    if (folder) {
      if (renderedFolders.has(folder)) continue;
      renderedFolders.add(folder);
      const items = folderGroups.get(folder) || [];

      const folderBtn = document.createElement('button');
      folderBtn.type = 'button';
      folderBtn.className = 'bm-bar-item bm-bar-folder';
      if (openBookmarkFolderName === folder) folderBtn.classList.add('open');
      folderBtn.dataset.bmFolder = folder;
      folderBtn.title = `${folder} (${items.length} ${items.length === 1 ? 'bookmark' : 'bookmarks'})`;
      folderBtn.innerHTML = `
        <span class="bm-favicon-wrap">
          <svg class="bm-fallback-svg bm-folder-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        </span>
        <span class="bm-bar-label">${escapeHtml(folder)}</span>
        <svg class="bm-folder-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      `;

      folderBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.gxSounds?.playClick();
        if (openBookmarkFolderName === folder) {
          openBookmarkFolderName = null;
          updateBookmarkFolderButtonsState();
          window.gxAPI.closePopover();
          return;
        }
        openBookmarkFolderName = folder;
        updateBookmarkFolderButtonsState();
        const rect = folderBtn.getBoundingClientRect();
        const latestItems = cachedBookmarks.filter(
          (item) => item && item.url && typeof item.folder === 'string' && item.folder.trim() === folder
        );
        const popHeight = Math.min(360, Math.max(96, 48 + latestItems.length * 33 + 12));
        window.gxAPI.openPopover({
          kind: 'bookmark-folder',
          x: Math.round(rect.left),
          y: Math.round(rect.bottom + 2),
          width: 256,
          height: popHeight,
          payload: { folder, items: latestItems }
        });
      });

      bookmarksBarItems.appendChild(folderBtn);
      continue;
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bm-bar-item bm-bar-link';
    btn.dataset.bmId = bm.id || '';
    btn.dataset.bmUrl = bm.url;
    btn.title = `${bm.title || bm.url}\n${bm.url}`;

    const iconWrap = document.createElement('span');
    iconWrap.className = 'bm-favicon-wrap';
    iconWrap.innerHTML = `<svg class="bm-fallback-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8"/></svg>`;
    const fallbackSvg = iconWrap.firstElementChild;

    const favUrl = getBookmarkFaviconUrl(bm);
    if (favUrl) {
      const img = document.createElement('img');
      img.className = 'bm-favicon-img hidden';
      img.alt = '';
      img.draggable = false;
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
    label.className = 'bm-bar-label';
    label.textContent = bm.title || bm.url;

    btn.appendChild(iconWrap);
    btn.appendChild(label);

    btn.addEventListener('click', () => {
      window.gxSounds?.playClick();
      openBookmarkFolderName = null;
      updateBookmarkFolderButtonsState();
      window.gxAPI.closePopover();
      window.gxAPI.navigate(bm.url);
    });

    btn.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        window.gxSounds?.playTabOpen();
        openBookmarkFolderName = null;
        updateBookmarkFolderButtonsState();
        window.gxAPI.closePopover();
        window.gxAPI.createTab({ url: bm.url, active: false });
      }
    });

    bookmarksBarItems.appendChild(btn);
  }

  // [TABS-W2] Gap 7.5 — "All Bookmarks" overflow folder at the right end of
  // the bar (Chrome parity): opens the folder popover with every bookmark.
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'bm-bar-item bm-bar-folder bm-bar-all';
  if (openBookmarkFolderName === 'All Bookmarks') allBtn.classList.add('open');
  allBtn.dataset.bmFolder = 'All Bookmarks';
  allBtn.title = `All Bookmarks (${cachedBookmarks.length} ${cachedBookmarks.length === 1 ? 'bookmark' : 'bookmarks'
    })`;
  allBtn.innerHTML = `
    <span class="bm-favicon-wrap">
      <svg class="bm-fallback-svg bm-folder-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
    </span>
    <span class="bm-bar-label">All Bookmarks</span>
    <svg class="bm-folder-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
  `;
  allBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    window.gxSounds?.playClick();
    if (openBookmarkFolderName === 'All Bookmarks') {
      openBookmarkFolderName = null;
      updateBookmarkFolderButtonsState();
      window.gxAPI.closePopover();
      return;
    }
    openBookmarkFolderName = 'All Bookmarks';
    updateBookmarkFolderButtonsState();
    const rect = allBtn.getBoundingClientRect();
    const popHeight = Math.min(360, Math.max(96, 48 + cachedBookmarks.length * 33 + 12));
    window.gxAPI.openPopover({
      kind: 'bookmark-folder',
      x: Math.round(rect.left),
      y: Math.round(rect.bottom + 2),
      width: 256,
      height: popHeight,
      payload: { folder: 'All Bookmarks', items: [...cachedBookmarks] }
    });
  });
  bookmarksBarItems.appendChild(allBtn);
}

if (bookmarksBarItems) {
  bookmarksBarItems.addEventListener(
    'wheel',
    (e) => {
      if (bookmarksBarItems.scrollWidth <= bookmarksBarItems.clientWidth + 1) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta !== 0) {
        e.preventDefault();
        bookmarksBarItems.scrollLeft += delta;
      }
    },
    { passive: false }
  );
}

if (btnBookmarksManager) {
  btnBookmarksManager.addEventListener('click', () => {
    window.gxSounds?.playClick();
    openBookmarkFolderName = null;
    updateBookmarkFolderButtonsState();
    window.gxAPI.closePopover();
    window.gxAPI.createTab({ url: 'nextgx://bookmarks', active: true });
  });
}

// Tab Strip Drag-and-Drop, Context Menu, and Overflow Scroll State
let draggedTabId = null;
let didDropTab = false;
let pendingStateDuringDrag = null;
let suppressTabClickUntil = 0;
let tabContextMenuOpen = false;
let suppressAddressFocusSelect = false;
let activeTabContextMode = null;
let lastRenderedActiveTabId = null;
let lastRenderedTabCount = 0;
let lastRenderedWorkspaceId = null;
let userScrolledTabStrip = false;

function hasDraggedTab(e) {
  return Boolean(
    draggedTabId ||
    (e.dataTransfer &&
      e.dataTransfer.types &&
      (e.dataTransfer.types.includes('application/x-nextgx-tab-id') ||
        e.dataTransfer.types.includes('text/plain')))
  );
}

function getDraggedTabId(e) {
  return (
    draggedTabId ||
    e.dataTransfer?.getData('application/x-nextgx-tab-id') ||
    e.dataTransfer?.getData('text/plain') ||
    ''
  );
}

function setTabDraggingState(active) {
  if (titlebarEl) {
    titlebarEl.classList.toggle('is-tab-dragging', Boolean(active));
  }
}

function clearTabDropIndicators() {
  tabsContainer
    .querySelectorAll(
      '.nx-tab.drop-before, .nx-tab.drop-after, .nx-tab.drop-group, .nx-group-pill.drop-before, .nx-group-pill.drop-after, .nx-group-pill.drop-group'
    )
    .forEach((el) => {
      el.classList.remove('drop-before', 'drop-after', 'drop-group');
    });
  if (workspacePillsList) {
    workspacePillsList.querySelectorAll('.ws-pill.drop-target').forEach((el) => {
      el.classList.remove('drop-target');
    });
  }
  if (btnNewTab) {
    btnNewTab.classList.remove('drop-target');
  }
}

function getDropPositionForTab(el, targetTabId, sourceTabId, clientX, clientY, targetTab, sourceTab) {
  if (clientX === 0 && clientY === 0 && sourceTabId) {
    const srcIdx = currentState.tabs.findIndex((t) => t.id === sourceTabId);
    const dstIdx = currentState.tabs.findIndex((t) => t.id === targetTabId);
    if (srcIdx !== -1 && dstIdx !== -1) {
      return srcIdx < dstIdx ? 'after' : 'before';
    }
  }
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return 'before';
  const relX = (clientX - rect.left) / rect.width;

  const canCentreGroup =
    sourceTab &&
    targetTab &&
    !sourceTab.pinned &&
    !targetTab.pinned &&
    sourceTabId !== targetTabId &&
    !(sourceTab.groupId && sourceTab.groupId === targetTab.groupId);

  if (canCentreGroup) {
    if (relX < 0.25) return 'before';
    if (relX > 0.75) return 'after';
    return 'center';
  }
  return relX > 0.5 ? 'after' : 'before';
}

function getDropPositionForGroupPill(el, isCollapsed, clientX) {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return 'center';
  const relX = (clientX - rect.left) / rect.width;
  if (isCollapsed) {
    if (relX < 0.25) return 'before';
    if (relX > 0.75) return 'after';
    return 'center';
  }
  return relX < 0.25 ? 'before' : 'center';
}

function scrollActiveTabIntoView(activeEl) {
  if (!activeEl || !tabsContainer) return;
  if (typeof activeEl.scrollIntoView === 'function') {
    activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  const containerRect = tabsContainer.getBoundingClientRect();
  const tabRect = activeEl.getBoundingClientRect();
  if (containerRect.width > 0 && tabRect.width > 0) {
    if (tabRect.left < containerRect.left) {
      tabsContainer.scrollLeft -= containerRect.left - tabRect.left + 6;
    } else if (tabRect.right > containerRect.right) {
      tabsContainer.scrollLeft += tabRect.right - containerRect.right + 6;
    }
  }
}

function updateTabScrollButtons() {
  if (!btnTabsScrollLeft || !btnTabsScrollRight || !tabsContainer) return;
  const buttonsVisible = !btnTabsScrollLeft.classList.contains('hidden');
  const threshold = buttonsVisible ? 57 : 1;
  const isOverflowing = tabsContainer.scrollWidth > tabsContainer.clientWidth + threshold;

  btnTabsScrollLeft.classList.toggle('hidden', !isOverflowing);
  btnTabsScrollRight.classList.toggle('hidden', !isOverflowing);

  if (isOverflowing) {
    const maxScroll = Math.max(0, tabsContainer.scrollWidth - tabsContainer.clientWidth);
    btnTabsScrollLeft.disabled = tabsContainer.scrollLeft <= 1;
    btnTabsScrollRight.disabled = tabsContainer.scrollLeft >= maxScroll - 1;
  }
}

function renderWorkspaces(state) {
  if (!workspacePills || !workspacePillsList) return;
  // Single-profile minimalist Opera GX top bar: keep workspace pills hidden
  workspacePills.classList.add('hidden');
  return;

  const workspaces = Array.isArray(state?.workspaces) && state.workspaces.length
    ? state.workspaces
    : [{ id: 'default', name: 'Default' }];
  const activeWsId = state?.activeWorkspaceId || 'default';
  const allTabs = Array.isArray(state?.tabs) ? state.tabs : [];

  const tabCounts = new Map();
  for (const t of allTabs) {
    if (!t || t.pinned) continue;
    const wsId = t.workspaceId || 'default';
    tabCounts.set(wsId, (tabCounts.get(wsId) || 0) + 1);
  }

  workspacePillsList.innerHTML = '';
  for (const ws of workspaces) {
    const btn = document.createElement('button');
    btn.type = 'button';
    const isActive = ws.id === activeWsId;
    const count = tabCounts.get(ws.id) || 0;
    btn.className = `ws-pill${isActive ? ' active' : ''}`;
    btn.dataset.wsId = ws.id;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    btn.textContent = ws.name || 'Workspace';
    btn.title = `${ws.name || 'Workspace'} (${count} ${count === 1 ? 'tab' : 'tabs'}) — Right-click to manage`;

    btn.addEventListener('click', () => {
      window.gxSounds?.playClick();
      window.gxAPI.closePopover();
      if (ws.id !== currentState.activeWorkspaceId) {
        window.gxAPI.switchWorkspace(ws.id);
      }
    });

    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.gxSounds?.playClick();
      const rect = btn.getBoundingClientRect();
      tabContextMenuOpen = true;
      activeTabContextMode = 'workspace';
      window.gxAPI.openPopover({
        kind: 'tab-context',
        x: Math.round(rect.left),
        y: Math.round(Math.max(36, rect.bottom + 2)),
        width: 248,
        height: 180,
        payload: {
          contextType: 'workspace',
          workspace: ws,
          isDefault: ws.id === 'default',
          isActive,
          tabCount: count
        }
      });
    });

    const handleWsDragHover = (e) => {
      if (!hasDraggedTab(e)) return;
      const srcTab = currentState.tabs.find((t) => t.id === draggedTabId);
      if (!srcTab || srcTab.pinned || (srcTab.workspaceId || 'default') === ws.id) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      clearTabDropIndicators();
      btn.classList.add('drop-target');
    };

    btn.addEventListener('dragenter', handleWsDragHover);
    btn.addEventListener('dragover', handleWsDragHover);
    btn.addEventListener('dragleave', (e) => {
      if (e.relatedTarget && btn.contains(e.relatedTarget)) return;
      btn.classList.remove('drop-target');
    });
    btn.addEventListener('drop', (e) => {
      const sourceId = getDraggedTabId(e);
      if (!sourceId) return;
      const srcTab = currentState.tabs.find((t) => t.id === sourceId);
      if (!srcTab || srcTab.pinned || (srcTab.workspaceId || 'default') === ws.id) return;
      e.preventDefault();
      e.stopPropagation();
      didDropTab = true;
      suppressTabClickUntil = Date.now() + 300;
      draggedTabId = null;
      pendingStateDuringDrag = null;
      setTabDraggingState(false);
      clearTabDropIndicators();
      window.gxAPI.moveTabToWorkspace(sourceId, ws.id);
      showToast(`Moved tab to ${ws.name || 'Workspace'}`);
    });

    workspacePillsList.appendChild(btn);
  }
}

if (workspacePillsList) {
  workspacePillsList.addEventListener(
    'wheel',
    (e) => {
      if (workspacePillsList.scrollWidth <= workspacePillsList.clientWidth + 1) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta !== 0) {
        e.preventDefault();
        workspacePillsList.scrollLeft += delta;
      }
    },
    { passive: false }
  );
}

if (btnAddWorkspace) {
  btnAddWorkspace.addEventListener('click', (e) => {
    e.stopPropagation();
    window.gxSounds?.playClick();
    if (tabContextMenuOpen && activeTabContextMode === 'workspace-create') {
      tabContextMenuOpen = false;
      activeTabContextMode = null;
      window.gxAPI.closePopover();
      return;
    }
    const rect = btnAddWorkspace.getBoundingClientRect();
    tabContextMenuOpen = true;
    activeTabContextMode = 'workspace-create';
    window.gxAPI.openPopover({
      kind: 'tab-context',
      x: Math.round(rect.left),
      y: Math.round(Math.max(36, rect.bottom + 2)),
      width: 248,
      height: 112,
      payload: {
        contextType: 'workspace-create'
      }
    });
  });
}

// [TABS-W2] Gap 8.2/8.6 — speaker button on noisy/muted tabs. Clicking it
// mutes/unmutes the site (handled in the tab click listener); the muted
// variant shows a speaker with an X. Used by buildTabElement and by
// patchTabElementInPlace so the icon survives the fast-path re-render.
function tabAudioBtnHtml(tab, isMuted) {
  if (isMuted) {
    return `<button class="tab-audio-btn muted" draggable="false" data-muted="true" title="Unmute site"><svg class="tab-audio-svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="16" y1="9" x2="22" y2="15"/><line x1="22" y1="9" x2="16" y2="15"/></svg></button>`;
  }
  if (tab.audible) {
    return `<button class="tab-audio-btn" draggable="false" data-muted="false" title="Mute site"><svg class="tab-audio-svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg></button>`;
  }
  return '';
}

function buildTabElement(tab, group, state, activeWsGroupsList, otherClosableCount) {
  const el = document.createElement('div');
  const isActive = tab.id === state.activeTabId;
  const inGroup = Boolean(group && !tab.pinned);
  const split = state.split || null;
  const splitRole = split
    ? tab.id === split.leftTabId
      ? 'left'
      : tab.id === split.rightTabId
        ? 'right'
        : null
    : null;
  const isSplitVisible = Boolean(splitRole && split && split.visible);

  el.className = [
    'nx-tab',
    isActive ? 'active' : '',
    tab.pinned ? 'pinned' : '',
    inGroup ? 'in-group' : '',
    splitRole ? 'in-split' : '',
    splitRole ? `split-${splitRole}` : '',
    isSplitVisible ? 'split-visible' : '',
    tab.incognito ? 'incognito' : '',
    tab.sleeping ? 'sleeping' : ''
  ]
    .filter(Boolean)
    .join(' ');

  el.dataset.tabId = tab.id;
  el.dataset.favicon = tab.favicon || '';
  if (inGroup) {
    el.dataset.groupId = group.id;
    el.dataset.groupColor = group.color || 'group-1';
  }
  if (splitRole) {
    el.dataset.splitPane = splitRole;
  }
  el.draggable = true;
  el.title = tab.title || 'Start Page';

  // Loading indicator spins around the corner Stop (✕) button (#btnReload.is-stop)
  // rather than replacing the tab favicon in the top strip (tab-loading-spinner kept for CSS compat).
  // Capture-phase error listener swaps broken favicons to .tab-favicon-fallback cleanly.
  const iconHtml = tab.favicon
    ? `<img class="tab-favicon" draggable="false" src="${escapeHtml(tab.favicon)}" alt="" />`
    : `<svg class="tab-favicon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8"/></svg>`;

  const splitSvg = splitRole
    ? `<span class="tab-split-badge" title="Split view (${splitRole === 'left' ? 'Left' : 'Right'} pane)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/>${splitRole === 'left'
      ? '<rect x="4.5" y="5.5" width="7" height="13" rx="1" fill="currentColor" stroke="none"/>'
      : '<rect x="12.5" y="5.5" width="7" height="13" rx="1" fill="currentColor" stroke="none"/>'
    }<line x1="12" y1="4" x2="12" y2="20"/></svg></span>`
    : '';

  // [TABS-W2] Gap 8.2/8.6 — speaker button (click to mute/unmute the site);
  // muted tabs show the crossed-out speaker even when not currently audible.
  const isTabMuted = tabMuteMap.get(tab.id) === true;
  const audioBtn = tabAudioBtnHtml(tab, isTabMuted);

  const sleepSvg = tab.sleeping
    ? `<svg class="tab-sleep-svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`
    : '';

  const closeSvg = `<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 2l8 8M10 2l-8 8"/></svg>`;

  if (tab.pinned) {
    el.innerHTML = iconHtml;
  } else {
    el.innerHTML = `
      ${iconHtml}
      ${splitSvg}
      ${audioBtn}
      ${sleepSvg}
      <span class="tab-title">${escapeHtml(tab.title || 'Start Page')}</span>
      <button class="tab-close-btn" draggable="false" title="Close (Ctrl+W)">${closeSvg}</button>
    `;
  }

  el.addEventListener('dragstart', (e) => {
    if (e.target && e.target.closest && e.target.closest('.tab-close-btn, .tab-audio-btn')) {
      e.preventDefault();
      return;
    }
    if (tabContextMenuOpen) {
      tabContextMenuOpen = false;
      window.gxAPI.closePopover();
    }
    draggedTabId = tab.id;
    didDropTab = false;
    suppressTabClickUntil = Date.now() + 300;
    el.classList.add('dragging');
    setTabDraggingState(true);
    // Market audit bug #32: hide any hover preview the moment a drag starts.
    hideTabHoverCard();
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-nextgx-tab-id', tab.id);
      e.dataTransfer.setData('text/plain', tab.id);
    }
  });

  const handleTabDragHover = (e) => {
    if (!hasDraggedTab(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    clearTabDropIndicators();
    if (draggedTabId === tab.id) return;

    const sourceTab = currentState.tabs.find((t) => t.id === draggedTabId);
    if (sourceTab && Boolean(sourceTab.pinned) !== Boolean(tab.pinned)) {
      return;
    }
    const pos = getDropPositionForTab(el, tab.id, draggedTabId, e.clientX, e.clientY, tab, sourceTab);
    if (pos === 'center') {
      el.classList.add('drop-group');
    } else {
      el.classList.add(pos === 'after' ? 'drop-after' : 'drop-before');
    }
  };

  el.addEventListener('dragenter', handleTabDragHover);
  el.addEventListener('dragover', handleTabDragHover);

  el.addEventListener('dragleave', (e) => {
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    el.classList.remove('drop-before', 'drop-after', 'drop-group');
  });

  el.addEventListener('drop', (e) => {
    const sourceId = getDraggedTabId(e);
    if (!sourceId) return;
    e.preventDefault();
    e.stopPropagation();

    didDropTab = true;
    suppressTabClickUntil = Date.now() + 300;
    const sourceTab = currentState.tabs.find((t) => t.id === sourceId);
    const pos = getDropPositionForTab(el, tab.id, sourceId, e.clientX, e.clientY, tab, sourceTab);
    draggedTabId = null;
    pendingStateDuringDrag = null;
    setTabDraggingState(false);
    clearTabDropIndicators();

    if (sourceId !== tab.id) {
      userScrolledTabStrip = false;
      window.gxAPI.reorderTab({ tabId: sourceId, targetTabId: tab.id, position: pos });
    }
  });

  el.addEventListener('dragend', () => {
    const wasDropped = didDropTab;
    draggedTabId = null;
    didDropTab = false;
    suppressTabClickUntil = Date.now() + 250;
    el.classList.remove('dragging');
    setTabDraggingState(false);
    clearTabDropIndicators();
    if (!wasDropped && pendingStateDuringDrag) {
      const queued = pendingStateDuringDrag;
      pendingStateDuringDrag = null;
      renderTabs(queued);
    }
  });

  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.gxSounds?.playClick();
    hideTabHoverCard();
    tabContextMenuOpen = true;
    activeTabContextMode = 'tab';
    // [TABS-W2] Gap 8.2 — extra fields the tab menu needs (index, tabs to
    // the right, mute state, URL). tabsToRight counts unpinned same-workspace
    // tabs after this one, matching closeTabsToRight in tabs.js.
    // Market audit bug #9: the tab element is REUSED across state updates
    // (renderTabs fast path when the structure key is unchanged), so the
    // `tab`/`state` closed over here predate the video starting — the menu
    // always saw hasPlayingVideo=false even while a video played (the Player
    // panel, fed by main, showed PLAYING the whole time). Resolve the live
    // tab and state from currentState at menu-open time instead.
    const liveState = currentState || state;
    const liveTab = liveState.tabs?.find((t) => t.id === tab.id) || tab;
    const tabIndex = liveState.tabs.findIndex((t) => t.id === tab.id);
    const tabsToRight = liveState.tabs
      .slice(tabIndex + 1)
      .filter(
        (t) => !t.pinned && (t.workspaceId || 'default') === (liveTab.workspaceId || 'default')
      ).length;
    window.gxAPI.openPopover({
      kind: 'tab-context',
      x: Math.round(e.clientX),
      y: Math.round(Math.max(36, e.clientY)),
      width: 224,
      height: 240,
      payload: {
        contextType: 'tab',
        id: tab.id,
        index: tabIndex,
        tabsToRight,
        muted: tabMuteMap.get(tab.id) === true,
        url: liveTab.url || '',
        pinned: Boolean(liveTab.pinned),
        sleeping: Boolean(liveTab.sleeping),
        hasPlayingVideo: Boolean(liveTab.hasPlayingVideo),
        pipActive: Boolean(liveTab.pipActive),
        videoTitle: liveTab.videoTitle || '',
        isActive: tab.id === liveState.activeTabId,
        splitActive: Boolean(liveState.split),
        splitVisible: Boolean(liveState.split && liveState.split.visible),
        isSplitPane: Boolean(
          liveState.split && (tab.id === liveState.split.leftTabId || tab.id === liveState.split.rightTabId)
        ),
        splitPaneSide: liveState.split
          ? tab.id === liveState.split.leftTabId
            ? 'left'
            : tab.id === liveState.split.rightTabId
              ? 'right'
              : null
          : null,
        splitFocusedPane: liveState.split?.focusedPane || null,
        groupId: liveTab.pinned ? null : liveTab.groupId || null,
        groupName: group ? group.name : '',
        workspaceId: liveTab.workspaceId || 'default',
        groups: activeWsGroupsList,
        workspaces: liveState.windowIncognito ? [] : liveState.workspaces || [],
        windowIncognito: Boolean(liveState.windowIncognito),
        canCloseOthers: otherClosableCount > 0,
        totalTabs: liveState.tabs.length
      }
    });
  });

  el.addEventListener('click', (e) => {
    if (Date.now() < suppressTabClickUntil || draggedTabId) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // [TABS-W2] Gap 8.2/8.6 — click the speaker to mute/unmute the site.
    if (e.target.closest('.tab-audio-btn')) {
      e.stopPropagation();
      window.gxAPI.muteTab(tab.id);
      return;
    }
    if (e.target.closest('.tab-close-btn')) {
      e.stopPropagation();
      window.gxSounds?.playTabClose();
      window.gxAPI.closeTab(tab.id);
      showToast('Tab closed', {
        sound: false,
        actionLabel: 'Undo',
        onAction: () => window.gxAPI.reopenLastClosedTab?.()
      });
      return;
    }
    hideTabHoverCard();
    userScrolledTabStrip = false;
    window.gxSounds?.playClick();
    window.gxAPI.closePopover();
    // A tab switch dismisses the GX left tool drawer too — it used to
    // stick open over the new tab's Settings / History / Downloads page.
    if (activeLeftTool) closeLeftTool();
    window.gxAPI.switchTab(tab.id);
  });

  el.addEventListener('auxclick', (e) => {
    if (e.button === 1) {
      window.gxSounds?.playTabClose();
      window.gxAPI.closeTab(tab.id);
      showToast('Tab closed', {
        sound: false,
        actionLabel: 'Undo',
        onAction: () => window.gxAPI.reopenLastClosedTab?.()
      });
    }
  });

  // [TABS-W2] Gap 5.1 — hover preview card (Chrome-style), delayed so it
  // does not flash while sweeping across the strip.
  el.addEventListener('mouseenter', () => {
    scheduleTabHoverCard(tab, group, el);
  });
  el.addEventListener('mouseleave', () => {
    hideTabHoverCard();
  });

  return el;
}

function buildGroupPillElement(group, groupTabs, state) {
  const isCollapsed = Boolean(group.collapsed);
  const activeTabInGroup = groupTabs.find((t) => t.id === state.activeTabId) || null;
  const splitTabInGroup = state.split
    ? groupTabs.find((t) => t.id === state.split.leftTabId || t.id === state.split.rightTabId) || null
    : null;
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = [
    'nx-group-pill',
    isCollapsed ? 'collapsed' : 'expanded',
    isCollapsed && activeTabInGroup ? 'has-active' : '',
    isCollapsed && splitTabInGroup ? 'has-split' : ''
  ]
    .filter(Boolean)
    .join(' ');
  pill.dataset.groupId = group.id;
  pill.dataset.groupColor = group.color || 'group-1';
  pill.dataset.collapsed = isCollapsed ? '1' : '0';
  pill.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
  pill.title = isCollapsed
    ? `${group.name} (${groupTabs.length} ${groupTabs.length === 1 ? 'tab' : 'tabs'})${activeTabInGroup ? ` • Active: ${activeTabInGroup.title}` : ''
    } — Click to expand, right-click to edit`
    : `${group.name} (${groupTabs.length} ${groupTabs.length === 1 ? 'tab' : 'tabs'}) — Click to collapse, right-click to edit`;

  // Market audit bug #14: a collapsed pill only showed the group name and
  // count, so the active tab inside was invisible. Show the active tab's
  // favicon + title in the pill so it stays identifiable while collapsed.
  const activeTabHtml =
    isCollapsed && activeTabInGroup
      ? `<span class="group-active-tab" title="${escapeHtml(activeTabInGroup.title || '')}">
          ${activeTabInGroup.favicon
        ? `<img class="group-active-favicon" src="${escapeHtml(activeTabInGroup.favicon)}" alt="" onerror="this.remove()" />`
        : '<span class="group-active-dot"></span>'
      }
          <span class="group-active-title">${escapeHtml(activeTabInGroup.title || 'Untitled')}</span>
        </span>`
      : '';
  pill.innerHTML = `
    <span class="group-dot"></span>
    <span class="group-name">${escapeHtml(group.name || 'Group')}</span>
    <span class="group-count">${groupTabs.length}</span>
    ${activeTabHtml}
    <svg class="group-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
  `;

  pill.addEventListener('click', (e) => {
    e.stopPropagation();
    window.gxSounds?.playClick();
    window.gxAPI.closePopover();
    window.gxAPI.toggleTabGroupCollapse(group.id);
  });

  pill.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.gxSounds?.playClick();
    const rect = pill.getBoundingClientRect();
    tabContextMenuOpen = true;
    activeTabContextMode = 'group';
    window.gxAPI.openPopover({
      kind: 'tab-context',
      x: Math.round(rect.left),
      y: Math.round(Math.max(36, rect.bottom + 2)),
      width: 248,
      height: 224,
      payload: {
        contextType: 'group',
        group,
        tabCount: groupTabs.length
      }
    });
  });

  const handlePillDragHover = (e) => {
    if (!hasDraggedTab(e)) return;
    const sourceTab = currentState.tabs.find((t) => t.id === draggedTabId);
    if (sourceTab && sourceTab.pinned) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    clearTabDropIndicators();
    const pos = getDropPositionForGroupPill(pill, isCollapsed, e.clientX);
    if (pos === 'before') pill.classList.add('drop-before');
    else if (pos === 'after') pill.classList.add('drop-after');
    else pill.classList.add('drop-group');
  };

  pill.addEventListener('dragenter', handlePillDragHover);
  pill.addEventListener('dragover', handlePillDragHover);
  pill.addEventListener('dragleave', (e) => {
    if (e.relatedTarget && pill.contains(e.relatedTarget)) return;
    pill.classList.remove('drop-before', 'drop-after', 'drop-group');
  });
  pill.addEventListener('drop', (e) => {
    const sourceId = getDraggedTabId(e);
    if (!sourceId) return;
    const sourceTab = currentState.tabs.find((t) => t.id === sourceId);
    if (sourceTab && sourceTab.pinned) return;
    e.preventDefault();
    e.stopPropagation();

    didDropTab = true;
    suppressTabClickUntil = Date.now() + 300;
    const pos = getDropPositionForGroupPill(pill, isCollapsed, e.clientX);
    draggedTabId = null;
    pendingStateDuringDrag = null;
    setTabDraggingState(false);
    clearTabDropIndicators();

    userScrolledTabStrip = false;
    window.gxAPI.reorderTab({
      tabId: sourceId,
      targetGroupId: group.id,
      position: pos,
      atStart: !isCollapsed && pos === 'center'
    });
  });

  return pill;
}

// 1. RENDER TABS & TOP BAR (Zero Emojis — Crisp SVGs only)
let lastTabStripStructureKey = '';

function patchTabElementInPlace(el, tab, group, state) {
  const isActive = tab.id === state.activeTabId;
  const split = state.split && state.split.visible ? state.split : null;
  const splitRole = split
    ? split.leftTabId === tab.id
      ? 'left'
      : split.rightTabId === tab.id
        ? 'right'
        : null
    : null;
  const isSplitFocused = Boolean(splitRole && split.focusedPane === splitRole);

  el.classList.toggle('active', isActive);
  el.classList.toggle('sleeping', Boolean(tab.sleeping));
  el.classList.toggle('audible', Boolean(tab.audible));
  el.classList.toggle('split-focused', isSplitFocused);

  // [TABS-W2] Gap 5.1 — the native `title` tooltip was removed from the
  // tab element (see buildTabElement): the hover preview card is the
  // tooltip, and the native one would double it.
  const titleEl = el.querySelector('.tab-title');
  const displayTitle = tab.title || 'Start Page';
  if (titleEl && titleEl.textContent !== displayTitle) {
    titleEl.textContent = displayTitle;
  }

  const prevFav = el.dataset.favicon || '';
  const nextFav = tab.favicon || '';
  if (prevFav !== nextFav) {
    el.dataset.favicon = nextFav;
    const existingIcon = el.querySelector('img.tab-favicon, .tab-favicon-svg, .tab-favicon-fallback');
    if (nextFav) {
      if (existingIcon && existingIcon.tagName === 'IMG') {
        existingIcon.src = nextFav;
        existingIcon.style.display = '';
      } else {
        const img = document.createElement('img');
        img.className = 'tab-favicon';
        img.draggable = false;
        img.alt = '';
        img.src = nextFav;
        if (existingIcon) existingIcon.replaceWith(img);
        else el.prepend(img);
      }
    } else if (existingIcon && !existingIcon.classList.contains('tab-favicon-svg')) {
      const wrap = document.createElement('span');
      wrap.innerHTML = `<svg class="tab-favicon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8"/></svg>`;
      existingIcon.replaceWith(wrap.firstElementChild);
    }
  }

  // Keep tab favicon stable during load (loading spinner orbits #btnReload.is-stop in the toolbar corner).
  el.dataset.loading = tab.isLoading ? '1' : '0';
  el.title = tab.title || 'Start Page';

  if (!tab.pinned) {
    // [TABS-W2] Gap 8.2/8.6 — speaker button: present when audible OR muted;
    // swap the button when the muted state flips.
    const isMuted = tabMuteMap.get(tab.id) === true;
    const wantAudio = Boolean(tab.audible || isMuted);
    const existingAudioBtn = el.querySelector('.tab-audio-btn');
    if (wantAudio && !existingAudioBtn) {
      const wrap = document.createElement('span');
      wrap.innerHTML = tabAudioBtnHtml(tab, isMuted);
      if (titleEl) el.insertBefore(wrap.firstElementChild, titleEl);
    } else if (!wantAudio && existingAudioBtn) {
      existingAudioBtn.remove();
    } else if (existingAudioBtn && existingAudioBtn.dataset.muted !== String(isMuted)) {
      const wrap = document.createElement('span');
      wrap.innerHTML = tabAudioBtnHtml(tab, isMuted);
      existingAudioBtn.replaceWith(wrap.firstElementChild);
    }

    const existingSleep = el.querySelector('.tab-sleep-svg');
    if (tab.sleeping && !existingSleep) {
      const wrap = document.createElement('span');
      wrap.innerHTML = `<svg class="tab-sleep-svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
      if (titleEl) el.insertBefore(wrap.firstElementChild, titleEl);
    } else if (!tab.sleeping && existingSleep) {
      existingSleep.remove();
    }
  }
}

// [TABS-W2] Gap 5.1 — tab hover preview card (Chrome-style), shown after a
// short delay so it does not flash while sweeping across the strip. The
// card element is created lazily and appended to <body>.
let tabHoverTimer = null;
let tabHoverCardEl = null;

function getTabHoverCardEl() {
  if (tabHoverCardEl) return tabHoverCardEl;
  const card = document.createElement('div');
  card.id = 'tabHoverCard';
  card.className = 'tab-hover-card hidden';
  document.body.appendChild(card);
  tabHoverCardEl = card;
  return card;
}

function scheduleTabHoverCard(tab, group, tabEl) {
  hideTabHoverCard();
  if (settingsState.tabHoverPreview === false) return;
  // Market audit bug #32: the preview card popped up mid-drag. A tab drag
  // is in progress (draggedTabId set on dragstart), so never schedule one.
  if (draggedTabId) return;
  tabHoverTimer = setTimeout(() => {
    // Floating DOM tab hover overview card is disabled — native tab title tooltip is cleaner
    // and avoids WebContentsView clipping.
    if (settingsState.tabHoverPreview !== 'card') return;
    const card = getTabHoverCardEl();
    // Memory readout (Chrome-style): per-tab RAM/CPU from the last
    // system-stats sample, when the tab has been measured yet.
    const hoverStat = lastSystemStats?.tabStats?.[tab.id] || null;
    const hoverMem =
      hoverStat && typeof hoverStat.ramMB === 'number'
        ? `Memory: ${hoverStat.ramMB} MB${hoverStat.cpuPercent !== null && hoverStat.cpuPercent !== undefined ? ` • CPU: ${formatCpuPct(hoverStat.cpuPercent)}` : ''}${hoverStat.cpuThrottled ? ' • Throttled' : ''}`
        : '';
    // Fix2-shell (item 6): thumbnail strip. There is no live per-tab
    // screenshot pipeline in the shell — captureScreenshot is the manual
    // full-page tool for the active tab only, and inventing a per-tab
    // capture loop would cost a screenshot per hover — so the thumbnail is
    // the tab's favicon shown large on a gradient tile, with the title's
    // initial as the fallback when the favicon is missing or dead.
    const thumbLetter = (tab.title || 'Start Page').match(/[A-Za-z0-9]/)?.[0].toUpperCase() || 'N';
    card.innerHTML = `
      <div class="tab-hover-thumb"><span class="tab-hover-thumb-letter">${escapeHtml(thumbLetter)}</span>${tab.favicon
        ? `<img class="tab-hover-thumb-img" src="${escapeHtml(tab.favicon)}" alt="" onerror="this.remove()" />`
        : ''
      }</div>
      <div class="tab-hover-head">
        ${tab.favicon
        ? `<img class="tab-hover-favicon" src="${escapeHtml(tab.favicon)}" alt="" onerror="this.style.display='none'" />`
        : `<svg class="tab-hover-favicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8"/></svg>`
      }
        <span class="tab-hover-title">${escapeHtml(tab.title || 'Start Page')}</span>
      </div>
      <div class="tab-hover-url">${escapeHtml(tab.url || '')}</div>
      ${hoverMem ? `<div class="tab-hover-meta">${escapeHtml(hoverMem)}</div>` : ''}
    `;
    card.classList.remove('hidden');
    const rect = tabEl.getBoundingClientRect();
    const cardW = card.offsetWidth || 280;
    card.style.left = `${Math.max(8, Math.min(window.innerWidth - cardW - 8, Math.round(rect.left)))}px`;
    card.style.top = `${Math.round(rect.bottom + 8)}px`;
  }, 400);
}

function hideTabHoverCard() {
  if (tabHoverTimer) {
    clearTimeout(tabHoverTimer);
    tabHoverTimer = null;
  }
  if (tabHoverCardEl) tabHoverCardEl.classList.add('hidden');
}

// [TABS-W2] Gap 8.1 — tab search dropdown (chevron at the left of the tab
// strip, or Ctrl+Shift+A). The dropdown lives in the POPOVER (kind
// 'tab-search', rendered by popover.html), NOT in a renderer-side panel:
// renderer fixed panels below the top chrome are covered by the active
// tab's WebContentsView in the composited window, so only the popover view
// (which main brings to front) renders fully. Lists open tabs by recency
// with favicon, title and URL; Enter/click switches, per-row ✕ closes
// (handled inside the popover). Main toggles the popover closed when the
// same kind is re-opened, so the chevron / Ctrl+Shift+A naturally toggle it.
function openTabSearchPopover() {
  const rows = (currentState.tabs || []).map((t, i) => ({
    id: t.id,
    title: t.title || 'Start Page',
    url: t.url || '',
    favicon: t.favicon || '',
    groupName:
      ((currentState.groups || []).find((g) => g.id === t.groupId) || {}).name || '',
    lastSeen: tabLastSeen.get(t.id) || 0,
    stripIndex: i
  }));
  rows.sort((a, b) => b.lastSeen - a.lastSeen || a.stripIndex - b.stripIndex);
  const chevron = document.getElementById('btnTabSearch');
  const rect = chevron ? chevron.getBoundingClientRect() : { left: 210, right: 610, bottom: 40 };
  const popX = Math.max(8, Math.min((window.innerWidth || 1280) - 408, Math.round((rect.right || rect.left) - 400)));
  window.gxAPI.openPopover({
    kind: 'tab-search',
    x: popX,
    y: Math.round(rect.bottom + 4),
    width: 400,
    height: 320,
    payload: {
      tabs: rows.map(({ id, title, url, favicon, groupName }) => ({
        id,
        title,
        url,
        favicon,
        groupName
      }))
    }
  });
}

// [TABS-W2] Gap 3.7 — history-based omnibox suggestions (local history
// only, no search-suggestion backend). The dropdown lives in the POPOVER
// (kinds 'omnibox-suggest' / 'omnibox-suggest-alt', rendered by
// popover.html) — a renderer-side panel below the address bar is covered by
// the active tab's WebContentsView in the composited window. The two kinds
// alternate on every update because popovers.js toggles a popover closed
// when re-opened with the same kind, and there is no update channel for an
// already-open popover. Click a row to navigate, Enter keeps the normal
// typed-text navigation (which closes the popover).
let omniboxSuggestTimer = null;
let omniboxSuggestKindAlt = false;
let omniboxSuggestLastUrls = '';
let omniboxSuggestReqId = 0;
let omniboxSuggestItems = [];
let omniboxSuggestSelectedIdx = -1;
const addressDraftByTabId = new Map();
let selectAllOnMouseUp = false;

async function getHistoryForSuggestions() {
  const now = Date.now();
  if (historyCache && now - historyCacheAt < 30000) return historyCache;
  try {
    historyCache = (await window.gxAPI.getHistory?.()) || [];
  } catch (_) {
    historyCache = [];
  }
  // Market audit bug #20: the 30 s cache was populated empty on the first
  // keystroke (before any history existed), so suggestions stayed silently
  // empty for 30 s. Only cache non-empty results; an empty fetch retries
  // on the next keystroke.
  if (historyCache.length) historyCacheAt = now;
  else historyCacheAt = 0;
  return historyCache;
}

const OMNIBOX_TOP_SITES = [
  { title: 'YouTube', domain: 'youtube.com', url: 'https://www.youtube.com/' },
  { title: 'YouTube Music', domain: 'music.youtube.com', url: 'https://music.youtube.com/' },
  { title: 'GitHub', domain: 'github.com', url: 'https://github.com/' },
  { title: 'Google', domain: 'google.com', url: 'https://www.google.com/' },
  { title: 'ChatGPT', domain: 'chatgpt.com', url: 'https://chatgpt.com/' },
  { title: 'Spotify', domain: 'open.spotify.com', url: 'https://open.spotify.com/' },
  { title: 'Twitch', domain: 'twitch.tv', url: 'https://www.twitch.tv/' },
  { title: 'Reddit', domain: 'reddit.com', url: 'https://www.reddit.com/' },
  { title: 'Facebook', domain: 'facebook.com', url: 'https://www.facebook.com/' },
  { title: 'Instagram', domain: 'instagram.com', url: 'https://www.instagram.com/' },
  { title: 'WhatsApp', domain: 'web.whatsapp.com', url: 'https://web.whatsapp.com/' },
  { title: 'Wikipedia', domain: 'wikipedia.org', url: 'https://www.wikipedia.org/' },
  { title: 'Gmail', domain: 'mail.google.com', url: 'https://mail.google.com/' },
  { title: 'Netflix', domain: 'netflix.com', url: 'https://www.netflix.com/' }
];

const SEARCH_ENGINE_LABELS = {
  google: 'Google Search',
  brave: 'Brave Search',
  duckduckgo: 'DuckDuckGo Search',
  bing: 'Bing Search',
  ecosia: 'Ecosia Search'
};

function getCleanOmniboxUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  return rawUrl.replace(/^https?:\/\//i, '');
}

function getOmniboxDomain(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.host.replace(/^www\.(?=[^.]+\.)/i, '').toLowerCase();
  } catch (_) {
    return '';
  }
}

let lastOmniboxInputWasDelete = false;

function pushOmniboxSuggestPopover(items, selectedIdx) {
  omniboxSuggestKindAlt = !omniboxSuggestKindAlt;
  const rect = addressForm.getBoundingClientRect();
  const fullW = Math.max(400, Math.round(rect.width));
  const hasSuggestionsSec = items.some((it) => it.section === 'suggestions');
  const hasHistorySec = items.some((it) => it.section === 'history');
  const headerH = (hasSuggestionsSec ? 30 : 0) + (hasHistorySec ? 32 : 0);
  const targetH = Math.min(480, Math.max(84, 18 + headerH + items.length * 36));
  window.gxAPI.openPopover({
    kind: omniboxSuggestKindAlt ? 'omnibox-suggest-alt' : 'omnibox-suggest',
    x: Math.round(rect.left),
    y: Math.round(rect.bottom + 2),
    width: fullW,
    height: targetH,
    payload: { suggestions: items, selectedIndex: selectedIdx }
  });
}

async function renderOmniboxSuggestions() {
  if (document.activeElement !== addressInput || !document.hasFocus()) {
    return;
  }
  const reqId = ++omniboxSuggestReqId;
  const rawVal = addressInput.value;
  // If inline autocomplete is highlighted, match against only the user-typed prefix
  const selStart = addressInput.selectionStart ?? rawVal.length;
  const selEnd = addressInput.selectionEnd ?? rawVal.length;
  const typedRaw = selEnd === rawVal.length && selStart < selEnd ? rawVal.slice(0, selStart) : rawVal;
  const qOrig = typedRaw.trim();
  const q = qOrig.toLowerCase();
  if (!q || q.length < 1) {
    hideOmniboxSuggestions();
    return;
  }

  const [history, remoteQueries] = await Promise.all([
    getHistoryForSuggestions(),
    q.length >= 2 && !q.includes('://') && window.gxAPI.getRemoteSuggestions
      ? window.gxAPI.getRemoteSuggestions(qOrig).catch(() => [])
      : Promise.resolve([])
  ]);
  if (reqId !== omniboxSuggestReqId || document.activeElement !== addressInput || !document.hasFocus()) {
    return;
  }

  const engineId = settingsState?.searchEngine || 'google';
  const engineLabel = SEARCH_ENGINE_LABELS[engineId] || 'Web Search';

  // 1. Find best matching open tab or top site for Opera GX top suggestion + inline autocomplete
  const openTabs = Array.isArray(currentState.tabs) ? currentState.tabs : [];
  let topSiteMatch = null;
  let autocompleteDomain = '';

  const checkPrefixDomain = (domain, title, url, favicon, switchTabId = null) => {
    if (!domain) return;
    if (domain.startsWith(q) || (title && title.toLowerCase().startsWith(q))) {
      if (!topSiteMatch) {
        topSiteMatch = {
          section: 'suggestions',
          type: 'site',
          title: title || domain,
          url,
          displayUrl: getCleanOmniboxUrl(url),
          favicon: favicon || `https://${domain}/favicon.ico`,
          switchTabId
        };
      }
      if (!autocompleteDomain && domain.startsWith(q) && domain.length > q.length) {
        autocompleteDomain = domain;
      }
    }
  };

  for (const t of openTabs) {
    if (!t || !t.url || !/^https?:\/\//i.test(t.url)) continue;
    const dom = getOmniboxDomain(t.url);
    const isOtherTab = t.id !== currentState.activeTabId;
    checkPrefixDomain(dom, t.title || dom, t.url, t.favicon, isOtherTab ? t.id : null);
  }
  for (const bm of cachedBookmarks || []) {
    if (!bm || !bm.url || !/^https?:\/\//i.test(bm.url)) continue;
    const dom = getOmniboxDomain(bm.url);
    const openMatch = openTabs.find((t) => t && t.id !== currentState.activeTabId && getOmniboxDomain(t.url) === dom);
    checkPrefixDomain(dom, bm.title || dom, bm.url, bm.favicon, openMatch ? openMatch.id : null);
  }
  for (const site of OMNIBOX_TOP_SITES) {
    const openMatch = openTabs.find((t) => t && t.id !== currentState.activeTabId && getOmniboxDomain(t.url) === site.domain);
    checkPrefixDomain(site.domain, site.title, site.url, `https://${site.domain}/favicon.ico`, openMatch ? openMatch.id : null);
  }

  // Inline domain autocomplete (e.g. typing "you" -> "you[tube.com]") when typing forward
  if (
    !lastOmniboxInputWasDelete &&
    autocompleteDomain &&
    !qOrig.includes(' ') &&
    !qOrig.includes('/') &&
    selStart === typedRaw.length &&
    typedRaw.length >= 2
  ) {
    const completed = qOrig + autocompleteDomain.slice(q.length);
    if (addressInput.value !== completed) {
      addressInput.value = completed;
      try {
        addressInput.setSelectionRange(qOrig.length, completed.length);
      } catch (_) { }
    }
  }

  // 2. Build Opera GX SUGGESTIONS section
  const items = [];
  if (topSiteMatch) {
    items.push(topSiteMatch);
  }
  items.push({
    section: 'suggestions',
    type: 'search',
    title: qOrig,
    subtitle: engineLabel,
    url: qOrig
  });
  if (Array.isArray(remoteQueries)) {
    for (const rq of remoteQueries) {
      if (items.length >= 5) break;
      items.push({
        section: 'suggestions',
        type: 'search',
        title: rq,
        subtitle: engineLabel,
        url: rq
      });
    }
  }

  // 3. Build Opera GX HISTORY section (single-line clean rows)
  const seenUrls = new Set(topSiteMatch ? [topSiteMatch.url] : []);
  let historyCount = 0;
  for (const entry of history) {
    const url = entry.url || '';
    const title = entry.title || '';
    if (!url || seenUrls.has(url) || url.toLowerCase() === q) continue;
    if (title.toLowerCase().includes(q) || url.toLowerCase().includes(q)) {
      seenUrls.add(url);
      const dom = getOmniboxDomain(url);
      items.push({
        section: 'history',
        type: 'history',
        title: title || dom || url,
        url,
        displayUrl: getCleanOmniboxUrl(url),
        favicon: entry.favicon || (dom ? `https://${dom}/favicon.ico` : '')
      });
      historyCount += 1;
      if (historyCount >= 6) break;
    }
  }

  const urlsKey = items.map((m) => `${m.section}:${m.type}:${m.url}:${m.switchTabId || ''}`).join('|');
  omniboxSuggestItems = items;
  omniboxSuggestSelectedIdx = -1;
  if (urlsKey === omniboxSuggestLastUrls) return;
  omniboxSuggestLastUrls = urlsKey;
  pushOmniboxSuggestPopover(items, -1);
}

function hideOmniboxSuggestions() {
  clearTimeout(omniboxSuggestTimer);
  omniboxSuggestTimer = null;
  omniboxSuggestReqId += 1;
  // Only close when the suggestions popover may be open — never clobber
  // another popover (e.g. a permission prompt) and NEVER steal focus back to the tab!
  if (omniboxSuggestLastUrls) {
    window.gxAPI.closePopover({ kind: 'omnibox-suggest', restoreFocus: false });
  }
  omniboxSuggestLastUrls = '';
  omniboxSuggestItems = [];
  omniboxSuggestSelectedIdx = -1;
}

// [TABS-W2] Gap 1.5 — omnibox permission chip (while a prompt is open) and
// persistent per-site permission icons (after a decision). The chip text
// mirrors Chrome ("Use microphone?" etc.); the icons reopen the site-info
// panel, where the permission can be changed.
const PERM_CHIP_LABELS = {
  microphone: 'Use microphone?',
  camera: 'Use camera?',
  geolocation: 'Use your location?',
  notifications: 'Get notifications?',
  'clipboard-read': 'Share clipboard?',
  'screen-share': 'Share your screen?'
};
const PERM_ICON_SVGS = {
  camera:
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>',
  microphone:
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>',
  geolocation:
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  notifications:
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  'clipboard-read':
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>',
  'screen-share':
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>'
};

function renderPermChip() {
  const chip = document.getElementById('permChip');
  if (!chip) return;
  if (!activePermPrompt || !activePermPrompt.open) {
    chip.classList.add('hidden');
    chip.textContent = '';
    return;
  }
  const key = (activePermPrompt.keys || [])[0];
  chip.textContent = PERM_CHIP_LABELS[key] || 'Permission requested';
  chip.title = 'This site is asking for permission — answer in the prompt';
  chip.classList.remove('hidden');
}

async function refreshSitePermIcons() {
  const wrap = document.getElementById('permSiteIcons');
  if (!wrap) return;
  // Minimalist Opera GX URL bar: keep passive camera/microphone permission icons
  // inside the left Site Security / Lock popover (#btnSiteSecurity) rather than
  // permanently cluttering the right side of the address bar. Active prompts still
  // show #permChip when a site is requesting permission.
  wrap.innerHTML = '';
}

// [TABS-W2] Gap 7.4 — open the bookmark bubble (popover) for the active tab
// instead of toggling the bookmark directly (star click / Ctrl+D).
function openBookmarkBubble() {
  const active = currentState.activeTab;
  if (!active || !active.url || !/^https?:\/\//i.test(active.url)) {
    showToast('Only web pages can be bookmarked');
    return;
  }
  const rect = btnBookmarkStar.getBoundingClientRect();
  window.gxAPI.openPopover({
    kind: 'bookmark-bubble',
    x: Math.round(Math.max(8, rect.left - 140)),
    y: Math.round(rect.bottom + 6),
    width: 300,
    height: 260,
    payload: {
      url: active.url,
      title: active.title || active.url,
      favicon: active.favicon || '',
      isBookmarked: Boolean(active.isBookmarked)
    }
  });
}

function renderTabs(state) {
  if (draggedTabId) {
    pendingStateDuringDrag = state;
    return;
  }

  const activeWsId = state.windowIncognito ? 'default' : state.activeWorkspaceId || 'default';
  const wsChanged = activeWsId !== lastRenderedWorkspaceId;
  const prevScrollLeft = wsChanged ? 0 : tabsContainer.scrollLeft;
  const activeChanged = state.activeTabId !== lastRenderedActiveTabId;
  const countChanged = state.tabs.length !== lastRenderedTabCount;
  if (wsChanged || activeChanged || countChanged) {
    userScrolledTabStrip = false;
  }
  lastRenderedWorkspaceId = activeWsId;
  lastRenderedActiveTabId = state.activeTabId;
  lastRenderedTabCount = state.tabs.length;

  currentState = state;
  // [TABS-W2] Gap 8.1 — track last-active times for tab-search recency.
  if (state.activeTabId) tabLastSeen.set(state.activeTabId, Date.now());
  renderWorkspaces(state);

  const allTabs = Array.isArray(state.tabs) ? state.tabs : [];
  const pinnedTabs = allTabs.filter((t) => t && t.pinned);
  const wsUnpinnedTabs = allTabs.filter(
    (t) => t && !t.pinned && (state.windowIncognito ? 'default' : t.workspaceId || 'default') === activeWsId
  );

  const groupTabCounts = new Map();
  for (const t of wsUnpinnedTabs) {
    if (t.groupId) {
      groupTabCounts.set(t.groupId, (groupTabCounts.get(t.groupId) || 0) + 1);
    }
  }
  const activeWsGroupsList = (Array.isArray(state.groups) ? state.groups : [])
    .filter((g) => g && (g.workspaceId || 'default') === activeWsId && (groupTabCounts.get(g.id) || 0) > 0)
    .map((g) => ({ ...g, tabCount: groupTabCounts.get(g.id) || 0 }));
  const groupById = new Map(activeWsGroupsList.map((g) => [g.id, g]));

  const splitKey = state.split && state.split.visible ? `${state.split.leftTabId}|${state.split.rightTabId}` : '';
  const structureKey = [
    activeWsId,
    splitKey,
    pinnedTabs.map((t) => t.id).join(','),
    wsUnpinnedTabs.map((t) => `${t.id}:${t.groupId || ''}`).join(','),
    activeWsGroupsList.map((g) => `${g.id}:${g.name}:${g.color}:${g.collapsed ? 1 : 0}:${g.tabCount}`).join(',')
  ].join('||');

  let activeTabEl = null;
  let activeCollapsedPillEl = null;

  if (structureKey === lastTabStripStructureKey && tabsContainer.children.length > 0) {
    // Fast path: patch tab DOM nodes in-place without destroying/rebuilding listeners
    const existingTabsById = new Map();
    tabsContainer.querySelectorAll('.nx-tab[data-tab-id]').forEach((el) => {
      existingTabsById.set(el.dataset.tabId, el);
    });
    let allFound = true;
    for (const tab of pinnedTabs) {
      const el = existingTabsById.get(tab.id);
      if (!el) { allFound = false; break; }
      patchTabElementInPlace(el, tab, null, state);
      if (tab.id === state.activeTabId) activeTabEl = el;
    }
    if (allFound) {
      for (const tab of wsUnpinnedTabs) {
        const grp = tab.groupId ? groupById.get(tab.groupId) || null : null;
        if (grp && grp.collapsed) {
          // Fix2-shell (item 12), fast path: the active tab of a collapsed
          // group stays rendered in the strip. If it has no element yet,
          // fall through to the full rebuild (allFound = false) so one is
          // created; a stale element for a tab that is no longer active is
          // removed so it cannot linger visibly after a tab switch.
          if (tab.id === state.activeTabId) {
            activeCollapsedPillEl = tabsContainer.querySelector(`.nx-group-pill[data-group-id="${CSS.escape(grp.id)}"]`);
            const el = existingTabsById.get(tab.id);
            if (!el) { allFound = false; break; }
            patchTabElementInPlace(el, tab, grp, state);
            el.classList.add('active-in-collapsed-group');
            activeTabEl = el;
          } else {
            const stale = existingTabsById.get(tab.id);
            if (stale) stale.remove();
          }
          continue;
        }
        const el = existingTabsById.get(tab.id);
        if (!el) { allFound = false; break; }
        patchTabElementInPlace(el, tab, grp, state);
        if (tab.id === state.activeTabId) activeTabEl = el;
      }
    }
    if (allFound) {
      // Also keep collapsed group pills' active highlight in sync
      for (const grp of activeWsGroupsList) {
        if (!grp.collapsed) continue;
        const pill = tabsContainer.querySelector(`.nx-group-pill[data-group-id="${CSS.escape(grp.id)}"]`);
        if (pill) {
          const hasActive = wsUnpinnedTabs.some((t) => t.groupId === grp.id && t.id === state.activeTabId);
          pill.classList.toggle('has-active', hasActive);
        }
      }
      updateTabScrollButtons();
      const focusStripEl = activeTabEl || activeCollapsedPillEl;
      if (focusStripEl && !userScrolledTabStrip) {
        scrollActiveTabIntoView(focusStripEl);
        updateTabScrollButtons();
      }
      // Continue below to sync nav bar & active tab controls
      syncActiveTabBarControls(state, activeChanged);
      return;
    }
  }

  lastTabStripStructureKey = structureKey;
  tabsContainer.innerHTML = '';

  // Render global pinned tabs first
  for (const tab of pinnedTabs) {
    const otherClosableCount = wsUnpinnedTabs.length;
    const el = buildTabElement(tab, null, state, activeWsGroupsList, otherClosableCount);
    tabsContainer.appendChild(el);
    if (tab.id === state.activeTabId) activeTabEl = el;
  }

  // Render active workspace's unpinned tabs + tab islands
  const renderedGroups = new Set();
  for (const tab of wsUnpinnedTabs) {
    const otherClosableCount = wsUnpinnedTabs.length - 1;
    const gid = tab.groupId && groupById.has(tab.groupId) ? tab.groupId : null;
    if (!gid) {
      const el = buildTabElement(tab, null, state, activeWsGroupsList, otherClosableCount);
      tabsContainer.appendChild(el);
      if (tab.id === state.activeTabId) activeTabEl = el;
      continue;
    }
    if (renderedGroups.has(gid)) continue;
    renderedGroups.add(gid);

    const group = groupById.get(gid);
    const groupTabs = wsUnpinnedTabs.filter((t) => t.groupId === gid);
    const pillEl = buildGroupPillElement(group, groupTabs, state);
    tabsContainer.appendChild(pillEl);

    if (group.collapsed) {
      // Fix2-shell (item 12): collapsing a group must NOT hide the active
      // tab. Chose "keep it visible" over "switch active tab first": switching
      // would steal the user's context (and could trigger navigation/state
      // loss in the newly-activated tab). The active tab stays rendered right
      // after the pill, marked .active-in-collapsed-group; every other tab
      // in the group stays hidden until the group is expanded. The pill
      // keeps its active-tab favicon/title preview (prior MA-14 fix).
      const activeInGroup = groupTabs.find((t) => t.id === state.activeTabId);
      if (activeInGroup) {
        activeCollapsedPillEl = pillEl;
        const el = buildTabElement(activeInGroup, group, state, activeWsGroupsList, wsUnpinnedTabs.length - 1);
        el.classList.add('active-in-collapsed-group');
        tabsContainer.appendChild(el);
        activeTabEl = el;
      }
      continue;
    }

    for (const gt of groupTabs) {
      const el = buildTabElement(gt, group, state, activeWsGroupsList, wsUnpinnedTabs.length - 1);
      tabsContainer.appendChild(el);
      if (gt.id === state.activeTabId) activeTabEl = el;
    }
  }

  tabsContainer.scrollLeft = prevScrollLeft;
  updateTabScrollButtons();
  updateTopContourWidth();
  const focusStripEl = activeTabEl || activeCollapsedPillEl;
  if (focusStripEl && !userScrolledTabStrip) {
    scrollActiveTabIntoView(focusStripEl);
    updateTabScrollButtons();
    requestAnimationFrame(() => {
      const currentActive =
        tabsContainer.querySelector('.nx-tab.active') ||
        tabsContainer.querySelector('.nx-group-pill.has-active');
      if (currentActive && !userScrolledTabStrip) {
        scrollActiveTabIntoView(currentActive);
      }
      updateTabScrollButtons();
      updateTopContourWidth();
    });
  }

  syncActiveTabBarControls(state, activeChanged);
}

function syncActiveTabBarControls(state, activeChanged = false) {
  const active = state.activeTab;
  if (active) {
    btnBack.disabled = !active.canGoBack;
    btnForward.disabled = !active.canGoForward;
    const isLoading = Boolean(active.isLoading);
    btnReload.classList.remove('spinning');
    btnReload.classList.toggle('is-stop', isLoading);
    if (btnReload.dataset.mode !== (isLoading ? 'stop' : 'reload')) {
      btnReload.innerHTML = isLoading ? STOP_ICON_SVG : RELOAD_ICON_SVG;
      btnReload.dataset.mode = isLoading ? 'stop' : 'reload';
    }
    btnReload.title = isLoading ? 'Stop loading (Esc)' : 'Reload (Ctrl+R)';
    btnReload.setAttribute('aria-label', isLoading ? 'Stop loading' : 'Reload');

    const activeDraft = active.id ? addressDraftByTabId.get(active.id) : undefined;
    if (activeChanged) {
      if (typeof activeDraft === 'string') {
        addressInput.value = activeDraft;
      } else {
        addressInput.value = active.url === 'nextgx://newtab' ? '' : elideUrlForDisplay(active.url);
      }
    } else if (document.activeElement !== addressInput && typeof activeDraft !== 'string') {
      // [URLBAR-3.1] Unfocused omnibox shows the elided display value (no scheme).
      addressInput.value = active.url === 'nextgx://newtab' ? '' : elideUrlForDisplay(active.url);
    }

    if (siteInfoPopoverUrl && active.url !== siteInfoPopoverUrl) {
      siteInfoPopoverUrl = '';
      window.gxAPI.closePopover({ kind: 'site-info', restoreFocus: false });
    }
    if (zoomPopoverUrl && active.url !== zoomPopoverUrl) {
      zoomPopoverUrl = '';
      window.gxAPI.closePopover({ kind: 'zoom-bubble', restoreFocus: false });
    }

    const secState =
      active.securityState ||
      (active.isHttpInsecure ? 'insecure' : active.isSecure ? 'secure' : 'neutral');
    const isHttpInsecure = secState === 'insecure';
    const isNeutralSec = secState === 'neutral';
    btnSiteSecurity.classList.toggle('insecure', isHttpInsecure);
    btnSiteSecurity.classList.toggle('neutral', isNeutralSec);
    secNotSecureLabel.classList.toggle('hidden', !isHttpInsecure);
    const secLockSvg = document.getElementById('secLockSvg');
    const nextIconState = isHttpInsecure ? 'warn' : isNeutralSec ? 'info' : 'lock';
    const INFO_ICON_PATHS =
      '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>';
    if (secLockSvg && secLockSvg.dataset.state !== nextIconState) {
      secLockSvg.innerHTML =
        nextIconState === 'warn'
          ? WARN_ICON_PATHS
          : nextIconState === 'info'
            ? INFO_ICON_PATHS
            : LOCK_ICON_PATHS;
      secLockSvg.dataset.state = nextIconState;
    }

    if (btnPanic && typeof state.panicActive === 'boolean') {
      const pActive = Boolean(state.panicActive);
      btnPanic.classList.toggle('active', pActive);
      btnPanic.setAttribute('aria-pressed', pActive ? 'true' : 'false');
      btnPanic.title = pActive
        ? 'Panic active — click to restore your tabs (Ctrl+Shift+P)'
        : 'Panic button — instantly hide all tabs (Ctrl+Shift+P), press again to restore';
    }

    const isWebPage = Boolean(active.url && /^https?:\/\//i.test(active.url));
    incognitoIndicator.classList.toggle('hidden', !active.incognito);
    btnBookmarkStar.classList.toggle('hidden', !isWebPage);
    btnBookmarkStar.classList.toggle('active', Boolean(active.isBookmarked));
    btnReaderMode.classList.toggle('hidden', !isWebPage);
    btnReaderMode.classList.toggle('active', Boolean(active.readerMode));
    const btnSnapEl = document.getElementById('btnScreenshot');
    if (btnSnapEl) btnSnapEl.classList.toggle('hidden', !isWebPage);
    if (btnPopOutVideo) {
      const canPopOut = Boolean((active.hasPlayingVideo || active.pipActive) && !active.sleeping);
      const isPip = Boolean(active.pipActive && canPopOut);
      btnPopOutVideo.disabled = !canPopOut;
      btnPopOutVideo.classList.toggle('has-video', canPopOut);
      btnPopOutVideo.classList.toggle('active', isPip);
      btnPopOutVideo.setAttribute('aria-pressed', isPip ? 'true' : 'false');
      btnPopOutVideo.title = !canPopOut
        ? 'Pop out video — play a video in this tab to enable'
        : isPip
          ? 'Video popped out — click to exit Picture-in-Picture'
          : active.videoTitle
            ? `Pop out video: ${active.videoTitle}`
            : 'Pop out video (Picture-in-Picture)';
    }
    if (zoomValueText) {
      zoomValueText.textContent = `${active.zoomPercent || 100}%`;
    }
    // [URLBAR-3.5] Omnibox magnifier: visible only while zoom is not 100%.
    if (btnZoomIndicator) {
      const pct = active.zoomPercent || 100;
      btnZoomIndicator.classList.toggle('hidden', pct === 100);
      if (zoomIndicatorText) zoomIndicatorText.textContent = `${pct}%`;
    }
    // [URLBAR-9.2] Per-site zoom restore / remember.
    syncPerSiteZoom(state, active);
  } else if (btnPopOutVideo) {
    btnPopOutVideo.disabled = true;
    btnPopOutVideo.classList.remove('has-video', 'active');
    btnPopOutVideo.setAttribute('aria-pressed', 'false');
    btnPopOutVideo.title = 'Pop out video — play a video in this tab to enable';
  }

  if (activeChanged && findBarOpen) {
    const txt = findInput.value.trim();
    if (txt) {
      lastFindQuery = txt;
      window.gxAPI.findInPage(txt, true);
    } else {
      lastFindQuery = '';
      updateFindMatchCount(null);
    }
  }

  updateAddressShieldAppearance();
  updateSplitToolbarButton(state.split);
  updateSplitDividerLayout(state.split);

  if (btnGxCornerTab) {
    const isCornerActive = Boolean(active && active.url === 'nextgx://corner');
    btnGxCornerTab.classList.toggle('active', isCornerActive);
    btnGxCornerTab.setAttribute('aria-pressed', isCornerActive ? 'true' : 'false');
  }

  document.querySelectorAll('[data-sidebar-tab]').forEach((btn) => {
    const targetUrl = btn.dataset.sidebarTab || '';
    const isActive = Boolean(active && targetUrl && active.url === targetUrl);
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });

  if (activeLeftTool === 'gxControl') {
    renderPerformanceTabList();
  }

  // [TABS-W2] Gap 1.5 — persistent site-permission icons in the omnibox;
  // refresh when the active tab changes.
  if (activeChanged) {
    refreshSitePermIcons();
  }
}

// Tab Strip Container Drag Drop (empty gap / right edge fallback) & Scroll Controls
function handleTabStripDragHover(e) {
  if (!hasDraggedTab(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
}

function handleTabStripDrop(e) {
  if (e.defaultPrevented) return;
  const sourceId = getDraggedTabId(e);
  if (!sourceId) return;
  e.preventDefault();
  e.stopPropagation();
  didDropTab = true;
  suppressTabClickUntil = Date.now() + 300;
  draggedTabId = null;
  pendingStateDuringDrag = null;
  setTabDraggingState(false);
  clearTabDropIndicators();

  const items = Array.from(tabsContainer.children).filter(
    (el) => el.classList.contains('nx-tab') || el.classList.contains('nx-group-pill')
  );
  const targetEl = items.find((el) => {
    const r = el.getBoundingClientRect();
    return e.clientX <= r.left + r.width / 2;
  });
  userScrolledTabStrip = false;
  if (targetEl) {
    if (targetEl.classList.contains('nx-group-pill') && targetEl.dataset.groupId) {
      window.gxAPI.reorderTab({
        tabId: sourceId,
        targetGroupId: targetEl.dataset.groupId,
        position: 'before',
        ungroup: true
      });
    } else if (targetEl.dataset.tabId && targetEl.dataset.tabId !== sourceId) {
      const sourceTab = currentState.tabs.find((t) => t.id === sourceId);
      window.gxAPI.reorderTab({
        tabId: sourceId,
        targetTabId: targetEl.dataset.tabId,
        position: 'before',
        ungroup: !sourceTab?.groupId
      });
    }
  } else {
    window.gxAPI.reorderTab({ tabId: sourceId, toEnd: true, ungroup: true });
  }
}

tabsContainer.addEventListener('dragenter', handleTabStripDragHover);
tabsContainer.addEventListener('dragover', handleTabStripDragHover);
tabsContainer.addEventListener('drop', handleTabStripDrop);

// Market audit bug #13: a tab favicon img has an inline onerror that hides
// it with no fallback, so a pinned tab (icon-only, 36 px) whose favicon 404s
// becomes an empty rectangle. Error events do not bubble, so listen in the
// capture phase and swap the dead img for the same globe SVG used when no
// favicon URL is present at all.
document.addEventListener(
  'error',
  (e) => {
    const t = e.target;
    if (!t || !t.classList || !t.classList.contains('tab-favicon')) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'tab-favicon tab-favicon-fallback');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.innerHTML =
      '<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18"></path><path d="M12 3a15.3 15.3 0 0 1 0 18a15.3 15.3 0 0 1 0-18z"></path>';
    t.replaceWith(svg);
  },
  true
);

if (tabsStrip) {
  tabsStrip.addEventListener('dragenter', handleTabStripDragHover);
  tabsStrip.addEventListener('dragover', handleTabStripDragHover);
  tabsStrip.addEventListener('drop', handleTabStripDrop);
}

if (btnNewTab) {
  const handleNewTabDragHover = (e) => {
    if (!hasDraggedTab(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    clearTabDropIndicators();
    btnNewTab.classList.add('drop-target');
    const stripItems = Array.from(tabsContainer.children).filter(
      (el) => el.classList.contains('nx-tab') || el.classList.contains('nx-group-pill')
    );
    const lastEl = stripItems[stripItems.length - 1];
    if (lastEl && lastEl.dataset.tabId !== draggedTabId) {
      const sourceTab = currentState.tabs.find((t) => t.id === draggedTabId);
      const lastTab = lastEl.dataset.tabId
        ? currentState.tabs.find((t) => t.id === lastEl.dataset.tabId)
        : null;
      if (!sourceTab || !lastTab || Boolean(sourceTab.pinned) === Boolean(lastTab.pinned)) {
        lastEl.classList.add('drop-after');
      }
    }
  };
  btnNewTab.addEventListener('dragenter', handleNewTabDragHover);
  btnNewTab.addEventListener('dragover', handleNewTabDragHover);
  btnNewTab.addEventListener('dragleave', (e) => {
    if (e.relatedTarget && btnNewTab.contains(e.relatedTarget)) return;
    clearTabDropIndicators();
  });
  btnNewTab.addEventListener('drop', (e) => {
    const sourceId = getDraggedTabId(e);
    if (!sourceId) return;
    e.preventDefault();
    e.stopPropagation();

    didDropTab = true;
    suppressTabClickUntil = Date.now() + 300;
    draggedTabId = null;
    pendingStateDuringDrag = null;
    setTabDraggingState(false);
    clearTabDropIndicators();

    userScrolledTabStrip = false;
    window.gxAPI.reorderTab({ tabId: sourceId, toEnd: true, ungroup: true });
  });
}

tabsContainer.addEventListener('scroll', () => {
  updateTabScrollButtons();
});

tabsContainer.addEventListener(
  'wheel',
  (e) => {
    if (tabsContainer.scrollWidth <= tabsContainer.clientWidth + 1) return;
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (delta !== 0) {
      e.preventDefault();
      userScrolledTabStrip = true;
      tabsContainer.scrollLeft += delta;
      updateTabScrollButtons();
    }
  },
  { passive: false }
);

if (btnTabsScrollLeft) {
  btnTabsScrollLeft.addEventListener('click', () => {
    userScrolledTabStrip = true;
    const step = Math.max(160, Math.round(tabsContainer.clientWidth * 0.55));
    tabsContainer.scrollBy({ left: -step, behavior: 'smooth' });
    setTimeout(updateTabScrollButtons, 200);
  });
}

if (btnTabsScrollRight) {
  btnTabsScrollRight.addEventListener('click', () => {
    userScrolledTabStrip = true;
    const step = Math.max(160, Math.round(tabsContainer.clientWidth * 0.55));
    tabsContainer.scrollBy({ left: step, behavior: 'smooth' });
    setTimeout(updateTabScrollButtons, 200);
  });
}

// [TABS-W2] Gap 1.5 — clicking the permission chip opens the site-info
// panel, where the permission can be answered/changed.
const permChip = document.getElementById('permChip');
if (permChip) {
  permChip.addEventListener('click', () => {
    btnSiteSecurity.click();
  });
}

// [TABS-W2] Gap 8.1 — tab search chevron opens the popover (main toggles
// it closed when it is already open).
const btnTabSearch = document.getElementById('btnTabSearch');
if (btnTabSearch) {
  btnTabSearch.addEventListener('click', () => {
    window.gxSounds?.playClick();
    openTabSearchPopover();
  });
}

function updateTopContourWidth() {
  if (IS_DRAWER_OVERLAY) return;
  const anchor = btnNewTab || document.getElementById('tabsContour');
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  if (rect && rect.right > 0) {
    const winControls = document.querySelector('.nx-window-controls');
    const maxW = winControls ? Math.max(180, Math.round(winControls.getBoundingClientRect().left - 12)) : Math.max(180, (window.innerWidth || 1280) - 160);
    const targetW = Math.min(maxW, Math.max(180, Math.round(rect.right + 14)));
    document.documentElement.style.setProperty('--nx-top-glow-w', `${targetW}px`);
  }
}

if (!IS_DRAWER_OVERLAY && typeof ResizeObserver === 'function') {
  const contourEl = document.getElementById('tabsContour');
  if (contourEl) {
    const ro = new ResizeObserver(() => updateTopContourWidth());
    ro.observe(contourEl);
  }
}

window.addEventListener('resize', () => {
  updateTabScrollButtons();
  updateTopContourWidth();
  if (sidebarPanelState.open) {
    applySidebarPanelDOMState();
  }
  updateSplitDividerLayout();
  if (!userScrolledTabStrip) {
    const activeEl = tabsContainer.querySelector('.nx-tab.active');
    if (activeEl) {
      scrollActiveTabIntoView(activeEl);
      updateTabScrollButtons();
    }
  }
});

window.addEventListener('mousedown', (e) => {
  if (tabContextMenuOpen) {
    if (
      e.button === 2 &&
      e.target &&
      e.target.closest &&
      e.target.closest('.nx-tab, .nx-group-pill, .ws-pill')
    ) {
      return;
    }
    if (e.button === 0 && e.target && e.target.closest && e.target.closest('#btnAddWorkspace')) {
      return;
    }
    tabContextMenuOpen = false;
    activeTabContextMode = null;
    window.gxAPI.closePopover();
  }
  if (openBookmarkFolderName) {
    if (e.target && e.target.closest && e.target.closest('.bm-bar-folder')) {
      return;
    }
    openBookmarkFolderName = null;
    updateBookmarkFolderButtonsState();
    window.gxAPI.closePopover();
  }
  if (sidebarPanelState.open && !sidebarPanelState.pinned) {
    const clickedSidebar = Boolean(e.target && e.target.closest && e.target.closest('.nx-sidebar, #sidebarPanel'));
    if (!clickedSidebar) {
      window.gxAPI.closeSidebarPanel({ restoreFocus: false });
    }
  }
});

// Top Bar Events
if (btnGxCornerTab) {
  btnGxCornerTab.addEventListener('click', () => {
    window.gxSounds?.playTabOpen();
    window.gxAPI.closePopover();
    window.gxAPI.openGxCorner();
  });
}

document.getElementById('btnNewTab').addEventListener('click', () => {
  window.gxSounds?.playTabOpen();
  window.gxAPI.createTab({ url: 'nextgx://newtab', active: true });
});

const btnBrandHome = document.getElementById('btnBrandHome');
if (btnBrandHome) {
  btnBrandHome.addEventListener('click', () => {
    window.gxSounds?.playClick();
    window.gxAPI.goHome();
  });
}

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
  const picked =
    omniboxSuggestSelectedIdx >= 0 && omniboxSuggestItems[omniboxSuggestSelectedIdx]
      ? omniboxSuggestItems[omniboxSuggestSelectedIdx].url
      : '';
  const val = (picked || addressInput.value).trim();
  const activeId = currentState.activeTab?.id;
  if (activeId) addressDraftByTabId.delete(activeId);
  hideOmniboxSuggestions();
  if (val) {
    window.gxAPI.navigate(val);
    addressInput.blur();
  }
});

// [Fix2 integration] Panic button (toolbar): hides all tabs instantly,
// press again (or Ctrl+Shift+P) to restore. The button reflects state.
const btnPanic = document.getElementById('btnPanic');
async function refreshPanicButton() {
  if (!btnPanic || !window.gxAPI.getPanicState) return;
  try {
    const st = await window.gxAPI.getPanicState();
    const active = Boolean(st && st.active);
    btnPanic.classList.toggle('active', active);
    btnPanic.setAttribute('aria-pressed', active ? 'true' : 'false');
    btnPanic.title = active
      ? 'Panic active — click to restore your tabs (Ctrl+Shift+P)'
      : 'Panic button — instantly hide all tabs (Ctrl+Shift+P), press again to restore';
  } catch (_) {
    /* panic state unavailable — button still toggles */
  }
}
if (btnPanic) {
  btnPanic.addEventListener('click', async () => {
    window.gxSounds?.playClick();
    if (window.gxAPI.togglePanic) await window.gxAPI.togglePanic();
    refreshPanicButton();
  });
  refreshPanicButton();
}

// [Fix2 integration] Keyboard sounds: a subtle synth click on character
// key presses while the setting is on (throttled so fast typing does not
// stack sounds). Background music has no audio files in the repo — its
// toggle is a real setting, reported honestly in Settings.
let lastKeySoundAt = 0;
document.addEventListener('keydown', (e) => {
  if (!settingsState || !settingsState.keyboardSoundsEnabled) return;
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (typeof e.key !== 'string' || e.key.length !== 1) return;
  const now = Date.now();
  if (now - lastKeySoundAt < 60) return;
  lastKeySoundAt = now;
  window.gxSounds?.playKeyTick ? window.gxSounds.playKeyTick() : window.gxSounds?.playClick();
});

addressInput.addEventListener('focus', () => {
  if (suppressAddressFocusSelect) return;
  const activeId = currentState.activeTab?.id;
  const hasDraft = activeId && addressDraftByTabId.has(activeId);
  if (!hasDraft) {
    // [URLBAR-3.1/3.2] Focus reveals the FULL URL (including scheme) and selects it.
    const full = getActiveTabFullUrl();
    if (full && addressInput.value !== full) addressInput.value = full;
  }
  selectAllOnMouseUp = true;
  addressInput.select();
});

addressInput.addEventListener('mouseup', (e) => {
  if (selectAllOnMouseUp) {
    selectAllOnMouseUp = false;
    if (addressInput.selectionStart === addressInput.selectionEnd) {
      e.preventDefault();
      addressInput.select();
    }
  }
});

addressInput.addEventListener('blur', () => {
  selectAllOnMouseUp = false;
  clearTimeout(omniboxSuggestTimer);
  omniboxSuggestTimer = null;
  const activeId = currentState.activeTab?.id;
  const hasDraft = activeId && addressDraftByTabId.has(activeId);
  if (!hasDraft) {
    // [URLBAR-3.1] Back to the elided display value once focus leaves the omnibox.
    const full = getActiveTabFullUrl();
    addressInput.value = full ? elideUrlForDisplay(full) : '';
  }
  // mousedown on a suggestion row fires before blur and navigates; closing
  // with kind='omnibox-suggest' guarantees we never clobber a newly opened toolbar menu.
  setTimeout(() => {
    if (document.activeElement !== addressInput) {
      hideOmniboxSuggestions();
    }
  }, 150);
});

addressInput.addEventListener('mousedown', (e) => {
  if (e.button === 2) {
    window.gxAPI.setChromeContextTarget?.('address-bar');
    if (document.activeElement !== addressInput) {
      addressInput.focus();
      addressInput.select();
    }
  }
});

// [TABS-W2] Gap 3.7 — Opera GX expanded suggestions while typing in the omnibox.
addressInput.addEventListener('input', (e) => {
  if (e && e.isComposing) return;
  lastOmniboxInputWasDelete = Boolean(e && typeof e.inputType === 'string' && e.inputType.startsWith('delete'));
  const activeId = currentState.activeTab?.id;
  if (activeId) {
    addressDraftByTabId.set(activeId, addressInput.value);
  }
  clearTimeout(omniboxSuggestTimer);
  omniboxSuggestTimer = setTimeout(() => {
    renderOmniboxSuggestions();
  }, 90);
});
addressInput.addEventListener('keydown', (e) => {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Escape') {
    if (omniboxSuggestLastUrls) {
      e.preventDefault();
      hideOmniboxSuggestions();
      return;
    }
    const activeId = currentState.activeTab?.id;
    if (activeId) addressDraftByTabId.delete(activeId);
    const full = getActiveTabFullUrl();
    addressInput.value = full || '';
    addressInput.select();
    return;
  }
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && omniboxSuggestItems.length > 0) {
    e.preventDefault();
    const len = omniboxSuggestItems.length;
    if (e.key === 'ArrowDown') {
      omniboxSuggestSelectedIdx = (omniboxSuggestSelectedIdx + 1) % len;
    } else {
      omniboxSuggestSelectedIdx = omniboxSuggestSelectedIdx <= 0 ? len - 1 : omniboxSuggestSelectedIdx - 1;
    }
    const sel = omniboxSuggestItems[omniboxSuggestSelectedIdx];
    if (sel && sel.url) {
      addressInput.value = sel.url;
      const activeId = currentState.activeTab?.id;
      if (activeId) addressDraftByTabId.set(activeId, sel.url);
    }
    pushOmniboxSuggestPopover(omniboxSuggestItems, omniboxSuggestSelectedIdx);
    return;
  }
  if (e.key === 'Tab' && settingsState?.searchShortcutMode === 'tab') {
    const val = addressInput.value;
    if (val && !/\s/.test(val)) {
      e.preventDefault();
      addressInput.value = val + '\t';
    }
  }
});

// [FIXUP-1] Site-info bubble + zoom bubble (Chrome parity gaps 3.3/3.4/3.5):
// the content now lives in the popover system (popover.html kinds
// 'site-info' / 'zoom-bubble') because the tab's WebContentsView occludes
// any renderer-side fixed panel below the top chrome. The renderer only
// opens the popover anchored under the lock icon / magnifier; the popover
// itself renders the contents and wires the controls. Clicking the anchor
// again toggles it closed (openPopover closes a same-kind popover).
// siteInfoPopoverUrl / zoomPopoverUrl remember which URL the bubble was
// opened for, so a navigation away closes it (same as the old panels);
// clicking into the page or pressing Escape is handled by the main process
// (tab focus / shortcut closePopover).
// SITE_INFO_PERMS is also used by refreshSitePermIcons (omnibox site icons).
const SITE_INFO_PERMS = [
  { key: 'camera', label: 'Camera' },
  { key: 'microphone', label: 'Microphone' },
  { key: 'geolocation', label: 'Location' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'clipboard-read', label: 'Clipboard' },
  { key: 'screen-share', label: 'Screen sharing' }
];
let siteInfoPopoverUrl = '';
let zoomPopoverUrl = '';

btnSiteSecurity.addEventListener('click', () => {
  window.gxSounds?.playClick();
  const active = currentState.activeTab || {};
  const url = active.url || '';
  if (!url || url === 'nextgx://newtab') {
    showToast('No site to inspect on this page');
    return;
  }
  const rect = btnSiteSecurity.getBoundingClientRect();
  siteInfoPopoverUrl = url;
  zoomPopoverUrl = '';
  Promise.resolve(
    window.gxAPI.openPopover({
      kind: 'site-info',
      x: Math.round(rect.left),
      y: TOP_CHROME_HEIGHT + 2,
      width: 320,
      height: 424,
      payload: {
        origin: active.origin || '',
        url,
        securityState: active.securityState || (active.isHttpInsecure ? 'insecure' : active.isSecure ? 'secure' : 'neutral'),
        hasCertBypass: Boolean(active.hasCertBypass)
      }
    })
  ).then((opened) => {
    // Toggled closed by the same click.
    if (!opened) siteInfoPopoverUrl = '';
  });
});

btnZoomIndicator?.addEventListener('click', () => {
  window.gxSounds?.playClick();
  const rect = btnZoomIndicator.getBoundingClientRect();
  zoomPopoverUrl = currentState.activeTab?.url || '';
  siteInfoPopoverUrl = '';
  Promise.resolve(
    window.gxAPI.openPopover({
      kind: 'zoom-bubble',
      x: Math.round(rect.left),
      y: TOP_CHROME_HEIGHT + 2,
      width: 320,
      height: 100,
      payload: { zoomPercent: currentState.activeTab?.zoomPercent || 100 }
    })
  ).then((opened) => {
    // Toggled closed by the same click.
    if (!opened) zoomPopoverUrl = '';
  });
});

// [URLBAR-9.2] Per-site zoom: restore the stored zoom when the active tab lands
// on a known origin, and remember zoom changes (including Ctrl++/Ctrl+- / Ctrl+0
// shortcuts, which bypass the 'tabs:zoom' IPC and are persisted here instead).
let lastZoomSiteKey = '';
let lastZoomSitePercent = 0;
let zoomApplyInFlight = false;
let zoomSaveTimer = null;

function syncPerSiteZoom(state, active) {
  if (!active || !active.url) return;
  const origin = active.origin || '';
  if (!origin || !(active.url.startsWith('http://') || active.url.startsWith('https://'))) return;
  const percent = active.zoomPercent || 100;
  const key = `${state.activeTabId}|${origin}`;
  if (key !== lastZoomSiteKey) {
    lastZoomSiteKey = key;
    lastZoomSitePercent = percent;
    if (window.gxAPI.getSiteZoom) {
      zoomApplyInFlight = true;
      window.gxAPI
        .getSiteZoom(origin)
        .then((stored) => {
          const factor = Number(stored);
          if (Number.isFinite(factor) && factor > 0 && Math.round(factor * 100) !== percent) {
            window.gxAPI.setZoom(factor);
          }
        })
        .catch(() => { })
        .finally(() => {
          zoomApplyInFlight = false;
        });
    }
    return;
  }
  if (percent !== lastZoomSitePercent && !zoomApplyInFlight) {
    lastZoomSitePercent = percent;
    clearTimeout(zoomSaveTimer);
    zoomSaveTimer = setTimeout(() => {
      window.gxAPI.saveSiteZoom?.(origin, percent / 100);
    }, 400);
  }
}

// [TABS-W2] Gap 7.4 — star opens the bookmark bubble (Name / Folder /
// Remove / Done) instead of toggling directly.
btnBookmarkStar.addEventListener('click', async () => {
  window.gxSounds?.playClick();
  openBookmarkBubble();
});

// [TABS-W2] Gap 9.6 — reader button now uses the real extraction channel
// (toggleReaderModeExtract) instead of the old CSS-only toggleReaderMode.
btnReaderMode.addEventListener('click', async () => {
  window.gxSounds?.playClick();
  const res = await window.gxAPI.toggleReaderModeExtract();
  if (res && res.ok) {
    showToast(res.active ? 'Reader View Enabled' : 'Reader View Off');
  } else if (res && res.error) {
    showToast(res.error);
  }
});

if (btnPopOutVideo) {
  btnPopOutVideo.addEventListener('click', async () => {
    if (btnPopOutVideo.disabled) return;
    window.gxSounds?.playClick();
    await window.gxAPI.popOutVideo();
  });
}

// Split View Toolbar Toggle & Resizable DOM Divider (rendered inside the 6px layout gap)
let isResizingSplit = false;
let splitDragRatio = SPLIT_DEFAULT_RATIO;
let activeSplitPointerId = null;

function clampSplitRatio(raw) {
  const num = Number(raw);
  if (!Number.isFinite(num)) return SPLIT_DEFAULT_RATIO;
  const clamped = Math.max(SPLIT_MIN_RATIO, Math.min(SPLIT_MAX_RATIO, num));
  return Math.round(clamped * 10000) / 10000;
}

function updateSplitToolbarButton(splitState = currentState.split) {
  if (!btnSplitView) return;
  const isVisible = Boolean(splitState && splitState.visible);
  btnSplitView.classList.toggle('active', isVisible);
  btnSplitView.classList.toggle('split-active', isVisible);
  btnSplitView.setAttribute('aria-pressed', isVisible ? 'true' : 'false');
  btnSplitView.title = isVisible
    ? 'Exit Split View (restore both tabs)'
    : 'Split View — Open current tab side by side with a new tab';
}

function positionSplitDividerForRatio(ratio) {
  if (!splitDivider || !viewportPlaceholder) return;
  const vpRect = viewportPlaceholder.getBoundingClientRect();
  const contentW = Math.max(120, Math.round(vpRect.width));
  const availW = Math.max(2, contentW - SPLIT_DIVIDER_WIDTH);
  const minPaneW = Math.min(80, Math.floor(availW / 2));
  const safeRatio = clampSplitRatio(ratio);
  const leftW = Math.max(minPaneW, Math.min(availW - minPaneW, Math.round(availW * safeRatio)));
  splitDivider.style.left = `${leftW}px`;
  splitDivider.style.width = `${SPLIT_DIVIDER_WIDTH}px`;
  splitDivider.setAttribute('aria-valuenow', String(Math.round(safeRatio * 100)));
}

function updateSplitDividerLayout(splitState = currentState.split) {
  if (!splitDivider) return;
  const isVisible = Boolean(splitState && splitState.visible);
  if (!isVisible) {
    if (isResizingSplit) {
      endSplitResize({ commit: false });
    }
    splitDivider.classList.add('hidden');
    splitDivider.removeAttribute('data-focused-pane');
    return;
  }
  splitDivider.classList.remove('hidden');
  splitDivider.dataset.focusedPane = splitState.focusedPane === 'right' ? 'right' : 'left';
  const ratio = isResizingSplit ? splitDragRatio : clampSplitRatio(splitState.ratio);
  positionSplitDividerForRatio(ratio);
}

function computeSplitRatioFromClientX(clientX) {
  if (!viewportPlaceholder || typeof clientX !== 'number') {
    return clampSplitRatio(currentState.split?.ratio);
  }
  const vpRect = viewportPlaceholder.getBoundingClientRect();
  const availW = Math.max(2, vpRect.width - SPLIT_DIVIDER_WIDTH);
  const rawLeft = clientX - vpRect.left - SPLIT_DIVIDER_WIDTH / 2;
  return clampSplitRatio(rawLeft / availW);
}

function beginSplitResize(clientX, pointerId = null) {
  if (isResizingSplit || !currentState.split?.visible) return;
  isResizingSplit = true;
  splitDragRatio = clampSplitRatio(currentState.split.ratio);
  activeSplitPointerId = pointerId;
  splitDivider?.classList.add('dragging');
  if (pointerId !== null && splitDivider?.setPointerCapture) {
    try {
      splitDivider.setPointerCapture(pointerId);
    } catch (_) { }
  }
  if (typeof clientX === 'number') {
    updateSplitResize(clientX);
  }
}

function updateSplitResize(clientX) {
  if (!isResizingSplit || typeof clientX !== 'number') return;
  const nextRatio = computeSplitRatioFromClientX(clientX);
  if (Math.abs(nextRatio - splitDragRatio) >= 0.001) {
    splitDragRatio = nextRatio;
    positionSplitDividerForRatio(nextRatio);
    window.gxAPI.setSplitRatio(nextRatio, { persist: false });
  }
}

function endSplitResize({ commit = true } = {}) {
  if (!isResizingSplit) return;
  isResizingSplit = false;
  splitDivider?.classList.remove('dragging');
  if (activeSplitPointerId !== null && splitDivider?.releasePointerCapture) {
    try {
      splitDivider.releasePointerCapture(activeSplitPointerId);
    } catch (_) { }
  }
  activeSplitPointerId = null;
  if (commit && currentState.split?.visible) {
    const finalRatio = clampSplitRatio(splitDragRatio);
    positionSplitDividerForRatio(finalRatio);
    window.gxAPI.setSplitRatio(finalRatio, { persist: true });
  }
}

if (btnSplitView) {
  btnSplitView.addEventListener('click', () => {
    window.gxSounds?.playClick();
    window.gxAPI.closePopover();
    window.gxAPI.toggleSplit();
  });
}

if (splitDivider) {
  splitDivider.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    window.gxAPI.closePopover();
    beginSplitResize(e.clientX, e.pointerId);
  });
  splitDivider.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || isResizingSplit) return;
    e.preventDefault();
    window.gxAPI.closePopover();
    beginSplitResize(e.clientX, null);
  });
  splitDivider.addEventListener('dblclick', (e) => {
    e.preventDefault();
    if (!currentState.split?.visible) return;
    window.gxSounds?.playClick();
    splitDragRatio = SPLIT_DEFAULT_RATIO;
    positionSplitDividerForRatio(SPLIT_DEFAULT_RATIO);
    window.gxAPI.setSplitRatio(SPLIT_DEFAULT_RATIO, { persist: true });
  });
  splitDivider.addEventListener('keydown', (e) => {
    if (!currentState.split?.visible) return;
    const cur = clampSplitRatio(currentState.split.ratio);
    let next = null;
    if (e.key === 'ArrowLeft') next = clampSplitRatio(cur - 0.05);
    else if (e.key === 'ArrowRight') next = clampSplitRatio(cur + 0.05);
    else if (e.key === 'Home' || e.key === '0') next = SPLIT_DEFAULT_RATIO;
    if (next !== null) {
      e.preventDefault();
      splitDragRatio = next;
      positionSplitDividerForRatio(next);
      window.gxAPI.setSplitRatio(next, { persist: true });
    }
  });
}

window.addEventListener('pointermove', (e) => {
  if (!isResizingSplit) return;
  updateSplitResize(e.clientX);
});

window.addEventListener('mousemove', (e) => {
  if (!isResizingSplit) return;
  updateSplitResize(e.clientX);
});

window.addEventListener('pointerup', () => {
  if (isResizingSplit) endSplitResize({ commit: true });
});

window.addEventListener('pointercancel', () => {
  if (isResizingSplit) endSplitResize({ commit: true });
});

window.addEventListener('mouseup', () => {
  if (isResizingSplit) endSplitResize({ commit: true });
});

document.getElementById('btnScreenshot').addEventListener('click', () => {
  window.gxSounds?.playClick();
  window.gxAPI.closePopover();
  window.gxAPI.startAreaScreenshot();
});

document.getElementById('btnTopDownloads').addEventListener('click', () => {
  window.gxSounds?.playClick();
  const rect = document.getElementById('btnTopDownloads').getBoundingClientRect();
  window.gxAPI.openPopover({
    kind: 'downloads',
    x: rect.right - 316,
    y: TOP_CHROME_HEIGHT + 2,
    width: 316,
    height: 220
  });
});

let cachedProfileState = null;

function renderProfileAvatar(data) {
  if (!data || !btnProfileMenu) return;
  cachedProfileState = data;
  const displayProfile = data.windowProfile || data.profile || data.activeProfile || null;
  const activeProfile = data.activeProfile || data.profile || displayProfile;
  const letter = (displayProfile?.avatar || displayProfile?.name?.charAt(0) || 'D').toUpperCase();
  const color = displayProfile?.color || 'gx-violet';
  btnProfileMenu.dataset.profileColor = color;
  if (profileAvatarLetter) {
    profileAvatarLetter.textContent = letter;
  }
  const winName = displayProfile?.name || 'Default';
  const activeName = activeProfile?.name || winName;
  btnProfileMenu.title =
    displayProfile && activeProfile && displayProfile.id !== activeProfile.id
      ? `Profile: ${winName} (New windows open in ${activeName})`
      : `Profile: ${winName} — Click to switch or manage profiles`;
}

if (btnProfileMenu) {
  btnProfileMenu.addEventListener('click', async () => {
    window.gxSounds?.playClick();
    const rect = btnProfileMenu.getBoundingClientRect();
    let payload = cachedProfileState;
    try {
      if (window.gxAPI.listProfiles) {
        payload = await window.gxAPI.listProfiles();
        renderProfileAvatar(payload);
      }
    } catch (_) { }
    window.gxAPI.openPopover({
      kind: 'profiles',
      x: Math.round(rect.right - 304),
      y: TOP_CHROME_HEIGHT + 2,
      width: 304,
      height: 240,
      payload: payload || {}
    });
  });
}


// ================================================================
// UX PHASE — ONE shared "New Profile" modal (Chrome-style)
// Opened from the toolbar avatar menu, Settings, and the profile
// popover via gxAPI.openCreateProfileModal(). Creating a profile
// here switches to it (when the checkbox is on) instead of showing
// a "Click Switch" banner.
// ================================================================
const PROFILE_MODAL_COLORS = [
  { id: 'gx-violet', label: 'Violet' },
  { id: 'crimson', label: 'Crimson' },
  { id: 'cyan', label: 'Cyan' },
  { id: 'emerald', label: 'Emerald' },
  { id: 'magenta', label: 'Magenta' },
  { id: 'amber', label: 'Amber' },
  { id: 'lime', label: 'Lime' },
  { id: 'ice', label: 'Ice' }
];
// Avatar is a single alphanumeric letter (storage.deriveProfileAvatar
// keeps the first alphanumeric character); '' means "initial from name".
const PROFILE_MODAL_AVATARS = [
  { id: '', label: 'Auto — initial from name', letter: 'Aa' },
  { id: 'A', label: 'A' },
  { id: 'G', label: 'G' },
  { id: 'M', label: 'M' },
  { id: 'P', label: 'P' },
  { id: 'S', label: 'S' },
  { id: 'W', label: 'W' }
];

const profileModalBackdrop = document.getElementById('profileModalBackdrop');
const profileModalEl = document.getElementById('profileModal');
const profileModalForm = document.getElementById('profileModalForm');
const profileModalName = document.getElementById('profileModalName');
const profileModalAvatar = document.getElementById('profileModalAvatar');
const profileModalPreviewName = document.getElementById('profileModalPreviewName');
const profileModalError = document.getElementById('profileModalError');
const profileModalCount = document.getElementById('profileModalCount');
const profileModalSwatches = document.getElementById('profileModalSwatches');
const profileModalAvatars = document.getElementById('profileModalAvatars');
const profileModalSwitchAfter = document.getElementById('profileModalSwitchAfter');
const profileModalCreateBtn = document.getElementById('btnProfileModalCreate');

let profileModalOpen = false;
let profileModalColor = 'gx-violet';
let profileModalAvatarChoice = '';
let profileModalLastFocus = null;

function profileModalAvatarLetter() {
  if (profileModalAvatarChoice) return profileModalAvatarChoice.toUpperCase();
  const name = profileModalName ? profileModalName.value.trim() : '';
  const m = name.match(/[A-Za-z0-9]/);
  return m ? m[0].toUpperCase() : 'P';
}

function renderProfileModalPreview() {
  if (!profileModalEl) return;
  const name = profileModalName ? profileModalName.value.trim().replace(/\s+/g, ' ') : '';
  if (profileModalAvatar) {
    profileModalAvatar.textContent = profileModalAvatarLetter();
    profileModalAvatar.dataset.profileColor = profileModalColor;
  }
  if (profileModalPreviewName) {
    profileModalPreviewName.textContent = name || 'Your profile';
  }
  if (profileModalCount) {
    profileModalCount.textContent = `${profileModalName ? profileModalName.value.length : 0} / 40`;
  }
  if (profileModalCreateBtn) {
    const switchAfter = profileModalSwitchAfter ? profileModalSwitchAfter.checked : true;
    profileModalCreateBtn.textContent = switchAfter ? 'Create & Switch' : 'Create Profile';
  }
}

function buildProfileModalPickers() {
  if (profileModalSwatches && !profileModalSwatches.children.length) {
    for (const c of PROFILE_MODAL_COLORS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nx-profile-swatch';
      b.dataset.profileColor = c.id;
      b.title = c.label;
      b.setAttribute('aria-label', c.label);
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => {
        profileModalColor = c.id;
        profileModalSwatches.querySelectorAll('.nx-profile-swatch').forEach((x) => {
          x.classList.toggle('active', x.dataset.profileColor === c.id);
          x.setAttribute('aria-checked', x.dataset.profileColor === c.id ? 'true' : 'false');
        });
        renderProfileModalPreview();
      });
      profileModalSwatches.appendChild(b);
    }
  }
  if (profileModalAvatars && !profileModalAvatars.children.length) {
    for (const a of PROFILE_MODAL_AVATARS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nx-profile-avatar-opt';
      b.textContent = a.id === '' ? 'Aa' : a.id;
      b.title = a.label;
      b.setAttribute('aria-label', a.label);
      b.setAttribute('role', 'radio');
      b.dataset.avatar = a.id;
      b.addEventListener('click', () => {
        profileModalAvatarChoice = a.id;
        profileModalAvatars.querySelectorAll('.nx-profile-avatar-opt').forEach((x) => {
          x.classList.toggle('active', x.dataset.avatar === a.id);
          x.setAttribute('aria-checked', x.dataset.avatar === a.id ? 'true' : 'false');
        });
        renderProfileModalPreview();
      });
      profileModalAvatars.appendChild(b);
    }
  }
  if (profileModalSwatches) {
    profileModalSwatches.querySelectorAll('.nx-profile-swatch').forEach((x) => {
      x.classList.toggle('active', x.dataset.profileColor === profileModalColor);
      x.setAttribute('aria-checked', x.dataset.profileColor === profileModalColor ? 'true' : 'false');
    });
  }
  if (profileModalAvatars) {
    profileModalAvatars.querySelectorAll('.nx-profile-avatar-opt').forEach((x) => {
      x.classList.toggle('active', x.dataset.avatar === profileModalAvatarChoice);
      x.setAttribute('aria-checked', x.dataset.avatar === profileModalAvatarChoice ? 'true' : 'false');
    });
  }
}

function openProfileModal() {
  if (!profileModalBackdrop || profileModalOpen) return;
  buildProfileModalPickers();
  // Default colour: first colour no existing profile uses yet.
  try {
    const used = new Set((cachedProfileState?.profiles || []).map((pr) => pr.color));
    profileModalColor =
      PROFILE_MODAL_COLORS.find((c) => !used.has(c.id))?.id || 'gx-violet';
  } catch (_) {
    profileModalColor = 'gx-violet';
  }
  profileModalAvatarChoice = '';
  if (profileModalName) profileModalName.value = '';
  if (profileModalSwitchAfter) profileModalSwitchAfter.checked = true;
  if (profileModalError) profileModalError.classList.add('hidden');
  if (profileModalName) profileModalName.classList.remove('is-invalid');
  buildProfileModalPickers();
  renderProfileModalPreview();
  profileModalLastFocus = document.activeElement;
  profileModalOpen = true;
  // The modal can be opened from the profiles popover — close it first so
  // its view cannot sit above the modal or stay hidden-but-open afterwards.
  try {
    window.gxAPI?.closePopover?.();
  } catch (_) { }
  profileModalBackdrop.classList.remove('hidden');
  // Market audit bug #2: the shell DOM sits UNDER every WebContentsView, so
  // ask main to hide the content views while the modal is open — otherwise
  // the modal is invisible and focus stays trapped in the webview.
  try {
    window.gxAPI?.setShellModalOpen?.(true);
  } catch (_) { }
  if (profileModalName) profileModalName.focus();
  // Fix2-shell A1: if the name input did not take focus (e.g. the hidden
  // webview kept it), keyboard events never reach the shell and Escape
  // cannot dismiss the modal — fall back to the modal element itself.
  if (document.activeElement !== profileModalName && profileModalEl) {
    profileModalEl.focus();
    if (profileModalName) profileModalName.focus();
  }
}

function closeProfileModal() {
  if (!profileModalBackdrop || !profileModalOpen) return;
  profileModalOpen = false;
  profileModalBackdrop.classList.add('hidden');
  try {
    window.gxAPI?.setShellModalOpen?.(false);
  } catch (_) { }
  if (profileModalLastFocus && typeof profileModalLastFocus.focus === 'function') {
    try { profileModalLastFocus.focus(); } catch (_) { }
  }
}

if (profileModalBackdrop) {
  profileModalBackdrop.addEventListener('click', (e) => {
    if (e.target === profileModalBackdrop) closeProfileModal();
    // Fix2-shell A1: the × button must dismiss the modal even if its own
    // direct listener never fires (audit: × did nothing). Delegated here so
    // any click landing on the button — or its text node — closes it.
    else if (e.target && e.target.closest && e.target.closest('#btnProfileModalClose')) {
      closeProfileModal();
    }
  });
  profileModalBackdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeProfileModal();
      return;
    }
    // Focus trap: Tab cycles inside the modal.
    if (e.key === 'Tab') {
      const focusable = Array.from(
        profileModalEl.querySelectorAll('button, input, [tabindex]')
      ).filter((el) => !el.disabled && el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
}

// Fix2-shell A1: Escape must dismiss the profile modal even when focus or
// event routing bypasses the backdrop's own keydown listener (audit: Esc
// did nothing while typing in the name field). Capture phase, so no other
// shell handler can swallow it first; the keyup listener covers the case
// where the keydown never reaches the renderer at all (e.g. it went to a
// hidden webview) and the key is released after focus returns to the shell.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && profileModalOpen) {
    e.preventDefault();
    e.stopPropagation();
    closeProfileModal();
  }
}, true);
document.addEventListener('keyup', (e) => {
  if (e.key === 'Escape' && profileModalOpen) {
    e.preventDefault();
    closeProfileModal();
  }
}, true);

if (profileModalName) {
  profileModalName.addEventListener('input', () => {
    profileModalName.classList.remove('is-invalid');
    if (profileModalError) profileModalError.classList.add('hidden');
    renderProfileModalPreview();
  });
}

if (profileModalSwitchAfter) {
  profileModalSwitchAfter.addEventListener('change', renderProfileModalPreview);
}

document.getElementById('btnProfileModalClose')?.addEventListener('click', closeProfileModal);
document.getElementById('btnProfileModalCancel')?.addEventListener('click', closeProfileModal);

if (profileModalForm) {
  profileModalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = profileModalName ? profileModalName.value.trim().replace(/\s+/g, ' ').slice(0, 40) : '';
    if (!name) {
      if (profileModalError) {
        profileModalError.textContent = 'Please enter a profile name.';
        profileModalError.classList.remove('hidden');
      }
      profileModalName?.classList.add('is-invalid');
      profileModalName?.focus();
      return;
    }
    if (profileModalCreateBtn) {
      profileModalCreateBtn.disabled = true;
      profileModalCreateBtn.textContent = 'Creating…';
    }
    try {
      const res = await window.gxAPI.createProfile({
        name,
        color: profileModalColor,
        avatar: profileModalAvatarChoice || undefined
      });
      if (!res || !res.ok) {
        if (profileModalError) {
          profileModalError.textContent = res?.error || 'Could not create profile.';
          profileModalError.classList.remove('hidden');
        }
        return;
      }
      const createdName = res.profile?.name || name;
      const switchAfter = profileModalSwitchAfter ? profileModalSwitchAfter.checked : true;
      closeProfileModal();
      showToast(`Profile "${createdName}" created`, { sound: false });
      if (switchAfter && res.profile?.id) {
        const sw = await window.gxAPI.switchProfile(res.profile.id);
        if (!sw || !sw.ok) {
          showToast('Profile created, but switching failed', { sound: false });
        }
      }
    } catch (err) {
      if (profileModalError) {
        profileModalError.textContent = 'Could not create profile.';
        profileModalError.classList.remove('hidden');
      }
    } finally {
      if (profileModalCreateBtn) {
        profileModalCreateBtn.disabled = false;
        renderProfileModalPreview();
      }
    }
  });
}

// Opened from Settings / the profile popover, via main (profiles.js).
window.gxAPI.onOpenCreateProfileModal?.(() => openProfileModal());

// Market audit bug #30: the rail context menu (popover view) asks the shell
// to open a left system drawer (e.g. Customize Dock) — relayed via main.
window.gxAPI.onOpenLeftTool?.((tool) => {
  if (typeof openLeftTool === 'function' && tool) openLeftTool(tool);
});

// ================================================================
// UX PHASE — expandable sidebar rail (overlay flyout, labels)
// ================================================================
const nxSidebarEl = document.querySelector('.nx-sidebar');
const btnRailExpand = document.getElementById('btnRailExpand');

function setRailExpanded(expanded, { persist = true } = {}) {
  if (!IS_DRAWER_OVERLAY && window.gxAPI.toggleShellDrawer) {
    if (expanded) window.gxAPI.openShellDrawer({ kind: 'rail' });
    else window.gxAPI.closeShellDrawer();
    return;
  }
  if (!nxSidebarEl) return;
  nxSidebarEl.classList.toggle('expanded', Boolean(expanded));
  railExpandedState = Boolean(expanded);
  if (btnRailExpand) {
    btnRailExpand.setAttribute('aria-pressed', expanded ? 'true' : 'false');
    btnRailExpand.title = expanded ? 'Collapse sidebar — hide labels' : 'Expand sidebar — show labels';
    const label = btnRailExpand.querySelector('.sidebar-label');
    if (label) label.textContent = expanded ? 'Collapse' : 'Expand';
  }
  if (persist) {
    try { localStorage.setItem('nx-rail-expanded', expanded ? '1' : '0'); } catch (_) { }
  }
  // Fix2-shell A2: expanding/collapsing the rail while a drawer or pinned
  // panel is open changes the native offset (see syncLayoutOffsets).
  syncLayoutOffsets();
}

if (btnRailExpand) {
  btnRailExpand.addEventListener('click', () => {
    window.gxSounds?.playClick();
    if (IS_DRAWER_OVERLAY) {
      window.gxAPI.closeShellDrawer?.();
    } else if (window.gxAPI.toggleShellDrawer) {
      window.gxAPI.toggleShellDrawer({ kind: 'rail' });
    } else {
      setRailExpanded(!nxSidebarEl?.classList.contains('expanded'));
    }
  });
}

// Market audit bug #30: right-click on a rail icon opens a context menu
// (Open panel / Hide from rail / Customize Dock). The rail buttons carry
// data-sidebar-item=<key> and data-sidebar-panel or data-service-url.
if (nxSidebarEl) {
  nxSidebarEl.addEventListener('contextmenu', (e) => {
    const btn = e.target && e.target.closest
      ? e.target.closest('[data-sidebar-item]')
      : null;
    if (!btn || !btn.dataset.sidebarItem) return;
    e.preventDefault();
    e.stopPropagation();
    window.gxSounds?.playClick();
    const key = btn.dataset.sidebarItem;
    const label = btn.dataset.label || btn.getAttribute('aria-label') || btn.title || key;
    window.gxAPI.openPopover({
      kind: 'rail-context',
      x: Math.round(e.clientX + 2),
      y: Math.round(e.clientY + 2),
      width: 220,
      height: 172,
      // Fix2-shell (item 9): the menu also offers Pin/Unpin panel. Only
      // items that open a sidebar panel can be pinned (services + Player);
      // left-tool items (GX Control/Cleaner) and tab items cannot.
      payload: {
        key,
        title: label,
        pinned: sidebarPanelState.pinned,
        canPin: Boolean(btn.dataset.sidebarPanel || btn.dataset.serviceUrl)
      }
    });
  });
}

try {
  if (localStorage.getItem('nx-rail-expanded') === '1') setRailExpanded(true, { persist: false });
} catch (_) { }

// ================================================================
// Fix2-shell (item 10) — one-screen first-run card. Shown once, on the
// first launch only: dismissing persists `firstRunSeen` through the
// existing settings channel (gxAPI.updateSettings merges it into the root
// settings; no new storage API). Never shown in Private windows.
// ================================================================
const firstRunCard = document.getElementById('firstRunCard');

function dismissFirstRunCard() {
  if (!firstRunCard) return;
  firstRunCard.classList.add('hidden');
  settingsState = { ...settingsState, firstRunSeen: true };
  try {
    window.gxAPI.updateSettings({ firstRunSeen: true });
  } catch (_) { }
  // The card is a shell overlay like the profile modal: while it is up the
  // content views are hidden so it is not occluded by the tab's webview.
  // Restore them on dismiss, unless the profile modal is open (it owns the
  // hidden-views state then).
  try {
    if (!profileModalOpen) window.gxAPI?.setShellModalOpen?.(false);
  } catch (_) { }
}

function maybeShowFirstRunCard() {
  if (IS_DRAWER_OVERLAY) return;
  if (!firstRunCard) return;
  if (document.documentElement.dataset.incognito === 'true') return;
  if (settingsState && settingsState.firstRunSeen === true) return;
  firstRunCard.classList.remove('hidden');
  try {
    window.gxAPI?.setShellModalOpen?.(true);
  } catch (_) { }
}

// Escape dismisses the card (registered after the profile-modal capture
// listener, so a modal-open Escape still closes the modal, not the card).
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && firstRunCard && !firstRunCard.classList.contains('hidden')) {
    e.preventDefault();
    dismissFirstRunCard();
  }
}, true);

document.getElementById('btnFirstRunClose')?.addEventListener('click', dismissFirstRunCard);
document.getElementById('btnFirstRunGotIt')?.addEventListener('click', dismissFirstRunCard);
document.getElementById('btnFirstRunGx')?.addEventListener('click', () => {
  dismissFirstRunCard();
  if (typeof openLeftTool === 'function') openLeftTool('gxControl');
});

document.getElementById('btnChromeMenu').addEventListener('click', () => {
  window.gxSounds?.playClick();
  const rect = document.getElementById('btnChromeMenu').getBoundingClientRect();
  window.gxAPI.openPopover({
    kind: 'menu',
    x: rect.right - 280,
    y: TOP_CHROME_HEIGHT + 2,
    width: 280,
    height: 542,
    payload: { zoomPercent: currentState.activeTab?.zoomPercent || 100 }
  });
});

document.getElementById('btnAddressShield').addEventListener('click', () => {
  window.gxSounds?.playClick();
  const rect = document.getElementById('btnAddressShield').getBoundingClientRect();
  const active = currentState.activeTab || {};
  window.gxAPI.openPopover({
    kind: 'shield',
    x: rect.right - 312,
    y: TOP_CHROME_HEIGHT + 2,
    width: 312,
    height: 318,
    payload: {
      origin: active.origin || '',
      url: active.url || ''
    }
  });
});

// Window Controls (sync Maximize single-square vs Restore overlapping-squares icon)
const MAXIMIZE_ICON_SVG =
  '<svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="2" width="8" height="8" rx="1.2"/></svg>';
const RESTORE_ICON_SVG =
  '<svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.25"><rect x="1.8" y="3.2" width="6.8" height="6.8" rx="1"/><path d="M3.8 3.2V2.2a.8.8 0 0 1 .8-.8h5.2a.8.8 0 0 1 .8.8v5.2a.8.8 0 0 1-.8.8H8.8"/></svg>';

function syncWindowMaximizeIcon(isMaximized) {
  const btnMax = document.getElementById('btnWinMax');
  if (!btnMax) return;
  const max = Boolean(isMaximized);
  btnMax.innerHTML = max ? RESTORE_ICON_SVG : MAXIMIZE_ICON_SVG;
  btnMax.title = max ? 'Restore Down' : 'Maximize';
  btnMax.setAttribute('aria-label', max ? 'Restore Down' : 'Maximize');
}

document.getElementById('btnWinMin').addEventListener('click', () => window.gxAPI.minimizeWindow());
document.getElementById('btnWinMax').addEventListener('click', () => window.gxAPI.maximizeWindow());
document.getElementById('btnWinClose').addEventListener('click', () => window.gxAPI.closeWindow());
if (!IS_DRAWER_OVERLAY) {
  window.gxAPI.onWindowMaximizeChanged?.((isMax) => syncWindowMaximizeIcon(isMax));
  window.gxAPI.isWindowMaximized?.().then((isMax) => syncWindowMaximizeIcon(isMax)).catch(() => { });
}

const SERVICE_LOGOS = {
  'https://www.youtube.com': `<svg viewBox="0 0 24 24" width="20" height="20"><rect x="2" y="5" width="20" height="14" rx="4.5" fill="#ff0000"/><polygon points="10,9 16,12 10,15" fill="#fff"/></svg>`,
  'https://music.youtube.com': `<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="10" fill="#ff0033"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="#fff" stroke-width="1.3"/><polygon points="10.5,9.5 15,12 10.5,14.5" fill="#fff"/></svg>`,
  'https://open.spotify.com': `<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="10" fill="#1db954"/><path d="M7 9.5c3.5-1 7-.8 10 .5M7.5 12.5c3-.8 6-.6 8.5.4M8.2 15.5c2.2-.6 4.5-.5 6.5.3" fill="none" stroke="#0b0c10" stroke-width="1.7" stroke-linecap="round"/></svg>`,
  'https://music.apple.com': `<svg viewBox="0 0 24 24" width="20" height="20"><rect x="2" y="2" width="20" height="20" rx="5" fill="#fa243c"/><path d="M15 7v8.2a2.2 2.2 0 1 1-1.5-2.1V9.2l-4 1v5a2.2 2.2 0 1 1-1.5-2.1V8.4L15 7z" fill="#fff"/></svg>`,
  'https://soundcloud.com': `<svg viewBox="0 0 24 24" width="20" height="20"><path d="M11 17h7.5a3 3 0 0 0 .4-5.97A4.5 4.5 0 0 0 10 9.5V17h1z" fill="#ff5500"/><path d="M7.5 11v6M5.5 12.5v4.5M3.5 13.5v3.5" stroke="#ff5500" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  'https://www.deezer.com': `<svg viewBox="0 0 24 24" width="20" height="20"><rect x="3" y="15" width="3.5" height="3" fill="#a238ff"/><rect x="8" y="12" width="3.5" height="6" fill="#c084fc"/><rect x="13" y="9" width="3.5" height="9" fill="#00e5ff"/><rect x="18" y="6" width="3.5" height="12" fill="#10b981"/></svg>`,
  'https://listen.tidal.com': `<svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><polygon points="6,8 9,11 6,14 3,11"/><polygon points="12,8 15,11 12,14 9,11"/><polygon points="18,8 21,11 18,14 15,11"/><polygon points="12,14 15,17 12,20 9,17"/></svg>`,
  'https://www.twitch.tv': `<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4.5 2L3 6v14h5v2h3l2-2h3.5L21 15.5V2H4.5z" fill="#9146ff"/><polygon points="6,4 19,4 19,14.5 16,17.5 12.5,17.5 10.5,19.5 10.5,17.5 6,17.5" fill="#fff"/><rect x="10" y="7.5" width="2" height="5" fill="#9146ff"/><rect x="15" y="7.5" width="2" height="5" fill="#9146ff"/></svg>`,
  'https://chatgpt.com': `<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="10" fill="#10a37f"/><g fill="none" stroke="#fff" stroke-width="1.35" stroke-linecap="round"><path d="M10.27 13V7.6A2.4 2.4 0 0 1 14.94 8.3"/><path d="M10.27 13V7.6A2.4 2.4 0 0 1 14.94 8.3" transform="rotate(60 12 12)"/><path d="M10.27 13V7.6A2.4 2.4 0 0 1 14.94 8.3" transform="rotate(120 12 12)"/><path d="M10.27 13V7.6A2.4 2.4 0 0 1 14.94 8.3" transform="rotate(180 12 12)"/><path d="M10.27 13V7.6A2.4 2.4 0 0 1 14.94 8.3" transform="rotate(240 12 12)"/><path d="M10.27 13V7.6A2.4 2.4 0 0 1 14.94 8.3" transform="rotate(300 12 12)"/></g></svg>`,
  'https://claude.ai': `<svg viewBox="0 0 24 24" width="20" height="20"><g stroke="#d97757" stroke-width="2" stroke-linecap="round"><line x1="12" y1="3" x2="12" y2="21"/><line x1="12" y1="3" x2="12" y2="21" transform="rotate(36 12 12)"/><line x1="12" y1="3" x2="12" y2="21" transform="rotate(72 12 12)"/><line x1="12" y1="3" x2="12" y2="21" transform="rotate(108 12 12)"/><line x1="12" y1="3" x2="12" y2="21" transform="rotate(144 12 12)"/></g><circle cx="12" cy="12" r="2.2" fill="#d97757"/></svg>`,
  'https://gemini.google.com': `<svg viewBox="0 0 24 24" width="20" height="20"><defs><linearGradient id="nxGeminiGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#4285f4"/><stop offset="55%" stop-color="#9b72cb"/><stop offset="100%" stop-color="#d96570"/></linearGradient></defs><path d="M12 2C12 7.5 16.5 12 22 12C16.5 12 12 16.5 12 22C12 16.5 7.5 12 2 12C7.5 12 12 7.5 12 2Z" fill="url(#nxGeminiGrad)"/></svg>`,
  'https://www.perplexity.ai': `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#20b8cd" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M6.5 8.5V4l5.5 4.5L17.5 4v4.5"/><path d="M4.5 8.5h15v7h-2.5m-10 0H4.5v-7"/><path d="M12 8.5l-5.5 5.5v6l5.5-4.5 5.5 4.5v-6L12 8.5z"/></svg>`,
  'https://web.whatsapp.com': `<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 2.5a9.5 9.5 0 0 0-8.2 14.3L2.5 21.5l4.9-1.3A9.5 9.5 0 1 0 12 2.5z" fill="#25d366"/><path d="M9.6 8.0c-.4-.1-.9.1-1.3.5-.5.6-.7 1.4-.4 2.3.8 2.2 2.9 4.4 5.1 5.3.9.4 1.8.2 2.4-.3.4-.4.6-.9.5-1.3-.1-.3-.4-.5-.8-.7l-1.3-.6c-.3-.2-.6-.1-.8.2l-.6.7c-.2.2-.5.2-.8.1-.8-.4-1.6-1.2-2-2-.1-.3-.1-.6.1-.8l.7-.6c.3-.2.4-.5.2-.8l-.6-1.3c-.2-.4-.4-.7-.7-.7z" fill="#fff"/></svg>`,
  'https://discord.com/app': `<svg viewBox="0 0 24 24" width="20" height="20"><rect x="2" y="2" width="20" height="20" rx="5" fill="#5865f2"/><path d="M16.5 8.1a10.4 10.4 0 0 0-2.6-.8l-.3.7a9.7 9.7 0 0 0-3.2 0l-.3-.7a10.4 10.4 0 0 0-2.6.8C5.9 10.5 5.4 12.9 5.6 15.2a10.6 10.6 0 0 0 3.2 1.6l.6-1a6.8 6.8 0 0 1-1-.5l.2-.2a7.5 7.5 0 0 0 6.8 0l.2.2a6.8 6.8 0 0 1-1 .5l.6 1a10.6 10.6 0 0 0 3.2-1.6c.3-2.7-.5-5.1-1.9-7.1z" fill="#fff"/><circle cx="9.8" cy="12.6" r="1.2" fill="#5865f2"/><circle cx="14.2" cy="12.6" r="1.2" fill="#5865f2"/></svg>`
};

// 2. SIDEBAR OVERLAY PANEL & GX LEFT RAIL
const SERVICE_META_BY_KEY = {};
const INTERNAL_PANEL_ICONS = {
  player: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="color:var(--nx-accent-bright);"><circle cx="12" cy="12" r="9"/><polygon points="10 8.5 16 12 10 15.5 10 8.5" fill="currentColor" stroke="none"/></svg>`
};
let playerHasPlayingMedia = false;

document.querySelectorAll('[data-service-url]').forEach((btn) => {
  const url = btn.dataset.serviceUrl;
  const key = btn.dataset.sidebarItem;
  const title = btn.getAttribute('title') || key || 'Service';
  if (SERVICE_LOGOS[url]) {
    // Keep the label span: replacing innerHTML would destroy it and the
    // expanded rail would show no labels for service buttons (found by
    // screenshot verification — GX Corner/Player kept theirs, services lost).
    const labelText = btn.dataset.label || title;
    btn.innerHTML = `${SERVICE_LOGOS[url]}<span class="sidebar-label"></span>`;
    btn.querySelector('.sidebar-label').textContent = labelText;
  }
  if (key) {
    SERVICE_META_BY_KEY[key] = { key, url, title, logoHtml: SERVICE_LOGOS[url] || '' };
  }
  btn.addEventListener('click', () => {
    toggleSidebarService(key || url);
    if (IS_DRAWER_OVERLAY) window.gxAPI.closeShellDrawer?.();
  });
});

document.querySelectorAll('[data-sidebar-panel]').forEach((btn) => {
  const key = btn.dataset.sidebarPanel;
  const title = btn.getAttribute('aria-label') || btn.getAttribute('title') || key || 'Panel';
  if (key) {
    SERVICE_META_BY_KEY[key] = {
      key,
      url: '',
      title,
      logoHtml: INTERNAL_PANEL_ICONS[key] || '',
      internal: true
    };
  }
  btn.addEventListener('click', () => {
    toggleSidebarService(key);
    if (IS_DRAWER_OVERLAY) window.gxAPI.closeShellDrawer?.();
  });
});

document.querySelectorAll('[data-sidebar-tab]').forEach((btn) => {
  const targetUrl = btn.dataset.sidebarTab;
  if (!targetUrl) return;
  btn.addEventListener('click', () => {
    window.gxSounds?.playTabOpen();
    window.gxAPI.closePopover();
    if (targetUrl === 'nextgx://corner' && window.gxAPI.openGxCorner) {
      window.gxAPI.openGxCorner();
    } else {
      window.gxAPI.createTab({ url: targetUrl, active: true });
    }
    if (IS_DRAWER_OVERLAY) window.gxAPI.closeShellDrawer?.();
  });
});

function applySidebarPanelDOMState() {
  const isOpen = Boolean(sidebarPanelState.open && sidebarPanelState.activeKey);
  const activeKey = isOpen ? sidebarPanelState.activeKey : null;
  const width = getEffectiveSidebarPanelWidth(sidebarPanelState.width);
  const pinned = Boolean(sidebarPanelState.pinned);
  const audibleSet = new Set(Array.isArray(sidebarPanelState.audibleKeys) ? sidebarPanelState.audibleKeys : []);

  document.querySelectorAll('[data-service-url]').forEach((btn) => {
    const key = btn.dataset.sidebarItem;
    const isActive = Boolean(isOpen && key === activeKey);
    btn.classList.toggle('active', isActive);
    btn.classList.toggle('audible', Boolean(key && audibleSet.has(key)));
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });

  document.querySelectorAll('[data-sidebar-panel]').forEach((btn) => {
    const key = btn.dataset.sidebarPanel;
    const isActive = Boolean(isOpen && key === activeKey);
    btn.classList.toggle('active', isActive);
    if (key === 'player') {
      btn.classList.toggle('audible', Boolean(playerHasPlayingMedia));
    }
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });

  // Hover-expanding the rail via CSS position:absolute gets sliced by the
  // native WebContentsView at x=50px; expand only on explicit #btnRailExpand click.
  if (nxSidebarEl) {
    nxSidebarEl.classList.remove('rail-hover-expand');
    if (pinned && nxSidebarEl.classList.contains('expanded')) {
      setRailExpanded(false);
    }
    // Market audit bugs #15/#16: a floating panel is a WebContentsView and
    // always paints above the shell DOM, so an expanded rail's labels would
    // be clipped/overlapped by the panel. While any panel is open, suppress
    // hover-expand (CSS .nx-panel-open) and collapse a pinned-expanded rail.
    nxSidebarEl.classList.toggle('nx-panel-open', isOpen);
    if (isOpen && nxSidebarEl.classList.contains('expanded')) {
      setRailExpanded(false);
    }
  }

  if (!sidebarPanel) return;

  sidebarPanel.classList.toggle('hidden', !isOpen);
  sidebarPanel.classList.toggle('pinned', pinned);
  sidebarPanel.style.width = `${width}px`;
  sidebarPanel.style.minWidth = `${width}px`;

  if (activeKey) {
    const meta = SERVICE_META_BY_KEY[activeKey];
    const logoHtml =
      INTERNAL_PANEL_ICONS[activeKey] ||
      (meta && meta.logoHtml) ||
      (sidebarPanelState.serviceUrl && SERVICE_LOGOS[sidebarPanelState.serviceUrl]) ||
      '';
    if (sidebarPanelIcon) {
      sidebarPanelIcon.innerHTML = logoHtml;
    }
    if (sidebarPanelTitle) {
      sidebarPanelTitle.textContent = sidebarPanelState.title || (meta && meta.title) || activeKey;
    }
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

  if (btnSidebarReload) {
    btnSidebarReload.classList.toggle('spinning', Boolean(sidebarPanelState.isLoading));
  }
  updateSplitDividerLayout();
}

function applySidebarPanelState(nextState) {
  if (!nextState || typeof nextState !== 'object') return;
  const resolvedWidth = isResizingSidebarPanel
    ? clampSidebarPanelWidth(sidebarPanelState.width)
    : clampSidebarPanelWidth(nextState.width ?? sidebarPanelState.width);
  sidebarPanelState = {
    ...sidebarPanelState,
    ...nextState,
    width: resolvedWidth,
    pinned: Boolean(nextState.pinned ?? sidebarPanelState.pinned),
    open: Boolean(nextState.open && nextState.activeKey)
  };
  if (sidebarPanelState.open && activeLeftTool) {
    activeLeftTool = null;
    leftToolDrawer.classList.add('hidden');
    document.querySelectorAll('[data-left-tool]').forEach((btn) => btn.classList.remove('active'));
  }
  applySidebarPanelDOMState();
  if (!isResizingSidebarPanel) {
    syncLayoutOffsets();
  }
}

async function toggleSidebarService(serviceKey) {
  if (!serviceKey) return;
  window.gxSounds?.playPanelOpen();
  window.gxAPI.closePopover();
  if (activeLeftTool) {
    activeLeftTool = null;
    leftToolDrawer.classList.add('hidden');
    document.querySelectorAll('[data-left-tool]').forEach((btn) => btn.classList.remove('active'));
  }
  const state = await window.gxAPI.toggleSidebarPanel(serviceKey);
  applySidebarPanelState(state);
}

if (btnSidebarPin) {
  btnSidebarPin.addEventListener('click', async () => {
    window.gxSounds?.playClick();
    const state = await window.gxAPI.setSidebarPinned(!sidebarPanelState.pinned);
    applySidebarPanelState(state);
  });
}

if (btnSidebarReload) {
  btnSidebarReload.addEventListener('click', async () => {
    window.gxSounds?.playClick();
    const state = await window.gxAPI.reloadSidebarPanel();
    applySidebarPanelState(state);
  });
}

if (btnSidebarOpenTab) {
  btnSidebarOpenTab.addEventListener('click', async () => {
    window.gxSounds?.playTabOpen();
    await window.gxAPI.openSidebarInNewTab();
  });
}

if (btnSidebarClose) {
  btnSidebarClose.addEventListener('click', async () => {
    window.gxSounds?.playClick();
    const state = await window.gxAPI.closeSidebarPanel();
    applySidebarPanelState(state);
  });
}

// Sidebar Panel Right-Edge Drag-to-Resize (260px – 800px / 50% window, persisted on release)
let sidebarResizeStartX = 0;
let sidebarResizeStartWidth = SIDEBAR_PANEL_DEFAULT_WIDTH;
let activeSidebarPointerId = null;

function beginSidebarPanelResize(clientX, pointerId = null) {
  if (isResizingSidebarPanel) return;
  isResizingSidebarPanel = true;
  sidebarResizeStartWidth = getEffectiveSidebarPanelWidth(sidebarPanelState.width);
  showSidebarResizeBadge(sidebarResizeStartWidth, clientX);
  sidebarResizeStartX = typeof clientX === 'number' ? clientX : SIDEBAR_ICON_WIDTH + sidebarResizeStartWidth;
  activeSidebarPointerId = pointerId;
  sidebarPanelResizer?.classList.add('dragging');
  sidebarPanel?.classList.add('resizing');
  if (pointerId !== null && sidebarPanelResizer?.setPointerCapture) {
    try {
      sidebarPanelResizer.setPointerCapture(pointerId);
    } catch (_) { }
  }
}

function updateSidebarPanelResize(clientX) {
  if (!isResizingSidebarPanel || typeof clientX !== 'number') return;
  const delta = clientX - sidebarResizeStartX;
  const nextWidth = getEffectiveSidebarPanelWidth(sidebarResizeStartWidth + delta);
  if (nextWidth !== sidebarPanelState.width) {
    sidebarPanelState.width = nextWidth;
    applySidebarPanelDOMState();
    showSidebarResizeBadge(nextWidth, clientX);
    window.gxAPI.setSidebarWidth(nextWidth, { persist: false });
  }
}

function endSidebarPanelResize() {
  if (!isResizingSidebarPanel) return;
  isResizingSidebarPanel = false;
  sidebarPanelResizer?.classList.remove('dragging');
  sidebarPanel?.classList.remove('resizing');
  if (activeSidebarPointerId !== null && sidebarPanelResizer?.releasePointerCapture) {
    try {
      sidebarPanelResizer.releasePointerCapture(activeSidebarPointerId);
    } catch (_) { }
  }
  activeSidebarPointerId = null;
  const finalWidth = getEffectiveSidebarPanelWidth(sidebarPanelState.width);
  sidebarPanelState.width = finalWidth;
  applySidebarPanelDOMState();
  syncLayoutOffsets();
  hideSidebarResizeBadgeSoon();
  window.gxAPI.setSidebarWidth(finalWidth, { persist: true });
}

if (sidebarPanelResizer) {
  // Market audit bug #17: the dblclick reset never fired — pointerdown calls
  // preventDefault() + setPointerCapture, which swallows the dblclick event.
  // Detect a double press manually in pointerdown instead (same 380 px reset).
  let lastResizerPointerDownAt = 0;
  const resetSidebarPanelWidth = (clientX) => {
    sidebarPanelState.width = SIDEBAR_PANEL_DEFAULT_WIDTH;
    applySidebarPanelDOMState();
    syncLayoutOffsets();
    showSidebarResizeBadge(SIDEBAR_PANEL_DEFAULT_WIDTH, clientX);
    hideSidebarResizeBadgeSoon();
    window.gxAPI.setSidebarWidth(SIDEBAR_PANEL_DEFAULT_WIDTH, { persist: true });
    showToast('Sidebar width reset to 380 px', { sound: false });
  };
  sidebarPanelResizer.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    const now = Date.now();
    if (now - lastResizerPointerDownAt < 400) {
      lastResizerPointerDownAt = 0;
      resetSidebarPanelWidth(e.clientX);
      return;
    }
    lastResizerPointerDownAt = now;
    beginSidebarPanelResize(e.clientX, e.pointerId);
  });
  sidebarPanelResizer.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || isResizingSidebarPanel) return;
    e.preventDefault();
    beginSidebarPanelResize(e.clientX, null);
  });
}

window.addEventListener('pointermove', (e) => {
  if (!isResizingSidebarPanel) return;
  updateSidebarPanelResize(e.clientX);
});

window.addEventListener('mousemove', (e) => {
  if (!isResizingSidebarPanel) return;
  updateSidebarPanelResize(e.clientX);
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

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !e.defaultPrevented) {
    if (profileModalOpen) {
      e.preventDefault();
      closeProfileModal();
      return;
    }
    if (nxSidebarEl && nxSidebarEl.classList.contains('expanded')) {
      e.preventDefault();
      setRailExpanded(false);
      return;
    }
    if (findBarOpen && document.activeElement === findInput) return;
    // Escape closes the GX left tool drawer first (GX Control / Cleaner /
    // Customize Dock used to ignore Escape entirely), then the sidebar
    // panel, matching the main-process Escape handling in shortcuts.js.
    if (activeLeftTool) {
      e.preventDefault();
      closeLeftTool();
      return;
    }
    if (sidebarPanelState.open && !sidebarPanelState.pinned) {
      e.preventDefault();
      window.gxAPI.closeSidebarPanel().then((state) => applySidebarPanelState(state));
    }
  }
});

// 3. LEFT SYSTEM DRAWER (GX Control, Cleaner, Customize Dock)
const LEFT_TOOL_TITLES = {
  gxControl: 'GX Control',
  gxCleaner: 'Instant Privacy Cleaner',
  sidebarSetup: 'Customize Dock'
};

function openLeftTool(toolName) {
  window.gxSounds?.playPanelOpen();
  window.gxAPI.closePopover();
  if (!IS_DRAWER_OVERLAY && window.gxAPI.toggleShellDrawer) {
    window.gxAPI.toggleShellDrawer({ kind: 'left-tool', tool: toolName });
    return;
  }
  if (activeLeftTool === toolName) {
    closeLeftTool();
    return;
  }

  if (sidebarPanelState.open) {
    sidebarPanelState.open = false;
    applySidebarPanelDOMState();
    window.gxAPI.closeSidebarPanel();
  }

  activeLeftTool = toolName;
  leftToolTitle.textContent = LEFT_TOOL_TITLES[toolName] || 'System';
  leftToolDrawer.classList.remove('hidden');
  if (nxSidebarEl) {
    nxSidebarEl.classList.add('nx-panel-open');
    if (nxSidebarEl.classList.contains('expanded')) {
      setRailExpanded(false);
    }
  }
  if (toolName === 'gxCleaner') refreshCleanerCacheSize();

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
  if (IS_DRAWER_OVERLAY && window.gxAPI.closeShellDrawer) {
    window.gxAPI.closeShellDrawer();
    return;
  }
  if (!IS_DRAWER_OVERLAY && window.gxAPI.closeShellDrawer) {
    activeLeftTool = null;
    document.querySelectorAll('[data-left-tool]').forEach((btn) => btn.classList.remove('active'));
    window.gxAPI.closeShellDrawer();
    return;
  }
  activeLeftTool = null;
  leftToolDrawer.classList.add('hidden');
  document.querySelectorAll('[data-left-tool]').forEach((btn) => btn.classList.remove('active'));
  if (nxSidebarEl && !sidebarPanelState.open) {
    nxSidebarEl.classList.remove('nx-panel-open');
  }
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
  if (
    sidebarPanelState.open &&
    sidebarPanelState.activeKey &&
    sidebarItems[sidebarPanelState.activeKey] === false
  ) {
    window.gxAPI.closeSidebarPanel().then((state) => applySidebarPanelState(state));
  }
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

// Market audit bug #36: live cache-size readout for the Cleaner drawer.
async function refreshCleanerCacheSize() {
  const el = document.getElementById('cleanerCacheSizeText');
  if (!el) return;
  try {
    const res = await window.gxAPI.getCacheSize?.();
    const bytes = Number(res?.bytes);
    el.textContent = Number.isFinite(bytes) && bytes > 0 ? formatBytes(bytes) : 'Empty';
  } catch (_) {
    el.textContent = '—';
  }
}

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
  refreshCleanerCacheSize();
});

// 4. RIGHT DRAWER (Control Center & Extensions)
const RIGHT_DRAWER_TITLES = {
  easySetup: 'Easy Setup',
  extensions: 'Extensions'
};

function openRightDrawer(panelName) {
  window.gxSounds?.playPanelOpen();
  window.gxAPI.closePopover();
  if (!IS_DRAWER_OVERLAY && window.gxAPI.toggleShellDrawer) {
    window.gxAPI.toggleShellDrawer({ kind: 'right-drawer', panel: panelName });
    return;
  }
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
  if (sidebarPanelState.open) applySidebarPanelDOMState();
  syncLayoutOffsets();
}

function closeRightDrawer() {
  if (IS_DRAWER_OVERLAY && window.gxAPI.closeShellDrawer) {
    window.gxAPI.closeShellDrawer();
    return;
  }
  if (!IS_DRAWER_OVERLAY && window.gxAPI.closeShellDrawer) {
    activeRightDrawer = null;
    window.gxAPI.closeShellDrawer();
    return;
  }
  activeRightDrawer = null;
  rightDrawer.classList.add('hidden');
  if (sidebarPanelState.open) applySidebarPanelDOMState();
  syncLayoutOffsets();
}

function applyShellDrawerOverlayState(st) {
  const open = Boolean(st && st.open);
  const kind = open ? st.kind : null;
  if (!IS_DRAWER_OVERLAY) {
    const activeTool = kind === 'left-tool' ? st.tool : null;
    document.querySelectorAll('[data-left-tool]').forEach((btn) => {
      btn.classList.toggle('active', Boolean(activeTool && btn.dataset.leftTool === activeTool));
    });
    const btnEasy = document.getElementById('btnEasySetup');
    if (btnEasy) {
      btnEasy.classList.toggle('active', kind === 'right-drawer' && st.panel === 'easySetup');
    }
    if (btnRailExpand) {
      const railOpen = kind === 'rail';
      btnRailExpand.classList.toggle('active', railOpen);
      btnRailExpand.setAttribute('aria-pressed', railOpen ? 'true' : 'false');
    }
    return;
  }

  // Inside floating overlay WebContentsView: render ONLY the requested floating panel
  if (nxSidebarEl) {
    nxSidebarEl.classList.toggle('hidden', kind !== 'rail');
    nxSidebarEl.classList.toggle('expanded', kind === 'rail');
    if (btnRailExpand) {
      const label = btnRailExpand.querySelector('.sidebar-label');
      if (label) label.textContent = 'Collapse';
    }
  }
  if (leftToolDrawer) {
    const isLeft = kind === 'left-tool';
    leftToolDrawer.classList.toggle('hidden', !isLeft);
    if (isLeft) {
      const toolName = st.tool || 'gxControl';
      activeLeftTool = toolName;
      leftToolTitle.textContent = LEFT_TOOL_TITLES[toolName] || 'System';
      document.querySelectorAll('#leftToolDrawer .tool-body').forEach((el) => {
        el.classList.toggle('hidden', el.id !== `left-tool-${toolName}`);
      });
      if (toolName === 'gxCleaner') refreshCleanerCacheSize();
      if (toolName === 'gxControl') loadPerformancePanel();
    } else {
      activeLeftTool = null;
    }
  }
  if (rightDrawer) {
    const isRight = kind === 'right-drawer';
    rightDrawer.classList.toggle('hidden', !isRight);
    if (isRight) {
      const panelName = st.panel || 'easySetup';
      activeRightDrawer = panelName;
      rightDrawerTitle.textContent = RIGHT_DRAWER_TITLES[panelName] || 'Easy Setup';
      document.querySelectorAll('#rightDrawer .tool-body').forEach((el) => {
        el.classList.toggle('hidden', el.id !== `right-panel-${panelName}`);
      });
      if (panelName === 'easySetup') loadEasySetupPanel();
    } else {
      activeRightDrawer = null;
    }
  }
}

window.gxAPI.onShellDrawerState?.((st) => applyShellDrawerOverlayState(st));
if (IS_DRAWER_OVERLAY && window.gxAPI.getShellDrawerState) {
  window.gxAPI.getShellDrawerState().then((st) => applyShellDrawerOverlayState(st)).catch(() => { });
}

document.getElementById('btnEasySetup').addEventListener('click', () => openRightDrawer('easySetup'));
document.getElementById('btnTopExtensions').addEventListener('click', () => {
  window.gxSounds?.playClick();
  const rect = document.getElementById('btnTopExtensions').getBoundingClientRect();
  window.gxAPI.openPopover({
    kind: 'extensions-dropdown',
    x: Math.round(rect.right - 320),
    y: TOP_CHROME_HEIGHT + 2,
    width: 320,
    height: 220
  });
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
function updateFindMatchCount(result) {
  if (!findMatchCount) return;
  const query = findInput.value.trim();
  if (!findBarOpen || !query || !result) {
    findMatchCount.textContent = '';
    findMatchCount.classList.remove('has-matches', 'no-results');
    return;
  }
  const matches = Number(result.matches) || 0;
  const active = Number(result.activeMatchOrdinal) || 0;
  if (matches > 0) {
    // [URLBAR-9.1] Chrome format: "1/1" (no spaces around the slash).
    findMatchCount.textContent = `${active}/${matches}`;
    findMatchCount.classList.add('has-matches');
    findMatchCount.classList.remove('no-results');
  } else if (result.finalUpdate) {
    findMatchCount.textContent = 'No results';
    findMatchCount.classList.remove('has-matches');
    findMatchCount.classList.add('no-results');
  }
}

function openFindBar() {
  findBarOpen = true;
  findBar.classList.remove('hidden');
  syncLayoutOffsets();
  findInput.focus();
  findInput.select();
  const txt = findInput.value.trim();
  if (txt) {
    lastFindQuery = txt;
    window.gxAPI.findInPage(txt, true);
  } else {
    lastFindQuery = '';
    updateFindMatchCount(null);
  }
}

function closeFindBar() {
  findBarOpen = false;
  lastFindQuery = '';
  findBar.classList.add('hidden');
  updateFindMatchCount(null);
  window.gxAPI.stopFindInPage();
  syncLayoutOffsets();
}

findInput.addEventListener('input', () => {
  const txt = findInput.value.trim();
  if (!txt) {
    lastFindQuery = '';
    updateFindMatchCount(null);
    window.gxAPI.stopFindInPage();
    return;
  }
  if (txt === lastFindQuery) return;
  lastFindQuery = txt;
  window.gxAPI.findInPage(txt, true);
});

findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const txt = findInput.value.trim();
    if (txt) {
      lastFindQuery = txt;
      window.gxAPI.findInPage(txt, !e.shiftKey);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeFindBar();
  }
});

document.getElementById('btnFindNext').addEventListener('click', () => {
  const txt = findInput.value.trim();
  if (txt) {
    lastFindQuery = txt;
    window.gxAPI.findInPage(txt, true);
  }
});
document.getElementById('btnFindPrev').addEventListener('click', () => {
  const txt = findInput.value.trim();
  if (txt) {
    lastFindQuery = txt;
    window.gxAPI.findInPage(txt, false);
  }
});
document.getElementById('btnFindClose').addEventListener('click', closeFindBar);

// 5. PERFORMANCE, MEMORY OPTIMIZER & GX CONTROL LIMITERS
const gxSliderDragging = { ram: false, cpu: false, net: false };
const gxSliderTimers = { ram: null, cpu: null, net: null };
let lastPerfTabSignature = '';

function formatRamCap(mb) {
  const num = Number(mb);
  if (!Number.isFinite(num) || num <= 0) return '4 GB';
  if (num < 1024) return `${Math.round(num)} MB`;
  const gb = num / 1024;
  return `${num % 1024 === 0 ? gb : gb.toFixed(1)} GB`;
}

function formatCpuPct(val) {
  const num = Number(val);
  if (!Number.isFinite(num) || num < 0) return '--';
  return `${num < 10 ? num.toFixed(1) : Math.round(num)}%`;
}

function syncGxLimitersUI(s) {
  if (!s || typeof s !== 'object') return;

  const ramEnabled = Boolean(s.gxRamLimiterEnabled);
  const ramLimitMB = Number.isFinite(Number(s.gxRamLimitMB)) ? Math.round(Number(s.gxRamLimitMB)) : 4096;
  const chkRam = document.getElementById('chkGxRamLimiter');
  const rngRam = document.getElementById('rngGxRamLimit');
  const valRam = document.getElementById('valGxRamLimit');
  const rowRam = document.getElementById('gxRamSliderRow');
  const blockRam = document.getElementById('gxRamLimiterBlock');
  if (chkRam) chkRam.checked = ramEnabled;
  if (rowRam) rowRam.classList.toggle('is-disabled', !ramEnabled);
  if (blockRam) blockRam.classList.toggle('is-enabled', ramEnabled);
  if (rngRam) {
    rngRam.disabled = !ramEnabled;
    if (!gxSliderDragging.ram) rngRam.value = String(ramLimitMB);
  }
  if (valRam && !gxSliderDragging.ram) {
    valRam.textContent = formatRamCap(ramLimitMB);
  }

  const cpuEnabled = Boolean(s.gxCpuLimiterEnabled);
  const cpuLimitPercent = Number.isFinite(Number(s.gxCpuLimitPercent)) ? Math.round(Number(s.gxCpuLimitPercent)) : 50;
  const chkCpu = document.getElementById('chkGxCpuLimiter');
  const rngCpu = document.getElementById('rngGxCpuLimit');
  const valCpu = document.getElementById('valGxCpuLimit');
  const rowCpu = document.getElementById('gxCpuSliderRow');
  const blockCpu = document.getElementById('gxCpuLimiterBlock');
  if (chkCpu) chkCpu.checked = cpuEnabled;
  if (rowCpu) rowCpu.classList.toggle('is-disabled', !cpuEnabled);
  if (blockCpu) blockCpu.classList.toggle('is-enabled', cpuEnabled);
  if (rngCpu) {
    rngCpu.disabled = !cpuEnabled;
    if (!gxSliderDragging.cpu) rngCpu.value = String(cpuLimitPercent);
  }
  if (valCpu && !gxSliderDragging.cpu) {
    valCpu.textContent = `${cpuLimitPercent}%`;
  }

  const netEnabled = Boolean(s.gxNetLimiterEnabled);
  const netLimitMbps = Number.isFinite(Number(s.gxNetLimitMbps)) ? Math.round(Number(s.gxNetLimitMbps)) : 10;
  const chkNet = document.getElementById('chkGxNetLimiter');
  const rngNet = document.getElementById('rngGxNetLimit');
  const valNet = document.getElementById('valGxNetLimit');
  const rowNet = document.getElementById('gxNetSliderRow');
  const presetsNet = document.getElementById('gxNetPresets');
  const blockNet = document.getElementById('gxNetLimiterBlock');
  if (chkNet) chkNet.checked = netEnabled;
  if (rowNet) rowNet.classList.toggle('is-disabled', !netEnabled);
  if (blockNet) blockNet.classList.toggle('is-enabled', netEnabled);
  if (rngNet) {
    rngNet.disabled = !netEnabled;
    if (!gxSliderDragging.net) rngNet.value = String(netLimitMbps);
  }
  if (valNet && !gxSliderDragging.net) {
    valNet.textContent = `${netLimitMbps} Mbps`;
  }
  if (presetsNet) {
    presetsNet.classList.toggle('is-disabled', !netEnabled);
    presetsNet.setAttribute('aria-disabled', netEnabled ? 'false' : 'true');
    const shownMbps = gxSliderDragging.net && rngNet ? Number(rngNet.value) : netLimitMbps;
    presetsNet.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.disabled = !netEnabled;
      btn.classList.toggle('active', Number(btn.dataset.mbps) === shownMbps);
    });
  }
}

function bindGxRangeSlider(key, rangeId, valueId, settingKey, formatFn, onPreview) {
  const rng = document.getElementById(rangeId);
  const valEl = document.getElementById(valueId);
  if (!rng) return;

  const commit = (rawVal) => {
    clearTimeout(gxSliderTimers[key]);
    const num = Number(rawVal);
    if (!Number.isFinite(num)) return;
    settingsState = { ...settingsState, [settingKey]: num };
    window.gxAPI.updateSettings({ [settingKey]: num });
  };

  const endDrag = () => {
    gxSliderDragging[key] = false;
  };

  rng.addEventListener('pointerdown', () => {
    gxSliderDragging[key] = true;
  });
  rng.addEventListener('mousedown', () => {
    gxSliderDragging[key] = true;
  });
  rng.addEventListener('pointerup', endDrag);
  rng.addEventListener('mouseup', endDrag);
  rng.addEventListener('blur', endDrag);

  rng.addEventListener('input', () => {
    const num = Number(rng.value);
    if (valEl) valEl.textContent = formatFn(num);
    if (typeof onPreview === 'function') onPreview(num);
    clearTimeout(gxSliderTimers[key]);
    gxSliderTimers[key] = setTimeout(() => commit(rng.value), 120);
  });

  rng.addEventListener('change', () => {
    endDrag();
    const num = Number(rng.value);
    if (valEl) valEl.textContent = formatFn(num);
    if (typeof onPreview === 'function') onPreview(num);
    commit(num);
  });
}

const chkGxRamLimiterEl = document.getElementById('chkGxRamLimiter');
if (chkGxRamLimiterEl) {
  chkGxRamLimiterEl.addEventListener('change', (e) => {
    const enabled = e.target.checked;
    settingsState = { ...settingsState, gxRamLimiterEnabled: enabled };
    syncGxLimitersUI(settingsState);
    window.gxAPI.updateSettings({ gxRamLimiterEnabled: enabled });
  });
}

const chkGxCpuLimiterEl = document.getElementById('chkGxCpuLimiter');
if (chkGxCpuLimiterEl) {
  chkGxCpuLimiterEl.addEventListener('change', (e) => {
    const enabled = e.target.checked;
    settingsState = { ...settingsState, gxCpuLimiterEnabled: enabled };
    syncGxLimitersUI(settingsState);
    window.gxAPI.updateSettings({ gxCpuLimiterEnabled: enabled });
  });
}

const chkGxNetLimiterEl = document.getElementById('chkGxNetLimiter');
if (chkGxNetLimiterEl) {
  chkGxNetLimiterEl.addEventListener('change', (e) => {
    const enabled = e.target.checked;
    settingsState = { ...settingsState, gxNetLimiterEnabled: enabled };
    syncGxLimitersUI(settingsState);
    window.gxAPI.updateSettings({ gxNetLimiterEnabled: enabled });
  });
}

bindGxRangeSlider('ram', 'rngGxRamLimit', 'valGxRamLimit', 'gxRamLimitMB', formatRamCap);
bindGxRangeSlider('cpu', 'rngGxCpuLimit', 'valGxCpuLimit', 'gxCpuLimitPercent', (v) => `${Math.round(v)}%`);
bindGxRangeSlider(
  'net',
  'rngGxNetLimit',
  'valGxNetLimit',
  'gxNetLimitMbps',
  (v) => `${Math.round(v)} Mbps`,
  (v) => {
    const presetsNet = document.getElementById('gxNetPresets');
    if (presetsNet) {
      presetsNet.querySelectorAll('.seg-btn').forEach((btn) => {
        btn.classList.toggle('active', Number(btn.dataset.mbps) === Math.round(v));
      });
    }
  }
);

document.querySelectorAll('#gxNetPresets .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    const mbps = Number(btn.dataset.mbps);
    if (!Number.isFinite(mbps)) return;
    settingsState = { ...settingsState, gxNetLimitMbps: mbps };
    const rngNet = document.getElementById('rngGxNetLimit');
    const valNet = document.getElementById('valGxNetLimit');
    if (rngNet) rngNet.value = String(mbps);
    if (valNet) valNet.textContent = `${mbps} Mbps`;
    document.querySelectorAll('#gxNetPresets .seg-btn').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.mbps) === mbps);
    });
    window.gxAPI.updateSettings({ gxNetLimitMbps: mbps });
  });
});

async function loadPerformancePanel() {
  const stats = await window.gxAPI.getSystemStats();
  if (stats?.settings) syncGxLimitersUI(stats.settings);
  else syncGxLimitersUI(settingsState);
  renderSystemStats(stats);
  renderPerformanceTabList({ forceRebuild: true });
}

function renderSystemStats(stats) {
  if (!stats) return;
  lastSystemStats = stats;

  const gx = stats.gxControl || null;
  const ramCfg = gx?.ram || {
    enabled: Boolean(stats.settings?.gxRamLimiterEnabled),
    limitMB: stats.settings?.gxRamLimitMB || 4096,
    currentMB: stats.browserRamMB || 0,
    overLimit: false,
    hibernatedCount: 0,
    eligibleBackgroundTabs: 0
  };
  const cpuCfg = gx?.cpu || {
    enabled: Boolean(stats.settings?.gxCpuLimiterEnabled),
    limitPercent: stats.settings?.gxCpuLimitPercent || 50,
    currentPercent: Number(stats.browserCpuPercent) || 0,
    throttlingActive: false,
    throttledRate: 1,
    throttledCount: 0
  };
  const netCfg = gx?.network || {
    enabled: Boolean(stats.settings?.gxNetLimiterEnabled),
    limitMbps: stats.settings?.gxNetLimitMbps || 10,
    active: Boolean(stats.settings?.gxNetLimiterEnabled),
    limitedCount: 0
  };

  const ramEl = document.getElementById('perfBrowserRam');
  if (ramEl) {
    ramEl.textContent = `${stats.browserRamMB} MB`;
    const ramDenom = ramCfg.enabled && ramCfg.limitMB > 0 ? ramCfg.limitMB : 2048;
    const pct = Math.min(100, Math.round((stats.browserRamMB / ramDenom) * 100));
    const ramBar = document.getElementById('perfBrowserRamBar');
    if (ramBar) {
      ramBar.style.width = `${Math.max(4, pct)}%`;
      ramBar.classList.toggle('is-danger', Boolean(ramCfg.enabled && ramCfg.overLimit));
      ramBar.classList.toggle('is-warn', Boolean(ramCfg.enabled && !ramCfg.overLimit && pct >= 85));
    }

    const ramSub = document.getElementById('perfBrowserRamSub');
    if (ramSub) {
      if (!ramCfg.enabled) {
        ramSub.textContent = 'Cap: Off';
        ramSub.classList.remove('is-warn', 'is-danger');
      } else if (ramCfg.overLimit) {
        ramSub.textContent = `Over ${formatRamCap(ramCfg.limitMB)} cap`;
        ramSub.classList.add('is-danger');
        ramSub.classList.remove('is-warn');
      } else {
        ramSub.textContent = `Cap: ${formatRamCap(ramCfg.limitMB)}`;
        ramSub.classList.toggle('is-warn', pct >= 85);
        ramSub.classList.remove('is-danger');
      }
    }

    // Circular RAM gauge (GX-style): live number in the ring, hot red
    // when over the cap, amber when near it. Circumference for r=30 is 188.5.
    const ramGaugeArc = document.getElementById('perfRamGaugeArc');
    const ramGaugeText = document.getElementById('perfRamGaugeText');
    if (ramGaugeArc) {
      ramGaugeArc.style.strokeDashoffset = `${Math.max(0, 188.5 * (1 - pct / 100)).toFixed(1)}`;
      ramGaugeArc.classList.toggle('is-danger', Boolean(ramCfg.enabled && ramCfg.overLimit));
      ramGaugeArc.classList.toggle('is-warn', Boolean(ramCfg.enabled && !ramCfg.overLimit && pct >= 85));
    }
    if (ramGaugeText) {
      ramGaugeText.textContent =
        stats.browserRamMB >= 1024 ? `${(stats.browserRamMB / 1024).toFixed(1)} GB` : `${stats.browserRamMB} MB`;
    }

    const sysRamEl = document.getElementById('perfSysRamText');
    if (sysRamEl) {
      sysRamEl.textContent = `System RAM: ${stats.usedSysMB} / ${stats.totalSysMB} MB (${stats.sysRamPercent}%)`;
    }

    const cpuEl = document.getElementById('perfCpuPercent');
    if (cpuEl) cpuEl.textContent = `${stats.cpuPercent}%`;
    const cpuBar = document.getElementById('perfCpuBar');
    if (cpuBar) cpuBar.style.width = `${Math.max(4, stats.cpuPercent)}%`;

    const browserCpuInline = document.getElementById('perfBrowserCpuInline');
    if (browserCpuInline) {
      const browserCpuStr = formatCpuPct(stats.browserCpuPercent ?? cpuCfg.currentPercent);
      browserCpuInline.textContent = cpuCfg.enabled
        ? `Browser: ${browserCpuStr} / ${cpuCfg.limitPercent}%`
        : `Browser: ${browserCpuStr}`;
      browserCpuInline.classList.toggle('is-warn', Boolean(cpuCfg.throttlingActive));
    }

    const tabCountsEl = document.getElementById('perfTabCounts');
    if (tabCountsEl) {
      tabCountsEl.textContent = `Active Tabs: ${stats.activeTabsCount} • Hibernated: ${stats.sleepingTabsCount}`;
    }
  }

  // Update RAM Limiter status
  const ramBadge = document.getElementById('gxRamStatusBadge');
  const ramMeta = document.getElementById('gxRamLimiterMeta');
  const ramBlock = document.getElementById('gxRamLimiterBlock');
  if (ramBadge && ramMeta) {
    ramBadge.classList.remove('is-active', 'is-warn', 'is-danger');
    ramMeta.classList.remove('is-warn', 'is-danger');
    if (ramBlock) ramBlock.classList.toggle('is-enforcing', Boolean(ramCfg.enabled && ramCfg.overLimit));
    const limCount = Number(ramCfg.hibernatedCount) || 0;
    if (!ramCfg.enabled) {
      ramBadge.textContent = 'OFF';
      ramMeta.textContent = `Live: ${stats.browserRamMB} MB • Cap off • Hibernated by limiter: ${limCount}`;
    } else if (ramCfg.overLimit) {
      ramBadge.textContent = ramCfg.eligibleBackgroundTabs > 0 ? 'TRIMMING' : 'OVER CAP';
      ramBadge.classList.add('is-danger');
      ramMeta.classList.add('is-danger');
      ramMeta.textContent =
        ramCfg.eligibleBackgroundTabs > 0
          ? `Live: ${stats.browserRamMB} MB / ${formatRamCap(ramCfg.limitMB)} • Hibernating LRU bg tabs (${limCount} total)`
          : `Live: ${stats.browserRamMB} MB / ${formatRamCap(ramCfg.limitMB)} • No eligible bg tabs • Hibernated: ${limCount}`;
    } else {
      ramBadge.textContent = 'ACTIVE';
      ramBadge.classList.add('is-active');
      ramMeta.textContent = `Live: ${stats.browserRamMB} MB / ${formatRamCap(ramCfg.limitMB)} • Hibernated by limiter: ${limCount}`;
    }
  }

  // Update CPU Limiter status
  const cpuBadge = document.getElementById('gxCpuStatusBadge');
  const cpuMeta = document.getElementById('gxCpuLimiterMeta');
  const cpuBlock = document.getElementById('gxCpuLimiterBlock');
  if (cpuBadge && cpuMeta) {
    cpuBadge.classList.remove('is-active', 'is-warn', 'is-danger');
    cpuMeta.classList.remove('is-warn', 'is-danger');
    if (cpuBlock) cpuBlock.classList.toggle('is-enforcing', Boolean(cpuCfg.enabled && cpuCfg.throttlingActive));
    const bCpuStr = formatCpuPct(stats.browserCpuPercent ?? cpuCfg.currentPercent);
    if (!cpuCfg.enabled) {
      cpuBadge.textContent = 'OFF';
      cpuMeta.textContent = `Browser CPU: ${bCpuStr} • Limiter off`;
    } else if (cpuCfg.throttlingActive) {
      cpuBadge.textContent = 'THROTTLING';
      cpuBadge.classList.add('is-warn');
      cpuMeta.classList.add('is-warn');
      const count = Number(cpuCfg.throttledCount) || 0;
      const rate = Number(cpuCfg.throttledRate) || 2;
      cpuMeta.textContent =
        count > 0
          ? `Browser CPU: ${bCpuStr} / ${cpuCfg.limitPercent}% • Throttling ${count} bg tab(s) (${rate}x CDP)`
          : `Browser CPU: ${bCpuStr} / ${cpuCfg.limitPercent}% • Active tab protected (0 bg tabs to throttle)`;
    } else {
      cpuBadge.textContent = 'ACTIVE';
      cpuBadge.classList.add('is-active');
      cpuMeta.textContent = `Browser CPU: ${bCpuStr} / ${cpuCfg.limitPercent}% • Below cap (unthrottled)`;
    }
  }

  // Update Network Limiter status (honest state-only; no fabricated live Mbps)
  const netBadge = document.getElementById('gxNetStatusBadge');
  const netMeta = document.getElementById('gxNetLimiterMeta');
  const netBlock = document.getElementById('gxNetLimiterBlock');
  if (netBadge && netMeta) {
    netBadge.classList.remove('is-active', 'is-warn', 'is-danger');
    if (netBlock) netBlock.classList.toggle('is-enforcing', Boolean(netCfg.enabled));
    if (!netCfg.enabled) {
      netBadge.textContent = 'OFF';
      netMeta.textContent = 'Unlimited • Limiter inactive';
    } else {
      netBadge.textContent = 'ACTIVE';
      netBadge.classList.add('is-active');
      const limitedCount = Number(netCfg.limitedCount) || 0;
      netMeta.textContent = `Cap: ${netCfg.limitMbps} Mbps/tab down • ${limitedCount} tab(s) capped (live Mbps not metered)`;
    }
  }

  if (activeLeftTool === 'gxControl') {
    renderPerformanceTabList();
  }
}

function buildPerfTabMeta(tab, isCurrent, stat) {
  const roleLabel = isCurrent ? 'Active' : tab.sleeping ? 'Hibernated' : 'Background';
  let subText = '';
  if (tab.sleeping) {
    subText = 'Hibernated • 0 MB • 0% CPU';
  } else if (stat && stat.matched && stat.ramMB !== null) {
    const cpuPart = stat.cpuPercent !== null ? formatCpuPct(stat.cpuPercent) : '--';
    subText = `${roleLabel} • ${stat.ramMB} MB • ${cpuPart} CPU`;
  } else {
    subText = `${roleLabel} • Measuring...`;
  }

  const badges = [];
  if (stat?.cpuThrottled) {
    const rate = stat.cpuThrottleRate || 2;
    badges.push({
      cls: 'throttled',
      label: 'Throttled',
      title: `CDP CPU throttling active (${rate}x slowdown on background tab)`
    });
  }
  if (stat?.netLimited) {
    const cap = lastSystemStats?.gxControl?.network?.limitMbps || settingsState?.gxNetLimitMbps || 10;
    badges.push({
      cls: 'net',
      label: `Net ${cap}M`,
      title: `CDP Network download cap active (${cap} Mbps per tab)`
    });
  }
  if (stat?.sharedProcess && stat.sharedProcessCount > 1) {
    badges.push({
      cls: 'shared',
      label: `Shared (${stat.sharedProcessCount})`,
      title: `Shares renderer PID ${stat.osPid || ''} with ${stat.sharedProcessCount} tabs — values reflect process total`
    });
  }
  if (tab.pinned) {
    badges.push({ cls: 'state', label: 'Pinned', title: 'Protected from auto/RAM hibernation' });
  }
  if (tab.audible) {
    badges.push({ cls: 'state', label: 'Audio', title: 'Playing audio — protected from auto/RAM hibernation' });
  }
  if (!currentState.windowIncognito && !tab.pinned && Array.isArray(currentState.workspaces) && currentState.workspaces.length > 1) {
    const wsObj = currentState.workspaces.find((w) => w && w.id === (tab.workspaceId || 'default'));
    if (wsObj && wsObj.name) {
      badges.push({ cls: 'state', label: wsObj.name, title: `Workspace: ${wsObj.name}` });
    }
  }

  return { subText, badges };
}

function renderPerformanceTabList({ forceRebuild = false } = {}) {
  const container = document.getElementById('perfTabsList');
  if (!container) return;

  const tabs = Array.isArray(currentState.tabs) ? currentState.tabs : [];
  const tabStatsMap = lastSystemStats?.tabStats || {};
  const signature = tabs
    .map((t) => `${t.id}:${t.id === currentState.activeTabId ? 1 : 0}:${t.sleeping ? 1 : 0}`)
    .join('|');

  const canPatchInPlace = !forceRebuild && signature === lastPerfTabSignature && container.children.length === tabs.length;
  if (canPatchInPlace) {
    tabs.forEach((tab, idx) => {
      const row = container.children[idx];
      if (!row || row.dataset.tabId !== tab.id) return;
      const isCurrent = tab.id === currentState.activeTabId;
      const stat = tabStatsMap[tab.id] || null;
      const { subText, badges } = buildPerfTabMeta(tab, isCurrent, stat);
      const titleEl = row.querySelector('.row-title');
      if (titleEl && titleEl.textContent !== (tab.title || '')) {
        titleEl.textContent = tab.title || '';
      }
      const subEl = row.querySelector('.row-sub');
      if (subEl && subEl.textContent !== subText) {
        subEl.textContent = subText;
      }
      const badgesEl = row.querySelector('.gx-tab-badges');
      if (badgesEl) {
        if (!badges.length) {
          badgesEl.innerHTML = '';
          badgesEl.classList.add('hidden');
        } else {
          badgesEl.classList.remove('hidden');
          badgesEl.innerHTML = badges
            .map(
              (b) =>
                `<span class="gx-tab-badge ${b.cls}" title="${escapeHtml(b.title)}">${escapeHtml(b.label)}</span>`
            )
            .join('');
        }
      }
    });
    return;
  }

  const prevScrollTop = container.scrollTop;
  lastPerfTabSignature = signature;
  container.innerHTML = '';

  for (const tab of tabs) {
    const isCurrent = tab.id === currentState.activeTabId;
    const stat = tabStatsMap[tab.id] || null;
    const { subText, badges } = buildPerfTabMeta(tab, isCurrent, stat);
    const badgesHtml = badges
      .map((b) => `<span class="gx-tab-badge ${b.cls}" title="${escapeHtml(b.title)}">${escapeHtml(b.label)}</span>`)
      .join('');

    const row = document.createElement('div');
    row.className = 'list-row';
    row.dataset.tabId = tab.id;
    row.innerHTML = `
      <div class="row-main">
        <div class="row-title">${escapeHtml(tab.title)}</div>
        <div class="row-sub">${escapeHtml(subText)}</div>
        <div class="gx-tab-badges${badges.length ? '' : ' hidden'}">${badgesHtml}</div>
      </div>
      ${!isCurrent && !tab.sleeping
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
  container.scrollTop = prevScrollTop;
}

document.getElementById('btnSleepBackgroundTabs').addEventListener('click', async () => {
  const res = await window.gxAPI.sleepBackgroundTabs();
  showToast(`Hibernated ${res.sleptCount || 0} background tab(s)`);
  loadPerformancePanel();
});

// Hot Tab Killer (Opera GX-style): hibernate the single background tab
// using the most RAM, as measured in the last system-stats sample.
// The active tab, pinned tabs and audible tabs are never candidates —
// sleepTab itself also refuses the active tab.
document.getElementById('btnHotTabKiller')?.addEventListener('click', async () => {
  const tabStatsMap = lastSystemStats?.tabStats || {};
  const tabs = Array.isArray(currentState.tabs) ? currentState.tabs : [];
  let hungriest = null;
  let hungriestMB = -1;
  for (const tab of tabs) {
    if (!tab || tab.id === currentState.activeTabId || tab.sleeping || tab.pinned || tab.audible) continue;
    const stat = tabStatsMap[tab.id];
    const mb = stat && typeof stat.ramMB === 'number' ? stat.ramMB : -1;
    if (mb > hungriestMB) {
      hungriestMB = mb;
      hungriest = tab;
    }
  }
  if (!hungriest) {
    showToast('No hibernatable background tab with measured RAM');
    return;
  }
  await window.gxAPI.sleepTab(hungriest.id);
  showToast(`Hibernated hungriest tab: ${hungriest.title || 'Untitled'} (${hungriestMB >= 0 ? `${hungriestMB} MB` : 'unmeasured'})`);
  loadPerformancePanel();
});

function syncAutoSleepSegmentDisabled(enabled) {
  const seg = document.getElementById('autoSleepSegments');
  if (!seg) return;
  const isOn = Boolean(enabled);
  seg.classList.toggle('is-disabled', !isOn);
  seg.setAttribute('aria-disabled', isOn ? 'false' : 'true');
  seg.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.disabled = !isOn;
  });
}

document.getElementById('chkAutoSleep').addEventListener('change', (e) => {
  syncAutoSleepSegmentDisabled(e.target.checked);
  window.gxAPI.updateSettings({ autoSleepEnabled: e.target.checked });
});

document.querySelectorAll('#autoSleepSegments .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    const mins = Number(btn.dataset.mins);
    document.querySelectorAll('#autoSleepSegments .seg-btn').forEach((b) =>
      b.classList.toggle('active', Number(b.dataset.mins) === mins)
    );
    window.gxAPI.updateSettings({ autoSleepMinutes: mins });
  });
});

// 6. EASY SETUP / CONTROL CENTER
function syncEasySetupCheckboxes(s) {
  if (!s || typeof s !== 'object') return;
  const setChk = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(val);
  };
  setChk('chkBookmarksBar', s.showBookmarksBar !== false);
  setChk('chkForceDarkWeb', Boolean(s.forceDarkWeb));
  setChk('chkUiSounds', s.uiSoundsEnabled !== false);
  setChk('chkCloseLastTab', Boolean(s.closeWindowOnLastTab));
  setChk('chkEasyWallpaperEnabled', s.wallpaper?.type !== 'none');
  setChk('chkEasyColorizeSidebar', Boolean(s.colorizeSidebarIcons));
  setChk('chkEasyReduceAnimations', Boolean(s.reduceAnimations));
  setChk('chkEasyKeyboardSounds', Boolean(s.keyboardSoundsEnabled));
  setChk('chkEasyShowSidebar', s.showSidebar !== false);
  setChk('chkEasySpClock', s.startPageShowClock !== false);
  setChk('chkEasySpNames', s.startPageShowNames !== false);
  setChk('chkEasySpBigger', Boolean(s.startPageBiggerTiles));
  setChk('chkEasySpSuggestions', s.startPageShowSuggestions !== false);
  setChk('chkEasySpHideSearch', s.startPageShowSearch === false);
  setChk('chkEasyTrackerBlock', s.trackerBlockEnabled !== false);

  const activeWp = s.wallpaper?.type === 'preset' ? (s.wallpaper.preset || 'obsidian-wave') : '';
  document.querySelectorAll('[data-easy-wp]').forEach((btn) => {
    btn.classList.toggle('active', s.wallpaper?.type === 'preset' && btn.dataset.easyWp === activeWp);
  });
  document.querySelectorAll('#searchEngineSegments .seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.engine === (s.searchEngine || 'google'));
  });
}

async function loadEasySetupPanel() {
  const adStats = await window.gxAPI.getAdblockStats();
  renderAdblockStats(adStats);
  const s = await window.gxAPI.getSettings();
  syncEasySetupCheckboxes(s);
}

function updateAddressShieldAppearance() {
  const btn = document.getElementById('btnAddressShield');
  if (!btn) return;
  const active = currentState.activeTab;
  const isPaused = active
    ? active.adblockSiteEnabled === false
    : Boolean(lastAdblockStats && lastAdblockStats.enabled === false);
  btn.classList.toggle('paused', isPaused);
  btn.title = isPaused
    ? 'nextGx Privacy Shield — Paused on this site'
    : 'nextGx Privacy Shield — Ads & Trackers Blocked';
}

function renderAdblockStats(stats) {
  if (!stats) return;
  lastAdblockStats = stats;
  topBlockedCount.textContent = String(stats.sessionBlocked ?? 0);
  updateAddressShieldAppearance();
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

const chkBookmarksBarEl = document.getElementById('chkBookmarksBar');
if (chkBookmarksBarEl) {
  chkBookmarksBarEl.addEventListener('change', async (e) => {
    applyBookmarksBarVisibility(e.target.checked);
    await window.gxAPI.updateSettings({ showBookmarksBar: e.target.checked });
  });
}

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

const bindEasySettingToggle = (id, key, invert = false) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', async (e) => {
    window.gxSounds?.playClick();
    await window.gxAPI.updateSettings({ [key]: invert ? !e.target.checked : e.target.checked });
  });
};
bindEasySettingToggle('chkEasyColorizeSidebar', 'colorizeSidebarIcons');
bindEasySettingToggle('chkEasyReduceAnimations', 'reduceAnimations');
bindEasySettingToggle('chkEasyKeyboardSounds', 'keyboardSoundsEnabled');
bindEasySettingToggle('chkEasyShowSidebar', 'showSidebar');
bindEasySettingToggle('chkEasySpClock', 'startPageShowClock');
bindEasySettingToggle('chkEasySpNames', 'startPageShowNames');
bindEasySettingToggle('chkEasySpBigger', 'startPageBiggerTiles');
bindEasySettingToggle('chkEasySpSuggestions', 'startPageShowSuggestions');
bindEasySettingToggle('chkEasySpHideSearch', 'startPageShowSearch', true);

document.getElementById('chkEasyTrackerBlock')?.addEventListener('change', async (e) => {
  window.gxSounds?.playClick();
  await window.gxAPI.toggleTrackerBlock(e.target.checked);
});

document.getElementById('chkEasyWallpaperEnabled')?.addEventListener('change', async (e) => {
  window.gxSounds?.playClick();
  const cur = settingsState?.wallpaper || { type: 'preset', preset: 'obsidian-wave', file: '' };
  await window.gxAPI.updateSettings({
    wallpaper: e.target.checked
      ? { ...cur, type: cur.file ? 'custom' : 'preset', preset: cur.preset || 'obsidian-wave' }
      : { ...cur, type: 'none' }
  });
});

document.querySelectorAll('[data-easy-wp]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    window.gxSounds?.playClick();
    const preset = btn.dataset.easyWp;
    const cur = settingsState?.wallpaper || { type: 'preset', preset: '', file: '' };
    await window.gxAPI.updateSettings({ wallpaper: { ...cur, type: 'preset', preset } });
  });
});

const easyWpInput = document.getElementById('easyWallpaperFileInput');
document.getElementById('btnEasyAddWallpaper')?.addEventListener('click', () => {
  if (easyWpInput) {
    easyWpInput.value = '';
    easyWpInput.click();
  }
});
easyWpInput?.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file || !window.gxAPI.saveCustomWallpaper) return;
  try {
    const buf = await file.arrayBuffer();
    const res = await window.gxAPI.saveCustomWallpaper({
      name: file.name,
      type: file.type,
      bytes: new Uint8Array(buf)
    });
    if (res?.ok) showToast('Custom wallpaper applied');
    else showToast(res?.error || 'Could not apply wallpaper');
  } catch (_) {
    showToast('Could not read selected image');
  }
});

document.getElementById('btnEasyGearSettings')?.addEventListener('click', () => {
  window.gxSounds?.playClick();
  closeRightDrawer();
  window.gxAPI.createTab({ url: 'nextgx://settings', active: true });
});

document.getElementById('btnEasyClearData')?.addEventListener('click', () => {
  window.gxSounds?.playClick();
  closeRightDrawer();
  window.gxAPI.createTab({ url: 'nextgx://privacy', active: true });
});

function applyTheme(theme) {
  const resolved = theme || 'gx-violet';
  document.documentElement.setAttribute('data-theme', resolved);
  document.querySelectorAll('[data-theme-choice]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.themeChoice === resolved);
  });
}

const PINNED_EXT_FALLBACK_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4c-1.1 0-2 .9-2 2v3.8h1.5c1.5 0 2.7 1.2 2.7 2.7S5 16.2 3.5 16.2H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.5 1.2-2.7 2.7-2.7s2.7 1.2 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5a2.5 2.5 0 0 0 0-5z"/></svg>`;

function renderPinnedExtensions(pinnedList) {
  const container = document.getElementById('pinnedExtensions');
  if (!container) return;
  container.innerHTML = '';
  const items = Array.isArray(pinnedList)
    ? pinnedList.filter((item) => item && typeof item.id === 'string')
    : [];
  container.classList.toggle('hidden', items.length === 0);

  for (const ext of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toolbar-icon-btn pinned-ext-btn';
    btn.dataset.extId = ext.id;
    btn.title = ext.name || 'Extension';
    btn.setAttribute('aria-label', ext.name || 'Extension');

    if (ext.iconDataUrl) {
      const img = document.createElement('img');
      img.className = 'pinned-ext-icon';
      img.alt = '';
      img.draggable = false;
      img.src = ext.iconDataUrl;
      img.addEventListener('error', () => {
        btn.innerHTML = PINNED_EXT_FALLBACK_SVG;
      });
      btn.appendChild(img);
    } else {
      btn.innerHTML = PINNED_EXT_FALLBACK_SVG;
    }

    btn.addEventListener('click', () => {
      window.gxSounds?.playClick();
      window.gxAPI.triggerMenuAction(`extension-popup:${ext.id}`);
    });

    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.gxSounds?.playClick();
      window.gxAPI.triggerMenuAction(`extension-unpin:${ext.id}`);
      showToast(`Unpinned ${ext.name || 'extension'} from toolbar`);
    });

    container.appendChild(btn);
  }
}

function syncSettingsUI(s) {
  if (!s || typeof s !== 'object') return;
  settingsState = s;
  applyTheme(s.theme);
  renderPinnedExtensions(s.pinnedExtensions);

  window.gxSounds?.setConfig({
    enabled: s.uiSoundsEnabled !== false,
    volume: typeof s.uiSoundsVolume === 'number' ? s.uiSoundsVolume : 0.35
  });

  // [Fix2 integration] Battery saver: reduce shell motion while enabled.
  document.body.classList.toggle('battery-saver', Boolean(s.batterySaverEnabled));
  document.body.classList.toggle('reduce-animations', Boolean(s.reduceAnimations));
  document.body.classList.toggle('colorize-sidebar-icons', Boolean(s.colorizeSidebarIcons));
  document.body.classList.toggle('hide-left-sidebar', s.showSidebar === false);
  syncEasySetupCheckboxes(s);

  applySidebarVisibility(s.sidebarItems || {});
  if (!isResizingSidebarPanel && typeof s.sidebarPanelWidth === 'number') {
    sidebarPanelState.width = clampSidebarPanelWidth(s.sidebarPanelWidth);
  }
  if (typeof s.sidebarPanelPinned === 'boolean') {
    sidebarPanelState.pinned = Boolean(s.sidebarPanelPinned);
  }
  applySidebarPanelDOMState();
  applyBookmarksBarVisibility(s.showBookmarksBar !== false);

  const chkBm = document.getElementById('chkBookmarksBar');
  if (chkBm) chkBm.checked = s.showBookmarksBar !== false;
  const chkDark = document.getElementById('chkForceDarkWeb');
  if (chkDark) chkDark.checked = Boolean(s.forceDarkWeb);
  const chkSounds = document.getElementById('chkUiSounds');
  if (chkSounds) chkSounds.checked = s.uiSoundsEnabled !== false;
  const chkCloseLast = document.getElementById('chkCloseLastTab');
  if (chkCloseLast) chkCloseLast.checked = s.closeWindowOnLastTab !== false;
  const chkAutoSleep = document.getElementById('chkAutoSleep');
  const autoSleepEnabled = s.autoSleepEnabled !== false;
  if (chkAutoSleep) chkAutoSleep.checked = autoSleepEnabled;
  syncAutoSleepSegmentDisabled(autoSleepEnabled);
  syncGxLimitersUI(s);

  const btnHome = document.getElementById('btnHome');
  if (btnHome) {
    btnHome.title = s.homepageUrl ? `Home (${s.homepageUrl})` : 'Home (Start Page)';
    // [TABS-W2] Gap 5.1 — home button follows the worker-D setting
    // (showHomeButton; default ON when the key is absent).
    btnHome.classList.toggle('hidden', s.showHomeButton === false);
  }
  // [TABS-W2] Gap 5.1 / 8.1 — tab search chevron follows its setting
  // (showTabSearchButton; default ON when the key is absent).
  const btnTabSearchEl = document.getElementById('btnTabSearch');
  if (btnTabSearchEl) {
    btnTabSearchEl.classList.toggle('hidden', s.showTabSearchButton === false);
  }

  document.querySelectorAll('#searchEngineSegments .seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.engine === (s.searchEngine || 'google'));
  });
  document.querySelectorAll('#autoSleepSegments .seg-btn').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.mins) === Number(s.autoSleepMinutes || 10));
  });
}

document.querySelectorAll('[data-theme-choice]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    window.gxSounds?.playClick();
    const theme = btn.dataset.themeChoice;
    applyTheme(theme);
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
window.gxAPI.onSidebarUpdate?.((panelState) => applySidebarPanelState(panelState));
window.gxAPI.onPopoverData?.((data) => {
  if (data && data.closed) {
    tabContextMenuOpen = false;
    activeTabContextMode = null;
    omniboxSuggestLastUrls = '';
    omniboxSuggestItems = [];
    omniboxSuggestSelectedIdx = -1;
    siteInfoPopoverUrl = '';
    zoomPopoverUrl = '';
    if (openBookmarkFolderName) {
      openBookmarkFolderName = null;
      updateBookmarkFolderButtonsState();
    }
  }
});
window.gxAPI.onAdblockUpdate((stats) => renderAdblockStats(stats));
let prevHadActiveDownloads = false;
let dlJustDoneTimer = null;

function formatDlBytesCompact(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function updateToolbarDownloadProgress(list) {
  const items = Array.isArray(list) ? list : [];
  const active = items.filter((d) => d && (d.state === 'progressing' || d.state === 'paused'));
  const progressing = items.filter((d) => d && d.state === 'progressing');
  const btn = document.getElementById('btnTopDownloads');
  const dot = document.getElementById('dlActiveDot');
  const arc = document.getElementById('dlRingArc');
  const wave = document.getElementById('dlWaveFill');

  if (dot) dot.classList.toggle('hidden', progressing.length === 0);
  if (!btn) return;

  if (active.length > 0) {
    prevHadActiveDownloads = true;
    clearTimeout(dlJustDoneTimer);
    btn.classList.remove('dl-just-done');
    btn.classList.add('downloading');

    let sumReceived = 0;
    let sumTotal = 0;
    let sumSpeed = 0;
    for (const d of active) {
      sumReceived += Number(d.receivedBytes) || 0;
      sumTotal += Number(d.totalBytes) || 0;
      if (d.state === 'progressing') sumSpeed += Number(d.speedBytesPerSec) || 0;
    }

    const circumference = 72.26;
    if (sumTotal > 0) {
      const pct = Math.max(2, Math.min(100, Math.round((sumReceived / sumTotal) * 100)));
      btn.classList.remove('indeterminate');
      if (arc) arc.style.strokeDashoffset = String(circumference * (1 - pct / 100));
      if (wave) wave.style.setProperty('--dl-fill-pct', `${pct}%`);
      const speedPart = sumSpeed > 0 ? ` · ${formatDlBytesCompact(sumSpeed)}/s` : '';
      btn.title = `Downloading ${pct}% (${formatDlBytesCompact(sumReceived)} / ${formatDlBytesCompact(sumTotal)}${speedPart})`;
    } else {
      btn.classList.add('indeterminate');
      if (arc) arc.style.strokeDashoffset = String(circumference * 0.65);
      if (wave) wave.style.setProperty('--dl-fill-pct', '45%');
      btn.title = `Downloading (${formatDlBytesCompact(sumReceived)})`;
    }
  } else {
    btn.classList.remove('downloading', 'indeterminate');
    if (arc) arc.style.strokeDashoffset = '72.26';
    if (wave) wave.style.setProperty('--dl-fill-pct', '0%');
    btn.title = 'Downloads (Ctrl+J)';
    if (prevHadActiveDownloads) {
      prevHadActiveDownloads = false;
      const latestCompleted = items.find((d) => d && d.state === 'completed');
      if (latestCompleted) {
        btn.classList.add('dl-just-done');
        clearTimeout(dlJustDoneTimer);
        dlJustDoneTimer = setTimeout(() => btn.classList.remove('dl-just-done'), 3200);
      }
    }
  }
}

window.gxAPI.onDownloadsUpdate((list) => {
  cachedDownloads = list || [];
  updateToolbarDownloadProgress(cachedDownloads);
});
window.gxAPI.onSystemStats((stats) => renderSystemStats(stats));
window.gxAPI.onSettingsUpdate?.((s) => syncSettingsUI(s));
// [Fix2 integration] History updates must invalidate the omnibox
// suggestion cache, or new history stays invisible for up to 30 s.
window.gxAPI.onHistoryUpdate?.(() => {
  historyCache = null;
  historyCacheAt = 0;
});
window.gxAPI.onBookmarksUpdate?.((list) => renderBookmarksBar(list));
window.gxAPI.onProfilesUpdate?.((data) => renderProfileAvatar(data));
window.gxAPI.onFindResult?.((result) => updateFindMatchCount(result));
window.gxAPI.onPlayerUpdate?.((pState) => {
  playerHasPlayingMedia = Boolean(pState?.hasPlayingMedia);
  const btnPlayer = document.getElementById('btnSidebarPlayer');
  if (btnPlayer) {
    btnPlayer.classList.toggle('audible', playerHasPlayingMedia);
    const activeSrc = pState?.activeSource;
    btnPlayer.title =
      activeSrc && activeSrc.isPlaying
        ? `Player — Playing: ${activeSrc.title || activeSrc.sourceName || 'Media'}`
        : activeSrc
          ? `Player — Paused: ${activeSrc.title || activeSrc.sourceName || 'Media'}`
          : 'Player — Unified Media Controls';
  }
});

window.gxAPI.onToast((msg) => {
  if (msg && msg.includes('Screenshot')) {
    window.gxSounds?.playShutter();
    showToast(msg, { sound: false });
  } else {
    showToast(msg);
  }
});

// [TABS-W2] Gap 8.2/8.6 — main pushes mute state changes; mirror them and
// re-render so the speaker icon / tab-menu label update.
window.gxAPI.onTabMuteState?.(({ tabId, muted }) => {
  if (!tabId) return;
  tabMuteMap.set(tabId, Boolean(muted));
  renderTabs(currentState);
});
// [TABS-W2] Gap 1.5 — permission prompt opened/closed: show/hide the chip.
// On close, refresh the persistent site icons: the decision was just stored,
// so the icon for the granted/denied permission should appear immediately
// instead of waiting for the next tab switch.
window.gxAPI.onPermissionPromptState?.((state) => {
  activePermPrompt = state && state.open ? state : null;
  renderPermChip();
  if (state && !state.open) refreshSitePermIcons();
});

window.gxAPI.onShortcutAction((action) => {
  if (action === 'focus-address-bar') {
    addressInput.focus();
    addressInput.select();
  } else if (action === 'toggle-bookmark') {
    // [TABS-W2] Gap 7.4 — Ctrl+D opens the bookmark bubble now.
    openBookmarkBubble();
  } else if (action === 'open-find') {
    openFindBar();
  } else if (action === 'open-tab-search') {
    // [TABS-W2] Gap 8.1 — Ctrl+Shift+A.
    openTabSearchPopover();
  } else if (action === 'toggle-reader-mode') {
    // [TABS-W2] Gap 9.6 — Alt+Shift+R.
    window.gxAPI.toggleReaderModeExtract().then((res) => {
      if (res && res.ok) {
        showToast(res.active ? 'Reader View Enabled' : 'Reader View Off');
      } else if (res && res.error) {
        showToast(res.error);
      }
    });
  }
});

// Startup Initialization
(async () => {
  const params = new URLSearchParams(window.location.search);
  const isPrivateWin = params.get('incognito') === '1';
  if (isPrivateWin) {
    document.title = 'nextGx Private';
    document.documentElement.setAttribute('data-incognito', 'true');
    const brandText = document.querySelector('.nx-brand-text');
    if (brandText) brandText.innerHTML = 'next<strong>Gx</strong> Private';
    incognitoIndicator.classList.remove('hidden');
    if (workspacePills) workspacePills.classList.add('hidden');
  }
  const initialTheme = params.get('theme');
  if (initialTheme) {
    applyTheme(initialTheme);
  }
  const initialBmBar = params.get('bookmarksBar');
  if (initialBmBar !== null) {
    applyBookmarksBarVisibility(initialBmBar !== '0');
  }

  settingsState = await window.gxAPI.getSettings();
  syncSettingsUI(settingsState);

  // Fix2-shell (item 10): first-run card, once — never on later launches
  // (dismissing persists firstRunSeen) and never in Private windows.
  maybeShowFirstRunCard();

  if (window.gxAPI.getSidebarState) {
    const initialSidebar = await window.gxAPI.getSidebarState();
    applySidebarPanelState(initialSidebar);
  }

  if (window.gxAPI.getPlayerState) {
    const initialPlayer = await window.gxAPI.getPlayerState();
    playerHasPlayingMedia = Boolean(initialPlayer?.hasPlayingMedia);
    const btnPlayer = document.getElementById('btnSidebarPlayer');
    if (btnPlayer) {
      btnPlayer.classList.toggle('audible', playerHasPlayingMedia);
    }
  }

  const initialBookmarks = await window.gxAPI.getBookmarks();
  renderBookmarksBar(initialBookmarks);

  if (window.gxAPI.getActiveProfile) {
    const initialProfile = await window.gxAPI.getActiveProfile();
    renderProfileAvatar(initialProfile);
  }

  const adStats = await window.gxAPI.getAdblockStats();
  renderAdblockStats(adStats);

  cachedDownloads = await window.gxAPI.getDownloads();
  const hasActive = cachedDownloads.some((d) => d.state === 'progressing');
  document.getElementById('dlActiveDot').classList.toggle('hidden', !hasActive);
})();

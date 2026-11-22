const SIDEBAR_ICON_WIDTH = 50;
const TOP_CHROME_HEIGHT = 82;
const BOOKMARKS_BAR_HEIGHT = 30;
const FIND_BAR_HEIGHT = 38;
const LEFT_TOOL_WIDTH = 340;
const RIGHT_DRAWER_WIDTH = 360;
const SIDEBAR_PANEL_DEFAULT_WIDTH = 380;
const SIDEBAR_PANEL_MIN_WIDTH = 320;
const SIDEBAR_PANEL_MAX_WIDTH = 640;
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
let lastAdblockStats = null;
let lastSystemStats = null;
let cachedDownloads = [];
let cachedBookmarks = [];
let activeDlCategory = 'all';

let activeLeftTool = null;
let activeRightDrawer = null;
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

const rightDrawer = document.getElementById('rightDrawer');
const rightDrawerTitle = document.getElementById('rightDrawerTitle');
const findBar = document.getElementById('findBar');
const findInput = document.getElementById('findInput');
const findMatchCount = document.getElementById('findMatchCount');
const zoomValueText = document.getElementById('zoomValueText');
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

function showToast(msg, { sound = true } = {}) {
  if (!topToast) return;
  if (sound) window.gxSounds?.playNotification();
  topToast.textContent = msg;
  topToast.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => topToast.classList.add('hidden'), 2800);
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
  return Math.min(base, maxAvail);
}

function syncLayoutOffsets() {
  let left = SIDEBAR_ICON_WIDTH;
  if (activeLeftTool) {
    left += LEFT_TOOL_WIDTH;
  } else if (sidebarPanelState.open && sidebarPanelState.pinned) {
    left += getEffectiveSidebarPanelWidth(sidebarPanelState.width);
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
    top,
    right,
    bottom: 0
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
    } catch (_) {}
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

  if (openBookmarkFolderName && !folderGroups.has(openBookmarkFolderName)) {
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
  const isPrivate =
    Boolean(state?.windowIncognito) ||
    document.documentElement.getAttribute('data-incognito') === 'true';
  if (isPrivate) {
    workspacePills.classList.add('hidden');
    return;
  }
  workspacePills.classList.remove('hidden');

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
  if (inGroup) {
    el.dataset.groupId = group.id;
    el.dataset.groupColor = group.color || 'group-1';
  }
  if (splitRole) {
    el.dataset.splitPane = splitRole;
  }
  el.draggable = true;
  const splitTitlePrefix = splitRole ? `[Split ${splitRole === 'left' ? 'Left' : 'Right'}] ` : '';
  el.title = inGroup
    ? `${splitTitlePrefix}[${group.name}] ${tab.title}\n${tab.url}`
    : `${splitTitlePrefix}${tab.title}\n${tab.url}`;

  const iconHtml = tab.favicon
    ? `<img class="tab-favicon" draggable="false" src="${escapeHtml(tab.favicon)}" alt="" onerror="this.style.display='none'" />`
    : `<svg class="tab-favicon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8"/></svg>`;

  const splitSvg = splitRole
    ? `<span class="tab-split-badge" title="Split view (${splitRole === 'left' ? 'Left' : 'Right'} pane)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/>${
        splitRole === 'left'
          ? '<rect x="4.5" y="5.5" width="7" height="13" rx="1" fill="currentColor" stroke="none"/>'
          : '<rect x="12.5" y="5.5" width="7" height="13" rx="1" fill="currentColor" stroke="none"/>'
      }<line x1="12" y1="4" x2="12" y2="20"/></svg></span>`
    : '';

  const audioSvg = tab.audible
    ? `<svg class="tab-audio-svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`
    : '';

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
      ${audioSvg}
      ${sleepSvg}
      <span class="tab-title">${escapeHtml(tab.title || 'Start Page')}</span>
      <button class="tab-close-btn" draggable="false" title="Close (Ctrl+W)">${closeSvg}</button>
    `;
  }

  el.addEventListener('dragstart', (e) => {
    if (e.target && e.target.closest && e.target.closest('.tab-close-btn')) {
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
    tabContextMenuOpen = true;
    activeTabContextMode = 'tab';
    window.gxAPI.openPopover({
      kind: 'tab-context',
      x: Math.round(e.clientX),
      y: Math.round(Math.max(36, e.clientY)),
      width: 224,
      height: 240,
      payload: {
        contextType: 'tab',
        id: tab.id,
        pinned: Boolean(tab.pinned),
        sleeping: Boolean(tab.sleeping),
        hasPlayingVideo: Boolean(tab.hasPlayingVideo),
        pipActive: Boolean(tab.pipActive),
        videoTitle: tab.videoTitle || '',
        isActive: tab.id === state.activeTabId,
        splitActive: Boolean(state.split),
        splitVisible: Boolean(state.split && state.split.visible),
        isSplitPane: Boolean(
          state.split && (tab.id === state.split.leftTabId || tab.id === state.split.rightTabId)
        ),
        splitPaneSide: state.split
          ? tab.id === state.split.leftTabId
            ? 'left'
            : tab.id === state.split.rightTabId
            ? 'right'
            : null
          : null,
        splitFocusedPane: state.split?.focusedPane || null,
        groupId: tab.pinned ? null : tab.groupId || null,
        groupName: group ? group.name : '',
        workspaceId: tab.workspaceId || 'default',
        groups: activeWsGroupsList,
        workspaces: state.windowIncognito ? [] : state.workspaces || [],
        windowIncognito: Boolean(state.windowIncognito),
        canCloseOthers: otherClosableCount > 0,
        totalTabs: state.tabs.length
      }
    });
  });

  el.addEventListener('click', (e) => {
    if (Date.now() < suppressTabClickUntil || draggedTabId) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.target.closest('.tab-close-btn')) {
      e.stopPropagation();
      window.gxSounds?.playTabClose();
      window.gxAPI.closeTab(tab.id);
      return;
    }
    userScrolledTabStrip = false;
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
    ? `${group.name} (${groupTabs.length} ${groupTabs.length === 1 ? 'tab' : 'tabs'})${
        activeTabInGroup ? ` • Active: ${activeTabInGroup.title}` : ''
      } — Click to expand, right-click to edit`
    : `${group.name} (${groupTabs.length} ${groupTabs.length === 1 ? 'tab' : 'tabs'}) — Click to collapse, right-click to edit`;

  pill.innerHTML = `
    <span class="group-dot"></span>
    <span class="group-name">${escapeHtml(group.name || 'Group')}</span>
    <span class="group-count">${groupTabs.length}</span>
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
  renderWorkspaces(state);
  tabsContainer.innerHTML = '';

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

  let activeTabEl = null;
  let activeCollapsedPillEl = null;

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
      if (groupTabs.some((t) => t.id === state.activeTabId)) {
        activeCollapsedPillEl = pillEl;
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
    });
  }

  const active = state.activeTab;
  if (active) {
    btnBack.disabled = !active.canGoBack;
    btnForward.disabled = !active.canGoForward;
    btnReload.classList.toggle('spinning', Boolean(active.isLoading));
    btnReload.title = active.isLoading ? 'Stop loading' : 'Reload (Ctrl+R)';

    if (document.activeElement !== addressInput || !document.hasFocus() || activeChanged) {
      addressInput.value = active.url === 'nextgx://newtab' ? '' : active.url;
    }

    btnSiteSecurity.classList.toggle('insecure', Boolean(active.isHttpInsecure));
    secNotSecureLabel.classList.toggle('hidden', !active.isHttpInsecure);

    incognitoIndicator.classList.toggle('hidden', !active.incognito);
    btnBookmarkStar.classList.toggle('active', Boolean(active.isBookmarked));
    btnReaderMode.classList.toggle('active', Boolean(active.readerMode));
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

  document.querySelectorAll('[data-sidebar-tab]').forEach((btn) => {
    const targetUrl = btn.dataset.sidebarTab || '';
    const isActive = Boolean(active && targetUrl && active.url === targetUrl);
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });

  if (activeLeftTool === 'gxControl') {
    renderPerformanceTabList();
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

window.addEventListener('resize', () => {
  updateTabScrollButtons();
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
    width: 316,
    height: 388,
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
    } catch (_) {}
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
    } catch (_) {}
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
  const rect = document.getElementById('btnScreenshot').getBoundingClientRect();
  window.gxAPI.openPopover({
    kind: 'screenshot',
    x: rect.right - 224,
    y: TOP_CHROME_HEIGHT + 2,
    width: 224,
    height: 86
  });
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
    } catch (_) {}
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

// Window Controls
document.getElementById('btnWinMin').addEventListener('click', () => window.gxAPI.minimizeWindow());
document.getElementById('btnWinMax').addEventListener('click', () => window.gxAPI.maximizeWindow());
document.getElementById('btnWinClose').addEventListener('click', () => window.gxAPI.closeWindow());

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

// 2. SIDEBAR OVERLAY PANEL & GX LEFT RAIL
const SERVICE_META_BY_KEY = {};
const INTERNAL_PANEL_ICONS = {
  player: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="color:var(--nx-accent-bright);"><circle cx="12" cy="12" r="9"/><polygon points="10 8.5 16 12 10 15.5 10 8.5" fill="currentColor" stroke="none"/></svg>`
};
let playerHasPlayingMedia = false;

document.querySelectorAll('[data-service-url]').forEach((btn) => {
  const url = btn.dataset.serviceUrl;
  const key = btn.dataset.sidebarItem;
  const title = btn.getAttribute('title') || key || 'Service';
  if (SERVICE_LOGOS[url]) {
    btn.innerHTML = SERVICE_LOGOS[url];
  }
  if (key) {
    SERVICE_META_BY_KEY[key] = { key, url, title, logoHtml: SERVICE_LOGOS[url] || '' };
  }
  btn.addEventListener('click', () => {
    toggleSidebarService(key || url);
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
  });
});

document.querySelectorAll('[data-sidebar-tab]').forEach((btn) => {
  const targetUrl = btn.dataset.sidebarTab;
  if (!targetUrl) return;
  btn.addEventListener('click', () => {
    window.gxSounds?.playTabOpen();
    window.gxAPI.closePopover();
    window.gxAPI.createTab({ url: targetUrl, active: true });
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

// Sidebar Panel Right-Edge Drag-to-Resize (320px – 640px, persisted on release)
let sidebarResizeStartX = 0;
let sidebarResizeStartWidth = SIDEBAR_PANEL_DEFAULT_WIDTH;
let activeSidebarPointerId = null;

function beginSidebarPanelResize(clientX, pointerId = null) {
  if (isResizingSidebarPanel) return;
  isResizingSidebarPanel = true;
  sidebarResizeStartWidth = getEffectiveSidebarPanelWidth(sidebarPanelState.width);
  sidebarResizeStartX = typeof clientX === 'number' ? clientX : SIDEBAR_ICON_WIDTH + sidebarResizeStartWidth;
  activeSidebarPointerId = pointerId;
  sidebarPanelResizer?.classList.add('dragging');
  sidebarPanel?.classList.add('resizing');
  if (pointerId !== null && sidebarPanelResizer?.setPointerCapture) {
    try {
      sidebarPanelResizer.setPointerCapture(pointerId);
    } catch (_) {}
  }
}

function updateSidebarPanelResize(clientX) {
  if (!isResizingSidebarPanel || typeof clientX !== 'number') return;
  const delta = clientX - sidebarResizeStartX;
  const nextWidth = getEffectiveSidebarPanelWidth(sidebarResizeStartWidth + delta);
  if (nextWidth !== sidebarPanelState.width) {
    sidebarPanelState.width = nextWidth;
    applySidebarPanelDOMState();
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
    } catch (_) {}
  }
  activeSidebarPointerId = null;
  const finalWidth = getEffectiveSidebarPanelWidth(sidebarPanelState.width);
  sidebarPanelState.width = finalWidth;
  applySidebarPanelDOMState();
  syncLayoutOffsets();
  window.gxAPI.setSidebarWidth(finalWidth, { persist: true });
}

if (sidebarPanelResizer) {
  sidebarPanelResizer.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
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
    if (findBarOpen && document.activeElement === findInput) return;
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
  if (sidebarPanelState.open) applySidebarPanelDOMState();
  syncLayoutOffsets();
}

function closeRightDrawer() {
  activeRightDrawer = null;
  rightDrawer.classList.add('hidden');
  if (sidebarPanelState.open) applySidebarPanelDOMState();
  syncLayoutOffsets();
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
    findMatchCount.textContent = `${active} / ${matches}`;
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
  container.scrollTop = prevScrollTop;
}

document.getElementById('btnSleepBackgroundTabs').addEventListener('click', async () => {
  const res = await window.gxAPI.sleepBackgroundTabs();
  showToast(`Hibernated ${res.sleptCount || 0} background tab(s)`);
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

// 6. CONTROL CENTER
async function loadEasySetupPanel() {
  const adStats = await window.gxAPI.getAdblockStats();
  renderAdblockStats(adStats);
  const s = await window.gxAPI.getSettings();
  const chkBm = document.getElementById('chkBookmarksBar');
  if (chkBm) chkBm.checked = s.showBookmarksBar !== false;
  document.getElementById('chkForceDarkWeb').checked = Boolean(s.forceDarkWeb);
  document.getElementById('chkUiSounds').checked = s.uiSoundsEnabled !== false;
  document.getElementById('chkCloseLastTab').checked = s.closeWindowOnLastTab !== false;
  document.querySelectorAll('#searchEngineSegments .seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.engine === (s.searchEngine || 'google'));
  });
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
    if (openBookmarkFolderName) {
      openBookmarkFolderName = null;
      updateBookmarkFolderButtonsState();
    }
  }
});
window.gxAPI.onAdblockUpdate((stats) => renderAdblockStats(stats));
window.gxAPI.onDownloadsUpdate((list) => {
  cachedDownloads = list || [];
  const hasActive = cachedDownloads.some((d) => d.state === 'progressing');
  document.getElementById('dlActiveDot').classList.toggle('hidden', !hasActive);
});
window.gxAPI.onSystemStats((stats) => renderSystemStats(stats));
window.gxAPI.onSettingsUpdate?.((s) => syncSettingsUI(s));
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

window.gxAPI.onShortcutAction((action) => {
  if (action === 'focus-address-bar') {
    addressInput.focus();
    addressInput.select();
  } else if (action === 'toggle-bookmark') {
    window.gxAPI.toggleBookmark().then((res) => {
      if (res) showToast(res.added ? 'Saved to Bookmarks' : 'Removed from Bookmarks');
    });
  } else if (action === 'open-find') {
    openFindBar();
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

const SIDEBAR_ICON_WIDTH = 50;
const TOP_CHROME_HEIGHT = 82;
const BOOKMARKS_BAR_HEIGHT = 30;
const FIND_BAR_HEIGHT = 38;
const LEFT_TOOL_WIDTH = 340;
const RIGHT_DRAWER_WIDTH = 360;

let currentState = { tabs: [], activeTabId: null, activeTab: null };
let settingsState = {};
let lastAdblockStats = null;
let cachedDownloads = [];
let cachedBookmarks = [];
let activeDlCategory = 'all';

let activeLeftTool = null;
let activeRightDrawer = null;
let findBarOpen = false;
let bookmarksBarVisible = true;
let openBookmarkFolderName = null;

const topChrome = document.getElementById('topChrome');
const bookmarksBar = document.getElementById('bookmarksBar');
const bookmarksBarItems = document.getElementById('bookmarksBarItems');
const btnBookmarksManager = document.getElementById('btnBookmarksManager');
const tabsContainer = document.getElementById('tabsContainer');
const btnTabsScrollLeft = document.getElementById('btnTabsScrollLeft');
const btnTabsScrollRight = document.getElementById('btnTabsScrollRight');
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
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
let lastRenderedActiveTabId = null;
let lastRenderedTabCount = 0;
let userScrolledTabStrip = false;

function clearTabDropIndicators() {
  tabsContainer.querySelectorAll('.nx-tab.drop-before, .nx-tab.drop-after').forEach((el) => {
    el.classList.remove('drop-before', 'drop-after');
  });
}

function getDropPositionForTab(el, targetTabId, sourceTabId, clientX, clientY) {
  if (clientX === 0 && clientY === 0 && sourceTabId) {
    const srcIdx = currentState.tabs.findIndex((t) => t.id === sourceTabId);
    const dstIdx = currentState.tabs.findIndex((t) => t.id === targetTabId);
    if (srcIdx !== -1 && dstIdx !== -1) {
      return srcIdx < dstIdx ? 'after' : 'before';
    }
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && clientX > rect.left + rect.width / 2 ? 'after' : 'before';
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

// 1. RENDER TABS & TOP BAR (Zero Emojis — Crisp SVGs only)
function renderTabs(state) {
  if (draggedTabId) {
    pendingStateDuringDrag = state;
    return;
  }

  const prevScrollLeft = tabsContainer.scrollLeft;
  const activeChanged = state.activeTabId !== lastRenderedActiveTabId;
  const countChanged = state.tabs.length !== lastRenderedTabCount;
  if (activeChanged || countChanged) {
    userScrolledTabStrip = false;
  }
  lastRenderedActiveTabId = state.activeTabId;
  lastRenderedTabCount = state.tabs.length;

  currentState = state;
  tabsContainer.innerHTML = '';

  let activeTabEl = null;

  for (const tab of state.tabs) {
    const el = document.createElement('div');
    const isActive = tab.id === state.activeTabId;
    el.className = [
      'nx-tab',
      isActive ? 'active' : '',
      tab.pinned ? 'pinned' : '',
      tab.incognito ? 'incognito' : '',
      tab.sleeping ? 'sleeping' : ''
    ]
      .filter(Boolean)
      .join(' ');

    el.dataset.tabId = tab.id;
    el.draggable = true;
    el.title = `${tab.title}\n${tab.url}`;

    const iconHtml = tab.favicon
      ? `<img class="tab-favicon" draggable="false" src="${escapeHtml(tab.favicon)}" alt="" onerror="this.style.display='none'" />`
      : `<svg class="tab-favicon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8"/></svg>`;

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
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-nextgx-tab-id', tab.id);
        e.dataTransfer.setData('text/plain', tab.id);
      }
    });

    el.addEventListener('dragover', (e) => {
      const hasTabType =
        draggedTabId ||
        (e.dataTransfer &&
          e.dataTransfer.types &&
          (e.dataTransfer.types.includes('application/x-nextgx-tab-id') ||
            e.dataTransfer.types.includes('text/plain')));
      if (!hasTabType) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      clearTabDropIndicators();
      if (draggedTabId === tab.id) return;

      const sourceTab = currentState.tabs.find((t) => t.id === draggedTabId);
      if (sourceTab && Boolean(sourceTab.pinned) !== Boolean(tab.pinned)) {
        return;
      }
      const pos = getDropPositionForTab(el, tab.id, draggedTabId, e.clientX, e.clientY);
      el.classList.add(pos === 'after' ? 'drop-after' : 'drop-before');
    });

    el.addEventListener('dragleave', () => {
      el.classList.remove('drop-before', 'drop-after');
    });

    el.addEventListener('drop', (e) => {
      const sourceId =
        draggedTabId ||
        e.dataTransfer?.getData('application/x-nextgx-tab-id') ||
        e.dataTransfer?.getData('text/plain');
      if (!sourceId) return;
      e.preventDefault();
      e.stopPropagation();

      didDropTab = true;
      suppressTabClickUntil = Date.now() + 300;
      const pos = getDropPositionForTab(el, tab.id, sourceId, e.clientX, e.clientY);
      draggedTabId = null;
      pendingStateDuringDrag = null;
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
      window.gxAPI.openPopover({
        kind: 'tab-context',
        x: Math.round(e.clientX),
        y: Math.round(Math.max(36, e.clientY)),
        width: 224,
        height: 222,
        payload: {
          id: tab.id,
          pinned: Boolean(tab.pinned),
          sleeping: Boolean(tab.sleeping),
          isActive: tab.id === state.activeTabId,
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

    tabsContainer.appendChild(el);
    if (isActive) activeTabEl = el;
  }

  tabsContainer.scrollLeft = prevScrollLeft;
  updateTabScrollButtons();
  if (activeTabEl && !userScrolledTabStrip) {
    scrollActiveTabIntoView(activeTabEl);
    updateTabScrollButtons();
    requestAnimationFrame(() => {
      const currentActive = tabsContainer.querySelector('.nx-tab.active');
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

    if (document.activeElement !== addressInput) {
      addressInput.value = active.url === 'nextgx://newtab' ? '' : active.url;
    }

    btnSiteSecurity.classList.toggle('insecure', Boolean(active.isHttpInsecure));
    secNotSecureLabel.classList.toggle('hidden', !active.isHttpInsecure);

    incognitoIndicator.classList.toggle('hidden', !active.incognito);
    btnBookmarkStar.classList.toggle('active', Boolean(active.isBookmarked));
    btnReaderMode.classList.toggle('active', Boolean(active.readerMode));
  }

  updateAddressShieldAppearance();

  if (activeLeftTool === 'gxControl') {
    renderPerformanceTabList();
  }
}

// Tab Strip Container Drag Drop (empty gap / right edge fallback) & Scroll Controls
tabsContainer.addEventListener('dragover', (e) => {
  if (!draggedTabId) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
});

tabsContainer.addEventListener('drop', (e) => {
  const sourceId =
    draggedTabId ||
    e.dataTransfer?.getData('application/x-nextgx-tab-id') ||
    e.dataTransfer?.getData('text/plain');
  if (!sourceId) return;
  e.preventDefault();
  didDropTab = true;
  suppressTabClickUntil = Date.now() + 300;
  draggedTabId = null;
  pendingStateDuringDrag = null;
  clearTabDropIndicators();

  const tabEls = Array.from(tabsContainer.querySelectorAll('.nx-tab'));
  const targetEl = tabEls.find((el) => {
    const r = el.getBoundingClientRect();
    return e.clientX <= r.left + r.width / 2;
  });
  if (targetEl && targetEl.dataset.tabId && targetEl.dataset.tabId !== sourceId) {
    window.gxAPI.reorderTab({ tabId: sourceId, targetTabId: targetEl.dataset.tabId, position: 'before' });
  } else if (tabEls.length) {
    const lastId = tabEls[tabEls.length - 1].dataset.tabId;
    if (lastId && lastId !== sourceId) {
      window.gxAPI.reorderTab({ tabId: sourceId, targetTabId: lastId, position: 'after' });
    }
  }
});

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
    if (e.button === 2 && e.target && e.target.closest && e.target.closest('.nx-tab')) {
      return;
    }
    tabContextMenuOpen = false;
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
    height: 410,
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
  window.gxSounds?.playClick();
  const rect = document.getElementById('btnAddressShield').getBoundingClientRect();
  const active = currentState.activeTab || {};
  window.gxAPI.openPopover({
    kind: 'shield',
    x: rect.right - 310,
    y: TOP_CHROME_HEIGHT + 2,
    width: 310,
    height: 315,
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

// 2. SIDEBAR SERVICE BUTTONS (Always open in a brand-new active tab)
document.querySelectorAll('[data-service-url]').forEach((btn) => {
  const url = btn.dataset.serviceUrl;
  if (SERVICE_LOGOS[url]) {
    btn.innerHTML = SERVICE_LOGOS[url];
  }
  btn.addEventListener('click', () => {
    window.gxSounds?.playTabOpen();
    window.gxAPI.closePopover();
    window.gxAPI.createTab({ url, active: true });
  });
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

function syncSettingsUI(s) {
  if (!s || typeof s !== 'object') return;
  settingsState = s;
  applyTheme(s.theme);

  window.gxSounds?.setConfig({
    enabled: s.uiSoundsEnabled !== false,
    volume: typeof s.uiSoundsVolume === 'number' ? s.uiSoundsVolume : 0.35
  });

  document.querySelectorAll('.ws-pill').forEach((p) => {
    p.classList.toggle('active', p.dataset.ws === (s.workspace || 'Personal'));
  });

  applySidebarVisibility(s.sidebarItems || {});
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
  if (chkAutoSleep) chkAutoSleep.checked = s.autoSleepEnabled !== false;

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
window.gxAPI.onPopoverData?.((data) => {
  if (data && data.closed) {
    tabContextMenuOpen = false;
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

window.gxAPI.onToast((msg) => {
  if (msg && msg.includes('Screenshot')) window.gxSounds?.playShutter();
  showToast(msg);
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
    document.documentElement.setAttribute('data-incognito', 'true');
    const brandText = document.querySelector('.nx-brand-text');
    if (brandText) brandText.innerHTML = 'next<strong>Gx</strong> Private';
    incognitoIndicator.classList.remove('hidden');
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

  const initialBookmarks = await window.gxAPI.getBookmarks();
  renderBookmarksBar(initialBookmarks);

  const adStats = await window.gxAPI.getAdblockStats();
  renderAdblockStats(adStats);

  cachedDownloads = await window.gxAPI.getDownloads();
  const hasActive = cachedDownloads.some((d) => d.state === 'progressing');
  document.getElementById('dlActiveDot').classList.toggle('hidden', !hasActive);
})();

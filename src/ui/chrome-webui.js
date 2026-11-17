const mainContainer = document.getElementById('mainContainer');
const pageHeaderTitle = document.getElementById('pageHeaderTitle');
const globalSearchInput = document.getElementById('globalSearchInput');
const topRightActions = document.getElementById('topRightActions');

let currentPage = 'history';
let searchQuery = '';
let dlFilterCat = 'all';

const SVG_GLOBE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#938da9" stroke-width="2" style="flex-shrink:0;"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8"/></svg>`;
const SVG_DOWNLOAD = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
const SVG_STAR = `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" style="color:var(--accent-bright);flex-shrink:0;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
const SVG_SHIELD = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
const SVG_MUSIC = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
const SVG_PUZZLE = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4c-1.1 0-2 .9-2 2v3.8h1.5c1.5 0 2.7 1.2 2.7 2.7S5 16.2 3.5 16.2H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.5 1.2-2.7 2.7-2.7s2.7 1.2 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5a2.5 2.5 0 0 0 0-5z"/></svg>`;

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

function switchPage(page) {
  currentPage = page;
  window.location.hash = page;

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

  if (currentPage === 'history') await renderHistoryPage();
  else if (currentPage === 'downloads') await renderDownloadsPage();
  else if (currentPage === 'bookmarks') await renderBookmarksPage();
  else if (currentPage === 'passwords') await renderPasswordsPage();
  else if (currentPage === 'extensions') await renderExtensionsPage();
  else if (currentPage === 'settings') await renderSettingsPage();
}

// 1. HISTORY (Today / Yesterday / Older Grouping + Favicons + Time Range Clear)
async function renderHistoryPage() {
  const list = await window.gxChromePagesAPI.getHistory();
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

  const filtered = (list || []).filter(
    (h) =>
      !searchQuery ||
      (h.title && h.title.toLowerCase().includes(searchQuery)) ||
      (h.url && h.url.toLowerCase().includes(searchQuery))
  );

  if (!filtered.length) {
    mainContainer.innerHTML = `<div class="section-card"><div class="empty-state">Your browsing history appears here.</div></div>`;
    return;
  }

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

  let html = '';
  for (const [label, items] of Object.entries(groups)) {
    if (!items.length) continue;
    let rowsHtml = '';
    for (const item of items) {
      const timeStr = new Date(item.visitedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const favHtml = item.favicon
        ? `<img src="${escapeHtml(item.favicon)}" width="16" height="16" style="border-radius:3px;flex-shrink:0;" onerror="this.style.display='none'" />`
        : SVG_GLOBE;
      rowsHtml += `
        <div class="card-row" data-id="${escapeHtml(item.id)}">
          <span style="color:var(--text-secondary);font-size:12px;min-width:65px;">${timeStr}</span>
          ${favHtml}
          <div class="row-info">
            <div class="row-title open-link" data-url="${escapeHtml(item.url)}">${escapeHtml(item.title)}</div>
            <div class="row-sub">${escapeHtml(item.url)}</div>
          </div>
          <button class="btn danger del-item">Delete</button>
        </div>
      `;
    }
    html += `
      <div class="section-card">
        <div class="card-header"><h2>${label} (${items.length})</h2></div>
        ${rowsHtml}
      </div>
    `;
  }

  mainContainer.innerHTML = html;

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
async function renderDownloadsPage() {
  const list = await window.gxChromePagesAPI.getDownloads();
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

  mainContainer.innerHTML = `<div class="section-card"><div class="card-header"><h2>Downloads (${filtered.length})</h2></div>${rowsHtml}</div>`;

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

// 3. BOOKMARKS
async function renderBookmarksPage() {
  const list = await window.gxChromePagesAPI.getBookmarks();
  const filtered = (list || []).filter(
    (b) =>
      !searchQuery ||
      (b.title && b.title.toLowerCase().includes(searchQuery)) ||
      (b.url && b.url.toLowerCase().includes(searchQuery))
  );

  if (!filtered.length) {
    mainContainer.innerHTML = `<div class="section-card"><div class="empty-state">No bookmarks saved yet.</div></div>`;
    return;
  }

  let rowsHtml = '';
  for (const bm of filtered) {
    rowsHtml += `
      <div class="card-row" data-id="${escapeHtml(bm.id)}">
        ${SVG_STAR}
        <div class="row-info">
          <div class="row-title open-bm" data-url="${escapeHtml(bm.url)}">${escapeHtml(bm.title)}</div>
          <div class="row-sub">${escapeHtml(bm.url)}</div>
        </div>
        <button class="btn danger del-bm">Remove</button>
      </div>
    `;
  }

  mainContainer.innerHTML = `<div class="section-card"><div class="card-header"><h2>Saved Bookmarks (${filtered.length})</h2></div>${rowsHtml}</div>`;

  mainContainer.querySelectorAll('.open-bm').forEach((el) => {
    el.addEventListener('click', () => window.gxChromePagesAPI.navigate(el.dataset.url));
  });
  mainContainer.querySelectorAll('.del-bm').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.closest('.card-row').dataset.id;
      await window.gxChromePagesAPI.removeBookmark(id);
      renderBookmarksPage();
    });
  });
}

// 4. PASSWORDS & AUTOFILL
async function renderPasswordsPage() {
  const list = await window.gxChromePagesAPI.getPasswords();
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
        <h2>Add Website Login (Auto-Fills on Matching Sites)</h2>
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
        <h2>Saved Logins (${filtered.length})</h2>
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
async function renderExtensionsPage() {
  topRightActions.innerHTML = `
    <span style="color:var(--text-secondary);">Developer Mode</span>
    <label class="nx-switch">
      <input type="checkbox" checked />
      <span class="nx-slider"></span>
    </label>
    <button class="btn primary" id="btnLoadUnpacked">+ Load Unpacked</button>
  `;

  document.getElementById('btnLoadUnpacked').addEventListener('click', async () => {
    await window.gxChromePagesAPI.loadUnpackedExtension();
    renderExtensionsPage();
  });

  const userExts = (await window.gxChromePagesAPI.getExtensions()) || [];
  const adStats = await window.gxChromePagesAPI.getAdblockStats();

  const builtInHtml = `
    <div class="ext-card">
      <div class="ext-top">
        <div class="ext-icon">${SVG_SHIELD}</div>
        <div class="row-info">
          <div style="font-weight:600;font-size:14.5px;">nextGx Privacy Shield <span style="font-size:11px;color:var(--text-secondary);">2.5.0</span></div>
          <div class="row-sub" style="white-space:normal;margin-top:4px;">Blocks intrusive ads, popups & analytics trackers at the Chromium network layer (${adStats?.totalBlocked || 0} blocked).</div>
        </div>
      </div>
      <div class="ext-bottom">
        <span style="font-size:11.5px;color:#34d399;font-weight:600;">Built-in System Module</span>
        <label class="nx-switch">
          <input type="checkbox" id="extAdblockToggle" ${adStats?.enabled !== false ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
    </div>

    <div class="ext-card">
      <div class="ext-top">
        <div class="ext-icon">${SVG_MUSIC}</div>
        <div class="row-info">
          <div style="font-weight:600;font-size:14.5px;">nextGx Media & AI Overlay <span style="font-size:11px;color:var(--text-secondary);">2.5.0</span></div>
          <div class="row-sub" style="white-space:normal;margin-top:4px;">Floating overlay dock with dropdown switcher for YouTube Music, Spotify, Apple Music, SoundCloud & ChatGPT.</div>
        </div>
      </div>
      <div class="ext-bottom">
        <span style="font-size:11.5px;color:#34d399;font-weight:600;">Built-in System Module</span>
        <label class="nx-switch">
          <input type="checkbox" checked disabled />
          <span class="nx-slider"></span>
        </label>
      </div>
    </div>
  `;

  let userExtsHtml = '';
  for (const ext of userExts) {
    userExtsHtml += `
      <div class="ext-card">
        <div class="ext-top">
          <div class="ext-icon">${SVG_PUZZLE}</div>
          <div class="row-info">
            <div style="font-weight:600;font-size:14.5px;">${escapeHtml(ext.name)} <span style="font-size:11px;color:var(--text-secondary);">${escapeHtml(ext.version || '1.0')}</span></div>
            <div class="row-sub" style="white-space:normal;margin-top:4px;">ID: ${escapeHtml(ext.id)}</div>
          </div>
        </div>
        <div class="ext-bottom">
          <button class="btn danger remove-ext" data-id="${escapeHtml(ext.id)}">Remove</button>
          <label class="nx-switch">
            <input type="checkbox" checked disabled />
            <span class="nx-slider"></span>
          </label>
        </div>
      </div>
    `;
  }

  mainContainer.innerHTML = `<div class="ext-grid">${builtInHtml}${userExtsHtml}</div>`;

  const toggle = document.getElementById('extAdblockToggle');
  if (toggle) {
    toggle.addEventListener('change', async (e) => {
      await window.gxChromePagesAPI.toggleAdblock(e.target.checked);
    });
  }

  mainContainer.querySelectorAll('.remove-ext').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await window.gxChromePagesAPI.removeExtension(btn.dataset.id);
      renderExtensionsPage();
    });
  });
}

// 6. SETTINGS
async function renderSettingsPage() {
  const s = await window.gxChromePagesAPI.getSettings();
  const sys = await window.gxChromePagesAPI.getSystemStats();
  const ad = await window.gxChromePagesAPI.getAdblockStats();

  mainContainer.innerHTML = `
    <div class="section-card">
      <div class="card-header"><h2>Appearance, Sound & Behavior</h2></div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">nextGx Theme</div>
          <div class="row-sub">Choose your browser accent</div>
        </div>
        <div class="nx-segmented" id="setThemeSeg">
          <button class="seg-btn ${s.theme === 'gx-violet' ? 'active' : ''}" data-theme="gx-violet">nextGx Violet</button>
          <button class="seg-btn ${s.theme === 'crimson' ? 'active' : ''}" data-theme="crimson">Crimson</button>
          <button class="seg-btn ${s.theme === 'cyan' ? 'active' : ''}" data-theme="cyan">Cyber Cyan</button>
          <button class="seg-btn ${s.theme === 'emerald' ? 'active' : ''}" data-theme="emerald">Emerald</button>
        </div>
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
      <div class="card-header"><h2>Search Engine</h2></div>
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
      <div class="card-header"><h2>Privacy Shield & Security</h2></div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">nextGx Built-in Ad & Tracker Blocker</div>
          <div class="row-sub">Blocked ${ad?.sessionBlocked || 0} this session (${ad?.totalBlocked || 0} lifetime)</div>
        </div>
        <label class="nx-switch">
          <input type="checkbox" id="setAdblockChk" ${ad?.enabled !== false ? 'checked' : ''} />
          <span class="nx-slider"></span>
        </label>
      </div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">Clear Browsing Data & Cache</div>
          <div class="row-sub">Remove cached files and browsing history</div>
        </div>
        <button class="btn danger" id="btnSetClearData">Clear Data Now</button>
      </div>
    </div>

    <div class="section-card">
      <div class="card-header"><h2>Performance & 8 GB Memory Saver</h2></div>
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
      <div class="card-header"><h2>About nextGx Browser</h2></div>
      <div class="card-row">
        <div class="row-info">
          <div class="row-title">nextGx Browser v2.5.0 (64-bit) — Powered by Chromium Engine v156.0.8078.100</div>
          <div class="row-sub">Designed for Linux & Windows (Microsoft Store MSIX Ready)</div>
        </div>
      </div>
    </div>
  `;

  mainContainer.querySelectorAll('#setThemeSeg .seg-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await window.gxChromePagesAPI.updateSettings({ theme: btn.dataset.theme });
      renderSettingsPage();
    });
  });

  mainContainer.querySelectorAll('#setSearchSeg .seg-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await window.gxChromePagesAPI.updateSettings({ searchEngine: btn.dataset.engine });
      renderSettingsPage();
    });
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
  document.getElementById('setAdblockChk').addEventListener('change', (e) => {
    window.gxChromePagesAPI.toggleAdblock(e.target.checked);
  });
  document.getElementById('setAutoSleepChk').addEventListener('change', (e) => {
    window.gxChromePagesAPI.updateSettings({ autoSleepEnabled: e.target.checked });
  });
  document.getElementById('btnSetClearData').addEventListener('click', async () => {
    await window.gxChromePagesAPI.clearBrowsingData({ cache: true, cookies: false, history: true });
    document.getElementById('btnSetClearData').textContent = 'Cleared!';
  });
  document.getElementById('btnSetSleepNow').addEventListener('click', async () => {
    await window.gxChromePagesAPI.sleepBackgroundTabs();
    renderSettingsPage();
  });
}

window.addEventListener('hashchange', () => {
  const hash = window.location.hash.replace('#', '');
  if (hash && hash !== currentPage) switchPage(hash);
});

const initialHash = window.location.hash.replace('#', '') || 'history';
switchPage(initialHash);

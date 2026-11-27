const SERVICES = {
  music: [
    { label: 'YouTube Music', url: 'https://music.youtube.com' },
    { label: 'Spotify', url: 'https://open.spotify.com' },
    { label: 'Apple Music', url: 'https://music.apple.com' },
    { label: 'SoundCloud', url: 'https://soundcloud.com' },
    { label: 'Deezer', url: 'https://www.deezer.com' },
    { label: 'Tidal', url: 'https://listen.tidal.com' }
  ],
  ai: [
    { label: 'ChatGPT', url: 'https://chatgpt.com' },
    { label: 'Claude AI', url: 'https://claude.ai' },
    { label: 'Google Gemini', url: 'https://gemini.google.com' },
    { label: 'Perplexity AI', url: 'https://www.perplexity.ai' }
  ],
  twitch: [
    { label: 'Twitch Live', url: 'https://www.twitch.tv' }
  ]
};

const currentUrlByTool = {
  music: 'https://music.youtube.com',
  ai: 'https://chatgpt.com',
  twitch: 'https://www.twitch.tv'
};

let activeTool = 'music';

const serviceSelect = document.getElementById('serviceSelect');
const webFrame = document.getElementById('webFrame');
const webFrameWrap = document.getElementById('webFrameWrap');
const controlView = document.getElementById('controlView');
const cleanerView = document.getElementById('cleanerView');
const setupView = document.getElementById('setupView');

function switchTool(tool) {
  activeTool = tool;
  document.querySelectorAll('.rail-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });

  const isWebTool = tool === 'music' || tool === 'ai' || tool === 'twitch';
  webFrameWrap.classList.toggle('hidden', !isWebTool);
  controlView.classList.toggle('hidden', tool !== 'control');
  cleanerView.classList.toggle('hidden', tool !== 'cleaner');
  setupView.classList.toggle('hidden', tool !== 'setup');

  if (isWebTool) {
    const opts = SERVICES[tool] || [];
    serviceSelect.innerHTML = '';
    for (const o of opts) {
      const el = document.createElement('option');
      el.value = o.url;
      el.textContent = o.label;
      serviceSelect.appendChild(el);
    }
    const targetUrl = currentUrlByTool[tool] || opts[0].url;
    serviceSelect.value = targetUrl;
    if (webFrame.src !== targetUrl) {
      webFrame.src = targetUrl;
    }
  } else {
    serviceSelect.textContent = '';
    const opt = document.createElement('option');
    opt.textContent = String(tool || '').toUpperCase();
    serviceSelect.appendChild(opt);
    if (tool === 'control') refreshTabsList();
  }
}

document.querySelectorAll('.rail-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTool(btn.dataset.tool));
});

serviceSelect.addEventListener('change', (e) => {
  const url = e.target.value;
  if (url && url.startsWith('http')) {
    currentUrlByTool[activeTool] = url;
    webFrame.src = url;
    if (activeTool === 'music') {
      chrome.storage.local.set({ musicService: url });
    }
  }
});

document.getElementById('btnReloadFrame').addEventListener('click', () => {
  webFrame.src = webFrame.src;
});

document.getElementById('btnPopoutWindow').addEventListener('click', () => {
  const url = currentUrlByTool[activeTool] || 'https://music.youtube.com';
  chrome.windows.create({
    url,
    type: 'popup',
    width: 440,
    height: 700
  });
});

// GX Control & RAM Saver
function refreshTabsList() {
  const container = document.getElementById('openTabsList');
  container.innerHTML = '';
  chrome.tabs.query({}, (tabs) => {
    for (const t of tabs) {
      const row = document.createElement('div');
      row.className = 'tab-item';
      const labelSpan = document.createElement('span');
      labelSpan.textContent = `${t.discarded ? '💤 ' : ''}${t.title || t.url || ''}`;
      row.appendChild(labelSpan);
      if (!t.active && !t.discarded) {
        const btn = document.createElement('button');
        btn.className = 'icon-btn discard-btn';
        btn.type = 'button';
        btn.textContent = 'Sleep';
        btn.addEventListener('click', async () => {
          await chrome.tabs.discard(t.id);
          refreshTabsList();
        });
        row.appendChild(btn);
      }
      container.appendChild(row);
    }
  });
}

document.getElementById('btnSleepBgTabs').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'SLEEP_BACKGROUND_TABS' }, (res) => {
    const count = res?.discardedCount || 0;
    document.getElementById('sleepStatus').textContent =
      `✓ Hibernated ${count} background tab(s) to free RAM!`;
    refreshTabsList();
  });
});

document.getElementById('chkAdblock').addEventListener('change', (e) => {
  chrome.runtime.sendMessage({ type: 'TOGGLE_ADBLOCK', enabled: e.target.checked });
});

// Cleaner
document.getElementById('btnRunClean').addEventListener('click', () => {
  chrome.runtime.sendMessage(
    {
      type: 'CLEAN_BROWSER_DATA',
      options: {
        cache: document.getElementById('chkCleanCache').checked,
        cookies: document.getElementById('chkCleanCookies').checked,
        history: document.getElementById('chkCleanHistory').checked
      }
    },
    () => {
      document.getElementById('cleanResult').textContent = '✓ Cleaned selected browser data!';
    }
  );
});

// Native Chrome Pages Quick Open
document.getElementById('btnOpenChromeSettings').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://settings' });
});
document.getElementById('btnOpenChromePasswords').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://password-manager' });
});
document.getElementById('btnOpenChromeHistory').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://history' });
});

// Init from storage
chrome.storage.local.get(['activeTool', 'musicService', 'adblockEnabled'], (data) => {
  if (data.musicService) currentUrlByTool.music = data.musicService;
  if (typeof data.adblockEnabled === 'boolean') {
    document.getElementById('chkAdblock').checked = data.adblockEnabled;
  }
  switchTool(data.activeTool || 'music');
});

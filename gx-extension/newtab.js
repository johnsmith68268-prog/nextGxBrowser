const DEFAULT_DIALS = [
  { id: '1', title: 'Twitch', url: 'https://www.twitch.tv', bg: 'linear-gradient(135deg, #6441a5, #4b2d83)' },
  { id: '2', title: 'YouTube', url: 'https://www.youtube.com', bg: 'linear-gradient(135deg, #e52d27, #b31217)' },
  { id: '3', title: 'GitHub', url: 'https://github.com', bg: 'linear-gradient(135deg, #24292e, #121518)' },
  { id: '4', title: 'YouTube Music', url: 'https://music.youtube.com', bg: 'linear-gradient(135deg, #ff0055, #990033)' },
  { id: '5', title: 'Reddit', url: 'https://www.reddit.com', bg: 'linear-gradient(135deg, #ff4500, #cc3700)' },
  { id: '6', title: 'ChatGPT', url: 'https://chatgpt.com', bg: 'linear-gradient(135deg, #10a37f, #0b6e56)' },
  { id: '7', title: 'SoundCloud', url: 'https://soundcloud.com', bg: 'linear-gradient(135deg, #ff7700, #ff3300)' },
  { id: '8', title: 'Facebook', url: 'https://www.facebook.com', bg: 'linear-gradient(135deg, #1877f2, #0d52ad)' }
];

const dialGrid = document.getElementById('dialGrid');
const addModal = document.getElementById('addModal');

function renderDials(list) {
  dialGrid.textContent = '';
  for (const item of list) {
    const card = document.createElement('div');
    card.className = 'dial-tile';
    card.style.background = item.bg || 'linear-gradient(135deg, #6441a5, #3b206c)';
    const delBtn = document.createElement('button');
    delBtn.className = 'tile-del';
    delBtn.title = 'Remove';
    delBtn.textContent = '✕';
    const titleSpan = document.createElement('span');
    titleSpan.className = 'tile-title';
    titleSpan.textContent = String(item.title || '');
    card.appendChild(delBtn);
    card.appendChild(titleSpan);
    card.addEventListener('click', (e) => {
      if (e.target.closest('.tile-del')) {
        e.stopPropagation();
        const next = list.filter((d) => d.id !== item.id);
        chrome.storage.local.set({ speedDials: next });
        renderDials(next);
        return;
      }
      window.location.href = item.url;
    });
    dialGrid.appendChild(card);
  }

  const addCard = document.createElement('div');
  addCard.className = 'dial-tile add-tile';
  addCard.textContent = '+';
  addCard.addEventListener('click', () => addModal.classList.add('open'));
  dialGrid.appendChild(addCard);
}

document.querySelectorAll('[data-open-side]').forEach((btn) => {
  btn.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      type: 'OPEN_SIDE_PANEL',
      tool: btn.dataset.openSide
    });
  });
});

document.getElementById('btnCancelModal').addEventListener('click', () => {
  addModal.classList.remove('open');
});

document.getElementById('addDialForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const title = document.getElementById('dialTitleInput').value.trim();
  const rawUrl = document.getElementById('dialUrlInput').value.trim();
  if (!title || !rawUrl) return;
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  chrome.storage.local.get(['speedDials'], (res) => {
    const list = res.speedDials || DEFAULT_DIALS;
    const next = [
      ...list,
      { id: String(Date.now()), title, url, bg: 'linear-gradient(135deg, #9d4edd, #4c1d95)' }
    ];
    chrome.storage.local.set({ speedDials: next });
    renderDials(next);
    addModal.classList.remove('open');
    e.target.reset();
  });
});

document.getElementById('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('searchInput').value.trim();
  if (!q) return;
  if (/^https?:\/\//i.test(q) || (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(q) && !q.includes(' '))) {
    window.location.href = /^https?:\/\//i.test(q) ? q : `https://${q}`;
  } else {
    window.location.href = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  }
});

chrome.storage.local.get(['speedDials'], (res) => {
  renderDials(res.speedDials || DEFAULT_DIALS);
});

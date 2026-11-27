    let playerState = { activeSource: null, sources: [], hasPlayingMedia: false };
    let isSeeking = false;
    let seekLockUntil = 0;
    let lastArtworkUrl = '';
    let clockTimerId = null;

    const emptyStateEl = document.getElementById('playerEmptyState');
    const activeStateEl = document.getElementById('playerActiveState');
    const statusDotEl = document.getElementById('playerStatusDot');
    const sourceLabelEl = document.getElementById('playerSourceLabel');
    const stateTagEl = document.getElementById('playerStateTag');
    const btnPlayerPip = document.getElementById('btnPlayerPip');
    const btnPlayerFocusSource = document.getElementById('btnPlayerFocusSource');
    const artworkFrameEl = document.getElementById('playerArtworkFrame');
    const artworkImgEl = document.getElementById('playerArtworkImg');
    const artworkPlaceholderEl = document.getElementById('playerArtworkPlaceholder');
    const mediaKindLabelEl = document.getElementById('playerMediaKindLabel');
    const trackTitleEl = document.getElementById('playerTrackTitle');
    const trackArtistEl = document.getElementById('playerTrackArtist');
    const trackAlbumEl = document.getElementById('playerTrackAlbum');
    const seekRangeEl = document.getElementById('playerSeekRange');
    const timeCurrentEl = document.getElementById('playerTimeCurrent');
    const timeDurationEl = document.getElementById('playerTimeDuration');
    const btnPlayerPrev = document.getElementById('btnPlayerPrev');
    const btnPlayerPlayPause = document.getElementById('btnPlayerPlayPause');
    const btnPlayerNext = document.getElementById('btnPlayerNext');
    const iconPlayEl = document.getElementById('iconPlay');
    const iconPauseEl = document.getElementById('iconPause');
    const controlNoteEl = document.getElementById('playerControlNote');
    const sourcesSectionEl = document.getElementById('playerSourcesSection');
    const sourcesCountEl = document.getElementById('playerSourcesCount');
    const sourcesListEl = document.getElementById('playerSourcesList');

    function applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme || 'gx-violet');
    }

    function applySettings(s) {
      if (!s || typeof s !== 'object') return;
      if (s.theme) applyTheme(s.theme);
      window.gxSounds?.setConfig({
        enabled: s.uiSoundsEnabled !== false,
        volume: typeof s.uiSoundsVolume === 'number' ? s.uiSoundsVolume : 0.35
      });
    }

    function formatTime(rawSec) {
      const sec = Number(rawSec);
      if (!Number.isFinite(sec) || sec < 0) return '--:--';
      const total = Math.floor(sec);
      const hrs = Math.floor(total / 3600);
      const mins = Math.floor((total % 3600) / 60);
      const secs = total % 60;
      const pad = (n) => String(n).padStart(2, '0');
      return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
    }

    function computeDisplayedTime(src) {
      if (!src) return 0;
      let cur = Number(src.currentTime) || 0;
      if (src.isPlaying && typeof src.updatedAt === 'number' && src.updatedAt > 0) {
        const elapsed = Math.max(0, (Date.now() - src.updatedAt) / 1000);
        const rate = Number(src.playbackRate) || 1;
        cur += elapsed * rate;
      }
      if (typeof src.duration === 'number' && Number.isFinite(src.duration) && src.duration > 0) {
        cur = Math.min(src.duration, cur);
      }
      return Math.max(0, cur);
    }

    function updateSeekVisual(value, max) {
      const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
      seekRangeEl.style.background = `linear-gradient(90deg, var(--nx-accent) 0%, var(--nx-accent-bright) ${pct}%, var(--bg-elevated) ${pct}%, var(--bg-elevated) 100%)`;
    }

    function renderSeekProgress(src) {
      if (!src || isSeeking || Date.now() < seekLockUntil) return;
      const canSeek = Boolean(src.canSeek && typeof src.duration === 'number' && src.duration > 0);
      const cur = computeDisplayedTime(src);

      seekRangeEl.disabled = !canSeek;
      if (canSeek) {
        seekRangeEl.max = String(Math.max(1, Math.floor(src.duration)));
        seekRangeEl.value = String(Math.min(Math.floor(src.duration), Math.floor(cur)));
        updateSeekVisual(cur, src.duration);
        timeCurrentEl.textContent = formatTime(cur);
        timeDurationEl.textContent = formatTime(src.duration);
        seekRangeEl.title = 'Drag to seek';
      } else {
        seekRangeEl.max = '100';
        seekRangeEl.value = '0';
        updateSeekVisual(0, 100);
        timeCurrentEl.textContent = src.isLive ? formatTime(cur) : (cur > 0 ? formatTime(cur) : '0:00');
        timeDurationEl.textContent = src.isLive ? 'LIVE' : '--:--';
        seekRangeEl.title = src.isLive ? 'Live stream — seeking unavailable' : 'Seeking not available for this source';
      }
    }

    function renderArtwork(src) {
      const art = typeof src?.artwork === 'string' ? src.artwork.trim() : '';
      const isSafeArt =
        Boolean(art) &&
        (/^https?:\/\//i.test(art) || /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(art));

      artworkFrameEl.classList.toggle('playing', Boolean(src?.isPlaying));
      mediaKindLabelEl.textContent = src?.mediaKind === 'video' ? 'Video' : 'Audio';

      if (!isSafeArt) {
        lastArtworkUrl = '';
        artworkImgEl.classList.add('hidden');
        artworkImgEl.removeAttribute('src');
        artworkPlaceholderEl.classList.remove('hidden');
        return;
      }

      if (art !== lastArtworkUrl) {
        lastArtworkUrl = art;
        artworkImgEl.classList.add('hidden');
        artworkPlaceholderEl.classList.remove('hidden');
        artworkImgEl.src = art;
      }
    }

    artworkImgEl.addEventListener('load', () => {
      if (artworkImgEl.naturalWidth > 0 && lastArtworkUrl) {
        artworkImgEl.classList.remove('hidden');
        artworkPlaceholderEl.classList.add('hidden');
      }
    });

    artworkImgEl.addEventListener('error', () => {
      artworkImgEl.classList.add('hidden');
      artworkPlaceholderEl.classList.remove('hidden');
    });

    function renderSourcesList(sources, activeWcId) {
      const list = Array.isArray(sources) ? sources : [];
      if (list.length <= 1) {
        sourcesSectionEl.classList.add('hidden');
        sourcesListEl.innerHTML = '';
        return;
      }
      sourcesSectionEl.classList.remove('hidden');
      sourcesCountEl.textContent = String(list.length);
      sourcesListEl.innerHTML = '';

      for (const s of list) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `source-row${s.wcId === activeWcId ? ' active' : ''}`;
        btn.dataset.wcId = String(s.wcId);

        const dot = document.createElement('span');
        dot.className = `source-dot${s.isPlaying ? ' playing' : ''}`;

        const info = document.createElement('div');
        info.className = 'source-row-info';

        const tEl = document.createElement('div');
        tEl.className = 'source-row-title';
        tEl.textContent = s.title || s.sourceName || 'Media';

        const subEl = document.createElement('div');
        subEl.className = 'source-row-sub';
        const kindTag = s.sourceType === 'sidebar' ? 'Sidebar' : 'Tab';
        subEl.textContent = `${kindTag} · ${s.sourceName || 'Page'} · ${s.isPlaying ? 'Playing' : 'Paused'}`;

        info.appendChild(tEl);
        info.appendChild(subEl);
        btn.appendChild(dot);
        btn.appendChild(info);

        btn.addEventListener('click', () => {
          window.gxSounds?.playClick();
          window.gxPlayerAPI?.control({ action: 'select-source', sourceWcId: s.wcId });
        });

        sourcesListEl.appendChild(btn);
      }
    }

    function renderPlayerState(nextState) {
      if (!nextState || typeof nextState !== 'object') return;
      playerState = nextState;
      const src = playerState.activeSource || null;

      if (!src) {
        emptyStateEl.classList.remove('hidden');
        activeStateEl.classList.add('hidden');
        lastArtworkUrl = '';
        stopClockTimer();
        return;
      }

      emptyStateEl.classList.add('hidden');
      activeStateEl.classList.remove('hidden');

      const isPlaying = Boolean(src.isPlaying);
      statusDotEl.classList.toggle('playing', isPlaying);
      const originPrefix = src.sourceType === 'sidebar' ? 'Sidebar' : 'Tab';
      sourceLabelEl.textContent = `${originPrefix} · ${src.sourceName || 'Media'}`;
      sourceLabelEl.title = src.sourceUrl || src.sourceName || '';

      if (src.isLive) {
        stateTagEl.textContent = 'LIVE';
        stateTagEl.classList.add('live');
      } else {
        stateTagEl.textContent = isPlaying ? 'PLAYING' : 'PAUSED';
        stateTagEl.classList.remove('live');
      }

      btnPlayerFocusSource.title =
        src.sourceType === 'sidebar'
          ? `Open ${src.sourceName || 'service'} in sidebar`
          : `Switch to tab: ${src.sourceName || 'Tab'}`;

      const showPip = Boolean(src.hasPlayingVideo || src.pipActive);
      btnPlayerPip.classList.toggle('hidden', !showPip);
      btnPlayerPip.classList.toggle('active', Boolean(src.pipActive && showPip));
      btnPlayerPip.title = src.pipActive
        ? 'Exit Picture-in-Picture'
        : 'Pop out video (Picture-in-Picture)';

      renderArtwork(src);

      trackTitleEl.textContent = src.title || src.sourceName || 'Untitled Media';
      trackTitleEl.title = trackTitleEl.textContent;
      trackArtistEl.textContent = src.artist || src.sourceName || '';
      trackArtistEl.classList.toggle('hidden', !trackArtistEl.textContent);
      trackAlbumEl.textContent = src.album || '';
      trackAlbumEl.classList.toggle('hidden', !src.album);

      renderSeekProgress(src);

      // Transport buttons — honestly reflect what this source supports
      const canPlayPause = Boolean(src.canPlayPause);
      btnPlayerPlayPause.disabled = !canPlayPause;
      iconPlayEl.classList.toggle('hidden', isPlaying);
      iconPauseEl.classList.toggle('hidden', !isPlaying);
      btnPlayerPlayPause.title = !canPlayPause
        ? 'Playback control unavailable for this source — click Open to control in tab'
        : isPlaying
        ? 'Pause'
        : 'Play';
      btnPlayerPlayPause.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');

      const canPrev = Boolean(src.canPrevious);
      btnPlayerPrev.disabled = !canPrev;
      btnPlayerPrev.title = canPrev ? 'Previous track' : 'Previous track not supported by this page';

      const canNext = Boolean(src.canNext);
      btnPlayerNext.disabled = !canNext;
      btnPlayerNext.title = canNext ? 'Next track' : 'Next track not supported by this page';

      if (!canPlayPause) {
        controlNoteEl.textContent = 'Audio detected — control playback directly inside the source tab.';
        controlNoteEl.classList.remove('hidden');
      } else {
        controlNoteEl.textContent = '';
        controlNoteEl.classList.add('hidden');
      }

      renderSourcesList(playerState.sources, src.wcId);

      if (isPlaying) startClockTimer();
      else stopClockTimer();
    }

    function startClockTimer() {
      if (clockTimerId) return;
      clockTimerId = setInterval(() => {
        if (document.visibilityState === 'hidden') return;
        if (playerState.activeSource && playerState.activeSource.isPlaying) {
          renderSeekProgress(playerState.activeSource);
        }
      }, 1000);
    }

    function stopClockTimer() {
      if (clockTimerId) {
        clearInterval(clockTimerId);
        clockTimerId = null;
      }
    }

    btnPlayerPlayPause.addEventListener('click', async () => {
      const src = playerState.activeSource;
      if (!src || btnPlayerPlayPause.disabled) return;
      window.gxSounds?.playClick();
      const res = await window.gxPlayerAPI?.control({
        action: 'toggle-play',
        sourceWcId: src.wcId
      });
      if (res?.state) renderPlayerState(res.state);
    });

    btnPlayerPrev.addEventListener('click', async () => {
      const src = playerState.activeSource;
      if (!src || btnPlayerPrev.disabled) return;
      window.gxSounds?.playClick();
      await window.gxPlayerAPI?.control({
        action: 'previous',
        sourceWcId: src.wcId
      });
    });

    btnPlayerNext.addEventListener('click', async () => {
      const src = playerState.activeSource;
      if (!src || btnPlayerNext.disabled) return;
      window.gxSounds?.playClick();
      await window.gxPlayerAPI?.control({
        action: 'next',
        sourceWcId: src.wcId
      });
    });

    btnPlayerFocusSource.addEventListener('click', () => {
      const src = playerState.activeSource;
      if (!src) return;
      window.gxSounds?.playClick();
      window.gxPlayerAPI?.control({
        action: 'focus-source',
        sourceWcId: src.wcId
      });
    });

    btnPlayerPip.addEventListener('click', () => {
      const src = playerState.activeSource;
      if (!src) return;
      window.gxSounds?.playClick();
      window.gxPlayerAPI?.control({
        action: 'pip',
        sourceWcId: src.wcId
      });
    });

    document.getElementById('btnQuickYtMusic').addEventListener('click', () => {
      window.gxSounds?.playClick();
      window.gxPlayerAPI?.openSidebarService('youtubeMusic');
    });

    document.getElementById('btnQuickSpotify').addEventListener('click', () => {
      window.gxSounds?.playClick();
      window.gxPlayerAPI?.openSidebarService('spotify');
    });

    const beginSeek = () => {
      if (seekRangeEl.disabled) return;
      isSeeking = true;
    };

    seekRangeEl.addEventListener('pointerdown', beginSeek);
    seekRangeEl.addEventListener('mousedown', beginSeek);

    seekRangeEl.addEventListener('input', () => {
      if (seekRangeEl.disabled) return;
      isSeeking = true;
      const val = Number(seekRangeEl.value) || 0;
      const max = Number(seekRangeEl.max) || 100;
      timeCurrentEl.textContent = formatTime(val);
      updateSeekVisual(val, max);
    });

    let lastSeekCommitAt = 0;
    const commitSeek = async ({ fromChange = false } = {}) => {
      const wasSeeking = isSeeking;
      isSeeking = false;
      const src = playerState.activeSource;
      if ((!wasSeeking && !fromChange) || !src || seekRangeEl.disabled) return;
      const now = Date.now();
      if (now - lastSeekCommitAt < 80) return;
      lastSeekCommitAt = now;
      const seekTime = Number(seekRangeEl.value) || 0;
      seekLockUntil = now + 600;
      const res = await window.gxPlayerAPI?.control({
        action: 'seek',
        sourceWcId: src.wcId,
        seekTime
      });
      if (res?.state) renderPlayerState(res.state);
    };

    seekRangeEl.addEventListener('change', () => commitSeek({ fromChange: true }));
    seekRangeEl.addEventListener('pointerup', () => commitSeek());
    seekRangeEl.addEventListener('mouseup', () => commitSeek());

    (function init() {
      const params = new URLSearchParams(window.location.search);
      if (params.get('incognito') === '1') {
        document.documentElement.setAttribute('data-incognito', 'true');
      }
      const initialTheme = params.get('theme');
      if (initialTheme) applyTheme(initialTheme);

      window.gxPlayerAPI?.onSettingsUpdate?.((s) => applySettings(s));
      window.gxPlayerAPI?.onUpdate?.((st) => renderPlayerState(st));

      window.gxPlayerAPI?.getSettings?.().then((s) => applySettings(s)).catch(() => {});
      window.gxPlayerAPI?.getState?.().then((st) => renderPlayerState(st)).catch(() => {});
    })();
  

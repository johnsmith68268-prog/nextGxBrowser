    const TOTAL_STEPS = 5;
    let step = 0;
    let selectedTheme = 'gx-violet';
    let selectedWp = 'obsidian-wave';
    let selectedPreset = 'classic';
    let selectedEngine = 'google';
    const selectedApps = {
      youtubeMusic: true,
      spotify: true,
      chatgpt: true,
      gemini: true,
      claude: false,
      whatsapp: true,
      discord: false,
      twitch: true
    };

    const steps = Array.from(document.querySelectorAll('.ob-step'));
    const dots = Array.from(document.querySelectorAll('.ob-dot'));
    const btnBack = document.getElementById('btnObBack');
    const btnNext = document.getElementById('btnObNext');
    const obBg = document.getElementById('obBg');

    function renderStep() {
      steps.forEach((s, idx) => s.classList.toggle('active', idx === step));
      dots.forEach((d, idx) => {
        d.classList.toggle('active', idx === step);
        d.classList.toggle('done', idx < step);
      });
      btnBack.classList.toggle('hidden', step === 0);
      if (step === 0) btnNext.textContent = 'Get Started →';
      else if (step === TOTAL_STEPS - 1) btnNext.textContent = 'Finish & Start Browsing →';
      else btnNext.textContent = 'Continue →';
    }

    function applyThemePreview(theme) {
      selectedTheme = theme || 'gx-violet';
      document.documentElement.setAttribute('data-theme', selectedTheme);
      document.querySelectorAll('#obThemeGrid .ob-theme-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.theme === selectedTheme);
      });
    }

    document.querySelectorAll('#obThemeGrid .ob-theme-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyThemePreview(btn.dataset.theme);
        window.gxOnboardingAPI?.updateSettings({ theme: selectedTheme });
      });
    });

    document.querySelectorAll('#obWpGrid .ob-wp-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedWp = btn.dataset.wp;
        document.querySelectorAll('#obWpGrid .ob-wp-btn').forEach((b) => b.classList.toggle('active', b === btn));
        if (obBg && btn.dataset.img) obBg.style.backgroundImage = `url("${btn.dataset.img}")`;
        window.gxOnboardingAPI?.updateSettings({ wallpaper: { type: 'preset', preset: selectedWp, file: '' } });
      });
    });

    document.querySelectorAll('#obPresetGrid .ob-preset-card').forEach((card) => {
      card.addEventListener('click', () => {
        selectedPreset = card.dataset.preset;
        document.querySelectorAll('#obPresetGrid .ob-preset-card').forEach((c) => c.classList.toggle('active', c === card));
      });
    });

    document.querySelectorAll('#obAppsGrid .ob-app-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const key = chip.dataset.app;
        selectedApps[key] = !selectedApps[key];
        chip.classList.toggle('active', selectedApps[key]);
        chip.lastElementChild.textContent = selectedApps[key] ? '✓' : '';
      });
    });

    document.querySelectorAll('#obEngineGrid .ob-app-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        selectedEngine = chip.dataset.engine;
        document.querySelectorAll('#obEngineGrid .ob-app-chip').forEach((c) => {
          const on = c.dataset.engine === selectedEngine;
          c.classList.toggle('active', on);
          c.lastElementChild.textContent = on ? '✓' : '';
        });
      });
    });

    document.getElementById('btnObDefaultBrowser').addEventListener('click', async () => {
      const guide = document.getElementById('obDefaultGuide');
      const res = await window.gxOnboardingAPI?.setDefaultBrowser?.();
      if (guide) {
        guide.innerHTML = res?.openedSystemSettings
          ? 'Windows Default Apps is now open — select <strong>nextGx Browser</strong> and click <strong>Set default</strong>.'
          : res?.ok
            ? 'Registered nextGx Browser for http and https links!'
            : 'Open Windows Settings &rarr; Apps &rarr; Default apps &rarr; select <strong>nextGx Browser</strong>.';
      }
    });

    document.getElementById('btnObImportBookmarks').addEventListener('click', async () => {
      const status = document.getElementById('obImportStatus');
      const res = await window.gxOnboardingAPI?.importBookmarksHtml?.();
      if (status && res && !res.canceled) {
        status.textContent = res.ok
          ? `Imported ${res.imported || 0} bookmarks cleanly!`
          : (res.error || 'Import did not complete.');
      }
    });

    async function completeSetup({ skipped = false } = {}) {
      if (window.gxOnboardingAPI?.updateSettings) {
        if (skipped) {
          await window.gxOnboardingAPI.updateSettings({ onboardingCompleted: true });
        } else {
          const presetPayload =
            selectedPreset === 'gaming'
              ? { uiSoundsEnabled: true, gxRamLimiterEnabled: true, gxRamLimitMB: 4096, autoSleepEnabled: true, adblockEnabled: true, trackerBlockEnabled: true }
              : selectedPreset === 'privacy'
                ? { adblockEnabled: true, trackerBlockEnabled: true, dnsOverHttps: true, thirdPartyCookies: 'block', webrtcPolicy: 'default_public_interface_only' }
                : { uiSoundsEnabled: false, keyboardSoundsEnabled: false, adblockEnabled: true, trackerBlockEnabled: true, startPageShowClock: true };

          await window.gxOnboardingAPI.updateSettings({
            theme: selectedTheme,
            wallpaper: { type: 'preset', preset: selectedWp, file: '' },
            searchEngine: selectedEngine,
            sidebarItems: { ...selectedApps },
            ...presetPayload,
            onboardingCompleted: true
          });
        }
      }
      window.gxOnboardingAPI?.navigate?.('nextgx://newtab');
    }

    document.getElementById('btnSkipSetup').addEventListener('click', () => completeSetup({ skipped: true }));
    btnBack.addEventListener('click', () => {
      if (step > 0) {
        step -= 1;
        renderStep();
      }
    });
    btnNext.addEventListener('click', () => {
      if (step < TOTAL_STEPS - 1) {
        step += 1;
        renderStep();
      } else {
        completeSetup({ skipped: false });
      }
    });

    (async function init() {
      const s = await window.gxOnboardingAPI?.getSettings?.().catch(() => null);
      if (s?.theme) applyThemePreview(s.theme);
      renderStep();
    })();
  

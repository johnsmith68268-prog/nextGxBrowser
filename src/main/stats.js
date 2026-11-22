const os = require('os');
const { windowContexts, state } = require('./core');
const { isNewTabUrl } = require('./utils');
const { sleepTab } = require('./tabs');
const gxControl = require('./gxcontrol');
const playerMod = () => require('./player');

let prevCpuInfo = os.cpus();
let statsIntervalId = null;
let autoSleepIntervalId = null;
let statsTickInFlight = false;

function getSystemCpuPercent() {
  const cpus = os.cpus();
  let idleDiff = 0;
  let totalDiff = 0;
  for (let i = 0; i < cpus.length; i++) {
    const prev = prevCpuInfo[i] || cpus[i];
    const curr = cpus[i];
    let prevTotal = 0;
    let currTotal = 0;
    for (const type of Object.keys(curr.times)) {
      prevTotal += prev.times[type] || 0;
      currTotal += curr.times[type] || 0;
    }
    idleDiff += curr.times.idle - prev.times.idle;
    totalDiff += currTotal - prevTotal;
  }
  prevCpuInfo = cpus;
  if (totalDiff <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(((totalDiff - idleDiff) / totalDiff) * 100)));
}

function getBrowserRamMB() {
  return gxControl.sampleProcessMetrics().browserRamMB;
}

function collectSystemStats({ sample = null } = {}) {
  const totalSysMB = Math.round(os.totalmem() / (1024 * 1024));
  const freeSysMB = Math.round(os.freemem() / (1024 * 1024));
  const usedSysMB = totalSysMB - freeSysMB;
  const metrics = sample || gxControl.sampleProcessMetrics();
  const browserRamMB = metrics.browserRamMB;
  const browserCpuPercent = metrics.browserCpuPercent;
  const cpuPercent = getSystemCpuPercent();
  const settings = state.storage.getSettings();

  let activeTabsCount = 0;
  let sleepingTabsCount = 0;
  for (const ctx of windowContexts.values()) {
    for (const t of ctx.tabs.values()) {
      if (t.sleeping) sleepingTabsCount += 1;
      else activeTabsCount += 1;
    }
  }

  const { tabStats, gxControl: gxControlState } = gxControl.buildGxControlSnapshot(metrics, settings);

  return {
    totalSysMB,
    usedSysMB,
    freeSysMB,
    sysRamPercent: totalSysMB > 0 ? Math.round((usedSysMB / totalSysMB) * 100) : 0,
    browserRamMB,
    browserCpuPercent,
    cpuCoreCount: metrics.coreCount,
    cpuPercent,
    activeTabsCount,
    sleepingTabsCount,
    tabStats,
    gxControl: gxControlState,
    settings
  };
}

function broadcastSystemStatsNow({ sample = null } = {}) {
  const stats = collectSystemStats({ sample });
  for (const ctx of windowContexts.values()) {
    if (ctx.win && !ctx.win.isDestroyed()) {
      ctx.win.webContents.send('system:stats-update', stats);
    }
    for (const tab of ctx.tabs.values()) {
      if (
        !tab ||
        tab.sleeping ||
        !tab.view ||
        !tab.view.webContents ||
        tab.view.webContents.isDestroyed()
      ) {
        continue;
      }
      const wcUrl = tab.view.webContents.getURL();
      if (isNewTabUrl(tab.url) || isNewTabUrl(wcUrl)) {
        tab.view.webContents.send('system:stats-update', stats);
      }
    }
  }
  return stats;
}

function startBackgroundTimers() {
  stopBackgroundTimers();
  gxControl.primeMetrics();

  statsIntervalId = setInterval(async () => {
    if (statsTickInFlight || state.isAppQuitting) return;
    statsTickInFlight = true;
    try {
      const sample = gxControl.sampleProcessMetrics({ force: true });
      await gxControl.enforceOnTick(sample, { sleepTab });
      playerMod().pruneStaleSources();
      if (!state.isAppQuitting) {
        broadcastSystemStatsNow({ sample });
      }
    } catch (_) {
    } finally {
      statsTickInFlight = false;
    }
  }, 2500);

  autoSleepIntervalId = setInterval(() => {
    if (state.isAppQuitting) return;
    const s = state.storage.getSettings();
    if (!s.autoSleepEnabled) return;
    const rawMinutes = Number(s.autoSleepMinutes);
    const safeMinutes = Number.isFinite(rawMinutes) && rawMinutes > 0 ? Math.max(1, rawMinutes) : 10;
    const timeoutMs = safeMinutes * 60 * 1000;
    const now = Date.now();
    for (const ctx of windowContexts.values()) {
      for (const [id, tab] of ctx.tabs.entries()) {
        const pipActive = Boolean(tab?.pipActive || playerMod().getTabVideoState(tab)?.pipActive);
        if (
          id !== ctx.activeTabId &&
          !tab.sleeping &&
          !tab.pinned &&
          !tab.audible &&
          !pipActive &&
          now - tab.lastActiveAt >= timeoutMs
        ) {
          sleepTab(ctx, id);
        }
      }
    }
  }, 20000);
}

function stopBackgroundTimers() {
  if (statsIntervalId) {
    clearInterval(statsIntervalId);
    statsIntervalId = null;
  }
  if (autoSleepIntervalId) {
    clearInterval(autoSleepIntervalId);
    autoSleepIntervalId = null;
  }
}

module.exports = {
  getSystemCpuPercent,
  getBrowserRamMB,
  collectSystemStats,
  broadcastSystemStatsNow,
  startBackgroundTimers,
  stopBackgroundTimers
};

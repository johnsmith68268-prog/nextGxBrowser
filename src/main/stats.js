const os = require('os');
const { windowContexts, state } = require('./core');
const { isNewTabUrl } = require('./utils');
const { sleepTab } = require('./tabs');
const gxControl = require('./gxcontrol');
const playerMod = () => require('./player');
const sidebarMod = () => require('./sidebar');

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

  // [Fix2 A6] Memory Saver, visible: real counts from the live tab set and
  // the RAM limiter — never fabricated. The status bar / GX Control UI
  // reads memorySaver.sleepingTabsCount + hibernatedByLimiterCount for its
  // badge; collectSystemStats is the broadcast payload, so the numbers are
  // the same ones the limiter acted on.
  const ramStats = gxControl.getRamHibernationStats();
  const memorySaver = {
    sleepingTabsCount,
    hibernatedByLimiterCount: ramStats.hibernatedCount,
    lastHibernateAt: ramStats.lastHibernateAt,
    autoSleepEnabled: Boolean(settings.autoSleepEnabled),
    autoSleepMinutes: Number(settings.autoSleepMinutes) || 10,
    batterySaverEnabled: Boolean(settings.batterySaverEnabled)
  };

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
    memorySaver,
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

function shouldPollMetricsFast() {
  const s = state.storage?.getSettings?.() || {};
  if (s.gxRamLimiterEnabled || s.gxCpuLimiterEnabled) return true;
  for (const ctx of windowContexts.values()) {
    if (!ctx || !ctx.win || ctx.win.isDestroyed()) continue;
    if (ctx.gxControlOpen) return true;
    const activeTab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (activeTab && !activeTab.sleeping && isNewTabUrl(activeTab.url)) {
      return true;
    }
  }
  return false;
}

const FAST_STATS_INTERVAL_MS = 2500;
const IDLE_STATS_INTERVAL_MS = 15000;
let lastStatsPollAt = 0;

// [Fix2 Battery saver] Polling intervals. Battery saver halves the polling
// rate (fast 2.5s -> 5s, idle 15s -> 30s) so the stats loop itself stops
// waking the machine up. Pure function for tests.
function getStatsIntervals(settings) {
  const battery = Boolean(settings && settings.batterySaverEnabled);
  return {
    fast: battery ? 5000 : FAST_STATS_INTERVAL_MS,
    idle: battery ? 30000 : IDLE_STATS_INTERVAL_MS
  };
}

// [Fix2 Battery saver] Effective auto-sleep timeout. Battery saver caps
// the idle timeout at 2 minutes (never below 1) so background tabs
// hibernate sooner; otherwise the configured timeout applies.
function getEffectiveAutoSleepMs(settings) {
  const rawMinutes = Number(settings && settings.autoSleepMinutes);
  const safeMinutes = Number.isFinite(rawMinutes) && rawMinutes > 0 ? Math.max(1, rawMinutes) : 10;
  const effectiveMinutes = settings && settings.batterySaverEnabled ? Math.min(safeMinutes, 2) : safeMinutes;
  return effectiveMinutes * 60 * 1000;
}

// [Fix2 A6 Hibernate Now] Hibernate every eligible background tab in every
// window plus every idle sidebar service view, and measure real RAM
// before/after with a forced sample. Returns measured numbers only —
// `savedMB` may be small or 0 if the OS has not reclaimed the pages yet;
// it is reported as measured, never inflated.
function hibernateNow() {
  const beforeMB = gxControl.sampleProcessMetrics({ force: true }).browserRamMB;
  let splitView = null;
  try { splitView = require('./splitview'); } catch (_) {}
  let sleptCount = 0;
  for (const ctx of windowContexts.values()) {
    if (!ctx || !ctx.win || ctx.win.isDestroyed()) continue;
    for (const [id, tab] of ctx.tabs.entries()) {
      const pipActive = Boolean(tab?.pipActive || playerMod().getTabVideoState(tab)?.pipActive);
      const inSplit = Boolean(splitView && typeof splitView.isTabInVisibleSplit === 'function' && splitView.isTabInVisibleSplit(ctx, id));
      if (
        id !== ctx.activeTabId &&
        !inSplit &&
        !tab.sleeping &&
        !tab.pinned &&
        !tab.audible &&
        !pipActive
      ) {
        const before = tab.sleeping;
        sleepTab(ctx, id);
        if (!before && tab.sleeping) sleptCount += 1;
      }
    }
  }
  let sidebarSuspended = 0;
  try {
    sidebarSuspended = sidebarMod().suspendIdleSidebarViews(0) || 0;
  } catch (_) {
    sidebarSuspended = 0;
  }
  const afterMB = gxControl.sampleProcessMetrics({ force: true }).browserRamMB;
  const ramStats = gxControl.getRamHibernationStats();
  let sleepingTabsCount = 0;
  for (const ctx of windowContexts.values()) {
    for (const t of ctx.tabs.values()) {
      if (t && t.sleeping) sleepingTabsCount += 1;
    }
  }
  return {
    beforeMB,
    afterMB,
    savedMB: beforeMB - afterMB,
    sleptCount,
    sidebarSuspended,
    sleepingTabsCount,
    hibernatedByLimiterCount: ramStats.hibernatedCount,
    lastHibernateAt: ramStats.lastHibernateAt
  };
}

function startBackgroundTimers() {
  stopBackgroundTimers();
  gxControl.primeMetrics();
  lastStatsPollAt = 0;

  statsIntervalId = setInterval(async () => {
    if (statsTickInFlight || state.isAppQuitting) return;
    const now = Date.now();
    const fast = shouldPollMetricsFast();
    const intervals = getStatsIntervals(state.storage.getSettings());
    const minInterval = fast ? intervals.fast : intervals.idle;
    if (lastStatsPollAt > 0 && now - lastStatsPollAt < minInterval - 100) {
      playerMod().pruneStaleSources();
      return;
    }
    statsTickInFlight = true;
    lastStatsPollAt = now;
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
  }, FAST_STATS_INTERVAL_MS);

  autoSleepIntervalId = setInterval(() => {
    if (state.isAppQuitting) return;
    const s = state.storage.getSettings();
    // [Fix2 A6] Sidebar views suspend sooner when RAM is high: the audit
    // saw ~200 MB per live sidebar service, so above 1 GB (or 80% of the
    // RAM cap when the limiter is on) idle services suspend after 60 s
    // instead of 5 minutes. Audible / visible services are never suspended
    // (suspendIdleSidebarViews enforces that).
    let sidebarTimeoutMs = 5 * 60 * 1000;
    try {
      const ramMB = gxControl.sampleProcessMetrics({ force: false }).browserRamMB;
      const highRam =
        ramMB > 1024 || (s.gxRamLimiterEnabled && ramMB > 0.8 * (Number(s.gxRamLimitMB) || 4096));
      if (highRam) sidebarTimeoutMs = 60 * 1000;
    } catch (_) {}
    try {
      sidebarMod().suspendIdleSidebarViews(sidebarTimeoutMs);
    } catch (_) {}
    if (!s.autoSleepEnabled) return;
    // [Fix2 Battery saver] getEffectiveAutoSleepMs caps the timeout at 2
    // minutes while battery saver is on, so background tabs hibernate
    // sooner; otherwise the configured timeout applies.
    const timeoutMs = getEffectiveAutoSleepMs(s);
    const now = Date.now();
    let splitView = null;
    try { splitView = require('./splitview'); } catch (_) {}
    for (const ctx of windowContexts.values()) {
      for (const [id, tab] of ctx.tabs.entries()) {
        const pipActive = Boolean(tab?.pipActive || playerMod().getTabVideoState(tab)?.pipActive);
        const inSplit = Boolean(splitView && typeof splitView.isTabInVisibleSplit === 'function' && splitView.isTabInVisibleSplit(ctx, id));
        if (
          id !== ctx.activeTabId &&
          !inSplit &&
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
    sidebarMod().suspendIdleSidebarViews(timeoutMs);
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
  stopBackgroundTimers,
  getStatsIntervals,
  getEffectiveAutoSleepMs,
  hibernateNow,
  FAST_STATS_INTERVAL_MS,
  IDLE_STATS_INTERVAL_MS
};

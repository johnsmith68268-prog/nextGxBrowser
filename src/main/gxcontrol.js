const os = require('os');
const { app } = require('electron');
const { windowContexts, state } = require('./core');
const { resolveInternalUiFile } = require('./utils');

const playerMod = () => require('./player');

const SAMPLE_CACHE_MS = 500;
const RAM_HIBERNATE_COOLDOWN_MS = 5000;
const CDP_CMD_TIMEOUT_MS = 2500;

// In-memory session state
let lastSample = null;
let lastSampleAt = 0;
let ramHibernatedByLimiterCount = 0;
let lastRamHibernateAt = 0;
let cpuThrottlingActive = false;
let currentCpuThrottleRate = 1;

// Per-webContents coordinated CDP debugger state (shared by CPU & Network limiters)
// webContents.id -> {
//   wc, tabId, attachedByUs, cpuRate, netEnabled, netLimitMbps,
//   networkDomainEnabled, detachListenerAttached, destroyListenerAttached, queue
// }
const cdpStates = new Map();

function mbpsToBytesPerSec(mbps) {
  const num = Number(mbps);
  if (!Number.isFinite(num) || num <= 0) return -1;
  return Math.max(1, Math.round((num * 1000 * 1000) / 8));
}

function computeCpuThrottleRate(limitPercent, browserCpuPercent) {
  const cap = Number.isFinite(Number(limitPercent)) ? Math.max(25, Math.min(100, Number(limitPercent))) : 50;
  const usage = Number.isFinite(Number(browserCpuPercent)) ? Math.max(0, Number(browserCpuPercent)) : 0;
  let rate = 2;
  if (cap <= 30) rate = 6;
  else if (cap <= 55) rate = 4;
  else rate = 2;

  if (usage > cap * 1.5) {
    rate = Math.min(8, rate + 2);
  }
  return Math.max(2, Math.min(8, rate));
}

function aggregateProcessMetrics(metrics, coreCountInput) {
  const cores =
    Number.isFinite(Number(coreCountInput)) && Number(coreCountInput) > 0
      ? Math.round(Number(coreCountInput))
      : Math.max(1, (os.cpus() || []).length || 1);

  let totalWorkingSetKB = 0;
  let totalRawCpu = 0;
  const metricsByPid = new Map();

  if (Array.isArray(metrics)) {
    for (const m of metrics) {
      if (!m || typeof m !== 'object') continue;
      const workingSetKB =
        m.memory && typeof m.memory.workingSetSize === 'number' && Number.isFinite(m.memory.workingSetSize)
          ? Math.max(0, m.memory.workingSetSize)
          : 0;
      const rawCpu =
        m.cpu && typeof m.cpu.percentCPUUsage === 'number' && Number.isFinite(m.cpu.percentCPUUsage)
          ? Math.max(0, m.cpu.percentCPUUsage)
          : 0;

      totalWorkingSetKB += workingSetKB;
      totalRawCpu += rawCpu;

      if (typeof m.pid === 'number' && m.pid > 0) {
        metricsByPid.set(m.pid, {
          pid: m.pid,
          type: m.type || 'Unknown',
          ramMB: Math.round(workingSetKB / 1024),
          rawCpuPercent: rawCpu,
          cpuPercent: Math.max(0, Math.min(100, Math.round(rawCpu * 10) / 10))
        });
      }
    }
  }

  const browserRamMB = Math.round(totalWorkingSetKB / 1024);
  const browserCpuPercent = Math.max(0, Math.min(100, Math.round(totalRawCpu * 10) / 10));

  return {
    browserRamMB,
    browserCpuPercent,
    metricsByPid,
    coreCount: cores
  };
}

function isInternalUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  if (
    rawUrl.startsWith('chrome-error://') ||
    rawUrl.startsWith('devtools://') ||
    rawUrl.startsWith('nextgx://') ||
    rawUrl.startsWith('gx://')
  ) {
    return true;
  }
  return Boolean(resolveInternalUiFile(rawUrl));
}

function isInternalTab(tab) {
  if (!tab) return true;
  let liveUrl = '';
  try {
    if (tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) {
      liveUrl = tab.view.webContents.getURL() || '';
    }
  } catch (_) {}
  if (liveUrl && (liveUrl.startsWith('chrome-error://') || liveUrl.startsWith('devtools://'))) {
    return true;
  }
  const primaryUrl = tab.url || liveUrl || '';
  return isInternalUrl(primaryUrl);
}

function getSafeWebContents(tab) {
  if (!tab || tab.sleeping || !tab.view || !tab.view.webContents) return null;
  try {
    if (tab.view.webContents.isDestroyed()) return null;
    return tab.view.webContents;
  } catch (_) {
    return null;
  }
}

function primeMetrics() {
  try {
    if (app && typeof app.getAppMetrics === 'function') {
      app.getAppMetrics();
    }
  } catch (_) {}
}

function sampleProcessMetrics({ force = false } = {}) {
  const now = Date.now();
  if (!force && lastSample && now - lastSampleAt < SAMPLE_CACHE_MS) {
    return lastSample;
  }

  let rawMetrics = null;
  try {
    if (app && typeof app.getAppMetrics === 'function') {
      rawMetrics = app.getAppMetrics();
    }
  } catch (_) {
    rawMetrics = null;
  }

  let sample;
  if (Array.isArray(rawMetrics)) {
    sample = aggregateProcessMetrics(rawMetrics);
  } else {
    const cores = Math.max(1, (os.cpus() || []).length || 1);
    sample = {
      browserRamMB: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      browserCpuPercent: 0,
      metricsByPid: new Map(),
      coreCount: cores
    };
  }

  sample.sampledAt = now;
  lastSample = sample;
  lastSampleAt = now;
  return sample;
}

function isTabPipActive(tab) {
  if (!tab) return false;
  if (tab.pipActive) return true;
  try {
    return Boolean(playerMod().getTabVideoState(tab)?.pipActive);
  } catch (_) {
    return false;
  }
}

/**
 * Selects the least-recently-used eligible background tab across all windows.
 * Skips active, sleeping, pinned, audible, and PiP-active tabs (matching auto-hibernate rules).
 */
function selectRamHibernationCandidate(contexts) {
  let splitView = null;
  try { splitView = require('./splitview'); } catch (_) {}
  const candidates = [];
  for (const ctx of contexts) {
    if (!ctx || !ctx.tabs) continue;
    for (const [id, tab] of ctx.tabs.entries()) {
      if (!tab) continue;
      const inSplit = Boolean(splitView && typeof splitView.isTabInVisibleSplit === 'function' && splitView.isTabInVisibleSplit(ctx, id));
      if (id === ctx.activeTabId || inSplit || tab.sleeping || tab.pinned || tab.audible || isTabPipActive(tab)) {
        continue;
      }
      candidates.push({
        ctx,
        tab,
        lastActiveAt: Number.isFinite(Number(tab.lastActiveAt)) ? Number(tab.lastActiveAt) : 0
      });
    }
  }
  if (!candidates.length) {
    return { candidate: null, eligibleCount: 0 };
  }
  candidates.sort((a, b) => a.lastActiveAt - b.lastActiveAt);
  return { candidate: candidates[0], eligibleCount: candidates.length };
}

/**
 * Matches tabs to app.getAppMetrics() entries via webContents.id -> webContents.getOSProcessId() -> pid.
 * Multiple tabs sharing a Chromium renderer OS PID are marked sharedProcess=true and report the
 * shared process's real workingSetSize / normalized CPU rather than fabricating a split.
 */
function buildTabResourceMap(contexts, metricsByPid, cdpStateMap = cdpStates) {
  const entries = [];
  const pidCounts = new Map();

  for (const ctx of contexts) {
    if (!ctx || !ctx.tabs) continue;
    for (const [tabId, tab] of ctx.tabs.entries()) {
      if (!tab) continue;
      const wc = getSafeWebContents(tab);
      let wcId = null;
      let osPid = null;
      if (wc) {
        wcId = typeof wc.id === 'number' ? wc.id : null;
        try {
          const pid = typeof wc.getOSProcessId === 'function' ? wc.getOSProcessId() : 0;
          if (typeof pid === 'number' && pid > 0) {
            osPid = pid;
            pidCounts.set(pid, (pidCounts.get(pid) || 0) + 1);
          }
        } catch (_) {}
      }
      entries.push({ ctx, tabId, tab, wcId, osPid });
    }
  }

  const tabStats = {};
  for (const item of entries) {
    const { ctx, tabId, tab, wcId, osPid } = item;
    const active = tabId === ctx.activeTabId;
    const sleeping = Boolean(tab.sleeping);
    const cdpEntry = wcId !== null ? cdpStateMap.get(wcId) : null;
    const cpuThrottled = Boolean(!sleeping && !active && cdpEntry && cdpEntry.attachedByUs && cdpEntry.cpuRate > 1);
    const cpuThrottleRate = cpuThrottled ? cdpEntry.cpuRate : 1;
    const netLimited = Boolean(!sleeping && cdpEntry && cdpEntry.attachedByUs && cdpEntry.netEnabled);

    if (sleeping) {
      tabStats[tabId] = {
        tabId,
        windowId: ctx.win?.id ?? null,
        webContentsId: null,
        osPid: null,
        sleeping: true,
        pinned: Boolean(tab.pinned),
        audible: false,
        active,
        ramMB: 0,
        cpuPercent: 0,
        sharedProcess: false,
        sharedProcessCount: 0,
        matched: true,
        cpuThrottled: false,
        cpuThrottleRate: 1,
        netLimited: false
      };
      continue;
    }

    const proc = osPid !== null && metricsByPid ? metricsByPid.get(osPid) : null;
    const sharedCount = osPid !== null ? pidCounts.get(osPid) || 1 : 0;

    tabStats[tabId] = {
      tabId,
      windowId: ctx.win?.id ?? null,
      webContentsId: wcId,
      osPid,
      sleeping: false,
      pinned: Boolean(tab.pinned),
      audible: Boolean(tab.audible),
      active,
      ramMB: proc ? proc.ramMB : null,
      cpuPercent: proc ? proc.cpuPercent : null,
      sharedProcess: sharedCount > 1,
      sharedProcessCount: sharedCount,
      matched: Boolean(proc),
      cpuThrottled,
      cpuThrottleRate,
      netLimited
    };
  }

  return tabStats;
}

function sendCdpCommandWithTimeout(wc, method, params = {}) {
  if (!wc || wc.isDestroyed() || !wc.debugger || !wc.debugger.isAttached()) {
    return Promise.resolve(false);
  }
  let timer = null;
  const cmdPromise = wc.debugger
    .sendCommand(method, params)
    .then(() => true)
    .catch(() => false);
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), CDP_CMD_TIMEOUT_MS);
  });
  return Promise.race([cmdPromise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function ensureCdpEntry(wc, tabId) {
  const wcId = wc.id;
  let entry = cdpStates.get(wcId);
  if (!entry) {
    entry = {
      wcId,
      wc,
      tabId,
      attachedByUs: false,
      cpuRate: 1,
      netEnabled: false,
      netLimitMbps: 0,
      networkDomainEnabled: false,
      detachListenerAttached: false,
      destroyListenerAttached: false,
      queue: Promise.resolve()
    };
    cdpStates.set(wcId, entry);
  } else {
    entry.wc = wc;
    if (tabId) entry.tabId = tabId;
  }

  if (!entry.detachListenerAttached && wc.debugger && typeof wc.debugger.on === 'function') {
    entry.detachListenerAttached = true;
    wc.debugger.on('detach', () => {
      entry.attachedByUs = false;
      entry.cpuRate = 1;
      entry.netEnabled = false;
      entry.netLimitMbps = 0;
      entry.networkDomainEnabled = false;
    });
  }

  if (!entry.destroyListenerAttached && typeof wc.once === 'function') {
    entry.destroyListenerAttached = true;
    wc.once('destroyed', () => {
      cdpStates.delete(wcId);
    });
  }

  return entry;
}

function runCdpOp(wc, tabId, fn) {
  if (!wc) return Promise.resolve();
  try {
    if (wc.isDestroyed()) return Promise.resolve();
  } catch (_) {
    return Promise.resolve();
  }
  const entry = ensureCdpEntry(wc, tabId);
  const next = entry.queue
    .catch(() => {})
    .then(async () => {
      if (!entry.wc || entry.wc.isDestroyed()) {
        cdpStates.delete(entry.wcId);
        return;
      }
      await fn(entry);
    })
    .catch(() => {});
  entry.queue = next;
  return next;
}

function getSettingsSafe() {
  if (state.storage && typeof state.storage.getSettings === 'function') {
    return state.storage.getSettings();
  }
  return {
    gxRamLimiterEnabled: false,
    gxRamLimitMB: 4096,
    gxCpuLimiterEnabled: false,
    gxCpuLimitPercent: 50,
    gxNetLimiterEnabled: false,
    gxNetLimitMbps: 10
  };
}

function hasAnyAttachedCdp() {
  for (const entry of cdpStates.values()) {
    if (entry && entry.attachedByUs) return true;
  }
  return false;
}

/**
 * Coordinates real CDP CPU throttling (Emulation.setCPUThrottlingRate, background tabs only)
 * and real CDP network bandwidth limiting (Network.emulateNetworkConditions, awake non-internal tabs)
 * through a single shared webContents.debugger owner per tab.
 */
function syncTabCdpState(ctx, tab, { forceReapply = false } = {}) {
  const wc = getSafeWebContents(tab);
  if (!wc) return Promise.resolve();

  const preSettings = getSettingsSafe();
  if (!cdpStates.has(wc.id) && !preSettings.gxNetLimiterEnabled && !(preSettings.gxCpuLimiterEnabled && cpuThrottlingActive)) {
    return Promise.resolve();
  }

  return runCdpOp(wc, tab.id, async (entry) => {
    const s = getSettingsSafe();
    const isActive = Boolean(ctx && ctx.activeTabId === tab.id);
    const internal = isInternalTab(tab);

    // CPU limiter STRICTLY skips the active tab and internal UI pages.
    const desiredCpuRate =
      s.gxCpuLimiterEnabled && cpuThrottlingActive && !isActive && !internal ? currentCpuThrottleRate : 1;

    // Network limiter applies per-tab CDP download cap on awake non-internal tabs.
    const desiredNetEnabled = Boolean(s.gxNetLimiterEnabled && !internal);
    const desiredNetMbps = desiredNetEnabled ? s.gxNetLimitMbps : 0;

    const needsDebugger = desiredCpuRate > 1 || desiredNetEnabled;

    if (!needsDebugger) {
      if (entry.attachedByUs && !wc.isDestroyed() && wc.debugger.isAttached()) {
        if (entry.cpuRate > 1) {
          await sendCdpCommandWithTimeout(wc, 'Emulation.setCPUThrottlingRate', { rate: 1 });
          entry.cpuRate = 1;
        }
        if (entry.netEnabled) {
          await sendCdpCommandWithTimeout(wc, 'Network.emulateNetworkConditions', {
            offline: false,
            latency: 0,
            downloadThroughput: -1,
            uploadThroughput: -1
          });
          await sendCdpCommandWithTimeout(wc, 'Network.disable');
          entry.netEnabled = false;
          entry.netLimitMbps = 0;
          entry.networkDomainEnabled = false;
        }
        try {
          if (!wc.isDestroyed() && wc.debugger.isAttached() && entry.attachedByUs) {
            wc.debugger.detach();
          }
        } catch (_) {}
      }
      entry.attachedByUs = false;
      entry.cpuRate = 1;
      entry.netEnabled = false;
      entry.netLimitMbps = 0;
      entry.networkDomainEnabled = false;
      return;
    }

    // Attach debugger only if we own it or nobody else is attached.
    if (!wc.debugger.isAttached()) {
      try {
        wc.debugger.attach('1.3');
        entry.attachedByUs = true;
        entry.cpuRate = 1;
        entry.netEnabled = false;
        entry.netLimitMbps = 0;
        entry.networkDomainEnabled = false;
      } catch (_) {
        // Another debugger may have attached concurrently or target is closing — never crash.
        entry.attachedByUs = false;
        return;
      }
    } else if (!entry.attachedByUs) {
      // Debugger already attached by DevTools or an external tool — respect ownership and skip.
      return;
    }

    if (wc.isDestroyed() || !wc.debugger.isAttached() || !entry.attachedByUs) return;

    // Apply or release CPU throttling rate
    if (entry.cpuRate !== desiredCpuRate || (forceReapply && desiredCpuRate > 1)) {
      const ok = await sendCdpCommandWithTimeout(wc, 'Emulation.setCPUThrottlingRate', {
        rate: desiredCpuRate
      });
      if (ok) {
        entry.cpuRate = desiredCpuRate;
      }
    }

    if (wc.isDestroyed() || !wc.debugger.isAttached() || !entry.attachedByUs) return;

    // Apply or release Network throttling
    if (desiredNetEnabled) {
      if (forceReapply || !entry.networkDomainEnabled) {
        const netEnOk = await sendCdpCommandWithTimeout(wc, 'Network.enable', {
          maxTotalBufferSize: 0,
          maxResourceBufferSize: 0
        });
        if (netEnOk) {
          entry.networkDomainEnabled = true;
        }
      }
      if (wc.isDestroyed() || !wc.debugger.isAttached() || !entry.attachedByUs) return;
      if (forceReapply || !entry.netEnabled || entry.netLimitMbps !== desiredNetMbps) {
        const bytesPerSec = mbpsToBytesPerSec(desiredNetMbps);
        const emuOk = await sendCdpCommandWithTimeout(wc, 'Network.emulateNetworkConditions', {
          offline: false,
          latency: 0,
          downloadThroughput: bytesPerSec,
          uploadThroughput: -1
        });
        if (emuOk) {
          entry.netEnabled = true;
          entry.netLimitMbps = desiredNetMbps;
        }
      }
    } else if (entry.netEnabled) {
      await sendCdpCommandWithTimeout(wc, 'Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1
      });
      await sendCdpCommandWithTimeout(wc, 'Network.disable');
      entry.netEnabled = false;
      entry.netLimitMbps = 0;
      entry.networkDomainEnabled = false;
    }
  });
}

async function syncAllTabsCdp({ forceReapply = false } = {}) {
  const ops = [];
  for (const ctx of windowContexts.values()) {
    if (!ctx || !ctx.tabs) continue;
    for (const tab of ctx.tabs.values()) {
      if (!tab || tab.sleeping) continue;
      ops.push(syncTabCdpState(ctx, tab, { forceReapply }));
    }
  }
  await Promise.allSettled(ops);
}

async function enforceOnTick(sample, { sleepTab, bypassRamCooldown = false } = {}) {
  const s = getSettingsSafe();
  const metrics = sample || sampleProcessMetrics();
  const now = Date.now();

  // 1. RAM Limiter: hibernate least-recently-used eligible background tab when over cap
  if (s.gxRamLimiterEnabled && metrics.browserRamMB > s.gxRamLimitMB) {
    const cooldownOk = bypassRamCooldown || now - lastRamHibernateAt >= RAM_HIBERNATE_COOLDOWN_MS;
    if (cooldownOk && typeof sleepTab === 'function') {
      const { candidate } = selectRamHibernationCandidate(windowContexts.values());
      if (candidate && candidate.ctx && candidate.tab) {
        try {
          sleepTab(candidate.ctx, candidate.tab.id);
          if (candidate.tab.sleeping) {
            ramHibernatedByLimiterCount += 1;
            lastRamHibernateAt = now;
          }
        } catch (_) {}
      }
    }
  }

  // 2. CPU Limiter: engage CDP CPU throttling on background tabs when browser CPU exceeds cap;
  //    release cleanly when usage drops back to/below cap or limiter is disabled.
  if (!s.gxCpuLimiterEnabled) {
    cpuThrottlingActive = false;
    currentCpuThrottleRate = 1;
  } else if (metrics.browserCpuPercent > s.gxCpuLimitPercent) {
    cpuThrottlingActive = true;
    currentCpuThrottleRate = computeCpuThrottleRate(s.gxCpuLimitPercent, metrics.browserCpuPercent);
  } else {
    cpuThrottlingActive = false;
    currentCpuThrottleRate = 1;
  }

  // 3. Reconcile CDP state (CPU + Network limiters) across all awake tabs
  await syncAllTabsCdp({ forceReapply: false });
}

function onTabViewCreated(ctx, tab) {
  if (!ctx || !tab) return;
  const s = getSettingsSafe();
  if (!s.gxNetLimiterEnabled && !(s.gxCpuLimiterEnabled && cpuThrottlingActive)) {
    return;
  }
  syncTabCdpState(ctx, tab, { forceReapply: true }).catch(() => {});
}

function onTabNavigated(ctx, tab, { forceReapply = false } = {}) {
  if (!ctx || !tab) return;
  const wc = getSafeWebContents(tab);
  if (!wc) return;
  const s = getSettingsSafe();
  const hasEntry = cdpStates.has(wc.id);
  if (!hasEntry && !s.gxNetLimiterEnabled && !(s.gxCpuLimiterEnabled && cpuThrottlingActive)) {
    return;
  }
  syncTabCdpState(ctx, tab, { forceReapply }).catch(() => {});
}

function onActiveTabChanged(ctx) {
  if (!ctx || !ctx.tabs) return;
  const s = getSettingsSafe();
  const hasAnyAttached = hasAnyAttachedCdp();
  if (!hasAnyAttached && !s.gxCpuLimiterEnabled && !s.gxNetLimiterEnabled) {
    return;
  }
  for (const tab of ctx.tabs.values()) {
    if (!tab || tab.sleeping) continue;
    syncTabCdpState(ctx, tab, { forceReapply: false }).catch(() => {});
  }
}

function onTabDetached(tab) {
  if (!tab || !tab.view || !tab.view.webContents) return;
  const wc = tab.view.webContents;
  let wcId = null;
  try {
    wcId = wc.id;
  } catch (_) {
    return;
  }
  const entry = cdpStates.get(wcId);
  if (entry) {
    if (entry.attachedByUs) {
      try {
        if (!wc.isDestroyed() && wc.debugger.isAttached()) {
          wc.debugger.detach();
        }
      } catch (_) {}
    }
    cdpStates.delete(wcId);
  }
}

async function onSettingsChanged(settings, { sleepTab } = {}) {
  const s = settings || getSettingsSafe();
  const sample = sampleProcessMetrics({ force: false });

  if (!s.gxCpuLimiterEnabled) {
    cpuThrottlingActive = false;
    currentCpuThrottleRate = 1;
  } else if (sample.browserCpuPercent > s.gxCpuLimitPercent) {
    cpuThrottlingActive = true;
    currentCpuThrottleRate = computeCpuThrottleRate(s.gxCpuLimitPercent, sample.browserCpuPercent);
  } else {
    cpuThrottlingActive = false;
    currentCpuThrottleRate = 1;
  }

  await enforceOnTick(sample, { sleepTab, bypassRamCooldown: false });
}

function buildGxControlSnapshot(sample, settings) {
  const s = settings || getSettingsSafe();
  const metrics = sample || sampleProcessMetrics();
  const tabStats = buildTabResourceMap(windowContexts.values(), metrics.metricsByPid, cdpStates);

  const throttledTabIds = [];
  const netLimitedTabIds = [];
  for (const [tabId, info] of Object.entries(tabStats)) {
    if (info.cpuThrottled) throttledTabIds.push(tabId);
    if (info.netLimited) netLimitedTabIds.push(tabId);
  }

  const { eligibleCount } = selectRamHibernationCandidate(windowContexts.values());

  return {
    tabStats,
    gxControl: {
      ram: {
        enabled: Boolean(s.gxRamLimiterEnabled),
        limitMB: s.gxRamLimitMB,
        currentMB: metrics.browserRamMB,
        overLimit: Boolean(s.gxRamLimiterEnabled && metrics.browserRamMB > s.gxRamLimitMB),
        hibernatedCount: ramHibernatedByLimiterCount,
        eligibleBackgroundTabs: eligibleCount
      },
      cpu: {
        enabled: Boolean(s.gxCpuLimiterEnabled),
        limitPercent: s.gxCpuLimitPercent,
        currentPercent: metrics.browserCpuPercent,
        throttlingActive: Boolean(s.gxCpuLimiterEnabled && cpuThrottlingActive),
        throttledRate: s.gxCpuLimiterEnabled && cpuThrottlingActive ? currentCpuThrottleRate : 1,
        throttledTabIds,
        throttledCount: throttledTabIds.length
      },
      network: {
        enabled: Boolean(s.gxNetLimiterEnabled),
        limitMbps: s.gxNetLimitMbps,
        active: Boolean(s.gxNetLimiterEnabled),
        limitedTabIds: netLimitedTabIds,
        limitedCount: netLimitedTabIds.length,
        throughputMeasured: false
      }
    }
  };
}

function getRamHibernationStats() {
  return {
    hibernatedCount: ramHibernatedByLimiterCount,
    lastHibernateAt: lastRamHibernateAt
  };
}

function shutdown() {
  cpuThrottlingActive = false;
  currentCpuThrottleRate = 1;
  for (const [wcId, entry] of cdpStates.entries()) {
    try {
      if (entry.attachedByUs && entry.wc && !entry.wc.isDestroyed() && entry.wc.debugger.isAttached()) {
        entry.wc.debugger.detach();
      }
    } catch (_) {}
    cdpStates.delete(wcId);
  }
}

module.exports = {
  SAMPLE_CACHE_MS,
  RAM_HIBERNATE_COOLDOWN_MS,
  mbpsToBytesPerSec,
  computeCpuThrottleRate,
  aggregateProcessMetrics,
  selectRamHibernationCandidate,
  buildTabResourceMap,
  isInternalUrl,
  isInternalTab,
  primeMetrics,
  sampleProcessMetrics,
  syncTabCdpState,
  syncAllTabsCdp,
  enforceOnTick,
  onTabViewCreated,
  onTabNavigated,
  onActiveTabChanged,
  onTabDetached,
  onSettingsChanged,
  buildGxControlSnapshot,
  getRamHibernationStats,
  shutdown
};

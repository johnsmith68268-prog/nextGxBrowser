const { session } = require('electron');
const { state } = require('./core');
const { getCtxFromSender, sendToWebUiTabs } = require('./broadcast');
const profilesMod = () => require('./profiles');

function cancelScheduledCookiesBroadcast() {
  if (state.cookiesUpdateTimer) {
    clearTimeout(state.cookiesUpdateTimer);
    state.cookiesUpdateTimer = null;
  }
}

function broadcastCookiesUpdate({ immediate = false, profileId = null } = {}) {
  if (state.isAppQuitting) return;
  if (immediate) {
    cancelScheduledCookiesBroadcast();
    sendToWebUiTabs('cookies:update', undefined, { profileId });
    return;
  }
  if (state.cookiesUpdateTimer) return;
  state.cookiesUpdateTimer = setTimeout(() => {
    state.cookiesUpdateTimer = null;
    if (!state.isAppQuitting) {
      sendToWebUiTabs('cookies:update', undefined, { profileId });
    }
  }, 100);
}

function resolveCookieSessionForSender(sender) {
  const ctx = getCtxFromSender(sender);
  if (ctx && ctx.session) {
    return {
      ses: ctx.session,
      profileId: ctx.profileId || 'default',
      incognito: Boolean(ctx.incognito),
      ctx
    };
  }
  const pid = ctx?.profileId || state.storage?.getActiveProfileId?.() || 'default';
  const ses = profilesMod().getSessionForProfile(pid) || session.defaultSession;
  return { ses, profileId: pid, incognito: false, ctx: null };
}

function notifySenderCookieChange({ incognito, profileId, ctx }) {
  if (incognito) {
    if (ctx && ctx.tabs instanceof Map) {
      const { isWebUiUrl } = require('./utils');
      for (const tab of ctx.tabs.values()) {
        const wc = tab?.view?.webContents;
        if (!wc || wc.isDestroyed()) continue;
        try {
          if (isWebUiUrl(tab.url) || isWebUiUrl(wc.getURL())) {
            wc.send('cookies:update');
          }
        } catch (_) {}
      }
    }
    return;
  }
  broadcastCookiesUpdate({ immediate: true, profileId });
}

// Cookies Management (defaultSession)
// Note: Private-window cookies live in ephemeral partitions and vanish when the window closes.
const normalizeCookieDomain = (d) =>
  String(d || '')
    .trim()
    .toLowerCase()
    .replace(/^\.+/, '');

const buildCookieUrl = (cookie) => {
  const host = normalizeCookieDomain(cookie?.domain);
  if (!host) return '';
  const protocol = cookie.secure ? 'https://' : 'http://';
  const rawPath = typeof cookie.path === 'string' && cookie.path ? cookie.path : '/';
  const cookiePath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  return `${protocol}${host}${cookiePath}`;
};

const doesCookieMatchTarget = (cookie, target) => {
  const cDom = normalizeCookieDomain(cookie?.domain);
  if (!cDom) return false;
  const raw =
    typeof target === 'object' && target !== null
      ? target.origin || target.url || target.domain || ''
      : String(target || '');
  const trimmed = String(raw || '').trim();
  if (!trimmed) return true;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      const host = normalizeCookieDomain(u.hostname);
      if (!host) return false;
      return cDom === host || host.endsWith(`.${cDom}`);
    } catch (_) {
      return false;
    }
  }

  const targetDom = normalizeCookieDomain(trimmed);
  if (!targetDom) return false;
  return cDom === targetDom;
};

function registerCookieIpcHandlers(handleInternal) {
  handleInternal('cookies:get', async (e, filter) => {
    const { ses } = resolveCookieSessionForSender(e.sender);
    const all = await ses.cookies.get({});
    const filtered = filter ? (all || []).filter((c) => doesCookieMatchTarget(c, filter)) : all || [];
    return filtered.map((c) => ({
      domain: c.domain || '',
      name: c.name || '',
      path: c.path || '/',
      expirationDate: c.expirationDate ?? null,
      session: Boolean(c.session),
      secure: Boolean(c.secure),
      httpOnly: Boolean(c.httpOnly)
    }));
  });

  handleInternal('cookies:remove', async (e, arg1, arg2) => {
    const resolved = resolveCookieSessionForSender(e.sender);
    const { ses } = resolved;
    let url = '';
    let name = '';
    if (arg1 && typeof arg1 === 'object') {
      url = typeof arg1.url === 'string' ? arg1.url.trim() : '';
      name = typeof arg1.name === 'string' ? arg1.name : '';
    } else {
      url = typeof arg1 === 'string' ? arg1.trim() : '';
      name = typeof arg2 === 'string' ? arg2 : '';
    }
    if (!url || !name || !/^https?:\/\//i.test(url)) return { ok: false };
    await ses.cookies.remove(url, name);
    await ses.cookies.flushStore().catch(() => {});
    notifySenderCookieChange(resolved);
    return { ok: true };
  });

  handleInternal('cookies:clear-site', async (e, originOrDomain) => {
    const resolved = resolveCookieSessionForSender(e.sender);
    const { ses } = resolved;
    const raw =
      typeof originOrDomain === 'object' && originOrDomain !== null
        ? originOrDomain.origin || originOrDomain.url || originOrDomain.domain || ''
        : String(originOrDomain || '');
    if (!String(raw || '').trim()) return { ok: false, removed: 0 };

    const all = await ses.cookies.get({});
    const matched = (all || []).filter((c) => doesCookieMatchTarget(c, originOrDomain));
    let removed = 0;
    for (const c of matched) {
      const url = buildCookieUrl(c);
      if (url && c.name) {
        await ses.cookies.remove(url, c.name).catch(() => {});
        removed += 1;
      }
    }
    await ses.cookies.flushStore().catch(() => {});
    notifySenderCookieChange(resolved);
    return { ok: true, removed };
  });

  handleInternal('cookies:clear-all', async (e) => {
    const resolved = resolveCookieSessionForSender(e.sender);
    const { ses } = resolved;
    const all = await ses.cookies.get({});
    let removed = 0;
    for (const c of all || []) {
      const url = buildCookieUrl(c);
      if (url && c.name) {
        await ses.cookies.remove(url, c.name).catch(() => {});
        removed += 1;
      }
    }
    await ses.clearStorageData({ storages: ['cookies'] }).catch(() => {});
    await ses.cookies.flushStore().catch(() => {});
    notifySenderCookieChange(resolved);
    return { ok: true, removed };
  });
}

module.exports = {
  cancelScheduledCookiesBroadcast,
  broadcastCookiesUpdate,
  normalizeCookieDomain,
  buildCookieUrl,
  doesCookieMatchTarget,
  registerCookieIpcHandlers
};

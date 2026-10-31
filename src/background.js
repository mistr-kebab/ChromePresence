import {
  ALARM_KEEPALIVE,
  HOST_NAME,
  isValidAppId,
  normalizeSettings,
  STORAGE_KEY,
} from './shared/defaults.js';
import { getHostname, displayHost } from './shared/domain.js';
import { activityKey, createActivity } from './shared/presence.js';
import { getSession, getSettings, saveSession } from './shared/storage.js';

const SEND_INTERVAL_MS = 4500;
const RECONNECT_MAX_MS = 30000;

const state = {
  initialized: null,
  settings: null,
  runtime: {
    tabId: null,
    url: null,
    windowId: null,
    startedAt: 0,
    focused: true,
    idle: 'active',
  },
  preview: { title: '', host: '', reason: null, tabId: null },
  desiredActivity: null,
  desiredSet: false,
  desiredKey: 'null',
  sentKey: null,
  lastSentAt: 0,
  sendTimer: null,
  refreshTimer: null,
  refreshChain: Promise.resolve(),
  port: null,
  host: { state: 'idle', error: null },
  discord: { state: 'unknown', error: null },
  reconnectTimer: null,
  reconnectDelay: 1000,
  lastError: null,
  lastRuntimeJson: '',
};

function logError(error) {
  console.error('[Chrome Presence]', error);
}

function applyIdleInterval(settings) {
  const seconds =
    settings.idleTimeoutMinutes > 0
      ? Math.max(15, settings.idleTimeoutMinutes * 60)
      : 3600;
  try {
    chrome.idle.setDetectionInterval(seconds);
  } catch {
    // Ignore: idle detection is optional for presence.
  }
}

async function updateBadge() {
  try {
    if (!state.settings) return;
    if (!state.settings.enabled) {
      await chrome.action.setBadgeBackgroundColor({ color: '#4E5058' });
      await chrome.action.setBadgeText({ text: 'II' });
      return;
    }
    if (!isValidAppId(state.settings.appId)) {
      await chrome.action.setBadgeBackgroundColor({ color: '#F0B232' });
      await chrome.action.setBadgeText({ text: '!' });
      return;
    }
    await chrome.action.setBadgeText({ text: '' });
  } catch {
    // Badge failures must never break presence.
  }
}

function persistRuntime() {
  const snapshot = {
    tabId: state.runtime.tabId,
    url: state.runtime.url,
    windowId: state.runtime.windowId,
    startedAt: state.runtime.startedAt,
    focused: state.runtime.focused,
    idle: state.runtime.idle,
  };
  const json = JSON.stringify(snapshot);
  if (json === state.lastRuntimeJson) return;
  state.lastRuntimeJson = json;
  saveSession(snapshot);
}

function ensureInit() {
  if (!state.initialized) {
    state.initialized = init().catch((error) => {
      state.initialized = null;
      throw error;
    });
  }
  return state.initialized;
}

async function init() {
  state.settings = await getSettings();
  const savedRuntime = await getSession();
  state.runtime = {
    ...state.runtime,
    ...savedRuntime,
  };
  state.lastRuntimeJson = JSON.stringify({
    tabId: state.runtime.tabId,
    url: state.runtime.url,
    windowId: state.runtime.windowId,
    startedAt: state.runtime.startedAt,
    focused: state.runtime.focused,
    idle: state.runtime.idle,
  });

  applyIdleInterval(state.settings);
  updateBadge();

  try {
    await chrome.alarms.create(ALARM_KEEPALIVE, { periodInMinutes: 1 });
  } catch {
    // Alarms only keep the worker warm; they are not critical.
  }

  await refresh('init');
}

function requestRefresh(reason) {
  return ensureInit().then(() => {
    const next = state.refreshChain.then(() => refresh(reason));
    state.refreshChain = next.catch(() => {});
    return next;
  });
}

function scheduleRefresh(reason, delay = 350) {
  if (state.refreshTimer) clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(() => {
    state.refreshTimer = null;
    requestRefresh(reason).catch(logError);
  }, delay);
}

async function refresh(reason) {
  const settings = state.settings;
  if (!settings) return;

  if (!settings.enabled) {
    disconnectPort();
    setDesired(null, 'paused');
    state.preview = { title: '', host: '', reason: 'paused', tabId: null };
    persistRuntime();
    return;
  }

  if (!isValidAppId(settings.appId)) {
    disconnectPort();
    setDesired(null, 'no-app-id');
    persistRuntime();
    return;
  }

  let idle = 'active';
  if (settings.idleTimeoutMinutes > 0) {
    try {
      idle = await chrome.idle.queryState(settings.idleTimeoutMinutes * 60);
    } catch {
      idle = 'active';
    }
  }
  state.runtime.idle = idle;

  if (idle !== 'active') {
    setDesired(null, 'idle');
    persistRuntime();
    return;
  }

  let lastFocused = null;
  try {
    lastFocused = await chrome.windows.getLastFocused({ populate: false });
  } catch {
    lastFocused = null;
  }

  const focused = Boolean(lastFocused?.focused);
  state.runtime.focused = focused;

  if (!focused && settings.onlyWhenFocused) {
    setDesired(null, 'unfocused');
    persistRuntime();
    return;
  }

  let tab = null;
  if (lastFocused?.id != null) {
    try {
      const tabs = await chrome.tabs.query({
        active: true,
        windowId: lastFocused.id,
      });
      tab = tabs[0] ?? null;
    } catch {
      tab = null;
    }
  }

  if (!tab) {
    state.runtime.tabId = null;
    state.runtime.url = null;
    state.runtime.startedAt = 0;
    state.preview = { title: '', host: '', reason: 'no-tab', tabId: null };
    setDesired(null, 'no-tab');
    persistRuntime();
    return;
  }

  const samePage =
    state.runtime.tabId === tab.id && state.runtime.url === tab.url;
  if (!samePage || !state.runtime.startedAt) {
    state.runtime.startedAt = Date.now();
  }
  state.runtime.tabId = tab.id;
  state.runtime.url = tab.url;
  state.runtime.windowId = lastFocused.id;

  const host = displayHost(getHostname(tab.url));
  state.preview = {
    title: tab.title || '',
    host,
    reason: null,
    tabId: tab.id ?? null,
  };

  const built = createActivity({
    tab,
    settings,
    startedAt: state.runtime.startedAt,
    now: Date.now(),
  });

  if (!built.activity) {
    if (built.reason === 'incognito') {
      state.preview = {
        title: '',
        host: '',
        reason: 'incognito',
        tabId: tab.id ?? null,
      };
    } else {
      state.preview.host = built.host || host;
      state.preview.reason = built.reason;
    }
    setDesired(null, built.reason);
    persistRuntime();
    return;
  }

  state.preview.host = built.host || host;
  state.preview.reason = null;
  ensurePort();
  setDesired(built.activity, null);
  await persistRuntime();
}

function setDesired(activity, reason) {
  state.desiredActivity = activity;
  state.desiredSet = true;
  state.desiredKey = activityKey(activity);
  if (reason) state.preview.reason = reason;

  if (activity) {
    ensurePort();
    queuePresence();
  } else if (state.port) {
    queuePresence({ immediate: true });
  } else {
    state.sentKey = 'null';
    state.lastSentAt = 0;
  }
}

function queuePresence({ immediate = false } = {}) {
  if (!state.desiredSet) return;

  if (!state.port) {
    if (state.desiredActivity) ensurePort();
    if (!state.port) return;
  }

  if (state.sentKey === state.desiredKey) return;

  const now = Date.now();
  const wait = immediate
    ? 0
    : Math.max(0, SEND_INTERVAL_MS - (now - state.lastSentAt));

  if (state.sendTimer) {
    clearTimeout(state.sendTimer);
    state.sendTimer = null;
  }

  if (wait <= 0) {
    flushPresence();
  } else {
    state.sendTimer = setTimeout(() => {
      state.sendTimer = null;
      flushPresence();
    }, wait);
  }
}

function flushPresence() {
  if (!state.port || !state.desiredSet) return;
  if (state.sentKey === state.desiredKey) return;

  try {
    state.port.postMessage({
      type: 'presence',
      activity: state.desiredActivity,
    });
    state.sentKey = state.desiredKey;
    state.lastSentAt = Date.now();
  } catch (error) {
    handlePortError(error);
  }
}

function ensurePort({ force = false } = {}) {
  const settings = state.settings;
  if (!settings?.enabled || !isValidAppId(settings.appId)) return;

  if (state.port && !force) return;
  if (state.port && force) disconnectPort();

  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  let port;
  try {
    port = chrome.runtime.connectNative(HOST_NAME);
  } catch (error) {
    handlePortError(error);
    return;
  }

  state.port = port;
  state.sentKey = null;
  state.lastSentAt = 0;
  state.host = { state: 'connecting', error: null };
  state.discord = { state: 'unknown', error: null };

  port.onMessage.addListener(handleHostMessage);
  port.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError?.message || null;
    if (state.port === port) {
      state.port = null;
      state.sentKey = null;
      state.host = { state: 'disconnected', error };
      state.discord = { state: 'unknown', error: null };
      if (error) state.lastError = error;
      if (state.sendTimer) {
        clearTimeout(state.sendTimer);
        state.sendTimer = null;
      }
    }
    scheduleReconnect();
  });

  try {
    port.postMessage({
      type: 'hello',
      version: 1,
      appId: settings.appId,
      extensionId: chrome.runtime.id,
    });
    state.host = { state: 'connected', error: null };
    state.reconnectDelay = 1000;
    if (state.desiredSet) queuePresence({ immediate: true });
  } catch (error) {
    handlePortError(error);
  }
}

function handleHostMessage(message) {
  if (!message || typeof message !== 'object') return;

  state.host = { state: 'connected', error: null };
  state.reconnectDelay = 1000;

  if (message.type === 'hello-ack') return;

  if (message.type === 'status') {
    const known = ['connected', 'connecting', 'disconnected', 'error', 'idle'];
    const discord = known.includes(message.discord)
      ? message.discord
      : 'unknown';
    const error = message.error ? String(message.error) : null;
    state.discord = { state: discord, error };
    if (error) state.lastError = error;
    if (discord === 'connected') state.lastError = null;
  }
}

function disconnectPort() {
  const port = state.port;
  state.port = null;
  state.sentKey = null;
  state.host = { state: 'disconnected', error: null };
  state.discord = { state: 'unknown', error: null };
  if (state.sendTimer) {
    clearTimeout(state.sendTimer);
    state.sendTimer = null;
  }
  if (port) {
    try {
      port.disconnect();
    } catch {
      // The port may already be gone.
    }
  }
}

function scheduleReconnect() {
  if (state.reconnectTimer || state.port) return;
  const settings = state.settings;
  if (!settings?.enabled || !isValidAppId(settings.appId)) return;

  const delay = state.reconnectDelay;
  state.reconnectDelay = Math.min(
    RECONNECT_MAX_MS,
    Math.round(state.reconnectDelay * 1.8),
  );

  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    if (!state.port) ensurePort({ force: true });
  }, delay);
}

function handlePortError(error) {
  state.lastError = error?.message || String(error);
  state.host = { state: 'error', error: state.lastError };
  state.discord = { state: 'unknown', error: null };
  if (state.port) {
    const port = state.port;
    state.port = null;
    state.sentKey = null;
    try {
      port.disconnect();
    } catch {
      // Ignore.
    }
  }
  scheduleReconnect();
}

function applySettingsChange(rawSettings) {
  const previous = state.settings;
  const next = normalizeSettings(rawSettings);
  state.settings = next;

  const previousAppId = previous?.appId ?? '';
  const appIdChanged = previousAppId !== next.appId;
  const wasEnabled = previous?.enabled ?? false;

  updateBadge();
  applyIdleInterval(next);

  if (!next.enabled || !isValidAppId(next.appId)) {
    disconnectPort();
    setDesired(null, !next.enabled ? 'paused' : 'no-app-id');
    if (!next.enabled) {
      state.preview = { title: '', host: '', reason: 'paused', tabId: null };
    }
    return;
  }

  if (appIdChanged || (!wasEnabled && next.enabled)) {
    disconnectPort();
    state.reconnectDelay = 250;
    state.lastError = null;
    ensurePort();
    if (state.desiredSet) queuePresence({ immediate: true });
  }

  scheduleRefresh('settings', 100);
}

function snapshot() {
  return {
    ok: true,
    enabled: Boolean(state.settings?.enabled),
    appIdConfigured: isValidAppId(state.settings?.appId),
    extensionId: chrome.runtime.id,
    hostName: HOST_NAME,
    version: chrome.runtime.getManifest().version,
    host: state.host,
    discord: state.discord,
    activity: state.desiredActivity,
    preview: state.preview,
    runtime: {
      focused: state.runtime.focused,
      idle: state.runtime.idle,
    },
    lastError: state.lastError,
  };
}

chrome.runtime.onInstalled.addListener((details) => {
  ensureInit().catch(logError);
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage().catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(() => {
  ensureInit().catch(logError);
});

chrome.tabs.onActivated.addListener(() => {
  scheduleRefresh('tab-activated', 200);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url && !changeInfo.title) return;
  if (tabId !== state.runtime.tabId && !changeInfo.url) return;
  scheduleRefresh('tab-updated', changeInfo.url ? 250 : 650);
});

chrome.tabs.onRemoved.addListener(() => {
  scheduleRefresh('tab-removed', 150);
});

chrome.windows.onFocusChanged.addListener(() => {
  scheduleRefresh('window-focus', 100);
});

chrome.windows.onRemoved.addListener(() => {
  scheduleRefresh('window-removed', 100);
});

chrome.idle.onStateChanged.addListener((newState) => {
  state.runtime.idle = newState;
  scheduleRefresh('idle', 0);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_KEEPALIVE) return;
  ensureInit()
    .then(() => {
      ensurePort();
      return requestRefresh('alarm');
    })
    .catch(logError);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes[STORAGE_KEY]) return;
  const next = changes[STORAGE_KEY].newValue;
  ensureInit()
    .then(() => applySettingsChange(next))
    .catch(logError);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  if (message.type === 'getStatus') {
    requestRefresh('status')
      .then(() => sendResponse(snapshot()))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === 'reconnect') {
    requestRefresh('reconnect-before')
      .then(() => {
        disconnectPort();
        state.reconnectDelay = 250;
        state.lastError = null;
        ensurePort();
        if (state.desiredSet) queuePresence({ immediate: true });
        return requestRefresh('manual-reconnect');
      })
      .then(() => sendResponse(snapshot()))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === 'refresh') {
    requestRefresh('popup-refresh')
      .then(() => sendResponse(snapshot()))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  return false;
});

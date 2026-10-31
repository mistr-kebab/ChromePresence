import { isValidAppId } from '../shared/defaults.js';
import { getSettings, saveSettings } from '../shared/storage.js';

const $ = (id) => document.getElementById(id);

const el = {
  popupStatus: $('popup-status'),
  enabledToggle: $('enabled-toggle'),
  shareHint: $('share-hint'),
  liveBadge: $('live-badge'),
  previewDetails: $('preview-details'),
  previewState: $('preview-state'),
  previewTime: $('preview-time'),
  currentTab: $('current-tab'),
  setupBanner: $('setup-banner'),
  setupButton: $('setup-button'),
  errorBanner: $('error-banner'),
  errorTitle: $('error-title'),
  errorText: $('error-text'),
  reconnect: $('reconnect'),
  settings: $('settings'),
  optionsLink: $('options-link'),
  toast: $('toast'),
};

const REASON_LABELS = {
  paused: 'Presence is paused',
  'no-app-id': 'Discord app ID is missing',
  idle: 'Idle – presence hidden',
  unfocused: 'Chrome is not focused',
  'no-tab': 'No active tab',
  incognito: 'Incognito tab is not shared',
  internal: 'Internal browser page is not shared',
  excluded: 'Domain is excluded',
};

const HOST_NOT_FOUND =
  'The host is not installed. Run “./host/install.sh” and reload the extension.';

let lastStatus = null;
let pollTimer = null;
let elapsedTimer = null;
let toastTimer = null;
let busy = false;

function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, 2000);
}

function reasonLabel(reason) {
  if (!reason) return 'Ready to share';
  return REASON_LABELS[reason] || 'No activity';
}

function explainHostError(message) {
  if (!message) return HOST_NOT_FOUND;
  if (/native messaging host not found/i.test(message)) return HOST_NOT_FOUND;
  if (/forbidden/i.test(message)) {
    return 'The extension ID does not match the installed host. Install the host again.';
  }
  return message;
}

function formatElapsed(startSeconds) {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - startSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `for ${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `for ${minutes}:${String(secs).padStart(2, '0')}`;
}

function renderElapsed() {
  const activity = lastStatus?.activity;
  if (activity?.timestamps?.start) {
    el.previewTime.textContent = formatElapsed(activity.timestamps.start);
    el.previewTime.hidden = false;
  } else {
    el.previewTime.hidden = true;
  }
}

function setBadge(text, tone) {
  el.liveBadge.textContent = text;
  el.liveBadge.dataset.tone = tone;
}

function render(status) {
  if (!status?.ok) {
    el.popupStatus.textContent = 'Status unavailable';
    setBadge('Offline', 'danger');
    el.errorTitle.textContent = 'Status unavailable';
    el.errorText.textContent = status?.error || 'Unknown error.';
    el.errorBanner.hidden = false;
    return;
  }

  lastStatus = status;
  const appOk = status.appIdConfigured;
  const hostOk = status.host?.state === 'connected';
  const discordOk = status.discord?.state === 'connected';
  const connected = hostOk && discordOk;
  const activity = status.activity;
  const preview = status.preview || {};

  el.enabledToggle.checked = Boolean(status.enabled);
  el.enabledToggle.disabled = busy;

  let statusText = 'Connecting…';
  if (!status.enabled) statusText = 'Paused';
  else if (!appOk) statusText = 'Setup required';
  else if (hostOk && discordOk) statusText = 'Connected to Discord';
  else if (!hostOk && (status.host?.state === 'disconnected' || status.host?.state === 'error')) {
    statusText = 'Host unreachable';
  } else if (hostOk && !discordOk) statusText = 'Discord unreachable';
  else if (status.discord?.state === 'error') statusText = 'Discord error';
  el.popupStatus.textContent = statusText;

  el.shareHint.textContent = !status.enabled
    ? 'Paused'
    : !appOk
      ? 'App ID missing'
      : 'On';

  if (!status.enabled) setBadge('Paused', 'neutral');
  else if (!appOk) setBadge('Setup', 'warn');
  else if (connected && activity) setBadge('Live', 'ok');
  else if (connected) setBadge('Ready', 'neutral');
  else if (
    status.host?.state === 'disconnected' ||
    status.host?.state === 'error' ||
    status.discord?.state === 'error'
  ) {
    setBadge('Offline', 'danger');
  } else setBadge('Connecting…', 'warn');

  if (activity) {
    el.previewDetails.textContent = activity.details || 'Chrome';
    el.previewDetails.title = activity.details || '';
    el.previewState.textContent = activity.state || '';
    el.previewState.title = activity.state || '';
    el.previewState.hidden = !activity.state;
    renderElapsed();
  } else {
    el.previewDetails.textContent = reasonLabel(preview.reason);
    el.previewDetails.title = '';
    el.previewState.textContent = preview.host || '';
    el.previewState.title = preview.host || '';
    el.previewState.hidden = !preview.host;
    el.previewTime.hidden = true;
  }

  if (preview.title || preview.host) {
    el.currentTab.textContent = `Current: ${preview.title || preview.host}`;
    el.currentTab.title = preview.title || preview.host;
  } else {
    el.currentTab.textContent = '';
    el.currentTab.title = '';
  }

  el.setupBanner.hidden = !status.enabled || appOk;

  let errorTitle = '';
  let errorText = '';
  if (status.enabled && appOk) {
    if (status.host?.state === 'disconnected' || status.host?.state === 'error') {
      errorTitle = 'Host unreachable';
      errorText = explainHostError(status.host?.error);
    } else if (status.discord?.state === 'error') {
      errorTitle = 'Discord reported an error';
      errorText = status.discord?.error || 'Check the app ID and the logs.';
    } else if (status.discord?.state === 'disconnected') {
      errorTitle = 'Discord not found';
      errorText = 'Start the Discord desktop app. The host will reconnect automatically.';
    }
  }

  if (errorTitle) {
    el.errorTitle.textContent = errorTitle;
    el.errorText.textContent = errorText;
    el.errorBanner.hidden = false;
  } else {
    el.errorBanner.hidden = true;
  }
}

async function refresh() {
  try {
    const status = await chrome.runtime.sendMessage({ type: 'getStatus' });
    render(status);
  } catch (error) {
    render({ ok: false, error: String(error) });
  }
}

async function toggleEnabled(enabled) {
  if (busy) return;
  busy = true;
  el.enabledToggle.disabled = true;
  try {
    const settings = await getSettings();
    await saveSettings({ ...settings, enabled });
    const status = await chrome.runtime.sendMessage({ type: 'refresh' });
    render(status);
    toast(enabled ? 'Presence enabled' : 'Presence paused');
  } catch (error) {
    el.enabledToggle.checked = !enabled;
    toast('Could not save the change');
    console.error('[Chrome Presence]', error);
  } finally {
    busy = false;
    el.enabledToggle.disabled = false;
  }
}

async function reconnect() {
  if (busy) return;
  busy = true;
  el.reconnect.disabled = true;
  el.reconnect.textContent = 'Connecting…';
  try {
    const status = await chrome.runtime.sendMessage({ type: 'reconnect' });
    render(status);
    toast('Connection restarted');
  } catch (error) {
    toast('Connection failed');
    console.error('[Chrome Presence]', error);
  } finally {
    busy = false;
    el.reconnect.disabled = false;
    el.reconnect.textContent = 'Reconnect';
  }
}

function openOptions() {
  chrome.runtime.openOptionsPage();
}

el.enabledToggle.addEventListener('change', () => {
  toggleEnabled(el.enabledToggle.checked);
});

el.settings.addEventListener('click', openOptions);
el.optionsLink.addEventListener('click', openOptions);
el.setupButton.addEventListener('click', openOptions);
el.reconnect.addEventListener('click', reconnect);

window.addEventListener('pagehide', () => {
  if (pollTimer) clearInterval(pollTimer);
  if (elapsedTimer) clearInterval(elapsedTimer);
});

refresh();
pollTimer = setInterval(refresh, 2000);
elapsedTimer = setInterval(renderElapsed, 1000);

import {
  DEFAULT_SETTINGS,
  HOST_NAME,
  isValidAppId,
  normalizeSettings,
} from '../shared/defaults.js';
import { getSettings, saveSettings } from '../shared/storage.js';

const $ = (id) => document.getElementById(id);

const el = {
  saveState: $('save-state'),
  statusDot: $('status-dot'),
  statusHeading: $('status-heading'),
  statusDetail: $('status-detail'),
  enabledToggle: $('enabled-toggle'),
  toggleHint: $('toggle-hint'),
  presencePreview: $('presence-preview'),
  previewDetails: $('preview-details'),
  previewState: $('preview-state'),
  previewTime: $('preview-time'),
  currentPage: $('current-page'),
  reconnect: $('reconnect'),
  stepApp: $('step-app'),
  stepHost: $('step-host'),
  stepDiscord: $('step-discord'),
  stepAppBadge: $('step-app-badge'),
  stepHostBadge: $('step-host-badge'),
  stepDiscordBadge: $('step-discord-badge'),
  setupCallout: $('setup-callout'),
  setupCalloutTitle: $('setup-callout-title'),
  setupCalloutText: $('setup-callout-text'),
  extensionId: $('extension-id'),
  hostName: $('host-name'),
  aboutHost: $('about-host'),
  version: $('version'),
  manualManifest: $('manual-manifest'),
  appId: $('app-id'),
  appIdError: $('app-id-error'),
  activityType: $('activity-type'),
  detailsSource: $('details-source'),
  stateSource: $('state-source'),
  showTimestamp: $('show-timestamp'),
  showSiteIcon: $('show-site-icon'),
  iconTemplateField: $('icon-template-field'),
  iconTemplate: $('icon-template'),
  largeImageKey: $('large-image-key'),
  largeText: $('large-text'),
  smallImageKey: $('small-image-key'),
  smallText: $('small-text'),
  onlyWhenFocused: $('only-when-focused'),
  hideIncognito: $('hide-incognito'),
  idleTimeout: $('idle-timeout'),
  excludedDomains: $('excluded-domains'),
  toast: $('toast'),
};

const REASON_LABELS = {
  paused: 'Presence is paused',
  'no-app-id': 'Discord app ID is missing',
  idle: 'Idle detected – presence hidden',
  unfocused: 'Chrome is not focused',
  'no-tab': 'No active tab',
  incognito: 'Incognito tab is not shared',
  internal: 'Internal browser page is not shared',
  excluded: 'This domain is excluded',
};

const IS_WINDOWS = navigator.userAgent.includes('Windows');

const HOST_NOT_FOUND =
  'The native host is not installed or has not been loaded yet. Run “./host/install.sh” (Linux/macOS) or “.\\host\\install.cmd” (Windows), then reload the extension at chrome://extensions.';

let settings = null;
let saveTimer = null;
let saveStateTimer = null;
let statusTimer = null;
let elapsedTimer = null;
let toastTimer = null;
let lastStatus = null;
let populating = false;

function setSaveState(text, tone = '') {
  el.saveState.textContent = text;
  el.saveState.dataset.tone = tone;
  if (saveStateTimer) clearTimeout(saveStateTimer);
  if (text) {
    saveStateTimer = setTimeout(() => {
      el.saveState.textContent = '';
      el.saveState.dataset.tone = '';
    }, 2200);
  }
}

function toast(message) {
  el.toast.classList.remove('is-leaving');
  el.toast.textContent = message;
  el.toast.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.classList.add('is-leaving');
    toastTimer = setTimeout(() => {
      el.toast.hidden = true;
      el.toast.classList.remove('is-leaving');
    }, 160);
  }, 2200);
}

function populateForm() {
  populating = true;
  el.enabledToggle.checked = settings.enabled;
  el.appId.value = settings.appId;
  el.activityType.value = String(settings.activityType);
  el.detailsSource.value = settings.detailsSource;
  el.stateSource.value = settings.stateSource;
  el.showTimestamp.checked = settings.showTimestamp;
  el.showSiteIcon.checked = settings.showSiteIcon;
  el.iconTemplate.value = settings.siteIconTemplate;
  el.largeImageKey.value = settings.largeImageKey;
  el.largeText.value = settings.largeText;
  el.smallImageKey.value = settings.smallImageKey;
  el.smallText.value = settings.smallText;
  el.onlyWhenFocused.checked = settings.onlyWhenFocused;
  el.hideIncognito.checked = settings.hideIncognito;
  el.idleTimeout.value = String(settings.idleTimeoutMinutes);
  el.excludedDomains.value = settings.excludedDomains.join('\n');
  el.iconTemplateField.hidden = !settings.showSiteIcon;
  validateAppId(false);
  populating = false;
}

function collectSettings() {
  const idle = Number(el.idleTimeout.value);
  return normalizeSettings({
    ...settings,
    enabled: el.enabledToggle.checked,
    appId: el.appId.value.trim(),
    activityType: Number(el.activityType.value),
    detailsSource: el.detailsSource.value,
    stateSource: el.stateSource.value,
    showTimestamp: el.showTimestamp.checked,
    showSiteIcon: el.showSiteIcon.checked,
    siteIconTemplate:
      el.iconTemplate.value.trim() || DEFAULT_SETTINGS.siteIconTemplate,
    largeImageKey: el.largeImageKey.value.trim(),
    largeText: el.largeText.value.trim(),
    smallImageKey: el.smallImageKey.value.trim(),
    smallText: el.smallText.value.trim(),
    onlyWhenFocused: el.onlyWhenFocused.checked,
    hideIncognito: el.hideIncognito.checked,
    idleTimeoutMinutes: Number.isFinite(idle)
      ? idle
      : DEFAULT_SETTINGS.idleTimeoutMinutes,
    excludedDomains: el.excludedDomains.value.split(/\r?\n/),
  });
}

function validateAppId(showEmptyError = false) {
  const value = el.appId.value.trim();
  const valid = !value || isValidAppId(value);
  el.appId.setAttribute('aria-invalid', valid ? 'false' : 'true');
  el.appIdError.hidden = valid || (!showEmptyError && !value);
  return valid;
}

function scheduleSave(delay = 450) {
  if (populating) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, delay);
}

async function saveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  if (!validateAppId(true)) {
    setSaveState('Check app ID', 'danger');
    return;
  }

  const next = collectSettings();
  try {
    settings = await saveSettings(next);
    setSaveState('Saved', 'ok');
    updateToggleHint();
    const response = await chrome.runtime.sendMessage({ type: 'refresh' });
    if (response?.ok) renderStatus(response);
  } catch (error) {
    setSaveState('Save failed', 'danger');
    console.error('[Chrome Presence]', error);
  }
}

function updateToggleHint() {
  if (!el.enabledToggle.checked) {
    el.toggleHint.textContent = 'Paused';
  } else if (!isValidAppId(el.appId.value.trim())) {
    el.toggleHint.textContent = 'App ID missing';
  } else {
    el.toggleHint.textContent = 'On';
  }
}

function reasonLabel(reason) {
  if (!reason) return 'Ready to share';
  return REASON_LABELS[reason] || 'No activity';
}

function explainHostError(message) {
  if (!message) return HOST_NOT_FOUND;
  if (/native messaging host not found/i.test(message)) return HOST_NOT_FOUND;
  if (/forbidden/i.test(message)) {
    return 'The host does not allow this extension ID. Run the installer again so it can add the current ID.';
  }
  return message;
}

function formatElapsed(startSeconds) {
  if (!Number.isFinite(startSeconds)) return '';
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
  if (!activity?.timestamps?.start) {
    el.previewTime.hidden = true;
    return;
  }
  el.previewTime.textContent = formatElapsed(activity.timestamps.start);
  el.previewTime.hidden = false;
}

function setStep(step, done, label, badgeText, tone) {
  step.classList.toggle('is-done', done);
  step.classList.toggle('is-error', !done && tone === 'danger');
  const badge = step.querySelector('.badge');
  badge.textContent = badgeText ?? label;
  badge.dataset.tone = tone || (done ? 'ok' : 'warn');
}

function renderStatus(status) {
  if (!status?.ok) {
    el.statusDot.dataset.tone = 'danger';
    el.statusHeading.textContent = 'Status unavailable';
    el.statusDetail.textContent =
      status?.error || 'The extension could not read its status.';
    return;
  }

  lastStatus = status;
  const appOk = status.appIdConfigured;
  const hostOk = status.host?.state === 'connected';
  const discordOk = status.discord?.state === 'connected';
  const hostError = status.host?.error;
  const discordError = status.discord?.error;

  let tone = 'neutral';
  let heading = 'Connecting…';
  let detail = 'The extension is checking the Discord connection.';

  if (!status.enabled) {
    tone = 'neutral';
    heading = 'Paused';
    detail = 'Presence is turned off. Your activity is not being shared.';
  } else if (!appOk) {
    tone = 'warn';
    heading = 'App ID missing';
    detail = 'Enter the Application ID of your Discord app in the settings.';
  } else if (status.host?.state === 'disconnected' || status.host?.state === 'error') {
    tone = 'danger';
    heading = 'Native host unreachable';
    detail = explainHostError(hostError);
  } else if (status.discord?.state === 'error') {
    tone = 'danger';
    heading = 'Discord reported an error';
    detail = discordError || 'Check the Application ID and the Discord logs.';
  } else if (status.discord?.state === 'disconnected' || status.discord?.state === 'idle') {
    tone = 'warn';
    heading = 'Discord unreachable';
    detail =
      'Start the Discord desktop app. The host will connect automatically once Discord is running.';
  } else if (
    status.discord?.state === 'connecting' ||
    status.host?.state === 'connecting' ||
    status.host?.state === 'idle'
  ) {
    tone = 'warn';
    heading = 'Connecting…';
    detail = 'The host is looking for the local Discord client.';
  } else if (discordOk) {
    tone = 'ok';
    heading = 'Connected';
    detail = status.activity
      ? 'Your current browser activity is being shared to Discord.'
      : reasonLabel(status.preview?.reason);
  } else {
    tone = 'warn';
    heading = 'Connecting…';
    detail = 'Waiting for the Discord client.';
  }

  el.statusDot.dataset.tone = tone;
  el.statusHeading.textContent = heading;
  el.statusDetail.textContent = detail;
  el.enabledToggle.checked = Boolean(status.enabled);
  updateToggleHint();

  const appTone = appOk ? 'ok' : 'warn';
  setStep(
    el.stepApp,
    appOk,
    'Discord app',
    appOk ? 'Done' : 'Open',
    appTone,
  );

  const hostTone = hostOk ? 'ok' : status.enabled ? 'warn' : 'neutral';
  setStep(
    el.stepHost,
    hostOk,
    'Local host',
    !status.enabled
      ? 'Paused'
      : hostOk
        ? 'Connected'
        : status.host?.state === 'disconnected' || status.host?.state === 'error'
          ? 'Missing'
          : 'Connecting…',
    hostTone,
  );

  setStep(
    el.stepDiscord,
    discordOk,
    'Discord',
    !status.enabled
      ? 'Paused'
      : discordOk
        ? 'Connected'
        : status.host?.state === 'connected'
          ? 'Unreachable'
          : 'Open',
    discordOk ? 'ok' : 'warn',
  );

  const allReady = status.enabled && appOk && hostOk && discordOk;
  const hostWarning = status.enabled && appOk && !hostOk;
  const discordWarning = status.enabled && appOk && hostOk && !discordOk;
  el.setupCallout.hidden = !(allReady || hostWarning || discordWarning);
  if (allReady) {
    el.setupCallout.dataset.tone = 'ok';
    el.setupCalloutTitle.textContent = 'All set.';
    el.setupCalloutText.textContent =
      'Your browser activity is now being sent to Discord locally.';
  } else if (hostWarning) {
    el.setupCallout.dataset.tone = 'danger';
    el.setupCalloutTitle.textContent = 'The host is not responding.';
    el.setupCalloutText.textContent = explainHostError(hostError);
  } else if (discordWarning) {
    el.setupCallout.dataset.tone = 'warn';
    el.setupCalloutTitle.textContent = 'Discord is not connected yet.';
    el.setupCalloutText.textContent =
      'Start the Discord desktop app. The host will connect automatically once Discord is running.';
  }

  const activity = status.activity;
  const preview = status.preview || {};
  el.presencePreview.classList.toggle('is-empty', !activity);
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
    el.currentPage.textContent = `Current tab: ${preview.title || preview.host}`;
  } else if (preview.reason) {
    el.currentPage.textContent = reasonLabel(preview.reason);
  } else {
    el.currentPage.textContent = '';
  }
}

async function refreshStatus() {
  if (document.hidden) return;
  try {
    const status = await chrome.runtime.sendMessage({ type: 'getStatus' });
    renderStatus(status);
  } catch (error) {
    renderStatus({ ok: false, error: String(error) });
  }
}

async function reconnect() {
  el.reconnect.disabled = true;
  const original = el.reconnect.textContent;
  el.reconnect.textContent = 'Connecting…';
  try {
    const status = await chrome.runtime.sendMessage({ type: 'reconnect' });
    renderStatus(status);
  } catch (error) {
    renderStatus({ ok: false, error: String(error) });
  } finally {
    el.reconnect.disabled = false;
    el.reconnect.textContent = original;
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard');
  } catch {
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.append(helper);
    helper.select();
    try {
      document.execCommand('copy');
      toast('Copied to clipboard');
    } catch {
      toast('Could not copy');
    }
    helper.remove();
  }
}

function bindEvents() {
  el.appId.addEventListener('input', () => {
    const valid = validateAppId(false);
    updateToggleHint();
    if (valid) scheduleSave(650);
    else if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  });

  el.appId.addEventListener('blur', () => {
    el.appId.value = el.appId.value.trim();
    validateAppId(true);
    scheduleSave(0);
  });

  el.enabledToggle.addEventListener('change', () => {
    updateToggleHint();
    scheduleSave(0);
  });

  el.showSiteIcon.addEventListener('change', () => {
    el.iconTemplateField.hidden = !el.showSiteIcon.checked;
    scheduleSave(100);
  });

  el.reconnect.addEventListener('click', reconnect);

  const textFields = [
    el.iconTemplate,
    el.largeImageKey,
    el.largeText,
    el.smallImageKey,
    el.smallText,
    el.idleTimeout,
    el.excludedDomains,
  ];
  for (const field of textFields) {
    field.addEventListener('input', () => scheduleSave(500));
    field.addEventListener('change', () => scheduleSave(100));
  }

  const changeFields = [
    el.activityType,
    el.detailsSource,
    el.stateSource,
    el.showTimestamp,
    el.onlyWhenFocused,
    el.hideIncognito,
  ];
  for (const field of changeFields) {
    field.addEventListener('change', () => scheduleSave(50));
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-copy], [data-copy-target]');
    if (!button) return;
    const target = button.dataset.copyTarget;
    const value = target
      ? document.getElementById(target)?.textContent?.trim()
      : button.dataset.copy;
    if (value) copyText(value);
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshStatus();
  });

  initSectionNavigation();
}

function initSectionNavigation() {
  const links = [...document.querySelectorAll('.side-nav a')];
  const sections = [...document.querySelectorAll('.section')];
  const ids = sections.map((section) => section.id);

  const resolve = (hash) => {
    let id = hash.startsWith('#') ? hash.slice(1) : '';
    try {
      id = decodeURIComponent(id);
    } catch {
      return ids[0];
    }
    return ids.includes(id) ? id : ids[0];
  };

  const show = (id, scroll = false) => {
    for (const section of sections) section.hidden = section.id !== id;
    for (const link of links) {
      const active = link.getAttribute('href') === `#${id}`;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    if (scroll) window.scrollTo({ top: 0 });
  };

  for (const link of links) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const id = resolve(link.hash);
      if (location.hash !== `#${id}`) history.pushState(null, '', `#${id}`);
      show(id, true);
    });
  }

  window.addEventListener('hashchange', () => show(resolve(location.hash), true));
  window.addEventListener('popstate', () => show(resolve(location.hash), true));

  show(resolve(location.hash), true);
  requestAnimationFrame(() => window.scrollTo({ top: 0 }));
}

function buildMeta() {
  const id = chrome.runtime.id;
  el.extensionId.textContent = id;
  el.hostName.textContent = HOST_NAME;
  el.aboutHost.textContent = HOST_NAME;
  el.version.textContent = chrome.runtime.getManifest().version;
  const wrapper = IS_WINDOWS
    ? 'C:\\absolute\\path\\to\\ChromePresence\\host\\run-host.cmd'
    : '/absolute/path/to/ChromePresence/host/run-host.sh';
  el.manualManifest.textContent = JSON.stringify(
    {
      name: HOST_NAME,
      description: 'Chrome Presence – local native messaging host',
      path: wrapper,
      type: 'stdio',
      allowed_origins: [`chrome-extension://${id}/`],
    },
    null,
    2,
  );
}

async function main() {
  buildMeta();
  bindEvents();

  try {
    settings = await getSettings();
    populateForm();
  } catch (error) {
    setSaveState('Could not load settings', 'danger');
    console.error('[Chrome Presence]', error);
    settings = normalizeSettings({});
    populateForm();
  }

  await refreshStatus();
  statusTimer = setInterval(refreshStatus, 2500);
  elapsedTimer = setInterval(renderElapsed, 1000);

  window.addEventListener('pagehide', () => {
    if (statusTimer) clearInterval(statusTimer);
    if (elapsedTimer) clearInterval(elapsedTimer);
  });
}

main();

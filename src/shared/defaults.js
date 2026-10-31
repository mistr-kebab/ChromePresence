export const HOST_NAME = 'app.chromepresence.host';
export const STORAGE_KEY = 'settings';
export const SESSION_KEY = 'runtime';
export const ALARM_KEEPALIVE = 'chromepresence-keepalive';

export const ACTIVITY_TYPES = Object.freeze([
  { value: 0, label: 'Playing' },
  { value: 2, label: 'Listening' },
  { value: 3, label: 'Watching' },
  { value: 5, label: 'Competing' },
]);

export const DETAILS_SOURCES = Object.freeze([
  { value: 'title', label: 'Tab title' },
  { value: 'domain', label: 'Domain only' },
]);

export const STATE_SOURCES = Object.freeze([
  { value: 'domain', label: 'Domain only' },
  { value: 'path', label: 'Domain + path' },
  { value: 'url', label: 'Full URL' },
]);

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  appId: '',
  activityType: 0,
  detailsSource: 'title',
  stateSource: 'domain',
  showTimestamp: true,
  showSiteIcon: true,
  siteIconTemplate: 'https://www.google.com/s2/favicons?domain={domain}&sz=128',
  largeImageKey: '',
  largeText: 'Google Chrome',
  smallImageKey: '',
  smallText: '',
  onlyWhenFocused: false,
  idleTimeoutMinutes: 15,
  hideIncognito: true,
  excludedDomains: [],
});

const ACTIVITY_VALUES = new Set(ACTIVITY_TYPES.map((item) => item.value));
const DETAIL_VALUES = new Set(DETAILS_SOURCES.map((item) => item.value));
const STATE_VALUES = new Set(STATE_SOURCES.map((item) => item.value));

export function normalizeSettings(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const merged = { ...DEFAULT_SETTINGS, ...source };

  let excluded = [];
  if (Array.isArray(merged.excludedDomains)) {
    excluded = merged.excludedDomains;
  } else if (typeof merged.excludedDomains === 'string') {
    excluded = merged.excludedDomains.split(/\r?\n/);
  }

  excluded = excluded
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .slice(0, 200);

  const idle = Number(merged.idleTimeoutMinutes);

  return {
    ...merged,
    enabled: Boolean(merged.enabled),
    appId: String(merged.appId ?? '').trim(),
    activityType: ACTIVITY_VALUES.has(Number(merged.activityType))
      ? Number(merged.activityType)
      : DEFAULT_SETTINGS.activityType,
    detailsSource: DETAIL_VALUES.has(merged.detailsSource)
      ? merged.detailsSource
      : DEFAULT_SETTINGS.detailsSource,
    stateSource: STATE_VALUES.has(merged.stateSource)
      ? merged.stateSource
      : DEFAULT_SETTINGS.stateSource,
    showTimestamp: Boolean(merged.showTimestamp),
    showSiteIcon: Boolean(merged.showSiteIcon),
    siteIconTemplate: String(
      merged.siteIconTemplate ?? DEFAULT_SETTINGS.siteIconTemplate,
    ).trim(),
    largeImageKey: String(merged.largeImageKey ?? '').trim(),
    largeText: String(merged.largeText ?? DEFAULT_SETTINGS.largeText).trim(),
    smallImageKey: String(merged.smallImageKey ?? '').trim(),
    smallText: String(merged.smallText ?? '').trim(),
    onlyWhenFocused: Boolean(merged.onlyWhenFocused),
    idleTimeoutMinutes: Number.isFinite(idle)
      ? Math.min(1440, Math.max(0, Math.round(idle)))
      : DEFAULT_SETTINGS.idleTimeoutMinutes,
    hideIncognito: Boolean(merged.hideIncognito),
    excludedDomains: excluded,
  };
}

export function isValidAppId(value) {
  return /^\d{16,22}$/.test(String(value ?? '').trim());
}

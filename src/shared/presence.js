import { displayHost, isExcluded, isWebUrl } from './domain.js';

const MAX_FIELD = 128;
const VALID_TYPES = new Set([0, 2, 3, 5]);

export function truncate(value, max = MAX_FIELD) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  const characters = Array.from(text);
  if (characters.length <= max) return text;
  if (max <= 1) return characters.slice(0, Math.max(0, max)).join('');
  return `${characters.slice(0, max - 1).join('').trimEnd()}…`;
}

function cleanTitle(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function pathWithDetails(url) {
  let path = url.pathname || '/';
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path === '/' ? '' : path;
}

export function formatState(url, mode) {
  const host = displayHost(url.hostname);
  if (mode === 'url') {
    const full = `${url.origin}${url.pathname}${url.search}${url.hash}`;
    return full;
  }
  if (mode === 'path') {
    return `${host}${pathWithDetails(url)}`;
  }
  return host;
}

function iconUrl(template, host) {
  const value = String(template ?? '').trim();
  if (!value || !value.includes('{domain}')) return '';
  if (!/^https?:\/\//i.test(value)) return '';
  const rendered = value.replaceAll('{domain}', encodeURIComponent(host));
  if (rendered.length > 1024) return '';
  try {
    const url = new URL(rendered);
    return url.protocol === 'http:' || url.protocol === 'https:' ? rendered : '';
  } catch {
    return '';
  }
}

function buildAssets(settings, host) {
  const assets = {};

  if (settings.showSiteIcon) {
    const external = iconUrl(settings.siteIconTemplate, host);
    if (external) {
      assets.large_image = external;
      assets.large_text = truncate(host);
    }
  }

  if (!assets.large_image && settings.largeImageKey) {
    assets.large_image = truncate(settings.largeImageKey);
    if (settings.largeText) assets.large_text = truncate(settings.largeText);
  }

  if (settings.smallImageKey) {
    assets.small_image = truncate(settings.smallImageKey);
    assets.small_text = truncate(settings.smallText || 'Chrome Presence');
  }

  return Object.keys(assets).length > 0 ? assets : null;
}

/**
 * Builds a Discord SET_ACTIVITY payload from a Chrome tab.
 *
 * @returns {{ activity: object|null, reason: string|null, host: string|null }}
 */
export function createActivity({ tab, settings, startedAt, now = Date.now() }) {
  if (!tab) return { activity: null, reason: 'no-tab', host: null };
  if (settings.hideIncognito && tab.incognito) {
    return { activity: null, reason: 'incognito', host: null };
  }
  if (!isWebUrl(tab.url)) {
    return { activity: null, reason: 'internal', host: null };
  }

  let url;
  try {
    url = new URL(tab.url);
  } catch {
    return { activity: null, reason: 'internal', host: null };
  }

  const host = displayHost(url.hostname);
  if (!host) return { activity: null, reason: 'internal', host: null };
  if (isExcluded(url.hostname, settings.excludedDomains)) {
    return { activity: null, reason: 'excluded', host };
  }

  const title = cleanTitle(tab.title);
  const titleIsUrl = /^https?:\/\//i.test(title) || title === tab.url;
  const detailsSource =
    settings.detailsSource === 'domain' || !title || titleIsUrl ? host : title;

  let state = formatState(url, settings.stateSource);
  if (state === detailsSource) state = '';

  const activity = {
    type: VALID_TYPES.has(Number(settings.activityType))
      ? Number(settings.activityType)
      : 0,
    details: truncate(detailsSource || host),
  };

  if (state) activity.state = truncate(state);

  if (
    settings.showTimestamp &&
    Number.isFinite(startedAt) &&
    startedAt > 0 &&
    startedAt <= now
  ) {
    activity.timestamps = { start: Math.floor(startedAt / 1000) };
  }

  const assets = buildAssets(settings, host);
  if (assets) activity.assets = assets;

  return { activity, reason: null, host };
}

export function activityKey(activity) {
  return activity ? JSON.stringify(activity) : 'null';
}

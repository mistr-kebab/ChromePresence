const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const WILDCARD_RE = /^\*\.?/;

export function isWebUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getHostname(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return '';
  }
}

export function displayHost(hostname) {
  const host = String(hostname ?? '').toLowerCase().replace(/\.$/, '');
  if (host.startsWith('www.') && host.split('.').length > 2) {
    return host.slice(4);
  }
  return host;
}

export function normalizeDomainPattern(value) {
  let pattern = String(value ?? '').trim().toLowerCase();
  if (!pattern) return '';
  pattern = pattern.replace(SCHEME_RE, '');
  pattern = pattern.replace(WILDCARD_RE, '');
  pattern = pattern.split(/[/?#]/)[0];
  pattern = pattern.replace(/:\d+$/, '');
  pattern = pattern.replace(/\.$/, '');
  pattern = pattern.trim();

  if (!pattern) return '';

  // Turn IDN input such as "münchen.de" into its ASCII representation.
  if (/[^\x00-\x7F]/.test(pattern)) {
    try {
      pattern = new URL(`http://${pattern}`).hostname;
    } catch {
      return '';
    }
  }

  if (!/^[a-z0-9.-]+$/.test(pattern)) return '';
  if (pattern.startsWith('.') || pattern.includes('..')) return '';
  return pattern;
}

export function sanitizeDomainList(values) {
  const source = Array.isArray(values) ? values : String(values ?? '').split(/\r?\n/);
  const unique = new Set();
  for (const value of source) {
    const normalized = normalizeDomainPattern(value);
    if (normalized) unique.add(normalized);
  }
  return [...unique];
}

export function matchesDomain(hostname, pattern) {
  const host = String(hostname ?? '').toLowerCase().replace(/\.$/, '');
  const normalized = normalizeDomainPattern(pattern);
  if (!host || !normalized) return false;
  return host === normalized || host.endsWith(`.${normalized}`);
}

export function isExcluded(hostname, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return false;
  return patterns.some((pattern) => matchesDomain(hostname, pattern));
}

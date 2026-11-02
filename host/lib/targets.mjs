import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOST_NAME = 'app.chromepresence.host';

export function expandHome(value, home = os.homedir()) {
  if (value === '~') return home;
  if (value.startsWith('~/')) return path.join(home, value.slice(2));
  return value;
}

function windowsTargets() {
  const browsers = [
    ['Google Chrome', 'Software\\Google\\Chrome'],
    ['Chromium', 'Software\\Chromium'],
    ['Brave', 'Software\\BraveSoftware\\Brave-Browser'],
    ['Microsoft Edge', 'Software\\Microsoft\\Edge'],
    ['Vivaldi', 'Software\\Vivaldi'],
    ['Opera', 'Software\\Opera Software\\Opera Stable'],
    ['Opera GX', 'Software\\Opera Software\\Opera GX Stable'],
    ['Arc', 'Software\\ArcBrowser\\Arc'],
  ];

  return browsers.map(([name, root]) => ({
    name,
    kind: 'registry',
    platform: 'win32',
    registryKey: `HKCU\\${root}\\NativeMessagingHosts\\${HOST_NAME}`,
  }));
}

/**
 * Browser locations where Chromium-family browsers look for native messaging
 * host manifests. On Windows this is a registry location; on Linux and macOS
 * it is a directory inside the browser's configuration folder.
 */
export function standardTargets({
  home = os.homedir(),
  platform = process.platform,
} = {}) {
  if (platform === 'win32') return windowsTargets();

  let entries;
  if (platform === 'darwin') {
    entries = [
      ['Google Chrome', 'Library/Application Support/Google/Chrome'],
      ['Google Chrome Beta', 'Library/Application Support/Google/Chrome Beta'],
      ['Google Chrome Canary', 'Library/Application Support/Google/Chrome Canary'],
      ['Chromium', 'Library/Application Support/Chromium'],
      ['Brave', 'Library/Application Support/BraveSoftware/Brave-Browser'],
      ['Microsoft Edge', 'Library/Application Support/Microsoft Edge'],
      ['Vivaldi', 'Library/Application Support/Vivaldi'],
      ['Opera', 'Library/Application Support/com.operasoftware.Opera'],
    ];
  } else {
    entries = [
      ['Google Chrome', '.config/google-chrome'],
      ['Google Chrome Beta', '.config/google-chrome-beta'],
      ['Google Chrome Dev', '.config/google-chrome-unstable'],
      ['Chromium', '.config/chromium'],
      ['Brave', '.config/BraveSoftware/Brave-Browser'],
      ['Microsoft Edge', '.config/microsoft-edge'],
      ['Vivaldi', '.config/vivaldi'],
      ['Opera', '.config/opera'],
      ['Chrome (Flatpak)', '.var/app/com.google.Chrome/config/google-chrome', 'flatpak'],
      [
        'Chromium (Flatpak)',
        '.var/app/org.chromium.Chromium/config/chromium',
        'flatpak',
      ],
      [
        'Brave (Flatpak)',
        '.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser',
        'flatpak',
      ],
      [
        'Edge (Flatpak)',
        '.var/app/com.microsoft.Edge/config/microsoft-edge',
        'flatpak',
      ],
      [
        'Vivaldi (Flatpak)',
        '.var/app/com.vivaldi.Vivaldi/config/vivaldi',
        'flatpak',
      ],
      [
        'Chromium (Snap)',
        'snap/chromium/current/.config/chromium',
        'snap',
      ],
    ];
  }

  // Always build POSIX paths here, even when the tests simulate Linux or
  // macOS from a Windows host.
  return entries.map(([name, relative, kind]) => ({
    name,
    base: path.posix.join(home, relative),
    kind: kind || 'native',
  }));
}

export function withManifestPath(target) {
  return {
    ...target,
    manifest: path.join(target.base, 'NativeMessagingHosts', `${HOST_NAME}.json`),
  };
}

/**
 * Normalizes a Windows registry path supplied through --target. A bare
 * Software\... path is treated as HKCU, and a path that ends at the
 * NativeMessagingHosts folder gets the host name appended.
 */
export function normalizeRegistryKey(value) {
  let key = String(value ?? '')
    .trim()
    .replaceAll('/', '\\')
    .replace(/\\{2,}/g, '\\')
    .replace(/^\\+|\\+$/g, '');

  if (!key) throw new Error('The registry key must not be empty.');

  key = key
    .replace(/^HKEY_CURRENT_USER\\/i, 'HKCU\\')
    .replace(/^HKEY_LOCAL_MACHINE\\/i, 'HKLM\\');

  if (!/^(HKCU|HKLM)(\\|$)/i.test(key)) key = `HKCU\\${key}`;
  if (/\\NativeMessagingHosts$/i.test(key)) key = `${key}\\${HOST_NAME}`;

  return key;
}

/**
 * Manifest file used by the Windows installer. On Windows the manifest can
 * live anywhere; only its path is stored in the registry.
 */
export function windowsManifestPath({
  env = process.env,
  home = os.homedir(),
} = {}) {
  const base = env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local');
  return path.win32.join(base, 'ChromePresence', `${HOST_NAME}.json`);
}

export function extensionIdFromManifest(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (typeof manifest.key !== 'string' || !manifest.key.trim()) {
    throw new Error(
      'manifest.json does not contain a "key" field. Without a fixed key, the extension ID changes.',
    );
  }
  const hash = crypto
    .createHash('sha256')
    .update(Buffer.from(manifest.key, 'base64'))
    .digest('hex')
    .slice(0, 32);
  return [...hash]
    .map((nibble) => String.fromCharCode(97 + parseInt(nibble, 16)))
    .join('');
}

export function validateExtensionId(extensionId) {
  return /^[a-p]{32}$/.test(String(extensionId ?? ''));
}

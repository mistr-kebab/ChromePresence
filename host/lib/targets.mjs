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

/**
 * Browser profile directories where Chromium-family browsers look for
 * user-level native messaging host manifests.
 */
export function standardTargets({ home = os.homedir(), platform = process.platform } = {}) {
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

  return entries.map(([name, relative, kind]) => ({
    name,
    base: path.join(home, relative),
    kind: kind || 'native',
  }));
}

export function withManifestPath(target) {
  return {
    ...target,
    manifest: path.join(target.base, 'NativeMessagingHosts', `${HOST_NAME}.json`),
  };
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

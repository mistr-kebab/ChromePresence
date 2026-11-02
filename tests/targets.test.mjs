import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HOST_NAME,
  normalizeRegistryKey,
  standardTargets,
  windowsManifestPath,
} from '../host/lib/targets.mjs';
import {
  wrapperContent,
  wrapperFileName,
} from '../host/lib/wrapper.mjs';

test('uses browser profile folders on Linux and macOS', () => {
  const linux = standardTargets({ home: '/home/kebab', platform: 'linux' });
  assert.equal(linux[0].name, 'Google Chrome');
  assert.equal(linux[0].base, '/home/kebab/.config/google-chrome');
  assert.ok(linux.some((target) => target.name === 'Brave'));
  assert.ok(!linux.some((target) => target.registryKey));

  const mac = standardTargets({ home: '/Users/kebab', platform: 'darwin' });
  assert.equal(
    mac[0].base,
    '/Users/kebab/Library/Application Support/Google/Chrome',
  );
});

test('uses registry keys on Windows', () => {
  const targets = standardTargets({ platform: 'win32' });
  const chrome = targets.find((target) => target.name === 'Google Chrome');

  assert.ok(chrome);
  assert.equal(chrome.kind, 'registry');
  assert.equal(
    chrome.registryKey,
    `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
  );
  assert.ok(
    targets.some(
      (target) =>
        target.registryKey ===
        `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`,
    ),
  );
  assert.ok(
    targets.some(
      (target) =>
        target.registryKey ===
        `HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\${HOST_NAME}`,
    ),
  );
});

test('normalizes Windows registry keys passed through --target', () => {
  assert.equal(
    normalizeRegistryKey('HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts'),
    `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
  );
  assert.equal(
    normalizeRegistryKey('/Software/Chromium/NativeMessagingHosts/'),
    `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`,
  );
  assert.equal(
    normalizeRegistryKey('HKEY_CURRENT_USER\\Software\\Vivaldi\\NativeMessagingHosts'),
    `HKCU\\Software\\Vivaldi\\NativeMessagingHosts\\${HOST_NAME}`,
  );
  assert.throws(() => normalizeRegistryKey('   '), /must not be empty/);
});

test('places the Windows manifest under LOCALAPPDATA', () => {
  const file = windowsManifestPath({
    env: { LOCALAPPDATA: 'C:\\Users\\kebab\\AppData\\Local' },
    home: 'C:\\Users\\kebab',
  });
  assert.equal(
    file,
    `C:\\Users\\kebab\\AppData\\Local\\ChromePresence\\${HOST_NAME}.json`,
  );
});

test('generates a platform-specific host wrapper', () => {
  assert.equal(wrapperFileName('win32'), 'run-host.cmd');
  assert.equal(wrapperFileName('linux'), 'run-host.sh');
  assert.equal(wrapperFileName('darwin'), 'run-host.sh');

  const windows = wrapperContent({
    platform: 'win32',
    nodePath: 'C:\\Program Files\\nodejs\\node.exe',
    hostScript: 'C:\\Users\\100%\\ChromePresence\\host\\host.cjs',
  });
  assert.match(windows, /^@echo off\r\n/);
  assert.match(
    windows,
    /"C:\\Program Files\\nodejs\\node\.exe" "C:\\Users\\100%%\\ChromePresence\\host\\host\.cjs" %\*/,
  );
  assert.ok(windows.endsWith('\r\n'));

  const unix = wrapperContent({
    platform: 'linux',
    nodePath: "/opt/Node's bin/node",
    hostScript: '/home/kebab/Chrome Presence/host/host.cjs',
  });
  assert.match(unix, /^#!\/bin\/sh\n/);
  assert.match(unix, /exec '\/opt\/Node'\\''s bin\/node' '\/home\/kebab\/Chrome Presence\/host\/host\.cjs' "\$@"/);
});

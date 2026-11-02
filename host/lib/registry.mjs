import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

function run(file, args) {
  const result = spawnSync(file, args, {
    encoding: 'utf8',
    windowsHide: true,
  });
  return result;
}

function failure(result) {
  const detail = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  return new Error(
    detail || `reg.exe exited with code ${result.status ?? 'unknown'}.`,
  );
}

function queryWithReg(key) {
  const result = run('reg.exe', ['query', key, '/ve']);
  if (result.error) throw result.error;
  if (result.status !== 0) return null;
  const match = result.stdout.match(/REG_SZ\s+(.+?)\s*$/m);
  return match ? match[1] : '';
}

/**
 * reg.exe writes in the console code page when stdout is redirected, so a
 * non-ASCII path can be garbled. If the decoded path does not exist, ask
 * PowerShell for the value as UTF-8. This keeps the common path fast.
 */
function queryWithPowerShell(key) {
  const registryPath = key
    .replace(/^HKCU\\/i, 'HKEY_CURRENT_USER\\')
    .replace(/^HKLM\\/i, 'HKEY_LOCAL_MACHINE\\')
    .replaceAll("'", "''");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$item = Get-Item -LiteralPath 'Registry::${registryPath}'`,
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    "$item.GetValue('')",
  ].join('; ');

  const result = run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script,
  ]);
  if (result.error || result.status !== 0) return undefined;
  return result.stdout.replace(/^\uFEFF/, '').replace(/\r?\n$/, '');
}

/** Sets the unnamed (default) value of a registry key to a REG_SZ path. */
export function addRegistryValue(key, value) {
  const result = run('reg.exe', [
    'add',
    key,
    '/ve',
    '/t',
    'REG_SZ',
    '/d',
    value,
    '/f',
  ]);
  if (result.error) throw result.error;
  if (result.status !== 0) throw failure(result);
}

/** Returns the default value, null when the key does not exist. */
export function queryRegistryValue(key) {
  const value = queryWithReg(key);
  if (value === null || value === '' || process.platform !== 'win32') {
    return value;
  }
  if (fs.existsSync(value)) return value;

  const unicodeValue = queryWithPowerShell(key);
  return unicodeValue === undefined ? value : unicodeValue;
}

/** Deletes a key. Returns false when it was already absent. */
export function deleteRegistryKey(key) {
  if (queryRegistryValue(key) === null) return false;
  const result = run('reg.exe', ['delete', key, '/f']);
  if (result.error) throw result.error;
  if (result.status !== 0) throw failure(result);
  return true;
}

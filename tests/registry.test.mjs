import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  addRegistryValue,
  deleteRegistryKey,
  queryRegistryValue,
} from '../host/lib/registry.mjs';

const skip = process.platform === 'win32'
  ? 'uses a fake reg.exe script'
  : false;

test('reads, writes and deletes registry values', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-presence-reg-'));
  const bin = path.join(dir, 'bin');
  const db = path.join(dir, 'db');
  fs.mkdirSync(bin);
  fs.mkdirSync(db);

  const fakeReg = path.join(bin, 'reg.exe');
  fs.writeFileSync(
    fakeReg,
    [
      '#!/bin/sh',
      'case "$1" in',
      '  add) printf "%s" "$7" > "$REG_DB/value"; exit 0 ;;',
      '  query)',
      '    if [ -f "$REG_DB/value" ]; then',
      '      printf "HKEY_CURRENT_USER\\\\Software\\\\Test\\\\NativeMessagingHosts\\\\app.chromepresence.host\\n"',
      '      printf "    (Default)    REG_SZ    %s\\n" "$(cat "$REG_DB/value")"',
      '      exit 0',
      '    fi',
      '    exit 1 ;;',
      '  delete) rm -f "$REG_DB/value"; exit 0 ;;',
      'esac',
      'exit 2',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );

  const oldPath = process.env.PATH;
  const oldDb = process.env.REG_DB;
  process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
  process.env.REG_DB = db;

  try {
    const key = 'HKCU\\Software\\Test\\NativeMessagingHosts\\app.chromepresence.host';
    const value = 'C:\\Users\\Someone\\AppData\\Local\\ChromePresence\\app.chromepresence.host.json';

    assert.equal(queryRegistryValue(key), null);
    addRegistryValue(key, value);
    assert.equal(queryRegistryValue(key), value);
    assert.equal(deleteRegistryKey(key), true);
    assert.equal(queryRegistryValue(key), null);
    assert.equal(deleteRegistryKey(key), false);
  } finally {
    process.env.PATH = oldPath;
    if (oldDb === undefined) delete process.env.REG_DB;
    else process.env.REG_DB = oldDb;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

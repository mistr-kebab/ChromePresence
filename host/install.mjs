#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HOST_NAME,
  expandHome,
  extensionIdFromManifest,
  standardTargets,
  validateExtensionId,
  withManifestPath,
} from './lib/targets.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EXTENSION_MANIFEST = path.join(ROOT, 'manifest.json');
const HOST_SCRIPT = path.join(HERE, 'host.cjs');
const WRAPPER = path.join(HERE, 'run-host.sh');

const options = {
  uninstall: false,
  dryRun: false,
  all: false,
  help: false,
  extensionId: null,
  targets: [],
};

for (const arg of process.argv.slice(2)) {
  if (arg === '--uninstall') options.uninstall = true;
  else if (arg === '--dry-run') options.dryRun = true;
  else if (arg === '--all') options.all = true;
  else if (arg === '--help' || arg === '-h') options.help = true;
  else if (arg.startsWith('--extension-id=')) {
    options.extensionId = arg.slice('--extension-id='.length).trim();
  } else if (arg.startsWith('--target=')) {
    options.targets.push(arg.slice('--target='.length));
  } else {
    console.error(`Unknown option: ${arg}`);
    console.error('Use --help to see the available options.');
    process.exit(2);
  }
}

function printHelp() {
  console.log(`Chrome Presence – native host

Usage:
  ./host/install.sh                 Install the host for detected browsers
  ./host/install.sh --uninstall     Remove the host manifests
  ./host/install.sh --dry-run       Show what would happen without writing
  ./host/install.sh --all           Also set up known default browser folders

Options:
  --target=DIR         Use only this browser configuration folder
                       (repeatable, e.g. ~/.config/google-chrome)
  --extension-id=ID    Override the extension ID (32 characters, a–p)
  --help               Show this help
`);
}

function resolveExtensionId() {
  if (options.extensionId) {
    if (!validateExtensionId(options.extensionId)) {
      throw new Error(
        'The extension ID is invalid. Expected 32 characters from a to p.',
      );
    }
    return options.extensionId;
  }
  return extensionIdFromManifest(EXTENSION_MANIFEST);
}

function customTargets() {
  return options.targets.map((raw) => {
    const resolved = path.resolve(expandHome(raw));
    const base = path.basename(resolved) === 'NativeMessagingHosts'
      ? path.dirname(resolved)
      : resolved;
    return { name: `Custom: ${resolved}`, base, kind: 'custom' };
  });
}

function pickTargets() {
  // An explicit --target is treated as "only this browser", so that the
  // installer can be used in isolated profiles without touching other ones.
  const useOnlyCustom = options.targets.length > 0 && !options.all;
  const all = useOnlyCustom
    ? customTargets()
    : [...standardTargets(), ...customTargets()];
  const seen = new Set();
  const selected = [];

  for (const target of all) {
    if (seen.has(target.base)) continue;
    seen.add(target.base);
    const exists = fs.existsSync(target.base);
    if (target.kind === 'custom' || options.all || exists) {
      selected.push(withManifestPath(target));
    }
  }

  return selected;
}

function shQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function writeWrapper(nodePath) {
  const content = [
    '#!/bin/sh',
    `exec ${shQuote(nodePath)} ${shQuote(HOST_SCRIPT)} "$@"`,
    '',
  ].join('\n');

  if (options.dryRun) {
    console.log(`[dry-run] would write: ${WRAPPER}`);
    return;
  }
  fs.writeFileSync(WRAPPER, content, { mode: 0o755 });
  fs.chmodSync(WRAPPER, 0o755);
}

function install() {
  if (!fs.existsSync(HOST_SCRIPT)) {
    throw new Error(`Host script is missing: ${HOST_SCRIPT}`);
  }

  const extensionId = resolveExtensionId();
  const nodePath = process.execPath;
  const targets = pickTargets();

  console.log('Chrome Presence – native host');
  console.log(`Extension ID: ${extensionId}`);
  console.log(`Node.js:      ${nodePath}`);
  console.log(`Host script:  ${HOST_SCRIPT}`);
  console.log(`Wrapper:      ${WRAPPER}`);
  console.log('');

  if (!options.dryRun) writeWrapper(nodePath);
  else console.log(`[dry-run] would write: ${WRAPPER}`);

  const manifest = {
    name: HOST_NAME,
    description: 'Chrome Presence – local native messaging host',
    path: WRAPPER,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };

  if (targets.length === 0) {
    console.log('No browser configuration folder found.');
    console.log('');
    console.log('Use --target=DIR for a manual path, for example:');
    console.log('  ./host/install.sh --target="$HOME/.config/google-chrome"');
    console.log('');
    console.log('Or use --all to set up all known standard browsers.');
    process.exitCode = 1;
    return;
  }

  console.log('Installed for:');
  for (const target of targets) {
    const directory = path.dirname(target.manifest);
    if (options.dryRun) {
      console.log(`  [dry-run] ${target.name}`);
      console.log(`            ${target.manifest}`);
    } else {
      fs.mkdirSync(directory, { recursive: true, mode: 0o755 });
      fs.writeFileSync(target.manifest, `${JSON.stringify(manifest, null, 2)}\n`, {
        mode: 0o644,
      });
      fs.chmodSync(target.manifest, 0o644);
      console.log(`  ✓ ${target.name}`);
      console.log(`    ${target.manifest}`);
    }
    if (target.kind === 'flatpak') {
      console.log(
        '    ! Flatpak: The browser may not be allowed to execute the host path.',
      );
      console.log(
        '      If the connection fails, use a native Chrome installation',
      );
      console.log(
        '      or grant the Flatpak access to the project directory.',
      );
    }
    if (target.kind === 'snap') {
      console.log(
        '    ! Snap: Native messaging is often restricted in the Snap sandbox.',
      );
    }
  }

  console.log('');
  console.log('Done. Reload the extension at chrome://extensions and open');
  console.log('the settings to enter the Discord Application ID.');
  if (options.dryRun) console.log('(Dry run: no files were changed.)');
}

function uninstall() {
  const extensionId = resolveExtensionId();
  const targets = [
    ...standardTargets(),
    ...customTargets(),
  ].map(withManifestPath);

  const seen = new Set();
  let removed = 0;

  console.log('Chrome Presence – host uninstall');
  console.log(`Extension ID: ${extensionId}`);
  console.log('');

  for (const target of targets) {
    if (seen.has(target.manifest)) continue;
    seen.add(target.manifest);
    if (!fs.existsSync(target.manifest)) continue;

    if (options.dryRun) {
      console.log(`[dry-run] would delete: ${target.manifest}`);
    } else {
      fs.unlinkSync(target.manifest);
      console.log(`✓ removed: ${target.manifest}`);
    }
    removed += 1;
  }

  if (removed === 0) {
    console.log('No host manifests found. Nothing to remove.');
  }
  console.log('');
  console.log('Remove the extension itself at chrome://extensions.');
}

try {
  if (options.help) {
    printHelp();
  } else if (options.uninstall) {
    uninstall();
  } else {
    install();
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}

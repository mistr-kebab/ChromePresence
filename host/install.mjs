#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HOST_NAME,
  expandHome,
  extensionIdFromManifest,
  normalizeRegistryKey,
  standardTargets,
  validateExtensionId,
  withManifestPath,
  windowsManifestPath,
} from './lib/targets.mjs';
import {
  addRegistryValue,
  deleteRegistryKey,
  queryRegistryValue,
} from './lib/registry.mjs';
import { wrapperContent, wrapperFileName } from './lib/wrapper.mjs';

const IS_WINDOWS = process.platform === 'win32';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EXTENSION_MANIFEST = path.join(ROOT, 'manifest.json');
const HOST_SCRIPT = path.join(HERE, 'host.cjs');
const WRAPPER = path.join(HERE, wrapperFileName());
const WINDOWS_MANIFEST = IS_WINDOWS ? windowsManifestPath() : null;

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
  const targetHelp = IS_WINDOWS
    ? `  --target=KEY         Use only this registry key
                       (repeatable, e.g. HKCU\\Software\\...\\NativeMessagingHosts)`
    : `  --target=DIR         Use only this browser configuration folder
                       (repeatable, e.g. ~/.config/google-chrome)`;

  console.log(`Chrome Presence – native host

Usage:
  ${IS_WINDOWS ? '.\\host\\install.cmd' : './host/install.sh'}                 Install the host
  ${IS_WINDOWS ? '.\\host\\install.cmd' : './host/install.sh'} --uninstall     Remove the host
  ${IS_WINDOWS ? '.\\host\\install.cmd' : './host/install.sh'} --dry-run       Show what would happen without writing

Options:
${targetHelp}
  --extension-id=ID    Override the extension ID (32 characters, a–p)
  --all                Also include known default browser locations
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
  if (IS_WINDOWS) {
    return options.targets.map((raw) => {
      const registryKey = normalizeRegistryKey(raw);
      return {
        name: `Custom: ${registryKey}`,
        kind: 'custom',
        registryKey,
      };
    });
  }

  return options.targets.map((raw) => {
    const resolved = path.resolve(expandHome(raw));
    const base = path.basename(resolved) === 'NativeMessagingHosts'
      ? path.dirname(resolved)
      : resolved;
    return { name: `Custom: ${resolved}`, base, kind: 'custom' };
  });
}

function uniqueBy(items, key) {
  const seen = new Set();
  return items.filter((item) => {
    const value = item[key];
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function pickTargets() {
  if (IS_WINDOWS) {
    const standard = standardTargets({ platform: 'win32' });
    const custom = customTargets();
    const targets = options.targets.length === 0
      ? standard
      : options.all
        ? [...standard, ...custom]
        : custom;
    return uniqueBy(targets, 'registryKey');
  }

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

function writeWrapper(nodePath) {
  const content = wrapperContent({
    platform: process.platform,
    nodePath,
    hostScript: HOST_SCRIPT,
  });

  if (options.dryRun) {
    console.log(`[dry-run] would write: ${WRAPPER}`);
    return;
  }

  fs.writeFileSync(WRAPPER, content);
  if (!IS_WINDOWS) fs.chmodSync(WRAPPER, 0o755);
}

function printDone() {
  console.log('');
  console.log('Done. Reload the extension at chrome://extensions and open');
  console.log('the settings to enter the Discord Application ID.');
  if (IS_WINDOWS) {
    console.log('If the browser is already running, quit it completely and start it again.');
  }
  if (options.dryRun) console.log('(Dry run: no files were changed.)');
}

function installWindows(targets, manifest) {
  if (options.dryRun) {
    console.log(`[dry-run] would write: ${WINDOWS_MANIFEST}`);
  } else {
    fs.mkdirSync(path.dirname(WINDOWS_MANIFEST), { recursive: true });
    fs.writeFileSync(
      WINDOWS_MANIFEST,
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }

  console.log('');
  console.log('Installed for:');
  let failures = 0;

  for (const target of targets) {
    if (options.dryRun) {
      console.log(`  [dry-run] ${target.name}`);
      console.log(`            ${target.registryKey}`);
      continue;
    }

    try {
      addRegistryValue(target.registryKey, WINDOWS_MANIFEST);
      console.log(`  ✓ ${target.name}`);
      console.log(`    ${target.registryKey}`);
    } catch (error) {
      failures += 1;
      console.log(`  ✗ ${target.name}`);
      console.log(`    ${error.message}`);
    }
  }

  if (failures > 0) {
    console.log('');
    console.log(`${failures} registry entr${failures === 1 ? 'y' : 'ies'} could not be written.`);
    process.exitCode = 1;
    return;
  }

  printDone();
}

function installUnix(targets, manifest) {
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

  printDone();
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
  if (IS_WINDOWS) console.log(`Manifest:     ${WINDOWS_MANIFEST}`);
  console.log('');

  writeWrapper(nodePath);

  const manifest = {
    name: HOST_NAME,
    description: 'Chrome Presence – local native messaging host',
    path: WRAPPER,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };

  if (IS_WINDOWS) {
    installWindows(targets, manifest);
  } else {
    installUnix(targets, manifest);
  }
}

function uninstallWindows() {
  const candidates = options.targets.length > 0 && !options.all
    ? customTargets()
    : [...standardTargets({ platform: 'win32' }), ...customTargets()];
  const targets = uniqueBy(candidates, 'registryKey');
  const extensionId = resolveExtensionId();

  console.log('Chrome Presence – host uninstall');
  console.log(`Extension ID: ${extensionId}`);
  console.log('');

  let removed = 0;
  let failures = 0;

  for (const target of targets) {
    let present;
    try {
      present = queryRegistryValue(target.registryKey) !== null;
    } catch (error) {
      failures += 1;
      console.log(`✗ could not read: ${target.registryKey}`);
      console.log(`  ${error.message}`);
      continue;
    }
    if (!present) continue;

    if (options.dryRun) {
      console.log(`[dry-run] would delete: ${target.registryKey}`);
      removed += 1;
      continue;
    }

    try {
      deleteRegistryKey(target.registryKey);
      console.log(`✓ removed: ${target.registryKey}`);
      removed += 1;
    } catch (error) {
      failures += 1;
      console.log(`✗ could not delete: ${target.registryKey}`);
      console.log(`  ${error.message}`);
    }
  }

  const removeManifest = options.targets.length === 0 || options.all;
  if (
    removeManifest &&
    WINDOWS_MANIFEST &&
    fs.existsSync(WINDOWS_MANIFEST)
  ) {
    if (options.dryRun) {
      console.log(`[dry-run] would delete: ${WINDOWS_MANIFEST}`);
    } else {
      fs.unlinkSync(WINDOWS_MANIFEST);
      console.log(`✓ removed: ${WINDOWS_MANIFEST}`);
    }
    removed += 1;
  }

  if (removed === 0 && failures === 0) {
    console.log('No host registry entries found. Nothing to remove.');
  }
  console.log('');
  console.log('Remove the extension itself at chrome://extensions.');
  if (failures > 0) process.exitCode = 1;
}

function uninstallUnix() {
  const extensionId = resolveExtensionId();
  const candidates = options.targets.length > 0 && !options.all
    ? customTargets()
    : [...standardTargets(), ...customTargets()];
  const targets = candidates.map(withManifestPath);

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
    if (IS_WINDOWS) uninstallWindows();
    else uninstallUnix();
  } else {
    install();
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}

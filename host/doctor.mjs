#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  HOST_NAME,
  expandHome,
  extensionIdFromManifest,
  standardTargets,
  validateExtensionId,
  withManifestPath,
} from './lib/targets.mjs';

const require = createRequire(import.meta.url);
const { existingSocketCandidates } = require('./lib/discord-rpc.cjs');
const { NativeMessageReader } = require('./lib/native-messaging.cjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EXTENSION_MANIFEST = path.join(ROOT, 'manifest.json');
const HOST_SCRIPT = path.join(HERE, 'host.cjs');
const WRAPPER = path.join(HERE, 'run-host.sh');

const options = {
  help: false,
  extensionId: null,
  targets: [],
};

for (const arg of process.argv.slice(2)) {
  if (arg === '--help' || arg === '-h') options.help = true;
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

if (options.help) {
  console.log(`Chrome Presence – diagnostics

Usage:
  npm run doctor
  node host/doctor.mjs [--target=DIR] [--extension-id=ID]

Checks Node.js, the extension ID, the host wrapper, installed native
messaging manifests, and the Discord IPC socket.

Options:
  --target=DIR         Check an additional browser configuration folder
                       (repeatable)
  --extension-id=ID    Override the expected extension ID
  --help               Show this help
`);
  process.exit(0);
}

const results = { pass: 0, warn: 0, fail: 0 };

function pass(title, detail = '') {
  results.pass += 1;
  console.log(`✓ ${title}${detail ? `\n  ${detail}` : ''}`);
}

function warn(title, detail = '') {
  results.warn += 1;
  console.log(`! ${title}${detail ? `\n  ${detail}` : ''}`);
}

function fail(title, detail = '') {
  results.fail += 1;
  console.log(`✗ ${title}${detail ? `\n  ${detail}` : ''}`);
}

function info(title, detail = '') {
  console.log(`  ${title}${detail ? `\n  ${detail}` : ''}`);
}

function prettyPath(value) {
  const home = os.homedir();
  return value.startsWith(home) ? `~${value.slice(home.length)}` : value;
}

function readNativeManifest(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const manifest = JSON.parse(raw);
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Manifest is not a JSON object.');
  }
  return manifest;
}

function resolveExpectedId() {
  const computed = extensionIdFromManifest(EXTENSION_MANIFEST);
  if (!options.extensionId) return { id: computed, computed, overridden: false };

  if (!validateExtensionId(options.extensionId)) {
    throw new Error(
      'The ID passed via --extension-id is invalid. Expected 32 characters from a to p.',
    );
  }
  return {
    id: options.extensionId,
    computed,
    overridden: options.extensionId !== computed,
  };
}

function customTargets() {
  return options.targets.map((raw) => {
    const resolved = path.resolve(expandHome(raw));
    const base = path.basename(resolved) === 'NativeMessagingHosts'
      ? path.dirname(resolved)
      : resolved;
    return { name: `Custom: ${prettyPath(resolved)}`, base, kind: 'custom' };
  });
}

function hostRuntimeCheck() {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(WRAPPER, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });
    } catch (error) {
      resolve({ ok: false, error: error.message });
      return;
    }

    const reader = new NativeMessageReader();
    const messages = [];
    let stderr = '';
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        // Ignore.
      }
      finish({ ok: false, error: 'Timed out after 5 seconds.' });
    }, 5000);

    child.on('error', (error) => {
      finish({ ok: false, error: error.message });
    });

    child.stdout.on('data', (chunk) => {
      try {
        messages.push(...reader.push(chunk));
      } catch (error) {
        finish({ ok: false, error: error.message });
      }
    });

    child.stderr.on('data', (chunk) => {
      if (stderr.length < 4000) stderr += chunk.toString('utf8');
    });

    child.on('close', (code, signal) => {
      const hello = messages.find((message) => message?.type === 'hello');
      finish({
        ok: Boolean(hello),
        code,
        signal,
        stderr: stderr.trim(),
        messages,
      });
    });

    // Closing stdin lets the host send its greeting and shut down cleanly.
    child.stdin.end();
  });
}

function inspectBrowserManifests(expectedId) {
  const targets = [
    ...standardTargets().map((target) => ({
      ...withManifestPath(target),
      browserExists: fs.existsSync(target.base),
    })),
    ...customTargets().map((target) => ({
      ...withManifestPath(target),
      browserExists: true,
    })),
  ];

  const seen = new Set();
  const installed = [];
  const missing = [];
  let invalid = 0;

  for (const target of targets) {
    if (seen.has(target.manifest)) continue;
    seen.add(target.manifest);

    if (!fs.existsSync(target.manifest)) {
      if (target.browserExists) missing.push(target);
      continue;
    }

    try {
      const manifest = readNativeManifest(target.manifest);
      const allowed = Array.isArray(manifest.allowed_origins)
        ? manifest.allowed_origins
        : [];
      const expectedOrigin = `chrome-extension://${expectedId}/`;
      const problems = [];
      if (manifest.name !== HOST_NAME) problems.push(`name is not ${HOST_NAME}`);
      if (manifest.type !== 'stdio') problems.push('type is not stdio');
      if (typeof manifest.path !== 'string' || !manifest.path) {
        problems.push('path is missing');
      } else if (path.resolve(manifest.path) !== path.resolve(WRAPPER)) {
        problems.push(`path does not point to ${prettyPath(WRAPPER)}`);
      }
      if (!allowed.includes(expectedOrigin)) {
        problems.push(`allowed_origins does not contain ${expectedOrigin}`);
      }

      if (problems.length > 0) {
        invalid += 1;
        fail(
          `${target.name}: host manifest is invalid`,
          problems.join('; ') + `\n  ${prettyPath(target.manifest)}`,
        );
      } else {
        installed.push(target);
        pass(
          `${target.name}: host manifest is valid`,
          prettyPath(target.manifest),
        );
        if (target.kind === 'flatpak') {
          warn(
            `${target.name}: Flatpak sandbox`,
            'The browser may not be able to start the host outside the sandbox.',
          );
        }
        if (target.kind === 'snap') {
          warn(
            `${target.name}: Snap sandbox`,
            'Native messaging is often restricted in the Snap sandbox.',
          );
        }
      }
    } catch (error) {
      invalid += 1;
      fail(
        `${target.name}: host manifest is not readable`,
        `${error.message}\n  ${prettyPath(target.manifest)}`,
      );
    }
  }

  if (installed.length === 0) {
    if (invalid === 0) {
      fail(
        'No native messaging manifest found',
        'Run ./host/install.sh (or use --target=DIR for a custom profile).',
      );
    }
  } else {
    const names = installed.map((target) => target.name).join(', ');
    info(`Installed for: ${names}`);
  }

  if (missing.length > 0 && installed.length > 0) {
    info(
      'Browsers with a profile but no host manifest:',
      missing.map((target) => target.name).join(', '),
    );
  }
}

function inspectDiscord() {
  let sockets = [];
  try {
    sockets = existingSocketCandidates();
  } catch (error) {
    warn('Could not check the Discord IPC socket', error.message);
    return;
  }

  if (sockets.length === 0) {
    warn(
      'No Discord IPC socket found',
      'Start the Discord desktop app. With Flatpak/Snap, the socket may be inside a sandbox.',
    );
    return;
  }

  pass('Discord IPC socket found', sockets.map(prettyPath).join('\n  '));
}

async function main() {
  console.log('Chrome Presence – diagnostics\n');

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor >= 18) {
    pass(`Node.js ${process.version}`);
  } else {
    fail(
      `Node.js ${process.version} is too old`,
      'The host requires Node.js 18 or newer.',
    );
  }

  let expectedId;
  try {
    expectedId = resolveExpectedId();
    pass(
      `Extension ID: ${expectedId.id}`,
      `computed from manifest.json: ${expectedId.computed}`,
    );
    if (expectedId.overridden) {
      warn(
        'Different extension ID expected',
        'The installer uses the ID from manifest.json by default.',
      );
    }
  } catch (error) {
    fail('Could not determine the extension ID', error.message);
    expectedId = { id: null };
  }

  const requiredFiles = [
    EXTENSION_MANIFEST,
    HOST_SCRIPT,
    path.join(HERE, 'lib', 'discord-rpc.cjs'),
    path.join(HERE, 'lib', 'native-messaging.cjs'),
    WRAPPER,
  ];
  const missingFiles = requiredFiles.filter((file) => !fs.existsSync(file));
  if (missingFiles.length > 0) {
    fail(
      'Project files are missing',
      missingFiles.map(prettyPath).join(', '),
    );
  } else {
    pass('Host files present');
  }

  if (fs.existsSync(WRAPPER)) {
    try {
      fs.accessSync(WRAPPER, fs.constants.X_OK);
      pass('Host wrapper is executable', prettyPath(WRAPPER));
    } catch {
      fail(
        'Host wrapper is not executable',
        `Run chmod +x ${prettyPath(WRAPPER)} or run the installer again.`,
      );
    }

    if (missingFiles.length === 0) {
      const runtime = await hostRuntimeCheck();
      if (runtime.ok) {
        pass('Host starts and responds');
      } else {
        fail(
          'Host does not start correctly',
          runtime.error ||
            runtime.stderr ||
            'The host did not send a valid greeting.',
        );
      }
    }
  }

  if (expectedId.id) inspectBrowserManifests(expectedId.id);
  inspectDiscord();

  console.log('');
  console.log(
    `Result: ${results.pass} OK, ${results.warn} warning${results.warn === 1 ? '' : 's'}, ${results.fail} error${results.fail === 1 ? '' : 's'}`,
  );

  if (results.fail > 0) {
    console.log(
      'Fix the errors first, then reload Chrome at chrome://extensions.',
    );
    process.exitCode = 1;
    return;
  }

  if (results.warn > 0) {
    console.log(
      'Basic functionality should work. Check the warnings if Discord does not show any activity.',
    );
  } else {
    console.log(
      'Everything is ready. Enter the Discord Application ID in the extension settings.',
    );
  }
}

main().catch((error) => {
  console.error(`Diagnostics failed: ${error.message}`);
  process.exitCode = 1;
});

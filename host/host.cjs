#!/usr/bin/env node
'use strict';

const { DiscordRPC } = require('./lib/discord-rpc.cjs');
const {
  NativeMessageReader,
  encodeNativeMessage,
} = require('./lib/native-messaging.cjs');

const DEBUG = Boolean(process.env.CHROME_PRESENCE_DEBUG);
const MIN_INTERVAL_MS = Number(process.env.CHROME_PRESENCE_MIN_INTERVAL_MS) || 4000;
const RETRY_MS = Number(process.env.CHROME_PRESENCE_RETRY_MS) || 5000;
const HOST_VERSION = 1;

let appId = '';
let rpc = null;
let activitySet = false;
let lastActivity = null;
let shuttingDown = false;

function log(...args) {
  if (DEBUG) console.error('[Chrome Presence]', ...args);
}

function send(message) {
  if (shuttingDown) return;
  try {
    if (!process.stdout.writable) return;
    process.stdout.write(encodeNativeMessage(message));
  } catch (error) {
    log('stdout write failed:', error.message);
    shutdown();
  }
}

function sendStatus(state, error = null) {
  send({ type: 'status', discord: state, error: error || null });
}

function isValidAppId(value) {
  return /^\d{16,22}$/.test(String(value ?? '').trim());
}

function ensureRpc() {
  if (!isValidAppId(appId)) {
    sendStatus('error', 'Invalid or missing Discord Application ID.');
    return;
  }

  if (rpc && rpc.clientId === String(appId)) return;
  if (rpc) {
    rpc.removeAllListeners();
    rpc.stop();
    rpc = null;
  }

  rpc = new DiscordRPC({
    clientId: String(appId),
    minIntervalMs: MIN_INTERVAL_MS,
    retryMs: RETRY_MS,
    logger: log,
  });

  rpc.on('status', (status) => {
    sendStatus(status.state, status.error);
  });

  rpc.on('error', (error) => {
    log('rpc error:', error.message);
  });

  rpc.start();

  if (activitySet) {
    rpc.setActivity(lastActivity);
  }
}

function handleMessage(message) {
  if (!message || typeof message !== 'object') return;

  switch (message.type) {
    case 'hello': {
      const nextAppId = String(message.appId ?? '').trim();
      appId = nextAppId;
      send({ type: 'hello-ack', version: HOST_VERSION });
      ensureRpc();
      break;
    }

    case 'presence': {
      const activity = message.activity ?? null;
      if (
        activity !== null &&
        (typeof activity !== 'object' || Array.isArray(activity))
      ) {
        sendStatus('error', 'Invalid activity data from the extension.');
        return;
      }
      activitySet = true;
      lastActivity = activity;
      ensureRpc();
      if (rpc) rpc.setActivity(activity);
      break;
    }

    case 'ping': {
      send({ type: 'pong' });
      break;
    }

    default:
      log('unknown message type:', message.type);
  }
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (rpc) {
    rpc.removeAllListeners();
    rpc.stop();
    rpc = null;
  }
  process.exitCode = 0;
  // Give a pending stdout frame a moment to flush, then leave even if a
  // half-open Discord connection is still winding down.
  setTimeout(() => process.exit(0), 100);
}

const reader = new NativeMessageReader();

process.stdin.on('data', (chunk) => {
  let messages;
  try {
    messages = reader.push(chunk);
  } catch (error) {
    log('native message error:', error.message);
    sendStatus('error', 'Error while reading the extension message.');
    shutdown();
    return;
  }

  for (const message of messages) {
    try {
      handleMessage(message);
    } catch (error) {
      log('message handler error:', error);
      sendStatus('error', error.message || String(error));
    }
  }
});

process.stdin.on('end', shutdown);
process.stdin.on('close', shutdown);
process.stdin.on('error', shutdown);

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);
process.on('uncaughtException', (error) => {
  log('uncaught exception:', error);
  shutdown();
});
process.on('unhandledRejection', (error) => {
  log('unhandled rejection:', error);
  shutdown();
});

send({ type: 'hello', host: 'ready', version: HOST_VERSION });
log('host started, pid', process.pid);

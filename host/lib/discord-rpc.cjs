'use strict';

const net = require('node:net');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

const MAX_FRAME_BYTES = 4 * 1024 * 1024;
const HANDSHAKE_TIMEOUT_MS = 10000;
const CONNECT_TIMEOUT_MS = 1200;

function encodeFrame(op, payload) {
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const frame = Buffer.allocUnsafe(8 + json.length);
  frame.writeInt32LE(op, 0);
  frame.writeInt32LE(json.length, 4);
  json.copy(frame, 8);
  return frame;
}

function decodeValue(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\.$/, '');
}

/**
 * Returns every plausible Discord IPC socket path for this platform.
 * DISCORD_IPC_PATH and DISCORD_IPC_DIR exist for tests and unusual setups.
 */
function socketCandidates() {
  if (process.env.DISCORD_IPC_PATH) {
    return [process.env.DISCORD_IPC_PATH];
  }

  const dirs = [];
  if (process.env.DISCORD_IPC_DIR) {
    dirs.push(process.env.DISCORD_IPC_DIR);
  } else if (process.platform === 'win32') {
    return Array.from({ length: 10 }, (_, index) => `\\\\?\\pipe\\discord-ipc-${index}`);
  } else {
    const runtime = process.env.XDG_RUNTIME_DIR;
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    const tmp = os.tmpdir();

    if (runtime) {
      dirs.push(runtime);
      dirs.push(path.join(runtime, 'app', 'com.discordapp.Discord'));
      dirs.push(path.join(runtime, 'app', 'com.discordapp.DiscordCanary'));
      dirs.push(path.join(runtime, 'app', 'com.discordapp.DiscordPTB'));
      dirs.push(path.join(runtime, 'app', 'dev.vencord.Vesktop'));
      dirs.push(path.join(runtime, 'snap.discord'));
      dirs.push(path.join(runtime, '.flatpak', 'com.discordapp.Discord', 'xdg-run'));
      dirs.push(path.join(runtime, '.flatpak', 'dev.vencord.Vesktop', 'xdg-run'));
    }
    if (uid !== null) {
      dirs.push(`/run/user/${uid}`);
    }
    dirs.push(tmp);
    dirs.push('/tmp');
    if (process.platform === 'darwin') {
      dirs.push(path.join(os.homedir(), 'Library', 'Application Support', 'discord'));
      dirs.push(path.join(os.homedir(), 'Library', 'Application Support', 'Discord'));
    }
  }

  const uniqueDirs = [...new Set(dirs.filter(Boolean).map(decodeValue))];
  const paths = [];
  for (const dir of uniqueDirs) {
    for (let index = 0; index < 10; index += 1) {
      paths.push(path.join(dir, `discord-ipc-${index}`));
    }
  }
  return [...new Set(paths)];
}

function existingSocketCandidates() {
  const candidates = socketCandidates();
  if (process.platform === 'win32' || process.env.DISCORD_IPC_PATH) {
    return candidates;
  }
  return candidates.filter((socketPath) => {
    try {
      return fs.existsSync(socketPath);
    } catch {
      return false;
    }
  });
}

class DiscordRPC extends EventEmitter {
  constructor({
    clientId,
    minIntervalMs = 4000,
    retryMs = 5000,
    logger = () => {},
  }) {
    super();
    this.clientId = String(clientId);
    this.minIntervalMs = Math.max(250, Number(minIntervalMs) || 4000);
    this.retryMs = Math.max(250, Number(retryMs) || 5000);
    this.logger = logger;

    this.socket = null;
    this.ready = false;
    this.stopped = true;
    this.buffer = Buffer.alloc(0);
    this.sentKey = null;
    this.sentAnything = false;
    this.desired = null;
    this.hasDesired = false;
    this.lastSentAt = 0;
    this.sendTimer = null;
    this.retryTimer = null;
    this.retryDelay = this.retryMs;
    this.attempting = false;
    this.lastStatus = null;
    this.fatalError = null;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    this.ready = false;
    clearTimeout(this.sendTimer);
    clearTimeout(this.retryTimer);
    this.sendTimer = null;
    this.retryTimer = null;
    this.destroySocket();
    this.setStatus('disconnected', null);
  }

  setActivity(activity) {
    if (activity !== null && (typeof activity !== 'object' || Array.isArray(activity))) {
      throw new TypeError('activity must be an object or null');
    }
    this.desired = activity;
    this.hasDesired = true;
    this.scheduleSend(0);
  }

  clearActivity() {
    this.setActivity(null);
  }

  setStatus(state, error = null) {
    const next = { state, error: error || null };
    if (
      this.lastStatus &&
      this.lastStatus.state === next.state &&
      this.lastStatus.error === next.error
    ) {
      return;
    }
    this.lastStatus = next;
    this.logger(`status: ${state}${error ? ` (${error})` : ''}`);
    this.emit('status', next);
  }

  connect() {
    if (this.stopped || this.socket || this.attempting) return;
    this.fatalError = null;
    this.ready = false;
    this.attempting = true;
    this.setStatus('connecting', null);

    const candidates = existingSocketCandidates();
    if (candidates.length === 0) {
      this.attempting = false;
      this.setStatus('disconnected', 'Discord not found – is the desktop app running?');
      this.scheduleRetry();
      return;
    }

    const tryNext = (index) => {
      if (this.stopped || this.socket) {
        this.attempting = false;
        return;
      }
      if (index >= candidates.length) {
        this.attempting = false;
        this.setStatus('disconnected', 'Discord not found – is the desktop app running?');
        this.scheduleRetry();
        return;
      }

      const socketPath = candidates[index];
      const socket = net.createConnection({ path: socketPath });
      let settled = false;

      const connectTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.destroy();
        tryNext(index + 1);
      }, CONNECT_TIMEOUT_MS);

      socket.once('connect', () => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        this.attempting = false;
        if (this.stopped) {
          socket.destroy();
          return;
        }
        this.attachSocket(socket);
      });

      socket.once('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        this.logger(`socket ${socketPath}: ${error.message}`);
        socket.destroy();
        tryNext(index + 1);
      });
    };

    tryNext(0);
  }

  attachSocket(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.sentKey = null;
    this.sentAnything = false;
    this.lastSentAt = 0;

    socket.on('data', (chunk) => this.handleData(chunk));
    socket.on('error', (error) => {
      this.logger(`discord socket error: ${error.message}`);
    });
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.handleSocketGone();
    });

    const handshakeTimer = setTimeout(() => {
      if (!this.ready && this.socket === socket) {
        this.logger('handshake timeout');
        this.destroySocket();
      }
    }, HANDSHAKE_TIMEOUT_MS);

    socket.once('close', () => clearTimeout(handshakeTimer));
    socket.write(encodeFrame(OP_HANDSHAKE, { v: 1, client_id: this.clientId }));
  }

  handleSocketGone() {
    this.ready = false;
    this.buffer = Buffer.alloc(0);
    clearTimeout(this.sendTimer);
    this.sendTimer = null;
    if (this.stopped) return;

    if (this.fatalError) {
      this.setStatus('error', this.fatalError);
      this.scheduleRetry(30000);
    } else {
      this.setStatus('disconnected', 'Connection to Discord closed.');
      this.scheduleRetry();
    }
  }

  destroySocket() {
    if (!this.socket) return;
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    try {
      socket.destroy();
    } catch {
      // Ignore.
    }
    this.handleSocketGone();
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 8) {
      const op = this.buffer.readInt32LE(0);
      const length = this.buffer.readInt32LE(4);
      if (length < 0 || length > MAX_FRAME_BYTES) {
        this.logger(`invalid Discord frame length: ${length}`);
        this.fatalError = 'Invalid response from Discord.';
        this.destroySocket();
        return;
      }
      if (this.buffer.length < 8 + length) break;

      const payload = this.buffer.subarray(8, 8 + length);
      this.buffer = this.buffer.subarray(8 + length);

      let message;
      try {
        message = JSON.parse(payload.toString('utf8'));
      } catch (error) {
        this.logger(`invalid Discord JSON: ${error.message}`);
        continue;
      }
      this.handleFrame(op, message);
    }
  }

  handleFrame(op, message) {
    if (op === OP_PING) {
      this.writeFrame(OP_PONG, message);
      return;
    }

    if (op === OP_CLOSE) {
      this.destroySocket();
      return;
    }

    if (op !== OP_FRAME || !message || typeof message !== 'object') return;

    if (message.cmd === 'DISPATCH' && message.evt === 'READY') {
      this.ready = true;
      this.fatalError = null;
      this.retryDelay = this.retryMs;
      this.setStatus('connected', null);
      this.scheduleSend(0);
      return;
    }

    if (message.evt === 'ERROR' || message.error) {
      const data = message.data || {};
      const code = data.code ?? message.code;
      const text = data.message || message.message || 'Unknown Discord error';
      const detail = `Discord: ${text}${code ? ` (${code})` : ''}`;
      this.logger(detail);
      if (code === 4000) this.fatalError = detail;
      this.setStatus('error', detail);
      this.emit('error', new Error(detail));
      if (code === 4000) {
        this.destroySocket();
      }
      return;
    }

    // Discord acknowledges SET_ACTIVITY with the same command and a nonce.
    if (message.cmd === 'SET_ACTIVITY' && message.nonce) {
      this.setStatus('connected', null);
    }
  }

  writeFrame(op, payload) {
    if (!this.socket) return false;
    try {
      this.socket.write(encodeFrame(op, payload));
      return true;
    } catch (error) {
      this.logger(`write failed: ${error.message}`);
      this.destroySocket();
      return false;
    }
  }

  scheduleSend(delay = 0) {
    if (this.stopped || !this.ready || !this.hasDesired) return;

    const key = activityKey(this.desired);
    if (this.sentKey === key) return;
    if (this.sendTimer) return;

    const now = Date.now();
    const wait = Math.max(
      Number(delay) || 0,
      this.lastSentAt + this.minIntervalMs - now,
    );

    if (wait <= 0) {
      this.flush();
      return;
    }

    this.sendTimer = setTimeout(() => {
      this.sendTimer = null;
      this.flush();
    }, wait);
  }

  flush() {
    if (this.stopped || !this.ready || !this.hasDesired) return;

    const key = activityKey(this.desired);
    if (this.sentKey === key) return;

    if (this.desired === null && !this.sentAnything) {
      this.sentKey = 'null';
      return;
    }

    const args = { pid: process.pid };
    if (this.desired !== null) args.activity = this.desired;

    const payload = {
      cmd: 'SET_ACTIVITY',
      args,
      nonce: crypto.randomUUID(),
    };

    if (!this.writeFrame(OP_FRAME, payload)) return;
    this.sentKey = key;
    this.sentAnything = true;
    this.lastSentAt = Date.now();
    this.logger(
      this.desired === null
        ? 'activity cleared'
        : `activity sent: ${this.desired.details || ''}`,
    );
  }

  scheduleRetry(delay = this.retryDelay) {
    if (this.stopped || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }
}

function activityKey(activity) {
  return activity ? JSON.stringify(activity) : 'null';
}

module.exports = {
  DiscordRPC,
  encodeFrame,
  socketCandidates,
  existingSocketCandidates,
  activityKey,
  OP_HANDSHAKE,
  OP_FRAME,
  OP_CLOSE,
  OP_PING,
  OP_PONG,
};

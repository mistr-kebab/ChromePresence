import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  DiscordRPC,
  encodeFrame,
  OP_FRAME,
  OP_HANDSHAKE,
  OP_PING,
  OP_PONG,
} = require('../host/lib/discord-rpc.cjs');
const {
  encodeNativeMessage,
  NativeMessageReader,
} = require('../host/lib/native-messaging.cjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST_SCRIPT = path.join(HERE, '..', 'host', 'host.cjs');

function waitFor(predicate, { timeout = 2500, interval = 20 } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      let result = false;
      try {
        result = predicate();
      } catch (error) {
        clearInterval(timer);
        reject(error);
        return;
      }
      if (result) {
        clearInterval(timer);
        resolve(result);
      } else if (Date.now() - started > timeout) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for condition'));
      }
    }, interval);
  });
}

class DiscordFrameReader {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames = [];
    while (this.buffer.length >= 8) {
      const op = this.buffer.readInt32LE(0);
      const length = this.buffer.readInt32LE(4);
      if (this.buffer.length < 8 + length) break;
      const payload = JSON.parse(
        this.buffer.subarray(8, 8 + length).toString('utf8'),
      );
      this.buffer = this.buffer.subarray(8 + length);
      frames.push({ op, payload });
    }
    return frames;
  }
}

async function startFakeDiscord(socketPath, frames) {
  const server = net.createServer((socket) => {
    const reader = new DiscordFrameReader();
    socket.on('data', (chunk) => {
      for (const frame of reader.push(chunk)) {
        frames.push(frame);
        if (frame.op === OP_HANDSHAKE) {
          socket.write(
            encodeFrame(OP_FRAME, {
              cmd: 'DISPATCH',
              evt: 'READY',
              data: { v: 1, user: { id: '1' } },
            }),
          );
        }
        if (frame.op === OP_PING) {
          socket.write(encodeFrame(OP_PONG, frame.payload));
        }
        if (frame.op === OP_FRAME && frame.payload?.cmd === 'SET_ACTIVITY') {
          socket.write(
            encodeFrame(OP_FRAME, {
              cmd: 'SET_ACTIVITY',
              evt: null,
              data: frame.payload.args?.activity ?? null,
              nonce: frame.payload.nonce,
            }),
          );
        }
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  return server;
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

let pipeCounter = 0;

function tempSocket() {
  if (process.platform === 'win32') {
    pipeCounter += 1;
    return {
      directory: null,
      socketPath: `\\\\.\\pipe\\chrome-presence-${process.pid}-${Date.now()}-${pipeCounter}`,
    };
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-presence-'));
  return { directory, socketPath: path.join(directory, 'discord-ipc-0') };
}

function setSocket(directory, socketPath) {
  if (process.platform === 'win32') {
    process.env.DISCORD_IPC_PATH = socketPath;
    delete process.env.DISCORD_IPC_DIR;
  } else {
    process.env.DISCORD_IPC_DIR = directory;
    delete process.env.DISCORD_IPC_PATH;
  }
}

function clearSocket() {
  delete process.env.DISCORD_IPC_DIR;
  delete process.env.DISCORD_IPC_PATH;
}

function removeSocketDir(directory) {
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
}

test('DiscordRPC handshakes, sends and clears activity', async (t) => {
  const { directory, socketPath } = tempSocket();
  setSocket(directory, socketPath);
  const frames = [];
  const server = await startFakeDiscord(socketPath, frames);
  const statuses = [];
  let rpc;

  t.after(async () => {
    if (rpc) rpc.stop();
    await closeServer(server);
    clearSocket();
    removeSocketDir(directory);
  });

  rpc = new DiscordRPC({
    clientId: '123456789012345678',
    minIntervalMs: 250,
    retryMs: 100,
    logger: () => {},
  });
  rpc.on('status', (status) => statuses.push(status));
  rpc.start();

  await waitFor(() => statuses.some((status) => status.state === 'connected'));

  const handshake = frames.find((frame) => frame.op === OP_HANDSHAKE);
  assert.equal(handshake.payload.client_id, '123456789012345678');
  assert.equal(handshake.payload.v, 1);

  const activity = {
    type: 0,
    details: 'Testseite',
    state: 'example.com',
    timestamps: { start: 1_700_000_000 },
  };
  rpc.setActivity(activity);

  await waitFor(() =>
    frames.some(
      (frame) =>
        frame.payload?.cmd === 'SET_ACTIVITY' &&
        frame.payload.args?.activity?.details === 'Testseite',
    ),
  );
  const sent = frames.filter(
    (frame) => frame.payload?.cmd === 'SET_ACTIVITY',
  ).at(-1);
  assert.deepEqual(sent.payload.args.activity, activity);
  assert.equal(sent.payload.args.pid, process.pid);

  rpc.clearActivity();
  await waitFor(() =>
    frames.some(
      (frame) =>
        frame.payload?.cmd === 'SET_ACTIVITY' && !frame.payload.args?.activity,
    ),
  );
});

test('DiscordRPC connects when Discord appears later', async (t) => {
  const { directory, socketPath } = tempSocket();
  setSocket(directory, socketPath);
  const frames = [];
  const statuses = [];
  let rpc;
  let server;

  t.after(async () => {
    if (rpc) rpc.stop();
    if (server) await closeServer(server);
    clearSocket();
    removeSocketDir(directory);
  });

  rpc = new DiscordRPC({
    clientId: '123456789012345678',
    minIntervalMs: 250,
    retryMs: 100,
    logger: () => {},
  });
  rpc.on('status', (status) => statuses.push(status));
  rpc.start();

  await waitFor(() =>
    statuses.some((status) => status.state === 'disconnected'),
  );

  server = await startFakeDiscord(socketPath, frames);
  await waitFor(
    () => statuses.some((status) => status.state === 'connected'),
    { timeout: 4000 },
  );
});

test('native host bridges native messages to Discord IPC', async (t) => {
  const { directory, socketPath } = tempSocket();
  setSocket(directory, socketPath);
  const frames = [];
  const server = await startFakeDiscord(socketPath, frames);
  const nativeMessages = [];
  const reader = new NativeMessageReader();

  const child = spawn(process.execPath, [HOST_SCRIPT], {
    env: {
      ...process.env,
      CHROME_PRESENCE_MIN_INTERVAL_MS: '50',
      CHROME_PRESENCE_RETRY_MS: '100',
    },
    stdio: ['pipe', 'pipe', 'ignore'],
  });

  t.after(async () => {
    if (child.exitCode === null) child.kill('SIGTERM');
    await closeServer(server);
    clearSocket();
    removeSocketDir(directory);
  });

  child.stdout.on('data', (chunk) => {
    for (const message of reader.push(chunk)) nativeMessages.push(message);
  });

  await waitFor(() =>
    nativeMessages.some((message) => message.type === 'hello' && message.host === 'ready'),
  );

  child.stdin.write(
    encodeNativeMessage({
      type: 'hello',
      appId: '123456789012345678',
      version: 1,
    }),
  );

  await waitFor(() =>
    nativeMessages.some((message) => message.type === 'hello-ack'),
  );
  await waitFor(() =>
    nativeMessages.some(
      (message) => message.type === 'status' && message.discord === 'connected',
    ),
  );

  child.stdin.write(
    encodeNativeMessage({
      type: 'presence',
      activity: {
        type: 3,
        details: 'A video',
        state: 'youtube.com',
      },
    }),
  );

  await waitFor(() =>
    frames.some(
      (frame) =>
        frame.payload?.cmd === 'SET_ACTIVITY' &&
        frame.payload.args?.activity?.details === 'A video',
    ),
  );
  const update = frames
    .filter((frame) => frame.payload?.cmd === 'SET_ACTIVITY')
    .at(-1);
  assert.equal(update.payload.args.activity.type, 3);
  assert.equal(update.payload.args.activity.state, 'youtube.com');

  child.stdin.write(
    encodeNativeMessage({ type: 'presence', activity: null }),
  );
  await waitFor(() =>
    frames.some(
      (frame) =>
        frame.payload?.cmd === 'SET_ACTIVITY' && !frame.payload.args?.activity,
    ),
  );

  child.stdin.end();
  await waitFor(() => child.exitCode === 0, { timeout: 4000 });
});

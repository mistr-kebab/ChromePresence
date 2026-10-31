import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  encodeNativeMessage,
  NativeMessageReader,
} = require('../host/lib/native-messaging.cjs');

test('encodes and decodes a native message', () => {
  const encoded = encodeNativeMessage({ type: 'hello', appId: '123' });
  assert.equal(encoded.readUInt32LE(0), encoded.length - 4);

  const reader = new NativeMessageReader();
  assert.deepEqual(reader.push(encoded), [{ type: 'hello', appId: '123' }]);
});

test('handles split and multiple messages', () => {
  const first = encodeNativeMessage({ n: 1 });
  const second = encodeNativeMessage({ n: 2 });
  const both = Buffer.concat([first, second]);
  const reader = new NativeMessageReader();

  assert.deepEqual(reader.push(both.subarray(0, 3)), []);
  assert.deepEqual(reader.push(both.subarray(3, 7)), []);
  const messages = reader.push(both.subarray(7));
  assert.deepEqual(messages, [{ n: 1 }, { n: 2 }]);
});

test('rejects oversized and invalid messages', () => {
  const huge = Buffer.alloc(4);
  huge.writeUInt32LE(9 * 1024 * 1024, 0);
  const reader = new NativeMessageReader();
  assert.throws(() => reader.push(huge), /too large/);

  const invalid = Buffer.from([3, 0, 0, 0, 0x7b, 0x7b, 0x7b]);
  const invalidReader = new NativeMessageReader();
  assert.throws(() => invalidReader.push(invalid), /Invalid native message JSON/);
});

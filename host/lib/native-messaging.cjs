'use strict';

const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

function encodeNativeMessage(message) {
  const json = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(json.length, 0);
  return Buffer.concat([header, json]);
}

class NativeMessageReader {
  constructor({ maxSize = MAX_MESSAGE_BYTES } = {}) {
    this.buffer = Buffer.alloc(0);
    this.maxSize = maxSize;
  }

  push(chunk) {
    if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk);
    this.buffer = Buffer.concat([this.buffer, chunk]);

    const messages = [];
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (length > this.maxSize) {
        throw new Error(`Native message too large: ${length} bytes`);
      }
      if (this.buffer.length < 4 + length) break;

      const payload = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);

      let message;
      try {
        message = JSON.parse(payload.toString('utf8'));
      } catch (error) {
        throw new Error(`Invalid native message JSON: ${error.message}`);
      }
      messages.push(message);
    }

    return messages;
  }
}

module.exports = {
  encodeNativeMessage,
  NativeMessageReader,
  MAX_MESSAGE_BYTES,
};

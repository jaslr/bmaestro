import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NativeMessaging } from './native-messaging.js';
import { Readable, Writable } from 'stream';

describe('NativeMessaging', () => {
  it('reads a message with length prefix', async () => {
    // Create a buffer with length-prefixed message
    const message = { test: 'hello' };
    const json = JSON.stringify(message);
    const buffer = Buffer.alloc(4 + json.length);
    buffer.writeUInt32LE(json.length, 0);
    buffer.write(json, 4);

    const readable = Readable.from([buffer]);
    const writable = new Writable({ write: () => {} });

    const nm = new NativeMessaging(readable, writable);
    const received = await nm.read();

    expect(received).toEqual(message);
  });

  it('writes a message with length prefix', async () => {
    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk, _, callback) {
        chunks.push(chunk);
        callback();
      }
    });
    const readable = new Readable({ read: () => {} });

    const nm = new NativeMessaging(readable, writable);
    await nm.write({ test: 'hello' });

    const combined = Buffer.concat(chunks);
    const length = combined.readUInt32LE(0);
    const json = combined.slice(4, 4 + length).toString();

    expect(JSON.parse(json)).toEqual({ test: 'hello' });
  });
});

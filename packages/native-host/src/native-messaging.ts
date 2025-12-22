import { Readable, Writable } from 'stream';

/**
 * Native Messaging protocol handler
 * Chrome's native messaging uses length-prefixed JSON messages
 */
export class NativeMessaging {
  private buffer = Buffer.alloc(0);
  private pendingReads: Array<{
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(
    private input: Readable,
    private output: Writable
  ) {
    this.input.on('data', (chunk: Buffer) => this.onData(chunk));
    this.input.on('end', () => this.onEnd());
    this.input.on('error', (err) => this.onError(err));
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.processBuffer();
  }

  private onEnd(): void {
    for (const pending of this.pendingReads) {
      pending.reject(new Error('Stream ended'));
    }
    this.pendingReads = [];
  }

  private onError(error: Error): void {
    for (const pending of this.pendingReads) {
      pending.reject(error);
    }
    this.pendingReads = [];
  }

  private processBuffer(): void {
    while (this.buffer.length >= 4) {
      const messageLength = this.buffer.readUInt32LE(0);

      if (this.buffer.length < 4 + messageLength) {
        break; // Wait for more data
      }

      const json = this.buffer.slice(4, 4 + messageLength).toString('utf-8');
      this.buffer = this.buffer.slice(4 + messageLength);

      try {
        const message = JSON.parse(json);
        const pending = this.pendingReads.shift();
        if (pending) {
          pending.resolve(message);
        }
      } catch (error) {
        const pending = this.pendingReads.shift();
        if (pending) {
          pending.reject(error as Error);
        }
      }
    }
  }

  read<T = unknown>(): Promise<T> {
    return new Promise((resolve, reject) => {
      this.pendingReads.push({
        resolve: resolve as (value: unknown) => void,
        reject
      });
      this.processBuffer();
    });
  }

  write(message: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const json = JSON.stringify(message);
      const buffer = Buffer.alloc(4 + Buffer.byteLength(json, 'utf-8'));
      buffer.writeUInt32LE(Buffer.byteLength(json, 'utf-8'), 0);
      buffer.write(json, 4, 'utf-8');

      this.output.write(buffer, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

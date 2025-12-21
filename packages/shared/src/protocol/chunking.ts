import { randomUUID } from 'crypto';

/**
 * Maximum chunk size in bytes (900KB to leave headroom under 1MB limit)
 */
export const CHUNK_SIZE = 900 * 1024;

/**
 * A single chunk of a large message
 */
export interface MessageChunk {
  type: 'CHUNK';
  chunkId: string;
  index: number;
  total: number;
  data: string; // base64 encoded
}

/**
 * A single (non-chunked) message
 */
export interface SingleMessage<T> {
  type: 'SINGLE';
  data: T;
}

export type ChunkedMessage<T> = SingleMessage<T> | MessageChunk;

/**
 * Split a large message into chunks for Native Messaging protocol
 * Messages over 900KB are split to stay under 1MB limit
 *
 * @param message - The message object to potentially chunk
 * @returns Array of chunks (or single message if under limit)
 */
export function chunkMessage<T>(message: T): ChunkedMessage<T>[] {
  const json = JSON.stringify(message);
  const base64 = Buffer.from(json, 'utf-8').toString('base64');

  // If small enough, return as single message
  if (base64.length <= CHUNK_SIZE) {
    return [{ type: 'SINGLE', data: message }];
  }

  // Split into chunks
  const chunks: MessageChunk[] = [];
  const chunkId = randomUUID();
  const totalChunks = Math.ceil(base64.length / CHUNK_SIZE);

  for (let i = 0; i < totalChunks; i++) {
    chunks.push({
      type: 'CHUNK',
      chunkId,
      index: i,
      total: totalChunks,
      data: base64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
    });
  }

  return chunks;
}

/**
 * Chunk accumulator for reassembling chunked messages
 */
export class ChunkAccumulator {
  private chunks: Map<string, Map<number, string>> = new Map();
  private totals: Map<string, number> = new Map();

  /**
   * Add a chunk and return the complete message if all chunks received
   *
   * @param chunk - The chunk to add
   * @returns The reassembled message if complete, null otherwise
   */
  addChunk<T>(chunk: MessageChunk): T | null {
    const { chunkId, index, total, data } = chunk;

    // Initialize storage for this chunk ID
    if (!this.chunks.has(chunkId)) {
      this.chunks.set(chunkId, new Map());
      this.totals.set(chunkId, total);
    }

    // Store the chunk
    const chunkMap = this.chunks.get(chunkId)!;
    chunkMap.set(index, data);

    // Check if all chunks received
    if (chunkMap.size === total) {
      // Reassemble in order
      const sortedIndices = Array.from(chunkMap.keys()).sort((a, b) => a - b);
      const base64Parts = sortedIndices.map(i => chunkMap.get(i)!);
      const base64 = base64Parts.join('');

      // Decode and parse
      const json = Buffer.from(base64, 'base64').toString('utf-8');
      const message = JSON.parse(json) as T;

      // Clean up
      this.chunks.delete(chunkId);
      this.totals.delete(chunkId);

      return message;
    }

    return null;
  }

  /**
   * Get the number of received chunks for a chunk ID
   */
  getReceivedCount(chunkId: string): number {
    return this.chunks.get(chunkId)?.size ?? 0;
  }

  /**
   * Check if a chunk ID is being accumulated
   */
  hasChunkId(chunkId: string): boolean {
    return this.chunks.has(chunkId);
  }

  /**
   * Clear all accumulated chunks (e.g., on timeout)
   */
  clear(): void {
    this.chunks.clear();
    this.totals.clear();
  }

  /**
   * Clear chunks for a specific chunk ID
   */
  clearChunkId(chunkId: string): void {
    this.chunks.delete(chunkId);
    this.totals.delete(chunkId);
  }
}

/**
 * Check if a message needs chunking
 */
export function needsChunking(message: unknown): boolean {
  const json = JSON.stringify(message);
  const base64 = Buffer.from(json, 'utf-8').toString('base64');
  return base64.length > CHUNK_SIZE;
}

/**
 * Calculate the number of chunks needed for a message
 */
export function calculateChunkCount(message: unknown): number {
  const json = JSON.stringify(message);
  const base64 = Buffer.from(json, 'utf-8').toString('base64');
  return Math.ceil(base64.length / CHUNK_SIZE);
}

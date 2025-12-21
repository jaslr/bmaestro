import { describe, it, expect } from 'vitest';
import {
  chunkMessage,
  ChunkAccumulator,
  needsChunking,
  calculateChunkCount,
  CHUNK_SIZE,
} from '../src/protocol/chunking.js';
import { normalizeUrl, urlsAreEquivalent } from '../src/utils/url-normalize.js';
import { calculateBookmarkChecksum } from '../src/utils/checksum.js';

describe('Message Chunking', () => {
  describe('chunkMessage', () => {
    it('should return single message for small payloads', () => {
      const message = { type: 'test', data: 'small' };
      const chunks = chunkMessage(message);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe('SINGLE');
      if (chunks[0].type === 'SINGLE') {
        expect(chunks[0].data).toEqual(message);
      }
    });

    it('should split large messages into chunks', () => {
      // Create a message larger than CHUNK_SIZE
      const largeData = 'x'.repeat(CHUNK_SIZE * 2);
      const message = { data: largeData };
      const chunks = chunkMessage(message);

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].type).toBe('CHUNK');
      if (chunks[0].type === 'CHUNK') {
        expect(chunks[0].index).toBe(0);
        expect(chunks[0].total).toBe(chunks.length);
      }
    });
  });

  describe('ChunkAccumulator', () => {
    it('should reassemble chunks in order', () => {
      const accumulator = new ChunkAccumulator();
      const message = { test: 'value', nested: { data: [1, 2, 3] } };

      // Simulate chunking
      const chunks = chunkMessage(message);

      if (chunks[0].type === 'SINGLE') {
        // Small message, no chunking needed
        expect(chunks[0].data).toEqual(message);
      } else {
        // Process all chunks
        let result = null;
        for (const chunk of chunks) {
          if (chunk.type === 'CHUNK') {
            result = accumulator.addChunk(chunk);
          }
        }
        expect(result).toEqual(message);
      }
    });

    it('should handle out-of-order chunks', () => {
      const accumulator = new ChunkAccumulator();

      // Create large message
      const largeData = 'x'.repeat(CHUNK_SIZE * 2);
      const message = { data: largeData };
      const chunks = chunkMessage(message);

      // Skip if message is small
      if (chunks[0].type === 'SINGLE') return;

      // Shuffle chunks (reverse order)
      const shuffled = [...chunks].reverse();

      let result = null;
      for (const chunk of shuffled) {
        if (chunk.type === 'CHUNK') {
          result = accumulator.addChunk(chunk);
        }
      }

      expect(result).toEqual(message);
    });
  });

  describe('needsChunking', () => {
    it('should return false for small messages', () => {
      expect(needsChunking({ small: 'data' })).toBe(false);
    });

    it('should return true for large messages', () => {
      const large = { data: 'x'.repeat(CHUNK_SIZE * 2) };
      expect(needsChunking(large)).toBe(true);
    });
  });

  describe('calculateChunkCount', () => {
    it('should return 1 for small messages', () => {
      expect(calculateChunkCount({ small: 'data' })).toBe(1);
    });

    it('should return correct count for large messages', () => {
      const large = { data: 'x'.repeat(CHUNK_SIZE * 2) };
      expect(calculateChunkCount(large)).toBeGreaterThan(1);
    });
  });
});

describe('URL Normalization', () => {
  describe('normalizeUrl', () => {
    it('should strip UTM parameters', () => {
      const url = 'https://example.com/page?utm_source=test&utm_medium=email&foo=bar';
      const normalized = normalizeUrl(url);

      expect(normalized).not.toContain('utm_source');
      expect(normalized).not.toContain('utm_medium');
      expect(normalized).toContain('foo=bar');
    });

    it('should strip Facebook tracking', () => {
      const url = 'https://example.com/page?fbclid=abc123';
      const normalized = normalizeUrl(url);

      expect(normalized).not.toContain('fbclid');
    });

    it('should strip Google tracking', () => {
      const url = 'https://example.com/page?gclid=xyz789';
      const normalized = normalizeUrl(url);

      expect(normalized).not.toContain('gclid');
    });

    it('should upgrade HTTP to HTTPS', () => {
      const url = 'http://example.com/page';
      const normalized = normalizeUrl(url);

      expect(normalized).toBe('https://example.com/page');
    });

    it('should not upgrade localhost', () => {
      const url = 'http://localhost:3000/page';
      const normalized = normalizeUrl(url);

      expect(normalized).toBe('http://localhost:3000/page');
    });

    it('should remove trailing slash from root path', () => {
      const url = 'https://example.com/';
      const normalized = normalizeUrl(url);

      expect(normalized).toBe('https://example.com');
    });

    it('should lowercase hostname', () => {
      const url = 'https://EXAMPLE.COM/Page';
      const normalized = normalizeUrl(url);

      expect(normalized).toContain('example.com');
    });
  });

  describe('urlsAreEquivalent', () => {
    it('should match same URLs with different tracking params', () => {
      const url1 = 'https://example.com/page?utm_source=twitter';
      const url2 = 'https://example.com/page?utm_source=email';

      expect(urlsAreEquivalent(url1, url2)).toBe(true);
    });

    it('should match http and https versions', () => {
      const url1 = 'http://example.com/page';
      const url2 = 'https://example.com/page';

      expect(urlsAreEquivalent(url1, url2)).toBe(true);
    });

    it('should not match different pages', () => {
      const url1 = 'https://example.com/page1';
      const url2 = 'https://example.com/page2';

      expect(urlsAreEquivalent(url1, url2)).toBe(false);
    });
  });
});

describe('Checksum', () => {
  describe('calculateBookmarkChecksum', () => {
    it('should generate consistent checksums', () => {
      const bookmark = {
        title: 'Test',
        urlNormalized: 'https://example.com',
        isFolder: false,
        position: 0,
        parentNativeId: '1',
      };

      const checksum1 = calculateBookmarkChecksum(bookmark);
      const checksum2 = calculateBookmarkChecksum(bookmark);

      expect(checksum1).toBe(checksum2);
      expect(checksum1).toHaveLength(16);
    });

    it('should generate different checksums for different content', () => {
      const bookmark1 = {
        title: 'Test 1',
        urlNormalized: 'https://example.com',
        isFolder: false,
        position: 0,
        parentNativeId: '1',
      };

      const bookmark2 = {
        title: 'Test 2',
        urlNormalized: 'https://example.com',
        isFolder: false,
        position: 0,
        parentNativeId: '1',
      };

      expect(calculateBookmarkChecksum(bookmark1)).not.toBe(
        calculateBookmarkChecksum(bookmark2)
      );
    });
  });
});

import { createHash } from 'crypto';
import type { Bookmark } from '../types/bookmark.js';

/**
 * Calculate a checksum for a bookmark based on its content
 * Used for change detection during sync
 *
 * The checksum is based on:
 * - title
 * - url (normalized)
 * - isFolder
 * - position
 * - parentNativeId
 *
 * @param bookmark - Partial bookmark data
 * @returns SHA-256 hash (first 16 characters)
 */
export function calculateBookmarkChecksum(
  bookmark: Pick<Bookmark, 'title' | 'urlNormalized' | 'isFolder' | 'position' | 'parentNativeId'>
): string {
  const content = [
    bookmark.title,
    bookmark.urlNormalized ?? '',
    bookmark.isFolder ? '1' : '0',
    bookmark.position.toString(),
    bookmark.parentNativeId ?? '',
  ].join('|');

  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Calculate a checksum for an entire bookmark tree
 * Used for full tree comparison
 *
 * @param bookmarks - Array of bookmarks
 * @returns SHA-256 hash
 */
export function calculateTreeChecksum(bookmarks: Bookmark[]): string {
  // Sort by path for consistent ordering
  const sorted = [...bookmarks].sort((a, b) => a.path.localeCompare(b.path));

  // Concatenate all individual checksums
  const content = sorted.map(b => b.checksum).join('');

  return createHash('sha256').update(content).digest('hex');
}

/**
 * Calculate a checksum for a graveyard snapshot
 *
 * @param treeData - The complete tree data as JSON
 * @returns SHA-256 hash
 */
export function calculateSnapshotChecksum(treeData: unknown): string {
  const json = JSON.stringify(treeData);
  return createHash('sha256').update(json).digest('hex');
}

/**
 * Verify a snapshot's integrity
 *
 * @param treeData - The tree data to verify
 * @param expectedChecksum - The expected checksum
 * @returns True if checksum matches
 */
export function verifySnapshotIntegrity(
  treeData: unknown,
  expectedChecksum: string
): boolean {
  return calculateSnapshotChecksum(treeData) === expectedChecksum;
}

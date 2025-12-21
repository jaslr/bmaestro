import { z } from 'zod';

/**
 * Browser types supported by BMaestro
 */
export const BrowserType = z.enum(['chrome', 'brave', 'edge']);
export type BrowserType = z.infer<typeof BrowserType>;

/**
 * Special folder types in Chromium browsers
 * CRITICAL: Use folderType to identify bookmark bar, NOT hardcoded IDs
 */
export const FolderType = z.enum(['bookmarks-bar', 'other', 'mobile', 'managed']);
export type FolderType = z.infer<typeof FolderType>;

/**
 * A bookmark or folder in the tree
 */
export const Bookmark = z.object({
  /** BMaestro internal ID (UUID v7 for ordering) */
  id: z.string().uuid(),

  /** Browser's native bookmark ID */
  nativeId: z.string(),

  /** Parent folder's native ID */
  parentNativeId: z.string().nullable(),

  /** Display title */
  title: z.string(),

  /** URL (null for folders) */
  url: z.string().url().nullable(),

  /** Normalized URL for deduplication (strips utm_*, etc.) */
  urlNormalized: z.string().nullable(),

  /** Whether this is a folder */
  isFolder: z.boolean(),

  /** Special folder type (only for root-level special folders) */
  folderType: FolderType.nullable(),

  /** 0-indexed position within parent */
  position: z.number().int().nonnegative(),

  /** Full path from root: 'Bookmarks Bar/Dev/Projects' */
  path: z.string(),

  /** Original creation timestamp */
  dateAdded: z.string().datetime(),

  /** Hash of title+url for change detection */
  checksum: z.string(),
});
export type Bookmark = z.infer<typeof Bookmark>;

/**
 * Browser instance registered with BMaestro
 */
export const Browser = z.object({
  /** BMaestro internal ID */
  id: z.string(),

  /** Browser type */
  name: BrowserType,

  /** Profile name (default: 'Default') */
  profile: z.string().default('Default'),

  /** Installed extension ID */
  extensionId: z.string().nullable(),

  /** Current connection status */
  isConnected: z.boolean(),

  /** Whether this is the source-of-truth browser */
  isCanonical: z.boolean(),

  /** Last successful communication */
  lastSeen: z.string().datetime().nullable(),

  /** Last successful sync completion */
  lastSync: z.string().datetime().nullable(),

  /** Cached bookmark count */
  bookmarkCount: z.number().int().nonnegative(),

  /** Browser version string */
  version: z.string().nullable(),
});
export type Browser = z.infer<typeof Browser>;

/**
 * A complete bookmark tree for a browser
 */
export const BookmarkTree = z.object({
  browser: Browser,
  bookmarks: z.array(Bookmark),
  timestamp: z.string().datetime(),
  checksum: z.string(),
});
export type BookmarkTree = z.infer<typeof BookmarkTree>;

/**
 * Find the bookmarks bar folder in a tree
 * CRITICAL: Uses folderType, not hardcoded IDs
 */
export function findBookmarksBar(bookmarks: Bookmark[]): Bookmark | undefined {
  return bookmarks.find(b => b.folderType === 'bookmarks-bar');
}

/**
 * Get all bookmarks under the bookmarks bar
 */
export function getBookmarksBarContents(bookmarks: Bookmark[]): Bookmark[] {
  const bar = findBookmarksBar(bookmarks);
  if (!bar) return [];

  return bookmarks.filter(b => b.path.startsWith('Bookmarks Bar/') || b.parentNativeId === bar.nativeId);
}

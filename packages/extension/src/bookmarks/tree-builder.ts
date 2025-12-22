import { v7 as uuidv7 } from 'uuid';
import type { Bookmark, FolderType } from '@bmaestro/shared/types';
import { normalizeUrl } from '@bmaestro/shared/utils';
import { calculateBookmarkChecksum } from '@bmaestro/shared/utils';

/**
 * Map a Chrome bookmark node to our Bookmark type
 */
export function mapChromeBookmark(
  node: chrome.bookmarks.BookmarkTreeNode,
  parentPath: string,
  folderType: FolderType | null,
): Bookmark {
  const isFolder = !node.url;
  const path = parentPath ? `${parentPath}/${node.title}` : node.title;

  const bookmark: Bookmark = {
    id: uuidv7(),
    nativeId: node.id,
    parentNativeId: node.parentId ?? null,
    title: node.title,
    url: node.url ?? null,
    urlNormalized: node.url ? normalizeUrl(node.url) : null,
    isFolder,
    folderType,
    position: node.index ?? 0,
    path: isFolder ? path : parentPath,
    dateAdded: node.dateAdded
      ? new Date(node.dateAdded).toISOString()
      : new Date().toISOString(),
    checksum: '', // Will be set below
  };

  bookmark.checksum = calculateBookmarkChecksum(bookmark);
  return bookmark;
}

/**
 * Determine folder type for special folders
 */
function getFolderType(node: chrome.bookmarks.BookmarkTreeNode): FolderType | null {
  const title = node.title.toLowerCase();

  if (node.id === '1' || title === 'bookmarks bar' || title === 'bookmark bar') {
    return 'bookmarks-bar';
  }
  if (node.id === '2' || title === 'other bookmarks') {
    return 'other';
  }
  if (title === 'mobile bookmarks') {
    return 'mobile';
  }
  if (title === 'managed bookmarks') {
    return 'managed';
  }

  return null;
}

/**
 * Recursively build bookmark array from Chrome tree
 */
function walkTree(
  node: chrome.bookmarks.BookmarkTreeNode,
  parentPath: string,
  bookmarks: Bookmark[],
): void {
  if (node.id !== '0') {
    const folderType = node.children ? getFolderType(node) : null;
    const bookmark = mapChromeBookmark(node, parentPath, folderType);
    bookmarks.push(bookmark);
  }

  if (node.children) {
    const newPath = node.id === '0' ? '' : (parentPath ? `${parentPath}/${node.title}` : node.title);
    for (const child of node.children) {
      walkTree(child, newPath, bookmarks);
    }
  }
}

/**
 * Build complete bookmark tree from Chrome API
 */
export async function buildBookmarkTree(): Promise<Bookmark[]> {
  const tree = await chrome.bookmarks.getTree();
  const bookmarks: Bookmark[] = [];

  for (const root of tree) {
    walkTree(root, '', bookmarks);
  }

  return bookmarks;
}

/**
 * Get bookmarks bar contents only
 */
export async function getBookmarksBarContents(): Promise<Bookmark[]> {
  const all = await buildBookmarkTree();
  const bar = all.find(b => b.folderType === 'bookmarks-bar');

  if (!bar) return [];

  return all.filter(b =>
    b.path.startsWith('Bookmarks Bar/') ||
    b.parentNativeId === bar.nativeId
  );
}

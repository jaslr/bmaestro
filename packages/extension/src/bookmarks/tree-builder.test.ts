import { describe, it, expect, vi } from 'vitest';
import { mapChromeBookmark } from './tree-builder.js';

describe('mapChromeBookmark', () => {
  it('maps a bookmark correctly', () => {
    const chromeBookmark: chrome.bookmarks.BookmarkTreeNode = {
      id: '100',
      parentId: '1',
      index: 0,
      title: 'GitHub',
      url: 'https://github.com?utm_source=test',
      dateAdded: 1700000000000,
    };

    const result = mapChromeBookmark(chromeBookmark, 'Bookmarks Bar', null);

    expect(result.nativeId).toBe('100');
    expect(result.parentNativeId).toBe('1');
    expect(result.title).toBe('GitHub');
    expect(result.url).toBe('https://github.com?utm_source=test');
    expect(result.urlNormalized).toBe('https://github.com'); // UTM stripped
    expect(result.isFolder).toBe(false);
    expect(result.path).toBe('Bookmarks Bar');
    expect(result.position).toBe(0);
  });

  it('identifies bookmarks bar folder', () => {
    const chromeBookmark: chrome.bookmarks.BookmarkTreeNode = {
      id: '1',
      parentId: '0',
      index: 0,
      title: 'Bookmarks Bar',
      children: [],
    };

    const result = mapChromeBookmark(chromeBookmark, '', 'bookmarks-bar');

    expect(result.isFolder).toBe(true);
    expect(result.folderType).toBe('bookmarks-bar');
  });
});

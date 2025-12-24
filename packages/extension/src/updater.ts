// packages/extension/src/updater.ts
// Self-updating extension using File System Access API

import { CLOUD_CONFIG, EXTENSION_VERSION } from './cloud/config.js';

const DB_NAME = 'bmaestro-updater';
const STORE_NAME = 'folder-handle';
const HANDLE_KEY = 'extension-folder';

interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string;
}

// Store folder handle in IndexedDB
async function storeHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  });
}

// Retrieve folder handle from IndexedDB
async function getStoredHandle(): Promise<FileSystemDirectoryHandle | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(STORE_NAME, 'readonly');
      const getRequest = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
      getRequest.onsuccess = () => resolve(getRequest.result || null);
      getRequest.onerror = () => reject(getRequest.error);
    };
  });
}

// Check if we have write permission to the stored handle
async function verifyPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const permission = await handle.queryPermission({ mode: 'readwrite' });
    if (permission === 'granted') return true;

    const requested = await handle.requestPermission({ mode: 'readwrite' });
    return requested === 'granted';
  } catch {
    return false;
  }
}

// Check for updates
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  try {
    const response = await fetch(CLOUD_CONFIG.versionUrl);
    const data = await response.json();

    const updateAvailable = compareVersions(data.version, EXTENSION_VERSION) > 0;

    return {
      updateAvailable,
      currentVersion: EXTENSION_VERSION,
      latestVersion: data.version,
      downloadUrl: data.downloadUrl,
    };
  } catch (error) {
    console.error('[Updater] Failed to check for update:', error);
    return {
      updateAvailable: false,
      currentVersion: EXTENSION_VERSION,
      latestVersion: EXTENSION_VERSION,
      downloadUrl: CLOUD_CONFIG.downloadUrl,
    };
  }
}

function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}

// Setup: prompt user to select extension folder
export async function setupAutoUpdate(): Promise<boolean> {
  try {
    // Show directory picker
    const handle = await (window as any).showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'downloads',
    });

    // Verify we got the right folder by checking for manifest.json
    try {
      await handle.getFileHandle('manifest.json');
    } catch {
      throw new Error('Please select the BMaestro extension folder (should contain manifest.json)');
    }

    // Store the handle
    await storeHandle(handle);
    console.log('[Updater] Auto-update configured for folder:', handle.name);
    return true;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.log('[Updater] User cancelled folder selection');
      return false;
    }
    console.error('[Updater] Setup failed:', error);
    throw error;
  }
}

// Check if auto-update is configured
export async function isAutoUpdateConfigured(): Promise<boolean> {
  try {
    const handle = await getStoredHandle();
    if (!handle) return false;
    return await verifyPermission(handle);
  } catch {
    return false;
  }
}

// Download and extract update
export async function downloadAndApplyUpdate(
  onProgress?: (status: string) => void
): Promise<boolean> {
  const handle = await getStoredHandle();
  if (!handle) {
    throw new Error('Auto-update not configured. Please run setup first.');
  }

  const hasPermission = await verifyPermission(handle);
  if (!hasPermission) {
    throw new Error('Permission denied. Please re-run setup.');
  }

  onProgress?.('Downloading update...');

  // Download the zip
  const response = await fetch(`${CLOUD_CONFIG.downloadUrl}/extension.zip`);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }

  const zipBlob = await response.blob();
  onProgress?.('Extracting files...');

  // Extract zip using JSZip-like approach (we'll use a simple unzip)
  const files = await unzipBlob(zipBlob);

  onProgress?.('Writing files...');

  // Write all files to the folder
  for (const [path, content] of files) {
    await writeFile(handle, path, content);
  }

  onProgress?.('Update complete! Reloading...');

  // Small delay then reload
  await new Promise(resolve => setTimeout(resolve, 500));
  chrome.runtime.reload();

  return true;
}

// Simple zip extraction using the browser's native decompression
async function unzipBlob(blob: Blob): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();

  // Use JSZip-style parsing of ZIP format
  const buffer = await blob.arrayBuffer();
  const view = new DataView(buffer);

  let offset = 0;

  while (offset < buffer.byteLength - 4) {
    const signature = view.getUint32(offset, true);

    // Local file header signature
    if (signature !== 0x04034b50) break;

    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const fileNameLength = view.getUint16(offset + 26, true);
    const extraFieldLength = view.getUint16(offset + 28, true);

    const fileNameStart = offset + 30;
    const fileName = new TextDecoder().decode(
      new Uint8Array(buffer, fileNameStart, fileNameLength)
    );

    const dataStart = fileNameStart + fileNameLength + extraFieldLength;
    const compressedData = new Uint8Array(buffer, dataStart, compressedSize);

    // Skip directories
    if (!fileName.endsWith('/')) {
      let fileData: Uint8Array;

      if (compressionMethod === 0) {
        // Stored (no compression)
        fileData = compressedData;
      } else if (compressionMethod === 8) {
        // Deflate
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        const reader = ds.readable.getReader();

        writer.write(compressedData);
        writer.close();

        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }

        const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
        fileData = new Uint8Array(totalLength);
        let pos = 0;
        for (const chunk of chunks) {
          fileData.set(chunk, pos);
          pos += chunk.length;
        }
      } else {
        console.warn(`[Updater] Unknown compression method ${compressionMethod} for ${fileName}`);
        offset = dataStart + compressedSize;
        continue;
      }

      files.set(fileName, fileData);
    }

    offset = dataStart + compressedSize;
  }

  return files;
}

// Write a file to the folder, creating subdirectories as needed
async function writeFile(
  rootHandle: FileSystemDirectoryHandle,
  path: string,
  content: Uint8Array
): Promise<void> {
  const parts = path.split('/');
  const fileName = parts.pop()!;

  // Navigate/create subdirectories
  let dirHandle = rootHandle;
  for (const part of parts) {
    if (part) {
      dirHandle = await dirHandle.getDirectoryHandle(part, { create: true });
    }
  }

  // Write the file
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

// Auto-check and update on startup (if configured)
export async function autoUpdateCheck(): Promise<void> {
  const configured = await isAutoUpdateConfigured();
  if (!configured) {
    console.log('[Updater] Auto-update not configured');
    return;
  }

  const updateInfo = await checkForUpdate();
  if (!updateInfo.updateAvailable) {
    console.log('[Updater] Already on latest version:', updateInfo.currentVersion);
    return;
  }

  console.log('[Updater] Update available:', updateInfo.currentVersion, '->', updateInfo.latestVersion);

  // Store update info for popup to show
  await chrome.storage.local.set({
    pendingUpdate: {
      currentVersion: updateInfo.currentVersion,
      latestVersion: updateInfo.latestVersion,
      checkedAt: Date.now(),
    },
  });
}

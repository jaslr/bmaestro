import { IncomingMessage, ServerResponse } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const EXTENSION_DIR = process.env.EXTENSION_DIR || '/app/extension';

// Read extension ID from file (generated during Docker build)
function getExtensionId(): string {
  const idPath = join(EXTENSION_DIR, 'extension-id.txt');
  if (existsSync(idPath)) {
    try {
      return readFileSync(idPath, 'utf-8').trim();
    } catch {
      // Fall through
    }
  }
  return process.env.EXTENSION_ID || 'bmaestro';
}

// Read version from extension manifest in the Docker image
function getExtensionVersion(): string {
  const manifestPath = join(EXTENSION_DIR, 'manifest.json');

  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      return manifest.version;
    } catch {
      // Fall through
    }
  }

  return process.env.EXTENSION_VERSION || '1.8.0';
}

export function handleUpdateManifest(
  req: IncomingMessage,
  res: ServerResponse
): boolean {
  const url = req.url || '';

  if (url === '/update.xml') {
    const extensionId = getExtensionId();
    const version = getExtensionVersion();
    const crxUrl = 'https://bmaestro-sync.fly.dev/download/extension.crx';

    // Chrome update manifest format
    // See: https://developer.chrome.com/docs/extensions/how-to/distribute/host-extensions
    const xml = `<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='${extensionId}'>
    <updatecheck codebase='${crxUrl}' version='${version}' />
  </app>
</gupdate>`;

    res.writeHead(200, {
      'Content-Type': 'application/xml',
      'Cache-Control': 'no-cache',
    });
    res.end(xml);
    return true;
  }

  return false;
}

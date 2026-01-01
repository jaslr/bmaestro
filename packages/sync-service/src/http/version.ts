import { IncomingMessage, ServerResponse } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Read version from extension manifest at startup
let extensionVersion = '1.0.0';

// In Docker, extension manifest is at /app/extension/manifest.json
const extensionDir = process.env.EXTENSION_DIR || '/app/extension';
const manifestPath = join(extensionDir, 'manifest.json');

if (existsSync(manifestPath)) {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    extensionVersion = manifest.version;
    console.log(`[Version] Loaded extension version ${extensionVersion} from ${manifestPath}`);
  } catch (err) {
    console.error('[Version] Failed to read extension manifest:', err);
  }
} else {
  // Fallback for local dev
  try {
    const localManifest = join(process.cwd(), 'packages', 'extension', 'manifest.json');
    if (existsSync(localManifest)) {
      const manifest = JSON.parse(readFileSync(localManifest, 'utf-8'));
      extensionVersion = manifest.version;
    }
  } catch {
    extensionVersion = process.env.EXTENSION_VERSION || '1.0.0';
  }
}

export function getExtensionVersion(): string {
  return extensionVersion;
}

export function handleVersionCheck(
  req: IncomingMessage,
  res: ServerResponse
): boolean {
  const url = req.url || '';

  if (url === '/version' || url === '/version/extension') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({
      version: extensionVersion,
      downloadUrl: 'https://bmaestro-sync.fly.dev/download',
      timestamp: new Date().toISOString(),
    }));
    return true;
  }

  return false;
}

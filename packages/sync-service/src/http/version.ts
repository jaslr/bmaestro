import { IncomingMessage, ServerResponse } from 'http';
import { readFileSync } from 'fs';
import { join } from 'path';

// Read version from package.json at startup
let extensionVersion = '1.0.0';
try {
  // In production, extension package.json is baked into the zip
  // We'll use the sync-service version as the canonical version
  const pkgPath = join(process.cwd(), 'packages', 'sync-service', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  extensionVersion = pkg.version;
} catch {
  // Fallback - try reading from environment
  extensionVersion = process.env.EXTENSION_VERSION || '1.0.0';
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

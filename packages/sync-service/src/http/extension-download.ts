import { IncomingMessage, ServerResponse } from 'http';
import { createReadStream, statSync, existsSync } from 'fs';
import { join } from 'path';

// Extension files are bundled into the Docker image at /app/extension
const EXTENSION_DIR = process.env.EXTENSION_DIR || '/app/extension';
const EXTENSION_ZIP = join(EXTENSION_DIR, 'bmaestro-extension.zip');

export function handleExtensionDownload(
  req: IncomingMessage,
  res: ServerResponse
): boolean {
  const url = req.url || '';

  // Download extension zip
  if (url === '/download/extension' || url === '/download/extension.zip') {
    if (!existsSync(EXTENSION_ZIP)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Extension not available' }));
      return true;
    }

    const stat = statSync(EXTENSION_ZIP);
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Length': stat.size,
      'Content-Disposition': 'attachment; filename="bmaestro-extension.zip"',
    });

    createReadStream(EXTENSION_ZIP).pipe(res);
    return true;
  }

  // Installation instructions page
  if (url === '/download' || url === '/install') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html>
<html>
<head>
  <title>BMaestro Extension Download</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
    h1 { color: #1a73e8; }
    .btn { display: inline-block; background: #1a73e8; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin: 10px 0; }
    .btn:hover { background: #1557b0; }
    ol { line-height: 2; }
    code { background: #f5f5f5; padding: 2px 6px; border-radius: 4px; }
    .note { background: #fff3cd; border: 1px solid #ffc107; padding: 12px; border-radius: 6px; margin: 20px 0; }
  </style>
</head>
<body>
  <h1>BMaestro Extension</h1>
  <p>Cross-browser bookmark sync for Chrome, Brave, and Edge.</p>

  <a href="/download/extension.zip" class="btn">Download Extension</a>

  <h2>Installation</h2>
  <ol>
    <li>Download the extension zip above</li>
    <li>Extract the zip to a folder (e.g., <code>C:\\bmaestro-extension</code>)</li>
    <li>Open your browser's extensions page:
      <ul>
        <li>Chrome: <code>chrome://extensions</code></li>
        <li>Brave: <code>brave://extensions</code></li>
        <li>Edge: <code>edge://extensions</code></li>
      </ul>
    </li>
    <li>Enable "Developer mode" (toggle in top right)</li>
    <li>Click "Load unpacked"</li>
    <li>Select the extracted folder</li>
  </ol>

  <h2>Configuration</h2>
  <ol>
    <li>Click the BMaestro extension icon</li>
    <li>Enter your User ID</li>
    <li>Enter your Sync Secret</li>
    <li>Click Save</li>
  </ol>

  <div class="note">
    <strong>Note:</strong> Install in each browser you want to sync (Chrome, Brave, Edge). Use the same User ID and Sync Secret in all browsers.
  </div>
</body>
</html>`);
    return true;
  }

  return false;
}

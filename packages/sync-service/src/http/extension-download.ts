import { IncomingMessage, ServerResponse } from 'http';
import { createReadStream, statSync, existsSync } from 'fs';
import { join } from 'path';

// Extension files are bundled into the Docker image at /app/extension
const EXTENSION_DIR = process.env.EXTENSION_DIR || '/app/extension';
const EXTENSION_ZIP = join(EXTENSION_DIR, 'bmaestro-extension.zip');

// PowerShell installer script (embedded)
const INSTALLER_SCRIPT = `# BMaestro Extension Installer/Updater
# Downloads and extracts extension to a permanent location
# All browsers (Chrome, Brave, Edge) load from the same folder

$ErrorActionPreference = "Stop"

# Installation directory
$InstallDir = "$env:LOCALAPPDATA\\BMaestro\\extension"
$TempZip = "$env:TEMP\\bmaestro-extension.zip"
$DownloadUrl = "https://bmaestro-sync.fly.dev/download/extension.zip"

Write-Host ""
Write-Host "BMaestro Extension Installer" -ForegroundColor Cyan
Write-Host "=============================" -ForegroundColor Cyan
Write-Host ""

# Check if this is an update or fresh install
$isUpdate = Test-Path $InstallDir

if ($isUpdate) {
    Write-Host "Updating existing installation..." -ForegroundColor Yellow
} else {
    Write-Host "Installing BMaestro extension..." -ForegroundColor Green
}

# Create install directory
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Write-Host "Created: $InstallDir" -ForegroundColor Gray
}

# Download extension
Write-Host "Downloading from $DownloadUrl..." -ForegroundColor Gray
try {
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $TempZip -UseBasicParsing
    Write-Host "Download complete." -ForegroundColor Green
} catch {
    Write-Host "Download failed: $_" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Clear old files
if ($isUpdate) {
    Write-Host "Removing old version..." -ForegroundColor Gray
    Get-ChildItem -Path $InstallDir | Remove-Item -Recurse -Force
}

# Extract
Write-Host "Extracting..." -ForegroundColor Gray
try {
    Expand-Archive -Path $TempZip -DestinationPath $InstallDir -Force
    Write-Host "Extraction complete." -ForegroundColor Green
} catch {
    Write-Host "Extraction failed: $_" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Cleanup
Remove-Item $TempZip -Force -ErrorAction SilentlyContinue

# Get version from manifest
$manifest = Get-Content "$InstallDir\\manifest.json" | ConvertFrom-Json
$version = $manifest.version

Write-Host ""
Write-Host "SUCCESS! BMaestro v$version installed." -ForegroundColor Green
Write-Host ""
Write-Host "Extension location:" -ForegroundColor Cyan
Write-Host "  $InstallDir" -ForegroundColor White
Write-Host ""

if (-not $isUpdate) {
    Write-Host "FIRST-TIME SETUP - Load extension in each browser:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  1. Go to chrome://extensions (or brave:// or edge://)" -ForegroundColor White
    Write-Host "  2. Enable 'Developer mode' (top-right toggle)" -ForegroundColor White
    Write-Host "  3. Click 'Load unpacked'" -ForegroundColor White
    Write-Host "  4. Select: $InstallDir" -ForegroundColor Cyan
    Write-Host ""
} else {
    Write-Host "Reload extension in each browser:" -ForegroundColor Yellow
    Write-Host "  Go to extensions page -> click refresh icon on BMaestro" -ForegroundColor White
    Write-Host ""
}

Read-Host "Press Enter to exit"
`;

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

  // Download PowerShell installer
  if (url === '/download/installer.ps1') {
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'attachment; filename="bmaestro-install.ps1"',
    });
    res.end(INSTALLER_SCRIPT);
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
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 700px; margin: 50px auto; padding: 20px; background: #f8f9fa; }
    .container { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { color: #1a73e8; margin-top: 0; }
    h2 { color: #333; border-bottom: 1px solid #eee; padding-bottom: 10px; }
    .btn { display: inline-block; background: #1a73e8; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; margin: 8px 8px 8px 0; font-weight: 500; }
    .btn:hover { background: #1557b0; }
    .btn-secondary { background: #5f6368; }
    .btn-secondary:hover { background: #3c4043; }
    .method { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .method h3 { margin-top: 0; color: #1a73e8; }
    ol { line-height: 2; }
    code { background: #e8eaed; padding: 3px 8px; border-radius: 4px; font-size: 14px; }
    .note { background: #e8f5e9; border: 1px solid #4caf50; padding: 12px; border-radius: 6px; margin: 20px 0; }
    .path { background: #fff3e0; padding: 10px; border-radius: 4px; font-family: monospace; margin: 10px 0; }
  </style>
</head>
<body>
  <div class="container">
    <h1>BMaestro Extension</h1>
    <p>Cross-browser bookmark sync for Chrome, Brave, and Edge.</p>

    <div class="method">
      <h3>Windows Quick Install (Recommended)</h3>
      <p>Run this PowerShell command to install or update:</p>
      <div class="path">powershell -ExecutionPolicy Bypass -c "irm https://bmaestro-sync.fly.dev/download/installer.ps1 | iex"</div>
      <p style="color: #666; font-size: 14px;">Or download and run: <a href="/download/installer.ps1">bmaestro-install.ps1</a></p>
    </div>

    <div class="method">
      <h3>Manual Install</h3>
      <a href="/download/extension.zip" class="btn btn-secondary">Download ZIP</a>
      <ol>
        <li>Download and extract ZIP to a permanent folder</li>
        <li>Open browser extensions: <code>chrome://extensions</code></li>
        <li>Enable "Developer mode" (top-right toggle)</li>
        <li>Click "Load unpacked" and select the folder</li>
      </ol>
    </div>

    <h2>After Installation</h2>
    <ol>
      <li>Click the BMaestro extension icon in your toolbar</li>
      <li>Enter your User ID and Sync Secret</li>
      <li>Click Save - you're syncing!</li>
    </ol>

    <div class="note">
      <strong>Tip:</strong> Install in all browsers (Chrome, Brave, Edge) using the same credentials. All browsers share the same extension folder, so updates apply to all at once - just reload each browser's extension.
    </div>
  </div>
</body>
</html>`);
    return true;
  }

  return false;
}

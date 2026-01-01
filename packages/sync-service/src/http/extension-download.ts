import { IncomingMessage, ServerResponse } from 'http';
import { createReadStream, statSync, existsSync } from 'fs';
import { join } from 'path';

// Extension files are bundled into the Docker image at /app/extension
const EXTENSION_DIR = process.env.EXTENSION_DIR || '/app/extension';
const EXTENSION_ZIP = join(EXTENSION_DIR, 'bmaestro-extension.zip');
const EXTENSION_CRX = join(EXTENSION_DIR, 'bmaestro-extension.crx');

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

// Auto-updater script - runs in background, checks for updates
const UPDATER_SCRIPT = `# BMaestro Auto-Updater Service
# Runs in background, checks for updates, auto-downloads new versions

$ErrorActionPreference = "Stop"
$InstallDir = "$env:LOCALAPPDATA\\BMaestro\\extension"
$VersionUrl = "https://bmaestro-sync.fly.dev/version"
$DownloadUrl = "https://bmaestro-sync.fly.dev/download/extension.zip"
$TempZip = "$env:TEMP\\bmaestro-update.zip"
$IntervalMinutes = 30

function Get-LocalVersion {
    $manifestPath = "$InstallDir\\manifest.json"
    if (Test-Path $manifestPath) {
        $manifest = Get-Content $manifestPath | ConvertFrom-Json
        return $manifest.version
    }
    return "0.0.0"
}

function Get-RemoteVersion {
    try {
        $response = Invoke-RestMethod -Uri $VersionUrl -UseBasicParsing
        return $response.version
    } catch {
        return $null
    }
}

function Compare-Versions {
    param($local, $remote)
    $localParts = $local.Split('.') | ForEach-Object { [int]$_ }
    $remoteParts = $remote.Split('.') | ForEach-Object { [int]$_ }
    for ($i = 0; $i -lt [Math]::Max($localParts.Count, $remoteParts.Count); $i++) {
        $l = if ($i -lt $localParts.Count) { $localParts[$i] } else { 0 }
        $r = if ($i -lt $remoteParts.Count) { $remoteParts[$i] } else { 0 }
        if ($r -gt $l) { return $true }
        if ($l -gt $r) { return $false }
    }
    return $false
}

function Update-Extension {
    try {
        Invoke-WebRequest -Uri $DownloadUrl -OutFile $TempZip -UseBasicParsing
        if (-not (Test-Path $InstallDir)) {
            New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        }
        Get-ChildItem -Path $InstallDir | Remove-Item -Recurse -Force
        Expand-Archive -Path $TempZip -DestinationPath $InstallDir -Force
        Remove-Item $TempZip -Force -ErrorAction SilentlyContinue
        return $true
    } catch {
        return $false
    }
}

# Initial check
$localVersion = Get-LocalVersion
if ($localVersion -eq "0.0.0") {
    Update-Extension
}

# Update loop
while ($true) {
    $localVersion = Get-LocalVersion
    $remoteVersion = Get-RemoteVersion
    if ($remoteVersion -and (Compare-Versions $localVersion $remoteVersion)) {
        Update-Extension
    }
    Start-Sleep -Seconds ($IntervalMinutes * 60)
}
`;

// Complete setup script - installs extension + auto-updater
const SETUP_SCRIPT = `# BMaestro Complete Setup
# Downloads extension + installs auto-updater

$ErrorActionPreference = "Stop"
$Username = $env:USERNAME
$InstallDir = "$env:LOCALAPPDATA\\BMaestro"
$ExtensionDir = "$InstallDir\\extension"
$UpdaterScript = "$InstallDir\\bmaestro-updater.ps1"
$StartupDir = "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"
$StartupShortcut = "$StartupDir\\BMaestro Updater.bat"
$DownloadUrl = "https://bmaestro-sync.fly.dev/download/extension.zip"
$UpdaterUrl = "https://bmaestro-sync.fly.dev/download/updater.ps1"
$TempZip = "$env:TEMP\\bmaestro-extension.zip"

Write-Host ""
Write-Host "BMaestro Setup for $Username" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
Write-Host ""

# Create directories
Write-Host "Creating folders..." -ForegroundColor Gray
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
New-Item -ItemType Directory -Path $ExtensionDir -Force | Out-Null

# Download extension
Write-Host "Downloading extension..." -ForegroundColor Gray
Invoke-WebRequest -Uri $DownloadUrl -OutFile $TempZip -UseBasicParsing

# Extract
Write-Host "Installing extension..." -ForegroundColor Gray
Get-ChildItem -Path $ExtensionDir -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
Expand-Archive -Path $TempZip -DestinationPath $ExtensionDir -Force
Remove-Item $TempZip -Force

# Get version
$manifest = Get-Content "$ExtensionDir\\manifest.json" | ConvertFrom-Json
$version = $manifest.version

# Download updater script
Write-Host "Setting up auto-updater..." -ForegroundColor Gray
Invoke-WebRequest -Uri $UpdaterUrl -OutFile $UpdaterScript -UseBasicParsing

# Create startup batch file (runs updater at login, no admin required)
$batchContent = @"
@echo off
powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File "$UpdaterScript"
"@
Set-Content -Path $StartupShortcut -Value $batchContent -Force

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  SUCCESS! BMaestro v$version installed" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Extension installed to:" -ForegroundColor White
Write-Host "  $ExtensionDir" -ForegroundColor Cyan
Write-Host ""
Write-Host "Auto-updater: Installed (runs at login)" -ForegroundColor Green
Write-Host ""
Write-Host "----------------------------------------" -ForegroundColor Gray
Write-Host "NEXT STEP: Load extension in each browser" -ForegroundColor Yellow
Write-Host "----------------------------------------" -ForegroundColor Gray
Write-Host ""
Write-Host "For Chrome, Brave, and Edge:" -ForegroundColor White
Write-Host ""
Write-Host "  1. Open extensions page:" -ForegroundColor White
Write-Host "     - Chrome: chrome://extensions" -ForegroundColor Gray
Write-Host "     - Brave:  brave://extensions" -ForegroundColor Gray
Write-Host "     - Edge:   edge://extensions" -ForegroundColor Gray
Write-Host ""
Write-Host "  2. Enable 'Developer mode' (top-right toggle)" -ForegroundColor White
Write-Host ""
Write-Host "  3. Click 'Load unpacked'" -ForegroundColor White
Write-Host ""
Write-Host "  4. Paste this path and click Select Folder:" -ForegroundColor White
Write-Host "     $ExtensionDir" -ForegroundColor Cyan
Write-Host ""

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

  // Download extension CRX (for auto-update)
  if (url === '/download/extension.crx') {
    if (!existsSync(EXTENSION_CRX)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'CRX not available' }));
      return true;
    }

    const stat = statSync(EXTENSION_CRX);
    res.writeHead(200, {
      'Content-Type': 'application/x-chrome-extension',
      'Content-Length': stat.size,
      'Content-Disposition': 'attachment; filename="bmaestro-extension.crx"',
    });

    createReadStream(EXTENSION_CRX).pipe(res);
    return true;
  }

  // Download PowerShell installer (legacy - redirects to setup)
  if (url === '/download/installer.ps1') {
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'attachment; filename="bmaestro-install.ps1"',
    });
    res.end(INSTALLER_SCRIPT);
    return true;
  }

  // Download auto-updater script
  if (url === '/download/updater.ps1') {
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'attachment; filename="bmaestro-updater.ps1"',
    });
    res.end(UPDATER_SCRIPT);
    return true;
  }

  // Download complete setup script (extension + auto-updater)
  if (url === '/download/setup.ps1') {
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'attachment; filename="bmaestro-setup.ps1"',
    });
    res.end(SETUP_SCRIPT);
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
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 750px; margin: 50px auto; padding: 20px; background: #f8f9fa; }
    .container { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { color: #1a73e8; margin-top: 0; }
    h2 { color: #333; border-bottom: 1px solid #eee; padding-bottom: 10px; margin-top: 30px; }
    .btn { display: inline-block; background: #1a73e8; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; margin: 8px 8px 8px 0; font-weight: 500; }
    .btn:hover { background: #1557b0; }
    .btn-secondary { background: #5f6368; }
    .btn-secondary:hover { background: #3c4043; }
    .btn-small { padding: 8px 16px; font-size: 13px; }
    .method { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #1a73e8; }
    .method h3 { margin-top: 0; color: #1a73e8; }
    .method.secondary { border-left-color: #5f6368; }
    .method.secondary h3 { color: #5f6368; }
    ol, ul { line-height: 2; }
    code { background: #e8eaed; padding: 3px 8px; border-radius: 4px; font-size: 14px; }
    .note { background: #e8f5e9; border: 1px solid #4caf50; padding: 12px; border-radius: 6px; margin: 20px 0; }
    .warning { background: #fff3e0; border: 1px solid #ff9800; padding: 12px; border-radius: 6px; margin: 20px 0; }
    .cmd { background: #263238; color: #aed581; padding: 12px 16px; border-radius: 6px; font-family: 'Consolas', 'Monaco', monospace; margin: 10px 0; overflow-x: auto; }
    .browsers { display: flex; gap: 20px; flex-wrap: wrap; margin: 15px 0; }
    .browser { text-align: center; padding: 15px; background: #f8f9fa; border-radius: 8px; min-width: 100px; }
    .browser-name { font-weight: 500; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>BMaestro Extension</h1>
    <p>Cross-browser bookmark sync for Chrome, Brave, and Edge.</p>

    <div class="browsers">
      <div class="browser">
        <div style="font-size: 32px;">🌐</div>
        <div class="browser-name">Chrome</div>
      </div>
      <div class="browser">
        <div style="font-size: 32px;">🦁</div>
        <div class="browser-name">Brave</div>
      </div>
      <div class="browser">
        <div style="font-size: 32px;">📘</div>
        <div class="browser-name">Edge</div>
      </div>
    </div>

    <h2>Install (Windows)</h2>

    <div class="method">
      <h3>One Command Setup</h3>
      <p>Open PowerShell and run:</p>
      <div class="cmd">powershell -ExecutionPolicy Bypass -c "irm https://bmaestro-sync.fly.dev/download/setup.ps1 | iex"</div>
      <p style="margin: 15px 0 0 0;">This will:</p>
      <ul style="margin: 5px 0;">
        <li>Download extension to <code>%LOCALAPPDATA%\\BMaestro\\extension</code></li>
        <li>Install background auto-updater (checks every 30 min)</li>
        <li>Start auto-updater immediately</li>
      </ul>
    </div>

    <div class="method secondary">
      <h3>Manual Install (Any OS)</h3>
      <a href="/download/extension.zip" class="btn btn-secondary btn-small">Download ZIP</a>
      <ol style="margin-bottom: 0;">
        <li>Extract to a permanent folder</li>
        <li>Open <code>chrome://extensions</code> (or brave:// or edge://)</li>
        <li>Enable <strong>Developer mode</strong> (top-right toggle)</li>
        <li>Click <strong>Load unpacked</strong> → select folder</li>
      </ol>
    </div>

    <h2>How Updates Work</h2>
    <div class="note">
      <strong>Automatic:</strong> The background updater downloads new versions automatically.<br>
      <strong>You just reload:</strong> When the extension shows "Update available", click the ↻ reload icon in your browser's extensions page.
    </div>

    <p><strong>All browsers share one folder</strong> - update downloads once, reload in each browser.</p>

    <h2>First-Time Setup</h2>
    <ol>
      <li>Click the BMaestro icon in your toolbar</li>
      <li>Enter your <strong>User ID</strong> and <strong>Sync Secret</strong></li>
      <li>Click <strong>Save</strong></li>
      <li>Repeat in each browser with the same credentials</li>
    </ol>

    <div class="warning">
      <strong>Note:</strong> Use the same User ID and Sync Secret in all browsers to sync between them.
    </div>
  </div>
</body>
</html>`);
    return true;
  }

  return false;
}

# BMaestro Extension Installer/Updater
# Downloads and extracts extension to a permanent location
# All browsers (Chrome, Brave, Edge) load from the same folder

$ErrorActionPreference = "Stop"

# Installation directory
$InstallDir = "$env:LOCALAPPDATA\BMaestro\extension"
$TempZip = "$env:TEMP\bmaestro-extension.zip"
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
    exit 1
}

# Clear old files (except user data)
if ($isUpdate) {
    Write-Host "Removing old version..." -ForegroundColor Gray
    Get-ChildItem -Path $InstallDir -Exclude "*.json" | Remove-Item -Recurse -Force
}

# Extract
Write-Host "Extracting..." -ForegroundColor Gray
try {
    Expand-Archive -Path $TempZip -DestinationPath $InstallDir -Force
    Write-Host "Extraction complete." -ForegroundColor Green
} catch {
    Write-Host "Extraction failed: $_" -ForegroundColor Red
    exit 1
}

# Cleanup
Remove-Item $TempZip -Force -ErrorAction SilentlyContinue

# Get version from manifest
$manifest = Get-Content "$InstallDir\manifest.json" | ConvertFrom-Json
$version = $manifest.version

Write-Host ""
Write-Host "SUCCESS! BMaestro v$version installed." -ForegroundColor Green
Write-Host ""
Write-Host "Extension location:" -ForegroundColor Cyan
Write-Host "  $InstallDir" -ForegroundColor White
Write-Host ""

if (-not $isUpdate) {
    Write-Host "FIRST-TIME SETUP:" -ForegroundColor Yellow
    Write-Host "Load the extension in each browser:" -ForegroundColor White
    Write-Host ""
    Write-Host "  Chrome: chrome://extensions" -ForegroundColor Gray
    Write-Host "  Brave:  brave://extensions" -ForegroundColor Gray
    Write-Host "  Edge:   edge://extensions" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  1. Enable 'Developer mode' (toggle in top-right)" -ForegroundColor White
    Write-Host "  2. Click 'Load unpacked'" -ForegroundColor White
    Write-Host "  3. Select: $InstallDir" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host "RELOAD THE EXTENSION in each browser:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Chrome: chrome://extensions -> click refresh icon" -ForegroundColor Gray
    Write-Host "  Brave:  brave://extensions  -> click refresh icon" -ForegroundColor Gray
    Write-Host "  Edge:   edge://extensions   -> click refresh icon" -ForegroundColor Gray
    Write-Host ""
}

Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

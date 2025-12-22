# BMaestro Native Host Installer for Windows
# Run this script as Administrator in PowerShell

$ErrorActionPreference = "Stop"

Write-Host "Installing BMaestro Native Host..." -ForegroundColor Cyan

# Create installation directory
$installDir = "C:\bmaestro"
if (-not (Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir | Out-Null
    Write-Host "Created $installDir"
}

# Copy files from WSL
$wslPath = "\\wsl.localhost\ubuntu\home\chip\bmaestro\packages\native-host\windows-setup"

Copy-Item "$wslPath\run-native-host.bat" "$installDir\run-native-host.bat" -Force
Copy-Item "$wslPath\com.bmaestro.native_host.json" "$installDir\com.bmaestro.native_host.json" -Force
Write-Host "Copied native host files to $installDir"

# Register for Chrome
$chromeRegPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.bmaestro.native_host"
if (-not (Test-Path $chromeRegPath)) {
    New-Item -Path $chromeRegPath -Force | Out-Null
}
Set-ItemProperty -Path $chromeRegPath -Name "(Default)" -Value "$installDir\com.bmaestro.native_host.json"
Write-Host "Registered for Chrome" -ForegroundColor Green

# Register for Brave
$braveRegPath = "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.bmaestro.native_host"
if (-not (Test-Path $braveRegPath)) {
    New-Item -Path $braveRegPath -Force | Out-Null
}
Set-ItemProperty -Path $braveRegPath -Name "(Default)" -Value "$installDir\com.bmaestro.native_host.json"
Write-Host "Registered for Brave" -ForegroundColor Green

# Register for Edge
$edgeRegPath = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.bmaestro.native_host"
if (-not (Test-Path $edgeRegPath)) {
    New-Item -Path $edgeRegPath -Force | Out-Null
}
Set-ItemProperty -Path $edgeRegPath -Name "(Default)" -Value "$installDir\com.bmaestro.native_host.json"
Write-Host "Registered for Edge" -ForegroundColor Green

Write-Host ""
Write-Host "Installation complete!" -ForegroundColor Cyan
Write-Host "Now restart Chrome and the BMaestro extension should connect."
Write-Host ""
Write-Host "To start the daemon, run in WSL:" -ForegroundColor Yellow
Write-Host "  node /home/chip/bmaestro/packages/native-host/dist/daemon.js"

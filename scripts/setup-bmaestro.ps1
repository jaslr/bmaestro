# BMaestro Complete Setup
# Downloads extension + installs auto-updater

$ErrorActionPreference = "Stop"

$InstallDir = "$env:LOCALAPPDATA\BMaestro"
$ExtensionDir = "$InstallDir\extension"
$UpdaterScript = "$InstallDir\bmaestro-updater.ps1"
$DownloadUrl = "https://bmaestro-sync.fly.dev/download/extension.zip"
$UpdaterUrl = "https://bmaestro-sync.fly.dev/download/updater.ps1"
$TempZip = "$env:TEMP\bmaestro-extension.zip"
$TaskName = "BMaestro Auto-Updater"

Write-Host ""
Write-Host "BMaestro Setup" -ForegroundColor Cyan
Write-Host "==============" -ForegroundColor Cyan
Write-Host ""

# Create directories
Write-Host "Creating directories..." -ForegroundColor Gray
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
New-Item -ItemType Directory -Path $ExtensionDir -Force | Out-Null

# Download extension
Write-Host "Downloading extension..." -ForegroundColor Gray
Invoke-WebRequest -Uri $DownloadUrl -OutFile $TempZip -UseBasicParsing

# Extract
Write-Host "Extracting..." -ForegroundColor Gray
Get-ChildItem -Path $ExtensionDir | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive -Path $TempZip -DestinationPath $ExtensionDir -Force
Remove-Item $TempZip -Force

# Get version
$manifest = Get-Content "$ExtensionDir\manifest.json" | ConvertFrom-Json
$version = $manifest.version

# Download updater script
Write-Host "Setting up auto-updater..." -ForegroundColor Gray
Invoke-WebRequest -Uri $UpdaterUrl -OutFile $UpdaterScript -UseBasicParsing

# Create scheduled task for auto-updates
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$UpdaterScript`""

$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -RunLevel Limited | Out-Null

# Start the updater now
Start-ScheduledTask -TaskName $TaskName

Write-Host ""
Write-Host "SUCCESS! BMaestro v$version installed" -ForegroundColor Green
Write-Host ""
Write-Host "Extension location:" -ForegroundColor Cyan
Write-Host "  $ExtensionDir" -ForegroundColor White
Write-Host ""
Write-Host "Auto-updater: Installed and running" -ForegroundColor Green
Write-Host "  Checks for updates every 30 minutes" -ForegroundColor Gray
Write-Host ""
Write-Host "NEXT STEPS:" -ForegroundColor Yellow
Write-Host "Load the extension in each browser:" -ForegroundColor White
Write-Host ""
Write-Host "  1. Go to chrome://extensions (or brave:// or edge://)" -ForegroundColor Gray
Write-Host "  2. Enable 'Developer mode' (top-right)" -ForegroundColor Gray
Write-Host "  3. Click 'Load unpacked'" -ForegroundColor Gray
Write-Host "  4. Select: $ExtensionDir" -ForegroundColor Cyan
Write-Host ""
Write-Host "When updates are available:" -ForegroundColor Yellow
Write-Host "  - Auto-updater downloads automatically" -ForegroundColor Gray
Write-Host "  - Extension popup shows 'Update available'" -ForegroundColor Gray
Write-Host "  - Click reload icon in browser extensions page" -ForegroundColor Gray
Write-Host ""

Read-Host "Press Enter to exit"

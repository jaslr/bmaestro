# BMaestro Auto-Updater Service
# Runs in background, checks for updates, auto-downloads new versions
# Install as scheduled task to run at startup

param(
    [switch]$Install,      # Install as scheduled task
    [switch]$Uninstall,    # Remove scheduled task
    [switch]$RunOnce,      # Check once and exit
    [int]$IntervalMinutes = 30  # Check interval (default 30 min)
)

$ErrorActionPreference = "Stop"
$InstallDir = "$env:LOCALAPPDATA\BMaestro\extension"
$VersionUrl = "https://bmaestro-sync.fly.dev/version"
$DownloadUrl = "https://bmaestro-sync.fly.dev/download/extension.zip"
$TempZip = "$env:TEMP\bmaestro-update.zip"
$TaskName = "BMaestro Auto-Updater"

function Get-LocalVersion {
    $manifestPath = "$InstallDir\manifest.json"
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
        Write-Host "Failed to check remote version: $_" -ForegroundColor Red
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
    Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - Downloading update..." -ForegroundColor Cyan

    try {
        # Download
        Invoke-WebRequest -Uri $DownloadUrl -OutFile $TempZip -UseBasicParsing

        # Create dir if needed
        if (-not (Test-Path $InstallDir)) {
            New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        }

        # Clear old files
        Get-ChildItem -Path $InstallDir | Remove-Item -Recurse -Force

        # Extract
        Expand-Archive -Path $TempZip -DestinationPath $InstallDir -Force

        # Cleanup
        Remove-Item $TempZip -Force -ErrorAction SilentlyContinue

        $newVersion = Get-LocalVersion
        Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - Updated to v$newVersion" -ForegroundColor Green

        # Create a flag file so extension knows to prompt reload
        Set-Content -Path "$InstallDir\.updated" -Value (Get-Date -Format o)

        return $true
    } catch {
        Write-Host "Update failed: $_" -ForegroundColor Red
        return $false
    }
}

function Install-Task {
    $scriptPath = $MyInvocation.PSCommandPath
    if (-not $scriptPath) {
        $scriptPath = "$PSScriptRoot\bmaestro-updater.ps1"
    }

    # Remove existing task
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`""

    $trigger = New-ScheduledTaskTrigger -AtLogOn

    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -RestartInterval (New-TimeSpan -Minutes 5) `
        -RestartCount 3

    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -RunLevel Limited

    Write-Host "Installed scheduled task: $TaskName" -ForegroundColor Green
    Write-Host "The updater will run at logon and check every $IntervalMinutes minutes." -ForegroundColor Gray
    Write-Host ""
    Write-Host "To start now: Start-ScheduledTask -TaskName '$TaskName'" -ForegroundColor Cyan
}

function Uninstall-Task {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Removed scheduled task: $TaskName" -ForegroundColor Yellow
}

function Run-UpdateLoop {
    Write-Host "BMaestro Auto-Updater started" -ForegroundColor Cyan
    Write-Host "Checking for updates every $IntervalMinutes minutes" -ForegroundColor Gray
    Write-Host "Extension folder: $InstallDir" -ForegroundColor Gray
    Write-Host ""

    while ($true) {
        $localVersion = Get-LocalVersion
        $remoteVersion = Get-RemoteVersion

        if ($remoteVersion) {
            Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - Local: v$localVersion, Remote: v$remoteVersion" -ForegroundColor Gray

            if (Compare-Versions $localVersion $remoteVersion) {
                Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - Update available!" -ForegroundColor Yellow
                Update-Extension
            }
        }

        if ($RunOnce) { break }

        Start-Sleep -Seconds ($IntervalMinutes * 60)
    }
}

# Main
if ($Install) {
    Install-Task
} elseif ($Uninstall) {
    Uninstall-Task
} else {
    # First run - do initial check
    $localVersion = Get-LocalVersion
    if ($localVersion -eq "0.0.0") {
        Write-Host "No extension installed. Downloading..." -ForegroundColor Yellow
        Update-Extension
    }

    Run-UpdateLoop
}

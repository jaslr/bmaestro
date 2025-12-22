# DEPRECATED

This package is no longer used. The extension now connects directly to the cloud sync service.

## What Changed

Previously:
```
Extension → Native Host → Daemon → Cloud
```

Now:
```
Extension → Cloud (direct HTTP)
```

## Files Kept for Reference

- `windows-setup/` - Windows installation scripts (no longer needed)
- `src/` - Source code (no longer needed)

## Migration

If you had the native host installed:

1. **Remove Windows Registry entries** (optional, they're harmless):
   ```powershell
   Remove-Item -Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.bmaestro.native_host" -ErrorAction SilentlyContinue
   Remove-Item -Path "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.bmaestro.native_host" -ErrorAction SilentlyContinue
   Remove-Item -Path "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.bmaestro.native_host" -ErrorAction SilentlyContinue
   ```

2. **Delete installation folder** (optional):
   ```powershell
   Remove-Item -Recurse -Force "C:\bmaestro" -ErrorAction SilentlyContinue
   ```

3. **Stop daemon** if running - it's no longer needed.

4. **Remove from startup** if you added it there.

## Configuration

Extension now stores config in `chrome.storage.local`:
- `userId` - Your user ID
- `syncSecret` - Authentication secret
- `pollIntervalMinutes` - Sync interval (default: 5)

Configure via the extension popup.

## Why This Change?

The direct cloud connection approach:
- No daemon to start or manage
- Works immediately after browser launch
- Simpler architecture
- Fewer moving parts to break
- Still syncs quickly (default 5-minute intervals with immediate sync on changes)

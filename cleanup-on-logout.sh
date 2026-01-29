#!/bin/bash
# Safe cleanup script - runs on logout
# Only removes temp/cache files, never project files

echo "[Cleanup] Running session cleanup..."

# APT cache (downloaded .deb files)
apt-get clean 2>/dev/null

# Journal logs older than 3 days
journalctl --vacuum-time=3d 2>/dev/null

# Gradle caches older than 7 days (stale build artifacts)
find ~/.gradle/caches -type f -atime +7 -delete 2>/dev/null

# npm cache
npm cache clean --force 2>/dev/null

# Python pip cache
pip cache purge 2>/dev/null

# Old log files (compressed/rotated)
find /var/log -name "*.gz" -delete 2>/dev/null
find /var/log -name "*.old" -delete 2>/dev/null
find /var/log -name "*.[0-9]" -delete 2>/dev/null

# Docker cleanup (if docker exists) - only dangling/unused
if command -v docker &>/dev/null; then
    docker system prune -f 2>/dev/null
fi

echo "[Cleanup] Done. Disk: $(df -h / | tail -1 | awk '{print $5}') used"

/**
 * Formatting utilities for human-readable MCP tool output.
 */

/** Format an ISO timestamp to a concise local string. */
export function formatTime(iso: string | undefined): string {
  if (!iso) return "unknown";
  try {
    const d = new Date(iso);
    return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
  } catch {
    return iso;
  }
}

/** Truncate a URL for display. */
export function shortUrl(url: string | undefined, maxLen = 60): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    const display = u.hostname + u.pathname;
    return display.length > maxLen ? display.slice(0, maxLen) + "..." : display;
  } catch {
    return url.length > maxLen ? url.slice(0, maxLen) + "..." : url;
  }
}

/** Capitalize first letter. */
export function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
}

/** Time ago from now. */
export function timeAgo(iso: string | undefined): string {
  if (!iso) return "never";
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 0) return "just now";
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return iso;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

/** Format a single activity/action entry as a one-line summary. */
export function formatAction(entry: AnyRecord): string {
  const time = formatTime(entry.timestamp || entry.created);
  const action = entry.action || entry.type || "UNKNOWN";
  const title = entry.title || entry.bookmarkTitle || "";
  const url = entry.url || entry.bookmarkUrl || "";

  let detail = "";
  if (title && url) {
    detail = `: "${title}" -> ${shortUrl(url)}`;
  } else if (title) {
    detail = `: "${title}"`;
  } else if (url) {
    detail = `: ${shortUrl(url)}`;
  } else if (entry.details) {
    detail = `: ${typeof entry.details === "string" ? entry.details : JSON.stringify(entry.details)}`;
  } else if (entry.sent !== undefined || entry.received !== undefined) {
    detail = `: sent ${entry.sent ?? 0}, received ${entry.received ?? 0}`;
  }

  return `[${time}] ${action}${detail}`;
}

/** Format a feed response into readable text. */
export function formatFeed(
  data: AnyRecord,
  browser: string | undefined,
  limit: number
): string {
  const items: AnyRecord[] = data.actions || data.feed || data.items || data.activity || [];
  const label = browser ? capitalize(browser) : "All browsers";

  if (items.length === 0) {
    return `=== ${label} Feed ===\nNo recent actions found.`;
  }

  const lines = items.slice(0, limit).map(formatAction);
  return `=== ${label} Feed (last ${lines.length} actions) ===\n${lines.join("\n")}`;
}

/** Format a comparison response into readable text. */
export function formatComparison(
  data: AnyRecord,
  browser1: string,
  browser2: string
): string {
  const b1 = capitalize(browser1);
  const b2 = capitalize(browser2);

  const lines: string[] = [`=== ${b1} vs ${b2} Comparison ===`];

  // Summary stats if provided
  if (data.summary) {
    const s = data.summary;
    lines.push("");
    lines.push(`${b1}: ${s[browser1]?.actionCount ?? s.browser1Count ?? "?"} actions, last sync ${timeAgo(s[browser1]?.lastSync || s.browser1LastSync)}`);
    lines.push(`${b2}: ${s[browser2]?.actionCount ?? s.browser2Count ?? "?"} actions, last sync ${timeAgo(s[browser2]?.lastSync || s.browser2LastSync)}`);
  }

  // Discrepancies
  const discrepancies: AnyRecord[] = data.discrepancies || data.differences || data.mismatches || [];
  if (discrepancies.length > 0) {
    lines.push("");
    lines.push(`Discrepancies (${discrepancies.length}):`);
    for (const d of discrepancies) {
      const title = d.title || d.bookmarkTitle || "";
      const url = d.url || d.bookmarkUrl || "";
      const location = d.presentIn || d.browser || "";
      const reason = d.reason || d.type || "";
      lines.push(`  - ${title || shortUrl(url)} [${reason}] ${location ? `(in ${capitalize(location)} only)` : ""}`);
    }
  } else if (data.discrepancies !== undefined) {
    lines.push("");
    lines.push("No discrepancies found - browsers are in sync.");
  }

  // In-sync count
  if (data.inSyncCount !== undefined) {
    lines.push("");
    lines.push(`${data.inSyncCount} bookmarks in sync across both browsers.`);
  }

  return lines.join("\n");
}

/** Format errors response. */
export function formatErrors(data: AnyRecord, browser: string | undefined): string {
  const items: AnyRecord[] = data.errors || data.items || [];
  const label = browser ? capitalize(browser) : "All browsers";

  if (items.length === 0) {
    return `=== ${label} Errors ===\nNo recent errors found.`;
  }

  const lines: string[] = [`=== ${label} Errors (${items.length}) ===`];
  for (const e of items) {
    const time = formatTime(e.timestamp || e.created);
    const msg = e.message || e.error || e.details || "Unknown error";
    const source = e.browser || e.source || "";
    lines.push(`[${time}]${source ? ` (${capitalize(source)})` : ""} ${msg}`);
  }

  return lines.join("\n");
}

/** Format device status overview. */
export function formatDeviceStatus(data: AnyRecord): string {
  const devices: AnyRecord[] = data.devices || data.items || [];

  if (devices.length === 0) {
    return "=== Device Status ===\nNo devices found.";
  }

  const lines: string[] = ["=== Device Status Overview ==="];

  // Canonical browser
  if (data.canonical) {
    lines.push(`Canonical browser: ${capitalize(data.canonical)}`);
  }

  lines.push("");

  for (const d of devices) {
    const name = d.name || d.deviceId || d.id || "Unknown";
    const browser = d.browser || d.browserType || "";
    const lastSeen = timeAgo(d.lastSeen || d.lastActivity || d.updated);
    const actions = d.actionCount ?? d.totalActions ?? "?";
    const status = d.status || (d.connected ? "connected" : "disconnected");
    const canonical = d.isCanonical ? " [CANONICAL]" : "";

    lines.push(`${capitalize(browser)}${canonical} (${name})`);
    lines.push(`  Status: ${status} | Last seen: ${lastSeen} | Actions: ${actions}`);
  }

  return lines.join("\n");
}

/** Format a "last sync" quick summary. */
export function formatLastSync(data: AnyRecord): string {
  // Try to build a narrative from whatever the API returns
  if (data.message) return data.message;

  const parts: string[] = [];

  if (data.lastSync) {
    const ls = data.lastSync;
    const time = formatTime(ls.timestamp || ls.created);
    const browser = ls.browser ? capitalize(ls.browser) : "Unknown browser";
    const action = ls.action || "synced";
    parts.push(`Last sync: ${browser} -> Server at ${time}.`);

    if (ls.title || ls.bookmarkTitle) {
      const title = ls.title || ls.bookmarkTitle;
      const url = ls.url || ls.bookmarkUrl;
      parts.push(`${browser} ${action.toLowerCase().replace(/_/g, " ")} "${title}"${url ? ` (${shortUrl(url, 40)})` : ""}.`);
    }
  }

  // Device staleness warnings
  const devices: AnyRecord[] = data.devices || [];
  for (const d of devices) {
    const lastSeen = d.lastSeen || d.lastActivity;
    if (lastSeen) {
      const ms = Date.now() - new Date(lastSeen).getTime();
      const hours = ms / (1000 * 60 * 60);
      if (hours > 48) {
        const browser = d.browser ? capitalize(d.browser) : "A device";
        parts.push(`${browser} has not synced in ${Math.floor(hours)}+ hours.`);
      }
    }
  }

  if (parts.length === 0) {
    // Fallback: format the raw data
    return `Last sync info:\n${JSON.stringify(data, null, 2)}`;
  }

  return parts.join(" ");
}

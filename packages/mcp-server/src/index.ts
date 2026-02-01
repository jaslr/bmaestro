#!/usr/bin/env node

/**
 * BMaestro MCP Server
 *
 * Provides diagnostic tools for querying bookmark sync status
 * via the BMaestro sync service API.
 *
 * Environment variables:
 *   BMAESTRO_SYNC_SECRET (required) - Bearer token for API auth
 *   BMAESTRO_SYNC_URL    (optional) - API base URL (default: https://bmaestro-sync.fly.dev)
 *   BMAESTRO_USER_ID     (optional) - User ID header (default: chip)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { type ApiConfig, getConfig, apiGet } from "./api.js";
import {
  formatFeed,
  formatComparison,
  formatErrors,
  formatDeviceStatus,
  formatLastSync,
} from "./formatters.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  return textResult(`Error: ${msg}`);
}

let cachedConfig: ApiConfig | null = null;

function config(): ApiConfig {
  if (!cachedConfig) {
    cachedConfig = getConfig();
  }
  return cachedConfig;
}

// ── Server Setup ─────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "bmaestro-diagnostics",
  version: "1.0.0",
});

// ── Tool: get_device_feed ────────────────────────────────────────────────────

server.tool(
  "get_device_feed",
  "Get the most recent sync actions for a specific browser or all browsers. " +
  "Shows what bookmarks were added, removed, or synced recently.",
  {
    browser: z
      .enum(["chrome", "brave", "edge"])
      .optional()
      .describe("Filter by browser type"),
    device_id: z
      .string()
      .optional()
      .describe("Filter by specific device ID"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe("Number of recent actions to return (default: 20, max: 100)"),
    actions: z
      .string()
      .optional()
      .describe("Comma-separated action type filter (e.g. BOOKMARK_ADDED,BOOKMARK_REMOVED)"),
  },
  async ({ browser, device_id, limit, actions }) => {
    try {
      const cfg = config();

      // Try the dedicated feed endpoint first, fall back to activity
      let data: unknown;
      try {
        data = await apiGet(cfg, "/devices/feed", {
          browser,
          device: device_id,
          limit,
          actions,
        });
      } catch {
        // Fall back to the existing activity endpoint
        data = await apiGet(cfg, "/activity", {
          browser,
          limit,
          action: actions,
        });
      }

      return textResult(
        formatFeed(data as Record<string, unknown>, browser, limit)
      );
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ── Tool: compare_browsers ───────────────────────────────────────────────────

server.tool(
  "compare_browsers",
  "Compare recent sync actions between two browsers to find discrepancies. " +
  "Shows which bookmarks exist in one browser but not the other.",
  {
    browser1: z
      .enum(["chrome", "brave", "edge"])
      .describe("First browser to compare"),
    browser2: z
      .enum(["chrome", "brave", "edge"])
      .describe("Second browser to compare"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(100)
      .describe("Number of recent actions to compare (default: 100)"),
  },
  async ({ browser1, browser2, limit }) => {
    try {
      const cfg = config();
      const data = await apiGet(cfg, "/devices/compare", {
        browser1,
        browser2,
        limit,
      });
      return textResult(
        formatComparison(data as Record<string, unknown>, browser1, browser2)
      );
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ── Tool: get_sync_errors ────────────────────────────────────────────────────

server.tool(
  "get_sync_errors",
  "Get recent sync errors and failures. " +
  "Useful for diagnosing why bookmarks are not syncing correctly.",
  {
    browser: z
      .enum(["chrome", "brave", "edge"])
      .optional()
      .describe("Filter errors by browser type"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .describe("Number of errors to return (default: 50)"),
  },
  async ({ browser, limit }) => {
    try {
      const cfg = config();
      const data = await apiGet(cfg, "/devices/errors", {
        browser,
        limit,
      });
      return textResult(formatErrors(data as Record<string, unknown>, browser));
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ── Tool: get_device_status ──────────────────────────────────────────────────

server.tool(
  "get_device_status",
  "Overview of all connected devices and their sync state. " +
  "Shows which browsers are connected, their last activity, and which is canonical.",
  {},
  async () => {
    try {
      const cfg = config();
      const data = await apiGet(cfg, "/devices/status");
      return textResult(formatDeviceStatus(data as Record<string, unknown>));
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ── Tool: get_last_sync ──────────────────────────────────────────────────────

server.tool(
  "get_last_sync",
  "Quick check - what was the last thing that synced and between which browsers? " +
  "Returns a human-readable summary of the most recent sync activity.",
  {},
  async () => {
    try {
      const cfg = config();

      // Fetch both device status and recent activity to build a narrative
      const [statusData, activityData] = await Promise.all([
        apiGet(cfg, "/devices/status").catch(() => null),
        apiGet(cfg, "/activity", { limit: 1 }).catch(() => null),
      ]);

      // Build a combined view for the formatter
      const combined: Record<string, unknown> = {};

      // Extract last sync from activity
      if (activityData && typeof activityData === "object") {
        const items = (activityData as Record<string, unknown[]>).activity ||
          (activityData as Record<string, unknown[]>).items || [];
        if (Array.isArray(items) && items.length > 0) {
          combined.lastSync = items[0];
        }
      }

      // Extract device list from status
      if (statusData && typeof statusData === "object") {
        const sd = statusData as Record<string, unknown>;
        combined.devices = sd.devices || sd.items || [];
        combined.canonical = sd.canonical;
      }

      return textResult(formatLastSync(combined));
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ── Start Server ─────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error starting MCP server:", err);
  process.exit(1);
});

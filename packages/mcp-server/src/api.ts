/**
 * HTTP client for the BMaestro sync service API.
 */

export interface ApiConfig {
  baseUrl: string;
  syncSecret: string;
  userId: string;
}

export function getConfig(): ApiConfig {
  const syncSecret = process.env.BMAESTRO_SYNC_SECRET;
  if (!syncSecret) {
    throw new Error(
      "BMAESTRO_SYNC_SECRET environment variable is required. " +
      "Set it to the sync service bearer token."
    );
  }

  return {
    baseUrl: process.env.BMAESTRO_SYNC_URL || "https://bmaestro-sync.fly.dev",
    syncSecret,
    userId: process.env.BMAESTRO_USER_ID || "chip",
  };
}

export async function apiGet(
  config: ApiConfig,
  path: string,
  params?: Record<string, string | number | undefined>
): Promise<unknown> {
  const url = new URL(path, config.baseUrl);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${config.syncSecret}`,
      "X-User-Id": config.userId,
      "Accept": "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `API request failed: ${response.status} ${response.statusText}` +
      (body ? ` - ${body}` : "")
    );
  }

  return response.json();
}

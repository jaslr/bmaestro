import { pb } from '../pocketbase.js';

export interface ActivityLogEntry {
  user_id: string;
  device_id: string;
  browser_type: 'chrome' | 'brave' | 'edge';
  action: string;
  bookmark_title?: string;
  bookmark_url?: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export async function logActivity(entry: ActivityLogEntry): Promise<void> {
  try {
    await pb.collection('activity_log').create(entry);
  } catch (err) {
    console.error('[ActivityLog] Failed to log activity:', err);
  }
}

export async function getActivityLog(
  userId: string,
  options?: {
    limit?: number;
    offset?: number;
    action?: string;
    browserType?: string;
    startDate?: string;
    endDate?: string;
  }
): Promise<{ items: ActivityLogEntry[]; totalItems: number }> {
  const filter: string[] = [`user_id = "${userId}"`];

  if (options?.action) {
    filter.push(`action = "${options.action}"`);
  }
  if (options?.browserType) {
    filter.push(`browser_type = "${options.browserType}"`);
  }
  if (options?.startDate) {
    filter.push(`timestamp >= "${options.startDate}"`);
  }
  if (options?.endDate) {
    filter.push(`timestamp <= "${options.endDate}"`);
  }

  const result = await pb.collection('activity_log').getList(
    Math.floor((options?.offset || 0) / (options?.limit || 50)) + 1,
    options?.limit || 50,
    {
      filter: filter.join(' && '),
      sort: '-timestamp',
    }
  );

  return {
    items: result.items as unknown as ActivityLogEntry[],
    totalItems: result.totalItems,
  };
}

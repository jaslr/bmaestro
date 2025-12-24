import type { SyncOperation } from '@bmaestro/shared/types';
import { logActivity } from '../http/activity-logger.js';
import { pb } from '../pocketbase.js';

export interface SyncRequest {
  userId: string;
  deviceId: string;
  browserType: 'chrome' | 'brave' | 'edge';
  operations: SyncOperation[];
  lastSyncVersion: number;
}

export interface SyncResponse {
  success: boolean;
  operations: SyncOperation[];
  lastSyncVersion: number;
  conflicts?: Array<{
    localOp: SyncOperation;
    remoteOp: SyncOperation;
    resolution: 'local_wins' | 'remote_wins';
  }>;
}

export async function processSyncRequest(req: SyncRequest): Promise<SyncResponse> {
  const { userId, deviceId, browserType, operations, lastSyncVersion } = req;

  // 1. Get operations from other devices since lastSyncVersion
  const pendingOps = await pb.collection('sync_operations').getFullList({
    filter: `user_id = "${userId}" && device_id != "${deviceId}" && version > ${lastSyncVersion}`,
    sort: 'version',
  });

  // 2. Process incoming operations with last-edit-wins conflict resolution
  const conflicts: SyncResponse['conflicts'] = [];
  const newVersion = Date.now();

  for (const op of operations) {
    // Check for conflicts (same bookmark modified by different devices)
    const conflictingOp = pendingOps.find(
      pending => {
        const pendingPayload = pending.payload as any;
        const opPayload = op.payload as any;
        return pendingPayload?.nativeId === opPayload?.nativeId ||
               pendingPayload?.url === opPayload?.url;
      }
    );

    if (conflictingOp) {
      // Last edit wins - compare timestamps
      const conflictOpTimestamp = new Date(conflictingOp.timestamp).getTime();
      const localOpTimestamp = typeof op.timestamp === 'number'
        ? op.timestamp
        : new Date(op.timestamp as any).getTime();

      conflicts.push({
        localOp: op,
        remoteOp: conflictingOp as unknown as SyncOperation,
        resolution: localOpTimestamp > conflictOpTimestamp ? 'local_wins' : 'remote_wins',
      });

      // Log conflict
      await logActivity({
        user_id: userId,
        device_id: deviceId,
        browser_type: browserType,
        action: 'CONFLICT_RESOLVED',
        bookmark_title: (op.payload as any)?.title,
        bookmark_url: (op.payload as any)?.url,
        details: {
          resolution: localOpTimestamp > conflictOpTimestamp ? 'local_wins' : 'remote_wins',
          localTimestamp: localOpTimestamp,
          remoteTimestamp: conflictOpTimestamp,
        },
        timestamp: new Date().toISOString(),
      });

      // If remote wins, skip saving local op
      if (conflictOpTimestamp > localOpTimestamp) {
        continue;
      }
    }

    // Save operation to database
    await pb.collection('sync_operations').create({
      user_id: userId,
      device_id: deviceId,
      op_type: op.opType,
      bookmark_id: op.bookmarkId,
      payload: op.payload,
      version: newVersion,
      timestamp: typeof op.timestamp === 'number'
        ? op.timestamp
        : new Date(op.timestamp as string).getTime(),
    });

    // Log activity
    const actionMap: Record<string, string> = {
      'ADD': 'BOOKMARK_ADDED',
      'UPDATE': 'BOOKMARK_UPDATED',
      'DELETE': 'BOOKMARK_DELETED',
      'MOVE': 'BOOKMARK_MOVED',
    };

    await logActivity({
      user_id: userId,
      device_id: deviceId,
      browser_type: browserType,
      action: actionMap[op.opType] || 'BOOKMARK_UPDATED',
      bookmark_title: (op.payload as any)?.title,
      bookmark_url: (op.payload as any)?.url,
      details: op.payload as Record<string, unknown>,
      timestamp: new Date().toISOString(),
    });
  }

  // 3. Return operations to apply (from other devices)
  const opsToApply = pendingOps
    .filter(op => {
      // Exclude ops that lost conflict resolution
      const lostConflict = conflicts.find(
        c => c.remoteOp.id === op.id && c.resolution === 'local_wins'
      );
      return !lostConflict;
    })
    .map(op => ({
      id: op.id,
      opType: op.op_type,
      bookmarkId: op.bookmark_id,
      payload: op.payload,
      timestamp: typeof op.timestamp === 'string'
        ? new Date(op.timestamp).getTime()
        : op.timestamp,
      vectorClock: {},
      sourceDeviceId: op.device_id,
    })) as SyncOperation[];

  // Log sync completed
  await logActivity({
    user_id: userId,
    device_id: deviceId,
    browser_type: browserType,
    action: 'SYNC_COMPLETED',
    details: {
      operationsSent: operations.length,
      operationsReceived: opsToApply.length,
      conflicts: conflicts.length,
    },
    timestamp: new Date().toISOString(),
  });

  return {
    success: true,
    operations: opsToApply,
    lastSyncVersion: newVersion,
    conflicts: conflicts.length > 0 ? conflicts : undefined,
  };
}

// Moderation module for all bookmark operations from non-canonical browsers
// Stores pending operations in PocketBase for persistence across service restarts

import { pb } from '../pocketbase.js';

export type OperationType = 'ADD' | 'UPDATE' | 'DELETE';

export interface PendingOperation {
  id: string;
  userId: string;
  browser: string;
  operationType: OperationType;
  url?: string;
  title: string;
  folderPath?: string;
  parentId?: string;
  // For UPDATE - store previous values for revert
  previousTitle?: string;
  previousUrl?: string;
  previousParentId?: string;
  timestamp: string;
}

// Canonical browser status (per user) - this can stay in-memory as it's less critical
const canonicalBrowsers = new Map<string, string | null>();

export async function queueOperation(
  userId: string,
  operation: Omit<PendingOperation, 'id' | 'userId' | 'timestamp'>
): Promise<PendingOperation> {
  try {
    // Check if already queued (same URL and operation type)
    if (operation.url) {
      const existing = await pb.collection('pending_moderations').getList(1, 1, {
        filter: `user_id='${userId}'&&url='${operation.url}'&&operation_type='${operation.operationType}'&&status='pending'`,
      });

      if (existing.items.length > 0) {
        const item = existing.items[0];
        // For UPDATE, merge with latest values
        if (operation.operationType === 'UPDATE') {
          await pb.collection('pending_moderations').update(item.id, {
            title: operation.title,
          });
        }
        return mapRecordToOperation(item);
      }
    }

    // Create new pending operation
    const record = await pb.collection('pending_moderations').create({
      user_id: userId,
      browser: operation.browser,
      operation_type: operation.operationType,
      url: operation.url || '',
      title: operation.title || '',
      folder_path: operation.folderPath || '',
      parent_id: operation.parentId || '',
      previous_title: operation.previousTitle || '',
      previous_url: operation.previousUrl || '',
      previous_parent_id: operation.previousParentId || '',
      status: 'pending',
    });

    console.log(`[Moderation] Queued ${operation.operationType} for ${userId}: ${operation.title || operation.url}`);
    return mapRecordToOperation(record);
  } catch (err) {
    console.error('[Moderation] Failed to queue operation:', err);
    throw err;
  }
}

// Map PocketBase record to PendingOperation interface
function mapRecordToOperation(record: any): PendingOperation {
  return {
    id: record.id,
    userId: record.user_id,
    browser: record.browser,
    operationType: record.operation_type as OperationType,
    url: record.url || undefined,
    title: record.title,
    folderPath: record.folder_path || undefined,
    parentId: record.parent_id || undefined,
    previousTitle: record.previous_title || undefined,
    previousUrl: record.previous_url || undefined,
    previousParentId: record.previous_parent_id || undefined,
    timestamp: record.created,
  };
}

// Legacy function for backwards compatibility
export async function queueDeletion(
  userId: string,
  deletion: { browser: string; url: string; title: string; parentId?: string }
): Promise<PendingOperation> {
  return queueOperation(userId, {
    ...deletion,
    operationType: 'DELETE',
  });
}

export async function getPendingOperations(userId: string): Promise<PendingOperation[]> {
  try {
    const result = await pb.collection('pending_moderations').getFullList({
      filter: `user_id='${userId}'&&status='pending'`,
    });
    return result.map(mapRecordToOperation);
  } catch (err) {
    console.error('[Moderation] Failed to get pending operations:', err);
    return [];
  }
}

// Legacy alias
export async function getPendingDeletions(userId: string): Promise<PendingOperation[]> {
  return getPendingOperations(userId);
}

export async function acceptOperation(userId: string, operationId: string): Promise<PendingOperation | null> {
  try {
    const record = await pb.collection('pending_moderations').getOne(operationId);

    if (record.user_id !== userId || record.status !== 'pending') {
      return null;
    }

    // Mark as accepted
    await pb.collection('pending_moderations').update(operationId, {
      status: 'accepted',
    });

    console.log(`[Moderation] Accepted ${record.operation_type} for ${userId}: ${record.title || record.url}`);
    return mapRecordToOperation(record);
  } catch (err) {
    console.error('[Moderation] Failed to accept operation:', err);
    return null;
  }
}

// Legacy alias
export async function acceptDeletion(userId: string, deletionId: string): Promise<PendingOperation | null> {
  return acceptOperation(userId, deletionId);
}

export async function rejectOperation(userId: string, operationId: string): Promise<PendingOperation | null> {
  try {
    const record = await pb.collection('pending_moderations').getOne(operationId);

    if (record.user_id !== userId || record.status !== 'pending') {
      return null;
    }

    // Mark as rejected
    await pb.collection('pending_moderations').update(operationId, {
      status: 'rejected',
    });

    console.log(`[Moderation] Rejected ${record.operation_type} for ${userId}: ${record.title || record.url}`);
    return mapRecordToOperation(record);
  } catch (err) {
    console.error('[Moderation] Failed to reject operation:', err);
    return null;
  }
}

// Legacy alias
export async function rejectDeletion(userId: string, deletionId: string): Promise<PendingOperation | null> {
  return rejectOperation(userId, deletionId);
}

export async function acceptAllOperations(userId: string): Promise<PendingOperation[]> {
  try {
    const pending = await getPendingOperations(userId);

    for (const op of pending) {
      await pb.collection('pending_moderations').update(op.id, {
        status: 'accepted',
      });
    }

    console.log(`[Moderation] Accepted all ${pending.length} operations for ${userId}`);
    return pending;
  } catch (err) {
    console.error('[Moderation] Failed to accept all operations:', err);
    return [];
  }
}

// Legacy alias
export async function acceptAllDeletions(userId: string): Promise<PendingOperation[]> {
  return acceptAllOperations(userId);
}

export async function rejectAllOperations(userId: string): Promise<PendingOperation[]> {
  try {
    const pending = await getPendingOperations(userId);

    for (const op of pending) {
      await pb.collection('pending_moderations').update(op.id, {
        status: 'rejected',
      });
    }

    console.log(`[Moderation] Rejected all ${pending.length} operations for ${userId}`);
    return pending;
  } catch (err) {
    console.error('[Moderation] Failed to reject all operations:', err);
    return [];
  }
}

// Legacy alias
export async function rejectAllDeletions(userId: string): Promise<PendingOperation[]> {
  return rejectAllOperations(userId);
}

export function setCanonicalBrowser(userId: string, browserType: string | null): void {
  canonicalBrowsers.set(userId, browserType);
  console.log(`[Moderation] Set canonical browser for ${userId}: ${browserType || 'none'}`);
}

export function getCanonicalBrowser(userId: string): string | null {
  return canonicalBrowsers.get(userId) || null;
}

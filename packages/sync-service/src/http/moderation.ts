// Moderation module for all bookmark operations from non-canonical browsers
// Stores pending operations that require approval from the source of truth

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

// In-memory store (per user)
const pendingOperations = new Map<string, PendingOperation[]>();

// Canonical browser status (per user)
const canonicalBrowsers = new Map<string, string | null>();

export function queueOperation(
  userId: string,
  operation: Omit<PendingOperation, 'id' | 'userId' | 'timestamp'>
): PendingOperation {
  const pending = pendingOperations.get(userId) || [];

  // Check if already queued (same URL and operation type)
  // For ADD/DELETE: check by URL
  // For UPDATE: check by URL (only one pending update per URL)
  if (operation.url) {
    const existing = pending.find(
      p => p.url === operation.url && p.operationType === operation.operationType
    );
    if (existing) {
      // For UPDATE, merge with latest values
      if (operation.operationType === 'UPDATE') {
        existing.title = operation.title;
        existing.previousTitle = existing.previousTitle || operation.previousTitle;
        existing.previousUrl = existing.previousUrl || operation.previousUrl;
      }
      return existing;
    }
  }

  const newOperation: PendingOperation = {
    id: crypto.randomUUID(),
    userId,
    ...operation,
    timestamp: new Date().toISOString(),
  };

  pending.push(newOperation);
  pendingOperations.set(userId, pending);

  console.log(`[Moderation] Queued ${operation.operationType} for ${userId}: ${operation.title || operation.url}`);
  return newOperation;
}

// Legacy function for backwards compatibility
export function queueDeletion(
  userId: string,
  deletion: { browser: string; url: string; title: string; parentId?: string }
): PendingOperation {
  return queueOperation(userId, {
    ...deletion,
    operationType: 'DELETE',
  });
}

export function getPendingOperations(userId: string): PendingOperation[] {
  return pendingOperations.get(userId) || [];
}

// Legacy alias
export function getPendingDeletions(userId: string): PendingOperation[] {
  return getPendingOperations(userId);
}

export function acceptOperation(userId: string, operationId: string): PendingOperation | null {
  const pending = pendingOperations.get(userId) || [];
  const index = pending.findIndex(p => p.id === operationId);

  if (index === -1) return null;

  const [accepted] = pending.splice(index, 1);
  pendingOperations.set(userId, pending);

  console.log(`[Moderation] Accepted ${accepted.operationType} for ${userId}: ${accepted.title || accepted.url}`);
  return accepted;
}

// Legacy alias
export function acceptDeletion(userId: string, deletionId: string): PendingOperation | null {
  return acceptOperation(userId, deletionId);
}

export function rejectOperation(userId: string, operationId: string): PendingOperation | null {
  const pending = pendingOperations.get(userId) || [];
  const index = pending.findIndex(p => p.id === operationId);

  if (index === -1) return null;

  const [rejected] = pending.splice(index, 1);
  pendingOperations.set(userId, pending);

  console.log(`[Moderation] Rejected ${rejected.operationType} for ${userId}: ${rejected.title || rejected.url}`);
  return rejected;
}

// Legacy alias
export function rejectDeletion(userId: string, deletionId: string): PendingOperation | null {
  return rejectOperation(userId, deletionId);
}

export function acceptAllOperations(userId: string): PendingOperation[] {
  const pending = pendingOperations.get(userId) || [];
  pendingOperations.set(userId, []);

  console.log(`[Moderation] Accepted all ${pending.length} operations for ${userId}`);
  return pending;
}

// Legacy alias
export function acceptAllDeletions(userId: string): PendingOperation[] {
  return acceptAllOperations(userId);
}

export function rejectAllOperations(userId: string): PendingOperation[] {
  const pending = pendingOperations.get(userId) || [];
  pendingOperations.set(userId, []);

  console.log(`[Moderation] Rejected all ${pending.length} operations for ${userId}`);
  return pending;
}

// Legacy alias
export function rejectAllDeletions(userId: string): PendingOperation[] {
  return rejectAllOperations(userId);
}

export function setCanonicalBrowser(userId: string, browserType: string | null): void {
  canonicalBrowsers.set(userId, browserType);
  console.log(`[Moderation] Set canonical browser for ${userId}: ${browserType || 'none'}`);
}

export function getCanonicalBrowser(userId: string): string | null {
  return canonicalBrowsers.get(userId) || null;
}

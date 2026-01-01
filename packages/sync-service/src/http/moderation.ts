// Moderation module for deletion review
// Stores pending deletions that non-canonical browsers request

export interface PendingDeletion {
  id: string;
  userId: string;
  browser: string;
  url: string;
  title: string;
  parentId?: string;
  timestamp: string;
}

// In-memory store (per user)
const pendingDeletions = new Map<string, PendingDeletion[]>();

// Canonical browser status (per user)
const canonicalBrowsers = new Map<string, string | null>();

export function queueDeletion(userId: string, deletion: Omit<PendingDeletion, 'id' | 'userId' | 'timestamp'>): PendingDeletion {
  const pending = pendingDeletions.get(userId) || [];

  // Check if already queued (same URL)
  const existing = pending.find(p => p.url === deletion.url);
  if (existing) {
    return existing;
  }

  const newDeletion: PendingDeletion = {
    id: crypto.randomUUID(),
    userId,
    ...deletion,
    timestamp: new Date().toISOString(),
  };

  pending.push(newDeletion);
  pendingDeletions.set(userId, pending);

  console.log(`[Moderation] Queued deletion for ${userId}: ${deletion.title || deletion.url}`);
  return newDeletion;
}

export function getPendingDeletions(userId: string): PendingDeletion[] {
  return pendingDeletions.get(userId) || [];
}

export function acceptDeletion(userId: string, deletionId: string): PendingDeletion | null {
  const pending = pendingDeletions.get(userId) || [];
  const index = pending.findIndex(p => p.id === deletionId);

  if (index === -1) return null;

  const [accepted] = pending.splice(index, 1);
  pendingDeletions.set(userId, pending);

  console.log(`[Moderation] Accepted deletion for ${userId}: ${accepted.title || accepted.url}`);
  return accepted;
}

export function rejectDeletion(userId: string, deletionId: string): PendingDeletion | null {
  const pending = pendingDeletions.get(userId) || [];
  const index = pending.findIndex(p => p.id === deletionId);

  if (index === -1) return null;

  const [rejected] = pending.splice(index, 1);
  pendingDeletions.set(userId, pending);

  console.log(`[Moderation] Rejected deletion for ${userId}: ${rejected.title || rejected.url}`);
  return rejected;
}

export function acceptAllDeletions(userId: string): PendingDeletion[] {
  const pending = pendingDeletions.get(userId) || [];
  pendingDeletions.set(userId, []);

  console.log(`[Moderation] Accepted all ${pending.length} deletions for ${userId}`);
  return pending;
}

export function rejectAllDeletions(userId: string): PendingDeletion[] {
  const pending = pendingDeletions.get(userId) || [];
  pendingDeletions.set(userId, []);

  console.log(`[Moderation] Rejected all ${pending.length} deletions for ${userId}`);
  return pending;
}

export function setCanonicalBrowser(userId: string, browserType: string | null): void {
  canonicalBrowsers.set(userId, browserType);
  console.log(`[Moderation] Set canonical browser for ${userId}: ${browserType || 'none'}`);
}

export function getCanonicalBrowser(userId: string): string | null {
  return canonicalBrowsers.get(userId) || null;
}

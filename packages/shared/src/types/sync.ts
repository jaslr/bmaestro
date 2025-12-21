import { z } from 'zod';
import { Bookmark, BrowserType } from './bookmark.js';

/**
 * Types of sync operations
 */
export const SyncOpType = z.enum(['ADD', 'UPDATE', 'DELETE', 'MOVE']);
export type SyncOpType = z.infer<typeof SyncOpType>;

/**
 * A single sync operation
 */
export const SyncOperation = z.object({
  /** Operation ID */
  id: z.string().uuid(),

  /** Type of operation */
  opType: SyncOpType,

  /** Bookmark being operated on */
  bookmarkId: z.string().uuid(),

  /** Operation payload (bookmark data for ADD/UPDATE, move info for MOVE) */
  payload: z.record(z.unknown()),

  /** Operation timestamp (ms since epoch) */
  timestamp: z.number(),

  /** Vector clock for conflict detection */
  vectorClock: z.record(z.number()),

  /** Source device that initiated this operation */
  sourceDeviceId: z.string(),
});
export type SyncOperation = z.infer<typeof SyncOperation>;

/**
 * Status of a sync operation batch
 */
export const SyncStatus = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'partial',
]);
export type SyncStatus = z.infer<typeof SyncStatus>;

/**
 * A batch of sync operations
 */
export const SyncBatch = z.object({
  id: z.string().uuid(),
  operationType: z.enum(['full_sync', 'incremental', 'merge', 'restore']),
  sourceBrowser: z.string(),
  targetBrowsers: z.array(z.string()),
  status: SyncStatus,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  durationMs: z.number().nullable(),
  itemsProcessed: z.number().int().nonnegative(),
  itemsCreated: z.number().int().nonnegative(),
  itemsUpdated: z.number().int().nonnegative(),
  itemsDeleted: z.number().int().nonnegative(),
  errors: z.array(z.object({
    code: z.number(),
    message: z.string(),
    bookmarkId: z.string().optional(),
  })),
  graveyardSnapshotId: z.string().nullable(),
});
export type SyncBatch = z.infer<typeof SyncBatch>;

/**
 * Conflict types that can occur during sync
 */
export const ConflictType = z.enum([
  'SAME_URL_DIFFERENT_TITLE',
  'SAME_TITLE_DIFFERENT_URL',
  'POSITION_CONFLICT',
  'DELETED_IN_CANONICAL',
  'DELETED_IN_NON_CANONICAL',
  'EDIT_DELETE_CONFLICT',
]);
export type ConflictType = z.infer<typeof ConflictType>;

/**
 * A detected sync conflict
 */
export const SyncConflict = z.object({
  id: z.string().uuid(),
  type: ConflictType,
  canonicalOp: SyncOperation.nullable(),
  nonCanonicalOp: SyncOperation,
  resolution: z.enum(['CANONICAL_WINS', 'NON_CANONICAL_WINS', 'KEEP_BOTH', 'MANUAL_REVIEW']).nullable(),
  resolvedAt: z.string().datetime().nullable(),
  detectedAt: z.string().datetime(),
});
export type SyncConflict = z.infer<typeof SyncConflict>;

/**
 * Delta sync request - sent when browser checks in
 */
export const DeltaSyncRequest = z.object({
  deviceId: z.string(),
  lastSyncVersion: z.number(),
  browserType: BrowserType,
});
export type DeltaSyncRequest = z.infer<typeof DeltaSyncRequest>;

/**
 * Delta sync response - operations the device needs to apply
 */
export const DeltaSyncResponse = z.object({
  operations: z.array(SyncOperation),
  currentVersion: z.number(),
  yourVersion: z.number(),
  hasMore: z.boolean(),
});
export type DeltaSyncResponse = z.infer<typeof DeltaSyncResponse>;

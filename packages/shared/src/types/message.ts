import { z } from 'zod';
import { BrowserType } from './bookmark.js';
import { SyncOperation } from './sync.js';

/**
 * Standard request envelope for all messages
 */
export const RequestEnvelope = z.object({
  /** Action to perform */
  action: z.string(),

  /** Action parameters */
  params: z.record(z.unknown()).optional(),

  /** Unique request ID for correlation */
  requestId: z.string().uuid(),

  /** Request timestamp (ISO 8601) */
  timestamp: z.string().datetime(),
});
export type RequestEnvelope = z.infer<typeof RequestEnvelope>;

/**
 * Standard response envelope for all messages
 */
export const ResponseEnvelope = z.object({
  /** Whether the operation succeeded */
  success: z.boolean(),

  /** Response data (on success) */
  data: z.unknown().optional(),

  /** Error details (on failure) */
  error: z.object({
    code: z.number(),
    category: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    recoverable: z.boolean(),
    suggestedAction: z.string().optional(),
  }).optional(),

  /** Correlated request ID */
  requestId: z.string().uuid(),

  /** Operation duration in ms */
  duration: z.number(),

  /** Browser that processed this request */
  browser: BrowserType.optional(),
});
export type ResponseEnvelope = z.infer<typeof ResponseEnvelope>;

/**
 * WebSocket message types (client -> server)
 */
export const WSClientMessageType = z.enum([
  'CHECK_IN',
  'SYNC_OPS',
  'CHUNK_START',
  'CHUNK_DATA',
  'CHUNK_END',
  'PING',
  'REGISTER_DEVICE',
]);
export type WSClientMessageType = z.infer<typeof WSClientMessageType>;

/**
 * WebSocket message types (server -> client)
 */
export const WSServerMessageType = z.enum([
  'SYNC_DELTA',
  'CONFLICT',
  'PONG',
  'ERROR',
  'ACK',
  'CHUNK_ACK',
]);
export type WSServerMessageType = z.infer<typeof WSServerMessageType>;

/**
 * WebSocket client message
 */
export const WSClientMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('CHECK_IN'),
    deviceId: z.string(),
    lastSyncVersion: z.number(),
  }),
  z.object({
    type: z.literal('SYNC_OPS'),
    deviceId: z.string(),
    operations: z.array(SyncOperation),
  }),
  z.object({
    type: z.literal('CHUNK_START'),
    chunkId: z.string().uuid(),
    totalChunks: z.number().int().positive(),
    contentType: z.string(),
  }),
  z.object({
    type: z.literal('CHUNK_DATA'),
    chunkId: z.string().uuid(),
    index: z.number().int().nonnegative(),
    data: z.string(), // base64 encoded
  }),
  z.object({
    type: z.literal('CHUNK_END'),
    chunkId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('PING'),
  }),
  z.object({
    type: z.literal('REGISTER_DEVICE'),
    deviceId: z.string(),
    browserType: BrowserType,
    deviceName: z.string(),
  }),
]);
export type WSClientMessage = z.infer<typeof WSClientMessage>;

/**
 * WebSocket server message
 */
export const WSServerMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('SYNC_DELTA'),
    operations: z.array(SyncOperation),
    currentVersion: z.number(),
    yourVersion: z.number(),
  }),
  z.object({
    type: z.literal('CONFLICT'),
    conflictId: z.string().uuid(),
    yourOp: SyncOperation,
    winningOp: SyncOperation,
    resolution: z.string(),
  }),
  z.object({
    type: z.literal('PONG'),
  }),
  z.object({
    type: z.literal('ERROR'),
    code: z.string(),
    message: z.string(),
  }),
  z.object({
    type: z.literal('ACK'),
    requestId: z.string(),
  }),
  z.object({
    type: z.literal('CHUNK_ACK'),
    chunkId: z.string().uuid(),
    receivedChunks: z.number(),
  }),
]);
export type WSServerMessage = z.infer<typeof WSServerMessage>;

/**
 * Native Messaging request (extension -> native host)
 */
export const NativeRequest = z.object({
  id: z.string().uuid(),
  type: z.enum([
    'BOOKMARK_ADDED',
    'BOOKMARK_UPDATED',
    'BOOKMARK_DELETED',
    'BOOKMARK_MOVED',
    'CHECK_IN_SYNC',
    'GET_STATUS',
    'GET_TREE',
  ]),
  payload: z.record(z.unknown()).optional(),
  browser: BrowserType,
});
export type NativeRequest = z.infer<typeof NativeRequest>;

/**
 * Native Messaging response (native host -> extension)
 */
export const NativeResponse = z.object({
  id: z.string().uuid(),
  type: z.enum(['ACK', 'STATUS', 'TREE', 'SYNC_DELTA', 'ERROR', 'CHUNK']),
  payload: z.record(z.unknown()).optional(),
  error: z.string().optional(),
});
export type NativeResponse = z.infer<typeof NativeResponse>;

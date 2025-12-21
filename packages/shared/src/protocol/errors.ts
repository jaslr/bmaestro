/**
 * Error categories for BMaestro
 */
export enum ErrorCategory {
  CONNECTION = 'connection',
  VALIDATION = 'validation',
  OPERATION = 'operation',
  SYNC = 'sync',
  SYSTEM = 'system',
}

/**
 * Error codes organized by category
 *
 * 1xxx - Connection errors
 * 2xxx - Validation errors
 * 3xxx - Operation errors
 * 4xxx - Sync errors
 * 5xxx - System errors
 */
export enum ErrorCode {
  // Connection errors (1xxx)
  BROWSER_NOT_CONNECTED = 1001,
  EXTENSION_NOT_RESPONDING = 1002,
  NATIVE_HOST_TIMEOUT = 1003,
  WEBSOCKET_DISCONNECTED = 1004,
  AUTH_EXPIRED = 1005,

  // Validation errors (2xxx)
  INVALID_BOOKMARK_URL = 2001,
  FOLDER_PATH_NOT_FOUND = 2002,
  INVALID_REQUEST = 2003,
  MISSING_REQUIRED_FIELD = 2004,
  INVALID_BROWSER_TYPE = 2005,

  // Operation errors (3xxx)
  BOOKMARK_NOT_FOUND = 3001,
  DUPLICATE_BOOKMARK = 3002,
  PERMISSION_DENIED = 3003,
  FOLDER_NOT_EMPTY = 3004,
  CANNOT_MODIFY_SPECIAL_FOLDER = 3005,

  // Sync errors (4xxx)
  SYNC_CONFLICT = 4001,
  PARTIAL_SYNC_FAILURE = 4002,
  SYNC_VERSION_MISMATCH = 4003,
  CANONICAL_NOT_SET = 4004,
  SYNC_IN_PROGRESS = 4005,

  // System errors (5xxx)
  DATABASE_UNREACHABLE = 5001,
  DISK_FULL = 5002,
  MEMORY_EXHAUSTED = 5003,
  INTERNAL_ERROR = 5004,
  CHUNK_REASSEMBLY_FAILED = 5005,
}

/**
 * Get the category for an error code
 */
export function getErrorCategory(code: ErrorCode): ErrorCategory {
  if (code >= 1000 && code < 2000) return ErrorCategory.CONNECTION;
  if (code >= 2000 && code < 3000) return ErrorCategory.VALIDATION;
  if (code >= 3000 && code < 4000) return ErrorCategory.OPERATION;
  if (code >= 4000 && code < 5000) return ErrorCategory.SYNC;
  return ErrorCategory.SYSTEM;
}

/**
 * Check if an error is recoverable (retry might succeed)
 */
export function isRecoverable(code: ErrorCode): boolean {
  const recoverableCodes = new Set([
    ErrorCode.BROWSER_NOT_CONNECTED,
    ErrorCode.EXTENSION_NOT_RESPONDING,
    ErrorCode.NATIVE_HOST_TIMEOUT,
    ErrorCode.WEBSOCKET_DISCONNECTED,
    ErrorCode.DATABASE_UNREACHABLE,
    ErrorCode.SYNC_IN_PROGRESS,
  ]);
  return recoverableCodes.has(code);
}

/**
 * Get suggested action for an error
 */
export function getSuggestedAction(code: ErrorCode): string {
  const actions: Record<ErrorCode, string> = {
    [ErrorCode.BROWSER_NOT_CONNECTED]: 'Ensure browser is running; reinstall extension if persists',
    [ErrorCode.EXTENSION_NOT_RESPONDING]: 'Restart browser; check extension is enabled',
    [ErrorCode.NATIVE_HOST_TIMEOUT]: 'Restart BMaestro service; check system resources',
    [ErrorCode.WEBSOCKET_DISCONNECTED]: 'Check internet connection; service will reconnect automatically',
    [ErrorCode.AUTH_EXPIRED]: 'Re-authenticate with the service',
    [ErrorCode.INVALID_BOOKMARK_URL]: 'Verify URL format; must include protocol (http:// or https://)',
    [ErrorCode.FOLDER_PATH_NOT_FOUND]: 'Check folder exists; use exact path spelling',
    [ErrorCode.INVALID_REQUEST]: 'Check request format and parameters',
    [ErrorCode.MISSING_REQUIRED_FIELD]: 'Provide all required fields',
    [ErrorCode.INVALID_BROWSER_TYPE]: 'Use chrome, brave, or edge',
    [ErrorCode.BOOKMARK_NOT_FOUND]: 'Bookmark may have been deleted; refresh and retry',
    [ErrorCode.DUPLICATE_BOOKMARK]: 'Bookmark with same URL exists in folder',
    [ErrorCode.PERMISSION_DENIED]: 'Check browser permissions',
    [ErrorCode.FOLDER_NOT_EMPTY]: 'Delete folder contents first or use recursive delete',
    [ErrorCode.CANNOT_MODIFY_SPECIAL_FOLDER]: 'Cannot rename/move special folders like Bookmarks Bar',
    [ErrorCode.SYNC_CONFLICT]: 'Review conflict in dashboard; choose resolution',
    [ErrorCode.PARTIAL_SYNC_FAILURE]: 'Some browsers failed; check individual statuses',
    [ErrorCode.SYNC_VERSION_MISMATCH]: 'Pull latest changes before pushing',
    [ErrorCode.CANONICAL_NOT_SET]: 'Set a canonical browser before syncing',
    [ErrorCode.SYNC_IN_PROGRESS]: 'Wait for current sync to complete',
    [ErrorCode.DATABASE_UNREACHABLE]: 'Restart PocketBase; check disk space',
    [ErrorCode.DISK_FULL]: 'Free up disk space',
    [ErrorCode.MEMORY_EXHAUSTED]: 'Restart service; reduce batch size',
    [ErrorCode.INTERNAL_ERROR]: 'Report this issue with error details',
    [ErrorCode.CHUNK_REASSEMBLY_FAILED]: 'Retry the operation',
  };
  return actions[code] ?? 'Contact support';
}

/**
 * BMaestro error class with rich metadata
 */
export class BMaestroError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'BMaestroError';
  }

  get category(): ErrorCategory {
    return getErrorCategory(this.code);
  }

  get recoverable(): boolean {
    return isRecoverable(this.code);
  }

  get suggestedAction(): string {
    return getSuggestedAction(this.code);
  }

  toJSON() {
    return {
      code: this.code,
      category: this.category,
      message: this.message,
      details: this.details,
      recoverable: this.recoverable,
      suggestedAction: this.suggestedAction,
    };
  }
}

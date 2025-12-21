/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // Skip if already exists
  try {
    const existing = app.findCollectionByNameOrId("operation_log");
    if (existing) return;
  } catch (e) {}

  const collection = new Collection({
    name: "operation_log",
    type: "base",
    fields: [
      { name: "id", type: "text", primaryKey: true, required: true },
      { name: "user_id", type: "text", required: true }, // References users.id
      { name: "browser_id", type: "text" }, // References browsers.id
      { name: "sync_operation_id", type: "text" }, // References sync_operations.id
      { name: "action", type: "text", required: true }, // create, update, move, delete
      { name: "bookmark_native_id", type: "text" },
      { name: "before_state", type: "json" }, // State before operation
      { name: "after_state", type: "json" }, // State after operation
      { name: "source", type: "text", required: true }, // mcp, dashboard, sync, api
      { name: "duration_ms", type: "number" },
      { name: "success", type: "bool", required: true },
      { name: "error_message", type: "text" },
      { name: "logged_at", type: "date", required: true }, // Explicit timestamp for indexing
    ],
    indexes: [
      "CREATE INDEX idx_oplog_user_id ON operation_log (user_id)",
      "CREATE INDEX idx_oplog_browser_id ON operation_log (browser_id)",
      "CREATE INDEX idx_oplog_success ON operation_log (success)",
      "CREATE INDEX idx_oplog_logged_at ON operation_log (logged_at)"
    ]
  });

  return app.save(collection);
}, (app) => {
  try {
    const collection = app.findCollectionByNameOrId("operation_log");
    return app.delete(collection);
  } catch (e) {}
});

/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // Skip if already exists
  try {
    const existing = app.findCollectionByNameOrId("sync_operations");
    if (existing) return;
  } catch (e) {}

  const collection = new Collection({
    name: "sync_operations",
    type: "base",
    fields: [
      { name: "id", type: "text", primaryKey: true, required: true },
      { name: "user_id", type: "text", required: true }, // References users.id
      { name: "device_id", type: "text", required: true }, // References browsers.id
      { name: "op_type", type: "text", required: true }, // ADD, UPDATE, DELETE, MOVE
      { name: "bookmark_id", type: "text", required: true },
      { name: "payload", type: "json" }, // Bookmark data for ADD/UPDATE, move info for MOVE
      { name: "version", type: "number", required: true }, // Global version number for ordering
      { name: "vector_clock", type: "json" }, // Vector clock for conflict detection
      { name: "timestamp", type: "number", required: true }, // Unix timestamp ms
    ],
    indexes: [
      "CREATE INDEX idx_sync_ops_user_id ON sync_operations (user_id)",
      "CREATE INDEX idx_sync_ops_version ON sync_operations (user_id, version)",
      "CREATE INDEX idx_sync_ops_bookmark_id ON sync_operations (bookmark_id)",
      "CREATE INDEX idx_sync_ops_timestamp ON sync_operations (timestamp)"
    ]
  });

  return app.save(collection);
}, (app) => {
  try {
    const collection = app.findCollectionByNameOrId("sync_operations");
    return app.delete(collection);
  } catch (e) {}
});

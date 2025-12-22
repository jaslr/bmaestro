/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // Skip if already exists
  try {
    const existing = app.findCollectionByNameOrId("activity_log");
    if (existing) return;
  } catch (e) {}

  const collection = new Collection({
    name: "activity_log",
    type: "base",
    fields: [
      { name: "id", type: "text", primaryKey: true, required: true },
      { name: "user_id", type: "text", required: true }, // References users.id
      { name: "device_id", type: "text", required: true },
      { name: "browser_type", type: "text", required: true }, // chrome, brave, edge
      { name: "action", type: "text", required: true }, // BOOKMARK_ADDED, BOOKMARK_UPDATED, BOOKMARK_DELETED, BOOKMARK_MOVED, SYNC_STARTED, SYNC_COMPLETED, SYNC_FAILED, CONFLICT_DETECTED, CONFLICT_RESOLVED, DEVICE_CONNECTED, DEVICE_DISCONNECTED
      { name: "bookmark_title", type: "text" },
      { name: "bookmark_url", type: "text" },
      { name: "details", type: "json" }, // Additional context data
      { name: "timestamp", type: "date", required: true },
    ],
    indexes: [
      "CREATE INDEX idx_activity_user ON activity_log (user_id)",
      "CREATE INDEX idx_activity_timestamp ON activity_log (timestamp DESC)",
      "CREATE INDEX idx_activity_action ON activity_log (action)",
      "CREATE INDEX idx_activity_browser ON activity_log (browser_type)",
      "CREATE INDEX idx_activity_device ON activity_log (device_id)"
    ]
  });

  return app.save(collection);
}, (app) => {
  try {
    const collection = app.findCollectionByNameOrId("activity_log");
    return app.delete(collection);
  } catch (e) {}
});

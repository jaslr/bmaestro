/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // Skip if already exists
  try {
    const existing = app.findCollectionByNameOrId("sync_batches");
    if (existing) return;
  } catch (e) {}

  const collection = new Collection({
    name: "sync_batches",
    type: "base",
    fields: [
      { name: "id", type: "text", primaryKey: true, required: true },
      { name: "user_id", type: "text", required: true }, // References users.id
      { name: "operation_type", type: "text", required: true }, // full_sync, incremental, merge, restore
      { name: "source_browser", type: "text" }, // References browsers.id
      { name: "target_browsers", type: "json" }, // Array of browser IDs
      { name: "status", type: "text", required: true }, // pending, running, completed, failed, partial
      { name: "started_at", type: "date", required: true },
      { name: "completed_at", type: "date" },
      { name: "duration_ms", type: "number" },
      { name: "items_processed", type: "number" },
      { name: "items_created", type: "number" },
      { name: "items_updated", type: "number" },
      { name: "items_deleted", type: "number" },
      { name: "errors", type: "json" }, // Array of error objects
      { name: "graveyard_snapshot_id", type: "text" }, // References graveyard_snapshots.id
    ],
    indexes: [
      "CREATE INDEX idx_sync_batches_user_id ON sync_batches (user_id)",
      "CREATE INDEX idx_sync_batches_status ON sync_batches (status)",
      "CREATE INDEX idx_sync_batches_started ON sync_batches (started_at)"
    ]
  });

  return app.save(collection);
}, (app) => {
  try {
    const collection = app.findCollectionByNameOrId("sync_batches");
    return app.delete(collection);
  } catch (e) {}
});

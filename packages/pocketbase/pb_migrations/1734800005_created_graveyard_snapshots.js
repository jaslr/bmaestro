/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // Skip if already exists
  try {
    const existing = app.findCollectionByNameOrId("graveyard_snapshots");
    if (existing) return;
  } catch (e) {}

  const collection = new Collection({
    name: "graveyard_snapshots",
    type: "base",
    fields: [
      { name: "id", type: "text", primaryKey: true, required: true },
      { name: "user_id", type: "text", required: true }, // References users.id
      { name: "browser_id", type: "text", required: true }, // References browsers.id
      { name: "snapshot_type", type: "text", required: true }, // initial, pre_sync, manual, scheduled
      { name: "bookmark_count", type: "number", required: true },
      { name: "tree_data", type: "json", required: true }, // Complete bookmark tree
      { name: "checksum", type: "text", required: true }, // Hash for integrity
      { name: "notes", type: "text" }, // Optional description
      { name: "is_restorable", type: "bool", required: true },
      { name: "expires_at", type: "date" }, // For retention policy
    ],
    indexes: [
      "CREATE INDEX idx_graveyard_user_id ON graveyard_snapshots (user_id)",
      "CREATE INDEX idx_graveyard_browser_id ON graveyard_snapshots (browser_id)",
      "CREATE INDEX idx_graveyard_type ON graveyard_snapshots (snapshot_type)",
      "CREATE INDEX idx_graveyard_expires ON graveyard_snapshots (expires_at)"
    ]
  });

  return app.save(collection);
}, (app) => {
  try {
    const collection = app.findCollectionByNameOrId("graveyard_snapshots");
    return app.delete(collection);
  } catch (e) {}
});

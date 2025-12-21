/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // Skip if already exists
  try {
    const existing = app.findCollectionByNameOrId("sync_conflicts");
    if (existing) return;
  } catch (e) {}

  const collection = new Collection({
    name: "sync_conflicts",
    type: "base",
    fields: [
      { name: "id", type: "text", primaryKey: true, required: true },
      { name: "user_id", type: "text", required: true }, // References users.id
      { name: "sync_batch_id", type: "text" }, // References sync_batches.id
      { name: "conflict_type", type: "text", required: true }, // SAME_URL_DIFFERENT_TITLE, etc.
      { name: "canonical_op", type: "json" }, // Operation from canonical browser
      { name: "non_canonical_op", type: "json", required: true }, // Operation from other browser
      { name: "resolution", type: "text" }, // CANONICAL_WINS, NON_CANONICAL_WINS, KEEP_BOTH, MANUAL_REVIEW
      { name: "resolved_at", type: "date" },
      { name: "resolved_by", type: "text" }, // auto, user
    ],
    indexes: [
      "CREATE INDEX idx_conflicts_user_id ON sync_conflicts (user_id)",
      "CREATE INDEX idx_conflicts_unresolved ON sync_conflicts (user_id, resolved_at)"
    ]
  });

  return app.save(collection);
}, (app) => {
  try {
    const collection = app.findCollectionByNameOrId("sync_conflicts");
    return app.delete(collection);
  } catch (e) {}
});

/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // Skip if already exists
  try {
    const existing = app.findCollectionByNameOrId("pending_moderations");
    if (existing) return;
  } catch (e) {}

  const collection = new Collection({
    name: "pending_moderations",
    type: "base",
    fields: [
      // Note: id is auto-managed by PocketBase, don't define it
      { name: "user_id", type: "text", required: true },
      { name: "browser", type: "text", required: true },
      { name: "operation_type", type: "text", required: true }, // ADD, UPDATE, DELETE
      { name: "url", type: "text" },
      { name: "title", type: "text" },
      { name: "folder_path", type: "text" },
      { name: "parent_id", type: "text" },
      { name: "previous_title", type: "text" },
      { name: "previous_url", type: "text" },
      { name: "previous_parent_id", type: "text" },
      { name: "status", type: "text", required: true }, // pending, accepted, rejected
    ],
    indexes: [
      "CREATE INDEX idx_pending_moderations_user_id ON pending_moderations (user_id)",
      "CREATE INDEX idx_pending_moderations_status ON pending_moderations (status)",
      "CREATE INDEX idx_pending_moderations_user_status ON pending_moderations (user_id, status)"
    ]
  });

  return app.save(collection);
}, (app) => {
  try {
    const collection = app.findCollectionByNameOrId("pending_moderations");
    return app.delete(collection);
  } catch (e) {}
});

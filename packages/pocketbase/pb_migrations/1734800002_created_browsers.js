/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // Skip if already exists
  try {
    const existing = app.findCollectionByNameOrId("browsers");
    if (existing) return;
  } catch (e) {}

  const collection = new Collection({
    name: "browsers",
    type: "base",
    fields: [
      { name: "id", type: "text", primaryKey: true, required: true },
      { name: "user_id", type: "text", required: true }, // References users.id
      { name: "name", type: "text", required: true }, // chrome, brave, edge
      { name: "profile", type: "text", required: true }, // Default
      { name: "device_name", type: "text" }, // User's machine name
      { name: "extension_id", type: "text" },
      { name: "is_connected", type: "bool", required: true },
      { name: "is_canonical", type: "bool", required: true },
      { name: "last_seen", type: "date" },
      { name: "last_sync", type: "date" },
      { name: "last_sync_version", type: "number" },
      { name: "bookmark_count", type: "number" },
      { name: "version", type: "text" },
    ],
    indexes: [
      "CREATE INDEX idx_browsers_user_id ON browsers (user_id)",
      "CREATE INDEX idx_browsers_is_connected ON browsers (is_connected)",
      "CREATE UNIQUE INDEX idx_browsers_user_name_profile ON browsers (user_id, name, profile)"
    ]
  });

  return app.save(collection);
}, (app) => {
  try {
    const collection = app.findCollectionByNameOrId("browsers");
    return app.delete(collection);
  } catch (e) {}
});

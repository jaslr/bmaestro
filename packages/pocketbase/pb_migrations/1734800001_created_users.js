/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // Skip if already exists
  try {
    const existing = app.findCollectionByNameOrId("users");
    if (existing) return;
  } catch (e) {}

  const collection = new Collection({
    name: "users",
    type: "auth",
    fields: [
      { name: "id", type: "text", primaryKey: true, required: true },
      { name: "email", type: "email", required: true },
      { name: "canonical_browser", type: "text" }, // chrome, brave, edge
      { name: "sync_enabled", type: "bool" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_users_email ON users (email)"
    ]
  });

  return app.save(collection);
}, (app) => {
  try {
    const collection = app.findCollectionByNameOrId("users");
    return app.delete(collection);
  } catch (e) {}
});

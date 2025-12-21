/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // Skip if already exists
  try {
    const existing = app.findCollectionByNameOrId("settings");
    if (existing) return;
  } catch (e) {}

  const collection = new Collection({
    name: "settings",
    type: "base",
    fields: [
      { name: "id", type: "text", primaryKey: true, required: true },
      { name: "user_id", type: "text", required: true }, // References users.id
      { name: "key", type: "text", required: true },
      { name: "value", type: "json", required: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_settings_user_key ON settings (user_id, key)"
    ]
  });

  return app.save(collection);
}, (app) => {
  try {
    const collection = app.findCollectionByNameOrId("settings");
    return app.delete(collection);
  } catch (e) {}
});

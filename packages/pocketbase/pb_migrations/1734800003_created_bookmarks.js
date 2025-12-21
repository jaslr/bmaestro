/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // Skip if already exists
  try {
    const existing = app.findCollectionByNameOrId("bookmarks");
    if (existing) return;
  } catch (e) {}

  const collection = new Collection({
    name: "bookmarks",
    type: "base",
    fields: [
      { name: "id", type: "text", primaryKey: true, required: true },
      { name: "user_id", type: "text", required: true }, // References users.id
      { name: "browser_id", type: "text", required: true }, // References browsers.id
      { name: "native_id", type: "text", required: true }, // Browser's internal ID
      { name: "parent_native_id", type: "text" }, // Parent folder's native ID
      { name: "title", type: "text", required: true },
      { name: "url", type: "text" }, // null for folders
      { name: "url_normalized", type: "text" }, // Normalized for deduplication
      { name: "is_folder", type: "bool", required: true },
      { name: "folder_type", type: "text" }, // bookmarks-bar, other, mobile, managed
      { name: "position", type: "number", required: true },
      { name: "path", type: "text", required: true }, // Full path: 'Bookmarks Bar/Dev/Projects'
      { name: "date_added", type: "date" },
      { name: "checksum", type: "text", required: true }, // Hash for change detection
      { name: "is_deleted", type: "bool" }, // Soft delete flag
    ],
    indexes: [
      "CREATE INDEX idx_bookmarks_user_id ON bookmarks (user_id)",
      "CREATE INDEX idx_bookmarks_browser_id ON bookmarks (browser_id)",
      "CREATE INDEX idx_bookmarks_native_id ON bookmarks (browser_id, native_id)",
      "CREATE INDEX idx_bookmarks_url_normalized ON bookmarks (user_id, url_normalized)",
      "CREATE INDEX idx_bookmarks_path ON bookmarks (user_id, path)",
      "CREATE INDEX idx_bookmarks_checksum ON bookmarks (checksum)"
    ]
  });

  return app.save(collection);
}, (app) => {
  try {
    const collection = app.findCollectionByNameOrId("bookmarks");
    return app.delete(collection);
  } catch (e) {}
});

/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // Fix sync_operations - remove custom id field requirement
  try {
    const syncOps = app.findCollectionByNameOrId("sync_operations");
    if (syncOps) {
      // Remove the custom id field if it exists as a regular field
      const fields = syncOps.fields.filter(f => f.name !== 'id' || f.primaryKey === undefined);
      syncOps.fields = fields;
      app.save(syncOps);
      console.log("Fixed sync_operations schema");
    }
  } catch (e) {
    console.log("sync_operations fix error:", e);
  }

  // Fix activity_log - remove custom id field requirement
  try {
    const activityLog = app.findCollectionByNameOrId("activity_log");
    if (activityLog) {
      const fields = activityLog.fields.filter(f => f.name !== 'id' || f.primaryKey === undefined);
      activityLog.fields = fields;
      app.save(activityLog);
      console.log("Fixed activity_log schema");
    }
  } catch (e) {
    console.log("activity_log fix error:", e);
  }

  // Fix bookmarks
  try {
    const bookmarks = app.findCollectionByNameOrId("bookmarks");
    if (bookmarks) {
      const fields = bookmarks.fields.filter(f => f.name !== 'id' || f.primaryKey === undefined);
      bookmarks.fields = fields;
      app.save(bookmarks);
      console.log("Fixed bookmarks schema");
    }
  } catch (e) {
    console.log("bookmarks fix error:", e);
  }
}, (app) => {
  // No revert needed
});

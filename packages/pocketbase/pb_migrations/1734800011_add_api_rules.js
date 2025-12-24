/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // Update sync_operations collection with API rules
  try {
    const syncOps = app.findCollectionByNameOrId("sync_operations");
    if (syncOps) {
      // Allow all operations - sync service is trusted
      syncOps.listRule = "";
      syncOps.viewRule = "";
      syncOps.createRule = "";
      syncOps.updateRule = "";
      syncOps.deleteRule = "";
      app.save(syncOps);
      console.log("Updated sync_operations API rules");
    }
  } catch (e) {
    console.log("sync_operations not found:", e);
  }

  // Update activity_log collection with API rules
  try {
    const activityLog = app.findCollectionByNameOrId("activity_log");
    if (activityLog) {
      // Allow all operations - sync service is trusted
      activityLog.listRule = "";
      activityLog.viewRule = "";
      activityLog.createRule = "";
      activityLog.updateRule = "";
      activityLog.deleteRule = "";
      app.save(activityLog);
      console.log("Updated activity_log API rules");
    }
  } catch (e) {
    console.log("activity_log not found:", e);
  }

  // Update bookmarks collection
  try {
    const bookmarks = app.findCollectionByNameOrId("bookmarks");
    if (bookmarks) {
      bookmarks.listRule = "";
      bookmarks.viewRule = "";
      bookmarks.createRule = "";
      bookmarks.updateRule = "";
      bookmarks.deleteRule = "";
      app.save(bookmarks);
      console.log("Updated bookmarks API rules");
    }
  } catch (e) {
    console.log("bookmarks not found:", e);
  }

  // Update users collection
  try {
    const users = app.findCollectionByNameOrId("users");
    if (users) {
      users.listRule = "";
      users.viewRule = "";
      users.createRule = "";
      users.updateRule = "";
      users.deleteRule = "";
      app.save(users);
      console.log("Updated users API rules");
    }
  } catch (e) {
    console.log("users not found:", e);
  }

  // Update browsers collection
  try {
    const browsers = app.findCollectionByNameOrId("browsers");
    if (browsers) {
      browsers.listRule = "";
      browsers.viewRule = "";
      browsers.createRule = "";
      browsers.updateRule = "";
      browsers.deleteRule = "";
      app.save(browsers);
      console.log("Updated browsers API rules");
    }
  } catch (e) {
    console.log("browsers not found:", e);
  }
}, (app) => {
  // Revert - lock down all collections
  const collections = ["sync_operations", "activity_log", "bookmarks", "users", "browsers"];
  for (const name of collections) {
    try {
      const col = app.findCollectionByNameOrId(name);
      if (col) {
        col.listRule = null;
        col.viewRule = null;
        col.createRule = null;
        col.updateRule = null;
        col.deleteRule = null;
        app.save(col);
      }
    } catch (e) {}
  }
});

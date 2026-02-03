/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // Update pending_moderations collection with API rules
  try {
    const pendingModerations = app.findCollectionByNameOrId("pending_moderations");
    if (pendingModerations) {
      // Allow all operations - sync service is trusted
      pendingModerations.listRule = "";
      pendingModerations.viewRule = "";
      pendingModerations.createRule = "";
      pendingModerations.updateRule = "";
      pendingModerations.deleteRule = "";
      app.save(pendingModerations);
      console.log("Updated pending_moderations API rules");
    }
  } catch (e) {
    console.log("pending_moderations not found:", e);
  }
}, (app) => {
  // Revert - lock down collection
  try {
    const col = app.findCollectionByNameOrId("pending_moderations");
    if (col) {
      col.listRule = null;
      col.viewRule = null;
      col.createRule = null;
      col.updateRule = null;
      col.deleteRule = null;
      app.save(col);
    }
  } catch (e) {}
});

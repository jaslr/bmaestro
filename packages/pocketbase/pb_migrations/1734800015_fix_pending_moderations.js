/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // Fix pending_moderations - remove custom id field requirement
  try {
    const pendingModerations = app.findCollectionByNameOrId("pending_moderations");
    if (pendingModerations) {
      // Remove the custom id field if it exists as a regular field
      const fields = pendingModerations.fields.filter(f => f.name !== 'id' || f.primaryKey === undefined);
      pendingModerations.fields = fields;
      app.save(pendingModerations);
      console.log("Fixed pending_moderations schema - removed custom id field");
    }
  } catch (e) {
    console.log("pending_moderations fix error:", e);
  }
}, (app) => {
  // No revert needed
});



export const index = 1;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/fallbacks/error.svelte.js')).default;
export const imports = ["_app/immutable/nodes/1.CO0iydTF.js","_app/immutable/chunks/B2QSKqcC.js","_app/immutable/chunks/C_IguIC6.js","_app/immutable/chunks/CVzrbGDj.js"];
export const stylesheets = [];
export const fonts = [];

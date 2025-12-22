

export const index = 2;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_page.svelte.js')).default;
export const imports = ["_app/immutable/nodes/2.C8X10g7x.js","_app/immutable/chunks/B2QSKqcC.js","_app/immutable/chunks/C_IguIC6.js"];
export const stylesheets = ["_app/immutable/assets/2.CYAk_KqP.css"];
export const fonts = [];

export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set([]),
	mimeTypes: {},
	_: {
		client: {start:"_app/immutable/entry/start.DVnB8DA0.js",app:"_app/immutable/entry/app.jjh0AwCY.js",imports:["_app/immutable/entry/start.DVnB8DA0.js","_app/immutable/chunks/lECtuqPk.js","_app/immutable/chunks/B2QSKqcC.js","_app/immutable/entry/app.jjh0AwCY.js","_app/immutable/chunks/B2QSKqcC.js","_app/immutable/chunks/C_IguIC6.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js')),
			__memo(() => import('./nodes/2.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/",
				pattern: /^\/$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			}
		],
		prerendered_routes: new Set([]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();

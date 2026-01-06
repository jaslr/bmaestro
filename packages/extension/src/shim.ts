// Browser shims for Node.js globals - must be imported first!
// These shims provide minimal compatibility for libraries that expect Node.js globals

// Use a more permissive approach to avoid conflicts with @types/node
const _globalThis = globalThis as Record<string, unknown>;

if (typeof _globalThis.process === 'undefined') {
  _globalThis.process = {
    env: {},
    browser: true,
    version: 'v20.0.0',
    versions: {},
    platform: 'browser',
    nextTick: (cb: Function, ...args: unknown[]) => setTimeout(() => cb(...args), 0),
  };
}

if (typeof _globalThis.exports === 'undefined') {
  _globalThis.exports = {};
}

if (typeof _globalThis.module === 'undefined') {
  _globalThis.module = { exports: _globalThis.exports };
}

export {};

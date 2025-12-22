// Browser shims for Node.js globals - must be imported first!
declare global {
  var process: any;
  var exports: any;
  var module: any;
}

if (typeof globalThis.process === 'undefined') {
  globalThis.process = {
    env: {},
    browser: true,
    version: 'v20.0.0',
    versions: {},
    platform: 'browser',
    nextTick: (cb: Function, ...args: any[]) => setTimeout(() => cb(...args), 0),
  };
}

if (typeof globalThis.exports === 'undefined') {
  globalThis.exports = {};
}

if (typeof globalThis.module === 'undefined') {
  globalThis.module = { exports: globalThis.exports };
}

export {};

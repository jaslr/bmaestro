#!/usr/bin/env node
import { writeFileSync, mkdirSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { homedir, platform } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MANIFEST_NAME = 'com.bmaestro.native_host';

interface BrowserConfig {
  name: string;
  manifestPath: string;
}

function getBrowserConfigs(): BrowserConfig[] {
  const home = homedir();
  const os = platform();

  if (os === 'darwin') {
    return [
      {
        name: 'chrome',
        manifestPath: join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts'),
      },
      {
        name: 'brave',
        manifestPath: join(home, 'Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts'),
      },
      {
        name: 'edge',
        manifestPath: join(home, 'Library/Application Support/Microsoft Edge/NativeMessagingHosts'),
      },
    ];
  }

  if (os === 'linux') {
    return [
      {
        name: 'chrome',
        manifestPath: join(home, '.config/google-chrome/NativeMessagingHosts'),
      },
      {
        name: 'brave',
        manifestPath: join(home, '.config/BraveSoftware/Brave-Browser/NativeMessagingHosts'),
      },
      {
        name: 'edge',
        manifestPath: join(home, '.config/microsoft-edge/NativeMessagingHosts'),
      },
    ];
  }

  if (os === 'win32') {
    const appData = process.env.LOCALAPPDATA ?? join(home, 'AppData/Local');
    return [
      {
        name: 'chrome',
        manifestPath: join(appData, 'Google/Chrome/User Data/NativeMessagingHosts'),
      },
      {
        name: 'brave',
        manifestPath: join(appData, 'BraveSoftware/Brave-Browser/User Data/NativeMessagingHosts'),
      },
      {
        name: 'edge',
        manifestPath: join(appData, 'Microsoft/Edge/User Data/NativeMessagingHosts'),
      },
    ];
  }

  throw new Error(`Unsupported platform: ${os}`);
}

function createManifest(extensionId: string, shimPath: string): object {
  return {
    name: MANIFEST_NAME,
    description: 'BMaestro Bookmark Sync Native Host',
    path: shimPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
}

function install(extensionIds: Record<string, string>): void {
  const configs = getBrowserConfigs();
  const shimPath = join(__dirname, 'shim.js');

  // Make shim executable on Unix
  if (platform() !== 'win32') {
    try {
      chmodSync(shimPath, 0o755);
    } catch {
      // Ignore if already executable
    }
  }

  for (const config of configs) {
    const extensionId = extensionIds[config.name];
    if (!extensionId) {
      console.log(`Skipping ${config.name} - no extension ID provided`);
      continue;
    }

    const manifest = createManifest(extensionId, shimPath);
    const manifestPath = join(config.manifestPath, `${MANIFEST_NAME}.json`);

    try {
      mkdirSync(config.manifestPath, { recursive: true });
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      console.log(`Installed native host manifest for ${config.name}: ${manifestPath}`);
    } catch (err) {
      console.error(`Failed to install manifest for ${config.name}:`, err);
    }
  }
}

// Run if called directly
const args = process.argv.slice(2);
if (args.length > 0) {
  // Expect format: --chrome=EXTENSION_ID --brave=EXTENSION_ID --edge=EXTENSION_ID
  const extensionIds: Record<string, string> = {};

  for (const arg of args) {
    const match = arg.match(/^--(\w+)=(.+)$/);
    if (match) {
      extensionIds[match[1]] = match[2];
    }
  }

  if (Object.keys(extensionIds).length === 0) {
    console.log('Usage: bmaestro-install --chrome=EXTENSION_ID --brave=EXTENSION_ID --edge=EXTENSION_ID');
    process.exit(1);
  }

  install(extensionIds);
}

export { install, MANIFEST_NAME };

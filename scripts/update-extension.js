#!/usr/bin/env node
// scripts/update-extension.js
// Downloads latest extension from cloud and extracts to dist folder

import { execSync } from 'child_process';
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const EXTENSION_DIR = join(ROOT, 'packages', 'extension');
const DIST_DIR = join(EXTENSION_DIR, 'dist');
const TEMP_ZIP = join(ROOT, '.temp-extension.zip');

const CLOUD_URL = 'https://bmaestro-sync.fly.dev';

async function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ ok: res.statusCode === 200, data, status: res.statusCode }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      file.close();
      reject(err);
    });
  });
}

async function main() {
  console.log('🔍 Checking for updates...\n');

  // Get current local version
  let localVersion = '0.0.0';
  try {
    const manifest = await import(join(DIST_DIR, 'manifest.json'), { assert: { type: 'json' } });
    localVersion = manifest.default.version;
  } catch {
    // No local dist, will need to download
  }

  // Get cloud version
  const versionRes = await fetch(`${CLOUD_URL}/version`);
  if (!versionRes.ok) {
    console.error('❌ Failed to check version:', versionRes.status);
    process.exit(1);
  }

  const { version: cloudVersion } = JSON.parse(versionRes.data);

  console.log(`   Local version:  ${localVersion || 'not installed'}`);
  console.log(`   Cloud version:  ${cloudVersion}\n`);

  if (localVersion === cloudVersion) {
    console.log('✅ Already up to date!\n');
    console.log('   To reload in browser: chrome://extensions → BMaestro → 🔄 reload icon');
    return;
  }

  console.log('📥 Downloading update...');

  // Download zip
  await downloadFile(`${CLOUD_URL}/download/extension.zip`, TEMP_ZIP);

  // Clear existing dist
  if (existsSync(DIST_DIR)) {
    rmSync(DIST_DIR, { recursive: true });
  }
  mkdirSync(DIST_DIR, { recursive: true });

  // Extract zip
  console.log('📦 Extracting...');
  execSync(`unzip -q "${TEMP_ZIP}" -d "${DIST_DIR}"`);

  // Cleanup
  rmSync(TEMP_ZIP);

  console.log(`\n✅ Updated to v${cloudVersion}!\n`);
  console.log('   To apply: chrome://extensions → BMaestro → click 🔄 reload icon');
  console.log('   Or press Ctrl+R while focused on the extension details page\n');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});

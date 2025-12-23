import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background.ts'),
        popup: resolve(__dirname, 'src/popup.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        format: 'es',
      },
    },
    target: 'esnext',
    minify: false,
    sourcemap: true,
  },
  resolve: {
    alias: {
      crypto: 'crypto-browserify',
      buffer: 'buffer',
      stream: 'stream-browserify',
      events: 'events',
      vm: 'vm-browserify',
    },
  },
  define: {
    'global': 'globalThis',
    'process.env': '{}',
    'process.browser': 'true',
    'process.version': '"v20.0.0"',
    'process.versions': '{}',
    'process.platform': '"browser"',
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },
  plugins: [
    {
      name: 'copy-extension-files',
      closeBundle() {
        // Copy manifest and static files
        copyFileSync('manifest.json', 'dist/manifest.json');
        copyFileSync('popup.html', 'dist/popup.html');
        copyFileSync('src/popup.css', 'dist/popup.css');

        // Create icons directory and copy icons
        mkdirSync('dist/icons', { recursive: true });
        const iconSizes = ['16', '48', '128'];
        for (const size of iconSizes) {
          const src = `src/icons/icon${size}.png`;
          const dest = `dist/icons/icon${size}.png`;
          if (existsSync(src)) {
            copyFileSync(src, dest);
          }
        }
      },
    },
  ],
});

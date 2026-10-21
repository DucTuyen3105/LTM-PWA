import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export default defineConfig({
  server: { host: '0.0.0.0', port: 3000, strictPort: true },
  preview: { host: '0.0.0.0', port: 3000, strictPort: true },
  build: { sourcemap: true },
  plugins: [{
    name: 'precache-offline-app',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const template = readFileSync(new URL('./service-worker.js', import.meta.url), 'utf8');
        const files = Object.values(bundle).filter(file => !file.fileName.endsWith('.map'));
        const urls = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', ...files.map(file => `/${file.fileName}`)];
        const hash = createHash('sha256').update(template);
        for (const file of files) hash.update(file.type === 'chunk' ? file.code : file.source);
        const source = template
          .replace('__CACHE_VERSION__', JSON.stringify(`sync-lab-vanilla-${hash.digest('hex').slice(0, 12)}`))
          .replace('__PRECACHE_URLS__', JSON.stringify(urls));
        this.emitFile({ type: 'asset', fileName: 'sw.js', source });
      },
    },
  }],
});

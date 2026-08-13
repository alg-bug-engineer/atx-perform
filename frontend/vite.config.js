import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function attachDataMiddleware(middlewares) {
  middlewares.use((req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/data/')) return next();
    const file = path.join(repoRoot, decodeURIComponent(url));
    if (!file.startsWith(path.join(repoRoot, 'data')) || !fs.existsSync(file)) {
      return next();
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    fs.createReadStream(file).pipe(res);
  });
}

function serveRepoData() {
  return {
    name: 'serve-repo-data',
    configureServer(server) {
      attachDataMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      attachDataMiddleware(server.middlewares);
    },
  };
}

export default defineConfig({
  plugins: [vue(), serveRepoData()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
});

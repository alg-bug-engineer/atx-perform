import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { skillSolidifyPlugin } from './plugins/skillSolidifyPlugin.js'

const root = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(root, '..')

/**
 * 把仓库 data/ 挂到 /data/：3D 幕（MapRuntime / scene2-cause）按 URL 取幕数据，
 * 与 @data 别名同源，保证「每幕读本地 1-*.json」这条约定在两种取数方式下都成立。
 */
function serveRepoData() {
  function attach(middlewares) {
    middlewares.use((req, res, next) => {
      const url = req.url?.split('?')[0] ?? ''
      if (!url.startsWith('/data/')) return next()
      const file = path.join(repoRoot, decodeURIComponent(url))
      if (!file.startsWith(path.join(repoRoot, 'data')) || !fs.existsSync(file)) return next()
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      fs.createReadStream(file).pipe(res)
    })
  }
  return {
    name: 'serve-repo-data',
    configureServer: (server) => attach(server.middlewares),
    configurePreviewServer: (server) => attach(server.middlewares),
  }
}

export default defineConfig({
  plugins: [vue(), serveRepoData(), skillSolidifyPlugin(repoRoot)],
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
      '@data': path.resolve(repoRoot, 'data'),
      '@assets': path.resolve(repoRoot, 'assets'),
    },
  },
  /** 只从 index.html 出发：act1.html 是另一套实现的旧入口，不参与本应用构建 */
  optimizeDeps: {
    entries: ['index.html'],
  },
  build: {
    rollupOptions: {
      input: path.resolve(root, 'index.html'),
    },
  },
  server: {
    port: 5174,
    fs: {
      allow: [repoRoot],
    },
  },
})

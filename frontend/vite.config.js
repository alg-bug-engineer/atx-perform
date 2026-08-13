import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { skillSolidifyPlugin } from './plugins/skillSolidifyPlugin.js'

const root = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(root, '..')

export default defineConfig({
  plugins: [vue(), skillSolidifyPlugin(repoRoot)],
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
      '@data': path.resolve(repoRoot, 'data'),
      '@assets': path.resolve(repoRoot, 'assets'),
    },
  },
  /**
   * 只从 index.html 出发扫描依赖：仓库里另一套 three.js 实现（src/features/**、act1.html）
   * 作为逻辑参考保留，不参与本应用构建，也不应拖入 three 等未安装依赖。
   */
  optimizeDeps: {
    entries: ['index.html'],
  },
  /** public/ 是另一套实现的地图底图（25 MB），不进本应用产物 */
  publicDir: 'static',
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

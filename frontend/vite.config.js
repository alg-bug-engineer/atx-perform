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
  server: {
    port: 5174,
    fs: {
      allow: [repoRoot],
    },
  },
})

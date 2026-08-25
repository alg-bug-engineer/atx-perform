/**
 * 幕数据网关：从 FastAPI /api/v1/scenes 取数。
 * 默认关闭（VITE_SCENE_API !== '1'），前端仍走 @data 打包，演示不依赖后端。
 * 打开后页面不得再 import 仓库 data/ 或 fetch('/data/1-*.json')。
 */
import { getJSON, isApiError } from '../api/client.js'

const sceneCache = new Map()
const sceneLoading = new Map()

export function isSceneApiEnabled() {
  return import.meta.env.VITE_SCENE_API === '1'
}

/**
 * @param {string} sceneKey
 * @returns {Promise<Record<string, unknown>>}
 */
export async function loadSceneFromApi(sceneKey) {
  const key = String(sceneKey)
  if (sceneCache.has(key)) return sceneCache.get(key)
  if (sceneLoading.has(key)) return sceneLoading.get(key)

  const loading = getJSON(`/scenes/${key}`)
    .then((res) => {
      if (isApiError(res)) {
        throw new Error(res.reason || `scene_${key}_failed`)
      }
      const datasets = res.datasets || {}
      sceneCache.set(key, datasets)
      return datasets
    })
    .finally(() => sceneLoading.delete(key))

  sceneLoading.set(key, loading)
  return loading
}

/**
 * @param {string[]} names
 * @returns {Promise<Record<string, unknown>>}
 */
export async function loadSceneBundleFromApi(names) {
  const res = await getJSON('/scenes/bundle', { names: names.join(',') })
  if (isApiError(res)) {
    throw new Error(res.reason || 'scene_bundle_failed')
  }
  return res.datasets || {}
}

/**
 * Scene 组件挂载前调用；Mock 模式不发请求。
 * @param {string} sceneKey
 * @returns {Promise<Record<string, unknown>|null>}
 */
export async function preloadSceneData(sceneKey) {
  if (!isSceneApiEnabled()) return null
  return loadSceneFromApi(sceneKey)
}

export function clearSceneDataCache() {
  sceneCache.clear()
  sceneLoading.clear()
}

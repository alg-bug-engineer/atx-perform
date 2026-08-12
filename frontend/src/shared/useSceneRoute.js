import { computed, ref, watch } from 'vue'
import { DEFAULT_SCENE_KEY, SCENE_QUERY_KEY } from './constants.js'
import { resolveSceneKey } from './scene-registry.js'

function readSceneFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return resolveSceneKey(params.get(SCENE_QUERY_KEY)) || DEFAULT_SCENE_KEY
}

function writeSceneToUrl(key) {
  const url = new URL(window.location.href)
  url.searchParams.set(SCENE_QUERY_KEY, key)
  window.history.replaceState({}, '', url)
}

/** 模块级单例，保证分幕组件与 AppShell 共享同一路由状态 */
const activeSceneKey = ref(
  typeof window !== 'undefined' ? readSceneFromUrl() : DEFAULT_SCENE_KEY,
)

let listenersBound = false

function bindListeners() {
  if (listenersBound || typeof window === 'undefined') return
  listenersBound = true
  window.addEventListener('popstate', () => {
    activeSceneKey.value = readSceneFromUrl()
  })
  writeSceneToUrl(activeSceneKey.value)
  watch(activeSceneKey, (key) => writeSceneToUrl(key))
}

/**
 * 独立调试路由：?scene=0..5（或别名 plan/effect/skill）
 * 切换幕只改 URL + 当前 key，不依赖上一幕运行时状态。
 */
export function useSceneRoute() {
  bindListeners()

  function setScene(key) {
    const resolved = resolveSceneKey(key) || DEFAULT_SCENE_KEY
    activeSceneKey.value = resolved
  }

  return {
    activeSceneKey: computed(() => activeSceneKey.value),
    setScene,
  }
}

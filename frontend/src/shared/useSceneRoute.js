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

/**
 * 独立调试路由：?scene=0..5（或别名 plan/effect/skill）
 * 切换幕只改 URL + 当前 key，不依赖上一幕运行时状态。
 */
export function useSceneRoute() {
  const activeSceneKey = ref(readSceneFromUrl())

  function setScene(key) {
    const resolved = resolveSceneKey(key) || DEFAULT_SCENE_KEY
    activeSceneKey.value = resolved
    writeSceneToUrl(resolved)
  }

  function onPopState() {
    activeSceneKey.value = readSceneFromUrl()
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('popstate', onPopState)
    // 首次进入时规范化 URL
    writeSceneToUrl(activeSceneKey.value)
  }

  watch(activeSceneKey, (key) => writeSceneToUrl(key))

  return {
    activeSceneKey: computed(() => activeSceneKey.value),
    setScene,
  }
}

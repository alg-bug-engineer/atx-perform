import { computed, ref, watch } from 'vue'
import { gateActAdvance, resetPlaybackPause } from './act-playback.js'
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

  function commitScene(key) {
    activeSceneKey.value = resolveSceneKey(key) || DEFAULT_SCENE_KEY
  }

  /** 手动切幕（步骤栏 / 按钮 / ← →）：立刻跳转，并清掉空格暂停挂起 */
  function setScene(key) {
    const resolved = resolveSceneKey(key) || DEFAULT_SCENE_KEY
    if (resolved !== activeSceneKey.value) resetPlaybackPause()
    commitScene(resolved)
  }

  /**
   * 本幕演完后的自动交棒：若已按空格请求暂停，则停在当前幕，再按空格才进入下一幕。
   * 对齐 agent-loop `gateActAdvance`。
   */
  function advanceScene(key) {
    const resolved = resolveSceneKey(key) || DEFAULT_SCENE_KEY
    gateActAdvance({
      nextAct: resolved,
      apply: () => commitScene(resolved),
    })
  }

  return {
    activeSceneKey: computed(() => activeSceneKey.value),
    setScene,
    advanceScene,
  }
}

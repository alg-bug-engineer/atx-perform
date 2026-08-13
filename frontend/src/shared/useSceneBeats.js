import { onBeforeUnmount, ref } from 'vue'

/** 自动化/降低动效环境：直接落到终态，便于截图与回归 */
export function prefersInstant() {
  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const automation = typeof navigator !== 'undefined' && navigator.webdriver === true
  return Boolean(reduced || automation)
}

/**
 * 幕内节拍时间轴：对齐另一套实现里 act 的 mapBeat 推进方式，
 * 把「扫描 → 告警 → 拉近」这类分镜从组件里抽出来，便于与播报对齐。
 *
 * @param {Array<{ id: string, ms?: number }>} beats
 * @param {{ instant?: boolean, defaultMs?: number, onBeat?: (id: string) => void }} options
 */
export function useSceneBeats(beats, options = {}) {
  const { instant = false, defaultMs = 1600, onBeat } = options

  const current = ref(null)
  const index = ref(-1)
  const done = ref(false)
  const seen = ref(new Set())
  let timer = null

  function stop() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function enter(i) {
    index.value = i
    current.value = beats[i].id
    seen.value = new Set([...seen.value, beats[i].id])
    onBeat?.(beats[i].id)
  }

  function step() {
    const next = index.value + 1
    if (next >= beats.length) {
      done.value = true
      return
    }
    enter(next)
    timer = setTimeout(step, beats[next].ms || defaultMs)
  }

  function start() {
    stop()
    done.value = false
    seen.value = new Set()
    if (!beats.length) {
      done.value = true
      return
    }
    if (instant) {
      beats.forEach((b, i) => {
        if (i < beats.length - 1) {
          seen.value = new Set([...seen.value, b.id])
          onBeat?.(b.id)
        }
      })
      enter(beats.length - 1)
      done.value = true
      return
    }
    index.value = -1
    step()
  }

  /** 某节拍是否已经到达（用于“到了这一拍就一直显示”的元素） */
  function reached(id) {
    return seen.value.has(id)
  }

  onBeforeUnmount(stop)

  return { current, index, done, start, stop, reached }
}

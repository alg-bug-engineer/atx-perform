import { reactive, ref } from 'vue'

/** 当前正在播报的条目 */
export const currentBroadcast = ref(null)

/** 待播报队列（FIFO） */
export const broadcastQueue = reactive([])

/** 全局静音开关（点击头像关闭/开启） */
export const broadcastMuted = ref(false)

/** true = 正在播报或队列非空 */
export const broadcastBusy = ref(false)

const idleCallbacks = []

/**
 * 等当前所有排队/正在播报的内容全部结束后执行。
 * @returns {() => void} cancel
 */
export function afterBroadcastDone(cb) {
  let active = true
  const wrapped = () => {
    if (active) cb()
  }
  if (!broadcastBusy.value && broadcastQueue.length === 0) {
    Promise.resolve().then(wrapped)
  } else {
    idleCallbacks.push(wrapped)
  }
  return () => {
    active = false
  }
}

export function _notifyBroadcastStart() {
  broadcastBusy.value = true
}

export function _notifyBroadcastEnd() {
  if (broadcastQueue.length > 0) return
  broadcastBusy.value = false
  const cbs = idleCallbacks.splice(0)
  cbs.forEach((fn) => fn())
}

/**
 * 触发一条播报。
 * @param {string} key
 * @param {string} text
 * @param {{ audioUrl?: string, durationSec?: number }} [opts]
 */
export function triggerBroadcast(key, text, opts = {}) {
  broadcastQueue.push({
    key,
    text,
    audioUrl: opts.audioUrl || '',
    durationSec: opts.durationSec || 0,
    ts: Date.now(),
  })
}

/** 清空队列并打断当前条目（由 DigitalAvatar cancel 配合） */
export function clearBroadcastQueue() {
  broadcastQueue.splice(0, broadcastQueue.length)
}

/**
 * 本地预合成 WAV 播放（幕 3/4/5 讲解）。
 * 数据固定，不走实时 TTS WebSocket，避免演示时依赖外网。
 */

let currentAudio = null

/**
 * @param {string} audioUrl
 * @param {object} [options]
 * @param {Function} [options.onStart]
 * @param {Function} [options.onEnd]
 * @param {number} [options.fallbackMs] - 自动播放被拦时，按此时长推进
 * @returns {() => void} cancel
 */
export function playAudio(audioUrl, { onStart, onEnd, fallbackMs = 0 } = {}) {
  stopCurrent()
  if (!audioUrl) {
    onEnd?.()
    return () => {}
  }

  let ended = false
  let fallbackTimer = null
  const finish = () => {
    if (ended) return
    ended = true
    if (fallbackTimer) clearTimeout(fallbackTimer)
    if (currentAudio === audio) currentAudio = null
    onEnd?.()
  }

  const audio = new Audio(audioUrl)
  currentAudio = audio
  audio.preload = 'auto'

  const onPlaying = () => {
    if (fallbackTimer) {
      clearTimeout(fallbackTimer)
      fallbackTimer = null
    }
    onStart?.()
  }
  const onEnded = () => finish()
  const onError = (e) => {
    console.error('[TTS] 本地音频播放失败', audioUrl, e)
    finish()
  }

  audio.addEventListener('playing', onPlaying)
  audio.addEventListener('ended', onEnded)
  audio.addEventListener('error', onError)

  const playPromise = audio.play()
  if (playPromise?.catch) {
    playPromise.catch((err) => {
      const blocked = err?.name === 'NotAllowedError'
      console.warn('[TTS] play() rejected', blocked ? '(需用户手势)' : err)
      if (blocked && fallbackMs > 0) {
        onStart?.()
        fallbackTimer = setTimeout(finish, fallbackMs)
        return
      }
      finish()
    })
  }

  return () => {
    audio.removeEventListener('playing', onPlaying)
    audio.removeEventListener('ended', onEnded)
    audio.removeEventListener('error', onError)
    if (fallbackTimer) clearTimeout(fallbackTimer)
    audio.pause()
    audio.src = ''
    if (currentAudio === audio) currentAudio = null
    finish()
  }
}

export function stopCurrent() {
  if (!currentAudio) return
  try {
    currentAudio.pause()
    currentAudio.src = ''
  } catch {
    /* ignore */
  }
  currentAudio = null
}

/**
 * 兼容 baseline speak(text) 签名：无本地文件时只回调 onEnd。
 * 本项目优先用 playAudio(url)。
 */
export function speak(text, { onStart, onEnd } = {}) {
  if (!text) {
    onEnd?.()
    return () => {}
  }
  onStart?.()
  // 无音频 URL 时按字数估时，保证字幕节奏仍可用
  const ms = Math.min(12000, Math.max(1800, String(text).length * 220))
  const t = setTimeout(() => onEnd?.(), ms)
  return () => {
    clearTimeout(t)
    onEnd?.()
  }
}

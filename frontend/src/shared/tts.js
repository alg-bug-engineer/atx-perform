/**
 * 本地预合成 WAV 播放（幕 3/4/5 讲解）。
 * 数据固定，不走实时 TTS WebSocket，避免演示时依赖外网。
 */

let currentAudio = null
let speaking = false

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
  speaking = false
  if (!currentAudio) return
  try {
    currentAudio.pause()
    currentAudio.src = ''
  } catch {
    /* ignore */
  }
  currentAudio = null
}

/** 是否仍在出声：幕间交棒（act-voice / act-timing）用它判断能否推进 */
export function isTtsPlaybackActive() {
  return speaking || Boolean(currentAudio && !currentAudio.paused && !currentAudio.ended)
}

/**
 * 兼容 baseline speak(text) 签名：无本地文件时只回调 onEnd。
 * 本项目优先用 playAudio(url)。
 */
export function speak(text, { onStart, onEnd, fallbackMs = 0 } = {}) {
  if (!text) {
    onEnd?.()
    return () => {}
  }

  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null

  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    speaking = false
    onEnd?.()
  }

  // 浏览器原生 TTS 不可用：静默按字数推进，保证字幕节奏仍可用
  if (!synth) {
    speaking = true
    onStart?.()
    const ms = Math.min(12000, Math.max(1800, String(text).length * 220))
    const t = setTimeout(finish, ms)
    return () => {
      clearTimeout(t)
      finish()
    }
  }

  const utter = new SpeechSynthesisUtterance(text)
  utter.lang = 'zh-CN'
  utter.rate = 1
  utter.pitch = 1
  // 优先选中文语音（部分浏览器首次 getVoices 为空，lang 兜底）
  const zh = (synth.getVoices() || []).find((v) => /zh|cmn|chinese/i.test(v.lang))
  if (zh) utter.voice = zh

  let fallbackTimer = null
  const done = () => {
    if (finished) return
    finished = true
    if (fallbackTimer) clearTimeout(fallbackTimer)
    speaking = false
    onEnd?.()
  }

  utter.onstart = () => {
    speaking = true
    onStart?.()
  }
  utter.onend = done
  utter.onerror = done

  // 兜底：语音卡住才放行；仍在出声则继续等，避免定时器抢断
  const estimatedMs = Math.min(28000, Math.max(2500, String(text).length * 280))
  const hardCapMs = Math.max(Number(fallbackMs) || 0, estimatedMs) + 4000
  const startedAt = Date.now()
  const armFallback = () => {
    fallbackTimer = setTimeout(() => {
      if (finished) return
      if ((synth.speaking || synth.pending) && Date.now() - startedAt < hardCapMs) {
        armFallback()
        return
      }
      done()
    }, 500)
  }
  armFallback()

  synth.speak(utter)

  return () => {
    done()
    try { synth.cancel() } catch { /* ignore */ }
  }
}

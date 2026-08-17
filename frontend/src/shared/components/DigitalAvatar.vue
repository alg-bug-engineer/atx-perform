<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import avatarImage from '../../assets/digital_avatar_officer_male.png'
import {
  _notifyBroadcastEnd,
  _notifyBroadcastStart,
  broadcastFrozen,
  broadcastInterruptSeq,
  broadcastMuted,
  broadcastQueue,
} from '../broadcast-bus.js'
import { playAudio, speak } from '../tts.js'
import { playSceneNarration, sceneHasNarration } from '../sceneNarration.js'
import { useSceneRoute } from '../useSceneRoute.js'

const { activeSceneKey } = useSceneRoute()

const isSpeaking = ref(false)
const displayText = ref('')
const typeText = ref('')
const isProcessing = ref(false)
const showMuteHint = ref(false)

let typeTimer = null
let cancelCurrentSpeak = null
let endTimer = null
let speakGeneration = 0

function runTypewriter(text) {
  typeText.value = ''
  let idx = 0
  clearInterval(typeTimer)
  typeTimer = setInterval(() => {
    idx += 1
    typeText.value = text.slice(0, idx)
    if (idx >= text.length) clearInterval(typeTimer)
  }, 48)
}

function hardStopSpeaking({ notifyEnd = true } = {}) {
  speakGeneration += 1
  cancelCurrentSpeak?.()
  cancelCurrentSpeak = null
  clearTimeout(endTimer)
  clearInterval(typeTimer)
  endTimer = null
  isSpeaking.value = false
  isProcessing.value = false
  displayText.value = ''
  typeText.value = ''
  if (notifyEnd) _notifyBroadcastEnd()
}

async function processNext() {
  if (broadcastFrozen.value) return
  if (isProcessing.value || broadcastQueue.length === 0) return
  isProcessing.value = true
  _notifyBroadcastStart()

  const item = broadcastQueue.shift()
  if (!item) {
    isProcessing.value = false
    _notifyBroadcastEnd()
    return
  }

  displayText.value = item.text
  isSpeaking.value = true
  clearTimeout(endTimer)
  runTypewriter(item.text)

  const gen = ++speakGeneration

  if (!broadcastMuted.value) {
    const player = item.audioUrl
      ? (opts) => playAudio(item.audioUrl, opts)
      : (opts) => speak(item.text, opts)

    let finished = false
    const finishItem = () => {
      if (finished || gen !== speakGeneration || broadcastFrozen.value) return
      finished = true
      clearTimeout(endTimer)
      isSpeaking.value = false
      isProcessing.value = false
      _notifyBroadcastEnd()
      endTimer = setTimeout(() => {
        if (gen !== speakGeneration || broadcastFrozen.value) return
        displayText.value = ''
        typeText.value = ''
        processNext()
      }, 900)
    }

    cancelCurrentSpeak = player({
      onStart: () => {
        isSpeaking.value = true
      },
      onEnd: finishItem,
      fallbackMs: item.durationSec ? Math.round(item.durationSec * 1000) : Math.max(2000, (item.text?.length || 20) * 220),
    })
  } else {
    const hold = Math.min(3200, Math.max(1600, (item.text?.length || 20) * 40))
    endTimer = setTimeout(() => {
      if (gen !== speakGeneration || broadcastFrozen.value) return
      isSpeaking.value = false
      isProcessing.value = false
      displayText.value = ''
      typeText.value = ''
      _notifyBroadcastEnd()
      processNext()
    }, hold)
  }
}

watch(
  () => broadcastQueue.length,
  (len) => {
    if (len > 0 && !isProcessing.value && !broadcastFrozen.value) processNext()
  },
)

watch(broadcastInterruptSeq, () => {
  hardStopSpeaking()
  if (!broadcastFrozen.value && broadcastQueue.length > 0) setTimeout(processNext, 0)
})

watch(broadcastFrozen, (frozen) => {
  if (frozen) {
    hardStopSpeaking()
    return
  }
  if (broadcastQueue.length > 0 && !isProcessing.value) processNext()
})

onMounted(() => {
  if (broadcastQueue.length > 0 && !isProcessing.value) processNext()
})

function toggleMute() {
  const turningOn = broadcastMuted.value
  broadcastMuted.value = !broadcastMuted.value
  if (broadcastMuted.value && isSpeaking.value) {
    hardStopSpeaking()
    if (broadcastQueue.length > 0 && !broadcastFrozen.value) setTimeout(processNext, 0)
  } else if (turningOn && sceneHasNarration(activeSceneKey.value)) {
    // 用户手势开启播报：重播当前幕（解锁浏览器自动播放限制）
    playSceneNarration(activeSceneKey.value)
  }
}

onUnmounted(() => {
  clearTimeout(endTimer)
  clearInterval(typeTimer)
  cancelCurrentSpeak?.()
})
</script>

<template>
  <div class="da-wrap" :class="{ speaking: isSpeaking, muted: broadcastMuted }">
    <div
      class="da-avatar"
      :class="{ speaking: isSpeaking, muted: broadcastMuted }"
      :title="broadcastMuted ? '点击开启语音播报' : '点击关闭语音播报'"
      @click="toggleMute"
      @mouseenter="showMuteHint = true"
      @mouseleave="showMuteHint = false"
    >
      <div class="da-ring r1" :class="{ active: isSpeaking && !broadcastMuted }" />
      <div class="da-ring r2" :class="{ active: isSpeaking && !broadcastMuted }" />
      <img class="da-officer-image" :src="avatarImage" alt="讲解员" />
      <transition name="hint-fade">
        <div v-if="showMuteHint" class="da-hover-hint">
          <svg v-if="!broadcastMuted" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 5L6 9H2v6h4l5 4V5z" />
            <line x1="23" y1="9" x2="17" y2="15" stroke-linecap="round" />
            <line x1="17" y1="9" x2="23" y2="15" stroke-linecap="round" />
          </svg>
          <svg v-else viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 5L6 9H2v6h4l5 4V5z" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          </svg>
        </div>
      </transition>
    </div>

    <transition name="caption-slide">
      <div v-if="(isSpeaking || typeText) && !broadcastMuted" class="da-caption">
        <span class="da-caption-text">{{ typeText }}</span>
        <span v-if="isSpeaking" class="da-cursor">|</span>
      </div>
    </transition>

    <transition name="badge-pop">
      <div v-if="broadcastMuted" class="da-mute-badge" title="语音已关闭">
        <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M7 3.5L4 6H1.5v4H4l3 2.5V3.5z" />
          <line x1="14" y1="5.5" x2="10" y2="9.5" stroke-linecap="round" />
          <line x1="10" y1="5.5" x2="14" y2="9.5" stroke-linecap="round" />
        </svg>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.da-wrap {
  position: fixed;
  left: 24px;
  bottom: 24px;
  z-index: 100;
  display: flex;
  align-items: flex-end;
  gap: 10px;
  pointer-events: none;
  transition: opacity 0.3s;
  opacity: 0.55;
}
.da-wrap.speaking { opacity: 1; }
.da-wrap.muted { opacity: 0.45; }

.da-avatar {
  position: relative;
  width: 58px;
  height: 58px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 12, 24, 0.78);
  border: 1px solid rgba(0, 229, 255, 0.4);
  border-radius: 50%;
  overflow: hidden;
  transition: border-color 0.3s, transform 0.3s, box-shadow 0.3s, opacity 0.3s;
  flex-shrink: 0;
  pointer-events: auto;
  cursor: pointer;
  user-select: none;
}
.da-avatar:hover {
  border-color: rgba(0, 229, 255, 0.7);
  box-shadow: 0 0 12px rgba(0, 229, 255, 0.25);
  transform: scale(1.05);
}
.da-avatar:active { transform: scale(0.97); }
.da-avatar.speaking {
  border-color: rgba(0, 229, 255, 0.9);
  transform: scale(1.08);
  box-shadow: 0 0 18px rgba(0, 229, 255, 0.35);
}
.da-avatar.muted {
  border-color: rgba(180, 60, 60, 0.5);
  box-shadow: none;
}
.da-avatar.muted:hover {
  border-color: rgba(220, 80, 80, 0.75);
  box-shadow: 0 0 10px rgba(200, 60, 60, 0.25);
}

.da-hover-hint {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: rgba(0, 8, 18, 0.62);
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(0, 229, 255, 0.95);
  z-index: 2;
  backdrop-filter: blur(1px);
}
.da-avatar.muted .da-hover-hint { color: rgba(100, 220, 140, 0.95); }
.hint-fade-enter-active,
.hint-fade-leave-active { transition: opacity 0.18s ease; }
.hint-fade-enter-from,
.hint-fade-leave-to { opacity: 0; }

.da-officer-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 18%;
  filter: drop-shadow(0 0 5px rgba(0, 229, 255, 0.25));
  user-select: none;
  pointer-events: none;
}

.da-ring {
  position: absolute;
  top: 50%;
  left: 50%;
  border-radius: 50%;
  border: 1px solid rgba(0, 229, 255, 0.22);
  pointer-events: none;
  opacity: 0;
}
.r1 { width: 72px; height: 72px; margin-top: -36px; margin-left: -36px; }
.r2 { width: 86px; height: 86px; margin-top: -43px; margin-left: -43px; border-color: rgba(0, 229, 255, 0.12); }
.r1.active { animation: ring-pulse 1.8s ease-in-out infinite; }
.r2.active { animation: ring-pulse 1.8s ease-in-out infinite 0.4s; }
@keyframes ring-pulse {
  0%, 100% { transform: scale(1); opacity: 0.6; }
  50% { transform: scale(1.06); opacity: 1; }
}

.da-caption {
  max-width: min(420px, 42vw);
  background: rgba(0, 12, 24, 0.88);
  border: 1px solid rgba(0, 229, 255, 0.45);
  padding: 8px 12px;
  border-left: 2px solid rgba(0, 229, 255, 0.85);
}
.da-caption-text {
  font-size: 13px;
  color: rgba(220, 240, 255, 0.92);
  font-family: var(--font-mono, 'Courier New', monospace);
  letter-spacing: 0.3px;
  line-height: 1.55;
  word-break: break-word;
}
.da-cursor {
  display: inline-block;
  color: var(--cyan, #00e5ff);
  font-weight: bold;
  animation: blink-cursor 0.65s step-end infinite;
  margin-left: 1px;
}
@keyframes blink-cursor {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.caption-slide-enter-active {
  transition: opacity 0.25s ease, transform 0.25s ease, max-width 0.25s ease;
}
.caption-slide-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease, max-width 0.3s ease;
}
.caption-slide-enter-from,
.caption-slide-leave-to {
  opacity: 0;
  transform: translateX(-8px);
  max-width: 0;
}

.da-mute-badge {
  position: absolute;
  top: -2px;
  left: 42px;
  width: 17px;
  height: 17px;
  background: rgba(200, 50, 40, 0.9);
  border: 1px solid rgba(255, 100, 80, 0.6);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  pointer-events: none;
  box-shadow: 0 0 6px rgba(200, 50, 40, 0.45);
}
.badge-pop-enter-active {
  transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.badge-pop-leave-active { transition: opacity 0.15s ease, transform 0.15s ease; }
.badge-pop-enter-from,
.badge-pop-leave-to { opacity: 0; transform: scale(0.4); }
</style>

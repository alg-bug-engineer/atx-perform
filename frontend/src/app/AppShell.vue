<script setup>
import { computed, defineAsyncComponent, onMounted, onUnmounted, watch } from 'vue'
import { sceneRegistry, getSceneByKey } from '../shared/scene-registry.js'
import { useSceneRoute } from '../shared/useSceneRoute.js'
import { playSceneNarration, narrateBeat } from '../shared/sceneNarration.js'
import { broadcastSilent } from '../shared/broadcast-bus.js'
import { narrativeActive, narrativeState } from '../shared/narrative-state.js'
import { onBeatChanged } from '../shared/act-voice.js'
import {
  conclusionSpaceWaitActive,
  isTypingTarget,
  playbackHint,
  resetPlaybackPause,
  toggleSpacePlayback,
} from '../shared/act-playback.js'
import DigitalAvatar from '../shared/components/DigitalAvatar.vue'
import AppChrome from './AppChrome.vue'

const { activeSceneKey, setScene } = useSceneRoute()

const activeScene = computed(() => getSceneByKey(activeSceneKey.value))
const activeSceneComponent = computed(() =>
  defineAsyncComponent(activeScene.value.component),
)

watch(activeSceneKey, (key) => {
  document.title = `济南交管支队信控智能体 · ${getSceneByKey(key).name}`
  playSceneNarration(key)
}, { immediate: true })

// 叙事口播：幕内 beat 变化 → act-voice 词槽填充 → 入队播报
// （原 ActLoopShell 随废弃的 MainLayout 不再挂载，此处补回该职责）
watch(
  () => narrativeState.beatId,
  (beatId, prev) => {
    if (!beatId || beatId === prev) return
    // 幕 1（a1.* / a2.*）已改由指挥家时间轴分段 WAV 播报，跳过逐句 speechSynthesis
    if (/^a[12]\./.test(beatId)) return
    // 幕 3 成因分析（a2f.*）走预合成 WAV 统一音色；文档未收录的拍保持静默，不回退女声
    if (/^a2f\./.test(beatId)) {
      narrateBeat(beatId)
      return
    }
    onBeatChanged(beatId)
  },
)

// 空格暂停：按一次 → 本幕演完停在幕间栅栏不自动跳转；再按一次恢复
function onKeydown(e) {
  if (e.code !== 'Space' && e.key !== ' ') return
  if (e.repeat) return
  if (e.altKey || e.ctrlKey || e.metaKey) return
  if (!narrativeActive.value) return
  if (isTypingTarget(e.target)) return
  if (conclusionSpaceWaitActive.value) return
  e.preventDefault()
  toggleSpacePlayback()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  resetPlaybackPause()
})
</script>

<template>
  <div class="shell">
    <AppChrome
      :scenes="sceneRegistry"
      :active-key="activeSceneKey"
      @change="setScene"
    />

    <main class="viewport">
      <component
        :is="activeSceneComponent"
        :key="activeScene.key"
      />
    </main>

    <!-- 数字人 / 口播字幕：默认关闭，避免卡住面板揭示顺序；VITE_TTS_ENABLED=true 时再挂上 -->
    <DigitalAvatar v-if="!broadcastSilent" />

  </div>
</template>

<style scoped>
.shell {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background:
    radial-gradient(ellipse at 20% 0%, rgba(0, 80, 120, 0.35), transparent 55%),
    var(--bg);
}

.viewport {
  position: absolute;
  top: var(--app-chrome-h);
  right: 0;
  bottom: 0;
  left: 0;
}

.pause-hint {
  position: absolute;
  left: 50%;
  bottom: 148px;
  transform: translateX(-50%);
  z-index: 95;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  font-size: 13px;
  letter-spacing: 1px;
  color: var(--cyan);
  background: rgba(4, 12, 30, 0.88);
  border: 1px solid var(--cyan-border);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}

.ph-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--cyan);
  animation: ph-blink 1.1s ease-in-out infinite;
}

@keyframes ph-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

.hint-fade-enter-active,
.hint-fade-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.hint-fade-enter-from,
.hint-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(6px);
}
</style>

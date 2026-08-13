<script setup>
import { computed, defineAsyncComponent, watch } from 'vue'
import { sceneRegistry, getSceneByKey } from '../shared/scene-registry.js'
import { useSceneRoute } from '../shared/useSceneRoute.js'
import { playSceneNarration } from '../shared/sceneNarration.js'
import { broadcastSilent } from '../shared/broadcast-bus.js'
import DigitalAvatar from '../shared/components/DigitalAvatar.vue'
import AppChrome from './AppChrome.vue'

const { activeSceneKey, setScene } = useSceneRoute()

const activeScene = computed(() => getSceneByKey(activeSceneKey.value))
const activeSceneComponent = computed(() =>
  defineAsyncComponent(activeScene.value.component),
)

watch(activeSceneKey, (key) => {
  document.title = `奥体西绩效可视化 · ${getSceneByKey(key).name}`
  playSceneNarration(key)
}, { immediate: true })
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
</style>

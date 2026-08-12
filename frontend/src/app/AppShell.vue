<script setup>
import { computed, defineAsyncComponent, watch } from 'vue'
import { sceneRegistry, getSceneByKey } from '../shared/scene-registry.js'
import { useSceneRoute } from '../shared/useSceneRoute.js'
import SceneSwitcher from './SceneSwitcher.vue'

const { activeSceneKey, setScene } = useSceneRoute()

const activeScene = computed(() => getSceneByKey(activeSceneKey.value))
const activeSceneComponent = computed(() =>
  defineAsyncComponent(activeScene.value.component),
)

watch(activeSceneKey, (key) => {
  document.title = `atx-perform · ${getSceneByKey(key).name}`
}, { immediate: true })
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <span class="eyebrow">ATX-PERFORM</span>
        <h1>奥体西绩效可视化</h1>
      </div>
      <div class="scene-meta">
        <span class="badge">SCENE {{ activeScene.key }}</span>
        <span class="name">{{ activeScene.name }}</span>
        <span class="hint">{{ activeScene.ownerHint }}</span>
      </div>
      <div class="debug-tip">
        独立调试：<code>?scene=0..5</code>
        或 <code>plan</code> / <code>effect</code> / <code>skill</code>
      </div>
    </header>

    <main class="viewport">
      <component
        :is="activeSceneComponent"
        :key="activeScene.key"
      />
    </main>

    <SceneSwitcher
      :scenes="sceneRegistry"
      :active-key="activeSceneKey"
      @change="setScene"
    />
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

.topbar {
  position: absolute;
  inset: 0 0 auto 0;
  z-index: 30;
  display: grid;
  grid-template-columns: 1.2fr 1.4fr 1fr;
  gap: 16px;
  align-items: end;
  padding: 16px 20px 12px;
  pointer-events: none;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.55), transparent);
}

.brand h1 {
  margin: 4px 0 0;
  font-size: 18px;
  font-weight: 500;
  letter-spacing: 1px;
  color: var(--cyan);
}

.eyebrow,
.badge {
  color: var(--cyan-dim);
  font-size: 11px;
  letter-spacing: 2px;
}

.scene-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  align-items: baseline;
}

.scene-meta .name {
  color: var(--text);
  font-size: 16px;
}

.scene-meta .hint,
.debug-tip {
  color: var(--text-muted);
  font-size: 11px;
}

.debug-tip {
  text-align: right;
}

.debug-tip code {
  color: var(--cyan-dim);
}

.viewport {
  position: absolute;
  inset: 0;
}
</style>

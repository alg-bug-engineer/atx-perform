<script setup>
/**
 * 幕 1 · 问题定位（3D）：TrafficOriginScene 走廊 + act-01 问题定位舞台。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import '../../features/acts/act-01-problem-locate/index.js'
import TrafficOriginScene from '../../features/scenes/traffic-origin/TrafficOriginScene.vue'
import ProblemLocateStage from '../../features/acts/act-01-problem-locate/ProblemLocateStage.vue'
import { narrativeActive } from '../../shared/narrative-state.js'
import { gateSceneAdvance } from '../../shared/act-playback.js'
import { useSceneRoute } from '../../shared/useSceneRoute.js'
import { SCENE_META } from './index.js'

const { setScene } = useSceneRoute()

const mapReady = ref(false)

narrativeActive.value = true

/** 幕 1 自动退出 → 门控跳转幕 2（空格暂停时停在幕间栅栏） */
function onActExit() {
  gateSceneAdvance({ nextSceneKey: '2', apply: () => setScene('2') })
}

onMounted(() => {
  // mapReady 由 TrafficOriginScene @ready 事件设置
})

onBeforeUnmount(() => {
  narrativeActive.value = false
})
</script>

<template>
  <div class="scene-3d" data-testid="scene1-problem-locate">
    <TrafficOriginScene @ready="mapReady = true" />
    <ProblemLocateStage v-if="mapReady" @exit="onActExit" />

    <div class="scene-actions">
      <span class="scene-tag">{{ SCENE_META.name }}</span>
      <button type="button" class="btn ghost" @click="setScene('0')">返回开幕</button>
      <button type="button" class="btn primary" @click="setScene('2')">分析成因</button>
    </div>
  </div>
</template>

<style scoped>
.scene-3d {
  position: absolute;
  inset: 0;
}

.scene-3d :deep(.hud),
.scene-3d :deep(.timestamp) {
  display: none;
}

/* 走廊铺满本幕视口（运行时默认写死 100vw/100vh，会顶穿步骤栏） */
.scene-3d :deep(.map-root) {
  width: 100%;
  height: 100%;
}

/* 运行时原本给自带 HUD 留的顶距，这里由步骤栏承担，收回给内容 */
.scene-3d :deep(.act-dock) {
  top: 12px;
  max-height: calc(100% - 96px);
}

.scene-actions {
  position: absolute;
  right: 20px;
  bottom: 68px;
  z-index: 42;
  display: flex;
  align-items: center;
  gap: 12px;
}

.scene-tag {
  font-size: 11px;
  letter-spacing: 3px;
  color: var(--cyan-dim);
}

.btn {
  padding: 8px 22px;
  font-size: 13px;
  letter-spacing: 2px;
  border-radius: 2px;
  cursor: pointer;
}

.btn.primary {
  color: #041020;
  background: var(--cyan);
  border: none;
}

.btn.primary:hover {
  box-shadow: 0 0 14px rgba(0, 229, 255, 0.6);
}

.btn.ghost {
  color: var(--text-muted);
  background: rgba(4, 12, 30, 0.72);
  border: 1px solid var(--cyan-border);
}

.btn.ghost:hover {
  color: var(--cyan);
  border-color: var(--cyan-border-strong);
}
</style>

<script setup>
/**
 * 幕 2 · 分析成因（3D）：MapRuntime 直接进入流量溯源演绎。
 * 节拍 trace → supply → ew_clear → arterial → signal → overflow 由 scene2-cause.js 驱动，
 * 数据读本地 data/1-2-flow-trace.json（vite serveRepoData 把仓库 data/ 挂到 /data/）。
 */
import { onBeforeUnmount } from 'vue'
import MapRuntime from '../../features/scenes/MapRuntime.vue'
import { enterIdle } from '../../shared/home-idle-state.js'
import { useSceneRoute } from '../../shared/useSceneRoute.js'
import { SCENE_META } from './index.js'

const { setScene } = useSceneRoute()

onBeforeUnmount(() => enterIdle())
</script>

<template>
  <div class="scene-3d" data-testid="scene2-cause-analysis">
    <MapRuntime initial-scene="scene2" route-mode />

    <div class="scene-actions">
      <span class="scene-tag">{{ SCENE_META.name }}</span>
      <button type="button" class="btn ghost" @click="setScene('1')">返回问题定位</button>
      <button type="button" class="btn primary" @click="setScene('3')">看优化方案</button>
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

/* 运行时原本给自带 HUD 留的顶距，这里由步骤栏承担，收回给内容 */
.scene-3d :deep(.scene2-dock) {
  top: 12px;
  max-height: calc(100% - 100px);
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

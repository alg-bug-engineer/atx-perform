<script setup>
/**
 * 幕 0 · 开幕（3D）：复用 MapRuntime 的城市监控运行时。
 * 分镜：城市扫描 → 揭示监控 → 问题路段高德式深红实色带 → 连贯拉近镜头（scene0-opening.js）。
 * 幕内不自行切幕，跳转统一交给顶部步骤栏 / ?scene= 路由。
 */
import { onBeforeUnmount } from 'vue'
import MapRuntime from '../../features/scenes/MapRuntime.vue'
import { enterIdle, openingBeat } from '../../shared/home-idle-state.js'

onBeforeUnmount(() => {
  enterIdle()
  openingBeat.value = ''
})
</script>

<template>
  <div class="scene-3d" data-testid="scene0-opening">
    <MapRuntime route-mode />
  </div>
</template>

<style scoped>
.scene-3d {
  position: absolute;
  inset: 0;
}

/* 顶部大字报与时钟由 AppChrome 统一出，隐去运行时自带的一套 */
.scene-3d :deep(.hud),
.scene-3d :deep(.timestamp) {
  display: none;
}

/* 运行时原本给自带 HUD 留的 96px 顶距，这里由步骤栏承担，收回给内容 */
.scene-3d :deep(.act-dock),
.scene-3d :deep(.metrics-dock),
.scene-3d :deep(.monitor-scan-hint) {
  top: 12px;
}

.scene-3d :deep(.act-dock),
.scene-3d :deep(.act-dock-monitor) {
  max-height: calc(100% - 84px);
}
</style>

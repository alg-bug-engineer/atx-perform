<script setup>
/**
 * 幕 0 · 开幕（3D）：复用 MapRuntime 的城市监控运行时。
 * 分镜：城市扫描 → 揭示监控 → 问题路段标红闪烁 → 连贯拉近镜头（scene0-opening.js）。
 * 幕内不自行切幕，跳转统一交给顶部步骤栏 / ?scene= 路由。
 */
import { computed, onBeforeUnmount } from 'vue'
import MapRuntime from '../../features/scenes/MapRuntime.vue'
import { enterIdle, openingBeat } from '../../shared/home-idle-state.js'
import { useSceneRoute } from '../../shared/useSceneRoute.js'
import { SCENE_META } from './index.js'

const { setScene } = useSceneRoute()

const CAPTION = {
  scan: '全域巡检：正在扫描城市路网态势',
  reveal: '锁定奥体西走廊：解放东路 → 经十路 区间告警',
  alert: '问题路段标红：奥体西路北向南持续排队',
  dive: '拉近镜头：交由问题定位继续处置',
}

const caption = computed(() => CAPTION[openingBeat.value] || CAPTION.scan)

onBeforeUnmount(() => {
  enterIdle()
  openingBeat.value = ''
})
</script>

<template>
  <div class="scene-3d" data-testid="scene0-opening">
    <MapRuntime initial-scene="idle" route-mode @enter-scene2="setScene('2')" />

    <p class="caption">{{ caption }}</p>

    <div class="scene-actions">
      <span class="scene-tag">{{ SCENE_META.name }}</span>
      <button type="button" class="btn primary" @click="setScene('1')">进入问题定位</button>
    </div>
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

.caption {
  position: absolute;
  left: 50%;
  bottom: 92px;
  transform: translateX(-50%);
  z-index: 42;
  margin: 0;
  padding: 7px 16px;
  font-size: 13px;
  letter-spacing: 1px;
  color: var(--text);
  background: rgba(4, 12, 30, 0.82);
  border-left: 2px solid var(--cyan);
  pointer-events: none;
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
</style>

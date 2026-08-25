<script setup>
/**
 * 幕 2 · 分析成因（3D 原生幕）：TrafficOriginScene 走廊 + act-02 流量溯源舞台。
 * 地图演绎由 flowTraceMapFx 在走廊里直接播放（trace → supply →
 * channel_change），不再切回首页重载。经十路东西向进口钉与绿灯约束画面已撤。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import '../../features/acts/act-02-flow-trace/index.js'
import TrafficOriginScene from '../../features/scenes/traffic-origin/TrafficOriginScene.vue'
import Act2FlowStage from '../../features/acts/act-02-flow-trace/Act2FlowStage.vue'
import { narrativeActive } from '../../shared/narrative-state.js'
import { gateSceneAdvance } from '../../shared/act-playback.js'
import { useSceneRoute } from '../../shared/useSceneRoute.js'
import { loadScene2Data, SCENE_META } from './index.js'

const { setScene } = useSceneRoute()

const datasets = ref(null)
const loadError = ref('')
/** 等地图与 flowTraceFx 就位再挂舞台，否则首拍 trace 会被丢掉 */
const mapReady = ref(false)

narrativeActive.value = true

/** 幕 2 自动退出 → 门控跳转幕 3（空格暂停时停在幕间栅栏） */
function onActExit() {
  gateSceneAdvance({ nextSceneKey: '3', apply: () => setScene('3') })
}

onMounted(async () => {
  try {
    datasets.value = await loadScene2Data()
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err)
  }
})

onBeforeUnmount(() => {
  narrativeActive.value = false
})
</script>

<template>
  <div class="scene-3d" data-testid="scene2-cause-analysis">
    <p v-if="loadError" class="scene-load-error">幕数据加载失败：{{ loadError }}</p>
    <template v-else-if="datasets">
      <TrafficOriginScene :scene-datasets="datasets" @ready="mapReady = true" />
      <Act2FlowStage v-if="mapReady" @exit="onActExit" />
    </template>

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

.scene-load-error {
  margin: 24px;
  color: #ff8b8b;
}

/* 走廊铺满本幕视口（运行时默认写死 100vw/100vh，会顶穿步骤栏） */
.scene-3d :deep(.map-root) {
  width: 100%;
  height: 100%;
}

/* 顶部大字报与时钟由 AppChrome 统一出，隐去运行时自带的一套 */
.scene-3d :deep(.hud),
.scene-3d :deep(.timestamp) {
  display: none;
}

/* 视口已在步骤栏下方；覆盖打到实际类名 .trace-dock，避免再留 92px 空档 */
.scene-3d :deep(.act-dock),
.scene-3d :deep(.scene2-dock),
.scene-3d :deep(.trace-dock) {
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

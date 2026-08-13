<script setup>
/**
 * 幕 1 · 问题定位（3D）：TrafficOriginScene 走廊 + act-01 问题定位舞台。
 * act-01 本身没有渠化（state.js 注释：'channelization' 节拍语义 = 走廊揭示），
 * 而剧本要求本幕显示双路口渠化，这里按 1-1-channelization.json 补一个渠化 dock。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
// 副作用注册 act-01：TrafficOriginScene init 时要从注册表取 createAct1/2MapFx
import '../../features/acts/act-01-problem-locate/index.js'
import TrafficOriginScene from '../../features/scenes/traffic-origin/TrafficOriginScene.vue'
import ProblemLocateStage from '../../features/acts/act-01-problem-locate/ProblemLocateStage.vue'
import { narrativeActive } from '../../shared/narrative-state.js'
import { loadSceneBundle } from '../../services/loadSceneData.js'
import { useSceneRoute } from '../../shared/useSceneRoute.js'
import IntersectionChannelization from './IntersectionChannelization.vue'
import { SCENE_META } from './index.js'

const { setScene } = useSceneRoute()

const channelization = ref(null)
const locate = ref(null)
const objects = ref(null)
const showChan = ref(true)
/** 等地图与 act-01 特效工厂就位再挂舞台，否则搜索态首拍会被丢掉 */
const mapReady = ref(false)

narrativeActive.value = true

onMounted(async () => {
  const bundle = await loadSceneBundle(['channelization', 'locate', 'objects'])
  channelization.value = bundle.channelization
  locate.value = bundle.locate
  objects.value = bundle.objects
})

onBeforeUnmount(() => {
  narrativeActive.value = false
})

function armsOf(interId) {
  return channelization.value?.by_intersection?.[interId]?.arms || []
}

function satText() {
  const s = locate.value?.jingshi_north_through_saturation?.turn_saturation
  return Number.isFinite(s) ? `北进口直行饱和度 ${s.toFixed(2)}` : '北进口直行饱和度 —'
}
</script>

<template>
  <div class="scene-3d" data-testid="scene1-problem-locate">
    <TrafficOriginScene @ready="mapReady = true" />
    <ProblemLocateStage v-if="mapReady" @exit="setScene('2')" />

    <section v-if="channelization" class="chan-dock" :class="{ folded: !showChan }">
      <header class="chan-dock-hd">
        <span>双路口渠化</span>
        <button type="button" @click="showChan = !showChan">{{ showChan ? '收起' : '展开' }}</button>
      </header>
      <div v-show="showChan" class="chan-dock-body">
        <IntersectionChannelization
          title="下游 · 奥体西路与经十路"
          :arms="armsOf(objects?.intersections?.downstream_jingshi?.inter_id || '011wwe28ctu00001')"
          highlight-dir="0"
          :tag="satText()"
        />
        <IntersectionChannelization
          title="上游 · 奥体西路与解放东路"
          :arms="armsOf(objects?.intersections?.upstream_jiefang?.inter_id || '011wwe28fmc00001')"
          highlight-dir="0"
          tag="进口饱和度库内缺值"
        />
      </div>
    </section>

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

.chan-dock {
  position: absolute;
  left: 24px;
  bottom: 60px;
  z-index: 41;
  width: 344px;
  padding: 8px 10px;
  background: rgba(6, 14, 26, 0.9);
  border: 1px solid var(--cyan-border);
  pointer-events: auto;
}

.chan-dock-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  letter-spacing: 1px;
  color: var(--cyan-dim);
}

.chan-dock-hd button {
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid var(--cyan-border);
  padding: 1px 8px;
  cursor: pointer;
}

.chan-dock-hd button:hover {
  color: var(--cyan);
}

.chan-dock-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 8px;
}

.chan-dock :deep(.chan) {
  height: 140px;
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

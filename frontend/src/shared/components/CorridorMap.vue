<script setup>
/**
 * 走廊路网底图（SVG）：按库内 geom 画真实路段，按速度派生 state 上色。
 * 幕 0 扫描/告警、幕 1 排队、幕 2 溯源都复用它，叠加内容走 default 插槽（拿到投影函数）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { collectPoints, createProjector } from '../geo.js'

const props = defineProps({
  links: { type: Array, default: () => [] },
  nodes: { type: Array, default: () => [] },
  /** 高亮/闪烁的问题路段 */
  alertId: { type: String, default: '' },
  /** 镜头：null 为全景，{ lon, lat, spanMeters } 为拉近 */
  focus: { type: Object, default: null },
  scanning: { type: Boolean, default: false },
  showLabels: { type: Boolean, default: true },
  /** 压暗非问题路段，让告警路段跳出来 */
  dimOthers: { type: Boolean, default: false },
})

/** 画布随容器变形，投影按实际宽高铺满，避免宽扁容器里地图缩成一条 */
const rootEl = ref(null)
const size = ref({ w: 1000, h: 600 })
let ro = null

onMounted(() => {
  if (!rootEl.value || typeof ResizeObserver === 'undefined') return
  ro = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect
    if (width > 0 && height > 0) size.value = { w: Math.round(width), h: Math.round(height) }
  })
  ro.observe(rootEl.value)
})

onBeforeUnmount(() => ro?.disconnect())

const W = computed(() => size.value.w)
const H = computed(() => size.value.h)

const projector = computed(() =>
  createProjector(collectPoints(props.links, props.nodes), {
    width: W.value,
    height: H.value,
    padding: Math.min(48, Math.max(16, Math.min(W.value, H.value) * 0.08)),
  }),
)

const STATE_COLOR = {
  red: '#ff4444',
  yellow: '#ffcc00',
  green: '#33cc88',
}

const drawn = computed(() =>
  props.links
    .filter((l) => l?.geom?.coordinates?.length > 1)
    .map((l) => ({
      id: l.link_id,
      d: projector.value.toPath(l.geom.coordinates),
      color: STATE_COLOR[l.color] || 'rgba(120, 165, 190, 0.45)',
      width: Math.max(3, Math.min(7, (l.lane_num || 3) * 1.2)),
      alert: l.link_id === props.alertId,
      name: l.road_name || '',
    }))
    .sort((a, b) => Number(a.alert) - Number(b.alert)),
)

/** 投影后按纵向错开标注，避免同一片区的路口名压成一团 */
const placedNodes = computed(() => {
  const list = props.nodes
    .map((n) => {
      const lon = n.lon ?? n.lng
      if (!Number.isFinite(lon) || !Number.isFinite(n.lat)) return null
      const [x, y] = projector.value.project(lon, n.lat)
      return { ...n, x, y, labelDy: 0, anchor: x > W.value * 0.7 ? 'end' : 'start' }
    })
    .filter(Boolean)
    .sort((a, b) => a.y - b.y)

  const gap = 17
  for (let i = 1; i < list.length; i += 1) {
    const prev = list[i - 1]
    const cur = list[i]
    const prevY = prev.y + prev.labelDy
    if (Math.abs(cur.x - prev.x) < 240 && cur.y + cur.labelDy - prevY < gap) {
      cur.labelDy = prevY + gap - cur.y
    }
  }
  return list
})

/** 拉近镜头：整层做 CSS transform，过渡出“飞入”的观感 */
const zoom = computed(() => {
  const f = props.focus
  if (!f || !Number.isFinite(f.lon)) return { k: 1, tx: 0, ty: 0 }
  const span = projector.value.metersToUnits(f.spanMeters || 600)
  const k = Math.max(1, Math.min(4, H.value / span))
  const [px, py] = projector.value.project(f.lon, f.lat)
  return { k, tx: W.value / 2 - k * px, ty: H.value / 2 - k * py }
})

const worldStyle = computed(() => ({
  transform: `translate(${zoom.value.tx}px, ${zoom.value.ty}px) scale(${zoom.value.k})`,
}))

/** 标注随镜头反向缩放，保持字号可读 */
const labelScale = computed(() => 1 / zoom.value.k)

defineExpose({ projector })
</script>

<template>
  <svg ref="rootEl" class="corridor-map" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none">
    <defs>
      <linearGradient id="cm-scan" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(0,229,255,0)" />
        <stop offset="55%" stop-color="rgba(0,229,255,0.30)" />
        <stop offset="100%" stop-color="rgba(0,229,255,0)" />
      </linearGradient>
      <filter id="cm-glow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="3" result="b" />
        <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>

    <g class="world" :style="worldStyle">
      <path v-for="l in drawn" :key="`case-${l.id}`" class="casing" :d="l.d" :stroke-width="l.width + 4" />

      <path
        v-for="l in drawn"
        :key="`road-${l.id}`"
        class="road"
        :class="{ alert: l.alert, dim: dimOthers && !l.alert }"
        :d="l.d"
        :stroke="l.color"
        :stroke-width="l.width"
      />

      <template v-for="l in drawn.filter((x) => x.alert)" :key="`fx-${l.id}`">
        <path class="halo" :d="l.d" :stroke-width="l.width + 8" />
        <path class="crawl" :d="l.d" :stroke-width="l.width - 1.5" />
      </template>

      <slot :projector="projector" :label-scale="labelScale" :zoom="zoom.k" />

      <g v-if="showLabels" class="nodes">
        <g v-for="n in placedNodes" :key="n.id" :transform="`translate(${n.x} ${n.y})`">
          <circle class="node-ring" :class="n.role" :r="7 * labelScale" />
          <circle class="node-dot" :class="n.role" :r="2.6 * labelScale" />
          <line
            v-if="n.labelDy"
            class="leader"
            x1="0"
            y1="0"
            :x2="(n.anchor === 'end' ? -9 : 9) * labelScale"
            :y2="n.labelDy"
          />
          <text
            class="node-label"
            :x="(n.anchor === 'end' ? -10 : 10) * labelScale"
            :y="n.labelDy + 4 * labelScale"
            :text-anchor="n.anchor"
            :style="{ fontSize: `${13 * labelScale}px` }"
          >
            {{ n.name }}
          </text>
        </g>
      </g>
    </g>

    <rect v-if="scanning" class="scan" x="0" y="-120" :width="W" height="120" fill="url(#cm-scan)" />
    <rect
      v-if="scanning"
      class="scan-line"
      x="0"
      y="-1"
      :width="W"
      height="1.5"
    />
  </svg>
</template>

<style scoped>
.corridor-map {
  display: block;
  width: 100%;
  height: 100%;
}

.world {
  transition: transform 1.1s cubic-bezier(0.22, 1, 0.36, 1);
}

.casing {
  fill: none;
  stroke: rgba(6, 26, 44, 0.95);
  stroke-linecap: round;
  stroke-linejoin: round;
}

.road {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.9;
}

.road.alert {
  opacity: 1;
  filter: url(#cm-glow);
}

.road.dim {
  opacity: 0.28;
}

/* 问题路段上的蠕行车流：与排队方向一致，缓慢向下游爬行 */
.crawl {
  fill: none;
  stroke: rgba(255, 220, 220, 0.85);
  stroke-linecap: round;
  stroke-dasharray: 6 22;
  animation: crawl-move 3.6s linear infinite;
}

@keyframes crawl-move {
  to { stroke-dashoffset: -56; }
}

.halo {
  fill: none;
  stroke: rgba(255, 68, 68, 0.55);
  stroke-linecap: round;
  animation: halo-pulse 1.15s ease-in-out infinite;
}

@keyframes halo-pulse {
  0%, 100% { opacity: 0.15; }
  50% { opacity: 0.7; }
}

.node-ring {
  fill: rgba(4, 12, 30, 0.85);
  stroke: var(--cyan-border-strong);
  stroke-width: 1;
}

.node-ring.target {
  stroke: var(--danger);
}

.node-dot {
  fill: var(--cyan);
}

.node-dot.target {
  fill: var(--danger);
}

.leader {
  stroke: rgba(0, 229, 255, 0.35);
  stroke-width: 0.8;
}

.node-label {
  fill: rgba(220, 245, 255, 0.85);
  letter-spacing: 1px;
  paint-order: stroke;
  stroke: rgba(2, 8, 18, 0.9);
  stroke-width: 3px;
}

.scan,
.scan-line {
  animation: scan-sweep 2.4s linear infinite;
}

.scan-line {
  fill: rgba(0, 229, 255, 0.55);
}

@keyframes scan-sweep {
  0% { transform: translateY(0); }
  100% { transform: translateY(900px); }
}
</style>

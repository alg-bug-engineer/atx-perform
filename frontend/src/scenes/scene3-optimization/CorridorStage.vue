<script setup>
import { computed } from 'vue'

const props = defineProps({
  model: { type: Object, required: true },
  variant: { type: Object, required: true },
  sample: { type: Object, default: null },
  /** 对照方案此刻的排队长度：>0 时在本幅画出参考队尾与差值，供上下两幅对读 */
  ghostQueueM: { type: Number, default: 0 },
})

/**
 * 横向走廊：上游解放东路口在左、下游经十路口在右，北向南车流自左向右。
 * 行车方向朝右 → 屏幕上方是东、下方是西，因此左转往上、右转往下。
 * 上游 3 车道，距经十路 100 m 处在东侧展宽出两条左转道，变成 5 车道。
 */
const GEO = {
  w: 1280,
  h: 194,
  jiefangL: 8,
  jiefangR: 108,
  jingshiL: 1128,
  jingshiR: 1228,
  downTop: 10,
  upTop: 70,
  roadBottom: 160,
  laneH: 30,
}
const CORRIDOR_PX = GEO.jingshiL - GEO.jiefangR

const LANE_LABELS = ['左转 + 掉头', '左转', '直行', '直行', '右转借道 · 公交']
const LANE_TURN = ['left', 'left', 'through', 'through', 'right']
const UP_LABELS = ['左转集结', '直行', '公交专用道']

const lengthM = computed(() => props.model.geometry?.length_m || 368)
const pxPerM = computed(() => CORRIDOR_PX / lengthM.value)
const mx = (m) => GEO.jiefangR + m * pxPerM.value

const taperStartX = computed(() => mx(props.variant.result.taperStart))
const taperEndX = computed(() => mx(props.variant.result.taperEnd))

const downCenter = (i) => GEO.downTop + GEO.laneH * (i + 0.5)
const upCenter = (i) => GEO.upTop + GEO.laneH * (i + 0.5)

/** 上游车道 → 展宽后车道的默认落位，用于插值出渐变的车辆 y */
const DEFAULT_DOWN = [1, 3, 4]

/** 路面轮廓：上游 3 车道，东侧渐开成 5 车道 */
const roadPath = computed(
  () =>
    `M ${GEO.jiefangR} ${GEO.upTop} L ${taperStartX.value} ${GEO.upTop}` +
    ` L ${taperEndX.value} ${GEO.downTop} L ${GEO.jingshiL} ${GEO.downTop}` +
    ` L ${GEO.jingshiL} ${GEO.roadBottom} L ${GEO.jiefangR} ${GEO.roadBottom} Z`,
)

/** 渐变车道线：上游 4 条边界渐移到展宽后位置，另外 2 条从展宽点新开 */
const laneLines = computed(() => {
  const t0 = taperStartX.value
  const t1 = taperEndX.value
  const taper = (yUp, yDown, cls) => ({
    cls,
    d: `M ${GEO.jiefangR} ${yUp} L ${t0} ${yUp} L ${t1} ${yDown} L ${GEO.jingshiL} ${yDown}`,
  })
  const fresh = (yDown, cls) => ({ cls, d: `M ${t1} ${yDown} L ${GEO.jingshiL} ${yDown}` })
  return [
    taper(GEO.upTop, GEO.downTop, 'median'),
    taper(GEO.upTop + GEO.laneH, GEO.downTop + GEO.laneH * 2, 'dash'),
    taper(GEO.upTop + GEO.laneH * 2, GEO.downTop + GEO.laneH * 4, 'solid-bus'),
    fresh(GEO.downTop + GEO.laneH, 'dash'),
    fresh(GEO.downTop + GEO.laneH * 3, 'dash'),
    { cls: 'edge', d: `M ${GEO.jiefangR} ${GEO.roadBottom} L ${GEO.jingshiL} ${GEO.roadBottom}` },
  ]
})

/** 展宽段路面导向箭头 */
const laneArrows = computed(() => {
  const x = GEO.jingshiL - 86
  return LANE_TURN.map((turn, i) => {
    const y = downCenter(i)
    if (turn === 'left') return { id: i, d: `M ${x} ${y + 5} L ${x + 22} ${y + 5} L ${x + 22} ${y - 6}` }
    if (turn === 'right') return { id: i, d: `M ${x} ${y - 5} L ${x + 22} ${y - 5} L ${x + 22} ${y + 6}` }
    return { id: i, d: `M ${x} ${y} L ${x + 28} ${y}` }
  })
})

const zebra = computed(() =>
  Array.from({ length: 7 }, (_, i) => ({
    id: i,
    x: GEO.jingshiL + 8 + i * 12,
    y: GEO.downTop,
    w: 6,
    h: GEO.roadBottom - GEO.downTop,
  })),
)

const ruler = computed(() => {
  const out = []
  for (let m = 0; m <= lengthM.value; m += 50) {
    out.push({ id: m, x: mx(m), label: `${m}` })
  }
  out.push({ id: 'end', x: mx(lengthM.value), label: `${Math.round(lengthM.value)} m` })
  return out
})

// ---- 动态 ----
const queueM = computed(() => props.sample?.queueM ?? 0)
/** 路段被车流占用的长度：判断还有没有蓄车空间看它，排队长度看排得最长的那股流向 */
const occupiedM = computed(() => props.sample?.occupiedM ?? 0)
const worstLabel = computed(
  () => ({ left: '左转', through: '直行', right: '右转' })[props.sample?.worstGroup] || '直行',
)
const spill = computed(() => !!props.sample?.spill)
const warning = computed(() => !spill.value && queueM.value >= props.model.warningM)
const queueTone = computed(() => (spill.value ? 'danger' : warning.value ? 'warn' : 'calm'))
const tailX = computed(() => mx(Math.max(0, lengthM.value - queueM.value)))

/** 对照方案的队尾（现状），画在本幅上直接量出缩短了多少 */
const ghost = computed(() => {
  const g = props.ghostQueueM
  if (!g || g <= queueM.value + 1) return null
  return {
    x: mx(Math.max(0, lengthM.value - g)),
    queueM: g,
    deltaM: Math.round(g - queueM.value),
  }
})
const occX = computed(() => mx(Math.max(0, lengthM.value - occupiedM.value)))
const warnX = computed(() => mx(Math.max(0, lengthM.value - props.model.warningM)))

const VEH_L = 16
const VEH_H = 14

const cars = computed(() => {
  const list = props.sample?.cars || []
  const t0 = props.variant.result.taperStart
  const t1 = props.variant.result.taperEnd
  return list.map((c) => {
    const down = c.downLane >= 0 ? c.downLane : DEFAULT_DOWN[c.upLane]
    const yUp = upCenter(c.upLane)
    const yDown = downCenter(down)
    const u = c.x <= t0 ? 0 : c.x >= t1 ? 1 : (c.x - t0) / (t1 - t0)
    return {
      id: c.id,
      x: mx(c.x) - VEH_L,
      y: yUp + (yDown - yUp) * u - VEH_H / 2,
      cls: c.moving ? 'moving' : 'queued',
      turn: c.turn,
    }
  })
})

/** 进不去路段、堵在解放东路口里的车 */
const blockedCars = computed(() => {
  const n = Math.min(12, Math.round((props.sample?.spillQueueM ?? 0) / 7))
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    x: GEO.jiefangR - 14 - (i % 4) * 15,
    y: upCenter(Math.floor(i / 4) % 3) - VEH_H / 2,
  }))
})

const sources = computed(() => props.sample?.upstreamSources || [])
const activeSource = computed(() => sources.value.find((s) => s.green) || null)

const inflowArrows = computed(() => {
  const s = activeSource.value
  if (!s) return []
  const lanes = s.key === 'east_left' ? [0] : s.key === 'west_right' ? [2] : [0, 1, 2]
  return lanes.map((l, i) => ({ id: l, y: upCenter(l), delay: `${i * 0.22}s` }))
})
</script>

<template>
  <figure class="corridor" :class="[`tone-${variant.tone}`, { spilling: spill }]">
    <figcaption class="hd">
      <span class="badge">{{ variant.key === 'before' ? '现状配时' : '相位协调后' }}</span>
      <span class="title">{{ variant.title }}</span>
      <span class="sub">{{ variant.subtitle }}</span>
      <span v-if="spill" class="alarm">路口溢出 · 排队压回解放东</span>
    </figcaption>

    <div class="body">
      <div class="canvas-wrap">
      <svg class="canvas" :viewBox="`0 0 ${GEO.w} ${GEO.h}`" preserveAspectRatio="none">
        <defs>
          <marker
            :id="`flow-${variant.key}`"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(0,229,255,0.85)" />
          </marker>
          <marker
            :id="`arw-${variant.key}`"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="4.5"
            markerHeight="4.5"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(200,232,248,0.62)" />
          </marker>
          <clipPath :id="`stop-${variant.key}`">
            <rect x="0" y="0" :width="GEO.jingshiL + 52" :height="GEO.h" />
          </clipPath>
        </defs>

        <!-- 相交道路 -->
        <rect class="cross" :x="GEO.jiefangL" y="0" :width="GEO.jiefangR - GEO.jiefangL" :height="GEO.h" />
        <rect class="cross trunk" :x="GEO.jingshiL" y="0" :width="GEO.jingshiR - GEO.jingshiL" :height="GEO.h" />

        <!-- 问题方向路面 -->
        <path class="road" :d="roadPath" />
        <rect class="bus-lane" :x="GEO.jiefangR" :y="GEO.roadBottom - GEO.laneH" :width="CORRIDOR_PX" :height="GEO.laneH" />
        <path v-for="(l, i) in laneLines" :key="`ln${i}`" :class="['mark', l.cls]" :d="l.d" />

        <!-- 展宽标注 -->
        <line class="widen-tick" :x1="taperEndX" :y1="GEO.downTop + 2" :x2="taperEndX" :y2="GEO.roadBottom + 6" />
        <text class="widen-label" :x="taperEndX + 6" :y="GEO.downTop + 14">展宽起点 · 距经十路 100 m</text>
        <text class="widen-label dim" :x="GEO.jiefangR + 8" :y="GEO.upTop - 8">上游 3 车道</text>

        <!-- 蓄车边界 / 预警线 -->
        <line class="ref warn" :x1="warnX" :y1="GEO.upTop - 4" :x2="warnX" :y2="GEO.roadBottom + 4" />
        <line class="ref storage" :x1="GEO.jiefangR" :y1="GEO.upTop - 10" :x2="GEO.jiefangR" :y2="GEO.roadBottom + 10" />

        <!-- 汇入 -->
        <g v-if="inflowArrows.length" class="inflow">
          <line
            v-for="a in inflowArrows"
            :key="`in${a.id}`"
            :x1="GEO.jiefangL + 8"
            :y1="a.y"
            :x2="GEO.jiefangR + 30"
            :y2="a.y"
            :style="{ animationDelay: a.delay }"
            :marker-end="`url(#flow-${variant.key})`"
          />
        </g>

        <!-- 车辆 -->
        <g class="fleet" :clip-path="`url(#stop-${variant.key})`">
          <rect
            v-for="c in blockedCars"
            :key="`bk${c.id}`"
            class="veh blocked"
            :x="c.x"
            :y="c.y"
            :width="VEH_L"
            :height="VEH_H"
            rx="1.5"
          />
          <rect
            v-for="c in cars"
            :key="c.id"
            :class="['veh', c.cls, c.turn]"
            :x="c.x"
            :y="c.y"
            :width="VEH_L"
            :height="VEH_H"
            rx="1.5"
          />
        </g>

        <!-- 停止线与人行横道 -->
        <line class="stop-line" :x1="GEO.jingshiL" :y1="GEO.downTop" :x2="GEO.jingshiL" :y2="GEO.roadBottom" />
        <rect v-for="z in zebra" :key="`z${z.id}`" class="zebra" :x="z.x" :y="z.y" :width="z.w" :height="z.h" />

        <!-- 车道功能 -->
        <path
          v-for="a in laneArrows"
          :key="`ar${a.id}`"
          class="lane-arrow"
          :d="a.d"
          :marker-end="`url(#arw-${variant.key})`"
        />
        <text v-for="(l, i) in LANE_LABELS" :key="`ll${i}`" class="lane-label" :x="GEO.jingshiL - 8" :y="downCenter(i) + 3" text-anchor="end">
          {{ l }}
        </text>
        <g v-for="(l, i) in UP_LABELS" :key="`ul${i}`">
          <rect
            class="up-label-bg"
            :x="GEO.jiefangR + 6"
            :y="upCenter(i) - 7"
            :width="l.length * 9.5 + 8"
            :height="14"
          />
          <text class="up-label" :x="GEO.jiefangR + 10" :y="upCenter(i) + 3">{{ l }}</text>
        </g>

        <!-- 队尾标注：主排队流向的队尾，另标出整段被占用到哪里 -->
        <g class="occ">
          <line :x1="occX" :y1="GEO.upTop - 6" :x2="occX" :y2="GEO.roadBottom + 6" />
          <text :x="occX + 6" :y="GEO.roadBottom + 2">占用 {{ Math.round(occupiedM) }} m</text>
        </g>
        <g class="tail" :class="queueTone">
          <line :x1="tailX" :y1="GEO.downTop" :x2="tailX" :y2="GEO.roadBottom + 8" />
          <text :x="tailX - 8" :y="GEO.downTop + 14" text-anchor="end">
            {{ worstLabel }}队尾 {{ Math.round(queueM) }} m
          </text>
        </g>

        <!-- 与上一幅对读：现状队尾位置 + 缩短量 -->
        <g v-if="ghost" class="ghost">
          <line :x1="ghost.x" :y1="GEO.downTop" :x2="ghost.x" :y2="GEO.roadBottom + 8" />
          <text :x="ghost.x - 6" :y="GEO.downTop + 14" text-anchor="end">
            现状队尾 {{ Math.round(ghost.queueM) }} m
          </text>
          <line class="span" :x1="ghost.x" :y1="GEO.downTop + 18" :x2="tailX" :y2="GEO.downTop + 18" />
          <text class="span-text" :x="(ghost.x + tailX) / 2" :y="GEO.downTop + 14" text-anchor="middle">
            缩短 {{ ghost.deltaM }} m
          </text>
        </g>

        <!-- 标尺 -->
        <g class="ruler">
          <line :x1="GEO.jiefangR" :y1="GEO.roadBottom + 16" :x2="GEO.jingshiL" :y2="GEO.roadBottom + 16" />
          <g v-for="r in ruler" :key="`rl${r.id}`">
            <line :x1="r.x" :y1="GEO.roadBottom + 13" :x2="r.x" :y2="GEO.roadBottom + 19" />
            <text :x="r.x" :y="GEO.roadBottom + 30" text-anchor="middle">{{ r.label }}</text>
          </g>
        </g>

        <!-- 路口名 -->
        <text class="inter-name" :x="(GEO.jiefangL + GEO.jiefangR) / 2" y="22" text-anchor="middle">解放东路口</text>
        <text class="inter-name trunk" :x="(GEO.jingshiL + GEO.jingshiR) / 2" y="22" text-anchor="middle">经十路口</text>
      </svg>
      </div>
    </div>
  </figure>
</template>

<style scoped>
.corridor {
  margin: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 4px;
  padding: 6px 8px 6px;
  border: 1px solid var(--cyan-border);
  border-radius: 4px;
  background: rgba(2, 10, 24, 0.72);
}
.corridor.tone-danger { border-color: rgba(255, 68, 68, 0.34); }
.corridor.tone-ok { border-color: rgba(51, 204, 136, 0.4); }
.corridor.spilling { box-shadow: inset 0 0 40px rgba(255, 68, 68, 0.1); }

.hd { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; flex: none; }
.badge {
  padding: 2px 10px;
  font-size: 12px;
  letter-spacing: 2px;
  border: 1px solid currentColor;
  border-radius: 2px;
  color: var(--danger);
}
.tone-ok .badge { color: var(--ok); }
.title { font-size: 15px; color: var(--text); letter-spacing: 1px; }
.sub { font-size: 12px; color: var(--text-muted); }
.alarm {
  margin-left: auto;
  padding: 2px 10px;
  font-size: 12px;
  color: #ff9a9a;
  border: 1px solid var(--danger);
  background: rgba(255, 68, 68, 0.15);
  animation: blink 0.9s ease-in-out infinite;
}
@keyframes blink { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }

.body {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
}
.canvas-wrap { position: relative; min-height: 0; height: 100%; }
.canvas { position: absolute; inset: 0; width: 100%; height: 100%; }

.cross { fill: #07182a; stroke: rgba(0, 229, 255, 0.2); }
.cross.trunk { fill: #082137; }

.road { fill: #0b2540; stroke: none; }
.bus-lane { fill: rgba(0, 229, 255, 0.05); }

.mark { fill: none; }
.mark.dash { stroke: rgba(214, 236, 250, 0.32); stroke-width: 1.2; stroke-dasharray: 11 9; }
.mark.solid-bus { stroke: rgba(0, 229, 255, 0.34); stroke-width: 1.4; }
.mark.median { stroke: rgba(255, 200, 60, 0.5); stroke-width: 1.8; }
.mark.edge { stroke: rgba(214, 236, 250, 0.42); stroke-width: 1.4; }

.widen-tick { stroke: rgba(0, 229, 255, 0.4); stroke-width: 1; stroke-dasharray: 3 3; }
.widen-label { font-size: 10px; fill: rgba(0, 229, 255, 0.62); letter-spacing: 0.5px; }
.widen-label.dim { fill: rgba(150, 190, 212, 0.5); }

.ghost line {
  stroke: rgba(255, 68, 68, 0.55);
  stroke-width: 1.2;
  stroke-dasharray: 4 4;
}
.ghost .span {
  stroke: rgba(51, 204, 136, 0.85);
  stroke-dasharray: none;
  stroke-width: 1.4;
}
.ghost text {
  font-size: 10px;
  fill: rgba(255, 130, 130, 0.9);
  font-family: var(--font-mono);
}
.ghost .span-text {
  fill: var(--ok);
  font-size: 11px;
}

.ref { stroke-dasharray: 5 4; }
.ref.warn { stroke: rgba(255, 204, 0, 0.4); stroke-width: 1.2; }
.ref.storage { stroke: rgba(255, 68, 68, 0.6); stroke-width: 1.6; }

.stop-line { stroke: rgba(228, 246, 255, 0.85); stroke-width: 3; }
.zebra { fill: rgba(214, 236, 250, 0.22); }
.lane-arrow { fill: none; stroke: rgba(200, 232, 248, 0.5); stroke-width: 1.4; }
.lane-label { font-size: 10px; fill: rgba(170, 208, 228, 0.8); }
.up-label { font-size: 9.5px; fill: rgba(170, 208, 228, 0.7); }
.up-label-bg { fill: rgba(2, 16, 28, 0.82); }

.veh { transition: fill 0.18s linear; }
.veh.queued { fill: #ffae2e; }
.veh.moving { fill: #3ddc97; }
.veh.right { opacity: 0.82; }
.veh.blocked { fill: #ff4d4d; animation: blink 0.8s ease-in-out infinite; }

.inflow line {
  stroke: var(--cyan);
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-dasharray: 10 12;
  animation: inflow 0.9s linear infinite;
}
@keyframes inflow {
  from { stroke-dashoffset: 22; opacity: 0.35; }
  50% { opacity: 1; }
  to { stroke-dashoffset: 0; opacity: 0.35; }
}

.occ line { stroke: rgba(200, 232, 248, 0.32); stroke-width: 1; stroke-dasharray: 2 5; }
.occ text { font-size: 9.5px; fill: rgba(200, 232, 248, 0.5); font-family: var(--font-mono); }

.tail line { stroke-width: 1.2; stroke-dasharray: 4 4; }
.tail text { font-size: 12px; font-family: var(--font-mono); }
.tail.calm line, .tail.calm text { stroke: var(--cyan); fill: var(--cyan); }
.tail.warn line, .tail.warn text { stroke: var(--warn); fill: var(--warn); }
.tail.danger line, .tail.danger text { stroke: var(--danger); fill: var(--danger); }
.tail line { fill: none; }

.ruler line { stroke: rgba(0, 229, 255, 0.24); stroke-width: 1; }
.ruler text { font-size: 9px; fill: rgba(150, 190, 212, 0.5); font-family: var(--font-mono); }

.inter-name { font-size: 12px; fill: rgba(160, 200, 220, 0.8); letter-spacing: 1px; }
.inter-name.trunk { fill: rgba(0, 229, 255, 0.9); }
</style>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  model: { type: Object, required: true },
  variant: { type: Object, required: true },
  sample: { type: Object, default: null },
  /** 对照方案此刻的排队长度：>0 时在本幅画出参考队尾与差值，供上下两幅对读 */
  ghostQueueM: { type: Number, default: 0 },
  /** 现状幅画出调研排队 270 m 锚点，和前面几幕口径一致 */
  showExpertQueue: { type: Boolean, default: false },
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
  const L = lengthM.value
  const out = []
  // 经十路（右）为 0 m，解放东（左）为路段全长
  out.push({ id: 'jiefang', x: mx(0), label: `${Math.round(L)} m` })
  for (let d = 50; d < L; d += 50) {
    out.push({ id: d, x: mx(L - d), label: `${d}` })
  }
  out.push({ id: 'jingshi', x: mx(L), label: '0 m' })
  return out
})

// ---- 动态 ----
const queueM = computed(() => props.sample?.queueM ?? 0)
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
const warnX = computed(() => mx(Math.max(0, lengthM.value - props.model.warningM)))
const expertX = computed(() => mx(Math.max(0, lengthM.value - 270)))

const jingshiSig = computed(
  () => props.sample?.downstreamThrough || { green: false, countdown: 0 },
)
const jiefangSig = computed(() => {
  const list = props.sample?.upstreamSources || []
  return list.find((s) => s.green) || list.find((s) => s.key === 'north_through') || { green: false, countdown: 0 }
})

const VEH_L = 20
const VEH_H = 16

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
    x: GEO.jiefangR - 16 - (i % 4) * 18,
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
      <span class="badge">{{ variant.key === 'before' ? '现状配时' : '优化后' }}</span>
      <span class="sub">{{ variant.subtitle }}</span>
      <span v-if="spill" class="alarm">路口溢出，排队溢至解放东</span>
    </figcaption>

    <div class="body">
      <div class="canvas-wrap">
      <svg class="canvas" :viewBox="`0 0 ${GEO.w} ${GEO.h}`" preserveAspectRatio="xMidYMid meet">
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
        <text class="widen-label" :x="taperEndX + 6" :y="GEO.downTop + 14">
          <tspan class="lbl">展宽起点 · 距经十路 </tspan>
          <tspan class="val">100 m</tspan>
        </text>
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
            rx="2"
          />
          <rect
            v-for="c in cars"
            :key="c.id"
            :class="['veh', c.cls, c.turn]"
            :x="c.x"
            :y="c.y"
            :width="VEH_L"
            :height="VEH_H"
            rx="2"
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

        <g class="tail" :class="queueTone">
          <line :x1="tailX" :y1="GEO.downTop" :x2="tailX" :y2="GEO.roadBottom + 8" />
          <text :x="tailX - 8" :y="GEO.downTop + 14" text-anchor="end">
            <tspan class="lbl">{{ worstLabel }}队尾 </tspan>
            <tspan class="val">{{ Math.round(queueM) }} m</tspan>
          </text>
        </g>

        <g v-if="showExpertQueue" class="expert">
          <line :x1="expertX" :y1="GEO.upTop - 4" :x2="expertX" :y2="GEO.roadBottom + 6" />
          <text :x="expertX + 6" :y="GEO.roadBottom + 2">
            <tspan class="lbl">调研排队 </tspan>
            <tspan class="val">270 m</tspan>
          </text>
        </g>

        <!-- 与上一幅对读：现状队尾位置 + 缩短量 -->
        <g v-if="ghost" class="ghost">
          <line :x1="ghost.x" :y1="GEO.downTop" :x2="ghost.x" :y2="GEO.roadBottom + 8" />
          <text :x="ghost.x - 6" :y="GEO.downTop + 14" text-anchor="end">
            <tspan class="lbl">对照 现状队尾 </tspan>
            <tspan class="val">{{ Math.round(ghost.queueM) }} m</tspan>
          </text>
          <line class="span" :x1="ghost.x" :y1="GEO.downTop + 18" :x2="tailX" :y2="GEO.downTop + 18" />
          <text class="span-text" :x="(ghost.x + tailX) / 2" :y="GEO.downTop + 14" text-anchor="middle">
            <tspan class="lbl">缩短 </tspan>
            <tspan class="val">{{ ghost.deltaM }} m</tspan>
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

        <!-- 路口名 + 灯态 -->
        <g class="sig" :transform="`translate(${(GEO.jiefangL + GEO.jiefangR) / 2}, 10)`">
          <circle r="7" :class="['lamp', jiefangSig.green ? 'g' : 'r']" />
          <text class="inter-name" y="22" text-anchor="middle">解放东路口</text>
          <text class="cd" y="34" text-anchor="middle">
            <tspan :class="jiefangSig.green ? 'g' : 'r'">{{ jiefangSig.green ? '绿灯' : '红灯' }}</tspan>
            <tspan class="w"> {{ jiefangSig.countdown || 0 }} s</tspan>
          </text>
        </g>
        <g class="sig" :transform="`translate(${(GEO.jingshiL + GEO.jingshiR) / 2}, 10)`">
          <circle r="7" :class="['lamp', jingshiSig.green ? 'g' : 'r']" />
          <text class="inter-name trunk" y="22" text-anchor="middle">经十路口</text>
          <text class="cd" y="34" text-anchor="middle">
            <tspan :class="jingshiSig.green ? 'g' : 'r'">{{ jingshiSig.green ? '绿灯' : '红灯' }}</tspan>
            <tspan class="w"> {{ jingshiSig.countdown || 0 }} s</tspan>
          </text>
        </g>
      </svg>
      </div>
    </div>
    <div v-if="$slots.foot" class="foot">
      <slot name="foot" />
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
  padding: 4px 8px 6px;
  border: 1px solid var(--cyan-border);
  border-left: 3px solid var(--cyan-border);
  border-radius: 2px;
  background: rgba(2, 10, 24, 0.72);
}
.corridor.tone-danger { border-left-color: var(--danger); }
.corridor.tone-ok { border-left-color: var(--ok); }
.corridor.spilling { box-shadow: inset 0 0 28px rgba(255, 68, 68, 0.08); }

.hd { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; flex: none; }
.badge {
  padding: 1px 8px;
  font-size: 12px;
  letter-spacing: 1px;
  border: 1px solid currentColor;
  border-radius: 2px;
  color: var(--danger);
}
.tone-ok .badge { color: var(--ok); }
.sub { font-size: 12px; color: var(--text); }
.alarm {
  margin-left: auto;
  font-size: 12px;
  font-weight: 600;
  color: var(--danger);
}
@keyframes blink { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }

.foot { flex: none; min-width: 0; }
.body {
  flex: 1 1 0;
  min-height: 0;
  display: grid;
}
.canvas-wrap {
  position: relative;
  min-height: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

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
.widen-label { font-size: 10px; fill: rgba(220, 245, 255, 0.92); letter-spacing: 0.4px; }
.widen-label .val { fill: var(--cyan); }
.widen-label.dim { fill: rgba(220, 245, 255, 0.92); }

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
  fill: rgba(220, 245, 255, 0.92);
  font-family: var(--font-mono);
}
.ghost text .val { fill: var(--danger); }
.ghost .span-text { fill: rgba(220, 245, 255, 0.92); font-size: 11px; }
.ghost .span-text .val { fill: var(--ok); }

.ref { stroke-dasharray: 5 4; }
.ref.warn { stroke: rgba(255, 204, 0, 0.4); stroke-width: 1.2; }
.ref.storage { stroke: rgba(255, 68, 68, 0.6); stroke-width: 1.6; }

.stop-line { stroke: rgba(228, 246, 255, 0.85); stroke-width: 3; }
.zebra { fill: rgba(214, 236, 250, 0.22); }
.lane-arrow { fill: none; stroke: rgba(200, 232, 248, 0.5); stroke-width: 1.4; }
.lane-label { font-size: 10px; fill: rgba(220, 245, 255, 0.88); }
.up-label { font-size: 9.5px; fill: rgba(220, 245, 255, 0.88); }
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
.tail text { font-size: 12px; font-family: var(--font-mono); fill: rgba(220, 245, 255, 0.92); }
.tail .lbl { fill: rgba(220, 245, 255, 0.92); }
.tail.calm line { stroke: var(--cyan); }
.tail.calm .val { fill: var(--cyan); }
.tail.warn line { stroke: var(--warn); }
.tail.warn .val { fill: var(--warn); }
.tail.danger line { stroke: var(--danger); }
.tail.danger .val { fill: var(--danger); }
.tail line { fill: none; }

.ruler line { stroke: rgba(0, 229, 255, 0.24); stroke-width: 1; }
.ruler text { font-size: 9px; fill: rgba(220, 245, 255, 0.72); font-family: var(--font-mono); }

.inter-name { font-size: 12px; fill: rgba(220, 245, 255, 0.92); letter-spacing: 1px; }
.inter-name.trunk { fill: rgba(220, 245, 255, 0.92); }
.sig .lamp { stroke: rgba(255, 255, 255, 0.35); stroke-width: 1; }
.sig .lamp.g { fill: #33cc88; }
.sig .lamp.r { fill: #ff4444; }
.sig .cd { font-size: 9px; fill: rgba(220, 245, 255, 0.92); font-family: var(--font-mono); }
.sig .cd .g { fill: var(--ok); }
.sig .cd .r { fill: var(--danger); }
.sig .cd .w { fill: rgba(220, 245, 255, 0.92); }
.expert line {
  stroke: rgba(255, 204, 0, 0.55);
  stroke-width: 1.2;
  stroke-dasharray: 5 4;
}
.expert text { font-size: 9.5px; fill: rgba(220, 245, 255, 0.92); font-family: var(--font-mono); }
.expert .val { fill: var(--warn); }
</style>

<script setup>
/**
 * 阶段渠化示意（参考 agent-loop StageMovementCanvas，改 SVG + 补全标线）
 * 北上东右；每个进口按右侧通行分内外半幅，放行流向画在自己的车道上。
 */
import { computed } from 'vue'

const props = defineProps({
  movements: { type: Array, default: () => [] },
  stageNo: { type: Number, default: null },
})

const S = 96
const C = S / 2
const RW = 18 // 单向路幅宽度
const LANE = 9 // 流向所在车道中心相对路中心的偏移
const R = 10 // 转弯半径

const IN = C - RW
const OUT = C + RW
const ZEBRA_FAR = IN - 9
const ZEBRA_NEAR = IN - 3
const STOP = IN - 11

const legs = [
  { key: 'n', x: IN, y: 0, w: RW * 2, h: IN },
  { key: 's', x: IN, y: OUT, w: RW * 2, h: IN },
  { key: 'w', x: 0, y: IN, w: IN, h: RW * 2 },
  { key: 'e', x: OUT, y: IN, w: IN, h: RW * 2 },
]

/** 四个进口的斑马线（每条 4 根条纹） */
const zebras = computed(() => {
  const stripes = []
  const n = 4
  const span = RW * 2
  const w = span / (n * 2 - 1)
  for (let i = 0; i < n; i += 1) {
    const off = IN + i * w * 2
    stripes.push({ id: `zn${i}`, x: off, y: ZEBRA_FAR, w, h: ZEBRA_NEAR - ZEBRA_FAR })
    stripes.push({ id: `zs${i}`, x: off, y: S - ZEBRA_NEAR, w, h: ZEBRA_NEAR - ZEBRA_FAR })
    stripes.push({ id: `zw${i}`, x: ZEBRA_FAR, y: off, w: ZEBRA_NEAR - ZEBRA_FAR, h: w })
    stripes.push({ id: `ze${i}`, x: S - ZEBRA_NEAR, y: off, w: ZEBRA_NEAR - ZEBRA_FAR, h: w })
  }
  return stripes
})

/** 停止线只画在进口半幅上（右侧通行） */
const stopLines = [
  { id: 'sn', x1: IN, y1: STOP, x2: C, y2: STOP },
  { id: 'ss', x1: C, y1: S - STOP, x2: OUT, y2: S - STOP },
  { id: 'se', x1: S - STOP, y1: IN, x2: S - STOP, y2: C },
  { id: 'sw', x1: STOP, y1: C, x2: STOP, y2: OUT },
]

/** 中心双黄线 + 同向车道虚线 */
const centerLines = [
  { id: 'cn', x1: C, y1: 0, x2: C, y2: STOP },
  { id: 'cs', x1: C, y1: S - STOP, x2: C, y2: S },
  { id: 'cw', x1: 0, y1: C, x2: STOP, y2: C },
  { id: 'ce', x1: S - STOP, y1: C, x2: S, y2: C },
]
const laneDashes = [
  { id: 'dn1', x1: C - LANE, y1: 0, x2: C - LANE, y2: STOP },
  { id: 'dn2', x1: C + LANE, y1: 0, x2: C + LANE, y2: STOP },
  { id: 'ds1', x1: C - LANE, y1: S - STOP, x2: C - LANE, y2: S },
  { id: 'ds2', x1: C + LANE, y1: S - STOP, x2: C + LANE, y2: S },
  { id: 'dw1', x1: 0, y1: C - LANE, x2: STOP, y2: C - LANE },
  { id: 'dw2', x1: 0, y1: C + LANE, x2: STOP, y2: C + LANE },
  { id: 'de1', x1: S - STOP, y1: C - LANE, x2: S, y2: C - LANE },
  { id: 'de2', x1: S - STOP, y1: C + LANE, x2: S, y2: C + LANE },
]

// 进口来向 → 行进方向；右侧通行下每个行进方向靠哪一侧
const HEADING = { 0: 'south', 2: 'west', 4: 'north', 6: 'east' }
const LEFT_OF = { south: 'east', west: 'south', north: 'west', east: 'north' }
const RIGHT_OF = { south: 'west', west: 'north', north: 'east', east: 'south' }
const VEC = {
  south: [0, 1],
  north: [0, -1],
  east: [1, 0],
  west: [-1, 0],
}
const SIDE = { south: -LANE, north: LANE, west: -LANE, east: LANE }
const CIRCULAR_LEFT_STAGES = new Set([2, 4, 10])
const LEFT_ARC_R = 38

/**
 * 对向左转分别放进路口中心的两个对角区，各画一段独立圆弧。
 * 不只圆滑拐点，还要避开对向轨迹的进口直线与出口直线。
 */
function circularLeftPath(heading, start, end) {
  const near = C - LANE
  const far = C + LANE
  const r = LEFT_ARC_R
  const tangents = {
    south: [[near, far - r], [near + r, far]],
    west: [[near + r, near], [near, near + r]],
    north: [[far, near + r], [far - r, near]],
    east: [[far - r, far], [far, far - r]],
  }
  const [pre, post] = tangents[heading]
  return (
    `M ${start[0]} ${start[1]} L ${pre[0]} ${pre[1]}` +
    ` A ${r} ${r} 0 0 0 ${post[0]} ${post[1]}` +
    ` L ${end[0]} ${end[1]}`
  )
}

/** 沿行进方向取画布边界上的进/出点 */
function edgePoint(heading, lateral, atStart) {
  switch (heading) {
    case 'south':
      return [C + lateral, atStart ? 0 : S]
    case 'north':
      return [C + lateral, atStart ? S : 0]
    case 'east':
      return [atStart ? 0 : S, C + lateral]
    default:
      return [atStart ? S : 0, C + lateral]
  }
}

const paths = computed(() =>
  props.movements
    .map((m) => {
      const heading = HEADING[m.dir8]
      if (!heading) return null
      const outHeading = m.turn === 1 ? LEFT_OF[heading] : m.turn === 3 ? RIGHT_OF[heading] : heading
      const inLat = SIDE[heading]
      const outLat = SIDE[outHeading]
      const start = edgePoint(heading, inLat, true)
      const end = edgePoint(outHeading, outLat, false)

      if (outHeading === heading) {
        return { id: `${m.dir8}-${m.turn}`, d: `M ${start[0]} ${start[1]} L ${end[0]} ${end[1]}` }
      }

      if (m.turn === 1 && CIRCULAR_LEFT_STAGES.has(props.stageNo)) {
        return {
          id: `${m.dir8}-${m.turn}`,
          d: circularLeftPath(heading, start, end),
        }
      }

      // 转弯拐点：进口车道与出口车道的交点
      const corner =
        VEC[heading][0] === 0 ? [C + inLat, C + outLat] : [C + outLat, C + inLat]
      const pre = [corner[0] - VEC[heading][0] * R, corner[1] - VEC[heading][1] * R]
      const post = [corner[0] + VEC[outHeading][0] * R, corner[1] + VEC[outHeading][1] * R]
      return {
        id: `${m.dir8}-${m.turn}`,
        d: `M ${start[0]} ${start[1]} L ${pre[0]} ${pre[1]} Q ${corner[0]} ${corner[1]} ${post[0]} ${post[1]} L ${end[0]} ${end[1]}`,
      }
    })
    .filter(Boolean),
)

/** 进口信号灯：本阶段放行的进口亮绿，其余亮红，位置贴各自停止线的外侧 */
const APPROACH_OF = { 0: 'n', 2: 'e', 4: 's', 6: 'w' }
const HEAD_POS = {
  n: [IN - 8, STOP - 11],
  s: [OUT + 3, S - STOP],
  w: [STOP - 11, OUT + 3],
  e: [S - STOP, IN - 14],
}
const heads = computed(() => {
  const on = new Set(props.movements.map((m) => APPROACH_OF[m.dir8]).filter(Boolean))
  return Object.entries(HEAD_POS).map(([key, [x, y]]) => ({ key, x, y, on: on.has(key) }))
})

const uid = Math.random().toString(36).slice(2, 8)
</script>

<template>
  <svg class="chan" :viewBox="`0 0 ${S} ${S}`" preserveAspectRatio="xMidYMid meet" role="img" aria-label="阶段放行渠化示意">
    <defs>
      <marker
        :id="`arw-${uid}`"
        viewBox="0 0 10 10"
        refX="8.5"
        refY="5"
        markerWidth="4"
        markerHeight="4"
        orient="auto"
      >
        <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
      </marker>
      <filter :id="`gl-${uid}`" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="1.6" result="b" />
        <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>

    <rect class="block" x="0" y="0" :width="S" :height="S" rx="3" />
    <rect v-for="l in legs" :key="l.key" class="asphalt" :x="l.x" :y="l.y" :width="l.w" :height="l.h" />
    <rect class="asphalt box" :x="IN" :y="IN" :width="RW * 2" :height="RW * 2" />

    <line v-for="d in laneDashes" :key="d.id" class="lane-dash" v-bind="d" />
    <line v-for="c in centerLines" :key="c.id" class="center-line" v-bind="c" />
    <rect v-for="z in zebras" :key="z.id" class="zebra" :x="z.x" :y="z.y" :width="z.w" :height="z.h" />
    <line v-for="s in stopLines" :key="s.id" class="stop-line" v-bind="s" />

    <g class="flows" :filter="`url(#gl-${uid})`">
      <path
        v-for="p in paths"
        :key="p.id"
        class="flow"
        :d="p.d"
        :marker-end="`url(#arw-${uid})`"
      />
    </g>

    <g
      v-for="h in heads"
      :key="`sg${h.key}`"
      class="head"
      :class="{ on: h.on }"
      :transform="`translate(${h.x}, ${h.y})`"
    >
      <rect class="case" x="0" y="0" width="5" height="11" rx="1.4" />
      <circle class="red" cx="2.5" cy="3.2" r="1.4" />
      <circle class="grn" cx="2.5" cy="7.8" r="1.4" />
    </g>

    <text v-if="!paths.length" class="idle" :x="C" :y="C + 3">过渡</text>
  </svg>
</template>

<style scoped>
.chan {
  display: block;
  width: 100%;
  height: 100%;
  color: var(--ok);
}
.block { fill: rgba(6, 26, 44, 0.9); stroke: rgba(0, 229, 255, 0.16); }
.asphalt { fill: rgba(16, 46, 68, 0.95); }
.asphalt.box { fill: rgba(20, 56, 80, 0.95); }
.lane-dash {
  stroke: rgba(226, 240, 255, 0.28);
  stroke-width: 0.7;
  stroke-dasharray: 3 3;
}
.center-line { stroke: rgba(255, 196, 60, 0.5); stroke-width: 0.9; }
.zebra { fill: rgba(226, 240, 255, 0.3); }
.stop-line { stroke: rgba(226, 240, 255, 0.75); stroke-width: 1.8; }
.flow {
  fill: none;
  stroke: currentColor;
  stroke-width: 2.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.head .case { fill: rgba(4, 14, 26, 0.95); stroke: rgba(160, 200, 220, 0.35); stroke-width: 0.4; }
.head .red { fill: #ff4444; }
.head .grn { fill: rgba(51, 204, 136, 0.16); }
.head.on .red { fill: rgba(255, 68, 68, 0.16); }
.head.on .grn { fill: #33cc88; }

.idle { font-size: 9px; fill: rgba(160, 200, 220, 0.5); text-anchor: middle; }
</style>

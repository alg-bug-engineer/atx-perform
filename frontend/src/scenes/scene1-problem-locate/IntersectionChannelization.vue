<script setup>
/**
 * 路口渠化示意：按 1-1-channelization.json 的进/出口臂逐车道还原。
 * turn_move 11=直行 / 12=左转 / 13=右转，复合编码按“直行+右转”降级画。
 * 画法沿用幕 3b 的阶段渠化（右侧通行、进口半幅、停止线 + 斑马线）。
 */
import { computed } from 'vue'

const props = defineProps({
  title: { type: String, default: '' },
  arms: { type: Array, default: () => [] },
  /** 需要强调的进口方位码：'0' 北 / '2' 东 / '4' 南 / '6' 西 */
  highlightDir: { type: String, default: '' },
  tag: { type: String, default: '' },
})

const S = 120
const C = S / 2
const RW = 30
const IN = C - RW
const STOP = IN - 5

/** 进口来向 → 行进（指向路口中心）单位向量；右向量 = 顺时针 90° */
const INBOUND = {
  0: [0, 1],
  2: [-1, 0],
  4: [0, -1],
  6: [1, 0],
}
const DIR_LABEL = { 0: '北进口', 2: '东进口', 4: '南进口', 6: '西进口' }
const ROTATE = { 0: 180, 2: 270, 4: 0, 6: 90 }

function right([x, y]) {
  return [-y, x]
}

const dirs = computed(() => {
  const set = new Set()
  for (const a of props.arms) {
    const d = String(a.dir8_code ?? '')
    if (INBOUND[d]) set.add(d)
  }
  return [...set]
})

const legs = computed(() =>
  dirs.value.map((d) => {
    const v = INBOUND[d]
    const horizontal = v[0] !== 0
    return {
      d,
      x: horizontal ? (v[0] > 0 ? 0 : C + RW) : C - RW,
      y: horizontal ? C - RW : v[1] > 0 ? 0 : C + RW,
      w: horizontal ? IN : RW * 2,
      h: horizontal ? RW * 2 : IN,
    }
  }),
)

const TURN_GLYPH = {
  through: 'M 0 7 L 0 -6 M -2.4 -2.6 L 0 -6.4 L 2.4 -2.6',
  left: 'M 0 7 L 0 -1 Q 0 -5 -4 -5 L -6 -5 M -3.8 -7.2 L -6.6 -5 L -3.8 -2.8',
  right: 'M 0 7 L 0 -1 Q 0 -5 4 -5 L 6 -5 M 3.8 -7.2 L 6.6 -5 L 3.8 -2.8',
}

function turnKind(code) {
  const c = String(code)
  if (c === '12') return 'left'
  if (c === '13') return 'right'
  if (c === '22' || c === '32' || c === '40') return 'right'
  return 'through'
}

/** 同一方位可能有主路 + 辅路两条进口臂，取车道数最多的主路作代表 */
const primaryEntrances = computed(() => {
  const byDir = new Map()
  for (const a of props.arms) {
    if (a.link_role !== 'entrance') continue
    const d = String(a.dir8_code ?? '')
    if (!INBOUND[d]) continue
    const prev = byDir.get(d)
    if (!prev || (a.c_lane_num || a.lane_num || 0) > (prev.c_lane_num || prev.lane_num || 0)) {
      byDir.set(d, a)
    }
  }
  return [...byDir.values()]
})

/** 每个进口按车道展开：内侧车道贴中心线，外侧靠路缘 */
const approaches = computed(() =>
  primaryEntrances.value
    .map((a) => {
      const d = String(a.dir8_code)
      const v = INBOUND[d]
      const r = right(v)
      const moves = String(a.turn_move || '').split('|').filter(Boolean)
      const n = moves.length || a.c_lane_num || a.lane_num || 1
      const laneW = RW / n
      /** 车道多时缩小箭头，避免相邻车道压字 */
      const glyphScale = Math.max(0.5, Math.min(1, laneW / 6))
      const lanes = Array.from({ length: n }, (_, i) => {
        const lateral = (i + 0.5) * laneW
        const dist = IN + 8 * glyphScale + 4
        return {
          key: `${d}-${i}`,
          x: C - v[0] * dist + r[0] * lateral,
          y: C - v[1] * dist + r[1] * lateral,
          scale: glyphScale,
          kind: turnKind(moves[i] || '11'),
        }
      })
      const dividers = Array.from({ length: Math.max(0, n - 1) }, (_, i) => {
        const lateral = (i + 1) * laneW
        const from = IN
        const to = C - 2
        return {
          key: `dv-${d}-${i}`,
          x1: C - v[0] * from + r[0] * lateral,
          y1: C - v[1] * from + r[1] * lateral,
          x2: C - v[0] * to + r[0] * lateral,
          y2: C - v[1] * to + r[1] * lateral,
        }
      })
      const stop = {
        x1: C - v[0] * STOP,
        y1: C - v[1] * STOP,
        x2: C - v[0] * STOP + r[0] * RW,
        y2: C - v[1] * STOP + r[1] * RW,
      }
      return {
        d,
        label: DIR_LABEL[d],
        laneNum: n,
        highlight: d === props.highlightDir,
        rotate: ROTATE[d],
        lanes,
        dividers,
        stop,
        labelPos: {
          x: C - v[0] * (C - 4) + r[0] * (RW / 2),
          y: C - v[1] * (C - 4) + r[1] * (RW / 2) + 2,
        },
      }
    }),
)
</script>

<template>
  <figure class="chan-card">
    <figcaption class="chan-hd">
      <span class="chan-title">{{ title }}</span>
      <span v-if="tag" class="chan-tag">{{ tag }}</span>
    </figcaption>

    <svg :viewBox="`0 0 ${S} ${S}`" class="chan" role="img" :aria-label="`${title} 渠化`">
      <rect class="block" x="0" y="0" :width="S" :height="S" />
      <rect v-for="l in legs" :key="`leg-${l.d}`" class="asphalt" :x="l.x" :y="l.y" :width="l.w" :height="l.h" />
      <rect class="asphalt box" :x="IN" :y="IN" :width="RW * 2" :height="RW * 2" />

      <g v-for="a in approaches" :key="`ap-${a.d}`" :class="{ hot: a.highlight }">
        <line
          v-for="dv in a.dividers"
          :key="dv.key"
          class="lane-dash"
          :x1="dv.x1"
          :y1="dv.y1"
          :x2="dv.x2"
          :y2="dv.y2"
        />
        <line class="stop-line" :x1="a.stop.x1" :y1="a.stop.y1" :x2="a.stop.x2" :y2="a.stop.y2" />
        <path
          v-for="ln in a.lanes"
          :key="ln.key"
          class="glyph"
          :d="TURN_GLYPH[ln.kind]"
          :transform="`translate(${ln.x} ${ln.y}) rotate(${a.rotate}) scale(${ln.scale})`"
        />
        <text class="ap-label" :x="a.labelPos.x" :y="a.labelPos.y">
          {{ a.label }} {{ a.laneNum }}车道
        </text>
      </g>
    </svg>
  </figure>
</template>

<style scoped>
.chan-card {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--cyan-border);
  border-radius: 3px;
  background: var(--bg-inset);
  min-width: 0;
}

.chan-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.chan-title {
  font-size: 12px;
  color: var(--cyan-dim);
  letter-spacing: 1px;
}

.chan-tag {
  font-size: 11px;
  color: var(--warn);
  border: 1px solid rgba(255, 204, 0, 0.4);
  padding: 1px 6px;
}

.chan {
  display: block;
  margin: 0 auto;
  width: auto;
  height: 176px;
  max-width: 100%;
}

.block { fill: rgba(6, 26, 44, 0.6); }
.asphalt { fill: var(--asphalt); }
.asphalt.box { fill: rgba(20, 56, 80, 0.95); }

.lane-dash {
  stroke: rgba(226, 240, 255, 0.26);
  stroke-width: 0.6;
  stroke-dasharray: 3 3;
}

.stop-line {
  stroke: rgba(226, 240, 255, 0.7);
  stroke-width: 1.6;
}

.glyph {
  fill: none;
  stroke: rgba(190, 225, 245, 0.75);
  stroke-width: 1.1;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.hot .glyph {
  stroke: var(--danger);
  stroke-width: 1.4;
}

.hot .stop-line {
  stroke: var(--danger);
}

.ap-label {
  font-size: 5.4px;
  fill: rgba(160, 200, 220, 0.75);
  text-anchor: middle;
  letter-spacing: 0.4px;
}

.hot .ap-label {
  fill: var(--danger);
}
</style>

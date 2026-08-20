<script setup>
/**
 * 干线绿波时距图，生成方式对齐 deepagent 工作台 CorridorSpaceTimeDiagram：
 * - 红绿窗按节点相位差 + 方向性绿时（coordinated_green_forward_s/reverse_s）几何重铺
 * - 左转喂流窗取引擎 diagram.green_windows 的 left_feeder
 * - 绿波带用几何重叠梯形带（collectOverlapBands 口径），空时才回退服务端带宽带
 * - 轨迹：服务端 Newell 折线，采样上限 180 + 行驶/等待分段配色
 *
 * 引擎只对优化后方案跑轨迹，所以「现状」只画红绿窗与几何带，不伪造轨迹。
 */
import { computed } from 'vue'

const props = defineProps({
  model: { type: Object, required: true },
  mode: { type: String, default: 'optimized' },
  direction: { type: String, default: 'both' },
})

const W = 960
const H = 740
const PAD = { top: 26, right: 18, bottom: 38, left: 52 }
/** 信号条画在路口竖线两侧：左=北向南，右=南向北 */
const BAR = { w: 5, left: -6, right: 1 }

const diagram = computed(() => props.model.diagram)
const isEngine = computed(() => props.mode === 'optimized' && !!diagram.value)

const nodeNames = computed(() => props.model.rawNodes.map((n) => n.short_name))
const focusFlags = computed(() => props.model.rawNodes.map((n) => n.is_focus))

const distances = computed(() =>
  isEngine.value
    ? diagram.value.cum_distance_m
    : props.model.views[props.mode].nodes.map((n) => n.distM),
)

const cycleS = computed(() => diagram.value?.cycle_s || props.model.corridor.cycle_s || 180)

/** 时间轴对齐工作台默认 4 个周期（ST_DEFAULT_CYCLES=4，scaleY=1） */
const tRange = computed(() => [0, cycleS.value * 4])

const maxDist = computed(() => Math.max(1, ...distances.value))

function sx(m) {
  return PAD.left + (m / maxDist.value) * (W - PAD.left - PAD.right)
}
/** 时间自下而上 */
function sy(t) {
  const [t0, t1] = tRange.value
  const plot = H - PAD.top - PAD.bottom
  return PAD.top + plot - ((t - t0) / Math.max(1e-6, t1 - t0)) * plot
}

const showFwd = computed(() => props.direction !== 'reverse')
const showRev = computed(() => props.direction !== 'forward')

const timeTicks = computed(() => {
  const [t0, t1] = tRange.value
  const out = []
  for (let t = Math.ceil(t0 / cycleS.value) * cycleS.value; t <= t1; t += cycleS.value) out.push(t)
  return out
})

const nodeCols = computed(() =>
  distances.value.map((m, i) => ({
    i,
    x: sx(m),
    name: nodeNames.value[i] || `N${i + 1}`,
    focus: focusFlags.value[i],
  })),
)

/** 红灯底条：绿窗盖在上面，露出的部分即红灯，画法同工作台 */
const redBars = computed(() => {
  const y = sy(tRange.value[1])
  const h = sy(tRange.value[0]) - y
  const rows = []
  for (const c of nodeCols.value) {
    if (showFwd.value) rows.push({ key: `rf${c.i}`, x: c.x + BAR.left, y, h })
    if (showRev.value) rows.push({ key: `rr${c.i}`, x: c.x + BAR.right, y, h })
  }
  return rows
})

/** 红绿窗与工作台同口径：按节点相位差 + 方向性绿时几何重铺；左转喂流窗取引擎 diagram */
const bars = computed(() => {
  const [t0, t1] = tRange.value
  const rows = []
  props.model.views[props.mode].nodes.forEach((n, i) => {
    const x = sx(distances.value[i] ?? 0)
    const push = (list, side) => {
      if (!list) return
      for (const w of list) {
        if (w.end < t0 || w.start > t1) continue
        rows.push({
          key: `${i}-${side}-${w.start}`,
          x: x + (side === 'fwd' ? BAR.left : BAR.right),
          y: sy(Math.min(w.end, t1)),
          h: Math.max(1, sy(Math.max(w.start, t0)) - sy(Math.min(w.end, t1))),
          role: 'coord',
        })
      }
    }
    push(n.greensFwd, 'fwd')
    push(n.greensRev, 'rev')
  })
  if (isEngine.value) {
    for (const w of diagram.value.windows) {
      if (w.role !== 'left_feeder') continue
      if (w.dir === 'forward' && !showFwd.value) continue
      if (w.dir === 'reverse' && !showRev.value) continue
      if (w.t1 < t0 || w.t0 > t1) continue
      rows.push({
        key: `f${w.node}-${w.t0}`,
        x: sx(distances.value[w.node] ?? 0) + BAR.left,
        y: sy(Math.min(w.t1, t1)),
        h: Math.max(1, sy(Math.max(w.t0, t0)) - sy(Math.min(w.t1, t1))),
        role: 'left_feeder',
      })
    }
  }
  return rows
})

function polyline(pts) {
  return pts.map((p) => `${sx(p[1]).toFixed(1)},${sy(p[0]).toFixed(1)}`).join(' ')
}

/** 轨迹采样与分段配色均照抄工作台：sampleVehicles 上限 180，splitMoveWaitRuns 拆分行驶/等待 */
function sampleVehicles(list, maxN, cycleS) {
  const flt = list.filter((v) => (v.pts || []).length >= 2)
  if (flt.length <= maxN) return flt
  const C = Math.max(1e-6, cycleS || 90)
  const buckets = new Map()
  flt.forEach((v) => {
    const t0 = Number(v.meta?.depart_s != null ? v.meta.depart_s : v.pts[0][0])
    const k = Number.isFinite(t0) ? Math.max(0, Math.floor(t0 / C)) : 0
    const arr = buckets.get(k) ?? []
    arr.push(v)
    buckets.set(k, arr)
  })
  const keys = Array.from(buckets.keys()).sort((a, b) => a - b)
  const per = Math.max(1, Math.floor(maxN / Math.max(keys.length, 1)))
  const picked = []
  keys.forEach((k) => {
    const arr = buckets.get(k) || []
    const step = Math.max(1, Math.ceil(arr.length / per))
    for (let i = 0; i < arr.length && picked.length < maxN; i += step) picked.push(arr[i])
  })
  return picked
}

function splitMoveWaitRuns(pts) {
  const moveRuns = []
  const waitRuns = []
  let cur = null
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i]
    const p1 = pts[i + 1]
    const dt = p1[0] - p0[0]
    const dx = Math.abs(p1[1] - p0[1])
    const isWait = dx < 0.5 && dt > 0.5
    if (!cur || cur.wait !== isWait) {
      cur = { wait: isWait, pts: [p0, p1] }
      ;(isWait ? waitRuns : moveRuns).push(cur)
    } else {
      cur.pts.push(p1)
    }
  }
  return { moveRuns, waitRuns }
}

const trajectories = computed(() => {
  if (!isEngine.value) return []
  const out = []
  const pool = sampleVehicles(diagram.value.vehicles, 180, cycleS.value)
  for (const v of pool) {
    if (v.dir === 'forward' && !showFwd.value) continue
    if (v.dir === 'reverse' && !showRev.value) continue
    const meta = v.meta || {}
    const isRedDepart = meta.depart_phase === 'red' || !!meta.side_arrival
    const isFeeder = v.role === 'left_feeder'
    const { moveRuns, waitRuns } = splitMoveWaitRuns(v.pts || [])
    for (const run of moveRuns) {
      out.push({
        key: `v${out.length}`,
        dir: v.dir,
        cls: `move${isRedDepart ? ' reddepart' : ''}${isFeeder ? ' feeder' : ''}`,
        pts: polyline(run.pts),
      })
    }
    for (const run of waitRuns) {
      out.push({
        key: `v${out.length}`,
        dir: v.dir,
        cls: `wait${isFeeder ? ' feeder' : ''}${isRedDepart ? ' reddepart' : ''}`,
        pts: polyline(run.pts),
      })
    }
  }
  return out
})

const tails = computed(() =>
  isEngine.value ? diagram.value.queue_tails.map((p, i) => ({ key: `q${i}`, pts: polyline(p) })) : [],
)

const clipId = `tsd-plot-${Math.random().toString(36).slice(2, 8)}`

/** 几何重叠梯形带优先（工作台 collectOverlapBands 口径）；几何带为空才回退服务端带宽带 */
const geoBands = computed(() => {
  const out = []
  for (const link of props.model.views[props.mode].links) {
    const push = (list, dir) => {
      for (const b of list) {
        out.push({
          key: `g${dir[0]}${link.key}-${b.upStart}`,
          dir,
          pts: [
            [b.upStart, b.fromDistM],
            [b.downStart, b.toDistM],
            [b.downStart + b.width, b.toDistM],
            [b.upStart + b.width, b.fromDistM],
          ]
            .map((p) => `${sx(p[1]).toFixed(1)},${sy(p[0]).toFixed(1)}`)
            .join(' '),
        })
      }
    }
    if (showFwd.value) push(link.forwardBands, 'forward')
    if (showRev.value) push(link.reverseBands, 'reverse')
  }
  return out
})

const serverBands = computed(() => {
  if (geoBands.value.length > 0) return []
  return isEngine.value
    ? diagram.value.bands
        .filter((b) => (b.dir === 'forward' ? showFwd.value : showRev.value))
        .map((b, i) => ({ key: `b${i}`, dir: b.dir, pts: polyline(b.pts) }))
    : []
})
</script>

<template>
  <svg class="tsd" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="xMidYMid meet">
    <defs>
      <clipPath :id="clipId">
        <rect
          :x="PAD.left - 8"
          :y="PAD.top"
          :width="W - PAD.left - PAD.right + 16"
          :height="H - PAD.top - PAD.bottom"
        />
      </clipPath>
    </defs>

    <g class="grid">
      <line
        v-for="t in timeTicks"
        :key="`t${t}`"
        :x1="PAD.left"
        :x2="W - PAD.right"
        :y1="sy(t)"
        :y2="sy(t)"
      />
      <text v-for="t in timeTicks" :key="`tl${t}`" class="tick" :x="PAD.left - 8" :y="sy(t) + 3">
        {{ t }}
      </text>
      <text class="unit" :x="PAD.left - 8" :y="PAD.top - 10">s</text>
    </g>

    <g class="cols">
      <line
        v-for="c in nodeCols"
        :key="`c${c.i}`"
        :x1="c.x"
        :x2="c.x"
        :y1="PAD.top"
        :y2="H - PAD.bottom"
      />
      <text
        v-for="c in nodeCols"
        :key="`cn${c.i}`"
        class="nm"
        :class="{ focus: c.focus }"
        :x="c.x"
        :y="PAD.top - 10"
      >
        {{ c.name }}
      </text>
    </g>

    <g :clip-path="`url(#${clipId})`">
      <g class="signal">
        <rect
          v-for="r in redBars"
          :key="r.key"
          class="red"
          :x="r.x"
          :y="r.y"
          :width="BAR.w"
          :height="r.h"
        />
        <rect
          v-for="b in bars"
          :key="b.key"
          :class="b.role"
          :x="b.x"
          :y="b.y"
          :width="BAR.w"
          :height="b.h"
        />
      </g>

      <g class="traj">
        <polyline v-for="v in trajectories" :key="v.key" :class="[v.dir, v.cls]" :points="v.pts" />
      </g>

      <g class="tails">
        <polyline v-for="q in tails" :key="q.key" :points="q.pts" />
      </g>

      <g class="bands">
        <polygon v-for="b in geoBands" :key="b.key" :class="b.dir" :points="b.pts" />
        <polyline v-for="b in serverBands" :key="b.key" :class="b.dir" :points="b.pts" />
      </g>
    </g>

    <g class="axis">
      <text class="cap" :x="(PAD.left + W - PAD.right) / 2" :y="H - 6">距离 / 路口位置（米）</text>
    </g>
  </svg>
</template>

<style scoped>
.tsd {
  width: 100%;
  height: 100%;
  display: block;
  font-family: var(--font-mono);
}

.grid line {
  stroke: rgba(0, 229, 255, 0.14);
  stroke-dasharray: 4 4;
}
.grid text.tick,
.grid text.unit {
  fill: var(--text-muted);
  font-size: 9px;
  text-anchor: end;
}

.cols line {
  stroke: rgba(0, 229, 255, 0.12);
  stroke-dasharray: 3 5;
}
.cols text.nm {
  fill: rgba(190, 220, 236, 0.75);
  font-size: 9.5px;
  text-anchor: middle;
}
.cols text.nm.focus {
  fill: var(--text);
  font-weight: 600;
}

/* 协调相位绿窗；左转搭接窗用琥珀区分 */
.signal rect.red {
  fill: rgba(255, 68, 68, 0.4);
}
.signal rect.coord {
  fill: rgba(51, 204, 136, 0.9);
}
.signal rect.left_feeder,
.signal rect.right_feeder {
  fill: rgba(255, 204, 0, 0.5);
}

.traj polyline {
  fill: none;
  stroke-width: 0.9;
}
.traj polyline.move.forward {
  stroke: rgba(51, 204, 136, 0.5);
}
.traj polyline.move.reverse {
  stroke: rgba(0, 229, 255, 0.5);
}
.traj polyline.move.reddepart {
  stroke: rgba(255, 150, 150, 0.8);
}
.traj polyline.move.feeder {
  stroke: rgba(255, 204, 0, 0.75);
}
.traj polyline.wait {
  stroke: rgba(255, 96, 96, 0.95);
  stroke-width: 2.2;
}
.traj polyline.wait.feeder {
  stroke: rgba(255, 138, 0, 0.9);
}

.tails polyline {
  fill: none;
  stroke: rgba(255, 138, 0, 0.65);
  stroke-width: 1.1;
}

.bands polygon {
  stroke-width: 1;
}
.bands polygon.forward {
  fill: rgba(51, 204, 136, 0.18);
  stroke: rgba(51, 204, 136, 0.9);
}
.bands polygon.reverse {
  fill: rgba(0, 229, 255, 0.08);
  stroke: rgba(0, 229, 255, 0.75);
  stroke-dasharray: 5 4;
}
.bands polyline {
  fill: none;
  stroke-width: 2.4;
}
.bands polyline.forward {
  stroke: rgba(51, 204, 136, 0.85);
}
.bands polyline.reverse {
  stroke: rgba(0, 229, 255, 0.85);
}

.axis text.cap {
  fill: var(--text-muted);
  font-size: 9.5px;
  text-anchor: middle;
}
</style>

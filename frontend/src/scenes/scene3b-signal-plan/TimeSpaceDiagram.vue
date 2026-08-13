<script setup>
/**
 * 干线绿波时距图，坐标与图元均对齐 deepagent 工作台：
 * 横轴走里程、纵轴走时间且自下而上，车辆轨迹是服务端 Newell 跟驰算出的折线。
 *
 * 引擎只对优化后方案跑轨迹，所以「现状」只画各路口的协调相位绿窗，不伪造轨迹。
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

const tRange = computed(() => {
  if (isEngine.value) return [diagram.value.t_min_s, diagram.value.t_max_s]
  return [0, cycleS.value * 3]
})

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
    if (showFwd.value || !isEngine.value) rows.push({ key: `rf${c.i}`, x: c.x + BAR.left, y, h })
    if (showRev.value && isEngine.value) rows.push({ key: `rr${c.i}`, x: c.x + BAR.right, y, h })
  }
  return rows
})

/** 优化后取引擎绿窗；现状按相位差与协调绿自铺，标注为示意 */
const bars = computed(() => {
  const [t0, t1] = tRange.value
  const rows = []
  if (isEngine.value) {
    for (const w of diagram.value.windows) {
      if (w.dir === 'forward' && !showFwd.value) continue
      if (w.dir === 'reverse' && !showRev.value) continue
      if (w.t1 < t0 || w.t0 > t1) continue
      rows.push({
        key: `${w.node}-${w.dir}-${w.role}-${w.t0}`,
        x: sx(distances.value[w.node] ?? 0) + (w.dir === 'forward' ? BAR.left : BAR.right),
        y: sy(Math.min(w.t1, t1)),
        h: Math.max(1, sy(Math.max(w.t0, t0)) - sy(Math.min(w.t1, t1))),
        role: w.role,
      })
    }
    return rows
  }
  props.model.views[props.mode].nodes.forEach((n, i) => {
    for (let t = -cycleS.value; t <= t1; t += n.cycleS) {
      const a = n.offsetS + t
      const b = a + n.coordGreenS
      if (b < t0 || a > t1) continue
      rows.push({
        key: `${i}-${t}`,
        x: sx(distances.value[i] ?? 0) + BAR.left,
        y: sy(Math.min(b, t1)),
        h: Math.max(1, sy(Math.max(a, t0)) - sy(Math.min(b, t1))),
        role: 'coord',
      })
    }
  })
  return rows
})

function polyline(pts) {
  return pts.map((p) => `${sx(p[1]).toFixed(1)},${sy(p[0]).toFixed(1)}`).join(' ')
}

const trajectories = computed(() => {
  if (!isEngine.value) return []
  return diagram.value.vehicles
    .filter((v) => (v.dir === 'forward' ? showFwd.value : showRev.value))
    .map((v, i) => ({ key: `v${i}`, dir: v.dir, pts: polyline(v.pts) }))
})

const tails = computed(() =>
  isEngine.value ? diagram.value.queue_tails.map((p, i) => ({ key: `q${i}`, pts: polyline(p) })) : [],
)

const bands = computed(() =>
  isEngine.value
    ? diagram.value.bands
        .filter((b) => (b.dir === 'forward' ? showFwd.value : showRev.value))
        .map((b, i) => ({ key: `b${i}`, dir: b.dir, pts: polyline(b.pts) }))
    : [],
)
</script>

<template>
  <svg class="tsd" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="xMidYMid meet">
    <defs>
      <clipPath id="tsd-plot">
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

    <g clip-path="url(#tsd-plot)">
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
        <polyline v-for="v in trajectories" :key="v.key" :class="v.dir" :points="v.pts" />
      </g>

      <g class="tails">
        <polyline v-for="q in tails" :key="q.key" :points="q.pts" />
      </g>

      <g class="bands">
        <polyline v-for="b in bands" :key="b.key" :class="b.dir" :points="b.pts" />
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
  fill: var(--cyan);
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
.traj polyline.forward {
  stroke: rgba(51, 204, 136, 0.5);
}
.traj polyline.reverse {
  stroke: rgba(0, 229, 255, 0.5);
}

.tails polyline {
  fill: none;
  stroke: rgba(255, 138, 0, 0.65);
  stroke-width: 1.1;
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

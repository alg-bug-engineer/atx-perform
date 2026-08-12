<script setup>
/**
 * 试运行效果 SVG 趋势图（移植自 agent-loop TrialEffectCharts，配色改 baseline）
 */
import { computed } from 'vue'

const props = defineProps({
  cycles: { type: Array, default: () => [] },
  revealed: { type: Number, default: 0 },
  warningRatio: { type: Number, default: 0.8 },
  greenLow: { type: Number, default: 0.6 },
})

const W = 320
const H = 148
const PAD = { t: 18, r: 12, b: 28, l: 40 }
const innerW = W - PAD.l - PAD.r
const innerH = H - PAD.t - PAD.b

function visiblePoints(key) {
  return props.cycles
    .filter((c) => c.index <= props.revealed)
    .map((c) => ({ index: c.index, value: c[key] }))
}

function yDomain(values, refLines) {
  const nums = [...values, ...refLines].filter((v) => typeof v === 'number' && Number.isFinite(v))
  if (!nums.length) return { min: 0, max: 1 }
  let min = Math.min(...nums)
  let max = Math.max(...nums)
  const pad = Math.max((max - min) * 0.18, 0.04)
  min = Math.max(0, min - pad)
  max = Math.min(1.05, max + pad)
  if (max <= min) max = min + 0.1
  return { min, max }
}

function buildChart(key, title, color, refLines) {
  const allVals = props.cycles.map((c) => c[key]).filter((v) => typeof v === 'number')
  const domain = yDomain(allVals, refLines.map((r) => r.value))
  const n = Math.max(props.cycles.length, 1)
  const xAt = (index) => PAD.l + ((index - 1) / Math.max(n - 1, 1)) * innerW
  const yAt = (v) => PAD.t + (1 - (v - domain.min) / (domain.max - domain.min)) * innerH
  const pts = visiblePoints(key)
  const path = pts.length
    ? pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(p.index).toFixed(1)} ${yAt(p.value).toFixed(1)}`).join(' ')
    : ''
  return {
    key,
    title,
    color,
    path,
    points: pts.map((p) => ({ x: xAt(p.index), y: yAt(p.value) })),
    refs: refLines.map((r, i) => ({
      ...r,
      y: yAt(r.value),
      labelY: yAt(r.value) - 3 - i * 11,
    })),
    ticks: props.cycles.map((c) => ({
      index: c.index,
      x: xAt(c.index),
      dim: c.index > props.revealed,
    })),
    yMinLabel: domain.min.toFixed(2),
    yMaxLabel: domain.max.toFixed(2),
  }
}

const charts = computed(() => [
  buildChart('queue_ratio', '目标排队比', '#7ee8f5', [
    { value: props.warningRatio, label: `预警 ${props.warningRatio}`, tone: 'warn' },
  ]),
  buildChart('green_utilization', '绿灯利用率', '#33cc88', [
    { value: props.greenLow, label: `低利用 ${props.greenLow}`, tone: 'mute' },
  ]),
  buildChart('downstream_queue_ratio', '上游排队比', '#ffcc00', [
    { value: props.warningRatio, label: `预警 ${props.warningRatio}`, tone: 'warn' },
  ]),
])
</script>

<template>
  <div class="charts" data-testid="effect-charts">
    <article v-for="chart in charts" :key="chart.key" class="chart-card">
      <header class="chart-hd">
        <span class="chart-title">{{ chart.title }}</span>
      </header>
      <svg class="chart-svg" :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="chart.title">
        <line class="grid" :x1="PAD.l" :y1="PAD.t" :x2="PAD.l" :y2="PAD.t + innerH" />
        <line class="grid" :x1="PAD.l" :y1="PAD.t + innerH" :x2="PAD.l + innerW" :y2="PAD.t + innerH" />
        <text class="axis-label" :x="PAD.l - 4" :y="PAD.t + 4" text-anchor="end">{{ chart.yMaxLabel }}</text>
        <text class="axis-label" :x="PAD.l - 4" :y="PAD.t + innerH" text-anchor="end">{{ chart.yMinLabel }}</text>
        <g v-for="(ref, i) in chart.refs" :key="`ref-${i}`">
          <line class="ref-line" :class="ref.tone" :x1="PAD.l" :y1="ref.y" :x2="PAD.l + innerW" :y2="ref.y" />
          <text class="ref-label" :class="ref.tone" :x="PAD.l + innerW - 2" :y="ref.labelY" text-anchor="end">
            {{ ref.label }}
          </text>
        </g>
        <path v-if="chart.path" class="series" :stroke="chart.color" :d="chart.path" fill="none" />
        <circle
          v-for="(p, i) in chart.points"
          :key="`pt-${i}`"
          class="dot"
          :cx="p.x"
          :cy="p.y"
          r="3.2"
          :fill="chart.color"
        />
        <text
          v-for="tick in chart.ticks"
          :key="`t-${tick.index}`"
          class="x-label"
          :class="{ dim: tick.dim }"
          :x="tick.x"
          :y="H - 8"
          text-anchor="middle"
        >
          {{ tick.index }}
        </text>
      </svg>
    </article>
  </div>
</template>

<style scoped>
.charts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  flex-shrink: 0;
}
.chart-card {
  border: 1px solid var(--cyan-border);
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.28);
  padding: 6px 8px 4px;
  min-width: 0;
}
.chart-title {
  font-size: 11px;
  color: var(--cyan-dim);
  font-weight: 600;
}
.chart-svg {
  width: 100%;
  height: auto;
  display: block;
}
.grid {
  stroke: rgba(0, 229, 255, 0.18);
  stroke-width: 1;
}
.axis-label,
.x-label,
.ref-label {
  fill: rgba(160, 200, 220, 0.45);
  font-size: 9px;
}
.x-label.dim {
  fill: rgba(160, 200, 220, 0.22);
}
.ref-line {
  stroke-width: 1;
  stroke-dasharray: 3 3;
  stroke: rgba(160, 200, 220, 0.35);
}
.ref-line.warn,
.ref-label.warn {
  stroke: rgba(255, 68, 68, 0.7);
  fill: rgba(255, 68, 68, 0.8);
}
.ref-line.mute,
.ref-label.mute {
  stroke: rgba(160, 200, 220, 0.4);
  fill: rgba(160, 200, 220, 0.55);
}
.series {
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.dot {
  stroke: rgba(4, 12, 30, 0.9);
  stroke-width: 1;
}
@media (max-width: 1100px) {
  .charts {
    grid-template-columns: 1fr;
  }
}
</style>

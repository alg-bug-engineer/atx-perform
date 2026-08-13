<script setup>
/** 单周期机理复核：把幕 3 的排队推演结果拿到效果评估里做前后对照 */
import { computed } from 'vue'
import { buildCorridorDemo, queueSeries } from '../scene3-optimization/corridorDemo.js'

const props = defineProps({
  optimization: { type: Object, default: null },
})

const model = computed(() => (props.optimization ? buildCorridorDemo(props.optimization) : null))

const W = 620
const H = 470
const PAD = { top: 26, right: 62, bottom: 40, left: 52 }

const maxY = computed(() => {
  const peak = model.value.variants.reduce((m, v) => Math.max(m, v.peakM), model.value.storageM)
  return Math.ceil((peak * 1.04) / 25) * 25
})

const x0 = PAD.left
const x1 = W - PAD.right
const y0 = H - PAD.bottom
const y1 = PAD.top

function toX(t) {
  return x0 + (t / model.value.cycleLen) * (x1 - x0)
}
function toY(q) {
  return y0 - (q / maxY.value) * (y0 - y1)
}

const curves = computed(() =>
  model.value.variants.map((v) => {
    const s = queueSeries(v, 2)
    const d = s.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.t).toFixed(1)} ${toY(p.q).toFixed(1)}`).join(' ')
    return {
      key: v.key,
      tone: v.tone,
      label: v.key === 'before' ? '优化前' : '优化后',
      peakM: v.peakM,
      d,
      area: `${d} L ${toX(model.value.cycleLen).toFixed(1)} ${y0} L ${x0} ${y0} Z`,
      peakX: toX(s.reduce((best, p) => (p.q > best.q ? p : best), s[0]).t),
      peakY: toY(v.peakM),
    }
  }),
)

const overflow = computed(() =>
  model.value.variants.map((v) => ({ key: v.key, over: v.peakM > model.value.storageM })),
)

const yTicks = computed(() => {
  const out = []
  for (let q = 0; q <= maxY.value; q += 100) out.push(q)
  return out
})

const xTicks = computed(() => {
  const c = model.value.cycleLen
  return [0, 0.25, 0.5, 0.75, 1].map((r) => Math.round(c * r))
})
</script>

<template>
  <section v-if="model" class="cycle-queue" data-testid="cycle-queue-chart">
    <header>
      <h3>单周期排队推演 · 前后对照</h3>
      <div class="legend">
        <span class="lg before"><i />优化前 峰值 {{ Math.round(curves[0].peakM) }} m</span>
        <span class="lg after"><i />优化后 峰值 {{ Math.round(curves[1].peakM) }} m</span>
        <span class="lg limit"><i />蓄车边界 {{ Math.round(model.storageM) }} m</span>
      </div>
    </header>

    <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="xMidYMid meet" class="chart">
      <defs>
        <linearGradient id="q-before" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(255,68,68,0.3)" />
          <stop offset="100%" stop-color="rgba(255,68,68,0)" />
        </linearGradient>
        <linearGradient id="q-after" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(51,204,136,0.28)" />
          <stop offset="100%" stop-color="rgba(51,204,136,0)" />
        </linearGradient>
      </defs>

      <g class="grid" v-for="q in yTicks" :key="`y${q}`">
        <line :x1="x0" :y1="toY(q)" :x2="x1" :y2="toY(q)" />
        <text :x="x0 - 8" :y="toY(q) + 4" text-anchor="end">{{ q }}</text>
      </g>
      <line class="axis" :x1="x0" :y1="y0" :x2="x1" :y2="y0" />

      <rect
        class="over-band"
        :x="x0"
        :y="y1"
        :width="x1 - x0"
        :height="Math.max(0, toY(model.storageM) - y1)"
      />
      <line class="limit" :x1="x0" :y1="toY(model.storageM)" :x2="x1" :y2="toY(model.storageM)" />
      <text class="limit-text" :x="x1 + 6" :y="toY(model.storageM) + 4">溢出</text>

      <path v-for="c in curves" :key="`a${c.key}`" :class="['area', c.key]" :d="c.area" />
      <path v-for="c in curves" :key="`l${c.key}`" :class="['ln', c.tone]" :d="c.d" />

      <g v-for="c in curves" :key="`p${c.key}`">
        <circle :class="['peak', c.tone]" :cx="c.peakX" :cy="c.peakY" r="4.5" />
        <text :class="['peak-text', c.tone]" :x="c.peakX" :y="c.peakY - 9" text-anchor="middle">
          {{ Math.round(c.peakM) }} m
        </text>
      </g>

      <g class="xtick" v-for="t in xTicks" :key="`x${t}`">
        <text :x="toX(t)" :y="y0 + 18" text-anchor="middle">{{ t }}s</text>
      </g>
    </svg>

    <p class="verdict">
      <span :class="overflow[0].over ? 'bad' : 'good'">
        优化前{{ overflow[0].over ? '突破蓄车边界，路口溢出' : '未溢出' }}
      </span>
      <span :class="overflow[1].over ? 'bad' : 'good'">
        优化后{{ overflow[1].over ? '仍会溢出' : '全程在蓄车边界内' }}
      </span>
    </p>
  </section>
</template>

<style scoped>
.cycle-queue { display: flex; flex-direction: column; gap: 6px; min-height: 0; }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
h3 { margin: 0; font-size: 13px; font-weight: 500; letter-spacing: 1px; color: var(--cyan); }
.legend { display: flex; gap: 14px; font-size: 11px; color: var(--text-muted); }
.lg { display: inline-flex; align-items: center; gap: 6px; }
.lg i { width: 16px; height: 2px; background: currentColor; }
.lg.before { color: var(--danger); }
.lg.after { color: var(--ok); }
.lg.limit { color: rgba(255, 68, 68, 0.6); }
.lg.limit i { background: repeating-linear-gradient(90deg, currentColor 0 4px, transparent 4px 8px); }

.chart { width: 100%; height: 100%; min-height: 0; display: block; }
.grid line { stroke: rgba(0, 229, 255, 0.08); }
.grid text { font-size: 10px; fill: rgba(160, 200, 220, 0.5); font-family: var(--font-mono); }
.axis { stroke: rgba(0, 229, 255, 0.35); }
.over-band { fill: rgba(255, 68, 68, 0.06); }
.limit { stroke: rgba(255, 68, 68, 0.6); stroke-width: 1.2; stroke-dasharray: 6 5; }
.limit-text { font-size: 10px; fill: rgba(255, 120, 120, 0.85); font-family: var(--font-mono); }
.area.before { fill: url(#q-before); }
.area.after { fill: url(#q-after); }
.ln { fill: none; stroke-width: 2.4; }
.ln.danger { stroke: var(--danger); }
.ln.ok { stroke: var(--ok); }
.peak.danger { fill: var(--danger); }
.peak.ok { fill: var(--ok); }
.peak-text { font-size: 11px; font-family: var(--font-mono); }
.peak-text.danger { fill: var(--danger); }
.peak-text.ok { fill: var(--ok); }
.xtick text { font-size: 10px; fill: var(--text-muted); font-family: var(--font-mono); }

.verdict { display: flex; gap: 16px; margin: 0; font-size: 11px; }
.verdict .good { color: var(--ok); }
.verdict .bad { color: var(--danger); }
</style>

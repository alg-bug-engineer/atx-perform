<script setup>
/** 单周期机理复核：把幕 3 的排队推演结果拿到效果评估里做前后对照 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { buildCorridorDemo, queueSeries } from '../scene3-optimization/corridorDemo.js'
import { prefersInstant } from '../../shared/useSceneBeats.js'

const props = defineProps({
  optimization: { type: Object, default: null },
})

const model = computed(() => (props.optimization ? buildCorridorDemo(props.optimization) : null))

const host = ref(null)
const size = ref({ w: 920, h: 420 })
const PAD = { top: 22, right: 48, bottom: 32, left: 44 }
const drawT = ref(prefersInstant() ? 1 : 0)
const maskId = `queue-draw-${Math.random().toString(36).slice(2, 9)}`

const W = computed(() => size.value.w)
const H = computed(() => size.value.h)
const x0 = computed(() => PAD.left)
const x1 = computed(() => Math.max(PAD.left + 40, size.value.w - PAD.right))
const y0 = computed(() => Math.max(PAD.top + 40, size.value.h - PAD.bottom))
const y1 = computed(() => PAD.top)

const maxY = computed(() => {
  if (!model.value) return 400
  const peak = model.value.variants.reduce((m, v) => Math.max(m, v.peakM), model.value.storageM)
  return Math.ceil((peak * 1.04) / 25) * 25
})

function toX(t) {
  const span = model.value?.cycleLen || 1
  return x0.value + (t / span) * (x1.value - x0.value)
}
function toY(q) {
  return y0.value - (q / (maxY.value || 1)) * (y0.value - y1.value)
}

const curves = computed(() => {
  if (!model.value) return []
  return model.value.variants.map((v) => {
    const s = queueSeries(v, 0.5)
    const d = s.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.t).toFixed(2)} ${toY(p.q).toFixed(2)}`).join(' ')
    const peakPt = s.reduce((best, p) => (p.q > best.q ? p : best), s[0])
    return {
      key: v.key,
      tone: v.tone,
      label: v.key === 'before' ? '优化前' : '优化后',
      peakM: v.peakM,
      d,
      area: `${d} L ${toX(model.value.cycleLen).toFixed(2)} ${y0.value} L ${x0.value} ${y0.value} Z`,
      peakX: toX(peakPt.t),
      peakY: toY(v.peakM),
    }
  })
})

const overflow = computed(() =>
  (model.value?.variants || []).map((v) => ({ key: v.key, over: v.peakM > model.value.storageM })),
)

const yTicks = computed(() => {
  const out = []
  for (let q = 0; q <= maxY.value; q += 100) out.push(q)
  return out
})

const xTicks = computed(() => {
  const c = model.value?.cycleLen || 0
  return [0, 0.25, 0.5, 0.75, 1].map((r) => Math.round(c * r))
})

const FADE = 36
const clipW = computed(() => {
  if (drawT.value >= 1) return W.value
  return Math.max(0, x0.value + drawT.value * (x1.value - x0.value) + FADE)
})
const fadeX1 = computed(() => clipW.value)
const fadeX0 = computed(() => Math.max(0, clipW.value - FADE))

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2
}

function applySize(rect) {
  const w = Math.max(360, Math.round(rect.width))
  const h = Math.max(180, Math.round(rect.height))
  if (w === size.value.w && h === size.value.h) return
  size.value = { w, h }
}

let ro = null
let raf = 0
let drawing = false

function startDraw() {
  if (drawing || prefersInstant()) {
    drawT.value = 1
    return
  }
  drawing = true
  drawT.value = 0
  const dur = 2200
  const t0 = performance.now()
  const tick = (now) => {
    const u = Math.min(1, (now - t0) / dur)
    drawT.value = easeInOutCubic(u)
    if (u < 1) raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
}

function bindHost() {
  ro?.disconnect()
  const el = host.value
  if (!el) return
  applySize(el.getBoundingClientRect())
  ro = new ResizeObserver((entries) => {
    const cr = entries[0]?.contentRect
    if (cr && cr.width > 0 && cr.height > 0) applySize(cr)
  })
  ro.observe(el)
}

onMounted(() => {
  nextTick(() => {
    bindHost()
    requestAnimationFrame(startDraw)
  })
})
watch(model, () => nextTick(bindHost))
onUnmounted(() => {
  ro?.disconnect()
  cancelAnimationFrame(raf)
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

    <div ref="host" class="chart-host">
      <svg
        class="chart"
        :viewBox="`0 0 ${W} ${H}`"
        :width="W"
        :height="H"
        preserveAspectRatio="xMinYMin meet"
      >
        <defs>
          <linearGradient id="q-before" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="rgba(255,68,68,0.3)" />
            <stop offset="100%" stop-color="rgba(255,68,68,0)" />
          </linearGradient>
          <linearGradient id="q-after" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="rgba(51,204,136,0.28)" />
            <stop offset="100%" stop-color="rgba(51,204,136,0)" />
          </linearGradient>
          <linearGradient
            :id="`${maskId}-fade`"
            gradientUnits="userSpaceOnUse"
            :x1="fadeX0"
            y1="0"
            :x2="fadeX1"
            y2="0"
          >
            <stop offset="0" stop-color="#fff" />
            <stop offset="1" stop-color="#fff" stop-opacity="0" />
          </linearGradient>
          <mask :id="maskId" maskUnits="userSpaceOnUse">
            <rect x="0" y="0" :width="Math.max(0, fadeX0)" :height="H" fill="#fff" />
            <rect :x="fadeX0" y="0" :width="FADE" :height="H" :fill="`url(#${maskId}-fade)`" />
          </mask>
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

        <g :mask="`url(#${maskId})`">
          <path v-for="c in curves" :key="`a${c.key}`" :class="['area', c.key]" :d="c.area" />
          <path v-for="c in curves" :key="`l${c.key}`" :class="['ln', c.tone]" :d="c.d" />

          <g v-for="c in curves" :key="`p${c.key}`">
            <circle :class="['peak', c.tone]" :cx="c.peakX" :cy="c.peakY" r="4" />
            <text
              v-if="c.key !== 'after'"
              :class="['peak-text', c.tone]"
              :x="c.peakX"
              :y="c.peakY - 9"
              text-anchor="middle"
            >
              {{ Math.round(c.peakM) }} m
            </text>
          </g>
        </g>

        <g class="xtick" v-for="t in xTicks" :key="`x${t}`">
          <text :x="toX(t)" :y="y0 + 18" text-anchor="middle">{{ t }}s</text>
        </g>
      </svg>
    </div>

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
.cycle-queue {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  height: 100%;
}
header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 0 12px; }
h3 { margin: 0; font-size: 13px; font-weight: 500; letter-spacing: 1px; color: var(--cyan); }
.legend { display: flex; gap: 14px; font-size: 11px; color: var(--text-muted); }
.lg { display: inline-flex; align-items: center; gap: 6px; }
.lg i { width: 16px; height: 2px; background: currentColor; }
.lg.before { color: var(--danger); }
.lg.after { color: var(--ok); }
.lg.limit { color: rgba(255, 68, 68, 0.6); }
.lg.limit i { background: repeating-linear-gradient(90deg, currentColor 0 4px, transparent 4px 8px); }

.chart-host {
  flex: 1;
  min-height: 0;
  width: 100%;
  overflow: hidden;
}
.chart {
  display: block;
  width: 100%;
  height: 100%;
}
.grid line { stroke: rgba(0, 229, 255, 0.08); }
.grid text { font-size: 10px; fill: rgba(160, 200, 220, 0.5); font-family: var(--font-mono); }
.axis { stroke: rgba(0, 229, 255, 0.35); }
.over-band { fill: rgba(255, 68, 68, 0.06); }
.limit { stroke: rgba(255, 68, 68, 0.6); stroke-width: 1.2; stroke-dasharray: 6 5; }
.limit-text { font-size: 10px; fill: rgba(255, 120, 120, 0.85); font-family: var(--font-mono); }
.area.before { fill: url(#q-before); }
.area.after { fill: url(#q-after); }
.ln {
  fill: none;
  stroke-width: 1.8;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.ln.danger { stroke: var(--danger); }
.ln.ok { stroke: var(--ok); }
.peak.danger { fill: var(--danger); }
.peak.ok { fill: var(--ok); }
.peak-text { font-size: 11px; font-family: var(--font-mono); }
.peak-text.danger { fill: var(--danger); }
.peak-text.ok { fill: var(--ok); }
.xtick text { font-size: 10px; fill: var(--text-muted); font-family: var(--font-mono); }

.verdict {
  display: flex;
  gap: 12px;
  margin: 0;
  padding: 0 12px 4px;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: 0.4px;
}
.verdict span {
  padding: 4px 10px;
  border-radius: 2px;
}
.verdict .good {
  color: #7dffc0;
  background: rgba(51, 204, 136, 0.16);
  text-shadow: 0 0 10px rgba(51, 204, 136, 0.45);
}
.verdict .bad {
  color: #ff8a8a;
  background: rgba(255, 68, 68, 0.16);
  text-shadow: 0 0 10px rgba(255, 68, 68, 0.45);
}
</style>

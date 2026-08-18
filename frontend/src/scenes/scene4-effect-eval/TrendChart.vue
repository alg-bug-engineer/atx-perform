<script setup>
/** 逐周期趋势折线：一条实测线 + 一条阈值虚线，横轴是试运行周期 */
import { computed } from 'vue'

const props = defineProps({
  title: { type: String, required: true },
  /** 已揭示的取值序列，长度 = 已观察周期数 */
  values: { type: Array, default: () => [] },
  /** 全序列（用于固定纵轴范围，避免逐周期跳动） */
  allValues: { type: Array, default: () => [] },
  threshold: { type: Object, default: null }, // { value, label, tone: 'warn' | 'ok' }
  tone: { type: String, default: 'cyan' }, // cyan | ok | warn
  format: { type: Function, default: (v) => v.toFixed(2) },
})

/** 视口按 4:3 略高，配合 meet 在大屏上基本填满单元格 */
const W = 300
const H = 226
const PAD = { top: 22, right: 48, bottom: 28, left: 42 }

const domain = computed(() => {
  const pool = [...(props.allValues.length ? props.allValues : props.values)]
  if (props.threshold?.value != null) pool.push(props.threshold.value)
  if (!pool.length) return { min: 0, max: 1 }
  const min = Math.min(...pool)
  const max = Math.max(...pool)
  const pad = (max - min) * 0.18 || Math.abs(max) * 0.2 || 0.1
  return { min: min - pad, max: max + pad }
})

function toX(i, n) {
  const span = Math.max(1, n - 1)
  return PAD.left + (i / span) * (W - PAD.left - PAD.right)
}

function toY(v) {
  const { min, max } = domain.value
  const r = (v - min) / (max - min || 1)
  return H - PAD.bottom - r * (H - PAD.top - PAD.bottom)
}

const total = computed(() => (props.allValues.length || props.values.length || 1))

const points = computed(() =>
  props.values.map((v, i) => ({
    x: toX(i, total.value),
    y: toY(v),
    v,
    i,
    risk: isRisk(v),
  })),
)

function isRisk(v) {
  const th = props.threshold
  if (th?.value == null || v == null) return false
  if (th.riskWhen === 'below') return v < th.value
  if (th.riskWhen === 'above') return v >= th.value
  return false
}

const line = computed(() =>
  points.value.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '),
)

const thresholdY = computed(() =>
  props.threshold?.value != null ? toY(props.threshold.value) : null,
)

const last = computed(() => points.value[points.value.length - 1] || null)
</script>

<template>
  <figure class="trend">
    <figcaption>
      <span class="t-title">{{ title }}</span>
      <strong v-if="last" :class="`tone-${tone}`">{{ format(last.v) }}</strong>
    </figcaption>

    <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="xMidYMid meet" class="svg">
      <text class="ax" :x="PAD.left - 6" :y="toY(domain.max) + 4" text-anchor="end">
        {{ format(domain.max) }}
      </text>
      <text class="ax" :x="PAD.left - 6" :y="toY(domain.min) + 4" text-anchor="end">
        {{ format(domain.min) }}
      </text>

      <template v-if="thresholdY != null">
        <line
          class="threshold"
          :class="`tone-${threshold.tone || 'warn'}`"
          :x1="PAD.left"
          :y1="thresholdY"
          :x2="W - PAD.right"
          :y2="thresholdY"
        />
        <text
          class="threshold-text"
          :class="`tone-${threshold.tone || 'warn'}`"
          :x="W - PAD.right + 5"
          :y="thresholdY + 4"
        >
          {{ threshold.label }}
        </text>
      </template>

      <path class="line" :class="`tone-${tone}`" :d="line" />
      <circle
        v-for="p in points"
        :key="`p${p.i}`"
        class="dot"
        :class="p.risk ? 'tone-danger' : `tone-${tone}`"
        :cx="p.x"
        :cy="p.y"
        r="3.2"
      />

      <text
        v-for="p in points"
        :key="`x${p.i}`"
        class="ax"
        :x="p.x"
        :y="H - 8"
        text-anchor="middle"
      >
        {{ p.i + 1 }}
      </text>
    </svg>
  </figure>
</template>

<style scoped>
.trend {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  min-height: 0;
  padding: 8px 10px;
  border: 1px solid var(--cyan-border);
  border-radius: 3px;
  background: rgba(2, 12, 26, 0.55);
}

figcaption {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.t-title {
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--text-muted);
}

figcaption strong {
  font-size: 15px;
  font-weight: 500;
}

.svg {
  width: 100%;
  height: 100%;
  min-height: 96px;
  display: block;
}

.ax {
  font-size: 9px;
  fill: var(--text);
  font-family: var(--font-mono);
}

.line {
  fill: none;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.threshold {
  stroke-dasharray: 5 4;
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.threshold-text {
  font-size: 9px;
  font-family: var(--font-mono);
}

.tone-cyan { color: var(--cyan); stroke: var(--cyan); }
.tone-ok { color: var(--ok); stroke: var(--ok); }
.tone-warn { color: var(--warn); stroke: var(--warn); }
.tone-danger { color: var(--danger); stroke: var(--danger); }

.dot.tone-cyan { fill: var(--cyan); }
.dot.tone-ok { fill: var(--ok); }
.dot.tone-warn { fill: var(--warn); }
.dot.tone-danger { fill: var(--danger); }

.threshold.tone-warn,
.threshold-text.tone-warn { stroke: rgba(255, 68, 68, 0.7); fill: rgba(255, 120, 120, 0.9); }
.threshold.tone-ok,
.threshold-text.tone-ok { stroke: rgba(51, 204, 136, 0.6); fill: rgba(120, 220, 175, 0.9); }
</style>

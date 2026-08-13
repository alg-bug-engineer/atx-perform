<script setup>
/** 回滚护栏：上游排队比半环表 + 逐周期状态胶囊 */
import { computed } from 'vue'

const props = defineProps({
  cycles: { type: Array, required: true },
  revealed: { type: Number, default: 0 },
  current: { type: Number, default: 0 },
  warning: { type: Number, default: 0.8 },
  rollback: { type: Number, default: 0.9 },
})

const MAX = 1
const W = 210
const H = 112
const CX = W / 2
const CY = 100
const R = 80

function angle(v) {
  return Math.PI * (1 - Math.min(1, Math.max(0, v / MAX)))
}
function pt(v, r = R) {
  const a = angle(v)
  return [CX + Math.cos(a) * r, CY - Math.sin(a) * r]
}
function arc(from, to, r = R) {
  const [x0, y0] = pt(from, r)
  const [x1, y1] = pt(to, r)
  return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`
}

const knob = computed(() => pt(props.current))
const valueArc = computed(() => arc(0, Math.max(props.current, 0.001)))
const safe = computed(() => props.current < props.warning)
const margin = computed(() => (props.rollback - props.current).toFixed(2))
</script>

<template>
  <section class="guard" data-testid="trial-guard-rail">
    <div class="gauge">
      <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="xMidYMax meet">
        <path class="band ok" :d="arc(0, warning)" />
        <path class="band warn" :d="arc(warning, rollback)" />
        <path class="band danger" :d="arc(rollback, MAX)" />
        <path class="value-arc" :class="{ safe }" :d="valueArc" />
        <line
          class="tick"
          :x1="pt(rollback, R - 10)[0]"
          :y1="pt(rollback, R - 10)[1]"
          :x2="pt(rollback, R + 10)[0]"
          :y2="pt(rollback, R + 10)[1]"
        />
        <circle class="knob" :class="{ safe }" :cx="knob[0]" :cy="knob[1]" r="5" />
        <text class="val" :x="CX" :y="CY - 26" :class="{ safe }">{{ current.toFixed(2) }}</text>
        <text class="cap" :x="CX" :y="CY - 9">上游排队比</text>
        <text class="edge" :x="CX - R" :y="CY + 12" text-anchor="middle">0</text>
        <text class="edge" :x="CX + R" :y="CY + 12" text-anchor="middle">1.0</text>
      </svg>
    </div>

    <div class="info">
      <p class="title">回滚护栏 · 上游解放东路口</p>
      <p class="line">
        回滚线 {{ rollback }}，当前
        <b :class="{ safe }">{{ current.toFixed(2) }}</b>
        ，余量 <b class="safe">{{ margin }}</b>
      </p>
      <div class="caps">
        <span
          v-for="c in cycles"
          :key="c.index"
          class="cap-item"
          :class="{
            done: c.index <= revealed && !c.rolled_back,
            risk: c.index <= revealed && c.spillover_risk,
            back: c.rolled_back,
          }"
        >
          C{{ c.index }}
          <i>{{ c.index <= revealed ? c.downstream_queue_ratio.toFixed(2) : '—' }}</i>
        </span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.guard {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  align-items: center;
  gap: 14px;
  min-height: 0;
}
.gauge { height: 100%; min-height: 0; }
svg { width: 100%; height: 100%; display: block; }
.band { fill: none; stroke-width: 8; stroke-linecap: butt; }
.band.ok { stroke: rgba(51, 204, 136, 0.18); }
.band.warn { stroke: rgba(255, 176, 32, 0.32); }
.band.danger { stroke: rgba(255, 68, 68, 0.4); }
.value-arc {
  fill: none;
  stroke: var(--warn);
  stroke-width: 8;
  filter: drop-shadow(0 0 5px rgba(255, 176, 32, 0.55));
  transition: d 0.6s ease;
}
.value-arc.safe { stroke: var(--ok); filter: drop-shadow(0 0 5px rgba(51, 204, 136, 0.55)); }
.tick { stroke: rgba(255, 68, 68, 0.95); stroke-width: 2; }
.knob { fill: var(--warn); stroke: rgba(4, 14, 26, 0.9); stroke-width: 2; }
.knob.safe { fill: var(--ok); }
.val { font-size: 26px; font-family: var(--font-mono); fill: var(--warn); text-anchor: middle; }
.val.safe { fill: var(--ok); }
.cap { font-size: 9.5px; fill: var(--text-muted); text-anchor: middle; }
.edge { font-size: 9px; fill: rgba(160, 200, 220, 0.4); }

.info { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.title { margin: 0; font-size: 12px; color: var(--cyan); letter-spacing: 1px; }
.line { margin: 0; font-size: 11px; color: var(--text-muted); }
.line b { font-family: var(--font-mono); color: var(--warn); }
.line b.safe { color: var(--ok); }
.caps { display: flex; gap: 6px; flex-wrap: wrap; }
.cap-item {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 2px;
  border: 1px solid var(--cyan-border);
  background: rgba(0, 20, 34, 0.55);
  font-size: 10px;
  color: rgba(160, 200, 220, 0.4);
}
.cap-item i { font-style: normal; font-family: var(--font-mono); font-size: 11px; }
.cap-item.done { border-color: rgba(51, 204, 136, 0.45); color: var(--ok); }
.cap-item.risk { border-color: rgba(255, 176, 32, 0.5); color: var(--warn); }
.cap-item.back { border-color: rgba(255, 68, 68, 0.55); color: var(--danger); }
</style>

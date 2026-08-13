<script setup>
/** 治理画像：五个维度统一归一到「越外圈越好」，基线与试运行后叠成两层 */
import { computed } from 'vue'

const props = defineProps({
  axes: { type: Array, required: true },
  revealed: { type: Boolean, default: false },
})

const S = 260
const C = S / 2
const R = 84

function point(i, ratio) {
  const a = (Math.PI * 2 * i) / props.axes.length - Math.PI / 2
  const r = R * Math.max(0.04, Math.min(1, ratio))
  return [C + Math.cos(a) * r, C + Math.sin(a) * r]
}
function poly(key) {
  return props.axes.map((ax, i) => point(i, ax[key]).map((n) => n.toFixed(1)).join(',')).join(' ')
}

const rings = [0.25, 0.5, 0.75, 1]
const spokes = computed(() => props.axes.map((_, i) => point(i, 1)))
const labels = computed(() =>
  props.axes.map((ax, i) => {
    const [x, y] = point(i, 1.3)
    return { ...ax, x, y, anchor: x > C + 6 ? 'start' : x < C - 6 ? 'end' : 'middle' }
  }),
)
</script>

<template>
  <section class="radar" data-testid="governance-radar">
    <header>
      <h3>治理画像</h3>
      <div class="legend">
        <span class="lg base"><i />基线</span>
        <span class="lg now"><i />试运行后</span>
      </div>
    </header>
    <svg :viewBox="`0 0 ${S} ${S}`" preserveAspectRatio="xMidYMid meet">
      <defs>
        <filter id="radar-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      <circle v-for="r in rings" :key="`r${r}`" class="ring" :cx="C" :cy="C" :r="R * r" />
      <line v-for="(p, i) in spokes" :key="`s${i}`" class="spoke" :x1="C" :y1="C" :x2="p[0]" :y2="p[1]" />

      <polygon class="shape base" :points="poly('base')" />
      <polygon
        class="shape now"
        :points="revealed ? poly('now') : poly('base')"
        filter="url(#radar-glow)"
      />

      <circle
        v-for="(ax, i) in axes"
        :key="`d${i}`"
        class="node"
        :cx="point(i, revealed ? ax.now : ax.base)[0]"
        :cy="point(i, revealed ? ax.now : ax.base)[1]"
        r="3.2"
      />

      <g v-for="(l, i) in labels" :key="`l${i}`">
        <text class="ax-name" :x="l.x" :y="l.y" :text-anchor="l.anchor">{{ l.name }}</text>
        <text class="ax-val" :x="l.x" :y="l.y + 13" :text-anchor="l.anchor">{{ l.text }}</text>
      </g>
    </svg>
  </section>
</template>

<style scoped>
.radar { display: flex; flex-direction: column; gap: 6px; min-height: 0; }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
h3 { margin: 0; font-size: 13px; font-weight: 500; letter-spacing: 1px; color: var(--cyan); }
.legend { display: flex; gap: 12px; font-size: 11px; color: var(--text-muted); }
.lg { display: inline-flex; align-items: center; gap: 5px; }
.lg i { width: 12px; height: 8px; border-radius: 1px; }
.lg.base i { background: rgba(255, 68, 68, 0.35); box-shadow: inset 0 0 0 1px rgba(255, 68, 68, 0.7); }
.lg.now i { background: rgba(51, 204, 136, 0.4); box-shadow: inset 0 0 0 1px var(--ok); }

svg { width: 100%; height: 100%; min-height: 0; display: block; }
.ring { fill: none; stroke: rgba(0, 229, 255, 0.1); }
.spoke { stroke: rgba(0, 229, 255, 0.12); }
.shape { stroke-width: 1.6; }
.shape.base { fill: rgba(255, 68, 68, 0.12); stroke: rgba(255, 68, 68, 0.6); stroke-dasharray: 4 3; }
.shape.now {
  fill: rgba(51, 204, 136, 0.22);
  stroke: var(--ok);
  stroke-width: 2;
  transition: all 0.9s cubic-bezier(0.22, 1, 0.36, 1);
}
.node { fill: var(--ok); }
.ax-name { font-size: 11px; fill: var(--text-muted); }
.ax-val { font-size: 10px; fill: rgba(51, 204, 136, 0.85); font-family: var(--font-mono); }
</style>

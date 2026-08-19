<script setup>
/**
 * 双灯对时：经十南北直行 vs 解放东北直。给政务汇报做相序图的白话版。
 * 路名用 HTML 标注，避免绿条 SVG 横向拉伸时把文字压扁。
 */
import { computed } from 'vue'

const props = defineProps({
  title: { type: String, required: true },
  hint: { type: String, default: '' },
  keyWord: { type: String, default: '' },
  compact: { type: Boolean, default: false },
  tone: { type: String, default: 'ok' },
  cycleLen: { type: Number, default: 220 },
  t: { type: Number, default: 0 },
  jingshi: { type: Array, default: () => [] },
  jiefang: { type: Array, default: () => [] },
})

const W = computed(() => props.cycleLen || 220)
const ROW = 11

function segs(bands) {
  const out = []
  for (const b of bands || []) {
    const s = ((b.start % props.cycleLen) + props.cycleLen) % props.cycleLen
    const d = Math.min(b.dur, props.cycleLen)
    if (s + d <= props.cycleLen) out.push({ x: s, w: d })
    else {
      out.push({ x: s, w: props.cycleLen - s })
      out.push({ x: 0, w: d - (props.cycleLen - s) })
    }
  }
  return out
}

const jingshiSegs = computed(() => segs(props.jingshi))
const jiefangSegs = computed(() => segs(props.jiefang))
const playX = computed(() => ((props.t % props.cycleLen) + props.cycleLen) % props.cycleLen)
</script>

<template>
  <aside class="align" :class="[`tone-${tone}`, { compact }]">
    <header>
      <strong>{{ title }}</strong>
      <span>{{ hint }} <em v-if="keyWord">{{ keyWord }}</em></span>
    </header>
    <div class="chart">
      <div class="labs">
        <span>经十路</span>
        <span>解放东</span>
      </div>
      <svg class="bars" :viewBox="`0 0 ${W} 28`" preserveAspectRatio="none">
        <g v-for="row in [
            { y: 2, segs: jingshiSegs },
            { y: 15, segs: jiefangSegs },
          ]"
          :key="row.y"
        >
          <rect class="track" :x="0" :y="row.y" :width="W" :height="ROW" />
          <rect
            v-for="(s, k) in row.segs"
            :key="k"
            class="g"
            :x="s.x"
            :y="row.y"
            :width="Math.max(0.8, s.w)"
            :height="ROW"
          />
        </g>
        <line class="play" :x1="playX" y1="1" :x2="playX" y2="27" />
      </svg>
    </div>
  </aside>
</template>

<style scoped>
.align {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 6px 8px 7px;
  border: 1px solid var(--cyan-border);
  border-left: 3px solid var(--cyan-border);
  background: rgba(0, 16, 28, 0.55);
}
.align.tone-danger { border-left-color: var(--danger); }
.align.tone-ok { border-left-color: var(--ok); }
header {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  text-align: center;
}
header strong {
  flex: none;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 3px;
  line-height: 1.2;
  color: var(--text);
}
.align.tone-danger header strong { color: var(--danger); }
.align.tone-ok header strong { color: var(--ok); }
header span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-muted);
}
header em {
  margin-left: 4px;
  font-style: normal;
  font-weight: 600;
}
.align.tone-danger header em { color: var(--danger); }
.align.tone-ok header em { color: var(--ok); }
.align.compact {
  padding: 2px 0 0;
  border: none;
  border-left: none;
  background: transparent;
}
.chart {
  display: grid;
  grid-template-columns: 48px 1fr;
  gap: 8px;
  align-items: stretch;
  min-width: 0;
}
.labs {
  display: flex;
  flex-direction: column;
  justify-content: space-around;
  font-size: 12px;
  line-height: 1;
  color: var(--text);
  white-space: nowrap;
}
.bars { width: 100%; height: 36px; display: block; }
.track { fill: rgba(8, 28, 44, 0.9); }
.g { fill: rgba(51, 204, 136, 0.78); }
.play { stroke: #fff; stroke-width: 1.2; }
</style>

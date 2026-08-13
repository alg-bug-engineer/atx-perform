<script setup>
/**
 * 主视觉：把排队长度放回「路段还剩多少蓄车能力」这把尺子上，
 * 让优化前突破蓄车边界这件事一眼可见。
 */
import { computed } from 'vue'

const props = defineProps({
  storageM: { type: Number, required: true },
  rows: { type: Array, required: true },
  revealed: { type: Boolean, default: false },
})

const scaleMax = computed(() => {
  const peak = Math.max(props.storageM, ...props.rows.map((r) => r.value))
  return Math.ceil((peak * 1.1) / 20) * 20
})

function pct(v) {
  return `${Math.min(100, (v / scaleMax.value) * 100)}%`
}
const limitLeft = computed(() => `${(props.storageM / scaleMax.value) * 100}%`)
const overflowWidth = computed(() => `${100 - (props.storageM / scaleMax.value) * 100}%`)

const ticks = computed(() => {
  const step = 100
  const out = []
  for (let v = 0; v <= scaleMax.value; v += step) {
    out.push({ v, left: `${(v / scaleMax.value) * 100}%` })
  }
  return out
})
</script>

<template>
  <section class="hero" data-testid="queue-capacity-hero">
    <header>
      <h3>路段蓄车占用</h3>
      <span class="cap">蓄车能力 {{ Math.round(storageM) }} m</span>
    </header>

    <div class="scale">
      <div class="track-layer">
        <div class="overflow-zone" :style="{ left: limitLeft, width: overflowWidth }">
          <span>溢出</span>
        </div>
        <div v-for="t in ticks" :key="t.v" class="tick" :style="{ left: t.left }">
          <span>{{ t.v }}</span>
        </div>
        <div class="limit" :style="{ left: limitLeft }">
          <span>蓄车边界</span>
        </div>
      </div>

      <div v-for="r in rows" :key="r.key" class="row" :class="[r.tone, { grouped: r.groupStart }]">
        <span class="row-group" v-if="r.groupStart">{{ r.group }}</span>
        <span class="row-label">{{ r.label }}</span>
        <div class="track">
          <div class="fill" :style="{ width: revealed ? pct(r.value) : '0%' }" />
          <div v-if="r.value > storageM" class="spill" :style="{ left: limitLeft, width: pct(r.value - storageM) }" />
        </div>
        <strong class="row-val">{{ Math.round(r.value) }}<i>m</i></strong>
      </div>
    </div>

    <p class="foot">
      优化前单周期峰值越过蓄车边界，队尾压回上游路口；优化后峰值全程留在边界内。
    </p>
  </section>
</template>

<style scoped>
.hero { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
h3 { margin: 0; font-size: 13px; font-weight: 500; letter-spacing: 1px; color: var(--cyan); }
.cap { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }

.scale {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 13px;
  flex: 1;
  min-height: 0;
}
/* 覆盖层只盖住条形所在的中间列，和 .row 的网格保持一致 */
.track-layer {
  position: absolute;
  top: 14px;
  bottom: 15px;
  left: 102px;
  right: 84px;
  pointer-events: none;
}
.tick {
  position: absolute;
  top: 6px;
  bottom: 0;
  width: 0;
  border-left: 1px solid rgba(0, 229, 255, 0.09);
}
.tick span {
  position: absolute;
  bottom: -15px;
  left: -14px;
  width: 28px;
  text-align: center;
  font-size: 9px;
  font-family: var(--font-mono);
  color: rgba(160, 200, 220, 0.38);
}
.overflow-zone {
  position: absolute;
  top: 0;
  bottom: 0;
  background: repeating-linear-gradient(
    45deg,
    rgba(255, 68, 68, 0.13) 0 5px,
    rgba(255, 68, 68, 0.03) 5px 10px
  );
}
.overflow-zone span {
  position: absolute;
  bottom: 1px;
  left: 5px;
  font-size: 10px;
  color: rgba(255, 120, 120, 0.75);
}
.limit {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  border-left: 1.5px dashed rgba(255, 68, 68, 0.75);
}
.limit span {
  position: absolute;
  top: -14px;
  left: -34px;
  width: 68px;
  text-align: center;
  font-size: 10px;
  color: rgba(255, 120, 120, 0.85);
}

.row {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr) 74px;
  align-items: center;
  gap: 10px;
  position: relative;
}
.row.grouped { margin-top: 16px; }
.row-group {
  position: absolute;
  top: -14px;
  left: 0;
  font-size: 10px;
  letter-spacing: 1px;
  color: var(--cyan-dim);
}
.row-label { font-size: 12px; color: var(--text-muted); }
.track {
  position: relative;
  height: 26px;
  border-radius: 2px;
  background: rgba(0, 229, 255, 0.06);
  box-shadow: inset 0 0 0 1px rgba(0, 229, 255, 0.12);
}
.fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.9s cubic-bezier(0.22, 1, 0.36, 1);
}
.row.bad .fill {
  background: linear-gradient(90deg, rgba(255, 68, 68, 0.6), rgba(255, 68, 68, 0.95));
  box-shadow: 0 0 10px rgba(255, 68, 68, 0.28);
}
.row.warn .fill {
  background: linear-gradient(90deg, rgba(255, 176, 32, 0.55), rgba(255, 176, 32, 0.92));
  box-shadow: 0 0 10px rgba(255, 176, 32, 0.22);
}
.row.good .fill {
  background: linear-gradient(90deg, rgba(51, 204, 136, 0.6), rgba(51, 204, 136, 0.95));
  box-shadow: 0 0 10px rgba(51, 204, 136, 0.28);
}
.spill {
  position: absolute;
  top: -2px;
  bottom: -2px;
  border-radius: 2px;
  background: rgba(255, 68, 68, 0.95);
  box-shadow: 0 0 12px rgba(255, 68, 68, 0.7);
  animation: spill-pulse 1.4s ease-in-out infinite;
}
@keyframes spill-pulse {
  0%, 100% { opacity: 0.72; }
  50% { opacity: 1; }
}
.row-val {
  font-size: 19px;
  font-weight: 500;
  font-family: var(--font-mono);
  text-align: right;
  color: var(--text);
}
.row.bad .row-val { color: var(--danger); }
.row.warn .row-val { color: var(--warn); }
.row.good .row-val { color: var(--ok); }
.row-val i { font-size: 11px; font-style: normal; margin-left: 2px; color: var(--text-muted); }

.foot { margin: 0; font-size: 11px; line-height: 1.45; color: rgba(160, 200, 220, 0.5); }
</style>

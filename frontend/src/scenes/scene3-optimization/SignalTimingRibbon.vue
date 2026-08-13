<script setup>
/**
 * 共用配时条：两个方案画在同一条周期时间轴上。
 * 经十路全盘不动 → 只画一条；差别只在解放东放行时机，现状与优化后各一条，
 * 上下对齐后能直接看出「先放谁」以及排队随之怎么变。
 */
import { computed } from 'vue'

const props = defineProps({
  model: { type: Object, required: true },
  /** 当前播放位置（秒，相对展示窗口起点） */
  t: { type: Number, default: 0 },
})

const cycleLen = computed(() => props.model.cycleLen || 1)

/** 绝对秒 → 展示窗口内的相对秒；跨周期的窗口切成两段 */
function toSpans(windows, absStartS) {
  const out = []
  for (const w of windows || []) {
    let s = w.start - absStartS
    let e = w.end - absStartS
    if (e <= 0 || s >= cycleLen.value) continue
    s = Math.max(0, s)
    e = Math.min(cycleLen.value, e)
    if (e > s) out.push({ s, e })
  }
  return out
}

function variantOf(key) {
  return props.model.variants.find((v) => v.key === key)
}

function jiefangSpans(variant) {
  const r = variant?.result
  if (!r) return []
  const merged = []
  for (const g of r.greens.jiefang || []) {
    merged.push(...toSpans(g.windows, r.absStartS))
  }
  return merged.sort((a, b) => a.s - b.s)
}

const before = computed(() => variantOf('before'))
const after = computed(() => variantOf('after'))

const jingshiSpans = computed(() => {
  const r = before.value?.result
  return r ? toSpans(r.greens.through, r.absStartS) : []
})

/** 经十路两方案是否真的一模一样（方案承诺全盘不动，这里做个自检） */
const jingshiSame = computed(() => {
  const a = JSON.stringify(jingshiSpans.value)
  const r = after.value?.result
  const b = JSON.stringify(r ? toSpans(r.greens.through, r.absStartS) : [])
  return a === b
})

const lanes = computed(() => [
  {
    key: 'jingshi',
    label: jingshiSame.value ? '经十路 南北直行（两方案一致）' : '经十路 南北直行 · 现状',
    tone: 'trunk',
    spans: jingshiSpans.value,
  },
  {
    key: 'jiefang-before',
    label: '解放东 放行 · 现状配时',
    tone: 'before',
    spans: jiefangSpans(before.value),
  },
  {
    key: 'jiefang-after',
    label: '解放东 放行 · 相位协调后',
    tone: 'after',
    spans: jiefangSpans(after.value),
  },
])

const pct = (v) => `${(v / cycleLen.value) * 100}%`
const playhead = computed(() => `${(props.t / cycleLen.value) * 100}%`)

/** 每 20 s 一根刻度，作为对齐粒度 */
const ticks = computed(() => {
  const step = cycleLen.value > 160 ? 20 : 10
  const out = []
  for (let s = step; s < cycleLen.value; s += step) out.push(s)
  return out
})
</script>

<template>
  <section class="ribbon" aria-label="共用信号配时">
    <div v-for="lane in lanes" :key="lane.key" class="lane">
      <span class="lane-label">{{ lane.label }}</span>
      <div class="track">
        <span v-for="s in ticks" :key="`tk${s}`" class="tick" :style="{ left: pct(s) }" />
        <span
          v-for="(sp, i) in lane.spans"
          :key="`sp${i}`"
          class="green"
          :class="lane.tone"
          :style="{ left: pct(sp.s), width: pct(sp.e - sp.s) }"
        />
        <span class="playhead" :style="{ left: playhead }" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.ribbon {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 7px 12px;
  border: 1px solid var(--cyan-border);
  border-radius: 3px;
  background: rgba(0, 18, 32, 0.55);
}

.lane {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}

.lane-label {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.track {
  position: relative;
  height: 12px;
  border: 1px solid rgba(0, 229, 255, 0.16);
  background: rgba(4, 14, 26, 0.85);
}

.tick {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(0, 229, 255, 0.14);
}

.green {
  position: absolute;
  top: 1px;
  bottom: 1px;
  border-radius: 1px;
}

.green.trunk {
  background: rgba(0, 229, 255, 0.55);
}

.green.before {
  background: rgba(255, 68, 68, 0.6);
}

.green.after {
  background: rgba(51, 204, 136, 0.65);
}

.playhead {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 1.5px;
  background: var(--warn);
  box-shadow: 0 0 6px rgba(255, 204, 0, 0.7);
}
</style>

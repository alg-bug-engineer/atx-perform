<script setup>
/**
 * 共用配时轴（竖排，贯穿现状 / 协调后两幅走廊）。
 * 经十路全盘不动 → 只画一条；差别只在解放东放行时机，现状与协调后各一条。
 * 时间自上而下走，播放头横贯三条轨道 —— 两幅走廊看的是同一时刻。
 */
import { computed } from 'vue'

const props = defineProps({
  model: { type: Object, required: true },
  /** 当前播放位置（秒，相对展示窗口起点） */
  t: { type: Number, default: 0 },
})

const cycleLen = computed(() => props.model.cycleLen || 1)

/** 绝对秒 → 展示窗口内的相对秒 */
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
  for (const g of r.greens.jiefang || []) merged.push(...toSpans(g.windows, r.absStartS))
  return merged.sort((a, b) => a.s - b.s)
}

const before = computed(() => variantOf('before'))
const after = computed(() => variantOf('after'))

const jingshiSpans = computed(() => {
  const r = before.value?.result
  return r ? toSpans(r.greens.through, r.absStartS) : []
})

/** 方案承诺经十路全盘不动，这里做个自检 */
const jingshiSame = computed(() => {
  const r = after.value?.result
  return (
    JSON.stringify(jingshiSpans.value)
    === JSON.stringify(r ? toSpans(r.greens.through, r.absStartS) : [])
  )
})

const lanes = computed(() => [
  { key: 'jingshi', short: '经十路', tone: 'trunk', spans: jingshiSpans.value },
  { key: 'before', short: '现状', tone: 'before', spans: jiefangSpans(before.value) },
  { key: 'after', short: '协调后', tone: 'after', spans: jiefangSpans(after.value) },
])

const pct = (v) => `${(v / cycleLen.value) * 100}%`
const playhead = computed(() => `${(props.t / cycleLen.value) * 100}%`)

/** 刻度即对齐粒度 */
const ticks = computed(() => {
  const step = cycleLen.value > 160 ? 40 : 20
  const out = [0]
  for (let s = step; s < cycleLen.value; s += step) out.push(s)
  return out
})
</script>

<template>
  <section class="ribbon" aria-label="共用信号配时">
    <header class="hd">
      <span class="hd-title">共用配时</span>
      <span class="hd-sub">周期 {{ cycleLen }} s</span>
    </header>

    <div class="grid">
      <div class="axis">
        <span v-for="tk in ticks" :key="`ax${tk}`" class="axis-tick" :style="{ top: pct(tk) }">
          {{ tk }}s
        </span>
      </div>

      <div v-for="lane in lanes" :key="lane.key" class="lane">
        <span class="lane-label">{{ lane.short }}</span>
        <div class="track">
          <span v-for="tk in ticks" :key="`tk${tk}`" class="tick" :style="{ top: pct(tk) }" />
          <span
            v-for="(sp, i) in lane.spans"
            :key="`sp${i}`"
            class="green"
            :class="lane.tone"
            :style="{ top: pct(sp.s), height: pct(sp.e - sp.s) }"
          />
        </div>
      </div>

      <div class="playhead" :style="{ top: playhead }">
        <span class="playhead-num">{{ Math.round(t) }}s</span>
      </div>
    </div>

    <footer class="legend">
      <span class="lg trunk">经十路 南北直行{{ jingshiSame ? '（两方案一致）' : '' }}</span>
      <span class="lg before">解放东 放行 · 现状</span>
      <span class="lg after">解放东 放行 · 协调后</span>
    </footer>
  </section>
</template>

<style scoped>
.ribbon {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  padding: 9px 10px 10px;
  border: 1px solid var(--cyan-border);
  border-radius: 3px;
  background: rgba(0, 18, 32, 0.55);
}

.hd {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  flex: none;
}

.hd-title {
  font-size: 12px;
  letter-spacing: 2px;
  color: var(--cyan-dim);
}

.hd-sub {
  font-size: 10px;
  color: var(--text-muted);
}

.grid {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: 30px repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.axis {
  position: relative;
}

.axis-tick {
  position: absolute;
  right: 0;
  transform: translateY(-50%);
  font-size: 9px;
  color: rgba(160, 200, 220, 0.5);
  font-family: var(--font-mono);
}

.lane {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
}

.lane-label {
  flex: none;
  font-size: 10px;
  text-align: center;
  color: var(--text-muted);
  white-space: nowrap;
}

.track {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  border: 1px solid rgba(0, 229, 255, 0.16);
  background: rgba(4, 14, 26, 0.85);
}

.tick {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: rgba(0, 229, 255, 0.12);
}

.green {
  position: absolute;
  left: 1px;
  right: 1px;
  border-radius: 1px;
}

.green.trunk { background: rgba(0, 229, 255, 0.55); }
.green.before { background: rgba(255, 68, 68, 0.6); }
.green.after { background: rgba(51, 204, 136, 0.65); }

/* 播放头横贯三条轨道：两幅走廊画的是同一时刻 */
.playhead {
  position: absolute;
  left: 30px;
  right: 0;
  height: 1.5px;
  margin-top: 17px;
  background: var(--warn);
  box-shadow: 0 0 6px rgba(255, 204, 0, 0.7);
  pointer-events: none;
}

.playhead-num {
  position: absolute;
  right: 0;
  top: -13px;
  font-size: 9px;
  color: var(--warn);
  font-family: var(--font-mono);
}

.legend {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: none;
  font-size: 9.5px;
  color: var(--text-muted);
}

.lg {
  display: flex;
  align-items: center;
  gap: 5px;
  line-height: 1.3;
}

.lg::before {
  content: '';
  width: 9px;
  height: 3px;
  flex: none;
}

.lg.trunk::before { background: rgba(0, 229, 255, 0.55); }
.lg.before::before { background: rgba(255, 68, 68, 0.6); }
.lg.after::before { background: rgba(51, 204, 136, 0.65); }
</style>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import CorridorStage from './CorridorStage.vue'
import SignalTimingRibbon from './SignalTimingRibbon.vue'
import { buildCorridorDemo, sampleVariant } from './corridorDemo.js'

const props = defineProps({
  payload: { type: Object, required: true },
})

const model = computed(() => buildCorridorDemo(props.payload))
const timing = computed(() => props.payload?.optimized_signal_plans || {})
const jingshiPlan = computed(() => props.payload?.baseline_signal_plans?.jingshi?.plan?.config || {})

const t = ref(0)
const playing = ref(true)
const speed = ref(model.value?.playback?.default_speed || 12)
const speedOptions = computed(() => model.value?.playback?.speed_options || [4, 8, 12, 20])

let raf = 0
let last = 0

function tick(now) {
  if (last) {
    const dt = Math.min((now - last) / 1000, 0.25)
    if (playing.value) {
      const next = t.value + dt * speed.value
      t.value = next >= model.value.cycleLen ? 0 : next
    }
  }
  last = now
  raf = requestAnimationFrame(tick)
}

onMounted(() => {
  raf = requestAnimationFrame(tick)
})
onBeforeUnmount(() => cancelAnimationFrame(raf))

const samples = computed(() =>
  Object.fromEntries(model.value.variants.map((v) => [v.key, sampleVariant(v, t.value)])),
)

/** 时间轴刻度：各放行窗口的起讫点，方便对照哪一段在放行、哪一段在汇入 */
const markers = computed(() => {
  const set = new Set()
  for (const v of model.value.variants) {
    const r = v.result
    const rel = (abs) => abs - r.absStartS
    const push = (w) => {
      for (const x of [rel(w.start), rel(w.end)]) {
        if (x > 2 && x < model.value.cycleLen - 2) set.add(Math.round(x))
      }
    }
    r.greens.through.forEach(push)
    r.greens.jiefang.forEach((g) => g.windows.forEach(push))
  }
  return [...set].sort((a, b) => a - b)
})

function replay() {
  t.value = 0
  playing.value = true
}
function onScrub(e) {
  t.value = Number(e.target.value)
}

const measureChips = computed(() => {
  const rel = timing.value.release_timing_vs_downstream_green_sec || {}
  const geo = model.value.geometry || {}
  return [
    { k: '共同周期', v: `${jingshiPlan.value.cycle_len_sec || model.value.cycleLen} s`, tone: 'hold' },
    {
      k: '解放东放行时机',
      v: `下游绿灯前 ${Math.abs(rel.before ?? 0)} s → 绿灯后 ${rel.after ?? 0} s`,
      tone: 'change',
    },
    { k: '进口道展宽', v: `${geo.widen_len_m || 100} m · 3 车道 → 5 车道`, tone: 'hold' },
    { k: '经十路配时', v: '全盘不动', tone: 'hold' },
  ]
})

</script>

<template>
  <section v-if="model" class="plan-compare" data-testid="plan-compare">
    <header class="head">
      <div class="head-main">
        <p class="eyebrow">优化方案</p>
        <h2>相位协调：让经十路先放走队列，解放东再汇入</h2>
        <p class="lede">
          {{ timing.summary }}
        </p>
      </div>
      <div class="chips">
        <div v-for="c in measureChips" :key="c.k" class="chip" :class="c.tone">
          <span>{{ c.k }}</span>
          <strong>{{ c.v }}</strong>
        </div>
      </div>
    </header>

    <div class="controls">
      <button type="button" class="ctl" @click="playing = !playing">
        {{ playing ? '暂停' : '播放' }}
      </button>
      <button type="button" class="ctl ghost" @click="replay">重播</button>
      <div class="track">
        <input
          type="range"
          min="0"
          :max="model.cycleLen"
          step="0.5"
          :value="t"
          @input="onScrub"
          aria-label="演示进度"
        />
        <span
          v-for="m in markers"
          :key="`mk${m}`"
          class="marker"
          :style="{ left: `${(m / model.cycleLen) * 100}%` }"
        />
      </div>
      <span class="clock">{{ Math.round(t) }} / {{ model.cycleLen }} s</span>
      <div class="speeds">
        <button
          v-for="s in speedOptions"
          :key="s"
          type="button"
          class="ctl tiny"
          :class="{ on: speed === s }"
          @click="speed = s"
        >
          {{ s }}×
        </button>
      </div>
    </div>

    <SignalTimingRibbon :model="model" :t="t" />

    <div class="stages">
      <CorridorStage
        v-for="v in model.variants"
        :key="v.key"
        :model="model"
        :variant="v"
        :sample="samples[v.key]"
      />
    </div>
  </section>
</template>

<style scoped>
.plan-compare {
  display: grid;
  grid-template-rows: auto auto auto minmax(250px, 1fr);
  gap: 10px;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.head {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
}
.eyebrow {
  margin: 0 0 4px;
  font-size: 11px;
  letter-spacing: 4px;
  color: var(--cyan-dim);
}
h2 {
  margin: 0 0 4px;
  font-size: 21px;
  font-weight: 500;
  letter-spacing: 1px;
  color: var(--text);
}
.lede {
  margin: 0;
  max-width: 96ch;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
}
.chips { display: flex; gap: 8px; flex-wrap: wrap; }
.chip {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 5px 12px;
  border: 1px solid var(--cyan-border);
  border-radius: 3px;
  background: rgba(0, 22, 38, 0.6);
}
.chip span { font-size: 11px; color: var(--text-muted); }
.chip strong { font-size: 13px; font-weight: 500; color: var(--cyan); }
.chip.change { border-color: rgba(51, 204, 136, 0.5); }
.chip.change strong { color: var(--ok); }

.controls {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  border: 1px solid var(--cyan-border);
  border-radius: 3px;
  background: rgba(0, 18, 32, 0.55);
}
.ctl {
  padding: 5px 14px;
  font-size: 12px;
  letter-spacing: 1px;
  color: var(--cyan);
  background: rgba(0, 229, 255, 0.08);
  border: 1px solid var(--cyan-border-strong);
  border-radius: 2px;
  cursor: pointer;
}
.ctl:hover { background: rgba(0, 229, 255, 0.16); }
.ctl.ghost { color: var(--text-muted); border-color: var(--cyan-border); background: transparent; }
.ctl.tiny { padding: 4px 9px; font-size: 11px; }
.ctl.tiny.on { background: var(--cyan); color: #041020; }

.track { position: relative; flex: 1; display: flex; align-items: center; }
.track input {
  width: 100%;
  appearance: none;
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(90deg, rgba(0, 229, 255, 0.55), rgba(0, 229, 255, 0.15));
  cursor: pointer;
}
.track input::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--cyan);
  box-shadow: 0 0 8px rgba(0, 229, 255, 0.8);
}
.marker {
  position: absolute;
  top: 50%;
  width: 1px;
  height: 12px;
  transform: translateY(-50%);
  background: rgba(0, 229, 255, 0.5);
  pointer-events: none;
}
.clock { font-size: 12px; color: var(--cyan-dim); min-width: 84px; text-align: right; }
.speeds { display: flex; gap: 4px; }

/* 上下排列：两个方案共用同一条横向里程轴，排队长度可直接比长短 */
.stages {
  display: grid;
  grid-template-rows: 1fr 1fr;
  gap: 10px;
  min-height: 0;
}
</style>

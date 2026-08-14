<script setup>
import { computed, ref } from 'vue'
import TimeSpaceDiagram from '../scene3b-signal-plan/TimeSpaceDiagram.vue'
import { buildSignalPlanModel } from '../scene3b-signal-plan/signalPlanModel.js'
import PhaseSequenceBoard from './PhaseSequenceBoard.vue'

const props = defineProps({
  payload: { type: Object, required: true },
  signalPlan: { type: Object, default: null },
})

const timing = computed(() => props.payload?.optimized_signal_plans || {})
const board = computed(() => props.payload?.signal_plan_board || null)
const tsModel = computed(() => (props.signalPlan ? buildSignalPlanModel(props.signalPlan) : null))

const mode = ref('optimized')
const direction = ref('both')

const chips = computed(() => {
  const t = timing.value
  const offset = t.offset_shift_sec?.value
  const donor = t.donor_green_delta_sec
  return [
    { k: '共同周期', v: '220 s 不变' },
    { k: '解放东相位差', v: offset != null ? `后移 ${offset} s` : '—', on: true },
    {
      k: '北直绿时',
      v: donor ? `${donor.before} → ${donor.after} s` : '—',
      on: true,
    },
    { k: '经十路配时', v: '全盘不动' },
  ]
})

function fmt(v) {
  if (v == null) return '—'
  return Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10
}

const diagramHint = computed(() =>
  mode.value === 'optimized'
    ? '服务端 Newell 轨迹 · 横轴里程 · 纵轴时间自下而上'
    : '现状仅绘协调相位绿窗，引擎未对现状跑轨迹',
)

const bandCaption = computed(() => {
  if (!tsModel.value) return ''
  if (mode.value === 'baseline') return '现状配时绿窗'
  const b = tsModel.value.corridor.bandwidth
  return `正向链式带宽 ${fmt(b.chained_forward_s)} s · 反向链式带宽 ${fmt(b.chained_reverse_s)} s`
})
</script>

<template>
  <section class="plan-compare" data-testid="plan-compare">
    <header class="head">
      <p class="lead-eyebrow">优化方案 · 相位协调</p>
      <h2 class="lead-headline">{{ timing.summary }}</h2>
      <div class="chips">
        <div v-for="c in chips" :key="c.k" class="chip" :class="{ on: c.on }">
          <span>{{ c.k }}</span>
          <strong>{{ c.v }}</strong>
        </div>
      </div>
    </header>

    <div class="body">
      <div v-if="tsModel" class="col diagram">
        <div class="col-head">
          <h3>绿波时距图</h3>
          <span class="hint">{{ diagramHint }}</span>
          <div class="toggles">
            <button
              v-for="m in [
                { k: 'baseline', t: '现状' },
                { k: 'optimized', t: '优化后' },
              ]"
              :key="m.k"
              type="button"
              class="tg"
              :class="{ on: mode === m.k }"
              @click="mode = m.k"
            >
              {{ m.t }}
            </button>
            <span class="sep" />
            <button
              v-for="d in [
                { k: 'both', t: '双向' },
                { k: 'forward', t: '北向南' },
                { k: 'reverse', t: '南向北' },
              ]"
              :key="d.k"
              type="button"
              class="tg"
              :class="{ on: direction === d.k }"
              @click="direction = d.k"
            >
              {{ d.t }}
            </button>
          </div>
        </div>
        <div class="canvas">
          <TimeSpaceDiagram :model="tsModel" :mode="mode" :direction="direction" />
        </div>
        <p class="caption">{{ bandCaption }}</p>
      </div>
      <PhaseSequenceBoard v-if="board" :board="board" />
    </div>
  </section>
</template>

<style scoped>
.plan-compare {
  display: grid;
  grid-template-rows: auto minmax(220px, 1fr);
  gap: 10px;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.head {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0 0;
}
.chip {
  display: flex;
  align-items: baseline;
  gap: 5px;
  padding: 2px 8px;
  border: 1px solid var(--cyan-border);
  border-radius: 2px;
  background: var(--bg-inset);
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
}
.chip strong {
  font-size: 10px;
  font-weight: 500;
  color: rgba(190, 220, 236, 0.85);
}
.chip.on {
  border-color: rgba(51, 204, 136, 0.5);
}
.chip.on strong {
  color: var(--ok);
}

.body {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(280px, 0.85fr);
  gap: 10px;
  min-height: 0;
}

.col.diagram {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--cyan-border);
  background: rgba(0, 16, 28, 0.55);
}

.col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  flex: none;
}
h3 {
  margin: 0;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 2px;
  color: var(--cyan-dim);
}
.hint {
  font-size: 10px;
  color: var(--text-muted);
}

.toggles {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  align-items: center;
  margin-left: auto;
}
.tg {
  padding: 3px 9px;
  font-size: 10px;
  letter-spacing: 1px;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid var(--cyan-border);
  cursor: pointer;
}
.tg.on {
  color: #041020;
  background: var(--cyan);
  border-color: var(--cyan);
}
.sep {
  width: 1px;
  height: 12px;
  background: var(--cyan-border);
}

.canvas {
  flex: 1;
  min-height: 0;
}
.caption {
  margin: 0;
  flex: none;
  font-size: 10px;
  color: var(--text-muted);
}
</style>

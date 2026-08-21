<script setup>
import { computed, ref } from 'vue'
import TimeSpaceDiagram from '../scene3b-signal-plan/TimeSpaceDiagram.vue'
import { buildSignalPlanModel } from '../scene3b-signal-plan/signalPlanModel.js'
import PhaseSequenceBoard from './PhaseSequenceBoard.vue'

const props = defineProps({
  payload: { type: Object, required: true },
  signalPlan: { type: Object, default: null },
})

const board = computed(() => props.payload?.signal_plan_board || null)
const tsModel = computed(() => (props.signalPlan ? buildSignalPlanModel(props.signalPlan) : null))

const mode = ref('optimized')
const direction = ref('both')

function fmt(v) {
  if (v == null) return '—'
  return Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10
}

const diagramHint = computed(() =>
  mode.value === 'optimized'
    ? '横轴为里程，纵轴为时间（自下而上）'
    : '现状仅绘制协调相位绿窗',
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
      <h2 v-if="board" class="lead-headline">周期绿信比优化</h2>
      <h2 v-if="tsModel" class="lead-headline">相位差优化</h2>
    </header>

    <div class="diagrams">
      <div v-if="board" class="diagram-card phase">
        <PhaseSequenceBoard :board="board" />
      </div>
      <figure v-if="tsModel" class="diagram-card wave">
        <header class="wave-head">
            <h3>绿波时距图</h3>
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
        </header>
        <p class="hint">{{ diagramHint }}</p>
        <div class="wave-body">
          <TimeSpaceDiagram :model="tsModel" :mode="mode" :direction="direction" />
        </div>
        <p class="caption">{{ bandCaption }}</p>
      </figure>
    </div>
  </section>
</template>

<style scoped>
.plan-compare {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 8px;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.head {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  align-items: baseline;
}
.lead-headline {
  margin: 0;
  min-width: 0;
  text-align: center;
}

.diagrams {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  min-width: 0;
  min-height: 0;
}

.diagram-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--cyan-border);
  background: rgba(0, 16, 28, 0.55);
}
.diagram-card.phase :deep(.phase-board) {
  height: 100%;
  border: none;
  background: transparent;
}

.wave-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
  padding: 8px 10px 0;
}
.wave-head h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 1px;
  color: var(--text);
}
.toggles {
  display: flex;
  gap: 4px;
  align-items: center;
  margin-left: auto;
}
.tg {
  padding: 2px 10px;
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--text);
  background: transparent;
  border: 1px solid var(--cyan-border);
  cursor: pointer;
}
.tg.on {
  color: #041020;
  background: var(--cyan);
  border-color: var(--text);
}
.sep {
  width: 1px;
  height: 12px;
  background: var(--cyan-border);
}

.hint,
.caption {
  margin: 0;
  flex: none;
  padding: 4px 10px 0;
  font-size: 12px;
  color: var(--text);
}
.caption { padding-bottom: 8px; }

.wave-body {
  flex: 1 1 0;
  min-height: 0;
}
.wave-body :deep(.tsd) {
  width: 100%;
  height: 100%;
}
</style>

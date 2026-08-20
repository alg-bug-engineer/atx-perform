<script setup>
/**
 * 效果评估大屏：单周期排队推演作主图，右侧四张指标卡。
 */
import { computed } from 'vue'
import CycleQueueChart from './CycleQueueChart.vue'
import { buildTrialEffectSeries, fmtPct, fmtRatio2 } from './trialEffectSeries.js'

const props = defineProps({
  payload: { type: Object, required: true },
  optimization: { type: Object, default: null },
})

const emit = defineEmits(['finish', 'home'])

const series = computed(() => buildTrialEffectSeries(props.payload))

const activeCycle = computed(() => {
  const list = series.value.cycles
  return list[list.length - 1] || null
})
const baseline = computed(() => series.value.baseline)

const headline = computed(() => {
  const c = activeCycle.value
  if (!c) return '试运行观察中…'
  const b = baseline.value
  return `最大排队长度由 ${b.queue_length_m} m 降至 ${c.queue_length_m} m`
})

function trendOf(now, base) {
  if (now == null || base == null || Number.isNaN(now) || Number.isNaN(base)) return ''
  if (now < base) return 'down'
  if (now > base) return 'up'
  return ''
}

const cards = computed(() => {
  const c = activeCycle.value
  const b = baseline.value
  const th = series.value.thresholds
  return [
    {
      key: 'queue',
      label: '目标排队长度',
      value: c ? `${c.queue_length_m}` : '—',
      unit: 'm',
      tone: 'ok',
      trend: c ? trendOf(c.queue_length_m, b.queue_length_m) : '',
      sub: `基线 ${b.queue_length_m} m`,
    },
    {
      key: 'ratio',
      label: '排队比',
      value: c ? fmtRatio2(c.queue_ratio) : '—',
      tone: c && c.queue_ratio < th.queue_ratio_warning ? 'ok' : 'warn',
      trend: c ? trendOf(c.queue_ratio, b.queue_ratio) : '',
      sub: `基线 ${fmtRatio2(b.queue_ratio)} · 预警 ${th.queue_ratio_warning}`,
    },
    {
      key: 'green',
      label: '绿灯利用率',
      value: c ? fmtPct(c.green_utilization) : '—',
      tone: c && c.green_utilization >= th.green_utilization_low ? 'ok' : 'warn',
      trend: c ? trendOf(c.green_utilization, b.green_utilization) : '',
      sub: `基线 ${fmtPct(b.green_utilization)} · 目标 ${fmtPct(th.green_utilization_low)}`,
    },
    {
      key: 'upstream',
      label: '上游排队比',
      value: c ? fmtRatio2(c.downstream_queue_ratio) : '—',
      tone: c && c.downstream_queue_ratio < series.value.rollbackThreshold ? 'ok' : 'danger',
      trend: c ? trendOf(c.downstream_queue_ratio, b.downstream_queue_ratio) : '',
      sub: `回滚线 ${series.value.rollbackThreshold}`,
    },
  ]
})
</script>

<template>
  <section class="effect" data-testid="trial-effect-panel">
    <header class="banner">
      <div class="banner-main">
        <p class="lead-eyebrow">效果评估 · 相位协调试运行</p>
        <h2 class="lead-headline">{{ headline }}</h2>
      </div>
    </header>

    <div class="stage">
      <CycleQueueChart class="cycle-cell" :optimization="optimization" />
      <div class="cards" data-testid="effect-kpis">
        <div v-for="c in cards" :key="c.key" class="card" :class="`tone-${c.tone}`">
          <span class="card-k">{{ c.label }}</span>
          <strong class="card-v">
            {{ c.value }}<em v-if="c.unit">{{ c.unit }}</em>
            <i
              v-if="c.trend"
              class="delta"
              :class="c.trend"
              :title="c.trend === 'down' ? '较基线下降' : '较基线上升'"
              :aria-label="c.trend === 'down' ? '较基线下降' : '较基线上升'"
            />
          </strong>
          <span class="card-sub">{{ c.sub }}</span>
        </div>
      </div>
    </div>

    <footer class="foot">
      <div class="acts">
        <button
          type="button"
          class="btn ghost"
          data-testid="effect-home"
          @click="emit('home')"
        >
          返回主页
        </button>
        <button
          type="button"
          class="btn"
          data-testid="effect-finish"
          @click="emit('finish')"
        >
          固化为可复用技能
        </button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.effect {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 12px;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.banner,
.foot {
  padding-left: 16px;
  padding-right: 16px;
}
.banner {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 26px;
}
.banner-main { min-width: 0; }

.stage {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 280px);
  gap: 12px;
  min-height: 0;
}

.cycle-cell {
  min-height: 0;
  height: 100%;
  padding: 4px 0;
  border: none;
  border-radius: 0;
  background: rgba(2, 12, 26, 0.55);
}

.cards {
  display: grid;
  grid-template-rows: repeat(4, minmax(0, 1fr));
  gap: 12px;
  min-height: 0;
}
.card {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  min-height: 0;
  padding: 10px 14px;
  border: 1px solid var(--cyan-border);
  border-left: 2px solid var(--cyan);
  border-radius: 3px;
  background: rgba(0, 20, 34, 0.55);
}
.card-k { font-size: 13px; color: rgba(200, 228, 240, 0.88); }
.card-v {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 26px;
  font-weight: 500;
  line-height: 1.1;
  color: var(--text);
}
.card-v em { font-style: normal; font-size: 13px; margin-left: 0; color: rgba(200, 228, 240, 0.8); }
.delta {
  display: inline-block;
  width: 0;
  height: 0;
  flex: none;
  font-style: normal;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
}
.delta.up {
  border-bottom: 9px solid currentColor;
  filter: drop-shadow(0 0 4px currentColor);
  transform: translateY(-3px);
}
.delta.down {
  border-top: 9px solid currentColor;
  filter: drop-shadow(0 0 4px currentColor);
  transform: translateY(2px);
}
.card-sub { font-size: 13px; font-weight: 500; letter-spacing: 0.2px; color: rgba(210, 232, 244, 0.88); }
.card.tone-ok { border-left-color: var(--ok); }
.card.tone-ok .card-v { color: var(--text); }
.card.tone-warn { border-left-color: var(--warn); }
.card.tone-warn .card-v { color: var(--warn); }
.card.tone-danger { border-left-color: var(--danger); }
.card.tone-danger .card-v { color: var(--danger); }

.foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
}

.acts { display: flex; gap: 10px; align-items: center; }
.btn {
  padding: 11px 26px;
  border-radius: 3px;
  border: 1px solid var(--cyan-border-strong);
  background: rgba(0, 229, 255, 0.92);
  color: rgba(4, 12, 22, 0.95);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.btn:hover:not(:disabled) { background: var(--cyan); }
.btn:disabled { opacity: 0.4; cursor: default; }
.btn.ghost {
  background: transparent;
  border-color: var(--cyan-border);
  color: var(--text-muted);
  font-weight: 400;
  padding: 11px 20px;
}
.btn.ghost:hover:not(:disabled) {
  background: rgba(0, 229, 255, 0.08);
  border-color: var(--cyan-border-strong);
  color: var(--text);
}

@media (max-width: 1100px) {
  .stage { grid-template-columns: 1fr; }
  .cards {
    grid-template-rows: none;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    padding: 0 8px 8px;
  }
}
</style>

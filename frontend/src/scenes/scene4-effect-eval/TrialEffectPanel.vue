<script setup>
/**
 * 效果评估大屏：版式对齐 assets/效果评估.png
 * 左侧周期时间线 + 四张指标卡 + 逐周期趋势折线，末排保留幕 3 的单周期排队推演对照。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import CycleQueueChart from './CycleQueueChart.vue'
import TrendChart from './TrendChart.vue'
import { buildTrialEffectSeries, fmtPct, fmtRatio2 } from './trialEffectSeries.js'
import { prefersInstant } from '../../shared/useSceneBeats.js'

const props = defineProps({
  payload: { type: Object, required: true },
  optimization: { type: Object, default: null },
})

const emit = defineEmits(['finish', 'home'])

const series = computed(() => buildTrialEffectSeries(props.payload))
const revealed = ref(0)
let timer = null

onMounted(() => {
  const n = series.value.cyclesCount
  if (prefersInstant()) {
    revealed.value = n
    return
  }
  revealed.value = 0
  let i = 0
  timer = setInterval(() => {
    i += 1
    revealed.value = i
    if (i >= n) {
      clearInterval(timer)
      timer = null
    }
  }, 620)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

const cycles = computed(() => series.value.cycles)
const shown = computed(() => cycles.value.slice(0, revealed.value))
const activeCycle = computed(() => shown.value[shown.value.length - 1] || null)
const allRevealed = computed(() => revealed.value >= series.value.cyclesCount)
const baseline = computed(() => series.value.baseline)

function cycleState(i) {
  if (i < revealed.value - 1) return 'done'
  if (i === revealed.value - 1) return 'active'
  return 'idle'
}

/** 试运行的是幕 3 那套方案，参数原样列出，避免两幕对不上 */
const planChips = computed(() => {
  const t = series.value.timing
  const chips = [{ k: '共同周期', v: `${t.cycleLenS} s 不变` }]
  if (t.releaseBeforeS != null && t.releaseAfterS != null) {
    const fmt = (v) => (v < 0 ? `绿灯前 ${-v} s` : `绿灯后 ${v} s`)
    chips.push({ k: '解放东北直放行', v: `${fmt(t.releaseBeforeS)} → ${fmt(t.releaseAfterS)}`, on: true })
  }
  if (t.donorGreenDeltaS) {
    chips.push({ k: '解放东北直绿时', v: `${t.donorGreenDeltaS} s 轻微截流`, on: true })
  }
  chips.push({ k: '经十路配时', v: '全盘不动' })
  chips.push({ k: '蓄车边界', v: `${baseline.value.storage_length_m} m` })
  return chips
})

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
      sub: `基线 ${b.queue_length_m} m`,
    },
    {
      key: 'ratio',
      label: '排队比',
      value: c ? fmtRatio2(c.queue_ratio) : '—',
      tone: c && c.queue_ratio < th.queue_ratio_warning ? 'ok' : 'warn',
      sub: `基线 ${fmtRatio2(b.queue_ratio)} · 预警 ${th.queue_ratio_warning}`,
    },
    {
      key: 'green',
      label: '绿灯利用率',
      value: c ? fmtPct(c.green_utilization) : '—',
      tone: c && c.green_utilization >= th.green_utilization_low ? 'ok' : 'warn',
      sub: `基线 ${fmtPct(b.green_utilization)} · 目标 ${th.green_utilization_low}`,
    },
    {
      key: 'upstream',
      label: '上游排队比',
      value: c ? fmtRatio2(c.downstream_queue_ratio) : '—',
      tone: c && c.downstream_queue_ratio < series.value.rollbackThreshold ? 'ok' : 'danger',
      sub: `回滚线 ${series.value.rollbackThreshold}`,
    },
  ]
})

const trends = computed(() => {
  const th = series.value.thresholds
  return [
    {
      key: 'ratio',
      title: '目标排队比',
      tone: 'cyan',
      values: shown.value.map((c) => c.queue_ratio),
      allValues: cycles.value.map((c) => c.queue_ratio),
      threshold: { value: th.queue_ratio_warning, label: `预警 ${th.queue_ratio_warning}`, tone: 'warn' },
      format: (v) => fmtRatio2(v),
    },
    {
      key: 'green',
      title: '绿灯利用率',
      tone: 'ok',
      values: shown.value.map((c) => c.green_utilization),
      allValues: cycles.value.map((c) => c.green_utilization),
      threshold: { value: th.green_utilization_low, label: `目标 ${th.green_utilization_low}`, tone: 'ok' },
      format: (v) => fmtPct(v),
    },
    {
      key: 'upstream',
      title: '上游排队比',
      tone: 'warn',
      values: shown.value.map((c) => c.downstream_queue_ratio),
      allValues: cycles.value.map((c) => c.downstream_queue_ratio),
      threshold: {
        value: series.value.rollbackThreshold,
        label: `回滚 ${series.value.rollbackThreshold}`,
        tone: 'warn',
      },
      format: (v) => fmtRatio2(v),
    },
  ]
})

const verdictText = computed(() => {
  if (!allRevealed.value) return `试运行观察中 · 已完成 ${revealed.value} / ${series.value.cyclesCount} 周期`
  return series.value.verdict
})
</script>

<template>
  <section class="effect" data-testid="trial-effect-panel">
    <header class="banner">
      <div class="banner-main">
        <p class="eyebrow">效果评估</p>
        <h2>{{ series.intersection }}</h2>
        <p class="lede">
          试点 {{ series.cyclesCount }} 周期 · 监测上游 {{ series.downstreamName }}
          <template v-if="series.timePeriodLabel">（{{ series.timePeriodLabel }}）</template>
        </p>
        <ul class="plan-chips">
          <li v-for="c in planChips" :key="c.k" :class="{ on: c.on }">
            <span>{{ c.k }}</span>
            <strong>{{ c.v }}</strong>
          </li>
        </ul>
      </div>

      <div class="banner-side">
        <span class="side-label">{{ allRevealed ? '观察完成' : '观察中' }}</span>
        <strong class="side-num" data-testid="effect-progress">
          {{ revealed }}<small>/ {{ series.cyclesCount }}</small>
        </strong>
      </div>
    </header>

    <div class="board">
      <aside class="rail" aria-label="试运行周期">
        <h4>周期</h4>
        <div
          v-for="(c, i) in cycles"
          :key="c.index"
          class="rail-item"
          :class="`is-${cycleState(i)}`"
        >
          <span class="rail-dot" aria-hidden="true" />
          <span>{{ c.label }}</span>
        </div>
      </aside>

      <div class="content">
        <div class="cards" data-testid="effect-kpis">
          <div v-for="c in cards" :key="c.key" class="card" :class="`tone-${c.tone}`">
            <span class="card-k">{{ c.label }}</span>
            <strong class="card-v">{{ c.value }}<em v-if="c.unit">{{ c.unit }}</em></strong>
            <span class="card-sub">{{ c.sub }}</span>
          </div>
        </div>

        <div class="charts">
          <TrendChart
            v-for="t in trends"
            :key="t.key"
            :title="t.title"
            :tone="t.tone"
            :values="t.values"
            :all-values="t.allValues"
            :threshold="t.threshold"
            :format="t.format"
          />
          <CycleQueueChart class="cycle-cell" :optimization="optimization" />
        </div>

        <section class="verdict" :class="{ ok: allRevealed && !series.rolledBack }">
          <header class="verdict-hd">
            <span class="verdict-tag">{{ allRevealed ? (series.rolledBack ? '已回滚' : '达标结论') : '观察中' }}</span>
            <p>{{ verdictText }}</p>
          </header>
          <div class="outcomes" data-testid="effect-outcomes">
            <div
              v-for="item in series.outcomeHighlights"
              :key="item.id"
              class="outcome"
              :class="{ ok: item.ok && allRevealed }"
            >
              <span class="outcome-hd">
                <i>{{ item.ok && allRevealed ? '达成' : '待核' }}</i>
                {{ item.title }}
              </span>
              <p>{{ item.detail }}</p>
            </div>
          </div>
        </section>
      </div>
    </div>

    <footer class="foot">
      <div class="foot-meta">
        <span>试运行 <strong>{{ series.targetLabel }}</strong> → {{ series.downstreamName }}</span>
        <span>
          回滚
          <strong :class="series.rolledBack ? 'bad' : 'good'">
            {{ series.rolledBack ? '已触发' : '未触发' }}
          </strong>
        </span>
      </div>
      <div class="acts">
        <button
          type="button"
          class="btn ghost"
          :disabled="!allRevealed"
          data-testid="effect-home"
          @click="emit('home')"
        >
          返回主页
        </button>
        <button
          type="button"
          class="btn"
          :disabled="!allRevealed"
          data-testid="effect-finish"
          @click="emit('finish')"
        >
          {{ allRevealed ? '固化为可复用技能' : '试运行中…' }}
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

.banner {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 26px;
}
.banner-main { min-width: 0; }
.eyebrow { margin: 0 0 4px; font-size: 11px; letter-spacing: 4px; color: var(--cyan-dim); }
h2 {
  margin: 0 0 5px;
  font-size: 24px;
  font-weight: 500;
  letter-spacing: 1px;
  color: var(--text);
}
.lede { margin: 0; font-size: 12px; color: var(--text-muted); }

.plan-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}
.plan-chips li {
  display: flex;
  align-items: baseline;
  gap: 5px;
  padding: 2px 8px;
  border: 1px solid var(--cyan-border);
  border-radius: 2px;
  background: var(--bg-inset);
  font-size: 10px;
  color: var(--text-muted);
}
.plan-chips li strong { font-weight: 500; color: rgba(190, 220, 236, 0.85); }
.plan-chips li.on { border-color: rgba(51, 204, 136, 0.5); }
.plan-chips li.on strong { color: var(--ok); }

.banner-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  flex: none;
}
.side-label { font-size: 11px; letter-spacing: 2px; color: var(--text-muted); }
.side-num { font-size: 30px; font-weight: 500; color: var(--ok); line-height: 1.1; }
.side-num small { font-size: 13px; color: var(--text-muted); margin-left: 4px; }

.board {
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr);
  gap: 14px;
  min-height: 0;
}

.rail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--cyan-border);
  border-radius: 3px;
  background: var(--bg-inset);
  overflow: auto;
}
.rail h4 {
  margin: 0 0 2px;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 2px;
  color: var(--cyan-dim);
}
.rail-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
}
.rail-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
  background: rgba(160, 200, 220, 0.3);
}
.rail-item.is-done { color: var(--text); }
.rail-item.is-done .rail-dot { background: var(--ok); }
.rail-item.is-active { color: var(--cyan); }
.rail-item.is-active .rail-dot {
  background: var(--cyan);
  box-shadow: 0 0 8px rgba(0, 229, 255, 0.6);
}

.content {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 12px;
  min-height: 0;
}

.cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 14px;
  border: 1px solid var(--cyan-border);
  border-left: 2px solid var(--cyan);
  border-radius: 3px;
  background: rgba(0, 20, 34, 0.55);
}
.card-k { font-size: 11px; color: var(--text-muted); }
.card-v { font-size: 26px; font-weight: 500; line-height: 1.1; color: var(--cyan); }
.card-v em { font-style: normal; font-size: 12px; margin-left: 4px; color: var(--text-muted); }
.card-sub { font-size: 10px; color: rgba(160, 200, 220, 0.55); }
.card.tone-ok { border-left-color: var(--ok); }
.card.tone-ok .card-v { color: var(--ok); }
.card.tone-warn { border-left-color: var(--warn); }
.card.tone-warn .card-v { color: var(--warn); }
.card.tone-danger { border-left-color: var(--danger); }
.card.tone-danger .card-v { color: var(--danger); }

.charts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(0, 1.5fr);
  gap: 12px;
  min-height: 0;
}
.cycle-cell {
  padding: 10px 12px;
  border: 1px solid var(--cyan-border);
  border-radius: 3px;
  background: rgba(2, 12, 26, 0.55);
}

.verdict {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 14px;
  border: 1px solid var(--cyan-border);
  border-radius: 3px;
  background: rgba(0, 20, 34, 0.5);
}
.verdict.ok { border-color: rgba(51, 204, 136, 0.45); }
.verdict-hd { display: flex; align-items: baseline; gap: 12px; }
.verdict-hd p { margin: 0; font-size: 12.5px; color: var(--text); }
.verdict-tag {
  flex: none;
  padding: 2px 10px;
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--text-muted);
  border: 1px solid var(--cyan-border);
}
.verdict.ok .verdict-tag { color: var(--ok); border-color: rgba(51, 204, 136, 0.5); }

.outcomes {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.outcome {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border: 1px solid var(--cyan-border);
  border-radius: 2px;
  background: rgba(0, 12, 24, 0.5);
}
.outcome-hd {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--text-muted);
}
.outcome i {
  font-style: normal;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 2px;
  color: var(--text-muted);
  background: rgba(160, 200, 220, 0.12);
}
.outcome p { margin: 0; font-size: 11px; line-height: 1.5; color: rgba(160, 200, 220, 0.7); }
.outcome.ok { border-color: rgba(51, 204, 136, 0.4); }
.outcome.ok .outcome-hd { color: var(--text); }
.outcome.ok i { color: rgba(4, 16, 32, 0.95); background: var(--ok); }

.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
/* 左下角是数字人头标，给它让开位置 */
.foot-meta {
  display: flex;
  gap: 22px;
  margin-left: 62px;
  font-size: 11px;
  color: var(--text-muted);
}
.foot-meta strong { font-weight: 500; color: var(--text); }
.foot-meta strong.good { color: var(--ok); }
.foot-meta strong.bad { color: var(--danger); }

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
  color: var(--cyan);
}

@media (max-width: 1500px) {
  .charts { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .cycle-cell { grid-column: 1 / -1; }
}
</style>

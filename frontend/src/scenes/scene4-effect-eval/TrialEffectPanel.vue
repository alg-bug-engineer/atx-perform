<script setup>
/**
 * 效果评估大屏：一条结论 + 一个主视觉（蓄车占用）+ 三类互补图形
 * （容量条 / 单周期面积图 / 治理画像雷达 / 护栏半环），不再堆折线。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import CycleQueueChart from './CycleQueueChart.vue'
import GovernanceRadar from './GovernanceRadar.vue'
import QueueCapacityHero from './QueueCapacityHero.vue'
import TrialGuardRail from './TrialGuardRail.vue'
import { buildTrialEffectSeries } from './trialEffectSeries.js'

const props = defineProps({
  payload: { type: Object, required: true },
  optimization: { type: Object, default: null },
})

const emit = defineEmits(['finish', 'home'])

const series = computed(() => buildTrialEffectSeries(props.payload))
const revealed = ref(0)
let timer = null

const instant = (() => {
  const reduced =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const automation = typeof navigator !== 'undefined' && navigator.webdriver === true
  return reduced || automation
})()

onMounted(() => {
  const n = series.value.cyclesCount
  if (instant) {
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

const activeCycle = computed(() => series.value.cycles[Math.max(0, revealed.value - 1)] || null)
const allRevealed = computed(() => revealed.value >= series.value.cyclesCount)
const progress = computed(() => revealed.value / series.value.cyclesCount)
const started = computed(() => revealed.value > 0)

const corridor = computed(() => props.optimization?.corridor_demo || null)
const storageM = computed(
  () => corridor.value?.link?.storage_length_m ?? series.value.baseline.storage_length_m,
)
const peaks = computed(() => {
  const kpi = (corridor.value?.kpis || []).find((k) => k.key === 'peak_queue')
  return kpi ? { before: kpi.before, after: kpi.after } : null
})

const headline = computed(() => {
  const c = activeCycle.value
  if (!c) return '试运行观察中…'
  const cut = Math.round(series.value.baseline.queue_length_m - c.queue_length_m)
  const noSpill = peaks.value && peaks.value.after <= storageM.value
  return `排队缩短 ${cut} 米，速度回到 ${c.avg_speed_kmh} km/h${noSpill ? '，路口不再溢出' : ''}`
})

const capacityRows = computed(() => {
  const c = activeCycle.value
  const p = peaks.value
  const rows = []
  if (p) {
    rows.push(
      { key: 'peak-before', group: '单周期推演峰值', groupStart: true, label: '优化前', value: p.before, tone: 'bad' },
      { key: 'peak-after', label: '优化后', value: p.after, tone: 'good' },
    )
  }
  rows.push(
    { key: 'obs-base', group: '试运行实测排队', groupStart: true, label: '基线', value: series.value.baseline.queue_length_m, tone: 'warn' },
    {
      key: 'obs-now',
      label: `第 ${Math.max(revealed.value, 1)} 周期`,
      value: c ? c.queue_length_m : series.value.baseline.queue_length_m,
      tone: 'good',
    },
  )
  return rows
})

/** 雷达五维统一成「越大越好」，便于领导横向看一眼 */
const radarAxes = computed(() => {
  const b = series.value.baseline
  const c = activeCycle.value || b
  const clamp = (v) => Math.max(0, Math.min(1, v))
  const speedRef = 30
  const delayNorm = (d) => clamp(1 - (d - 1) / 5)
  return [
    {
      name: '排队控制',
      base: clamp(1 - b.queue_ratio),
      now: clamp(1 - c.queue_ratio),
      text: c.queue_ratio.toFixed(2),
    },
    {
      name: '路段速度',
      base: clamp(b.avg_speed_kmh / speedRef),
      now: clamp(c.avg_speed_kmh / speedRef),
      text: `${c.avg_speed_kmh} km/h`,
    },
    {
      name: '通行延误',
      base: delayNorm(b.delay_index),
      now: delayNorm(c.delay_index),
      text: c.delay_index.toFixed(2),
    },
    {
      name: '绿灯利用',
      base: clamp(b.green_utilization),
      now: clamp(c.green_utilization),
      text: `${Math.round(c.green_utilization * 100)}%`,
    },
    {
      name: '上游安全',
      base: clamp(1 - b.downstream_queue_ratio / series.value.rollbackThreshold),
      now: clamp(1 - c.downstream_queue_ratio / series.value.rollbackThreshold),
      text: c.downstream_queue_ratio.toFixed(2),
    },
  ]
})

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
  return chips
})

/** 结论横幅下的三个核心数字，只留最该被记住的 */
const headlineStats = computed(() => {
  const b = series.value.baseline
  const c = activeCycle.value
  if (!c) return []
  return [
    { key: 'queue', label: '排队长度', from: `${b.queue_length_m} m`, to: `${c.queue_length_m} m`, delta: `${Math.round(((c.queue_length_m - b.queue_length_m) / b.queue_length_m) * 100)}%` },
    { key: 'speed', label: '路段速度', from: `${b.avg_speed_kmh}`, to: `${c.avg_speed_kmh} km/h`, delta: `+${Math.round(((c.avg_speed_kmh - b.avg_speed_kmh) / b.avg_speed_kmh) * 100)}%` },
    { key: 'delay', label: '拥堵延时指数', from: b.delay_index.toFixed(2), to: c.delay_index.toFixed(2), delta: `${Math.round(((c.delay_index - b.delay_index) / b.delay_index) * 100)}%` },
  ]
})
</script>

<template>
  <section class="effect" data-testid="trial-effect-panel">
    <header class="banner">
      <div class="banner-main">
        <p class="eyebrow">效果评估 · 相位协调试运行</p>
        <h2>{{ headline }}</h2>
        <p class="lede">
          {{ series.intersection }} · 监测上游 {{ series.downstreamName }}
          <template v-if="series.timePeriodLabel"> · {{ series.timePeriodLabel }}</template>
        </p>
        <ul class="plan-chips">
          <li v-for="c in planChips" :key="c.k" :class="{ on: c.on }">
            <span>{{ c.k }}</span>
            <strong>{{ c.v }}</strong>
          </li>
        </ul>
      </div>

      <div class="stats" data-testid="effect-kpis">
        <div v-for="s in headlineStats" :key="s.key" class="stat">
          <span class="stat-k">{{ s.label }}</span>
          <div class="stat-v">
            <s>{{ s.from }}</s>
            <strong>{{ s.to }}</strong>
          </div>
          <span class="stat-d">{{ s.delta }}</span>
        </div>
      </div>

      <div class="banner-side">
        <div class="verdict-badge" :class="{ ok: allRevealed && !series.rolledBack }">
          {{ allRevealed ? (series.rolledBack ? '已回滚' : '达标 · 建议固化') : '试运行观察中' }}
        </div>
        <div class="progress">
          <svg viewBox="0 0 64 64" class="ring">
            <circle class="ring-bg" cx="32" cy="32" r="27" />
            <circle class="ring-fg" cx="32" cy="32" r="27" :stroke-dasharray="`${progress * 169.6} 169.6`" />
          </svg>
          <div class="progress-num">
            <strong data-testid="effect-progress">{{ revealed }}</strong>
            <small>/ {{ series.cyclesCount }} 周期</small>
          </div>
        </div>
      </div>
    </header>

    <div class="board">
      <QueueCapacityHero
        class="cell"
        :storage-m="storageM"
        :rows="capacityRows"
        :revealed="started"
      />
      <CycleQueueChart class="cell" :optimization="optimization" />
      <GovernanceRadar class="cell" :axes="radarAxes" :revealed="allRevealed" />
    </div>

    <footer class="foot">
      <TrialGuardRail
        class="cell guard-cell"
        :cycles="series.cycles"
        :revealed="revealed"
        :current="activeCycle?.downstream_queue_ratio ?? series.baseline.downstream_queue_ratio"
        :warning="series.thresholds.queue_ratio_warning"
        :rollback="series.rollbackThreshold"
      />

      <div class="foot-right">
        <div class="outcomes" data-testid="effect-outcomes">
          <span
            v-for="item in series.outcomeHighlights"
            :key="item.id"
            class="outcome"
            :class="{ ok: item.ok }"
          >
            <i>{{ item.ok ? '达成' : '待核' }}</i>
            {{ item.title }}
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
      </div>
    </footer>
  </section>
</template>

<style scoped>
.effect {
  display: grid;
  grid-template-rows: auto minmax(240px, 1fr) auto;
  gap: 12px;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 26px;
}
.banner-main { min-width: 0; }
.eyebrow { margin: 0 0 4px; font-size: 11px; letter-spacing: 4px; color: var(--cyan-dim); }
h2 {
  margin: 0 0 5px;
  font-size: 28px;
  font-weight: 500;
  letter-spacing: 1px;
  color: var(--text);
}
.lede { margin: 0; font-size: 12px; color: var(--text-muted); }

/* 试运行方案参数：与幕 3 逐项对应 */
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
  background: rgba(0, 22, 38, 0.5);
  font-size: 10px;
  color: var(--text-muted);
}
.plan-chips li strong {
  font-weight: 500;
  color: rgba(190, 220, 236, 0.85);
}
.plan-chips li.on {
  border-color: rgba(51, 204, 136, 0.5);
}
.plan-chips li.on strong {
  color: var(--ok);
}

.stats { display: flex; gap: 10px; margin-left: auto; }
.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 14px;
  border: 1px solid var(--cyan-border);
  border-left: 2px solid var(--ok);
  border-radius: 3px;
  background: rgba(0, 20, 34, 0.55);
}
.stat-k { font-size: 11px; color: var(--text-muted); }
.stat-v { display: flex; align-items: baseline; gap: 6px; }
.stat-v s { font-size: 12px; color: rgba(160, 200, 220, 0.45); }
.stat-v strong { font-size: 22px; font-weight: 500; color: var(--ok); line-height: 1.1; }
.stat-d { font-size: 11px; color: var(--ok); }

.banner-side { display: flex; align-items: center; gap: 14px; }
.verdict-badge {
  padding: 8px 14px;
  border: 1px solid var(--cyan-border);
  border-radius: 3px;
  font-size: 13px;
  color: var(--text-muted);
  background: rgba(0, 20, 34, 0.6);
  white-space: nowrap;
}
.verdict-badge.ok {
  border-color: rgba(51, 204, 136, 0.55);
  color: var(--ok);
  background: rgba(51, 204, 136, 0.12);
}
.progress { position: relative; width: 70px; height: 70px; flex: none; }
.ring { width: 70px; height: 70px; transform: rotate(-90deg); }
.ring-bg { fill: none; stroke: rgba(0, 229, 255, 0.14); stroke-width: 4; }
.ring-fg {
  fill: none;
  stroke: var(--ok);
  stroke-width: 4;
  stroke-linecap: round;
  transition: stroke-dasharray 0.5s ease;
}
.progress-num {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1.1;
}
.progress-num strong { font-size: 21px; color: var(--ok); font-weight: 500; }
.progress-num small { font-size: 9px; color: var(--text-muted); }

.board {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr) minmax(0, 0.82fr);
  gap: 14px;
  min-height: 0;
}
.cell {
  padding: 12px 14px;
  border: 1px solid var(--cyan-border);
  border-radius: 4px;
  background: rgba(2, 12, 26, 0.55);
}

.foot {
  display: grid;
  grid-template-columns: minmax(380px, 33%) minmax(0, 1fr);
  align-items: center;
  gap: 16px;
}
.guard-cell { padding: 8px 14px; height: 112px; }
.foot-right { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.outcomes { display: flex; gap: 10px; flex-wrap: wrap; }
.outcome {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 13px;
  border: 1px solid var(--cyan-border);
  border-radius: 3px;
  font-size: 12px;
  color: var(--text-muted);
  background: rgba(0, 20, 34, 0.5);
}
.outcome i {
  font-style: normal;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 2px;
  color: var(--text-muted);
  background: rgba(160, 200, 220, 0.12);
}
.outcome.ok { border-color: rgba(51, 204, 136, 0.4); color: var(--text); }
.outcome.ok i { color: rgba(4, 16, 32, 0.95); background: var(--ok); }

.btn {
  padding: 12px 28px;
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

.acts { display: flex; gap: 10px; align-items: center; }
.btn.ghost {
  background: transparent;
  border-color: var(--cyan-border);
  color: var(--text-muted);
  font-weight: 400;
  padding: 12px 22px;
}
.btn.ghost:hover:not(:disabled) {
  background: rgba(0, 229, 255, 0.08);
  border-color: var(--cyan-border-strong);
  color: var(--cyan);
}

@media (max-width: 1500px) {
  .board { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .board > :nth-child(3) { grid-column: 1 / -1; }
}
</style>

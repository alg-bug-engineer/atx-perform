<script setup>
/**
 * 试运行 N 周期治理效果面板（移植自 agent-loop TrialEffectPanel，配色 baseline）
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import TrialEffectCharts from './TrialEffectCharts.vue'
import {
  buildTrialEffectSeries,
  fmtDeltaS,
  fmtMeters,
  fmtPct,
  fmtRatio2,
} from './trialEffectSeries.js'

const props = defineProps({
  payload: { type: Object, required: true },
})

const emit = defineEmits(['finish'])

const series = computed(() => buildTrialEffectSeries(props.payload))
const revealed = ref(0)
let timer = null

const instant = (() => {
  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
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
  }, 520)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

const activeCycle = computed(() => {
  const idx = Math.max(0, revealed.value - 1)
  return series.value.cycles[idx] || null
})

const allRevealed = computed(() => revealed.value >= series.value.cyclesCount)

const warningRatio = computed(() => series.value.thresholds.queue_ratio_warning)
const greenLow = computed(() => series.value.thresholds.green_utilization_low)

function cycleStatus(index) {
  if (revealed.value >= series.value.cyclesCount) {
    return index <= revealed.value ? 'done' : 'pending'
  }
  if (index < revealed.value) return 'done'
  if (index === revealed.value) return 'active'
  return 'pending'
}
</script>

<template>
  <section class="effect" data-testid="trial-effect-panel">
    <header class="effect-hd">
      <div>
        <span class="effect-eyebrow">效果优化</span>
        <h2>{{ series.intersection || series.planName }}</h2>
        <p class="effect-sub">
          试运行 {{ series.cyclesCount }} 周期 · 监测上游 {{ series.downstreamName }}
          <template v-if="series.timePeriodLabel"> · {{ series.timePeriodLabel }}</template>
        </p>
      </div>
      <div class="progress-card">
        <span>{{ allRevealed ? '观察完成' : '试运行中' }}</span>
        <strong data-testid="effect-progress">
          {{ revealed }}/{{ series.cyclesCount }}
        </strong>
      </div>
    </header>

    <div class="timing-bar" data-testid="effect-timing">
      <span class="chip">{{ series.targetLabel }} {{ fmtDeltaS(series.timing.targetGreenDeltaS) }}</span>
      <span class="chip mute">{{ series.timing.jingshiNote || '经十优先消散' }}</span>
      <span class="chip mute">{{ series.timing.jiefangNote || '解放东错峰' }}</span>
      <span class="chip mute">方案 · {{ series.planName }}</span>
      <span class="chip mute">蓄车 {{ fmtMeters(series.baseline.storage_length_m) }}</span>
    </div>

    <div class="workbench">
      <aside class="timeline" aria-label="试运行周期">
        <h3>周期</h3>
        <div
          v-for="c in series.cycles"
          :key="c.index"
          class="timeline-item"
          :class="`is-${cycleStatus(c.index)}`"
        >
          <span class="timeline-dot" aria-hidden="true" />
          <span class="timeline-label">{{ c.label }}</span>
          <small class="timeline-pct">
            {{ cycleStatus(c.index) === 'done' ? '完成' : cycleStatus(c.index) === 'active' ? '监测' : '待观察' }}
          </small>
        </div>
      </aside>

      <section class="main-pane" aria-label="治理效果">
        <div class="kpi-row" data-testid="effect-kpis">
          <div class="kpi">
            <span class="kpi-k">目标排队</span>
            <strong class="kpi-v">{{ fmtMeters(activeCycle?.queue_length_m) }}</strong>
            <em class="kpi-base">基线 {{ fmtMeters(series.baseline.queue_length_m) }}</em>
          </div>
          <div class="kpi">
            <span class="kpi-k">排队比</span>
            <strong class="kpi-v down">{{ fmtRatio2(activeCycle?.queue_ratio) }}</strong>
            <em class="kpi-base">基线 {{ fmtRatio2(series.baseline.queue_ratio) }} · 预警 {{ warningRatio }}</em>
          </div>
          <div class="kpi">
            <span class="kpi-k">绿灯利用率</span>
            <strong class="kpi-v up">{{ fmtPct(activeCycle?.green_utilization) }}</strong>
            <em class="kpi-base">基线 {{ fmtPct(series.baseline.green_utilization) }} · 低利用 {{ greenLow }}</em>
          </div>
          <div class="kpi">
            <span class="kpi-k">上游排队比</span>
            <strong class="kpi-v">{{ fmtRatio2(activeCycle?.downstream_queue_ratio) }}</strong>
            <em class="kpi-base">回滚线 {{ series.rollbackThreshold }}</em>
          </div>
        </div>

        <TrialEffectCharts
          :cycles="series.cycles"
          :revealed="revealed"
          :warning-ratio="warningRatio"
          :green-low="greenLow"
        />

        <div class="table-wrap">
          <table class="cycle-table" data-testid="effect-cycle-table">
            <thead>
              <tr>
                <th>周期</th>
                <th>排队长度</th>
                <th>排队比</th>
                <th>绿灯利用率</th>
                <th>上游排队比</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="c in series.cycles"
                :key="`row-${c.index}`"
                :class="{
                  dim: c.index > revealed,
                  current: c.index === revealed,
                }"
              >
                <td>{{ c.label }}</td>
                <td class="mono">{{ c.index <= revealed ? fmtMeters(c.queue_length_m) : '—' }}</td>
                <td class="mono">{{ c.index <= revealed ? fmtRatio2(c.queue_ratio) : '—' }}</td>
                <td class="mono">{{ c.index <= revealed ? fmtPct(c.green_utilization) : '—' }}</td>
                <td class="mono">{{ c.index <= revealed ? fmtRatio2(c.downstream_queue_ratio) : '—' }}</td>
                <td>
                  <span v-if="c.index > revealed" class="tag mute">待观察</span>
                  <span v-else-if="c.rolled_back" class="tag warn">回滚</span>
                  <span v-else class="tag ok">正常</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="allRevealed" class="verdict" data-testid="effect-verdict">
          <div class="verdict-banner">
            <span class="verdict-eyebrow">治理结论</span>
            <b>{{ series.verdict }}</b>
            <p>{{ series.successText }}</p>
          </div>
          <div class="outcome-grid" data-testid="effect-outcomes">
            <article
              v-for="item in series.outcomeHighlights"
              :key="item.id"
              class="outcome-card"
              :class="{ ok: item.ok, bad: !item.ok }"
            >
              <span class="outcome-badge">{{ item.ok ? '达成' : '待核' }}</span>
              <strong>{{ item.title }}</strong>
              <p>{{ item.detail }}</p>
            </article>
          </div>
          <ul v-if="series.successConditions.length" class="cond-list">
            <li v-for="(s, i) in series.successConditions.slice(0, 4)" :key="`sc-${i}`">{{ s }}</li>
          </ul>
        </div>
      </section>
    </div>

    <footer class="effect-ft" data-testid="effect-footer">
      <div class="meta-card">
        <div class="meta-row">
          <span class="meta-k">监测对象</span>
          <span class="meta-v">{{ series.targetLabel }} → 上游 {{ series.downstreamName }}</span>
        </div>
        <div class="meta-row">
          <span class="meta-k">回滚</span>
          <span class="meta-v">{{ series.rolledBack ? '已触发' : '未触发' }}</span>
        </div>
      </div>
      <div class="effect-actions">
        <button
          type="button"
          class="btn btn-primary"
          data-testid="effect-finish"
          @click="emit('finish')"
        >
          进入技能固化
        </button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.effect {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.effect-hd {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  flex-shrink: 0;
}
.effect-eyebrow {
  font-size: 10px;
  letter-spacing: 1px;
  color: var(--cyan-dim);
}
.effect-hd h2 {
  margin: 2px 0;
  font-size: 16px;
  color: var(--text);
}
.effect-sub {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}
.progress-card {
  text-align: right;
  font-size: 11px;
  color: var(--text-muted);
}
.progress-card strong {
  display: block;
  font-size: 22px;
  color: var(--ok);
}
.timing-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
  flex-shrink: 0;
}
.chip {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 2px;
  border: 1px solid rgba(51, 204, 136, 0.35);
  color: var(--ok);
  background: rgba(51, 204, 136, 0.08);
}
.chip.mute {
  border-color: var(--cyan-border);
  color: var(--text-muted);
  background: rgba(0, 0, 0, 0.18);
}
.workbench {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 128px minmax(0, 1fr);
  gap: 12px;
}
.timeline h3 {
  margin: 0 0 8px;
  font-size: 11px;
  color: var(--cyan-dim);
}
.timeline-item {
  display: grid;
  grid-template-columns: 10px 1fr auto;
  gap: 6px;
  align-items: center;
  font-size: 11px;
  color: rgba(160, 200, 220, 0.45);
  margin-bottom: 6px;
}
.timeline-item.is-active,
.timeline-item.is-done {
  color: var(--text);
}
.timeline-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(160, 200, 220, 0.35);
}
.timeline-item.is-active .timeline-dot {
  background: var(--cyan);
  box-shadow: 0 0 6px rgba(0, 229, 255, 0.6);
}
.timeline-item.is-done .timeline-dot {
  background: var(--ok);
}
.timeline-pct {
  color: rgba(160, 200, 220, 0.45);
}
.main-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 10px;
  overflow: auto;
}
.kpi-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  flex-shrink: 0;
}
.kpi {
  padding: 8px 10px;
  border: 1px solid var(--cyan-border);
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.28);
}
.kpi-k {
  display: block;
  font-size: 10px;
  color: var(--cyan-dim);
  margin-bottom: 4px;
}
.kpi-v {
  display: block;
  font-size: 16px;
  color: var(--text);
  font-weight: 700;
}
.kpi-v.up { color: var(--ok); }
.kpi-v.down { color: #7ee8f5; }
.kpi-base {
  display: block;
  margin-top: 2px;
  font-size: 10px;
  font-style: normal;
  color: rgba(160, 200, 220, 0.45);
}
.table-wrap {
  border: 1px solid var(--cyan-border);
  border-radius: 2px;
  overflow: auto;
  background: rgba(0, 0, 0, 0.22);
}
.cycle-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}
.cycle-table th,
.cycle-table td {
  padding: 7px 8px;
  text-align: left;
  border-bottom: 1px solid rgba(0, 229, 255, 0.1);
  color: var(--text);
}
.cycle-table th {
  color: var(--cyan-dim);
  font-weight: 600;
  background: rgba(0, 229, 255, 0.04);
}
.cycle-table tr.dim td {
  color: rgba(160, 200, 220, 0.35);
}
.cycle-table tr.current td {
  background: rgba(0, 229, 255, 0.06);
}
.mono {
  font-family: var(--font-mono);
  font-size: 11px;
}
.tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 2px;
}
.tag.ok {
  color: var(--ok);
  background: rgba(51, 204, 136, 0.12);
}
.tag.warn {
  color: var(--danger);
  background: rgba(255, 68, 68, 0.12);
}
.tag.mute {
  color: var(--text-muted);
  background: rgba(160, 200, 220, 0.1);
}
.verdict {
  padding: 12px 14px;
  border: 1px solid rgba(51, 204, 136, 0.35);
  border-radius: 4px;
  background: linear-gradient(
    135deg,
    rgba(51, 204, 136, 0.12) 0%,
    rgba(0, 229, 255, 0.06) 55%,
    rgba(4, 12, 30, 0.2) 100%
  );
}
.verdict-banner {
  margin-bottom: 10px;
}
.verdict-eyebrow {
  display: inline-block;
  font-size: 10px;
  letter-spacing: 1px;
  color: var(--ok);
  margin-bottom: 4px;
}
.verdict b {
  display: block;
  font-size: 15px;
  line-height: 1.35;
  color: var(--ok);
  margin-bottom: 4px;
}
.verdict p {
  margin: 0;
  font-size: 12px;
  color: var(--text);
}
.outcome-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 8px;
}
.outcome-card {
  padding: 10px 10px 8px;
  border-radius: 2px;
  border: 1px solid var(--cyan-border);
  background: rgba(0, 0, 0, 0.28);
}
.outcome-card.ok {
  border-color: rgba(51, 204, 136, 0.4);
  background: rgba(51, 204, 136, 0.08);
}
.outcome-card.bad {
  border-color: rgba(255, 68, 68, 0.35);
}
.outcome-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 2px;
  margin-bottom: 4px;
  color: var(--text-muted);
  background: rgba(160, 200, 220, 0.12);
}
.outcome-card.ok .outcome-badge {
  color: #041016;
  background: var(--ok);
}
.outcome-card strong {
  display: block;
  font-size: 13px;
  color: var(--text);
  margin-bottom: 4px;
}
.outcome-card p {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-muted);
}
.cond-list {
  margin: 0;
  padding-left: 16px;
  font-size: 11px;
  color: var(--text-muted);
}
.effect-ft {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(0, 229, 255, 0.15);
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
}
.meta-card {
  display: grid;
  gap: 4px;
  font-size: 11px;
}
.meta-row {
  display: flex;
  gap: 8px;
}
.meta-k {
  color: var(--cyan-dim);
  min-width: 48px;
}
.meta-v {
  color: var(--text);
}
.btn {
  padding: 8px 18px;
  border-radius: 2px;
  border: 1px solid var(--cyan-border-strong);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
}
.btn-primary {
  background: rgba(0, 229, 255, 0.92);
  color: rgba(4, 12, 22, 0.95);
}
.btn-primary:hover {
  background: var(--cyan);
}
@media (max-width: 1100px) {
  .outcome-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 900px) {
  .kpi-row {
    grid-template-columns: repeat(2, 1fr);
  }
  .workbench {
    grid-template-columns: 1fr;
  }
}
</style>

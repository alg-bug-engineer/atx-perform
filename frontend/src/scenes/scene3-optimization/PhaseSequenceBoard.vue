<script setup>
/**
 * 相位相序图：对齐 assets/信控方案可视化图.png
 * 一阶段一张卡，绿时前后对比 + 渠化流向。
 * 数据源两种口径：幕 4 专家建议板（key=jingshi/jiefang）与幕 4b 引擎方案板（3 路口）。
 * 默认选中「焦点路口」（无焦点标记时优先解放东，即幕 4 有改动的口）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { broadcastSilent, currentBroadcast } from '../../shared/broadcast-bus.js'
import StageChannelization from '../scene3b-signal-plan/StageChannelization.vue'
import { stageCanvasKeys, stageFlowLabel } from '../scene3b-signal-plan/corridorStageCanvas.js'

const props = defineProps({
  board: { type: Object, required: true },
  /** 缩小预览：只演示两张卡（阶段 1 / 阶段 2） */
  compact: { type: Boolean, default: false },
})

const selectedKey = ref(null)
const revealedDeltaCount = ref(0)
let revealTimers = []

const nodes = computed(() => {
  const list = [...(props.board?.intersections || [])]
  return list.sort(
    (a, b) =>
      Number(Boolean(b.is_focus)) - Number(Boolean(a.is_focus)) ||
      Number(b.key === 'jiefang') - Number(a.key === 'jiefang'),
  )
})

const node = computed(
  () => nodes.value.find((n) => n.key === selectedKey.value) || nodes.value[0],
)

function pickLabel(n) {
  if (n.short_name) return n.short_name
  if (n.key === 'jiefang') return '解放东'
  return '经十路'
}

const cards = computed(() => {
  const n = node.value
  if (!n) return []
  const mapped = (n.stages || [])
    .filter((s) => s.green_before_s > 0 || s.green_after_s > 0 || (s.movements || []).length)
    .map((s) => {
      const delta = s.timing_delta_s ?? s.green_delta_s ?? 0
      const canvasKeys = stageCanvasKeys(s)
      const tone = delta < 0 ? 'cut' : delta > 0 ? 'add' : 'flat'
      return {
        key: `${n.key}-${s.stage_seq_no}`,
        seq: s.stage_seq_no,
        stageNo: s.stage_no,
        stageName: s.stage_name || '',
        role: s.role,
        note: s.note,
        focus: Boolean(s.feeds_problem_link),
        movements: s.movements || [],
        labels: stageFlowLabel(canvasKeys),
        before: s.timing_before_s ?? s.green_before_s,
        after: s.timing_after_s ?? s.green_after_s,
        delta,
        tone,
        minG: s.min_green_sec,
        maxG: s.max_green_sec,
      }
    })
  if (!props.compact) return mapped
  const demo = mapped.filter((c) => c.movements.length).slice(0, 2)
  return demo.map((c, i) => ({ ...c, demoNo: i + 1 }))
})

function deltaText(d) {
  if (d === 0) return '±0s'
  return `${d > 0 ? '+' : ''}${d}s`
}

function clearRevealTimers() {
  revealTimers.forEach((timer) => window.clearTimeout(timer))
  revealTimers = []
}

function reduceMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** 阶段差值跟随本幕约 25 秒的 s3-main 口播逐项揭示。 */
function revealDeltas(voice = null, quick = false) {
  clearRevealTimers()
  const total = cards.value.length
  if (!total) return
  if (reduceMotion() || props.compact) {
    revealedDeltaCount.value = total
    return
  }
  revealedDeltaCount.value = 0
  const durationMs = Math.max(0, Number(voice?.durationSec) || 0) * 1000
  const startMs = quick ? 180 : 1800
  const intervalMs = quick
    ? 360
    : Math.max(900, Math.min(2500, (durationMs * 0.42) / Math.max(1, total - 1)))
  for (let i = 0; i < total; i += 1) {
    revealTimers.push(window.setTimeout(() => {
      revealedDeltaCount.value = i + 1
    }, startMs + i * intervalMs))
  }
}

watch(currentBroadcast, (item) => {
  if (item?.key === 's3-main') revealDeltas(item)
})

watch(() => node.value?.key, (next, prev) => {
  if (prev && next !== prev) revealDeltas(null, true)
})

onMounted(() => {
  if (currentBroadcast.value?.key === 's3-main') revealDeltas(currentBroadcast.value)
  else if (broadcastSilent.value) revealDeltas(null, true)
  else revealTimers.push(window.setTimeout(() => {
    if (revealedDeltaCount.value === 0) revealDeltas(null, true)
  }, 1200))
})

onBeforeUnmount(clearRevealTimers)
</script>

<template>
  <section v-if="node" class="phase-board" :class="{ compact }" data-testid="phase-sequence">
    <header class="col-head">
      <h3>相位相序图</h3>
      <div class="picker">
        <button
          v-for="n in nodes"
          :key="n.key"
          type="button"
          class="tg"
          :class="{ on: n.key === node.key }"
          @click="selectedKey = n.key"
        >
          {{ pickLabel(n) }}
        </button>
      </div>
      <slot name="head-extra" />
    </header>

    <p class="note">{{ node.note }}</p>

    <ul class="meta">
      <li>
        <span>周期</span>
        <strong>{{ node.cycle_len_sec }} s</strong>
      </li>
      <li>
        <span>相位差</span>
        <strong>
          {{ node.offset_before_s }} → {{ node.offset_after_s }} s
          <em v-if="node.offset_delta_s" :class="node.offset_delta_s > 0 ? 'add' : 'cut'">
            {{ node.offset_delta_s > 0 ? '+' : '' }}{{ node.offset_delta_s }}s
          </em>
        </strong>
      </li>
    </ul>

    <div class="cards">
      <article
        v-for="(c, index) in cards"
        :key="c.key"
        class="card"
        :class="[c.tone, { focus: c.focus }]"
      >
        <header>
          <span class="ph">阶段 {{ compact ? c.demoNo : c.seq }}</span>
          <strong class="comparison">
            <span class="before">{{ c.before }}s</span>
            <span class="arrow">→</span>
            <span class="after">{{ c.after }}s</span>
            <span class="delta-slot" aria-live="polite">
              <Transition name="delta-pop">
                <b v-if="index < revealedDeltaCount">{{ deltaText(c.delta) }}</b>
              </Transition>
            </span>
          </strong>
        </header>
        <div class="chan-slot">
          <StageChannelization :movements="c.movements" :stage-name="c.stageName" />
        </div>
        <p class="labels">{{ c.labels || '过渡 / 行人' }}</p>
      </article>
    </div>
  </section>
</template>

<style scoped>
.phase-board {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  padding: 14px 16px 16px;
  border: 1px solid #dfe7f1;
  border-radius: 12px;
  background: #f8fafc;
}

.col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 1px;
  color: #172033;
}
.picker {
  display: flex;
  gap: 4px;
  margin-left: auto;
}
.tg {
  padding: 2px 10px;
  font-size: 11px;
  letter-spacing: 1px;
  color: #64748b;
  background: #fff;
  border: 1px solid #d7e5db;
  border-radius: 5px;
  cursor: pointer;
}
.tg.on {
  color: #fff;
  background: #1683a1;
  border-color: #1683a1;
}

.note {
  margin: 6px 0 4px;
  font-size: 11px;
  line-height: 1.45;
  color: #64748b;
}

.meta {
  display: flex;
  gap: 14px;
  margin: 0 0 8px;
  padding: 0;
  list-style: none;
  font-size: 11px;
}
.meta span {
  margin-right: 6px;
  color: #64748b;
}
.meta strong {
  font-weight: 500;
  color: #334155;
}
.meta em {
  margin-left: 4px;
  font-style: normal;
}
.meta em.add,
.card.add header b {
  color: #16a34a;
}
.meta em.cut,
.card.cut header b {
  color: #dc2626;
}

.cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-auto-rows: max-content;
  gap: 10px;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  flex: 1;
  padding: 4px 2px 6px;
  scrollbar-width: thin;
  scrollbar-color: #cbd5e1 transparent;
}
.card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 10px;
  border: 1px solid #d7e5db;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 40, 28, 0.04);
  overflow: hidden;
}
.card.focus {
  border-color: #9fd7b6;
  box-shadow: 0 1px 3px rgba(22, 163, 74, 0.12);
}
.card header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.ph {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #1f5b3d;
}
.card header strong {
  font-size: 14px;
  font-weight: 600;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
}
.card header b {
  font-size: 12px;
  font-weight: 700;
}
.card.flat header b {
  color: #94a3b8;
}

.comparison {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 5px;
  min-height: 23px;
  white-space: nowrap;
}
.comparison .before {
  text-decoration: line-through;
  text-decoration-thickness: 2px;
  text-decoration-color: #cbd5e1;
}
.comparison .arrow { font-size: 12px; }
.comparison .after {
  font-size: 22px;
  font-weight: 800;
  line-height: 1;
  color: #16a34a;
}
.delta-slot { display: inline-block; min-width: 31px; }
.delta-pop-enter-active {
  transition: opacity 0.32s ease, transform 0.32s cubic-bezier(.2, .8, .2, 1);
}
.delta-pop-enter-from { opacity: 0; transform: translateY(7px) scale(.82); }

.chan-slot {
  width: min(150px, 100%);
  aspect-ratio: 1;
  flex: 0 0 auto;
}
.chan-slot :deep(.chan) {
  width: 100%;
  height: 100%;
}

.labels,
.role,
.bound {
  margin: 0;
  max-width: 152px;
  font-size: 11px;
  line-height: 1.45;
  text-align: center;
  color: #64748b;
}
.role {
  color: #475569;
}

.phase-board.compact {
  width: 100%;
  height: 100%;
  min-height: 0;
}
.phase-board.compact .note,
.phase-board.compact .meta,
.phase-board.compact .bound {
  display: none;
}
.phase-board.compact .cards {
  width: 100%;
  display: grid;
  grid-template-columns: 1fr 1fr;
  overflow: hidden;
  min-height: 0;
}

.phase-board.compact .card {
  width: auto;
  height: 100%;
  min-height: 0;
  padding: 10px;
  gap: 8px;
}
.phase-board.compact .ph {
  font-size: 12px;
}
.phase-board.compact .card header strong {
  font-size: 16px;
}
.phase-board.compact .labels,
.phase-board.compact .role {
  display: block;
  font-size: 12px;
}
.phase-board.compact .chan-slot {
  flex: 1 1 0;
  min-height: 0;
}

@media (prefers-reduced-motion: reduce) {
  .delta-pop-enter-active { transition: none; }
}
</style>

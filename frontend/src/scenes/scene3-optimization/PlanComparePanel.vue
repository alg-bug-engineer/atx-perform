<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import TimeSpaceDiagram from '../scene3b-signal-plan/TimeSpaceDiagram.vue'
import { buildSignalPlanModel } from '../scene3b-signal-plan/signalPlanModel.js'
import PhaseSequenceBoard from './PhaseSequenceBoard.vue'
import OffsetAlignStrip from './OffsetAlignStrip.vue'
import CorridorStage from './CorridorStage.vue'
import { buildCorridorDemo, findBriefingBeats, greenBands, sampleVariant } from './corridorDemo.js'

const props = defineProps({
  payload: { type: Object, required: true },
  signalPlan: { type: Object, default: null },
})

const board = computed(() => props.payload?.signal_plan_board || null)
const tsModel = computed(() => (props.signalPlan ? buildSignalPlanModel(props.signalPlan) : null))
const demo = computed(() => {
  try {
    return buildCorridorDemo(props.payload)
  } catch (err) {
    console.warn('[scene3] corridor demo failed', err)
    return null
  }
})

const before = computed(() => demo.value?.variants.find((v) => v.key === 'before') || null)
const after = computed(() => demo.value?.variants.find((v) => v.key === 'after') || null)

const mode = ref('optimized')
const direction = ref('both')
const enlarged = ref(null)

const clock = ref(0)
const paused = ref(false)
const guided = ref(false)
const holdRemain = ref(0)
const BEAT_IDLE = { tag: '说明', text: '解放东放行窗口对准经十路绿灯', tone: 'ok' }
const beatCaption = ref({ ...BEAT_IDLE })
const speed = ref(7)

const beats = computed(() => findBriefingBeats(before.value, after.value))
const fired = new Set()

let rafId = 0
let lastTs = 0
function tick(ts) {
  if (lastTs && demo.value && !paused.value) {
    const dt = (ts - lastTs) / 1000
    const cycle = demo.value.cycleLen || 220
    if (holdRemain.value > 0) {
      holdRemain.value -= dt
    } else {
      const next = clock.value + dt * speed.value
      if (guided.value) {
        const hit = beats.value.find((b) => clock.value < b.t && next >= b.t && !fired.has(b.id))
        if (hit) {
          clock.value = hit.t
          holdRemain.value = hit.hold
          beatCaption.value = { tag: hit.tag, text: hit.text, tone: hit.tone }
          fired.add(hit.id)
        } else if (next >= cycle) {
          clock.value = cycle - 0.01
          guided.value = false
          paused.value = true
          beatCaption.value = { tag: '演示结束', text: '可再次播放', tone: 'plain' }
        } else {
          clock.value = next
        }
      } else {
        clock.value = next % cycle
      }
    }
  }
  lastTs = ts
  rafId = requestAnimationFrame(tick)
}

function playOnce() {
  fired.clear()
  clock.value = 0
  holdRemain.value = 0.4
  paused.value = false
  guided.value = true
  speed.value = 8
  beatCaption.value = { tag: '演示', text: '先观察现状拥堵形成，再对比优化后通行', tone: 'plain' }
}

function onKey(e) {
  if (e.key === 'Escape') enlarged.value = null
}

onMounted(() => {
  rafId = requestAnimationFrame(tick)
  window.addEventListener('keydown', onKey)
  playOnce()
})
onUnmounted(() => {
  cancelAnimationFrame(rafId)
  window.removeEventListener('keydown', onKey)
})

const beforeSample = computed(() => (before.value ? sampleVariant(before.value, clock.value) : null))
const afterSample = computed(() => (after.value ? sampleVariant(after.value, clock.value) : null))

const resultCards = computed(() => {
  const list = (demo.value?.kpis || props.payload?.corridor_demo?.kpis || []).filter(
    (k) => k.key !== 'cycle_end_queue',
  )
  return list.map((k) => {
    const drop = k.before > 0 ? Math.round(((k.before - k.after) / k.before) * 100) : 0
    const cleared = k.after === 0 && k.before > 0
    return {
      key: k.key,
      label: k.label,
      unit: k.unit,
      before: k.before,
      after: k.after,
      delta: cleared ? '已消除' : drop > 0 ? `↓ ${drop}%` : '持平',
    }
  })
})

const jingshiBefore = computed(() =>
  before.value
    ? greenBands(before.value.jingshiPlan, before.value.displayStartS, before.value.cycleLen, 0, 2)
    : [],
)
const jiefangBefore = computed(() =>
  before.value
    ? greenBands(before.value.jiefangPlan, before.value.displayStartS, before.value.cycleLen, 0, 2)
    : [],
)
const jingshiAfter = computed(() =>
  after.value
    ? greenBands(after.value.jingshiPlan, after.value.displayStartS, after.value.cycleLen, 0, 2)
    : [],
)
const jiefangAfter = computed(() =>
  after.value
    ? greenBands(after.value.jiefangPlan, after.value.displayStartS, after.value.cycleLen, 0, 2)
    : [],
)

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

const enlargeTitle = computed(() => {
  if (enlarged.value === 'phase') return '相位相序图'
  if (enlarged.value === 'wave') return '绿波时距图'
  return ''
})
const enlargeLead = computed(() => {
  if (enlarged.value === 'phase') return 'phase'
  if (enlarged.value === 'wave') return 'wave'
  return ''
})
const cycleLen = computed(() => demo.value?.cycleLen || 220)
const clockLabel = computed(() => `${Math.floor(clock.value)} / ${cycleLen.value} s`)
</script>

<template>
  <section class="plan-compare" data-testid="plan-compare">
    <header class="head">
      <h2 class="lead-headline">路口的优化方案为<span>相位协调</span></h2>
      <div class="tech">
        <span>技术细节</span>
        <button v-if="board" type="button" class="diagram-btn" @click="enlarged = 'phase'">
          相位相序图
        </button>
        <button v-if="tsModel" type="button" class="diagram-btn" @click="enlarged = 'wave'">
          绿波时距图
        </button>
      </div>
    </header>

    <ul class="posters" data-testid="scene3-kpis">
      <li v-for="c in resultCards" :key="c.key">
        <span class="poster-k">{{ c.label }}</span>
        <b class="poster-badge">改善</b>
        <strong>
          {{ c.before }}{{ c.unit }} → <em>{{ c.after }}{{ c.unit }}</em>
        </strong>
        <span class="poster-d">{{ c.delta }}</span>
      </li>
    </ul>

    <div class="compare">
      <div class="compare-bar">
        <span class="compare-title">方案对比</span>
        <p class="beat-line">
          <span class="clock"><i>周期</i> {{ clockLabel }}</span>
          <span class="beat">
            <b :class="beatCaption.tone">{{ beatCaption.tag }}</b>
            <span>{{ beatCaption.text }}</span>
          </span>
        </p>
        <div class="compare-acts">
          <button type="button" class="play-btn" @click="playOnce">播放演示</button>
          <button type="button" class="play-btn ghost" @click="paused = !paused">
            {{ paused ? '继续' : '暂停' }}
          </button>
        </div>
      </div>
      <div v-if="demo" class="align-row">
        <OffsetAlignStrip
          compact
          title="现状配时"
          hint="经十路 / 解放东北直绿窗"
          key-word="错开"
          tone="danger"
          :cycle-len="cycleLen"
          :t="clock"
          :jingshi="jingshiBefore"
          :jiefang="jiefangBefore"
        />
        <OffsetAlignStrip
          compact
          title="优化后"
          hint="经十路 / 解放东北直绿窗"
          key-word="对准"
          tone="ok"
          :cycle-len="cycleLen"
          :t="clock"
          :jingshi="jingshiAfter"
          :jiefang="jiefangAfter"
        />
      </div>
      <div class="stage">
        <CorridorStage
          v-if="demo && before"
          :model="demo"
          :variant="before"
          :sample="beforeSample"
          show-expert-queue
        />
        <CorridorStage
          v-if="demo && after"
          :model="demo"
          :variant="after"
          :sample="afterSample"
          :ghost-queue-m="beforeSample?.queueM || 0"
        />
        <p v-if="!demo" class="empty">走廊仿真数据未就绪</p>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="enlarged"
        class="lightbox"
        data-testid="scene3-enlarge"
        @click.self="enlarged = null"
      >
        <div class="sheet" :class="enlarged">
          <header>
            <h3>{{ enlargeTitle }}</h3>
            <div v-if="enlarged === 'wave'" class="toggles">
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
            <button type="button" class="close" @click="enlarged = null">关闭</button>
          </header>
          <p v-if="enlargeLead === 'phase'" class="lead-copy">
            解放东整体后移 <b class="ok">56 s</b>，北进口直行绿时 <b class="warn">21 → 15 s</b>，经十路配时维持不变。
          </p>
          <p v-else-if="enlargeLead === 'wave'" class="lead-copy">
            解放东放行窗口对准经十路南北绿灯，正向绿波 <b class="ok">衔接</b>。
          </p>
          <p v-if="enlarged === 'wave'" class="hint">{{ diagramHint }}</p>
          <div class="sheet-body">
            <PhaseSequenceBoard v-if="enlarged === 'phase' && board" :board="board" />
            <TimeSpaceDiagram
              v-else-if="enlarged === 'wave' && tsModel"
              :model="tsModel"
              :mode="mode"
              :direction="direction"
            />
          </div>
          <p v-if="enlarged === 'wave'" class="caption">{{ bandCaption }}</p>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.plan-compare {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 8px;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.lead-headline {
  margin: 0;
  min-width: 0;
  flex: 1;
}
.lead-headline span { color: var(--text); }

.tech {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.tech > span {
  font-size: 12px;
  letter-spacing: 1px;
  color: var(--text-muted);
}

.posters {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.posters li {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 4px 8px 4px;
  border: 1px solid var(--cyan-border);
  border-left: 3px solid var(--ok);
  border-radius: 2px;
  background: rgba(0, 20, 34, 0.55);
}
.poster-k {
  font-size: 11px;
  letter-spacing: 0.4px;
  color: var(--text-muted);
}
.poster-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1px;
  color: var(--ok);
  border: 1px solid rgba(51, 204, 136, 0.45);
  border-radius: 2px;
}
.posters strong {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px;
  font-size: 16px;
  font-weight: 500;
  line-height: 1.2;
  color: var(--text);
}
.posters strong em {
  font-style: normal;
  color: var(--text);
}
.poster-d {
  font-size: 11px;
  font-weight: 600;
  color: var(--ok);
}

.compare {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  padding: 6px 8px 8px;
  border: 1px solid var(--cyan-border);
  background: rgba(0, 16, 28, 0.35);
}
.compare-bar {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex: none;
  min-width: 0;
}
.compare-title {
  flex: none;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 1.5px;
  color: var(--text);
}
.compare-acts {
  display: flex;
  gap: 8px;
  margin-left: auto;
  flex: none;
}
.play-btn,
.diagram-btn {
  padding: 6px 14px;
  font-size: 12px;
  letter-spacing: 1px;
  color: var(--text);
  background: transparent;
  border: 1px solid var(--cyan-border);
  cursor: pointer;
}
.play-btn {
  color: #041020;
  background: var(--cyan);
  border-color: var(--text);
}
.play-btn.ghost,
.diagram-btn {
  color: var(--text);
  background: transparent;
  border-color: var(--cyan-border);
}
.play-btn:hover { box-shadow: 0 0 12px rgba(0, 229, 255, 0.45); }
.diagram-btn:hover {
  color: var(--text);
  border-color: var(--cyan-border-strong);
}

.beat-line {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin: 0;
  min-width: 0;
  flex: 1;
}
.beat-line .clock {
  flex: none;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text);
}
.beat-line .clock i {
  margin-right: 6px;
  font-style: normal;
  color: var(--text);
}
.beat {
  display: flex;
  gap: 8px;
  min-width: 0;
  font-size: 13px;
  color: var(--text);
}
.beat b { flex: none; font-weight: 600; }
.beat b.danger { color: var(--danger); }
.beat b.ok { color: var(--ok); }
.beat b.plain { color: var(--text); }
.beat span { font-weight: 400; color: var(--text); }

.align-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  flex: none;
  min-width: 0;
}
.stage {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
}
.stage :deep(.corridor) {
  flex: 1 1 0;
  min-height: 0;
}
.empty {
  margin: auto;
  font-size: 12px;
  color: var(--text);
}

.sheet header h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 1px;
  color: var(--text);
}

.close,
.tg {
  padding: 2px 10px;
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--text);
  background: transparent;
  border: 1px solid var(--cyan-border);
  cursor: pointer;
}
.close:hover {
  color: var(--text);
  border-color: var(--cyan-border-strong);
}
.tg.on {
  color: #041020;
  background: var(--cyan);
  border-color: var(--text);
}

.lightbox {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px;
  background: rgba(2, 8, 18, 0.78);
}
.sheet {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(1180px, 94vw);
  height: min(820px, 90vh);
  padding: 12px 14px 14px;
  border: 1px solid var(--cyan-border-strong);
  border-radius: 4px;
  background: var(--bg-drawer);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
}
.sheet.phase {
  width: min(1080px, 94vw);
}
.sheet header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}
.sheet header .toggles {
  display: flex;
  gap: 4px;
  align-items: center;
  margin-left: 8px;
}
.sheet header .close {
  margin-left: auto;
}
.sep {
  width: 1px;
  height: 12px;
  background: var(--cyan-border);
}
.hint,
.caption,
.lead-copy {
  margin: 0;
  flex: none;
  font-size: 12px;
  color: var(--text);
}
.lead-copy b.ok { color: var(--ok); font-weight: 600; }
.lead-copy b.warn { color: var(--warn); font-weight: 600; }
.sheet-body {
  flex: 1;
  min-height: 0;
}
.sheet-body :deep(.phase-board),
.sheet-body :deep(.tsd) {
  width: 100%;
  height: 100%;
}
</style>

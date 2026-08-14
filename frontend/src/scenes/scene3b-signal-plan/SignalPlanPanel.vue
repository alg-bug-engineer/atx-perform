<script setup>
/** 信控方案调节面板：方案指标条 + 绿波时距图 + 路口配时对比 + 比选与风险 */
import { computed, ref } from 'vue'
import TimeSpaceDiagram from './TimeSpaceDiagram.vue'
import StageTimingCompare from './StageTimingCompare.vue'
import { buildSignalPlanModel } from './signalPlanModel.js'

const props = defineProps({
  payload: { type: Object, required: true },
})

const model = computed(() => buildSignalPlanModel(props.payload))

const mode = ref('optimized')
const direction = ref('both')
const selectedId = ref('011wwe28ctu00001')

const selectedNode = computed(
  () => model.value.rawNodes.find((n) => n.inter_id === selectedId.value) || model.value.rawNodes[0],
)

function fmt(v) {
  if (v == null) return '—'
  return Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10
}

/** 指标条只展示 KPI_ORDER 选中的几项，文案里仍可取全量口径 */
function kpi(name) {
  return props.payload.kpis.find((k) => k.name === name)
}

/** 带宽类指标跟随方向切换；「双向」时按方案实际协调的南向北口径 */
const bandDir = computed(() => (direction.value === 'forward' ? 'forward' : 'reverse'))
const dirLabel = computed(() => (bandDir.value === 'forward' ? '北向南' : '南向北'))

/** 概述只引用引擎指标，不自造口径 */
const lede = computed(() => {
  const c = model.value.corridor
  const band = kpi('chained_bandwidth_s')
  const travel = kpi('travel_time_s')
  const delay = kpi('coordinated_direction_delay_s')
  return `公共周期由现状 ${c.baseline_cycles_s.join(' / ')} s 统一为 ${c.cycle_s} s，七个路口相位差重排；绿波带宽 ${fmt(band?.baseline)} → ${fmt(band?.optimized)} s，协调方向通行时间缩短 ${fmt(Math.abs(travel?.delta ?? 0))} s、平均延误降 ${fmt(Math.abs(delay?.delta ?? 0))} s/车。`
})

const headChips = computed(() => {
  const c = model.value.corridor
  const m = model.value.meta
  return [
    { k: '公共周期', v: `${c.cycle_s} s`, sub: `现状 ${c.baseline_cycles_s.join(' / ')} s`, tone: 'change' },
    { k: '协调策略', v: m.strategy_label, sub: m.strategy_family_label, tone: 'hold' },
    { k: '设计车速', v: `${c.design_speed_kmh.toFixed(1)} km/h`, sub: '晚高峰实测干线速度', tone: 'hold' },
    {
      k: '相位差重排',
      v: `${fmt(kpi('avg_abs_offset_change_s')?.optimized)} s`,
      sub: `${model.value.rawNodes.length} 个路口平均调整`,
      tone: 'change',
    },
  ]
})

const kpiCards = computed(() =>
  model.value.kpis.map((k) => ({
    name: k.name,
    label: k.label,
    value: fmt(k.optimized),
    base: fmt(k.baseline),
    delta: k.delta == null ? null : fmt(k.delta),
    hasBase: k.baseline != null,
    tone: k.improved === true ? 'good' : k.improved === false ? 'bad' : 'flat',
  })),
)

const linkRows = computed(() =>
  model.value.views.optimized.links.map((l) => ({
    key: l.key,
    label: `${l.from} → ${l.to}`,
    isFocus: l.to === '经十路',
    lengthM: l.lengthM,
    travelS: bandDir.value === 'forward' ? l.travelForwardS : l.travelReverseS,
  })),
)

const offsetRows = computed(() =>
  model.value.rawNodes.map((n) => ({
    key: n.inter_id,
    name: n.short_name,
    isFocus: n.is_focus,
    before: n.baseline.offset_s,
    after: n.optimized.offset_s,
    delta: n.offset_delta_s,
  })),
)

/** 引擎只对优化后方案跑 Newell 轨迹，现状侧如实说明缺什么 */
const diagramHint = computed(() =>
  mode.value === 'optimized'
    ? '服务端 Newell 轨迹 · 横轴里程 · 纵轴时间自下而上'
    : '现状仅绘协调相位绿窗，引擎未对现状跑轨迹',
)

/** 与工作台时距图面板同样的两项 */
const bandCaption = computed(() => {
  if (mode.value === 'baseline') return '现状配时绿窗'
  const b = model.value.corridor.bandwidth
  return `正向链式带宽 ${fmt(b.chained_forward_s)} s · 反向链式带宽 ${fmt(b.chained_reverse_s)} s`
})
</script>

<template>
  <section v-if="model" class="signal-plan" data-testid="signal-plan">
    <header class="head">
      <p class="lead-eyebrow">信控方案调节 · {{ model.meta.subtitle }}</p>
      <h2 class="lead-headline">{{ lede }}</h2>
      <div class="chips">
        <div v-for="c in headChips" :key="c.k" class="chip" :class="c.tone" :title="c.sub">
          <span>{{ c.k }}</span>
          <strong>{{ c.v }}</strong>
        </div>
      </div>
    </header>

    <div class="expect">
      <span class="expect-tag">预期效果<em>模型估算</em></span>
      <ul class="kpis">
        <li v-for="k in kpiCards" :key="k.name" :class="k.tone">
          <span class="kl">{{ k.label }}</span>
          <span class="kv">
            <template v-if="k.hasBase"><i>{{ k.base }}</i> → </template>
            <b>{{ k.value }}</b>
            <em v-if="k.delta != null" class="kd">
              {{ k.delta > 0 ? '+' : '' }}{{ k.delta }}
            </em>
          </span>
        </li>
      </ul>
    </div>

    <div class="body">
      <div class="col diagram">
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
          <TimeSpaceDiagram :model="model" :mode="mode" :direction="direction" />
        </div>
        <p class="caption">{{ bandCaption }}</p>
      </div>

      <div class="col timing">
        <div class="col-head">
          <h3>路口配时对比</h3>
          <div class="picker">
            <button
              v-for="n in model.rawNodes"
              :key="n.inter_id"
              type="button"
              class="tg"
              :class="{ on: selectedId === n.inter_id, focus: n.is_focus }"
              @click="selectedId = n.inter_id"
            >
              {{ n.short_name }}
            </button>
          </div>
        </div>
        <StageTimingCompare :node="selectedNode" />
      </div>

      <div class="col side">
        <div class="side-scroll">
          <div class="col-head">
            <h3>逐段行程时间</h3>
            <span class="hint">{{ dirLabel }} · s</span>
          </div>
          <ul class="links">
            <li v-for="l in linkRows" :key="l.key" :class="{ focus: l.isFocus }">
              <span class="ll">{{ l.label }}</span>
              <span class="lb">{{ fmt(l.lengthM) }} m</span>
              <span class="arw">·</span>
              <strong class="la">{{ fmt(l.travelS) }}</strong>
            </li>
          </ul>

          <div class="col-head tight">
            <h3>相位差重排</h3>
            <span class="hint">现状 → 优化 · s</span>
          </div>
          <ul class="links offsets">
            <li v-for="o in offsetRows" :key="o.key" :class="{ focus: o.isFocus }">
              <span class="ll">{{ o.name }}</span>
              <span class="lb">{{ o.before }}</span>
              <span class="arw">→</span>
              <strong class="la">{{ o.after }}</strong>
            </li>
          </ul>

          <div class="col-head tight">
            <h3>候选方案比选</h3>
            <span class="hint">综合分</span>
          </div>
          <ul class="cands">
            <li v-for="c in model.candidates" :key="c.candidate_id" :class="{ on: c.selected }">
              <span class="cl">{{ c.label }}</span>
              <strong class="cs" :class="{ pos: c.score_delta > 0 }">
                {{ c.score_delta > 0 ? '+' : '' }}{{ c.score_delta.toFixed(2) }}
              </strong>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.signal-plan {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 8px;
  height: 100%;
  min-height: 0;
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
  flex-direction: row;
  align-items: baseline;
  gap: 5px;
  padding: 2px 8px;
  border: 1px solid var(--cyan-border);
  border-radius: 2px;
  background: var(--bg-inset);
  white-space: nowrap;
  font-size: 10px;
  color: var(--text-muted);
}
.chip span {
  font-size: 10px;
  color: var(--text-muted);
}
.chip strong {
  font-size: 10px;
  font-weight: 500;
  color: rgba(190, 220, 236, 0.85);
}
.chip.change {
  border-color: rgba(51, 204, 136, 0.5);
}
.chip.change strong {
  color: var(--ok);
}
.chip.warn {
  border-color: rgba(255, 204, 0, 0.5);
}
.chip.warn strong {
  color: var(--warn);
}

/* 方案生成阶段的模型预估，压成一条，不与幕 4 的试运行实测抢视觉 */
.expect {
  display: flex;
  align-items: stretch;
  gap: 10px;
  padding: 4px 10px;
  border: 1px solid var(--cyan-border);
  border-left: 2px solid var(--cyan-border-strong);
  background: rgba(0, 22, 38, 0.5);
}
.expect-tag {
  display: flex;
  flex-direction: column;
  justify-content: center;
  flex: none;
  padding-right: 10px;
  border-right: 1px solid var(--cyan-border);
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--cyan-dim);
}
.expect-tag em {
  font-style: normal;
  font-size: 9px;
  letter-spacing: 0;
  color: rgba(160, 200, 220, 0.45);
}

.kpis {
  display: flex;
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}
.kpis li {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
  padding: 2px 10px;
}
.kpis li + li {
  border-left: 1px solid var(--cyan-border);
}
.kl {
  font-size: 9.5px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kv {
  font-size: 12px;
  line-height: 1.3;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.kv i {
  font-style: normal;
  color: rgba(160, 200, 220, 0.5);
}
.kv b {
  font-size: 14px;
  font-weight: 600;
}
.kpis li.good .kv b {
  color: var(--ok);
}
.kpis li.bad .kv b {
  color: var(--danger);
}
.kd {
  margin-left: 4px;
  font-style: normal;
  font-size: 10px;
  font-weight: 600;
  color: rgba(160, 200, 220, 0.55);
}
.kpis li.good .kd {
  color: var(--ok);
}
.kpis li.bad .kd {
  color: var(--danger);
}

.body {
  display: grid;
  grid-template-columns: 1.55fr 1.05fr 0.7fr;
  gap: 12px;
  min-height: 0;
}
.col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--cyan-border);
  border-radius: 3px;
  background: rgba(0, 18, 32, 0.5);
}
.col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.col-head.tight {
  margin-top: 6px;
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

.toggles,
.picker {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  align-items: center;
}
.tg {
  padding: 3px 9px;
  font-size: 10px;
  letter-spacing: 1px;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid var(--cyan-border);
  border-radius: 2px;
  cursor: pointer;
}
.tg:hover {
  color: var(--cyan);
}
.tg.on {
  background: var(--cyan);
  border-color: var(--cyan);
  color: #041020;
}
.tg.focus:not(.on) {
  border-color: var(--cyan-border-strong);
  color: var(--cyan-dim);
}
.sep {
  width: 1px;
  height: 14px;
  background: var(--cyan-border);
  margin: 0 4px;
}

.canvas {
  flex: 1;
  min-height: 0;
}
/* 配时对比自身负责内部滚动，必须能被压缩 */
.col.timing > :deep(.stage-compare) {
  flex: 1;
  min-height: 0;
}
.caption {
  margin: 0;
  /* 右对齐避开左下角讲解头像的字幕气泡 */
  text-align: right;
  font-size: 10px;
  color: var(--text-muted);
}

.links,
.cands {
  display: grid;
  gap: 3px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.links li {
  display: grid;
  grid-template-columns: 1fr auto 12px auto;
  gap: 5px;
  align-items: center;
  font-size: 10px;
  color: var(--text-muted);
}
.links li.focus .ll {
  color: var(--cyan);
}
.arw {
  text-align: center;
}
.la {
  font-weight: 600;
  color: var(--ok);
  min-width: 30px;
  text-align: right;
}
.la.zero {
  color: var(--warn);
}
.links.offsets .la {
  color: var(--cyan);
}

.cands li {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px;
  align-items: center;
  padding: 2px 5px;
  font-size: 9.5px;
  color: rgba(160, 200, 220, 0.6);
  border-left: 2px solid transparent;
}
.cands li.on {
  border-left-color: var(--cyan);
  background: rgba(0, 229, 255, 0.07);
  color: var(--text);
}
.cands .cl {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cands .cs {
  font-weight: 600;
  min-width: 36px;
  text-align: right;
  color: rgba(255, 68, 68, 0.75);
}
.cands .cs.pos {
  color: var(--ok);
}

/* 侧栏统计区可滚动，避免内容顶破边框 */
.side-scroll {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--cyan-border-strong) transparent;
}

@media (max-width: 1500px) {
  .body {
    grid-template-columns: 1.3fr 1fr;
  }
  .col.side {
    grid-column: 1 / -1;
  }
}
</style>

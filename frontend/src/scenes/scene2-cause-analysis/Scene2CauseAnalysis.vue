<script setup>
/**
 * 幕 2 · 分析成因：上下游流量溯源 → 供需对照 → 下游绿灯约束。
 * 分镜（trace/supply/arterial/signal/overflow）取 1-2-flow-trace.json 的 map_beats，
 * 与另一套实现 act-02 的 flowTraceMapBeat 同名同序；溯源只用 flow_share_ratio。
 */
import { computed, onMounted, ref } from 'vue'
import SceneStage from '../../shared/components/SceneStage.vue'
import SceneHeadline from '../../shared/components/SceneHeadline.vue'
import CorridorMap from '../../shared/components/CorridorMap.vue'
import { prefersInstant, useSceneBeats } from '../../shared/useSceneBeats.js'
import { useSceneRoute } from '../../shared/useSceneRoute.js'
import { loadScene2Data } from './index.js'

const { setScene } = useSceneRoute()

const loading = ref(true)
const error = ref('')
const cause = ref(null)
const flowTrace = ref(null)
const objects = ref(null)
const locate = ref(null)

const direction = ref('UPSTREAM')
const turn = ref('through')

const TURNS = [
  { key: 'through', label: '直行' },
  { key: 'left', label: '左转' },
  { key: 'right', label: '右转' },
]

const BEATS = [
  { id: 'trace', ms: 3000 },
  { id: 'supply', ms: 2800 },
  { id: 'arterial', ms: 3200 },
  { id: 'signal', ms: 2800 },
  { id: 'overflow' },
]

const { current: beat, reached, start: startBeats } = useSceneBeats(BEATS, {
  instant: prefersInstant(),
})

onMounted(async () => {
  try {
    const data = await loadScene2Data()
    cause.value = data.cause
    flowTrace.value = data.flowTrace
    objects.value = data.objects
    locate.value = data.locate
    startBeats()
  } catch (e) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
})

const beats = computed(() => flowTrace.value?.map_beats || {})
const caption = computed(() => beats.value[beat.value]?.caption || beats.value.trace?.caption || '')

const target = computed(() => flowTrace.value?.target || {})
const demand = computed(() => cause.value?.demand_supply || {})
const constraint = computed(() => flowTrace.value?.downstream_constraint || {})
const fallback = computed(() => cause.value?.jingshi_ew_fallback_metrics || {})

const rows = computed(() => {
  const pack = direction.value === 'UPSTREAM'
    ? cause.value?.upstream_traces
    : cause.value?.downstream_traces
  return pack?.by_turn?.[turn.value] || []
})

/** 溯源链：每一跳挂到上一跳里几何最近的节点，末跳汇到目标路口 */
const traceGraph = computed(() => {
  const t = target.value
  if (!Number.isFinite(t.lng)) return { nodes: [], edges: [] }
  const root = { id: t.id, name: t.name, lon: t.lng, lat: t.lat, hop: 0 }
  const nodes = [root]
  const byHop = new Map([[0, [root]]])

  /** 同一路口可能有多条相关流向，按最近一跳 + 最大份额收敛成一个节点 */
  const merged = new Map()
  for (const r of rows.value) {
    if (!Number.isFinite(r.cor_lon)) continue
    const prev = merged.get(r.cor_inter_id)
    if (prev && (prev.hop < r.chain_hop || prev.share >= r.flow_share_ratio)) continue
    merged.set(r.cor_inter_id, {
      id: r.cor_inter_id,
      name: r.cor_inter_name?.replace('路口', '') || r.cor_inter_id,
      lon: r.cor_lon,
      lat: r.cor_lat,
      hop: r.chain_hop,
      share: r.flow_share_ratio,
    })
  }

  for (const node of [...merged.values()].sort((a, b) => a.hop - b.hop)) {
    nodes.push(node)
    byHop.set(node.hop, [...(byHop.get(node.hop) || []), node])
  }

  const edges = []
  for (const node of nodes) {
    if (!node.hop) continue
    const prev = byHop.get(node.hop - 1) || byHop.get(0)
    let anchor = prev[0]
    let best = Infinity
    for (const p of prev) {
      const d = (p.lon - node.lon) ** 2 + (p.lat - node.lat) ** 2
      if (d < best) {
        best = d
        anchor = p
      }
    }
    edges.push({ id: `${node.id}->${anchor.id}`, from: node, to: anchor, share: node.share })
  }
  return { nodes, edges }
})

const mapNodes = computed(() =>
  traceGraph.value.nodes.map((n) => ({
    id: n.id,
    name: n.hop === 0 ? `${n.name}（汇点）` : n.name,
    lon: n.lon,
    lat: n.lat,
    role: n.hop === 0 ? 'target' : 'upstream',
  })),
)

const links = computed(() => locate.value?.traffic_color_links || [])
const problemLinkId = computed(() => objects.value?.problem_link?.link_id || '')

const chips = computed(() => [
  { k: '路口需求', v: `${demand.value.demand_flow_veh_h ?? '—'} 辆/h` },
  { k: '北进口供给', v: `${demand.value.supply_capacity_veh_h ?? '—'} 辆/h`, tone: 'change' },
  {
    k: '路口最大饱和度',
    v: constraint.value.metrics?.intersection_saturation_max?.toFixed?.(2) ?? '—',
    tone: 'alert',
  },
  { k: '服务水平', v: constraint.value.metrics?.intersection_los || '—', tone: 'alert' },
])

/** 供需条形：以供给能力为满格 */
const supplyBar = computed(() => {
  const supply = demand.value.supply_capacity_veh_h || 1
  return {
    supply,
    demand: demand.value.demand_flow_veh_h || 0,
    pct: Math.min(100, ((demand.value.demand_flow_veh_h || 0) / supply) * 100),
  }
})

const approachCards = computed(() => {
  const east = fallback.value.east_entrance_E2W || {}
  const west = fallback.value.west_entrance_W2E || {}
  const m = constraint.value.metrics || {}
  return [
    {
      role: '东进口',
      speed: east.avg_speed_kmh,
      delay: east.congestion_delay_index,
      saturation: m.east_through_saturation,
      flow: m.east_through_flow_vph,
      mock: false,
    },
    {
      role: '西进口',
      speed: west.avg_speed_kmh,
      delay: west.congestion_delay_index,
      saturation: null,
      flow: null,
      mock: true,
    },
  ]
})

const copy = computed(() => constraint.value.copy || [])
</script>

<template>
  <SceneStage
    :loading="loading"
    :error="error"
    :ready="Boolean(cause)"
    data-testid="scene2-cause-analysis"
  >
    <SceneHeadline
      eyebrow="分 析 成 因"
      title="不是路段装不下，而是经十路没有绿灯可分"
      :lede="`北进口直行需求 ${demand.demand_flow_veh_h ?? '—'} 辆/h，低于车道通行能力 ${demand.supply_capacity_veh_h ?? '—'} 辆/h；但下游经十路口最大饱和度 ${constraint.metrics?.intersection_saturation_max?.toFixed?.(2) ?? '—'}（${constraint.metrics?.intersection_los || '—'} 级），周期内挤不出绿灯给北向南直行。`"
      :chips="chips"
    />

    <div class="body">
      <section class="map-card">
        <div class="trace-ctl">
          <div class="seg">
            <button
              type="button"
              :class="{ on: direction === 'UPSTREAM' }"
              @click="direction = 'UPSTREAM'"
            >
              上游来源
            </button>
            <button
              type="button"
              :class="{ on: direction === 'DOWNSTREAM' }"
              @click="direction = 'DOWNSTREAM'"
            >
              下游去向
            </button>
          </div>
          <div class="seg">
            <button
              v-for="t in TURNS"
              :key="t.key"
              type="button"
              :class="{ on: turn === t.key }"
              @click="turn = t.key"
            >
              {{ t.label }}
            </button>
          </div>
          <span class="metric-note">份额指标：flow_share_ratio（%）</span>
        </div>

        <CorridorMap :links="links" :nodes="mapNodes" :alert-id="problemLinkId" dim-others>
          <template #default="{ projector }">
            <g class="traces">
              <template v-for="e in traceGraph.edges" :key="e.id">
                <path
                  class="trace-line"
                  :d="`M ${projector.project(e.from.lon, e.from.lat)[0]} ${projector.project(e.from.lon, e.from.lat)[1]} L ${projector.project(e.to.lon, e.to.lat)[0]} ${projector.project(e.to.lon, e.to.lat)[1]}`"
                  :stroke-width="2 + (e.share || 0) / 18"
                />
                <text
                  class="trace-share"
                  :x="(projector.project(e.from.lon, e.from.lat)[0] + projector.project(e.to.lon, e.to.lat)[0]) / 2"
                  :y="(projector.project(e.from.lon, e.from.lat)[1] + projector.project(e.to.lon, e.to.lat)[1]) / 2 - 4"
                >
                  {{ e.share?.toFixed?.(1) }}%
                </text>
              </template>
            </g>
          </template>
        </CorridorMap>

        <p class="caption">{{ caption }}</p>
      </section>

      <aside class="side">
        <section class="card" :class="{ hot: beat === 'supply' }">
          <h4>供需对照 · 北进口</h4>
          <div class="bar">
            <div class="bar-fill" :style="{ width: `${supplyBar.pct}%` }" />
            <span class="bar-cap">通行能力 {{ supplyBar.supply }}</span>
          </div>
          <div class="bar-legend">
            <span>需求 <strong>{{ supplyBar.demand }}</strong> 辆/h</span>
            <span>占用 <strong>{{ supplyBar.pct.toFixed(0) }}%</strong></span>
          </div>
          <p class="note">{{ demand.narrative_claim }}</p>
        </section>

        <section class="card" :class="{ hot: beat === 'arterial' || beat === 'signal' }">
          <h4>下游约束 · 经十路东西向</h4>
          <div class="ap-grid">
            <div v-for="a in approachCards" :key="a.role" class="ap">
              <span class="ap-role">{{ a.role }}</span>
              <strong v-if="a.saturation != null">饱和度 {{ a.saturation.toFixed(2) }}</strong>
              <strong v-else class="degraded">饱和度缺值</strong>
              <em>{{ a.speed?.toFixed?.(1) ?? '—' }} km/h · 延时 {{ a.delay?.toFixed?.(2) ?? '—' }}</em>
              <small v-if="a.flow">直行流量 {{ a.flow }} 辆/h</small>
              <small v-else class="degraded">按速度 + 延时指数降级</small>
            </div>
          </div>
          <p class="note">
            {{ constraint.hint }}
          </p>
        </section>

        <section class="card" :class="{ hot: beat === 'overflow' }">
          <h4>成因结论</h4>
          <ul class="copy">
            <li v-for="c in copy" :key="c.id" :class="{ dim: !reached('arterial') }">{{ c.text }}</li>
          </ul>
          <p class="gap">
            {{ (constraint.gaps || []).join(' / ') }} · 排队 {{ beats.overflow?.queue_m ?? 270 }} m 取专家调研值；相位环为示意，非库内绿秒。
          </p>
        </section>
      </aside>
    </div>

    <template #foot>
      <button type="button" class="btn ghost" @click="setScene('1')">返回问题定位</button>
      <button type="button" class="btn ghost" @click="startBeats()">重播分镜</button>
      <button type="button" class="btn primary" @click="setScene('3')">看优化方案</button>
    </template>
  </SceneStage>
</template>

<style scoped>
.body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 350px);
  gap: 12px;
}

.map-card {
  position: relative;
  min-height: 0;
  border: 1px solid var(--cyan-border);
  border-radius: 3px;
  background: rgba(2, 10, 22, 0.7);
  overflow: hidden;
}

.trace-ctl {
  position: absolute;
  left: 12px;
  top: 10px;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.seg {
  display: flex;
  border: 1px solid var(--cyan-border);
  border-radius: 2px;
  overflow: hidden;
}

.seg button {
  padding: 3px 10px;
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--text-muted);
  background: rgba(4, 12, 30, 0.8);
  border: none;
  cursor: pointer;
}

.seg button.on {
  color: #041020;
  background: var(--cyan);
}

.metric-note {
  font-size: 10px;
  color: rgba(160, 200, 220, 0.5);
}

.trace-line {
  fill: none;
  stroke: rgba(0, 229, 255, 0.75);
  stroke-linecap: round;
  stroke-dasharray: 10 8;
  animation: trace-flow 1.4s linear infinite;
}

@keyframes trace-flow {
  to { stroke-dashoffset: -18; }
}

.trace-share {
  font-size: 11px;
  fill: var(--cyan-dim);
  text-anchor: middle;
  paint-order: stroke;
  stroke: rgba(2, 8, 18, 0.9);
  stroke-width: 3px;
}

.caption {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 10px;
  margin: 0;
  padding: 6px 10px;
  font-size: 12px;
  letter-spacing: 1px;
  color: var(--text);
  background: rgba(4, 12, 30, 0.82);
  border-left: 2px solid var(--cyan);
}

.side {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow: auto;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--cyan-border);
  border-radius: 2px;
  background: var(--bg-inset);
  transition: border-color 0.35s ease, box-shadow 0.35s ease;
}

.card.hot {
  border-color: var(--cyan-border-strong);
  box-shadow: 0 0 0 1px rgba(0, 229, 255, 0.12) inset;
}

h4 {
  margin: 0;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 1px;
  color: var(--cyan-dim);
}

.bar {
  position: relative;
  height: 22px;
  border: 1px solid var(--cyan-border);
  background: rgba(0, 12, 24, 0.7);
}

.bar-fill {
  height: 100%;
  background: linear-gradient(90deg, rgba(0, 229, 255, 0.55), rgba(0, 229, 255, 0.2));
  transition: width 0.8s ease;
}

.bar-cap {
  position: absolute;
  right: 6px;
  top: 3px;
  font-size: 10px;
  color: var(--text-muted);
}

.bar-legend {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-muted);
}

.bar-legend strong {
  color: var(--cyan);
  font-weight: 500;
}

.ap-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.ap {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 9px;
  border: 1px solid var(--cyan-border);
  background: rgba(0, 12, 24, 0.5);
}

.ap-role {
  font-size: 11px;
  color: var(--text-muted);
}

.ap strong {
  font-size: 13px;
  font-weight: 500;
  color: var(--warn);
}

.ap strong.degraded {
  color: rgba(160, 200, 220, 0.6);
}

.ap em {
  font-style: normal;
  font-size: 11px;
  color: var(--text);
}

.ap small {
  font-size: 10px;
  color: rgba(160, 200, 220, 0.5);
}

.ap small.degraded {
  color: var(--warn);
}

.note {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-muted);
}

.copy {
  margin: 0;
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text);
}

.copy li.dim {
  color: var(--text-muted);
}

.gap {
  margin: 0;
  font-size: 10px;
  line-height: 1.5;
  color: rgba(160, 200, 220, 0.5);
}

.btn {
  padding: 8px 22px;
  font-size: 13px;
  letter-spacing: 2px;
  border-radius: 2px;
  cursor: pointer;
}

.btn.primary {
  color: #041020;
  background: var(--cyan);
  border: none;
}

.btn.primary:hover {
  box-shadow: 0 0 14px rgba(0, 229, 255, 0.6);
}

.btn.ghost {
  color: var(--text-muted);
  background: transparent;
  border: 1px solid var(--cyan-border);
}

.btn.ghost:hover {
  color: var(--cyan);
  border-color: var(--cyan-border-strong);
}

@media (max-width: 1180px) {
  .body {
    grid-template-columns: 1fr;
  }
}
</style>

<script setup>
/**
 * 幕 1 · 问题定位：走廊落点 + 排队/蓄车对照 + 双路口渠化 + 推理收敛。
 * 推理步骤对齐另一套实现 act-01 的 planningItems / recognitionSteps，取数改读库内嗅探 JSON。
 */
import { computed, onMounted, ref } from 'vue'
import SceneStage from '../../shared/components/SceneStage.vue'
import SceneHeadline from '../../shared/components/SceneHeadline.vue'
import CorridorMap from '../../shared/components/CorridorMap.vue'
import ReasoningStream from '../../shared/components/ReasoningStream.vue'
import IntersectionChannelization from './IntersectionChannelization.vue'
import { prefersInstant } from '../../shared/useSceneBeats.js'
import { pointAlong, sliceLine } from '../../shared/geo.js'
import { useSceneRoute } from '../../shared/useSceneRoute.js'
import { loadScene1Data } from './index.js'

const { setScene } = useSceneRoute()

const loading = ref(true)
const error = ref('')
const locate = ref(null)
const channelization = ref(null)
const objects = ref(null)
const instant = prefersInstant()

onMounted(async () => {
  try {
    const data = await loadScene1Data()
    locate.value = data.locate
    channelization.value = data.channelization
    objects.value = data.objects
  } catch (e) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
})

const metrics = computed(() => locate.value?.problem_link_metrics || {})
const links = computed(() => locate.value?.traffic_color_links || [])
const problemLink = computed(() => objects.value?.problem_link || {})
const timeWindow = computed(() => locate.value?.meta?.time_window?.label || '')

const nodes = computed(() => {
  const list = Object.values(objects.value?.intersections || {})
  return list.map((i) => ({
    id: i.inter_id,
    name: i.inter_name?.replace('路口', '') || i.inter_id,
    lon: i.lon,
    lat: i.lat,
    role: i.role === 'downstream_target' ? 'target' : 'upstream',
  }))
})

const focus = computed(() => {
  const coords = problemLink.value?.geom?.coordinates || []
  if (!coords.length) return null
  const mid = coords[Math.floor(coords.length / 2)]
  return { lon: mid[0], lat: mid[1], spanMeters: 560 }
})

/** 排队占用比：专家排队值 / 库内蓄车长度 */
const queueRatio = computed(() => {
  const q = metrics.value.queue_length_m
  const s = metrics.value.storage_length_m
  if (!q || !s) return 0
  return Math.min(1, q / s)
})

/** 排队画在路段下游端（几何终点即经十路口） */
const queueCoords = computed(() => {
  const coords = problemLink.value?.geom?.coordinates || []
  if (!coords.length) return []
  return sliceLine(coords, 1 - queueRatio.value, 1)
})

const queueAnchor = computed(() => {
  const coords = problemLink.value?.geom?.coordinates || []
  if (!coords.length) return null
  return pointAlong(coords, 1 - queueRatio.value / 2)
})

const northSat = computed(() => locate.value?.jingshi_north_through_saturation || {})
const ew = computed(() => locate.value?.jingshi_ew_metrics?.primary_display || {})
const ewGaps = computed(() => locate.value?.jingshi_ew_metrics?.gaps || [])

const chips = computed(() => [
  { k: '时段', v: timeWindow.value || '—' },
  { k: '路段速度', v: `${metrics.value.avg_speed_kmh?.toFixed?.(1) ?? '—'} km/h`, tone: 'alert' },
  { k: '拥堵延时指数', v: metrics.value.congestion_delay_index?.toFixed?.(2) ?? '—', tone: 'alert' },
  {
    k: '北进口直行饱和度',
    v: northSat.value.turn_saturation?.toFixed?.(2) ?? '—',
    tone: 'alert',
  },
])

const callouts = computed(() => [
  {
    k: '排队长度',
    v: metrics.value.queue_length_m ?? '—',
    unit: 'm',
    tone: 'alert',
    note: metrics.value.queue_length_source === 'expert_survey' ? '专家调研值' : '',
  },
  { k: '蓄车长度', v: metrics.value.storage_length_m?.toFixed?.(0) ?? '—', unit: 'm', tone: '' },
  {
    k: '排队比',
    v: (queueRatio.value * 100).toFixed(0),
    unit: '%',
    tone: queueRatio.value > 0.7 ? 'alert' : '',
    note: queueRatio.value > 0.7 ? '接近边界' : '',
  },
])

const interById = computed(() => channelization.value?.by_intersection || {})
const downstreamId = computed(
  () => objects.value?.intersections?.downstream_jingshi?.inter_id || '011wwe28ctu00001',
)
const upstreamId = computed(
  () => objects.value?.intersections?.upstream_jiefang?.inter_id || '011wwe28fmc00001',
)

const steps = computed(() => [
  { id: 'object', label: '识别对象：路段', detail: problemLink.value.road_name || '' },
  { id: 'time', label: `锁定时间：${timeWindow.value || '晚高峰'}`, detail: '按 5 分钟粒度取窗口均值' },
  {
    id: 'index',
    label: '读取运行指标',
    detail: `速度 ${metrics.value.avg_speed_kmh?.toFixed?.(1) ?? '—'} km/h · 拥堵延时指数 ${metrics.value.congestion_delay_index?.toFixed?.(2) ?? '—'}`,
  },
  {
    id: 'queue',
    label: '比对排队与蓄车能力',
    detail: `排队 ${metrics.value.queue_length_m ?? '—'} m / 蓄车 ${metrics.value.storage_length_m?.toFixed?.(0) ?? '—'} m，占用 ${(queueRatio.value * 100).toFixed(0)}%`,
  },
  {
    id: 'north',
    label: '核对下游北进口直行饱和度',
    detail: `${northSat.value.dir_label || '北进口'} ${northSat.value.turn_label || '直行'} ${northSat.value.turn_saturation?.toFixed?.(2) ?? '—'}`,
  },
  {
    id: 'ew',
    label: '东西进口降级取数',
    detail: `西向饱和度库内缺失（${ewGaps.value.join('/') || 'GAP'}），改用进口速度 + 拥堵延时指数`,
  },
  { id: 'verdict', label: '判定问题：北向南直行排队外溢', detail: '非路口渠化不足，指向下游绿灯约束' },
])

const conclusion = computed(
  () =>
    `问题定位完成：${problemLink.value.road_name || '问题路段'} 排队 ${metrics.value.queue_length_m ?? '—'} m（蓄车 ${metrics.value.storage_length_m?.toFixed?.(0) ?? '—'} m），下游经十路口东西向压力偏高，进入成因分析。`,
)
</script>

<template>
  <SceneStage
    :loading="loading"
    :error="error"
    :ready="Boolean(locate)"
    data-testid="scene1-problem-locate"
  >
    <SceneHeadline
      eyebrow="问 题 定 位"
      :title="`排队 ${metrics.queue_length_m ?? '—'} 米压在 ${metrics.storage_length_m?.toFixed?.(0) ?? '—'} 米蓄车段上`"
      :lede="`${problemLink.road_name || ''}：晚高峰速度 ${metrics.avg_speed_kmh?.toFixed?.(1) ?? '—'} km/h，排队已占用蓄车段 ${(queueRatio * 100).toFixed(0)}%，一旦越界即回堵上游解放东路口。`"
      :chips="chips"
    />

    <div class="body">
      <section class="map-card">
        <CorridorMap
          :links="links"
          :nodes="nodes"
          :alert-id="problemLink.link_id"
          :focus="focus"
          dim-others
        >
          <template #default="{ projector, labelScale }">
            <path v-if="queueCoords.length" class="queue" :d="projector.toPath(queueCoords)" />
            <g v-if="queueAnchor">
              <circle
                :cx="projector.project(queueAnchor[0], queueAnchor[1])[0]"
                :cy="projector.project(queueAnchor[0], queueAnchor[1])[1]"
                :r="3 * labelScale"
                class="queue-dot"
              />
              <text
                class="queue-label"
                :x="projector.project(queueAnchor[0], queueAnchor[1])[0] + 10 * labelScale"
                :y="projector.project(queueAnchor[0], queueAnchor[1])[1]"
                :style="{ fontSize: `${13 * labelScale}px` }"
              >
                排队 {{ metrics.queue_length_m }} m
              </text>
            </g>
          </template>
        </CorridorMap>

        <div class="callouts">
          <div v-for="c in callouts" :key="c.k" class="callout" :class="c.tone">
            <strong>{{ c.v }}<em>{{ c.unit }}</em></strong>
            <span>{{ c.k }}</span>
            <small v-if="c.note">{{ c.note }}</small>
          </div>
        </div>
      </section>

      <aside class="side">
        <ReasoningStream
          title="问题定位推理"
          :steps="steps"
          :conclusion="conclusion"
          :instant="instant"
        />

        <div class="ew">
          <h4>经十路东西进口 · 降级指标</h4>
          <div class="ew-row">
            <span>东进口</span>
            <strong>{{ ew.east_entrance?.avg_speed_kmh?.toFixed?.(1) ?? '—' }} km/h</strong>
            <em>延时 {{ ew.east_entrance?.congestion_delay_index?.toFixed?.(2) ?? '—' }}</em>
          </div>
          <div class="ew-row">
            <span>西进口</span>
            <strong>{{ ew.west_entrance?.avg_speed_kmh?.toFixed?.(1) ?? '—' }} km/h</strong>
            <em>延时 {{ ew.west_entrance?.congestion_delay_index?.toFixed?.(2) ?? '—' }}</em>
          </div>
          <p class="gap">
            {{ ewGaps.join(' / ') }}：西向饱和度与转向流量库内为 0，按速度 + 延时指数降级展示。
          </p>
        </div>
      </aside>

      <div class="chan-row">
        <IntersectionChannelization
          title="下游 · 奥体西路与经十路"
          :arms="interById[downstreamId]?.arms || []"
          highlight-dir="0"
          :tag="`北进口直行饱和度 ${northSat.turn_saturation?.toFixed?.(2) ?? '—'}`"
        />
        <IntersectionChannelization
          title="上游 · 奥体西路与解放东路"
          :arms="interById[upstreamId]?.arms || []"
          highlight-dir="0"
          tag="进口饱和度库内缺值"
        />
      </div>
    </div>

    <template #foot>
      <button type="button" class="btn ghost" @click="setScene('0')">返回开幕</button>
      <button type="button" class="btn primary" @click="setScene('2')">分析成因</button>
    </template>
  </SceneStage>
</template>

<style scoped>
.body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 340px);
  grid-template-rows: minmax(0, 1fr) auto;
  grid-template-areas:
    'map side'
    'chan side';
  gap: 12px;
}

.map-card {
  grid-area: map;
  position: relative;
  min-height: 0;
  border: 1px solid var(--cyan-border);
  border-radius: 3px;
  background: rgba(2, 10, 22, 0.7);
  overflow: hidden;
}

.side {
  grid-area: side;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow: auto;
}

.chan-row {
  grid-area: chan;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.queue {
  fill: none;
  stroke: rgba(255, 68, 68, 0.55);
  stroke-width: 11;
  stroke-linecap: butt;
}

.queue-dot {
  fill: var(--warn);
}

.queue-label {
  fill: var(--warn);
  paint-order: stroke;
  stroke: rgba(2, 8, 18, 0.9);
  stroke-width: 3px;
  dominant-baseline: middle;
}

.callouts {
  position: absolute;
  left: 12px;
  bottom: 12px;
  display: flex;
  gap: 10px;
}

.callout {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 6px 12px;
  background: rgba(4, 12, 30, 0.86);
  border-left: 2px solid var(--cyan);
}

.callout strong {
  font-size: 22px;
  font-weight: 500;
  color: var(--cyan);
  line-height: 1.1;
}

.callout em {
  font-size: 11px;
  font-style: normal;
  margin-left: 3px;
  color: var(--text-muted);
}

.callout span {
  font-size: 11px;
  color: var(--text-muted);
}

.callout small {
  font-size: 10px;
  color: rgba(160, 200, 220, 0.5);
}

.callout.alert {
  border-left-color: var(--danger);
}

.callout.alert strong {
  color: var(--danger);
}

.ew {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--cyan-border);
  border-radius: 2px;
  background: var(--bg-inset);
  flex: none;
}

.ew h4 {
  margin: 0;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 1px;
  color: var(--cyan-dim);
}

.ew-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 12px;
  color: var(--text-muted);
}

.ew-row strong {
  color: var(--text);
  font-weight: 500;
}

.ew-row em {
  font-style: normal;
  font-size: 11px;
  color: var(--warn);
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
    grid-template-rows: minmax(220px, 1fr) auto auto;
    grid-template-areas:
      'map'
      'side'
      'chan';
  }
}
</style>

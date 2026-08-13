<script setup>
/**
 * 幕 0 · 开幕：走廊扫描 → 问题路段标红闪烁 → 拉近镜头出巡检工单。
 * 分镜取 1-0-opening.json 的 actions，节拍推进方式对齐另一套实现的 act mapBeat。
 */
import { computed, onMounted, ref } from 'vue'
import SceneStage from '../../shared/components/SceneStage.vue'
import SceneHeadline from '../../shared/components/SceneHeadline.vue'
import CorridorMap from '../../shared/components/CorridorMap.vue'
import { prefersInstant, useSceneBeats } from '../../shared/useSceneBeats.js'
import { useSceneRoute } from '../../shared/useSceneRoute.js'
import { loadScene0Data } from './index.js'

const { setScene } = useSceneRoute()

const loading = ref(true)
const error = ref('')
const opening = ref(null)
const objects = ref(null)
const locate = ref(null)

const BEATS = [
  { id: 'scan', ms: 2200 },
  { id: 'alert', ms: 2000 },
  { id: 'fly', ms: 2400 },
  { id: 'settle' },
]

const CAPTION = {
  scan: '全域巡检：正在扫描奥体西走廊各路段运行状态',
  alert: '发现异常：奥体西路北向南路段持续标红',
  fly: '拉近镜头：锁定解放东路 → 经十路区间',
  settle: '生成巡检工单，交由问题定位处置',
}

const { current: beat, reached, start: startBeats } = useSceneBeats(BEATS, {
  instant: prefersInstant(),
})

onMounted(async () => {
  try {
    const data = await loadScene0Data()
    opening.value = data.opening
    objects.value = data.objects
    locate.value = data.locate
    startBeats()
  } catch (e) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
})

const links = computed(() => locate.value?.traffic_color_links || [])

const problemLinkId = computed(
  () => opening.value?.camera?.problem_link_id || objects.value?.problem_link?.link_id || '',
)

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

/** 拉近镜头：以问题路段中点为中心 */
const focus = computed(() => {
  if (!reached('fly')) return null
  const coords = objects.value?.problem_link?.geom?.coordinates || []
  if (!coords.length) return null
  const mid = coords[Math.floor(coords.length / 2)]
  return { lon: mid[0], lat: mid[1], spanMeters: 620 }
})

const metrics = computed(() => locate.value?.problem_link_metrics || {})
const timeWindow = computed(() => objects.value?.meta?.time_window?.label || '')

const chips = computed(() => [
  { k: '时段', v: timeWindow.value || '—' },
  { k: '平均速度', v: `${metrics.value.avg_speed_kmh?.toFixed?.(1) ?? '—'} km/h`, tone: 'alert' },
  { k: '拥堵延时指数', v: metrics.value.congestion_delay_index?.toFixed?.(2) ?? '—', tone: 'alert' },
  {
    k: '排队 / 蓄车',
    v: `${metrics.value.queue_length_m ?? '—'} / ${metrics.value.storage_length_m?.toFixed?.(0) ?? '—'} m`,
    tone: 'alert',
  },
])

/** 巡检工单：字段对齐另一套实现的诊断工单 */
const ticket = computed(() => {
  const link = objects.value?.problem_link || {}
  const inter = objects.value?.intersections || {}
  return [
    { k: '对象', v: '路段' },
    { k: '问题路段', v: link.road_name || '—' },
    { k: '时段', v: timeWindow.value || '—' },
    { k: '流向', v: '北向南 · 直行' },
    { k: '问题类型', v: '排队外溢' },
    { k: '下游路口', v: inter.downstream_jingshi?.inter_name || '—' },
    { k: '上游路口', v: inter.upstream_jiefang?.inter_name || '—' },
    { k: '约束', v: '避免加重下游经十路拥堵' },
  ]
})

const queueM = computed(() => objects.value?.meta?.expert_overrides?.queue_length_m ?? 270)
</script>

<template>
  <SceneStage :loading="loading" :error="error" :ready="Boolean(objects)" data-testid="scene0-opening">
    <SceneHeadline
      eyebrow="开 幕"
      title="晚高峰巡检：奥体西路北向南出现持续排队"
      :lede="`${timeWindow} 走廊扫描发现，奥体西路解放东路→经十路区间速度掉到 ${metrics.avg_speed_kmh?.toFixed?.(1) ?? '—'} km/h，排队 ${queueM} m 已逼近 ${metrics.storage_length_m?.toFixed?.(0) ?? '—'} m 蓄车边界。`"
      :chips="chips"
    />

    <div class="body">
      <section class="map-card">
        <CorridorMap
          :links="links"
          :nodes="nodes"
          :alert-id="reached('alert') ? problemLinkId : ''"
          :focus="focus"
          :scanning="beat === 'scan'"
          :dim-others="reached('fly')"
        />
        <div class="legend">
          <span class="lg green">畅通</span>
          <span class="lg yellow">缓行</span>
          <span class="lg red">拥堵</span>
        </div>
        <p class="caption">{{ CAPTION[beat] || CAPTION.scan }}</p>
      </section>

      <Transition name="slide">
        <aside v-if="reached('alert')" class="ticket">
          <header class="ticket-hd">
            <span class="badge">巡检工单</span>
            <span class="ticket-id">{{ problemLinkId }}</span>
          </header>
          <dl class="ticket-rows">
            <div v-for="row in ticket" :key="row.k" class="ticket-row">
              <dt>{{ row.k }}</dt>
              <dd>{{ row.v }}</dd>
            </div>
          </dl>
          <p class="ticket-foot">
            处置目标：<strong>配时优化</strong>，不新增车道、不动经十路全盘周期。
          </p>
        </aside>
      </Transition>
    </div>

    <template #foot>
      <button type="button" class="btn ghost" @click="startBeats()">重播分镜</button>
      <button type="button" class="btn primary" @click="setScene('1')">进入问题定位</button>
    </template>
  </SceneStage>
</template>

<style scoped>
.body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 330px);
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

.legend {
  position: absolute;
  left: 12px;
  top: 10px;
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--text-muted);
}

.lg::before {
  content: '';
  display: inline-block;
  width: 14px;
  height: 3px;
  margin-right: 5px;
  vertical-align: middle;
}

.lg.green::before { background: var(--ok); }
.lg.yellow::before { background: var(--warn); }
.lg.red::before { background: var(--danger); }

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

.ticket {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--cyan-border);
  border-top: 2px solid var(--danger);
  border-radius: 3px;
  background: var(--bg-inset);
  overflow: auto;
}

.ticket-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.badge {
  padding: 2px 8px;
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--danger);
  border: 1px solid rgba(255, 68, 68, 0.5);
}

.ticket-id {
  font-size: 11px;
  color: var(--text-muted);
}

.ticket-rows {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.ticket-row {
  display: flex;
  gap: 10px;
  align-items: baseline;
  font-size: 12px;
}

.ticket-row dt {
  flex: none;
  width: 62px;
  color: var(--text-muted);
}

.ticket-row dd {
  margin: 0;
  color: var(--text);
  line-height: 1.45;
}

.ticket-foot {
  margin: 0;
  padding-top: 8px;
  border-top: 1px dashed var(--cyan-border);
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-muted);
}

.ticket-foot strong {
  color: var(--cyan);
  font-weight: 500;
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

.slide-enter-active {
  transition: opacity 0.45s ease, transform 0.45s cubic-bezier(0.22, 1, 0.36, 1);
}

.slide-enter-from {
  opacity: 0;
  transform: translateX(16px);
}

@media (max-width: 1100px) {
  .body {
    grid-template-columns: 1fr;
  }
}
</style>

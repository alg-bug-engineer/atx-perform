<script setup>
import { computed, onMounted, ref } from 'vue'
import SceneScaffold from '../../shared/components/SceneScaffold.vue'
import { SCENE_META, loadScene1Data } from './index.js'

const loading = ref(true)
const error = ref('')
const locate = ref(null)

onMounted(async () => {
  try {
    const data = await loadScene1Data()
    locate.value = data.locate
  } catch (e) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
})

const metrics = computed(() => locate.value?.problem_link_metrics)
const ew = computed(() => locate.value?.jingshi_ew_metrics?.primary_display)
</script>

<template>
  <SceneScaffold
    :title="SCENE_META.name"
    subtitle="双路口渠化 + 问题路段指标；东西进口用速度/延时指数降级"
    :loading="loading"
    :error="error"
    :data-files="SCENE_META.dataFiles"
  >
    <template #stage>
      <div class="stage-label">CHANNELIZATION + TRAFFIC COLOR · SCENE 1</div>
    </template>

    <div v-if="metrics" class="cards">
      <div class="card">
        <span>速度</span>
        <strong>{{ metrics.avg_speed_kmh?.toFixed?.(1) ?? '—' }} km/h</strong>
      </div>
      <div class="card">
        <span>拥堵延时指数</span>
        <strong>{{ metrics.congestion_delay_index?.toFixed?.(2) ?? '—' }}</strong>
      </div>
      <div class="card">
        <span>排队 / 蓄车</span>
        <strong>{{ metrics.queue_length_m }} / {{ metrics.storage_length_m?.toFixed?.(0) }} m</strong>
      </div>
    </div>

    <h3 v-if="ew">东西进口降级指标</h3>
    <ul v-if="ew" class="list">
      <li>
        东进口 E→W：{{ ew.east_entrance?.avg_speed_kmh?.toFixed?.(1) }} km/h ·
        延时 {{ ew.east_entrance?.congestion_delay_index?.toFixed?.(2) }}
      </li>
      <li>
        西进口 W→E：{{ ew.west_entrance?.avg_speed_kmh?.toFixed?.(1) }} km/h ·
        延时 {{ ew.west_entrance?.congestion_delay_index?.toFixed?.(2) }}
      </li>
    </ul>
  </SceneScaffold>
</template>

<style scoped>
.stage-label {
  position: absolute;
  left: 24px;
  bottom: 88px;
  color: var(--cyan-dim);
  font-size: 12px;
  letter-spacing: 2px;
}
.cards {
  display: grid;
  gap: 8px;
}
.card {
  border: 1px solid var(--cyan-border);
  padding: 10px 12px;
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.card span {
  color: var(--text-muted);
}
.card strong {
  color: var(--cyan);
  font-weight: 500;
}
h3 {
  margin: 16px 0 8px;
  font-size: 12px;
  color: var(--cyan-dim);
  font-weight: 500;
}
.list {
  margin: 0;
  padding-left: 18px;
  color: var(--text-muted);
}
</style>

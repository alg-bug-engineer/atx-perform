<script setup>
import { computed, onMounted, ref } from 'vue'
import SceneScaffold from '../../shared/components/SceneScaffold.vue'
import { SCENE_META, loadScene2Data } from './index.js'

const loading = ref(true)
const error = ref('')
const cause = ref(null)

onMounted(async () => {
  try {
    const data = await loadScene2Data()
    cause.value = data.cause
  } catch (e) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
})

const demand = computed(() => cause.value?.demand_supply)
const counts = computed(() => {
  const up = cause.value?.upstream_traces?.by_turn || {}
  const down = cause.value?.downstream_traces?.by_turn || {}
  return {
    up: Object.fromEntries(Object.entries(up).map(([k, v]) => [k, v?.length || 0])),
    down: Object.fromEntries(Object.entries(down).map(([k, v]) => [k, v?.length || 0])),
  }
})
</script>

<template>
  <SceneScaffold
    :title="SCENE_META.name"
    subtitle="上/下游流量份额溯源；路口需求取北进口直行流量"
    :loading="loading"
    :error="error"
  >
    <div v-if="demand" class="cards">
      <div class="card">
        <span>需求（直行）</span>
        <strong>{{ demand.demand_flow_veh_h }} 辆/h</strong>
      </div>
      <div class="card">
        <span>供给能力</span>
        <strong>{{ demand.supply_capacity_veh_h }} 辆/h</strong>
      </div>
    </div>

    <h3>溯源流向统计</h3>
    <p class="mono">上游 {{ counts.up }}</p>
    <p class="mono">下游 {{ counts.down }}</p>
  </SceneScaffold>
</template>

<style scoped>
.cards {
  display: grid;
  gap: 8px;
}
.card {
  border: 1px solid var(--cyan-border);
  padding: 10px 12px;
  display: flex;
  justify-content: space-between;
}
.card span { color: var(--text-muted); }
.card strong { color: var(--cyan); font-weight: 500; }
h3 {
  margin: 16px 0 8px;
  font-size: 12px;
  color: var(--cyan-dim);
  font-weight: 500;
}
.mono {
  margin: 0 0 6px;
  color: var(--text-muted);
  word-break: break-all;
}
</style>

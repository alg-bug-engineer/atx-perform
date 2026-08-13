<script setup>
import { onMounted, ref } from 'vue'
import SceneStage from '../../shared/components/SceneStage.vue'
import { useSceneRoute } from '../../shared/useSceneRoute.js'
import { loadScene3Data } from './index.js'
import PlanComparePanel from './PlanComparePanel.vue'

const { setScene } = useSceneRoute()

const loading = ref(true)
const error = ref('')
const payload = ref(null)

onMounted(async () => {
  try {
    payload.value = (await loadScene3Data()).optimization
  } catch (e) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <SceneStage
    :loading="loading"
    :error="error"
    :ready="Boolean(payload)"
    data-testid="scene3-optimization"
  >
    <PlanComparePanel v-if="payload" :payload="payload" />

    <template #foot>
      <button type="button" class="btn primary" @click="setScene('3b')">看信控方案调节</button>
    </template>
  </SceneStage>
</template>

<style scoped>
:deep(.plan-compare) {
  flex: 1;
  min-height: 0;
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
</style>

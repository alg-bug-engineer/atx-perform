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
const signalPlan = ref(null)

onMounted(async () => {
  try {
    const bundle = await loadScene3Data()
    payload.value = bundle.optimization
    signalPlan.value = bundle.signalPlan
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
    <PlanComparePanel v-if="payload" :payload="payload" :signal-plan="signalPlan" />

    <template #foot>
      <button type="button" class="btn primary" @click="setScene('4')">试点后看效果评估</button>
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

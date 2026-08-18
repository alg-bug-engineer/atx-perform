<script setup>
import { onMounted, ref } from 'vue'
import SceneStage from '../../shared/components/SceneStage.vue'
import { useSceneRoute } from '../../shared/useSceneRoute.js'
import { loadScene3bData } from './index.js'
import SignalPlanPanel from './SignalPlanPanel.vue'

const { setScene } = useSceneRoute()

const loading = ref(true)
const error = ref('')
const payload = ref(null)

onMounted(async () => {
  try {
    payload.value = (await loadScene3bData()).signalPlan
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
    data-testid="scene3b-signal-plan"
  >
    <SignalPlanPanel v-if="payload" :payload="payload" />

    <template #foot>
      <button type="button" class="btn ghost" @click="setScene('3')">返回渠化仿真</button>
      <button type="button" class="btn primary" @click="setScene('4')">试点后看效果评估</button>
    </template>
  </SceneStage>
</template>

<style scoped>
:deep(.signal-plan) {
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

.btn.ghost {
  color: var(--text-muted);
  background: transparent;
  border: 1px solid var(--cyan-border);
}

.btn.ghost:hover {
  color: var(--text);
  border-color: var(--cyan-border-strong);
}
</style>

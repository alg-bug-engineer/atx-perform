<script setup>
import { onMounted, ref } from 'vue'
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
  <div class="scene3" data-testid="scene3-optimization">
    <div class="map-plane" aria-hidden="true">
      <div class="grid" />
    </div>

    <div v-if="loading" class="state-banner">加载中…</div>
    <div v-else-if="error" class="state-banner error">{{ error }}</div>

    <aside v-else-if="payload" class="plan-drawer">
      <PlanComparePanel :payload="payload" />
      <div class="drawer-foot">
        <button type="button" class="next" @click="setScene('4')">试点后看效果评估</button>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.scene3 {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.map-plane {
  position: absolute;
  inset: 0;
}
.grid {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(rgba(0, 229, 255, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 229, 255, 0.05) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(ellipse at center, black 40%, transparent 85%);
}
.state-banner {
  position: absolute;
  left: 50%;
  top: 40%;
  transform: translate(-50%, -50%);
  color: var(--text-muted);
  z-index: 40;
}
.state-banner.error {
  color: var(--danger);
}

.plan-drawer {
  position: absolute;
  top: 12px;
  bottom: 24px;
  left: 16px;
  right: 16px;
  z-index: 46;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
  padding: 14px 16px;
  border-radius: 4px;
  border: 1px solid var(--cyan-border-strong);
  background: rgba(4, 12, 30, 0.96);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
  pointer-events: auto;
}
.plan-drawer > :deep(.plan-compare) {
  flex: 1;
  min-height: 0;
}
.drawer-foot {
  display: flex;
  justify-content: flex-end;
  flex: none;
}
.next {
  padding: 8px 22px;
  font-size: 13px;
  letter-spacing: 2px;
  color: #041020;
  background: var(--cyan);
  border: none;
  border-radius: 2px;
  cursor: pointer;
}
.next:hover {
  box-shadow: 0 0 14px rgba(0, 229, 255, 0.6);
}
</style>

<script setup>
import { onMounted, ref } from 'vue'
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
  <div class="scene3b" data-testid="scene3b-signal-plan">
    <div class="map-plane" aria-hidden="true">
      <div class="grid" />
    </div>

    <div v-if="loading" class="state-banner">加载中…</div>
    <div v-else-if="error" class="state-banner error">{{ error }}</div>

    <aside v-else-if="payload" class="plan-drawer">
      <SignalPlanPanel :payload="payload" />
      <div class="drawer-foot">
        <button type="button" class="back" @click="setScene('3')">返回渠化仿真</button>
        <button type="button" class="next" @click="setScene('4')">试点后看效果评估</button>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.scene3b {
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
.plan-drawer > :deep(.signal-plan) {
  flex: 1;
  min-height: 0;
}
.drawer-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex: none;
}
.next,
.back {
  padding: 8px 22px;
  font-size: 13px;
  letter-spacing: 2px;
  border-radius: 2px;
  cursor: pointer;
}
.next {
  color: #041020;
  background: var(--cyan);
  border: none;
}
.next:hover {
  box-shadow: 0 0 14px rgba(0, 229, 255, 0.6);
}
.back {
  color: var(--text-muted);
  background: transparent;
  border: 1px solid var(--cyan-border);
}
.back:hover {
  color: var(--cyan);
  border-color: var(--cyan-border-strong);
}
</style>

<script setup>
import { onMounted, ref } from 'vue'
import { useSceneRoute } from '../../shared/useSceneRoute.js'
import { loadScene4Data } from './index.js'
import TrialEffectDrawer from './TrialEffectDrawer.vue'

const { setScene } = useSceneRoute()

const loading = ref(true)
const error = ref('')
const payload = ref(null)

onMounted(async () => {
  try {
    payload.value = (await loadScene4Data()).effect
  } catch (e) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
})

function goSkill() {
  setScene('5')
}
</script>

<template>
  <div class="scene4" data-testid="scene4-effect-eval">
    <div class="map-plane" aria-hidden="true">
      <div class="grid" />
    </div>

    <div v-if="loading" class="state-banner">加载中…</div>
    <div v-else-if="error" class="state-banner error">{{ error }}</div>
    <TrialEffectDrawer
      v-else-if="payload"
      :payload="payload"
      @finish="goSkill"
    />
  </div>
</template>

<style scoped>
.scene4 {
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
</style>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import SceneStage from '../../shared/components/SceneStage.vue'
import { gateSceneAdvance } from '../../shared/act-playback.js'
import { whenBroadcastIdle } from '../../shared/broadcast-bus.js'
import { narrativeActive } from '../../shared/narrative-state.js'
import { useSceneRoute } from '../../shared/useSceneRoute.js'
import { loadScene3Data } from './index.js'
import PlanComparePanel from './PlanComparePanel.vue'

const { setScene } = useSceneRoute()

const loading = ref(true)
const error = ref('')
const payload = ref(null)
const signalPlan = ref(null)

narrativeActive.value = true

const timers = []
let cancelled = false
let advanceStarted = false

function later(fn, ms) {
  const t = setTimeout(fn, ms)
  timers.push(t)
  return t
}

function goEffectEval() {
  if (cancelled) return
  gateSceneAdvance({ nextSceneKey: '4', apply: () => setScene('4') })
}

/** 口播与入场动画都结束后交棒效果预评估（空格可停在幕间栅栏） */
function onIntroComplete() {
  if (cancelled || advanceStarted) return
  advanceStarted = true
  whenBroadcastIdle({ later, safetyMs: 28_000, settleMs: 200 }).then(() => {
    later(goEffectEval, 600)
  })
}

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

onBeforeUnmount(() => {
  cancelled = true
  timers.forEach(clearTimeout)
  narrativeActive.value = false
})
</script>

<template>
  <SceneStage
    :loading="loading"
    :error="error"
    :ready="Boolean(payload)"
    data-testid="scene3-optimization"
  >
    <PlanComparePanel
      v-if="payload"
      :payload="payload"
      :signal-plan="signalPlan"
      @intro-complete="onIntroComplete"
    />

    <template #foot>
      <button type="button" class="btn primary" @click="setScene('4')">试点后看效果预评估</button>
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

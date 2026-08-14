<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import CorridorStage from './CorridorStage.vue'
import { buildCorridorDemo, sampleVariant } from './corridorDemo.js'

const props = defineProps({
  payload: { type: Object, required: true },
})

const model = computed(() => buildCorridorDemo(props.payload))
const timing = computed(() => props.payload?.optimized_signal_plans || {})

const t = ref(0)
const speed = 12

let raf = 0
let last = 0

function tick(now) {
  if (last) {
    const dt = Math.min((now - last) / 1000, 0.25)
    const next = t.value + dt * speed
    t.value = next >= model.value.cycleLen ? 0 : next
  }
  last = now
  raf = requestAnimationFrame(tick)
}

onMounted(() => {
  raf = requestAnimationFrame(tick)
})
onBeforeUnmount(() => cancelAnimationFrame(raf))

const samples = computed(() =>
  Object.fromEntries(model.value.variants.map((v) => [v.key, sampleVariant(v, t.value)])),
)

</script>

<template>
  <section v-if="model" class="plan-compare" data-testid="plan-compare">
    <header class="head">
      <p class="lead-eyebrow">优化方案 · 相位协调</p>
      <h2 class="lead-headline">{{ timing.summary }}</h2>
    </header>

    <div class="stages">
      <CorridorStage
        v-for="v in model.variants"
        :key="v.key"
        :model="model"
        :variant="v"
        :sample="samples[v.key]"
        :ghost-queue-m="v.key === 'after' ? samples.before?.queueM ?? 0 : 0"
      />
    </div>
  </section>
</template>

<style scoped>
.plan-compare {
  display: grid;
  grid-template-rows: auto minmax(250px, 1fr);
  gap: 10px;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.head {
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* 上下排列：两个方案共用同一条横向里程轴，排队长度可直接比长短 */
.stages {
  display: grid;
  grid-template-rows: 1fr 1fr;
  gap: 10px;
  min-height: 0;
}
</style>

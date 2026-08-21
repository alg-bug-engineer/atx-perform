<script setup>
/**
 * 效果预评估主视觉：复用幕 3 走廊微观仿真，现状 / 优化后对照播放。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import CorridorStage from './CorridorStage.vue'
import { buildCorridorDemo, sampleVariant } from '../scene3-optimization/corridorDemo.js'

const props = defineProps({
  optimization: { type: Object, default: null },
  beforeQueueM: { type: Number, default: 270 },
  afterQueueM: { type: Number, default: 230 },
})

const demo = computed(() => {
  try {
    return props.optimization ? buildCorridorDemo(props.optimization) : null
  } catch (err) {
    console.warn('[scene4] corridor demo failed', err)
    return null
  }
})

const before = computed(() => demo.value?.variants.find((v) => v.key === 'before') || null)
const after = computed(() => demo.value?.variants.find((v) => v.key === 'after') || null)

const PLAY_START_S = 30
const PLAY_DURATION_S = 10
const reduceMotion = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const paused = ref(false)
const frozen = ref(false)
const elapsedS = ref(0)

/** 找到目标排队长度最接近的完整仿真步，让车流、停车状态和队尾线来自同一帧。 */
function nearestQueueTime(variant, targetQueueM) {
  const result = variant?.result
  if (!result?.queueM?.length) return PLAY_START_S
  let bestStep = 0
  let bestDelta = Number.POSITIVE_INFINITY
  for (let step = 0; step < result.queueM.length; step += 1) {
    const delta = Math.abs(result.queueM[step] - targetQueueM)
    if (delta < bestDelta) {
      bestStep = step
      bestDelta = delta
    }
  }
  return bestStep * result.dt
}

const progress = computed(() => Math.min(1, elapsedS.value / PLAY_DURATION_S))
const easedProgress = computed(() => {
  const t = progress.value
  return t * t * (3 - 2 * t)
})
const beforeEndS = computed(() => nearestQueueTime(before.value, props.beforeQueueM))
const afterEndS = computed(() => nearestQueueTime(after.value, props.afterQueueM))

/**
 * 仿真以 7 m 车头间距离散，目标值通常落在两个完整车位之间。
 * 对最近整帧的连续排队车辆做不足一个车位的渐进压缩/伸展：停止线侧不动，
 * 越靠近队尾修正越完整，使车流实体与专家口径的队尾线精确重合。
 */
function alignQueueToTarget(sample, targetQueueM) {
  const deltaM = sample.queueM - targetQueueM
  if (Math.abs(deltaM) < 0.01) return sample

  const stopped = sample.cars
    .filter((car) => !car.moving && car.turn === sample.worstGroup)
    .sort((a, b) => b.x - a.x)
  if (stopped.length < 3) return { ...sample, queueM: targetQueueM }

  const chain = [stopped[0]]
  let tailX = stopped[0].x
  const maxQueueGapM = 21
  for (let i = 1; i < stopped.length; i += 1) {
    if (tailX - stopped[i].x > maxQueueGapM) break
    chain.push(stopped[i])
    tailX = stopped[i].x
  }

  const headX = chain[0].x
  const spanM = Math.max(0.01, headX - tailX)
  const chainIds = new Set(chain.map((car) => car.id))
  const cars = sample.cars.map((car) => {
    if (!chainIds.has(car.id)) return car
    const tailWeight = (headX - car.x) / spanM
    return { ...car, x: car.x + deltaM * tailWeight }
  })
  return { ...sample, cars, queueM: targetQueueM }
}

function sampleTowardQueue(variant, endS, targetQueueM) {
  if (!variant) return null
  const t = PLAY_START_S + (endS - PLAY_START_S) * easedProgress.value
  const sample = sampleVariant(variant, t)
  if (!sample || !frozen.value) return sample
  return alignQueueToTarget(sample, targetQueueM)
}

const beforeSample = computed(() => (
  sampleTowardQueue(before.value, beforeEndS.value, props.beforeQueueM)
))
const afterSample = computed(() => (
  sampleTowardQueue(after.value, afterEndS.value, props.afterQueueM)
))

let rafId = 0
let lastTs = 0
function tick(ts) {
  if (lastTs && demo.value && !paused.value && !frozen.value) {
    const dt = (ts - lastTs) / 1000
    elapsedS.value += dt
    if (elapsedS.value >= PLAY_DURATION_S) {
      elapsedS.value = PLAY_DURATION_S
      frozen.value = true
      lastTs = 0
      return
    }
  }
  lastTs = ts
  rafId = requestAnimationFrame(tick)
}

function playOnce() {
  cancelAnimationFrame(rafId)
  elapsedS.value = 0
  frozen.value = false
  paused.value = false
  if (reduceMotion) {
    elapsedS.value = PLAY_DURATION_S
    frozen.value = true
    return
  }
  lastTs = 0
  rafId = requestAnimationFrame(tick)
}

onMounted(() => {
  playOnce()
})
onUnmounted(() => {
  cancelAnimationFrame(rafId)
})

function togglePause() {
  if (frozen.value) return
  paused.value = !paused.value
}

defineExpose({ playOnce, togglePause, paused, frozen })
</script>

<template>
  <div class="trial-stage" data-testid="corridor-trial-stage">
    <div v-if="demo && before && after" class="stage">
      <CorridorStage
        :model="demo"
        :variant="before"
        :sample="beforeSample"
        :frozen="frozen"
      />
      <CorridorStage
        :model="demo"
        :variant="after"
        :sample="afterSample"
        :frozen="frozen"
      />
    </div>
    <p v-else class="empty">走廊仿真数据未就绪</p>
  </div>
</template>

<style scoped>
.trial-stage {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
  min-height: 0;
  height: 100%;
}
.stage {
  display: flex;
  flex-direction: row;
  gap: 8px;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
}
.stage :deep(.corridor) {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
}
.empty {
  margin: auto;
  font-size: 12px;
  color: var(--text);
}
</style>

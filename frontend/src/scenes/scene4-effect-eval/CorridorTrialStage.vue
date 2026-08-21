<script setup>
/**
 * 效果预评估主视觉：复用幕 3 走廊微观仿真，现状 / 优化后对照播放。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import CorridorStage from './CorridorStage.vue'
import { buildCorridorDemo, findBriefingBeats, sampleVariant } from '../scene3-optimization/corridorDemo.js'

const props = defineProps({
  optimization: { type: Object, default: null },
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
const clock = ref(PLAY_START_S)
const paused = ref(false)
const guided = ref(true)
const holdRemain = ref(0.4)
const BEAT_SPEED = 8
const LOOP_SPEED = 6
const speed = ref(BEAT_SPEED)
const BEAT_IDLE = { tag: '预评估', text: '对照现状与优化后排队消散', tone: 'plain' }
const beatCaption = ref({ ...BEAT_IDLE })

const beats = computed(() => findBriefingBeats(before.value, after.value))
const fired = new Set()

function skipBeatsBefore(t) {
  for (const b of beats.value) {
    if (b.t <= t) fired.add(b.id)
  }
}

function wrapFromStart(t, cycle) {
  const start = PLAY_START_S
  const span = Math.max(1, cycle - start)
  if (t < cycle) return Math.max(start, t)
  return start + ((t - start) % span)
}

const beforeSample = computed(() => (before.value ? sampleVariant(before.value, clock.value) : null))
const afterSample = computed(() => (after.value ? sampleVariant(after.value, clock.value) : null))

let rafId = 0
let lastTs = 0
function tick(ts) {
  if (lastTs && demo.value && !paused.value) {
    const dt = (ts - lastTs) / 1000
    const cycle = demo.value.cycleLen || 220
    if (holdRemain.value > 0) {
      holdRemain.value -= dt
    } else {
      const next = clock.value + dt * speed.value
      if (guided.value) {
        const hit = beats.value.find((b) => clock.value < b.t && next >= b.t && !fired.has(b.id))
        if (hit) {
          clock.value = hit.t
          holdRemain.value = hit.hold
          beatCaption.value = { tag: hit.tag, text: hit.text, tone: hit.tone }
          fired.add(hit.id)
        } else if (next >= cycle) {
          // 讲解节拍走完后从 30 s 继续循环，避免回到周期初空车位
          clock.value = PLAY_START_S
          guided.value = false
          speed.value = LOOP_SPEED
        } else {
          clock.value = next
        }
      } else {
        clock.value = wrapFromStart(next, cycle)
      }
    }
  }
  lastTs = ts
  rafId = requestAnimationFrame(tick)
}

function playOnce() {
  fired.clear()
  clock.value = PLAY_START_S
  skipBeatsBefore(PLAY_START_S)
  holdRemain.value = 0.4
  paused.value = false
  guided.value = true
  speed.value = BEAT_SPEED
  beatCaption.value = { tag: '预评估', text: '先观察现状拥堵形成，再对比优化后通行', tone: 'plain' }
}

onMounted(() => {
  rafId = requestAnimationFrame(tick)
  playOnce()
})
onUnmounted(() => {
  cancelAnimationFrame(rafId)
})

function togglePause() {
  paused.value = !paused.value
}

defineExpose({ playOnce, togglePause, paused })
</script>

<template>
  <div class="trial-stage" data-testid="corridor-trial-stage">
    <div v-if="demo && before && after" class="stage">
      <CorridorStage
        :model="demo"
        :variant="before"
        :sample="beforeSample"
      />
      <CorridorStage
        :model="demo"
        :variant="after"
        :sample="afterSample"
        :ghost-queue-m="beforeSample?.queueM || 0"
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

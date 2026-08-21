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
const cycleLen = computed(() => demo.value?.cycleLen || 220)
const clockLabel = computed(() => `${Math.floor(clock.value)} / ${cycleLen.value} s`)

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
          beatCaption.value = { tag: '循环对照', text: '现状持续积压，优化后每周期清空', tone: 'plain' }
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
</script>

<template>
  <div class="trial-stage" data-testid="corridor-trial-stage">
    <div class="bar">
      <p class="beat-line">
        <span class="clock"><i>周期</i> {{ clockLabel }}</span>
        <span class="beat">
          <b :class="beatCaption.tone">{{ beatCaption.tag }}</b>
          <span>{{ beatCaption.text }}</span>
        </span>
      </p>
      <div class="acts">
        <button type="button" class="play-btn" @click="playOnce">播放演示</button>
        <button type="button" class="play-btn ghost" @click="paused = !paused">
          {{ paused ? '继续' : '暂停' }}
        </button>
      </div>
    </div>
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
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  min-height: 0;
  height: 100%;
}
.bar {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex: none;
  min-width: 0;
  padding: 0 4px;
}
.beat-line {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin: 0;
  min-width: 0;
  flex: 1;
}
.clock {
  flex: none;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text);
}
.clock i {
  margin-right: 6px;
  font-style: normal;
}
.beat {
  display: flex;
  gap: 8px;
  min-width: 0;
  font-size: 13px;
  color: var(--text);
}
.beat b { flex: none; font-weight: 600; }
.beat b.danger { color: var(--danger); }
.beat b.ok { color: var(--ok); }
.beat b.plain { color: var(--text); }
.acts { display: flex; gap: 8px; flex: none; }
.play-btn {
  padding: 6px 14px;
  font-size: 12px;
  letter-spacing: 1px;
  color: var(--text);
  background: transparent;
  border: 1px solid var(--cyan-border);
  cursor: pointer;
}
.play-btn:hover { box-shadow: 0 0 12px rgba(0, 229, 255, 0.45); }
.play-btn.ghost { color: var(--text-muted); }
.stage {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
}
.stage :deep(.corridor) {
  flex: 1 1 0;
  min-height: 0;
}
.empty {
  margin: auto;
  font-size: 12px;
  color: var(--text);
}
</style>

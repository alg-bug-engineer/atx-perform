<script setup>
/**
 * 生产壳层：大字报标题 + 顶部步骤栏 + 执行状态
 * 步骤栏覆盖全部六幕（内部 key 0–5，展示编号 1–6），点选或 ← / → 切幕，与 ?scene= 调试路由同源。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  barrierPaused,
  pauseAfterActRequested,
  playbackHint,
} from '../shared/act-playback.js'

const props = defineProps({
  scenes: { type: Array, required: true },
  activeKey: { type: String, required: true },
})

const emit = defineEmits(['change'])

const nowText = ref('')
let clockTimer = null

function pad(n) {
  return String(n).padStart(2, '0')
}

function tickClock() {
  const d = new Date()
  nowText.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const activeIndex = computed(() => props.scenes.findIndex((s) => s.key === props.activeKey))

const activeScene = computed(() => props.scenes[activeIndex.value] || props.scenes[0])

/** 执行状态用处置动作命名，不直接复读幕名 */
const STATUS_LABEL = {
  0: '主动巡检',
  1: '问题定位',
  2: '成因研判',
  3: '方案生成',
  4: '效果预评估',
  5: '技能固化',
}

const statusLabel = computed(
  () => STATUS_LABEL[props.activeKey] || activeScene.value?.name || '执行中',
)

const pausedTone = computed(() => barrierPaused.value || pauseAfterActRequested.value)

const statusText = computed(() => playbackHint.value || `执行中：${statusLabel.value}`)

/** 展示编号 = 步骤序号 + 1（幕0 显示为第一幕）；内部路由仍用 scene.key，与 ?scene= 调试参数对得上 */
const steps = computed(() =>
  props.scenes.map((scene, i) => ({
    key: scene.key,
    name: scene.name,
    badge: String(i + 1),
    sub: /[a-z]$/i.test(scene.key),
    state: i < activeIndex.value ? 'done' : i === activeIndex.value ? 'active' : 'idle',
  })),
)

function move(delta) {
  const next = activeIndex.value + delta
  if (next < 0 || next >= props.scenes.length) return
  emit('change', props.scenes[next].key)
}

function onKey(e) {
  if (e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName)) return
  if (e.key === 'ArrowRight') move(1)
  if (e.key === 'ArrowLeft') move(-1)
}

onMounted(() => {
  tickClock()
  clockTimer = window.setInterval(tickClock, 1000)
  window.addEventListener('keydown', onKey)
})

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <header class="chrome" data-testid="app-chrome">
    <div class="banner">
      <h1 class="title-main">济南交管支队信控智能体</h1>
      <div class="banner-right">
        <time class="clock" :datetime="nowText">{{ nowText }}</time>
      </div>
    </div>

    <div class="step-row">
      <nav class="step-bar" aria-label="处置流程">
        <template v-for="(step, i) in steps" :key="step.key">
          <span v-if="i > 0" class="step-line" :class="{ passed: step.state !== 'idle' }" aria-hidden="true" />
          <button
            type="button"
            class="step"
            :class="[`is-${step.state}`, { 'is-sub': step.sub }]"
            :aria-current="step.state === 'active' ? 'step' : undefined"
            @click="emit('change', step.key)"
          >
            <span class="step-badge">{{ step.badge }}</span>
            <span class="step-label">{{ step.name }}</span>
          </button>
        </template>
      </nav>

      <div class="status-strip" :class="{ paused: pausedTone }">
        <span class="status-dot" aria-hidden="true" />
        <span class="status-text">{{ statusText }}</span>
        <kbd class="status-kbd" :class="{ space: pausedTone }">空格</kbd>
        <kbd class="status-kbd">← →</kbd>
      </div>
    </div>
  </header>
</template>

<style scoped>
.chrome {
  position: absolute;
  inset: 0 0 auto 0;
  z-index: 50;
  padding: 18px 24px 10px;
  pointer-events: none;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.72) 0%, rgba(0, 0, 0, 0.35) 70%, transparent 100%);
}

.banner {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.title-main {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 4px;
  color: var(--text);
  text-shadow: none;
}

.banner-right {
  display: flex;
  align-items: baseline;
  gap: 14px;
  white-space: nowrap;
}

.clock {
  font-size: 13px;
  letter-spacing: 1px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

/* 步骤栏居中放大（大字报风格常驻），执行状态移至其下居中 */
.step-row {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.step-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  pointer-events: auto;
  min-width: 0;
  overflow-x: auto;
}

.step {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  padding: 3px 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 3px;
  white-space: nowrap;
}

.step-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  height: 26px;
  padding: 0 6px;
  flex: none;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0;
  border-radius: 6px;
  border: 1px solid rgba(160, 200, 220, 0.35);
  color: rgba(160, 200, 220, 0.7);
  background: rgba(4, 12, 30, 0.7);
}

.step-line {
  width: 34px;
  height: 1px;
  margin: 0 12px;
  flex: none;
  background: rgba(0, 229, 255, 0.2);
}

.step-line.passed {
  background: rgba(240, 246, 255, 0.45);
}

.step.is-sub .step-badge {
  border-style: dashed;
}

.step.is-done {
  color: var(--text);
  opacity: 0.55;
}

.step.is-done .step-badge {
  color: var(--text);
  border-color: rgba(240, 246, 255, 0.6);
  box-shadow: none;
}

.step.is-active {
  color: var(--text);
}

.step.is-active .step-badge {
  color: #041020;
  background: var(--text);
  border-color: var(--text);
  box-shadow: none;
}

.step.is-active .step-label {
  font-weight: 600;
}

.step:hover .step-label {
  color: var(--text);
}

.status-strip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: none;
  padding: 5px 12px;
  border: 1px solid var(--cyan-border);
  background: rgba(4, 12, 30, 0.82);
  pointer-events: none;
}

.status-strip.paused {
  border-color: rgba(240, 246, 255, 0.5);
  background: rgba(10, 14, 20, 0.88);
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #f0f6ff;
  box-shadow: none;
  animation: blink 1.1s ease-in-out infinite;
}

.status-strip.paused .status-dot {
  background: #f0f6ff;
  box-shadow: none;
  animation: none;
}

.status-text {
  font-size: 12px;
  letter-spacing: 1px;
  color: var(--text);
}

.status-kbd {
  font-family: inherit;
  font-size: 10px;
  letter-spacing: 1px;
  color: rgba(160, 200, 220, 0.55);
  border: 1px solid rgba(160, 200, 220, 0.28);
  border-radius: 2px;
  padding: 0 5px;
}

.status-kbd.space {
  color: rgba(240, 246, 255, 0.9);
  border-color: rgba(240, 246, 255, 0.4);
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

@media (max-width: 1100px) {
  .title-main {
    font-size: 18px;
    letter-spacing: 2px;
  }
  .step-line {
    width: 14px;
    margin: 0 5px;
  }
  .step-label {
    display: none;
  }
  .step.is-active .step-label {
    display: inline;
  }
}
</style>

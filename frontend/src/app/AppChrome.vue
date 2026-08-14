<script setup>
/**
 * 生产壳层：大字报标题 + 顶部步骤栏 + 执行状态
 * 步骤栏覆盖幕 0–5，点选或 ← / → 切幕，与 ?scene= 调试路由同源。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'

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
  0: '走廊扫描',
  1: '问题定位',
  2: '成因研判',
  3: '方案生成',
  4: '效果评估',
  5: '技能固化',
}

const statusLabel = computed(
  () => STATUS_LABEL[props.activeKey] || activeScene.value?.name || '执行中',
)

/** 编号直接用幕 key，和 ?scene= 调试参数对得上 */
const steps = computed(() =>
  props.scenes.map((scene, i) => ({
    key: scene.key,
    name: scene.name,
    badge: scene.key,
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
      <h1 class="title-main">奥体西绩效可视化</h1>
      <div class="banner-right">
        <span class="route-hint">?scene={{ activeKey }}</span>
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

      <div class="status-strip">
        <span class="status-dot" aria-hidden="true" />
        <span class="status-text">执行中：{{ statusLabel }}</span>
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
  color: var(--cyan);
  text-shadow:
    0 0 14px rgba(0, 229, 255, 0.85),
    0 0 28px rgba(0, 229, 255, 0.35);
}

.banner-right {
  display: flex;
  align-items: baseline;
  gap: 14px;
  white-space: nowrap;
}

.route-hint {
  font-size: 11px;
  letter-spacing: 1px;
  color: rgba(160, 200, 220, 0.5);
}

.clock {
  font-size: 13px;
  letter-spacing: 1px;
  color: var(--cyan-dim);
  font-variant-numeric: tabular-nums;
}

/* 步骤栏与执行状态并排一行，给下方内容让出高度 */
.step-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.step-bar {
  display: flex;
  align-items: center;
  gap: 0;
  pointer-events: auto;
  min-width: 0;
  overflow-x: auto;
}

.step {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  padding: 3px 0;
  font-size: 12px;
  letter-spacing: 1px;
  white-space: nowrap;
}

.step-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  flex: none;
  font-size: 10px;
  letter-spacing: 0;
  border-radius: 50%;
  border: 1px solid rgba(160, 200, 220, 0.35);
  color: rgba(160, 200, 220, 0.7);
  background: rgba(4, 12, 30, 0.7);
}

.step-line {
  width: 26px;
  height: 1px;
  margin: 0 8px;
  flex: none;
  background: rgba(0, 229, 255, 0.2);
}

.step-line.passed {
  background: rgba(51, 204, 136, 0.5);
}

.step.is-sub .step-badge {
  border-style: dashed;
}

.step.is-done {
  color: var(--text);
}

.step.is-done .step-badge {
  color: var(--ok);
  border-color: var(--ok);
  box-shadow: 0 0 8px rgba(51, 204, 136, 0.3);
}

.step.is-active {
  color: var(--cyan);
}

.step.is-active .step-badge {
  color: #041020;
  background: var(--cyan);
  border-color: var(--cyan);
  box-shadow: 0 0 10px rgba(0, 229, 255, 0.65);
}

.step.is-active .step-label {
  font-weight: 600;
}

.step:hover .step-label {
  color: var(--cyan);
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

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--cyan);
  box-shadow: 0 0 8px rgba(0, 229, 255, 0.6);
  animation: blink 1.1s ease-in-out infinite;
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

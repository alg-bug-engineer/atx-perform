<script setup>
/**
 * 生产壳层：大字报标题 + 顶部步骤栏 + 执行状态
 * 样式对齐 agent-loop / baseline 的 HUD 标题气质（青霓虹大字）
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

onMounted(() => {
  tickClock()
  clockTimer = window.setInterval(tickClock, 1000)
})

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer)
})

const activeScene = computed(
  () => props.scenes.find((s) => s.key === props.activeKey) || props.scenes[0],
)

const statusLabel = computed(() => {
  const map = {
    0: '走廊扫描',
    1: '问题定位',
    2: '成因研判',
    3: '方案生成',
    4: '效果评估',
    5: '技能固化',
  }
  return map[props.activeKey] || activeScene.value?.name || '执行中'
})

function stepState(key) {
  const cur = Number(props.activeKey)
  const idx = Number(key)
  if (Number.isNaN(cur) || Number.isNaN(idx)) {
    return key === props.activeKey ? 'active' : 'idle'
  }
  if (idx < cur) return 'done'
  if (idx === cur) return 'active'
  return 'idle'
}
</script>

<template>
  <header class="chrome" data-testid="app-chrome">
    <div class="banner">
      <h1 class="title-main">奥体西绩效可视化</h1>
      <time class="clock" :datetime="nowText">{{ nowText }}</time>
    </div>

    <nav class="step-bar" aria-label="处置流程">
      <button
        v-for="(scene, i) in scenes"
        :key="scene.key"
        type="button"
        class="step"
        :class="`is-${stepState(scene.key)}`"
        @click="emit('change', scene.key)"
      >
        <span class="step-dot" aria-hidden="true" />
        <span class="step-label">{{ scene.name }}</span>
        <span v-if="i < scenes.length - 1" class="step-line" aria-hidden="true" />
      </button>
    </nav>

    <div class="status-strip">
      <span class="status-dot" aria-hidden="true" />
      <span class="status-text">执行中：{{ statusLabel }}</span>
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
  margin-bottom: 14px;
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

.clock {
  font-size: 13px;
  letter-spacing: 1px;
  color: var(--cyan-dim);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.step-bar {
  display: flex;
  align-items: center;
  gap: 0;
  pointer-events: auto;
  margin-bottom: 10px;
  overflow-x: auto;
}

.step {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px 0;
  font-size: 12px;
  letter-spacing: 1px;
  white-space: nowrap;
}

.step-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(160, 200, 220, 0.35);
  border: 1px solid rgba(160, 200, 220, 0.35);
  flex-shrink: 0;
}

.step-label {
  padding-right: 4px;
}

.step-line {
  width: 28px;
  height: 1px;
  margin: 0 10px 0 6px;
  background: rgba(0, 229, 255, 0.22);
}

.step.is-done {
  color: var(--text);
}
.step.is-done .step-dot {
  background: var(--ok);
  border-color: var(--ok);
  box-shadow: 0 0 8px rgba(51, 204, 136, 0.45);
}
.step.is-done .step-line {
  background: rgba(51, 204, 136, 0.45);
}

.step.is-active {
  color: var(--cyan);
}
.step.is-active .step-dot {
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
  padding: 6px 12px;
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

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

@media (max-width: 900px) {
  .title-main {
    font-size: 18px;
    letter-spacing: 2px;
  }
  .step-line {
    width: 16px;
    margin: 0 6px 0 4px;
  }
}
</style>

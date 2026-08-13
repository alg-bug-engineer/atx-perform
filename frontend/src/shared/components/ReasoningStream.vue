<script setup>
/**
 * 智能体推理流：按节拍逐条点亮步骤，最后给出结论。
 * 逻辑取自 agent-loop / act-01 的 AgentReasoning（planning 阶段逐项推进 + 完成回调），
 * 视觉沿用幕 5 技能构建的阶段时间线。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  title: { type: String, default: '推理过程' },
  steps: { type: Array, required: true },
  conclusion: { type: String, default: '' },
  stepMs: { type: Number, default: 900 },
  /** 自动化/降低动效环境下直接落到终态 */
  instant: { type: Boolean, default: false },
})

const emit = defineEmits(['step', 'done'])

const cursor = ref(-1)
const finished = ref(false)
let timer = null

function statusOf(i) {
  if (finished.value || i < cursor.value) return 'done'
  if (i === cursor.value) return 'active'
  return 'idle'
}

const progress = computed(() => {
  if (!props.steps.length) return 0
  if (finished.value) return 100
  return Math.round((Math.max(0, cursor.value) / props.steps.length) * 100)
})

function stop() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

function advance() {
  const next = cursor.value + 1
  if (next >= props.steps.length) {
    finished.value = true
    emit('done')
    return
  }
  cursor.value = next
  emit('step', { index: next, step: props.steps[next] })
  timer = setTimeout(advance, props.steps[next]?.ms || props.stepMs)
}

function start() {
  stop()
  cursor.value = -1
  finished.value = false
  if (props.instant) {
    cursor.value = props.steps.length - 1
    finished.value = true
    props.steps.forEach((step, index) => emit('step', { index, step }))
    emit('done')
    return
  }
  advance()
}

onMounted(start)
onBeforeUnmount(stop)
watch(() => props.steps, start)
</script>

<template>
  <section class="reasoning">
    <header class="rs-head">
      <h3>{{ title }}</h3>
      <span class="rs-pct">{{ progress }}%</span>
    </header>

    <ol class="rs-list">
      <li v-for="(s, i) in steps" :key="s.id || i" class="rs-item" :class="`is-${statusOf(i)}`">
        <span class="rs-dot" aria-hidden="true" />
        <div class="rs-body">
          <span class="rs-label">{{ s.label }}</span>
          <span v-if="s.detail && statusOf(i) !== 'idle'" class="rs-detail">{{ s.detail }}</span>
        </div>
      </li>
    </ol>

    <p v-if="conclusion && finished" class="rs-conclusion">{{ conclusion }}</p>
  </section>
</template>

<style scoped>
.reasoning {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--cyan-border);
  border-left: 2px solid var(--cyan-border-strong);
  border-radius: 2px;
  background: var(--bg-inset);
  min-height: 0;
}

.rs-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

h3 {
  margin: 0;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 2px;
  color: var(--cyan-dim);
}

.rs-pct {
  font-size: 11px;
  color: rgba(160, 200, 220, 0.45);
}

.rs-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
  overflow: auto;
  min-height: 0;
}

.rs-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
  transition: color 0.3s ease;
}

.rs-dot {
  width: 8px;
  height: 8px;
  margin-top: 4px;
  border-radius: 50%;
  flex: none;
  background: rgba(160, 200, 220, 0.3);
}

.rs-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.rs-detail {
  font-size: 11px;
  color: rgba(160, 200, 220, 0.55);
  line-height: 1.45;
}

.rs-item.is-active {
  color: var(--cyan);
}

.rs-item.is-active .rs-dot {
  background: var(--cyan);
  box-shadow: 0 0 6px rgba(0, 229, 255, 0.6);
  animation: rs-blink 1.1s ease-in-out infinite;
}

.rs-item.is-done {
  color: var(--text);
}

.rs-item.is-done .rs-dot {
  background: var(--ok);
}

.rs-conclusion {
  margin: 0;
  padding-top: 8px;
  border-top: 1px dashed var(--cyan-border);
  font-size: 12px;
  line-height: 1.5;
  color: var(--ok);
}

@keyframes rs-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>

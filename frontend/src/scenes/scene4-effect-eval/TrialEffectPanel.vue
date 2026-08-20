<script setup>
/**
 * 效果评估大屏：单周期排队推演铺满主区。
 */
import { computed } from 'vue'
import CycleQueueChart from './CycleQueueChart.vue'
import { buildTrialEffectSeries } from './trialEffectSeries.js'

const props = defineProps({
  payload: { type: Object, required: true },
  optimization: { type: Object, default: null },
})

const emit = defineEmits(['finish', 'home'])

const series = computed(() => buildTrialEffectSeries(props.payload))

const activeCycle = computed(() => {
  const list = series.value.cycles
  return list[list.length - 1] || null
})
const baseline = computed(() => series.value.baseline)

const headline = computed(() => {
  const c = activeCycle.value
  if (!c) return '试运行观察中…'
  const b = baseline.value
  return `最大排队长度由 ${b.queue_length_m} m 降至 ${c.queue_length_m} m`
})

</script>

<template>
  <section class="effect" data-testid="trial-effect-panel">
    <header class="banner">
      <div class="banner-main">
        <p class="lead-eyebrow">效果评估 · 相位协调试运行</p>
        <h2 class="lead-headline">{{ headline }}</h2>
      </div>
    </header>

    <div class="stage">
      <CycleQueueChart class="cycle-cell" :optimization="optimization" />
    </div>

    <footer class="foot">
      <div class="acts">
        <button
          type="button"
          class="btn ghost"
          data-testid="effect-home"
          @click="emit('home')"
        >
          返回主页
        </button>
        <button
          type="button"
          class="btn"
          data-testid="effect-finish"
          @click="emit('finish')"
        >
          固化为可复用技能
        </button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.effect {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 12px;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.banner,
.foot {
  padding-left: 16px;
  padding-right: 16px;
}
.banner {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 26px;
}
.banner-main { min-width: 0; }

.stage {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-height: 0;
  padding: 0 16px;
}

.cycle-cell {
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
  padding: 4px 0;
  border: none;
  border-radius: 0;
  background: rgba(2, 12, 26, 0.55);
}

.foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
}

.acts { display: flex; gap: 10px; align-items: center; }
.btn {
  padding: 11px 26px;
  border-radius: 3px;
  border: 1px solid var(--cyan-border-strong);
  background: rgba(0, 229, 255, 0.92);
  color: rgba(4, 12, 22, 0.95);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.btn:hover:not(:disabled) { background: var(--cyan); }
.btn:disabled { opacity: 0.4; cursor: default; }
.btn.ghost {
  background: transparent;
  border-color: var(--cyan-border);
  color: var(--text-muted);
  font-weight: 400;
  padding: 11px 20px;
}
.btn.ghost:hover:not(:disabled) {
  background: rgba(0, 229, 255, 0.08);
  border-color: var(--cyan-border-strong);
  color: var(--text);
}
</style>

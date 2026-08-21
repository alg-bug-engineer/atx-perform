<script setup>
/**
 * 效果预评估大屏：走廊微观仿真作主图（复用幕 3 现状 / 优化后对照）。
 */
import { computed, ref } from 'vue'
import CorridorTrialStage from './CorridorTrialStage.vue'
import { buildTrialEffectSeries } from './trialEffectSeries.js'

const props = defineProps({
  payload: { type: Object, required: true },
  optimization: { type: Object, default: null },
})

const emit = defineEmits(['finish', 'home'])
const trial = ref(null)

const series = computed(() => buildTrialEffectSeries(props.payload))
const headline = computed(() => {
  const first = series.value.baseline.queue_length_m
  const cycles = series.value.cycles
  const last = cycles[cycles.length - 1]
  return last ? `排队长度由 ${first} m 降至 ${last.queue_length_m} m` : '试运行观察中…'
})
</script>

<template>
  <section class="effect" data-testid="trial-effect-panel">
    <header class="banner">
      <p class="lead-eyebrow">效果预评估 · 相位协调试运行</p>
      <h2 class="lead-headline">{{ headline }}</h2>
      <div class="play-acts">
        <button type="button" class="play-btn" @click="trial?.playOnce()">播放演示</button>
        <button type="button" class="play-btn ghost" @click="trial?.togglePause()">
          {{ trial?.paused ? '继续' : '暂停' }}
        </button>
      </div>
    </header>

    <div class="stage">
      <CorridorTrialStage ref="trial" :optimization="optimization" />
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
  gap: 6px;
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
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
}
.banner .lead-eyebrow {
  margin: 0;
  justify-self: start;
  min-width: 0;
}
.banner .lead-headline {
  justify-self: center;
  text-align: center;
  white-space: nowrap;
}
.play-acts {
  display: flex;
  justify-self: end;
  flex: none;
  gap: 8px;
}
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
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-height: 0;
  padding: 0 16px;
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

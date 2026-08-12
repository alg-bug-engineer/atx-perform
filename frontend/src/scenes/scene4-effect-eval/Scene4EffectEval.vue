<script setup>
import { onMounted, ref } from 'vue'
import SceneScaffold from '../../shared/components/SceneScaffold.vue'
import { SCENE_META, loadScene4Data } from './index.js'

const loading = ref(true)
const error = ref('')
const data = ref(null)

onMounted(async () => {
  try {
    data.value = (await loadScene4Data()).effect
  } catch (e) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <SceneScaffold
    :title="SCENE_META.name"
    subtitle="分工开发入口：效果时序/图表独立调试 ?scene=4 或 ?scene=effect"
    :loading="loading"
    :error="error"
    :data-files="SCENE_META.dataFiles"
    :impl-ref="SCENE_META.implRef"
  >
    <template #stage>
      <div class="chart-placeholder">
        <span>TRIAL EFFECT SERIES</span>
        <small>排队 / 速度 before-after 曲线位</small>
      </div>
    </template>

    <p class="lead">TODO：迁入 TrialEffect* 时序与图表，主题变量改用 `--cyan` 等本项目色。</p>
    <ul v-if="data" class="list">
      <li>指标槽位：{{ data.metrics?.join(' · ') }}</li>
      <li>UI 参考：{{ data.meta?.ui_ref?.join(' · ') }}</li>
      <li>基线排队：{{ data.baseline_snapshot?.queue_length_m }} m</li>
    </ul>
  </SceneScaffold>
</template>

<style scoped>
.chart-placeholder {
  position: absolute;
  left: 24px;
  right: 400px;
  top: 120px;
  bottom: 100px;
  border: 1px dashed var(--cyan-border-strong);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--cyan-dim);
}
.chart-placeholder span {
  letter-spacing: 2px;
}
.chart-placeholder small {
  font-size: 11px;
  opacity: 0.8;
}
.lead {
  margin: 0 0 12px;
  color: var(--warn);
}
.list {
  margin: 0;
  padding-left: 18px;
  color: var(--text-muted);
}
</style>

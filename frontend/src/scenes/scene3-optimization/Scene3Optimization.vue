<script setup>
import { computed, onMounted, ref } from 'vue'
import SceneScaffold from '../../shared/components/SceneScaffold.vue'
import { SCENE_META, loadScene3Data } from './index.js'

const loading = ref(true)
const error = ref('')
const data = ref(null)

onMounted(async () => {
  try {
    data.value = (await loadScene3Data()).optimization
  } catch (e) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
})

const baseline = computed(() => data.value?.baseline_signal_plans)
const demo = computed(() => data.value?.demo_script)
</script>

<template>
  <SceneScaffold
    :title="SCENE_META.name"
    subtitle="分工开发入口：本幕独立挂载，不依赖 0–2 运行时状态"
    :loading="loading"
    :error="error"
    :data-files="SCENE_META.dataFiles"
    :impl-ref="SCENE_META.implRef"
  >
    <template #stage>
      <div class="split">
        <div class="pane">
          <span>BEFORE</span>
          <small>解放东先绿 → 汇入 → 溢出</small>
        </div>
        <div class="pane after">
          <span>AFTER</span>
          <small>经十先绿消散 → 解放东再绿</small>
        </div>
      </div>
    </template>

    <p class="lead">TODO：迁入 agent-loop 方案生成面板/相位画布，替换为 baseline 配色。</p>
    <ul v-if="demo" class="list">
      <li>左栏脚本：{{ demo.left_before?.join(' → ') }}</li>
      <li>右栏脚本：{{ demo.right_after?.join(' → ') }}</li>
    </ul>
    <div v-if="baseline" class="cards">
      <div class="card">
        <span>经十现状方案</span>
        <strong>#{{ baseline.jingshi?.period?.plan_no }}</strong>
      </div>
      <div class="card">
        <span>解放东现状方案</span>
        <strong>#{{ baseline.jiefang?.period?.plan_no }}</strong>
      </div>
    </div>
  </SceneScaffold>
</template>

<style scoped>
.split {
  position: absolute;
  inset: 90px 400px 90px 24px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.pane {
  border: 1px solid var(--cyan-border);
  background: rgba(0, 20, 32, 0.55);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--cyan-dim);
}
.pane.after {
  border-color: rgba(51, 204, 136, 0.45);
  color: var(--ok);
}
.pane span {
  letter-spacing: 3px;
  font-size: 14px;
}
.pane small {
  font-size: 11px;
  opacity: 0.8;
  text-align: center;
  padding: 0 12px;
}
.lead {
  margin: 0 0 12px;
  color: var(--warn);
}
.list {
  margin: 0 0 12px;
  padding-left: 18px;
  color: var(--text-muted);
}
.cards {
  display: grid;
  gap: 8px;
}
.card {
  border: 1px solid var(--cyan-border);
  padding: 10px 12px;
  display: flex;
  justify-content: space-between;
}
.card span { color: var(--text-muted); }
.card strong { color: var(--cyan); font-weight: 500; }
</style>

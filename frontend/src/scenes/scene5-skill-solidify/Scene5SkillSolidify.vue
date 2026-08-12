<script setup>
import { onMounted, ref } from 'vue'
import SceneScaffold from '../../shared/components/SceneScaffold.vue'
import { SCENE_META, loadScene5Data } from './index.js'

const loading = ref(true)
const error = ref('')
const data = ref(null)

onMounted(async () => {
  try {
    data.value = (await loadScene5Data()).skill
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
    subtitle="分工开发入口：技能沉淀流程独立调试 ?scene=5 或 ?scene=skill"
    :loading="loading"
    :error="error"
    :data-files="SCENE_META.dataFiles"
    :impl-ref="SCENE_META.implRef"
  >
    <template #stage>
      <div class="skill-placeholder">
        <span>SKILL SOLIDIFY</span>
        <small>代码沉淀 / 确认固化 交互位</small>
      </div>
    </template>

    <p class="lead">TODO：迁入 SkillBuild* 流程面板，配色对齐本项目，勿带入 agent-loop 紫系主题。</p>
    <ul v-if="data" class="list">
      <li>skills 槽位数：{{ data.skills?.length ?? 0 }}</li>
      <li>UI 参考：{{ data.meta?.ui_ref?.join(' · ') }}</li>
    </ul>
  </SceneScaffold>
</template>

<style scoped>
.skill-placeholder {
  position: absolute;
  left: 24px;
  right: 400px;
  top: 120px;
  bottom: 100px;
  border: 1px solid var(--cyan-border);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--cyan-dim);
  background: rgba(0, 229, 255, 0.03);
}
.skill-placeholder span {
  letter-spacing: 2px;
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

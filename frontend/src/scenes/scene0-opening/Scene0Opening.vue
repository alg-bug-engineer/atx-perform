<script setup>
import { onMounted, ref } from 'vue'
import SceneScaffold from '../../shared/components/SceneScaffold.vue'
import { SCENE_META, loadScene0Data } from './index.js'

const loading = ref(true)
const error = ref('')
const opening = ref(null)
const objects = ref(null)

onMounted(async () => {
  try {
    const data = await loadScene0Data()
    opening.value = data.opening
    objects.value = data.objects
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
    subtitle="扫描发现问题路段 → 标红闪烁 → 镜头拉近（本幕可独立调试）"
    :loading="loading"
    :error="error"
    :data-files="SCENE_META.dataFiles"
  >
    <template #stage>
      <div class="stage-label">MAP STAGE · SCENE 0</div>
    </template>

    <ul v-if="opening" class="list">
      <li v-for="a in opening.actions" :key="a.id">
        <code>{{ a.id }}</code> {{ a.do }}
      </li>
    </ul>
    <p v-if="objects" class="kv">
      问题路段
      <strong>{{ objects.problem_link?.link_id }}</strong>
      · 排队专家值 {{ objects.meta?.expert_overrides?.queue_length_m }} m
    </p>
  </SceneScaffold>
</template>

<style scoped>
.stage-label {
  position: absolute;
  left: 24px;
  bottom: 88px;
  color: var(--cyan-dim);
  font-size: 12px;
  letter-spacing: 2px;
}
.list {
  margin: 0;
  padding-left: 18px;
}
.list li {
  margin-bottom: 8px;
}
.list code {
  color: var(--cyan);
}
.kv {
  margin-top: 14px;
  color: var(--text-muted);
}
.kv strong {
  color: var(--danger);
  font-weight: 500;
}
</style>

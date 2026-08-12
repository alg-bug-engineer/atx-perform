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
    subtitle="扫描发现问题路段，标红闪烁并拉近镜头"
    :loading="loading"
    :error="error"
  >
    <ul v-if="opening" class="list">
      <li v-for="a in opening.actions" :key="a.id">
        {{ a.do }}
      </li>
    </ul>
    <p v-if="objects" class="kv">
      问题路段排队长度
      <strong>{{ objects.meta?.expert_overrides?.queue_length_m }} m</strong>
    </p>
  </SceneScaffold>
</template>

<style scoped>
.list {
  margin: 0;
  padding-left: 18px;
}
.list li {
  margin-bottom: 8px;
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

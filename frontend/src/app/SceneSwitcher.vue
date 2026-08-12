<script setup>
defineProps({
  scenes: { type: Array, required: true },
  activeKey: { type: String, required: true },
})
defineEmits(['change'])
</script>

<template>
  <nav class="switcher" aria-label="分幕切换">
    <button
      v-for="scene in scenes"
      :key="scene.key"
      type="button"
      class="tab"
      :class="{ active: scene.key === activeKey }"
      @click="$emit('change', scene.key)"
    >
      <span class="idx">{{ scene.key }}</span>
      <span class="label">{{ scene.name }}</span>
    </button>
  </nav>
</template>

<style scoped>
.switcher {
  position: absolute;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  z-index: 40;
  display: flex;
  gap: 6px;
  pointer-events: auto;
}

.tab {
  border: 1px solid var(--cyan-border);
  background: var(--bg-panel);
  color: var(--cyan-dim);
  cursor: pointer;
  font-size: 11px;
  letter-spacing: 1px;
  padding: 7px 12px;
  display: inline-flex;
  gap: 8px;
  align-items: center;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.tab .idx {
  opacity: 0.7;
}

.tab.active,
.tab:hover {
  background: rgba(0, 229, 255, 0.14);
  color: var(--cyan);
  border-color: var(--cyan-border-strong);
}
</style>

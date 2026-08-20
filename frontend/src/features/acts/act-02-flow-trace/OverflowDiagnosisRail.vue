<script setup>
/**
 * 幕 2 · 五步溢流诊断导航
 * 跟随地图节拍点亮；已判定 / 数据降级可回看证据，不打断自动演示。
 */
defineProps({
  steps: { type: Array, default: () => [] },
  selectedId: { type: String, default: '' },
  reviewing: { type: Boolean, default: false },
});

const emit = defineEmits(['select']);

function onSelect(step) {
  if (!step?.clickable) return;
  emit('select', step);
}
</script>

<template>
  <nav class="diagnosis-rail" aria-label="溢流五步诊断">
    <div class="rail-kicker">溢流诊断</div>
    <ol class="rail-list">
      <li
        v-for="(step, index) in steps"
        :key="step.id"
        class="rail-item"
        :class="[
          `is-${step.status}`,
          { 'is-selected': selectedId === step.id, 'is-clickable': step.clickable },
        ]"
      >
        <button
          type="button"
          class="rail-btn"
          :disabled="!step.clickable"
          :aria-current="selectedId === step.id ? 'step' : undefined"
          @click="onSelect(step)"
        >
          <span class="rail-index">{{ index + 1 }}</span>
          <span class="rail-copy">
            <span class="rail-label">{{ step.label }}</span>
            <span class="rail-status">{{ step.statusLabel }}</span>
          </span>
        </button>
        <span v-if="index < steps.length - 1" class="rail-join" aria-hidden="true" />
      </li>
    </ol>
    <p v-if="reviewing" class="rail-hint">回看证据中 · 自动演示未中断</p>
  </nav>
</template>

<style scoped>
.diagnosis-rail {
  pointer-events: auto;
  padding: 8px 10px 6px;
  background: rgba(6, 14, 26, 0.9);
  border: 1px solid rgba(0, 200, 230, 0.28);
}

.rail-kicker {
  font-size: 10px;
  letter-spacing: 2px;
  color: rgba(160, 180, 200, 0.75);
  margin-bottom: 6px;
}

.rail-list {
  display: flex;
  align-items: stretch;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.rail-item {
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
}

.rail-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin: 0;
  padding: 2px 4px;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: default;
}

.rail-item.is-clickable .rail-btn {
  cursor: pointer;
}

.rail-item.is-clickable .rail-btn:hover .rail-label {
  color: #e8f6ff;
}

.rail-btn:disabled {
  cursor: default;
}

.rail-index {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid rgba(0, 200, 230, 0.35);
  color: rgba(160, 180, 200, 0.8);
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
}

.rail-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.rail-label {
  font-size: 12px;
  letter-spacing: 0.4px;
  color: rgba(200, 214, 228, 0.78);
  white-space: nowrap;
}

.rail-status {
  font-size: 10px;
  color: rgba(160, 180, 200, 0.55);
  letter-spacing: 0.3px;
}

.rail-join {
  flex: 0 0 10px;
  height: 1px;
  margin: 0 2px;
  background: rgba(0, 200, 230, 0.22);
}

.rail-item.is-analyzing .rail-index {
  border-color: rgba(0, 229, 255, 0.85);
  color: #041020;
  background: #00e5ff;
}

.rail-item.is-analyzing .rail-label {
  color: #f0fbff;
}

.rail-item.is-analyzing .rail-status {
  color: #00e5ff;
}

.rail-item.is-judged .rail-index {
  border-color: rgba(0, 229, 255, 0.55);
  color: #00e5ff;
  background: rgba(0, 229, 255, 0.12);
}

.rail-item.is-judged .rail-label {
  color: rgba(230, 240, 250, 0.92);
}

.rail-item.is-degraded .rail-index {
  border-color: rgba(245, 193, 75, 0.7);
  color: #f5c14b;
}

.rail-item.is-degraded .rail-status {
  color: #f5c14b;
}

.rail-item.is-selected .rail-btn {
  outline: 1px solid rgba(0, 229, 255, 0.45);
}

.rail-hint {
  margin: 6px 0 0;
  font-size: 10px;
  letter-spacing: 0.4px;
  color: rgba(0, 229, 255, 0.75);
}
</style>

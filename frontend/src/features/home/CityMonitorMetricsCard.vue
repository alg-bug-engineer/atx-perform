<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import {
  findMonitorObject,
  HOME_FOCUS_CORRIDOR_ID,
  loadCityMonitorDemo,
  resolveMonitorMetrics,
  statusLabel,
} from '../../services/cityMonitorDemo.js';
import { cityMonitorSelection } from '../../shared/home-idle-state.js';
import { narrativeActive, resetNarrativeToHome } from '../../shared/narrative-state.js';

const demo = ref(null);

onMounted(async () => {
  try {
    demo.value = await loadCityMonitorDemo();
  } catch {
    demo.value = null;
  }
});

watch(cityMonitorSelection, async () => {
  if (!demo.value) {
    try {
      demo.value = await loadCityMonitorDemo();
    } catch {
      /* ignore */
    }
  }
});

const selectedTarget = computed(() => {
  const sel = cityMonitorSelection.value;
  if (!sel || !demo.value) return null;
  if (sel.type !== 'intersection' && sel.type !== 'corridor') return null;
  return findMonitorObject(demo.value, sel.type, sel.id);
});

const metrics = computed(() => {
  const sel = cityMonitorSelection.value;
  if (!sel || !selectedTarget.value) return null;
  return resolveMonitorMetrics(sel.type, selectedTarget.value);
});

/** 仅奥体西·解放东→经十廊道显示「立即优化」 */
const showOptimize = computed(() => {
  const sel = cityMonitorSelection.value;
  return sel?.type === 'corridor' && sel?.id === HOME_FOCUS_CORRIDOR_ID;
});

/** 点击「立即优化」：重置叙事 → 进入第一幕（幕舞台挂载后自动开始问题理解与定位） */
function onOptimize() {
  resetNarrativeToHome();
  narrativeActive.value = true;
}
</script>

<template>
  <div v-if="metrics" class="metrics-card">
    <div class="metrics-head">
      <div class="metrics-title">{{ metrics.name }}</div>
      <div class="metrics-sub">
        实时运行指标 · {{ statusLabel(metrics.status) }}
        <template v-if="metrics.stepLabel"> · {{ metrics.stepLabel }}</template>
      </div>
    </div>
    <div class="metrics-row">
      <div v-for="item in metrics.items" :key="item.key" class="metric-cell">
        <div class="metric-val" :style="{ color: item.color }">{{ item.value }}</div>
        <div class="metric-label">{{ item.label }}</div>
      </div>
    </div>
    <div v-if="showOptimize" class="metrics-footer">
      <button type="button" class="optimize-btn" @click="onOptimize">
        立即优化
      </button>
    </div>
  </div>
</template>

<style scoped>
.metrics-card {
  box-sizing: border-box;
  width: min(360px, calc(100vw - 48px));
  pointer-events: auto;
  background: rgba(4, 14, 26, 0.9);
  border: 1px solid rgba(0, 212, 240, 0.28);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.42);
  backdrop-filter: blur(10px);
  color: rgba(230, 245, 255, 0.92);
  overflow: hidden;
}

.metrics-head {
  padding: 10px 12px 8px;
  border-bottom: 1px solid rgba(0, 212, 240, 0.14);
}

.metrics-title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.3px;
  line-height: 1.35;
}

.metrics-sub {
  margin-top: 3px;
  font-size: 10px;
  color: rgba(0, 212, 240, 0.7);
  letter-spacing: 0.8px;
}

.metrics-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0;
}

.metric-cell {
  padding: 12px 8px 11px;
  text-align: center;
  border-right: 1px solid rgba(0, 212, 240, 0.1);
}

.metric-cell:last-child {
  border-right: none;
}

.metric-val {
  font-size: 16px;
  font-weight: 750;
  line-height: 1.2;
  letter-spacing: 0.2px;
}

.metric-label {
  margin-top: 5px;
  font-size: 10px;
  color: rgba(180, 210, 230, 0.55);
}

.metrics-footer {
  padding: 8px 10px 10px;
  border-top: 1px solid rgba(0, 212, 240, 0.14);
}

.optimize-btn {
  width: 100%;
  border: 1px solid rgba(0, 212, 240, 0.5);
  background: rgba(0, 212, 240, 0.14);
  color: #00d4f0;
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 2px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.optimize-btn:hover {
  background: rgba(0, 212, 240, 0.24);
  border-color: rgba(0, 212, 240, 0.75);
}
</style>

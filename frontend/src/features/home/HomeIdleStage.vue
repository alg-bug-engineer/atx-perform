<script setup>
import { computed } from 'vue';
import CityMonitorPanel from './CityMonitorPanel.vue';
import CityMonitorMetricsCard from './CityMonitorMetricsCard.vue';
import {
  cityMonitorReveal,
  cityMonitorSelection,
  enterScene2,
} from '../../shared/home-idle-state.js';

const emit = defineEmits(['enter-scene2']);

const showCityMonitor = computed(() => cityMonitorReveal.value);
const showMonitorScanning = computed(() => !cityMonitorReveal.value);
const showIntersectionMetrics = computed(() => {
  if (!showCityMonitor.value) return false;
  const t = cityMonitorSelection.value?.type;
  return t === 'intersection' || t === 'corridor';
});

function onEnterCause() {
  enterScene2();
  emit('enter-scene2');
}
</script>

<template>
  <div class="home-idle-stage">
    <transition name="dock-fade">
      <div v-if="showMonitorScanning" class="monitor-scan-hint">
        <span class="scan-dot" />
        正在检测城市路网态势…
      </div>
    </transition>

    <transition name="dock-fade">
      <aside v-if="showCityMonitor" class="act-dock act-dock-left act-dock-monitor">
        <CityMonitorPanel />
      </aside>
    </transition>

    <transition name="dock-fade">
      <div v-if="showIntersectionMetrics" class="metrics-dock">
        <CityMonitorMetricsCard />
      </div>
    </transition>

    <div class="launcher-row">
      <button type="button" class="diag-launcher muted">交通诊断</button>
      <button type="button" class="diag-launcher primary" @click="onEnterCause">
        分析成因
      </button>
    </div>
  </div>
</template>

<style scoped>
.home-idle-stage {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 36;
}

.act-dock {
  position: absolute;
  top: 96px;
  z-index: 37;
  pointer-events: auto;
  padding: 0;
  height: auto;
  max-height: calc(100vh - 96px - 72px);
  overflow: visible;
}

.act-dock-left {
  left: 24px;
  width: 300px;
}

.act-dock-monitor {
  width: 340px;
  max-height: calc(100vh - 96px - 72px);
  overflow: visible;
}

.metrics-dock {
  position: absolute;
  left: 380px;
  top: 96px;
  z-index: 37;
  pointer-events: none;
}

.monitor-scan-hint {
  position: absolute;
  left: 50%;
  top: 96px;
  transform: translateX(-50%);
  z-index: 37;
  pointer-events: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  font-size: 12px;
  letter-spacing: 1px;
  font-family: 'Courier New', monospace;
  color: rgba(0, 229, 255, 0.9);
  background: rgba(4, 14, 26, 0.72);
  border: 1px solid rgba(0, 229, 255, 0.3);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(8px);
}

.scan-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #00e5ff;
  box-shadow: 0 0 8px rgba(0, 229, 255, 0.8);
  animation: scan-pulse 1s ease-in-out infinite;
}

@keyframes scan-pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.85);
  }
  50% {
    opacity: 1;
    transform: scale(1.15);
  }
}

.launcher-row {
  position: absolute;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 50;
  display: flex;
  gap: 12px;
  pointer-events: auto;
}

.diag-launcher {
  border: 1px solid rgba(0, 212, 240, 0.45);
  background: rgba(4, 14, 26, 0.88);
  color: #00d4f0;
  font-size: 12px;
  letter-spacing: 2px;
  padding: 10px 22px;
  cursor: pointer;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(10px);
}

.diag-launcher.muted {
  cursor: default;
  opacity: 0.72;
}

.diag-launcher.primary {
  border-color: rgba(245, 166, 35, 0.55);
  color: #f5a623;
}

.diag-launcher.primary:hover {
  background: rgba(245, 166, 35, 0.16);
  border-color: rgba(245, 166, 35, 0.75);
}

.dock-fade-enter-active,
.dock-fade-leave-active {
  transition: opacity 0.45s ease, transform 0.45s ease;
}
.dock-fade-enter-from,
.dock-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>

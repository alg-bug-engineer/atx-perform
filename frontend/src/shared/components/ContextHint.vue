<script setup>
import { jumpContext } from '../analysis-state.js';
</script>

<template>
  <transition name="hint-slide">
    <div v-if="jumpContext.reason" class="ctx-hint">
      <span class="ch-icon">◈</span>
      <span class="ch-body">
        <span class="ch-from">智能体从「{{ jumpContext.fromLabel }}」引导至此</span>
        <span v-if="jumpContext.target" class="ch-target"> · 锁定目标：<b>{{ jumpContext.target }}</b></span>
        <span class="ch-sep"> · </span>
        <span class="ch-reason">{{ jumpContext.reason }}</span>
      </span>
    </div>
  </transition>
</template>

<style scoped>
.ctx-hint {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  background: rgba(0, 210, 240, 0.06);
  border: 1px solid rgba(0, 210, 240, 0.22);
  border-left: 2px solid rgba(0, 210, 240, 0.70);
  padding: 6px 9px;
  flex-shrink: 0;
}

.ch-icon {
  color: #00d4f0;
  font-size: 11px;
  flex-shrink: 0;
  margin-top: 1px;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.5; }
}

.ch-body {
  font-size: 11px;
  color: rgba(220, 240, 255, 0.82);
  line-height: 1.55;
  flex: 1;
}

.ch-from {
  color: rgba(0, 210, 240, 0.85);
}

.ch-target b {
  color: #eef6ff;
  font-weight: normal;
}

.ch-sep {
  color: rgba(255, 255, 255, 0.25);
}

.ch-reason {
  color: rgba(220, 240, 255, 0.75);
}

/* Transition */
.hint-slide-enter-active {
  transition: opacity 0.3s, transform 0.3s;
}
.hint-slide-enter-from {
  opacity: 0;
  transform: translateY(-5px);
}
</style>

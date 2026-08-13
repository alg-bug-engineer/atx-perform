<script setup>
/**
 * 幕任务栏（壳层通用组件，由 shared/narrative-state 驱动）
 * 从原 act-01/TaskBar.vue 迁移至此：任务栏属于壳层 UI，不属于任何幕模块。
 */
import { computed } from 'vue';
import {
  barrierPaused,
  pauseAfterActRequested,
  playbackHint,
} from '../../shared/act-playback.js';
import {
  taskBarLabel,
  taskBarVisible,
  act1Phase,
  act2Phase,
} from '../../shared/narrative-state.js';
import {
  agentRunState,
  getComputingLabel,
  isLiveMode,
} from '../../services/runtimeFixture.js';

const visible = computed(() => taskBarVisible.value || Boolean(playbackHint.value));
const label = computed(() => {
  if (playbackHint.value) return playbackHint.value;
  if (isLiveMode()) {
    const computing = getComputingLabel();
    if (computing && (agentRunState.status === 'running' || agentRunState.status === 'loading')) {
      // 幕内已有 taskBarLabel 时优先显示幕标签；无则显示后台推理
      if (!taskBarLabel.value || /推理中|加载路口|等待/.test(taskBarLabel.value)) {
        return computing;
      }
    }
  }
  return taskBarLabel.value || '执行中…';
});
const pulse = computed(() => (
  act1Phase.value === 'parsing'
  || act1Phase.value === 'handoff'
  || act2Phase.value === 'locating'
  || act2Phase.value === 'handoff'
  || (isLiveMode() && (agentRunState.status === 'running' || agentRunState.status === 'loading'))
));
const pausedTone = computed(() => barrierPaused.value || pauseAfterActRequested.value);
</script>

<template>
  <Teleport to="body">
    <transition name="bar-rise">
      <div v-if="visible" class="task-bar" :class="{ paused: pausedTone }">
        <span class="tb-dot" :class="{ pulse: pulse && !pausedTone, hold: pausedTone }"></span>
        <span class="tb-label">{{ label }}</span>
        <span v-if="pausedTone" class="tb-kbd">Space</span>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.task-bar {
  position: fixed;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
  z-index: 48;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 320px;
  max-width: min(520px, calc(100vw - 40px));
  padding: 10px 16px;
  background: rgba(4, 14, 26, 0.9);
  border: 1px solid rgba(0, 212, 240, 0.32);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4);
  pointer-events: auto;
  transition: border-color 0.25s ease, background 0.25s ease;
}

.task-bar.paused {
  border-color: rgba(255, 193, 74, 0.55);
  background: rgba(18, 14, 8, 0.92);
}

.tb-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #00d4f0;
  flex-shrink: 0;
}

.tb-dot.pulse {
  animation: tb-blink 0.9s ease-in-out infinite;
}

.tb-dot.hold {
  background: #ffc14a;
  box-shadow: 0 0 8px rgba(255, 193, 74, 0.55);
}

@keyframes tb-blink {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(0, 212, 240, 0.45); }
  50% { opacity: 0.45; box-shadow: 0 0 0 5px rgba(0, 212, 240, 0); }
}

.tb-label {
  flex: 1;
  font-size: 12px;
  letter-spacing: 1px;
  color: rgba(220, 240, 255, 0.88);
  font-family: 'Courier New', monospace;
}

.tb-kbd {
  flex-shrink: 0;
  font-size: 10px;
  letter-spacing: 0.5px;
  color: rgba(255, 193, 74, 0.9);
  border: 1px solid rgba(255, 193, 74, 0.4);
  padding: 1px 6px;
  border-radius: 3px;
  font-family: 'Courier New', monospace;
}

.bar-rise-enter-active {
  transition: opacity 0.45s ease, transform 0.45s cubic-bezier(0.22, 1, 0.36, 1);
}
.bar-rise-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.bar-rise-enter-from,
.bar-rise-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(16px);
}
</style>

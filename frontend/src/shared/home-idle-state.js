import { ref } from 'vue';

/** 对齐 agent-loop narrative-state 中 Act1 idle 相关字段 */
export const cityMonitorReveal = ref(false);
export const cityMonitorSelection = ref(null);

/** idle = 首页监控；scene2 = 成因分析（上游溯源） */
export const activeScene = ref('idle');

export function resetHomeIdleState() {
  cityMonitorReveal.value = false;
  cityMonitorSelection.value = null;
}

export function enterScene2() {
  activeScene.value = 'scene2';
}

export function enterIdle() {
  activeScene.value = 'idle';
}

import { ref } from 'vue';

/** 对齐 agent-loop narrative-state 中 Act1 idle 相关字段 */
export const cityMonitorReveal = ref(false);
export const cityMonitorSelection = ref(null);

/** idle = 首页监控；scene2 = 成因分析（上游溯源） */
export const activeScene = ref('idle');

/**
 * 从叙事幕请求跳转到首页「分析成因」（递增信号，供 MapRuntime 消费）。
 * 幕 2（流量溯源）暂用跳转方式复用首页 scene2-cause，后续再改造为原生幕。
 */
export const scene2EnterRequest = ref(0);

export function requestEnterScene2() {
  scene2EnterRequest.value += 1;
}

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

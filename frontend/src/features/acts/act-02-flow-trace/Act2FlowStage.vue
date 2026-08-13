<script setup>
/**
 * 幕 2 · 流量溯源（成因分析）— 跳转壳
 *
 * 暂不在地图重演流量溯源：幕 1 结束后直接切回首页并进入「分析成因」页面，
 * 复用首页 scene2-cause 的完整演绎（溯源 / 供需 / 经十东西进口 / 绿灯约束 / 溢流）。
 * 后续再优化为原生幕（把 scene2-cause 移植到 TrafficOriginScene）。
 */
import { onMounted } from 'vue';
import { requestEnterScene2 } from '../../../shared/home-idle-state.js';
import { narrativeActive } from '../../../shared/narrative-state.js';
import { enterFlowTrace } from './state.js';

const props = defineProps({ prevState: { type: Object, default: null } });
const emit = defineEmits(['exit']);

onMounted(() => {
  enterFlowTrace(props.prevState);
  // 跳转：退出叙事模式 → 首页自动进入「分析成因」
  requestEnterScene2();
  narrativeActive.value = false;
});
</script>

<template>
  <div class="flow-trace-stage"></div>
</template>

<style scoped>
.flow-trace-stage {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 36;
}
</style>

<script setup>
/**
 * 幕循环壳（注册表驱动，可插拔）
 *
 * 只依赖 act-registry：
 * - 主工程入口（main.js / standalone 入口）import 各幕模块（副作用注册）；
 * - 本壳读取注册表，按 narrativeState.act 挂载对应幕舞台；
 * - 幕 exit 后自动推进到注册表中的下一幕；若无下一幕，停留在当前幕
 *   （任务栏提示「等待后续幕模块注册」），保证单幕独立开发不受影响。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { listActs } from './act-registry.js';
import ActTaskBar from './ActTaskBar.vue';
import LiveErrorOverlay from './LiveErrorOverlay.vue';
import HealthyExitOverlay from './HealthyExitOverlay.vue';
import {
  conclusionSpaceWaitActive,
  gateActAdvance,
  isTypingTarget,
  resetPlaybackPause,
  toggleSpacePlayback,
} from '../../shared/act-playback.js';
import {
  narrativeActive,
  narrativeState,
  setAct,
  taskBarLabel,
  taskBarVisible,
} from '../../shared/narrative-state.js';
import { onBeatChanged } from '../../shared/act-voice.js';

const emit = defineEmits(['act-exit']);

// 已注册幕（按 order 升序）
const acts = computed(() => listActs());

// 当前幕描述：优先按 narrativeState.act 匹配；无匹配时用第一幕
const currentDescriptor = computed(() => (
  acts.value.find((a) => a.id === narrativeState.act)
  || acts.value.find((a) => a.order === 1)
  || acts.value[0]
  || null
));

const currentStageComponent = computed(() => currentDescriptor.value?.stageComponent || null);

// 幕退出状态（传给下一幕的 prevState）
const actExitStates = ref({});

function onStageExit(nextState) {
  const current = currentDescriptor.value;
  if (!current) return;
  actExitStates.value[current.id] = nextState;
  emit('act-exit', nextState);

  const targetId = nextState?.nextAct != null ? nextState.nextAct : current.id + 1;
  const target = acts.value.find((a) => a.id === targetId);

  if (target && target.stageComponent) {
    // 下一幕已注册：推进
    gateActAdvance({
      nextAct: target.id,
      apply: () => {
        setAct(target.id);
        console.info(`[ActLoop] ${current.name} exit → ${target.name}`, nextState?.ticket?.intersection_name ?? '');
      },
    });
  } else {
    // 下一幕未注册：停留在当前幕（后续幕由其他模块按注册方式接入）
    taskBarVisible.value = true;
    taskBarLabel.value = `${current.name}完成 · 等待后续幕模块注册`;
    console.info(`[ActLoop] ${current.name} exit → 无下一幕（未注册），停留等待`, nextState);
    resetPlaybackPause();
  }
}

function onKeydown(e) {
  if (e.code !== 'Space' && e.key !== ' ') return;
  if (e.repeat) return;
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (!narrativeActive.value) return;
  if (isTypingTarget(e.target)) return;
  if (conclusionSpaceWaitActive.value) return;

  e.preventDefault();
  toggleSpacePlayback();
}

watch(
  () => narrativeState.beatId,
  (beatId, prev) => {
    if (!beatId || beatId === prev) return;
    onBeatChanged(beatId);
  },
);

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  if (import.meta.env.DEV) {
    console.info('[ActLoop] 已注册幕：', acts.value.map((a) => `${a.id}·${a.name}`).join(' / '));
  }
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  resetPlaybackPause();
});
</script>

<template>
  <div v-if="narrativeActive" class="act-loop-shell">
    <component
      :is="currentStageComponent"
      v-if="currentStageComponent"
      :prev-state="actExitStates[currentDescriptor?.id] || null"
      @exit="onStageExit"
    />
    <ActTaskBar />
    <HealthyExitOverlay />
    <LiveErrorOverlay />
  </div>
</template>

<style scoped>
.act-loop-shell {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 36;
}
</style>

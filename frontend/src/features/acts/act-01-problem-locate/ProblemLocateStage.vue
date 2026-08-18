<script setup>
/**
 * 幕 1 · 问题定位 — 指挥家时间轴舞台
 *
 * 语音为主轴，三拍带动单轨镜头、问题路段标红、上下游东西向与大字报。
 */
import { onMounted, onUnmounted, ref } from 'vue';
import HeadlineOverlay from '../../../shared/components/HeadlineOverlay.vue';
import { runExitBarrier } from '../../../shared/act-timing.js';
import { setAct2MapBeat } from '../../../shared/narrative-state.js';
import { createConductor } from '../../../shared/conductor/conductor.js';
import { ACT1_BEATS } from './timeline.js';
import {
  beginLocate,
  completeLocateConfirm,
  completeTicket,
  enterProblemLocate,
  exitProblemLocate,
  setProblemLocateHud,
} from './state.js';

const emit = defineEmits(['exit']);

const _timers = [];
function later(fn, ms) {
  const t = setTimeout(fn, ms);
  _timers.push(t);
  return t;
}
function clearTimers() {
  _timers.forEach(clearTimeout);
  _timers.length = 0;
}

// ── 指挥家状态 ─────────────────────────────────────────────────────
const headline = ref(null);
let exited = false;

// ── 指挥家分派 ─────────────────────────────────────────────────────
function onBeatStart(beat) {
  headline.value = { main: beat.headline };
  setProblemLocateHud({
    phase: beat.mapBeat,
    caption: beat.caption,
    headline: beat.headline,
    panel: beat.panel,
  });

  switch (beat.id) {
    case 's1-lock':
      completeTicket();
      beginLocate();
      break;
    case 's1-nodes':
      setAct2MapBeat('nodes');
      break;
    case 's1-conclusion':
      completeLocateConfirm();
      setAct2MapBeat('conclusion');
      break;
    default:
      break;
  }
}

function runExitFlow() {
  if (exited) return;
  exited = true;
  runExitBarrier({
    later,
    barriers: [],
    // 语音已随拍对齐（最后一拍播完才 onAllEnd），无需再等播报队列
    waitBroadcast: false,
    onExit: () => {
      const nextState = exitProblemLocate({ nextAct: 2 });
      emit('exit', nextState);
    },
  });
}

let conductor = null;

onMounted(() => {
  enterProblemLocate();

  conductor = createConductor({
    beats: ACT1_BEATS,
    hooks: {
      onBeatStart,
      // 末拍语音播完即收束交棒（消灭尾部干等）
      onAllEnd: () => later(runExitFlow, 400),
    },
  });
  conductor.play();
});

onUnmounted(() => {
  conductor?.dispose();
  conductor = null;
  clearTimers();
});
</script>

<template>
  <div class="problem-locate-stage">
    <!-- 大字报讲解（每拍一条要点） -->
    <HeadlineOverlay :headline="headline" />
  </div>
</template>

<style scoped>
.problem-locate-stage {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 36;
}
</style>

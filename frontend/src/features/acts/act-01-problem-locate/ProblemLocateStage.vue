<script setup>
/**
 * 幕 1 · 问题定位 — 指挥家时间轴舞台
 *
 * 语音为主轴，三拍带动单轨镜头、问题路段标红、上下游东西向与大字报。
 */
import { onMounted, onUnmounted, ref } from 'vue';
import TicketSpatialCard from './TicketSpatialCard.vue';
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
  problemLocateHud,
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
    <!-- 左侧只保留当前拍结论，详细数字落在地图钉上。 -->
    <transition name="dock-fade">
      <aside v-if="problemLocateHud.panel" :key="problemLocateHud.phase" class="act-dock act-dock-left">
        <TicketSpatialCard
          :panel="problemLocateHud.panel"
          compact
        />
      </aside>
    </transition>

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

.act-dock {
  position: absolute;
  z-index: 37;
  pointer-events: auto;
  padding: 0;
  height: auto;
  max-height: calc(100vh - 96px - 72px);
  overflow-x: hidden;
  overflow-y: auto;
}

.act-dock-left {
  top: 12px;
  left: 24px;
  width: min(280px, calc(100vw - 48px));
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

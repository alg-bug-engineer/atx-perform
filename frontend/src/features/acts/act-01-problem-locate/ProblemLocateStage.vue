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
import { PROBLEM_LOCATE_BEATS } from './fixture.js';
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
const dockStack = ref([]);
let exited = false;

/** 左侧信息侧栏卡片（参考幕三 trace-dock 处理方式，随拍累积） */
function dockCardFor(key) {
  switch (key) {
    case 'lock':
      return {
        title: '问题路段锁定',
        rows: [['路段', '奥体西路·解放东路—经十路'], ['流向', '北向南直行']],
      };
    case 'queue':
      return { title: '车辆排队', copy: '北向南直行车辆正在逐段排队，队尾向上游延伸。' };
    case 'm-queue':
      return { title: '排队长度', hero: '270 m', accent: '#ff8a3a', lab: '蓄车 368 m · 排队比 0.73，接近预警线' };
    case 'm-speed':
      return { title: '平均速度', hero: '7.2 km/h', accent: '#ffb020', lab: '通行速度偏低 · 延时指数 5.28' };
    case 'm-sat':
      return { title: '饱和度', hero: '0.84', accent: '#ff6b4a', lab: '北向南直行 · 预警线 0.8' };
    case 'nodes':
      return { title: '上下游路口', copy: '上游解放东路口、下游经十路口；经十路东西向压力突出，东进口通行偏慢。' };
    case 'conclusion':
      return { title: '问题定位完成', copy: '北向南溢流风险成立。' };
    default:
      return null;
  }
}

// lock 拍子步序列：语音播报期间同步演绎（播报与页面同步）
const SUB_KEYS = ['lock', 'channelization', 'queue', 'm-queue', 'm-speed', 'm-sat'];

/** 地图拍 + 侧栏卡 + 大字报 同步分派 */
function dispatchMapBeat(key) {
  setAct2MapBeat(key);
  const card = dockCardFor(key);
  if (card) dockStack.value = [...dockStack.value, card];
  const hd = PROBLEM_LOCATE_BEATS[key]?.headline;
  if (hd) headline.value = { main: hd };
}

// ── 指挥家分派 ─────────────────────────────────────────────────────
function onBeatStart(beat) {
  if (beat.headline) headline.value = { main: beat.headline };
  setProblemLocateHud({
    phase: beat.mapBeat,
    caption: beat.caption,
    headline: beat.headline,
    panel: beat.panel,
  });

  if (beat.mapBeat === 'lock') {
    completeTicket();
    beginLocate();
  }
  if (beat.mapBeat === 'conclusion') completeLocateConfirm();
  dispatchMapBeat(beat.mapBeat);
}

/** lock 拍子步：渠化→排队→三窗 随语音依次上页（播报与页面同步） */
function onBeatProgress(beat, subIdx) {
  if (beat.mapBeat !== 'lock') return;
  const key = SUB_KEYS[subIdx];
  if (key && key !== 'lock') dispatchMapBeat(key);
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
  dockStack.value = [];

  conductor = createConductor({
    beats: ACT1_BEATS,
    hooks: {
      onBeatStart,
      onBeatProgress,
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
    <!-- 左侧信息侧栏（参考幕三 trace-dock） -->
    <aside v-if="dockStack.length" class="locate-dock">
      <div v-for="(item, i) in dockStack" :key="i" class="dock-card">
        <div class="dock-title">{{ item.title }}</div>
        <div v-if="item.hero" class="dock-hero" :style="item.accent ? { color: item.accent } : null">
          {{ item.hero }}
        </div>
        <div v-if="item.lab" class="dock-lab">{{ item.lab }}</div>
        <div v-for="(row, j) in item.rows || []" :key="`r${j}`" class="dock-row">
          <span>{{ row[0] }}</span>
          <strong>{{ row[1] }}</strong>
        </div>
        <p v-if="item.copy" class="dock-copy">{{ item.copy }}</p>
      </div>
    </aside>

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

.locate-dock {
  position: absolute;
  left: 24px;
  top: 12px;
  z-index: 38;
  width: min(280px, calc(100vw - 48px));
  max-height: calc(100% - 160px);
  overflow-y: auto;
  overscroll-behavior: contain;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dock-card {
  padding: 10px 12px;
  background: rgba(6, 14, 26, 0.9);
  border: 1px solid rgba(0, 200, 230, 0.28);
}

.dock-title {
  font-size: 12px;
  letter-spacing: 1px;
  color: var(--text);
  margin-bottom: 8px;
}

.dock-hero {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.dock-lab {
  font-size: 10px;
  color: rgba(160, 180, 200, 0.75);
  margin-top: 2px;
}

.dock-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 14px;
  color: var(--text-muted);
  padding: 3px 0;
}

.dock-row strong {
  color: #e8f6ff;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.dock-copy {
  margin: 8px 0 0;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  font-size: 12px;
  line-height: 1.55;
  color: rgba(220, 230, 240, 0.92);
}
</style>

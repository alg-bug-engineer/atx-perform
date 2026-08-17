<script setup>
/**
 * 幕 1 · 问题定位 — 指挥家时间轴舞台
 *
 * 语音为主轴，四拍严格带动地图与 UI（信息不变，只重排呈现）：
 *   lock        飞入经十路北入口（语音起 = 镜头起，消灭开头割裂）+ 大字报点题
 *   metrics     FlowInfoWindow 四指标逐条揭示（substeps 对齐语音）
 *   upstream    指标窗撤下，镜头沿走廊扫视，上游汇入箭头强调
 *   conclusion  三路口同框收束 + 诊断对象锚点 + 大字报「问题定位完成」
 *
 * 侧板降级为过程信息：左卡紧凑模式（工单→空间对象）；
 * 语音播完即交棒，无尾部干等。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import TicketSpatialCard from './TicketSpatialCard.vue';
import FlowInfoWindow from './FlowInfoWindow.vue';
import HeadlineOverlay from '../../../shared/components/HeadlineOverlay.vue';
import { createReadyGate, runExitBarrier } from '../../../shared/act-timing.js';
import { act1Phase, act2Phase, setAct2MapBeat } from '../../../shared/narrative-state.js';
import { createConductor } from '../../../shared/conductor/conductor.js';
import { ACT1_BEATS } from './timeline.js';
import { FLOW_INFO_WINDOWS, INTERSECTIONS } from './fixture.js';
import {
  beginLocate,
  beginParse,
  completeLocateConfirm,
  completeTicket,
  enterProblemLocate,
  exitProblemLocate,
  locateCorridorReady,
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

// ── 可见性 ─────────────────────────────────────────────────────────
// 左卡：工单落地后显示；走廊揭示后切换为空间对象模式（紧凑）
const leftVisible = computed(
  () => act1Phase.value === 'ticket_ready'
    || act2Phase.value === 'locating'
    || act2Phase.value === 'confirming'
    || act2Phase.value === 'handoff',
);
const leftMode = computed(() => (corridorRevealed.value ? 'spatial' : 'ticket'));

// ── 指挥家状态 ─────────────────────────────────────────────────────
const headline = ref(null);              // 大字报（每拍一条要点）
const corridorRevealed = ref(false);     // 走廊揭示（飞入完成）
const windowsVisible = ref(false);       // 指标窗口（metrics 拍）
const visibleMetricCount = ref(0);       // 指标逐条揭示（substeps）
const showAnchor = computed(() => corridorRevealed.value);

let metricsBeatOn = false;

// 信息窗口：只展示核心问题路段（奥体西路·北向南）流量数据
const allWindows = [
  ...FLOW_INFO_WINDOWS.filter((w) => w.core).map((w) => ({
    ...w,
    offsetX: w.anchor === 'jingshi' ? -15 : -13,
    offsetY: -18,
  })),
];

const anchorMap = {
  jiefang: INTERSECTIONS.jiefang,
  kunshun: INTERSECTIONS.kunshun,
  jingshi: INTERSECTIONS.jingshi,
};

// ── 退出栅栏 ───────────────────────────────────────────────────────
const leftGate = createReadyGate(); // 工单左卡揭示完成
let exited = false;

function onTicketRevealDone() {
  leftGate.signal();
}

// 指标窗口：metrics 拍已开始 + 走廊已揭示（镜头到位）才显示
function maybeShowWindows() {
  if (metricsBeatOn && locateCorridorReady.ready && !windowsVisible.value) {
    windowsVisible.value = true;
    if (visibleMetricCount.value === 0) visibleMetricCount.value = 1;
  }
}

// ── 指挥家分派 ─────────────────────────────────────────────────────
function onBeatStart(beat) {
  headline.value = { main: beat.headline, sub: beat.headlineSub };
  switch (beat.id) {
    case 's1-lock':
      // 语音起 = 地图起：问题理解 + 飞入并行，工单紧凑落地
      beginParse();
      later(() => completeTicket(), 900);
      later(() => beginLocate(), 1400);
      break;
    case 's1-metrics':
      metricsBeatOn = true;
      maybeShowWindows();
      break;
    case 's1-upstream':
      // 镜头沿走廊扫视前先撤指标窗（静态投影窗口不跟随镜头）
      windowsVisible.value = false;
      setAct2MapBeat('path');
      break;
    case 's1-conclusion':
      completeLocateConfirm();
      setAct2MapBeat('settle');
      break;
    default:
      break;
  }
}

function onBeatProgress(beat, subIndex) {
  if (beat.id === 's1-metrics') {
    visibleMetricCount.value = Math.max(visibleMetricCount.value, subIndex + 1);
  }
}

function runExitFlow() {
  if (exited) return;
  exited = true;
  runExitBarrier({
    later,
    barriers: [leftGate.current],
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

  locateCorridorReady.once(() => {
    corridorRevealed.value = true;
    maybeShowWindows();
  });

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
    <!-- 左侧：工单 / 空间对象结果卡（紧凑模式，过程信息） -->
    <transition name="dock-fade">
      <aside v-if="leftVisible" class="act-dock act-dock-left">
        <TicketSpatialCard
          :key="leftMode"
          :mode="leftMode"
          compact
          @reveal-done="onTicketRevealDone"
        />
      </aside>
    </transition>

    <!-- 地图结论锚点：诊断对象 -->
    <transition name="anchor-fade">
      <div v-if="showAnchor" class="map-anchor">
        <span class="ma-dot"></span>
        <span class="ma-text">诊断对象</span>
        <span class="ma-name">奥体西路 · 北向南</span>
      </div>
    </transition>

    <!-- 核心问题路段流量信息窗口（奥体西路·北向南，指标逐条揭示） -->
    <FlowInfoWindow
      v-for="(win, i) in allWindows"
      :key="win.id"
      :anchor="win.anchor"
      :anchor-lon="anchorMap[win.anchor].lon"
      :anchor-lat="anchorMap[win.anchor].lat"
      :title="win.title"
      :subtitle="win.subtitle"
      :metrics="win.metrics || []"
      :turn-flow="win.turnFlow || null"
      :flow-dir="win.flowDir"
      :source="win.source"
      :visible="windowsVisible"
      :visible-metric-count="visibleMetricCount"
      :offset-x="win.offsetX"
      :offset-y="win.offsetY"
      @reveal-done="() => {}"
    />

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
  top: 96px;
  left: 24px;
  width: 240px;
}

.map-anchor {
  position: absolute;
  left: 50%;
  top: 88px;
  transform: translateX(-50%);
  z-index: 38;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  background: rgba(4, 14, 26, 0.88);
  border: 1px solid rgba(0, 212, 240, 0.45);
  pointer-events: none;
}

.ma-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #00d4f0;
  box-shadow: 0 0 8px rgba(0, 212, 240, 0.6);
}

.ma-text {
  font-size: 11px;
  letter-spacing: 1px;
  color: #00d4f0;
  font-family: 'Courier New', monospace;
}

.ma-name {
  font-size: 11px;
  color: rgba(220, 240, 255, 0.78);
}

.dock-fade-enter-active,
.dock-fade-leave-active,
.anchor-fade-enter-active,
.anchor-fade-leave-active {
  transition: opacity 0.45s ease, transform 0.45s ease;
}

.dock-fade-enter-from,
.dock-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.anchor-fade-enter-from,
.anchor-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-6px);
}
</style>

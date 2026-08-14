<script setup>
/**
 * 幕 1 · 问题定位 — 合并舞台（原幕 1 诊断工单 + 幕 2 路网定位，无渠化）
 *
 * 流程：
 *   idle（输入卡）→ parsing（问题理解推理）
 *   → ticket_ready（工单左卡）
 *   → locating（地图飞入三路口走廊，走廊/流向箭头揭示）
 *   → 走廊揭示完成 → 空间对象卡 → 退出进入幕 2
 *
 * 与主工程地图运行时（TrafficOriginScene）的协作：
 *   act2Phase='locating' → 地图飞入 → 飞入完成回调 markChannelizationReady()
 *   → locateCorridorReady 信号 → 本舞台揭示空间对象卡
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import TicketSpatialCard from './TicketSpatialCard.vue';
import LocateReasoningPanel from './LocateReasoningPanel.vue';
import FlowInfoWindow from './FlowInfoWindow.vue';
import { createReadyGate, runExitBarrier } from '../../../shared/act-timing.js';
import { act1Phase, act2Phase } from '../../../shared/narrative-state.js';
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
// 左卡：工单落地后显示；走廊揭示后切换为空间对象模式
const leftVisible = computed(
  () => act1Phase.value === 'ticket_ready'
    || act2Phase.value === 'locating'
    || act2Phase.value === 'confirming'
    || act2Phase.value === 'handoff',
);
const leftMode = computed(
  () => (corridorRevealed.value ? 'spatial' : 'ticket'),
);

const rightVisible = computed(
  () => act1Phase.value === 'parsing'
    || act1Phase.value === 'ticket_ready'
    || act2Phase.value === 'locating'
    || act2Phase.value === 'confirming',
);

// 走廊揭示状态（诊断对象锚点在走廊揭示时出现）
const corridorRevealed = ref(false);

// 信息窗口：走廊揭示 600ms 后出现（对齐地图指标脉冲动效）
const windowsVisible = ref(false);

const showAnchor = computed(() => corridorRevealed.value);

// 锚点坐标映射
const anchorMap = {
  jiefang: INTERSECTIONS.jiefang,
  kunshun: INTERSECTIONS.kunshun,
  jingshi: INTERSECTIONS.jingshi,
};

// ── 退出栅栏 ───────────────────────────────────────────────────────
const leftGate = createReadyGate();     // 工单左卡揭示完成
const windowsGate = createReadyGate();  // 信息窗口揭示完成
const confirmGate = createReadyGate();  // 空间定位确认态
let exited = false;

// 定位推理与走廊揭示双就绪后，才切确认态（避免飞入未完成时
// 地图运行时释放镜头，导致 markChannelizationReady 永不触发）
let locateDone = false;
let corridorDone = false;

function maybeConfirm() {
  if (!locateDone || !corridorDone) return;
  completeLocateConfirm();
  confirmGate.signal();
}

function onParseDone() {
  completeTicket();
}

function onTicketRevealDone() {
  leftGate.signal();
}

function onLocateDone() {
  // 定位推理收束：与走廊揭示对齐后切确认态
  locateDone = true;
  maybeConfirm();
}

// 信息窗口：只展示核心问题路段（奥体西路·北向南）流量数据，
// 去掉其余路口的流量窗口（坤顺上游 / 经十路东西入口）
const allWindows = [
  ...FLOW_INFO_WINDOWS.filter((w) => w.core).map((w) => ({
    ...w,
    offsetX: w.anchor === 'jingshi' ? -15 : -13,
    offsetY: -18,
  })),
];

function onWindowRevealDone(index) {
  // 所有窗口都揭示后放行
  if (index === allWindows.length - 1) {
    windowsGate.signal();
  }
}

function runExitFlow() {
  if (exited) return;
  exited = true;
  runExitBarrier({
    later,
    barriers: [leftGate.current, windowsGate.current, confirmGate.current],
    // 等本幕讲解语音播完再跳转幕 2（讲解约 23s，比舞台演绎长，需对齐后再切）
    waitBroadcast: true,
    onExit: () => {
      const nextState = exitProblemLocate({ nextAct: 2 });
      emit('exit', nextState);
    },
  });
}

onMounted(async () => {
  enterProblemLocate();

  // 删除手动输入入口：进入后自动开始问题理解
  later(() => beginParse(), 120);

  // 工单左卡揭示完成 → 进入空间定位
  leftGate.current.then(() => {
    later(() => beginLocate(), 350);
  });

  // 走廊揭示完成 → 信息窗口 + 空间对象卡 + 退出栅栏
  locateCorridorReady.once(() => {
    corridorDone = true;
    corridorRevealed.value = true;
    later(() => {
      windowsVisible.value = true;
    }, 600);
    later(() => runExitFlow(), 2600);
    maybeConfirm();
  });
  // 无信息窗口时直接放行窗口守门员（当前至少保留 1 个核心窗口，此分支兜底）
  if (allWindows.length === 0) {
    windowsGate.signal();
  }
});

onUnmounted(() => {
  clearTimers();
});
</script>

<template>
  <div class="problem-locate-stage">
    <!-- 左侧：工单 / 空间对象结果卡 -->
    <transition name="dock-fade">
      <aside v-if="leftVisible" class="act-dock act-dock-left">
        <TicketSpatialCard
          :key="leftMode"
          :mode="leftMode"
          @reveal-done="onTicketRevealDone"
        />
      </aside>
    </transition>

    <!-- 右侧：两阶段推理过程 -->
    <transition name="dock-fade">
      <aside v-if="rightVisible" class="act-dock act-dock-right">
        <LocateReasoningPanel
          @parse-done="onParseDone"
          @locate-done="onLocateDone"
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

    <!-- 核心问题路段流量信息窗口（奥体西路·北向南） -->
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
      :offset-x="win.offsetX"
      :offset-y="win.offsetY"
      @reveal-done="onWindowRevealDone(i)"
    />
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
  top: 96px;
  z-index: 37;
  pointer-events: auto;
  padding: 0;
  height: auto;
  max-height: calc(100vh - 96px - 72px);
  overflow-x: hidden;
  overflow-y: auto;
}

.act-dock-left {
  left: 24px;
  width: 300px;
}

.act-dock-right {
  right: 24px;
  width: 360px;
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

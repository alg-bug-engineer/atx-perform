<script setup>
/**
 * 幕 2 · 流量溯源（成因分析）— 原生舞台
 *
 * 地图演绎由 TrafficOriginScene 中的 flowTraceFx（本幕模块注册的地图特效
 * 工厂）直接播放，HUD 状态经 flowTraceHud 桥接到这里渲染；
 * 演绎完成（overflow）后自动交棒退出，彻底去掉切回首页的跳转与重载。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { whenBroadcastIdle } from '../../../shared/broadcast-bus.js';
import { flowTracePhase } from '../../../shared/narrative-state.js';
import {
  enterFlowTrace,
  exitFlowTrace,
  flowTraceHud,
  requestFlowTraceReplay,
} from './state.js';

const props = defineProps({ prevState: { type: Object, default: null } });
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

// ── HUD：溯源卡可被后续拍替换；供需 / 本口 / 绿灯 / 溢流按拍叠上不撤 ──
const dockStack = ref([]);

function applyDockPanel(state) {
  const phase = state?.phase;
  const panel = state?.panel;
  if (phase === 'trace' || phase === 'boot' || phase === 'error') {
    dockStack.value = panel ? [panel] : [];
    return;
  }
  if (phase === 'ew_clear') {
    dockStack.value = dockStack.value.filter((p) => p.kind !== 'trace');
    return;
  }
  if (!panel?.kind) return;
  const hideSupplyChain = panel.kind === 'arterial' || panel.kind === 'signal' || panel.kind === 'overflow';
  const rest = dockStack.value.filter((p) => {
    if (p.kind === 'trace' || p.kind === panel.kind) return false;
    if (hideSupplyChain && (p.kind === 'supply' || p.kind === 'downstream')) return false;
    return true;
  });
  dockStack.value = [...rest, panel];
}

watch(flowTraceHud, (state) => applyDockPanel(state), { deep: true, immediate: true });

const isDone = computed(() => flowTracePhase.value === 'done');

const headline = computed(() => {
  const phase = flowTraceHud.value.phase;
  if (!phase || phase === 'error' || phase === 'boot') return '';
  return flowTraceHud.value.headline || '';
});

function formatMetric(v, digits = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function onReplay() {
  dockStack.value = [];
  requestFlowTraceReplay();
}

// 演绎完成（溢流揭示）→ 收束交棒进入下一幕（未注册则停留提示）
watch(isDone, (v) => {
  if (!v) return;
  whenBroadcastIdle({ later, safetyMs: 28_000 }).then(() => {
    later(() => {
      emit('exit', exitFlowTrace({ nextAct: 3 }));
    }, 600);
  });
});

onMounted(() => {
  enterFlowTrace(props.prevState);
});

onUnmounted(() => {
  clearTimers();
});
</script>

<template>
  <div class="flow-trace-stage">
    <!-- 左侧结论卡只保留关键结论；详细数字优先落在地图钉上 -->
    <aside v-if="dockStack.length" class="trace-dock">
      <div v-for="item in dockStack" :key="item.kind" class="dock-card">
        <div class="dock-title">{{ item.title }}</div>

        <p v-if="item.kind === 'trace'" class="dock-lead">正在追溯上游来流</p>

        <template v-else-if="item.kind === 'supply'">
          <div class="dock-row">
            <span>当前通行流量</span>
            <strong>{{ item.supply }} vph</strong>
          </div>
          <div class="dock-row">
            <span>车道能力上限</span>
            <strong>{{ item.demand }} vph</strong>
          </div>
          <div class="dock-ok">{{ item.conclusion }}</div>
        </template>

        <template v-else-if="item.kind === 'downstream'">
          <div class="dock-hero">{{ formatMetric(item.ratio, 2) }}%</div>
          <div class="dock-lab">主要关联去向 · 下游关联占比</div>
          <p class="dock-copy">{{ item.destination }}</p>
          <div class="dock-ok">{{ item.conclusion }}</div>
        </template>

        <template v-else-if="item.kind === 'arterial'">
          <p v-if="item.copy" class="dock-copy">{{ item.copy }}</p>
        </template>

        <template v-else-if="item.kind === 'signal'">
          <div class="dock-hero">{{ item.value }}</div>
          <p v-if="item.copy" class="dock-copy">{{ item.copy }}</p>
        </template>

        <template v-else-if="item.kind === 'overflow'">
          <div class="dock-hero warn">{{ item.queue_m }} m</div>
          <div class="dock-lab">排队长度 · 排队比 {{ formatMetric(item.queue_ratio, 1) }}</div>
          <p v-if="item.copy" class="dock-copy">{{ item.copy }}</p>
        </template>
      </div>
    </aside>

    <transition name="headline-fade" mode="out-in">
      <p v-if="headline" :key="headline" class="beat-headline">{{ headline }}</p>
    </transition>

    <!-- 操作：重播溯源 -->
    <div class="trace-actions">
      <button type="button" class="action-btn" @click="onReplay">
        重播溯源
      </button>
    </div>
  </div>
</template>

<style scoped>
.flow-trace-stage {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 36;
  font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

.trace-dock {
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
  color: rgba(0, 229, 255, 0.9);
  margin-bottom: 8px;
}

.dock-lead {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(230, 240, 250, 0.92);
}

.dock-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 14px;
  color: rgba(0, 229, 255, 0.72);
  padding: 3px 0;
}

.dock-row strong {
  color: #e8f6ff;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.dock-ok {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(0, 229, 255, 0.22);
  color: #86efac;
  font-size: 13px;
  letter-spacing: 0.4px;
}

.dock-copy {
  margin: 8px 0 0;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  font-size: 12px;
  line-height: 1.55;
  color: rgba(220, 230, 240, 0.92);
}

.dock-lab {
  font-size: 10px;
  color: rgba(160, 180, 200, 0.75);
  margin-top: 2px;
}

.dock-hero {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #86efac;
}

.dock-hero.warn {
  color: #ff8a3a;
}

.beat-headline {
  position: absolute;
  left: 50%;
  bottom: 48px;
  transform: translateX(-50%);
  z-index: 42;
  margin: 0;
  padding: 10px 28px;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 3px;
  line-height: 1.35;
  color: #00e5ff;
  text-shadow:
    0 0 14px rgba(0, 229, 255, 0.85),
    0 0 28px rgba(0, 229, 255, 0.35);
  background: rgba(4, 12, 30, 0.82);
  border: 1px solid rgba(0, 229, 255, 0.4);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(8px);
  white-space: nowrap;
  pointer-events: none;
}

.headline-fade-enter-active,
.headline-fade-leave-active {
  transition: opacity 0.28s ease, transform 0.28s ease;
}
.headline-fade-enter-from,
.headline-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

.trace-actions {
  position: absolute;
  right: 20px;
  bottom: 28px;
  z-index: 40;
  display: flex;
  gap: 10px;
}

.action-btn {
  border: 1px solid rgba(0, 229, 255, 0.35);
  background: rgba(0, 20, 30, 0.72);
  color: #00e5ff;
  font-family: 'Courier New', monospace;
  font-size: 11px;
  letter-spacing: 2px;
  padding: 6px 12px;
  cursor: pointer;
  pointer-events: auto;
}

.action-btn:hover {
  background: rgba(0, 229, 255, 0.14);
  box-shadow: 0 0 12px rgba(0, 229, 255, 0.22);
}

</style>

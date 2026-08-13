<script setup>
/**
 * 幕 2 · 流量溯源（成因分析）— 原生舞台
 *
 * 地图演绎由 TrafficOriginScene 中的 flowTraceFx（本幕模块注册的地图特效
 * 工厂）直接播放，HUD 状态经 flowTraceHud 桥接到这里渲染；
 * 演绎完成（overflow）后自动交棒退出，彻底去掉切回首页的跳转与重载。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
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
  const rest = dockStack.value.filter((p) => p.kind !== 'trace' && p.kind !== panel.kind);
  dockStack.value = [...rest, panel];
}

watch(flowTraceHud, (state) => applyDockPanel(state), { deep: true, immediate: true });

const caption = computed(() => flowTraceHud.value.caption || flowTraceHud.value.text || '');
const isDone = computed(() => flowTracePhase.value === 'done');

function formatSat(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(2);
}

function isSatCrit(v) {
  return Number(v) >= 0.85;
}

function onReplay() {
  dockStack.value = [];
  requestFlowTraceReplay();
}

// 演绎完成（溢流揭示）→ 收束交棒进入下一幕（未注册则停留提示）
watch(isDone, (v) => {
  if (!v) return;
  later(() => {
    emit('exit', exitFlowTrace({ nextAct: 3 }));
  }, 2000);
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
    <!-- 左侧演绎结论卡（溯源 → 供需 → 本口 → 绿灯约束 → 溢流） -->
    <aside v-if="dockStack.length" class="trace-dock">
      <div v-for="item in dockStack" :key="item.kind" class="dock-card">
        <div class="dock-title">{{ item.title }}</div>

        <p v-if="item.kind === 'trace'" class="dock-lead">正在进行问题路段流量溯源</p>

        <template v-else-if="item.kind === 'supply'">
          <div class="dock-row">
            <span>供给流量</span>
            <strong>{{ item.supply }} vph</strong>
          </div>
          <div class="dock-row">
            <span>需求流量</span>
            <strong>{{ item.demand }} vph</strong>
          </div>
          <div class="dock-ok">{{ item.conclusion }}</div>
        </template>

        <template v-else-if="item.kind === 'arterial'">
          <div v-for="arm in item.approaches" :key="arm.role" class="dock-arm">
            <div class="dock-arm-h">
              <span class="dock-role">{{ arm.name ? `${arm.name} ${arm.role}` : arm.role }}</span>
            </div>
            <div class="dock-metrics">
              <div>
                <div class="dock-num" :class="{ crit: isSatCrit(arm.saturation) }">
                  {{ formatSat(arm.saturation) }}
                </div>
                <div class="dock-lab">饱和度</div>
              </div>
              <div>
                <div class="dock-num">{{ arm.flow_vph }}</div>
                <div class="dock-lab">直行流量 vph</div>
              </div>
            </div>
          </div>
          <p v-if="item.copy" class="dock-copy">{{ item.copy }}</p>
        </template>

        <template v-else-if="item.kind === 'signal'">
          <div class="dock-hero">{{ item.value }}</div>
          <p v-if="item.copy" class="dock-copy">{{ item.copy }}</p>
        </template>

        <template v-else-if="item.kind === 'overflow'">
          <div class="dock-hero warn">{{ item.queue_m }} m</div>
          <div class="dock-lab">排队长度 · {{ item.note }}</div>
          <p v-if="item.copy" class="dock-copy">{{ item.copy }}</p>
        </template>
      </div>
    </aside>

    <!-- 底部演绎说明条 -->
    <div v-if="caption && !isDone" class="trace-caption">
      <span class="scan-dot" />
      <span class="hint-text">{{ caption }}</span>
    </div>

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
  top: 92px;
  z-index: 38;
  width: min(280px, calc(100vw - 48px));
  max-height: calc(100% - 160px);
  overflow-y: auto;
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

.dock-arm + .dock-arm {
  margin-top: 8px;
}

.dock-arm-h {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}

.dock-role {
  font-size: 11px;
  color: rgba(255, 180, 100, 0.9);
}

.dock-metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.dock-num {
  font-size: 18px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: rgba(230, 240, 250, 0.95);
  line-height: 1.2;
}

.dock-num.crit {
  color: #fb7185;
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

.trace-caption {
  position: absolute;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 37;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  max-width: min(560px, calc(100vw - 280px));
  padding: 8px 16px;
  font-size: 14px;
  letter-spacing: 1px;
  line-height: 1.5;
  color: rgba(232, 246, 255, 0.95);
  background: rgba(4, 14, 26, 0.78);
  border: 1px solid rgba(0, 229, 255, 0.35);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(8px);
}

.scan-dot {
  width: 7px;
  height: 7px;
  margin-top: 4px;
  flex-shrink: 0;
  border-radius: 50%;
  background: #f5a623;
  box-shadow: 0 0 8px rgba(245, 166, 35, 0.8);
  animation: pulse 1s ease-in-out infinite;
}

.hint-text {
  flex: 1;
  min-width: 0;
  white-space: normal;
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

@keyframes pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.85);
  }
  50% {
    opacity: 1;
    transform: scale(1.15);
  }
}
</style>

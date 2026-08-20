<script setup>
/**
 * 幕 2 · 流量溯源（成因分析）— 原生舞台
 *
 * 地图演绎由 TrafficOriginScene 中的 flowTraceFx（本幕模块注册的地图特效
 * 工厂）直接播放，HUD 状态经 flowTraceHud 桥接到这里渲染；
 * 演绎完成（信号协调）后自动交棒退出，彻底去掉切回首页的跳转与重载。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { loadJson } from '../../../services/loadSceneData.js';
import { whenBroadcastIdle } from '../../../shared/broadcast-bus.js';
import { flowTracePhase } from '../../../shared/narrative-state.js';
import OverflowDiagnosisRail from './OverflowDiagnosisRail.vue';
import InflowShareSchema from './InflowShareSchema.vue';
import {
  buildRailStates,
  buildViaTurnInflowShares,
  getDiagnosisSteps,
  stepIdForPhase,
} from './diagnosisModel.js';
import {
  enterFlowTrace,
  exitFlowTrace,
  flowTraceHud,
  flowTraceSchemaAnchor,
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
const signalReviewPanel = ref(null);

function applyDockPanel(state) {
  const phase = state?.phase;
  const panel = state?.panel;
  if (panel?.kind === 'signal') signalReviewPanel.value = { ...panel };
  if (phase === 'trace' || phase === 'inflow' || phase === 'boot' || phase === 'error') {
    dockStack.value = panel ? [panel] : [];
    return;
  }
  if (phase === 'ew_clear') {
    dockStack.value = dockStack.value.filter((p) => p.kind !== 'trace' && p.kind !== 'inflow');
    return;
  }
  if (!panel?.kind) return;
  const hideSupplyChain = panel.kind === 'arterial' || panel.kind === 'signal';
  const rest = dockStack.value.filter((p) => {
    if (p.kind === 'trace' || p.kind === 'inflow' || p.kind === panel.kind) return false;
    if (hideSupplyChain && (p.kind === 'supply' || p.kind === 'downstream')) return false;
    return true;
  });
  dockStack.value = [...rest, panel];
}

watch(flowTraceHud, (state) => applyDockPanel(state), { deep: true, immediate: true });

const diagnosisSteps = ref(getDiagnosisSteps());
const viaInflow = ref(null);
const reviewStepId = ref('');

const railSteps = computed(() => buildRailStates(flowTraceHud.value.phase, diagnosisSteps.value));
const autoStepId = computed(() => stepIdForPhase(flowTraceHud.value.phase, diagnosisSteps.value));
const evidenceStepId = computed(() => reviewStepId.value || autoStepId.value);
const isReviewing = computed(() => Boolean(reviewStepId.value) && reviewStepId.value !== autoStepId.value);
const showInflowSchema = computed(() => {
  if (!viaInflow.value) return false;
  if (reviewStepId.value === 'upstream') return true;
  return flowTraceHud.value.phase === 'inflow';
});
const schemaAnchorStyle = computed(() => {
  const a = flowTraceSchemaAnchor.value;
  if (!a) return null;
  return {
    left: `${a.left}px`,
    top: `${a.top}px`,
    right: 'auto',
    bottom: 'auto',
  };
});
const reviewedStep = computed(() => railSteps.value.find((step) => step.id === reviewStepId.value) || null);
const reviewedPanel = computed(() => (
  reviewStepId.value === 'signal' ? signalReviewPanel.value : null
));
const autoCards = computed(() => {
  if (reviewStepId.value) return [];
  return dockStack.value.filter((item) => item.kind !== 'trace' && item.kind !== 'inflow');
});

function onSelectStep(step) {
  if (!step?.clickable) return;
  reviewStepId.value = reviewStepId.value === step.id ? '' : step.id;
}

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
  signalReviewPanel.value = null;
  reviewStepId.value = '';
  requestFlowTraceReplay();
}

// 演绎完成（信号协调）→ 收束交棒进入下一幕（未注册则停留提示）
watch(isDone, (v) => {
  if (!v) return;
  whenBroadcastIdle({ later, safetyMs: 28_000 }).then(() => {
    later(() => {
      emit('exit', exitFlowTrace({ nextAct: 3 }));
    }, 4200);
  });
});

onMounted(() => {
  enterFlowTrace(props.prevState);
  Promise.all([loadJson('cause'), loadJson('flowTrace')])
    .then(([cause, flowTrace]) => {
      diagnosisSteps.value = getDiagnosisSteps(cause);
      viaInflow.value = buildViaTurnInflowShares(cause, flowTrace?.via?.id);
    })
    .catch(() => {
      viaInflow.value = null;
    });
});

onUnmounted(() => {
  clearTimers();
});
</script>

<template>
  <div class="flow-trace-stage">
    <aside class="diagnosis-dock">
      <OverflowDiagnosisRail
        :steps="railSteps"
        :selected-id="evidenceStepId || ''"
        :reviewing="isReviewing"
        @select="onSelectStep"
      />

      <div v-if="isReviewing && reviewedStep && !showInflowSchema" class="dock-card">
        <div class="dock-title">{{ reviewedStep.label }}</div>
        <template v-if="reviewedPanel?.kind === 'signal'">
          <div class="dock-hero warn">{{ reviewedPanel.value }}</div>
          <div class="dock-row">
            <span>共同周期</span>
            <strong>{{ reviewedPanel.common_cycle_sec }} s</strong>
          </div>
          <div class="dock-row">
            <span>{{ reviewedPanel.mismatch_label || '绿灯错配' }}</span>
            <strong>{{ reviewedPanel.mismatch_sec }} s</strong>
          </div>
          <div class="dock-row">
            <span>{{ reviewedPanel.queue_label || '排队长度' }}</span>
            <strong>{{ reviewedPanel.queue_m }} m</strong>
          </div>
          <p v-if="reviewedPanel.copy" class="dock-copy">{{ reviewedPanel.copy }}</p>
        </template>
        <p v-else class="dock-copy">本步骤证据将在后续模块给出。自动演示未中断。</p>
      </div>

      <template v-else-if="!isReviewing">
        <div v-for="item in autoCards" :key="item.kind" class="dock-card">
          <div class="dock-title">{{ item.title }}</div>

        <p v-if="item.kind === 'trace'" class="dock-lead">正在追溯上游来流</p>

        <template v-else-if="item.kind === 'supply'">
          <div class="dock-row">
            <span>当前通行流量</span>
            <strong>{{ item.supply }} pcu/h</strong>
          </div>
          <div class="dock-row">
            <span>进口道路能力</span>
            <strong>{{ item.demand }} pcu/h</strong>
          </div>
          <div class="dock-ok">{{ item.conclusion }}</div>
        </template>

        <template v-else-if="item.kind === 'downstream'">
          <div class="dock-row">
            <span>主要去向</span>
            <strong class="primary">{{ formatMetric(item.ratio, 2) }}%</strong>
          </div>
          <p class="dock-copy dock-copy-tight">{{ item.destination }}</p>
          <div v-if="item.speed != null" class="dock-row">
            <span>路段速度</span>
            <strong>{{ formatMetric(item.speed, 1) }} km/h</strong>
          </div>
          <div v-if="item.delay != null" class="dock-row">
            <span>拥堵延时指数</span>
            <strong>{{ formatMetric(item.delay, 2) }}</strong>
          </div>
          <div v-if="item.queue_ratio != null" class="dock-row">
            <span>排队占比</span>
            <strong>{{ formatMetric(item.queue_ratio * 100, 1) }}%</strong>
          </div>
          <div v-if="item.contrast_speed != null" class="dock-lab">
            问题路段 {{ formatMetric(item.contrast_speed, 1) }} km/h · 峰值排队 {{ item.queue_m }} / {{ item.storage_m }} m
          </div>
          <div class="dock-ok">{{ item.conclusion }}</div>
        </template>

        <template v-else-if="item.kind === 'arterial'">
          <p v-if="item.copy" class="dock-copy">{{ item.copy }}</p>
        </template>

        <template v-else-if="item.kind === 'signal'">
          <div class="dock-hero warn">{{ item.value }}</div>
          <div class="dock-row">
            <span>共同周期</span>
            <strong>{{ item.common_cycle_sec }} s</strong>
          </div>
          <div class="dock-row">
            <span>{{ item.mismatch_label || '绿灯错配' }}</span>
            <strong>{{ item.mismatch_sec }} s</strong>
          </div>
          <div class="dock-row">
            <span>{{ item.queue_label || '排队长度' }}</span>
            <strong>{{ item.queue_m }} m</strong>
          </div>
          <p v-if="item.copy" class="dock-copy">{{ item.copy }}</p>
        </template>
        </div>
      </template>
    </aside>

    <div v-if="showInflowSchema" class="inflow-schema-anchor" :class="{ pinned: Boolean(schemaAnchorStyle) }" :style="schemaAnchorStyle || undefined">
      <InflowShareSchema :ranking="viaInflow" />
    </div>

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

.diagnosis-dock {
  position: absolute;
  left: 24px;
  top: 12px;
  z-index: 39;
  width: min(520px, calc(100vw - 48px));
  max-height: calc(100% - 160px);
  overflow-y: auto;
  overscroll-behavior: contain;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.inflow-schema-anchor {
  position: absolute;
  z-index: 40;
  pointer-events: auto;
  left: 56%;
  top: 52%;
}

.inflow-schema-anchor.pinned {
  transform: none;
}

.dock-card {
  width: min(280px, 100%);
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
  color: var(--text-muted);
  padding: 3px 0;
}

.dock-row strong {
  color: #e8f6ff;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.dock-row strong.primary {
  color: #00e5ff;
}

.dock-ok {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(240, 246, 255, 0.2);
  color: var(--text);
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

.dock-copy-tight {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
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
  color: var(--text);
}

.dock-hero.warn {
  color: #ff8a3a;
  font-size: 18px;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.beat-headline {
  position: absolute;
  left: 50%;
  bottom: 48px;
  transform: translateX(-50%);
  z-index: 42;
  margin: 0;
  padding: 10px 28px;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 1px;
  line-height: 1.35;
  color: #f0fbff;
  text-shadow: none;
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
  color: var(--text);
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

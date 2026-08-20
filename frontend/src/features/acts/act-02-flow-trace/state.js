/**
 * 幕 2 · 流量溯源（成因分析）— 状态机
 *
 * 阶段：idle → tracing → done → handoff
 *
 * 地图节拍（flowTraceMapBeat，供地图运行时消费）：
 *   null | 'trace' | 'inflow' | 'supply' | 'downstream' | 'arterial' | 'signal' | 'clear'
 *   - 'trace'     地图播放上游→汇点流量溯源动画（诊断步骤 1 上游来向）
 *   - 'inflow'    解放东三向汇入示意图（北直 70% / 东左 25% / 西右 5%，MOCK）
 *   - 'supply'    供需分析（上游需求流量）
 *   - 'downstream' 下游关联去向（flow_share_ratio；诊断步骤 2）
 *   - 'arterial'  本口（经十路东西向进口流量；诊断步骤 3）
 *   - 'signal'    绿灯错配与可协调判定（诊断步骤 5）
 */
import { ref } from 'vue';
import {
  flowTraceMapBeat,
  flowTracePhase,
  flowTraceReplaySeq,
  narrativeState,
  setAct,
  setBeat,
  setFlowTraceMapBeat,
  setLayerFlags,
  taskBarLabel,
  taskBarVisible,
} from '../../../shared/narrative-state.js';

/** 幕 2 地图节拍 → 口播 beat（跟随演绎 phase 播报） */
const VOICE_BEAT_BY_PHASE = {
  trace: 'a2f.trace',
  supply: 'a2f.supply',
  downstream: 'a2f.downstream',
  arterial: 'a2f.arterial',
  signal: 'a2f.signal',
};

const TASK_LABEL_BY_PHASE = {
  trace: '执行中：上游流量溯源',
  inflow: '执行中：汇入构成',
  supply: '执行中：路段供需核验',
  downstream: '执行中：下游关联去向',
  arterial: '执行中：经十路主干道研判',
  signal: '执行中：绿灯约束研判',
};

/**
 * 幕 2 HUD 状态（地图特效工厂 emitHud 输出 → 舞台组件渲染）
 * @type {import('vue').Ref<{ phase: string, caption: string, text: string, headline: string, panel: object|null }>}
 */
export const flowTraceHud = ref({ phase: '', caption: '', text: '', headline: '', panel: null });

/** 解放东路口示意图的屏幕锚点（地图投影，单位 px） */
export const flowTraceSchemaAnchor = ref(null);

export function setFlowTraceSchemaAnchor(anchor) {
  const next = anchor && Number.isFinite(anchor.left) && Number.isFinite(anchor.top)
    ? { left: Math.round(anchor.left), top: Math.round(anchor.top) }
    : null;
  const prev = flowTraceSchemaAnchor.value;
  if (prev?.left === next?.left && prev?.top === next?.top && Boolean(prev) === Boolean(next)) return;
  flowTraceSchemaAnchor.value = next;
}

/** 写入 HUD 状态；phase 变化时同步口播 beat */
export function setFlowTraceHud(state) {
  flowTraceHud.value = { ...flowTraceHud.value, ...state };
  if (VOICE_BEAT_BY_PHASE[state?.phase]) setFlowTraceMapBeat(state.phase);
  if (TASK_LABEL_BY_PHASE[state?.phase]) taskBarLabel.value = TASK_LABEL_BY_PHASE[state.phase];
  const beat = VOICE_BEAT_BY_PHASE[state?.phase];
  if (beat) setBeat(beat);
}

export function resetFlowTraceHud() {
  flowTraceHud.value = { phase: '', caption: '', text: '', headline: '', panel: null };
  flowTraceSchemaAnchor.value = null;
}

export function requestFlowTraceReplay() {
  flowTracePhase.value = 'tracing';
  taskBarLabel.value = '执行中：流量溯源';
  resetFlowTraceHud();
  flowTraceReplaySeq.value += 1;
}

export const FLOW_TRACE_ACT_ID = 2;
export const FLOW_TRACE_ACT_KEY = 'flow-trace';
export const FLOW_TRACE_ACT_NAME = '流量溯源';

/**
 * 幕内就绪信号（Stage 订阅）：
 * revealed —— 地图流量溯源动画完成（markFlowTraceRevealed 触发）
 */
export const flowTraceRevealed = {
  _ready: false,
  _listeners: new Set(),
  get ready() {
    return this._ready;
  },
  set ready(v) {
    this._ready = v;
    if (v) this._listeners.forEach((fn) => fn());
  },
  reset() {
    this._ready = false;
  },
  once(fn) {
    if (this._ready) {
      fn();
      return;
    }
    this._listeners.add(fn);
  },
  clear() {
    this._listeners.clear();
  },
};

/** 进入幕 2（流量溯源 / 成因分析） */
export function enterFlowTrace(prevState = null) {
  setAct(FLOW_TRACE_ACT_ID);
  setBeat('a2f.trace');
  flowTracePhase.value = 'tracing';
  flowTraceMapBeat.value = null;
  taskBarVisible.value = true;
  taskBarLabel.value = '执行中：流量溯源';
  // 隐去渠化，只看上游→汇点流量溯源
  setLayerFlags({
    channelization: false,
    mainPath: false,
    upstreamNodes: true,
    downstreamNodes: false,
    focusTrace: true,
    congestionSpread: false,
  });

  if (prevState?.ticket) narrativeState.ticket = prevState.ticket;
  if (prevState?.spatial) narrativeState.spatial = prevState.spatial;
  if (prevState?.camera) narrativeState.camera = { ...prevState.camera };

  flowTraceRevealed.reset();
  flowTraceRevealed.clear();
  resetFlowTraceHud();
  // 原生幕：直接在地图运行时触发流量溯源演绎（TrafficOriginScene watch 消费）
  setFlowTraceMapBeat('trace');

  return {
    act: FLOW_TRACE_ACT_ID,
    beatId: 'a2f.trace',
    ticket: narrativeState.ticket,
    spatial: narrativeState.spatial,
    camera: narrativeState.camera,
    layers: { ...narrativeState.layers },
  };
}

/** 地图流量溯源动画完成（由地图运行时回调） */
export function markFlowTraceRevealed() {
  flowTraceRevealed.ready = true;
}

/** 溯源收束 */
export function completeFlowTrace() {
  setFlowTraceHud({ phase: 'done' });
  flowTracePhase.value = 'done';
  taskBarLabel.value = '流量溯源完成';
}

/** 退出幕 2 */
export function exitFlowTrace(nextHint = {}) {
  flowTracePhase.value = 'handoff';
  taskBarLabel.value = '流量溯源完成，准备进入下一幕';
  setBeat('a2f.done');

  return {
    act: FLOW_TRACE_ACT_ID,
    beatId: 'a2f.done',
    ticket: narrativeState.ticket,
    spatial: narrativeState.spatial,
    camera: narrativeState.camera,
    layers: { ...narrativeState.layers },
    nextAct: nextHint.nextAct ?? 3,
  };
}

export default {
  actId: FLOW_TRACE_ACT_ID,
  enter: enterFlowTrace,
  exit: exitFlowTrace,
  markFlowTraceRevealed,
  completeFlowTrace,
  requestFlowTraceReplay,
};

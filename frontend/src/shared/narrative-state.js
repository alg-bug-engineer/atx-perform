import { reactive, ref } from 'vue';

/**
 * 叙事状态契约（见 docs/act-design/README.md）
 * 各 act：enter(prev) → play(beats) → exit(next)
 */
export const narrativeActive = ref(false);

export const narrativeState = reactive({
  act: 1,
  beatId: 'a1.input',
  ticket: null,
  camera: null,
  layers: {
    channelization: false,
    mainPath: false,
    upstreamNodes: false,
    downstreamNodes: false,
    queueBoundary: false,
    focusTrace: false,
    congestionSpread: false,
    arterialTrace: false,
    controlScope: false,
    planPreview: false,
  },
  branch: {
    bottleneck_type: null,
    overflow_mechanism: null,
    arterial_coordination_needed: null,
  },
  revealedMetrics: [],
  /** Act2 空间对象摘要（exit 写入） */
  spatial: null,
  /** Act3 溢出核验摘要（exit 写入） */
  overflow: null,
  /** Act4 瓶颈分支摘要（exit 写入） */
  branchSummary: null,
  /** Act5 干线上游摘要（exit 写入） */
  arterial: null,
  /** Act6 成因 + 案例摘要（exit 写入） */
  cause: null,
  /** Act7 治理策略摘要（exit 写入） */
  strategy: null,
  /** Act8 可执行方案摘要（exit 写入） */
  plan: null,
});

/** Act1 UI 阶段：idle → parsing → ticket_ready → handoff */
export const act1Phase = ref('idle');

/**
 * Act1 地图搜索态节拍（方案 B）
 * null | 'scan' | 'object' | 'intersection' | 'time' | 'direction' | 'problem' | 'constraint' | 'settle'
 */
export const act1MapBeat = ref(null);

/**
 * Act2 UI 阶段：idle → locating → confirming → handoff
 */
export const act2Phase = ref('idle');

/**
 * Act2 地图节拍
 * null | 'fly_in' | 'channelization' | 'arms' | 'topology' | 'path' | 'settle' | 'clear'
 */
export const act2MapBeat = ref(null);

/**
 * Act3 UI 阶段：idle → verifying → confirmed → handoff
 */
export const act3Phase = ref('idle');

/**
 * Act3 地图节拍
 * null | 'push_in' | 'storage' | 'queue' | 'ratio' | 'verdict' | 'settle' | 'clear'
 */
export const act3MapBeat = ref(null);

/**
 * Act4 UI 阶段：idle → tracing → branched → handoff
 */
export const act4Phase = ref('idle');

/**
 * Act4 地图节拍
 * null | 'trace_on' | 'spread' | 'compare' | 'branch' | 'small_step_ok' | 'settle' | 'clear'
 */
export const act4MapBeat = ref(null);

/**
 * Act5 UI 阶段：idle → expanding → settled → handoff
 */
export const act5Phase = ref('idle');

/**
 * Act5 地图节拍
 * null | 'spread_on' | 'north_expand' | 'no_metering' | 'dim' | 'settle' | 'clear'
 */
export const act5MapBeat = ref(null);

/**
 * Act6 UI 阶段：idle → ranking → settled → handoff
 */
export const act6Phase = ref('idle');

/**
 * Act6 地图节拍
 * null | 'rank' | 'primary_pin' | 'secondary' | 'gaps' | 'cases' | 'settle' | 'clear'
 */
export const act6MapBeat = ref(null);

/**
 * Act7 UI 阶段：idle → scoping → settled → handoff
 */
export const act7Phase = ref('idle');

/**
 * Act7 地图节拍
 * null | 'scope' | 'principles' | 'recommend' | 'reject' | 'settle' | 'clear'
 */
export const act7MapBeat = ref(null);

/**
 * Act8 UI 阶段：idle → planning → settled → handoff
 */
export const act8Phase = ref('idle');

/**
 * Act8 地图节拍
 * null | 'candidates' | 'reject_paths' | 'recommend' | 'timing' | 'trial' | 'rollback' | 'settle' | 'clear'
 */
export const act8MapBeat = ref(null);

/**
 * Act2 流量溯源（成因分析）UI 阶段：idle → tracing → done
 */
export const flowTracePhase = ref('idle');

/**
 * Act2 流量溯源地图节拍
 * null | 'trace' | 'supply' | 'arterial' | 'signal'
 */
export const flowTraceMapBeat = ref(null);

export function setFlowTraceMapBeat(beat) {
  flowTraceMapBeat.value = beat;
}

/** 幕 2 流量溯源重播请求（递增信号，TrafficOriginScene watch 消费） */
export const flowTraceReplaySeq = ref(0);

/** 底部任务栏文案 */
export const taskBarLabel = ref('');

/** 任务栏是否可见（输入框沉底后） */
export const taskBarVisible = ref(false);

/** 返回主页时递增，驱动 TrafficOriginScene 清空地图图层与镜头 */
export const narrativeMapResetSeq = ref(0);

/** 地图节拍 → 叙事 beat_id（驱动口播）；null 只清地图节拍 */
function syncNarrativeBeat(act, beat) {
  if (beat == null || beat === '') return;
  setBeat(`a${act}.${beat}`);
}

export function setAct1MapBeat(beat) {
  act1MapBeat.value = beat;
  syncNarrativeBeat(1, beat);
}

export function setAct2MapBeat(beat) {
  act2MapBeat.value = beat;
  syncNarrativeBeat(2, beat);
}

export function setAct3MapBeat(beat) {
  act3MapBeat.value = beat;
  syncNarrativeBeat(3, beat);
}

export function setAct4MapBeat(beat) {
  act4MapBeat.value = beat;
  syncNarrativeBeat(4, beat);
}

export function setAct5MapBeat(beat) {
  act5MapBeat.value = beat;
  syncNarrativeBeat(5, beat);
}

export function setAct6MapBeat(beat) {
  act6MapBeat.value = beat;
  syncNarrativeBeat(6, beat);
}

export function setAct7MapBeat(beat) {
  act7MapBeat.value = beat;
  syncNarrativeBeat(7, beat);
}

/** Act8 分析阶段仅更新地图，口播延后至 act8PlanVoice 序列 */
const ACT8_MAP_ONLY_BEATS = new Set(['recommend', 'timing']);

export function setAct8MapBeat(beat) {
  act8MapBeat.value = beat;
  if (beat != null && beat !== '' && !ACT8_MAP_ONLY_BEATS.has(beat)) {
    syncNarrativeBeat(8, beat);
  }
}

export function setBeat(beatId) {
  // 同 id 不重复触发，避免 enter / mapBeat / complete 三重入队
  if (narrativeState.beatId === beatId) return;
  narrativeState.beatId = beatId;
}

export function setAct(act) {
  narrativeState.act = act;
}

export function writeTicket(ticket) {
  narrativeState.ticket = ticket;
}

export function writeSpatial(spatial) {
  narrativeState.spatial = spatial;
}

export function writeOverflow(overflow) {
  narrativeState.overflow = overflow;
}

export function writeBranch(branchSummary) {
  narrativeState.branchSummary = {
    ...(narrativeState.branchSummary || {}),
    ...branchSummary,
  };
  if (branchSummary?.overflow_mechanism) {
    narrativeState.branch.overflow_mechanism = branchSummary.overflow_mechanism;
  }
  if (branchSummary?.bottleneck_type) {
    narrativeState.branch.bottleneck_type = branchSummary.bottleneck_type;
  }
  if (branchSummary?.arterial_coordination_needed != null) {
    narrativeState.branch.arterial_coordination_needed =
      branchSummary.arterial_coordination_needed;
  }
}

export function writeArterial(arterial) {
  narrativeState.arterial = arterial;
  if (arterial?.arterial_coordination_needed != null) {
    narrativeState.branch.arterial_coordination_needed =
      arterial.arterial_coordination_needed;
  }
}

export function writeCause(cause) {
  narrativeState.cause = cause;
  if (cause?.mechanism) {
    narrativeState.branch.overflow_mechanism = cause.mechanism;
  }
}

export function writeStrategy(strategy) {
  narrativeState.strategy = strategy;
}

export function writePlan(plan) {
  narrativeState.plan = plan;
}

export function setLayerFlags(partial) {
  Object.assign(narrativeState.layers, partial);
}

export function captureCamera(camera) {
  if (!camera?.position || !camera?.target) return;
  narrativeState.camera = {
    position: { ...camera.position },
    target: { ...camera.target },
    lerp: camera.lerp ?? 0.02,
  };
}

export function exitAct1ToHandoff() {
  setBeat('a1.ticket_ready');
  act1Phase.value = 'handoff';
  taskBarLabel.value = '执行中：路网定位';
  // 真正切 Act2 由 ActLoopShell 在 exit 后调用 enterAct2
}

const INITIAL_LAYERS = {
  channelization: false,
  mainPath: false,
  upstreamNodes: false,
  downstreamNodes: false,
  queueBoundary: false,
  focusTrace: false,
  congestionSpread: false,
  arterialTrace: false,
  controlScope: false,
  planPreview: false,
};

/**
 * 返回主页：重置叙事至 Act1 输入态（对齐参考项目 reset(toInput)）
 */
export function resetNarrativeToHome() {
  // 清空口播去重表，避免下次叙事同一 beat 被跳过（动态 import 避免循环依赖）
  import('./act-voice.js').then((m) => m.resetVoiceSpokenKeys()).catch(() => {});

  narrativeState.act = 1;
  narrativeState.beatId = 'a1.input';
  narrativeState.ticket = null;
  narrativeState.camera = null;
  narrativeState.layers = { ...INITIAL_LAYERS };
  narrativeState.branch = {
    bottleneck_type: null,
    overflow_mechanism: null,
    arterial_coordination_needed: null,
  };
  narrativeState.revealedMetrics = [];
  narrativeState.spatial = null;
  narrativeState.overflow = null;
  narrativeState.branchSummary = null;
  narrativeState.arterial = null;
  narrativeState.cause = null;
  narrativeState.strategy = null;
  narrativeState.plan = null;

  act1Phase.value = 'idle';
  act2Phase.value = 'idle';
  act3Phase.value = 'idle';
  act4Phase.value = 'idle';
  act5Phase.value = 'idle';
  act6Phase.value = 'idle';
  act7Phase.value = 'idle';
  act8Phase.value = 'idle';
  flowTracePhase.value = 'idle';

  act1MapBeat.value = null;
  act2MapBeat.value = null;
  act3MapBeat.value = null;
  act4MapBeat.value = null;
  act5MapBeat.value = null;
  act6MapBeat.value = null;
  act7MapBeat.value = null;
  act8MapBeat.value = null;
  flowTraceMapBeat.value = null;

  taskBarVisible.value = false;
  taskBarLabel.value = '';

  narrativeMapResetSeq.value += 1;
}

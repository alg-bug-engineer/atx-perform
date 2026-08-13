/**
 * 叙事幕次口播：beat_id → 模板+词槽 → broadcast-bus → DigitalAvatar/TTS
 *
 * 结论类文案一律来自运行时切片，禁止写死「问题成立 / 不宜激进大加绿 / 小步增绿」等 Case 结论。
 *
 * 词槽门控：模板中任一 `{slot}` 未就绪 → 挂起等待，数据齐了再播；禁止半句入队。
 * 依赖由 voice-scripts.json 模板占位符自动推导（见 checkTemplateSlotsReady）。
 */

import { watch } from 'vue';
import { narrativeState } from './narrative-state.js';
import { barrierPaused } from './act-playback.js';
import {
  actNumberFromVoiceKey,
  broadcastFrozen,
  registerBroadcastBusyCheck,
  triggerBroadcast,
} from './broadcast-bus.js';
import { isTtsPlaybackActive } from './tts.js';
import {
  checkTemplateSlotsReady,
  getVoiceTemplate,
  isVoiceSlotFilled,
  listTemplateSlotNames,
  listVoiceScripts,
  renderVoiceScript,
} from './voice-scripts.js';
import {
  approachLabelFromDirection,
  roadNameForCardinal,
  cardinalKeyFromDirection,
} from '../features/acts/entryArm.js';
import { applyDisplayNameAlias } from '../utils/userFacingCopy.js';
import {
  getDiagnosisTicket,
  getSpatialScene,
  getOverflowMetrics,
  getDownstreamState,
  getOverflowMechanism,
  getArterialAnalysis,
  getCauseAnalysis,
  getCauseRanking,
  getCauseScene,
  getPlanMeta,
  getPlanScene,
  getStrategyMeta,
  getPrinciples,
  getNotRecommendedMeasures,
  getTrialLoop,
  getAct3Conclusion,
  isOverflowProblemConfirmed,
  getAct8Conclusion,
  getAct5Conclusion,
} from '../services/caseFixture.js';
import { getRuntimeSlice, isDiagnosisHealthy } from '../services/runtimeFixture.js';
import { livePipelineError } from '../services/livePipelineError.js';

/** 短时去重：enter / mapBeat 同拍双触发 */
let _lastKey = '';
let _lastAt = 0;
const DEDUPE_MS = 1200;

/**
 * 软词槽口播：对应切片已到但字段仍空 → 跳过，禁止幕间卡死。
 * （典型：非 Case A 缺 axis_roads / 缺排队米数）
 */
const SOFT_VOICE_BEATS = {
  'a2.channelization': ['approach'],
  'a2.arms': ['ew_road', 'ns_road'],
  'a3.storage': ['storage_length'],
  'a3.queue': ['queue_length'],
  'a3.verdict': ['overflow_conclusion'],
  'a4.compare': ['downstream_verdict'],
  'a4.branch': ['mechanism'],
  'a4.small_step_ok': ['branch_conclusion'],
  'a5.north_expand': ['upstream_role'],
  'a5.handoff': ['arterial_verdict'],
  'a6.primary_pin': ['primary_cause'],
  'a6.handoff': ['primary_cause'],
  'a7.recommend': ['strategy_name'],
  'a7.handoff': ['strategy_name'],
  'a8.recommend': ['plan_name'],
  'a8.timing': ['timing_summary'],
};

/** 全叙事周期去重：同一 beat 只播一次（仅在真正入队后标记） */
const spokenBeatKeys = new Set();

/**
 * 缺词槽挂起：key → { extraSlots, opts, at }
 * 数据到达后由 flushPendingVoice 重试。
 * @type {Map<string, { extraSlots: Record<string, unknown>, opts: { force?: boolean }, at: number }>}
 */
const pendingSpeaks = new Map();

/** 硬槽（路口名等）可等后端；软槽短超时，避免界面假死 */
const HARD_PENDING_TTL_MS = 90_000;
const SOFT_PENDING_TTL_MS = 8_000;
let pendingWatchStop = null;
let pendingTimer = null;

function pendingTtlMs(key) {
  return SOFT_VOICE_BEATS[key] ? SOFT_PENDING_TTL_MS : HARD_PENDING_TTL_MS;
}

/** 丢弃过期挂起（软槽 8s）；供幕间栅栏与轮询共用 */
function expireStalePendingVoice() {
  if (!pendingSpeaks.size) return;
  const now = Date.now();
  for (const [key, pending] of [...pendingSpeaks.entries()]) {
    if (now - pending.at <= pendingTtlMs(key)) continue;
    console.warn(`[act-voice] 挂起口播超时跳过 ${key}`);
    pendingSpeaks.delete(key);
    spokenBeatKeys.add(key);
  }
}

// 口播挂起绝不能把幕间栅栏判为 busy（否则缺词槽 = 整幕卡死）。
// 仍定期清理过期挂起；忙碌态只由 TTS 队列本身决定。
registerBroadcastBusyCheck(() => {
  expireStalePendingVoice();
  return isTtsPlaybackActive();
});

export function resetVoiceSpokenKeys() {
  spokenBeatKeys.clear();
  pendingSpeaks.clear();
  _lastKey = '';
  _lastAt = 0;
  stopPendingWatch();
}

/** 标记 beat 已口播（不再入队），用于 Act8 等延后/合并播报场景 */
export function markVoiceBeatSpoken(...keys) {
  keys.forEach((key) => {
    if (!key) return;
    spokenBeatKeys.add(key);
    pendingSpeaks.delete(key);
  });
}

/** 幕间交棒：丢弃挂起词槽，避免旧幕补播到新镜头上 */
export function clearPendingVoiceForHandoff() {
  if (pendingSpeaks.size) {
    console.info(`[act-voice] 幕间清理挂起口播 ×${pendingSpeaks.size}`);
  }
  pendingSpeaks.clear();
  stopPendingWatch();
}

/** 是否有因缺词槽而挂起的口播（供调试） */
export function hasPendingVoice() {
  return pendingSpeaks.size > 0;
}

function stopPendingWatch() {
  pendingWatchStop?.();
  pendingWatchStop = null;
  if (pendingTimer != null) {
    clearInterval(pendingTimer);
    pendingTimer = null;
  }
}

function ensurePendingWatch() {
  if (pendingWatchStop) return;
  pendingWatchStop = watch(
    () => [
      narrativeState.act,
      narrativeState.beatId,
      narrativeState.ticket,
      narrativeState.spatial,
      narrativeState.overflow,
      narrativeState.branchSummary,
      narrativeState.arterial,
      narrativeState.cause,
      narrativeState.strategy,
      narrativeState.plan,
    ],
    () => {
      flushPendingVoice();
    },
    { deep: true },
  );
  // Live SSE 可能只更新 runtime snapshot、尚未 write* 到 narrativeState
  pendingTimer = setInterval(() => {
    if (!pendingSpeaks.size) {
      stopPendingWatch();
      return;
    }
    flushPendingVoice();
  }, 400);
}

/**
 * 口播词槽允许缺数据；failLivePipeline 会先写 livePipelineError 再 throw，
 * 此处必须还原，否则 Act1 建槽时会误弹「Act3/5/8 缺字段」。
 */
function safeCall(fn) {
  const prevError = livePipelineError.value;
  try {
    const v = fn();
    return v == null ? '' : String(v);
  } catch {
    livePipelineError.value = prevError;
    return '';
  }
}

function softObj(fn) {
  const prevError = livePipelineError.value;
  try {
    return fn() || null;
  } catch {
    livePipelineError.value = prevError;
    return null;
  }
}

/** @returns {Record<string, unknown>} */
function resolveTicket() {
  if (narrativeState.ticket && typeof narrativeState.ticket === 'object') {
    return narrativeState.ticket;
  }
  const fromGetter = softObj(() => getDiagnosisTicket());
  if (fromGetter) return fromGetter;
  const raw = getRuntimeSlice('intent')?.diagnosis_ticket;
  return raw && typeof raw === 'object' ? raw : {};
}

/** @returns {Record<string, unknown>} */
function resolveSpatialScene() {
  const fromState = narrativeState.spatial?.scene;
  if (fromState && typeof fromState === 'object') return fromState;
  const fromGetter = softObj(() => getSpatialScene());
  if (fromGetter) return fromGetter;
  const raw = getRuntimeSlice('intent')?.spatial_scene;
  return raw && typeof raw === 'object' ? raw : {};
}

/** @returns {Record<string, unknown>} */
function resolveOverflowMetrics() {
  const fromState = narrativeState.overflow?.metrics;
  if (fromState && typeof fromState === 'object') return fromState;
  const fromGetter = softObj(() => getOverflowMetrics());
  if (fromGetter) return fromGetter;
  const raw = getRuntimeSlice('overflow')?.overflow_metrics;
  return raw && typeof raw === 'object' ? raw : {};
}

/** 策略条目 → 短中文 */
function measureText(item) {
  if (!item) return '';
  if (typeof item === 'string') return item.trim();
  return String(
    item.title || item.label || item.text || item.desc || item.name || item.summary || '',
  ).trim();
}

function joinMeasures(list, limit = 2) {
  return (Array.isArray(list) ? list : [])
    .map(measureText)
    .filter(Boolean)
    .slice(0, limit)
    .join('；');
}

function fmtMeters(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v.toFixed(0);
  if (v == null || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(0) : String(v);
}

function fmtDeltaSeconds(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  return `${v > 0 ? '+' : ''}${v}秒`;
}

/**
 * 配时摘要：完全来自方案数据
 * @param {Record<string, unknown>|null|undefined} timing
 */
function buildTimingSummary(timing) {
  if (!timing || typeof timing !== 'object') return '';
  const plus = timing.target_green_delta_s;
  const minus = timing.donor_green_delta_s;
  const parts = [];
  if (typeof plus === 'number' && Number.isFinite(plus)) {
    parts.push(`目标流向${fmtDeltaSeconds(plus)}`);
  }
  if (typeof minus === 'number' && Number.isFinite(minus)) {
    parts.push(`借调相位${fmtDeltaSeconds(minus)}`);
  }
  if (timing.cycle_unchanged === true || timing.cycle_delta_s === 0) {
    parts.push('周期不变');
  } else if (typeof timing.cycle_delta_s === 'number' && Number.isFinite(timing.cycle_delta_s)) {
    parts.push(`周期${fmtDeltaSeconds(timing.cycle_delta_s)}`);
  }
  return parts.join('，');
}

/** 口播短句：取首句并截断，避免侧栏长结论拖慢 TTS */
function voiceShort(text, maxLen = 42) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const first = raw.split(/[。！？]/)[0] || raw;
  const s = first.replace(/[，、；]+$/g, '').trim();
  if (s.length <= maxLen) return s.endsWith('。') ? s : `${s}。`;
  return `${s.slice(0, maxLen)}…`;
}

/**
 * Act3 口播结论（短）：无数据留空等门控；不用侧栏长段落。
 */
function buildOverflowConclusion() {
  const ticket = resolveTicket();
  const spatial = resolveSpatialScene();
  const metrics = resolveOverflowMetrics();
  const name = ticket.intersection_name || spatial.target?.inter_name || '';
  if (!name) {
    // 仍尝试完整 getter（含多源回退），再截短
    return voiceShort(safeCall(() => getAct3Conclusion()), 48);
  }
  const risk = metrics.risk_level;
  const r = metrics.queue_ratio;
  const ratioNum = typeof r === 'number' ? r : Number(r);
  const lowByRatio = Number.isFinite(ratioNum) && ratioNum < 0.8;
  const isLowRisk = risk === 'low'
    || (risk == null && lowByRatio)
    || isDiagnosisHealthy()
    || narrativeState.overflow?.healthy_exit === true;
  if (isLowRisk) {
    if (r != null && r !== '') {
      const ratio = typeof r === 'number' ? r.toFixed(2) : r;
      return `${name}排队比约${ratio}，溢出风险较低。`;
    }
    return `${name}不构成需治理的溢出问题。`;
  }
  if (isOverflowProblemConfirmed(metrics) || risk === 'warning' || risk === 'high') {
    if (r != null && r !== '') {
      const ratio = typeof r === 'number' ? r.toFixed(2) : r;
      return `${name}排队比约${ratio}，溢出预警成立。`;
    }
  }
  return voiceShort(safeCall(() => getAct3Conclusion()), 48);
}

/**
 * Act4 口播结论（短）
 */
function buildBranchConclusion(mechLabel, downstream) {
  const decision = String(downstream?.decision || '');
  const label = String(downstream?.decision_label || downstream?.message || '');
  const parts = [];
  if (mechLabel) parts.push(mechLabel);

  if (decision === 'slack' || /余量|可承接|可试运行/.test(label)) {
    parts.push('下游有余量，可谨慎试运行');
  } else if (decision === 'blocked' || /受限|回堵|不宜加绿/.test(label)) {
    parts.push('下游承接受限');
  } else if (decision === 'unknown' || /不足|未知/.test(label)) {
    parts.push('下游指标不足');
  }

  return parts.filter(Boolean).join('，') || '';
}

/** Act5：干线结论短句 */
function buildArterialSlots(arterial) {
  const verdict = arterial?.verdict || '';
  let arterial_verdict = verdict || '';
  if (!arterial_verdict) {
    arterial_verdict = voiceShort(safeCall(() => getAct5Conclusion(arterial)), 40);
  } else if (arterial?.arterial_coordination_needed === false) {
    arterial_verdict = `${verdict}，暂不强制干线联控。`;
  }

  let upstream_role = '';
  const intensity = arterial?.upstream_arrival_intensity;
  if (intensity === 'low' || intensity === '弱' || intensity === '次因') {
    upstream_role = '上游压力较弱，主矛盾在本口。';
  } else if (intensity === 'high' || intensity === '强' || intensity === '主因') {
    upstream_role = '上游到达压力偏强。';
  }

  let coordination_line = '';
  if (arterial?.arterial_coordination_needed === false) {
    coordination_line = '干线联控非必须';
  } else if (arterial?.arterial_coordination_needed === true) {
    coordination_line = '需评估干线协调';
  }

  let metering_line = '';
  if (arterial?.need_upstream_metering === false) {
    metering_line = '暂不要求上游控流';
  } else if (arterial?.need_upstream_metering === true) {
    metering_line = '建议评估上游控流';
  }

  return { arterial_verdict, upstream_role, coordination_line, metering_line };
}

/**
 * @param {Record<string, string|number|null|undefined>} [extra]
 */
export function buildVoiceSlots(extra = {}) {
  const ticket = resolveTicket();
  const spatial = resolveSpatialScene();
  const interName = ticket.intersection_name || spatial.target?.inter_name || '';
  const axisRaw = spatial.axis_roads || {};
  const axisFb = axisFallbackFromIntersectionName(interName);
  const axis = {
    ...axisRaw,
    ew_road: axisRaw.ew_road || axisFb.ew_road,
    ns_road: axisRaw.ns_road || axisFb.ns_road,
  };
  const overflow = resolveOverflowMetrics();
  const branch = narrativeState.branchSummary || narrativeState.branch || {};
  const arterial = narrativeState.arterial || softObj(() => getArterialAnalysis()) || {};
  const strategy = narrativeState.strategy || softObj(() => getStrategyMeta()) || {};
  const planMeta = narrativeState.plan?.meta || softObj(() => getPlanMeta()) || {};
  const planScene = softObj(() => getPlanScene()) || {};
  const trial = softObj(() => getTrialLoop()) || {};
  const downstream = softObj(() => getDownstreamState()) || {};
  const mechanism = softObj(() => getOverflowMechanism()) || {};
  const cause = narrativeState.cause || softObj(() => getCauseAnalysis()) || {};
  const causeScene = softObj(() => getCauseScene()) || {};
  const ranking = softObj(() => getCauseRanking()) || [];

  const direction = ticket.direction || spatial.target?.direction || '';
  const movement = ticket.movement || spatial.target?.movement || '';
  const approach = approachLabelFromDirection(direction, axis);
  const key = cardinalKeyFromDirection(direction);
  const approachRoad = roadNameForCardinal(key, axis);

  const ratio = overflow.queue_ratio;
  const queueRatio = typeof ratio === 'number' ? ratio.toFixed(2) : (ratio || '');

  const timing = planScene?.timing || narrativeState.plan?.timing || {};
  const green = timing.target_green_delta_s;
  const timingSummary = buildTimingSummary(timing);

  const mechLabel = mechanism.primary_label
    || branch.mechanism_label
    || branch.overflow_mechanism_label
    || '';

  const primaryCause = cause.primary_cause
    || branch.primary_cause
    || mechLabel;

  const secondaryCause = (Array.isArray(ranking) ? ranking : [])
    .find((r) => /次/.test(String(r.role || '')))?.cause
    || cause.secondary_cause
    || '';

  const strategyName = strategy.package_display_name || strategy.short_name || '';
  const planName = planMeta.short_name || planMeta.name || '';
  const trialCycles = trial.cycles || trial.observation_cycles || '';

  // 口播短结论；无数据留空等门控
  let planConclusion = '';
  if (planName && timingSummary) {
    planConclusion = `方案${planName}，${timingSummary}。`;
  } else {
    planConclusion = voiceShort(safeCall(() => getAct8Conclusion(planMeta, planScene)), 48);
  }

  const branchConclusion = buildBranchConclusion(mechLabel, downstream);
  const dsDecision = String(downstream.decision || '');
  let downstream_verdict = '';
  if (dsDecision === 'slack' || /余量|可承接/.test(String(downstream.decision_label || ''))) {
    // 有决策即可；下游名可缺省为「下游」
    downstream_verdict = `${downstream.direct_downstream_inter_name || '下游'}有承接余量`;
  } else if (dsDecision === 'blocked' || /受限|回堵/.test(String(downstream.decision_label || ''))) {
    downstream_verdict = `${downstream.direct_downstream_inter_name || '下游'}承接受限`;
  } else if (downstream.direct_downstream_inter_name) {
    downstream_verdict = `下游为${downstream.direct_downstream_inter_name}`;
  }

  const arterialSlots = buildArterialSlots(arterial);
  const principlesText = joinMeasures(softObj(() => getPrinciples()) || [], 3);
  const rejectText = joinMeasures(softObj(() => getNotRecommendedMeasures()) || [], 2);
  const strategyHint = causeScene?.strategy_hint || strategy?.strategy_hint || '';

  const healthy = isDiagnosisHealthy()
    || narrativeState.overflow?.healthy_exit === true
    || narrativeState.overflow?.problem_confirmed === false;

  /** 口播可见名：齐川路 → 齐音路；查库仍用原始 intersection_name */
  const display = (v) => (v == null || v === '' ? v : applyDisplayNameAlias(String(v)));

  return {
    intersection_name: display(interName),
    direction,
    movement,
    period: ticket.period || '',
    problem_type: ticket.problem_type || '',
    // 有方位即可播；无道路名时用「北进口」等，禁止空槽永久挂起
    approach: approach && approach !== '目标进口' ? display(approach) : '',
    approach_road: display(approachRoad) || '',
    ew_road: display(axis.ew_road) || '',
    ns_road: display(axis.ns_road) || '',
    road_pair_text: display(
      (axis.road_pair || []).filter(Boolean).join('与')
      || [axis.ew_road, axis.ns_road].filter(Boolean).join('与'),
    ),
    queue_ratio: queueRatio,
    queue_length: fmtMeters(overflow.queue_length_m),
    storage_length: fmtMeters(overflow.storage_length_m),
    downstream_name: display(downstream.direct_downstream_inter_name) || '',
    downstream_verdict: display(downstream_verdict),
    upstream_name: display(spatial.upstream_nodes?.[0]?.inter_name) || '',
    mechanism: mechLabel,
    overflow_conclusion: display(buildOverflowConclusion()),
    branch_conclusion: display(branchConclusion),
    ...Object.fromEntries(
      Object.entries(arterialSlots).map(([k, v]) => [k, typeof v === 'string' ? display(v) : v]),
    ),
    primary_cause: display(primaryCause),
    secondary_cause: display(secondaryCause),
    strategy_hint: display(strategyHint),
    strategy_name: strategyName,
    principles_text: display(principlesText),
    reject_text: display(rejectText),
    plan_name: planName,
    timing_summary: timingSummary,
    green_delta: typeof green === 'number' ? fmtDeltaSeconds(green) : '',
    trial_cycles: trialCycles ? String(trialCycles) : '',
    plan_conclusion: display(planConclusion),
    next_step_hint: healthy ? '可返回主页或补充条件后重试' : '',
    conclusion: '',
    ...Object.fromEntries(
      Object.entries(extra).map(([k, v]) => [k, typeof v === 'string' ? display(v) : v]),
    ),
  };
}

/**
 * 重试挂起口播；过幕 / 超时丢弃，避免半句补播到错误幕次。
 */
export function flushPendingVoice() {
  if (!pendingSpeaks.size) {
    stopPendingWatch();
    return;
  }
  const now = Date.now();
  const currentAct = Number(narrativeState.act) || 0;
  for (const [key, pending] of [...pendingSpeaks.entries()]) {
    const actNum = actNumberFromVoiceKey(key);
    if (actNum != null && currentAct > actNum) {
      console.info(`[act-voice] 丢弃过期挂起口播 ${key}（已进入 Act${currentAct}）`);
      pendingSpeaks.delete(key);
      continue;
    }
    if (now - pending.at > pendingTtlMs(key)) {
      console.warn(`[act-voice] 挂起口播超时跳过 ${key}`);
      pendingSpeaks.delete(key);
      spokenBeatKeys.add(key);
      continue;
    }
    speakActBeat(key, pending.extraSlots, { ...pending.opts, _fromPending: true });
  }
  if (!pendingSpeaks.size) stopPendingWatch();
}

/**
 * 当前 beat 依赖的数据切片是否已到（到了仍缺槽 = 永久缺失，应跳过）
 * @param {string} key
 */
function isVoiceDataReadyForBeat(key) {
  const act = actNumberFromVoiceKey(key);
  if (act == null) return false;
  if (act <= 2) {
    return Boolean(
      getRuntimeSlice('intent')
      || narrativeState.ticket?.intersection_name
      || narrativeState.spatial?.scene
      || resolveSpatialScene()?.target,
    );
  }
  if (act === 3) {
    return Boolean(getOverflowMetrics() || getRuntimeSlice('overflow'));
  }
  if (act === 4) {
    return Boolean(getRuntimeSlice('bottleneck') || narrativeState.branchSummary);
  }
  if (act === 5) {
    return Boolean(getRuntimeSlice('arterial') || narrativeState.arterial);
  }
  if (act >= 6) {
    return Boolean(
      getRuntimeSlice('cause')
      || getRuntimeSlice('strategy')
      || getRuntimeSlice('plan')
      || narrativeState.cause
      || narrativeState.strategy
      || narrativeState.plan,
    );
  }
  return false;
}

/**
 * @param {string} key
 * @param {Record<string, unknown>} slots
 * @param {string[]} missing
 */
function trySkipSoftVoiceBeat(key, slots, missing) {
  const soft = SOFT_VOICE_BEATS[key];
  if (!soft?.length || !missing?.length) return false;
  if (!isVoiceDataReadyForBeat(key)) return false;
  const hardMissing = missing.filter((m) => !soft.includes(m));
  if (hardMissing.length) return false;
  pendingSpeaks.delete(key);
  spokenBeatKeys.add(key);
  console.info(`[act-voice] 跳过 ${key}：数据就绪但缺 ${missing.join(', ')}`);
  return true;
}

/** 从路口名拆道路对，供缺 axis_roads 时口播兜底（不区分东西/南北精度） */
function axisFallbackFromIntersectionName(name) {
  const parts = String(name || '')
    .replace(/路口$/, '')
    .split(/[与和×xX]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  if (parts.length < 2) return { ew_road: '', ns_road: '' };
  return { ew_road: parts[0], ns_road: parts[1] };
}

/**
 * @param {string} key
 * @param {Record<string, string|number|null|undefined>} [extraSlots]
 * @param {{ force?: boolean, _fromPending?: boolean }} [opts]
 */
export function speakActBeat(key, extraSlots = {}, opts = {}) {
  if (!key) return;
  if (barrierPaused.value || broadcastFrozen.value) return;

  // Act8 方案口播已在 act8PlanVoice 序列中播过，交棒不再重复 plan_conclusion
  if (key === 'a8.handoff' && (spokenBeatKeys.has('a8.recommend') || spokenBeatKeys.has('a8.timing'))) {
    spokenBeatKeys.add(key);
    pendingSpeaks.delete(key);
    return;
  }

  // 禁止过幕补播：当前幕次已超过 beat 所属幕，直接丢弃
  const actNum = actNumberFromVoiceKey(key);
  const currentAct = Number(narrativeState.act) || 0;
  if (!opts.force && actNum != null && currentAct > actNum) {
    pendingSpeaks.delete(key);
    return;
  }

  const now = Date.now();
  if (!opts.force) {
    if (spokenBeatKeys.has(key)) {
      pendingSpeaks.delete(key);
      return;
    }
    if (!opts._fromPending && key === _lastKey && now - _lastAt < DEDUPE_MS) return;
  }

  const tpl = getVoiceTemplate(key);
  if (!tpl) return;

  const slots = buildVoiceSlots(extraSlots);

  const { ready, missing } = checkTemplateSlotsReady(tpl, slots);
  if (!ready) {
    if (trySkipSoftVoiceBeat(key, slots, missing)) return;
    if (!opts.force) {
      pendingSpeaks.set(key, { extraSlots, opts: { force: opts.force }, at: pendingSpeaks.get(key)?.at || now });
      ensurePendingWatch();
      console.info(`[act-voice] 等待词槽后播报 ${key}，缺：${missing.join(', ')}`);
    }
    return;
  }

  const text = renderVoiceScript(key, slots, { requireFilled: true });
  if (!text) {
    if (!opts.force) {
      pendingSpeaks.set(key, { extraSlots, opts: { force: opts.force }, at: pendingSpeaks.get(key)?.at || now });
      ensurePendingWatch();
    }
    return;
  }

  pendingSpeaks.delete(key);
  spokenBeatKeys.add(key);
  _lastKey = key;
  _lastAt = now;
  triggerBroadcast(key, text);
}

export function onBeatChanged(beatId) {
  speakActBeat(beatId);
}

export function speakConclusion(conclusion) {
  const text = String(conclusion || '').trim();
  if (!text) return;
  speakActBeat('conclusion', { conclusion: text }, { force: true });
}

/**
 * 调试 / 文档：模板词槽依赖表（由 voice-scripts.json 占位符自动推导）
 * @returns {Record<string, string[]>}
 */
export function listVoiceSlotDependencies() {
  const out = {};
  for (const [key, tpl] of Object.entries(listVoiceScripts())) {
    out[key] = listTemplateSlotNames(tpl);
  }
  return out;
}

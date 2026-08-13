/**
 * Live 模式：幕进入前等待对应 phase 就绪；失败 throw，严禁回退 Mock。
 * Mock 模式立即返回。
 */
import {
  ACT_PHASE_GATE,
  ensurePhaseForAct,
  getActWaitLabel,
  getComputingLabel,
  getRuntimeSlice,
  isLiveMode,
} from '../../services/runtimeFixture.js';
import {
  failLivePipeline,
  requireLiveFields,
  requireLiveSlice,
} from '../../services/livePipelineError.js';
import { taskBarLabel, taskBarVisible } from '../../shared/narrative-state.js';

/** phase → caseFixture 切片键 */
const PHASE_SLICE_KEY = {
  intent: 'intent',
  diagnosis: 'overflow',
  cause: 'cause',
  strategy: 'strategy',
  plan: 'plan',
};

/** @type {Record<number, { key: string, fields: string[] }[]>} */
const ACT_FIELD_CHECKS = {
  // 与 getDiagnosisTicket() 硬字段对齐，避免 waitPhase 通过后取工单抛错导致左侧永不出现
  1: [{
    key: 'intent',
    fields: [
      'diagnosis_ticket.intersection_name',
      'diagnosis_ticket.lng',
      'diagnosis_ticket.lat',
      'diagnosis_ticket.inter_id',
      'diagnosis_ticket.direction',
      'diagnosis_ticket.movement',
      'diagnosis_ticket.time_range',
      'diagnosis_ticket.period',
      'diagnosis_ticket.problem_type',
      'diagnosis_ticket.diagnosis_scope',
      'diagnosis_ticket.governance_goal',
    ],
  }],
  2: [
    { key: 'intent', fields: ['spatial_scene.target.lng', 'spatial_scene.target.lat'] },
  ],
  3: [{ key: 'overflow', fields: ['overflow_metrics'] }],
  4: [
    { key: 'bottleneck', fields: ['overflow_mechanism.primary', 'overflow_mechanism.primary_label', 'downstream_state.decision'] },
  ],
  5: [
    { key: 'arterial', fields: ['arterial_analysis.verdict', 'arterial_analysis.summary'] },
    // flow_trace.links 非强制：缺边时 Act5 短幕仍可播三问，避免非 Case A 卡死
    { key: 'flow_trace', fields: ['target'] },
  ],
  // 对齐参考 CauseCard：case_cards 允许 cards=[]（库无匹配），不硬失败
  6: [{ key: 'cause', fields: ['cause_analysis.primary_cause', 'cause_scene.strategy_hint'] }],
  7: [{ key: 'strategy', fields: ['strategy_meta.strategy_package', 'control_scope'] }],
  8: [{ key: 'plan', fields: ['plan_meta.plan_id', 'plan_scene.timing.target_green_delta_s'] }],
};

/**
 * @param {number} act
 */
function assertActFields(act) {
  const checks = ACT_FIELD_CHECKS[act] || [];
  for (const check of checks) {
    const slice = getRuntimeSlice(check.key);
    requireLiveSlice(slice, check.key);
    requireLiveFields(slice, check.fields, `${check.key}`);
  }
  if (act === 2) {
    const intent = getRuntimeSlice('intent');
    const ch = intent?.spatial_scene?.channelization_map;
    if (!ch || ch.available !== true || !(ch.links || []).length) {
      failLivePipeline('Live 路网定位要求 channelization_map.available=true 且 links 非空');
    }
    const up = intent?.spatial_scene?.upstream_nodes || [];
    const down = intent?.spatial_scene?.downstream_nodes || [];
    if (!up.length || !down.length) {
      failLivePipeline('Live 路网定位要求 upstream_nodes / downstream_nodes 非空');
    }
  }
  if (act === 5) {
    const arterial = getRuntimeSlice('arterial');
    if (!Array.isArray(arterial?.three_questions) || !arterial.three_questions.length) {
      failLivePipeline('Live 干线上游要求 three_questions 非空数组');
    }
    // flow_trace：非典型 Case 可能缺结构边；允许进入短幕（地图侧空渲染），禁止整幕卡死
    const ft = getRuntimeSlice('flow_trace');
    if (!ft || typeof ft !== 'object') {
      failLivePipeline('Live 干线上游缺少 flow_trace 切片');
    }
  }
}

/**
 * @param {number} act
 * @returns {Promise<void>}
 */
export async function waitPhaseBeforeEnter(act) {
  if (!isLiveMode()) return;
  const computing = getComputingLabel();
  if (computing) {
    taskBarVisible.value = true;
    taskBarLabel.value = computing;
  } else {
    taskBarVisible.value = true;
    taskBarLabel.value = getActWaitLabel(act);
  }
  try {
    await ensurePhaseForAct(act);
    // Act2：intent 完成后若仍无上下游/渠化，再等 diagnosis 以便后端/适配层回填
    // （对齐 Case A fixture：spatial_scene.upstream_nodes / channelization_map）
    if (act === 2) {
      const intentReady = () => {
        const intent = getRuntimeSlice('intent');
        const scene = intent?.spatial_scene || {};
        const up = scene.upstream_nodes || [];
        const down = scene.downstream_nodes || [];
        const ch = scene.channelization_map;
        return up.length > 0
          && down.length > 0
          && ch?.available === true
          && (ch.links || []).length > 0;
      };
      if (!intentReady()) {
        taskBarLabel.value = '等待路网拓扑与渠化…';
        await ensurePhaseForAct(3); // diagnosis
        if (!intentReady()) {
          failLivePipeline('Live 路网定位在诊断回填后仍缺少 upstream/downstream/channelization_map');
        }
      }
    }
    const phase = ACT_PHASE_GATE[act];
    const sliceKey = PHASE_SLICE_KEY[phase] || phase;
    requireLiveSlice(getRuntimeSlice(sliceKey), sliceKey);
    assertActFields(act);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    taskBarLabel.value = msg;
    taskBarVisible.value = true;
    console.error('[actPhaseGate]', msg);
    failLivePipeline(msg);
  }
}

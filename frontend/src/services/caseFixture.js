import caseADemoFixture from '../../data/aotixi_fixture.json';
import { getRuntimeSlice, isDiagnosisHealthy, isLiveMode } from './runtimeFixture.js';
import { adaptSlice } from './fixtureAdapter.js';
import { failLivePipeline, requireLiveFields } from './livePipelineError.js';
import { approachLabelFromDirection } from '../features/acts/entryArm.js';
import {
  applyDisplayNameAlias,
  formatReasoningStep,
  sanitizeUserFacingCopy,
} from '../utils/userFacingCopy.js';

/**
 * Mock：从 data/case_a_demo_fixture.json 适配切片（前端可单机调试）。
 * Live：仅 runtime 适配切片，严禁静默回退 fixture。
 * @param {string} key
 * @returns {Record<string, unknown>|null}
 */
function resolveSlice(key) {
  if (!isLiveMode()) {
    return adaptSlice(caseADemoFixture, key);
  }
  return getRuntimeSlice(key);
}

function intentData() {
  return resolveSlice('intent');
}

function spatialData() {
  if (!isLiveMode()) {
    const slice = resolveSlice('intent');
    return {
      spatial_objects: slice?.spatial_objects ?? null,
      spatial_scene: slice?.spatial_scene ?? null,
    };
  }
  const live = resolveSlice('intent');
  if (!live) return { spatial_objects: null, spatial_scene: null };
  return {
    spatial_objects: live.spatial_objects ?? null,
    spatial_scene: live.spatial_scene ?? null,
  };
}

function overflowData() {
  return resolveSlice('overflow');
}

function bottleneckData() {
  return resolveSlice('bottleneck');
}

function arterialData() {
  return resolveSlice('arterial');
}

function flowTraceData() {
  return resolveSlice('flow_trace');
}

function causeData() {
  return resolveSlice('cause');
}

function strategyData() {
  return resolveSlice('strategy');
}

function planData() {
  return resolveSlice('plan');
}

/** Case A 默认自然语言（Mock 预填；Live 输入框仍可点示例芯片）
 * 展示用「齐音路」；Live 查库仍由 demo-cases.intersection_name「齐川路」+ inter_id 解析。
 */
export const CASE_A_DEFAULT_PROMPT =
  '奥体西路与经十路路口，晚高峰五点半到六点半，北进口直行经常排队外溢。' +
  '下游经十路东西向饱和度很高，北向南排队溢出到解放东路路口。' +
  '帮忙看看配时怎么调，别加重下游拥堵。';

/**
 * 规范化诊断工单（展示 + narrative-state.ticket）
 * Live：缺字段硬失败，禁止 Case A 默认值。
 */
export function getDiagnosisTicket() {
  const slice = intentData();
  const rawTicket = slice?.diagnosis_ticket ?? null;
  if (!rawTicket) return null;

  if (isLiveMode()) {
    requireLiveFields(
      rawTicket,
      [
        'intersection_name',
        'inter_id',
        'lng',
        'lat',
        'direction',
        'movement',
        'time_range',
        'period',
        'problem_type',
      ],
      'diagnosis_ticket',
    );
  }

  const constraints = Array.isArray(rawTicket.constraints)
    ? rawTicket.constraints
    : rawTicket.constraints
      ? [rawTicket.constraints]
      : [];
  // 对齐参考前端 DiagnosisTicketCard：constraints 可空，不阻断叙事

  const diagnosisScope = rawTicket.diagnosis_scope_display
    || (Array.isArray(rawTicket.diagnosis_scope) ? rawTicket.diagnosis_scope.join(' + ') : null)
    || (typeof rawTicket.diagnosis_scope === 'string' ? rawTicket.diagnosis_scope : null);
  const governanceGoal = rawTicket.governance_goal_display || rawTicket.governance_goal || null;
  if (isLiveMode() && !diagnosisScope) {
    failLivePipeline('Live 工单缺少 diagnosis_scope');
  }
  if (isLiveMode() && !governanceGoal) {
    failLivePipeline('Live 工单缺少 governance_goal');
  }

  return {
    object_type: rawTicket.object_type === 'intersection' ? '路口' : (rawTicket.object_type || '路口'),
    object_type_raw: rawTicket.object_type || 'intersection',
    intersection_name: rawTicket.intersection_name,
    time_range: String(rawTicket.time_range).replace('-', '–'),
    period: rawTicket.period,
    direction: rawTicket.direction,
    movement: rawTicket.movement,
    problem_type: rawTicket.problem_type,
    constraints,
    constraint_text: constraints.join('；'),
    diagnosis_scope: diagnosisScope,
    diagnosis_scope_raw: rawTicket.diagnosis_scope || [],
    governance_goal: governanceGoal,
    governance_goal_raw: rawTicket.governance_goal || governanceGoal,
    inter_id: rawTicket.inter_id,
    lng: rawTicket.lng,
    lat: rawTicket.lat,
    user_experiences: slice?.user_experiences || rawTicket.user_experiences || [],
  };
}

export function getTicketConclusion(ticket = getDiagnosisTicket()) {
  if (!ticket) return '诊断工单已生成。';
  return sanitizeUserFacingCopy(
    `诊断工单已生成：${ticket.intersection_name} · ${ticket.period}${ticket.direction}` +
    `${ticket.movement}${ticket.problem_type}；目标为${ticket.governance_goal}，` +
    `诊断范围含目标路口、上游来车与下游承接。`,
  );
}

export function getAct1PlanningItems(ticket = getDiagnosisTicket()) {
  if (!ticket) return [];
  return [
    `识别对象：${ticket.object_type}`,
    `定位路口：${ticket.intersection_name}`,
    `锁定时间：${ticket.time_range}（${ticket.period}）`,
    `确认流向：${ticket.direction} · ${ticket.movement}`,
    `判定问题：${ticket.problem_type}`,
    ticket.constraint_text
      ? `写入约束：${ticket.constraint_text}`
      : '写入约束：无显式约束',
  ].map(sanitizeUserFacingCopy);
}

export function getAct1TicketFields(ticket = getDiagnosisTicket()) {
  if (!ticket) return [];
  return [
    { key: 'object', label: '对象', value: ticket.object_type },
    { key: 'intersection', label: '路口', value: ticket.intersection_name },
    { key: 'time', label: '时间', value: ticket.time_range },
    { key: 'period', label: '时段', value: ticket.period },
    { key: 'direction', label: '方向', value: ticket.direction },
    { key: 'movement', label: '转向', value: ticket.movement },
    { key: 'problem', label: '问题', value: ticket.problem_type },
    { key: 'constraint', label: '约束', value: ticket.constraint_text },
    { key: 'scope', label: '诊断范围', value: ticket.diagnosis_scope },
    { key: 'goal', label: '治理目标', value: ticket.governance_goal },
  ].map((f) => ({
    ...f,
    value: typeof f.value === 'string' ? sanitizeUserFacingCopy(f.value) : f.value,
  }));
}

export function getSpatialObjects() {
  return spatialData()?.spatial_objects ?? null;
}

export function getSpatialScene() {
  return spatialData()?.spatial_scene ?? null;
}

export function getAct2RecognitionSteps(scene = getSpatialScene()) {
  const steps = scene?.recognition_steps || [];
  return steps.map((s) => formatReasoningStep(s)).filter(Boolean);
}

export function getAct2Conclusion(objects = getSpatialObjects(), scene = getSpatialScene()) {
  if (isLiveMode()) {
    requireLiveFields(objects, ['target_intersection', 'target_direction', 'target_movement', 'main_path'], 'spatial_objects');
    requireLiveFields(scene?.target, ['lng', 'lat', 'inter_id'], 'spatial_scene.target');
  }
  const path = objects?.main_path || scene?.main_path;
  const name = objects?.target_intersection || scene?.target?.inter_name;
  if (!path || !name) {
    if (isLiveMode()) failLivePipeline('Live Act2 结论缺少空间对象文案字段');
    return '';
  }
  return (
    `空间对象确认：${name} 已锚定为诊断对象；` +
    `流向 ${objects?.target_direction}·${objects?.target_movement}；` +
    `空间关系 ${path}。问题可能从单点升级为廊道风险，待溢出核验。`
  );
}

export function getOverflowMetrics() {
  return overflowData()?.overflow_metrics ?? null;
}

export function getOverflowScene() {
  return overflowData()?.overflow_scene ?? null;
}

export function getAct3VerificationSteps(scene = getOverflowScene()) {
  const steps = scene?.verification_steps || [];
  return steps.map((s) => formatReasoningStep(s)).filter(Boolean);
}

/** 仅 warning/high 才算「溢出问题成立」；verified=true 只表示核验完成 */
export function isOverflowProblemConfirmed(metrics = getOverflowMetrics()) {
  const slice = resolveSlice('overflow') || {};
  if (typeof slice.problem_confirmed === 'boolean') return slice.problem_confirmed;
  const risk = metrics?.risk_level || slice.overflow_metrics?.risk_level;
  return risk === 'warning' || risk === 'high';
}

export function getAct3Conclusion(metrics = getOverflowMetrics(), scene = getOverflowScene()) {
  // 对齐参考：指标可为 null（DB 无数据），上屏用 "—"，不因缺数阻断叙事
  const q = metrics?.queue_length_m;
  const s = metrics?.storage_length_m;
  const r = metrics?.queue_ratio;
  const risk = metrics?.risk_level;
  // 与 Act2 / 左栏面板一致：溢出切片缺名时回退工单与空间对象（禁止只认 overflow_scene.target.inter_name）
  const spatial = spatialData();
  const ticketName = intentData()?.diagnosis_ticket?.intersection_name;
  const name =
    scene?.target?.inter_name
    || spatial?.spatial_objects?.target_intersection
    || spatial?.spatial_scene?.target?.inter_name
    || ticketName
    || null;
  if (!name) {
    // 溢出阶段未到：Act1/2 口播建槽会提前调用，禁止误阻断；仅诊断切片已到却仍无名才硬失败
    const overflowReady = Boolean(metrics || scene || resolveSlice('overflow'));
    if (isLiveMode() && overflowReady) {
      failLivePipeline('Live Act3 结论缺少目标路口名');
    }
    return '';
  }
  const dir = scene?.target?.direction || '';
  const mov = scene?.target?.movement || '直行';
  const flowLabel = [dir, mov].filter(Boolean).join('') || '目标进口';
  // 侧栏/口播展示名：齐川路 → 齐音路（查库名不变）
  const displayName = applyDisplayNameAlias(name);

  if (q == null || s == null || r == null || risk === 'unknown') {
    return sanitizeUserFacingCopy(
      `溢出核验：${displayName} 目标进口排队/蓄车指标不完整` +
      `（排队 ${q ?? '—'} m / 蓄车 ${s ?? '—'} m / 排队比 ${r ?? '—'}），` +
      `数据库该时段无完整有效值，记入数据缺口，继续后续核验。`,
    );
  }

  const ratioNum = typeof r === 'number' ? r : Number(r);
  const lowByRatio = Number.isFinite(ratioNum) && ratioNum < 0.8;
  const isLowRisk = isDiagnosisHealthy()
    || risk === 'low'
    || (risk == null && lowByRatio)
    || (risk !== 'warning' && risk !== 'high' && !isOverflowProblemConfirmed(metrics) && lowByRatio);

  // 短排队 / 低风险：禁止写「溢出预警成立」（即便流水线因其它原因未 healthy 提前收尾）
  if (isLowRisk) {
    const healthyTail = isDiagnosisHealthy()
      ? '诊断流水线提前结束，可返回主页；若现场仍有感知问题，请补充时段或进口后重试。'
      : '尚不构成需按溢出问题推进的治理对象，继续对照本口与下游。';
    return sanitizeUserFacingCopy(
      `溢出核验结论：${displayName} ${flowLabel} 当前不构成需治理的溢出问题。` +
      `排队 ${q} m / 蓄车 ${s} m / 排队比 ${r}，` +
      `风险较低。${healthyTail}`,
    );
  }

  return sanitizeUserFacingCopy(
    `溢出预警成立：${displayName} ${flowLabel}排队 ${q} m / 蓄车 ${s} m，` +
    `排队比 ${r}，接近进口道空间边界。问题成立，尚不解释成因。`,
  );
}

export function getBottleneckAnalysis() {
  return bottleneckData()?.bottleneck_analysis ?? null;
}

export function getDownstreamState() {
  return bottleneckData()?.downstream_state ?? null;
}

export function getOverflowMechanism() {
  return bottleneckData()?.overflow_mechanism ?? null;
}

export function getCompareMetrics() {
  return bottleneckData()?.compare_metrics ?? null;
}

export function getBranchScene() {
  return bottleneckData()?.branch_scene ?? null;
}

export function getAct4BranchSteps(scene = getBranchScene()) {
  const steps = scene?.branch_steps || [];
  return steps
    .map((s) => formatReasoningStep(s))
    .filter(Boolean)
    .map((line) => (
      // TEMP: 绿灯利用率展示暂停
      typeof line === 'string' && line.includes('绿灯利用率')
        ? line.replace(/绿灯利用率与/g, '').replace(/绿灯利用率/g, '').replace(/：\s*$/g, '').trim()
        : line
    ));
}

export function getAct4Conclusion(
  analysis = getBottleneckAnalysis(),
  downstream = getDownstreamState(),
  mechanism = getOverflowMechanism(),
) {
  // TEMP: 绿灯利用率展示暂停
  // const compare = getCompareMetrics();
  if (isLiveMode()) {
    // 机制必填；下游决策 / 绿灯利用率属可降级字段，缺则文案降级，禁止整幕 setup 抛死
    requireLiveFields(mechanism, ['primary', 'primary_label'], 'overflow_mechanism');
  }
  // TEMP: 绿灯利用率展示暂停
  // const util = compare?.target?.green_utilization;
  const dsName = downstream?.direct_downstream_inter_name || '下游路口';
  const mechLabel = mechanism?.primary_label;
  if (!mechLabel) {
    if (isLiveMode()) failLivePipeline('Live Act4 结论缺少机制字段');
    return '';
  }
  // const utilPart = util == null ? '' : `目标口绿灯利用率 ${util}，`;
  const utilPart = '';
  const dsDecision = downstream?.decision;
  const capacityPart = dsDecision === 'unknown'
    ? `${dsName} 下游指标不完整，暂不判定承接余量；`
    : (downstream?.can_release === false || dsDecision === 'blocked'
      ? `${dsName} 承接偏紧，不宜激进加绿；`
      : `${dsName} 有承接余量，具备小步增绿试运行条件；`);
  return (
    `${mechLabel}：${utilPart}并非下游堵死。` +
    `${capacityPart}不宜激进一次性大加绿。`
  );
}

export function getArterialAnalysis() {
  return arterialData()?.arterial_analysis ?? null;
}

export function getCoordination() {
  return arterialData()?.coordination ?? null;
}

export function getThreeQuestions() {
  const qs = arterialData()?.three_questions;
  if (isLiveMode() && (!Array.isArray(qs) || !qs.length)) {
    failLivePipeline('Live 缺少 diagnosis.three_questions');
  }
  return qs ?? [];
}

export function getArterialScene() {
  return arterialData()?.arterial_scene ?? null;
}

export function getAct5AnalysisSteps(scene = getArterialScene()) {
  const steps = scene?.analysis_steps || [];
  return steps.map((s) => formatReasoningStep(s)).filter(Boolean);
}

export function getAct5Conclusion(analysis = getArterialAnalysis()) {
  // 干线切片未到 / 口播传入 {} 占位 → 软返回；有实质字段才硬校验
  const verdict = analysis?.verdict;
  const summary = analysis?.summary;
  if (!analysis || (verdict == null && summary == null)) return '';
  if (isLiveMode()) {
    requireLiveFields(analysis, ['verdict', 'summary', 'arterial_coordination_needed'], 'arterial_analysis');
  }
  if (!verdict || !summary) {
    if (isLiveMode()) failLivePipeline('Live Act5 结论缺少 arterial_analysis');
    return '';
  }
  return (
    `${verdict}：${summary}。` +
    `上游到达压力仅作次因，干线联控非必须，进入成因与案例。`
  );
}

export function getFlowTraceScene() {
  return flowTraceData() ?? null;
}

export function getFlowTraceLinks() {
  return flowTraceData()?.links ?? [];
}

export function getFlowTraceNodes() {
  return flowTraceData()?.nodes ?? [];
}

export function getFlowTraceCorridorChain() {
  return flowTraceData()?.main_corridor_chain ?? [];
}

export function getCauseAnalysis() {
  return causeData()?.cause_analysis ?? null;
}

export function getCauseRanking() {
  return causeData()?.cause_ranking ?? [];
}

export function getCauseCards() {
  return causeData()?.case_cards ?? [];
}

export function getDataGapItems() {
  return causeData()?.data_gap_items ?? [];
}

export function getCauseScene() {
  return causeData()?.cause_scene ?? null;
}

export function getAct6AnalysisSteps(scene = getCauseScene()) {
  const steps = scene?.analysis_steps || [];
  return steps.map((s) => formatReasoningStep(s)).filter(Boolean);
}

/** 单行标签：按字符预算截断，放不下就少显示，保证不换行 */
function fitTagsOneLine(tags, maxChars = 24) {
  if (!Array.isArray(tags) || !tags.length) return [];
  const out = [];
  let used = 0;
  for (const raw of tags) {
    const t = String(raw || '').trim();
    if (!t) continue;
    const add = t.length + (out.length ? 1 : 0);
    if (out.length && used + add > maxChars) break;
    out.push(t);
    used += add;
  }
  return out.length ? out : [String(tags[0]).trim()].filter(Boolean);
}

/** Top1→Top3 每行可见标签数不递增，避免排名更低反而一行里标签更多 */
function enforceMonotonicRowTags(results) {
  let coreCap = null;
  let secCap = null;
  for (const r of results) {
    if (coreCap != null && r.coreMatches.length > coreCap) {
      r.coreMatches = r.coreMatches.slice(0, coreCap);
    }
    if (secCap != null && r.secondaryMatches.length > secCap) {
      r.secondaryMatches = r.secondaryMatches.slice(0, secCap);
    }
    if (coreCap == null) coreCap = r.coreMatches.length;
    if (secCap == null) secCap = r.secondaryMatches.length;
  }
}

export function getAct6SearchPhase(cards = getCauseCards()) {
  // 对齐参考 CauseCard：允许 cards=[]（案例库无匹配），展示空态而非硬失败
  // 展示 Top1–3（新推荐引擎 Top3 精排结果），第一行语义片段、第二行标签，
  // 供 AgentReasoning 分层展示；标签抽取/BM25 粗召属内部环节，不上屏。
  const list = Array.isArray(cards) ? cards : [];
  const results = list.slice(0, 3).map((c, i) => ({
    rank: c.rank ?? i + 1,
    name: c.short_name || c.title || `案例 ${c.case_id}`,
    // 新引擎显式给 match_pct（0–100）；旧 CaseLibraryService 的 score 是 0–10
    // 量级，退回时按 *10 换算，两套来源单位不同，禁止直接共用同一乘数
    match: c.match_pct ?? Math.round((c.score ?? 0) * 10),
    coreMatches: fitTagsOneLine(c.core_matches),
    secondaryMatches: fitTagsOneLine(c.secondary_matches),
    // 卡片正文改为「案例场景」（title 已是后端截到 80 字的案例场景，天然截断展示）
    desc: c.title || '相似历史案例',
    // 「参考经验」替代原「差异」提醒：展示该案例真实取得的效果，做正向参考而非
    // 强调跟用户场景的差异
    refExperience: c.lesson || c.help_summary || '',
    // 点击卡片弹出详情用：案例场景 / 交通问题诊断 / 治理方案
    detail: c.case_id == null ? null : {
      caseId: c.case_id,
      name: c.short_name || c.title || `案例 ${c.case_id}`,
      scene: c.scene_full || c.title || '暂无数据',
      diagnosis: c.diagnosis_full || '暂无数据',
      solution: c.solution_full || c.historical_action || '暂无数据',
    },
  }));
  if (!results.length) {
    results.push({
      rank: 1,
      name: '暂无高度相似案例',
      match: 0,
      coreMatches: [],
      secondaryMatches: [],
      desc: '案例库无匹配项；主因仍由机制锁定与证据链给出',
      refExperience: '',
      detail: null,
    });
  }
  enforceMonotonicRowTags(results);
  return {
    type: 'searching',
    title: '经验库检索',
    query: '排队溢出 + 晚高峰 + 放行效率异常 · 勿激进加绿',
    results,
  };
}

export function getAct6Conclusion(analysis = getCauseAnalysis(), scene = getCauseScene()) {
  if (isLiveMode()) {
    requireLiveFields(analysis, ['primary_cause'], 'cause_analysis');
  }
  const primary = analysis?.primary_cause;
  const hint = scene?.strategy_hint;
  if (!primary) {
    if (isLiveMode()) failLivePipeline('Live Act6 结论缺少 primary_cause');
    return '';
  }
  return (
    `主因锁定：${primary}。` +
    `次因含交通需求压力；案例对照「勿激进加绿」。` +
    `问题可信、机制已定，策略应${hint || '按后端策略提示执行'}。`
  );
}

export function getStrategyMeta() {
  return strategyData()?.strategy_meta ?? null;
}

export function getPrinciples() {
  return strategyData()?.principles ?? [];
}

export function getRecommendedMeasures() {
  return strategyData()?.recommended ?? [];
}

export function getNotRecommendedMeasures() {
  return strategyData()?.not_recommended ?? [];
}

export function getHardConstraintsDisplay() {
  return strategyData()?.hard_constraints_display ?? [];
}

export function getControlScope() {
  return strategyData()?.control_scope ?? null;
}

export function getStrategyScene() {
  return strategyData()?.strategy_scene ?? null;
}

export function getExperienceContrast() {
  return strategyData()?.experience_contrast ?? null;
}

export function getAct7PlanningItems(meta = getStrategyMeta()) {
  if (isLiveMode()) {
    requireLiveFields(meta, ['package_display_name', 'strategy_package'], 'strategy_meta');
  }
  const name = meta?.package_display_name;
  if (!name) {
    if (isLiveMode()) failLivePipeline('Live Act7 缺少策略包显示名');
    return [];
  }
  const cause = meta?.primary_cause || '成因结论';
  return [
    `读取成因：${cause}`,
    '约束：避免加重下游拥堵、动作可回滚',
    '划定控制范围：目标 · 上游观测 · 下游监测',
    `候选策略包：${name}`,
  ].map(sanitizeUserFacingCopy);
}

export function getAct7AnalysisSteps(scene = getStrategyScene()) {
  const steps = scene?.analysis_steps || [];
  return steps.map((s) => formatReasoningStep(s)).filter(Boolean);
}

export function getAct7Conclusion(meta = getStrategyMeta()) {
  if (isLiveMode()) {
    requireLiveFields(meta, ['package_display_name'], 'strategy_meta');
  }
  const name = meta?.package_display_name;
  if (!name) {
    if (isLiveMode()) failLivePipeline('Live Act7 结论缺少策略包');
    return '';
  }
  if (meta?.overall_summary) return String(meta.overall_summary);
  return (
    `策略定调：${name}。` +
    `原则为防溢流优先、可回滚、先看下游、小步释放；` +
    `不推荐未核验前激进加绿。` +
    `具体秒数与试运行周期进入方案幕展开。`
  );
}

export function getPlanMeta() {
  return planData()?.plan_meta ?? null;
}

export function getPlanCandidates() {
  return planData()?.candidates ?? [];
}

export function getRecommendedActions() {
  return planData()?.recommended_actions ?? [];
}

export function getTrialLoop() {
  return planData()?.trial_loop ?? null;
}

export function getRollbackConditions() {
  return planData()?.rollback_conditions ?? [];
}

export function getExecutionOrder() {
  return planData()?.execution_order ?? [];
}

export function getPlanScene() {
  return planData()?.plan_scene ?? null;
}

export function getPlanTiming() {
  return planData()?.timing ?? null;
}

export function getPlanActionPackage() {
  return planData()?.action_package ?? null;
}

export function getAct8PlanningItems(meta = getPlanMeta(), scene = getPlanScene()) {
  if (isLiveMode()) {
    requireLiveFields(meta, ['short_name'], 'plan_meta');
  }
  const name = meta?.short_name;
  if (!name) {
    if (isLiveMode()) failLivePipeline('Live Act8 缺少方案短名');
    return [];
  }
  const dir = scene?.target?.direction || '';
  const mov = scene?.target?.movement || '直行';
  const approach = approachLabelFromDirection(dir, getSpatialScene()?.axis_roads || null);
  return [
    '承接策略包：小步增绿试运行',
    '梳理候选与否决路径',
    `落到${approach}${mov}作用点`,
    `生成可下发方案：${name}`,
  ].map(sanitizeUserFacingCopy);
}

export function getAct8AnalysisSteps(scene = getPlanScene()) {
  const steps = scene?.analysis_steps || [];
  return steps.map((s) => formatReasoningStep(s)).filter(Boolean);
}

export function getAct8Conclusion(meta = getPlanMeta(), scene = getPlanScene()) {
  // 方案切片未到（前序幕口播建槽）→ 软返回；切片已到才硬校验
  if (!meta && !scene) return '';
  if (isLiveMode()) {
    requireLiveFields(meta, ['short_name'], 'plan_meta');
    requireLiveFields(scene?.timing, ['target_green_delta_s', 'donor_green_delta_s'], 'plan_scene.timing');
  }
  const name = meta?.short_name;
  const plus = scene?.timing?.target_green_delta_s;
  const minus = scene?.timing?.donor_green_delta_s;
  if (!name || plus == null || minus == null) {
    if (isLiveMode()) failLivePipeline('Live Act8 结论缺少方案秒数');
    return '';
  }
  const dir = scene?.target?.direction || '';
  const mov = scene?.target?.movement || '直行';
  const flowLabel = [dir, mov].filter(Boolean).join('') || '目标流向';
  const fmtDelta = (v) => (Number(v) > 0 ? `+${v}` : `${v}`);
  return (
    `试运行方案可下发：${name}。` +
    `${flowLabel} ${fmtDelta(plus)}s，非目标最长相位 ${fmtDelta(minus)}s，周期不变；` +
    `试运行周期与下游监测条件见方案抽屉。`
  );
}

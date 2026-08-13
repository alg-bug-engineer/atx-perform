/**
 * 将后端 RunResponse / phases 映射为前端 case-a 切片形状。
 * 保留上屏中文纪律：机制码翻译、Act7 剔除秒数。
 */

const PACKAGE_DISPLAY = {
  incremental_release: '小步增绿试运行',
  incremental_release_trial: '小步增绿试运行',
  conditional_incremental_release: '小步增绿试运行',
  downstream_protection: '下游保护',
  arterial_coordination: '干线联控',
  aggressive_retiming: '激进大幅加绿',
};

const MECHANISM_LABEL = {
  discharge_anomaly: '放行效率异常',
  upstream_arrival_pressure: '上游到达压力',
  downstream_blocked: '下游受阻',
  channelization_bottleneck: '渠化瓶颈',
};

const SEC_PATTERN = /(\+|−|-)?\d+\s*s|试运行\s*\d+\s*周期|\+\d+秒|−\d+秒|-\d+秒/gi;

/** 从 intent.spatial_scene / ticket 取进口臂字段，禁止各 Act 切片丢方向后回退 Case A */
function resolveEntryTargetFields(snapshot, ticket = {}, extra = {}) {
  const intentTarget = snapshot?.phases?.intent?.spatial_scene?.target || {};
  return {
    direction: extra.direction || intentTarget.direction || ticket.direction || null,
    movement: extra.movement || intentTarget.movement || ticket.movement || null,
    north_arm_angle:
      extra.north_arm_angle
      ?? intentTarget.north_arm_angle
      ?? null,
  };
}


/** @param {unknown} text */
function stripSeconds(text) {
  if (typeof text !== 'string') return text;
  return text.replace(SEC_PATTERN, (m) => {
    if (/周期/.test(m)) return '试运行周期数详见方案';
    return '秒数详见方案';
  });
}

/** @param {unknown} value */
function deepStripSeconds(value) {
  if (typeof value === 'string') return stripSeconds(value);
  if (Array.isArray(value)) return value.map(deepStripSeconds);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (/delta_s|_s$|cycles|green_delta|cycle_delta/i.test(k) && typeof v === 'number') {
        continue;
      }
      out[k] = deepStripSeconds(v);
    }
    return out;
  }
  return value;
}

/**
 * 从 cause.case_cards 拼「案例借鉴」文案，供 Act8 整体结论区展示。
 * 优先用新推荐引擎综合 Top1–3 的 advice；无 advice 时回退首条 case_takeaway。
 * 不展示 case_id，统一为「借鉴{案例名}案例：…」。
 * @param {Record<string, unknown>|null|undefined} cause
 */
function caseCardDisplayName(card) {
  return String(card?.short_name || card?.title || '').trim();
}

/** @param {Array<Record<string, unknown>>} cards */
function buildCaseIdLookup(cards) {
  const map = new Map();
  for (const c of cards) {
    if (c?.case_id == null) continue;
    const name = caseCardDisplayName(c);
    if (name) map.set(String(c.case_id), name);
  }
  return map;
}

/** Act8「案例借鉴」展示字数上限 */
const CASE_REFERENCE_MAX = 96;

/** 将 advice 中的「案例440」「借鉴案例1」等替换为具体案例名 */
function humanizeCaseMentions(text, lookup, fallbackName) {
  let s = String(text || '').trim();
  if (!s) return '';

  s = s.replace(/(?:借鉴|参考)\s*案例\s*(\d+)/gi, (_, id) => {
    const name = lookup.get(id) || fallbackName;
    return name ? `借鉴${name}案例` : '借鉴相似案例';
  });

  s = s.replace(/案例\s*(\d+)/g, (_, id) => {
    const name = lookup.get(id);
    return name || fallbackName || '相似案例';
  });

  return s;
}

/** 口语 → 政务表述（案例借鉴上屏） */
function formalizeGovAdvice(text, lookup, topName) {
  let s = humanizeCaseMentions(text, lookup, topName);
  if (!s) return '';

  const replacers = [
    [/(?<!建议)优先(?=评估|核验|尝试)/g, '建议优先'],
    [/避免单向甩锅/g, '避免加剧下游拥堵风险'],
    [/你(?=路口|需|无|的)/g, '本'],
    [/其核心约束红线[：:]/g, '回滚约束：'],
    [/核心约束红线[：:]/g, '回滚约束：'],
    [/立即(?=终止|恢复)/g, '及时'],
    [/帮忙看看/g, ''],
    [/抠点绿/g, '小步增绿'],
    [/甩锅/g, '转移拥堵'],
  ];
  for (const [pattern, replacement] of replacers) {
    s = s.replace(pattern, replacement);
  }

  return s.replace(/\s+/g, ' ').replace(/,,+/g, '，').replace(/建议建议+/g, '建议').trim();
}

function buildCaseReferenceNote(cause) {
  const raw = cause?.case_cards;
  const bundle = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const cards = (Array.isArray(bundle.cards) ? bundle.cards : (Array.isArray(raw) ? raw : []))
    .filter((c) => c && typeof c === 'object' && c.case_id != null);
  if (!cards.length) return '';

  const topName = caseCardDisplayName(cards[0]) || '相似历史';
  const lookup = buildCaseIdLookup(cards);

  const adviceLines = (Array.isArray(bundle.advice) ? bundle.advice : [])
    .map((a) => formalizeGovAdvice(a, lookup, topName))
    .filter(Boolean);

  let body = adviceLines.find((l) => /下游|监测|试运行|承载|回滚/.test(l))
    || adviceLines[0]
    || formalizeGovAdvice(cards[0]?.lesson, lookup, topName)
    || '';

  if (!body) return '';

  // 去掉正文里重复的「借鉴…案例：」前缀，统一由外层包装
  body = body.replace(/^借鉴[^：:，,]{1,24}案例[：:，,]?/, '');
  body = body.replace(/^建议+/g, '建议');

  let tip = `已参考相似案例库，借鉴${topName}等相似案例：${body}`;
  if (tip.length > CASE_REFERENCE_MAX) {
    const cut = tip.slice(0, CASE_REFERENCE_MAX);
    const punct = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('；'), cut.lastIndexOf('，'));
    tip = (punct >= CASE_REFERENCE_MAX * 0.55 ? cut.slice(0, punct + 1) : cut.replace(/[^。；，]$/, '')) + '…';
  }

  return tip;
}

/** @param {string|null|undefined} code */
function mechanismLabel(code) {
  if (!code) return null;
  return MECHANISM_LABEL[code] || code;
}

/** @param {...unknown} values */
function pickMetricNumber(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/**
 * 可选比值类指标：缺数 → null（禁止把后端占位 0.0 当真实饱和度上屏）。
 * @param {unknown} value
 * @param {boolean|undefined|null} availableFlag metrics_available；false 强制 null
 */
function optionalRatioMetric(value, availableFlag) {
  if (availableFlag === false) return null;
  const n = pickMetricNumber(value);
  if (n == null) return null;
  // 后端 metrics_for_diagnosis 对缺失饱和度写 0.0；无正值则按缺数
  if (n <= 0) return null;
  return n;
}

/**
 * 可选利用率：缺或 ≤0 → null（不硬失败、不上屏假 0）。
 * @param {unknown} value
 */
function optionalUtilizationMetric(value) {
  const n = pickMetricNumber(value);
  if (n == null || n <= 0) return null;
  return n;
}

/**
 * @param {Record<string, unknown>|null|undefined} snapshot
 * @returns {Record<string, unknown>|null}
 */
export function adaptIntentSlice(snapshot) {
  if (!snapshot) return null;
  const intent = snapshot.phases?.intent;
  if (!intent && !snapshot.diagnosis_ticket) return null;
  const scene = enrichIntentSpatialScene(
    intent?.spatial_scene || null,
    snapshot,
  );
  return {
    diagnosis_ticket: snapshot.diagnosis_ticket || intent?.diagnosis_ticket || null,
    user_experiences: intent?.user_experiences || [],
    spatial_objects: intent?.spatial_objects || null,
    spatial_scene: scene,
  };
}

/**
 * 对齐 Case A fixture / 后端 response_builder：
 * intent.spatial_scene 缺上下游或渠化时，从 diagnosis.topology / map_scenes 回填。
 * @param {Record<string, unknown>|null} scene
 * @param {Record<string, unknown>} snapshot
 */
function enrichIntentSpatialScene(scene, snapshot) {
  if (!scene || typeof scene !== 'object') return scene;
  const diagnosis = snapshot?.phases?.diagnosis;
  if (!diagnosis || typeof diagnosis !== 'object') return scene;

  const out = { ...scene };
  const mapScenes = diagnosis.map_scenes || {};
  const ch = mapScenes.channelization_map;
  const existingCh = out.channelization_map;
  if (
    ch?.available
    && !(existingCh?.available && (existingCh.links || []).length)
  ) {
    out.channelization_map = ch;
  }

  const topo = diagnosis.topology || {};
  const needUp = !(out.upstream_nodes || []).length;
  const needDown = !(out.downstream_nodes || []).length;
  if ((needUp || needDown) && ((topo.upstream_nodes || []).length || (topo.downstream_nodes || []).length)) {
    if (needUp) {
      out.upstream_nodes = (topo.upstream_nodes || []).map((node) => ({
        inter_id: node.upstream_inter_id || node.inter_id,
        inter_name: node.upstream_inter_name || node.inter_name,
        lng: node.upstream_lng ?? node.lng ?? null,
        lat: node.upstream_lat ?? node.lat ?? null,
        path: node.path || null,
        role: 'upstream',
      }));
    }
    if (needDown) {
      out.downstream_nodes = (topo.downstream_nodes || []).map((node) => ({
        inter_id: node.inter_id,
        inter_name: node.inter_name,
        lng: node.lng ?? null,
        lat: node.lat ?? null,
        path: node.path || null,
        role: 'downstream',
      }));
    }
    if (Array.isArray(out.recognition_steps)) {
      out.recognition_steps = out.recognition_steps.map((step) => (
        step?.step === 'topology' ? { ...step, status: 'done' } : step
      ));
    }
  }
  return out;
}

/**
 * @param {Record<string, unknown>|null|undefined} snapshot
 */
/**
 * 解析溢出切片目标路口名。
 * 后端 diagnosis.target 用 `intersection`，profile 用 `inter_name`；二者需兼容。
 */
function resolveOverflowTargetName(snapshot, diagnosis, ticket) {
  const targetMeta = diagnosis?.target && typeof diagnosis.target === 'object'
    ? diagnosis.target
    : {};
  const targetProfile = diagnosis?.target_intersection && typeof diagnosis.target_intersection === 'object'
    ? diagnosis.target_intersection
    : {};
  const intent = snapshot?.phases?.intent;
  const intentTarget = intent?.spatial_scene?.target || {};
  const spatialName = intent?.spatial_objects?.target_intersection;
  const candidates = [
    targetMeta.inter_name,
    targetMeta.intersection,
    targetProfile.inter_name,
    ticket?.intersection_name,
    intentTarget.inter_name,
    typeof spatialName === 'string' ? spatialName : null,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function adaptOverflowSlice(snapshot) {
  const diagnosis = snapshot?.phases?.diagnosis;
  if (!diagnosis) return null;
  const metrics = diagnosis.metrics || {};
  const ov = diagnosis.overflow_verification || {};
  const intent = snapshot.phases?.intent;
  const ticket = snapshot.diagnosis_ticket || intent?.diagnosis_ticket || {};
  const targetMeta = diagnosis.target && typeof diagnosis.target === 'object'
    ? diagnosis.target
    : {};
  const targetProfile = diagnosis.target_intersection && typeof diagnosis.target_intersection === 'object'
    ? diagnosis.target_intersection
    : {};
  const armFields = resolveEntryTargetFields(snapshot, ticket, {
    direction: targetMeta.direction || targetProfile.direction,
    movement: targetMeta.movement || targetProfile.movement,
    north_arm_angle: targetMeta.north_arm_angle ?? targetProfile.north_arm_angle,
  });
  const interName = resolveOverflowTargetName(snapshot, diagnosis, ticket);

  // 对齐参考/后端 profile：兼容 avg_queue_m 等别名，缺 queue_ratio 时用长度回算
  const queueLength = pickMetricNumber(
    metrics.queue_length_m,
    metrics.avg_queue_m,
    metrics.max_queue_m,
    metrics.queue_m,
    metrics.movement_queue_length_m,
  );
  const storageLength = pickMetricNumber(
    metrics.storage_length_m,
    metrics.storage_m,
  );
  let queueRatio = pickMetricNumber(
    metrics.queue_ratio,
    metrics.queue_storage_ratio_max,
    metrics.spillback_risk_max,
  );
  if (queueRatio == null && queueLength != null && storageLength != null && storageLength > 0) {
    queueRatio = queueLength / storageLength;
  }

  const riskLevel = ov.risk_level || metrics.risk_level || null;
  const problemConfirmed = diagnosis.problem_confirmed === true
    || riskLevel === 'warning'
    || riskLevel === 'high';
  let verdictDetail = ov.message || '核验完成';
  let verdictAnchor = '核验完成';
  if (riskLevel === 'low') {
    verdictAnchor = '溢出风险较低';
    verdictDetail = ov.message || '排队尚在进口道可容纳范围内，不构成需治理溢出';
  } else if (problemConfirmed) {
    verdictAnchor = '溢出预警成立';
    verdictDetail = '溢出预警成立 · 问题成立';
  } else if (riskLevel === 'unknown' || ov.verified === false) {
    verdictAnchor = '证据不足';
    verdictDetail = ov.message || '排队/蓄车指标不完整，记入数据缺口';
  }

  return {
    overflow_metrics: {
      queue_length_m: queueLength,
      storage_length_m: storageLength,
      queue_ratio: queueRatio,
      storage_direction: metrics.storage_direction || null,
      risk_level: riskLevel,
      verified: ov.verified ?? null,
      message: ov.message || null,
    },
    problem_confirmed: problemConfirmed,
    overflow_scene: {
      available: true,
      verification_steps: [
        { step: 'push_in', status: 'done', label: '聚焦问题进口道', detail: '沿干线进入进口核验' },
        {
          step: 'storage',
          status: 'done',
          label: '量测蓄车空间边界',
          detail: storageLength != null ? `蓄车长度 ${storageLength} m` : '',
        },
        {
          step: 'queue',
          status: 'done',
          label: '量测排队范围',
          detail: queueLength != null ? `排队长度 ${queueLength} m` : '',
        },
        {
          step: 'ratio',
          status: 'done',
          label: '计算排队比',
          detail: queueRatio != null ? `排队比 ${queueRatio}` : '',
        },
        {
          step: 'verdict',
          status: 'done',
          label: '溢出核验结论',
          detail: verdictDetail,
        },
      ],
      target: {
        inter_id: targetMeta.inter_id || targetProfile.inter_id || ticket.inter_id || null,
        inter_name: interName,
        lng: targetMeta.lng ?? targetProfile.lng ?? ticket.lng ?? null,
        lat: targetMeta.lat ?? targetProfile.lat ?? ticket.lat ?? null,
        direction: armFields.direction,
        movement: armFields.movement,
        north_arm_angle: armFields.north_arm_angle,
      },
      whitelist_metric_keys: ['queue_length_m', 'storage_length_m', 'queue_ratio'],
      forbidden_metric_keys: ['green_utilization', 'saturation', 'stop_count', 'avg_delay_s', 'los'],
      verdict_anchor: verdictAnchor,
      verdict_detail: ov.message || verdictDetail,
    },
  };
}

/**
 * @param {Record<string, unknown>|null|undefined} snapshot
 */
export function adaptBottleneckSlice(snapshot) {
  const diagnosis = snapshot?.phases?.diagnosis;
  if (!diagnosis) return null;
  const metrics = diagnosis.metrics || {};
  const mechanism = diagnosis.overflow_mechanism || {};
  const downstream = diagnosis.downstream_state || {};
  const compare = diagnosis.map_scenes?.diagnosis_compare || {};
  const ticket = snapshot.diagnosis_ticket || {};
  const armFields = resolveEntryTargetFields(snapshot, ticket);

  const primary = mechanism.primary || null;
  const primaryLabel = mechanism.primary_label || mechanismLabel(primary) || null;

  const ba = diagnosis.bottleneck_analysis || {};
  const compareTargetRaw = compare.target || null;
  const compareDownstreamRaw = compare.downstream || null;
  const metricsAvailable = metrics.metrics_available;
  const dsMetricsAvailable = compareDownstreamRaw?.metrics_available
    ?? downstream.metrics_available;
  const compareTarget = compareTargetRaw
    ? {
        ...compareTargetRaw,
        queue_length_m: pickMetricNumber(
          compareTargetRaw.queue_length_m,
          compareTargetRaw.metrics?.queue_length_m,
          metrics.queue_length_m,
        ),
        green_utilization: optionalUtilizationMetric(
          compareTargetRaw.green_utilization
          ?? compareTargetRaw.metrics?.green_utilization
          ?? metrics.green_utilization,
        ),
        queue_ratio: pickMetricNumber(
          compareTargetRaw.queue_ratio,
          compareTargetRaw.metrics?.queue_ratio,
          metrics.queue_ratio,
        ),
        saturation: optionalRatioMetric(
          compareTargetRaw.saturation
          ?? compareTargetRaw.metrics?.saturation
          ?? metrics.saturation,
          metricsAvailable,
        ),
      }
    : null;
  const compareDownstream = compareDownstreamRaw
    ? {
        ...compareDownstreamRaw,
        queue_length_m: pickMetricNumber(
          compareDownstreamRaw.queue_length_m,
          compareDownstreamRaw.metrics?.queue_length_m,
          downstream.queue_length_m,
        ),
        remaining_storage_m: pickMetricNumber(
          compareDownstreamRaw.remaining_storage_m,
          downstream.remaining_storage_m,
        ),
        queue_ratio: pickMetricNumber(
          compareDownstreamRaw.queue_ratio,
          compareDownstreamRaw.metrics?.queue_ratio,
          downstream.queue_ratio,
        ),
        saturation: optionalRatioMetric(
          compareDownstreamRaw.saturation
          ?? compareDownstreamRaw.metrics?.saturation
          ?? downstream.saturation,
          dsMetricsAvailable,
        ),
      }
    : null;
  return {
    bottleneck_analysis: {
      ...ba,
      can_incremental_green: ba.can_incremental_green
        ?? (ba.can_simple_add_green === false && downstream.can_release !== false),
    },
    downstream_state: {
      ...downstream,
      decision_label: downstream.decision_label
        || (downstream.decision === 'slack' || downstream.can_release
          ? '有承接余量'
          : (downstream.blocked ? '下游受阻' : null)),
    },
    overflow_mechanism: {
      ...mechanism,
      primary_label: primaryLabel,
      secondary_label: mechanism.secondary_label || mechanismLabel(mechanism.secondary),
    },
    compare_metrics: {
      target: compareTarget,
      downstream: compareDownstream,
    },
    branch_scene: {
      available: Boolean(
        (ticket.lng != null && ticket.lat != null)
        || (diagnosis.target?.lng != null && diagnosis.target?.lat != null),
      ),
      branch_steps: [
        { step: 'compare', status: 'done', label: '本口与下游对照', detail: '绿灯利用率与下游余量' },
        { step: 'mechanism', status: 'done', label: '机制分支', detail: primaryLabel || '' },
        {
          step: 'trial',
          status: 'done',
          label: '小步增绿条件',
          detail: downstream.can_release !== false ? '下游有余量，可试运行' : '条件不足',
        },
      ],
      target: {
        inter_id: ticket.inter_id || diagnosis.target?.inter_id || null,
        inter_name: ticket.intersection_name || diagnosis.target?.intersection || diagnosis.target?.inter_name || null,
        lng: ticket.lng ?? diagnosis.target?.lng ?? null,
        lat: ticket.lat ?? diagnosis.target?.lat ?? null,
        direction: armFields.direction,
        movement: armFields.movement,
        north_arm_angle: armFields.north_arm_angle,
      },
      downstream: {
        inter_id: downstream.direct_downstream_inter_id || compareDownstreamRaw?.inter_id || null,
        inter_name: downstream.direct_downstream_inter_name || compareDownstreamRaw?.inter_name || null,
        lng: downstream.lng ?? compareDownstreamRaw?.lng ?? null,
        lat: downstream.lat ?? compareDownstreamRaw?.lat ?? null,
      },
      downstream_remaining_storage_m: pickMetricNumber(
        downstream.remaining_storage_m,
        compareDownstreamRaw?.remaining_storage_m,
      ),
    },
  };
}

/**
 * @param {Record<string, unknown>|null|undefined} snapshot
 */
/** 将后端三问规范为左栏契约 {id,label,answer,detail,tone} */
function normalizeThreeQuestions(raw) {
  if (!Array.isArray(raw) || !raw.length) return null;
  return raw.map((q, i) => {
    if (!q || typeof q !== 'object') return null;
    const label = q.label || q.q || '';
    const answer = q.answer || q.a || '';
    if (!label && !answer) return null;
    return {
      id: q.id || `q_${i}`,
      label,
      answer,
      detail: q.detail || '',
      tone: q.tone || 'ok',
    };
  }).filter(Boolean);
}

function intensityDetail(analysis = {}) {
  return analysis.upstream_arrival_intensity_label
    || (analysis.upstream_arrival_intensity === 'high' ? '偏高（次因）' : '')
    || analysis.upstream_arrival_intensity
    || '';
}

/** Live 推理步骤：先溯源 → 再上游压力 → 最后干线结论（与 Mock / 地图节拍一致） */
function buildArterialAnalysisSteps(analysis = {}) {
  return [
    {
      step: 'spread_on',
      status: 'done',
      label: '开启流量溯源上溯',
      detail: '目标口为锚 · 沿结构边向上游蔓延',
    },
    {
      step: 'north_expand',
      status: 'done',
      label: '上游到达压力',
      detail: intensityDetail(analysis),
    },
    {
      step: 'no_metering',
      status: 'done',
      label: '干线结论',
      detail: analysis.verdict || '',
    },
  ];
}

export function adaptArterialSlice(snapshot) {
  const diagnosis = snapshot?.phases?.diagnosis;
  if (!diagnosis) return null;
  const analysis = diagnosis.arterial_analysis || {};
  const coordination = diagnosis.coordination || {};
  const threeQuestions = normalizeThreeQuestions(diagnosis.three_questions);
  if (!threeQuestions?.length) {
    // Live 严禁前端伪造三问；由后端 diagnosis.three_questions 提供
    return {
      arterial_analysis: analysis,
      coordination,
      three_questions: null,
      arterial_scene: {
        available: Boolean(analysis?.verdict),
        analysis_steps: buildArterialAnalysisSteps(analysis),
      },
    };
  }
  return {
    arterial_analysis: analysis,
    coordination,
    three_questions: threeQuestions,
    arterial_scene: {
      available: true,
      analysis_steps: buildArterialAnalysisSteps(analysis),
    },
  };
}

/**
 * @param {Record<string, unknown>|null|undefined} snapshot
 */
/**
 * 合并 segment_coverage 节点（坐标/流量）与 sniff 节点（role/hop/廊道）。
 * 仅用 seg 会丢掉 role/hop → Act5 北扩镜头塌缩到路口特写。
 */
function mergeFlowTraceNodes(seg = {}, sniff = {}) {
  const segInters = seg.intersections || [];
  const sniffInters = sniff.intersections || [];
  const sniffById = new Map();
  for (const n of sniffInters) {
    const id = n.inter_id || n.id;
    if (id) sniffById.set(id, n);
  }

  const nodesById = new Map();
  for (const n of segInters) {
    const id = n.inter_id || n.id;
    if (!id) continue;
    const sn = sniffById.get(id);
    const lng = n.lng ?? (Array.isArray(n.center) ? n.center[0] : null)
      ?? (Array.isArray(sn?.center) ? sn.center[0] : null);
    const lat = n.lat ?? (Array.isArray(n.center) ? n.center[1] : null)
      ?? (Array.isArray(sn?.center) ? sn.center[1] : null);
    nodesById.set(id, {
      id,
      name: n.name || n.inter_name || sn?.name || '',
      lng: lng ?? null,
      lat: lat ?? null,
      role: sn?.role || n.role || null,
      hop: sn?.corridor_hop ?? sn?.hop ?? n.hop ?? null,
      coverage: sn?.path_coverage ?? (n.ratio != null ? n.ratio * 100 : null),
      in_main_corridor: Boolean(sn?.in_main_corridor),
    });
  }
  for (const n of sniffInters) {
    const id = n.inter_id || n.id;
    if (!id || nodesById.has(id)) continue;
    nodesById.set(id, {
      id,
      name: n.name || n.inter_name || '',
      lng: Array.isArray(n.center) ? n.center[0] : (n.lng ?? null),
      lat: Array.isArray(n.center) ? n.center[1] : (n.lat ?? null),
      role: n.role || null,
      hop: n.corridor_hop ?? n.hop ?? null,
      coverage: n.path_coverage ?? null,
      in_main_corridor: Boolean(n.in_main_corridor),
    });
  }

  // 主廊道 hop 回填：保证镜头/波前种子能拿到远端节点
  for (const hop of sniff.main_corridor_chain || seg.main_corridor_chain || []) {
    if (!hop?.inter_id) continue;
    const cur = nodesById.get(hop.inter_id);
    if (!cur) {
      nodesById.set(hop.inter_id, {
        id: hop.inter_id,
        name: hop.name || '',
        lng: null,
        lat: null,
        role: 'upstream',
        hop: hop.hop ?? null,
        coverage: hop.coverage ?? null,
        in_main_corridor: true,
      });
      continue;
    }
    if (cur.role == null) cur.role = 'upstream';
    if (cur.hop == null && hop.hop != null) cur.hop = hop.hop;
    if (cur.coverage == null && hop.coverage != null) cur.coverage = hop.coverage;
    if (!cur.name && hop.name) cur.name = hop.name;
    cur.in_main_corridor = true;
  }

  return [...nodesById.values()].filter((n) => n.id);
}

/**
 * 展平 sniff 嵌套 link（真实路网折线）供 Act5 吸附/桥接复用，避免直线飞线。
 * @param {Record<string, unknown>} sniff
 */
function flattenSniffLinks(sniff = {}) {
  const out = [];
  const seen = new Set();
  for (const inter of sniff.intersections || []) {
    const hostId = inter.inter_id || inter.id;
    if (!hostId) continue;
    for (const link of inter.links || []) {
      const path = link.path || link.coords;
      if (!Array.isArray(path) || path.length < 2) continue;
      const linkId = link.link_id || link.id || `sniff:${hostId}:${out.length}`;
      const dedupe = `${linkId}|${hostId}|${link.link_role || ''}|${link.adjacent_inter_id || ''}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);

      const adjId = link.adjacent_inter_id || null;
      // entrance：邻口 → 本口；exit：本口 → 邻口
      const isEntrance = link.link_role === 'entrance';
      const fromId = isEntrance ? (adjId || null) : hostId;
      const toId = isEntrance ? hostId : (adjId || null);
      const coverage = link.path_coverage ?? inter.path_coverage;
      out.push({
        id: linkId,
        name: link.road_name || link.name || inter.name || '',
        coords: path.map((p) => [p[0], p[1]]),
        path: path.map((p) => [p[0], p[1]]),
        from_inter_id: fromId,
        to_inter_id: toId,
        ratio: typeof coverage === 'number' ? Math.max(0.05, coverage / 100) : 0.35,
        source: 'sniff',
        link_role: link.link_role || null,
      });
    }
  }
  return out;
}

/**
 * seg 结构边优先，再补 sniff 真实折线（按 id 去重）。
 * @param {Record<string, unknown>} seg
 * @param {Record<string, unknown>} sniff
 */
function mergeFlowTraceLinks(seg = {}, sniff = {}) {
  const out = [];
  const seen = new Set();
  for (const link of seg.links || []) {
    const id = link.id || link.link_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(link);
  }
  for (const link of flattenSniffLinks(sniff)) {
    // sniff 与 seg 常共享 link_id；已有 seg 几何则跳过，避免重复边
    if (link.id && seen.has(link.id)) continue;
    if (link.id) seen.add(link.id);
    out.push(link);
  }
  return out;
}

export function adaptFlowTraceSlice(snapshot) {
  const diagnosis = snapshot?.phases?.diagnosis;
  if (!diagnosis) return null;
  const ms = diagnosis.map_scenes || {};
  const seg = ms.flow_trace_segment_coverage_map || {};
  const sniff = ms.flow_trace_links_sniff_map || {};
  if (!seg.available && !sniff.available && !(seg.links || []).length) return null;

  const nodes = mergeFlowTraceNodes(seg, sniff);
  const links = mergeFlowTraceLinks(seg, sniff);
  const ticket = snapshot.diagnosis_ticket || {};
  const targetFromSeg = seg.target || {};
  return {
    available: true,
    trace_direction: sniff.trace_direction || seg.trace_direction || 'upstream',
    business_direction: sniff.business_direction || seg.business_direction || 'incoming',
    title: sniff.title || '来向溯源',
    logic: sniff.logic || '',
    target: {
      // segment_coverage.target 使用 id（非 inter_id）
      id: targetFromSeg.id || targetFromSeg.inter_id || sniff.target_inter_id || ticket.inter_id,
      name: targetFromSeg.name || targetFromSeg.inter_name || ticket.intersection_name,
      lng: targetFromSeg.lng ?? (Array.isArray(seg.center) ? seg.center[0] : ticket.lng),
      lat: targetFromSeg.lat ?? (Array.isArray(seg.center) ? seg.center[1] : ticket.lat),
      direction: ticket.direction,
      movement: ticket.movement,
    },
    main_corridor_chain: sniff.main_corridor_chain || seg.main_corridor_chain || [],
    nodes,
    links,
    entry_traces: diagnosis.flow_trace?.entry_traces || [],
    problem_turns: diagnosis.flow_trace?.problem_turns || [],
  };
}

/**
 * 从 topology / cause_spatial / downstream_state 解析成因幕上下游锚点。
 * 禁止把上下游坐标静默回退到目标口（否则 Act6 次因/下游光晕叠在主因钉上）。
 * @param {Record<string, unknown>} snapshot
 * @param {'upstream'|'downstream'} role
 */
function resolveCauseNeighbor(snapshot, role) {
  const diagnosis = snapshot?.phases?.diagnosis || {};
  const ticket = snapshot?.diagnosis_ticket || {};
  const topo = diagnosis.topology || {};
  const scene = diagnosis.map_scenes?.cause_spatial || {};
  const annotations = Array.isArray(scene.annotations) ? scene.annotations : [];
  const ds = diagnosis.downstream_state || {};
  const compareDs = diagnosis.map_scenes?.diagnosis_compare?.downstream || {};
  const spatial = snapshot?.phases?.intent?.spatial_scene || {};

  if (role === 'upstream') {
    const fromTopo = (topo.upstream_nodes || [])[0] || null;
    const fromSpatial = (spatial.upstream_nodes || [])[0] || null;
    const fromAnno = annotations.find((a) => a?.kind === 'upstream' || a?.role === 'upstream') || null;
    const src = fromTopo || fromSpatial || fromAnno;
    if (!src) return null;
    const lng = src.upstream_lng ?? src.lng ?? null;
    const lat = src.upstream_lat ?? src.lat ?? null;
    if (lng == null || lat == null) return null;
    // 与目标口重合则视为无效，避免叠环
    if (ticket.lng != null && ticket.lat != null
      && Math.abs(Number(lng) - Number(ticket.lng)) < 1e-6
      && Math.abs(Number(lat) - Number(ticket.lat)) < 1e-6) {
      return null;
    }
    return {
      inter_id: src.upstream_inter_id || src.inter_id || null,
      inter_name: src.upstream_inter_name || src.inter_name || src.label || null,
      lng: Number(lng),
      lat: Number(lat),
      role: 'upstream',
      pressure: src.pressure || 'high',
    };
  }

  const fromTopo = (topo.downstream_nodes || [])[0] || null;
  const fromSpatial = (spatial.downstream_nodes || [])[0] || null;
  const fromAnno = annotations.find((a) => a?.kind === 'downstream' || a?.role === 'downstream') || null;
  const lng = ds.lng ?? compareDs.lng ?? fromTopo?.lng ?? fromSpatial?.lng ?? fromAnno?.lng ?? null;
  const lat = ds.lat ?? compareDs.lat ?? fromTopo?.lat ?? fromSpatial?.lat ?? fromAnno?.lat ?? null;
  if (lng == null || lat == null) return null;
  if (ticket.lng != null && ticket.lat != null
    && Math.abs(Number(lng) - Number(ticket.lng)) < 1e-6
    && Math.abs(Number(lat) - Number(ticket.lat)) < 1e-6) {
    return null;
  }
  return {
    inter_id: ds.direct_downstream_inter_id || compareDs.inter_id || fromTopo?.inter_id
      || fromSpatial?.inter_id || fromAnno?.inter_id || null,
    inter_name: ds.direct_downstream_inter_name || compareDs.inter_name || fromTopo?.inter_name
      || fromSpatial?.inter_name || fromAnno?.label || fromAnno?.inter_name || null,
    lng: Number(lng),
    lat: Number(lat),
    role: 'downstream',
    decision: ds.decision || null,
  };
}

/**
 * 成因地图标签：优先用诊断指标，禁止写死 Case A 数值。
 * @param {Record<string, unknown>} snapshot
 * @param {Record<string, unknown>} analysis
 * @param {Record<string, unknown>|null} upstream
 * @param {Record<string, unknown>|null} downstream
 */
function buildCauseMapLabels(snapshot, analysis, upstream, downstream) {
  const diagnosis = snapshot?.phases?.diagnosis || {};
  const metrics = diagnosis.metrics || {};
  const ticket = snapshot?.diagnosis_ticket || {};
  const primary = String(analysis.primary_cause || '').replace(/，待核验$/, '') || '主因待判定';
  const secondary = Array.isArray(analysis.secondary_causes) && analysis.secondary_causes[0]
    ? String(analysis.secondary_causes[0])
    : (mechanismLabel(analysis.overflow_mechanism?.secondary) || '次因');
  const ratio = pickMetricNumber(metrics.queue_ratio);
  const util = pickMetricNumber(metrics.green_utilization);
  const remaining = pickMetricNumber(
    diagnosis.downstream_state?.remaining_storage_m,
    diagnosis.map_scenes?.diagnosis_compare?.downstream?.remaining_storage_m,
  );
  const dir = ticket.direction || '';
  const mov = ticket.movement || '';
  const approach = [dir, mov].filter(Boolean).join('') || '目标进口';
  const dsName = downstream?.inter_name || diagnosis.downstream_state?.direct_downstream_inter_name || '下游路口';
  const upName = upstream?.inter_name || '上游路口';
  const dsDecision = diagnosis.downstream_state?.decision;
  const dsValue = dsDecision === 'blocked' ? '受阻'
    : (dsDecision === 'slack' || diagnosis.downstream_state?.can_release !== false ? '有余量' : '待核验');

  return {
    primary: {
      label: '主因',
      value: primary,
      status: analysis.mechanism_locked ? '已锁定' : '待核验',
      trend: `${approach} · 高排队低放行`,
    },
    ratio: {
      label: '排队比',
      value: ratio != null ? String(Number(ratio).toFixed(2)) : '—',
      status: ratio != null && ratio >= 0.9 ? '预警' : '观测',
      trend: '接近进口道空间边界',
    },
    util: {
      label: '绿利用率',
      value: util != null ? String(Number(util).toFixed(2)) : '—',
      status: util != null && util < 0.5 ? '偏低' : '观测',
      trend: '绿灯给了也用不上',
    },
    upstream: {
      label: '次因',
      value: secondary.replace(/交通需求压力/, '需求压力'),
      status: '偏高',
      trend: `${upName} · 到达偏高`,
    },
    downstream: {
      label: '下游',
      value: dsValue,
      status: dsDecision === 'blocked' ? '需保护' : '可承接',
      trend: remaining != null ? `${dsName} · 约 ${Math.round(remaining)} m` : dsName,
    },
    verdict: {
      label: '结论',
      value: analysis.mechanism_locked ? '机制已锁定' : '机制待核验',
      status: '可进入策略',
      trend: analysis.strategy_hint || '宜小步 · 可回滚 · 先监测下游',
    },
  };
}

/**
 * @param {Record<string, unknown>|null|undefined} snapshot
 */
export function adaptCauseSlice(snapshot) {
  const cause = snapshot?.phases?.cause;
  if (!cause) return null;
  const analysis = { ...(cause.cause_analysis || {}) };
  const scene = snapshot.phases?.diagnosis?.map_scenes?.cause_spatial || {};
  const mechanism = analysis.overflow_mechanism || cause.overflow_mechanism
    || snapshot.phases?.diagnosis?.overflow_mechanism || {};
  let strategyHint = analysis.strategy_hint || cause.strategy_hint || null;
  if (!strategyHint) {
    const byMech = {
      discharge_anomaly: '小步、可回滚、先监测下游',
      local_release_insufficient: '小步增绿、可回滚、同步监测下游',
      downstream_blocked: '先保护下游，再评估上游控流',
      upstream_arrival_shock: '评估上游控流与干线协同',
      evidence_insufficient: '先补证据，禁止未核验下发',
    };
    strategyHint = byMech[mechanism?.primary] || '按证据与机制选择可回滚策略';
  }
  if (!analysis.primary_cause && mechanism?.primary_label) {
    analysis.primary_cause = mechanism.primary_label;
  } else if (!analysis.primary_cause && mechanism?.primary) {
    const labels = {
      discharge_anomaly: '放行效率异常，待核验',
      local_release_insufficient: '本路口放行不足',
      downstream_blocked: '下游回堵',
      upstream_arrival_shock: '上游冲击',
      evidence_insufficient: '证据不足，待补充更多证据',
    };
    analysis.primary_cause = labels[mechanism.primary] || mechanism.primary;
  }
  analysis.strategy_hint = strategyHint;
  analysis.overflow_mechanism = mechanism || null;
  const rawCards = cause.case_cards || cause.similar_cases || [];
  const caseCards = Array.isArray(rawCards)
    ? rawCards
    : (Array.isArray(rawCards?.cards) ? rawCards.cards : []);

  const ticket = snapshot.diagnosis_ticket || {};
  const upstream = resolveCauseNeighbor(snapshot, 'upstream');
  const downstream = resolveCauseNeighbor(snapshot, 'downstream');
  const mapLabels = buildCauseMapLabels(snapshot, analysis, upstream, downstream);

  return {
    cause_analysis: {
      ...analysis,
      overflow_mechanism: mechanism || null,
      strategy_hint: strategyHint,
    },
    cause_ranking: cause.cause_ranking || [],
    case_cards: caseCards,
    data_gap_items: analysis.data_gaps || cause.data_gap_items || [],
    cause_scene: {
      available: scene.available !== false,
      primary_cause: scene.primary_cause || analysis.primary_cause,
      annotations: scene.annotations || [],
      analysis_steps: [
        { step: 'evidence', status: 'done', label: '汇总证据', detail: analysis.primary_cause || '' },
        { step: 'cases', status: 'done', label: '案例对照', detail: '经验库检索' },
      ],
      strategy_hint: strategyHint,
      target: {
        inter_id: ticket.inter_id || null,
        lng: ticket.lng ?? null,
        lat: ticket.lat ?? null,
        inter_name: ticket.intersection_name ?? null,
        role: 'target',
        mechanism: mechanism?.primary || null,
      },
      ...(upstream ? { upstream } : {}),
      ...(downstream ? { downstream } : {}),
      map_labels: mapLabels,
      verdict_anchor: analysis.mechanism_locked
        ? `主因锁定：${analysis.primary_cause || ''}`
        : `主因：${analysis.primary_cause || '待判定'}`,
    },
  };
}

/**
 * 从策略短句推断卡片标签（对齐 fixture tag：策略包/借绿/监测/禁忌）。
 * @param {string} text
 * @param {string} fallback
 */
function inferStrategyTag(text, fallback) {
  const t = text || '';
  if (/禁忌|不宜|禁止|勿|不要/.test(t)) return '禁忌';
  if (/监测|回滚/.test(t)) return '监测';
  if (/借绿|调剂/.test(t)) return '借绿';
  if (/试运行|策略包|小步增绿|小步释放/.test(t)) return '策略包';
  if (/组织|渠化|车道/.test(t)) return '组织';
  if (/管理|执法|秩序/.test(t)) return '管理';
  return fallback;
}

/**
 * 后端 skill 产出 string[]；旧 fixture 为卡片对象。统一为 StrategyPanel 契约。
 * @param {unknown} raw
 * @param {{ idPrefix: string, defaultTag: string, defaultConf: number, defaultColor: string, tone: string }} opts
 */
function normalizeStrategyMeasures(raw, opts) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    if (typeof r === 'string') {
      const action = stripSeconds(r.trim());
      if (!action) continue;
      out.push({
        id: `${opts.idPrefix}${i}`,
        // 不推荐列表固定「禁忌」，避免「无监测…」被误判为监测类
        tag: opts.tone === 'reject' ? opts.defaultTag : inferStrategyTag(action, opts.defaultTag),
        target: '',
        action,
        effect: '',
        conf: opts.defaultConf,
        color: opts.defaultColor,
        tone: opts.tone,
      });
      continue;
    }
    if (!r || typeof r !== 'object') continue;
    const action = stripSeconds(
      r.action || r.label || r.name || r.text || r.title || '',
    );
    if (!action) continue;
    out.push({
      id: r.id || `${opts.idPrefix}${i}`,
      tag: r.tag
        || (opts.tone === 'reject' ? opts.defaultTag : inferStrategyTag(action, opts.defaultTag)),
      target: r.target || r.where || '',
      action,
      effect: stripSeconds(r.effect || r.reason || r.detail || ''),
      conf: r.conf ?? r.confidence ?? opts.defaultConf,
      color: r.color || opts.defaultColor,
      tone: r.tone || opts.tone,
    });
  }
  return out;
}

/**
 * Act7：清洗秒数，合成 strategy_meta / principles 等上屏字段。
 * @param {Record<string, unknown>|null|undefined} snapshot
 */
export function adaptStrategySlice(snapshot) {
  const strategyPhase = snapshot?.phases?.strategy;
  if (!strategyPhase) return null;

  const inner = strategyPhase.strategy || {};
  const decision = strategyPhase.decision || {};
  const pkg = strategyPhase.strategy_package
    || decision.strategy_package
    || inner.decision_mode
    || null;
  const decisionMode = strategyPhase.decision_mode
    || decision.decision_mode
    || inner.decision_mode
    || null;

  const recommendedRaw = deepStripSeconds(inner.recommended || strategyPhase.recommended || []);
  const notRecommendedRaw = deepStripSeconds(inner.not_recommended || []);
  const principlesRaw = deepStripSeconds(inner.principles || []);

  const principles = (Array.isArray(principlesRaw) ? principlesRaw : []).map((p, i) => {
    if (typeof p === 'string') {
      return { id: `p${i}`, label: p, detail: '' };
    }
    return {
      id: p.id || `p${i}`,
      label: p.label || p.name || p.title || '原则',
      detail: p.detail || p.description || '',
    };
  });

  // 后端 skill 契约为 string[]；fixture 为卡片对象。二者都要能上屏。
  const recommended = normalizeStrategyMeasures(recommendedRaw, {
    idPrefix: 'r',
    defaultTag: '策略',
    defaultConf: 75,
    defaultColor: '#00e5ff',
    tone: 'recommend',
  });
  const not_recommended = normalizeStrategyMeasures(notRecommendedRaw, {
    idPrefix: 'n',
    defaultTag: '禁忌',
    defaultConf: 0,
    defaultColor: '#888899',
    tone: 'reject',
  });

  const scope = strategyPhase.control_scope_map || {};
  const cause = snapshot?.phases?.cause || {};
  const causeAnalysis = cause.cause_analysis || {};
  const diagnosis = snapshot?.phases?.diagnosis || {};
  const mechanism = causeAnalysis.overflow_mechanism
    || cause.overflow_mechanism
    || diagnosis.overflow_mechanism
    || {};
  const ticket = snapshot?.diagnosis_ticket || {};
  const llmNarrative = stripSeconds(
    causeAnalysis.narrative
    || strategyPhase.narrative
    || inner.narrative
    || '',
  );
  const arterialSummary = stripSeconds(diagnosis.arterial_analysis?.summary || '');
  const packageName = PACKAGE_DISPLAY[pkg] || PACKAGE_DISPLAY[decisionMode] || '治理策略';
  const primaryCause = causeAnalysis.primary_cause || mechanism.primary_label || '';
  const interName = ticket.intersection_name || '目标路口';
  const flow = [ticket.direction, ticket.movement].filter(Boolean).join('') || '目标流向';
  const overallSummary = [
    `问题对象：${interName} ${flow}。`,
    primaryCause ? `成因判定：${primaryCause}。` : '',
    arterialSummary ? `过程分析：${arterialSummary}。` : '',
    llmNarrative ? `证据说明：${llmNarrative}` : '',
    `策略结论：采用「${packageName}」，按可回滚、先看下游的原则推进；具体秒数进入方案幕展开。`,
  ].filter(Boolean).join('');
  const caseReferenceNote = buildCaseReferenceNote(cause);

  return {
    strategy_meta: {
      strategy_package: pkg,
      decision_mode: decisionMode,
      package_display_name: packageName,
      package_scores: strategyPhase.package_scores || {},
      upstream_control: decision.upstream_control ?? false,
      plan_status: decision.plan_status || inner.plan_status || 'trial_ready',
      executable: decision.executable ?? inner.executable ?? true,
      overall_summary: overallSummary,
      case_reference_note: caseReferenceNote || null,
      primary_cause: primaryCause || null,
      narrative: llmNarrative || null,
    },
    principles,
    recommended,
    not_recommended,
    hard_constraints_display: deepStripSeconds(
      inner.hard_constraints || strategyPhase.hard_constraints_display || [],
    ),
    control_scope: {
      available: scope.available !== false,
      center: scope.center || null,
      target_intersection: scope.target_intersection || null,
      upstream_metering_points: scope.upstream_metering_points || [],
      downstream_protection_nodes: scope.downstream_protection_nodes || [],
    },
    strategy_scene: {
      available: true,
      analysis_steps: [
        { step: 'scope', status: 'done', label: '划定控制范围', detail: '' },
        {
          step: 'package',
          status: 'done',
          label: '策略包定调',
          detail: packageName,
        },
      ],
    },
    experience_contrast: deepStripSeconds(strategyPhase.experience_contrast || null),
  };
}

/**
 * @param {Record<string, unknown>|null|undefined} snapshot
 */
/** 从 timing / 阶段 role / phase_changes 提取目标与借绿差（允许负目标绿差）。 */
function resolvePlanTimingDeltas(timing = {}, phaseChanges = []) {
  let targetDelta = timing.target_green_delta_s ?? null;
  let donorDelta = timing.donor_green_delta_s ?? null;
  const stages = [
    ...(timing.phase_stage_timing_list || timing.phaseStageTimingList || []),
    ...(Array.isArray(phaseChanges) ? phaseChanges : []),
  ];
  let positiveDelta = null;
  let negativeDelta = null;
  for (const stage of stages) {
    if (!stage || typeof stage !== 'object') continue;
    const d = stage.green_delta_s ?? stage.delta_s;
    if (typeof d !== 'number') continue;
    if (stage.role === 'target' && targetDelta == null) targetDelta = d;
    if (stage.role === 'donor' && donorDelta == null) donorDelta = d;
    if (d > 0 && positiveDelta == null) positiveDelta = d;
    if (d < 0 && negativeDelta == null) negativeDelta = d;
  }
  // 无摘要/role 时：有正增量则其为目标、负增量为借绿；仅有负增量（下游保护）则目标取负值、借绿记 0
  if (targetDelta == null) {
    targetDelta = positiveDelta != null ? positiveDelta : negativeDelta;
  }
  if (donorDelta == null) {
    donorDelta = positiveDelta != null ? negativeDelta : (targetDelta != null ? 0 : null);
  }
  return { targetDelta, donorDelta };
}

export function adaptPlanSlice(snapshot) {
  const planPhase = snapshot?.phases?.plan;
  const planTop = snapshot?.plan;
  if (!planPhase && !planTop) return null;

  const recommended = planPhase?.recommended || planTop?.recommended || {};
  const candidates = planPhase?.candidates || planTop?.candidates || [];
  const trial = planPhase?.trial_loop || planTop?.trial_loop || {};
  const rollback = planPhase?.rollback_conditions || planTop?.rollback_conditions || [];
  const actionPkg = planPhase?.action_package || {};
  const preview = snapshot?.phases?.diagnosis?.map_scenes?.plan_preview || {};
  const ticket = snapshot?.diagnosis_ticket || {};
  const armFields = resolveEntryTargetFields(snapshot, ticket);

  const fallbackCandidate = (Array.isArray(candidates) ? candidates : []).find(
    (c) => c && typeof c === 'object' && c.plan_id
      && (c.guardrail_pass === true || c.status === 'valid' || c.status === 'recommended'),
  ) || (Array.isArray(candidates) ? candidates : []).find(
    (c) => c && typeof c === 'object' && c.plan_id,
  ) || null;

  const planId = planPhase?.recommended_plan_id
    || planTop?.recommended_plan_id
    || recommended.plan_id
    || fallbackCandidate?.plan_id
    || null;

  const timing = recommended.timing || fallbackCandidate?.timing || {};
  const phaseChanges = preview.phase_changes || recommended.phase_changes || [];
  const { targetDelta, donorDelta } = resolvePlanTimingDeltas(timing, phaseChanges);

  const candList = (Array.isArray(candidates) ? candidates : []).map((c, i) => {
    if (typeof c === 'string') {
      return { id: `c${i}`, name: c, status: 'candidate', reason: '', tag: '' };
    }
    const id = c.plan_id || c.id || `c${i}`;
    const isRec = id === planId || c.status === 'recommended';
    return {
      id,
      name: c.name || c.short_name || PACKAGE_DISPLAY[id] || id,
      status: isRec ? 'recommended' : (c.status || (c.rejected ? 'rejected' : 'candidate')),
      reason: c.reason || c.reject_reason || '',
      tag: isRec ? '推荐' : (c.rejected || c.status === 'rejected' ? '否决' : ''),
    };
  });

  return {
    plan_meta: {
      plan_id: planId,
      name: recommended.name || recommended.title || '试运行方案',
      short_name: recommended.short_name || PACKAGE_DISPLAY[planId] || '可执行方案',
      status: planPhase?.plan_status || planTop?.plan_status || recommended.plan_status || 'trial_ready',
      executable: planPhase?.executable ?? planTop?.executable ?? recommended.executable ?? true,
      scenario: recommended.scenario || recommended.summary || '',
      overall_summary: (() => {
        const strategy = snapshot?.phases?.strategy || {};
        const cause = snapshot?.phases?.cause || {};
        const ca = cause.cause_analysis || {};
        const diagnosis = snapshot?.phases?.diagnosis || {};
        const mech = ca.overflow_mechanism || cause.overflow_mechanism || diagnosis.overflow_mechanism || {};
        const packageName = PACKAGE_DISPLAY[planId]
          || recommended.short_name
          || PACKAGE_DISPLAY[strategy.strategy_package]
          || '可执行方案';
        const parts = [
          ticket.intersection_name ? `问题对象：${ticket.intersection_name} ${[ticket.direction, ticket.movement].filter(Boolean).join('')}。` : '',
          (ca.primary_cause || mech.primary_label) ? `成因判定：${ca.primary_cause || mech.primary_label}。` : '',
          diagnosis.arterial_analysis?.summary ? `过程分析：${stripSeconds(diagnosis.arterial_analysis.summary)}。` : '',
          ca.narrative ? `证据说明：${stripSeconds(ca.narrative)}` : '',
          `方案结论：下发「${packageName}」试运行，监测下游并保留回滚条件。`,
        ];
        return parts.filter(Boolean).join('') || recommended.scenario || recommended.summary || '';
      })(),
      case_reference_note: buildCaseReferenceNote(snapshot?.phases?.cause) || null,
      expected_effect: recommended.expected_effect || '',
      risk: recommended.risk || '',
      downstream_risk: recommended.downstream_risk || '',
      user_basis: recommended.user_basis || '',
      road_mix: recommended.road_mix || '',
      primary_road: recommended.primary_road || '',
    },
    candidates: candList,
    recommended_actions: (recommended.actions || actionPkg.signal_actions || []).map((a, i) => ({
      id: a.id || `a${i}`,
      tag: a.tag || '动作',
      target: a.target || '',
      action: a.action || a.label || '',
      effect: a.effect || '',
      conf: a.conf ?? 80,
      color: a.color || '#34d89a',
      tone: a.tone || 'recommend',
      green_delta_s: a.green_delta_s,
      cycle_delta_s: a.cycle_delta_s,
    })),
    trial_loop: trial,
    rollback_conditions: rollback,
    execution_order: recommended.execution_order || [],
    timing: actionPkg.timing || recommended.timing || null,
    action_package: actionPkg,
    plan_scene: {
      available: preview.available !== false,
      analysis_steps: [
        { step: 'candidates', status: 'done', label: '梳理候选与否决', detail: '' },
        { step: 'pin', status: 'done', label: '选定推荐方案', detail: PACKAGE_DISPLAY[planId] || planId },
      ],
      timing: {
        target_green_delta_s: targetDelta,
        donor_green_delta_s: donorDelta,
      },
      target: {
        inter_id: ticket.inter_id,
        inter_name: ticket.intersection_name,
        lng: ticket.lng,
        lat: ticket.lat,
        direction: armFields.direction,
        movement: armFields.movement,
        north_arm_angle: armFields.north_arm_angle,
      },
    },
  };
}

/**
 * 按 act 切片键适配完整快照。
 * @param {Record<string, unknown>|null|undefined} snapshot
 * @param {string} key intent|overflow|bottleneck|arterial|flow_trace|cause|strategy|plan
 */
export function adaptSlice(snapshot, key) {
  switch (key) {
    case 'intent':
      return adaptIntentSlice(snapshot);
    case 'overflow':
      return adaptOverflowSlice(snapshot);
    case 'bottleneck':
      return adaptBottleneckSlice(snapshot);
    case 'arterial':
      return adaptArterialSlice(snapshot);
    case 'flow_trace':
      return adaptFlowTraceSlice(snapshot);
    case 'cause':
      return adaptCauseSlice(snapshot);
    case 'strategy':
      return adaptStrategySlice(snapshot);
    case 'plan':
      return adaptPlanSlice(snapshot);
    default:
      return null;
  }
}

export { stripSeconds, PACKAGE_DISPLAY, MECHANISM_LABEL };

/**
 * 幕 2 · 溢流五步诊断（模块 1/2）
 *
 * 步骤导航与上游来向排行的纯数据层。只用 flow_share_ratio，chain_hop≤3；
 * 份额不得写成辆/h。主来向按需求口径（北进口直行）在 hop=1 上取最大份额。
 */

export const DIAGNOSIS_STEPS = [
  {
    id: 'upstream',
    label: '上游来向',
    mapPhases: ['trace', 'inflow'],
    evidence: 'InflowShareSchema',
  },
  {
    id: 'downstream',
    label: '下游出口',
    mapPhases: ['downstream'],
    evidence: 'downstream_receiving',
  },
  {
    id: 'cross_arterial',
    label: '垂直流量',
    mapPhases: ['arterial'],
    evidence: null,
  },
  {
    id: 'channelization',
    label: '渠化复核',
    mapPhases: [],
    evidence: null,
  },
  {
    id: 'signal',
    label: '信号协调',
    mapPhases: ['signal'],
    evidence: 'signal_coordination_evidence',
  },
];

export const STEP_STATUS_LABEL = {
  pending: '待分析',
  analyzing: '分析中',
  judged: '已判定',
  degraded: '数据降级',
};

export const PHASE_ORDER = ['trace', 'inflow', 'supply', 'downstream', 'arterial', 'signal', 'done'];

const TURN_KEYS = ['left', 'through', 'right'];
const TOP_N = 3;
const MAX_HOP = 3;

const DIR8_LABEL = {
  0: '北进口',
  2: '东进口',
  4: '南进口',
  6: '西进口',
};

const TURN_NO_LABEL = {
  1: '左转',
  2: '直行',
  3: '右转',
};

const TURN_KEY_LABEL = {
  left: '左转',
  through: '直行',
  right: '右转',
};

export function dir8Label(code) {
  return DIR8_LABEL[Number(code)] || '未知进口';
}

export function turnNoLabel(no) {
  return TURN_NO_LABEL[Number(no)] || '未知转向';
}

export function getDiagnosisSteps(causeAnalysis) {
  const fromData = causeAnalysis?.diagnosis_rail?.steps;
  if (Array.isArray(fromData) && fromData.length) {
    return fromData.map((step, i) => ({
      id: step.id,
      label: step.label || DIAGNOSIS_STEPS[i]?.label || step.id,
      mapPhases: Array.isArray(step.map_phases) ? step.map_phases : DIAGNOSIS_STEPS[i]?.mapPhases || [],
      evidence: step.evidence ?? DIAGNOSIS_STEPS[i]?.evidence ?? null,
    }));
  }
  return DIAGNOSIS_STEPS;
}

export function stepIdForPhase(phase, steps = DIAGNOSIS_STEPS) {
  for (const step of steps) {
    if ((step.mapPhases || []).includes(phase)) return step.id;
  }
  return null;
}

/**
 * 五步轨状态：跟随地图节拍，无对应节拍的步骤保持待分析。
 * @param {string} phase
 * @param {typeof DIAGNOSIS_STEPS} [steps]
 */
export function buildRailStates(phase, steps = DIAGNOSIS_STEPS) {
  const phaseIdx = PHASE_ORDER.indexOf(phase);
  const currentId = stepIdForPhase(phase, steps);

  return steps.map((step) => {
    const lastPhase = (step.mapPhases || []).slice(-1)[0];
    const firstPhase = (step.mapPhases || [])[0];
    let status = 'pending';

    if (!firstPhase) {
      status = 'pending';
    } else if (step.id === currentId) {
      status = 'analyzing';
    } else if (phaseIdx >= 0 && PHASE_ORDER.indexOf(lastPhase) >= 0 && phaseIdx > PHASE_ORDER.indexOf(lastPhase)) {
      status = 'judged';
    }

    const clickable = status === 'judged' || status === 'degraded';
    return {
      ...step,
      status,
      statusLabel: STEP_STATUS_LABEL[status],
      clickable,
    };
  });
}

function normalizeTrace(raw, turnKey) {
  const hop = Number(raw?.chain_hop);
  const share = Number(raw?.flow_share_ratio);
  if (!Number.isFinite(hop) || hop < 1 || hop > MAX_HOP) return null;
  if (!Number.isFinite(share)) return null;
  return {
    turnKey,
    turnLabel: TURN_KEY_LABEL[turnKey],
    hop,
    share,
    interId: raw.cor_inter_id,
    interName: raw.cor_inter_name || raw.cor_inter_id,
    approachLabel: dir8Label(raw.cor_f_dir8_no),
    movementLabel: turnNoLabel(raw.cor_turn_dir_no),
    lon: raw.cor_lon,
    lat: raw.cor_lat,
    sourceType: 'pg',
    dbSupported: true,
    metric: 'flow_share_ratio',
  };
}

function isSameSource(a, b) {
  return Boolean(
    a &&
      b &&
      a.interId === b.interId &&
      a.turnKey === b.turnKey &&
      a.hop === b.hop &&
      a.approachLabel === b.approachLabel &&
      a.movementLabel === b.movementLabel,
  );
}

/**
 * 左/直/右各取份额前 3，按跳数分层。主来向 = 需求口径转向（直行）的 hop1 最大份额。
 */
export function buildUpstreamRanking(causeAnalysis, { visibleInterIds = [] } = {}) {
  const visible = new Set((visibleInterIds || []).filter(Boolean));
  const traces = causeAnalysis?.upstream_traces || {};
  const byTurn = traces.by_turn || {};
  const demandPolicy = causeAnalysis?.meta?.demand_policy || '';
  const primaryTurnKey = /through/.test(demandPolicy) || !demandPolicy ? 'through' : 'through';

  const primaryPool = (byTurn[primaryTurnKey] || [])
    .map((raw) => normalizeTrace(raw, primaryTurnKey))
    .filter((row) => row && row.hop === 1)
    .sort((a, b) => b.share - a.share);
  const primary = primaryPool[0] ? { ...primaryPool[0], isPrimary: true, mapVisible: visible.has(primaryPool[0].interId) } : null;

  const turns = TURN_KEYS.map((turnKey) => {
    const rows = (byTurn[turnKey] || [])
      .map((raw) => normalizeTrace(raw, turnKey))
      .filter(Boolean)
      .sort((a, b) => b.share - a.share)
      .slice(0, TOP_N)
      .map((row) => {
        const mapVisible = visible.has(row.interId);
        return {
          ...row,
          mapVisible,
          geometryNote: mapVisible ? '' : '几何不可视',
          isPrimary: isSameSource(row, primary),
        };
      });

    const hops = [1, 2, 3]
      .map((hop) => ({ hop, rows: rows.filter((row) => row.hop === hop) }))
      .filter((group) => group.rows.length);

    return {
      turnKey,
      turnLabel: TURN_KEY_LABEL[turnKey],
      isPrimaryTurn: turnKey === primaryTurnKey,
      rows,
      hops,
    };
  });

  const shareText = primary ? `${primary.share.toFixed(2)}%` : '—';
  const conclusion = primary
    ? `主要上游 = ${primary.interName} + ${primary.approachLabel} + ${primary.movementLabel}；依据 = flow_share_ratio ${shareText}`
    : '主要上游待判定';

  return {
    sourceType: 'pg',
    dbSupported: true,
    metric: 'flow_share_ratio',
    metricUnit: 'percent_share',
    sourceTable: traces.source || '',
    maxHop: MAX_HOP,
    demandPolicy,
    primaryTurnKey,
    primary,
    conclusion,
    turns,
  };
}

/** 地图钉用：同口径 traces 优先于 flow-trace 展示字段 */
export function findUpstreamShare(causeAnalysis, { turnKey, interId, hop } = {}) {
  const list = causeAnalysis?.upstream_traces?.by_turn?.[turnKey] || [];
  const hit = list.find(
    (row) => row?.cor_inter_id === interId && Number(row.chain_hop) === Number(hop),
  );
  const n = Number(hit?.flow_share_ratio);
  return Number.isFinite(n) ? n : null;
}

const JIEFANG_INFLOW_MOVEMENTS = [
  { key: 'north_through', label: '北进口直行', dir8: 0, turn: 2, isPrimary: true },
  { key: 'east_left', label: '东进口左转', dir8: 2, turn: 1, isPrimary: false },
  { key: 'west_right', label: '西进口右转', dir8: 6, turn: 3, isPrimary: false },
];

/**
 * 解放东×奥体西汇入问题路段：北进口直行 + 东进口左转 + 西进口右转。
 * 优先用 mock/落盘 share_pct；否则用流量归一。
 */
export function buildViaTurnInflowShares(causeAnalysis, viaInterId) {
  const spec = causeAnalysis?.problem_link_turn_inflow || {};
  const specMoves = spec.movements || [];

  const volumes = JIEFANG_INFLOW_MOVEMENTS.map((def) => {
    const meta = specMoves.find((row) => row.key === def.key) || {};
    const sharePct = Number(meta.share_pct);
    const flow = Number(meta.flow_veh_h);
    const hasShare = Number.isFinite(sharePct);
    const dbSupported = meta.db_supported === true;
    return {
      turnKey: def.key,
      turnLabel: meta.label || def.label,
      flow: Number.isFinite(flow) ? flow : null,
      sharePreset: hasShare ? sharePct : null,
      sourceType: meta.source_type || spec.source_type || (dbSupported ? 'pg' : 'mock'),
      dbSupported,
      fallbackReason: meta.fallback_reason || spec.note || '',
      isPrimary: Boolean(meta.is_primary ?? def.isPrimary),
    };
  });

  const flowTotal = volumes.reduce((sum, row) => {
    if (row.sharePreset != null) return sum;
    return sum + (Number.isFinite(row.flow) ? Math.max(0, row.flow) : 0);
  }, 0);

  const turns = volumes.map((row) => {
    let share = row.sharePreset;
    if (share == null && flowTotal > 0 && Number.isFinite(row.flow)) {
      share = (row.flow / flowTotal) * 100;
    }
    return { ...row, share };
  });
  if (!turns.some((row) => row.share != null)) return null;

  const mocked = turns.some((row) => row.sourceType === 'mock') || spec.source_type === 'mock';
  const degraded = mocked || turns.some((row) => !row.dbSupported);
  const flowLine = turns
    .map((row) => (row.share != null ? `${Number.isInteger(row.share) ? row.share : row.share.toFixed(1)}%` : '—'))
    .join(' / ');

  return {
    interId: spec.via_inter_id || viaInterId,
    title: '汇入问题路段',
    subtitle: '北直 · 东左 · 西右',
    foot: mocked ? `${flowLine} · MOCK` : flowLine,
    sourceType: mocked ? 'mock' : spec.source_type || 'pg',
    metric: 'jiefang_inflow_ratio',
    formula: spec.formula || 'ratio_i = flow_i / (north_through + east_left + west_right)',
    totalFlow: flowTotal,
    degraded,
    turns,
  };
}

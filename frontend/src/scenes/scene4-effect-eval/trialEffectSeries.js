/**
 * 试运行效果序列（移植自 agent-loop act-08/trialEffectSeries.js）
 * 基线与目标改读本项目 data/1-4-effect-eval.json，不再依赖 caseFixture。
 */

function num(v, fallback = null) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function round1(v) {
  return Math.round(v * 10) / 10
}

function round4(v) {
  return Math.round(v * 10000) / 10000
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function smoothstep(t) {
  return t * t * (3 - 2 * t)
}

export function calculateQueueRatio(queueLengthM, storageLengthM) {
  const storage = num(storageLengthM, 0)
  if (storage <= 0) return null
  return round4(num(queueLengthM, 0) / storage)
}

export function buildTrialEffectSeries(payload = {}) {
  const trial = payload.trial || {}
  const baselineIn = payload.baseline || {}
  const targets = payload.trial_targets || {}
  const thresholds = {
    queue_ratio_warning: 0.8,
    queue_ratio_spillback: 1.0,
    green_utilization_low: 0.6,
    green_utilization_high: 0.85,
    rollback_queue_ratio: 0.9,
    ...(payload.thresholds || {}),
  }
  const context = payload.context || {}
  const plan = payload.plan || {}
  const timing = plan.timing || {}

  const n = Math.max(1, Math.round(num(trial.cycles, null) ?? num(trial.observation_cycles, 5)))
  const storage = num(baselineIn.storage_length_m, 367.89)
  const queue0 = num(baselineIn.queue_length_m, 270)
  const queueStart = num(targets.start_queue_length_m, null) ?? queue0
  const ratioStart = num(targets.start_queue_ratio, null)
    ?? calculateQueueRatio(queueStart, storage)
    ?? (storage > 0 ? queueStart / storage : 0)
  const speed0 = num(baselineIn.avg_speed_kmh, 7.2)
  const delay0 = num(baselineIn.delay_index, 5.28)
  const green0 = num(baselineIn.green_utilization, 0.62)
  const upRatio0 = num(baselineIn.upstream_queue_ratio, 0.22)
  const upStorage = num(baselineIn.upstream_storage_length_m, 215.7)
  // 下游吃满时堵在解放东路口内进不来的车，取自幕 3 仿真 KPI；与上游进口排队比是两个口径
  const upBlocked0 = num(baselineIn.upstream_blocked_veh, null)

  const endRatio = num(targets.end_queue_ratio, Math.min(0.55, Math.max(0.4, ratioStart - 0.32)))
  const endQueue = num(targets.end_queue_length_m, null) ?? round1(storage * endRatio)
  const endSpeed = num(targets.end_speed_kmh, 13)
  const endDelay = num(targets.end_delay_index, 2.1)
  const endGreen = num(targets.end_green_utilization, 0.68)
  const endUpRatio = num(targets.end_upstream_queue_ratio, 0.35)
  const endUpBlocked = num(targets.end_upstream_blocked_veh, null)

  const cycles = []
  for (let i = 0; i < n; i += 1) {
    const t = n === 1 ? 1 : i / (n - 1)
    const ease = smoothstep(t)
    const queueLength = round1(lerp(queueStart, endQueue, ease))
    const queueRatio = round4(lerp(ratioStart, endRatio, ease))
    const avgSpeed = round1(lerp(speed0, endSpeed, ease))
    const delayIndex = round4(lerp(delay0, endDelay, ease))
    const greenUtil = round4(lerp(green0, endGreen, ease))
    const upQueueRatio = round4(lerp(upRatio0, endUpRatio, ease))
    const upQueueLength = round1(upStorage * upQueueRatio)
    const upBlocked =
      upBlocked0 == null || endUpBlocked == null
        ? null
        : Math.round(lerp(upBlocked0, endUpBlocked, ease))
    const prev = i > 0 ? cycles[i - 1] : null
    const rolledBack = upQueueRatio >= thresholds.rollback_queue_ratio
    const spillover = upQueueRatio >= thresholds.queue_ratio_warning
    cycles.push({
      index: i + 1,
      label: `第 ${i + 1} 周期`,
      queue_length_m: queueLength,
      queue_ratio: queueRatio,
      avg_speed_kmh: avgSpeed,
      delay_index: delayIndex,
      green_utilization: greenUtil,
      // 兼容图表字段名；本剧本监测上游溢出风险
      downstream_queue_ratio: upQueueRatio,
      downstream_queue_length_m: upQueueLength,
      upstream_queue_ratio: upQueueRatio,
      upstream_blocked_veh: upBlocked,
      rolled_back: rolledBack,
      spillover_risk: spillover || rolledBack,
      improved: Boolean(prev && queueRatio < prev.queue_ratio),
      note: rolledBack
        ? '上游触及回滚线'
        : spillover
          ? '上游接近预警'
          : queueRatio < thresholds.queue_ratio_warning
            ? '目标排队缓解中'
            : '消散进行中',
    })
  }

  const last = cycles[cycles.length - 1]
  const overflowRelieved = Boolean(last && last.queue_ratio < thresholds.queue_ratio_warning)
  const upstreamSafe = Boolean(
    last
    && last.upstream_queue_ratio < thresholds.queue_ratio_warning
    && last.upstream_queue_ratio < thresholds.rollback_queue_ratio
    && !last.rolled_back,
  )
  const speedImproved = Boolean(last && last.avg_speed_kmh > speed0 + 3)
  const success = overflowRelieved && upstreamSafe && !last?.rolled_back

  const outcomeHighlights = [
    {
      id: 'overflow',
      ok: overflowRelieved,
      title: '问题路段排队已缓解',
      detail: overflowRelieved
        ? `排队比 ${fmtRatio2(ratioStart)} → ${fmtRatio2(last.queue_ratio)}，已低于预警线 ${thresholds.queue_ratio_warning}`
        : '目标排队比尚未降至预警线以下',
    },
    {
      id: 'upstream',
      ok: upstreamSafe,
      // 截流让上游进口排队比上升，但下游不再溢出、回灌消失，路口内滞留反而减少，
      // 两个口径一起说，才不会和幕 3 的 blocked_veh 9 → 3 看起来互相打架
      title: '上游代价可控',
      detail: upstreamSafe
        ? `解放东进口排队比 ${fmtRatio2(upRatio0)} → ${fmtRatio2(last.upstream_queue_ratio)}（回滚线 ${thresholds.rollback_queue_ratio}）`
          + (last.upstream_blocked_veh != null
            ? `；路口内滞留 ${upBlocked0} → ${last.upstream_blocked_veh} 辆`
            : '')
        : '上游排队接近或超过安全阈值',
    },
    {
      id: 'speed',
      ok: speedImproved,
      title: '路段速度回升',
      detail: speedImproved
        ? `速度 ${fmtPlain(speed0)} → ${fmtPlain(last.avg_speed_kmh)} km/h，延时指数 ${delay0.toFixed(2)} → ${last.delay_index.toFixed(2)}`
        : '速度改善不足',
    },
  ]

  return {
    cyclesCount: n,
    planName: plan.short_name || plan.name || '相位协调试运行',
    intersection: context.intersection || '奥体西路与经十路路口',
    timePeriodLabel: context.time_period_label || '',
    targetLabel: trial.target_label || '北进口直行',
    downstreamName: trial.downstream_name || context.upstream_intersection || '奥体西路与解放东路路口',
    timing: {
      cycleLenS: num(timing.cycle_len_s, num(trial.cycle_len_s, 220)),
      cycleDeltaS: num(timing.cycle_delta_s, 0),
      targetGreenDeltaS: num(timing.target_green_delta_s, 0),
      donorGreenDeltaS: num(timing.donor_green_delta_s, 0),
      offsetShiftS: num(timing.offset_shift_s, null),
      releaseBeforeS: num(timing.release_vs_downstream_green_s?.before, null),
      releaseAfterS: num(timing.release_vs_downstream_green_s?.after, null),
      jingshiNote: timing.jingshi_offset_note || '',
      jiefangNote: timing.jiefang_release_note || '',
    },
    thresholds,
    baseline: {
      queue_length_m: round1(queueStart),
      queue_ratio: round4(ratioStart),
      avg_speed_kmh: round1(speed0),
      delay_index: round4(delay0),
      green_utilization: round4(green0),
      downstream_queue_ratio: round4(upRatio0),
      storage_length_m: round1(storage),
    },
    cycles,
    metrics: Array.isArray(trial.metrics) ? trial.metrics : [],
    successConditions: Array.isArray(trial.success_conditions) ? trial.success_conditions : [],
    rollbackRules: Array.isArray(trial.rollback_rules) ? trial.rollback_rules : [],
    outcomeHighlights,
    overflowRelieved,
    upstreamSafe,
    speedImproved,
    verdict: success
      ? `试运行 ${n} 周期达标：问题路段排队下降，速度回升，溢出风险消除。`
      : `试运行 ${n} 周期观察结束，请复核监测指标。`,
    successText: trial.success || '缓解目标排队且不加重上游溢出风险',
    rolledBack: Boolean(last?.rolled_back),
    rollbackThreshold: thresholds.rollback_queue_ratio,
  }
}

function trimDot0(n, digits = 1) {
  const f = 10 ** digits
  const r = Math.round(n * f) / f
  return Number.isInteger(r) ? String(r) : r.toFixed(digits)
}

export function fmtPlain(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return '—'
  return trimDot0(v, digits)
}

export function fmtMeters(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${trimDot0(v)} m`
}

export function fmtRatio2(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  const rounded = Math.round(v * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : String(rounded)
}

export function fmtPct(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${trimDot0(v * 100)}%`
}

export function fmtDeltaS(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  if (v === 0) return '±0s'
  return v > 0 ? `+${v}s` : `${v}s`
}

export function fmtSpeed(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${trimDot0(v)} km/h`
}

/**
 * 信控方案调节模型：把 deepagent 输出的公共周期 / 相位差 / 阶段配时，
 * 换算成时距图可直接绘制的绿灯窗口与绿波带几何。
 *
 * 相位差口径 offset_reference = coord_green_start，
 * 即 offset_s 就是该路口协调相位绿灯的起点（对齐引擎 arterial_bandwidth）。
 */

/** 时距图横轴最小跨度：对齐工作台默认 4 个周期（ST_DEFAULT_CYCLES） */
export const SPAN_S = 360

const MODES = ['baseline', 'optimized']

/** 把一个「每周期重复一次」的绿窗铺满整条时间轴 */
function repeatWindows(offset, dur, cycle, span) {
  if (!(cycle > 0) || !(dur > 0)) return []
  const out = []
  let start = (((offset % cycle) + cycle) % cycle) - cycle
  while (start < span) {
    out.push({ start, end: start + dur })
    start += cycle
  }
  return out
}

/**
 * 单段绿波带：上游绿窗沿行程时间平移后与下游绿窗的最大交集。
 * 返回以上游为起点的带首时刻与带宽，取不到交集即为断裂。
 */
function bandOnLink(upOffset, upGreen, downOffset, downGreen, travel, cycle) {
  let best = null
  for (let k = -1; k <= 1; k += 1) {
    const arrive = upOffset + travel + k * cycle
    for (let m = -1; m <= 2; m += 1) {
      const gs = downOffset + m * cycle
      const lo = Math.max(arrive, gs)
      const hi = Math.min(arrive + upGreen, gs + downGreen)
      const width = hi - lo
      if (width > (best?.width ?? 0)) best = { downStart: lo, width }
    }
  }
  if (!best || best.width < 0.5) return null
  return { upStart: best.downStart - travel, downStart: best.downStart, width: best.width }
}

/** 把单段绿波带按周期铺满时间轴，得到一串平行四边形 */
function repeatBand(band, cycle, span) {
  if (!band) return []
  const out = []
  let shift = -cycle
  while (band.upStart + shift < span) {
    if (band.downStart + shift > -cycle) {
      out.push({
        upStart: band.upStart + shift,
        downStart: band.downStart + shift,
        width: band.width,
      })
    }
    shift += cycle
  }
  return out
}

function nodeView(node, mode, span) {
  const t = node[mode]
  const coordStage = t.stages.find((s) => s.stage_no === node.coord_stage_no) || null
  // 方向性绿时：与工作台 nodeGreenForward/nodeGreenReverse 同口径，
  // coordinated_green_forward_s > 0 用它，否则回退 coordinated_green_s
  const gFwdNum = Number(t.coord_green_forward_s)
  const gRevNum = Number(t.coord_green_reverse_s)
  const gFwd = Number.isFinite(gFwdNum) && gFwdNum > 0 ? gFwdNum : Number(t.coord_green_s)
  const gRev = Number.isFinite(gRevNum) && gRevNum > 0 ? gRevNum : Number(t.coord_green_s)
  return {
    interId: node.inter_id,
    name: node.name,
    shortName: node.short_name,
    isFocus: node.is_focus,
    distM: node.dist_m,
    cycleS: t.cycle_s,
    offsetS: t.offset_s,
    coordGreenS: t.coord_green_s,
    coordGreenFwdS: gFwd,
    coordGreenRevS: gRev,
    coordStageName: coordStage?.name || '',
    greens: repeatWindows(t.offset_s, t.coord_green_s, t.cycle_s, span),
    greensFwd: repeatWindows(t.offset_s, gFwd, t.cycle_s, span),
    greensRev: repeatWindows(t.offset_s, gRev, t.cycle_s, span),
    stages: t.stages,
  }
}

/**
 * 相邻两口的绿窗重叠（几何重叠带宽，与工作台 collectOverlapBands 同口径）：
 * 正向/反向各自用方向性绿时（gFwd/gRev），行程时间取链路实测正/反向车速。
 * 这不是全线绿波——全线是否成波看 corridor.bandwidth。
 */
function linkView(link, up, down, mode, span) {
  const cycle = up.cycleS
  const mismatch = up.cycleS !== down.cycleS
  const tauF = link.travel_time_forward_s
  const tauR = link.travel_time_reverse_s
  const forward = mismatch
    ? null
    : bandOnLink(up.offsetS, up.coordGreenFwdS, down.offsetS, down.coordGreenFwdS, tauF, cycle)
  const reverse = mismatch
    ? null
    : bandOnLink(down.offsetS, down.coordGreenRevS, up.offsetS, up.coordGreenRevS, tauR, cycle)
  return {
    key: `${up.interId}-${down.interId}`,
    from: link.from,
    to: link.to,
    lengthM: link.length_m,
    travelForwardS: tauF,
    travelReverseS: tauR,
    upDistM: up.distM,
    downDistM: down.distM,
    cycleMismatch: mismatch,
    cycles: [up.cycleS, down.cycleS],
    forwardOverlapS: forward ? Math.round(forward.width * 10) / 10 : 0,
    reverseOverlapS: reverse ? Math.round(reverse.width * 10) / 10 : 0,
    // 正向沿里程递增（北向南），反向沿里程递减（南向北）
    forwardBands: repeatBand(forward, cycle, span).map((b) => ({
      ...b,
      fromDistM: up.distM,
      toDistM: down.distM,
    })),
    reverseBands: repeatBand(reverse, cycle, span).map((b) => ({
      ...b,
      fromDistM: down.distM,
      toDistM: up.distM,
    })),
    mode,
  }
}

/** 指标条口径与工作台一致：引擎报什么就展示什么 */
const KPI_ORDER = [
  'chained_bandwidth_s',
  'travel_time_s',
  'coordinated_direction_delay_s',
  'cross_direction_delay_s',
  'max_queue_length_m',
]

export function buildSignalPlanModel(payload) {
  if (!payload?.nodes?.length) return null

  // 周期随方案变化（如 220s），跨度对齐工作台默认 4 个周期，不足 360s 时取最小 360s
  const spanS = Math.max(SPAN_S, (payload.corridor?.cycle_s || 180) * 4)

  const views = {}
  for (const mode of MODES) {
    const nodes = payload.nodes.map((n) => nodeView(n, mode, spanS))
    const byId = Object.fromEntries(nodes.map((n) => [n.interId, n]))
    const links = payload.links
      .map((l, i) => {
        const up = byId[payload.nodes[i].inter_id]
        const down = byId[payload.nodes[i + 1].inter_id]
        return up && down ? linkView(l, up, down, mode, spanS) : null
      })
      .filter(Boolean)
    views[mode] = { nodes, links }
  }

  const maxDist = Math.max(...payload.nodes.map((n) => n.dist_m))
  const kpis = KPI_ORDER.map((name) => payload.kpis.find((k) => k.name === name)).filter(Boolean)

  return {
    meta: payload.meta,
    corridor: payload.corridor,
    diagram: payload.diagram || null,
    brief: payload.brief,
    guardrails: payload.guardrails,
    // 候选保留全量：分数为 null 时（如未跑通的策略变体）由面板显示「—」
    candidates: payload.candidates,
    rawNodes: payload.nodes,
    views,
    kpis,
    maxDist,
    spanS,
  }
}

/** 相位差调整方向文案：正数=绿灯启亮时刻后移 */
export function offsetShiftLabel(delta) {
  if (delta == null) return '—'
  if (Math.abs(delta) < 0.5) return '不变'
  return delta > 0 ? `后移 ${Math.round(delta)} s` : `前移 ${Math.round(-delta)} s`
}

const DIR8_CN = { 0: '北', 2: '东', 4: '南', 6: '西' }
const TURN_CN = { 0: '掉头', 1: '左', 2: '直', 3: '右' }

/**
 * 把 1-3-signal-plan.json 的节点转成幕 4 相位相序板（PhaseSequenceBoard）接口。
 * 引擎只调绿时与相位差、不改相序，阶段号前后一一对应；
 * 绿时对比按 stage_no 对齐，缺失侧（理论上不会发生）记 null 由面板显示「—」。
 */
export function buildPhaseBoard(payload) {
  if (!payload?.nodes?.length) return null
  const minGreen = payload.meta?.min_green_s ?? null
  const intersections = payload.nodes.map((n, idx) => {
    const byNo = Object.fromEntries(n.baseline.stages.map((s) => [s.stage_no, s]))
    const stages = n.optimized.stages.map((s, i) => {
      const b = byNo[s.stage_no] ?? null
      const greenB = b ? b.green_s : null
      const delta = greenB == null || s.green_s == null ? null : Math.round((s.green_s - greenB) * 10) / 10
      const timingBefore = b ? (b.total_s ?? b.green_s) : null
      const timingAfter = s.total_s ?? s.green_s ?? null
      const timingDelta = timingBefore == null || timingAfter == null
        ? null
        : Math.round((timingAfter - timingBefore) * 10) / 10
      const isCoord = String(s.stage_no) === String(n.coord_stage_no)
      return {
        stage_seq_no: i + 1,
        stage_no: s.stage_no,
        stage_name: s.name || b?.name || `阶段${i + 1}`,
        green_before_s: greenB,
        green_after_s: s.green_s,
        green_delta_s: delta,
        timing_before_s: timingBefore,
        timing_after_s: timingAfter,
        timing_delta_s: timingDelta,
        movements: (s.movements || []).map((m) => ({
          ...m,
          label: `${DIR8_CN[m.dir8] ?? m.dir8}${TURN_CN[m.turn] ?? m.turn}`,
        })),
        role: isCoord ? '协调相位 · 相位差锚点' : '',
        note: isCoord ? '干线协调方向放行窗口' : '',
        feeds_problem_link: Boolean(n.is_focus && isCoord),
        min_green_sec: minGreen,
        max_green_sec: null,
      }
    })
    const offsetDelta =
      n.offset_delta_s ??
      (n.optimized.offset_s != null && n.baseline.offset_s != null
        ? Math.round((n.optimized.offset_s - n.baseline.offset_s) * 10) / 10
        : null)
    return {
      key: n.inter_id,
      inter_id: n.inter_id,
      inter_name: n.name,
      short_name: n.short_name,
      is_focus: n.is_focus,
      seq: idx + 1,
      cycle_len_sec: n.optimized.cycle_s,
      offset_before_s: n.baseline.offset_s,
      offset_after_s: n.optimized.offset_s,
      offset_delta_s: offsetDelta,
      coord_stage_no: n.coord_stage_no,
      note: n.is_focus
        ? `问题路段${n.short_name}端 · ${payload.meta?.period_label || '高峰'}协调子区`
        : `协调子区成员路口 · ${payload.meta?.period_label || '高峰'} ${payload.meta?.period_window || ''}`.trim(),
      stages,
    }
  })
  return { intersections, reference_inter_key: payload.meta?.segment_key || '' }
}

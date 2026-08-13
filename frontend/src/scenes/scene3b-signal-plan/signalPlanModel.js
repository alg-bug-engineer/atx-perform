/**
 * 信控方案调节模型：把 deepagent 输出的公共周期 / 相位差 / 阶段配时，
 * 换算成时距图可直接绘制的绿灯窗口与绿波带几何。
 *
 * 相位差口径 offset_reference = coord_green_start，
 * 即 offset_s 就是该路口协调相位绿灯的起点（对齐引擎 arterial_bandwidth）。
 */

/** 时距图横轴跨度：两个 180s 周期，足够看清一条完整绿波带 */
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
  return {
    interId: node.inter_id,
    name: node.name,
    shortName: node.short_name,
    isFocus: node.is_focus,
    distM: node.dist_m,
    cycleS: t.cycle_s,
    offsetS: t.offset_s,
    coordGreenS: t.coord_green_s,
    coordStageName: coordStage?.name || '',
    greens: repeatWindows(t.offset_s, t.coord_green_s, t.cycle_s, span),
    stages: t.stages,
  }
}

/**
 * 相邻两口的绿窗重叠。口径对齐 deepagent：绿窗取协调阶段绿 `coordGreenS`，
 * 行程时间取链路实测正/反向车速（extract_signal_plan.py 已算好）。
 * 这不是绿波带——全线是否成波看 corridor.bandwidth。
 */
function linkView(link, up, down, mode, span) {
  const cycle = up.cycleS
  const mismatch = up.cycleS !== down.cycleS
  const tauF = link.travel_time_forward_s
  const tauR = link.travel_time_reverse_s
  const forward = mismatch
    ? null
    : bandOnLink(up.offsetS, up.coordGreenS, down.offsetS, down.coordGreenS, tauF, cycle)
  const reverse = mismatch
    ? null
    : bandOnLink(down.offsetS, down.coordGreenS, up.offsetS, up.coordGreenS, tauR, cycle)
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

  const views = {}
  for (const mode of MODES) {
    const nodes = payload.nodes.map((n) => nodeView(n, mode, SPAN_S))
    const byId = Object.fromEntries(nodes.map((n) => [n.interId, n]))
    const links = payload.links
      .map((l, i) => {
        const up = byId[payload.nodes[i].inter_id]
        const down = byId[payload.nodes[i + 1].inter_id]
        return up && down ? linkView(l, up, down, mode, SPAN_S) : null
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
    candidates: payload.candidates.filter((c) => c.score_delta != null),
    rawNodes: payload.nodes,
    views,
    kpis,
    maxDist,
    spanS: SPAN_S,
  }
}

/** 相位差调整方向文案：正数=绿灯启亮时刻后移 */
export function offsetShiftLabel(delta) {
  if (delta == null) return '—'
  if (Math.abs(delta) < 0.5) return '不变'
  return delta > 0 ? `后移 ${Math.round(delta)} s` : `前移 ${Math.round(-delta)} s`
}

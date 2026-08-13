/**
 * 信控方案看板模型：把库内阶段配时 / 相位放行关系，
 * 换算成以「经十路口北进口绿灯启动」为零点的协调时序。
 */

function cumulative(stages, key) {
  let acc = 0
  return stages.map((s) => {
    const start = acc
    acc += s[key]
    return { stage: s, start, end: acc, width: s[key] }
  })
}

/** 把一段可能跨越周期首尾的区间拆成 1~2 段，便于线性时序条渲染 */
function wrapSegments(start, width, cycleLen) {
  const s = ((start % cycleLen) + cycleLen) % cycleLen
  if (s + width <= cycleLen) return [{ start: s, width }]
  return [
    { start: s, width: cycleLen - s },
    { start: 0, width: width - (cycleLen - s) },
  ]
}

/** 区间落在窗口内的比例，用于判定这段放行主要发生在哪个窗口 */
function overlapFrac(seg, win) {
  const lo = Math.max(seg.start, win.start)
  const hi = Math.min(seg.start + seg.width, win.start + win.width)
  return seg.width > 0 ? Math.max(0, hi - lo) / seg.width : 0
}
const ZONE_MIN_FRAC = 0.34

function buildLane(inter, mode, refOffset, anchor, cycleLen, windows) {
  const totalKey = mode === 'after' ? 'total_after_s' : 'total_before_s'
  const greenKey = mode === 'after' ? 'green_after_s' : 'green_before_s'
  const offset = mode === 'after' ? inter.offset_after_s : inter.offset_before_s
  const shift = refOffset - offset

  return cumulative(inter.stages, totalKey).flatMap((slot) =>
    wrapSegments(slot.start - shift - anchor, slot.width, cycleLen).map((seg, i) => ({
      id: `${inter.key}-${mode}-${slot.stage.stage_no}-${i}`,
      stageNo: slot.stage.stage_no,
      label: slot.stage.role || `阶段 ${slot.stage.stage_no}`,
      greenSec: slot.stage[greenKey],
      feeds: slot.stage.feeds_problem_link,
      // 汇入相位落在哪个窗口，决定这股车流是被绿灯直接放走还是压进队尾
      zone: !slot.stage.feeds_problem_link
        ? 'none'
        : overlapFrac(seg, windows.green) >= ZONE_MIN_FRAC
          ? 'green'
          : 'red',
      movements: slot.stage.movements,
      ...seg,
    })),
  )
}

export function buildSignalBoard(optimization) {
  const src = optimization?.signal_plan_board
  if (!src?.intersections?.length) return null

  const reference = src.intersections.find((i) => i.key === src.reference_inter_key)
  const others = src.intersections.filter((i) => i !== reference)
  const cycleLen = reference?.cycle_len_sec || 220
  const refOffset = src.reference_offset_s ?? reference?.offset_before_s ?? 0

  // 零点 = 参考路口「问题路段放行」阶段的起点
  const refSlots = cumulative(reference.stages, 'total_before_s')
  const anchorSlot = refSlots.find((s) => s.stage.feeds_problem_link) || refSlots[0]
  const anchor = anchorSlot.start

  const windows = {
    green: { start: 0, width: anchorSlot.stage.green_before_s },
  }

  const shortName = (name) => name.replace('奥体西路与', '').replace('路路口', '路口')

  const lanes = [
    {
      key: 'ref',
      title: `${shortName(reference.inter_name)} · 维持不变`,
      tone: 'ref',
      blocks: buildLane(reference, 'before', refOffset, anchor, cycleLen, windows),
    },
    ...others.flatMap((inter) => [
      {
        key: `${inter.key}-before`,
        title: `${shortName(inter.inter_name)} · 现状`,
        tone: 'before',
        blocks: buildLane(inter, 'before', refOffset, anchor, cycleLen, windows),
      },
      {
        key: `${inter.key}-after`,
        title: `${shortName(inter.inter_name)} · 优化后`,
        tone: 'after',
        blocks: buildLane(inter, 'after', refOffset, anchor, cycleLen, windows),
      },
    ]),
  ]

  return {
    cycleLen,
    windows,
    greenWindowLabel: `${shortName(reference.inter_name)}北进口绿灯 ${anchorSlot.stage.green_before_s} s`,
    lanes,
    intersections: src.intersections,
    dbSupported: src.db_supported || {},
    optimizedNote: src.optimized_note || '',
    coordTargetNote: src.coord_target_note || '',
    source: src.source || {},
  }
}

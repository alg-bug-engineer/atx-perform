import { hasMovement, runCorridorSim, signalState, stageWindows } from './corridorSim.js'

function intersectionOf(payload, key) {
  return (payload?.signal_plan_board?.intersections || []).find((i) => i.key === key)
}

/** 展示窗口起点：锚在经十路口南北直行绿灯亮起前 lead_in 秒 */
function anchorStart(plan, cycleLen, leadIn) {
  const w = plan.windows.find((x) => hasMovement(x, 0, 2))
  if (!w) return 0
  return ((w.start - leadIn) % cycleLen + cycleLen) % cycleLen
}

function buildVariant(payload, sim, variantKey) {
  const cycleLen = sim.cycle_len_sec
  const jingshi = intersectionOf(payload, 'jingshi')
  const jiefang = intersectionOf(payload, 'jiefang')
  const after = variantKey === 'after'
  const greenKey = after ? 'green_after_s' : 'green_before_s'

  const jingshiPlan = stageWindows(
    jingshi.stages,
    sim.alignment.jingshi.stage1_start_s,
    cycleLen,
    greenKey,
  )
  const jiefangPlan = stageWindows(
    jiefang.stages,
    after ? sim.alignment.jiefang.stage1_start_after_s : sim.alignment.jiefang.stage1_start_before_s,
    cycleLen,
    greenKey,
  )

  const displayStartS = anchorStart(jingshiPlan, cycleLen, sim.display_anchor.lead_in_sec)

  const result = runCorridorSim(
    {
      cycleLen,
      stepSec: sim.step_sec,
      warmupCycles: sim.warmup_cycles,
      seed: sim.seed,
      lengthM: sim.geometry.length_m,
      widenLenM: sim.geometry.widen_len_m,
      taperLenM: sim.geometry.taper_len_m,
      vehicle: sim.vehicle,
      turnSplit: sim.turn_split,
      sources: sim.sources,
      jingshiPlan,
      jiefangPlan,
      displayStartS,
      inflowFactor: sim.demand?.field_factor ?? 1,
    },
    variantKey,
  )

  return { result, jingshiPlan, jiefangPlan, displayStartS }
}

export function buildCorridorDemo(optimization) {
  const src = optimization?.corridor_demo
  if (!src?.simulation) return null
  const sim = src.simulation
  const cycleLen = sim.cycle_len_sec
  const storageM = src.link?.storage_length_m || sim.geometry.length_m

  const meta = (src.variants || []).reduce((acc, v) => {
    acc[v.key] = v
    return acc
  }, {})

  const variants = ['before', 'after'].map((key) => {
    const built = buildVariant(optimization, sim, key)
    const m = meta[key] || {}
    return {
      key,
      title: m.title || (key === 'before' ? '现状配时' : '相位协调'),
      subtitle: m.subtitle || '',
      tone: key === 'before' ? 'danger' : 'ok',
      cycleLen,
      peakM: built.result.peakM,
      endM: built.result.endM,
      spillback: built.result.spill.some((s) => s === 1),
      ...built,
    }
  })

  return {
    cycleLen,
    storageM,
    warningM: src.link?.warning_length_m || Math.round(storageM * 0.8),
    link: src.link,
    upstream: src.upstream,
    downstream: src.downstream,
    kpis: src.kpis || [],
    dataNote: src.data_note || '',
    sim,
    geometry: sim.geometry,
    observation: sim.observation,
    playback: src.playback || { default_speed: 12, speed_options: [4, 8, 12, 20] },
    variants,
  }
}

/** 播放进度 t（0..周期长）→ 该帧的车辆位置、排队与信号状态 */
export function sampleVariant(variant, t) {
  const r = variant.result
  if (!r) return null
  const step = Math.min(r.steps - 1, Math.max(0, Math.round(t / r.dt)))
  const absT = r.absStartS + step * r.dt

  const cars = []
  for (const tr of r.tracks) {
    if (step < tr.from || step > tr.to) continue
    const x = tr.xs[step - tr.from]
    if (Number.isNaN(x)) continue
    const prev = step > tr.from ? tr.xs[step - tr.from - 1] : x
    cars.push({
      id: tr.id,
      x,
      turn: tr.turn,
      upLane: tr.upLane,
      downLane: tr.downLane,
      moving: (x - prev) / r.dt > 1.2,
    })
  }

  return {
    t,
    step,
    absT,
    cars,
    queueM: r.queueM[step],
    occupiedM: r.occupiedM[step],
    worstGroup: ['left', 'through', 'right'][r.worstGroup[step]],
    spillQueueM: r.spillQueueM[step],
    spill: r.spill[step] === 1,
    downstreamThrough: signalState(r.greens.through, absT),
    downstreamLeft: signalState(r.greens.left, absT),
    upstreamSources: r.greens.jiefang.map((g) => ({
      key: g.key,
      label: g.label,
      ...signalState(g.windows, absT),
    })),
  }
}

/** 幕 4 单周期排队曲线用 */
export function queueSeries(variant, stepS = 2) {
  const r = variant.result
  if (!r) return []
  const out = []
  const stride = Math.max(1, Math.round(stepS / r.dt))
  for (let s = 0; s < r.steps; s += stride) {
    out.push({ t: s * r.dt, q: r.queueM[s] })
  }
  return out
}

export function queueAt(variant, t) {
  const r = variant.result
  if (!r) return 0
  const step = Math.min(r.steps - 1, Math.max(0, Math.round(t / r.dt)))
  return r.queueM[step]
}

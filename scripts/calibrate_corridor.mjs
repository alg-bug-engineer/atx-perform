/**
 * 走廊仿真标定：扫参数，看能不能复现现场观测
 *   现状：经十绿灯放完剩约 170 m → 解放东西右/东左放完基本无剩余空间 → 北进口直行汇入短暂溢出
 *   优化：峰值明显下降、不溢出
 * 用法：node scripts/calibrate_corridor.mjs [--tau=2.0,2.2] [--scale=0.9,1.0] [--loss=2.5]
 */
import { readFileSync } from 'node:fs'
import { buildCorridorDemo } from '../frontend/src/scenes/scene3-optimization/corridorDemo.js'
import { signalState } from '../frontend/src/scenes/scene3-optimization/corridorSim.js'

const base = JSON.parse(readFileSync(new URL('../data/1-3-optimization.json', import.meta.url)))

const arg = (k, d) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3).split(',').map(Number) : d
}
const taus = arg('tau', [1.5, 1.8, 2.0, 2.2])
const scales = arg('scale', [0.85, 0.95, 1.0])
const losses = arg('loss', [2.5])
const mixes = arg('mix', [0.1])
const speeds = arg('v', [11.1])

function metrics(variant) {
  const r = variant.result
  const rel = (abs) => abs - r.absStartS
  const at = (t) => r.queueM[Math.min(r.steps - 1, Math.max(0, Math.round(t / r.dt)))]

  // 展示周期内的经十南北直行绿灯窗口
  const th = r.greens.through
    .map((w) => ({ s: rel(w.start), e: rel(w.end) }))
    .filter((w) => w.e > 0 && w.s < r.cycleLen)[0]
  const north = r.greens.jiefang.find((g) => g.key === 'north_through')
  const nw = north.windows
    .map((w) => ({ s: rel(w.start), e: rel(w.end) }))
    .filter((w) => w.e > 0 && w.s < r.cycleLen)[0]

  let spillSteps = 0
  for (const s of r.spill) spillSteps += s
  return {
    greenStartQ: th ? at(th.s) : NaN,
    greenEndQ: th ? at(th.e + 4) : NaN,
    preNorthQ: nw ? at(nw.s - 2) : NaN,
    postNorthQ: nw ? at(nw.e + 4) : NaN,
    peak: r.peakM,
    end: r.endM,
    spillSec: spillSteps * r.dt,
    maxBlocked: Math.max(...r.spillQueueM) / 7,
  }
}

const rows = []
for (const tau of taus) {
  for (const scale of scales) {
    for (const loss of losses) {
      for (const mix of mixes) {
       for (const v of speeds) {
        const payload = JSON.parse(JSON.stringify(base))
        const sim = payload.corridor_demo.simulation
        sim.vehicle.reaction_sec = tau
        sim.vehicle.startup_loss_sec = loss
        sim.vehicle.left_lane_through_mix = mix
        sim.vehicle.free_speed_mps = v
        sim.demand = { ...(sim.demand || {}), field_factor: scale }
        if (process.env.WARMUP) sim.warmup_cycles = Number(process.env.WARMUP)
        const model = buildCorridorDemo(payload)
        const b = metrics(model.variants[0])
        const a = metrics(model.variants[1])
        rows.push({ tau, scale, loss, mix, v, b, a })
       }
      }
    }
  }
}

const f = (x) => String(Math.round(x)).padStart(4)
console.log(
  'tau  scl  loss mix vf  | before: gStart gEnd preN postN peak spillS blk | after: gStart gEnd preN peak spillS',
)
for (const r of rows) {
  console.log(
    `${r.tau.toFixed(1)} ${r.scale.toFixed(2)} ${r.loss.toFixed(1)} ${r.mix.toFixed(2)} ${r.v.toFixed(1)} |` +
      `${f(r.b.greenStartQ)}${f(r.b.greenEndQ)}${f(r.b.preNorthQ)}${f(r.b.postNorthQ)}${f(r.b.peak)}` +
      `${f(r.b.spillSec)}${f(r.b.maxBlocked)} |` +
      `${f(r.a.greenStartQ)}${f(r.a.greenEndQ)}${f(r.a.preNorthQ)}${f(r.a.peak)}${f(r.a.spillSec)}`,
  )
}

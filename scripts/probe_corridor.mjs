/** 排查放行段的车辆分布：打印每 50 m 区间的在途车数，核对排队指标和实际占用是否一致 */
import { readFileSync } from 'node:fs'
import { buildCorridorDemo } from '../frontend/src/scenes/scene3-optimization/corridorDemo.js'

const payload = JSON.parse(readFileSync(new URL('../data/1-3-optimization.json', import.meta.url)))
const sim = payload.corridor_demo.simulation
if (process.env.FACTOR) sim.demand.field_factor = Number(process.env.FACTOR)
if (process.env.WARMUP) sim.warmup_cycles = Number(process.env.WARMUP)

const r = buildCorridorDemo(payload).variants[Number(process.env.V || 0)].result
const from = Number(process.env.FROM || 0)
const to = Number(process.env.TO || r.cycleLen)
for (let t = from; t <= to; t += 4) {
  const s = Math.min(r.steps - 1, Math.round(t / r.dt))
  const live = r.tracks.filter((tr) => s >= tr.from && s <= tr.to)
  const xs = live.map((tr) => tr.xs[s - tr.from]).filter((x) => !Number.isNaN(x))
  const hist = new Array(8).fill(0)
  for (const x of xs) hist[Math.min(7, Math.max(0, Math.floor(x / 50)))] += 1
  console.log(
    `t=${String(t).padStart(3)} q=${String(Math.round(r.queueM[s])).padStart(3)} ` +
      `live=${String(xs.length).padStart(3)} hist/50m=${hist.map((h) => String(h).padStart(2)).join(' ')}`,
  )
}

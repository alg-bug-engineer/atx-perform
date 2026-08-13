import { readFileSync } from 'node:fs'
import { buildCorridorDemo } from '../frontend/src/scenes/scene3-optimization/corridorDemo.js'
import { signalState } from '../frontend/src/scenes/scene3-optimization/corridorSim.js'

const payload = JSON.parse(readFileSync(new URL('../data/1-3-optimization.json', import.meta.url)))
if (process.env.FACTOR) payload.corridor_demo.simulation.demand.field_factor = Number(process.env.FACTOR)
if (process.env.WARMUP) payload.corridor_demo.simulation.warmup_cycles = Number(process.env.WARMUP)
const model = buildCorridorDemo(payload)

for (const v of model.variants) {
  const r = v.result
  console.log(`\n=== ${v.key} peak=${r.peakM.toFixed(0)} end=${r.endM.toFixed(0)} ===`)
  const rows = []
  for (let s = 0; s < r.steps; s += Math.round(4 / r.dt)) {
    const t = s * r.dt
    const abs = r.absStartS + t
    const th = signalState(r.greens.through, abs)
    const jf = r.greens.jiefang.map((g) => (signalState(g.windows, abs).green ? g.key[0] : '-')).join('')
    rows.push(
      `t=${String(Math.round(t)).padStart(3)} q=${String(Math.round(r.queueM[s])).padStart(3)}m ` +
        `occ=${String(Math.round(r.occupiedM[s])).padStart(3)}m ` +
        `blk=${String(Math.round(r.spillQueueM[s] / 7)).padStart(2)} spill=${r.spill[s]} ` +
        `jingshi=${th.green ? 'G' : 'r'}${String(th.countdown).padStart(3)} jiefang=${jf}`,
    )
  }
  console.log(rows.join('\n'))
}

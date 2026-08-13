/** 需求扫描：找一组让「现状溢出、优化后不溢出」且逐周期收敛的到达量 */
import { readFileSync } from 'node:fs'
import { buildCorridorDemo } from '../frontend/src/scenes/scene3-optimization/corridorDemo.js'

const base = JSON.parse(readFileSync(new URL('../data/1-3-optimization.json', import.meta.url)))

function run(nt, el, wr, through, mix = 0.15) {
  const payload = JSON.parse(JSON.stringify(base))
  const sim = payload.corridor_demo.simulation
  sim.sources[0].veh_per_cycle = nt
  sim.sources[1].veh_per_cycle = el
  sim.sources[2].veh_per_cycle = wr
  sim.vehicle.left_lane_through_mix = mix
  sim.turn_split = { left: (1 - through) * 0.62, through, right: (1 - through) * 0.38 }
  const model = buildCorridorDemo(payload)
  const out = {}
  for (const v of model.variants) {
    const r = v.result
    const g = r.greens.through.find((w) => w.start >= r.absStartS)
    const rel = (x) => r.queueM[Math.round(x / r.dt)]
    out[v.key] = {
      qGreenEnd: rel(120),
      qPre: rel(195),
      peak: r.peakM,
      q0: r.queueM[0],
      qEnd: r.endM,
      spill: r.spill.reduce((a, b) => a + b, 0),
      cars: r.tracks.length,
    }
  }
  return out
}

const rows = []
for (const scale of [0.8, 0.82, 0.84, 0.86, 0.88]) {
  for (const mix of [0.04, 0.08, 0.12, 0.18]) {
    const nt = Math.round(34 * scale)
    const el = Math.round(30 * scale)
    const wr = Math.round(18 * scale)
    const o = run(nt, el, wr, 0.6, mix)
    rows.push({ scale, mix, nt, el, wr, ...o })
  }
}

const f = (n) => String(Math.round(n)).padStart(4)
console.log('scale mix  需求       | before 绿末/汇入前/峰值/期末/溢出 | after 绿末/汇入前/峰值/期末/溢出')
for (const r of rows) {
  console.log(
    `${r.scale.toFixed(2)} ${r.mix.toFixed(2)} ${f(r.nt)}/${f(r.el)}/${f(r.wr)} |` +
      ` ${f(r.before.qGreenEnd)}${f(r.before.qPre)}${f(r.before.peak)}${f(r.before.qEnd)}${f(r.before.spill)} |` +
      ` ${f(r.after.qGreenEnd)}${f(r.after.qPre)}${f(r.after.peak)}${f(r.after.qEnd)}${f(r.after.spill)}`,
  )
}

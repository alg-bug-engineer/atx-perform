<script setup>
/**
 * traffic_signal_deepagent CorridorSpaceTimeDiagram.tsx 的 Vue 移植。
 * 保留 ServerDiagram / GeometricFallback 两条绘制路径及原始视觉参数。
 */
import { computed, ref, watch } from 'vue'

const props = defineProps({
  model: { type: Object, required: true },
  mode: { type: String, default: 'optimized' },
})
const emit = defineEmits(['direction-change'])

const showTraj = ref(false)
const showBands = ref(true)
const showFwd = ref(true)
const showRev = ref(true)

watch([showFwd, showRev], ([fwd, rev]) => {
  emit('direction-change', fwd && rev ? 'both' : fwd ? 'forward' : rev ? 'reverse' : 'none')
}, { immediate: true })

const nodes = computed(() => props.model.views[props.mode].nodes)
const links = computed(() => props.model.views[props.mode].links)
const cycleS = computed(() => Number(props.model.corridor.cycle_s) || 180)
const rawDiagram = computed(() => (props.mode === 'optimized' ? props.model.diagram : null))

const diagram = computed(() => {
  const d = rawDiagram.value
  if (!d) return null
  return {
    cum_distance_m: d.cum_distance_m || [],
    green_windows: (d.windows || []).map((w) => ({
      node_index: w.node,
      direction: w.dir,
      role: w.role,
      start_s: w.t0,
      end_s: w.t1,
    })),
    bandwidth_bands: (d.bands || []).map((b) => ({ direction: b.dir, points: b.pts })),
    vehicles: (d.vehicles || []).map((v) => ({
      direction: v.dir,
      points: v.pts,
      meta: { ...(v.meta || {}), role: v.role || v.meta?.role || 'main' },
      render: true,
    })),
    queue_tails: (d.queue_tails || []).map((points) => ({ points })),
  }
})

function fmtKpi(value, digits = 1) {
  if (value == null || value === '') return '—'
  const num = Number(value)
  return Number.isFinite(num) ? num.toFixed(digits) : String(value)
}

const directionEvaluation = computed(() => props.model.diagram?.evaluation?.direction_kpis?.[0] || null)
const delayKpi = computed(() => props.model.kpis.find((k) => k.name === 'coordinated_direction_delay_s'))
const kpis = computed(() => [
  { label: '延误', value: fmtKpi(directionEvaluation.value?.mean_delay_s ?? delayKpi.value?.optimized) },
  { label: '停车率', value: fmtKpi(directionEvaluation.value?.stop_rate, 2) },
  { label: '正向链式带宽', value: `${fmtKpi(props.model.corridor.bandwidth?.chained_forward_s)} s` },
  { label: '反向链式带宽', value: `${fmtKpi(props.model.corridor.bandwidth?.chained_reverse_s)} s` },
])

function travelTimeS(distanceM, speedKmh) {
  return Number(distanceM) / (Math.max(0.1, Number(speedKmh) || 40) / 3.6)
}

function greenSegments(offset, green, cycle) {
  const o = ((Number(offset) % cycle) + cycle) % cycle
  const g = Math.min(Number(green) || 0, cycle)
  if (g <= 0) return []
  return o + g <= cycle ? [[o, o + g]] : [[o, cycle], [0, o + g - cycle]]
}

function redSegments(offset, green, cycle) {
  const greens = greenSegments(offset, green, cycle).sort((a, b) => a[0] - b[0])
  if (!greens.length) return [[0, cycle]]
  const out = []
  let t = 0
  greens.forEach(([a, b]) => {
    if (a > t) out.push([t, a])
    t = Math.max(t, b)
  })
  if (t < cycle) out.push([t, cycle])
  return out
}

function repeatedSegments(base, cycle, count, fromK = 0) {
  const out = []
  for (let k = fromK; k < count; k += 1) {
    base.forEach(([a, b]) => out.push([a + k * cycle, b + k * cycle]))
  }
  return out
}

function repeatedSegmentsInRange(base, cycle, tMin, tMax) {
  const C = Math.max(1e-6, cycle)
  const out = []
  for (let k = Math.floor(tMin / C) - 1; k <= Math.ceil(tMax / C) + 1; k += 1) {
    base.forEach(([a, b]) => {
      const aa = a + k * C
      const bb = b + k * C
      if (bb <= tMin || aa >= tMax) return
      out.push([Math.max(aa, tMin), Math.min(bb, tMax)])
    })
  }
  return out
}

function sampleVehicles(vehicles, maxN, cycle) {
  const list = vehicles.filter((v) => v && v.render !== false && (v.points || []).length >= 2)
  if (list.length <= maxN) return list
  const buckets = new Map()
  list.forEach((v) => {
    const t0 = Number(v.meta?.depart_s ?? v.points?.[0]?.[0] ?? 0)
    const key = Number.isFinite(t0) ? Math.max(0, Math.floor(t0 / Math.max(1e-6, cycle))) : 0
    const bucket = buckets.get(key) || []
    bucket.push(v)
    buckets.set(key, bucket)
  })
  const keys = [...buckets.keys()].sort((a, b) => a - b)
  const per = Math.max(1, Math.floor(maxN / Math.max(keys.length, 1)))
  const picked = []
  keys.forEach((key) => {
    const bucket = buckets.get(key) || []
    const step = Math.max(1, Math.ceil(bucket.length / per))
    for (let i = 0; i < bucket.length && picked.length < maxN; i += step) picked.push(bucket[i])
  })
  return picked
}

/** 与原工作台一致：水平位移近零的轨迹片段是红灯等待/排队，其余为行驶。 */
function splitMoveWaitRuns(points = []) {
  const moveRuns = []
  const waitRuns = []
  let current = null
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i]
    const p1 = points[i + 1]
    const dt = Number(p1[0]) - Number(p0[0])
    const dx = Math.abs(Number(p1[1]) - Number(p0[1]))
    const wait = dx < 0.5 && dt > 0.5
    if (!current || current.wait !== wait) {
      current = { wait, points: [p0, p1] }
      ;(wait ? waitRuns : moveRuns).push(current)
    } else current.points.push(p1)
  }
  return { moveRuns, waitRuns }
}

const server = computed(() => {
  if (!diagram.value) return null
  const W = 920
  const H = 520
  const padL = 64
  const padR = 24
  const padT = 36
  const padB = 42
  const cum = diagram.value.cum_distance_m?.length ? diagram.value.cum_distance_m : [0]
  const xMax = Math.max(1, Number(cum[cum.length - 1]) || 1)
  const vehicles = sampleVehicles(diagram.value.vehicles || [], 180, cycleS.value).filter((v) => {
    if (v.direction === 'forward' && !showFwd.value) return false
    if (v.direction === 'reverse' && !showRev.value) return false
    return v.meta?.role !== 'right_feeder'
  })
  const windows = (diagram.value.green_windows || []).filter((w) => (
    (w.direction !== 'forward' || showFwd.value) && (w.direction !== 'reverse' || showRev.value)
  ))
  const bands = (diagram.value.bandwidth_bands || []).filter((b) => (
    (b.direction !== 'forward' || showFwd.value) && (b.direction !== 'reverse' || showRev.value)
  ))
  const tails = showTraj.value ? (diagram.value.queue_tails || []) : []

  const tMin = 0
  const tMax = Math.max(cycleS.value * 4, 1)

  const sx = (x) => padL + (Number(x) / xMax) * (W - padL - padR)
  const sy = (t) => padT + (H - padT - padB) - ((Number(t) - tMin) / (tMax - tMin)) * (H - padT - padB)
  const path = (points = [], laneDx = 0) => points.length < 2 ? '' : points.map((p, i) => `${i ? 'L' : 'M'} ${sx(p[1]) + laneDx} ${sy(p[0])}`).join(' ')
  const bandPolygon = (band) => [
    [sx(band.fromDistM), sy(band.upStart)],
    [sx(band.toDistM), sy(band.downStart)],
    [sx(band.toDistM), sy(band.downStart + band.width)],
    [sx(band.fromDistM), sy(band.upStart + band.width)],
  ].map(([x, y]) => `${x},${y}`).join(' ')
  const clipY = (t) => Math.min(H - padB, Math.max(padT, sy(t)))
  const barRect = (a, b) => {
    const y0 = clipY(b)
    const y1 = clipY(a)
    return { y: Math.min(y0, y1), h: Math.max(1, Math.abs(y1 - y0)) }
  }
  const ticks = []
  for (let t = Math.ceil(tMin / cycleS.value) * cycleS.value; t <= tMax + 1e-6; t += cycleS.value) ticks.push(t)
  const columns = cum.map((x, i) => {
    const node = nodes.value[i]
    const off = Number(node?.offsetS) || 0
    const gFwd = Number(node?.coordGreenFwdS) || 0
    const gRev = Number(node?.coordGreenRevS) || 0
    return {
      key: `n-${i}`,
      x: sx(x),
      name: node?.shortName || `N${i + 1}`,
      fwdRed: showFwd.value ? repeatedSegmentsInRange(redSegments(off, gFwd, cycleS.value), cycleS.value, tMin, tMax).map(([a, b]) => barRect(a, b)) : [],
      revRed: showRev.value ? repeatedSegmentsInRange(redSegments(off, gRev, cycleS.value), cycleS.value, tMin, tMax).map(([a, b]) => barRect(a, b)) : [],
      fwdGreen: showFwd.value ? repeatedSegmentsInRange(greenSegments(off, gFwd, cycleS.value), cycleS.value, tMin, tMax).map(([a, b]) => barRect(a, b)) : [],
      revGreen: showRev.value ? repeatedSegmentsInRange(greenSegments(off, gRev, cycleS.value), cycleS.value, tMin, tMax).map(([a, b]) => barRect(a, b)) : [],
    }
  })
  const geometricBands = []
  const appendBands = (rows, direction) => {
    rows.forEach((band) => {
      const times = [band.upStart, band.downStart, band.upStart + band.width, band.downStart + band.width]
      if (Math.max(...times) < tMin || Math.min(...times) > tMax) return
      geometricBands.push({
        key: `${direction}-${geometricBands.length}`,
        direction,
        points: bandPolygon(band),
      })
    })
  }
  links.value.forEach((link) => {
    if (showFwd.value) appendBands(link.forwardBands || [], 'forward')
    if (showRev.value) appendBands(link.reverseBands || [], 'reverse')
  })
  return {
    W, H, padL, padR, padT, padB, cum, sx, sy, path, ticks, columns,
    feederWindows: windows.filter((w) => w.role === 'left_feeder'),
    bands,
    geometricBands,
    vehicles: vehicles.map((vehicle) => ({ ...vehicle, ...splitMoveWaitRuns(vehicle.points) })),
    tails,
  }
})

const fallback = computed(() => {
  if (diagram.value || !nodes.value.length) return null
  const W = 920
  const H = 440
  const padL = 64
  const padR = 20
  const padT = 34
  const padB = 42
  const cyclesToShow = 4
  const totalTime = cycleS.value * cyclesToShow
  const cum = [0]
  links.value.forEach((link) => cum.push(cum[cum.length - 1] + Number(link.lengthM || 400)))
  const xMax = cum[cum.length - 1] || 1
  const sx = (d) => padL + (d / xMax) * (W - padL - padR)
  const sy = (t) => H - padB - (Math.max(0, Math.min(totalTime, t)) / totalTime) * (H - padT - padB)
  const repeatedGreen = (offset, green) => repeatedSegments(greenSegments(offset, green, cycleS.value), cycleS.value, cyclesToShow + 1, -1)
  const makeBands = (reverse) => {
    const out = []
    const indexes = reverse
      ? Array.from({ length: nodes.value.length - 1 }, (_, i) => nodes.value.length - 1 - i)
      : Array.from({ length: nodes.value.length - 1 }, (_, i) => i)
    indexes.forEach((i) => {
      const from = nodes.value[i]
      const to = nodes.value[reverse ? i - 1 : i + 1]
      const link = links.value[reverse ? i - 1 : i]
      const travel = travelTimeS(link?.lengthM || 400, reverse ? (link?.travelReverseS ? (link.lengthM / link.travelReverseS) * 3.6 : 40) : (link?.travelForwardS ? (link.lengthM / link.travelForwardS) * 3.6 : 40))
      const fromGreen = reverse ? from.coordGreenRevS : from.coordGreenFwdS
      const toGreen = reverse ? to.coordGreenRevS : to.coordGreenFwdS
      repeatedGreen(from.offsetS, fromGreen).forEach(([fa, fb]) => {
        repeatedGreen(to.offsetS, toGreen).forEach(([ta, tb]) => {
          const start = Math.max(fa, ta - travel)
          const end = Math.min(fb, tb - travel)
          if (end <= start || end < 0 || start > totalTime) return
          const xStart = sx(cum[i])
          const xEnd = sx(cum[reverse ? i - 1 : i + 1])
          out.push(`${xStart},${sy(start)} ${xEnd},${sy(start + travel)} ${xEnd},${sy(end + travel)} ${xStart},${sy(end)}`)
        })
      })
    })
    return out
  }
  const columns = nodes.value.map((node, i) => ({
    key: node.interId,
    x: sx(cum[i]),
    name: node.shortName,
    fwdRed: repeatedSegments(redSegments(node.offsetS, node.coordGreenFwdS, cycleS.value), cycleS.value, cyclesToShow).map(([a, b]) => ({ y: sy(b), h: Math.max(2, sy(a) - sy(b)) })),
    revRed: repeatedSegments(redSegments(node.offsetS, node.coordGreenRevS, cycleS.value), cycleS.value, cyclesToShow).map(([a, b]) => ({ y: sy(b), h: Math.max(2, sy(a) - sy(b)) })),
    fwdGreen: repeatedSegments(greenSegments(node.offsetS, node.coordGreenFwdS, cycleS.value), cycleS.value, cyclesToShow).map(([a, b]) => ({ y: sy(b), h: Math.max(2, sy(a) - sy(b)) })),
    revGreen: repeatedSegments(greenSegments(node.offsetS, node.coordGreenRevS, cycleS.value), cycleS.value, cyclesToShow).map(([a, b]) => ({ y: sy(b), h: Math.max(2, sy(a) - sy(b)) })),
  }))
  return { W, H, padL, padR, padT, padB, cyclesToShow, totalTime, sx, sy, columns, forwardBands: makeBands(false), reverseBands: makeBands(true) }
})
</script>

<template>
  <div class="space-time">
    <div class="soe-st-toolbar">
      <label><input v-model="showTraj" type="checkbox" /> 轨迹</label>
      <label><input v-model="showBands" type="checkbox" /> 绿波带</label>
      <label><input v-model="showFwd" type="checkbox" /> 正向</label>
      <label><input v-model="showRev" type="checkbox" /> 反向</label>
    </div>

    <div v-if="diagram" class="soe-st-kpis">
      <div v-for="item in kpis" :key="item.label" class="soe-st-kpi">
        <span>{{ item.label }}</span><strong>{{ item.value }}</strong>
      </div>
    </div>

    <div class="soe-st-wrap">
      <svg v-if="server" :viewBox="`0 0 ${server.W} ${server.H}`" class="soe-st-svg" role="img" aria-label="干线绿波时距图">
        <rect :width="server.W" :height="server.H" fill="#ffffff" />
        <line :x1="server.padL" :y1="server.H-server.padB" :x2="server.W-server.padR" :y2="server.H-server.padB" stroke="#cbd5e1" />
        <line :x1="server.padL" :y1="server.padT" :x2="server.padL" :y2="server.H-server.padB" stroke="#cbd5e1" />
        <text :x="(server.padL+server.W-server.padR)/2" :y="server.H-10" text-anchor="middle" font-size="11" fill="#64748b">距离 / 路口位置（米）</text>
        <text :transform="`rotate(-90 14 ${(server.padT+server.H-server.padB)/2})`" x="14" :y="(server.padT+server.H-server.padB)/2" text-anchor="middle" font-size="11" fill="#64748b">时间（秒，自下而上）</text>

        <g v-for="tick in server.ticks" :key="`tick-${tick}`">
          <line :x1="server.padL" :y1="server.sy(tick)" :x2="server.W-server.padR" :y2="server.sy(tick)" stroke="#e2e8f0" stroke-dasharray="4 3" />
          <text :x="server.padL-8" :y="server.sy(tick)+4" text-anchor="end" font-size="10" fill="#475569">{{ tick.toFixed(0) }}</text>
        </g>

        <g v-for="column in server.columns" :key="column.key">
          <line :x1="column.x" :y1="server.padT" :x2="column.x" :y2="server.H-server.padB" stroke="#cbd5e1" stroke-dasharray="4 4" />
          <text :x="column.x" :y="server.padT-10" text-anchor="middle" font-size="11" font-weight="600" fill="#1e293b">{{ column.name }}</text>
          <text :x="column.x" :y="server.H-server.padB+16" text-anchor="middle" font-size="10" fill="#334155">{{ column.name }}</text>
          <rect v-for="(r,i) in column.fwdRed" :key="`rf${i}`" :x="column.x-12" :y="r.y" width="8" :height="r.h" fill="rgba(239,68,68,.55)" rx="1" />
          <rect v-for="(r,i) in column.revRed" :key="`rr${i}`" :x="column.x+4" :y="r.y" width="8" :height="r.h" fill="rgba(220,38,38,.45)" rx="1" />
          <rect v-for="(r,i) in column.fwdGreen" :key="`gf${i}`" :x="column.x-12" :y="r.y" width="8" :height="r.h" fill="rgba(34,197,94,.88)" rx="1" />
          <rect v-for="(r,i) in column.revGreen" :key="`gr${i}`" :x="column.x+4" :y="r.y" width="8" :height="r.h" fill="rgba(21,128,61,.72)" rx="1" />
        </g>

        <rect v-for="(w,i) in server.feederWindows" :key="`feeder-${i}`" :x="server.sx(server.cum[w.node_index || 0] || 0)-12" :y="Math.min(server.sy(w.start_s),server.sy(w.end_s))" width="6" :height="Math.max(1,Math.abs(server.sy(w.end_s)-server.sy(w.start_s)))" fill="rgba(251,191,36,.55)" rx="1" />
        <polygon
          v-for="band in (showBands ? server.geometricBands : [])"
          :key="band.key"
          :points="band.points"
          :fill="band.direction === 'reverse' ? 'rgba(22,163,74,.22)' : 'rgba(74,222,128,.48)'"
          :stroke="band.direction === 'reverse' ? 'rgba(21,128,61,.85)' : 'rgba(22,163,74,.9)'"
          stroke-width="1"
          :stroke-dasharray="band.direction === 'reverse' ? '5 4' : undefined"
        />
        <path v-for="(b,i) in (showBands && !server.geometricBands.length ? server.bands : [])" :key="`band-${i}`" :d="server.path(b.points)" fill="none" :stroke="b.direction === 'reverse' ? 'rgba(56,189,248,.55)' : 'rgba(74,222,128,.55)'" stroke-width="2.5" />
        <g v-for="(v,i) in (showTraj ? server.vehicles : [])" :key="`veh-${i}`">
          <path
            v-for="(run,ri) in v.moveRuns"
            :key="`move-${ri}`"
            :d="server.path(run.points, v.direction === 'reverse' ? 2 : -2)"
            fill="none"
            :stroke="v.meta?.role === 'left_feeder' ? 'rgba(251,191,36,.85)' : (v.meta?.depart_phase === 'red' || v.meta?.side_arrival) ? 'rgba(252,165,165,.9)' : v.direction === 'reverse' ? 'rgba(56,189,248,.8)' : 'rgba(22,163,74,.75)'"
            stroke-width="1.15"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            v-for="(run,ri) in v.waitRuns"
            :key="`wait-${ri}`"
            :d="server.path(run.points, v.direction === 'reverse' ? 5 : -5)"
            fill="none"
            :stroke="v.meta?.role === 'left_feeder' ? 'rgba(234,88,12,.95)' : (v.meta?.depart_phase === 'red' || v.meta?.side_arrival) ? 'rgba(248,113,113,.98)' : 'rgba(185,28,28,.98)'"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </g>
        <path v-for="(q,i) in (showTraj ? server.tails : [])" :key="`tail-${i}`" :d="server.path(q.points)" fill="none" stroke="rgba(249,115,22,.8)" stroke-width="1.5" />

        <g v-if="showTraj" pointer-events="none">
          <rect :x="server.W-server.padR-268" :y="server.padT+4" width="264" height="44" rx="5" fill="rgba(255,255,255,.94)" stroke="#e2e8f0" />
          <line :x1="server.W-server.padR-256" :y1="server.padT+20" :x2="server.W-server.padR-236" :y2="server.padT+20" stroke="rgba(22,163,74,.9)" stroke-width="2.2" />
          <text :x="server.W-server.padR-232" :y="server.padT+24" font-size="11" fill="#166534">行驶</text>
          <line :x1="server.W-server.padR-196" :y1="server.padT+20" :x2="server.W-server.padR-176" :y2="server.padT+20" stroke="rgba(185,28,28,.95)" stroke-width="3" />
          <text :x="server.W-server.padR-172" :y="server.padT+24" font-size="11" fill="#b91c1c">红等/排队</text>
          <line :x1="server.W-server.padR-92" :y1="server.padT+20" :x2="server.W-server.padR-72" :y2="server.padT+20" stroke="rgba(234,88,12,.85)" stroke-width="1.8" stroke-dasharray="4 2" />
          <text :x="server.W-server.padR-68" :y="server.padT+24" font-size="11" fill="#c2410c">队尾</text>
          <text :x="server.W-server.padR-256" :y="server.padT+40" font-size="10" fill="#64748b">服务端 Newell 轨迹</text>
        </g>
      </svg>

      <svg v-else-if="fallback" :viewBox="`0 0 ${fallback.W} ${fallback.H}`" class="soe-st-svg" role="img" aria-label="干线绿波时距图（几何回退）">
        <rect :width="fallback.W" :height="fallback.H" fill="#ffffff" />
        <line :x1="fallback.padL" :y1="fallback.H-fallback.padB" :x2="fallback.W-fallback.padR" :y2="fallback.H-fallback.padB" stroke="#cbd5e1" />
        <line :x1="fallback.padL" :y1="fallback.padT" :x2="fallback.padL" :y2="fallback.H-fallback.padB" stroke="#cbd5e1" />
        <g v-for="tick in fallback.cyclesToShow+1" :key="`cycle-${tick}`">
          <line :x1="fallback.padL" :y1="fallback.sy((tick-1)*cycleS)" :x2="fallback.W-fallback.padR" :y2="fallback.sy((tick-1)*cycleS)" stroke="#e2e8f0" stroke-dasharray="4 3" />
          <text :x="fallback.padL-8" :y="fallback.sy((tick-1)*cycleS)+4" text-anchor="end" font-size="10" fill="#475569">{{ (tick-1)*cycleS }}秒</text>
        </g>
        <g v-for="column in fallback.columns" :key="column.key">
          <line :x1="column.x" :y1="fallback.padT" :x2="column.x" :y2="fallback.H-fallback.padB" stroke="#cbd5e1" />
          <text :x="column.x" :y="fallback.padT-12" text-anchor="middle" font-size="10" fill="#1e293b">{{ column.name }}</text>
          <rect v-for="(r,i) in (showFwd ? column.fwdRed : [])" :key="`rf${i}`" :x="column.x-12" :y="r.y" width="8" :height="r.h" fill="rgba(239,68,68,.55)" rx="1" />
          <rect v-for="(r,i) in (showRev ? column.revRed : [])" :key="`rr${i}`" :x="column.x+4" :y="r.y" width="8" :height="r.h" fill="rgba(220,38,38,.45)" rx="1" />
          <rect v-for="(r,i) in (showFwd ? column.fwdGreen : [])" :key="`gf${i}`" :x="column.x-12" :y="r.y" width="8" :height="r.h" fill="rgba(34,197,94,.88)" rx="1" />
          <rect v-for="(r,i) in (showRev ? column.revGreen : [])" :key="`gr${i}`" :x="column.x+4" :y="r.y" width="8" :height="r.h" fill="rgba(21,128,61,.72)" rx="1" />
        </g>
        <polygon v-for="(points,i) in (showBands && showFwd ? fallback.forwardBands : [])" :key="`fwd-${i}`" :points="points" fill="rgba(74,222,128,.48)" stroke="rgba(22,163,74,.9)" />
        <polygon v-for="(points,i) in (showBands && showRev ? fallback.reverseBands : [])" :key="`rev-${i}`" :points="points" fill="rgba(22,163,74,.22)" stroke="rgba(21,128,61,.85)" stroke-dasharray="5 4" />
      </svg>
    </div>
  </div>
</template>

<style scoped>
.space-time { display: flex; flex-direction: column; gap: 8px; min-height: 0; height: 100%; }
.soe-st-toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; font-size: 12px; color: #475569; }
.soe-st-toolbar label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
.soe-st-toolbar input { accent-color: #1677ff; }
.soe-st-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.soe-st-kpi { display: grid; gap: 2px; padding: 6px 10px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; }
.soe-st-kpi span { font-size: 11px; color: #64748b; }
.soe-st-kpi strong { font-size: 14px; color: #1f5b3d; font-variant-numeric: tabular-nums; }
.soe-st-wrap { width: 100%; min-height: 0; flex: 1; overflow: auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; }
.soe-st-svg { display: block; width: 100%; min-width: 720px; height: auto; background: #fff; border-radius: 10px; }
@media (max-width: 900px) { .soe-st-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>

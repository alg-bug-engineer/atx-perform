<script setup>
import { computed } from 'vue'

const props = defineProps({
  model: { type: Object, required: true },
  variant: { type: Object, required: true },
  sample: { type: Object, default: null },
  /** 对照方案此刻的排队长度：>0 时在本幅画出参考队尾与差值，供上下两幅对读 */
  ghostQueueM: { type: Number, default: 0 },
})

/**
 * 横向走廊：上游解放东路口在左、下游经十路口在右，北向南车流自左向右。
 * 行车方向朝右 → 屏幕上方是东、下方是西，因此左转往上、右转往下。
 *
 * 断面车道边界（viewBox y，东→西即上→下）。现场渠化的对应关系：
 *   - 东侧第二条左转道（dn1）是上游左转集结道（up0）的连贯延伸，位置完全不动；
 *   - 东侧第一条左转道（dn0）在距经十路 100 m 处向东拓宽新增；
 *   - 上游直行道（up1）略向西弯，一条拆成两条直行道（dn2 / dn3）；
 *   - 公交专用道 / 右转借道（up2）被中间直行道向西挤压变窄（dn4），西侧路缘不动。
 */
const UP_EDGES = [56, 91, 126, 160]
const DOWN_EDGES = [21, 56, 91, 114, 137, 160]
/** 上游 4 条边界各自渐移到展宽段的哪条边界上 */
const EDGE_MAP = [0, 2, 4, 5]
/** 展宽点才新划的两条线：dn0 | dn1、dn2 | dn3 */
const FRESH_EDGES = [1, 3]
const EDGE_CLS = ['median', 'dash', 'dash-bus', 'edge']

const GEO = {
  w: 1280,
  h: 194,
  jiefangL: 8,
  jiefangR: 108,
  jingshiL: 1128,
  jingshiR: 1228,
  downTop: DOWN_EDGES[0],
  upTop: UP_EDGES[0],
  roadBottom: DOWN_EDGES[DOWN_EDGES.length - 1],
}
const CORRIDOR_PX = GEO.jingshiL - GEO.jiefangR

const LANE_LABELS = ['左转 + 掉头', '左转', '直行', '直行', '右转借道 · 公交']
const LANE_TURN = ['left', 'left', 'through', 'through', 'right']
const UP_LABELS = ['左转集结', '直行', '公交专用道']

const lengthM = computed(() => props.model.geometry?.length_m || 368)
const pxPerM = computed(() => CORRIDOR_PX / lengthM.value)
const mx = (m) => GEO.jiefangR + m * pxPerM.value

const taperStartX = computed(() => mx(props.variant.result.taperStart))
const taperEndX = computed(() => mx(props.variant.result.taperEnd))

const downCenter = (i) => (DOWN_EDGES[i] + DOWN_EDGES[i + 1]) / 2
const upCenter = (i) => (UP_EDGES[i] + UP_EDGES[i + 1]) / 2
const downLaneH = (i) => DOWN_EDGES[i + 1] - DOWN_EDGES[i]
const upLaneH = (i) => UP_EDGES[i + 1] - UP_EDGES[i]

/** 上游车道 → 展宽后车道的默认落位，用于插值出渐变的车辆 y */
const DEFAULT_DOWN = [1, 3, 4]

/** 一条边界从上游位置渐移到展宽段位置 */
function edgePath(yUp, yDown) {
  return (
    `M ${GEO.jiefangR} ${yUp} L ${taperStartX.value} ${yUp}` +
    ` L ${taperEndX.value} ${yDown} L ${GEO.jingshiL} ${yDown}`
  )
}

/** 路面轮廓：东侧边界向东让出一条车道，西侧路缘不动 */
const roadPath = computed(
  () =>
    `M ${GEO.jiefangR} ${UP_EDGES[0]} L ${taperStartX.value} ${UP_EDGES[0]}` +
    ` L ${taperEndX.value} ${DOWN_EDGES[0]} L ${GEO.jingshiL} ${DOWN_EDGES[0]}` +
    ` L ${GEO.jingshiL} ${GEO.roadBottom} L ${GEO.jiefangR} ${GEO.roadBottom} Z`,
)

/** 公交专用道：上游一整条，展宽段被中间直行道向西挤压变窄 */
const busPath = computed(
  () =>
    `M ${GEO.jiefangR} ${UP_EDGES[2]} L ${taperStartX.value} ${UP_EDGES[2]}` +
    ` L ${taperEndX.value} ${DOWN_EDGES[4]} L ${GEO.jingshiL} ${DOWN_EDGES[4]}` +
    ` L ${GEO.jingshiL} ${GEO.roadBottom} L ${GEO.jiefangR} ${GEO.roadBottom} Z`,
)

/** 渐变车道线：上游 4 条边界渐移到展宽后位置，另外 2 条从展宽点新划 */
const laneLines = computed(() => [
  ...UP_EDGES.map((yUp, i) => ({
    cls: EDGE_CLS[i],
    d: edgePath(yUp, DOWN_EDGES[EDGE_MAP[i]]),
  })),
  ...FRESH_EDGES.map((e) => ({
    cls: 'dash',
    d: `M ${taperEndX.value} ${DOWN_EDGES[e]} L ${GEO.jingshiL} ${DOWN_EDGES[e]}`,
  })),
])

/** 展宽段路面导向箭头 */
const laneArrows = computed(() => {
  const x = GEO.jingshiL - 86
  return LANE_TURN.map((turn, i) => {
    const y = downCenter(i)
    if (turn === 'left') return { id: i, d: `M ${x} ${y + 5} L ${x + 22} ${y + 5} L ${x + 22} ${y - 6}` }
    if (turn === 'right') return { id: i, d: `M ${x} ${y - 5} L ${x + 22} ${y - 5} L ${x + 22} ${y + 6}` }
    return { id: i, d: `M ${x} ${y} L ${x + 28} ${y}` }
  })
})

const zebra = computed(() =>
  Array.from({ length: 7 }, (_, i) => ({
    id: i,
    x: GEO.jingshiL + 8 + i * 12,
    y: GEO.downTop,
    w: 6,
    h: GEO.roadBottom - GEO.downTop,
  })),
)

const ruler = computed(() => {
  const L = lengthM.value
  const out = []
  // 经十路（右）为 0 m，解放东（左）为路段全长
  out.push({ id: 'jiefang', x: mx(0), label: `${Math.round(L)} m` })
  for (let d = 50; d < L; d += 50) {
    out.push({ id: d, x: mx(L - d), label: `${d}` })
  }
  out.push({ id: 'jingshi', x: mx(L), label: '0 m' })
  return out
})

// ---- 动态 ----
const queueM = computed(() => props.sample?.queueM ?? 0)
const worstLabel = computed(
  () => ({ left: '左转', through: '直行', right: '右转' })[props.sample?.worstGroup] || '直行',
)
const spill = computed(() => !!props.sample?.spill)
const warning = computed(() => !spill.value && queueM.value >= props.model.warningM)
const queueTone = computed(() => (spill.value ? 'danger' : warning.value ? 'warn' : 'calm'))
const tailX = computed(() => mx(Math.max(0, lengthM.value - queueM.value)))

/** 对照方案的队尾（现状），画在本幅上直接量出缩短了多少 */
const ghost = computed(() => {
  const g = props.ghostQueueM
  if (!g || g <= queueM.value + 1) return null
  return {
    x: mx(Math.max(0, lengthM.value - g)),
    queueM: g,
    deltaM: Math.round(g - queueM.value),
  }
})
const warnX = computed(() => mx(Math.max(0, lengthM.value - props.model.warningM)))

/**
 * 路面上方只有两行可写字：标注行（贴着路面）和上一行。
 * 队尾会扫过整个路段，固定坐标必然撞上「展宽起点」「上游 3 车道」这些定点标注，
 * 所以把标签当占位块排：谁先占谁留在标注行，撞上的退到上一行。
 */
const ANNOT_ROWS = [GEO.downTop + 14, GEO.downTop - 3]
const UP_LANES_LABEL = '上游 3 车道'
const WIDEN_LABEL = '展宽起点 · 距经十路 100 m'
const CJK = /[\u3000-\u9fff·]/

/** 等宽字体下够用的宽度估算：中日韩字符占一个字号，其余约 0.62 */
function textW(s, size) {
  let w = 0
  for (const ch of s) w += CJK.test(ch) ? size : size * 0.62
  return w
}

const tailText = computed(() => `${worstLabel.value}队尾 ${Math.round(queueM.value)} m`)
const ghostText = computed(() =>
  ghost.value ? `现状队尾 ${Math.round(ghost.value.queueM)} m · 缩短 ${ghost.value.deltaM} m` : '',
)

const annots = computed(() => {
  // 定点标注先占位，免得它们随排队跳行：展宽起点画在上一行；
  // 上游车道数虽然贴着路面画，但和标注行只差一个字高，按占住标注行处理
  const taken = [
    [[GEO.jiefangR + 8, GEO.jiefangR + 8 + textW(UP_LANES_LABEL, 10)]],
    [[taperEndX.value + 6, taperEndX.value + 6 + textW(WIDEN_LABEL, 10)]],
  ]
  /** required 的标签排不进也要画（队尾是主角），其余排不进就不画，宁缺勿叠 */
  const place = (x, anchor, w, required) => {
    const left = anchor === 'end' ? x - w : x
    const right = left + w
    let row = taken.findIndex((occ) => occ.every(([l, r]) => right + 8 < l || left - 8 > r))
    if (row < 0) {
      if (!required) return null
      row = 0
    }
    taken[row].push([left, right])
    return { x, anchor, y: ANNOT_ROWS[row] }
  }

  const tw = textW(tailText.value, 12)
  // 排队顶到上游端时左侧只剩解放东路口，翻到队尾线右侧才不会压住路口名与灯态
  const tail =
    tailX.value - GEO.jiefangR < tw + 10
      ? place(tailX.value + 8, 'start', tw, true)
      : place(tailX.value - 8, 'end', tw, true)

  let ghostAnnot = null
  if (ghost.value) {
    const gw = textW(ghostText.value, 10)
    ghostAnnot =
      ghost.value.x - GEO.jiefangR < gw + 8
        ? place(ghost.value.x + 6, 'start', gw, false)
        : place(ghost.value.x - 6, 'end', gw, false)
  }
  return { tail, ghost: ghostAnnot }
})

const jingshiSig = computed(
  () => props.sample?.downstreamThrough || { green: false, countdown: 0 },
)
const jiefangSig = computed(() => {
  const list = props.sample?.upstreamSources || []
  return list.find((s) => s.green) || list.find((s) => s.key === 'north_through') || { green: false, countdown: 0 }
})

/**
 * 车身按实车尺寸换算：车长 4.9 m 折成像素后短于 7 m 的车头间距，
 * 排队时每辆车之间自然留出约 2 m 车距，不会连成一条色块。
 * 车宽不跟车道走：竖向比例被放大过，若按真实车宽折算会画得比车身还宽，
 * 所以取车长的 0.82，只在展宽段被挤窄的车道里再按车道宽收一档。
 */
const CAR_LEN_M = 5.4
const CAR_W_RATIO = 0.62
const CAR_LANE_FILL = 0.6
const VEH_L = computed(() => CAR_LEN_M * pxPerM.value)
const carW = (laneH) => Math.min(VEH_L.value * CAR_W_RATIO, laneH * CAR_LANE_FILL)

/**
 * 车色三段式：畅行绿 → 排队黄 → 溢出红。
 * 排队越过预警长度后，压在预警线之外（靠解放东那一段）的停车先转红；
 * 真正溢出到上游路口时整条队列转红。优化后峰值排队不到预警值，因此不会出现红色。
 */
const overflowFromM = computed(() => lengthM.value - props.model.warningM)
const carTone = (c) => {
  if (c.moving) return 'moving'
  if (spill.value) return 'jam'
  if (queueM.value >= props.model.warningM && c.x < overflowFromM.value) return 'jam'
  return 'queued'
}

const cars = computed(() => {
  const list = props.sample?.cars || []
  const t0 = props.variant.result.taperStart
  const t1 = props.variant.result.taperEnd
  const merge0 = lengthM.value - 60
  const merge1 = lengthM.value - 24
  const len = VEH_L.value
  return list.map((c) => {
    const down = c.downLane >= 0 ? c.downLane : DEFAULT_DOWN[c.upLane]
    const yUp = upCenter(c.upLane)
    const yDown = downCenter(down)
    const u = c.x <= t0 ? 0 : c.x >= t1 ? 1 : (c.x - t0) / (t1 - t0)
    const h = carW(upLaneH(c.upLane) + (downLaneH(down) - upLaneH(c.upLane)) * u)
    let yCenter = yUp + (yDown - yUp) * u
    if (c.borrowedThrough) {
      // 借道直行车在展宽后仍沿右转/公交道排队，距停止线约 60 m 才并回相邻直行道。
      const busY = c.x <= t0
        ? yUp
        : c.x >= t1
          ? downCenter(4)
          : yUp + (downCenter(4) - yUp) * u
      const mergeU = c.x <= merge0 ? 0 : c.x >= merge1 ? 1 : (c.x - merge0) / (merge1 - merge0)
      yCenter = busY + (downCenter(3) - busY) * mergeU
    }
    return {
      id: c.id,
      x: mx(c.x) - len,
      y: yCenter - h / 2,
      h,
      cls: carTone(c),
      turn: c.turn,
      borrowedThrough: c.borrowedThrough,
    }
  })
})

/** 进不去路段、堵在解放东路口里的车 */
const blockedCars = computed(() => {
  const n = Math.min(12, Math.round((props.sample?.spillQueueM ?? 0) / 7))
  const len = VEH_L.value
  const pitch = len + 5
  return Array.from({ length: n }, (_, i) => {
    const lane = Math.floor(i / 4) % 3
    const h = carW(upLaneH(lane))
    return {
      id: i,
      x: GEO.jiefangR - len - 4 - (i % 4) * pitch,
      y: upCenter(lane) - h / 2,
      h,
    }
  })
})

const sources = computed(() => props.sample?.upstreamSources || [])
const activeSource = computed(() => sources.value.find((s) => s.green) || null)

const inflowArrows = computed(() => {
  const s = activeSource.value
  if (!s) return []
  const lanes = s.key === 'east_left' ? [0] : s.key === 'west_right' ? [2] : [0, 1, 2]
  return lanes.map((l, i) => ({ id: l, y: upCenter(l), delay: `${i * 0.22}s` }))
})
</script>

<template>
  <figure class="corridor" :class="[`tone-${variant.tone}`, { spilling: spill }]">
    <figcaption class="hd">
      <span class="badge">{{ variant.key === 'before' ? '现状' : '优化后' }}</span>
      <span class="sub">{{ variant.subtitle }}</span>
      <span :class="['outcome', variant.spillback ? 'risk' : 'safe']">
        {{ variant.spillback ? '有溢出风险' : '无溢出风险' }}
      </span>
      <span v-if="spill" class="alarm">正在溢出至解放东路口</span>
    </figcaption>

    <div class="body">
      <div class="canvas-wrap">
      <svg class="canvas" :viewBox="`0 0 ${GEO.w} ${GEO.h}`" preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker
            :id="`flow-${variant.key}`"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(0,229,255,0.85)" />
          </marker>
          <marker
            :id="`arw-${variant.key}`"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="4.5"
            markerHeight="4.5"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(200,232,248,0.62)" />
          </marker>
          <clipPath :id="`stop-${variant.key}`">
            <rect x="0" y="0" :width="GEO.jingshiL + 52" :height="GEO.h" />
          </clipPath>
          <!--
            俯视小车画在 1×1 单位框里（车头朝右），再按车长 / 车宽缩放。
            车身取 currentColor 由状态类着色；描边用 non-scaling-stroke，
            缩放后仍是一条细边，让密集排队时每辆车都能分辨出轮廓。
          -->
          <g :id="`car-${variant.key}`">
            <rect x="0.50" y="0" width="0.08" height="0.06" fill="rgba(4,12,20,0.8)" />
            <rect x="0.50" y="0.94" width="0.08" height="0.06" fill="rgba(4,12,20,0.8)" />
            <path
              fill="currentColor"
              stroke="rgba(4,12,20,0.8)"
              stroke-width="0.7"
              vector-effect="non-scaling-stroke"
              d="M0.20 0.05 H0.66 C0.85 0.05 0.96 0.15 1 0.31 V0.69 C0.96 0.85 0.85 0.95 0.66 0.95 H0.20 C0.10 0.95 0.05 0.87 0.05 0.74 V0.26 C0.05 0.13 0.10 0.05 0.20 0.05 Z"
            />
            <rect x="0.18" y="0.05" width="0.15" height="0.10" fill="rgba(4,12,20,0.55)" />
            <rect x="0.62" y="0.05" width="0.15" height="0.10" fill="rgba(4,12,20,0.55)" />
            <rect x="0.18" y="0.85" width="0.15" height="0.10" fill="rgba(4,12,20,0.55)" />
            <rect x="0.62" y="0.85" width="0.15" height="0.10" fill="rgba(4,12,20,0.55)" />
            <path fill="rgba(8,20,32,0.78)" d="M0.32 0.29 L0.21 0.21 V0.79 L0.32 0.71 Z" />
            <path fill="rgba(8,20,32,0.78)" d="M0.55 0.29 L0.67 0.21 V0.79 L0.55 0.71 Z" />
            <rect x="0.94" y="0.19" width="0.055" height="0.15" fill="rgba(255,251,232,0.96)" />
            <rect x="0.94" y="0.66" width="0.055" height="0.15" fill="rgba(255,251,232,0.96)" />
          </g>
        </defs>

        <!-- 相交道路 -->
        <rect class="cross" :x="GEO.jiefangL" y="0" :width="GEO.jiefangR - GEO.jiefangL" :height="GEO.h" />
        <rect class="cross trunk" :x="GEO.jingshiL" y="0" :width="GEO.jingshiR - GEO.jingshiL" :height="GEO.h" />

        <!-- 问题方向路面 -->
        <path class="road" :d="roadPath" />
        <path class="bus-lane" :d="busPath" />
        <path v-for="(l, i) in laneLines" :key="`ln${i}`" :class="['mark', l.cls]" :d="l.d" />

        <!-- 展宽标注 -->
        <line class="widen-tick" :x1="taperEndX" :y1="GEO.downTop + 2" :x2="taperEndX" :y2="GEO.roadBottom + 6" />
        <text class="widen-label" :x="taperEndX + 6" :y="ANNOT_ROWS[1]">
          <tspan class="lbl">展宽起点 · 距经十路 </tspan>
          <tspan class="val">100 m</tspan>
        </text>
        <text class="widen-label dim" :x="GEO.jiefangR + 8" :y="GEO.upTop - 8">{{ UP_LANES_LABEL }}</text>

        <!-- 蓄车边界 / 预警线 -->
        <line class="ref warn" :x1="warnX" :y1="GEO.upTop - 4" :x2="warnX" :y2="GEO.roadBottom + 4" />
        <line class="ref storage" :x1="GEO.jiefangR" :y1="GEO.upTop - 10" :x2="GEO.jiefangR" :y2="GEO.roadBottom + 10" />

        <!-- 汇入 -->
        <g v-if="inflowArrows.length" class="inflow">
          <line
            v-for="a in inflowArrows"
            :key="`in${a.id}`"
            :x1="GEO.jiefangL + 8"
            :y1="a.y"
            :x2="GEO.jiefangR + 30"
            :y2="a.y"
            :style="{ animationDelay: a.delay }"
            :marker-end="`url(#flow-${variant.key})`"
          />
        </g>

        <!-- 车辆 -->
        <g class="fleet" :clip-path="`url(#stop-${variant.key})`">
          <use
            v-for="c in blockedCars"
            :key="`bk${c.id}`"
            :class="['car', spill ? 'jam blocked' : 'queued']"
            :href="`#car-${variant.key}`"
            :transform="`translate(${c.x} ${c.y}) scale(${VEH_L} ${c.h})`"
          />
          <use
            v-for="c in cars"
            :key="c.id"
            :class="['car', c.cls, c.turn, { 'borrowed-through': c.borrowedThrough }]"
            :href="`#car-${variant.key}`"
            :transform="`translate(${c.x} ${c.y}) scale(${VEH_L} ${c.h})`"
          />
        </g>

        <!-- 停止线与人行横道 -->
        <line class="stop-line" :x1="GEO.jingshiL" :y1="GEO.downTop" :x2="GEO.jingshiL" :y2="GEO.roadBottom" />
        <rect v-for="z in zebra" :key="`z${z.id}`" class="zebra" :x="z.x" :y="z.y" :width="z.w" :height="z.h" />

        <!-- 车道功能 -->
        <path
          v-for="a in laneArrows"
          :key="`ar${a.id}`"
          class="lane-arrow"
          :d="a.d"
          :marker-end="`url(#arw-${variant.key})`"
        />
        <text v-for="(l, i) in LANE_LABELS" :key="`ll${i}`" class="lane-label" :x="GEO.jingshiL - 8" :y="downCenter(i) + 3" text-anchor="end">
          {{ l }}
        </text>
        <g v-for="(l, i) in UP_LABELS" :key="`ul${i}`">
          <rect
            class="up-label-bg"
            :x="GEO.jiefangR + 6"
            :y="upCenter(i) - 7"
            :width="l.length * 9.5 + 8"
            :height="14"
          />
          <text class="up-label" :x="GEO.jiefangR + 10" :y="upCenter(i) + 3">{{ l }}</text>
        </g>

        <g class="tail" :class="queueTone">
          <line :x1="tailX" :y1="GEO.downTop" :x2="tailX" :y2="GEO.roadBottom + 8" />
          <text :x="annots.tail.x" :y="annots.tail.y" :text-anchor="annots.tail.anchor">
            <tspan class="lbl">{{ worstLabel }}队尾 </tspan>
            <tspan class="val">{{ Math.round(queueM) }} m</tspan>
          </text>
        </g>

        <!-- 与上一幅对读：现状队尾位置 + 缩短量 -->
        <g v-if="ghost" class="ghost">
          <line :x1="ghost.x" :y1="GEO.downTop" :x2="ghost.x" :y2="GEO.roadBottom + 8" />
          <text v-if="annots.ghost" :x="annots.ghost.x" :y="annots.ghost.y" :text-anchor="annots.ghost.anchor">
            <tspan class="lbl">现状队尾 </tspan>
            <tspan class="val">{{ Math.round(ghost.queueM) }} m</tspan>
            <tspan class="lbl"> · 缩短 </tspan>
            <tspan class="val">{{ ghost.deltaM }} m</tspan>
          </text>
          <line class="span" :x1="ghost.x" :y1="GEO.downTop + 18" :x2="tailX" :y2="GEO.downTop + 18" />
        </g>

        <!-- 标尺 -->
        <g class="ruler">
          <line :x1="GEO.jiefangR" :y1="GEO.roadBottom + 16" :x2="GEO.jingshiL" :y2="GEO.roadBottom + 16" />
          <g v-for="r in ruler" :key="`rl${r.id}`">
            <line :x1="r.x" :y1="GEO.roadBottom + 13" :x2="r.x" :y2="GEO.roadBottom + 19" />
            <text :x="r.x" :y="GEO.roadBottom + 30" text-anchor="middle">{{ r.label }}</text>
          </g>
        </g>

        <!-- 路口名 + 灯态 -->
        <g class="sig" :transform="`translate(${(GEO.jiefangL + GEO.jiefangR) / 2}, 10)`">
          <circle r="7" :class="['lamp', jiefangSig.green ? 'g' : 'r']" />
          <text class="inter-name" y="22" text-anchor="middle">解放东路口</text>
          <text class="cd" y="34" text-anchor="middle">
            <tspan :class="jiefangSig.green ? 'g' : 'r'">{{ jiefangSig.green ? '绿灯' : '红灯' }}</tspan>
            <tspan class="w"> {{ jiefangSig.countdown || 0 }} s</tspan>
          </text>
        </g>
        <g class="sig" :transform="`translate(${(GEO.jingshiL + GEO.jingshiR) / 2}, 10)`">
          <circle r="7" :class="['lamp', jingshiSig.green ? 'g' : 'r']" />
          <text class="inter-name trunk" y="22" text-anchor="middle">经十路口</text>
          <text class="cd" y="34" text-anchor="middle">
            <tspan :class="jingshiSig.green ? 'g' : 'r'">{{ jingshiSig.green ? '绿灯' : '红灯' }}</tspan>
            <tspan class="w"> {{ jingshiSig.countdown || 0 }} s</tspan>
          </text>
        </g>
      </svg>
      </div>
    </div>
    <div v-if="$slots.foot" class="foot">
      <slot name="foot" />
    </div>
  </figure>
</template>

<style scoped>
.corridor {
  margin: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 4px;
  padding: 4px 8px 6px;
  border: 1px solid var(--cyan-border);
  border-left: 3px solid var(--cyan-border);
  border-radius: 2px;
  background: rgba(2, 10, 24, 0.72);
}
.corridor.tone-danger { border-left-color: var(--danger); }
.corridor.tone-ok { border-left-color: var(--ok); }
.corridor.spilling { box-shadow: inset 0 0 28px rgba(255, 68, 68, 0.08); }

.hd {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: center;
  gap: 10px;
  flex: none;
  text-align: center;
}
.badge {
  padding: 3px 14px;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 3px;
  border: 1px solid currentColor;
  border-radius: 2px;
  color: var(--text);
}
.tone-danger .badge { color: var(--danger); border-color: var(--danger); }
.tone-ok .badge { color: var(--ok); border-color: var(--ok); }
.sub { font-size: 12px; color: var(--text); }
.alarm {
  font-size: 12px;
  font-weight: 600;
  color: var(--danger);
}
.outcome {
  padding: 2px 8px;
  border: 1px solid currentColor;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
}
.outcome.risk { color: var(--danger); background: rgba(255, 68, 68, 0.12); }
.outcome.safe { color: var(--ok); background: rgba(51, 204, 136, 0.12); }

.foot { flex: none; min-width: 0; }
.body {
  flex: 1 1 0;
  min-height: 0;
  display: grid;
}
.canvas-wrap {
  position: relative;
  min-height: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.cross { fill: #07182a; stroke: rgba(0, 229, 255, 0.2); }
.cross.trunk { fill: #082137; }

.road { fill: #0b2540; stroke: none; }
.bus-lane { fill: rgba(0, 229, 255, 0.05); }

.mark { fill: none; }
.mark.dash { stroke: rgba(214, 236, 250, 0.32); stroke-width: 1.2; stroke-dasharray: 11 9; }
/* 公交专用道允许右转车借道，与直行道之间是虚线 */
.mark.dash-bus { stroke: rgba(0, 229, 255, 0.34); stroke-width: 1.4; stroke-dasharray: 11 9; }
.mark.median { stroke: rgba(255, 200, 60, 0.5); stroke-width: 1.8; }
.mark.edge { stroke: rgba(214, 236, 250, 0.42); stroke-width: 1.4; }

.widen-tick { stroke: rgba(0, 229, 255, 0.4); stroke-width: 1; stroke-dasharray: 3 3; }
.widen-label { font-size: 10px; fill: rgba(220, 245, 255, 0.92); letter-spacing: 0.4px; }
.widen-label .val { fill: var(--text); }
.widen-label.dim { fill: rgba(220, 245, 255, 0.92); }

.ghost line {
  stroke: rgba(255, 68, 68, 0.55);
  stroke-width: 1.2;
  stroke-dasharray: 4 4;
}
.ghost .span {
  stroke: rgba(51, 204, 136, 0.85);
  stroke-dasharray: none;
  stroke-width: 1.4;
}
.ghost text {
  font-size: 10px;
  fill: rgba(220, 245, 255, 0.92);
  font-family: var(--font-mono);
}
.ghost text .val { fill: var(--text); }

.ref { stroke-dasharray: 5 4; }
.ref.warn { stroke: rgba(255, 204, 0, 0.4); stroke-width: 1.2; }
.ref.storage { stroke: rgba(255, 68, 68, 0.6); stroke-width: 1.6; }

.stop-line { stroke: rgba(228, 246, 255, 0.85); stroke-width: 3; }
.zebra { fill: rgba(214, 236, 250, 0.22); }
.lane-arrow { fill: none; stroke: rgba(200, 232, 248, 0.5); stroke-width: 1.4; }
.lane-label { font-size: 10px; fill: rgba(220, 245, 255, 0.88); }
.up-label { font-size: 9.5px; fill: rgba(220, 245, 255, 0.88); }
.up-label-bg { fill: rgba(2, 16, 28, 0.82); }

/* 车身用 currentColor：color 可继承进 <use> 的影子树，状态类只改 color */
.car { transition: color 0.35s linear; }
.car.moving { color: #3ddc97; }
.car.queued { color: #ffcc3d; }
.car.jam { color: #ff5252; }
.car.right { opacity: 0.86; }
.car.borrowed-through { filter: drop-shadow(0 0 1px rgba(0, 229, 255, 0.75)); }
/* 滞留在上游路口的车：颜色沿用同一套三段式，只在真正溢出时闪烁报警 */
.car.blocked { animation: blink 0.8s ease-in-out infinite; }
@keyframes blink { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }

.inflow line {
  stroke: var(--cyan);
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-dasharray: 10 12;
  animation: inflow 0.9s linear infinite;
}
@keyframes inflow {
  from { stroke-dashoffset: 22; opacity: 0.35; }
  50% { opacity: 1; }
  to { stroke-dashoffset: 0; opacity: 0.35; }
}

.occ line { stroke: rgba(200, 232, 248, 0.32); stroke-width: 1; stroke-dasharray: 2 5; }
.occ text { font-size: 9.5px; fill: rgba(200, 232, 248, 0.5); font-family: var(--font-mono); }

.tail line {
  stroke-width: 1.2;
  stroke-dasharray: 4 4;
  transition: x1 0.32s linear, x2 0.32s linear;
}
.tail text {
  font-size: 12px;
  font-family: var(--font-mono);
  fill: rgba(220, 245, 255, 0.92);
  transition: x 0.32s linear;
}
.tail .lbl { fill: rgba(220, 245, 255, 0.92); }
.tail.calm line { stroke: var(--ok); }
.tail.calm .val { fill: var(--ok); }
.tail.warn line { stroke: #ffcc3d; }
.tail.warn .val { fill: #ffcc3d; }
.tail.danger line { stroke: var(--danger); stroke-width: 2; }
.tail.danger .val { fill: var(--danger); }
.tail line { fill: none; }

.ruler line { stroke: rgba(0, 229, 255, 0.24); stroke-width: 1; }
.ruler text { font-size: 9px; fill: rgba(220, 245, 255, 0.72); font-family: var(--font-mono); }

.inter-name { font-size: 12px; fill: rgba(220, 245, 255, 0.92); letter-spacing: 1px; }
.inter-name.trunk { fill: rgba(220, 245, 255, 0.92); }
.sig .lamp { stroke: rgba(255, 255, 255, 0.35); stroke-width: 1; }
.sig .lamp.g { fill: #33cc88; }
.sig .lamp.r { fill: #ff4444; }
.sig .cd { font-size: 9px; fill: rgba(220, 245, 255, 0.92); font-family: var(--font-mono); }
.sig .cd .g { fill: var(--text); }
.sig .cd .r { fill: var(--text); }
.sig .cd .w { fill: rgba(220, 245, 255, 0.92); }
</style>

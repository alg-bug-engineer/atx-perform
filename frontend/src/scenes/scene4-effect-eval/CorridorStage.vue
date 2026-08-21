<script setup>
import { computed } from 'vue'

const props = defineProps({
  model: { type: Object, required: true },
  variant: { type: Object, required: true },
  sample: { type: Object, default: null },
})

/**
 * 竖向走廊：上游解放东路口在上、下游经十路口在下，北向南车流自上而下。
 * 画面按原横向几何顺时针转 90°：左侧是西、右侧是东，左转朝右、右转朝左。
 *
 * 断面车道边界（viewBox y，东→西即上→下）。现场渠化的对应关系：
 *   - 东侧第二条左转道（dn1）是上游左转集结道（up0）的连贯延伸，位置完全不动；
 *   - 东侧第一条左转道（dn0）在距经十路 90 m 处向东拓宽新增；
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
/**
 * 竖屏后路段南北向过长、断面过窄。先顺时针转 90°，再把东西向拉宽、南北向压短，
 * 整幅仍用 meet 落入栏内：路更清楚。标注/灯态/车辆单独抵消非等比缩放，避免拉扁。
 */
const FIT_EW = 1.25
const FIT_NS = 0.4
const VIEW_W = GEO.h * FIT_EW
const VIEW_H = GEO.w * FIT_NS
const SCENE_TRANSFORM = `scale(${FIT_EW} ${FIT_NS}) translate(${GEO.h} 0) rotate(90)`
const LABEL_ISO = 0.56
function upright(x, y) {
  return (
    `rotate(-90 ${x} ${y})` +
    ` translate(${x} ${y})` +
    ` scale(${LABEL_ISO / FIT_EW} ${LABEL_ISO / FIT_NS})` +
    ` translate(${-x} ${-y})`
  )
}
function sigXf(x, y) {
  return `translate(${x} ${y}) rotate(-90) scale(${LABEL_ISO / FIT_EW} ${LABEL_ISO / FIT_NS})`
}
function isoAt(x, y, k = LABEL_ISO) {
  return `translate(${x} ${y}) scale(${k / FIT_NS} ${k / FIT_EW}) translate(${-x} ${-y})`
}

const INFLOW_DASH = 10 / FIT_NS
const INFLOW_GAP = 12 / FIT_NS
const INFLOW_CYCLE = INFLOW_DASH + INFLOW_GAP
const INFLOW_STROKE = 2.4 / FIT_EW
const MARKER_UNSTRETCH = `translate(9 5) scale(${1 / FIT_NS} ${1 / FIT_EW}) translate(-9 -5)`

const LANE_LABELS = [
  { lines: ['左转 + 掉头'] },
  { lines: ['左转'] },
  { lines: ['直行'] },
  { lines: ['直行'] },
  { lines: ['右转借道', '公交'] },
]
const LANE_TURN = ['left', 'left', 'through', 'through', 'right']
const UP_LABELS = [
  { lines: ['左转集结'] },
  { lines: ['直行'] },
  { lines: ['公交', '专用道'] },
]
/** 贴在展宽段路面上、停止线稍北，按车道中心对齐 */
const LANE_LABEL_X = GEO.jingshiL - 44
/** 贴在上游路段上，按车道中心对齐 */
const UP_LABEL_X = GEO.jiefangR + 40
/** 灯态留在坐标尺一侧；路口名叠在左侧空白与坐标端点齐平 */
const SIG_Y = GEO.roadBottom + 22
function laneLabelDy(n, k) {
  if (n < 2) return '0'
  return k === 0 ? '-0.55em' : '1.2em'
}

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
    if (turn === 'left') return { id: i, cx: x + 14, cy: y, d: `M ${x} ${y + 5} L ${x + 22} ${y + 5} L ${x + 22} ${y - 6}` }
    if (turn === 'right') return { id: i, cx: x + 14, cy: y, d: `M ${x} ${y - 5} L ${x + 22} ${y - 5} L ${x + 22} ${y + 6}` }
    return { id: i, cx: x + 14, cy: y, d: `M ${x} ${y} L ${x + 28} ${y}` }
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

const warnX = computed(() => mx(Math.max(0, lengthM.value - props.model.warningM)))

/**
 * 路面上方只有两行可写字：标注行（贴着路面）和上一行。
 * 队尾会扫过整个路段，固定坐标必然撞上「展宽起点」「上游 3 车道」这些定点标注，
 * 所以把标签当占位块排：谁先占谁留在标注行，撞上的退到上一行。
 */
const ANNOT_ROWS = [GEO.downTop + 14, GEO.downTop - 3]
const UP_LANES_LABEL = '上游 3 车道'
const WIDEN_LABEL = '展宽起点 · 距经十路 90 m'
const CJK = /[\u3000-\u9fff·]/

/** 等宽字体下够用的宽度估算：中日韩字符占一个字号，其余约 0.62 */
function textW(s, size) {
  let w = 0
  for (const ch of s) w += CJK.test(ch) ? size : size * 0.62
  return w
}

const tailText = computed(() => `${worstLabel.value}队尾 ${Math.round(queueM.value)} m`)

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
  // 竖屏后文字沿东西向排：start 落在路右侧，end 会扫到路左侧。动态标签一律靠右。
  const tail = place(tailX.value + 8, 'start', tw, true)
  return { tail }
})

const jingshiSig = computed(
  () => props.sample?.downstreamThrough || { green: false, countdown: 0 },
)
const jiefangSig = computed(() => {
  const list = props.sample?.upstreamSources || []
  return list.find((s) => s.green) || list.find((s) => s.key === 'north_through') || { green: false, countdown: 0 }
})

/** 车身按仿真中的实车尺寸换算，车长与队尾计算共用 5.4 m 口径。 */
const CAR_LEN_M = 5.4
const CAR_W_RATIO = 0.62
const CAR_LANE_FILL = 0.72
const VEH_L = computed(() => CAR_LEN_M * pxPerM.value)
const carW = (laneH) => Math.min(VEH_L.value * CAR_W_RATIO, laneH * CAR_LANE_FILL)

/* ── 车辆绘制尺寸（仅影响画得多大，不改车辆位置/排队间距/队尾线）──
 * 场景做了非等比缩放（沿路 FIT_NS 压短、断面 FIT_EW 拉宽），故先在屏幕空间
 * 定尺寸再换回本地坐标，避免车被拉扫：
 *   车长：按 CAR_LEN_ISO 放大，但封顶到「车头间距 − 最小间隙」——车头钉在仿真位置，
 *          车身向车尾生长，故满排队（车头间距 7 m）也不交叠，队列头部仍贴停止线；
 *   车宽：按各车道净宽自适应（车道越宽车越宽），并限制 ≤ 车长，避免宽车道把车拉成横条。 */
const CAR_HEAD_M = 7 // 与仿真 vehicle.space_m 一致：满排队时车头间距
const CAR_LEN_ISO = 1.7 // 车长放大系数（实际受车头间距封顶，不会导致交叠）
const CAR_GAP_S = 0.6 // 满排队时相邻车最小可视间隙（屏幕px）
const CAR_LANE_W_FILL = 0.5 // 车宽占车道净宽比例（屏幕），随车道宽自适应
const CAR_MAX_WL = 2.2 // 车宽/车长上限：>1 允许车宽大于车长以填满车道（车长受车头间距锁死，仅车宽可放大）
function carBox(c) {
  const carS = VEH_L.value * FIT_NS // 实车长（屏幕）
  const headS = CAR_HEAD_M * pxPerM.value * FIT_NS // 车头间距（屏幕）
  const lenS = Math.min(carS * CAR_LEN_ISO, headS - CAR_GAP_S) // 车长封顶到车头间距 → 不交叠
  const laneS = (c.laneH || VEH_L.value) * FIT_EW // 车道净宽（屏幕）
  const widS = Math.min(laneS * CAR_LANE_W_FILL, lenS * CAR_MAX_WL) // 随车道宽自适应，上限防止填满整条车道
  const len = lenS / FIT_NS
  const w = widS / FIT_EW
  const front = c.x + VEH_L.value
  return { len, w, cx: front - len / 2, cy: c.y + c.h / 2 }
}
function carXf(c) {
  const { len, w, cx, cy } = carBox(c)
  return `translate(${cx - len / 2} ${cy - w / 2}) scale(${len} ${w})`
}

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
  const t0 = props.variant.result.taperStart
  const t1 = props.variant.result.taperEnd
  const list = props.sample?.cars || []
  const merge0 = lengthM.value - 60
  const merge1 = lengthM.value - 24
  const len = VEH_L.value
  return list.map((c) => {
    const px = c.x
    const down = c.downLane >= 0 ? c.downLane : DEFAULT_DOWN[c.upLane]
    const yUp = upCenter(c.upLane)
    const yDown = downCenter(down)
    const u = px <= t0 ? 0 : px >= t1 ? 1 : (px - t0) / (t1 - t0)
    const laneH = upLaneH(c.upLane) + (downLaneH(down) - upLaneH(c.upLane)) * u
    const h = carW(laneH)
    let yCenter = yUp + (yDown - yUp) * u
    if (c.borrowedThrough) {
      // 借道直行车在展宽后仍沿右转/公交道排队，距停止线约 60 m 才并回相邻直行道。
      const busY = px <= t0
        ? yUp
        : px >= t1
          ? downCenter(4)
          : yUp + (downCenter(4) - yUp) * u
      const mergeU = px <= merge0 ? 0 : px >= merge1 ? 1 : (px - merge0) / (merge1 - merge0)
      yCenter = busY + (downCenter(3) - busY) * mergeU
    }
    return {
      id: c.id,
      x: mx(px) - len,
      y: yCenter - h / 2,
      h,
      laneH,
      cls: carTone(c),
      turn: c.turn,
      borrowedThrough: c.borrowedThrough,
    }
  })
})

/** 进不去路段、堵在解放东路口里的车 */
const blockedCars = computed(() => {
  const n = Math.min(5, Math.round((props.sample?.spillQueueM ?? 0) / 16))
  const len = VEH_L.value
  const pitch = CAR_HEAD_M * pxPerM.value + 8
  return Array.from({ length: n }, (_, i) => {
    const lane = Math.floor(i / 3) % 3
    const laneH = upLaneH(lane)
    const h = carW(laneH)
    return {
      id: i,
      x: GEO.jiefangR - len - 4 - (i % 3) * pitch,
      y: upCenter(lane) - h / 2,
      h,
      laneH,
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
      <p class="road-name">奥体西路 · 北向南</p>
      <p class="inter-float north">解放东路口</p>
      <p class="inter-float south">经十路口</p>
      <svg class="canvas" :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`" preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker
            :id="`flow-${variant.key}`"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto"
            overflow="visible"
          >
            <path :transform="MARKER_UNSTRETCH" d="M 0 0 L 10 5 L 0 10 z" fill="rgba(0,229,255,0.85)" />
          </marker>
          <marker
            :id="`arw-${variant.key}`"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="4.5"
            markerHeight="4.5"
            orient="auto"
            overflow="visible"
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

        <g :transform="SCENE_TRANSFORM">
        <!-- 相交道路 -->
        <rect class="cross" :x="GEO.jiefangL" y="0" :width="GEO.jiefangR - GEO.jiefangL" :height="GEO.h" />
        <rect class="cross trunk" :x="GEO.jingshiL" y="0" :width="GEO.jingshiR - GEO.jingshiL" :height="GEO.h" />

        <!-- 问题方向路面 -->
        <path class="road" :d="roadPath" />
        <path class="bus-lane" :d="busPath" />
        <path v-for="(l, i) in laneLines" :key="`ln${i}`" :class="['mark', l.cls]" :d="l.d" />

        <!-- 展宽标注 -->
        <line class="widen-tick" :x1="taperEndX" :y1="GEO.downTop + 2" :x2="taperEndX" :y2="GEO.roadBottom + 6" />
        <text class="widen-label" :x="taperEndX + 6" :y="ANNOT_ROWS[1]" :transform="upright(taperEndX + 6, ANNOT_ROWS[1])">
          <tspan class="lbl">展宽起点 · 距经十路 </tspan>
          <tspan class="val">90 m</tspan>
        </text>
        <text class="widen-label dim" :x="GEO.jiefangR + 8" :y="GEO.upTop - 8" :transform="upright(GEO.jiefangR + 8, GEO.upTop - 8)">{{ UP_LANES_LABEL }}</text>

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
            :style="{
              animationDelay: a.delay,
              strokeDasharray: `${INFLOW_DASH} ${INFLOW_GAP}`,
              strokeWidth: INFLOW_STROKE,
              '--inflow-cycle': INFLOW_CYCLE,
            }"
            :marker-end="`url(#flow-${variant.key})`"
          />
        </g>

        <!-- 车辆：车头钉在仿真位置，进场时车身完整穿过解放东路口开进来 -->
        <g class="fleet" :clip-path="`url(#stop-${variant.key})`">
          <use
            v-for="c in blockedCars"
            :key="`bk${c.id}`"
            :class="['car', spill ? 'jam blocked' : 'queued']"
            :href="`#car-${variant.key}`"
            :transform="carXf(c)"
          />
          <use
            v-for="c in cars"
            :key="c.id"
            :class="['car', c.cls, c.turn, { 'borrowed-through': c.borrowedThrough }]"
            :href="`#car-${variant.key}`"
            :transform="carXf(c)"
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
          :transform="isoAt(a.cx, a.cy)"
          :marker-end="`url(#arw-${variant.key})`"
        />
        <text
          v-for="(l, i) in LANE_LABELS"
          :key="`ll${i}`"
          class="lane-label"
          :x="LANE_LABEL_X"
          :y="downCenter(i)"
          text-anchor="middle"
          dominant-baseline="middle"
          :transform="upright(LANE_LABEL_X, downCenter(i))"
        >
          <tspan
            v-for="(line, k) in l.lines"
            :key="k"
            :x="LANE_LABEL_X"
            :dy="laneLabelDy(l.lines.length, k)"
          >{{ line }}</tspan>
        </text>
        <text
          v-for="(l, i) in UP_LABELS"
          :key="`ul${i}`"
          class="lane-label"
          :x="UP_LABEL_X"
          :y="upCenter(i)"
          text-anchor="middle"
          dominant-baseline="middle"
          :transform="upright(UP_LABEL_X, upCenter(i))"
        >
          <tspan
            v-for="(line, k) in l.lines"
            :key="k"
            :x="UP_LABEL_X"
            :dy="laneLabelDy(l.lines.length, k)"
          >{{ line }}</tspan>
        </text>

        <g class="tail" :class="queueTone">
          <line :x1="tailX" :y1="GEO.downTop" :x2="tailX" :y2="GEO.roadBottom + 8" />
          <text :x="annots.tail.x" :y="annots.tail.y" :text-anchor="annots.tail.anchor" :transform="upright(annots.tail.x, annots.tail.y)">
            <tspan class="lbl">{{ worstLabel }}队尾 </tspan>
            <tspan class="val">{{ Math.round(queueM) }} m</tspan>
          </text>
        </g>

        <!-- 标尺 -->
        <g class="ruler">
          <line :x1="GEO.jiefangR" :y1="GEO.roadBottom + 16" :x2="GEO.jingshiL" :y2="GEO.roadBottom + 16" />
          <g v-for="r in ruler" :key="`rl${r.id}`">
            <line :x1="r.x" :y1="GEO.roadBottom + 13" :x2="r.x" :y2="GEO.roadBottom + 19" />
            <text :x="r.x" :y="GEO.roadBottom + 30" text-anchor="middle" :transform="upright(r.x, GEO.roadBottom + 30)">{{ r.label }}</text>
          </g>
        </g>

        <!-- 灯态留在路口坐标尺侧；路口名贴在奥体西路上 -->
        <g class="sig" :transform="sigXf((GEO.jiefangL + GEO.jiefangR) / 2, SIG_Y)">
          <circle r="7" :class="['lamp', jiefangSig.green ? 'g' : 'r']" />
          <text class="cd" y="16" text-anchor="middle">
            <tspan :class="jiefangSig.green ? 'g' : 'r'">{{ jiefangSig.green ? '绿灯' : '红灯' }}</tspan>
            <tspan class="w"> {{ jiefangSig.countdown || 0 }} s</tspan>
          </text>
        </g>
        <g class="sig" :transform="sigXf((GEO.jingshiL + GEO.jingshiR) / 2, SIG_Y)">
          <circle r="7" :class="['lamp', jingshiSig.green ? 'g' : 'r']" />
          <text class="cd" y="16" text-anchor="middle">
            <tspan :class="jingshiSig.green ? 'g' : 'r'">{{ jingshiSig.green ? '绿灯' : '红灯' }}</tspan>
            <tspan class="w"> {{ jingshiSig.countdown || 0 }} s</tspan>
          </text>
        </g>
        </g>
      </svg>
      <p v-if="variant.key === 'after'" class="coord-note">下游先放行，上游再放</p>
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
.coord-note {
  flex: none;
  align-self: center;
  margin: 0;
  padding: 0 12px 0 8px;
  font-size: 22px;
  font-weight: 800;
  letter-spacing: 2px;
  color: var(--cyan);
  white-space: nowrap;
  writing-mode: horizontal-tb;
  text-shadow:
    0 0 10px rgba(0, 229, 255, 0.55),
    1px 0 0 rgba(2, 16, 28, 0.92),
    -1px 0 0 rgba(2, 16, 28, 0.92),
    0 1px 0 rgba(2, 16, 28, 0.92),
    0 -1px 0 rgba(2, 16, 28, 0.92);
  pointer-events: none;
}
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
  display: flex;
  min-height: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.canvas {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  width: auto;
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
.widen-label { font-size: 16px; fill: rgba(220, 245, 255, 0.92); letter-spacing: 0.4px; }
.widen-label .val { fill: var(--text); }
.widen-label.dim { fill: rgba(220, 245, 255, 0.92); }

.ref { stroke-dasharray: 5 4; }
.ref.warn { stroke: rgba(255, 204, 0, 0.4); stroke-width: 1.2; }
.ref.storage { stroke: rgba(255, 68, 68, 0.6); stroke-width: 1.6; }

.stop-line { stroke: rgba(228, 246, 255, 0.85); stroke-width: 3; }
.zebra { fill: rgba(214, 236, 250, 0.22); }
.lane-arrow { fill: none; stroke: rgba(200, 232, 248, 0.5); stroke-width: 1.4; }
.lane-label {
  font-size: 10px;
  font-weight: 600;
  fill: rgba(220, 245, 255, 0.92);
  paint-order: stroke;
  stroke: rgba(2, 16, 28, 0.72);
  stroke-width: 2.4px;
}
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
  stroke-linecap: round;
  animation: inflow 0.9s linear infinite;
}
@keyframes inflow {
  from { stroke-dashoffset: var(--inflow-cycle); opacity: 0.35; }
  50% { opacity: 1; }
  to { stroke-dashoffset: 0; opacity: 0.35; }
}

.occ line { stroke: rgba(200, 232, 248, 0.32); stroke-width: 1; stroke-dasharray: 2 5; }
.occ text { font-size: 9.5px; fill: rgba(200, 232, 248, 0.5); font-family: var(--font-mono); }

.tail line {
  stroke-width: 1.2;
  stroke-dasharray: 4 4;
}
.tail text {
  font-size: 13px;
  font-family: var(--font-mono);
  fill: rgba(220, 245, 255, 0.92);
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
.ruler text { font-size: 15px; fill: rgba(220, 245, 255, 0.72); font-family: var(--font-mono); }

.inter-name { font-size: 12px; font-weight: 700; fill: rgba(220, 245, 255, 0.96); letter-spacing: 1px; }
.inter-name.trunk { fill: rgba(220, 245, 255, 0.96); }
.road-name {
  position: absolute;
  left: 10%;
  right: auto;
  top: 50%;
  z-index: 2;
  margin: 0;
  transform: translateY(-50%);
  font-size: 20px;
  font-weight: 700;
  color: rgba(220, 245, 255, 0.96);
  letter-spacing: 4px;
  writing-mode: vertical-rl;
  pointer-events: none;
}
.inter-float {
  position: absolute;
  left: 8%;
  z-index: 2;
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: rgba(220, 245, 255, 0.96);
  letter-spacing: 1px;
  white-space: nowrap;
  pointer-events: none;
}
.inter-float.north { top: 3%; }
.inter-float.south { bottom: 6%; }
.sig .lamp { stroke: rgba(255, 255, 255, 0.35); stroke-width: 1; }
.sig .lamp.g { fill: #33cc88; }
.sig .lamp.r { fill: #ff4444; }
.sig .cd { font-size: 13px; fill: rgba(220, 245, 255, 0.92); font-family: var(--font-mono); }
.sig .cd .g { fill: var(--text); }
.sig .cd .r { fill: var(--text); }
.sig .cd .w { fill: rgba(220, 245, 255, 0.92); }
</style>

/**
 * traffic_signal_deepagent/frontend/src/utils/corridorStageCards.ts 的 Canvas
 * 绘图内核。坐标、色值、线宽和箭头尺寸保持与原实现一致。
 */

const DIR_CN_TO_DIR8 = {
  北: 0,
  东北: 1,
  东: 2,
  东南: 3,
  南: 4,
  西南: 5,
  西: 6,
  西北: 7,
}
const DIR_CN_PREFIXES = ['东北', '东南', '西南', '西北', '北', '东', '南', '西']
const DIR_LABEL = { 0: '北', 1: '东北', 2: '东', 3: '东南', 4: '南', 5: '西南', 6: '西', 7: '西北' }
const FLOW_LABEL = { 1: '直', 2: '左', 3: '右', 4: '掉头', 5: '行人' }

function normalizeDir8(value) {
  const n = Number.parseInt(String(value), 10)
  if (!Number.isFinite(n)) return null
  if (n === 8) return 7
  return n >= 0 && n <= 7 ? n : null
}

function canvasDir8(value) {
  return Math.floor(value / 2) * 2
}

function movementKey(dir8, turn) {
  const dir = normalizeDir8(dir8)
  if (dir == null) return null
  // turn: 掉头=0 / 左=1 / 直=2 / 右=3；Canvas: 直=1 / 左=2 / 右=3 / 掉头=4
  const flow = { 0: 4, 1: 2, 2: 1, 3: 3, 5: 5 }[Number(turn)] ?? 1
  return `${canvasDir8(dir)}_${flow}`
}

function keysFromStageName(name) {
  const keys = []
  for (const part of String(name || '').split(/[、,，]/).map((item) => item.trim()).filter(Boolean)) {
    const dirName = DIR_CN_PREFIXES.find((dir) => part.startsWith(dir))
    if (!dirName) continue
    const tail = part.slice(dirName.length)
    let flow = 1
    if (tail.includes('行人') || tail.includes('出行') || tail.includes('入行')) flow = 5
    else if (tail.includes('掉')) flow = 4
    else if (tail.includes('左')) flow = 2
    else if (tail.includes('右')) flow = 3
    const key = `${canvasDir8(DIR_CN_TO_DIR8[dirName])}_${flow}`
    if (!keys.includes(key)) keys.push(key)
  }
  return keys
}

/** 把本项目的精简阶段数据转成原 Canvas keys。 */
export function stageCanvasKeys(stage = {}) {
  const keys = []
  for (const movement of stage.movements || []) {
    const key = movementKey(movement.dir8, movement.turn)
    if (key && !keys.includes(key)) keys.push(key)
  }
  // 蒸馏 JSON 未单独保留 pedDirList，但阶段名仍完整保留行人方向。
  for (const key of keysFromStageName(stage.stage_name || stage.name)) {
    if (!keys.includes(key)) keys.push(key)
  }
  return keys
}

export function stageFlowLabel(keys = []) {
  if (!keys.length) return '（未识别流向）'
  return keys.map((key) => {
    const [dir, flow] = key.split('_').map(Number)
    return `${DIR_LABEL[dir] ?? `方向${dir}`}${FLOW_LABEL[flow] ?? `流向${flow}`}`
  }).join('、')
}

const STAGE_ARROW_DEFS = {
  '0_1': { points: [[64, 0], [64, 38]], angle: Math.PI / 2 },
  '0_2': { points: [[74, 0], [74, 29], [85, 40]], angle: 0.78 },
  '0_3': { points: [[54, 0], [54, 28], [45, 40]], angle: 2.28 },
  '4_1': { points: [[86, 150], [86, 112]], angle: -Math.PI / 2 },
  '4_2': { points: [[76, 150], [76, 121], [64, 110]], angle: -2.36 },
  '4_3': { points: [[96, 150], [96, 122], [105, 110]], angle: -0.86 },
  '2_1': { points: [[150, 62], [112, 62]], angle: Math.PI },
  '2_2': { points: [[150, 74], [123, 74], [112, 85]], angle: 2.36 },
  '2_3': { points: [[150, 52], [123, 52], [111, 44]], angle: -2.55 },
  '6_1': { points: [[0, 88], [38, 88]], angle: 0 },
  '6_2': { points: [[0, 76], [27, 76], [38, 65]], angle: -0.78 },
  '6_3': { points: [[0, 98], [27, 98], [39, 106]], angle: 0.58 },
  '0_4': { points: [[88, 0], [88, 42], [99, 42], [99, 27]], angle: -Math.PI / 2, width: 3.1, arrowSize: 8.5 },
  '4_4': { points: [[62, 150], [62, 108], [51, 108], [51, 123]], angle: Math.PI / 2, width: 3.1, arrowSize: 8.5 },
  '2_4': { points: [[150, 86], [108, 86], [108, 97], [123, 97]], angle: 0, width: 3.1, arrowSize: 8.5 },
  '6_4': { points: [[0, 64], [42, 64], [42, 53], [27, 53]], angle: Math.PI, width: 3.1, arrowSize: 8.5 },
}

function drawPath(ctx, points, color, width) {
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1])
  ctx.stroke()
}

function arrowHead(ctx, x, y, angle, color, size) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x - size * Math.cos(angle - Math.PI / 6), y - size * Math.sin(angle - Math.PI / 6))
  ctx.lineTo(x - size * Math.cos(angle + Math.PI / 6), y - size * Math.sin(angle + Math.PI / 6))
  ctx.closePath()
  ctx.fill()
}

function drawRoadBase(ctx, w, h) {
  ctx.strokeStyle = 'rgba(226,232,240,.14)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(42, 0); ctx.lineTo(42, 42); ctx.lineTo(0, 42)
  ctx.moveTo(108, 0); ctx.lineTo(108, 42); ctx.lineTo(w, 42)
  ctx.moveTo(42, h); ctx.lineTo(42, 108); ctx.lineTo(0, 108)
  ctx.moveTo(108, h); ctx.lineTo(108, 108); ctx.lineTo(w, 108)
  ctx.stroke()
}

function zebraCrossing(ctx, x0, y0, x1, y1, color, vertical = false) {
  ctx.fillStyle = color
  ctx.globalAlpha = 0.6
  const stripeCount = 4
  if (!vertical) {
    const stripeW = (x1 - x0) / (stripeCount * 2 - 1)
    for (let i = 0; i < stripeCount; i += 1) ctx.fillRect(x0 + i * stripeW * 2, y0, stripeW, y1 - y0)
  } else {
    const stripeH = (y1 - y0) / (stripeCount * 2 - 1)
    for (let i = 0; i < stripeCount; i += 1) ctx.fillRect(x0, y0 + i * stripeH * 2, x1 - x0, stripeH)
  }
  ctx.globalAlpha = 1
}

/** 在 150×150 Canvas 上绘制阶段放行流向。 */
export function drawCorridorStageCanvas(canvas, keys) {
  const ctx = canvas?.getContext('2d')
  if (!ctx) return
  const active = new Set(keys)
  ctx.fillStyle = '#073f5e'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  drawRoadBase(ctx, canvas.width, canvas.height)

  const color = '#12d6bd'
  for (const [key, def] of Object.entries(STAGE_ARROW_DEFS)) {
    if (!active.has(key)) continue
    drawPath(ctx, def.points, color, def.width || 3.6)
    const tip = def.points[def.points.length - 1]
    arrowHead(ctx, tip[0], tip[1], def.angle, color, def.arrowSize || 10.5)
  }
  if (active.has('0_5')) zebraCrossing(ctx, 38, 48, 90, 56, '#4ade80')
  if (active.has('4_5')) zebraCrossing(ctx, 68, 94, 120, 102, '#4ade80')
  if (active.has('2_5')) zebraCrossing(ctx, 98, 36, 106, 82, '#4ade80', true)
  if (active.has('6_5')) zebraCrossing(ctx, 44, 76, 52, 118, '#4ade80', true)
}

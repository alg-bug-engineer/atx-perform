/**
 * 经纬度 → SVG 视口的等距投影（小范围路网，按中心纬度做 x 向余弦压缩即可）。
 * 幕 0/1/2 的路网、溯源链路共用同一投影，保证几何位置一致。
 */
const M_PER_DEG_LAT = 111320

export function collectPoints(links = [], nodes = []) {
  const pts = []
  for (const link of links) {
    for (const c of link?.geom?.coordinates || []) pts.push(c)
  }
  for (const n of nodes) {
    const lon = n?.lon ?? n?.lng
    const lat = n?.lat
    if (Number.isFinite(lon) && Number.isFinite(lat)) pts.push([lon, lat])
  }
  return pts
}

/**
 * @param {Array<[number, number]>} points 经纬度点集
 * @param {{ width: number, height: number, padding?: number }} view
 */
export function createProjector(points, { width, height, padding = 18 }) {
  const valid = points.filter((p) => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1]))
  const lons = valid.map((p) => p[0])
  const lats = valid.map((p) => p[1])
  const minLon = Math.min(...lons)
  const maxLon = Math.max(...lons)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const midLat = (minLat + maxLat) / 2
  const kx = Math.cos((midLat * Math.PI) / 180) || 1

  const spanX = Math.max((maxLon - minLon) * kx, 1e-6)
  const spanY = Math.max(maxLat - minLat, 1e-6)
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY)
  const offsetX = (width - spanX * scale) / 2
  const offsetY = (height - spanY * scale) / 2

  function project(lon, lat) {
    return [
      offsetX + (lon - minLon) * kx * scale,
      offsetY + (maxLat - lat) * scale,
    ]
  }

  /** 米 → 视口单位（用于排队长度、缓冲半径这类实际尺度） */
  function metersToUnits(m) {
    return (m / M_PER_DEG_LAT) * scale
  }

  function toPath(coordinates = []) {
    return coordinates
      .map((c, i) => {
        const [x, y] = project(c[0], c[1])
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
      })
      .join(' ')
  }

  /** 以某点为中心、覆盖 spanMeters 的 viewBox，用于“拉近镜头” */
  function viewBoxAround(lon, lat, spanMeters) {
    const [cx, cy] = project(lon, lat)
    const h = metersToUnits(spanMeters)
    const w = (h * width) / height
    return `${(cx - w / 2).toFixed(2)} ${(cy - h / 2).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}`
  }

  return { project, toPath, metersToUnits, viewBoxAround, scale, bounds: { minLon, maxLon, minLat, maxLat } }
}

/** 折线上按比例取点（0=起点，1=终点），用于排队段、流向箭头落点 */
export function pointAlong(coordinates, ratio) {
  if (!coordinates?.length) return null
  const segs = []
  let total = 0
  for (let i = 1; i < coordinates.length; i += 1) {
    const [x1, y1] = coordinates[i - 1]
    const [x2, y2] = coordinates[i]
    const d = Math.hypot(x2 - x1, y2 - y1)
    segs.push(d)
    total += d
  }
  if (total <= 0) return coordinates[0]
  let want = Math.max(0, Math.min(1, ratio)) * total
  for (let i = 0; i < segs.length; i += 1) {
    if (want <= segs[i]) {
      const t = segs[i] === 0 ? 0 : want / segs[i]
      const [x1, y1] = coordinates[i]
      const [x2, y2] = coordinates[i + 1]
      return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]
    }
    want -= segs[i]
  }
  return coordinates[coordinates.length - 1]
}

/** 截取折线的一段（比例区间），用于把排队长度画在路段末端 */
export function sliceLine(coordinates, fromRatio, toRatio) {
  if (!coordinates?.length) return []
  const start = pointAlong(coordinates, fromRatio)
  const end = pointAlong(coordinates, toRatio)
  const total = coordinates.length
  const out = [start]
  for (let i = 1; i < total - 1; i += 1) {
    const r = i / (total - 1)
    if (r > fromRatio && r < toRatio) out.push(coordinates[i])
  }
  out.push(end)
  return out
}

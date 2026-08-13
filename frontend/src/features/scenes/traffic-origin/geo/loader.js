// 济南市中心坐标 & 投影参数
const CENTER_LON = 117.096;
const CENTER_LAT = 36.662;
const METERS_PER_UNIT = 10; // 1 THREE单位 = 10米

function toRad(d) { return d * Math.PI / 180; }

/**
 * 将经纬度投影到以中心为原点的平面坐标 [x, y]
 * x = 东方向, y = 北方向 (在Three.js中 z=-y)
 */
export function project(lon, lat) {
  const dx = (lon - CENTER_LON) * Math.cos(toRad(CENTER_LAT)) * toRad(1) * 6371000;
  const dy = (lat - CENTER_LAT) * toRad(1) * 6371000;
  return [dx / METERS_PER_UNIT, dy / METERS_PER_UNIT];
}

/** 计算与中心的距离（千米）*/
export function distKm(lon, lat) {
  const dx = (lon - CENTER_LON) * Math.cos(toRad(CENTER_LAT)) * toRad(1) * 6371;
  const dy = (lat - CENTER_LAT) * toRad(1) * 6371;
  return Math.sqrt(dx * dx + dy * dy);
}

function computeProjectedBounds(items) {
  const bounds = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  };

  for (const item of items) {
    const pointList = item.coords ? item.coords : [item.pos];
    for (const [x, y] of pointList) {
      bounds.minX = Math.min(bounds.minX, x);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxY = Math.max(bounds.maxY, y);
    }
  }

  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  return {
    ...bounds,
    width,
    height,
    radius: Math.max(width, height) / 2,
  };
}

/** 根据 fc 字段确定道路等级 */
export function getRoadClass(props) {
  if (props.road_class_group === 'express') return 'express';
  const fc = props.fc || 5;
  if (fc <= 3) return 'arterial';
  if (fc === 4) return 'collector';
  return 'local';
}

/** 加载 GeoJSON 全量路网数据 */
export async function loadGeoData() {
  const resp = await fetch('/merged_network.geojson');
  const geojson = await resp.json();

  const roads = [];
  const intersections = [];

  for (const feature of geojson.features) {
    const geo = feature.geometry;
    const props = feature.properties;

    if (geo.type === 'LineString') {
      const coords = geo.coordinates;
      const projected = coords.map(([lon, lat]) => project(lon, lat));
      const roadClass = getRoadClass(props);
      // rawCoords 保留原始经纬度，供 GLCustomLayer 坐标转换使用
      roads.push({ props, coords: projected, rawCoords: coords.map(([lon, lat]) => [lon, lat]), roadClass });

    } else if (geo.type === 'Point') {
      const [lon, lat] = geo.coordinates;
      intersections.push({ props, pos: project(lon, lat), lonlat: [lon, lat] });
    }
  }

  return {
    roads,
    intersections,
    bounds: computeProjectedBounds([...roads, ...intersections]),
  };
}

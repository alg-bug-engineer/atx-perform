/**
 * osmLayer.js — 基于 OSM 数据的 Three.js 路网/建筑底图层
 *
 * 数据来源：src/map/jinan-roads.json（由 scripts/osm-to-json.js 生成）
 *   坐标系：x=东, z=南，1 单位 = 10m，原点 = (117.096°E, 36.662°N)
 *
 * 返回 THREE.Group，包含：
 *   - 道路（按等级分 5 层，LineSegments）
 *   - 建筑轮廓（LineSegments）
 */

import * as THREE    from 'three';
import roadData      from '../../../map/jinan-roads.json';

// ── 道路配色（科技深蓝风，与其他场景统一） ────────────────────────────────────
const ROAD_STYLE = [
  null, // level 0 未使用（MIN_LEVEL=1）
  { color: 0x1a3a5c, opacity: 0.55 }, // level 1 tertiary   深蓝暗
  { color: 0x1e5a9e, opacity: 0.65 }, // level 2 secondary  中蓝
  { color: 0x2a7fd4, opacity: 0.80 }, // level 3 primary    亮蓝
  { color: 0x55c8ff, opacity: 0.90 }, // level 4 trunk      亮青
  { color: 0xaaeeff, opacity: 1.00 }, // level 5 motorway   白青
];

const BUILDING_COLOR   = 0x0d2540;
const BUILDING_OPACITY = 0.50;

// ── 构建道路 LineSegments（按等级分批，减少 draw call） ───────────────────────
function buildRoads(roads) {
  const group = new THREE.Group();
  group.name  = 'osm-roads';

  // 按等级分组收集顶点
  const byLevel = [[], [], [], [], [], []];
  for (const { t, p } of roads) {
    const arr = byLevel[t];
    // p = [x1,z1, x2,z2, ...] → 拆成相邻段对 (LineSegments 需要配对)
    for (let i = 0; i + 3 < p.length; i += 2) {
      arr.push(p[i], 0, p[i + 1]);      // 起点
      arr.push(p[i + 2], 0, p[i + 3]); // 终点
    }
  }

  for (let lvl = 1; lvl <= 5; lvl++) {
    const verts = byLevel[lvl];
    if (!verts.length) continue;

    const style = ROAD_STYLE[lvl];
    const geo   = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));

    const mat = new THREE.LineBasicMaterial({
      color:       style.color,
      opacity:     style.opacity,
      transparent: style.opacity < 1,
      depthWrite:  false,
    });

    const mesh       = new THREE.LineSegments(geo, mat);
    mesh.renderOrder = lvl; // 高等级道路在上层
    group.add(mesh);
  }

  return group;
}

// ── 构建建筑轮廓 LineSegments ─────────────────────────────────────────────────
function buildBuildings(buildings) {
  if (!buildings || !buildings.length) return null;

  const verts = [];
  for (const pts of buildings) {
    // pts = [x1,z1, x2,z2, ... , xN,zN]
    // 绘制闭合轮廓：0→1, 1→2, ..., N-1→0
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      verts.push(pts[i * 2], 0.2, pts[i * 2 + 1]);      // 稍微抬高避免 z-fighting
      verts.push(pts[j * 2], 0.2, pts[j * 2 + 1]);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));

  const mat = new THREE.LineBasicMaterial({
    color:       BUILDING_COLOR,
    opacity:     BUILDING_OPACITY,
    transparent: true,
    depthWrite:  false,
  });

  const mesh       = new THREE.LineSegments(geo, mat);
  mesh.renderOrder = 0;
  return mesh;
}

// ── 公共接口 ──────────────────────────────────────────────────────────────────
/**
 * 创建 OSM 底图图层
 * @returns {{ group: THREE.Group, meta: object }}
 */
export function createOSMLayer() {
  const group = new THREE.Group();
  group.name  = 'osm-map';

  const buildings = buildBuildings(roadData.buildings);
  if (buildings) group.add(buildings);

  const roads = buildRoads(roadData.roads);
  group.add(roads);

  return {
    group,
    meta: roadData.meta,
  };
}

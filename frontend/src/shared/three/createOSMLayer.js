/**
 * createOSMLayer.js
 *
 * 根据底图数据服务（mapDataService）构建 Three.js 场景图层。
 *
 * 坐标约定与 geo/loader.js 一致：
 *   JSON 中  x = 东，z = 北（正值）；1 unit = 10 m
 *   Three.js x = 东，z = 南（负值）；转换：THREE.z = -JSON.z
 *
 * 视觉风格参考：深色科技感夜间地图
 *   - 快速路/高速：亮橙发光   #ff8800
 *   - 主干道：     亮青白发光  #66ccff
 *   - 次干道：     中蓝        #2277cc
 *   - 支路/居住：  极暗蓝      几乎不可见
 *   - 所有线条使用 AdditiveBlending，叠加出发光效果
 *   - 建筑只保留轮廓线（无填充面），城市核心会出现矩形网格光斑
 *   - 水体：深蓝填充 + 亮青轮廓
 */

import * as THREE from 'three';
import { getMapData } from '../../services/mapDataService.js';

// ── 道路颜色（仅快速路/主干高速/主干道/次干道）──────────────────────────────
//    t=1 motorway, t=2 trunk, t=3 primary, t=4 secondary
const ROAD_CFG = [
  null,
  { color: 0xff8800, opacity: 0.90 },  // 1 motorway    快速路   亮橙
  { color: 0xffaa00, opacity: 0.85 },  // 2 trunk       主干高速  金橙
  { color: 0x66ccff, opacity: 0.80 },  // 3 primary     主干道   亮青白
  { color: 0x3399bb, opacity: 0.45 },  // 4 secondary   次干道   青灰
  null,                                  // 5 tertiary    隐藏
  null,                                  // 6 residential 隐藏
  null,                                  // 7 service     隐藏
  null,                                  // 8 footway     隐藏
];

// ── 水体 ──────────────────────────────────────────────────────────────────────
const WATER_FILL_COLOR = 0x061830;   // 极深蓝，接近背景色（减少大面积蓝块突兀感）
const WATER_FILL_OPAC  = 0.55;       // 半透明，让背景底色透出

// ── 建筑轮廓（灰白色，暗调，加法混合在城市核心叠加出灰白光斑） ──────────────
const BUILDING_EDGE_COLOR = 0x667788;  // 灰白色
const BUILDING_EDGE_OPAC  = 0.25;      // 较暗，密集区叠加后才变亮

// ── 绿地/公园 ──────────────────────────────────────────────────────────────────
const PARK_FILL_COLOR = 0x0f2e14;   // 稍暗深绿
const PARK_FILL_OPAC  = 1.0;

// ── 几何工具 ──────────────────────────────────────────────────────────────────

/** 质心三角扇形，输出 Float32Array [x,y,z,...] (z 仍为北，最终在 makeFill 翻转) */
function triangulatePolygon(pts) {
  if (pts.length < 3) return null;
  let cx = 0, cz = 0;
  for (const [x, z] of pts) { cx += x; cz += z; }
  cx /= pts.length; cz /= pts.length;
  const verts = [];
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[(i + 1) % pts.length];
    verts.push(cx, 0, cz,  ax, 0, az,  bx, 0, bz);
  }
  return new Float32Array(verts);
}

/** 多个数组合并为 Float32Array */
function concat(arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Float32Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

// ── Three.js 对象工厂 ─────────────────────────────────────────────────────────

/**
 * 构建 LineSegments，使用 AdditiveBlending 产生发光叠加效果
 * @param {number[]} segs  [x1,z1(北), x2,z2(北), ...]
 */
function makeLines(segs, color, opacity, additive = true) {
  if (!segs.length) return null;
  const buf = new Float32Array(segs.length / 2 * 3);
  let i3 = 0;
  for (let i = 0; i < segs.length; i += 2) {
    buf[i3++] = segs[i];       // x（东）
    buf[i3++] = 0;              // y（地面）
    buf[i3++] = -segs[i + 1];  // z：北 → 三维南
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(buf, 3));
  const mat = new THREE.LineBasicMaterial({
    color,
    opacity,
    transparent: true,
    blending:    additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite:  false,
  });
  return new THREE.LineSegments(geo, mat);
}

/**
 * 构建填充 Mesh（z 轴统一取反），用于水体 / 绿地
 * @param {Float32Array[]} vertArrays  每项 [x,y,z(北),...]
 */
function makeFill(vertArrays, color, opacity) {
  if (!vertArrays.length) return null;
  // 翻转 z 分量（北 → 三维南）
  const flipped = vertArrays.map(v => {
    const out = new Float32Array(v.length);
    for (let i = 0; i < v.length; i += 3) {
      out[i]     = v[i];
      out[i + 1] = v[i + 1];
      out[i + 2] = -v[i + 2];
    }
    return out;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(concat(flipped), 3));
  const mat = new THREE.MeshBasicMaterial({
    color, opacity, transparent: true,
    side: THREE.DoubleSide, depthWrite: false,
  });
  return new THREE.Mesh(geo, mat);
}

// ── 主入口 ────────────────────────────────────────────────────────────────────
export async function createOSMLayer() {
  const data = await getMapData();
  const group = new THREE.Group();
  group.name  = 'osmLayer';

  // ── 绿地 / 公园（底层填充，renderOrder 最低）──────────────────────────────
  {
    const verts = [...(data.greens ?? []), ...(data.parks ?? [])]
      .map(p => triangulatePolygon(p.p)).filter(Boolean);
    const m = makeFill(verts, PARK_FILL_COLOR, PARK_FILL_OPAC);
    if (m) { m.renderOrder = 1; group.add(m); }
  }

  // ── 水体填充 ──────────────────────────────────────────────────────────────
  {
    const verts = (data.waters ?? []).map(w => triangulatePolygon(w.p)).filter(Boolean);
    const m = makeFill(verts, WATER_FILL_COLOR, WATER_FILL_OPAC);
    if (m) { m.renderOrder = 2; group.add(m); }
  }

  // ── 建筑轮廓线（无填充面；密集叠加产生城市光斑）──────────────────────────
  {
    const segs = [];
    for (const b of (data.buildings ?? [])) {
      for (let i = 0; i < b.p.length; i++) {
        const [ax, az] = b.p[i], [bx, bz] = b.p[(i + 1) % b.p.length];
        segs.push(ax, az, bx, bz);
      }
    }
    const l = makeLines(segs, BUILDING_EDGE_COLOR, BUILDING_EDGE_OPAC);
    if (l) { l.renderOrder = 4; group.add(l); }
  }

    // ── 道路（仅快速路/主干高速/主干道/次干道，支路及以下隐藏）────────────────
  const roadSegs = {};
  for (const r of (data.roads ?? [])) {
    if (ROAD_CFG[r.t] == null) continue;
    if (!roadSegs[r.t]) roadSegs[r.t] = [];
    for (let i = 0; i < r.p.length; i++) roadSegs[r.t].push(r.p[i]);
  }
  for (const t of [4, 3, 2, 1]) {
    const segs = roadSegs[t];
    if (!segs?.length) continue;
    const cfg = ROAD_CFG[t];
    const l = makeLines(segs, cfg.color, cfg.opacity);
    if (l) { l.renderOrder = 5 + (5 - t); group.add(l); }
  }

  group.traverse(obj => { obj.frustumCulled = false; });
  return group;
}

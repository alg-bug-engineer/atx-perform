/**
 * channelizationLayer.js  —  v3
 *
 * 改进点：
 *   1. 斑马线条纹平行于路臂方向（沿 Z 轴排列）
 *   2. 方向箭头更大，位置靠近停车线
 *   3. 相邻路臂角点用白色贝塞尔曲线相连
 *   4. 支持模拟车辆排队（可选 queueData 参数）
 *   5. 臂体沿 link geom 真实走向弯曲（近场 boxR+8 直线锁定，geom 缺失逐臂回退直线）
 *
 * 坐标约定（臂局部空间）：
 *   +Z  = 向路口外部（臂延伸方向）
 *   +X  = 俯视看臂时的右手侧
 *   进口道（-Z 行进）：在 +X 侧
 *   出口道（+Z 行进）：在 -X 侧
 */

import * as THREE from 'three';
import {
  isCardinalApproachLabel,
  roadNameForCardinal,
} from '../../acts/entryArm.js';
import { applyDisplayNameAlias } from '../../../utils/userFacingCopy.js';

// ── 几何参数 ──────────────────────────────────────────────────────────────────
// LANE_W/ARM_LEN 为渠化总尺寸主控（boxR 随 LANE_W 自动缩放）；
// act3/act8 的本地 LANE_W 副本必须与本值保持一致，否则排队色块/色带错位
const LANE_W  = 0.8;
const ARM_LEN = 37;
const BASE_Y  = 0.6;
const MARK_Y  = BASE_Y + 0.12;
const LINE_Y  = BASE_Y + 0.25;

// ── 颜色 ──────────────────────────────────────────────────────────────────────
const C_ROAD    = 0x2c2c2c;
const C_CENTER  = 0x1e1e1e;
const C_DIVIDER = 0xffcc00;
const C_MARKING = 0xcccccc;
const C_CURB    = 0xb0b8c0; // 路缘：中性灰白，避免俯视绿线被误读为色块
const C_STOP    = 0xff4444;
const C_ARROW   = 0xeeeeee;

// ── 投影 ──────────────────────────────────────────────────────────────────────
const CENTER_LON = 117.096, CENTER_LAT = 36.662, MPU = 10;
function project(lon, lat) {
  const x =  (lon - CENTER_LON) * Math.cos(CENTER_LAT * Math.PI / 180) * (Math.PI / 180) * 6371000 / MPU;
  const z = -(lat - CENTER_LAT) * (Math.PI / 180) * 6371000 / MPU;
  return [x, z];
}

// ── 方位角 → rotation.y ───────────────────────────────────────────────────────
function bearingToRotY(bearing) {
  return Math.PI - bearing * Math.PI / 180;
}

// ── 角度差（0-180）────────────────────────────────────────────────────────────
function angleDiff(a, b) {
  let d = Math.abs((a - b + 360) % 360);
  return d > 180 ? 360 - d : d;
}

// ── lane_info 解析 ────────────────────────────────────────────────────────────
function parseLaneInfo(lk) {
  if (lk.lane_info && lk.lane_info !== 'null') {
    return lk.lane_info.split('|').filter(s => s.length > 0);
  }
  return Array(lk.c_lane_num || lk.lane_num || 1).fill(null);
}

/** 地理方位角 → 方位键（0°北 / 90°东 / 180°南 / 270°西） */
function cardinalKeyFromArmAngle(angle) {
  const a = ((Number(angle) % 360) + 360) % 360;
  if (!Number.isFinite(a)) return null;
  if (a >= 315 || a < 45) return 'north';
  if (a < 135) return 'east';
  if (a < 225) return 'south';
  return 'west';
}

/**
 * 路臂道路名：优先 axis_roads（与口播东西/南北向一致，四臂同名也各标一次）；
 * 缺轴名时回退路段 road_name。忽略「北进口」类方位伪名。
 * 展示别名：齐川路 → 齐音路（查库名不变）。
 */
function pickArmRoadName(arm, axisRoads = null) {
  const key = cardinalKeyFromArmAngle(arm?.angle);
  const fromAxis = roadNameForCardinal(key, axisRoads);
  if (fromAxis && !isCardinalApproachLabel(fromAxis)) return fromAxis;

  const raw = arm?.inLink?.road_name || arm?.outLink?.road_name || '';
  const name = String(raw).split(':')[0].trim();
  if (!name || isCardinalApproachLabel(name)) return '';
  return applyDisplayNameAlias(name);
}

/** 渠化路臂上的道路名 Sprite（轻量青字，始终朝向相机） */
function makeArmRoadNameSprite(text) {
  const fontSize = 22;
  const padX = 10;
  const padY = 6;
  const font = `600 ${fontSize}px "PingFang SC","Microsoft YaHei",sans-serif`;
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;
  const tw = Math.ceil(measure.measureText(text).width);

  const canvas = document.createElement('canvas');
  canvas.width = tw + padX * 2;
  canvas.height = fontSize + padY * 2;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgba(4, 14, 26, 0.55)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(0, 212, 240, 0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);

  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#9aefff';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 0.5);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    // 俯视时勿被路面/人字箭头深度挡住；Act2 arms 口播时仍需可读
    depthTest: false,
    sizeAttenuation: true,
  });
  const sprite = new THREE.Sprite(mat);
  const s = 0.11;
  sprite.scale.set(canvas.width * s, canvas.height * s, 1);
  sprite.renderOrder = 52;
  sprite.frustumCulled = false;
  sprite.userData.isArmRoadLabel = true;
  return sprite;
}

// ── geom 坐标 → 路臂方位角 ────────────────────────────────────────────────────
function geoBearing(lon1, lat1, lon2, lat2) {
  const dLat = lat2 - lat1;
  const dLon = (lon2 - lon1) * Math.cos((lat1 + lat2) * Math.PI / 360);
  return (Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360;
}

function parseGeomPts(geom) {
  const inner = geom.slice(geom.indexOf('(') + 1, geom.lastIndexOf(')'));
  return inner.split(',').map(s => {
    const [lon, lat] = s.trim().split(/\s+/).map(Number);
    return [lon, lat];
  });
}

function getLinkArmAngle(lk, isIncoming) {
  try {
    const pts = parseGeomPts(lk.geom);
    if (pts.length >= 2) {
      const [p0, p1] = isIncoming
        ? [pts[pts.length - 1], pts[pts.length - 2]]
        : [pts[0], pts[1]];
      return geoBearing(p0[0], p0[1], p1[0], p1[1]);
    }
  } catch (_) { /* fall through */ }
  return isIncoming ? ((lk.t_angle + 180) % 360) : lk.f_angle;
}

// ── 将进/出路段归组为"臂" ─────────────────────────────────────────────────────
function gatherArms(inLinks, outLinks) {
  const arms = [];
  for (const lk of inLinks) {
    const angle = getLinkArmAngle(lk, true);
    let found = arms.find(a => angleDiff(a.angle, angle) < 22);
    if (!found) { found = { angle, inLink: null, outLink: null }; arms.push(found); }
    if (!found.inLink || parseLaneInfo(lk).length > parseLaneInfo(found.inLink).length) {
      found.inLink = lk;
      found.angle  = angle;
    }
  }
  for (const lk of outLinks) {
    const angle = getLinkArmAngle(lk, false);
    let found = arms.find(a => angleDiff(a.angle, angle) < 22);
    if (!found) { found = { angle, inLink: null, outLink: null }; arms.push(found); }
    if (!found.outLink || (lk.lane_num || 0) > (found.outLink.lane_num || 0)) {
      found.outLink = lk;
    }
  }
  return arms;
}

// ── 动态 BOX_R ────────────────────────────────────────────────────────────────
function calcBoxR(arms) {
  if (arms.length < 2) return 6;
  const sorted = [...arms].sort((a, b) => a.angle - b.angle);
  let maxR = 3;
  for (let i = 0; i < sorted.length; i++) {
    const a1 = sorted[i], a2 = sorted[(i + 1) % sorted.length];
    let dAngle = a2.angle - a1.angle;
    if (dAngle < 0) dAngle += 360;
    if (dAngle < 1) continue;
    const w1half = ((a1.inLink ? parseLaneInfo(a1.inLink).length : 0) + (a1.outLink?.lane_num || 0)) * LANE_W / 2;
    const w2half = ((a2.inLink ? parseLaneInfo(a2.inLink).length : 0) + (a2.outLink?.lane_num || 0)) * LANE_W / 2;
    const sinHalf = Math.sin(dAngle * Math.PI / 360);
    if (sinHalf < 0.01) continue;
    // 0.5 为相邻臂矩形恰好相切的几何下限（(w1+w2)/(2·sin(θ/2))）；
    // 低于该值臂宽将超出中心盒，路缘贝塞尔控制点翻转、四角出现外凸钩刺
    maxR = Math.max(maxR, (w1half + w2half) / sinHalf * 0.5);
  }
  return Math.min(Math.max(maxR, 3), 90);
}

// ── 几何辅助 ──────────────────────────────────────────────────────────────────
function hPlane(w, d, color, y = BASE_Y, opacity = 1) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({
      color, side: THREE.DoubleSide,
      depthWrite: opacity >= 1,
      transparent: opacity < 1, opacity,
    }),
  );
  m.rotation.x   = -Math.PI / 2;
  m.position.y   = y;
  m.renderOrder  = 10;
  return m;
}

function lineMat(color) {
  return new THREE.LineBasicMaterial({ color, depthWrite: false });
}

function xLine(x0, x1, z, color, y = LINE_Y) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([x0,y,z, x1,y,z], 3));
  const l = new THREE.Line(g, lineMat(color));
  l.renderOrder = 10;
  return l;
}

function zLine(x, z0, z1, color, y = LINE_Y) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([x,y,z0, x,y,z1], 3));
  const l = new THREE.Line(g, lineMat(color));
  l.renderOrder = 10;
  return l;
}

function zDash(x, z0, z1, color, dashLen = 2.8, gapLen = 2.2) {
  const pts = [];
  let z = z0, on = true;
  while (z < z1) {
    const end = Math.min(z + (on ? dashLen : gapLen), z1);
    if (on) pts.push(x, LINE_Y, z, x, LINE_Y, end);
    z = end; on = !on;
  }
  if (pts.length < 6) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const l = new THREE.LineSegments(g, lineMat(color));
  l.renderOrder = 10;
  return l;
}

// ── 方向箭头（进口道局部坐标，驾驶员行进方向 -Z）─────────────────────────────
// cx = 车道中心 x（+X 侧）；arrowZ = 箭头中心 z 位置
// 左 = -X（驾驶员左）；右 = +X（驾驶员右）

/**
 * 归一化车道功能码 → 转向字母
 * 常见：B左 C直 D右；Z 在部分数据里表示直行；F/G 等为辅码需剥离
 */
function normalizeLaneMovements(laneCode) {
  let mov = String(laneCode || '').toUpperCase();
  // FZ / Z → 按直行处理，避免剥离后变成空码导致无转向箭头
  if (mov.includes('Z') && !mov.includes('C')) mov = mov.replace(/Z/g, 'C');
  mov = mov.replace(/[FGLRTO]/g, '');
  return mov;
}

/**
 * 实心填充路面转向箭头（三角形网格，模拟真实路面标线）
 *   cx      — 车道中心 X
 *   arrowZ  — 箭头中心 Z（靠近停车线）
 *   scale   — 放大倍数（俯视特写需更大）
 */
function makeArrow(laneCode, cx, arrowZ, scale = 1) {
  const mov = normalizeLaneMovements(laneCode);
  if (!mov) return null;

  const hasC = mov.includes('C');
  const hasB = mov.includes('B') || mov.includes('A');
  const hasD = mov.includes('D') || mov.includes('E');
  if (!hasC && !hasB && !hasD) return null;

  const s = Math.max(0.8, scale);
  const sw  = LANE_W * 0.16 * s;   // 杆宽
  const H   = LANE_W * 0.72 * s;   // 箭头总高（放大，便于俯视辨认转向）
  const hw  = LANE_W * 0.22 * s;   // 直行箭头头部半宽
  const ah  = H * 0.38;            // 直行箭头头部高度
  const bl  = LANE_W * 0.30 * s;   // 转向分支长度
  const bah = sw  * 1.55;          // 转向箭头头部半宽
  const bal = sw  * 1.45;          // 转向箭头头部长度
  const Y   = LINE_Y + 0.08;

  const tris = [];

  /* 辅助：填充矩形（两个三角形）*/
  function rect(x0, x1, z0, z1) {
    tris.push(
      x0, Y, z0,  x1, Y, z0,  x0, Y, z1,
      x1, Y, z0,  x1, Y, z1,  x0, Y, z1,
    );
  }
  /* 辅助：三角形 */
  function tri(ax, az, bx, bz, dx, dz) {
    tris.push(ax, Y, az, bx, Y, bz, dx, Y, dz);
  }

  const baseZ  = arrowZ + H * 0.50;   // 杆尾（远离路口）
  const tipZ   = arrowZ - H * 0.50;   // 箭头尖（靠近路口）
  const neckZ  = tipZ + ah;            // 头部与杆的交界
  const forkZ  = arrowZ + H * (hasC ? 0.10 : 0.20);  // 转向分叉位置

  // ── 直行杆 + 箭头头部 ──────────────────────────────────────────────────────
  if (hasC) {
    rect(cx - sw / 2, cx + sw / 2, neckZ, baseZ);        // 杆身
    tri(cx - hw, neckZ, cx + hw, neckZ, cx, tipZ);       // 等腰三角箭头
  } else {
    // 无直行：短杆延伸到分叉处
    rect(cx - sw / 2, cx + sw / 2, forkZ, baseZ);
  }

  // ── 左转分支 ──────────────────────────────────────────────────────────────
  if (hasB) {
    rect(cx - bl, cx,  forkZ - sw / 2, forkZ + sw / 2); // 横向杆
    tri(                                                   // 向左箭头
      cx - bl,       forkZ - bah,
      cx - bl - bal, forkZ,
      cx - bl,       forkZ + bah,
    );
  }

  // ── 右转分支 ──────────────────────────────────────────────────────────────
  if (hasD) {
    rect(cx, cx + bl,  forkZ - sw / 2, forkZ + sw / 2); // 横向杆
    tri(                                                   // 向右箭头
      cx + bl,       forkZ - bah,
      cx + bl + bal, forkZ,
      cx + bl,       forkZ + bah,
    );
  }

  if (tris.length < 9) return null;

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(tris), 3));
  const mesh = new THREE.Mesh(
    geom,
    new THREE.MeshBasicMaterial({ color: C_ARROW, side: THREE.DoubleSide }),
  );
  mesh.userData.isLaneArrow = true;
  return mesh;
}

// ── 将臂局部坐标转换到路口世界坐标（XZ 平面）────────────────────────────────
// rotation.y = π - θ_rad; wx = lz*sin(θ) - lx*cos(θ); wz = -lx*sin(θ) - lz*cos(θ)
function armToWorld(armAngle, lx, lz) {
  const t = armAngle * Math.PI / 180;
  return {
    x: lz * Math.sin(t) - lx * Math.cos(t),
    z: -lx * Math.sin(t) - lz * Math.cos(t),
  };
}

// ── 两条 2D 射线交点（XZ 平面）───────────────────────────────────────────────
// 射线1：p1 + t*d1；射线2：p2 + s*d2；返回交点或 null
function lineIntersect2D(p1x, p1z, d1x, d1z, p2x, p2z, d2x, d2z) {
  // d1x*t - d2x*s = p2x - p1x
  // d1z*t - d2z*s = p2z - p1z
  const det = d1x * (-d2z) - (-d2x) * d1z;
  if (Math.abs(det) < 1e-6) return null;
  const dx = p2x - p1x, dz = p2z - p1z;
  const t = (dx * (-d2z) + d2x * dz) / det;
  const s = (d1x * dz  - d1z * dx)   / det;
  if (t < 0 || s < 0) return null;        // 交点在射线背面则无效
  return { x: p1x + t * d1x, z: p1z + t * d1z };
}

// ── 臂中心线：近场直线锁定 + 远端沿 link geom 真实走向（2026-08-11）──────────
// link geom 与底图 merged_network 同源（点级 0 偏差），沿 geom 弯曲即对齐真实道路。
// r ≤ boxR+ARM_LOCK_LEN 强制直线（保护盒区衔接/角点曲线/停车线/箭头/Act3 排队锚定），
// 其后 ARM_BLEND_LEN 区间 smoothstep 混合到真实折线；geom 缺失/异常逐臂回退直线。
// 混合区取 16U（160m）：过短会把横向偏移的曲率压缩在混合区内形成可见「肘部」（实测 8U 时峰值 7.2°/站）
const ARM_LOCK_LEN  = 8;
const ARM_BLEND_LEN = 16;

/** 世界 XZ 向量（相对路口中心）→ 臂局部坐标（armToWorld 的逆变换） */
function worldToArmLocal(armAngle, wx, wz) {
  const t = armAngle * Math.PI / 180;
  return {
    x: -wx * Math.cos(t) - wz * Math.sin(t),
    z:  wx * Math.sin(t) - wz * Math.cos(t),
  };
}

/** 折线按弧长密集重采样（端点保留），为平滑做准备 */
function resamplePolyline(pts, step) {
  const out = [{ ...pts[0] }];
  let acc = 0;   // 距上一个输出点的弧长
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
    if (segLen < 1e-6) continue;
    let s = step - acc;
    while (s <= segLen) {
      const t = s / segLen;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      s += step;
    }
    acc = segLen - (s - step);
  }
  out.push({ ...pts[pts.length - 1] });
  return out;
}

/**
 * 1-2-1 核邻域平滑（端点固定）：geom 折点稀疏（间距可达 18U），
 * 直接线性渲染会把折角画成锯齿；平滑消除折角且横向偏移保持在亚单位级
 */
function smoothPolyline(pts, passes = 6) {
  let cur = pts;
  for (let k = 0; k < passes; k++) {
    const nxt = cur.map((p) => ({ ...p }));
    for (let i = 1; i < cur.length - 1; i++) {
      nxt[i].x = (cur[i - 1].x + 2 * cur[i].x + cur[i + 1].x) / 4;
      nxt[i].z = (cur[i - 1].z + 2 * cur[i].z + cur[i + 1].z) / 4;
    }
    cur = nxt;
  }
  return cur;
}

// ── 臂中心线手工标定表（z=弧长站, x=横向）──────────────────────────────
// 个别链路 DB geom 为直线旧数据（如经十路下游南臂，底图真实走向东偏），
// 以底图实测中心线标定，仅作用于表内臂，其余臂不受影响。
const ARM_CENTER_OVERRIDES = {
  // 180° 臂系（x=东偏）：底图实测中心线，z33 后东南折明显
  '011wwe28ctu00001|180': [[0, 0], [6, 0], [12, 0], [18, 1.4], [24, 2.0], [30, 3.0], [36, 7.7], [44, 12]],
  // 经十路东西臂：OSM 实测轴线近水平（斜率≈0.02），此前「斜」为透视错觉
  '011wwe28ctu00001|90': [[0, 0], [12, 0.3], [24, 0.6], [36, 0.9], [44, 1.0]],
  '011wwe28ctu00001|270': [[0, 0], [12, 0.3], [24, 0.6], [36, 0.9], [44, 1.0]],
};

// ── 路口中心视觉标定（OSM 底图为视觉真源）─────────────────────────────
// inter_id → [dx, dz] 中心整体平移（世界单位，+z 向南），
// 修正 DB 坐标与底图的整体偏差（经十路口偏北）；
// createChannelizationLayer 与场景 worldOf 共用，保证段体与盒体接缝闭合。
const INTER_CENTER_OFFSET = {
  // OSM 实测经十路轴线在 DB 中心南约 6u；用户验证后回调至 3.0 居中
  '011wwe28ctu00001': [0, 3.0],
};
export function interCenterOffset(interId) {
  return (interId && INTER_CENTER_OFFSET[interId]) || [0, 0];
}

function overrideCenterline(arm, boxR) {
  const bucket = Math.round(arm.angle / 10) * 10;
  const ids = [arm.inLink?.f_inter_id, arm.inLink?.t_inter_id, arm.outLink?.f_inter_id, arm.outLink?.t_inter_id];
  const hit = ids.find((id) => id && ARM_CENTER_OVERRIDES[`${id}|${bucket}`]);
  if (!hit) return null;
  const tab = ARM_CENTER_OVERRIDES[`${hit}|${bucket}`];
  const rMax = boxR + ARM_LEN;
  const at = (z) => {
    if (z <= tab[0][0]) return tab[0][1];
    for (let i = 1; i < tab.length; i++) {
      if (tab[i][0] >= z) {
        const a = tab[i - 1];
        const b = tab[i];
        const t = (z - a[0]) / Math.max(b[0] - a[0], 1e-6);
        return a[1] + (b[1] - a[1]) * t;
      }
    }
    return tab[tab.length - 1][1];
  };
  const pts = [];
  for (let r = 0; r <= rMax; r += 1.5) pts.push({ x: at(r), z: r });
  return pts;
}

/**
 * 臂中心线采样器：沿臂射线弧长 r 等距采样，输出横向偏移站点与单位切向/法向。
 * 数据源优先级 inLink.geom > outLink.geom（与臂角来源一致）；
 * 返回 null = 回退直线渲染（geom 缺失/退化/横向偏移异常 >15U）。
 * @returns {null|{ stations: Array<object>, at: (r:number)=>object }}
 */
function buildArmCenterline(arm, boxR, center) {
  const geomIn = arm?.inLink?.geom;
  const geomOut = arm?.outLink?.geom;
  const geom = geomIn || geomOut;
  if (!geom || !center) return null;

  // 手工标定表优先（个别链路 geom 旧数据）；否则 link geom 双向均值
  const overridePts = overrideCenterline(arm, boxR);
  let pts = overridePts;

  // 投影到臂局部空间（+Z 沿臂向外），并从路口端向外排序
  const toLocal = (g) => {
    let ll;
    try { ll = parseGeomPts(g); } catch (_) { return null; }
    if (!Array.isArray(ll) || ll.length < 2) return null;
    const p = ll.map(([lon, lat]) => {
      const [wx, wz] = project(lon, lat);
      return worldToArmLocal(arm.angle, wx - center.x, wz - center.z);
    });
    const dHead = Math.hypot(p[0].x, p[0].z);
    const dTail = Math.hypot(p[p.length - 1].x, p[p.length - 1].z);
    if (dTail < dHead) p.reverse();
    return p;
  };

  if (!pts && geom) {
    pts = toLocal(geom);
    if (pts && pts[0].z > boxR + ARM_LEN) pts = null;   // 几何起点已在臂端之外，数据异常

    // 双向几何齐备时取进/出横向均值 = 道路中心线，
    // 避免臂体偏向单向车行道（经十路东西臂偏北、下游奥体西路偏侧）
    if (pts && geomIn && geomOut) {
      const other = toLocal(geom === geomIn ? geomOut : geomIn);
      if (other) {
        const xOtherAt = (z) => {
          if (z <= other[0].z) return other[0].x;
          for (let i = 1; i < other.length; i++) {
            if (other[i].z >= z) {
              const a = other[i - 1];
              const b = other[i];
              const tt = (z - a.z) / Math.max(b.z - a.z, 1e-6);
              return a.x + (b.x - a.x) * tt;
            }
          }
          return other[other.length - 1].x;
        };
        pts = pts.map((p) => ({ ...p, x: (p.x + xOtherAt(p.z)) / 2 }));
      }
    }
  }
  if (!pts) return null;

  // 密集重采样 + 平滑（消除折角；端点固定，锁定区行为不变）
  pts = smoothPolyline(resamplePolyline(pts, 1.0), 6);

  // 折线弧长表
  const arc = [0];
  for (let i = 1; i < pts.length; i++) {
    arc.push(arc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  }
  const total = arc[arc.length - 1];
  if (total < 1) return null;
  const s0 = Math.max(0, pts[0].z);   // 折线起点（路口端）对应的射线弧长

  // 未混合的折线采样（s<0 在几何起点之前 → 贴臂射线；s>total 沿末段切向外推）
  const rawAt = (r) => {
    const s = r - s0;
    if (s <= 0) return { x: 0, z: r };
    if (s >= total) {
      const n = pts.length;
      const dx = pts[n - 1].x - pts[n - 2].x, dz = pts[n - 1].z - pts[n - 2].z;
      const len = Math.hypot(dx, dz) || 1;
      return {
        x: pts[n - 1].x + (dx / len) * (s - total),
        z: pts[n - 1].z + (dz / len) * (s - total),
      };
    }
    let i = 1;
    while (i < arc.length - 1 && arc[i] < s) i++;
    const t = (s - arc[i - 1]) / Math.max(arc[i] - arc[i - 1], 1e-6);
    return {
      x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
      z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t,
    };
  };

  const lockEnd = boxR + ARM_LOCK_LEN;
  const blendW = (r) => {
    // 标定表为可信真源：全程直接应用，避免近场锁定+混合产生 S 形扭曲
    if (overridePts) return 1;
    const u = Math.min(1, Math.max(0, (r - lockEnd) / ARM_BLEND_LEN));
    return u * u * (3 - 2 * u);
  };
  const blendAt = (r) => {
    const raw = rawAt(r);
    const w = blendW(r);
    return { x: raw.x * w, z: r + (raw.z - r) * w };
  };

  const stations = [];
  const STEP = 1.5;
  for (let r = boxR; r < boxR + ARM_LEN; r += STEP) stations.push({ r, ...blendAt(r) });
  stations.push({ r: boxR + ARM_LEN, ...blendAt(boxR + ARM_LEN) });
  if (stations.some((p) => Math.abs(p.x) > 30)) return null;  // 横向偏移异常 → 回退直线（30U 容纳真实急弯，如下游奥体西路东南折）

  // 切向（中心差分）与法向（+X 侧）
  for (let i = 0; i < stations.length; i++) {
    const a = stations[Math.max(0, i - 1)];
    const b = stations[Math.min(stations.length - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    stations[i].tx = dx / len;
    stations[i].tz = dz / len;
    stations[i].nx = dz / len;
    stations[i].nz = -dx / len;
  }

  /** 任意弧长处插值取点（供路名 Sprite 等摆放） */
  const at = (r) => {
    const cl = Math.min(boxR + ARM_LEN, Math.max(boxR, r));
    let i = 1;
    while (i < stations.length - 1 && stations[i].r < cl) i++;
    const a = stations[i - 1], b = stations[i];
    const t = (cl - a.r) / Math.max(b.r - a.r, 1e-6);
    return {
      x:  a.x  + (b.x  - a.x)  * t,
      z:  a.z  + (b.z  - a.z)  * t,
      nx: a.nx + (b.nx - a.nx) * t,
      nz: a.nz + (b.nz - a.nz) * t,
    };
  };
  return { stations, at };
}

/** 沿中心线的臂路面（triangle strip，替代直线 hPlane） */
function buildCurvedRoad(curve, xMin, xMax) {
  const pos = [];
  for (const p of curve.stations) {
    pos.push(p.x + p.nx * xMin, BASE_Y, p.z + p.nz * xMin);
    pos.push(p.x + p.nx * xMax, BASE_Y, p.z + p.nz * xMax);
  }
  const idx = [];
  for (let i = 0; i < curve.stations.length - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color: C_ROAD, side: THREE.DoubleSide }),
  );
  m.renderOrder = 10;
  return m;
}

/** 沿中心线横向偏移的实线（缘石/中心分隔线），替代直线 zLine */
function buildCurvedLine(curve, xOff, color, y = LINE_Y) {
  const pts = [];
  for (const p of curve.stations) pts.push(p.x + p.nx * xOff, y, p.z + p.nz * xOff);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const l = new THREE.Line(g, lineMat(color));
  l.renderOrder = 10;
  return l;
}

/** 沿中心线横向偏移的虚线（车道分道线），按折线弧长 2.8/2.2 切分，替代 zDash */
function buildCurvedDash(curve, xOff, color, dashLen = 2.8, gapLen = 2.2) {
  const pts = [];
  let remain = dashLen, on = true;
  const st = curve.stations;
  for (let i = 0; i < st.length - 1; i++) {
    const ax = st[i].x + st[i].nx * xOff,     az = st[i].z + st[i].nz * xOff;
    const bx = st[i + 1].x + st[i + 1].nx * xOff, bz = st[i + 1].z + st[i + 1].nz * xOff;
    const segLen = Math.hypot(bx - ax, bz - az);
    if (segLen < 1e-6) continue;
    let t0 = 0;
    while (t0 < 1 - 1e-9) {
      const take = Math.min(remain, (1 - t0) * segLen);
      const t1 = t0 + take / segLen;
      if (on) {
        pts.push(
          ax + (bx - ax) * t0, LINE_Y, az + (bz - az) * t0,
          ax + (bx - ax) * t1, LINE_Y, az + (bz - az) * t1,
        );
      }
      remain -= take;
      t0 = t1;
      if (remain <= 1e-6) { on = !on; remain = on ? dashLen : gapLen; }
    }
  }
  if (pts.length < 6) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const l = new THREE.LineSegments(g, lineMat(color));
  l.renderOrder = 10;
  return l;
}

// ── 相邻路臂角点白色凹形贝塞尔曲线（模拟转弯半径）───────────────────────────
// 控制点取两条路缘向路口内侧延伸后的交点，使曲线向内凹（符合真实路口转角）
// 段中心渠化排除连接臂时角点曲线仍全量绘制：曲线整体位于盒区以内（r ≤ boxR），
// 其端点恰为段体缘石线起点，缺了会在段体入口两侧留下开口
function buildCenterCurves(arms, boxR) {
  const group = new THREE.Group();
  if (arms.length < 2) return group;

  const sorted = [...arms].sort((a, b) => a.angle - b.angle);

  for (let i = 0; i < sorted.length; i++) {
    const arm1 = sorted[i];
    const arm2 = sorted[(i + 1) % sorted.length];

    const nOut1 = arm1.outLink ? (arm1.outLink.c_lane_num || arm1.outLink.lane_num || 0) : 0;
    const nIn2  = arm2.inLink  ? parseLaneInfo(arm2.inLink).length : 0;

    const p1 = armToWorld(arm1.angle, -nOut1 * LANE_W, boxR);  // arm1 出口侧角点
    const p2 = armToWorld(arm2.angle,  nIn2  * LANE_W, boxR);  // arm2 进口侧角点

    // 路缘向路口内侧方向 = 路臂反方向（-sin, +cos in XZ）
    const t1 = arm1.angle * Math.PI / 180;
    const t2 = arm2.angle * Math.PI / 180;
    const d1x = -Math.sin(t1), d1z = Math.cos(t1);  // arm1 内侧方向
    const d2x = -Math.sin(t2), d2z = Math.cos(t2);  // arm2 内侧方向

    // 求两条内侧延伸线的交点作为贝塞尔控制点（凹曲线）
    let cpX, cpZ;
    const cp = lineIntersect2D(p1.x, p1.z, d1x, d1z, p2.x, p2.z, d2x, d2z);
    if (cp) {
      cpX = cp.x;
      cpZ = cp.z;
    } else {
      // 退化情况（两臂平行）：取中点略向内偏
      const midX = (p1.x + p2.x) / 2, midZ = (p1.z + p2.z) / 2;
      const midLen = Math.sqrt(midX * midX + midZ * midZ);
      const scale  = midLen > 0.5 ? (midLen * 0.55) / midLen : 0.55;
      cpX = midX * scale;
      cpZ = midZ * scale;
    }

    // 二次贝塞尔曲线（20 段）
    const pts = [];
    const N = 20;
    for (let k = 0; k <= N; k++) {
      const t  = k / N, it = 1 - t;
      pts.push(
        it * it * p1.x + 2 * it * t * cpX + t * t * p2.x,
        LINE_Y + 0.08,
        it * it * p1.z + 2 * it * t * cpZ + t * t * p2.z,
      );
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const bl = new THREE.Line(geom, lineMat(0xffffff));
    bl.renderOrder = 10;
    group.add(bl);
  }

  return group;
}

// ── 口心路面填补（atx-perform）─────────────────────────────
// agent-loop 依赖 OSM 底图沥青衬底，口心开放不可见；本工程底图为深色裸底，
// 需自绘口心路面：多边形取各臂内端角点（出口侧→进口侧），与臂体内缘精确对齐。
function buildCenterFill(arms, boxR) {
  const g = new THREE.Group();
  if (arms.length < 2) return g;
  const sorted = [...arms].sort((a, b) => a.angle - b.angle);
  // 边界点序列：相邻臂角点之间用与 buildCenterCurves 同源的二次贝塞尔采样，
  // 保证补片外缘与路缘曲线完全重合，角部不留缺口
  const pts = [];
  const N = 20;
  for (let i = 0; i < sorted.length; i++) {
    const arm1 = sorted[i];
    const arm2 = sorted[(i + 1) % sorted.length];
    const nOut1 = arm1.outLink ? (arm1.outLink.c_lane_num || arm1.outLink.lane_num || 0) : 0;
    const nIn2 = arm2.inLink ? parseLaneInfo(arm2.inLink).length : 0;
    const p1 = armToWorld(arm1.angle, -nOut1 * LANE_W, boxR);
    const p2 = armToWorld(arm2.angle, nIn2 * LANE_W, boxR);
    const t1 = (arm1.angle * Math.PI) / 180;
    const t2 = (arm2.angle * Math.PI) / 180;
    const d1x = -Math.sin(t1), d1z = Math.cos(t1);
    const d2x = -Math.sin(t2), d2z = Math.cos(t2);
    let cpX, cpZ;
    const cp = lineIntersect2D(p1.x, p1.z, d1x, d1z, p2.x, p2.z, d2x, d2z);
    if (cp) {
      cpX = cp.x;
      cpZ = cp.z;
    } else {
      const midX = (p1.x + p2.x) / 2, midZ = (p1.z + p2.z) / 2;
      const midLen = Math.sqrt(midX * midX + midZ * midZ);
      const scale = midLen > 0.5 ? (midLen * 0.55) / midLen : 0.55;
      cpX = midX * scale;
      cpZ = midZ * scale;
    }
    // 臂1 出口侧角点直连入边界，随后贝塞尔过渡到臂2 进口侧角点
    pts.push([p1.x, p1.z]);
    for (let k = 1; k <= N; k++) {
      const t = k / N, it = 1 - t;
      pts.push([
        it * it * p1.x + 2 * it * t * cpX + t * t * p2.x,
        it * it * p1.z + 2 * it * t * cpZ + t * t * p2.z,
      ]);
    }
  }
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const y = BASE_Y - 0.03; // 略低于臂体路面，避免共面闪
  const pos = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    pos.push(cx, y, cz, a[0], y, a[1], b[0], y, b[1]);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geom,
    new THREE.MeshBasicMaterial({ color: C_ROAD, side: THREE.DoubleSide }),
  );
  mesh.renderOrder = 9;
  g.add(mesh);
  return g;
}

// ── 3D 小汽车模型 ─────────────────────────────────────────────────────────────
// 车身 + 车顶舱体，坐标原点在车底中心，车头朝 -Z（驶向路口方向）
function createCarMesh(carLen, carW, bodyColor) {
  const g = new THREE.Group();

  // 车身（宽扁盒）
  const bh = 0.40;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(carW * 0.84, bh, carLen * 0.86),
    new THREE.MeshBasicMaterial({ color: bodyColor }),
  );
  body.position.y = bh / 2;
  g.add(body);

  // 车顶舱（稍窄、稍矮，偏后放置）
  const ch = 0.26;
  const cabinColor = new THREE.Color(bodyColor).multiplyScalar(0.68).getHex();
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(carW * 0.60, ch, carLen * 0.52),
    new THREE.MeshBasicMaterial({ color: cabinColor }),
  );
  cabin.position.y  = bh + ch / 2;
  cabin.position.z  = carLen * 0.04;  // 稍偏后（远离车头）
  g.add(cabin);

  return g;
}

// ── 车辆排队模拟 ───────────────────────────────────────────────────────────────
// queueInfo: { queueM: number, satPct: number }
// 车辆数 = round(queueM / 8)，每条车道各差 ±1 辆形成参差感
function buildQueueCars(arm, boxR, queueInfo) {
  const g = new THREE.Group();
  g.userData.isQueueCars = true;
  const carList = [];
  const inLanes = arm.inLink ? parseLaneInfo(arm.inLink) : [];
  const nIn = inLanes.length;
  if (nIn === 0) return g;

  const { queueM = 0, satPct = 0 } = queueInfo;
  if (queueM <= 0) return g;

  // 颜色依据饱和度
  const bodyColor =
    satPct >= 85 ? 0xdd2233 :
    satPct >= 70 ? 0xdd6600 :
    satPct >= 50 ? 0xccaa00 :
                   0x338844;

  // 总车辆数 = round(queueM / 8)；每辆约占 8m = 0.8 Three.js 单位
  const nCarsBase = Math.max(1, Math.round(queueM / 8));
  const carLen    = 0.54;   // 车身长度（Three.js 单位）
  const carGap    = 0.26;   // 车间距
  const carStep   = carLen + carGap;   // ≈ 0.8 单位 / 辆
  const carW      = LANE_W * 0.70;
  const startZ    = boxR + 0.9;        // 停车线后方出发点

  for (let lane = 0; lane < nIn; lane++) {
    const cx = (lane + 0.5) * LANE_W;
    const code = (inLanes[lane] || '').toUpperCase();

    // 按车道功能确定排队系数（空车道视为直行）：
    //   纯左转(B)/纯右转(D) → 40%；组合转向(BC/CD) → 65%；其余（含空车道）→ 100%
    const isOnlyLeft  = /^[BAZ]*B[BAZ]*$/.test(code) && !code.includes('C') && !code.includes('D');
    const isOnlyRight = /^[DEZ]*D[DEZ]*$/.test(code) && !code.includes('C') && !code.includes('B');
    const isMixed     = (code.includes('B') || code.includes('D')) && code.includes('C');
    const ratio = isOnlyLeft || isOnlyRight ? 0.40 : isMixed ? 0.65 : 1.0;

    // 数据标定（atx-perform）：每车道辆数 = round(queueM/8 × 转向比)，
    // 车步长 0.8u=8m → 长队长度精确等于 queueM 实际数据（agent-loop 原版 ×2 为视觉夸大）
    const laneVar   = (lane % 3) - 1;
    const nCarsLane = Math.max(0, Math.round(nCarsBase * ratio) + laneVar);

    // 车道小偏移，让排队不整齐划一
    const laneOffset = (lane % 2) * (carStep * 0.22);

    for (let c = 0; c < nCarsLane; c++) {
      const zCenter = startZ + carLen / 2 + c * carStep + laneOffset;
      if (zCenter > boxR + ARM_LEN * 0.94) break;

      const car = createCarMesh(carLen, carW, bodyColor);
      // 车底放在路面标线层上方
      car.position.set(cx, MARK_Y + 0.02, zCenter);
      g.add(car);
      carList.push({ car, z: zCenter });
    }
  }

  // 排队过程动画用：按距停车线由近及远排序，逐辆揭示
  carList.sort((a, b) => a.z - b.z);
  g.userData.queueCarList = carList.map((item) => item.car);

  g.rotation.y = bearingToRotY(arm.angle);
  // 供跨层摘臂：Act4 下游段化时按角度从保留渠化层隐藏主口连接臂
  g.userData.armAngle = arm.angle;
  return g;
}

// ── 构建单条路臂 ──────────────────────────────────────────────────────────────
// center（路口中心世界 XZ）存在且 link 带 geom 时，臂体按真实道路走向弯曲；
// 近场锁定区内（停车线/箭头/角点）构件保持直线局部坐标不变
function buildArm(arm, boxR, { arrowScale = 1.55, axisRoads = null, showArmRoadNames = true, center = null } = {}) {
  const g = new THREE.Group();

  const inLink  = arm.inLink;
  const outLink = arm.outLink;
  const inLanes = inLink  ? parseLaneInfo(inLink)                          : [];
  const nIn     = inLanes.length;
  const nOut    = outLink ? (outLink.c_lane_num || outLink.lane_num || 0) : 0;

  if (nIn + nOut === 0) return g;

  const xIn    =  nIn  * LANE_W;
  const xOut   = -nOut * LANE_W;
  const totalW = (nIn + nOut) * LANE_W;
  const xCenter = (xOut + xIn) / 2;

  const z0   = boxR;
  const z1   = boxR + ARM_LEN;
  const zMid = z0 + ARM_LEN / 2;

  // ── 臂中心线（有 geom 则弯曲，否则回退直线）─────────────────────────────
  const curve = buildArmCenterline(arm, boxR, center);

  // ── 路面 ──────────────────────────────────────────────────────────────────
  if (curve) {
    g.add(buildCurvedRoad(curve, xOut, xIn));
  } else {
    const road = hPlane(totalW, ARM_LEN, C_ROAD);
    road.position.set(xCenter, BASE_Y, z0 + ARM_LEN / 2);
    g.add(road);
  }

  // ── 缘石线 ────────────────────────────────────────────────────────────────
  if (curve) {
    if (nIn  > 0) g.add(buildCurvedLine(curve, xIn,  C_CURB));
    if (nOut > 0) g.add(buildCurvedLine(curve, xOut, C_CURB));
  } else {
    if (nIn  > 0) g.add(zLine( xIn,  z0, z1, C_CURB));
    if (nOut > 0) g.add(zLine( xOut, z0, z1, C_CURB));
  }

  // ── 中心分隔线 ────────────────────────────────────────────────────────────
  if (nIn > 0 && nOut > 0) {
    g.add(curve ? buildCurvedLine(curve, 0, C_DIVIDER) : zLine(0, z0, z1, C_DIVIDER));
  }

  // ── 进口道车道虚线 ────────────────────────────────────────────────────────
  for (let i = 1; i < nIn; i++) {
    const d = curve ? buildCurvedDash(curve, i * LANE_W, C_MARKING) : zDash(i * LANE_W, z0, z1, C_MARKING);
    if (d) g.add(d);
  }
  // ── 出口道车道虚线 ────────────────────────────────────────────────────────
  for (let j = 1; j < nOut; j++) {
    const d = curve ? buildCurvedDash(curve, -j * LANE_W, C_MARKING) : zDash(-j * LANE_W, z0, z1, C_MARKING);
    if (d) g.add(d);
  }

  // ── 停车线（红色细线，保留）────────────────────────────────────────────
  if (nIn > 0) {
    const sw = nIn * LANE_W;
    // 仅细停车线，不用大块红色色板（避免与排队色块抢戏）
    g.add(xLine(0, xIn, z0, C_STOP, MARK_Y + 0.06));
    g.add(xLine(0, xIn, z0 + 0.35, C_STOP, MARK_Y + 0.06));
  }

  // 斑马线白色色块已去除：俯视易误读为「车道白色统一色块」；转向箭头保留

  // ── 进口道方向箭头（放大 + 靠近停车线，缺码默认直行）──────────────────
  const arrowZ = z0 + ARM_LEN * 0.18;
  inLanes.forEach((code, i) => {
    const cx = (i + 0.5) * LANE_W;
    const arrow = makeArrow(code || 'C', cx, arrowZ, arrowScale);
    if (arrow) g.add(arrow);
  });

  // ── 道路名称（四臂均写；东西/南北同名也各自标注）────────────────────────
  // Act2 自带更大号轴路名时传 showArmRoadNames:false，避免与小框路名叠字
  if (showArmRoadNames) {
    const roadName = pickArmRoadName(arm, axisRoads);
    if (roadName) {
      const label = makeArmRoadNameSprite(roadName);
      // 放在路臂中段偏外，贴在示意图上方；弯曲臂贴中心线实际走向
      if (curve) {
        const p = curve.at(z0 + ARM_LEN * 0.55);
        label.position.set(p.x + p.nx * xCenter, MARK_Y + 2.6, p.z + p.nz * xCenter);
      } else {
        label.position.set(xCenter, MARK_Y + 2.6, z0 + ARM_LEN * 0.55);
      }
      label.userData.armCardinal = cardinalKeyFromArmAngle(arm.angle);
      label.userData.armRoadName = roadName;
      g.add(label);
    }
  }

  g.rotation.y = bearingToRotY(arm.angle);
  g.userData.armAngle = arm.angle;
  g.userData.armCardinal = cardinalKeyFromArmAngle(arm.angle);
  return g;
}

// ── 公开 API ──────────────────────────────────────────────────────────────────

/**
 * 创建路口渠化图
 * @param {object}   interItem  - intersection_links.json 中的一个路口对象
 * @param {Array}    [queueData] - 可选排队数据
 *   每项格式：{ armAngle: number, queueM: number, satPct: number }
 *   armAngle: 与路臂方向角匹配（地理方位角，度），不匹配则模拟少量
 * @param {object}   [opts]
 * @param {boolean}  [opts.showQueueCars=true]  是否绘制进口道排队小车
 * @param {number}   [opts.arrowScale=1.55]     转向箭头放大倍数
 * @param {boolean}  [opts.neutralOtherArms=true] 无匹配臂是否仍模拟少量排队
 * @param {boolean}  [opts.showArmRoadNames=true] 是否绘制渠化小框路名（Act2 有大号轴路名时关闭）
 * @param {{ ew_road?: string|null, ns_road?: string|null, approaches?: Record<string, string|null> }|null} [opts.axisRoads]
 * @param {number[]} [opts.excludeArmAngles] 不渲染的臂角（段中心渠化的连接臂）；
 *   仅跳过臂体路面/标线/箭头/排队车，calcBoxR 与角点曲线仍用全量臂，
 *   保持 computeChannelGeometry 契约与段体入口角点闭合
 */
export function createChannelizationLayer(interItem, queueData = null, opts = {}) {
  const {
    showQueueCars = true,
    arrowScale = 1.55,
    neutralOtherArms = true,
    showArmRoadNames = true,
    axisRoads = null,
    excludeArmAngles = [],
  } = opts;
  const isArmExcluded = (arm) => excludeArmAngles.some((a) => angleDiff(a, arm.angle) < 1);

  const group = new THREE.Group();
  group.name        = 'channelization';
  group.renderOrder = 10;

  const info     = interItem.intersection_info;
  const [pcx, pcz] = project(info.longitude, info.latitude);
  const [offx, offz] = interCenterOffset(info.inter_id);
  const cx = pcx + offx;
  const cz = pcz + offz;

  const sl       = interItem.surrounding_links;
  const inLinks  = sl['进入路口的路段']  || [];
  const outLinks = sl['离开路口的路段'] || [];

  const arms = gatherArms(inLinks, outLinks);
  const boxR = calcBoxR(arms);

  // ── 路臂几何（每臂独立写道路名，十字口四臂齐全）────────────────────────
  for (const arm of arms) {
    if (isArmExcluded(arm)) continue;
    group.add(buildArm(arm, boxR, { arrowScale, axisRoads, showArmRoadNames, center: { x: cx, z: cz } }));
  }

  // ── 角点曲线 ──────────────────────────────────────────────────────────────
  group.add(buildCenterFill(arms, boxR));
  group.add(buildCenterCurves(arms, boxR));

  // ── 车辆排队 ──────────────────────────────────────────────────────────────
  if (showQueueCars) {
    for (const arm of arms) {
      if (isArmExcluded(arm)) continue;
      if (!arm.inLink) continue;
      // 从 queueData 中查找最匹配的臂数据（角度差 < 30°）
      let qInfo = null;
      if (queueData) {
        const match = queueData.reduce((best, q) => {
          const d = angleDiff(arm.angle, q.armAngle);
          return d < (best?.d ?? 999) ? { ...q, d } : best;
        }, null);
        if (match && match.d < 30) qInfo = match;
      }
      // 没有具体数据 → 可选模拟少量（低饱和度）
      if (!qInfo) {
        if (!neutralOtherArms) continue;
        qInfo = { queueM: 25, satPct: 18 };
      }
      group.add(buildQueueCars(arm, boxR, qInfo));
    }
  }

  group.position.set(cx, 0, cz);
  group.userData.armCount = arms.length;
  group.userData.armLabels = arms.map((a) => pickArmRoadName(a, axisRoads)).filter(Boolean);
  group.traverse(o => { o.frustumCulled = false; });
  return group;
}

/**
 * 外部消费方（Act3 排队色块等）复用本层的归臂与动态 BOX_R，
 * 使停车线起点与渠化渲染完全一致，禁止色块落进路口盒。
 * @param {object} interItem - intersection_links.json / channelizationMapToInterItem 产物
 * @returns {{ boxR: number, arms: Array<{ angle: number, nIn: number, nOut: number }> }|null}
 */
export function computeChannelGeometry(interItem) {
  const sl = interItem?.surrounding_links;
  if (!sl) return null;
  const arms = gatherArms(sl['进入路口的路段'] || [], sl['离开路口的路段'] || []);
  if (!arms.length) return null;
  return {
    boxR: calcBoxR(arms),
    arms: arms.map((a) => ({
      angle: a.angle,
      nIn: a.inLink ? parseLaneInfo(a.inLink).length : 0,
      inCodes: a.inLink ? parseLaneInfo(a.inLink).map(normalizeLaneMovements) : [],
      nOut: a.outLink ? (a.outLink.c_lane_num || a.outLink.lane_num || 0) : 0,
      // geom 透传：段中心渠化的弯曲段体沿真实道路走向（Act3 消费方不读该字段，契约不变）
      inGeom: a.inLink?.geom || null,
      outGeom: a.outLink?.geom || null,
    })),
  };
}

/** 显示/隐藏渠化层上的排队小车（Act3 改用色块证据时关闭） */
export function setChannelizationQueueCarsVisible(group, visible) {
  if (!group) return;
  group.traverse((o) => {
    if (o.userData?.isQueueCars) o.visible = !!visible;
  });
}

/**
 * 排队过程动画：t∈[0,1]，按距停车线由近及远逐辆揭示排队车。
 * t=1 全部显示；需先 setChannelizationQueueCarsVisible(group, true)。
 */
export function setChannelizationQueueProgress(group, t) {
  if (!group) return;
  const k = Math.max(0, Math.min(1, t));
  group.traverse((o) => {
    const list = o.userData?.queueCarList;
    if (!o.userData?.isQueueCars || !list?.length) return;
    const n = Math.ceil(list.length * k);
    list.forEach((car, i) => { car.visible = i < n; });
  });
}

/** 强化转向箭头可见度（Act3 特写） */
export function boostChannelizationArrows(group, opacityScale = 1.35) {
  if (!group) return;
  group.traverse((o) => {
    if (!o.userData?.isLaneArrow || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => {
      m.transparent = true;
      const base = m.userData?.act2BaseOpacity ?? m.opacity ?? 1;
      m.opacity = Math.min(1, base * opacityScale);
      m.needsUpdate = true;
    });
  });
}

/** 释放 GPU 资源 */
export function disposeChannelizationLayer(group) {
  if (!group) return;
  group.traverse(o => {
    o.geometry?.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        m.map?.dispose?.();
        m.dispose?.();
      });
    }
  });
}

// ── 段中心渠化复用的内部工具（segmentChannelizationLayer.js）──────────────────
// 与 Act3/Act8 的 LANE_W 本地副本同源，禁止在此改动数值而不同步
export {
  LANE_W,
  BASE_Y, LINE_Y,
  C_ROAD, C_DIVIDER, C_MARKING, C_CURB,
  project, bearingToRotY, angleDiff, geoBearing,
  hPlane, zLine, zDash, makeArrow,
  buildArmCenterline,
  parseGeomPts, resamplePolyline, smoothPolyline,
  buildCurvedRoad, buildCurvedLine, buildCurvedDash,
  createCarMesh,
  buildQueueCars,
  gatherArms,
  calcBoxR,
};

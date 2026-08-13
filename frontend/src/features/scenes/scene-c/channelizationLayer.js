/**
 * channelizationLayer.js  —  v3
 *
 * 改进点：
 *   1. 斑马线条纹平行于路臂方向（沿 Z 轴排列）
 *   2. 方向箭头更大，位置靠近停车线
 *   3. 相邻路臂角点用白色贝塞尔曲线相连
 *   4. 支持模拟车辆排队（可选 queueData 参数）
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
const LANE_W  = 2.8;
const ARM_LEN = 72;
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
  if (arms.length < 2) return 18;
  const sorted = [...arms].sort((a, b) => a.angle - b.angle);
  let maxR = 16;
  for (let i = 0; i < sorted.length; i++) {
    const a1 = sorted[i], a2 = sorted[(i + 1) % sorted.length];
    let dAngle = a2.angle - a1.angle;
    if (dAngle < 0) dAngle += 360;
    if (dAngle < 1) continue;
    const w1half = ((a1.inLink ? parseLaneInfo(a1.inLink).length : 0) + (a1.outLink?.lane_num || 0)) * LANE_W / 2;
    const w2half = ((a2.inLink ? parseLaneInfo(a2.inLink).length : 0) + (a2.outLink?.lane_num || 0)) * LANE_W / 2;
    const sinHalf = Math.sin(dAngle * Math.PI / 360);
    if (sinHalf < 0.01) continue;
    maxR = Math.max(maxR, (w1half + w2half) / sinHalf * 0.55);
  }
  return Math.min(Math.max(maxR, 16), 90);
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

// ── 相邻路臂角点白色凹形贝塞尔曲线（模拟转弯半径）───────────────────────────
// 控制点取两条路缘向路口内侧延伸后的交点，使曲线向内凹（符合真实路口转角）
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

    // 整体 ×2；每条车道再做 -1 / 0 / +1 差异
    const laneVar   = (lane % 3) - 1;
    const nCarsLane = Math.max(0, Math.round(nCarsBase * ratio * 2) + laneVar);

    // 车道小偏移，让排队不整齐划一
    const laneOffset = (lane % 2) * (carStep * 0.22);

    for (let c = 0; c < nCarsLane; c++) {
      const zCenter = startZ + carLen / 2 + c * carStep + laneOffset;
      if (zCenter > boxR + ARM_LEN * 0.94) break;

      const car = createCarMesh(carLen, carW, bodyColor);
      // 车底放在路面标线层上方
      car.position.set(cx, MARK_Y + 0.02, zCenter);
      g.add(car);
    }
  }

  g.rotation.y = bearingToRotY(arm.angle);
  return g;
}

// ── 构建单条路臂 ──────────────────────────────────────────────────────────────
function buildArm(arm, boxR, { arrowScale = 1.55, axisRoads = null, showArmRoadNames = true } = {}) {
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

  // ── 路面 ──────────────────────────────────────────────────────────────────
  const road = hPlane(totalW, ARM_LEN, C_ROAD);
  road.position.set(xCenter, BASE_Y, z0 + ARM_LEN / 2);
  g.add(road);

  // ── 缘石线 ────────────────────────────────────────────────────────────────
  if (nIn  > 0) g.add(zLine( xIn,  z0, z1, C_CURB));
  if (nOut > 0) g.add(zLine( xOut, z0, z1, C_CURB));

  // ── 中心分隔线 ────────────────────────────────────────────────────────────
  if (nIn > 0 && nOut > 0) g.add(zLine(0, z0, z1, C_DIVIDER));

  // ── 进口道车道虚线 ────────────────────────────────────────────────────────
  for (let i = 1; i < nIn; i++) {
    const d = zDash(i * LANE_W, z0, z1, C_MARKING);
    if (d) g.add(d);
  }
  // ── 出口道车道虚线 ────────────────────────────────────────────────────────
  for (let j = 1; j < nOut; j++) {
    const d = zDash(-j * LANE_W, z0, z1, C_MARKING);
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
      // 放在路臂中段偏外，贴在示意图上方
      label.position.set(xCenter, MARK_Y + 2.6, z0 + ARM_LEN * 0.55);
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
 */
export function createChannelizationLayer(interItem, queueData = null, opts = {}) {
  const {
    showQueueCars = true,
    arrowScale = 1.55,
    neutralOtherArms = true,
    showArmRoadNames = true,
    axisRoads = null,
  } = opts;

  const group = new THREE.Group();
  group.name        = 'channelization';
  group.renderOrder = 10;

  const info     = interItem.intersection_info;
  const [cx, cz] = project(info.longitude, info.latitude);

  const sl       = interItem.surrounding_links;
  const inLinks  = sl['进入路口的路段']  || [];
  const outLinks = sl['离开路口的路段'] || [];

  const arms = gatherArms(inLinks, outLinks);
  const boxR = calcBoxR(arms);

  // ── 路臂几何（每臂独立写道路名，十字口四臂齐全）────────────────────────
  for (const arm of arms) {
    group.add(buildArm(arm, boxR, { arrowScale, axisRoads, showArmRoadNames }));
  }

  // ── 角点曲线 ──────────────────────────────────────────────────────────────
  group.add(buildCenterCurves(arms, boxR));

  // ── 车辆排队 ──────────────────────────────────────────────────────────────
  if (showQueueCars) {
    for (const arm of arms) {
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

/** 显示/隐藏渠化层上的排队小车（Act3 改用色块证据时关闭） */
export function setChannelizationQueueCarsVisible(group, visible) {
  if (!group) return;
  group.traverse((o) => {
    if (o.userData?.isQueueCars) o.visible = !!visible;
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

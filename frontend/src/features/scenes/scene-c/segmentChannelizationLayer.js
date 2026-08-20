/**
 * segmentChannelizationLayer.js — 以路段为锚点的渠化渲染（段中心化）
 *
 * 与 createChannelizationLayer（路口锚定）的关系：
 *   - 两端路口盒复用单口渠化，仅排除连接臂渲染（calcBoxR 仍全臂计算，
 *     Act3 computeChannelGeometry 契约不受影响）
 *   - 中央段体按两口真实中心连线铺设，双向半幅车道数取连接臂进/出口车道，
 *     两端口径一致时无缝衔接；真实间距不足时沿段轴做叙事拉长（仅推远端路口盒，
 *     主口盒坐标不动，保证 Act3 排队色块对齐）
 *
 * 段局部空间约定（与臂局部空间同源）：
 *   +Z = A→B 方向（A/B 按车流方向分配：车流从 A 驶向 B）
 *   A→B 半幅（沿 +Z 行驶）在 -X 侧；B→A 半幅（沿 -Z 行驶）在 +X 侧
 *   —— 与盒体「进口道在臂局部 +X 侧」约定经 armToWorld 变换后同侧自洽
 *
 * 拆分为 plan/build 两步：Act2 镜头在渠化层创建前就需要段取景参数，
 * planSegmentChannelization 为纯数据解析，可提前调用。
 */

import * as THREE from 'three';
import {
  LANE_W,
  BASE_Y, LINE_Y,
  C_ROAD, C_DIVIDER, C_MARKING, C_CURB,
  project, bearingToRotY, angleDiff, geoBearing,
  hPlane, zLine, zDash, makeArrow,
  createChannelizationLayer,
  computeChannelGeometry,
  parseGeomPts, resamplePolyline, smoothPolyline,
  buildCurvedRoad, buildCurvedLine, buildCurvedDash,
  createCarMesh,
} from './channelizationLayer.js';

// ── 段体参数 ──────────────────────────────────────────────────────────────────
/** 段体最小长度（世界单位）；真实间距不足时沿段轴叙事拉长 */
const MIN_BODY_LEN = 12;
/** 连接臂匹配容差（度）：段轴方位角与臂角差超过该值视为数据不足 */
const ARM_MATCH_TOL = 30;
/** 转向箭头距盒缘的收进量（避免贴停车线） */
const ARROW_INSET = 3;

// ── 拓宽段体（车道数单调过渡，如北向南 3→5 / 南向北 4→3）──────────────
// widen = { ab: [nA, nB], ba: [nA, nB] }：A→B 半幅在 A/B 端车道数、B→A 半幅在 A/B 端车道数；
// 路面两侧缘石线性收放，车道边界线自路缘「生长」（width > i·LANE_W 区间才绘制）。
/** 横向条带网格：左右缘均随局部 z 变化 */
function taperedPlane(xlAt, xrAt, zs, color, y = BASE_Y) {
  const pos = [];
  const idx = [];
  zs.forEach((z, k) => {
    pos.push(xlAt(z), y, z, xrAt(z), y, z);
    if (k > 0) {
      const a = 2 * k - 2;
      const b = 2 * k - 1;
      const c = 2 * k;
      const d = 2 * k + 1;
      idx.push(a, b, c, b, d, c);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, depthWrite: true }));
  m.renderOrder = 10;
  return m;
}

/** 缘石折线（[x, z] 列表） */
function edgeLine(xzList, color, y = LINE_Y) {
  const arr = [];
  xzList.forEach(([x, z]) => arr.push(x, y, z));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color }));
  l.renderOrder = 10;
  return l;
}

/** 线性宽 w0→w1 下，车道边界 i·LANE_W 的可绘 t 区间（width > i·LANE_W 才存在） */
function boundRange(w0, w1, i) {
  const span = w1 - w0;
  if (Math.abs(span) < 1e-6) return w0 > i * LANE_W ? [0, 1] : null;
  const t = (i * LANE_W - w0) / span;
  if (span > 0) return t >= 1 ? null : [Math.max(0, t), 1];
  return t <= 0 ? null : [0, Math.min(1, t)];
}

/** x 随 z 变化的斜向虚线（车道边界自绿化带生长） */
function dashLineX(xAt, z0, z1, color, dashLen = 2.8, gapLen = 2.2) {
  const pts = [];
  let z = z0;
  let on = true;
  while (z < z1) {
    const end = Math.min(z + (on ? dashLen : gapLen), z1);
    if (on) pts.push(xAt(z), LINE_Y, z, xAt(end), LINE_Y, end);
    z = end;
    on = !on;
  }
  if (pts.length < 6) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color }));
  l.renderOrder = 10;
  return l;
}

/** 扫描 wAt(z) 首次超过 target 的 z（z0→z1 方向），无交返回 null */
function widthCrossZ(wAt, target, z0, z1, n = 64) {
  for (let k = 0; k <= n; k++) {
    const z = z0 + (z1 - z0) * (k / n);
    if (wAt(z) > target + 1e-4) return z;
  }
  return null;
}

/** 中央绿化带（median）填充色 */
const C_MEDIAN = 0x1f6b3a;

/** 地理方位角 → 世界单位向量（x 东，z 南；北 = -Z） */
function bearingToWorldDir(bearing) {
  const t = (bearing * Math.PI) / 180;
  return { x: Math.sin(t), z: -Math.cos(t) };
}

/** 在 arms 中找与 targetBearing 最近的臂（差 < ARM_MATCH_TOL），找不到返回 null */
function findConnectingArm(arms, targetBearing) {
  let best = null;
  for (const arm of arms || []) {
    const d = angleDiff(arm.angle, targetBearing);
    if (d < (best?.d ?? Infinity)) best = { arm, d };
  }
  return best && best.d < ARM_MATCH_TOL ? best.arm : null;
}

/**
 * 段中心渠化数据解析（纯函数，不建 THREE 对象）
 * @param {object} mainItem  主端点路口（ticket.intersection_name 锚定口，坐标锚定不动）
 * @param {object} otherItem 另一端点路口（segment_end_name 解析口，间距不足时被推远）
 * @param {object} [opts]
 * @param {number} [opts.travelBearing] 车流地理方位角（ticket.direction 隐含方向；
 *   缺省时按 main→other 处理）
 * @returns {object|null} 数据不足（无渠化几何 / 连接臂缺失 / 两口重合）时返回 null
 */
export function planSegmentChannelization(mainItem, otherItem, opts = {}) {
  const { travelBearing = null } = opts;

  const geomMain = computeChannelGeometry(mainItem);
  const geomOther = computeChannelGeometry(otherItem);
  if (!geomMain || !geomOther) return null;

  const infoMain = mainItem.intersection_info;
  const infoOther = otherItem.intersection_info;
  const [mx, mz] = project(infoMain.longitude, infoMain.latitude);
  const [ox0, oz0] = project(infoOther.longitude, infoOther.latitude);

  const D0 = Math.hypot(ox0 - mx, oz0 - mz);
  if (D0 < 1) return null; // 两口坐标几乎重合，段模式无意义

  const bearingM2O = geoBearing(
    infoMain.longitude, infoMain.latitude,
    infoOther.longitude, infoOther.latitude,
  );
  const tb = Number.isFinite(travelBearing) ? travelBearing : bearingM2O;

  // 按车流方向分配段轴 A→B：车流驶向的一端为 B
  // bearingM2O 与车流方位角同向（差 ≤ 90°）→ 车流 main→other，A=main
  const mainIsA = angleDiff(bearingM2O, tb) <= 90;
  const itemA = mainIsA ? mainItem : otherItem;
  const itemB = mainIsA ? otherItem : mainItem;
  const geomA = mainIsA ? geomMain : geomOther;
  const geomB = mainIsA ? geomOther : geomMain;
  const segBearing = mainIsA ? bearingM2O : (bearingM2O + 180) % 360;

  // 连接臂：A 的 B 侧臂 / B 的 A 侧臂
  const armA = findConnectingArm(geomA.arms, segBearing);
  const armB = findConnectingArm(geomB.arms, (segBearing + 180) % 360);
  if (!armA || !armB) return null;

  // 双向半幅车道数：A→B = A 出口 / B 进口；B→A = A 进口 / B 出口（两端取大兼容口径差）
  const nAB = Math.max(armA.nOut || 0, armB.nIn || 0);
  const nBA = Math.max(armA.nIn || 0, armB.nOut || 0);
  if (nAB + nBA === 0) return null;
  const codesAB = (armB.inCodes || []).length ? armB.inCodes : Array(nAB).fill('C');
  const codesBA = (armA.inCodes || []).length ? armA.inCodes : Array(nBA).fill('C');

  // 真实间距不足 → 沿 main→other 轴叙事拉长（仅推 other 盒，main 锚定）
  const boxRA = geomA.boxR;
  const boxRB = geomB.boxR;
  let bodyLen = D0 - boxRA - boxRB;
  let stretched = false;
  let ax = mainIsA ? mx : ox0;
  let az = mainIsA ? mz : oz0;
  let bx = mainIsA ? ox0 : mx;
  let bz = mainIsA ? oz0 : mz;
  let ox = ox0;
  let oz = oz0;
  if (bodyLen < MIN_BODY_LEN) {
    stretched = true;
    const minD = boxRA + boxRB + MIN_BODY_LEN;
    const dirM2O = bearingToWorldDir(bearingM2O);
    ox = mx + dirM2O.x * minD;
    oz = mz + dirM2O.z * minD;
    if (mainIsA) {
      bx = ox; bz = oz;
    } else {
      ax = ox; az = oz;
    }
    bodyLen = MIN_BODY_LEN;
  }

  return {
    itemA, itemB, armA, armB,
    nAB, nBA, codesAB, codesBA,
    boxRA, boxRB, bodyLen, stretched,
    segBearing,
    worldA: { x: ax, z: az },
    worldB: { x: bx, z: bz },
    worldMain: { x: mx, z: mz },
    worldOther: { x: ox, z: oz },
    mid: { x: (ax + bx) / 2, z: (az + bz) / 2 },
    span: Math.hypot(bx - ax, bz - az),
  };
}

/**
 * 按 plan 单独构建中央段体（世界坐标，不含双端路口盒）
 * 供 Act4 下游段化复用：主口盒已由 Act2 保留渠化层渲染时，只需补段体
 * @param {object} plan planSegmentChannelization 产物
 * @param {object} [opts]
 * @param {number} [opts.arrowScale=1.55]
 * @param {boolean} [opts.curved=false] 双端锁定 + 沿 link geom 弯曲（Act4 下游段化启用；
 *   Act2 段中心渠化保持直段体——Act3 蓄车锚定沿臂直线假设，弯曲会破坏对齐）
 * @returns {THREE.Group}
 */
export function buildSegmentBody(plan, { arrowScale = 1.55, curved = false, centerToCenter = false, lift = 0, widen = null } = {}) {
  if (curved) {
    const curvedBody = buildCurvedSegmentBody(plan, { arrowScale });
    if (curvedBody) return curvedBody;
    // geom 缺失/退化/横向偏移异常 → 回退直段体
  }
  return buildStraightSegmentBody(plan, { arrowScale, centerToCenter, lift, widen });
}

/** 直段体（原实现）：沿 segBearing 盒缘到盒缘，中心组级旋转定位；
 *  centerToCenter=true 时两端延伸至路口中心，填补连接臂排除后的口心开放区缺失。
 *  widen={ab:[nA,nB], ba:[nA,nB]} 时双向半幅按端点车道数单调拓宽（真实车道演进）。 */
function buildStraightSegmentBody(plan, { arrowScale = 1.55, centerToCenter = false, lift = 0, widen = null } = {}) {
  const {
    nAB, nBA, codesAB, codesBA,
    boxRA, boxRB, bodyLen,
    segBearing, worldA, worldB,
  } = plan;

  // ── 中央段体（局部 +Z = A→B）──────────────────────────────────────────────
  const dirAB = bearingToWorldDir(segBearing);
  const body = new THREE.Group();
  body.name = 'segmentBody';
  const useWiden = !!widen && Array.isArray(widen.ab) && Array.isArray(widen.ba);
  // 轴选取：widen 时锁定「盒缘沿臂角」（与底图/盒体接缝同源）；否则原中心轴口径
  let startX;
  let startZ;
  let endX;
  let endZ;
  let axisBearing;
  let fullLen;
  if (useWiden && plan.armA && plan.armB) {
    const dA = bearingToWorldDir(plan.armA.angle);
    const dB = bearingToWorldDir(plan.armB.angle);
    startX = worldA.x + dA.x * boxRA;
    startZ = worldA.z + dA.z * boxRA;
    endX = worldB.x + dB.x * boxRB;
    endZ = worldB.z + dB.z * boxRB;
    axisBearing = (Math.atan2(endX - startX, -(endZ - startZ)) * 180) / Math.PI;
    fullLen = Math.hypot(endX - startX, endZ - startZ);
  } else {
    const extA = centerToCenter ? boxRA : 0;
    const extB = centerToCenter ? boxRB : 0;
    fullLen = bodyLen + extA + extB;
    startX = worldA.x + dirAB.x * (boxRA - extA);
    startZ = worldA.z + dirAB.z * (boxRA - extA);
    endX = worldB.x - dirAB.x * (boxRB - extB);
    endZ = worldB.z - dirAB.z * (boxRB - extB);
    axisBearing = segBearing;
  }
  const halfL = fullLen / 2;
  body.position.set((startX + endX) / 2, lift, (startZ + endZ) / 2);
  body.rotation.y = bearingToRotY(axisBearing);

  const wAB = nAB * LANE_W;
  const wBA = nBA * LANE_W;
  const totalW = wAB + wBA;
  const xCenter = (wBA - wAB) / 2;

  if (useWiden) {
    // ── 左转拓宽段体：段中取直等宽，近口 tA/tB 距离内 smoothstep 曲线拓宽 ──
    const abMax = Math.max(widen.ab[0], widen.ab[1]) * LANE_W;
    const baMax = Math.max(widen.ba[0], widen.ba[1]) * LANE_W;
    const tB = Math.min(widen.tB ?? 10, fullLen * 0.5);
    const tA = Math.min(widen.tA ?? 8, fullLen * 0.5);
    const smooth = (u) => {
      const c = Math.min(1, Math.max(0, u));
      return c * c * (3 - 2 * c);
    };
    // 北向南：段中 3 车道取直，近 B 端 tB 内曲线拓至 5
    const wABAt = (z) => (widen.ab[0] + (widen.ab[1] - widen.ab[0]) * smooth((z - (halfL - tB)) / tB)) * LANE_W;
    // 南向北：段中 3 车道取直，近 A 端 tA 内曲线拓至 4
    const wBAAt = (z) => (widen.ba[1] + (widen.ba[0] - widen.ba[1]) * smooth((-z - (halfL - tA)) / tA)) * LANE_W;
    const xiAB = (z) => -abMax + wABAt(z); // 北向南内缘（绿化带侧）
    const xiBA = (z) => baMax - wBAAt(z); // 南向北内缘（绿化带侧）
    const zs = [-halfL, -halfL * 0.5, 0, halfL * 0.5, halfL - tB, halfL - tB * 0.5, halfL];
    const zsBA = [-halfL, -halfL + tA * 0.5, -halfL + tA, 0, halfL * 0.5, halfL];
    const zsAll = [...new Set([...zs, ...zsBA])].sort((a, b) => a - b);
    body.add(taperedPlane(() => -abMax, xiAB, zsAll, C_ROAD));
    body.add(taperedPlane(xiBA, () => baMax, zsAll, C_ROAD));
    // 中央绿化带：两内缘之间，段中取直、近口收窄
    body.add(taperedPlane(xiAB, xiBA, zsAll, C_MEDIAN, BASE_Y + 0.02));
    // 外缘石（取直）
    body.add(zLine(-abMax, -halfL, halfL, C_CURB));
    body.add(zLine(baMax, -halfL, halfL, C_CURB));
    // 内缘线（绿化带侧路缘）
    body.add(edgeLine(zsAll.map((z) => [xiAB(z), z]), C_CURB));
    body.add(edgeLine(zsAll.map((z) => [xiBA(z), z]), C_CURB));
    // 车道边界线：直行车道边界取直常量；新增左转边界自绿化带直线长出
    const midInnerAB = abMax - widen.ab[0] * LANE_W;
    for (let i = 1; i < widen.ab[1]; i++) {
      const x = -i * LANE_W;
      let z0 = -halfL;
      if (i * LANE_W < midInnerAB - 1e-6) {
        // 新左转边界：自内缘穿过该常量线处起绘（直线）
        z0 = widthCrossZ(xiAB, x, -halfL, halfL);
        if (z0 == null) continue;
      } else if (Math.abs(i * LANE_W - midInnerAB) < 1e-6) {
        // 段中与内缘重合，仅绘拓宽段（直线）
        z0 = halfL - tB;
      }
      const d = zDash(x, z0, halfL, C_MARKING);
      if (d) body.add(d);
    }
    const midInnerBA = baMax - widen.ba[1] * LANE_W;
    for (let j = 1; j < widen.ba[0]; j++) {
      const x = j * LANE_W;
      let z1 = halfL;
      if (j * LANE_W < midInnerBA - 1e-6) {
        z1 = widthCrossZ((z) => -xiBA(z), -x, halfL, -halfL);
        if (z1 == null) continue;
      } else if (Math.abs(j * LANE_W - midInnerBA) < 1e-6) {
        z1 = -halfL + tA;
      }
      const d = zDash(x, -halfL, z1, C_MARKING);
      if (d) body.add(d);
    }
  } else {
    // 路面
    const road = hPlane(totalW, fullLen, C_ROAD);
    road.position.set(xCenter, road.position.y, 0);
    body.add(road);

    // 缘石线（两外侧）
    if (nAB > 0) body.add(zLine(-wAB, -halfL, halfL, C_CURB));
    if (nBA > 0) body.add(zLine(wBA, -halfL, halfL, C_CURB));
    // 中心分隔线
    if (nAB > 0 && nBA > 0) body.add(zLine(0, -halfL, halfL, C_DIVIDER));
    // 车道虚线
    for (let i = 1; i < nAB; i++) {
      const d = zDash(-i * LANE_W, -halfL, halfL, C_MARKING);
      if (d) body.add(d);
    }
    for (let j = 1; j < nBA; j++) {
      const d = zDash(j * LANE_W, -halfL, halfL, C_MARKING);
      if (d) body.add(d);
    }
  }

  // 转向箭头：A→B 半幅近 B 端（车流 +Z，经 rotation.y=π 镜像到 -X 侧、尖端朝 +Z）；
  // B→A 半幅近 A 端（车流 -Z，makeArrow 默认尖端朝 -Z 直接可用）
  if (fullLen >= ARROW_INSET * 2 + 2) {
    const arrowsAB = new THREE.Group();
    arrowsAB.rotation.y = Math.PI;
    codesAB.slice(0, nAB).forEach((code, i) => {
      const arrow = makeArrow(code || 'C', (i + 0.5) * LANE_W, -(halfL - ARROW_INSET), arrowScale);
      if (arrow) arrowsAB.add(arrow);
    });
    body.add(arrowsAB);
    codesBA.slice(0, nBA).forEach((code, j) => {
      const arrow = makeArrow(code || 'C', (j + 0.5) * LANE_W, -(halfL - ARROW_INSET), arrowScale);
      if (arrow) body.add(arrow);
    });
  }

  body.traverse((o) => { o.frustumCulled = false; });
  return body;
}

// ── 弯曲段体（双端锁定 + link geom 真实走向，2026-08-11）────────────────────
// 直段体的两端锚点沿 segBearing（两口中心连线方位角），而两端盒体的连接臂沿各自臂角
// （case_c：主口 180° vs 段轴 162.8°）——盒缘接缝横向错位实测 2.06U≈2.6 车道；
// 且直段体切过奥体西路弯道，偏离底图最大 5.12U。
// 修复：锚点改到「盒缘沿臂角」位置（与角点贝塞尔端点精确对齐），近端直线锁定保证
// 切向连续，中段沿连接臂 link geom 弯曲（与底图同源）。
/** 端头直线锁定长度（世界单位） */
const SEG_LOCK_LEN = 4;
/** 锁定区到真实 geom 的 smoothstep 混合宽度 */
const SEG_BLEND_LEN = 10;

/**
 * 段体中心线采样器（世界坐标）：两端盒缘锚点（沿连接臂角）直线锁定，
 * 中段沿连接臂 link geom 真实走向弯曲，smoothstep 混合。
 * geom 缺失时中心线即 P0→P1 弦线，两端锁定仍保证接缝位置/切向连续（消错位）。
 * @returns {null|{ stations: Array<object>, at: (r:number)=>object, total: number }}
 */
export function buildSegmentCenterline(plan) {
  const { armA, armB, boxRA, boxRB, worldA, worldB } = plan;
  if (!armA || !armB) return null;
  const dirA = bearingToWorldDir(armA.angle);
  const dirB = bearingToWorldDir(armB.angle);
  const p0 = { x: worldA.x + dirA.x * boxRA, z: worldA.z + dirA.z * boxRA };
  const p1 = { x: worldB.x + dirB.x * boxRB, z: worldB.z + dirB.z * boxRB };

  // geom 中间点：A 出口 link 优先（与车流 A→B 同向），裁剪两盒内部
  let mid = [];
  const geom = armA.outGeom || armA.inGeom || armB.inGeom || armB.outGeom;
  if (geom) {
    let ll = null;
    try { ll = parseGeomPts(geom); } catch (_) { ll = null; }
    if (Array.isArray(ll) && ll.length >= 2) {
      let pts = ll.map(([lon, lat]) => {
        const [wx, wz] = project(lon, lat);
        return { x: wx, z: wz };
      });
      const dHead = Math.hypot(pts[0].x - worldA.x, pts[0].z - worldA.z);
      const dTail = Math.hypot(pts[pts.length - 1].x - worldA.x, pts[pts.length - 1].z - worldA.z);
      if (dTail < dHead) pts.reverse();
      mid = pts.filter((p) =>
        Math.hypot(p.x - worldA.x, p.z - worldA.z) > boxRA + 0.5
        && Math.hypot(p.x - worldB.x, p.z - worldB.z) > boxRB + 0.5);
    }
  }

  // 中心线折线 = 锚点 P0 + 盒间 geom 点 + 锚点 P1（端点固定，平滑消折角）
  const pts = smoothPolyline(resamplePolyline([p0, ...mid, p1], 1.0), 4);
  const arc = [0];
  for (let i = 1; i < pts.length; i++) {
    arc.push(arc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  }
  const total = arc[arc.length - 1];
  if (total < 2) return null;

  const rawAt = (r) => {
    const s = Math.min(total, Math.max(0, r));
    let i = 1;
    while (i < arc.length - 1 && arc[i] < s) i++;
    const t = (s - arc[i - 1]) / Math.max(arc[i] - arc[i - 1], 1e-6);
    return {
      x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
      z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t,
    };
  };

  // 两端直线锁定 + smoothstep 混合；段长不足时等比收缩锁定/混合区
  const k = Math.min(1, total / (2 * (SEG_LOCK_LEN + SEG_BLEND_LEN) + 2));
  const lock = SEG_LOCK_LEN * k;
  const blend = Math.max(0.5, SEG_BLEND_LEN * k);
  const smooth01 = (u) => {
    const c = Math.min(1, Math.max(0, u));
    return c * c * (3 - 2 * c);
  };
  const headLine = (r) => ({ x: p0.x + dirA.x * r, z: p0.z + dirA.z * r });
  // 尾端锁定线：P1 朝 A 侧（+dirB）延伸，行进方向（r 递增）= -dirB = 车流驶入 B 方向
  const tailLine = (r) => ({ x: p1.x + dirB.x * (total - r), z: p1.z + dirB.z * (total - r) });
  const blendAt = (r) => {
    const raw = rawAt(r);
    if (r < lock) return headLine(r);
    if (r < lock + blend) {
      const w = smooth01((r - lock) / blend);
      const h = headLine(r);
      return { x: h.x + (raw.x - h.x) * w, z: h.z + (raw.z - h.z) * w };
    }
    if (r > total - lock) return tailLine(r);
    if (r > total - lock - blend) {
      const w = smooth01((r - (total - lock - blend)) / blend);
      const tl = tailLine(r);
      return { x: raw.x + (tl.x - raw.x) * w, z: raw.z + (tl.z - raw.z) * w };
    }
    return raw;
  };

  const stations = [];
  const STEP = 1.5;
  for (let r = 0; r < total; r += STEP) stations.push({ r, ...blendAt(r) });
  stations.push({ r: total, ...blendAt(total) });

  // 异常检测：中心线横向偏离 P0→P1 弦线 >15U → geom 异常，回退直段体
  const chord = { x: p1.x - p0.x, z: p1.z - p0.z };
  const chordLen2 = chord.x * chord.x + chord.z * chord.z || 1e-6;
  const exceeds = stations.some((p) => {
    const t = ((p.x - p0.x) * chord.x + (p.z - p0.z) * chord.z) / chordLen2;
    return Math.hypot(p.x - (p0.x + chord.x * t), p.z - (p0.z + chord.z * t)) > 15;
  });
  if (exceeds) return null;

  // 切向（中心差分）与法向（+X 侧，与直段体臂局部约定一致）
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

  /** 任意弧长处插值取点（供转向箭头摆放） */
  const at = (r) => {
    const cl = Math.min(total, Math.max(0, r));
    let i = 1;
    while (i < stations.length - 1 && stations[i].r < cl) i++;
    const a = stations[i - 1], b = stations[i];
    const t = (cl - a.r) / Math.max(b.r - a.r, 1e-6);
    return {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      tx: a.tx + (b.tx - a.tx) * t,
      tz: a.tz + (b.tz - a.tz) * t,
      nx: a.nx + (b.nx - a.nx) * t,
      nz: a.nz + (b.nz - a.nz) * t,
    };
  };
  return { stations, at, total };
}

/**
 * 弯曲段体：两端盒缘锚点锁定（与角点曲线接缝对齐），中段沿 link geom 真实走向。
 * 世界坐标直接构建（无组级旋转/平移）；geom 异常返回 null 由调用方回退直段体。
 */
function buildCurvedSegmentBody(plan, { arrowScale = 1.55 } = {}) {
  const { nAB, nBA, codesAB, codesBA } = plan;
  const curve = buildSegmentCenterline(plan);
  if (!curve) return null;

  const body = new THREE.Group();
  body.name = 'segmentBody';
  const wAB = nAB * LANE_W;
  const wBA = nBA * LANE_W;

  // 路面 + 缘石 + 中心分隔线 + 车道虚线（横向偏移约定与直段体一致：AB 半幅 -X，BA 半幅 +X）
  body.add(buildCurvedRoad(curve, -wAB, wBA));
  if (nAB > 0) body.add(buildCurvedLine(curve, -wAB, C_CURB));
  if (nBA > 0) body.add(buildCurvedLine(curve, wBA, C_CURB));
  if (nAB > 0 && nBA > 0) body.add(buildCurvedLine(curve, 0, C_DIVIDER));
  for (let i = 1; i < nAB; i++) {
    const d = buildCurvedDash(curve, -i * LANE_W, C_MARKING);
    if (d) body.add(d);
  }
  for (let j = 1; j < nBA; j++) {
    const d = buildCurvedDash(curve, j * LANE_W, C_MARKING);
    if (d) body.add(d);
  }

  // 转向箭头：AB 半幅近 B 端（尖端沿切向）、BA 半幅近 A 端（尖端逆切向）
  if (curve.total >= ARROW_INSET * 2 + 2) {
    const placeArrow = (code, r, off, reverse) => {
      const arrow = makeArrow(code || 'C', 0, 0, arrowScale);
      if (!arrow) return;
      const p = curve.at(r);
      // makeArrow 尖端朝局部 -Z；rotY(θ) 把 -Z 映射为 (-sinθ, -cosθ)
      arrow.rotation.y = Math.atan2(reverse ? p.tx : -p.tx, reverse ? p.tz : -p.tz);
      arrow.position.set(p.x + p.nx * off, 0, p.z + p.nz * off);
      body.add(arrow);
    };
    codesAB.slice(0, nAB).forEach((code, i) => {
      placeArrow(code, curve.total - ARROW_INSET, -(i + 0.5) * LANE_W, false);
    });
    codesBA.slice(0, nBA).forEach((code, j) => {
      placeArrow(code, ARROW_INSET, (j + 0.5) * LANE_W, true);
    });
  }

  body.traverse((o) => { o.frustumCulled = false; });
  return body;
}

/**
 * 按 plan 构建段中心渠化图层
 * @param {object} plan planSegmentChannelization 产物
 * @param {object} [opts]
 * @param {number}  [opts.arrowScale=1.55]
 * @param {boolean} [opts.showArmRoadNames=true]
 * @param {object}  [opts.axisRoads]
 * @returns {THREE.Group|null}
 */
export function buildSegmentChannelizationLayer(plan, opts = {}) {
  if (!plan) return null;
  const {
    arrowScale = 1.55,
    showArmRoadNames = true,
    axisRoads = null,
    centerToCenter = false,
    curved = false,
    excludeConnectingArms = true,
    showQueueCars = false,
    queueDataFor = null,
    bodyLift = 0,
    widen = null,
  } = opts;
  const {
    itemA, itemB, armA, armB,
    nAB, nBA, codesAB, codesBA,
    boxRA, boxRB, bodyLen, stretched,
    segBearing, worldA, worldB, worldMain, worldOther, mid, span,
  } = plan;

  // ── 两端路口盒：默认排除连接臂；excludeConnectingArms=false 时全臂渲染
  // （排队车走 agent-loop buildQueueCars 臂上逻辑，段体抬升 bodyLift 覆盖重叠区）
  const boxOpts = {
    arrowScale,
    axisRoads,
    showArmRoadNames,
    showQueueCars,
    neutralOtherArms: false,
  };
  const boxA = createChannelizationLayer(itemA, queueDataFor ? queueDataFor(itemA) : null, {
    ...boxOpts,
    excludeArmAngles: excludeConnectingArms ? [armA.angle] : [],
  });
  const boxB = createChannelizationLayer(itemB, queueDataFor ? queueDataFor(itemB) : null, {
    ...boxOpts,
    excludeArmAngles: excludeConnectingArms ? [armB.angle] : [],
  });
  if (stretched) {
    // 被叙事拉长的 only 是 other 盒；main 盒已在真实坐标
    const aIsOther = worldA.x === worldOther.x && worldA.z === worldOther.z;
    if (aIsOther) boxA.position.set(worldA.x, 0, worldA.z);
    else boxB.position.set(worldB.x, 0, worldB.z);
  }

  // ── 中央段体（局部 +Z = A→B）──────────────────────────────────────────────
  const body = buildSegmentBody(plan, { arrowScale, centerToCenter, curved, lift: bodyLift, widen });

  // ── 组装 ───────────────────────────────────────────────────────────────────
  const group = new THREE.Group();
  group.name = 'channelization'; // 与单口渠化同名：Act2 不透明度遍历 / 幕间 keepChannelization 契约复用
  group.renderOrder = 10;
  group.add(boxA);
  group.add(boxB);
  group.add(body);

  group.userData.isSegmentChannelization = true;
  group.userData.segmentBearing = segBearing;
  group.userData.segmentStretchApplied = stretched;
  group.userData.segmentMainWorld = { ...worldMain };
  group.userData.segmentOtherWorld = { ...worldOther };
  group.userData.segmentMidWorld = { ...mid };
  group.userData.segmentSpan = span;
  group.userData.armCount =
    (boxA.userData.armCount || 0) + (boxB.userData.armCount || 0) - 2;
  group.userData.armLabels = [
    ...(boxA.userData.armLabels || []),
    ...(boxB.userData.armLabels || []),
  ];
  group.traverse((o) => { o.frustumCulled = false; });
  return group;
}

/**
 * 一步到位创建段中心渠化图层（等价 plan + build）
 * @param {object} mainItem
 * @param {object} otherItem
 * @param {object} [opts] planSegmentChannelization + buildSegmentChannelizationLayer 的并集
 */
export function createSegmentChannelizationLayer(mainItem, otherItem, opts = {}) {
  const plan = planSegmentChannelization(mainItem, otherItem, opts);
  return buildSegmentChannelizationLayer(plan, opts);
}

/**
 * 段体排队过程：车辆沿 A→B 行驶半幅（-X 侧）排队，
 * 自 B 端停车线向 A 逐辆生长；复用 isQueueCars / queueCarList 契约，
 * 可配合 setChannelizationQueueCarsVisible / setChannelizationQueueProgress。
 * @param {object} plan planSegmentChannelization 产物
 * @param {{ queueM?: number, satPct?: number }} queueInfo
 */
export function buildSegmentQueueCars(plan, queueInfo = {}) {
  const g = new THREE.Group();
  g.userData.isQueueCars = true;
  const { queueM = 0, satPct = 0 } = queueInfo;
  if (!plan || queueM <= 0) return g;

  const bodyColor =
    satPct >= 85 ? 0xdd2233 :
    satPct >= 70 ? 0xdd6600 :
    satPct >= 50 ? 0xccaa00 :
                   0x338844;

  const carLen = 0.54;
  const carGap = 0.26;
  const carStep = carLen + carGap;
  const nCars = Math.max(1, Math.round(queueM / 8));
  const maxZ = plan.span / 2 - plan.boxRB - 1.2; // B 端停车线
  const minZ = -plan.span / 2 + plan.boxRA + 1.2;
  const carList = [];
  // 段空间分车道：A→B 半幅在 -X 侧；每车道辆数按 codesAB 转向比标定
  // （与 agent-loop buildQueueCars 数据逻辑同源：纯左/纯右 40%、组合 65%、其余 100%）
  const nAB = Math.max(1, plan.nAB || 2);
  const codes = (plan.codesAB || []).slice(0, nAB);
  const ratioOf = (code) => {
    const c = String(code || 'C').toUpperCase();
    const isOnlyLeft = /^[BAZ]*B[BAZ]*$/.test(c) && !c.includes('C') && !c.includes('D');
    const isOnlyRight = /^[DEZ]*D[DEZ]*$/.test(c) && !c.includes('C') && !c.includes('B');
    const isMixed = (c.includes('B') || c.includes('D')) && c.includes('C');
    return isOnlyLeft || isOnlyRight ? 0.40 : isMixed ? 0.65 : 1.0;
  };
  for (let lane = 0; lane < nAB; lane++) {
    const ratio = ratioOf(codes[lane]);
    const nLane = Math.max(0, Math.round(nCars * ratio) + ((lane % 3) - 1));
    const cx = -(lane + 0.5) * LANE_W;
    for (let c = 0; c < nLane; c++) {
      const z = maxZ - carLen / 2 - c * carStep - (lane % 2) * carStep * 0.22;
      if (z < minZ) break;
      const car = createCarMesh(carLen, LANE_W * 0.7, bodyColor);
      // createCarMesh 车头朝 -Z；段空间 A→B 车流朝 +Z，转 π 对齐行驶方向
      car.rotation.y = Math.PI;
      car.position.set(cx, 0.74, z);
      g.add(car);
      carList.push({ car, d: maxZ - z });
    }
  }
  carList.sort((a, b) => a.d - b.d);
  g.userData.queueCarList = carList.map((i) => i.car);

  // 段局部空间 → 世界：原点 mid，+Z = segBearing
  g.rotation.y = bearingToRotY(plan.segBearing);
  g.position.set(plan.mid.x, 0, plan.mid.z);
  return g;
}

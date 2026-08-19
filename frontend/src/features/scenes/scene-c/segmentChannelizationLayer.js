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
export function buildSegmentBody(plan, { arrowScale = 1.55, curved = false, centerToCenter = false, lift = 0 } = {}) {
  if (curved) {
    const curvedBody = buildCurvedSegmentBody(plan, { arrowScale });
    if (curvedBody) return curvedBody;
    // geom 缺失/退化/横向偏移异常 → 回退直段体
  }
  return buildStraightSegmentBody(plan, { arrowScale, centerToCenter, lift });
}

/** 直段体（原实现）：沿 segBearing 盒缘到盒缘，中心组级旋转定位；
 *  centerToCenter=true 时两端延伸至路口中心，填补连接臂排除后的口心开放区缺失。 */
function buildStraightSegmentBody(plan, { arrowScale = 1.55, centerToCenter = false, lift = 0 } = {}) {
  const {
    nAB, nBA, codesAB, codesBA,
    boxRA, boxRB, bodyLen,
    segBearing, worldA, worldB,
  } = plan;

  // ── 中央段体（局部 +Z = A→B）──────────────────────────────────────────────
  const dirAB = bearingToWorldDir(segBearing);
  const body = new THREE.Group();
  body.name = 'segmentBody';
  const extA = centerToCenter ? boxRA : 0;
  const extB = centerToCenter ? boxRB : 0;
  const fullLen = bodyLen + extA + extB;
  const halfL = fullLen / 2;
  // 段体中心 = A/B 延伸端点的中点（centerToCenter 时即两口中心连线中点）
  const startX = worldA.x + dirAB.x * (boxRA - extA);
  const startZ = worldA.z + dirAB.z * (boxRA - extA);
  const endX = worldB.x - dirAB.x * (boxRB - extB);
  const endZ = worldB.z - dirAB.z * (boxRB - extB);
  body.position.set((startX + endX) / 2, lift, (startZ + endZ) / 2);
  body.rotation.y = bearingToRotY(segBearing);

  const wAB = nAB * LANE_W;
  const wBA = nBA * LANE_W;
  const totalW = wAB + wBA;
  const xCenter = (wBA - wAB) / 2;

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
function buildSegmentCenterline(plan) {
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
    excludeConnectingArms = true,
    showQueueCars = false,
    queueDataFor = null,
    bodyLift = 0,
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
  const body = buildSegmentBody(plan, { arrowScale, centerToCenter, lift: bodyLift });

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

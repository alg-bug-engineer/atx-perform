/**
 * 拥堵蔓延图层
 *
 * 逻辑：
 *  - 以给定路口为起点，Dijkstra 计算波前到达时间
 *  - 默认东向偏置（SceneB）；可切换北→南偏置（Act4 Case A）
 *  - 蔓延半径限制在 MAX_SPREAD_RADIUS 世界单位（≈1.8km）内
 *  - 超出范围的路段显示暗黄底色（仅作路网背景）
 *  - 波前内路段顶点颜色按 绿→黄→红 动态插值
 *  - 可选：下游 slack 节点颜色钳制（避免拍成下游堵死）
 *  - 可选：播到峰值保持末帧（不淡出不循环）
 */

import * as THREE from 'three';
import { LineSegments2 }        from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial }         from 'three/addons/lines/LineMaterial.js';

// ── 常量 ─────────────────────────────────────────────────────────────────────

const WAVE_SPEED         = 4.0;   // 基础传播速度（世界单位/秒，1单位=10m）
const EAST_FACTOR        = 0.50;  // 向东路段：0.5× 时间（2× 更快）
const WEST_FACTOR        = 3.0;   // 向西路段：3× 时间（3× 更慢）
const SOUTH_FACTOR       = 0.50;  // 向南路段：更快（Act4 廊道）
const NORTH_FACTOR       = 3.0;   // 向北路段：更慢
const FADE_IN_DUR        = 2.0;   // 波前到达时：C_BASE → C_CLEAR 淡入时长（消除闪现）
const TRANS_DUR          = 4.0;   // 淡入结束后：C_CLEAR → C_JAM 过渡时长
const CYCLE_TIME         = 42;    // 单次动画周期（延长减少重置频率）
const FADE_OUT_DUR       = 6.0;   // 周期末尾淡出时长（避免跳变）
const MAX_SPREAD_RADIUS  = 180;   // 蔓延最大半径（世界单位 ≈1.8km）
const AXIS_THRESH        = 12;    // 方向判别阈值（世界单位）

// 颜色节点（拥堵蔓延：绿→黄→红）
const C_OUTSIDE = new THREE.Color(0x2a1800); // 超范围路段：暗棕黄（仅作背景）
const C_CLEAR   = new THREE.Color(0x00cc44); // 畅通绿
const C_SLOW    = new THREE.Color(0xffcc00); // 缓行黄
const C_JAM     = new THREE.Color(0xff1800); // 拥堵红
const C_BASE    = new THREE.Color(0x001508); // 范围内未到达：极暗绿
const C_SLACK   = new THREE.Color(0x44ccaa); // 下游余量弱蓝绿

// 流量溯源：暗青 → 翠绿 → 亮绿（终态绝不用红，避免误读拥堵）
const C_FLOW_BASE  = new THREE.Color(0x001a12);
const C_FLOW_START = new THREE.Color(0x1a8f5a);
const C_FLOW_MID   = new THREE.Color(0x22c97a);
const C_FLOW_PEAK  = new THREE.Color(0x3dff9a);
const C_FLOW_OUT   = new THREE.Color(0x0a1a14);

/** 拥堵程度 t ∈ [0,1] → 颜色 */
function congestionColor(t) {
  if (t <= 0) return C_CLEAR.clone();
  if (t >= 1) return C_JAM.clone();
  if (t < 0.45) return C_CLEAR.clone().lerp(C_SLOW, t / 0.45);
  return C_SLOW.clone().lerp(C_JAM, (t - 0.45) / 0.55);
}

/** 流量溯源程度 t ∈ [0,1] → 绿色系 */
function flowTraceColor(t) {
  if (t <= 0) return C_FLOW_START.clone();
  if (t >= 1) return C_FLOW_PEAK.clone();
  if (t < 0.5) return C_FLOW_START.clone().lerp(C_FLOW_MID, t / 0.5);
  return C_FLOW_MID.clone().lerp(C_FLOW_PEAK, (t - 0.5) / 0.5);
}

function directionFactor(srcPos, dstPos, biasAxis, factors) {
  if (biasAxis === 'north_south') {
    // pos[1] = 北向；dy < 0 → 向南（更快）
    const dy = dstPos[1] - srcPos[1];
    if (dy < -AXIS_THRESH) return factors.south;
    if (dy > AXIS_THRESH) return factors.north;
    return 1.0;
  }
  const rx = dstPos[0] - srcPos[0];
  if (rx > AXIS_THRESH) return factors.east;
  if (rx < -AXIS_THRESH) return factors.west;
  return 1.0;
}

// ── Dijkstra + 方向偏置 + 半径约束 ────────────────────────────────────────────

/**
 * 计算从起点出发每个路口的"波前到达时间"
 * @param {Array}  intersections
 * @param {Object} topology       { adjIn, adjOut }
 * @param {string} originId
 * @param {number[]} originPos
 * @param {{ biasAxis?: string, factors?: object }} [opts]
 * @returns {Map<string, number>}
 */
export function computeWaveTimes(intersections, topology, originId, originPos, opts = {}) {
  const biasAxis = opts.biasAxis || 'east_west';
  const maxRadius = opts.maxSpreadRadius ?? MAX_SPREAD_RADIUS;
  const factors = {
    east: opts.eastFactor ?? EAST_FACTOR,
    west: opts.westFactor ?? WEST_FACTOR,
    south: opts.southFactor ?? SOUTH_FACTOR,
    north: opts.northFactor ?? NORTH_FACTOR,
  };

  const posMap = new Map();
  for (const inter of intersections) posMap.set(inter.props.inter_id, inter.pos);

  const [ox, oy] = originPos;

  const waveTime = new Map([[originId, 0]]);
  const pq = [[0, originId]];

  while (pq.length > 0) {
    pq.sort((a, b) => a[0] - b[0]);
    const [t, id] = pq.shift();
    if (t > (waveTime.get(id) ?? Infinity) + 1e-6) continue;

    const srcPos = posMap.get(id);
    if (!srcPos) continue;

    const edges = [
      ...(topology.adjOut.get(id) || []).map(e => ({ road: e.road, nid: e.toId })),
      ...(topology.adjIn.get(id)  || []).map(e => ({ road: e.road, nid: e.fromId })),
    ];

    for (const { road, nid } of edges) {
      if (!nid) continue;
      const dstPos = posMap.get(nid);
      if (!dstPos) continue;

      const ddx = dstPos[0] - ox;
      const ddy = dstPos[1] - oy;
      if (Math.sqrt(ddx * ddx + ddy * ddy) > maxRadius) continue;

      const coords = road.coords;
      let len = 0;
      for (let i = 0; i < coords.length - 1; i++) {
        const adx = coords[i + 1][0] - coords[i][0];
        const ady = coords[i + 1][1] - coords[i][1];
        len += Math.sqrt(adx * adx + ady * ady);
      }
      if (len < 0.01) continue;

      const factor = directionFactor(srcPos, dstPos, biasAxis, factors);
      const speed = opts.waveSpeed ?? WAVE_SPEED;
      const newT = t + (len / speed) * factor;

      if (newT < (waveTime.get(nid) ?? Infinity)) {
        waveTime.set(nid, newT);
        pq.push([newT, nid]);
      }
    }
  }

  return waveTime;
}

// ── 路段动态颜色网格 ─────────────────────────────────────────────────────────

/**
 * @param {Array} roads
 * @param {Map} waveTimeMap
 * @param {number[]} originPos
 * @param {THREE.Vector2} resolution
 * @param {{
 *   slackInterIds?: string[],
 *   slackMaxCongestion?: number,
 *   holdPeak?: boolean,
 *   palette?: 'congestion'|'flow_trace',
 * }} [opts]
 */
export function buildCongestionRoads(roads, waveTimeMap, originPos, resolution, opts = {}) {
  const [ox, oy] = originPos;
  const slackSet = new Set(opts.slackInterIds || []);
  const slackMax = opts.slackMaxCongestion ?? 0.18;
  const holdPeak = !!opts.holdPeak;
  const fadeInDur = opts.fadeInDur ?? FADE_IN_DUR;
  const transDur = opts.transDur ?? TRANS_DUR;
  const lineWidth = opts.linewidth ?? 4;
  const maxRadius = opts.maxSpreadRadius ?? MAX_SPREAD_RADIUS;
  const isFlowTrace = opts.palette === 'flow_trace';
  const cOutside = isFlowTrace ? C_FLOW_OUT : C_OUTSIDE;
  const cBase = isFlowTrace ? C_FLOW_BASE : C_BASE;
  const cClear = isFlowTrace ? C_FLOW_START : C_CLEAR;
  const colorAt = isFlowTrace ? flowTraceColor : congestionColor;

  const posArr  = [];
  const colArr  = [];
  const segMeta = [];
  let   totalEdges = 0;

  for (const road of roads) {
    const fromId = road.props.from_inter_id;
    const toId   = road.props.to_inter_id;
    const fromT  = waveTimeMap.get(fromId);
    const toT    = waveTimeMap.get(toId);
    const coords = road.coords;
    if (coords.length < 2) continue;

    const mid = coords[Math.floor(coords.length / 2)];
    const isOutside = Math.hypot(mid[0] - ox, mid[1] - oy) > maxRadius;
    const isSlack = slackSet.has(fromId) || slackSet.has(toId);
    const ic = isOutside ? cOutside : cBase;

    const startEdge = totalEdges;
    for (let i = 0; i < coords.length - 1; i++) {
      const [x0, y0] = coords[i];
      const [x1, y1] = coords[i + 1];
      posArr.push(x0, 0.3, -y0,  x1, 0.3, -y1);
      colArr.push(ic.r, ic.g, ic.b,  ic.r, ic.g, ic.b);
      totalEdges++;
    }
    segMeta.push({
      startEdge,
      count: coords.length,
      fromT: fromT ?? Infinity,
      toT: toT ?? Infinity,
      isOutside,
      isSlack,
    });
  }

  const geo = new LineSegmentsGeometry();
  geo.setPositions(posArr);
  geo.setColors(colArr);

  const colorIBuf = geo.attributes.instanceColorStart.data;
  const colors    = colorIBuf.array;

  const mat = new LineMaterial({
    linewidth:    lineWidth,
    vertexColors: true,
    transparent:  true,
    opacity:      1.0,
    blending:     THREE.AdditiveBlending,
    depthWrite:   false,
    depthTest:    false,
    resolution:   resolution ?? new THREE.Vector2(1920, 1080),
  });

  const mesh = new LineSegments2(geo, mat);
  mesh.renderOrder = 10;
  mesh.userData.lineMat = mat;

  const calcColor = (frac, fromT, toT, cycleTime, isSlack) => {
    let vertWave;
    if (Number.isFinite(fromT) && Number.isFinite(toT)) {
      vertWave = fromT + (toT - fromT) * frac;
    } else if (Number.isFinite(fromT)) {
      vertWave = fromT;
    } else if (Number.isFinite(toT)) {
      vertWave = toT;
    } else {
      return cBase;
    }
    const elapsed = cycleTime - vertWave;
    if (elapsed < 0) return cBase;
    if (elapsed < fadeInDur) {
      const base = cBase.clone().lerp(isSlack ? C_SLACK : cClear, elapsed / fadeInDur);
      return base;
    }
    const raw = Math.max(0, Math.min(1, (elapsed - fadeInDur) / transDur));
    if (isSlack) {
      // 下游余量：钳制为弱蓝绿，绝不转红
      const t = Math.min(raw, slackMax);
      return C_SLACK.clone().lerp(cClear, 1 - t);
    }
    return colorAt(raw);
  };

  mesh.updateColors = (cycleTime) => {
    const peakCap = CYCLE_TIME - FADE_OUT_DUR;
    const effective = holdPeak ? Math.min(cycleTime, peakCap) : cycleTime;
    const fadeOut = (!holdPeak && effective >= peakCap)
      ? Math.max(0, (CYCLE_TIME - effective) / FADE_OUT_DUR)
      : 1.0;

    for (const { startEdge, count, fromT, toT, isOutside, isSlack } of segMeta) {
      if (isOutside) continue;
      for (let i = 0; i < count - 1; i++) {
        const frac0 = count > 1 ? i       / (count - 1) : 0;
        const frac1 = count > 1 ? (i + 1) / (count - 1) : 0;
        const c0 = calcColor(frac0, fromT, toT, effective, isSlack);
        const c1 = calcColor(frac1, fromT, toT, effective, isSlack);
        const base = (startEdge + i) * 6;
        colors[base]   = c0.r * fadeOut; colors[base+1] = c0.g * fadeOut; colors[base+2] = c0.b * fadeOut;
        colors[base+3] = c1.r * fadeOut; colors[base+4] = c1.g * fadeOut; colors[base+5] = c1.b * fadeOut;
      }
    }
    colorIBuf.needsUpdate = true;
  };

  mesh.setResolution = (w, h) => mat.resolution.set(w, h);
  return mesh;
}

// ── 波纹扩散环 ───────────────────────────────────────────────────────────────

export function buildRippleRings(intersections, waveTimeMap, originPos, opts = {}) {
  const [ox, oy] = originPos;
  const slackSet = new Set(opts.slackInterIds || []);
  const allowed = opts.allowedInterIds
    ? new Set(opts.allowedInterIds)
    : null;
  const maxRadius = opts.maxSpreadRadius ?? MAX_SPREAD_RADIUS;
  const isFlowTrace = opts.palette === 'flow_trace';
  const group = new THREE.Group();

  const congested = intersections.filter(i => {
    const id = i.props.inter_id;
    if (allowed && !allowed.has(id)) return false;
    const t = waveTimeMap.get(id);
    if (!Number.isFinite(t) || t >= CYCLE_TIME - TRANS_DUR) return false;
    const dx = i.pos[0] - ox;
    const dy = i.pos[1] - oy;
    return Math.sqrt(dx * dx + dy * dy) <= maxRadius;
  });
  if (congested.length === 0) return group;

  const RINGS_PER = 3;
  const RING_PTS  = 48;
  const MAX_R     = 9;
  const PERIOD    = 1.9;

  const totalRings = congested.length * RINGS_PER;
  const ringPos    = new Float32Array(totalRings * RING_PTS * 3);
  const ringCol    = new Float32Array(totalRings * RING_PTS * 3);

  const geo = new THREE.BufferGeometry();
  const ringPosAttr = new THREE.BufferAttribute(ringPos, 3);
  const ringColAttr = new THREE.BufferAttribute(ringCol, 3);
  geo.setAttribute('position', ringPosAttr);
  geo.setAttribute('color',    ringColAttr);

  const idxArr = [];
  for (let r = 0; r < totalRings; r++) {
    const base = r * RING_PTS;
    for (let j = 0; j < RING_PTS; j++) idxArr.push(base + j, base + (j + 1) % RING_PTS);
  }
  geo.setIndex(idxArr);

  const mat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });

  const lines = new THREE.LineSegments(geo, mat);
  lines.renderOrder = 30;
  group.add(lines);

  group.updateRipples = (cycleTime) => {
    for (let ci = 0; ci < congested.length; ci++) {
      const inter = congested[ci];
      const [ix, iy] = inter.pos;
      const wt = waveTimeMap.get(inter.props.inter_id) ?? 0;
      const isSlack = slackSet.has(inter.props.inter_id);

      for (let k = 0; k < RINGS_PER; k++) {
        const ri = ci * RINGS_PER + k;

        if (cycleTime < wt) {
          for (let j = 0; j < RING_PTS; j++) {
            const idx = (ri * RING_PTS + j) * 3;
            ringPos[idx] = ix; ringPos[idx + 1] = 0.5; ringPos[idx + 2] = -iy;
            ringCol[idx] = 0;  ringCol[idx + 1] = 0;   ringCol[idx + 2] = 0;
          }
          continue;
        }

        const phase  = ((cycleTime - wt) / PERIOD + k / RINGS_PER) % 1;
        const radius = phase * MAX_R;
        const fade   = 1 - Math.pow(phase, 0.65);

        for (let j = 0; j < RING_PTS; j++) {
          const angle = (j / RING_PTS) * Math.PI * 2;
          const idx   = (ri * RING_PTS + j) * 3;
          ringPos[idx]     = ix + Math.cos(angle) * radius;
          ringPos[idx + 1] = 0.5;
          ringPos[idx + 2] = -iy + Math.sin(angle) * radius;
          if (isSlack || isFlowTrace) {
            // 余量 / 流量溯源：青绿波纹，禁止红色恐吓
            ringCol[idx]     = fade * 0.12;
            ringCol[idx + 1] = fade * 0.95;
            ringCol[idx + 2] = fade * 0.55;
          } else {
            ringCol[idx]     = fade;
            ringCol[idx + 1] = fade * 0.1;
            ringCol[idx + 2] = 0;
          }
        }
      }
    }
    ringPosAttr.needsUpdate = true;
    ringColAttr.needsUpdate = true;
  };

  return group;
}

// ── 起点路口高亮标记 ─────────────────────────────────────────────────────────

function buildOriginMarker(inter, opts = {}) {
  const [ix, iy] = inter.pos;
  const group    = new THREE.Group();
  group.position.set(ix, 0, -iy);
  const beamColor = opts.palette === 'flow_trace' ? 0x22ee88 : 0xff2200;

  const dotGeo = new THREE.CircleGeometry(2.5, 32);
  const dotMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 1.0,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: false,
  });
  const dot = new THREE.Mesh(dotGeo, dotMat);
  dot.rotation.x = -Math.PI / 2;
  dot.position.y  = 0.6;
  dot.renderOrder = 50;
  group.add(dot);

  const beamGeo = new THREE.CylinderGeometry(0.08, 2.5, 28, 8, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color: beamColor, transparent: true, opacity: 0.22,
    side: THREE.BackSide, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: false,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.y  = 14;
  beam.renderOrder = 50;
  group.add(beam);

  group.update = (time) => {
    const p = 0.5 + 0.5 * Math.sin(time * 4.5);
    dotMat.opacity  = 0.8 + 0.2 * p;
    beamMat.opacity = 0.12 + 0.14 * p;
  };

  return group;
}

// ── 主入口 ───────────────────────────────────────────────────────────────────

/**
 * @param {Array} roads
 * @param {Array} intersections
 * @param {Object} topology
 * @param {string} originId
 * @param {THREE.Vector2} resolution
 * @param {{
 *   biasAxis?: 'east_west'|'north_south',
 *   slackInterIds?: string[],
 *   slackMaxCongestion?: number,
 *   holdPeak?: boolean,
 *   eastFactor?: number,
 *   westFactor?: number,
 *   southFactor?: number,
 *   northFactor?: number,
 *   waveSpeed?: number,
 *   fadeInDur?: number,
 *   transDur?: number,
 *   timeScale?: number,
 *   linewidth?: number,
 *   allowedInterIds?: string[],
 *   maxSpreadRadius?: number,
 *   seedWaveTimes?: Map<string, number> | Record<string, number>,
 *   palette?: 'congestion'|'flow_trace',
 * }} [options]
 */
export function createCongestionLayer(roads, intersections, topology, originId, resolution, options = {}) {
  const originInter = intersections.find(i => i.props.inter_id === originId);
  if (!originInter) {
    console.warn('[CongestionLayer] 未找到起点路口:', originId);
    return new THREE.Group();
  }
  const originPos = originInter.pos;
  const maxSpreadRadius = options.maxSpreadRadius ?? MAX_SPREAD_RADIUS;

  const waveOpts = {
    biasAxis: options.biasAxis || 'east_west',
    eastFactor: options.eastFactor,
    westFactor: options.westFactor,
    southFactor: options.southFactor,
    northFactor: options.northFactor,
    waveSpeed: options.waveSpeed,
    maxSpreadRadius,
  };
  const visualOpts = {
    slackInterIds: options.slackInterIds || [],
    slackMaxCongestion: options.slackMaxCongestion,
    holdPeak: options.holdPeak ?? false,
    fadeInDur: options.fadeInDur,
    transDur: options.transDur,
    linewidth: options.linewidth,
    allowedInterIds: options.allowedInterIds || null,
    maxSpreadRadius,
    palette: options.palette || 'congestion',
  };

  const waveTimeMap = computeWaveTimes(
    intersections, topology, originId, originPos, waveOpts,
  );

  // 补种已知 hop 波前：仅填充 Dijkstra 未到达的节点，不覆盖更优几何时间
  const seeds = options.seedWaveTimes;
  if (seeds) {
    const entries = seeds instanceof Map ? seeds.entries() : Object.entries(seeds);
    for (const [id, t] of entries) {
      if (!id || !Number.isFinite(t)) continue;
      if (!waveTimeMap.has(id)) waveTimeMap.set(id, t);
    }
  }

  const roadMesh = buildCongestionRoads(roads, waveTimeMap, originPos, resolution, visualOpts);
  const ripples  = buildRippleRings(intersections, waveTimeMap, originPos, visualOpts);
  const marker   = buildOriginMarker(originInter, visualOpts);

  const group = new THREE.Group();
  group.name  = 'congestionLayer';
  group.add(roadMesh);
  group.add(ripples);
  group.add(marker);

  let startTime = null;
  const holdPeak = visualOpts.holdPeak;
  const peakCap = CYCLE_TIME - FADE_OUT_DUR;
  const timeScale = options.timeScale ?? 1;

  group.update = (time) => {
    if (startTime === null) startTime = time;
    const raw = (time - startTime) * timeScale;
    const cycleTime = holdPeak
      ? Math.min(raw, peakCap)
      : Math.min(raw, CYCLE_TIME);
    roadMesh.updateColors(cycleTime);
    ripples.updateRipples(cycleTime);
    marker.update(time);
  };

  group.dispose = () => {
    group.traverse(obj => {
      obj.geometry?.dispose();
      obj.material?.dispose();
    });
  };

  group.originPos     = originPos;
  group.cycleTime     = CYCLE_TIME;
  group.fadeOutDur    = FADE_OUT_DUR;
  group.peakCap       = peakCap;
  group.timeScale     = timeScale;
  group.getCycleTime  = (t) => {
    if (startTime === null) return 0;
    const raw = (t - startTime) * timeScale;
    return holdPeak ? Math.min(raw, peakCap) : Math.min(raw, CYCLE_TIME);
  };
  group.setResolution = (w, h) => roadMesh.setResolution?.(w, h);

  return group;
}

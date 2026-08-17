/**
 * 流量溯源汇入层 — baseline 拥堵蔓延的反向
 *
 * 视觉：绿→黄波前，maxT - dist 让远端先亮、收束到汇点。
 * 终态：问题路段（解放东→经十北向南）与解放东×奥体西西进口为红，其余溯源为黄。
 * 路径：坤顺北/东/西 → 解放东北/东/西 → 经十路–奥体西北进口。
 */
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { incomingApproachDir } from '../geo/tracing.js';

export const WAVE_SPEED = 22;
export const FADE_IN_DUR = 0.4;
export const TRANS_DUR = 0.8;
const DEFAULT_APPROACHES = ['N', 'E', 'W'];
/** 走廊视野边距（投影单位，1 单位 ≈ 10 m） */
export const VIEW_PAD = 28;

const C_CLEAR = new THREE.Color(0x00cc44);
const C_SLOW = new THREE.Color(0xffcc00);
const C_JAM = new THREE.Color(0xff1800);
const C_BASE = new THREE.Color(0x001508);

function congestionColor(t, finalJam = false) {
  if (t <= 0) return C_CLEAR.clone();
  if (!finalJam) {
    if (t >= 1) return C_SLOW.clone();
    return C_CLEAR.clone().lerp(C_SLOW, t);
  }
  if (t >= 1) return C_JAM.clone();
  if (t < 0.45) return C_CLEAR.clone().lerp(C_SLOW, t / 0.45);
  return C_SLOW.clone().lerp(C_JAM, (t - 0.45) / 0.55);
}

/** 问题路段 + 解放东×奥体西西进口：终态红色 */
function isJamTraceRoad(road, { originId, viaIds } = {}) {
  const from = road?.props?.from_inter_id;
  const to = road?.props?.to_inter_id;
  const viaSet = viaIds instanceof Set ? viaIds : new Set(viaIds || []);
  if (originId && viaSet.has(from) && to === originId) return true;
  if (viaSet.has(to) && incomingApproachDir(road) === 'W') return true;
  return false;
}

export function roadLen(coords) {
  let len = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const dx = coords[i + 1][0] - coords[i][0];
    const dy = coords[i + 1][1] - coords[i][1];
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

export function roadKey(road) {
  return `${road.props.from_inter_id}→${road.props.to_inter_id}`;
}

/**
 * 从汇点沿 adjIn 向上游。
 * 汇点只走 targetApproaches（经十北进口）；
 * 源口 / 中继口走 hopApproaches（坤顺、解放东北东西进口）。
 */
export function computeInflowTimes(
  _intersections,
  topology,
  originId,
  {
    sourceId,
    viaIds = [],
    hopApproaches = DEFAULT_APPROACHES,
    targetApproaches = ['N'],
  } = {},
) {
  const hopAllowed = new Set(hopApproaches);
  const sinkAllowed = new Set(targetApproaches);
  const expandIds = new Set([originId, sourceId, ...viaIds].filter(Boolean));
  const distTime = new Map([[originId, 0]]);
  const tracedRoadKeys = new Set();
  const pq = [[0, originId]];

  while (pq.length > 0) {
    pq.sort((a, b) => a[0] - b[0]);
    const [t, id] = pq.shift();
    if (t > (distTime.get(id) ?? Infinity) + 1e-6) continue;
    if (!expandIds.has(id)) continue;

    const allowed = id === originId ? sinkAllowed : hopAllowed;
    const incoming = topology.adjIn.get(id) || [];
    for (const { road, fromId: nid } of incoming) {
      if (!nid) continue;
      const dir = incomingApproachDir(road);
      if (!dir || !allowed.has(dir)) continue;

      const len = roadLen(road.coords);
      if (len < 0.01) continue;

      tracedRoadKeys.add(roadKey(road));
      const newT = t + len / WAVE_SPEED;
      if (newT < (distTime.get(nid) ?? Infinity)) {
        distTime.set(nid, newT);
        pq.push([newT, nid]);
      }
    }
  }

  return { distTime, tracedRoadKeys };
}

export function boundsFromIds(intersections, ids, pad = VIEW_PAD) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const inter of intersections) {
    if (!ids.has(inter.props.inter_id)) continue;
    const [x, y] = inter.pos;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) {
    return { minX: -pad, maxX: pad, minY: -pad, maxY: pad };
  }
  return {
    minX: minX - pad,
    maxX: maxX + pad,
    minY: minY - pad,
    maxY: maxY + pad,
  };
}

function inBounds(xy, bounds) {
  return (
    xy[0] >= bounds.minX &&
    xy[0] <= bounds.maxX &&
    xy[1] >= bounds.minY &&
    xy[1] <= bounds.maxY
  );
}

function toRevealMap(distTime) {
  let maxT = 0;
  for (const t of distTime.values()) {
    if (Number.isFinite(t) && t > maxT) maxT = t;
  }
  const reveal = new Map();
  for (const [id, t] of distTime) {
    reveal.set(id, maxT - t);
  }
  return { reveal, maxT };
}

export function buildInflowRoads(roads, revealMap, tracedRoadKeys, viewBounds, resolution, jamOpts) {
  const posArr = [];
  const colArr = [];
  const segMeta = [];
  let totalEdges = 0;

  for (const road of roads) {
    const coords = road.coords;
    if (coords.length < 2) continue;

    const mid = coords[Math.floor(coords.length / 2)];
    if (!inBounds(mid, viewBounds)) continue;

    const traced = tracedRoadKeys.has(roadKey(road));
    const fromT = traced ? revealMap.get(road.props.from_inter_id) : Infinity;
    const toT = traced ? revealMap.get(road.props.to_inter_id) : Infinity;
    const finalJam = traced && isJamTraceRoad(road, jamOpts);
    const ic = C_BASE;

    const startEdge = totalEdges;
    for (let i = 0; i < coords.length - 1; i++) {
      const [x0, y0] = coords[i];
      const [x1, y1] = coords[i + 1];
      posArr.push(x0, 0.3, -y0, x1, 0.3, -y1);
      colArr.push(ic.r, ic.g, ic.b, ic.r, ic.g, ic.b);
      totalEdges++;
    }
    segMeta.push({
      startEdge,
      count: coords.length,
      fromT: fromT ?? Infinity,
      toT: toT ?? Infinity,
      isOutside: !traced,
      finalJam,
    });
  }

  if (posArr.length < 6) {
    const mesh = new THREE.Group();
    mesh.updateColors = () => {};
    mesh.setResolution = () => {};
    return mesh;
  }

  const geo = new LineSegmentsGeometry();
  geo.setPositions(posArr);
  geo.setColors(colArr);

  const colorIBuf = geo.attributes.instanceColorStart.data;
  const colors = colorIBuf.array;

  const mat = new LineMaterial({
    linewidth: 4,
    vertexColors: true,
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    resolution: resolution ?? new THREE.Vector2(1920, 1080),
  });

  const mesh = new LineSegments2(geo, mat);
  mesh.renderOrder = 10;

  const yellowOnly = jamOpts?.palette === 'yellow';
  const waveColor = yellowOnly ? C_SLOW : C_CLEAR;

  const calcColor = (frac, fromT, toT, cycleTime, finalJam) => {
    let vertWave;
    if (Number.isFinite(fromT) && Number.isFinite(toT)) {
      vertWave = fromT + (toT - fromT) * frac;
    } else if (Number.isFinite(fromT)) {
      vertWave = fromT;
    } else if (Number.isFinite(toT)) {
      vertWave = toT;
    } else {
      return C_BASE;
    }
    const elapsed = cycleTime - vertWave;
    if (elapsed < 0) return C_BASE;
    if (elapsed < FADE_IN_DUR) {
      return C_BASE.clone().lerp(waveColor, elapsed / FADE_IN_DUR);
    }
    if (yellowOnly) return C_SLOW.clone();
    return congestionColor(
      Math.max(0, Math.min(1, (elapsed - FADE_IN_DUR) / TRANS_DUR)),
      finalJam,
    );
  };

  mesh.updateColors = (cycleTime) => {
    for (const { startEdge, count, fromT, toT, isOutside, finalJam } of segMeta) {
      if (isOutside) continue;
      for (let i = 0; i < count - 1; i++) {
        const frac0 = count > 1 ? i / (count - 1) : 0;
        const frac1 = count > 1 ? (i + 1) / (count - 1) : 0;
        const c0 = calcColor(frac0, fromT, toT, cycleTime, finalJam);
        const c1 = calcColor(frac1, fromT, toT, cycleTime, finalJam);
        const base = (startEdge + i) * 6;
        colors[base] = c0.r;
        colors[base + 1] = c0.g;
        colors[base + 2] = c0.b;
        colors[base + 3] = c1.r;
        colors[base + 4] = c1.g;
        colors[base + 5] = c1.b;
      }
    }
    colorIBuf.needsUpdate = true;
  };

  mesh.setResolution = (w, h) => mat.resolution.set(w, h);
  return mesh;
}

export function buildRippleRings(intersections, revealMap, viewBounds) {
  const group = new THREE.Group();

  const congested = intersections.filter((i) => {
    const t = revealMap.get(i.props.inter_id);
    if (!Number.isFinite(t)) return false;
    return inBounds(i.pos, viewBounds);
  });
  if (congested.length === 0) return group;

  const RINGS_PER = 3;
  const RING_PTS = 48;
  const MAX_R = 9;
  const PERIOD = 1.9;
  const totalRings = congested.length * RINGS_PER;
  const ringPos = new Float32Array(totalRings * RING_PTS * 3);
  const ringCol = new Float32Array(totalRings * RING_PTS * 3);

  const geo = new THREE.BufferGeometry();
  const ringPosAttr = new THREE.BufferAttribute(ringPos, 3);
  const ringColAttr = new THREE.BufferAttribute(ringCol, 3);
  geo.setAttribute('position', ringPosAttr);
  geo.setAttribute('color', ringColAttr);

  const idxArr = [];
  for (let r = 0; r < totalRings; r++) {
    const base = r * RING_PTS;
    for (let j = 0; j < RING_PTS; j++) idxArr.push(base + j, base + ((j + 1) % RING_PTS));
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
      const wt = revealMap.get(inter.props.inter_id) ?? 0;

      for (let k = 0; k < RINGS_PER; k++) {
        const ri = ci * RINGS_PER + k;
        if (cycleTime < wt) {
          for (let j = 0; j < RING_PTS; j++) {
            const idx = (ri * RING_PTS + j) * 3;
            ringPos[idx] = ix;
            ringPos[idx + 1] = 0.5;
            ringPos[idx + 2] = -iy;
            ringCol[idx] = 0;
            ringCol[idx + 1] = 0;
            ringCol[idx + 2] = 0;
          }
          continue;
        }

        const phase = ((cycleTime - wt) / PERIOD + k / RINGS_PER) % 1;
        const radius = phase * MAX_R;
        const fade = 1 - Math.pow(phase, 0.65);

        for (let j = 0; j < RING_PTS; j++) {
          const angle = (j / RING_PTS) * Math.PI * 2;
          const idx = (ri * RING_PTS + j) * 3;
          ringPos[idx] = ix + Math.cos(angle) * radius;
          ringPos[idx + 1] = 0.5;
          ringPos[idx + 2] = -iy + Math.sin(angle) * radius;
          ringCol[idx] = fade;
          ringCol[idx + 1] = fade * 0.1;
          ringCol[idx + 2] = 0;
        }
      }
    }
    ringPosAttr.needsUpdate = true;
    ringColAttr.needsUpdate = true;
  };

  return group;
}

function makeArrowGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0.95, 0);
  shape.lineTo(-0.4, 0.32);
  shape.lineTo(-0.4, -0.32);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function pathLen(pts) {
  let len = 0;
  for (let i = 0; i < pts.length - 1; i += 1) {
    len += pts[i].distanceTo(pts[i + 1]);
  }
  return len;
}

function samplePath(pts, t) {
  const total = pathLen(pts);
  if (total <= 1e-6) {
    const p = pts[0] || new THREE.Vector3();
    return { pos: p.clone(), dir: new THREE.Vector3(0, 0, 1) };
  }
  const d = Math.max(0, Math.min(1, t)) * total;
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    const seg = a.distanceTo(b);
    if (acc + seg >= d - 1e-6) {
      const lt = seg > 0 ? (d - acc) / seg : 0;
      return { pos: a.clone().lerp(b, lt), dir: b.clone().sub(a).normalize() };
    }
    acc += seg;
  }
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2] || last;
  return { pos: last.clone(), dir: last.clone().sub(prev).normalize() };
}

/** 沿 from→to 汇入下游路口；三角躺在 XZ，尖端对齐行进方向 */
export function buildFlowArrows(roads, revealMap, tracedRoadKeys, viewBounds, jamOpts) {
  const group = new THREE.Group();
  const arrowGeo = makeArrowGeometry();
  const items = [];

  for (const road of roads) {
    if (!tracedRoadKeys.has(roadKey(road))) continue;
    const coords = road.coords;
    if (!coords || coords.length < 2) continue;
    const mid = coords[Math.floor(coords.length / 2)];
    if (!inBounds(mid, viewBounds)) continue;

    const pts = coords.map(([x, y]) => new THREE.Vector3(x, 1.15, -y));
    const len = pathLen(pts);
    if (len < 3) continue;

    const fromT = revealMap.get(road.props.from_inter_id) ?? 0;
    const count = Math.max(2, Math.min(4, Math.round(len / 14)));
    const arrowColor = isJamTraceRoad(road, jamOpts) ? 0xff1800 : 0xffcc00;

    for (let i = 0; i < count; i += 1) {
      const mesh = new THREE.Mesh(
        arrowGeo,
        new THREE.MeshBasicMaterial({
          color: arrowColor,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          depthTest: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        }),
      );
      mesh.scale.setScalar(1.15);
      mesh.renderOrder = 56;
      mesh.visible = false;
      group.add(mesh);
      items.push({
        mesh,
        pts,
        offset: i / count,
        speed: 0.16,
        revealAt: fromT,
      });
    }
  }

  group.updateArrows = (elapsed) => {
    for (const ar of items) {
      const fade = (elapsed - ar.revealAt) / 0.35;
      const a = fade <= 0 ? 0 : fade >= 1 ? 1 : fade;
      if (a <= 0) {
        ar.mesh.visible = false;
        continue;
      }
      ar.mesh.visible = true;
      ar.mesh.material.opacity = a * 0.95;
      const t = (ar.offset + elapsed * ar.speed) % 1;
      const { pos, dir } = samplePath(ar.pts, t);
      ar.mesh.position.copy(pos);
      ar.mesh.position.y = 1.4;
      // 几何尖端朝 +X；Ry 转到 (dir.x, dir.z)
      ar.mesh.rotation.set(0, Math.atan2(-dir.z, dir.x), 0);
    }
  };

  group.arrowGeo = arrowGeo;
  return group;
}

export function buildSinkMarker(inter, { beamColor = 0x22c55e } = {}) {
  const [ix, iy] = inter.pos;
  const group = new THREE.Group();
  group.position.set(ix, 0, -iy);

  const dotGeo = new THREE.CircleGeometry(2.5, 32);
  const dotMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1.0,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const dot = new THREE.Mesh(dotGeo, dotMat);
  dot.rotation.x = -Math.PI / 2;
  dot.position.y = 0.6;
  dot.renderOrder = 50;
  group.add(dot);

  const beamGeo = new THREE.CylinderGeometry(0.08, 2.5, 28, 8, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color: beamColor,
    transparent: true,
    opacity: 0.22,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.y = 14;
  beam.renderOrder = 50;
  group.add(beam);

  group.update = (time) => {
    const p = 0.5 + 0.5 * Math.sin(time * 4.5);
    dotMat.opacity = 0.8 + 0.2 * p;
    beamMat.opacity = 0.12 + 0.14 * p;
  };

  return group;
}

/**
 * @param {{
 *   roads: any[],
 *   intersections: any[],
 *   topology: { adjIn: Map, adjOut: Map },
 *   originId: string,
 *   sourceId?: string,
 *   viaIds?: string[],
 *   hopApproaches?: string[],
 *   targetApproaches?: string[],
 *   resolution?: THREE.Vector2,
 * }} opts
 */
export function createInflowTraceLayer({
  roads,
  intersections,
  topology,
  originId,
  sourceId,
  viaIds = [],
  hopApproaches = DEFAULT_APPROACHES,
  targetApproaches = ['N'],
  resolution,
}) {
  const originInter = intersections.find((i) => i.props.inter_id === originId);
  if (!originInter) {
    console.warn('[InflowTraceLayer] 未找到汇点路口:', originId);
    return new THREE.Group();
  }

  const originPos = originInter.pos;
  const { distTime, tracedRoadKeys } = computeInflowTimes(
    intersections,
    topology,
    originId,
    { sourceId, viaIds, hopApproaches, targetApproaches },
  );
  const { reveal, maxT } = toRevealMap(distTime);
  const viewBounds = boundsFromIds(intersections, new Set(distTime.keys()));
  const holdDur = Math.max(4.5, maxT + FADE_IN_DUR + TRANS_DUR);

  const jamOpts = { originId, viaIds };
  const roadMesh = buildInflowRoads(roads, reveal, tracedRoadKeys, viewBounds, resolution, jamOpts);
  const ripples = buildRippleRings(intersections, reveal, viewBounds);
  const arrows = buildFlowArrows(roads, reveal, tracedRoadKeys, viewBounds, jamOpts);
  const marker = buildSinkMarker(originInter);

  const group = new THREE.Group();
  group.name = 'inflowTraceLayer';
  group.add(roadMesh);
  group.add(ripples);
  group.add(arrows);
  group.add(marker);

  let startTime = null;
  let playing = false;
  let doneSignaled = false;
  let resolveDone = null;
  let donePromise = Promise.resolve();

  function play(at = performance.now() / 1000) {
    startTime = at;
    playing = true;
    doneSignaled = false;
    donePromise = new Promise((resolve) => {
      resolveDone = resolve;
    });
  }

  function stop() {
    playing = false;
  }

  group.update = (time) => {
    if (!playing || startTime == null) return;
    const elapsed = time - startTime;
    roadMesh.updateColors(Math.min(elapsed, holdDur));
    ripples.updateRipples?.(elapsed);
    arrows.updateArrows?.(elapsed);
    marker.update?.(time);
    if (!doneSignaled && elapsed >= holdDur) {
      doneSignaled = true;
      resolveDone?.();
    }
  };

  group.dispose = () => {
    stop();
    group.traverse((obj) => {
      obj.geometry?.dispose?.();
      obj.material?.dispose?.();
    });
    arrows.arrowGeo?.dispose?.();
  };

  const cx = (viewBounds.minX + viewBounds.maxX) / 2;
  const cy = (viewBounds.minY + viewBounds.maxY) / 2;
  group.play = play;
  group.stop = stop;
  group.whenFullyRevealed = () => donePromise;
  group.originPos = originPos;
  group.cycleTime = holdDur;
  group.setResolution = (w, h) => roadMesh.setResolution?.(w, h);
  group.getElapsed = (time) => (startTime == null ? 0 : time - startTime);
  group.getProgress = (time) => {
    if (startTime == null) return 0;
    return Math.max(0, Math.min(1, (time - startTime) / holdDur));
  };
  group.revealAt = (id) => reveal.get(id) ?? 0;
  group.worldCenter = new THREE.Vector3(cx, 0, -cy);
  group.bounds = {
    minX: viewBounds.minX,
    maxX: viewBounds.maxX,
    minZ: -viewBounds.maxY,
    maxZ: -viewBounds.minY,
  };

  return group;
}

/**
 * 幕 2 下游约束：只画经十路主路东西向 + 奥体西南北向（不含经十路辅路）。
 * 只取与目标路口直接相连的双向主路，避免拓扑扩展造成近景重复叠画。
 * 经十路东/西进口均按拥堵绘制；西进口数字为 mock（GAP-WEST-SAT）。
 * 奥体西北向南红、南向北黄；经十路南面（奥体西）黄色。
 */
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

const CLIP_R = 88;
const C_EW_JAM = new THREE.Color(0xff1800);
const C_NS_SB = new THREE.Color(0xff1800);
const C_NS_NB = new THREE.Color(0xffcc00);
const C_SOUTH = new THREE.Color(0xffcc00);

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
    return { pos: p.clone(), dir: new THREE.Vector3(1, 0, 0) };
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

function dist2(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

/** 从靠近路口的一端连续截取，避免逐点过滤把路网裁成断线。 */
function clipFromNearEnd(coords, originPos, maxDist = CLIP_R) {
  if (!coords || coords.length < 2 || !originPos) return [];
  const r2 = maxDist * maxDist;
  const startCloser = dist2(coords[0], originPos) <= dist2(coords[coords.length - 1], originPos);
  const seq = startCloser ? coords : coords.slice().reverse();
  const out = [];
  for (const p of seq) {
    if (dist2(p, originPos) > r2) {
      if (out.length) out.push(p);
      break;
    }
    out.push(p);
  }
  if (out.length < 2) return [];
  return startCloser ? out : out.reverse();
}

function isJingshiServiceRoad(names) {
  return String(names || '').includes('经十路辅路');
}

function isNamedMainRoad(names, prefix) {
  const s = String(names || '');
  if (!prefix) return false;
  if (s.includes('辅路')) return false;
  const escaped = String(prefix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|,\\s*)${escaped}:`).test(s);
}

function isJingshiMainRoad(names) {
  const s = String(names || '');
  if (isJingshiServiceRoad(s)) return false;
  return isNamedMainRoad(s, '经十路');
}

function isAotixiMainRoad(names) {
  const s = String(names || '');
  if (s.includes('辅路')) return false;
  return s.includes('奥体西路');
}

function roadTouches(road, interId) {
  return Boolean(interId)
    && (road.props?.from_inter_id === interId || road.props?.to_inter_id === interId);
}

function pickConnectedNamedRoads(roads, originInter, namePred, geomPred, maxDist) {
  const originPos = originInter?.pos;
  const originId = originInter?.props?.inter_id;
  if (!originPos) return [];

  const candidates = (roads || []).filter((road) => namePred(String(road.props?.road_names || '')));
  const picked = [];
  const directRoads = originId
    ? candidates.filter((road) => roadTouches(road, originId))
    : candidates;
  for (const road of directRoads) {
    const clipped = clipFromNearEnd(road.coords, originPos, maxDist);
    if (clipped.length < 2) continue;
    if (geomPred && !geomPred(clipped, road)) continue;
    picked.push({ road, coords: clipped });
  }
  return picked;
}

function midY(coords) {
  const a = coords[0];
  const b = coords[coords.length - 1];
  return (a[1] + b[1]) / 2;
}

function isEastWest(coords) {
  if (!coords || coords.length < 2) return false;
  const a = coords[0];
  const b = coords[coords.length - 1];
  return Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
}

function isEastToWest(coords) {
  const a = coords[0];
  const b = coords[coords.length - 1];
  return b[0] < a[0];
}

function isNorthSouth(coords) {
  if (!coords || coords.length < 2) return false;
  const a = coords[0];
  const b = coords[coords.length - 1];
  return Math.abs(b[1] - a[1]) > Math.abs(b[0] - a[0]);
}

function isSouthbound(coords) {
  const a = coords[0];
  const b = coords[coords.length - 1];
  return b[1] < a[1];
}

/** 仅把北向奥体西靠近路口的一端接到经十路中心纬度，填北侧空档，不穿十字。 */
function extendNorthNsToJingshi(coords, originPos) {
  if (!coords || coords.length < 2 || !originPos) return coords;
  const originY = originPos[1];
  const i = coords[0][1] < coords[coords.length - 1][1] ? 0 : coords.length - 1;
  const end = coords[i];
  if (end[1] <= originY + 0.35) return coords;
  const join = [end[0], originY];
  return i === 0 ? [join, ...coords] : [...coords, join];
}

function pickJingshiEwRoads(roads, originInter, ewPrefix = '经十路') {
  const namePred = ewPrefix === '经十路'
    ? isJingshiMainRoad
    : (names) => isNamedMainRoad(names, ewPrefix);
  return pickConnectedNamedRoads(
    roads,
    originInter,
    namePred,
    (clipped) => isEastWest(clipped),
    CLIP_R,
  ).map((item) => ({
    ...item,
    primary: isEastToWest(item.coords),
  }));
}

function pickAotixiNsRoads(roads, originInter) {
  return pickConnectedNamedRoads(
    roads,
    originInter,
    isAotixiMainRoad,
    (clipped) => isNorthSouth(clipped),
    CLIP_R + 24,
  ).map((item) => ({
    ...item,
    southbound: isSouthbound(item.road.coords),
  }));
}

function classifyNsBand(item, originY) {
  if (midY(item.coords) < originY - 1.5) return 'south';
  return item.southbound ? 'north_sb' : 'north_nb';
}

function buildLineMesh(segments, color, linewidth, resolution, opacity = 0.92) {
  const posArr = [];
  const colArr = [];
  for (const coords of segments) {
    for (let i = 0; i < coords.length - 1; i += 1) {
      const [x0, y0] = coords[i];
      const [x1, y1] = coords[i + 1];
      posArr.push(x0, 0.45, -y0, x1, 0.45, -y1);
      colArr.push(color.r, color.g, color.b, color.r, color.g, color.b);
    }
  }
  if (posArr.length < 6) return null;
  const geo = new LineSegmentsGeometry();
  geo.setPositions(posArr);
  geo.setColors(colArr);
  const mat = new LineMaterial({
    linewidth,
    vertexColors: true,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    resolution: resolution ?? new THREE.Vector2(1920, 1080),
  });
  const mesh = new LineSegments2(geo, mat);
  mesh.renderOrder = 12;
  mesh.userData.lineMat = mat;
  return mesh;
}

function boundsFromSegments(segments, pad = 18) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const coords of segments) {
    for (const [x, y] of coords) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return {
    minX: minX - pad,
    maxX: maxX + pad,
    minY: minY - pad,
    maxY: maxY + pad,
    minZ: -(maxY + pad),
    maxZ: -(minY - pad),
  };
}

/**
 * @param {{
 *   roads: any[],
 *   originInter: { pos: [number, number] },
 *   problemRoad?: { coords: [number, number][] },
 *   resolution?: THREE.Vector2,
 * }} opts
 */
export function createJingshiEwFlowLayer({
  roads,
  originInter,
  problemRoad,
  resolution,
  ewRoadPrefix = '经十路',
  includeEw = true,
  includeNs = true,
} = {}) {
  const group = new THREE.Group();
  group.name = 'jingshiEwFlowLayer';
  const originPos = originInter?.pos;
  if (!originPos) return group;

  const picked = includeEw ? pickJingshiEwRoads(roads, originInter, ewRoadPrefix) : [];
  const nsRoads = includeNs ? pickAotixiNsRoads(roads, originInter) : [];
  if (includeNs && problemRoad?.coords?.length >= 2) {
    const already = nsRoads.some((p) => p.road === problemRoad);
    if (!already) {
      const clipped = clipFromNearEnd(problemRoad.coords, originPos, CLIP_R + 24);
      if (clipped.length >= 2) {
        nsRoads.push({
          road: problemRoad,
          coords: clipped,
          southbound: isSouthbound(problemRoad.coords),
        });
      }
    }
  }

  const originY = originPos[1];
  const northSb = nsRoads
    .filter((p) => classifyNsBand(p, originY) === 'north_sb')
    .map((p) => ({ ...p, coords: extendNorthNsToJingshi(p.coords, originPos) }));
  const northNb = nsRoads
    .filter((p) => classifyNsBand(p, originY) === 'north_nb')
    .map((p) => ({ ...p, coords: extendNorthNsToJingshi(p.coords, originPos) }));
  const southNs = nsRoads.filter((p) => classifyNsBand(p, originY) === 'south');
  const primaryCoords = picked.filter((p) => p.primary).map((p) => p.coords);
  const secondaryCoords = picked.filter((p) => !p.primary).map((p) => p.coords);

  const meshes = [];
  const addMesh = (coords, color, width, opacity) => {
    const mesh = buildLineMesh(coords, color, width, resolution, opacity);
    if (mesh) {
      group.add(mesh);
      meshes.push(mesh);
    }
    return mesh;
  };

  addMesh(primaryCoords, C_EW_JAM, 7.5, 0.78);
  addMesh(secondaryCoords, C_EW_JAM, 7.5, 0.78);
  const northSbMesh = addMesh(
    northSb.map((p) => p.coords),
    C_NS_SB,
    6.2,
    0.78,
  );
  addMesh(
    northNb.map((p) => p.coords),
    C_NS_NB,
    6.2,
    0.78,
  );
  addMesh(
    southNs.map((p) => p.coords),
    C_SOUTH,
    6.2,
    0.78,
  );

  const arrowGeo = makeArrowGeometry();
  const arrowItems = [];

  function addArrows(items, { color, spacing, speed, scale, y }) {
    for (const item of items) {
      const pts = item.coords.map(([x, y0]) => new THREE.Vector3(x, y, -y0));
      const len = pathLen(pts);
      if (len < 4) continue;
      const count = Math.max(4, Math.min(8, Math.round(len / spacing)));
      for (let i = 0; i < count; i += 1) {
        const mesh = new THREE.Mesh(
          arrowGeo,
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            depthTest: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
          }),
        );
        mesh.scale.setScalar(scale);
        mesh.renderOrder = 56;
        group.add(mesh);
        arrowItems.push({
          mesh,
          pts,
          offset: i / count,
          speed,
          y,
        });
      }
    }
  }

  addArrows(picked, { color: 0xff1800, spacing: 8, speed: 0.2, scale: 1.2, y: 1.45 });
  addArrows(northSb, { color: 0xff1800, spacing: 10, speed: 0.16, scale: 1.05, y: 1.35 });
  addArrows(northNb, { color: 0xffcc00, spacing: 10, speed: 0.16, scale: 1.05, y: 1.35 });
  addArrows(southNs, { color: 0xffcc00, spacing: 10, speed: 0.16, scale: 1.05, y: 1.35 });

  let startTime = null;
  let playing = false;

  group.play = (at = performance.now() / 1000) => {
    startTime = at;
    playing = true;
  };

  group.stop = () => {
    playing = false;
  };

  group.update = (time) => {
    if (!playing || startTime == null) return;
    const elapsed = time - startTime;
    const fade = Math.min(1, elapsed / 0.45);
    for (const ar of arrowItems) {
      ar.mesh.material.opacity = fade * 0.95;
      const t = (ar.offset + elapsed * ar.speed) % 1;
      const { pos, dir } = samplePath(ar.pts, t);
      ar.mesh.position.copy(pos);
      ar.mesh.position.y = ar.y ?? 1.45;
      ar.mesh.rotation.set(0, Math.atan2(-dir.z, dir.x), 0);
    }
  };

  group.setOverflowHint = (on) => {
    if (northSbMesh) northSbMesh.userData.lineMat.opacity = on ? 0.92 : 0.78;
  };

  group.setResolution = (w, h) => {
    for (const mesh of meshes) {
      mesh.userData.lineMat?.resolution.set(w, h);
    }
  };

  group.dispose = () => {
    group.stop();
    group.traverse((obj) => {
      obj.geometry?.dispose?.();
      obj.material?.dispose?.();
    });
    arrowGeo.dispose();
  };

  const allSegs = [
    ...primaryCoords,
    ...secondaryCoords,
    ...northSb.map((p) => p.coords),
    ...northNb.map((p) => p.coords),
    ...southNs.map((p) => p.coords),
  ];
  const bounds = boundsFromSegments(allSegs) || {
    minX: originPos[0] - 40,
    maxX: originPos[0] + 40,
    minY: originPos[1] - 20,
    maxY: originPos[1] + 20,
    minZ: -(originPos[1] + 20),
    maxZ: -(originPos[1] - 20),
  };
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  group.bounds = bounds;
  group.worldCenter = new THREE.Vector3(cx, 0, -cy);

  return group;
}

/**
 * 单条有向路段：粗线 + 流动箭头，供幕 1 问题路段北向南标红。
 * @param {{ coords: [number, number][], color?: THREE.Color, resolution?: THREE.Vector2 }} opts
 */
export function createDirectedFlowLayer({
  coords,
  color = C_NS_SB,
  resolution,
} = {}) {
  const group = new THREE.Group();
  group.name = 'directedFlowLayer';
  if (!coords || coords.length < 2) return group;

  const mesh = buildLineMesh([coords], color, 6.4, resolution, 0.86);
  if (mesh) group.add(mesh);

  const arrowGeo = makeArrowGeometry();
  const arrowItems = [];
  const pts = coords.map(([x, y0]) => new THREE.Vector3(x, 1.35, -y0));
  const len = pathLen(pts);
  if (len >= 4) {
    const count = Math.max(5, Math.min(10, Math.round(len / 9)));
    for (let i = 0; i < count; i += 1) {
      const arrow = new THREE.Mesh(
        arrowGeo,
        new THREE.MeshBasicMaterial({
          color: color.getHex(),
          transparent: true,
          opacity: 0,
          depthWrite: false,
          depthTest: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        }),
      );
      arrow.scale.setScalar(1.12);
      arrow.renderOrder = 56;
      group.add(arrow);
      arrowItems.push({ mesh: arrow, pts, offset: i / count, speed: 0.16, y: 1.35 });
    }
  }

  let startTime = null;
  let playing = false;
  group.play = (at = performance.now() / 1000) => {
    startTime = at;
    playing = true;
  };
  group.stop = () => { playing = false; };
  group.update = (time) => {
    if (!playing || startTime == null) return;
    const elapsed = time - startTime;
    const fade = Math.min(1, elapsed / 0.45);
    for (const ar of arrowItems) {
      ar.mesh.material.opacity = fade * 0.95;
      const t = (ar.offset + elapsed * ar.speed) % 1;
      const { pos, dir } = samplePath(ar.pts, t);
      ar.mesh.position.copy(pos);
      ar.mesh.position.y = ar.y;
      ar.mesh.rotation.set(0, Math.atan2(-dir.z, dir.x), 0);
    }
  };
  group.setResolution = (w, h) => {
    mesh?.userData.lineMat?.resolution.set(w, h);
  };
  group.dispose = () => {
    group.stop();
    group.traverse((obj) => {
      obj.geometry?.dispose?.();
      obj.material?.dispose?.();
    });
    arrowGeo.dispose();
  };
  return group;
}

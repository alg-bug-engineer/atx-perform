/**
 * 幕 2 下游约束：只画经十路东西向 + 奥体西南北向。
 * 经十路东/西进口均按拥堵绘制；西进口数字为 mock（GAP-WEST-SAT）。
 * 奥体西北向南红、南向北黄；经十路南面（奥体西）绿色。
 */
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

const CLIP_R = 88;
const C_EW_JAM = new THREE.Color(0xff1800);
const C_NS_SB = new THREE.Color(0xff1800);
const C_NS_NB = new THREE.Color(0xffcc00);
const C_SOUTH = new THREE.Color(0x00cc44);

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

function clipNearAny(coords, origins, maxDist = CLIP_R) {
  const r2 = maxDist * maxDist;
  const pts = origins.filter((p) => p && Number.isFinite(p[0]));
  if (!pts.length) return [];
  return (coords || []).filter(([x, y]) =>
    pts.some(([ox, oy]) => {
      const dx = x - ox;
      const dy = y - oy;
      return dx * dx + dy * dy <= r2;
    }),
  );
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

function pickJingshiEwRoads(roads, originPos) {
  const picked = [];
  for (const road of roads) {
    const names = String(road.props?.road_names || '');
    if (!names.includes('经十路')) continue;
    const clipped = clipNearAny(road.coords, [originPos]);
    if (clipped.length < 2) continue;
    if (!isEastWest(clipped)) continue;
    picked.push({
      road,
      coords: clipped,
      primary: isEastToWest(clipped),
    });
  }
  return picked;
}

function pickAotixiNsRoads(roads, originPos) {
  const picked = [];
  for (const road of roads) {
    const names = String(road.props?.road_names || '');
    if (!names.includes('奥体西')) continue;
    const clipped = clipNearAny(road.coords, [originPos], CLIP_R + 24);
    if (clipped.length < 2) continue;
    if (!isNorthSouth(clipped)) continue;
    picked.push({
      road,
      coords: clipped,
      southbound: isSouthbound(road.coords),
    });
  }
  return picked;
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
}) {
  const group = new THREE.Group();
  group.name = 'jingshiEwFlowLayer';
  const originPos = originInter?.pos;
  if (!originPos) return group;

  const picked = pickJingshiEwRoads(roads, originPos);
  const nsRoads = pickAotixiNsRoads(roads, originPos);
  if (problemRoad?.coords?.length >= 2) {
    const already = nsRoads.some((p) => p.road === problemRoad);
    if (!already) {
      const clipped = clipNearAny(problemRoad.coords, [originPos], CLIP_R + 24);
      if (clipped.length >= 2) {
        nsRoads.push({
          road: problemRoad,
          coords: clipped,
          southbound: isSouthbound(problemRoad.coords),
        });
      }
    }
  }

  const primaryCoords = picked.filter((p) => p.primary).map((p) => p.coords);
  const secondaryCoords = picked.filter((p) => !p.primary).map((p) => p.coords);
  const originY = originPos[1];
  const northSb = nsRoads.filter((p) => classifyNsBand(p, originY) === 'north_sb');
  const northNb = nsRoads.filter((p) => classifyNsBand(p, originY) === 'north_nb');
  const southNs = nsRoads.filter((p) => classifyNsBand(p, originY) === 'south');

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
  addArrows(southNs, { color: 0x00cc44, spacing: 10, speed: 0.16, scale: 1.05, y: 1.35 });

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

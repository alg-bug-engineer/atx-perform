/**
 * 聚焦图层：选中路口后渲染的所有可视化元素
 *
 * 视觉原则：
 *  - 橘黄色系：亮橙（近路口） → 暗锈红（远边界）
 *  - 宽度：逐顶点计算，距路口越近越宽，由细到粗体现汇聚
 *  - 无外圈光圈，路口中心仅保留简洁亮点
 */

import * as THREE from 'three';

// 各等级道路宽度基准（1单位=10m）
const BASE_WIDTH = { express: 7, arterial: 4, collector: 2, local: 0.9 };

const FOCUS_RADIUS = 200; // 2km = 200 THREE单位

// 橙色系：橘子色 #FF6600 附近，近 → 远
const COLOR_NEAR = [1.0,  0.05, 0.0];   // 橘子亮橙 #FF5900
const COLOR_MID  = [0.85, 0.16, 0.0];   // 橙红
const COLOR_FAR  = [0.42, 0.06, 0.0];   // 暗橙红

function lerpColor(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

// 根据归一化距离 [0,1] 计算橘黄色（非线性：近处颜色变化慢，远处迅速暗淡）
function distToColor(distNorm, inbound) {
  // inbound 路段略亮，outbound 略暗
  const d = inbound ? distNorm : Math.min(1, distNorm * 1.3);
  if (d < 0.45) return lerpColor(COLOR_NEAR, COLOR_MID, d / 0.45);
  return lerpColor(COLOR_MID, COLOR_FAR, (d - 0.45) / 0.55);
}

// 根据归一化距离计算逐顶点宽度（越近越宽）
function distToWidth(distNorm, baseW, traceWeight) {
  // 非线性：近端宽，越往外越细，营造汇聚漏斗感
  const w = Math.pow(Math.max(0, 1 - distNorm), 0.65);
  return baseW * traceWeight * (0.08 + 0.92 * w);
}

// ── 构建 Ribbon 几何（逐顶点宽度 + 逐顶点颜色） ─────────────────────────────
function buildRibbons(traceMap, targetPos3) {
  const positions = [];
  const colors    = [];
  const indices   = [];
  let   vertIdx   = 0;

  for (const [road, { traceWeight, isInbound }] of traceMap) {
    const pts = road.coords;
    if (pts.length < 2) continue;

    const baseW    = BASE_WIDTH[road.roadClass] ?? 0.9;
    const n        = pts.length;
    const segStart = vertIdx;

    for (let i = 0; i < n; i++) {
      const [px, py] = pts[i];

      // 该顶点到路口的归一化距离
      const dx = px - targetPos3.x;
      const dz = (-py) - targetPos3.z;
      const distNorm = Math.min(1, Math.sqrt(dx * dx + dz * dz) / FOCUS_RADIUS);

      const [r, g, b] = distToColor(distNorm, isInbound);
      const hw = distToWidth(distNorm, baseW, traceWeight) / 2;

      // 切线方向
      let tx, tz;
      if (i === 0) {
        tx = pts[1][0] - pts[0][0]; tz = pts[1][1] - pts[0][1];
      } else if (i === n - 1) {
        tx = pts[n-1][0] - pts[n-2][0]; tz = pts[n-1][1] - pts[n-2][1];
      } else {
        tx = pts[i+1][0] - pts[i-1][0]; tz = pts[i+1][1] - pts[i-1][1];
      }
      const tlen = Math.sqrt(tx*tx + tz*tz) || 1;
      tx /= tlen; tz /= tlen;

      // 法向（XZ平面内垂直于切线）
      const nx = -tz, nz = tx;

      // 左顶点
      positions.push(px + nx * hw, 0.25, -py + nz * hw);
      colors.push(r, g, b);
      // 右顶点
      positions.push(px - nx * hw, 0.25, -py - nz * hw);
      colors.push(r, g, b);
      vertIdx += 2;
    }

    for (let i = 0; i < n - 1; i++) {
      const base = segStart + i * 2;
      indices.push(base, base+1, base+3);
      indices.push(base, base+3, base+2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color',    new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);

  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  }));
}

function distToTarget2D([x, y], target2D) {
  const dx = x - target2D[0];
  const dy = y - target2D[1];
  return Math.sqrt(dx * dx + dy * dy);
}

function orientFlowPath(pts, target2D, isInbound) {
  const firstDist = distToTarget2D(pts[0], target2D);
  const lastDist = distToTarget2D(pts[pts.length - 1], target2D);

  // inbound: 远端 -> 路口；outbound: 路口 -> 远端
  if (isInbound) return firstDist < lastDist ? [...pts].reverse() : pts;
  return firstDist > lastDist ? [...pts].reverse() : pts;
}

function buildPathMetrics(path) {
  const cumulative = [0];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i][0] - path[i - 1][0];
    const dy = path[i][1] - path[i - 1][1];
    total += Math.sqrt(dx * dx + dy * dy);
    cumulative.push(total);
  }
  return { cumulative, total };
}

function samplePath(path, cumulative, total, progress) {
  const d = progress * total;
  let idx = 1;
  while (idx < cumulative.length - 1 && cumulative[idx] < d) idx++;

  const prevD = cumulative[idx - 1];
  const nextD = cumulative[idx];
  const span = nextD - prevD || 1;
  const t = (d - prevD) / span;
  const p0 = path[idx - 1];
  const p1 = path[idx];
  const x = p0[0] + (p1[0] - p0[0]) * t;
  const y = p0[1] + (p1[1] - p0[1]) * t;
  const tx = (p1[0] - p0[0]) / span;
  const ty = (p1[1] - p0[1]) / span;

  return { x, y, tx, ty };
}

// ── 白色动态流向箭头：叠加在高亮 ribbon 上，体现溯源流量走向 ───────────────
function buildFlowingArrows(traceMap, targetPos3) {
  const flows = [];
  const target2D = [targetPos3.x, -targetPos3.z];

  for (const [road, { traceWeight, isInbound }] of traceMap) {
    if (traceWeight < 0.18) continue;
    const pts = road.coords;
    if (pts.length < 2) continue;

    const path = orientFlowPath(pts, target2D, isInbound);
    const { cumulative, total } = buildPathMetrics(path);
    if (total <= 0) continue;

    const baseW = BASE_WIDTH[road.roadClass] ?? 0.9;
    const count = Math.max(1, Math.min(4, Math.round(total / 55)));
    for (let i = 0; i < count; i++) {
      const width = Math.max(1.2, baseW * 0.48 * traceWeight);
      flows.push({
        path,
        cumulative,
        total,
        width,
        height: Math.max(3.5, width * 2.5),
        offset: i / count + Math.random() * 0.08,
        speed: 0.16 + traceWeight * 0.1,
      });
    }
  }

  if (flows.length === 0) return null;

  const positions = new Float32Array(flows.length * 9);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  }));

  mesh.update = (time) => {
    flows.forEach((flow, i) => {
      const p = (flow.offset + time * flow.speed) % 1;
      const { x, y, tx, ty } = samplePath(flow.path, flow.cumulative, flow.total, p);
      const nx = -ty;
      const ny = tx;
      const base = i * 9;

      positions[base]     = x + tx * flow.height;
      positions[base + 1] = 0.7;
      positions[base + 2] = -(y + ty * flow.height);

      positions[base + 3] = x + nx * flow.width;
      positions[base + 4] = 0.7;
      positions[base + 5] = -(y + ny * flow.width);

      positions[base + 6] = x - nx * flow.width;
      positions[base + 7] = 0.7;
      positions[base + 8] = -(y - ny * flow.width);
    });
    geo.attributes.position.needsUpdate = true;
  };

  return mesh;
}

// ── 路口标记（简洁：白色亮点 + 小光柱） ──────────────────────────────────────
function buildMarker(cx, cz) {
  const group = new THREE.Group();
  group.position.set(cx, 0, cz);

  // 中心亮点圆盘
  const dotGeo = new THREE.CircleGeometry(3.5, 32);
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
  dot.position.y = 0.5;
  group.add(dot);

  // 橙色晕环（仅一圈，小而精）
  const haloGeo = new THREE.RingGeometry(5, 6.5, 64);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xff8800,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.4;
  group.add(halo);

  // 细光柱
  const beamGeo = new THREE.CylinderGeometry(0.15, 2.5, 25, 8, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xff9900,
    transparent: true,
    opacity: 0.2,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.y = 12.5;
  group.add(beam);

  group.update = (time) => {
    const p = 0.5 + 0.5 * Math.sin(time * 3.5);
    dotMat.opacity  = 0.85 + 0.15 * p;
    haloMat.opacity = 0.4  + 0.4  * p;
    beamMat.opacity = 0.1  + 0.15 * p;
  };

  return group;
}

// ── 主入口 ─────────────────────────────────────────────────────────────────────
export function createFocusLayer(traceMap, targetInter) {
  const group = new THREE.Group();
  group.name  = 'focusLayer';

  const [ix, iy]   = targetInter.pos;
  const targetPos3 = new THREE.Vector3(ix, 0, -iy);

  // Ribbon 路网
  const ribbons = buildRibbons(traceMap, targetPos3);
  ribbons.renderOrder = 20;
  group.add(ribbons);

  // 白色流动箭头
  const arrows = buildFlowingArrows(traceMap, targetPos3);
  if (arrows) { arrows.renderOrder = 25; group.add(arrows); }

  // 路口标记（无光圈）
  const marker = buildMarker(ix, -iy);
  marker.traverse(o => { if (o.isMesh) o.renderOrder = 30; });
  group.add(marker);

  group.update = (time) => {
    marker.update(time);
    arrows?.update(time);
  };

  group.dispose = () => {
    group.traverse(obj => {
      obj.geometry?.dispose();
      obj.material?.dispose();
    });
  };

  return { mesh: group, interName: targetInter.props.inter_name || '路口' };
}

import * as THREE from 'three';
import { project } from '../../../geo/loader.js';

// ── 飞线调色板：匹配模版图片配色 ────────────────────────────────────────────
// 主色：天蓝/青色系；点缀：洋红、橙黄、白蓝、红橙
const FLOW_PALETTE = [
  { outer: [0x009fe8, 0x00e5ff], core: [0x44ccff, 0x99eeff] }, // 天蓝→亮青（主色）
  { outer: [0x0055dd, 0x00aaff], core: [0x3388ff, 0x66ccff] }, // 深蓝→天蓝
  { outer: [0x1166ff, 0x44aaff], core: [0x5599ff, 0x88ccff] }, // 蓝→冰蓝
  { outer: [0x00ccee, 0x88eeff], core: [0x66ddff, 0xccf5ff] }, // 青→白蓝（远距离弧）
  { outer: [0xff0099, 0xff55cc], core: [0xff55bb, 0xffaadd] }, // 洋红→粉（点缀）
  { outer: [0xff7700, 0xffcc00], core: [0xffaa33, 0xffee77] }, // 橙→金黄（暖色点缀）
  { outer: [0xff3300, 0xff8800], core: [0xff6644, 0xffaa55] }, // 红橙→橙（近中心）
  { outer: [0x00ffcc, 0x0099ff], core: [0x55ffdd, 0x55bbff] }, // 青绿→蓝
];

// ── 模式配置（围栏/点 marker 颜色，与图片主色对应） ─────────────────────────
const MODE_CONFIG = {
  outbound: { fenceColor: 0x0077cc, fenceGlow: 0x00e5ff }, // 蓝/青
  inbound:  { fenceColor: 0xff0088, fenceGlow: 0xff66cc }, // 洋红/粉
  transit:  { fenceColor: 0xff8800, fenceGlow: 0xffcc44 }, // 橙/金
};

// ─────────────────────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────────────────────

function polygonCenter(feature) {
  const ring = feature.geometry.coordinates[0];
  let x = 0, y = 0;
  for (const [lon, lat] of ring) {
    const [px, py] = project(lon, lat);
    x += px; y += py;
  }
  return new THREE.Vector3(x / ring.length, 0.8, -y / ring.length);
}

function getFlowWeight(feature, index, total) {
  const props = feature?.properties || {};
  const explicit = props.flow ?? props.volume ?? props.count ?? props.value;
  if (Number.isFinite(Number(explicit))) {
    return Math.max(0.28, Math.min(1, Number(explicit) / 100));
  }
  const rank = total <= 1 ? 1 : 1 - index / (total - 1);
  return 0.28 + rank * 0.72;
}

function makeArc(start, end, heightScale = 0.22) {
  const mid = start.clone().lerp(end, 0.5);
  const distance = start.distanceTo(end);
  mid.y += Math.max(20, distance * heightScale);
  return new THREE.CatmullRomCurve3([start, mid, end]);
}

// ─────────────────────────────────────────────────────────────────────────────
// 飞线颜色：统一渐变 白→深蓝→洋红→橘黄
// ─────────────────────────────────────────────────────────────────────────────

const LINE_GRADIENT = [
  { t: 0.00, hex: 0xffffff },  // 起点：纯白
  { t: 0.20, hex: 0x0033cc },  // 深蓝
  { t: 0.50, hex: 0x001899 },  // 更深蓝（主色）
  { t: 0.80, hex: 0x001066 },  // 极深蓝（主色尾段）
  { t: 0.82, hex: 0x7a0028 },  // 深玫红（尾部渐变起点）
  { t: 1.00, hex: 0xcc5500 },  // 深橘黄（尾部末端）
];

function sampleGradient(stops, t) {
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (t >= a.t && t <= b.t) {
      return new THREE.Color(a.hex).lerp(new THREE.Color(b.hex), (t - a.t) / (b.t - a.t));
    }
  }
  return new THREE.Color(stops[stops.length - 1].hex);
}

// ─────────────────────────────────────────────────────────────────────────────
// 渐变锥形管几何体（支持多色段 stops）
// ─────────────────────────────────────────────────────────────────────────────

function buildTaperedGradientTube(curve, radiusMax, tubularSegments, radialSegments, colorStops) {
  const frames = curve.computeFrenetFrames(tubularSegments, false);
  const vertices = [];
  const colors   = [];
  const indices  = [];
  const uvs      = [];

  for (let i = 0; i <= tubularSegments; i++) {
    const t      = i / tubularSegments;
    const taper  = 0.10 + 0.90 * (4 * t * (1 - t));
    const radius = radiusMax * taper;

    const pos      = curve.getPoint(t);
    const ni       = Math.min(i, frames.normals.length - 1);
    const normal   = frames.normals[ni];
    const binormal = frames.binormals[ni];
    const c        = sampleGradient(colorStops, t);

    for (let j = 0; j <= radialSegments; j++) {
      const angle = (j / radialSegments) * Math.PI * 2;
      const sin   = Math.sin(angle);
      const cos   = Math.cos(angle);
      vertices.push(
        pos.x + radius * (cos * normal.x + sin * binormal.x),
        pos.y + radius * (cos * normal.y + sin * binormal.y),
        pos.z + radius * (cos * normal.z + sin * binormal.z),
      );
      colors.push(c.r, c.g, c.b);
      uvs.push(t, j / radialSegments);
    }
  }

  for (let i = 0; i < tubularSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = (radialSegments + 1) * i + j;
      const b = (radialSegments + 1) * (i + 1) + j;
      const c = (radialSegments + 1) * (i + 1) + j + 1;
      const d = (radialSegments + 1) * i + j + 1;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color',    new THREE.Float32BufferAttribute(colors,   3));
  geometry.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs,      2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// ─────────────────────────────────────────────────────────────────────────────
// 飞线（外层渐变管 + 内层亮芯，均使用统一四色渐变）
// ─────────────────────────────────────────────────────────────────────────────

// 内芯用更亮的版本：白→冰蓝→粉→金
const CORE_GRADIENT = [
  { t: 0.00, hex: 0xffffff },  // 白
  { t: 0.20, hex: 0x4488ff },  // 亮蓝
  { t: 0.55, hex: 0x2244cc },  // 中深蓝
  { t: 0.80, hex: 0x1133aa },  // 深蓝（芯主色）
  { t: 0.82, hex: 0xff3366 },  // 亮玫红（尾部）
  { t: 1.00, hex: 0xff7700 },  // 亮橘（尾部末端）
];

function createCurveLine(curve, _palette, weight, opacity = 0.88) {
  const group     = new THREE.Group();
  const radiusMax = 2.0 + weight * 8.0; // 粗 2x

  const outerGeom = buildTaperedGradientTube(curve, radiusMax, 80, 8, LINE_GRADIENT);
  const outerMat  = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true,
    opacity: opacity * (0.55 + weight * 0.45),
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    side: THREE.DoubleSide,
  });
  group.add(new THREE.Mesh(outerGeom, outerMat));

  const coreGeom = buildTaperedGradientTube(curve, radiusMax * 0.22, 80, 5, CORE_GRADIENT);
  const coreMat  = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true,
    opacity: 0.80 + weight * 0.18,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    side: THREE.DoubleSide,
  });
  group.add(new THREE.Mesh(coreGeom, coreMat));

  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// 工具：弧长参数化顶边路径，返回 samplePath(t∈[0,1]) → Vector3
// ─────────────────────────────────────────────────────────────────────────────

function buildEdgePath(ring, height) {
  const pts = ring.map(([lon, lat]) => {
    const [x, y] = project(lon, lat);
    return new THREE.Vector3(x, height, -y);
  });
  const cumLen = [0];
  for (let i = 0; i < pts.length; i++) {
    cumLen.push(cumLen[i] + pts[i].distanceTo(pts[(i + 1) % pts.length]));
  }
  const total = cumLen[cumLen.length - 1];
  function sample(t) {
    const d = ((t % 1) + 1) % 1 * total;
    for (let i = 0; i < pts.length; i++) {
      if (d <= cumLen[i + 1] + 1e-6) {
        const seg = cumLen[i + 1] - cumLen[i];
        const lt  = seg > 0 ? (d - cumLen[i]) / seg : 0;
        return new THREE.Vector3().lerpVectors(pts[i], pts[(i + 1) % pts.length], Math.min(1, lt));
      }
    }
    return pts[0].clone();
  }
  return { pts, total, sample };
}

// ─────────────────────────────────────────────────────────────────────────────
// 柔和圆形光斑贴图（用于气体粒子）
// ─────────────────────────────────────────────────────────────────────────────

let _gasTex = null;
function getGasTexture() {
  if (_gasTex) return _gasTex;
  const sz  = 64;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = sz;
  const ctx = cvs.getContext('2d');
  const g   = ctx.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2);
  g.addColorStop(0,    'rgba(255,255,255,1.0)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.7,  'rgba(255,255,255,0.15)');
  g.addColorStop(1,    'rgba(255,255,255,0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, sz, sz);
  _gasTex = new THREE.CanvasTexture(cvs);
  return _gasTex;
}

// ─────────────────────────────────────────────────────────────────────────────
// 边界气体粒子：沿边界向上升腾，淡入→全亮→淡出，随高度扩散
// ─────────────────────────────────────────────────────────────────────────────

function createBoundaryParticles(ring, wallHeight, glowColor, isOrigin, weight) {
  const group  = new THREE.Group();
  const path   = buildEdgePath(ring, 0); // 从地面高度采样边界点
  const colG   = new THREE.Color(glowColor);
  const colW   = new THREE.Color(0xffffff);

  const COUNT = isOrigin ? 160 : Math.max(55, Math.round(100 * weight));

  const positions = new Float32Array(COUNT * 3);
  const colors    = new Float32Array(COUNT * 3);
  const sizes     = new Float32Array(COUNT);

  // CPU 端每粒子状态
  const pLife     = new Float32Array(COUNT); // 0~1 当前生命进度
  const pSpeed    = new Float32Array(COUNT); // 上升速度（世界单位/s）
  const pMaxH     = new Float32Array(COUNT); // 上升极限高度
  const pEdgeT    = new Float32Array(COUNT); // 在边界上的位置参数 t
  const pDriftX   = new Float32Array(COUNT); // 水平漂移方向 x
  const pDriftZ   = new Float32Array(COUNT);
  const pBaseSize = new Float32Array(COUNT);
  const pBaseR    = new Float32Array(COUNT);
  const pBaseG    = new Float32Array(COUNT);
  const pBaseB    = new Float32Array(COUNT);

  function resetParticle(i, randomLife) {
    pEdgeT[i]    = Math.random();
    pLife[i]     = randomLife ? Math.random() : 0;
    pSpeed[i]    = 0.5 + Math.random() * 1.0;
    pMaxH[i]     = wallHeight * (0.55 + Math.random() * 0.75);
    // 轻微向外/向内的随机漂移
    pDriftX[i]   = (Math.random() - 0.5) * 1.2;
    pDriftZ[i]   = (Math.random() - 0.5) * 1.2;
    pBaseSize[i] = isOrigin ? 6 + Math.random() * 7 : 4 + Math.random() * 5;
    // 颜色：围栏色混白，加少量随机亮度变化
    const c = colG.clone().lerp(colW, 0.15 + Math.random() * 0.4);
    pBaseR[i] = c.r; pBaseG[i] = c.g; pBaseB[i] = c.b;
  }

  for (let i = 0; i < COUNT; i++) resetParticle(i, true);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(colors,    3));
  geo.setAttribute('size',     new THREE.BufferAttribute(sizes,     1));

  const mat = new THREE.PointsMaterial({
    map: getGasTexture(),
    vertexColors: true,
    size: isOrigin ? 9 : 6,
    transparent: true,
    opacity: 1.0,
    alphaTest: 0.005,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    sizeAttenuation: true,
  });
  group.add(new THREE.Points(geo, mat));

  let _lastTime = -1;

  group.update = (time) => {
    const dt = _lastTime < 0 ? 0.016 : Math.min(time - _lastTime, 0.05);
    _lastTime = time;

    for (let i = 0; i < COUNT; i++) {
      pLife[i] += dt * pSpeed[i] / pMaxH[i];
      if (pLife[i] >= 1.0) resetParticle(i, false);

      const t  = pLife[i];
      const h  = t * pMaxH[i];
      const pt = path.sample(pEdgeT[i]);

      // 随高度线性扩散漂移
      positions[i * 3]     = pt.x + pDriftX[i] * t * 2.5;
      positions[i * 3 + 1] = h;
      positions[i * 3 + 2] = pt.z + pDriftZ[i] * t * 2.5;

      // 亮度曲线：底部淡入[0,0.2]，中段全亮[0.2,0.6]，顶部淡出[0.6,1]
      const alpha = t < 0.2 ? t / 0.2 : t > 0.6 ? (1 - t) / 0.4 : 1.0;
      colors[i * 3]     = pBaseR[i] * alpha;
      colors[i * 3 + 1] = pBaseG[i] * alpha;
      colors[i * 3 + 2] = pBaseB[i] * alpha;

      // 粒子随高度变大（气体扩散）
      sizes[i] = pBaseSize[i] * (0.4 + t * 1.4);
    }

    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate    = true;
    geo.attributes.size.needsUpdate     = true;
  };

  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// 山峰形状高度生成（每顶点独立高度，形成山脊轮廓）
// ─────────────────────────────────────────────────────────────────────────────

function mountainHeights(ring, maxH) {
  const n = ring.length;
  // 用多谐波叠加生成平滑但有起伏的"山脊"曲线
  // 相位由经纬度之和决定，保证同一区域每次相同
  const seed  = ring.reduce((s, [lon, lat]) => s + lon * 0.1 + lat * 0.13, 0);
  const p1    = (seed % 1) * Math.PI * 2;
  const p2    = ((seed * 1.618) % 1) * Math.PI * 2;
  const p3    = ((seed * 2.718) % 1) * Math.PI * 2;

  return ring.map((_, i) => {
    const a = (i / n) * Math.PI * 2;
    // 基波 + 二、三谐波叠加，模拟山峰起伏
    const v = 0.5
      + 0.28 * Math.cos(a + p1)
      + 0.14 * Math.cos(2 * a + p2)
      + 0.07 * Math.cos(3 * a + p3);
    return maxH * Math.max(0.22, v); // 最低不低于 22% 最大高度
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 区域围栏：垂直电子墙 + 顶边线 + 底面 + 粒子特效（逐顶点山峰高度）
// ─────────────────────────────────────────────────────────────────────────────

function createFenceWall(ring, heights, fenceColor, glowColor, isOrigin, weight) {
  const group    = new THREE.Group();
  const _fc = new THREE.Color(fenceColor).multiplyScalar(1.6);
  const colFence = new THREE.Color(Math.min(1,_fc.r), Math.min(1,_fc.g), Math.min(1,_fc.b)); // 整体提亮
  const colBase  = new THREE.Color(fenceColor).multiplyScalar(0.10);
  const maxH     = Math.max(...heights);

  // ── 1. 垂直墙面（底部极深→顶部饱和，顶点高度随山峰变化）
  const wallVerts = [], wallColors = [], wallIdxs = [];
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = project(...ring[i]);
    const [x1, y1] = project(...ring[(i + 1) % ring.length]);
    const h0 = heights[i];
    const h1 = heights[(i + 1) % ring.length];
    // 峰顶更亮（lerp 到白色的比例提高到 0.55）
    const bright0 = colFence.clone().lerp(new THREE.Color(0xffffff), (h0 / maxH) * 0.55);
    const bright1 = colFence.clone().lerp(new THREE.Color(0xffffff), (h1 / maxH) * 0.55);
    const base = wallVerts.length / 3;
    wallVerts.push(x0, 0.2, -y0);  wallColors.push(colBase.r,   colBase.g,   colBase.b);
    wallVerts.push(x0, h0,  -y0);  wallColors.push(bright0.r,   bright0.g,   bright0.b);
    wallVerts.push(x1, h1,  -y1);  wallColors.push(bright1.r,   bright1.g,   bright1.b);
    wallVerts.push(x1, 0.2, -y1);  wallColors.push(colBase.r,   colBase.g,   colBase.b);
    wallIdxs.push(base, base+1, base+2, base, base+2, base+3);
  }
  const wallGeom = new THREE.BufferGeometry();
  wallGeom.setAttribute('position', new THREE.Float32BufferAttribute(wallVerts,  3));
  wallGeom.setAttribute('color',    new THREE.Float32BufferAttribute(wallColors, 3));
  wallGeom.setIndex(wallIdxs);
  const wallMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true,
    opacity: isOrigin ? 0.82 : 0.62,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
  });
  group.add(new THREE.Mesh(wallGeom, wallMat));

  // ── 2. 顶部主发光线（沿山峰轮廓）
  const topPts  = ring.map(([lon, lat], i) => { const [x,y]=project(lon,lat); return new THREE.Vector3(x, heights[i], -y); });
  const topGeom = new THREE.BufferGeometry().setFromPoints(topPts);
  const topMat  = new THREE.LineBasicMaterial({
    color: glowColor, transparent: true, opacity: 1.0,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
  });
  group.add(new THREE.LineLoop(topGeom, topMat));

  // ── 3. 顶部白色光晕线（稍偏上）
  const hPts  = ring.map(([lon, lat], i) => { const [x,y]=project(lon,lat); return new THREE.Vector3(x, heights[i]+0.8, -y); });
  const hGeom = new THREE.BufferGeometry().setFromPoints(hPts);
  const hMat  = new THREE.LineBasicMaterial({
    color: 0xffffff, transparent: true, opacity: isOrigin ? 0.72 : 0.50,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
  });
  group.add(new THREE.LineLoop(hGeom, hMat));

  // ── 4. 底部填充面
  const shape   = new THREE.Shape(ring.map(([lon, lat]) => { const [x,y]=project(lon,lat); return new THREE.Vector2(x,y); }));
  const fillGeo = new THREE.ShapeGeometry(shape);
  const fillMat = new THREE.MeshBasicMaterial({
    color: fenceColor, transparent: true,
    opacity: isOrigin ? 0.30 : 0.20,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
  });
  const fill = new THREE.Mesh(fillGeo, fillMat);
  fill.rotation.x = -Math.PI / 2;
  fill.position.y  = 0.15;
  group.add(fill);

  // ── 5. 边界气体粒子（使用平均高度作为升腾上限）
  const avgH      = heights.reduce((s, h) => s + h, 0) / heights.length;
  const particles = createBoundaryParticles(ring, avgH, glowColor, isOrigin, weight);
  group.add(particles);

  // 脉冲动画
  group.update = (time) => {
    const pulse = 0.5 + 0.5 * Math.sin(time * (isOrigin ? 3.8 : 2.4));
    wallMat.opacity = (isOrigin ? 0.62 : 0.42) + pulse * (isOrigin ? 0.22 : 0.18);
    topMat.opacity  = 0.82 + pulse * 0.18;
    hMat.opacity    = (isOrigin ? 0.48 : 0.28) + pulse * 0.28;
    fillMat.opacity = isOrigin ? 0.22 + pulse * 0.12 : 0.14 + pulse * 0.10;
    particles.update?.(time);
  };

  return group;
}

// origin: 最大高度 48，target: 15~42 按流量权重缩放（均约 3x）
function createRegionFence(feature, isOrigin, fenceColor, glowColor, weight = 1.0) {
  const ring = feature.geometry.coordinates[0];
  if (!ring?.length) return new THREE.Group();
  const maxH   = isOrigin ? 48 : 15 + weight * 27; // origin 固定48，target 15~42
  const heights = mountainHeights(ring, maxH);
  return createFenceWall(ring, heights, fenceColor, glowColor, isOrigin, weight);
}

// ─────────────────────────────────────────────────────────────────────────────
// 区域中心 Marker
// ─────────────────────────────────────────────────────────────────────────────

function createRegionMarker(position, isOrigin, fenceColor) {
  const group = new THREE.Group();
  group.position.copy(position);

  const ringGeo = new THREE.RingGeometry(isOrigin ? 5 : 2.8, isOrigin ? 7.5 : 4, 64);
  const ringMat = new THREE.MeshBasicMaterial({
    color: fenceColor,
    transparent: true,
    opacity: isOrigin ? 0.88 : 0.55,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y  = 0.2;
  group.add(ring);

  if (isOrigin) {
    const outerGeo = new THREE.RingGeometry(9, 11.5, 64);
    const outerMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const outer = new THREE.Mesh(outerGeo, outerMat);
    outer.rotation.x = -Math.PI / 2;
    outer.position.y  = 0.15;
    group.add(outer);
  }

  const dotGeo = new THREE.CircleGeometry(isOrigin ? 3.5 : 1.5, 32);
  const dotMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: isOrigin ? 0.95 : 0.75,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const dot = new THREE.Mesh(dotGeo, dotMat);
  dot.rotation.x = -Math.PI / 2;
  dot.position.y  = 0.3;
  group.add(dot);

  group.update = (time) => {
    const pulse = 0.55 + 0.45 * Math.sin(time * (isOrigin ? 3.4 : 2.2));
    ringMat.opacity = (isOrigin ? 0.52 : 0.28) + pulse * 0.36;
    group.scale.setScalar(0.9 + pulse * 0.18);
  };

  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// 粒子系统
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// ">" 形箭头系统：用填充 Mesh 实现粗箭头，每条飞线 5 个均匀分布
// ─────────────────────────────────────────────────────────────────────────────

function buildArrowSystem(flows) {
  const PER_FLOW = 5;    // 每条飞线同时显示的箭头数
  const ARROW_W  = 4.5;  // 两腿横向张开距离（世界单位）
  const ARROW_L  = 6.5;  // 尖端向前伸出距离
  const LEG_W    = 1.1;  // 每条腿的填充宽度（决定"粗细"）

  // 每个箭头 = 两条腿，每腿 = 1 个矩形面片（2 三角 = 6 顶点）
  const totalArrows = flows.length * PER_FLOW;
  const vertPerArrow = 2 * 6; // 两腿 × 6顶点
  const positions    = new Float32Array(totalArrows * vertPerArrow * 3);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  // 外层：亮白填充
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  // 内层光晕：稍大 + 青蓝色
  const glowPositions = new Float32Array(totalArrows * vertPerArrow * 3);
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPositions, 3));
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0x55aaff,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });

  const mesh     = new THREE.Mesh(geo, mat);
  const glowMesh = new THREE.Mesh(glowGeo, glowMat);

  const _up   = new THREE.Vector3(0, 1, 0);
  const _rgt  = new THREE.Vector3();
  const _legD = new THREE.Vector3();
  const _legN = new THREE.Vector3();

  // 写一条腿的矩形（6顶点）到 buf[ptr]，返回新 ptr
  function writeLeg(buf, ptr, ax, ay, az, bx, by, bz, halfW) {
    _legD.set(bx - ax, by - ay, bz - az).normalize();
    _legN.crossVectors(_legD, _up).normalize().multiplyScalar(halfW);
    const nx = _legN.x, ny = _legN.y, nz = _legN.z;
    // tri 1
    buf[ptr++] = ax + nx; buf[ptr++] = ay + ny; buf[ptr++] = az + nz;
    buf[ptr++] = ax - nx; buf[ptr++] = ay - ny; buf[ptr++] = az - nz;
    buf[ptr++] = bx - nx; buf[ptr++] = by - ny; buf[ptr++] = bz - nz;
    // tri 2
    buf[ptr++] = ax + nx; buf[ptr++] = ay + ny; buf[ptr++] = az + nz;
    buf[ptr++] = bx - nx; buf[ptr++] = by - ny; buf[ptr++] = bz - nz;
    buf[ptr++] = bx + nx; buf[ptr++] = by + ny; buf[ptr++] = bz + nz;
    return ptr;
  }

  function updateBuffer(buf, time) {
    let ptr = 0;
    const glowHalfW = LEG_W * 2.0;
    flows.forEach((flow, fi) => {
      for (let k = 0; k < PER_FLOW; k++) {
        const t       = ((k / PER_FLOW + time * flow.speed * 0.85 + fi * 0.07) % 1 + 1) % 1;
        const pos     = flow.curve.getPoint(t);
        const tangent = flow.curve.getTangent(t).normalize();
        _rgt.crossVectors(tangent, _up).normalize();

        const tipX = pos.x + tangent.x * ARROW_L;
        const tipY = pos.y + tangent.y * ARROW_L;
        const tipZ = pos.z + tangent.z * ARROW_L;
        const blX  = pos.x + _rgt.x * ARROW_W;
        const blY  = pos.y + _rgt.y * ARROW_W;
        const blZ  = pos.z + _rgt.z * ARROW_W;
        const brX  = pos.x - _rgt.x * ARROW_W;
        const brY  = pos.y - _rgt.y * ARROW_W;
        const brZ  = pos.z - _rgt.z * ARROW_W;

        const hw = buf === positions ? LEG_W : glowHalfW;
        // 左腿：back-left → tip
        ptr = writeLeg(buf, ptr, blX, blY, blZ, tipX, tipY, tipZ, hw);
        // 右腿：back-right → tip
        ptr = writeLeg(buf, ptr, brX, brY, brZ, tipX, tipY, tipZ, hw);
      }
    });
  }

  const group = new THREE.Group();
  group.add(glowMesh);
  group.add(mesh);

  group.update = (time) => {
    updateBuffer(positions,    time);
    updateBuffer(glowPositions, time);
    geo.attributes.position.needsUpdate     = true;
    glowGeo.attributes.position.needsUpdate = true;
  };

  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow 数据生成
// ─────────────────────────────────────────────────────────────────────────────

function createFlows(origin, targets, targetFeatures, mode) {
  if (mode === 'inbound') {
    return targets.map((target, index) => ({
      curve:  makeArc(target, origin, 0.18 + (index % 3) * 0.038),
      weight: getFlowWeight(targetFeatures[index], index, targets.length),
      speed:  0.18 + (index % 4) * 0.022,
    }));
  }
  if (mode === 'transit') {
    const flows = [];
    for (let i = 0; i < targets.length; i++) {
      const next   = targets[(i + 3) % targets.length];
      const weight = getFlowWeight(targetFeatures[i], i, targets.length);
      flows.push({
        curve:  makeArc(targets[i], origin, 0.14 + (i % 3) * 0.032),
        weight,
        speed:  0.15 + (i % 4) * 0.018,
      });
      flows.push({
        curve:  makeArc(origin, next, 0.14 + (i % 3) * 0.032),
        weight: Math.max(0.28, weight * 0.82),
        speed:  0.16 + (i % 4) * 0.018,
      });
    }
    return flows;
  }
  return targets.map((target, index) => ({
    curve:  makeArc(origin, target, 0.18 + (index % 3) * 0.038),
    weight: getFlowWeight(targetFeatures[index], index, targets.length),
    speed:  0.18 + (index % 4) * 0.022,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 主入口
// ─────────────────────────────────────────────────────────────────────────────

export function createODLayer(features, mode = 'outbound') {
  const group = new THREE.Group();
  group.name  = 'odLayer';

  const centers        = features.map(polygonCenter);
  const origin         = centers[0];
  const targets        = centers.slice(1);
  const targetFeatures = features.slice(1);
  const modeConf       = MODE_CONFIG[mode] || MODE_CONFIG.outbound;
  const flows          = createFlows(origin, targets, targetFeatures, mode);

  // 每个目标区域的流量权重（0~1），用于决定围栏高度
  const targetWeights = targetFeatures.map((f, i) =>
    getFlowWeight(f, i, targetFeatures.length),
  );

  // ── 按距离中心由近到远为每个目标区分配颜色 ───────────────────────────────
  // 前三近：深红 / 红 / 深橙；其余：深绿→浅绿（越近越深）
  const DIST_COLORS = [
    { fence: 0x660010, glow: 0xcc0028 }, // rank0 最近：深红
    { fence: 0xaa0018, glow: 0xff2244 }, // rank1：红
    { fence: 0xaa3c00, glow: 0xff6600 }, // rank2：深橙
  ];
  const deepGreen  = new THREE.Color(0x004d1a);
  const lightGreen = new THREE.Color(0x00cc55);
  const deepGGlow  = new THREE.Color(0x007a2a);
  const lightGGlow = new THREE.Color(0x44ff88);

  // 按距离排序（近→远）
  const byDist = targets
    .map((t, i) => ({ i, dist: origin.distanceTo(t) }))
    .sort((a, b) => a.dist - b.dist);

  const targetColors = new Array(targets.length);
  byDist.forEach(({ i: idx }, rank) => {
    if (rank < 3) {
      targetColors[idx] = DIST_COLORS[rank];
    } else {
      const t   = (rank - 3) / Math.max(1, byDist.length - 4);
      const fc  = deepGreen.clone().lerp(lightGreen, t);
      const gc  = deepGGlow.clone().lerp(lightGGlow, t);
      targetColors[idx] = { fence: fc.getHex(), glow: gc.getHex() };
    }
  });

  // origin：深蓝
  const originFenceColor = 0x003388;
  const originGlowColor  = 0x0066ff;

  // 区域围栏：origin 固定最高，target 高度按流量权重缩放
  group.add(createRegionFence(features[0], true, originFenceColor, originGlowColor, 1.0));
  targetFeatures.forEach((feature, i) => {
    const col = targetColors[i];
    group.add(createRegionFence(feature, false, col.fence, col.glow, targetWeights[i]));
  });

  // 中心 marker
  group.add(createRegionMarker(origin, true, originGlowColor));
  targets.forEach((t, i) => group.add(createRegionMarker(t, false, targetColors[i].glow)));

  // 飞线：按 weight 从低到高排序（权重小的先渲染，在下层）
  const sortedFlows = flows
    .map((f, i) => ({ ...f, paletteIdx: i }))
    .sort((a, b) => a.weight - b.weight);

  sortedFlows.forEach(flow => {
    const pal  = FLOW_PALETTE[flow.paletteIdx % FLOW_PALETTE.length];
    const line = createCurveLine(flow.curve, pal, flow.weight);
    group.add(line);
  });

  const arrows = buildArrowSystem(flows);
  group.add(arrows);

  // 飞线和 OD 区域始终渲染在底图上方
  group.traverse(obj => {
    if (obj.isMesh || obj.isLine || obj.isPoints || obj.isLineSegments) obj.renderOrder = 100;
  });

  // ── 自动调相机：以数据包围盒中心居中，保留 10% 边距 ─────────────────────
  group.frameCamera = (camera, controls) => {
    const box = new THREE.Box3();
    for (const f of features) {
      for (const coord of f.geometry.coordinates[0]) {
        const [x, y] = project(coord[0], coord[1]);
        box.expandByPoint(new THREE.Vector3(x, 0, -y));
      }
    }

    const center = new THREE.Vector3();
    const size   = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    // 向东偏移，使中心城区在视野偏右侧（正 X = 东）
    const EAST_BIAS = -100;  // 世界单位 ≈300m
    center.x += EAST_BIAS;

    // 水平 FOV
    const vFovRad  = THREE.MathUtils.degToRad(camera.fov);
    const hFovRad  = 2 * Math.atan(Math.tan(vFovRad / 2) * camera.aspect);

    // 同时考虑宽高两方向，取较大值并留 10% 边距
    const halfW  = size.x * 0.5 * 1.1;
    const halfH  = size.z * 0.5 * 1.1;
    const distW  = halfW / Math.tan(hFovRad / 2);
    const distH  = halfH / Math.tan(vFovRad / 2);
    const camDist = Math.max(distW, distH);

    // 俯仰角约 42°，保持和当前场景近似的透视感
    const tilt = THREE.MathUtils.degToRad(42);
    const hd   = camDist * Math.cos(tilt); // 水平偏移（Z 轴方向）
    const vd   = camDist * Math.sin(tilt); // 高度

    camera.position.set(center.x, vd, center.z + hd);
    camera.lookAt(center.x, 0, center.z);
    camera.updateProjectionMatrix();

    if (controls) {
      controls.target.set(center.x, 0, center.z);
      controls.update();
    }
  };

  group.update = (time) => {
    arrows.update(time);
    group.children.forEach(child => child.update?.(time));
  };

  group.dispose = () => {
    group.traverse(obj => {
      obj.geometry?.dispose();
      if (Array.isArray(obj.material)) {
        obj.material.forEach(m => m.dispose());
      } else {
        obj.material?.dispose();
      }
    });
  };

  return group;
}

/**
 * 只渲染 origin（中心区域）围栏，供"区域诊断"第一屏使用。
 * 返回含 update / frameCamera / dispose 的 group。
 */
export function createOriginAreaLayer(features) {
  const group  = new THREE.Group();
  group.name   = 'originAreaLayer';

  const origin = polygonCenter(features[0]);
  const fence  = createRegionFence(features[0], true, 0x003388, 0x0066ff, 1.0);
  const marker = createRegionMarker(origin, true, 0x0066ff);

  group.add(fence);
  group.add(marker);

  group.update = (t) => {
    fence.update?.(t);
    marker.update?.(t);
  };

  group.frameCamera = (cam, ctrl) => {
    const ring = features[0]?.geometry?.coordinates?.[0];
    if (!ring) return;
    const pts = ring.map(([lon, lat]) => {
      const [x, z] = project(lon, lat);
      return new THREE.Vector3(x, 0, -z);
    });
    const box    = new THREE.Box3().setFromPoints(pts);
    const center = new THREE.Vector3();
    const size   = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    const vFov   = THREE.MathUtils.degToRad(cam.fov);
    const hFov   = 2 * Math.atan(Math.tan(vFov / 2) * cam.aspect);
    const dist   = Math.max(size.x / (2 * Math.tan(hFov / 2)),
                            size.z / (2 * Math.tan(vFov / 2))) * 1.5;

    cam.up.set(0, 0, -1);
    cam.position.set(center.x, dist, center.z);
    cam.lookAt(center.x, 0, center.z);
    cam.near = 0.5; cam.far = 5000;
    cam.updateProjectionMatrix();
    ctrl.target.set(center.x, 0, center.z);
    ctrl.minDistance = 80;
    ctrl.maxDistance = dist * 3;
    ctrl.update();
  };

  group.dispose = () => {
    group.traverse(obj => {
      obj.geometry?.dispose();
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material?.dispose();
    });
  };

  return group;
}

/**
 * 幕 1 · 问题定位 — 地图特效（无渠化）
 *
 * 兼容主工程地图运行时（TrafficOriginScene）的两类 fx 工厂：
 * - createAct1MapFx({ intersections, roads })  搜索态脉冲
 * - createAct2MapFx({ project })              定位态走廊（双路口 + 流向箭头 + 指标脉冲）
 *
 * 定位态视觉元素：
 *   1. 飞入锚环（走廊中点）
 *   2. 奥体西路北向南走廊发光主线（坤顺 → 解放 → 经十）
 *   3. 三路口标记 + 名称标签（坤顺 / 解放 / 经十）
 *   4. 北向南流向人字箭头（沿走廊流动）
 *   5. 上游双路口（解放 / 坤顺）指标脉冲环
 *   6. 路况着色层（高德语义）：直接在 3D 场景内铺贴地色带
 *      —— case 覆盖北入口 + 上游两个路段，红/深红呼吸脉冲
 *
 * 无渠化：不调用 createChannelizationLayer；hasChannelization() 恒为 false。
 */
import * as THREE from 'three';
// 复用主工程 geo/loader.js 的投影（对齐 agent-loop 的 project / getRoadClass 机制）
import { project } from '../../../geo/loader.js';
import { createCityScan } from '../../../mesh/cityScan.js';
import {
  INTERSECTIONS,
  SPATIAL_SCENE,
} from './fixture.js';
import {
  fetchCaseTrafficLinks,
  TRAFFIC_STATE_COLORS,
} from './trafficColorService.js';

/** 世界坐标（x 东 / y 北 / z=-y，对齐主工程） */
function worldOf(inter) {
  const [x, y] = project(inter.lon, inter.lat);
  return { x, y, z: -y };
}

/**
 * 由 SPATIAL_SCENE 解析走廊节点（对齐 agent-loop act2 的 spatial_scene 读取方式）：
 *   target / upstream_nodes / downstream_nodes → { lon, lat, name, role, color }
 * 上游按纬度降序（北在前），保证走廊 坤顺(北) → 解放(中) → 经十(南)。
 * 角色配色对齐 agent-loop act2：上游橙、下游青绿、目标青蓝。
 */
function resolveCorridorNodes() {
  const scene = SPATIAL_SCENE || {};
  const t = scene.target || {};
  const target = {
    lon: t.lng ?? INTERSECTIONS.jingshi.lon,
    lat: t.lat ?? INTERSECTIONS.jingshi.lat,
    name: t.inter_name || INTERSECTIONS.jingshi.name,
    role: 'downstream_target',
    color: 0x00d4f0,
  };
  const upstream = (scene.upstream_nodes || [])
    .slice()
    .sort((a, b) => (b.lat ?? -Infinity) - (a.lat ?? -Infinity))
    .map((n) => ({
      lon: n.lng,
      lat: n.lat,
      name: n.inter_name,
      role: n.role || 'upstream',
      color: 0xff8a3d,
    }));
  const downstream = (scene.downstream_nodes || []).map((n) => ({
    lon: n.lng,
    lat: n.lat,
    name: n.inter_name,
    role: n.role || 'downstream',
    color: 0x3ddc97,
  }));
  // 兼容旧数据：upstream_nodes 缺失时回退 INTERSECTIONS（坤顺北、解放中）
  if (!upstream.length) {
    upstream.push(
      { lon: INTERSECTIONS.kunshun.lon, lat: INTERSECTIONS.kunshun.lat, name: INTERSECTIONS.kunshun.name, role: 'upstream', color: 0xffc24d },
      { lon: INTERSECTIONS.jiefang.lon, lat: INTERSECTIONS.jiefang.lat, name: INTERSECTIONS.jiefang.name, role: 'upstream', color: 0xff8a3d },
    );
    upstream.sort((a, b) => b.lat - a.lat);
  }
  return { target, upstream, downstream };
}

const corridorNodes = resolveCorridorNodes();
const JINGSHI = worldOf(corridorNodes.target);
const JIEFANG = worldOf(corridorNodes.upstream[1] || corridorNodes.upstream[0]);
const KUNSHUN = worldOf(corridorNodes.upstream[0]);
const DOWNSTREAM_NODE = corridorNodes.downstream[0] ? worldOf(corridorNodes.downstream[0]) : null;

// 解放路东西向汇入段（解放东路:无名道路-奥体西路 西向东，汇入解放路口）
const JIEFANG_EW_START = (() => {
  const [x, y] = project(117.108448, 36.662916);
  return { x, z: -y };
})();
const JIEFANG_EW_END = (() => {
  const [x, y] = project(117.11127, 36.663051);
  return { x, z: -y };
})();

// 解放路东西向汇入段（解放东路:无名道路-奥体西路 东向西，汇入解放路口）
const JIEFANG_WE_START = (() => {
  const [x, y] = project(117.113678, 36.663126);
  return { x, z: -y };
})();
const JIEFANG_WE_END = (() => {
  const [x, y] = project(117.111468, 36.663136);
  return { x, z: -y };
})();

/** 走廊中点（飞入锚点：三路口同框） */
const CORRIDOR_CENTER = {
  x: (KUNSHUN.x + JINGSHI.x) / 2,
  y: (KUNSHUN.y + JINGSHI.y) / 2,
  z: (KUNSHUN.z + JINGSHI.z) / 2,
};

function makeGlowTexture() {
  const sz = 64;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = sz;
  const ctx = cvs.getContext('2d');
  const g = ctx.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, sz, sz);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 轻量道路名标签（青字 + 微光，无重框） */
function createRoadNameLabel(text, accent = '#7ee9ff') {
  const fontSize = 24;
  const padX = 8;
  const padY = 6;
  const font = `500 ${fontSize}px "PingFang SC","Microsoft YaHei",sans-serif`;

  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;
  const tw = Math.ceil(measure.measureText(text).width);

  const canvas = document.createElement('canvas');
  canvas.width = tw + padX * 2 + 8;
  canvas.height = fontSize + padY * 2 + 10;
  const ctx = canvas.getContext('2d');

  const cx = canvas.width / 2;
  const cy = canvas.height / 2 - 1;
  const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, canvas.width * 0.55);
  glow.addColorStop(0, 'rgba(0, 40, 60, 0.35)');
  glow.addColorStop(1, 'rgba(0, 20, 40, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(4, 14, 26, 0.75)';
  ctx.strokeText(text, cx, cy);
  ctx.fillStyle = accent;
  ctx.shadowColor = 'rgba(0, 212, 240, 0.55)';
  ctx.shadowBlur = 8;
  ctx.fillText(text, cx, cy);
  ctx.shadowBlur = 0;

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    sizeAttenuation: true,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(canvas.width * 0.13, canvas.height * 0.13, 1);
  sprite.frustumCulled = false;
  sprite.renderOrder = 48;
  sprite.center.set(0.5, 0.5);
  sprite.userData.disposeLabel = () => {
    tex.dispose();
    mat.dispose();
  };
  return sprite;
}

/** 北向南人字箭头组（尖端朝 +z 即南；spacings/scales 可定制，短路段用紧凑间距） */
function createFlowChevrons({ spacings = [-14, 2, 18], scales = [0.7, 0.85, 1.0] } = {}) {
  const root = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: 0x00d4f0,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  function makeChevron(scale = 1) {
    const shape = new THREE.Shape();
    const s = scale;
    shape.moveTo(0, -5.2 * s); // 尖端（南，+z）
    shape.lineTo(-3.6 * s, 0);
    shape.lineTo(-1.8 * s, 0);
    shape.lineTo(0, -2.4 * s);
    shape.lineTo(1.8 * s, 0);
    shape.lineTo(3.6 * s, 0);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  spacings.forEach((z, i) => {
    const c = makeChevron(scales[i] ?? 1);
    c.position.set(0, 0.2 + 0.08 * i, z);
    root.add(c);
  });

  root.userData.arrowMat = mat;
  root.userData.disposeArrow = () => {
    root.traverse((o) => o.geometry?.dispose());
    mat.dispose();
  };
  return root;
}

/** 路口标记（发光点 + 外环；opts 可缩放圆尺寸，上游路口用小尺寸避免喧宾夺主） */
function createIntersectionMarker(
  pos,
  color = 0x00d4f0,
  label = '',
  sublabel = '',
  opts = {},
) {
  const dotR = opts.dotR ?? 4;
  const ringIn = opts.ringIn ?? 6;
  const ringOut = opts.ringOut ?? 9;
  const group = new THREE.Group();

  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(dotR, 32),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  dot.rotation.x = -Math.PI / 2;
  dot.position.set(pos.x, 1.5, pos.z);
  group.add(dot);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(ringIn, ringOut, 48),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(pos.x, 1.4, pos.z);
  group.add(ring);

  let labelSprite = null;
  if (label) {
    labelSprite = createRoadNameLabel(label, '#7ee9ff');
    labelSprite.position.set(pos.x, 12, pos.z);
    group.add(labelSprite);
  }

  group.userData = { dot, ring, labelSprite, dotMat: dot.material, ringMat: ring.material };
  return group;
}

/**
 * Act1 搜索态 fx（兼容工厂）
 * @param {{ intersections?: unknown[], roads?: unknown[] }} _
 */
export function createAct1MapFx({ intersections = [], roads = [] } = {}) {
  const group = new THREE.Group();
  group.name = 'act1ProblemLocateFx';

  const glowTex = makeGlowTexture();

  // ── 城市扫描带（对齐 agent-loop act1 搜索态：表达「系统在理解」）────────
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  intersections.forEach((inter) => {
    const [x, y] = inter.pos || [0, 0];
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });
  if (!Number.isFinite(minX)) {
    minX = -260; maxX = 260; minY = -140; maxY = 140;
  }
  const cityScan = createCityScan({
    minX,
    maxX,
    // z = -y：扫描带以 north 作 Y（对齐 agent-loop act1 的包围盒换算）
    minY: -maxY,
    maxY: -minY,
  });
  // 压低扫描带存在感，不抢工单
  const scanMesh = cityScan.children[0];
  if (scanMesh?.material) scanMesh.material.opacity = 0;
  group.add(cityScan);

  // ── 候选路口点（搜索态随机抽样，对齐 agent-loop act1）────────────────
  const CANDIDATE_COUNT = 16;
  const pool = intersections.slice();
  const picked = [];
  const step = Math.max(1, Math.floor(pool.length / CANDIDATE_COUNT));
  for (let i = 0; i < pool.length && picked.length < CANDIDATE_COUNT; i += step) {
    picked.push(pool[i]);
  }
  const candPositions = new Float32Array(picked.length * 3);
  picked.forEach((inter, i) => {
    const [x, y] = inter.pos || [0, 0];
    candPositions[i * 3] = x;
    candPositions[i * 3 + 1] = 2.5;
    candPositions[i * 3 + 2] = -y;
  });
  const candGeo = new THREE.BufferGeometry();
  candGeo.setAttribute('position', new THREE.BufferAttribute(candPositions, 3));
  const candMat = new THREE.PointsMaterial({
    map: glowTex,
    color: 0x00d4f0,
    size: 18,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const candPoints = new THREE.Points(candGeo, candMat);
  candPoints.visible = false;
  candPoints.renderOrder = 40;
  group.add(candPoints);

  // 上游双路口脉冲
  const pulseTargets = [JIEFANG, KUNSHUN].map((pos) => {
    const m = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xffc24d,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    );
    m.position.set(pos.x, 3.5, pos.z);
    m.scale.set(18, 18, 1);
    group.add(m);
    return m;
  });

  let beat = null;
  let target = 0;
  let targetCand = 0;

  function play(nextBeat) {
    beat = nextBeat;
    if (nextBeat === 'scan') {
      cityScan.trigger();
      target = 0.75;
      targetCand = 0.85;
      candPoints.visible = true;
    } else if (nextBeat === 'settle') {
      target = 0.3;
      targetCand = 0;
    } else if (nextBeat === 'clear') {
      target = 0;
      targetCand = 0;
    }
  }

  function update(time) {
    cityScan.update?.(time);

    const pulse = 0.55 + 0.45 * Math.sin(time * 2.6);
    pulseTargets.forEach((m) => {
      m.material.opacity += (target * pulse - m.material.opacity) * 0.08;
      m.material.needsUpdate = true;
    });

    if (candPoints.visible) {
      const cpulse = 0.55 + 0.45 * Math.sin(time * 4.2);
      candMat.opacity += (targetCand * cpulse - candMat.opacity) * 0.08;
      if (candMat.opacity < 0.02 && targetCand <= 0) {
        candPoints.visible = false;
        candMat.opacity = 0;
      }
    }
  }

  function dispose() {
    cityScan.dispose?.();
    glowTex.dispose();
    candGeo.dispose();
    candMat.dispose();
    pulseTargets.forEach((m) => m.material.dispose());
  }

  return {
    group,
    play,
    update,
    dispose,
    getRoadBreath: () => 0.9,
  };
}

/** planning itemIdx → 搜索态节拍（兼容导出） */
export const ACT1_PLANNING_BEATS = [
  'scan',
  'scan',
  'scan',
  'scan',
  'scan',
  'scan',
];

// ══════════════════════════════════════════════════════════════════
// 3D 路况着色层（高德语义，直接在场景内铺贴地色带）
// ══════════════════════════════════════════════════════════════════

/** case 路况数据（模块级缓存，fx 重建时复用；Mock=PG 嗅探值 / Live=后端读 PG） */
let trafficLinksPromise = null;
function ensureTrafficLinks() {
  if (!trafficLinksPromise) {
    trafficLinksPromise = fetchCaseTrafficLinks().catch(() => []);
  }
  return trafficLinksPromise;
}

/**
 * 沿 polyline 构建世界宽度贴地色带（三角形带）。
 * 与 3D 场景同坐标系：天然与道路几何对齐，无屏幕空间换算。
 * @param {Array<{x:number,z:number}>} pts 世界坐标点（x 东 / z 南）
 * @param {number} halfWidth 半宽（世界单位，1 单位 = 10 m）
 * @param {number} y 离地高度
 * @returns {THREE.BufferGeometry}
 */
function buildRibbonGeometry(pts, halfWidth, y) {
  const positions = [];
  const indices = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    let dx = 0;
    let dz = 0;
    if (i > 0) { dx += p.x - pts[i - 1].x; dz += p.z - pts[i - 1].z; }
    if (i < pts.length - 1) { dx += pts[i + 1].x - p.x; dz += pts[i + 1].z - p.z; }
    const len = Math.hypot(dx, dz) || 1;
    const px = -dz / len;
    const pz = dx / len;
    positions.push(p.x + px * halfWidth, y, p.z + pz * halfWidth);
    positions.push(p.x - px * halfWidth, y, p.z - pz * halfWidth);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = i * 2 + 2;
    const d = i * 2 + 3;
    indices.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  return geo;
}

/** 路况层几何参数（贴地，覆盖车道宽度） */
const TRAFFIC_RIBBON = {
  coreY: 0.62,      // 核心色带离地高度（覆盖路面）
  coreHalfWidth: 0.95,  // 半宽 ≈ 9.5 m（约 5 车道）
  glowY: 0.55,      // 发光下衬离地高度
  glowHalfWidth: 1.8,   // 半宽 ≈ 18 m
};

/**
 * Act2 定位态 fx（兼容工厂，无渠化）
 * @param {{ project?: (lon: number, lat: number) => [number, number] }} opts
 */
export function createAct2MapFx({ project: _project } = {}) {
  const group = new THREE.Group();
  group.name = 'act2ProblemLocateCorridorFx';

  const glowTex = makeGlowTexture();

  // ── 飞入锚环（走廊中点）──────────────────────────────────────────
  const anchorRing = new THREE.Mesh(
    new THREE.RingGeometry(10, 16, 48),
    new THREE.MeshBasicMaterial({
      color: 0x00d4f0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  anchorRing.rotation.x = -Math.PI / 2;
  anchorRing.position.set(CORRIDOR_CENTER.x, 1.2, CORRIDOR_CENTER.z);
  anchorRing.visible = false;
  anchorRing.renderOrder = 42;
  group.add(anchorRing);

  // ── 主路径（上游 → 目标 → 下游，对齐 agent-loop act2 的 pathLine）────
  const mainPathWorld = [
    { x: KUNSHUN.x, z: KUNSHUN.z },
    { x: JIEFANG.x, z: JIEFANG.z },
    { x: JINGSHI.x, z: JINGSHI.z },
  ];
  if (DOWNSTREAM_NODE) mainPathWorld.push({ x: DOWNSTREAM_NODE.x, z: DOWNSTREAM_NODE.z });

  const corridorGeo = new THREE.BufferGeometry().setFromPoints(
    mainPathWorld.map((p) => new THREE.Vector3(p.x, 2.2, p.z)),
  );
  const corridorMat = new THREE.LineBasicMaterial({
    color: 0x66e0ff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const corridorLine = new THREE.Line(corridorGeo, corridorMat);
  corridorLine.visible = false;
  corridorLine.renderOrder = 43;
  group.add(corridorLine);

  // 走廊发光宽带
  const glowGeo = new THREE.BufferGeometry().setFromPoints(
    mainPathWorld.map((p) => new THREE.Vector3(p.x, 1.6, p.z)),
  );
  const glowMat = new THREE.LineBasicMaterial({
    color: 0x00d4f0,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const glowLine = new THREE.Line(glowGeo, glowMat);
  glowLine.visible = false;
  glowLine.renderOrder = 42;
  group.add(glowLine);

  // ── 路口标记（由 SPATIAL_SCENE 解析：上游/下游小圆、目标原尺寸）────────
  const markers = [
    createIntersectionMarker(KUNSHUN, 0xffc24d, corridorNodes.upstream[0]?.name || '坤顺路与奥体西路路口', '', {
      dotR: 2.2,
      ringIn: 3.2,
      ringOut: 4.8,
    }),
    createIntersectionMarker(JIEFANG, 0xff8a3d, corridorNodes.upstream[1]?.name || '解放路与奥体西路路口', '', {
      dotR: 2.2,
      ringIn: 3.2,
      ringOut: 4.8,
    }),
    // 目标路口保持原尺寸（诊断对象强调）
    createIntersectionMarker(JINGSHI, 0x00d4f0, corridorNodes.target.name || '经十路与奥体西路路口'),
  ];
  // 下游节点（青绿小圆，对齐 agent-loop act2 的 downstream 节点展示）
  if (DOWNSTREAM_NODE) {
    markers.push(createIntersectionMarker(DOWNSTREAM_NODE, 0x3ddc97, corridorNodes.downstream[0]?.name || '奥体西路与无名道路路口', '', {
      dotR: 2.2,
      ringIn: 3.2,
      ringOut: 4.8,
    }));
  }
  markers.forEach((m) => {
    m.visible = false;
    group.add(m);
  });

  // ── 轴路名（奥体西路沿走廊 + 经十路目标口两侧）────────────────────
  const labelGroup = new THREE.Group();
  labelGroup.visible = false;
  labelGroup.name = 'act2AxisRoadLabels';
  group.add(labelGroup);
  const labelMats = [];
  const axisLabels = [
    // 奥体西路：仅保留右侧一份（左侧删除），并向左微调靠近走廊
    { text: '奥体西路', pos: { x: CORRIDOR_CENTER.x + 15, z: CORRIDOR_CENTER.z + 10 } },
    { text: '经十路', pos: { x: JINGSHI.x + 40, z: JINGSHI.z } },
    { text: '经十路', pos: { x: JINGSHI.x - 40, z: JINGSHI.z } },
  ];
  axisLabels.forEach(({ text, pos }) => {
    const spr = createRoadNameLabel(text);
    spr.position.set(pos.x, 10, pos.z);
    labelGroup.add(spr);
    labelMats.push(spr.material);
  });

  // ── 北向南流向人字箭头（沿走廊推进）──────────────────────────────
  const chevrons = createFlowChevrons();
  chevrons.visible = false;
  const corridorTravelZ = JINGSHI.z - KUNSHUN.z; // >0：南向为 +z
  const corridorTravelX = JINGSHI.x - KUNSHUN.x;
  const corridorLen = Math.hypot(corridorTravelX, corridorTravelZ) || 1;
  chevrons.position.set(KUNSHUN.x, 2.8, KUNSHUN.z);
  chevrons.renderOrder = 45;
  group.add(chevrons);

  // ── 解放路东西向汇入箭头（西向东，汇入解放路口；不跨越奥体西路）────────
  // 用紧凑间距，箭头终止于解放路与奥体西路交界处，不横穿主干道
  const ewChevrons = createFlowChevrons({
    spacings: [-8, 0, 8],
    scales: [0.7, 0.85, 1.0],
  });
  ewChevrons.visible = false;
  ewChevrons.rotation.y = Math.PI / 2; // 尖端 +Z → +X（东）
  const ewTravelX = JIEFANG_EW_END.x - JIEFANG_EW_START.x; // >0 东向
  const ewTravelZ = JIEFANG_EW_END.z - JIEFANG_EW_START.z;
  const ewLen = Math.hypot(ewTravelX, ewTravelZ) || 1;
  ewChevrons.position.set(JIEFANG_EW_START.x, 2.8, JIEFANG_EW_START.z);
  ewChevrons.renderOrder = 45;
  group.add(ewChevrons);

  // ── 解放路东西向汇入箭头（东向西，汇入解放路口；不跨越奥体西路）────────
  const weChevrons = createFlowChevrons({
    spacings: [-8, 0, 8],
    scales: [0.7, 0.85, 1.0],
  });
  weChevrons.visible = false;
  weChevrons.rotation.y = -Math.PI / 2; // 尖端 +Z → -X（西）
  const weTravelX = JIEFANG_WE_END.x - JIEFANG_WE_START.x; // <0 西向
  const weTravelZ = JIEFANG_WE_END.z - JIEFANG_WE_START.z;
  const weLen = Math.hypot(weTravelX, weTravelZ) || 1;
  weChevrons.position.set(JIEFANG_WE_START.x, 2.8, JIEFANG_WE_START.z);
  weChevrons.renderOrder = 45;
  group.add(weChevrons);

  // ── 上游双路口指标脉冲（解放 / 坤顺；小环，避免盖住路况色带）────────
  const metricPulseTargets = [JIEFANG, KUNSHUN].map((pos) => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(5, 8, 48),
      new THREE.MeshBasicMaterial({
        color: 0xff8a3d,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, 1.3, pos.z);
    ring.visible = false;
    group.add(ring);
    return ring;
  });

  // ── 3D 路况着色层（高德语义：case 覆盖北入口 + 上游两个路段）────────
  const trafficGroup = new THREE.Group();
  trafficGroup.name = 'act2TrafficColorRibbons';
  trafficGroup.visible = false;
  group.add(trafficGroup);
  const trafficRibbons = []; // { glow, core, state, link }
  let trafficReady = false;
  let disposed = false;

  ensureTrafficLinks().then((links) => {
    if (disposed) return;
    links.forEach((link) => {
      const pts = (link.geom?.coordinates || []).map(([lon, lat]) => {
        const [x, y] = project(lon, lat);
        return { x, z: -y };
      });
      if (pts.length < 2) return;

      const state = link.derived_state;
      const colorHex = TRAFFIC_STATE_COLORS[state] ?? TRAFFIC_STATE_COLORS.null;

      // 发光下衬
      const glow = new THREE.Mesh(
        buildRibbonGeometry(pts, TRAFFIC_RIBBON.glowHalfWidth, TRAFFIC_RIBBON.glowY),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(colorHex),
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        }),
      );
      glow.renderOrder = 40;
      trafficGroup.add(glow);

      // 核心色带（覆盖车道宽度）
      const core = new THREE.Mesh(
        buildRibbonGeometry(pts, TRAFFIC_RIBBON.coreHalfWidth, TRAFFIC_RIBBON.coreY),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(colorHex),
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        }),
      );
      core.renderOrder = 41;
      trafficGroup.add(core);

      trafficRibbons.push({ glow, core, state, link });
    });
    trafficReady = trafficRibbons.length > 0;
  });

  // ── 状态机 ───────────────────────────────────────────────────────
  let beat = null;
  let beatStart = 0;
  let corridorRevealed = false;
  const targets = {
    ring: 0,
    corridor: 0,
    markers: 0,
    labels: 0,
    chevrons: 0,
    pulses: 0,
    traffic: 0,
  };

  function play(nextBeat, time = performance.now() / 1000, _ctx = {}) {
    beat = nextBeat;
    beatStart = time;

    if (nextBeat === 'fly_in') {
      anchorRing.visible = true;
      targets.ring = 0.9;
      targets.corridor = 0;
      targets.markers = 0;
      targets.labels = 0;
      targets.chevrons = 0;
      targets.pulses = 0;
      targets.traffic = 0;
    }

    if (nextBeat === 'channelization') {
      // 无渠化：语义 = 走廊揭示（主线 + 三路口 + 轴路名 + 流向箭头 + 路况色带）
      corridorRevealed = true;
      corridorLine.visible = true;
      glowLine.visible = true;
      markers.forEach((m) => { m.visible = true; });
      labelGroup.visible = true;
      chevrons.visible = true;
      ewChevrons.visible = true;
      weChevrons.visible = true;
      if (trafficReady) trafficGroup.visible = true;
      targets.ring = 0.15;
      targets.corridor = 0.85;
      targets.markers = 0.95;
      targets.labels = 0.9;
      targets.chevrons = 0.85;
      targets.pulses = 0;
      targets.traffic = 0.95;
    }

    if (nextBeat === 'arms') {
      if (!corridorRevealed) return play('channelization', time, _ctx);
      targets.labels = 1;
      targets.chevrons = 0.35;
    }

    if (nextBeat === 'topology') {
      if (!corridorRevealed) return play('channelization', time, _ctx);
      targets.markers = 1;
      targets.labels = 0.7;
    }

    if (nextBeat === 'path') {
      if (!corridorRevealed) return play('channelization', time, _ctx);
      targets.corridor = 0.9;
      targets.markers = 0.85;
      targets.labels = 0.55;
    }

    if (nextBeat === 'settle') {
      targets.ring = 0;
      targets.corridor = 0.75;
      targets.markers = 0.8;
      targets.labels = 0.5;
      targets.chevrons = 0.6;
      targets.pulses = 0.7;
      targets.traffic = 1;
    }

    if (nextBeat === 'dim' || nextBeat === 'handoff') {
      targets.ring = 0;
      targets.corridor = 0.45;
      targets.markers = 0.55;
      targets.labels = 0.35;
      targets.chevrons = 0.3;
      targets.pulses = 0.4;
      targets.traffic = 0.8;
    }

    if (nextBeat === 'clear') {
      targets.ring = 0;
      targets.corridor = 0;
      targets.markers = 0;
      targets.labels = 0;
      targets.chevrons = 0;
      targets.pulses = 0;
      targets.traffic = 0;
      corridorRevealed = false;
    }
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function update(time) {
    const elapsed = time - beatStart;

    if (anchorRing.visible) {
      const pulse = 0.6 + 0.4 * Math.sin(time * 3.2);
      anchorRing.material.opacity = lerp(anchorRing.material.opacity, targets.ring * pulse, 0.1);
      const s = 1 + 0.12 * Math.sin(time * 2.4);
      anchorRing.scale.set(s, s, s);
      if (anchorRing.material.opacity < 0.02 && targets.ring <= 0) {
        anchorRing.visible = false;
        anchorRing.material.opacity = 0;
      }
    }

    if (corridorLine.visible) {
      corridorMat.opacity = lerp(corridorMat.opacity, targets.corridor, 0.08);
      glowMat.opacity = lerp(glowMat.opacity, targets.corridor * 0.4, 0.08);
      if (corridorMat.opacity < 0.02 && targets.corridor <= 0) {
        corridorLine.visible = false;
        glowLine.visible = false;
        corridorMat.opacity = 0;
        glowMat.opacity = 0;
      }
    }

    markers.forEach((m) => {
      if (!m.visible) return;
      m.userData.dotMat.opacity = lerp(m.userData.dotMat.opacity, targets.markers, 0.08);
      m.userData.ringMat.opacity = lerp(m.userData.ringMat.opacity, targets.markers * 0.6, 0.08);
      if (m.userData.labelSprite) {
        m.userData.labelSprite.material.opacity = lerp(
          m.userData.labelSprite.material.opacity,
          targets.labels,
          0.08,
        );
      }
      if (m.userData.dotMat.opacity < 0.02 && targets.markers <= 0) {
        m.visible = false;
      }
    });

    if (labelGroup.visible && labelMats.length) {
      const pulse = beat === 'arms' ? 0.88 + 0.12 * Math.sin(time * 2.6) : 1;
      const want = targets.labels * pulse;
      labelMats.forEach((mat) => {
        mat.opacity = lerp(mat.opacity, want, 0.1);
      });
      if (targets.labels <= 0 && labelMats.every((mat) => mat.opacity < 0.02)) {
        labelGroup.visible = false;
        labelMats.forEach((mat) => { mat.opacity = 0; });
      }
    }

    if (chevrons.visible) {
      const mat = chevrons.userData.arrowMat;
      const pulse = 0.75 + 0.25 * Math.sin(time * 2.8);
      mat.opacity = lerp(mat.opacity, targets.chevrons * pulse, 0.1);
      // 北向南循环推进
      const span = corridorLen * 0.9;
      const travel = ((time * 16) % span);
      chevrons.position.x = KUNSHUN.x + (corridorTravelX / corridorLen) * travel;
      chevrons.position.z = KUNSHUN.z + (corridorTravelZ / corridorLen) * travel;
      if (mat.opacity < 0.02 && targets.chevrons <= 0) {
        chevrons.visible = false;
        mat.opacity = 0;
      }
    }

    if (ewChevrons.visible) {
      const mat = ewChevrons.userData.arrowMat;
      const pulse = 0.75 + 0.25 * Math.sin(time * 2.8);
      mat.opacity = lerp(mat.opacity, targets.chevrons * pulse, 0.1);
      // 西向东循环推进：行程止于解放路与奥体西路交界处，不跨越主干道
      const span = ewLen * 0.48;
      const travel = ((time * 16) % span);
      ewChevrons.position.x = JIEFANG_EW_START.x + (ewTravelX / ewLen) * travel;
      ewChevrons.position.z = JIEFANG_EW_START.z + (ewTravelZ / ewLen) * travel;
      if (mat.opacity < 0.02 && targets.chevrons <= 0) {
        ewChevrons.visible = false;
        mat.opacity = 0;
      }
    }

    if (weChevrons.visible) {
      const mat = weChevrons.userData.arrowMat;
      const pulse = 0.75 + 0.25 * Math.sin(time * 2.8);
      mat.opacity = lerp(mat.opacity, targets.chevrons * pulse, 0.1);
      // 东向西循环推进：行程止于解放路与奥体西路交界处，不跨越主干道
      const span = weLen * 0.33;
      const travel = ((time * 16) % span);
      weChevrons.position.x = JIEFANG_WE_START.x + (weTravelX / weLen) * travel;
      weChevrons.position.z = JIEFANG_WE_START.z + (weTravelZ / weLen) * travel;
      if (mat.opacity < 0.02 && targets.chevrons <= 0) {
        weChevrons.visible = false;
        mat.opacity = 0;
      }
    }

    // 指标脉冲：channelization 揭示 1.2s 后按目标缓入（供信息窗口对齐）
    const pulsesWant = corridorRevealed && elapsed > 1.2 ? targets.pulses || 0.65 : 0;
    metricPulseTargets.forEach((ring, i) => {
      if (!ring.visible && pulsesWant > 0) ring.visible = true;
      const pulse = 0.6 + 0.4 * Math.sin(time * 2.2 + i * 1.7);
      ring.material.opacity = lerp(ring.material.opacity, pulsesWant * pulse, 0.08);
      if (ring.material.opacity < 0.02 && pulsesWant <= 0) ring.visible = false;
    });

    // 3D 路况色带：走廊揭示 0.6s 后淡入（对齐信息窗口）；红/深红呼吸脉冲
    const trafficWant = corridorRevealed && elapsed > 0.6 && trafficReady ? targets.traffic : 0;
    trafficRibbons.forEach((r, i) => {
      const isRed = r.state === 3 || r.state === 4;
      const pulse = isRed ? 0.78 + 0.22 * Math.sin(time * 2.3 + i * 1.7) : 1;
      const want = trafficWant * pulse;
      r.glow.material.opacity = lerp(r.glow.material.opacity, want * 0.35, 0.06);
      r.core.material.opacity = lerp(r.core.material.opacity, want, 0.06);
      // 数据晚于揭示到达时补亮；淡出至近乎全隐时隐藏组
      if (trafficWant > 0 && !trafficGroup.visible) {
        trafficGroup.visible = true;
      }
      if (r.core.material.opacity < 0.02 && trafficWant <= 0 && trafficGroup.visible) {
        trafficGroup.visible = false;
      }
    });
  }

  function dispose() {
    disposed = true;
    glowTex.dispose();
    anchorRing.geometry.dispose();
    anchorRing.material.dispose();
    corridorGeo.dispose();
    corridorMat.dispose();
    glowGeo.dispose();
    glowMat.dispose();
    markers.forEach((m) => {
      m.userData.dot.geometry.dispose();
      m.userData.dotMat.dispose();
      m.userData.ring.geometry.dispose();
      m.userData.ringMat.dispose();
      m.userData.labelSprite?.userData?.disposeLabel?.();
    });
    labelGroup.traverse((o) => o.userData?.disposeLabel?.());
    chevrons.userData.disposeArrow?.();
    ewChevrons.userData.disposeArrow?.();
    weChevrons.userData.disposeArrow?.();
    metricPulseTargets.forEach((r) => {
      r.geometry.dispose();
      r.material.dispose();
    });
    trafficRibbons.forEach((r) => {
      r.glow.geometry.dispose();
      r.glow.material.dispose();
      r.core.geometry.dispose();
      r.core.material.dispose();
    });
    trafficRibbons.length = 0;
  }

  return {
    group,
    play,
    update,
    dispose,
    // 兼容主工程调用面：本幕无渠化
    hasChannelization: () => false,
    ensureChannelization: () => null,
    removeChannelization: () => {},
    detachChannelization: () => null,
    setQueueCarsVisible: () => {},
    boostArrows: () => {},
    getTargetWorld: () => ({ x: CORRIDOR_CENTER.x, y: CORRIDOR_CENTER.y, z: CORRIDOR_CENTER.z }),
    getPathScanTarget: () => ({ x: JIEFANG.x, z: JIEFANG.z }),
  };
}

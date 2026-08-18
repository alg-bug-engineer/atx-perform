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
 *   6. 路况线条层（对齐幕 2 线条形式）：LineSegments2 粗线，
 *      红/深红呼吸脉冲；case 覆盖北入口 + 上游两个路段
 *
 * 无渠化：不调用 createChannelizationLayer；hasChannelization() 恒为 false。
 */
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
// 复用主工程 geo/loader.js 的投影（对齐 agent-loop 的 project / getRoadClass 机制）
import { project } from '../../../geo/loader.js';
import { createCityScan } from '../../../mesh/cityScan.js';
import {
  INTERSECTIONS,
  SPATIAL_SCENE,
} from './fixture.js';
import {
  fetchCaseTrafficLinks,
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

/** 幕 2 风格地图指标钉：数字落在地图，HUD 只讲结论。 */
function createMetricPin(title, lines = [], accent = '#00e5ff') {
  const width = 430;
  const lineH = 34;
  const height = 58 + Math.max(1, lines.length) * lineH;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgba(4, 14, 26, 0.92)';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.62)';
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, width - 4, height - 4);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 5, height);

  ctx.font = '600 24px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillStyle = accent;
  ctx.fillText(title, 22, 34);
  ctx.font = '500 21px "PingFang SC","Microsoft YaHei",sans-serif';
  lines.forEach((line, i) => {
    ctx.fillStyle = i === 0 ? '#f0fbff' : 'rgba(205, 225, 238, 0.9)';
    ctx.fillText(line, 22, 68 + i * lineH);
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    sizeAttenuation: true,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(width * 0.085, height * 0.085, 1);
  sprite.frustumCulled = false;
  sprite.renderOrder = 80;
  sprite.userData.disposePin = () => {
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

  let beat = null;
  let targetCand = 0;

  function play(nextBeat) {
    beat = nextBeat;
    if (nextBeat === 'scan') {
      cityScan.trigger();
      targetCand = 0.85;
      candPoints.visible = true;
    } else if (nextBeat === 'settle') {
      targetCand = 0;
    } else if (nextBeat === 'clear') {
      targetCand = 0;
      candPoints.visible = false;
      candMat.opacity = 0;
      cityScan.stop?.();
    }
  }

  function update(time) {
    cityScan.update?.(time);

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
// 3D 路况层数据工具（case 路况 link：Mock=PG 嗅探值 / Live=后端读 PG）
// ══════════════════════════════════════════════════════════════════

/** case 路况数据（模块级缓存，fx 重建时复用；Mock=PG 嗅探值 / Live=后端读 PG） */
let trafficLinksPromise = null;
function ensureTrafficLinks() {
  if (!trafficLinksPromise) {
    trafficLinksPromise = fetchCaseTrafficLinks().catch(() => []);
  }
  return trafficLinksPromise;
}

// ══════════════════════════════════════════════════════
// 路况线条层（对齐幕 2 inflowTraceLayer 线条形式：
// LineSegments2 粗线 + 顶点色渐亮 + 红/深红呼吸，替代原贴地色带）
// ══════════════════════════════════════════════════════

/** 线条离地高度 / 渐亮参数（对齐幕 2 inflowTraceLayer） */
const TRAFFIC_LINE_Y = 0.62;
const TRAFFIC_LINE_FADE = 0.4;
const TRAFFIC_LINE_TRANS = 0.8;
/** 暗底色（未揭示；对齐幕 2 C_BASE） */
const TL_BASE = new THREE.Color(0x001508);
/** 高德语义终态色（对齐幕 2 线条色板，4 深红沿用幕 1 色板） */
const TL_STATE_COLORS = {
  1: new THREE.Color(0x00cc44),
  2: new THREE.Color(0xffcc00),
  3: new THREE.Color(0xff5a36),
  4: new THREE.Color(0xd0021b),
  null: new THREE.Color(0x56606e),
};

/** 揭示延迟（秒）：问题路段先亮 → 上游 → 周边 context */
function linkRevealDelay(link) {
  if (link.is_problem_link) return 0.2;
  if (link.role === 'north_entrance') return 0.4;
  return 0.8;
}

/**
 * 路况线条层：每条 link 一段粗线，走廊揭示后按延迟从暗底渐亮到终态色；
 * 红/深红 link 呼吸脉冲（对齐幕 1 原色带呼吸语义）。
 * @param {Array<{ geom: { coordinates: number[][] }, derived_state: number|null, is_problem_link?: boolean, role?: string }>} links
 * @param {THREE.Vector2} [resolution]
 */
function buildTrafficLineLayer(links, resolution) {
  const posArr = [];
  const colArr = [];
  const metas = [];
  let edgeBase = 0;

  for (const link of links) {
    const pts = (link.geom?.coordinates || []).map(([lon, lat]) => {
      const [x, y] = project(lon, lat);
      return { x, z: -y };
    });
    if (pts.length < 2) continue;
    const delay = linkRevealDelay(link);
    const final = TL_STATE_COLORS[link.derived_state] ?? TL_STATE_COLORS.null;
    const startEdge = edgeBase;
    for (let i = 0; i < pts.length - 1; i++) {
      posArr.push(pts[i].x, TRAFFIC_LINE_Y, pts[i].z, pts[i + 1].x, TRAFFIC_LINE_Y, pts[i + 1].z);
      colArr.push(TL_BASE.r, TL_BASE.g, TL_BASE.b, TL_BASE.r, TL_BASE.g, TL_BASE.b);
      edgeBase++;
    }
    metas.push({ startEdge, edges: pts.length - 1, delay, final, state: link.derived_state });
  }

  const group = new THREE.Group();
  group.name = 'act1TrafficLines';
  if (posArr.length < 6) {
    group.startReveal = () => {};
    group.updateLines = () => {};
    group.resetLines = () => {};
    group.disposeLines = () => {};
    group.setResolution = () => {};
    return group;
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
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    resolution: resolution ?? new THREE.Vector2(1920, 1080),
  });
  const mesh = new LineSegments2(geo, mat);
  mesh.renderOrder = 41;
  group.add(mesh);

  let revealStart = null;
  const tmp = new THREE.Color();

  /**
   * @param {number} time 当前时间（秒）
   * @param {number} pulseOn 呼吸强度 0~1（走廊揭示后缓入）
   */
  group.updateLines = (time, pulseOn = 1) => {
    if (revealStart == null) return;
    const elapsed = time - revealStart;
    for (const m of metas) {
      const t = Math.max(0, Math.min(1, (elapsed - m.delay) / (TRAFFIC_LINE_FADE + TRAFFIC_LINE_TRANS)));
      tmp.copy(TL_BASE).lerp(m.final, t);
      // 红/深红呼吸（对齐原色带语义；幕 2 无此需求，幕 1 保留强调）
      if (t > 0.9 && (m.state === 3 || m.state === 4)) {
        tmp.multiplyScalar((0.78 + 0.22 * Math.sin(time * 2.3)) * pulseOn + (1 - pulseOn));
      }
      const base = m.startEdge * 6;
      for (let e = 0; e < m.edges; e++) {
        const o = base + e * 6;
        colors[o] = tmp.r; colors[o + 1] = tmp.g; colors[o + 2] = tmp.b;
        colors[o + 3] = tmp.r; colors[o + 4] = tmp.g; colors[o + 5] = tmp.b;
      }
    }
    colorIBuf.needsUpdate = true;
  };

  group.startReveal = (time = performance.now() / 1000) => {
    if (revealStart == null) revealStart = time;
  };

  /** clear 拍：回到暗底，下次揭示重来 */
  group.resetLines = () => {
    revealStart = null;
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = TL_BASE.r; colors[i + 1] = TL_BASE.g; colors[i + 2] = TL_BASE.b;
    }
    colorIBuf.needsUpdate = true;
  };

  group.setResolution = (w, h) => mat.resolution.set(w, h);
  group.userData.lineMat = mat;
  group.disposeLines = () => {
    geo.dispose();
    mat.dispose();
  };
  return group;
}

export { createAct2MapFx } from './scene1LocateFx.js';

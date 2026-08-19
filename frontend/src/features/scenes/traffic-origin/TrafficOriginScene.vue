<template>
  <div class="map-root" ref="containerRef">

    <canvas ref="canvasRef"></canvas>

    <!-- 加载遮罩 -->
    <Transition name="fade">
      <div v-if="loading" class="overlay">
        <div class="loading-inner">
          <div class="loading-ring"></div>
          <p>{{ loadingText }}</p>
        </div>
      </div>
    </Transition>

    <div
      v-if="pageScanActive"
      class="page-scan-mask"
      @animationend="pageScanActive = false"
    ></div>

    <!-- 左上角 HUD -->
    <div v-show="!loading" class="hud">
      <div class="hud-title">
        <span class="title-main">济南交警支队信控智能体</span>
      </div>
    </div>


    <!-- 悬浮路口名称 -->
    <!-- 悬浮路口名称：叙事 Act 播放期间关闭，避免跟随鼠标抢戏 -->
    <div v-if="hoverInter && !focusMode && !narrativeActive" class="hover-label"
      :style="{ left: hoverPos.x + 'px', top: hoverPos.y + 'px' }">
      {{ hoverInter.props.inter_name || '路口' }}
    </div>

    <!-- 角落装饰 -->
    <template v-if="!loading">
      <div class="corner corner-tl"></div>
      <div class="corner corner-tr"></div>
      <div class="corner corner-bl"></div>
      <div class="corner corner-br"></div>
    </template>

    <div v-show="!loading" class="timestamp">{{ timeStr }}</div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue';
import * as THREE from 'three';
import { OrbitControls }    from 'three/addons/controls/OrbitControls.js';
import { computeFlows }            from './geo/topology.js';
import { buildTopology, findBusiestIntersection, findNearestIntersection, traceFlows } from './geo/tracing.js';
import { FlowParticles }           from './mesh/particles.js';
import { createFocusLayer }        from './mesh/focusLayer.js';
import { clearSelection, setSelection, odZonesVisible } from '../../../shared/event-bus.js';
import { ROAD_PARTICLES_VISIBLE } from '../../../shared/constants.js';
import { cityScanTriggered, activeAnalysisTab } from '../../../shared/analysis-state.js';
import {
  narrativeActive,
  act1Phase,
  act1MapBeat,
  act2Phase,
  act2MapBeat,
  flowTraceMapBeat,
  flowTraceReplaySeq,
  act3Phase,
  act3MapBeat,
  act4Phase,
  act4MapBeat,
  act5Phase,
  act5MapBeat,
  act6Phase,
  act6MapBeat,
  act7Phase,
  act7MapBeat,
  act8Phase,
  act8MapBeat,
  captureCamera,
  setAct2MapBeat,
  setAct3MapBeat,
  setAct4MapBeat,
  setAct5MapBeat,
  setAct6MapBeat,
  setAct7MapBeat,
  setAct8MapBeat,
  narrativeMapResetSeq,
} from '../../../shared/narrative-state.js';
import { getActFxCompat, getActCompatExports } from '../../acts/act-registry.js';
import { getFlowTraceScene, getDiagnosisTicket } from '../../../services/caseFixture.js';
import { failLivePipeline, isLiveStrictMode } from '../../../services/livePipelineError.js';
import {
  resolveNetworkIntersection,
} from '../../../shared/case-a-network.js';
import tfcunitData from '../scene-a/tfcunit.json';
import { createJinanBaseMapLayer } from '../../../shared/three/createJinanBaseMapLayer.js';
import { createOSMLayer }          from '../../../shared/three/createOSMLayer.js';
import { project }                 from './geo/loader.js';

const CENTER_LON      = 117.096;
const CENTER_LAT      = 36.662;
const METERS_PER_UNIT = 10;
const DEFAULT_INTER_ID = '6f9d6a722f3651';
const FOCUS_RADIUS_UNITS = 400; // 2km = 200 Three.js单位

/** 地图（含各幕地图特效工厂）初始化完成 */
const emit = defineEmits(['ready']);

// ── Refs ──────────────────────────────────────────────────────────────────────
const containerRef = ref(null);
const canvasRef    = ref(null);
const loading      = ref(true);
const loadingText  = ref('正在加载路网数据…');
const stats        = ref({ roads: 0, particles: 0 });
const timeStr      = ref('');
const focusMode    = ref(false);
const focusInfo    = ref(null);
const hoverInter   = ref(null);
const hoverPos     = ref({ x: 0, y: 0 });
const pageScanActive = ref(false);

// ── Three.js & 数据 ───────────────────────────────────────────────────────────
let renderer, scene, camera, controls;
let osmLayer, baseMapLayer, flowParticles, roadMeshGroup;
let currentFocusLayer = null;
let odZoneGroup = null;
let act1Fx = null;
let act2Fx = null;
let flowTraceFx = null;
let act3Fx = null;
let act4Fx = null;
let act4Congestion = null;
let act5Fx = null;
let act5FlowTrace = null;
let act5FlowTraceOpacity = 1;
let act6Fx = null;
let act7Fx = null;
let act8Fx = null;
let allRoads = [], allIntersections = [], topology = null;

// Act1 镜头：全域 → 干线路段级下钻 + 落地微漂（目标由 Live ticket 解析）
const _act1Cam = {
  mode: 'idle', // 'dive' | 'hold' | 'idle'
  t0: 0,
  duration: 10.8,
  fromPos: new THREE.Vector3(),
  fromTarget: new THREE.Vector3(),
  toPos: new THREE.Vector3(),
  toTarget: new THREE.Vector3(),
  holdPos: new THREE.Vector3(),
  holdTarget: new THREE.Vector3(),
  baseFov: 45,
};

// Act2 镜头：SceneC 式飞入（lerp=0.065）+ 北→南廊道扫视（链式，禁止重播重置）
const _act2Cam = {
  mode: 'idle', // 'fly' | 'sweep' | 'hold' | 'idle'
  lerp: 0.065,
  posTarget: new THREE.Vector3(),
  lookTarget: new THREE.Vector3(),
  onComplete: null,
  sweepT0: 0,
  sweepDur: 1.35,
  sweepFrom: new THREE.Vector3(),
  sweepTo: new THREE.Vector3(),
  sweepLookFrom: new THREE.Vector3(),
  sweepLookTo: new THREE.Vector3(),
  holdPos: new THREE.Vector3(),
  holdTarget: new THREE.Vector3(),
  /** 各镜头只播一次，避免 beat 重复触发导致从起点重播 */
  done: { flyIn: false, sweep: false },
  /** 飞入未完成时 path 先挂起，到位后接着扫 */
  pendingSweep: false,
};

// Act3 镜头：廊道位 → 北进口缓推（lerp≈0.055，链式，禁止从 Act2 起点重播）
const _act3Cam = {
  mode: 'idle', // 'push' | 'hold' | 'idle'
  lerp: 0.055,
  posTarget: new THREE.Vector3(),
  lookTarget: new THREE.Vector3(),
  onComplete: null,
  holdPos: new THREE.Vector3(),
  holdTarget: new THREE.Vector3(),
  done: { pushIn: false },
};

// Act4 镜头：一次揭示双节点 + hold 证据戏（禁止五段推拉闪烁）
const _act4Cam = {
  mode: 'idle', // 'crane' | 'hold' | 'idle'
  lerp: 0.088,
  posTarget: new THREE.Vector3(),
  lookTarget: new THREE.Vector3(),
  onComplete: null,
  holdPos: new THREE.Vector3(),
  holdTarget: new THREE.Vector3(),
  done: {
    reveal: false,
    slack: false,
    settle: false,
  },
};

// Act5 镜头：SceneB 正俯视 + 北扩（lerp≈0.03）
const _act5Cam = {
  mode: 'idle', // 'fly' | 'hold' | 'idle'
  lerp: 0.03,
  posTarget: new THREE.Vector3(),
  lookTarget: new THREE.Vector3(),
  onComplete: null,
  holdPos: new THREE.Vector3(),
  holdTarget: new THREE.Vector3(),
  done: {
    spread: false,
    north: false,
    settle: false,
  },
};

// Act6 镜头：干线廊道 → 丝滑放大近景 → 轻 orbit；案例卡锁死
const _act6Cam = {
  mode: 'idle', // 'fly' | 'orbit' | 'hold' | 'idle'
  lerp: 0.03,
  posTarget: new THREE.Vector3(),
  lookTarget: new THREE.Vector3(),
  onComplete: null,
  holdPos: new THREE.Vector3(),
  holdTarget: new THREE.Vector3(),
  orbit: {
    active: false,
    t0: 0,
    duration: 5.5,
    fromDeg: -4,
    toDeg: 8,
  },
  done: {
    corridor: false,
    close: false,
    orbit: false,
    settle: false,
  },
};

// Act7 镜头：承接近景 → 略拉高控制范围全貌（lerp≈0.03）
const _act7Cam = {
  mode: 'idle', // 'fly' | 'hold' | 'idle'
  lerp: 0.03,
  posTarget: new THREE.Vector3(),
  lookTarget: new THREE.Vector3(),
  onComplete: null,
  holdPos: new THREE.Vector3(),
  holdTarget: new THREE.Vector3(),
  done: {
    lift: false,
    scope: false,
    settle: false,
  },
};

// Act8 镜头：控制范围 → 推近北进口（lerp≈0.065）
const _act8Cam = {
  mode: 'idle', // 'fly' | 'hold' | 'idle'
  lerp: 0.065,
  posTarget: new THREE.Vector3(),
  lookTarget: new THREE.Vector3(),
  onComplete: null,
  holdPos: new THREE.Vector3(),
  holdTarget: new THREE.Vector3(),
  done: {
    approach: false,
    settle: false,
  },
};

function easeInOutQuint(t) {
  return t < 0.5
    ? 16 * t * t * t * t * t
    : 1 - ((-2 * t + 2) ** 5) / 2;
}

// 相机飞行动画（OD 等）
const _camAnim = {
  active: false,
  posTarget:  new THREE.Vector3(),
  lookTarget: new THREE.Vector3(),
  alpha: 0,
  lerp: 0.05,
};

/** 通用镜头缓动（对齐 MapRuntime.animateCamera，供幕 2 流量溯源特效工厂消费） */
function animateCamera({ posTarget, lookTarget, lerp = 0.035 }) {
  if (!camera || !controls) return;
  _camAnim.posTarget.set(posTarget.x, posTarget.y, posTarget.z);
  _camAnim.lookTarget.set(lookTarget.x, lookTarget.y, lookTarget.z);
  _camAnim.lerp = lerp;
  _camAnim.active = true;
  controls.minDistance = 40;
  controls.maxDistance = Math.max(4500, Math.hypot(posTarget.x, posTarget.z) + posTarget.y + 800);
  camera.far = Math.max(camera.far || 3000, controls.maxDistance + 500);
  camera.updateProjectionMatrix();
}

// 射线拾取（复用，避免每次 new）
const _raycaster  = new THREE.Raycaster();
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _groundPt   = new THREE.Vector3();

let animId;

// ── 鼠标 → 地面交点 → Three.js 世界坐标 ──────────────────────────────────────
function screenToWorld(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  const nx = (clientX - rect.left) / rect.width  *  2 - 1;
  const ny = -((clientY - rect.top) / rect.height * 2 - 1);
  _raycaster.setFromCamera({ x: nx, y: ny }, camera);
  return _raycaster.ray.intersectPlane(_groundPlane, _groundPt) ? _groundPt.clone() : null;
}

// ── Three.js 初始化 ───────────────────────────────────────────────────────────
function initThreeJS() {
  const canvas = canvasRef.value;
  const W = containerRef.value.clientWidth;
  const H = containerRef.value.clientHeight;

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x040c1e, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  scene = new THREE.Scene();

  // ── 正北方向正俯视，加载完成后定位到默认路口 ──────────────────────────────
  camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 5000);
  camera.up.set(0, 0, -1);  // 屏幕上方 = 地理正北
  camera.position.set(0, 300, 0);
  camera.lookAt(0, 0, 0);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.panSpeed = 1.4;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.9;
  controls.minDistance = 80;
  controls.maxDistance = 1200;
  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  // 地图交互：左键平移 / 右键旋转 / 滚轮缩放（默认左键是旋转，易误判为「不能平移」）
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.PAN,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  controls.touches = {
    ONE: THREE.TOUCH.PAN,
    TWO: THREE.TOUCH.DOLLY_ROTATE,
  };
  controls.update();

}

// ── 画布点击：射线拾取路口 ────────────────────────────────────────────────────
function onCanvasClick(e) {
  // 分析成因等叙事幕禁止点选路口弹出汇入特效（含演绎结束后）
  if (narrativeActive.value) return;
  if (!allIntersections.length) return;
  const pt = screenToWorld(e.clientX, e.clientY);
  if (!pt) return;
  const inter = findNearestIntersection(pt.x, pt.z, allIntersections, 40);
  if (inter) {
    selectIntersection(inter);
  } else if (focusMode.value) {
    clearFocus();
  }
}

function onCanvasMouseMove(e) {
  // 叙事模式下不拾取悬停路口，避免跟随标签
  if (narrativeActive.value || focusMode.value) {
    hoverInter.value = null;
    return;
  }
  const pt = screenToWorld(e.clientX, e.clientY);
  if (!pt) return;
  const inter = findNearestIntersection(pt.x, pt.z, allIntersections, 25);
  hoverInter.value = inter;
  if (inter) {
    hoverPos.value = { x: e.clientX + 12, y: e.clientY - 8 };
  }
}

// ── 选中路口 ──────────────────────────────────────────────────────────────────
function selectIntersection(inter) {
  if (currentFocusLayer) {
    currentFocusLayer.mesh.dispose?.();
    scene.remove(currentFocusLayer.mesh);
  }

  const traceMap = traceFlows(inter, allRoads, topology, FOCUS_RADIUS_UNITS);

  let inboundCount = 0, outboundCount = 0;
  for (const { isInbound } of traceMap.values()) {
    isInbound ? inboundCount++ : outboundCount++;
  }

  const layer = createFocusLayer(traceMap, inter);
  scene.add(layer.mesh);
  currentFocusLayer = layer;

  roadMeshGroup.traverse(obj => {
    if (obj.material && obj.userData.origOpacity != null) {
      obj.material.opacity = obj.userData.origOpacity * 0.22;
    }
  });

  focusMode.value = true;
  focusInfo.value = { interName: inter.props.inter_name || '未命名路口', inboundCount, outboundCount };
  setSelection({
    type: 'intersection',
    id: inter.props.inter_id,
    name: inter.props.inter_name || '未命名路口',
    payload: { intersection: inter, inboundCount, outboundCount },
  });
}

function clearFocus() {
  if (currentFocusLayer) {
    currentFocusLayer.mesh.dispose?.();
    scene.remove(currentFocusLayer.mesh);
    currentFocusLayer = null;
  }
  roadMeshGroup.traverse(obj => {
    if (obj.material && obj.userData.origOpacity != null) {
      obj.material.opacity = obj.userData.origOpacity;
    }
  });
  focusMode.value = false;
  focusInfo.value = null;
  clearSelection();
}

function triggerCityScan() {
  pageScanActive.value = false;
  requestAnimationFrame(() => {
    pageScanActive.value = true;
  });
}

// ── OD 区域叠加层（复刻 OD飞线电子围栏特效）────────────────────────────────

// 柔和圆形光斑贴图（气体粒子用）
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

// 弧长参数化边界路径，返回 sample(t) → Vector3
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

// 边界气体粒子：沿边界向上升腾
function createBoundaryParticles(ring, wallHeight, glowColor, isOrigin, weight) {
  const group  = new THREE.Group();
  const path   = buildEdgePath(ring, 0);
  const colG   = new THREE.Color(glowColor);
  const colW   = new THREE.Color(0xffffff);
  const COUNT  = isOrigin ? 160 : Math.max(55, Math.round(100 * weight));

  const positions = new Float32Array(COUNT * 3);
  const colors    = new Float32Array(COUNT * 3);
  const sizes     = new Float32Array(COUNT);
  const pLife     = new Float32Array(COUNT);
  const pSpeed    = new Float32Array(COUNT);
  const pMaxH     = new Float32Array(COUNT);
  const pEdgeT    = new Float32Array(COUNT);
  const pDriftX   = new Float32Array(COUNT);
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
    pDriftX[i]   = (Math.random() - 0.5) * 1.2;
    pDriftZ[i]   = (Math.random() - 0.5) * 1.2;
    pBaseSize[i] = isOrigin ? 6 + Math.random() * 7 : 4 + Math.random() * 5;
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
      positions[i * 3]     = pt.x + pDriftX[i] * t * 2.5;
      positions[i * 3 + 1] = h;
      positions[i * 3 + 2] = pt.z + pDriftZ[i] * t * 2.5;
      const alpha = t < 0.2 ? t / 0.2 : t > 0.6 ? (1 - t) / 0.4 : 1.0;
      colors[i * 3]     = pBaseR[i] * alpha;
      colors[i * 3 + 1] = pBaseG[i] * alpha;
      colors[i * 3 + 2] = pBaseB[i] * alpha;
      sizes[i] = pBaseSize[i] * (0.4 + t * 1.4);
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate    = true;
    geo.attributes.size.needsUpdate     = true;
  };
  return group;
}

// 山峰形高度（每顶点，形成锯齿轮廓）
function mountainHeights(ring, maxH) {
  const n    = ring.length;
  const seed = ring.reduce((s, [lon, lat]) => s + lon * 0.1 + lat * 0.13, 0);
  const p1   = (seed % 1) * Math.PI * 2;
  const p2   = ((seed * 1.618) % 1) * Math.PI * 2;
  const p3   = ((seed * 2.718) % 1) * Math.PI * 2;
  return ring.map((_, i) => {
    const a = (i / n) * Math.PI * 2;
    const v = 0.5 + 0.28 * Math.cos(a + p1) + 0.14 * Math.cos(2 * a + p2) + 0.07 * Math.cos(3 * a + p3);
    return maxH * Math.max(0.22, v);
  });
}

// 电子围栏主体：垂直墙 + 顶线 + 白光晕 + 底填充 + 粒子
function createFenceWall(ring, heights, fenceColor, glowColor, isOrigin, weight) {
  const group    = new THREE.Group();
  const _fc      = new THREE.Color(fenceColor).multiplyScalar(1.6);
  const colFence = new THREE.Color(Math.min(1, _fc.r), Math.min(1, _fc.g), Math.min(1, _fc.b));
  const colBase  = new THREE.Color(fenceColor).multiplyScalar(0.10);
  const maxH     = Math.max(...heights);

  // 1. 垂直墙面
  const wallVerts = [], wallColors = [], wallIdxs = [];
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = project(...ring[i]);
    const [x1, y1] = project(...ring[(i + 1) % ring.length]);
    const h0 = heights[i];
    const h1 = heights[(i + 1) % ring.length];
    const bright0 = colFence.clone().lerp(new THREE.Color(0xffffff), (h0 / maxH) * 0.55);
    const bright1 = colFence.clone().lerp(new THREE.Color(0xffffff), (h1 / maxH) * 0.55);
    const base = wallVerts.length / 3;
    wallVerts.push(x0, 0.2, -y0);  wallColors.push(colBase.r,  colBase.g,  colBase.b);
    wallVerts.push(x0, h0,  -y0);  wallColors.push(bright0.r,  bright0.g,  bright0.b);
    wallVerts.push(x1, h1,  -y1);  wallColors.push(bright1.r,  bright1.g,  bright1.b);
    wallVerts.push(x1, 0.2, -y1);  wallColors.push(colBase.r,  colBase.g,  colBase.b);
    wallIdxs.push(base, base + 1, base + 2, base, base + 2, base + 3);
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

  // 2. 顶部主发光线
  const topPts  = ring.map(([lon, lat], i) => { const [x, y] = project(lon, lat); return new THREE.Vector3(x, heights[i], -y); });
  const topGeom = new THREE.BufferGeometry().setFromPoints(topPts);
  const topMat  = new THREE.LineBasicMaterial({
    color: glowColor, transparent: true, opacity: 1.0,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
  });
  group.add(new THREE.LineLoop(topGeom, topMat));

  // 3. 顶部白色光晕线
  const hPts  = ring.map(([lon, lat], i) => { const [x, y] = project(lon, lat); return new THREE.Vector3(x, heights[i] + 0.8, -y); });
  const hGeom = new THREE.BufferGeometry().setFromPoints(hPts);
  const hMat  = new THREE.LineBasicMaterial({
    color: 0xffffff, transparent: true, opacity: isOrigin ? 0.72 : 0.50,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
  });
  group.add(new THREE.LineLoop(hGeom, hMat));

  // 4. 底部填充面
  const shape   = new THREE.Shape(ring.map(([lon, lat]) => { const [x, y] = project(lon, lat); return new THREE.Vector2(x, y); }));
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

  // 5. 边界气体粒子
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

// 区域围栏入口（按 idx 分配颜色方案）
function createOdZoneMeshes(features) {
  const group = new THREE.Group();

  const deepGreen  = new THREE.Color(0x004d1a);
  const lightGreen = new THREE.Color(0x00cc55);
  const deepGGlow  = new THREE.Color(0x007a2a);
  const lightGGlow = new THREE.Color(0x44ff88);
  const DIST_COLORS = [
    { fence: 0x660010, glow: 0xcc0028 },
    { fence: 0xaa0018, glow: 0xff2244 },
    { fence: 0xaa3c00, glow: 0xff6600 },
  ];

  features.forEach((feature, idx) => {
    const ring = feature.geometry.coordinates[0];
    if (!ring?.length) return;

    let fenceColor, glowColor, isOrigin;
    if (idx === 0) {
      fenceColor = 0x003388;
      glowColor  = 0x0066ff;
      isOrigin   = true;
    } else if (idx <= 3) {
      fenceColor = DIST_COLORS[idx - 1].fence;
      glowColor  = DIST_COLORS[idx - 1].glow;
      isOrigin   = false;
    } else {
      const t  = (idx - 3) / Math.max(1, features.length - 4);
      fenceColor = deepGreen.clone().lerp(lightGreen, t).getHex();
      glowColor  = deepGGlow.clone().lerp(lightGGlow, t).getHex();
      isOrigin   = false;
    }

    const weight  = 1.0 - idx / features.length;
    const maxH    = isOrigin ? 48 : 15 + weight * 27;
    const heights = mountainHeights(ring, maxH);
    const fence   = createFenceWall(ring, heights, fenceColor, glowColor, isOrigin, weight);
    group.add(fence);
  });

  group.update = (time) => {
    group.children.forEach(child => child.update?.(time));
  };

  return group;
}

function addOdZonesToScene() {
  if (odZoneGroup || !scene) return;
  odZoneGroup = createOdZoneMeshes(tfcunitData);
  odZoneGroup.traverse(obj => {
    obj.frustumCulled = false;
    obj.geometry?.computeBoundingSphere();
    if (obj.isMesh || obj.isLine || obj.isPoints || obj.isLineSegments) {
      obj.renderOrder = 100;
    }
  });
  scene.add(odZoneGroup);

  // ── 计算 OD 区域包围盒，飞行至俯瞰全局 ────────────────────────────────────
  const box = new THREE.Box3().setFromObject(odZoneGroup);
  const boxCenter = new THREE.Vector3();
  const boxSize   = new THREE.Vector3();
  box.getCenter(boxCenter);
  box.getSize(boxSize);
  boxCenter.y = 0;

  // 计算能看到全部区域的相机高度（45° FOV，两侧留 20% 余量）
  const halfSpan = Math.max(boxSize.x, boxSize.z) * 0.55;
  const fovRad   = (45 * Math.PI) / 180;
  const idealH   = halfSpan / Math.tan(fovRad / 2);
  const flyH     = Math.min(Math.max(idealH, 800), 3000);

  // 更新 controls 最大缩放距离，让用户可以继续拉远
  controls.maxDistance = flyH * 2.5;
  controls.minDistance = 80;

  // 设置飞行目标
  _camAnim.posTarget.set(boxCenter.x, flyH, boxCenter.z);
  _camAnim.lookTarget.copy(boxCenter);
  _camAnim.alpha  = 0;
  _camAnim.active = true;
}

// ── 主初始化 ──────────────────────────────────────────────────────────────────
async function init() {
  try {
    await initInner();
  } catch (err) {
    console.error('[TrafficOriginScene] init failed', err);
    loadingText.value = `路网加载失败：${err instanceof Error ? err.message : String(err)}`;
  } finally {
    loading.value = false;
    // 分幕独立调试时，幕舞台要等地图特效工厂就位再发节拍，否则首拍会被丢掉
    emit('ready');
  }
}

async function initInner() {
  initThreeJS();

  loadingText.value = '正在加载 OSM 底图…';
  osmLayer = await createOSMLayer();
  osmLayer.traverse(o => { o.renderOrder = (o.renderOrder ?? 0) - 20; });
  scene.add(osmLayer);

  loadingText.value = '正在加载路网数据…';
  baseMapLayer = await createJinanBaseMapLayer({ showRoads: false });
  scene.add(baseMapLayer.group);

  loadingText.value = '正在构建路网…';
  allRoads         = computeFlows(baseMapLayer.roads);
  allIntersections = baseMapLayer.intersections;
  topology         = buildTopology(allRoads);

  roadMeshGroup = baseMapLayer.roadMeshGroup;

  // ── 相机初始位置：以千佛山东路与历山路路口为中心，全域态势用大视野 ──────────
  const isCityTab = activeAnalysisTab.value === 'city';

  const initInter =
    allIntersections.find(i => i.props.inter_id === DEFAULT_INTER_ID) ||
    allIntersections[0];

  if (initInter) {
    const [ix, iy] = initInter.pos;
    const camH      = isCityTab ? 1400 : 500;
    const maxDist   = isCityTab ? 4000 : 1200;
    const minDist   = isCityTab ? 200  : 80;
    camera.position.set(ix, camH, -iy);
    camera.lookAt(ix, 0, -iy);
    camera.near = isCityTab ? 1 : 0.5;
    camera.far  = isCityTab ? 4500 : 3000;
    camera.updateProjectionMatrix();
    controls.target.set(ix, 0, -iy);
    controls.minDistance = minDist;
    controls.maxDistance = maxDist;
    controls.update();
  }

  // ── 车流粒子：仅主干，严格贴路；Act2 切换为路口廊道局部粒子
  // 开关 ROAD_PARTICLES_VISIBLE（shared/constants.js）控制是否显示
  if (ROAD_PARTICLES_VISIBLE) {
    flowParticles = new FlowParticles(allRoads, 5000, {
      allowedClasses: ['express', 'arterial'],
      speedScale: 1.35,
    });
    scene.add(flowParticles.mesh);
  }

  // Act1 搜索态图层（幕 1 模块注册表特效工厂）
  {
    const { createAct1MapFx } = getActFxCompat();
    if (createAct1MapFx) {
      act1Fx = createAct1MapFx({ intersections: allIntersections, roads: allRoads });
      scene.add(act1Fx.group);
    }
  }

  // Act2 定位态图层（无渠化：走廊 / 双路口 / 流向箭头）
  {
    const { createAct2MapFx } = getActFxCompat();
    if (createAct2MapFx) {
        act2Fx = createAct2MapFx({ project, roads: allRoads, intersections: allIntersections });
      scene.add(act2Fx.group);
    }
  }

  // 幕 2 流量溯源图层（原生幕：成因分析完整演绎，HUD 经 flowTraceHud 桥接舞台）
  {
    const { createAct2FlowMapFx } = getActFxCompat();
    if (createAct2FlowMapFx) {
      flowTraceFx = await createAct2FlowMapFx(
        { scene, camera, controls, animateCamera },
        {
          roads: allRoads,
          intersections: allIntersections,
          topology,
          getResolution: () => new THREE.Vector2(
            containerRef.value?.clientWidth || window.innerWidth,
            containerRef.value?.clientHeight || window.innerHeight,
          ),
        },
        {
          onComplete: () => {
            getActCompatExports().markFlowTraceRevealed?.();
            getActCompatExports().completeFlowTrace?.();
          },
        },
      );
    }
  }

  // 对齐参考项目：Live 无推演数据时不上业务图层；Mock 有 fixture 可预建。
  // Act3–8 进幕 watch 会 dispose+create，此处 Live 跳过避免 null.toFixed 崩冷启动。
  if (!isLiveStrictMode()) {
    const fxCompat = getActFxCompat();
    if (fxCompat.createAct3MapFx) { act3Fx = fxCompat.createAct3MapFx({ project }); scene.add(act3Fx.group); }
    if (fxCompat.createAct4MapFx) { act4Fx = fxCompat.createAct4MapFx({ project }); scene.add(act4Fx.group); }
    if (fxCompat.createAct5MapFx) { act5Fx = fxCompat.createAct5MapFx({ project }); scene.add(act5Fx.group); }
    if (fxCompat.createAct6MapFx) { act6Fx = fxCompat.createAct6MapFx({ project }); scene.add(act6Fx.group); }
    if (fxCompat.createAct7MapFx) { act7Fx = fxCompat.createAct7MapFx({ project }); scene.add(act7Fx.group); }
    if (fxCompat.createAct8MapFx) { act8Fx = fxCompat.createAct8MapFx({ project }); scene.add(act8Fx.group); }
  }

  stats.value = { roads: allRoads.length, particles: flowParticles?.count ?? 0 };

  scene.traverse(obj => { obj.frustumCulled = false; });

  // 叙事 Act1：保持全域，不自动钉死路口；旧分析模式仍自动选中
  if (!narrativeActive.value) {
    const defaultInter =
      allIntersections.find(inter => inter.props.inter_id === DEFAULT_INTER_ID) ||
      findBusiestIntersection(allIntersections, topology);
    if (defaultInter) selectIntersection(defaultInter);
  } else {
    // 叙事开场：略抬高俯视，便于搜索态
    if (initInter) {
      const [ix, iy] = initInter.pos;
      camera.position.set(ix, 1600, -iy + 40);
      controls.target.set(ix, 0, -iy);
      controls.maxDistance = 4500;
      controls.update();
    }
  }

  animate();
}

// ── 渲染循环 ──────────────────────────────────────────────────────────────────
function animate() {
  animId = requestAnimationFrame(animate);

  const t = performance.now() / 1000;
  flowParticles?.update();
  baseMapLayer?.update(t);
  if (currentFocusLayer) currentFocusLayer.mesh.update?.(t);
  act1Fx?.update(t);
  act2Fx?.update(t);
  flowTraceFx?.update?.(t);
  act3Fx?.update(t);
  act4Fx?.update(t);
  act5Fx?.update(t);
  act6Fx?.update(t);
  act7Fx?.update(t);
  act8Fx?.update(t);
  if (act5FlowTrace) {
    act5FlowTrace.update?.(t);
    applyAct5FlowTraceOpacity(act5FlowTraceOpacity);
  } else {
    act4Congestion?.update?.(t);
  }

  // Act8 北进口方案优先；其次 Act7 控制范围；再次 Act6…
  if (_act8Cam.mode !== 'idle' && camera && controls) {
    updateAct8Camera(t);
  } else if (_act7Cam.mode !== 'idle' && camera && controls) {
    updateAct7Camera(t);
  } else if (_act6Cam.mode !== 'idle' && camera && controls) {
    updateAct6Camera(t);
  } else if (_act5Cam.mode !== 'idle' && camera && controls) {
    updateAct5Camera(t);
  } else if (_act4Cam.mode !== 'idle' && camera && controls) {
    updateAct4Camera(t);
  } else if (_act3Cam.mode !== 'idle' && camera && controls) {
    updateAct3Camera(t);
  } else if (_act2Cam.mode !== 'idle' && camera && controls) {
    updateAct2Camera(t);
  } else if (_act1Cam.mode !== 'idle' && camera && controls) {
    updateAct1Camera(t);
  } else if (_camAnim.active && camera && controls) {
    // 相机飞行动画（每帧按目标 lerp，类似 ease-out）
    camera.position.lerp(_camAnim.posTarget, _camAnim.lerp || 0.05);
    controls.target.lerp(_camAnim.lookTarget, _camAnim.lerp || 0.05);
    if (camera.position.distanceTo(_camAnim.posTarget) < 3) {
      camera.position.copy(_camAnim.posTarget);
      controls.target.copy(_camAnim.lookTarget);
      _camAnim.active = false;
    }
  }

  if (
    _act8Cam.mode === 'idle'
    && _act7Cam.mode === 'idle'
    && _act6Cam.mode === 'idle'
    && _act5Cam.mode === 'idle'
    && _act4Cam.mode === 'idle'
    && _act3Cam.mode === 'idle'
    && _act2Cam.mode === 'idle'
    && _act1Cam.mode === 'idle'
  ) {
    controls?.update();
  } else if (
    (_act8Cam.mode === 'hold' || _act7Cam.mode === 'hold' || _act6Cam.mode === 'hold' || _act5Cam.mode === 'hold' || _act4Cam.mode === 'hold'
      || _act3Cam.mode === 'hold' || _act2Cam.mode === 'hold')
    && controls?.enabled
  ) {
    // hold 微漂期间仍跑 damping；用户 pointerdown 会 release
    controls.update();
  }

  // OD 区域围栏动画（粒子升腾 + 脉冲）
  if (odZoneGroup) {
    odZoneGroup.update?.(t);
  }

  // 路网呼吸（Act1 object/problem）
  const breath = act1Fx?.getRoadBreath?.() || 0;
  if (roadMeshGroup && breath > 0 && !focusMode.value) {
    const pulse = 0.85 + 0.15 * Math.sin(t * 2.4);
    roadMeshGroup.traverse(obj => {
      if (obj.material && obj.userData.origOpacity != null) {
        obj.material.opacity = obj.userData.origOpacity * (1 + breath * 0.35 * pulse);
      }
    });
  }

  const now = new Date();
  timeStr.value =
    `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ` +
    `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

  renderer.render(scene, camera);
}

// ── 窗口响应 ──────────────────────────────────────────────────────────────────
function onResize() {
  if (!renderer || !containerRef.value) return;
  const W = containerRef.value.clientWidth;
  const H = containerRef.value.clientHeight;
  renderer.setSize(W, H);
  if (camera?.isPerspectiveCamera) {
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  }
  act4Congestion?.setResolution?.(W, H);
  act5FlowTrace?.setResolution?.(W, H);
  flowTraceFx?.setResolution?.(W, H);
  act2Fx?.setResolution?.(W, H);
}

// 监听全局扫描触发 → 播放页面扫描视觉特效
watch(cityScanTriggered, (val) => {
  if (val) triggerCityScan();
});

// 监听 OD 区域可见性 → 在地图上渲染区域多边形
watch(odZonesVisible, (val) => {
  if (val) addOdZonesToScene();
});

function resolveLiveTargetWorld() {
  const ticket = getDiagnosisTicket();
  const lng = ticket?.lng;
  const lat = ticket?.lat;
  const interId = ticket?.inter_id;
  if (interId) {
    const byId = resolveNetworkIntersection(allIntersections, { interId, lng, lat });
    if (byId?.pos) return { x: byId.pos[0], y: byId.pos[1] };
  }
  if (Number.isFinite(lng) && Number.isFinite(lat)) {
    const near = resolveNetworkIntersection(allIntersections, { lng, lat });
    if (near?.pos) return { x: near.pos[0], y: near.pos[1] };
    const [x, y] = project(lng, lat);
    return { x, y };
  }
  // 仅在已有 Live 工单却缺坐标时硬失败；地图冷启动无 ticket 时返回原点占位
  if (isLiveStrictMode() && ticket?.intersection_name) {
    failLivePipeline('Live 目标坐标缺失，无法定位镜头');
  }
  return { x: 0, y: 0 };
}

/**
 * Act1：全域俯视 → 干线路段级慢镜头下钻
 * 不落到渠化特写，只收到廊道尺度，丝滑 ease + 收束 FOV
 */
function startAct1CorridorDive() {
  if (!camera || !controls) return;

  const { x: tx, y: ty } = resolveLiveTargetWorld();
  // 干线尺度高度（介于全域 1600 与路口特写 110 之间，对齐 SceneE 廊道气质）
  const endH = 540;
  const southBias = 110;

  _act1Cam.fromPos.copy(camera.position);
  _act1Cam.fromTarget.copy(controls.target);
  _act1Cam.toPos.set(tx, endH, -ty + southBias);
  _act1Cam.toTarget.set(tx, 0, -ty);
  _act1Cam.baseFov = camera.fov || 45;
  _act1Cam.t0 = performance.now() / 1000;
  _act1Cam.duration = 10.8;
  _act1Cam.mode = 'dive';

  _camAnim.active = false;
  controls.enabled = false;
  controls.maxDistance = Math.max(controls.maxDistance, 4500);
}

function updateAct1Camera(t) {
  if (_act1Cam.mode === 'dive') {
    const raw = Math.min(1, (t - _act1Cam.t0) / _act1Cam.duration);
    const e = easeInOutQuint(raw);

    camera.position.lerpVectors(_act1Cam.fromPos, _act1Cam.toPos, e);
    controls.target.lerpVectors(_act1Cam.fromTarget, _act1Cam.toTarget, e);

    // 下钻中略收 FOV，增强「压近」镜头感
    if (camera.isPerspectiveCamera) {
      camera.fov = _act1Cam.baseFov - e * 4; // 45 → ~41
      camera.updateProjectionMatrix();
    }

    if (raw >= 1) {
      camera.position.copy(_act1Cam.toPos);
      controls.target.copy(_act1Cam.toTarget);
      _act1Cam.holdPos.copy(_act1Cam.toPos);
      _act1Cam.holdTarget.copy(_act1Cam.toTarget);
      _act1Cam.t0 = t;
      _act1Cam.mode = 'hold';
    }
    return;
  }

  if (_act1Cam.mode === 'hold') {
    // 落地后极慢呼吸微漂，保持镜头活着但不抢戏
    const u = t - _act1Cam.t0;
    const amp = 7;
    const ox = Math.sin(u * 0.09) * amp;
    const oz = Math.cos(u * 0.07) * amp * 0.55;
    camera.position.set(
      _act1Cam.holdPos.x + ox,
      _act1Cam.holdPos.y + Math.sin(u * 0.06) * 3,
      _act1Cam.holdPos.z + oz,
    );
    controls.target.set(
      _act1Cam.holdTarget.x + ox * 0.28,
      0,
      _act1Cam.holdTarget.z + oz * 0.28,
    );
  }
}

function stopAct1Camera() {
  _act1Cam.mode = 'idle';
  if (camera?.isPerspectiveCamera) {
    camera.fov = _act1Cam.baseFov || 45;
    camera.updateProjectionMatrix();
  }
  if (controls && _act2Cam.mode === 'idle') controls.enabled = true;
}

function startAct1Drift() {
  // 兼容旧调用：改为廊道下钻
  startAct1CorridorDive();
}

function stopAct1Drift() {
  stopAct1Camera();
}

/** SceneC 式飞入：从当前机位连续 lerp，禁止瞬切回起点 */
function startAct2Fly(px, py, pz, lx, lz, onComplete = null) {
  if (!camera || !controls) return;
  stopAct1Camera();
  _camAnim.active = false;
  // 从「当前」位姿开始，不重置相机
  _act2Cam.posTarget.set(px, py, pz);
  _act2Cam.lookTarget.set(lx, 0, lz);
  _act2Cam.onComplete = onComplete;
  _act2Cam.mode = 'fly';
  _act2Cam.lerp = 0.065;
  controls.enabled = false;
  controls.minPolarAngle = 0;
  controls.minDistance = Math.min(controls.minDistance, 50);
  controls.maxDistance = Math.max(controls.maxDistance, 4500);
}

/** 幕 1 正俯视平移：高度不变，镜头垂直对准地面目标，不做 2.5D 侧倾。 */
function startAct2Pan(lx, lz, onComplete = null, { height } = {}) {
  const y = Number.isFinite(height) ? height : camera.position.y;
  startAct2Fly(lx, y, lz, lx, lz, onComplete);
}

function beginAct2PathSweep() {
  if (!camera || !controls || !act2Fx) return;
  if (_act2Cam.done.sweep) return; // 只播一次
  if (_act2Cam.mode === 'fly' || _act2Cam.mode === 'sweep') {
    // 上一镜未完：挂起，到位后再扫，避免打断后重来
    _act2Cam.pendingSweep = true;
    return;
  }

  const scan = act2Fx.getPathScanTarget();
  const tw = act2Fx.getTargetWorld();
  _act2Cam.sweepFrom.copy(camera.position);
  _act2Cam.sweepLookFrom.copy(controls.target);
  // 沿北→南微平移，略抬高看廊道（从当前点出发）
  _act2Cam.sweepTo.set(scan.x, Math.max(camera.position.y, 180), scan.z + 55);
  _act2Cam.sweepLookTo.set(tw.x, 0, scan.z);
  _act2Cam.sweepT0 = performance.now() / 1000;
  _act2Cam.sweepDur = 1.35;
  _act2Cam.mode = 'sweep';
  _act2Cam.pendingSweep = false;
  _act2Cam.done.sweep = true;
  controls.enabled = false;
}

function finishAct2Hold({ allowDrift = false } = {}) {
  if (!camera || !controls) return;
  captureCamera({
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
    lerp: 0.065,
  });
  if (allowDrift) {
    _act2Cam.holdPos.copy(camera.position);
    _act2Cam.holdTarget.copy(controls.target);
    _act2Cam.mode = 'hold';
  } else {
    _act2Cam.mode = 'idle';
    _act2Cam.onComplete = null;
  }
  controls.enabled = true;

  // 飞入结束后若挂起了扫视，立刻接着播（链式）
  if (_act2Cam.pendingSweep && !_act2Cam.done.sweep) {
    beginAct2PathSweep();
  }
}

/** 用户开始拖图 / 滚轮时立刻释放叙事镜头占用 */
function releaseAct2CameraForUser() {
  if (_act2Cam.mode === 'idle') return;
  _act2Cam.mode = 'idle';
  _act2Cam.onComplete = null;
  _act2Cam.pendingSweep = false;
  if (controls) controls.enabled = true;
  if (camera && controls) {
    captureCamera({
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
      lerp: 0.065,
    });
  }
}

/** Act3：从当前廊道位连续缓推至北进口特写，禁止瞬切回起点 */
function startAct3Push(px, py, pz, lx, lz, onComplete = null) {
  if (!camera || !controls) return;
  // 结束 Act2 占用，从当前位姿接着推
  _act2Cam.mode = 'idle';
  _act2Cam.onComplete = null;
  _camAnim.active = false;
  _act3Cam.posTarget.set(px, py, pz);
  _act3Cam.lookTarget.set(lx, 0, lz);
  _act3Cam.onComplete = onComplete;
  _act3Cam.mode = 'push';
  _act3Cam.lerp = 0.055;
  controls.enabled = false;
  controls.minDistance = Math.min(controls.minDistance, 40);
  controls.maxDistance = Math.max(controls.maxDistance, 4500);
}

function finishAct3Hold({ allowDrift = false } = {}) {
  if (!camera || !controls) return;
  captureCamera({
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
    lerp: 0.055,
  });
  if (allowDrift) {
    _act3Cam.holdPos.copy(camera.position);
    _act3Cam.holdTarget.copy(controls.target);
    _act3Cam.mode = 'hold';
  } else {
    _act3Cam.mode = 'idle';
    _act3Cam.onComplete = null;
  }
  controls.enabled = true;
}

function releaseAct3CameraForUser() {
  if (_act3Cam.mode === 'idle') return;
  _act3Cam.mode = 'idle';
  _act3Cam.onComplete = null;
  if (controls) controls.enabled = true;
  if (camera && controls) {
    captureCamera({
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
      lerp: 0.055,
    });
  }
}

function updateAct3Camera(t) {
  if (_act3Cam.mode === 'push') {
    camera.position.lerp(_act3Cam.posTarget, _act3Cam.lerp);
    controls.target.lerp(_act3Cam.lookTarget, _act3Cam.lerp);
    camera.lookAt(controls.target);
    const done =
      camera.position.distanceTo(_act3Cam.posTarget) < 2
      && controls.target.distanceTo(_act3Cam.lookTarget) < 1;
    if (done) {
      camera.position.copy(_act3Cam.posTarget);
      controls.target.copy(_act3Cam.lookTarget);
      camera.lookAt(controls.target);
      const cb = _act3Cam.onComplete;
      _act3Cam.onComplete = null;
      if (cb) cb();
      else finishAct3Hold({ allowDrift: true });
    }
    return;
  }

  if (_act3Cam.mode === 'hold') {
    const u = t;
    const amp = 1.6;
    camera.position.set(
      _act3Cam.holdPos.x + Math.sin(u * 0.06) * amp,
      _act3Cam.holdPos.y + Math.sin(u * 0.045) * 0.9,
      _act3Cam.holdPos.z + Math.cos(u * 0.05) * amp * 0.45,
    );
    controls.target.copy(_act3Cam.holdTarget);
  }
}

function ensureAct3PushIn(onArrive) {
  if (!act3Fx || !camera) return;
  if (_act3Cam.done.pushIn) {
    onArrive?.();
    return;
  }
  _act3Cam.done.pushIn = true;
  const cam = act3Fx.getApproachCam();
  startAct3Push(cam.x, cam.y, cam.z, cam.lx, cam.lz, onArrive);
}

function onAct3PushArrive() {
  if (!act3Fx) return;
  // 到位后若尚未上蓄车线，等下一拍；此处仅 hold
  finishAct3Hold({ allowDrift: true });
}

/** Act4：从北进口特写 crane-out 南移至双节点构图，禁止硬切重置 */
function startAct4Crane(px, py, pz, lx, lz, onComplete = null, lerp = 0.04) {
  if (!camera || !controls) return;
  _act3Cam.mode = 'idle';
  _act3Cam.onComplete = null;
  _act2Cam.mode = 'idle';
  _act2Cam.onComplete = null;
  _camAnim.active = false;
  _act4Cam.posTarget.set(px, py, pz);
  _act4Cam.lookTarget.set(lx, 0, lz);
  _act4Cam.onComplete = onComplete;
  _act4Cam.mode = 'crane';
  _act4Cam.lerp = lerp;
  controls.enabled = false;
  controls.minDistance = Math.min(controls.minDistance, 40);
  controls.maxDistance = Math.max(controls.maxDistance, 4500);
}

function finishAct4Hold() {
  if (!camera || !controls) return;
  // 叙事到位后 hold，禁止立刻 idle（OrbitControls 易回弹原点）
  // 但必须 lookAt，否则只改 position/target、朝向仍停在上一幕 → 路口被甩出画面
  _act4Cam.holdPos.copy(camera.position);
  _act4Cam.holdTarget.copy(controls.target);
  _act4Cam.mode = 'hold';
  _act4Cam.onComplete = null;
  camera.up.set(0, 0, -1);
  camera.lookAt(_act4Cam.holdTarget);
  captureCamera({
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
    lerp: 0.04,
  });
  controls.enabled = false;
}

function releaseAct4CameraForUser() {
  if (_act4Cam.mode === 'idle') return;
  if (_act4Cam.mode === 'hold') {
    camera.position.copy(_act4Cam.holdPos);
    controls.target.copy(_act4Cam.holdTarget);
  } else if (_act4Cam.mode === 'crane') {
    camera.position.copy(_act4Cam.posTarget);
    controls.target.copy(_act4Cam.lookTarget);
  }
  camera.up.set(0, 0, -1);
  camera.lookAt(controls.target);
  _act4Cam.mode = 'idle';
  _act4Cam.onComplete = null;
  if (controls) {
    controls.enabled = true;
    controls.update();
  }
  captureCamera({
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
    lerp: 0.04,
  });
}

function updateAct4Camera() {
  if (_act4Cam.mode === 'crane') {
    camera.position.lerp(_act4Cam.posTarget, _act4Cam.lerp);
    controls.target.lerp(_act4Cam.lookTarget, _act4Cam.lerp);
    camera.up.set(0, 0, -1);
    camera.lookAt(controls.target);
    const done =
      camera.position.distanceTo(_act4Cam.posTarget) < 2.5
      && controls.target.distanceTo(_act4Cam.lookTarget) < 1.2;
    if (done) {
      camera.position.copy(_act4Cam.posTarget);
      controls.target.copy(_act4Cam.lookTarget);
      camera.lookAt(controls.target);
      const cb = _act4Cam.onComplete;
      _act4Cam.onComplete = null;
      if (cb) cb();
      else finishAct4Hold();
    }
    return;
  }

  if (_act4Cam.mode === 'hold') {
    camera.position.copy(_act4Cam.holdPos);
    controls.target.copy(_act4Cam.holdTarget);
    camera.up.set(0, 0, -1);
    camera.lookAt(controls.target);
  }
}

function ensureAct4Shot(shotKey, getter, onArrive) {
  if (!act4Fx || !camera) return;
  if (_act4Cam.done[shotKey]) {
    onArrive?.();
    return;
  }
  _act4Cam.done[shotKey] = true;
  const cam = getter();
  startAct4Crane(cam.x, cam.y, cam.z, cam.lx, cam.lz, onArrive, cam.lerp ?? 0.04);
}

function ensureAct4Reveal(onArrive) {
  ensureAct4Shot('reveal', () => act4Fx.getRevealCam?.() || act4Fx.getDualFrameCam(), onArrive);
}

function ensureAct4SlackPush(onArrive) {
  ensureAct4Shot('slack', () => act4Fx.getSlackCam?.() || act4Fx.getSettleCam(), onArrive);
}

function ensureAct4Settle(onArrive) {
  ensureAct4Shot('settle', () => act4Fx.getSettleCam(), onArrive);
}

function onAct4CraneArrive() {
  finishAct4Hold();
}

/** Act5：北扩廊道飞入（lerp=0.03），禁止硬切重置 */
function startAct5Fly(px, py, pz, lx, lz, onComplete = null, lerp = 0.03) {
  if (!camera || !controls) return;
  _act4Cam.mode = 'idle';
  _act4Cam.onComplete = null;
  _act3Cam.mode = 'idle';
  _act3Cam.onComplete = null;
  _act2Cam.mode = 'idle';
  _act2Cam.onComplete = null;
  _camAnim.active = false;
  _act5Cam.posTarget.set(px, py, pz);
  _act5Cam.lookTarget.set(lx, 0, lz);
  _act5Cam.onComplete = onComplete;
  _act5Cam.mode = 'fly';
  _act5Cam.lerp = lerp;
  controls.enabled = false;
  controls.minDistance = Math.min(controls.minDistance, 40);
  controls.maxDistance = Math.max(controls.maxDistance, 4500);
}

function finishAct5Hold({ allowDrift = false } = {}) {
  if (!camera || !controls) return;
  captureCamera({
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
    lerp: 0.03,
  });
  if (allowDrift) {
    _act5Cam.holdPos.copy(camera.position);
    _act5Cam.holdTarget.copy(controls.target);
    _act5Cam.mode = 'hold';
  } else {
    _act5Cam.mode = 'idle';
    _act5Cam.onComplete = null;
  }
  controls.enabled = true;
}

function releaseAct5CameraForUser() {
  if (_act5Cam.mode === 'idle') return;
  _act5Cam.mode = 'idle';
  _act5Cam.onComplete = null;
  if (controls) controls.enabled = true;
  if (camera && controls) {
    captureCamera({
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
      lerp: 0.03,
    });
  }
}

function updateAct5Camera() {
  if (_act5Cam.mode === 'fly') {
    camera.position.lerp(_act5Cam.posTarget, _act5Cam.lerp);
    controls.target.lerp(_act5Cam.lookTarget, _act5Cam.lerp);
    camera.lookAt(controls.target);
    const done =
      camera.position.distanceTo(_act5Cam.posTarget) < 2.5
      && controls.target.distanceTo(_act5Cam.lookTarget) < 1.2;
    if (done) {
      camera.position.copy(_act5Cam.posTarget);
      controls.target.copy(_act5Cam.lookTarget);
      camera.lookAt(controls.target);
      const cb = _act5Cam.onComplete;
      _act5Cam.onComplete = null;
      if (cb) cb();
      else finishAct5Hold({ allowDrift: true });
    }
    return;
  }

  if (_act5Cam.mode === 'hold') {
    camera.position.copy(_act5Cam.holdPos);
    controls.target.copy(_act5Cam.holdTarget);
  }
}

function ensureAct5Corridor(onArrive) {
  if (!act5Fx || !camera) return;
  if (_act5Cam.done.north) {
    onArrive?.();
    return;
  }
  _act5Cam.done.north = true;
  const cam = act5Fx.getNorthExpandCam?.() || act5Fx.getCorridorCam();
  startAct5Fly(cam.x, cam.y, cam.z, cam.lx, cam.lz, onArrive, cam.lerp ?? 0.03);
}

function ensureAct5SpreadCam(onArrive) {
  if (!act5Fx || !camera) return;
  if (_act5Cam.done.spread) {
    onArrive?.();
    return;
  }
  _act5Cam.done.spread = true;
  const cam = act5Fx.getSpreadCam?.() || act5Fx.getCorridorCam();
  startAct5Fly(cam.x, cam.y, cam.z, cam.lx, cam.lz, onArrive, cam.lerp ?? 0.045);
}

function ensureAct5Settle(onArrive) {
  if (!act5Fx || !camera) return;
  if (_act5Cam.done.settle) {
    onArrive?.();
    return;
  }
  _act5Cam.done.settle = true;
  const cam = act5Fx.getSettleCam?.() || act5Fx.getCorridorCam();
  startAct5Fly(cam.x, cam.y, cam.z, cam.lx, cam.lz, onArrive, cam.lerp ?? 0.032);
}

function onAct5FlyArrive() {
  finishAct5Hold({ allowDrift: false });
}

function applyAct5FlowTraceOpacity(opacity) {
  if (!act5FlowTrace) return;
  const op = Math.max(0, Math.min(1, opacity));
  act5FlowTraceOpacity = op;
  act5FlowTrace.traverse?.((obj) => {
    if (!obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach((m) => {
      if (m?.opacity == null) return;
      if (m.userData?.act5BaseOp == null) m.userData.act5BaseOp = m.opacity;
      m.opacity = (m.userData.act5BaseOp ?? 1) * op;
    });
  });
}

/** 清掉 Act2–4 抢戏层，露出流量溯源廊道 */
function clearAct5CompetingLayers() {
  disposeAct4Congestion();

  if (currentFocusLayer) {
    currentFocusLayer.mesh.dispose?.();
    scene?.remove(currentFocusLayer.mesh);
    currentFocusLayer = null;
  }
  focusMode.value = false;

  if (act2Fx?.group) act2Fx.group.visible = false;
  if (act3Fx?.group) act3Fx.group.visible = false;
  if (act4Fx?.group) act4Fx.group.visible = false;

  act2Fx?.setQueueCarsVisible?.(false);
}

/**
 * Act5 主视觉 = 直接复刻 public/flow-trace-viz.html
 *（主走廊圆心连线 + showDir + 节点/跳数占比标签；默认不开十字拓扑）
 * 注意：act-05 模块已删除，此可视化暂不挂载。
 */
function ensureAct5FlowTraceViz() {
  // act-05 模块已删除：流量溯源廊道可视化不再挂载（后续重构时恢复）
  console.warn('[Act5] flow_trace 可视化已停用（act-05 模块已删除）');
  act5FlowTrace = null;
}

function dimAct5FlowTrace(targetOp = 0.72) {
  act5FlowTraceOpacity = targetOp;
  applyAct5FlowTraceOpacity(targetOp);
}

function disposeAct5FlowTrace() {
  if (!act5FlowTrace) return;
  scene?.remove(act5FlowTrace);
  act5FlowTrace.dispose?.();
  act5FlowTrace = null;
  act5FlowTraceOpacity = 1;
  if (controls) {
    controls.rotateSpeed = 0.6;
  }
}

/** Act6：廊道承接飞入 */
function startAct6Fly(px, py, pz, lx, lz, onComplete = null, lerp = 0.035) {
  if (!camera || !controls) return;
  // 交棒时只清 Act5 占用，勿 enable OrbitControls（否则一帧回弹）
  _act5Cam.mode = 'idle';
  _act5Cam.onComplete = null;
  _act4Cam.mode = 'idle';
  _act4Cam.onComplete = null;
  _camAnim.active = false;
  _act6Cam.posTarget.set(px, py, pz);
  _act6Cam.lookTarget.set(lx, 0, lz);
  _act6Cam.onComplete = onComplete;
  _act6Cam.mode = 'fly';
  _act6Cam.lerp = lerp;
  controls.enabled = false;
}

function finishAct6Hold() {
  if (!camera || !controls) return;
  _act6Cam.holdPos.copy(camera.position);
  _act6Cam.holdTarget.copy(controls.target);
  _act6Cam.mode = 'hold';
  _act6Cam.orbit.active = false;
  _act6Cam.onComplete = null;
  camera.up.set(0, 0, -1);
  camera.lookAt(_act6Cam.holdTarget);
  captureCamera({
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
    lerp: 0.03,
  });
  controls.enabled = false;
}

function releaseAct6CameraForUser() {
  if (_act6Cam.mode === 'idle') return;
  if (_act6Cam.mode === 'hold') {
    camera.position.copy(_act6Cam.holdPos);
    controls.target.copy(_act6Cam.holdTarget);
  } else if (_act6Cam.mode === 'fly') {
    camera.position.copy(_act6Cam.posTarget);
    controls.target.copy(_act6Cam.lookTarget);
  }
  camera.up.set(0, 0, -1);
  camera.lookAt(controls.target);
  _act6Cam.mode = 'idle';
  _act6Cam.orbit.active = false;
  _act6Cam.onComplete = null;
  if (controls) {
    controls.enabled = true;
    controls.update();
  }
}

function updateAct6Camera(t) {
  if (_act6Cam.mode === 'fly') {
    camera.position.lerp(_act6Cam.posTarget, _act6Cam.lerp);
    controls.target.lerp(_act6Cam.lookTarget, _act6Cam.lerp);
    camera.up.set(0, 0, -1);
    camera.lookAt(controls.target);
    const arrived =
      camera.position.distanceTo(_act6Cam.posTarget) < 2.5
      && controls.target.distanceTo(_act6Cam.lookTarget) < 1.2;
    if (arrived) {
      camera.position.copy(_act6Cam.posTarget);
      controls.target.copy(_act6Cam.lookTarget);
      camera.lookAt(controls.target);
      const cb = _act6Cam.onComplete;
      _act6Cam.onComplete = null;
      if (cb) cb();
      else finishAct6Hold();
    }
    return;
  }

  if (_act6Cam.mode === 'orbit' && act6Fx) {
    const o = _act6Cam.orbit;
    const elapsed = Math.max(0, t - o.t0);
    const u = Math.min(1, elapsed / o.duration);
    const eased = easeInOutQuint(u);
    const deg = o.fromDeg + (o.toDeg - o.fromDeg) * eased;
    const cam = act6Fx.getOrbitCam(deg);
    camera.position.set(cam.x, cam.y, cam.z);
    controls.target.set(cam.lx, 0, cam.lz);
    camera.up.set(0, 0, -1);
    camera.lookAt(controls.target);
    if (u >= 1) {
      o.active = false;
      finishAct6Hold();
    }
    return;
  }

  if (_act6Cam.mode === 'hold') {
    camera.position.copy(_act6Cam.holdPos);
    controls.target.copy(_act6Cam.holdTarget);
    camera.up.set(0, 0, -1);
    camera.lookAt(controls.target);
  }
}

function ensureAct6Corridor(onArrive) {
  if (!act6Fx || !camera) return;
  if (_act6Cam.done.corridor) {
    onArrive?.();
    return;
  }
  _act6Cam.done.corridor = true;
  const cam = act6Fx.getCorridorCam();
  startAct6Fly(cam.x, cam.y, cam.z, cam.lx, cam.lz, onArrive, cam.lerp ?? 0.028);
}

/** 干线层级 → 成因近景：慢速放大，禁止硬切 */
function ensureAct6CloseZoom(onArrive) {
  if (!act6Fx || !camera) return;
  if (_act6Cam.done.close) {
    onArrive?.();
    return;
  }
  _act6Cam.done.close = true;
  _act6Cam.orbit.active = false;
  const cam = act6Fx.getCloseCam?.() || act6Fx.getOrbitCam(0);
  startAct6Fly(cam.x, cam.y, cam.z, cam.lx, cam.lz, onArrive, cam.lerp ?? 0.022);
}

function ensureAct6Orbit() {
  if (!act6Fx || !camera) return;
  if (_act6Cam.done.orbit) return;
  _act6Cam.done.orbit = true;
  releaseAct5CameraForUser();
  const start = act6Fx.getOrbitCam(_act6Cam.orbit.fromDeg);
  // 若尚未落到近景，先对齐近景再 orbit
  if (!_act6Cam.done.close) {
    ensureAct6CloseZoom(() => {
      camera.position.set(start.x, start.y, start.z);
      controls.target.set(start.lx, 0, start.lz);
      _act6Cam.orbit.active = true;
      _act6Cam.orbit.t0 = performance.now() / 1000;
      _act6Cam.mode = 'orbit';
      if (controls) controls.enabled = false;
    });
    return;
  }
  camera.position.set(start.x, start.y, start.z);
  controls.target.set(start.lx, 0, start.lz);
  _act6Cam.orbit.active = true;
  _act6Cam.orbit.t0 = performance.now() / 1000;
  _act6Cam.mode = 'orbit';
  if (controls) controls.enabled = false;
}

function ensureAct6Settle(onArrive) {
  if (!act6Fx || !camera) return;
  if (_act6Cam.done.settle) {
    onArrive?.();
    return;
  }
  _act6Cam.done.settle = true;
  _act6Cam.orbit.active = false;
  const cam = act6Fx.getSettleCam?.() || act6Fx.getOrbitCam(12);
  startAct6Fly(cam.x, cam.y, cam.z, cam.lx, cam.lz, onArrive, cam.lerp ?? 0.028);
}

function onAct6FlyArrive() {
  finishAct6Hold();
}

/** Act7：控制范围拉高飞镜 */
function startAct7Fly(px, py, pz, lx, lz, onComplete = null, lerp = 0.03) {
  if (!camera || !controls) return;
  if (controls) controls.enabled = false;
  _act7Cam.posTarget.set(px, py, pz);
  _act7Cam.lookTarget.set(lx, 0, lz);
  _act7Cam.onComplete = onComplete;
  _act7Cam.mode = 'fly';
  _act7Cam.lerp = lerp;
}

function finishAct7Hold() {
  if (!camera || !controls) return;
  _act7Cam.holdPos.copy(camera.position);
  _act7Cam.holdTarget.copy(controls.target);
  _act7Cam.mode = 'hold';
  _act7Cam.onComplete = null;
  camera.lookAt(_act7Cam.holdTarget);
  captureCamera({
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
    lerp: 0.03,
  });
}

function releaseAct7CameraForUser() {
  if (_act7Cam.mode === 'idle') return;
  if (_act7Cam.mode === 'hold') {
    camera.position.copy(_act7Cam.holdPos);
    controls.target.copy(_act7Cam.holdTarget);
  } else if (_act7Cam.mode === 'fly') {
    camera.position.copy(_act7Cam.posTarget);
    controls.target.copy(_act7Cam.lookTarget);
  }
  camera.lookAt(controls.target);
  _act7Cam.mode = 'idle';
  _act7Cam.onComplete = null;
  if (controls) controls.enabled = true;
}

function updateAct7Camera() {
  if (_act7Cam.mode === 'fly') {
    camera.position.lerp(_act7Cam.posTarget, _act7Cam.lerp);
    controls.target.lerp(_act7Cam.lookTarget, _act7Cam.lerp);
    camera.lookAt(controls.target);
    const arrived =
      camera.position.distanceTo(_act7Cam.posTarget) < 2.5
      && controls.target.distanceTo(_act7Cam.lookTarget) < 1.2;
    if (arrived) {
      camera.position.copy(_act7Cam.posTarget);
      controls.target.copy(_act7Cam.lookTarget);
      camera.lookAt(controls.target);
      const cb = _act7Cam.onComplete;
      _act7Cam.onComplete = null;
      if (cb) cb();
      else finishAct7Hold();
    }
    return;
  }

  if (_act7Cam.mode === 'hold') {
    camera.position.copy(_act7Cam.holdPos);
    controls.target.copy(_act7Cam.holdTarget);
    camera.lookAt(controls.target);
  }
}

function ensureAct7Scope(onArrive) {
  if (!act7Fx || !camera) return;
  if (_act7Cam.done.scope) {
    onArrive?.();
    return;
  }
  _act7Cam.done.scope = true;
  const cam = act7Fx.getScopeCam();
  startAct7Fly(cam.x, cam.y, cam.z, cam.lx, cam.lz, onArrive, cam.lerp ?? 0.03);
}

function ensureAct7Settle(onArrive) {
  if (!act7Fx || !camera) return;
  if (_act7Cam.done.settle) {
    onArrive?.();
    return;
  }
  _act7Cam.done.settle = true;
  const cam = act7Fx.getSettleCam?.() || act7Fx.getScopeCam();
  startAct7Fly(cam.x, cam.y, cam.z, cam.lx, cam.lz, onArrive, cam.lerp ?? 0.03);
}

function onAct7FlyArrive() {
  finishAct7Hold();
}

/** Act8：推近北进口 */
function startAct8Fly(px, py, pz, lx, lz, onComplete = null, lerp = 0.065) {
  if (!camera || !controls) return;
  if (controls) controls.enabled = false;
  _act8Cam.posTarget.set(px, py, pz);
  _act8Cam.lookTarget.set(lx, 0, lz);
  _act8Cam.onComplete = onComplete;
  _act8Cam.mode = 'fly';
  _act8Cam.lerp = lerp;
}

function finishAct8Hold() {
  if (!camera || !controls) return;
  _act8Cam.holdPos.copy(camera.position);
  _act8Cam.holdTarget.copy(controls.target);
  _act8Cam.mode = 'hold';
  _act8Cam.onComplete = null;
  camera.lookAt(_act8Cam.holdTarget);
  captureCamera({
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
    lerp: 0.065,
  });
}

function releaseAct8CameraForUser() {
  if (_act8Cam.mode === 'idle') return;
  if (_act8Cam.mode === 'hold') {
    camera.position.copy(_act8Cam.holdPos);
    controls.target.copy(_act8Cam.holdTarget);
  } else if (_act8Cam.mode === 'fly') {
    camera.position.copy(_act8Cam.posTarget);
    controls.target.copy(_act8Cam.lookTarget);
  }
  camera.lookAt(controls.target);
  _act8Cam.mode = 'idle';
  _act8Cam.onComplete = null;
  if (controls) controls.enabled = true;
}

function updateAct8Camera() {
  if (_act8Cam.mode === 'fly') {
    camera.position.lerp(_act8Cam.posTarget, _act8Cam.lerp);
    controls.target.lerp(_act8Cam.lookTarget, _act8Cam.lerp);
    camera.lookAt(controls.target);
    const arrived =
      camera.position.distanceTo(_act8Cam.posTarget) < 2.2
      && controls.target.distanceTo(_act8Cam.lookTarget) < 1.0;
    if (arrived) {
      camera.position.copy(_act8Cam.posTarget);
      controls.target.copy(_act8Cam.lookTarget);
      camera.lookAt(controls.target);
      const cb = _act8Cam.onComplete;
      _act8Cam.onComplete = null;
      if (cb) cb();
      else finishAct8Hold();
    }
    return;
  }
  if (_act8Cam.mode === 'hold') {
    camera.position.copy(_act8Cam.holdPos);
    controls.target.copy(_act8Cam.holdTarget);
    camera.lookAt(controls.target);
  }
}

function ensureAct8Approach(onArrive) {
  if (!act8Fx || !camera) return;
  if (_act8Cam.done.approach) {
    onArrive?.();
    return;
  }
  _act8Cam.done.approach = true;
  const cam = act8Fx.getApproachCam();
  startAct8Fly(cam.x, cam.y, cam.z, cam.lx, cam.lz, onArrive, cam.lerp ?? 0.065);
}

function ensureAct8Settle(onArrive) {
  if (!act8Fx || !camera) return;
  if (_act8Cam.done.settle) {
    onArrive?.();
    return;
  }
  _act8Cam.done.settle = true;
  const cam = act8Fx.getSettleCam?.() || act8Fx.getApproachCam();
  startAct8Fly(cam.x, cam.y, cam.z, cam.lx, cam.lz, onArrive, cam.lerp ?? 0.05);
}

function onAct8FlyArrive() {
  finishAct8Hold();
}

/** Act4：结构溯源 — Case A 不做全网 focus ribbon（橙网易被误读为蔓延） */
function ensureAct4FocusTrace() {
  // 清掉可能从别处残留的 focus；Act4 证据戏以 act4Fx + 侧栏为主
  if (currentFocusLayer) {
    currentFocusLayer.mesh.dispose?.();
    scene?.remove(currentFocusLayer.mesh);
    currentFocusLayer = null;
  }
  focusMode.value = false;

  if (roadMeshGroup) {
    roadMeshGroup.traverse((obj) => {
      if (obj.material && obj.userData.origOpacity != null) {
        obj.material.opacity = obj.userData.origOpacity * 0.35;
      }
    });
  }
}

/** Act4：启动拥堵蔓延 — Case A 禁用全网蔓延（蔓延仅 Act5 主路径） */
function ensureAct4CongestionSpread() {
  // 明确 no-op：避免 Act4 全网红橙波前泄漏到后续幕
  disposeAct4Congestion();
}

function disposeAct4Congestion() {
  if (!act4Congestion) return;
  scene?.remove(act4Congestion);
  act4Congestion.dispose?.();
  act4Congestion = null;
}

function updateAct2Camera(t) {
  if (_act2Cam.mode === 'fly') {
    camera.position.lerp(_act2Cam.posTarget, _act2Cam.lerp);
    controls.target.lerp(_act2Cam.lookTarget, _act2Cam.lerp);
    camera.up.set(0, 0, -1);
    camera.lookAt(controls.target);
    const done =
      camera.position.distanceTo(_act2Cam.posTarget) < 2
      && controls.target.distanceTo(_act2Cam.lookTarget) < 1;
    if (done) {
      camera.position.copy(_act2Cam.posTarget);
      controls.target.copy(_act2Cam.lookTarget);
      camera.up.set(0, 0, -1);
      camera.lookAt(controls.target);
      const cb = _act2Cam.onComplete;
      _act2Cam.onComplete = null;
      if (cb) cb();
      else finishAct2Hold({ allowDrift: false });
    }
    return;
  }

  if (_act2Cam.mode === 'sweep') {
    const raw = Math.min(1, (t - _act2Cam.sweepT0) / _act2Cam.sweepDur);
    const e = easeInOutQuint(raw);
    camera.position.lerpVectors(_act2Cam.sweepFrom, _act2Cam.sweepTo, e);
    controls.target.lerpVectors(_act2Cam.sweepLookFrom, _act2Cam.sweepLookTo, e);
    camera.up.set(0, 0, -1);
    camera.lookAt(controls.target);
    if (raw >= 1) {
      // 扫完就地回稳：轻微拉回，不飞回远处「起点」重播
      const tw = act2Fx?.getTargetWorld() || { x: camera.position.x, z: controls.target.z };
      _act2Cam.posTarget.set(tw.x, camera.position.y, tw.z);
      _act2Cam.lookTarget.set(tw.x, 0, tw.z);
      _act2Cam.onComplete = () => finishAct2Hold({ allowDrift: true });
      _act2Cam.mode = 'fly';
      _act2Cam.lerp = 0.08;
    }
    return;
  }

  if (_act2Cam.mode === 'hold') {
    const u = t;
    const amp = 2.2;
    const ox = Math.sin(u * 0.07) * amp;
    const oz = Math.cos(u * 0.06) * amp * 0.5;
    camera.position.set(
      _act2Cam.holdPos.x + ox,
      _act2Cam.holdPos.y,
      _act2Cam.holdPos.z + oz,
    );
    controls.target.set(
      _act2Cam.holdTarget.x + ox,
      _act2Cam.holdTarget.y,
      _act2Cam.holdTarget.z + oz,
    );
    camera.up.set(0, 0, -1);
    camera.lookAt(controls.target);
  }
}

function ensureAct2FlyToTarget(onArrive) {
  if (!act2Fx || !camera) return;
  if (_act2Cam.done.flyIn) {
    // 已飞入过：不重播，直接回调
    onArrive?.();
    return;
  }
  _act2Cam.done.flyIn = true;
  const tw = act2Fx.getProblemWorld?.() || act2Fx.getTargetWorld();
  startAct2Pan(tw.x, tw.z, onArrive, { height: 135 });
}

function onAct2ChannelArrive() {
  if (!act2Fx || !scene) return;
  act2Fx.ensureChannelization(scene);
  act2Fx.play('channelization', performance.now() / 1000, { scene });
  // 注册表兼容导出：幕 1 模块无渠化，语义 = 走廊揭示完成
  getActCompatExports().markChannelizationReady?.();
  // 段中心渠化取景：镜头坐车流下游端回望段中点（对齐 agent-loop）
  const fr = act2Fx.getSegmentFraming?.();
  if (fr && _act2Cam.mode !== 'fly' && _act2Cam.mode !== 'sweep') {
    startAct2Fly(fr.camX, fr.alt, fr.camZ, fr.midX, fr.midZ, () => finishAct2Hold({ allowDrift: true }));
  }
}

/** 返回主页：清空各幕地图图层、渠化箭头、蔓延与叙事镜头（对齐参考 mapResetSeq） */
function resetNarrativeMapToHome() {
  if (!scene || !camera || !controls) return;

  const t = performance.now() / 1000;

  stopAct1Camera();
  _act1Cam.mode = 'idle';

  _act2Cam.mode = 'idle';
  _act2Cam.onComplete = null;
  _act2Cam.pendingSweep = false;
  _act2Cam.done.flyIn = false;
  _act2Cam.done.sweep = false;

  _act3Cam.mode = 'idle';
  _act3Cam.onComplete = null;
  _act3Cam.done.pushIn = false;

  _act4Cam.mode = 'idle';
  _act4Cam.onComplete = null;
  _act4Cam.done.reveal = false;
  _act4Cam.done.slack = false;
  _act4Cam.done.settle = false;

  _act5Cam.mode = 'idle';
  _act5Cam.onComplete = null;
  _act5Cam.done.spread = false;
  _act5Cam.done.north = false;
  _act5Cam.done.settle = false;

  _act6Cam.mode = 'idle';
  _act6Cam.onComplete = null;
  _act6Cam.orbit.active = false;
  _act6Cam.done.corridor = false;
  _act6Cam.done.close = false;
  _act6Cam.done.orbit = false;
  _act6Cam.done.settle = false;

  _act7Cam.mode = 'idle';
  _act7Cam.onComplete = null;
  _act7Cam.done.lift = false;
  _act7Cam.done.scope = false;
  _act7Cam.done.settle = false;

  _act8Cam.mode = 'idle';
  _act8Cam.onComplete = null;
  _act8Cam.done.approach = false;
  _act8Cam.done.settle = false;

  _camAnim.active = false;
  pageScanActive.value = false;

  act1Fx?.play('clear', t);
  act2Fx?.play('clear', t, { scene });
  act2Fx?.removeChannelization?.();
  flowTraceFx?.stop?.();
  flowTraceFx?.clear?.();
  act3Fx?.play('clear', t);
  act4Fx?.play('clear', t);
  act5Fx?.play('clear', t);
  act6Fx?.play('clear', t);
  act7Fx?.play('clear', t);
  act8Fx?.play('clear', t);

  if (act1Fx?.group) act1Fx.group.visible = true;
  [act2Fx, act3Fx, act4Fx, act5Fx, act6Fx, act7Fx, act8Fx].forEach((fx) => {
    if (fx?.group) fx.group.visible = false;
  });

  disposeAct4Congestion();
  disposeAct5FlowTrace();
  clearFocus();

  if (roadMeshGroup) {
    roadMeshGroup.traverse((obj) => {
      if (obj.material && obj.userData.origOpacity != null) {
        obj.material.opacity = obj.userData.origOpacity;
      }
    });
  }

  exitAct2ParticleMode();

  const homeInter = allIntersections.find((i) => i.props.inter_id === DEFAULT_INTER_ID)
    || allIntersections[0];
  if (homeInter) {
    const [ix, iy] = homeInter.pos;
    camera.position.set(ix, 1600, -iy + 40);
    camera.lookAt(ix, 0, -iy);
    if (camera.isPerspectiveCamera) {
      camera.fov = _act1Cam.baseFov || 45;
      camera.near = 0.5;
      camera.far = 4500;
      camera.updateProjectionMatrix();
    }
    controls.target.set(ix, 0, -iy);
    controls.minDistance = 80;
    controls.maxDistance = 4500;
    controls.enabled = true;
    controls.update();
  }
}

watch(narrativeMapResetSeq, () => {
  if (narrativeMapResetSeq.value > 0) {
    resetNarrativeMapToHome();
  }
});

// Act1 搜索态节拍 → 地图特效
watch(act1MapBeat, (beat) => {
  if (!act1Fx) return;
  const t = performance.now() / 1000;
  if (!beat || beat === 'clear') {
    act1Fx.play('clear', t);
    // 恢复路网透明度
    if (roadMeshGroup && !focusMode.value) {
      roadMeshGroup.traverse(obj => {
        if (obj.material && obj.userData.origOpacity != null) {
          obj.material.opacity = obj.userData.origOpacity;
        }
      });
    }
    return;
  }
  // 仅 3D 搜索态图层（不用 12s 全屏 pageScan，避免抢戏）
  act1Fx.play(beat, t);
});

watch(act1Phase, (phase) => {
  if (phase === 'parsing') {
    if (focusMode.value) clearFocus();
    // 幕 1 改为单轨镜头：不再启动 10.8s Act1 dive，定位 fly-in 从当前机位直接接管。
    stopAct1Drift();
  } else if (phase === 'idle') {
    stopAct1Drift();
    act1Fx?.play('clear', performance.now() / 1000);
  } else if (phase === 'ticket_ready' || phase === 'handoff') {
    act1Fx?.play('clear', performance.now() / 1000);
  }
});

// Act2 地图节拍 → 渠化 / 拓扑 / 主路径 + SceneC 飞入
watch(act2MapBeat, (beat) => {
  if (!act2Fx || !scene) return;
  const t = performance.now() / 1000;

  if (!beat || beat === 'clear') {
    act2Fx.play('clear', t, { scene });
    return;
  }

  if (beat === 'fly_in' || beat === 'lock') {
    // 清除 Act1 搜索态，承接镜头飞入问题路段
    stopAct1Camera();
    act1Fx?.play('clear', t);
    act2Fx.play('lock', t, { scene });
    if (!_act2Cam.done.flyIn) {
      ensureAct2FlyToTarget(() => {
        onAct2ChannelArrive();
        finishAct2Hold({ allowDrift: true });
      });
    } else if (!act2Fx.hasChannelization()) {
      onAct2ChannelArrive();
    }
    return;
  }

  if (beat === 'channelization') {
    act2Fx.play('channelization', t, { scene });
    if (!act2Fx.hasChannelization()) {
      if (_act2Cam.mode === 'hold' || _act2Cam.mode === 'idle' || _act2Cam.done.flyIn) {
        onAct2ChannelArrive();
      }
    }
    return;
  }

  if (beat === 'queue' || beat === 'm-queue' || beat === 'm-speed' || beat === 'm-sat') {
    act2Fx.play(beat, t, { scene });
    return;
  }

  if (beat === 'metrics') {
    act2Fx.play('lock', t, { scene });
    if (!act2Fx.hasChannelization()) {
      if (_act2Cam.mode === 'hold' || _act2Cam.mode === 'idle' || _act2Cam.done.flyIn) {
        onAct2ChannelArrive();
      }
    }
    return;
  }

  if (beat === 'nodes' || beat === 'downstream' || beat === 'upstream') {
    act2Fx.play('nodes', t, { scene });
    const point = act2Fx.getNodesWorld?.() || act2Fx.getProblemWorld?.();
    if (point) {
      startAct2Pan(point.x, point.z, () => {
        finishAct2Hold({ allowDrift: true });
      });
    }
    return;
  }

  if (beat === 'conclusion') {
    act2Fx.play('conclusion', t, { scene });
    // 结论拍不再二次定位：保持段取景机位就地收束，
    // 避免大字报上屏瞬间镜头回拉产生抖动/偏移
    finishAct2Hold({ allowDrift: false });
    return;
  }

  if (beat === 'arms') {
    act2Fx.play('arms', t, { scene });
    return;
  }

  if (beat === 'topology') {
    // Act2 只做空间拓扑标注（act2Fx），禁止挂全网 focus 溯源/蔓延
    // 全网橙 ribbon 会误读成 Act5「流量溯源蔓延」
    act2Fx.play('topology', t, { scene });
    return;
  }

  if (beat === 'path') {
    act2Fx.play('path', t, { scene });
    // 北→南扫视：挂起或接着播，绝不从飞入起点重来
    beginAct2PathSweep();
    return;
  }

  if (beat === 'settle' || beat === 'dim' || beat === 'handoff') {
    act2Fx.play(beat === 'settle' ? 'settle' : 'dim', t, { scene });
    // 保持当前机位交还控制，不拉回起点
    if (_act2Cam.mode === 'fly' || _act2Cam.mode === 'sweep') {
      // 等当前镜走完；若已结束则就地 idle
      _act2Cam.pendingSweep = false;
    } else {
      finishAct2Hold({ allowDrift: false });
    }
  }
});

// 幕 2 流量溯源节拍 → 原生地图演绎（成因分析：溯源→供需→本口→绿灯→溢流）
watch(flowTraceMapBeat, (beat) => {
  if (!beat || beat === 'clear') {
    // 终态保留经十/奥体西流量图，切幕卸载时再释放
    if (beat === 'clear') flowTraceFx?.stop?.();
    return;
  }
  if (beat === 'trace') {
    const t = performance.now() / 1000;
    // 释放幕 1 镜头占用，清理搜索/定位图层，避免抢戏
    stopAct1Camera();
    _act2Cam.mode = 'idle';
    _act2Cam.onComplete = null;
    _act2Cam.pendingSweep = false;
    act1Fx?.play('clear', t);
    act2Fx?.play('clear', t, { scene });
    act2Fx?.removeChannelization?.();
    if (act1Fx?.group) act1Fx.group.visible = false;
    if (act2Fx?.group) act2Fx.group.visible = false;
    flowTraceFx?.play?.();
  }
});

// 幕 2 重播请求 → 重新播放流量溯源演绎
watch(flowTraceReplaySeq, (seq) => {
  if (!flowTraceFx || seq === 0) return;
  flowTraceFx.replay?.();
});

// Act3 地图节拍 → 北进口缓推 + 蓄车/排队线
watch(act3MapBeat, (beat) => {
  if (!act3Fx || !scene) return;
  const t = performance.now() / 1000;

  if (!beat || beat === 'clear') {
    act3Fx.play('clear', t);
    return;
  }

  if (beat === 'push_in') {
    // 渠化降透作空间参照，不 dispose；隐藏中性小车，改由色块表达排队
    act2Fx?.play('dim', t, { scene });
    act2Fx?.setQueueCarsVisible?.(false);
    act2Fx?.boostArrows?.(1.45);
    act3Fx.play('push_in', t);
    if (!_act3Cam.done.pushIn) {
      ensureAct3PushIn(() => {
        onAct3PushArrive();
      });
    } else {
      finishAct3Hold({ allowDrift: true });
    }
    return;
  }

  if (beat === 'storage') {
    act2Fx?.setQueueCarsVisible?.(false);
    act2Fx?.boostArrows?.(1.5);
    act3Fx.play('storage', t);
    getActCompatExports().markStorageReady?.();
    return;
  }

  if (beat === 'queue') {
    // 提及排队：色块序列生长 + 扫光高亮
    act2Fx?.setQueueCarsVisible?.(false);
    act3Fx.play('queue', t);
    return;
  }

  if (beat === 'ratio') {
    // 排队比：边界呼吸 + 色块近端提亮 + 地图数值标注
    act3Fx.play('ratio', t);
    return;
  }

  if (beat === 'verdict' || beat === 'settle') {
    act3Fx.play(beat === 'verdict' ? 'verdict' : 'settle', t);
    if (_act3Cam.mode === 'push') {
      // 等缓推走完
    } else {
      finishAct3Hold({ allowDrift: false });
    }
  }
});

// Act4 地图节拍 → 近景揭示 + 下游长度强调 + 三色块加绿放行
watch(act4MapBeat, (beat) => {
  if (!act4Fx || !scene) return;
  const t = performance.now() / 1000;

  if (!beat || beat === 'clear') {
    act4Fx.play('clear', t);
    disposeAct4Congestion();
    return;
  }

  if (beat === 'trace_on') {
    // 确保本口渠化/排队层可见（Act5 清场会关掉，重播或回切需拉回）
    if (act2Fx?.group) act2Fx.group.visible = true;
    if (act3Fx?.group) act3Fx.group.visible = true;
    if (act4Fx?.group) act4Fx.group.visible = true;
    act2Fx?.play('dim', t, { scene });
    act2Fx?.setQueueCarsVisible?.(false);
    act3Fx?.play('settle', t);
    ensureAct4FocusTrace();
    act4Fx.play('trace_on', t);
    // 近景揭示：框住本口，禁止甩到下游空地
    ensureAct4Reveal(() => onAct4CraneArrive());
    return;
  }

  if (beat === 'spread') {
    ensureAct4FocusTrace();
    ensureAct4CongestionSpread();
    act4Fx.play('spread', t);
    // 锁机位看波前南移；禁止 idle 导致回弹原点
    if (_act4Cam.mode !== 'crane') finishAct4Hold();
    return;
  }

  if (beat === 'compare' || beat === 'slack_length') {
    ensureAct4FocusTrace();
    ensureAct4CongestionSpread();
    act4Fx.play('compare', t);
    // 推向下游，强调蓄车余量长度带
    ensureAct4SlackPush(() => onAct4CraneArrive());
    return;
  }

  if (beat === 'branch') {
    ensureAct4FocusTrace();
    ensureAct4CongestionSpread();
    act4Fx.play('branch', t);
    if (_act4Cam.mode !== 'crane') finishAct4Hold();
    return;
  }

  if (beat === 'small_step_ok' || beat === 'settle' || beat === 'no_simple_green' || beat === 'trial_flow') {
    ensureAct4FocusTrace();
    ensureAct4CongestionSpread();
    act4Fx.play(beat === 'settle' ? 'settle' : 'small_step_ok', t);
    // 回看廊道：本口增绿后车流向下游疏导 = 小步增绿放行
    ensureAct4Settle(() => {
      finishAct4Hold();
    });
  }
});

// Act5 地图节拍 → 流量溯源廊道可视化（箭头 / 占比 / 跳数）
watch(act5MapBeat, (beat) => {
  if (!act5Fx || !scene) return;
  const t = performance.now() / 1000;

  if (!beat || beat === 'clear') {
    act5Fx.play('clear', t);
    disposeAct5FlowTrace();
    return;
  }

  if (beat === 'spread_on' || beat === 'north_expand') {
    ensureAct5FlowTraceViz();
    act5Fx.play(beat, t);
    if (beat === 'spread_on') {
      ensureAct5SpreadCam(() => onAct5FlyArrive());
    } else {
      ensureAct5Corridor(() => onAct5FlyArrive());
    }
    return;
  }

  if (beat === 'no_metering') {
    ensureAct5FlowTraceViz();
    act5Fx.play('no_metering', t);
    ensureAct5Settle(() => onAct5FlyArrive());
    return;
  }

  if (beat === 'dim' || beat === 'settle') {
    act5Fx.play(beat === 'settle' ? 'settle' : 'dim', t);
    dimAct5FlowTrace(0.78);
    if (_act5Cam.mode === 'idle') finishAct5Hold({ allowDrift: false });
  }
});

// Act6 地图节拍 → 主因品红钉 + 次因光晕 + 小 orbit
watch(act6MapBeat, (beat) => {
  if (!act6Fx || !scene) return;
  const t = performance.now() / 1000;

  if (!beat || beat === 'clear') {
    act6Fx.play('clear', t);
    return;
  }

  if (beat === 'rank') {
    dimAct5FlowTrace(0.55);
    act6Fx.play('rank', t);
    // 先停在干线协调层级，与 Act5 机位衔接
    ensureAct6Corridor(() => onAct6FlyArrive());
    return;
  }

  if (beat === 'primary_pin') {
    dimAct5FlowTrace(0.42);
    act6Fx.play('primary_pin', t);
    // 同轴慢速放大到近景；到位后再轻 orbit
    ensureAct6CloseZoom(() => {
      finishAct6Hold();
      ensureAct6Orbit();
    });
    return;
  }

  if (beat === 'secondary' || beat === 'gaps') {
    act6Fx.play(beat === 'gaps' ? 'gaps' : 'secondary', t);
    return;
  }

  if (beat === 'cases') {
    // 案例卡滑入：停止 orbit，锁死终态机位，避免双焦点
    if (_act6Cam.mode === 'orbit') {
      finishAct6Hold();
    }
    act6Fx.play('cases', t);
    return;
  }

  if (beat === 'settle') {
    act6Fx.play('settle', t);
    ensureAct6Settle(() => onAct6FlyArrive());
  }
});

// Act7 地图节拍 → 控制范围包络 + 策略包锚点
watch(act7MapBeat, (beat) => {
  if (!act7Fx || !scene) return;
  const t = performance.now() / 1000;

  if (!beat || beat === 'clear') {
    act7Fx.play('clear', t);
    return;
  }

  if (beat === 'scope') {
    act7Fx.play('scope', t);
    ensureAct7Scope(() => onAct7FlyArrive());
    return;
  }

  if (beat === 'principles') {
    act7Fx.play('principles', t);
    return;
  }

  if (beat === 'recommend') {
    act7Fx.play('recommend', t);
    return;
  }

  if (beat === 'reject') {
    act7Fx.play('reject', t);
    return;
  }

  if (beat === 'settle') {
    act7Fx.play('settle', t);
    ensureAct7Settle(() => onAct7FlyArrive());
  }
});

// Act8 地图节拍 → 信号灯 + 进口道色带 + 试运行剧情
watch(act8MapBeat, (beat) => {
  if (!act8Fx || !scene) return;
  const t = performance.now() / 1000;

  if (!beat || beat === 'clear') {
    act8Fx.play('clear', t);
    return;
  }

  if (beat === 'candidates') {
    act8Fx.play('candidates', t);
    // 先推近北进口，避免远距离空等
    ensureAct8Approach(() => onAct8FlyArrive());
    return;
  }

  if (beat === 'reject_paths') {
    act8Fx.play('reject_paths', t);
    return;
  }

  if (beat === 'recommend') {
    act8Fx.play('recommend', t);
    if (!_act8Cam.done.approach) {
      ensureAct8Approach(() => onAct8FlyArrive());
    }
    return;
  }

  if (beat === 'timing') {
    act8Fx.play('timing', t);
    return;
  }

  if (beat === 'trial') {
    act8Fx.play('trial', t);
    return;
  }

  if (beat === 'rollback') {
    act8Fx.play('rollback', t);
    return;
  }

  if (beat === 'settle') {
    act8Fx.play('settle', t);
    ensureAct8Settle(() => onAct8FlyArrive());
  }
});

function setOsmBuildingEdgesVisible(visible) {
  osmLayer?.traverse((o) => {
    if (o.name === 'osmBuildingEdges') o.visible = visible;
  });
}

function setDecorationPointsVisible(visible) {
  baseMapLayer?.group?.traverse((o) => {
    if (o.isPoints) o.visible = visible;
  });
}

/** Act2：关掉建筑轮廓噪点，换路口附近贴路流动粒子（粒子开关关闭时整体跳过） */
function enterAct2ParticleMode() {
  if (!ROAD_PARTICLES_VISIBLE) return;
  setOsmBuildingEdgesVisible(false);
  setDecorationPointsVisible(false);

  const tw = act2Fx?.getTargetWorld?.();
  const near = tw
    ? { x: tw.x, y: -tw.z } // project 空间：y 北 = -three.z
    : { x: 0, y: 0 };

  // 移除全域粒子，换成廊道局部（主干+次干，半径约 1.2km）
  if (flowParticles) {
    scene.remove(flowParticles.mesh);
    flowParticles.dispose();
    flowParticles = null;
  }
  flowParticles = new FlowParticles(allRoads, 2800, {
    allowedClasses: ['express', 'arterial', 'collector'],
    nearPoint: near,
    nearRadius: 120,
    speedScale: 2.2,
  });
  scene.add(flowParticles.mesh);
  flowParticles.setOpacity(0.92);
}

function exitAct2ParticleMode() {
  if (!ROAD_PARTICLES_VISIBLE) return;
  setOsmBuildingEdgesVisible(true);
  setDecorationPointsVisible(true);
  if (flowParticles) {
    scene.remove(flowParticles.mesh);
    flowParticles.dispose();
    flowParticles = null;
  }
  flowParticles = new FlowParticles(allRoads, 5000, {
    allowedClasses: ['express', 'arterial'],
    speedScale: 1.35,
  });
  scene.add(flowParticles.mesh);
  flowParticles.setOpacity(0.9);
}

watch(act2Phase, (phase, prev) => {
  if (phase === 'locating' && prev !== 'locating') {
    // Live：进入 Act2 时用 runtime 路口重建渠化层，禁止沿用 Case A 冷启动绑定
    if (act2Fx) {
      try {
        act2Fx.dispose?.();
      } catch {
        /* ignore */
      }
      scene.remove(act2Fx.group);
      act2Fx = null;
    }
    {
      const { createAct2MapFx } = getActFxCompat();
      if (createAct2MapFx) {
        act2Fx = createAct2MapFx({ project, roads: allRoads, intersections: allIntersections });
        scene.add(act2Fx.group);
        act2Fx.group.visible = true;
      }
    }

    // 先清镜头状态，再触发飞入，保证从 Act1 结束位连续接上
    _act2Cam.done.flyIn = false;
    _act2Cam.done.sweep = false;
    _act2Cam.pendingSweep = false;
    enterAct2ParticleMode();
    act1Fx?.play('clear', performance.now() / 1000);
    if (act1Fx?.group) act1Fx.group.visible = false;
    setAct2MapBeat('lock');
  } else if (phase === 'confirming' || phase === 'handoff') {
    act2Fx?.play('dim', performance.now() / 1000, { scene });
    releaseAct2CameraForUser();
    flowParticles?.setOpacity(0.75);
  } else if (phase === 'idle') {
    exitAct2ParticleMode();
  }
});

watch(act3Phase, (phase, prev) => {
  if (phase === 'verifying' && prev !== 'verifying') {
    // Live：诊断切片就绪后重建，禁止沿用冷启动空绑定
    if (act3Fx) {
      try { act3Fx.dispose?.(); } catch { /* ignore */ }
      scene.remove(act3Fx.group);
      act3Fx = null;
    }
    act3Fx = createAct3MapFx({ project });
    scene.add(act3Fx.group);

    _act3Cam.done.pushIn = false;
    // 承接 Act2 机位，禁止重置
    releaseAct2CameraForUser();
    act2Fx?.play('dim', performance.now() / 1000, { scene });
    act2Fx?.setQueueCarsVisible?.(false);
    act2Fx?.boostArrows?.(1.45);
    setAct3MapBeat('push_in');
    flowParticles?.setOpacity(0.55);
  } else if (phase === 'confirmed' || phase === 'handoff') {
    act3Fx?.play('verdict', performance.now() / 1000);
    releaseAct3CameraForUser();
    flowParticles?.setOpacity(0.45);
  }
});

watch(act4Phase, (phase, prev) => {
  if (phase === 'tracing' && prev !== 'tracing') {
    if (act4Fx) {
      try { act4Fx.dispose?.(); } catch { /* ignore */ }
      scene.remove(act4Fx.group);
      act4Fx = null;
    }
    act4Fx = createAct4MapFx({ project });
    scene.add(act4Fx.group);

    _act4Cam.done.reveal = false;
    _act4Cam.done.slack = false;
    _act4Cam.done.settle = false;
    // 承接 Act3 北进口特写，禁止重置
    releaseAct3CameraForUser();
    act2Fx?.play('dim', performance.now() / 1000, { scene });
    act2Fx?.setQueueCarsVisible?.(false);
    act3Fx?.play('settle', performance.now() / 1000);
    setAct4MapBeat('trace_on');
    flowParticles?.setOpacity(0.32);
  } else if (phase === 'branched' || phase === 'handoff') {
    act4Fx?.play('small_step_ok', performance.now() / 1000);
    // 保持叙事 hold，勿 release→idle（会触发原点回弹）；用户指针再接管
    if (_act4Cam.mode === 'idle') finishAct4Hold();
    flowParticles?.setOpacity(0.28);
  }
});

watch(act5Phase, (phase, prev) => {
  if (phase === 'expanding' && prev !== 'expanding') {
    if (act5Fx) {
      try { act5Fx.dispose?.(); } catch { /* ignore */ }
      scene.remove(act5Fx.group);
      act5Fx = null;
    }
    act5Fx = createAct5MapFx({ project });
    scene.add(act5Fx.group);

    _act5Cam.done.spread = false;
    _act5Cam.done.north = false;
    _act5Cam.done.settle = false;
    // 交棒 Act5：禁止先 release→idle（OrbitControls 会回弹原点）
    _act4Cam.mode = 'idle';
    _act4Cam.onComplete = null;
    if (controls) controls.enabled = false;
    setAct5MapBeat('spread_on');
  } else if (phase === 'settled' || phase === 'handoff') {
    act5Fx?.play('settle', performance.now() / 1000);
    dimAct5FlowTrace(0.78);
    releaseAct5CameraForUser();
  }
});

watch(act6Phase, (phase, prev) => {
  if (phase === 'ranking' && prev !== 'ranking') {
    if (act6Fx) {
      try { act6Fx.dispose?.(); } catch { /* ignore */ }
      scene.remove(act6Fx.group);
      act6Fx = null;
    }
    act6Fx = createAct6MapFx({ project });
    scene.add(act6Fx.group);

    _act6Cam.done.corridor = false;
    _act6Cam.done.close = false;
    _act6Cam.done.orbit = false;
    _act6Cam.done.settle = false;
    // 从干线协调交棒：禁止先 release→idle 回弹；保持当前廊道位再同轴推近
    _act5Cam.mode = 'idle';
    _act5Cam.onComplete = null;
    if (controls) controls.enabled = false;
    dimAct5FlowTrace(0.55);
    if (act6Fx?.group) act6Fx.group.visible = true;
    setAct6MapBeat('rank');
    flowParticles?.setOpacity(0.22);
  } else if (phase === 'settled' || phase === 'handoff') {
    act6Fx?.play('settle', performance.now() / 1000);
    finishAct6Hold();
    flowParticles?.setOpacity(0.2);
  }
});

watch(act7Phase, (phase, prev) => {
  if (phase === 'scoping' && prev !== 'scoping') {
    if (act7Fx) {
      try { act7Fx.dispose?.(); } catch { /* ignore */ }
      scene.remove(act7Fx.group);
      act7Fx = null;
    }
    act7Fx = createAct7MapFx({ project });
    scene.add(act7Fx.group);

    _act7Cam.done.lift = false;
    _act7Cam.done.scope = false;
    _act7Cam.done.settle = false;
    // 从 Act6 交棒：禁止先 release→idle 回弹
    _act6Cam.mode = 'idle';
    _act6Cam.orbit.active = false;
    _act6Cam.onComplete = null;
    if (controls) controls.enabled = false;
    if (act7Fx?.group) act7Fx.group.visible = true;
    // 清掉 Act6 主因/次因/排队比/机制等遗留标注，本幕只讲策略
    act6Fx?.play('clear', performance.now() / 1000);
    if (act6Fx?.group) act6Fx.group.visible = false;
    // 溯源蔓延层降到几乎不可见，避免抢策略包络
    dimAct5FlowTrace(0.08);
    setAct7MapBeat('scope');
    flowParticles?.setOpacity(0.18);
  } else if (phase === 'settled' || phase === 'handoff') {
    act7Fx?.play('settle', performance.now() / 1000);
    finishAct7Hold();
    flowParticles?.setOpacity(0.16);
  }
});

watch(act8Phase, (phase, prev) => {
  if (phase === 'planning' && prev !== 'planning') {
    if (act8Fx) {
      try { act8Fx.dispose?.(); } catch { /* ignore */ }
      scene.remove(act8Fx.group);
      act8Fx = null;
    }
    act8Fx = createAct8MapFx({ project });
    scene.add(act8Fx.group);

    _act8Cam.done.approach = false;
    _act8Cam.done.settle = false;
    // 从 Act7 交棒：禁止先 release→idle
    _act7Cam.mode = 'idle';
    _act7Cam.onComplete = null;
    if (controls) controls.enabled = false;
    if (act8Fx?.group) act8Fx.group.visible = true;
    // 策略包络让位给信控方案主戏（信号灯 / 进口道色带）
    if (act7Fx?.group) act7Fx.group.visible = false;
    // 恢复渠化北臂作进口道语境
    if (act2Fx?.group) {
      act2Fx.group.visible = true;
      act2Fx.play?.('dim', performance.now() / 1000, { scene });
    }
    setAct8MapBeat('candidates');
    flowParticles?.setOpacity(0.2);
  } else if (phase === 'settled' || phase === 'handoff') {
    act8Fx?.play('settle', performance.now() / 1000);
    finishAct8Hold();
    flowParticles?.setOpacity(0.18);
  }
});

function onCanvasPointerDown() {
  // Act2–8：任意指针按下即释放叙事相机占用，恢复拖移/缩放
  if (narrativeActive.value && act8Phase.value !== 'idle') {
    releaseAct8CameraForUser();
  } else if (narrativeActive.value && act7Phase.value !== 'idle') {
    releaseAct7CameraForUser();
  } else if (narrativeActive.value && act6Phase.value !== 'idle') {
    releaseAct6CameraForUser();
  } else if (narrativeActive.value && act5Phase.value !== 'idle') {
    releaseAct5CameraForUser();
  } else if (narrativeActive.value && act4Phase.value !== 'idle') {
    releaseAct4CameraForUser();
  } else if (narrativeActive.value && act3Phase.value !== 'idle') {
    releaseAct3CameraForUser();
  } else if (narrativeActive.value && act2Phase.value !== 'idle') {
    releaseAct2CameraForUser();
  }
}

onMounted(async () => {
  await init();
  window.addEventListener('resize', onResize);
  canvasRef.value.addEventListener('click',     onCanvasClick);
  canvasRef.value.addEventListener('mousemove', onCanvasMouseMove);
  canvasRef.value.addEventListener('pointerdown', onCanvasPointerDown);
});

onUnmounted(() => {
  cancelAnimationFrame(animId);
  window.removeEventListener('resize', onResize);
  canvasRef.value?.removeEventListener('click',     onCanvasClick);
  canvasRef.value?.removeEventListener('mousemove', onCanvasMouseMove);
  canvasRef.value?.removeEventListener('pointerdown', onCanvasPointerDown);
  stopAct1Drift();
  act1Fx?.dispose();
  act1Fx = null;
  act2Fx?.dispose({ keepChannelization: true });
  act2Fx = null;
  act3Fx?.dispose();
  act3Fx = null;
  act4Fx?.dispose();
  act4Fx = null;
  disposeAct4Congestion();
  act5Fx?.dispose();
  act5Fx = null;
  disposeAct5FlowTrace();
  act6Fx?.dispose();
  act6Fx = null;
  act7Fx?.dispose();
  act7Fx = null;
  act8Fx?.dispose();
  act8Fx = null;
  flowParticles?.dispose();
  flowParticles = null;
  controls?.dispose();
  baseMapLayer?.dispose();
  osmLayer?.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  renderer?.dispose();
});
</script>

<style scoped>
.map-root {
  width: 100vw;
  height: 100vh;
  position: relative;
  overflow: hidden;
  background: #000;
}

/* 高德地图容器：绝对定位铺满，z-index最低 */
#amap-container {
  position: absolute;
  inset: 0;
  z-index: 0;
}

/* Three.js canvas：无底图时 normal 混合，有 AMap 时改为 screen */
canvas {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: auto;
  cursor: grab;
  /* mix-blend-mode: screen; */ /* 与 AMap 合成时启用 */
}
canvas:active { cursor: grabbing; }

/* ── 加载 ── */
.overlay {
  position: absolute; inset: 0; z-index: 30;
  display: flex; align-items: center; justify-content: center;
  background: rgba(2, 8, 16, 0.92);
}
.loading-inner {
  display: flex; flex-direction: column; align-items: center; gap: 18px;
  color: #00e5ff; font-family: 'Courier New', monospace;
  font-size: 13px; letter-spacing: 3px; text-transform: uppercase;
}
.loading-ring {
  width: 52px; height: 52px;
  border: 2px solid rgba(0,229,255,.15);
  border-top-color: var(--text);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.page-scan-mask {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 58vw;
  z-index: 25;
  pointer-events: none;
  background:
    linear-gradient(90deg,
      rgba(0, 120, 255, 0.06) 0%,
      rgba(0, 150, 255, 0.18) 35%,
      rgba(0, 210, 255, 0.28) 72%,
      rgba(0, 210, 255, 0.26) 93%,
      rgba(170, 245, 255, 0.34) 96.8%,
      rgba(255, 255, 255, 0.58) 98.1%,
      rgba(0, 210, 255, 0) 100%);
  box-shadow:
    0 0 42px rgba(0, 180, 255, 0.18),
    inset -10px 0 18px rgba(0, 220, 255, 0.18);
  mix-blend-mode: screen;
  transform: translateX(-70vw);
  animation: pageScan 12s ease-in-out forwards;
}
@keyframes pageScan {
  0% { transform: translateX(-70vw); opacity: 0; }
  3% { opacity: 1; }
  16.67% { transform: translateX(112vw); opacity: 1; }
  33.33% { transform: translateX(-70vw); opacity: 1; }
  50% { transform: translateX(112vw); opacity: 1; }
  66.67% { transform: translateX(-70vw); opacity: 1; }
  83.33% { transform: translateX(112vw); opacity: 1; }
  97% { opacity: 1; }
  100% { transform: translateX(112vw); opacity: 0; }
}

/* ── API Key 未配置提示 ── */
.key-notice {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  z-index: 30; background: rgba(20, 10, 2, 0.95);
  border: 1px solid #ff8800; color: #ffaa44;
  font-family: 'Courier New', monospace; font-size: 14px;
  padding: 24px 32px; text-align: center; line-height: 2;
}
.key-notice code { color: #f0f6ff; background: rgba(255,255,255,.08); padding: 2px 6px; }
.key-notice a { color: var(--text); }

/* ── HUD ── */
.hud {
  position: absolute; top: 24px; left: 24px; z-index: 10;
  pointer-events: none; user-select: none;
  font-family: 'Courier New', monospace; color: var(--text);
}
.hud-title { display: flex; flex-direction: column; margin-bottom: 20px; }
.title-main { font-size: 22px; font-weight: bold; letter-spacing: 3px;
  text-shadow: 0 0 14px #00e5ff, 0 0 28px rgba(0,229,255,.4); }
.title-sub { font-size: 11px; letter-spacing: 2px; opacity: .6; margin-top: 4px; }

.hud-stats { display: flex; gap: 12px; margin-bottom: 18px; }
.stat {
  display: flex; flex-direction: column; align-items: center;
  background: rgba(0,229,255,.04); border: 1px solid rgba(0,229,255,.18);
  padding: 8px 16px; min-width: 64px;
}
.stat-val { font-size: 20px; font-weight: bold; color: #00ffff; text-shadow: 0 0 8px #00ffff; }
.stat-lbl { font-size: 9px; opacity: .55; letter-spacing: 1px; margin-top: 2px; }

.legend { display: flex; flex-direction: column; gap: 7px; font-size: 11px; opacity: .8; }
.legend-item { display: flex; align-items: center; gap: 8px; }
.dot { width: 14px; height: 3px; display: inline-block; border-radius: 2px; flex-shrink: 0; }
.dot.express   { background: #ff7700; box-shadow: 0 0 5px #ff7700; }
.dot.arterial  { background: #00ddff; box-shadow: 0 0 5px #00ddff; }
.dot.collector { background: #0066bb; }
.dot.local     { background: #003366; }

.scan-btn {
  pointer-events: auto;
  margin-top: 14px;
  padding: 6px 12px;
  border: 1px solid rgba(0,229,255,.35);
  background: rgba(0,20,30,.52);
  color: var(--text);
  font-family: 'Courier New', monospace;
  font-size: 11px;
  letter-spacing: 2px;
  cursor: pointer;
}
.scan-btn:hover {
  background: rgba(0,229,255,.14);
  box-shadow: 0 0 12px rgba(0,229,255,.22);
}

.hint { margin-top: 14px; font-size: 10px; letter-spacing: 1px; opacity: .45; color: #00ffff;
  animation: blink 2.5s ease-in-out infinite; }
@keyframes blink { 0%,100%{opacity:.3} 50%{opacity:.7} }

/* ── 聚焦面板 ── */
.focus-panel {
  position: absolute; top: 24px; right: 28px; z-index: 10;
  width: 240px; background: rgba(8,5,2,.9);
  border: 1px solid rgba(255,150,0,.35);
  font-family: 'Courier New', monospace; color: #ffaa33; padding: 14px 16px;
  pointer-events: auto;
}
.focus-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.focus-icon { font-size: 18px; animation: spin 4s linear infinite; }
.focus-title { flex: 1; font-size: 14px; font-weight: bold; letter-spacing: 3px; }
.close-btn { background: none; border: 1px solid rgba(255,150,0,.3); color: #ffaa33;
  cursor: pointer; padding: 2px 7px; font-size: 11px; }
.close-btn:hover { background: rgba(255,150,0,.1); }
.focus-name { font-size: 13px; letter-spacing: 1px; margin-bottom: 12px;
  color: #fff; border-bottom: 1px solid rgba(255,150,0,.2); padding-bottom: 8px; }
.focus-meta { margin-bottom: 12px; }
.meta-row { display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 11px; }
.meta-label { opacity: .65; }
.meta-val { font-weight: bold; }
.meta-val.inbound  { color: #ffcc44; text-shadow: 0 0 6px #ff8800; }
.meta-val.outbound { color: #ff6600; text-shadow: 0 0 6px #ff4400; }
.focus-legend { margin-bottom: 10px; font-size: 10px; opacity: .75; }
.fl-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.fl-line { display: inline-block; width: 20px; height: 3px; border-radius: 1px; }
.inbound-line  { background: #ffcc44; box-shadow: 0 0 4px #ff8800; }
.outbound-line { background: #ff5500; opacity: .6; }
.fl-arrow { color: #ff9900; font-size: 10px; }
.focus-tip { font-size: 9px; color: rgba(255,150,0,.45); letter-spacing: .5px; line-height: 1.4; }

/* ── 悬浮标签 ── */
.hover-label {
  position: absolute; z-index: 10;
  background: rgba(0,20,40,.85); border: 1px solid rgba(0,229,255,.3);
  color: #00e5ff; font-family: 'Courier New', monospace;
  font-size: 11px; padding: 4px 10px; pointer-events: none; white-space: nowrap;
}

/* ── 角落 & 时间戳 ── */
.corner { position: absolute; width: 20px; height: 20px; opacity: .55; pointer-events: none; z-index: 10; }
.corner-tl { top:10px; left:10px; border-top:1.5px solid #00e5ff; border-left:1.5px solid #00e5ff; }
.corner-tr { top:10px; right:10px; border-top:1.5px solid #00e5ff; border-right:1.5px solid #00e5ff; }
.corner-bl { bottom:10px; left:10px; border-bottom:1.5px solid #00e5ff; border-left:1.5px solid #00e5ff; }
.corner-br { bottom:10px; right:10px; border-bottom:1.5px solid #00e5ff; border-right:1.5px solid #00e5ff; }
.timestamp {
  position: absolute; top:24px; right:280px; z-index: 10;
  font-family: 'Courier New', monospace; font-size: 12px;
  color: rgba(240,246,255,.7); letter-spacing: 2px; pointer-events: none;
}

/* ── 过渡 ── */
.fade-enter-active, .fade-leave-active { transition: opacity .6s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.slide-enter-active, .slide-leave-active { transition: all .35s ease; }
.slide-enter-from { opacity: 0; transform: translateX(30px); }
.slide-leave-to   { opacity: 0; transform: translateX(30px); }
</style>

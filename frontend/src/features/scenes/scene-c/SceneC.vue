<template>
  <div class="scene-c" ref="containerRef">
    <canvas ref="canvasRef" class="main-canvas" />

    <!-- Loading -->
    <Transition name="fade">
      <div v-if="loading" class="overlay">
        <div class="loading-inner">
          <div class="loading-ring"></div>
          <p>{{ loadingText }}</p>
        </div>
      </div>
    </Transition>

    <!-- ── 路口图层模式 ─────────────────────────────────────────────────────── -->
    <template v-if="!loading && !selectedInter">
      <div class="hud">
        <div class="hud-title">
          <span class="title-main">路口诊断</span>
          <span class="title-sub">{{ interData.length }} 个路口</span>
        </div>
        <div class="hint">左键旋转 · 右键平移 · 滚轮缩放</div>
        <div class="hint-cta">▶ 点击路口图标 查看渠化图</div>
      </div>

      <div class="legend">
        <div class="leg-item"><span class="leg-icon">＋</span>路口节点（可点击）</div>
        <div class="leg-item"><span class="leg-dot" style="background:#ff8800"></span>快速路</div>
        <div class="leg-item"><span class="leg-dot" style="background:#66ccff"></span>主干道</div>
      </div>
    </template>

    <!-- ── 渠化图模式 ──────────────────────────────────────────────────────── -->
    <Transition name="info-pop">
      <div v-if="selectedInter" class="inter-info">
        <div class="ii-icon">⬡</div>
        <div class="ii-content">
          <div class="ii-name">{{ selectedInter.intersection_info.inter_name }}</div>
          <div class="ii-meta">
            总车道数 {{ totalLanes || '—' }}
            · {{ armCount }} 条路臂
          </div>
        </div>
      </div>
    </Transition>

    <!-- 返回按钮（渠化图模式下显示）-->
    <Transition name="btn-slide">
      <button v-if="selectedInter" class="return-btn" @click="clearSelection">
        <span class="rb-icon">←</span>
        <span class="rb-text">返回路口图层</span>
      </button>
    </Transition>

    <!-- Corner brackets -->
    <template v-if="!loading">
      <div class="corner corner-tl"></div>
      <div class="corner corner-tr"></div>
      <div class="corner corner-bl"></div>
      <div class="corner corner-br"></div>
    </template>
  </div>
</template>

<script setup>
/**
 * SceneC — 路口诊断
 *
 * 路口图层：SVG 精灵标记（THREE.Points），鼠标悬停脉冲光环
 * 点击路口：隐藏路口图层 → 相机飞入 → 显示 3D 渠化图
 * 返回按钮：隐藏渠化图 → 显示路口图层 → 相机飞回
 */

import { ref, computed, onMounted, onUnmounted } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { createOSMLayer } from '../../../shared/three/createOSMLayer.js';
import interRawData from './intersection_links.json';
import {
  createChannelizationLayer,
  disposeChannelizationLayer,
} from './channelizationLayer.js';
import interSvgUrl from './inter.svg';

// ── Projection ───────────────────────────────────────────────────────────────
const CENTER_LON = 117.096, CENTER_LAT = 36.662, MPU = 10;
function project(lon, lat) {
  const x =  (lon - CENTER_LON) * Math.cos(CENTER_LAT * Math.PI / 180) * (Math.PI / 180) * 6371000 / MPU;
  const z = -(lat - CENTER_LAT) * (Math.PI / 180) * 6371000 / MPU;
  return [x, z];
}

// ── 路口排队数据（按路口名索引，臂角度匹配）─────────────────────────────────
const QUEUE_DATA = {
  '经十路与历山路路口': [
    { armAngle: 270,   queueM: 320, satPct: 96 },  // 西进口 直行  F
    { armAngle: 90,    queueM: 180, satPct: 82 },  // 东进口 直行  D
    { armAngle: 192.4, queueM: 70,  satPct: 58 },  // 南进口 左转  B
    { armAngle: 7.5,   queueM: 90,  satPct: 63 },  // 北进口 直行  C
  ],
};

// ── Data ─────────────────────────────────────────────────────────────────────
const interData = interRawData;
const avgLon = interData.reduce((s, d) => s + d.intersection_info.longitude, 0) / interData.length;
const avgLat = interData.reduce((s, d) => s + d.intersection_info.latitude,  0) / interData.length;
const [avgX, avgZ] = project(avgLon, avgLat);

// Pre-computed world positions for screen-space detection
const markerWorldPos = interData.map(d => {
  const [x, z] = project(d.intersection_info.longitude, d.intersection_info.latitude);
  return new THREE.Vector3(x, 3, z);
});

// ── Vue state ─────────────────────────────────────────────────────────────────
const containerRef  = ref(null);
const canvasRef     = ref(null);
const loading       = ref(true);
const loadingText   = ref('正在加载地图数据…');
const selectedInter = ref(null);

// 统计路臂数（按角度归组）和总车道数
const armCount = computed(() => {
  if (!selectedInter.value) return 0;
  const sl  = selectedInter.value.surrounding_links;
  const angles = [];
  const THRESH = 22;
  function addAngle(a) {
    const norm = ((a % 360) + 360) % 360;
    if (!angles.some(x => Math.abs(((norm - x + 360) % 360) > 180 ? 360 - ((norm - x + 360) % 360) : ((norm - x + 360) % 360)) < THRESH)) {
      angles.push(norm);
    }
  }
  for (const lk of (sl['进入路口的路段']  || [])) addAngle(lk.t_angle);
  for (const lk of (sl['离开路口的路段'] || [])) addAngle(lk.f_angle);
  return angles.length;
});

const totalLanes = computed(() => {
  if (!selectedInter.value) return 0;
  const sl   = selectedInter.value.surrounding_links;
  const seen = new Set();
  let total  = 0;
  for (const lk of [...(sl['进入路口的路段'] || []), ...(sl['离开路口的路段'] || [])]) {
    if (!seen.has(lk.link_id)) {
      seen.add(lk.link_id);
      total += lk.c_lane_num || lk.lane_num || 0;
    }
  }
  return total;
});

// ── Three.js vars ─────────────────────────────────────────────────────────────
let renderer, scene, camera, controls, animId;
let osmLayer, markerPoints, pulseRingMesh, channelGroup;
let selectedIndex = -1;
let hoverIndex    = -1;

// ── Camera fly ────────────────────────────────────────────────────────────────
const _fly = {
  active:     false,
  posTarget:  new THREE.Vector3(),
  lookTarget: new THREE.Vector3(),
  onComplete: null,   // 飞行结束后的回调
};

function startFly(px, py, pz, lx, lz, onComplete = null) {
  _fly.posTarget.set(px, py, pz);
  _fly.lookTarget.set(lx, 0, lz);
  _fly.onComplete = onComplete;
  _fly.active = true;
  if (controls) controls.enabled = false;
}

// ── Load SVG texture ──────────────────────────────────────────────────────────
function loadTexture(url) {
  return new Promise((resolve, reject) =>
    new THREE.TextureLoader().load(url, resolve, undefined, reject),
  );
}

// ── Build marker Points layer ─────────────────────────────────────────────────
function buildMarkers(svgTex) {
  svgTex.colorSpace = THREE.SRGBColorSpace;

  const positions = new Float32Array(interData.length * 3);
  interData.forEach((_, i) => {
    const wp = markerWorldPos[i];
    positions[i * 3]     = wp.x;
    positions[i * 3 + 1] = wp.y;
    positions[i * 3 + 2] = wp.z;
  });

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  markerPoints = new THREE.Points(geom, new THREE.PointsMaterial({
    map:             svgTex,
    size:            16,           // CSS 像素大小（sizeAttenuation=false）
    sizeAttenuation: false,
    transparent:     true,
    alphaTest:       0.04,
    depthWrite:      false,
    color:           0x66d4ff,
  }));
  markerPoints.frustumCulled = false;
  scene.add(markerPoints);

  // 脉冲光环（hover / 选中指示，单个 Mesh 跟随目标位置）
  const ringGeom = new THREE.RingGeometry(7, 11, 32);
  const ringMat  = new THREE.MeshBasicMaterial({
    color:       0x00ffcc,
    side:        THREE.DoubleSide,
    transparent: true,
    opacity:     0.8,
    depthWrite:  false,
  });
  pulseRingMesh = new THREE.Mesh(ringGeom, ringMat);
  pulseRingMesh.rotation.x    = -Math.PI / 2;
  pulseRingMesh.visible        = false;
  pulseRingMesh.frustumCulled  = false;
  scene.add(pulseRingMesh);
}

// ── Screen-space hit detection ────────────────────────────────────────────────
const _ndcV = new THREE.Vector3();

function findNearestOnScreen(clientX, clientY, threshPx = 24) {
  if (!canvasRef.value) return -1;
  const rect   = canvasRef.value.getBoundingClientRect();
  const clickX = clientX - rect.left;
  const clickY = clientY - rect.top;
  let nearestIdx = -1, nearestDist = threshPx;

  markerWorldPos.forEach((wp, i) => {
    _ndcV.copy(wp).project(camera);
    if (_ndcV.z > 1) return;
    const sx = (_ndcV.x + 1) / 2 * rect.width;
    const sy = (-_ndcV.y + 1) / 2 * rect.height;
    const d  = Math.hypot(clickX - sx, clickY - sy);
    if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
  });

  return nearestIdx;
}

// ── Select / clear ────────────────────────────────────────────────────────────
function selectIntersection(idx) {
  selectedIndex       = idx;
  selectedInter.value = interData[idx];

  // 隐藏路口图层（标记点 + 脉冲环）
  if (markerPoints)   markerPoints.visible   = false;
  if (pulseRingMesh)  pulseRingMesh.visible   = false;

  // 构建 3D 渠化图
  if (channelGroup) { disposeChannelizationLayer(channelGroup); scene.remove(channelGroup); }
  const interName = interData[idx].intersection_info.inter_name;
  const queueData = QUEUE_DATA[interName] || null;
  channelGroup = createChannelizationLayer(interData[idx], queueData);
  scene.add(channelGroup);

  // 相机飞入
  const info = interData[idx].intersection_info;
  const [tx, tz] = project(info.longitude, info.latitude);
  startFly(tx, 160, tz + 70, tx, tz);
}

function clearSelection() {
  // 恢复路口图层
  if (markerPoints)  markerPoints.visible = true;

  // 清除渠化图
  if (channelGroup) { disposeChannelizationLayer(channelGroup); scene.remove(channelGroup); channelGroup = null; }

  selectedIndex       = -1;
  hoverIndex          = -1;
  selectedInter.value = null;

  // 相机飞回全局
  startFly(avgX, 500, avgZ + 250, avgX, avgZ);
}

// ── Mouse events ──────────────────────────────────────────────────────────────
let mouseDownPos = { x: 0, y: 0 };

function onMouseDown(e) { mouseDownPos = { x: e.clientX, y: e.clientY }; }

function onMouseMove(e) {
  if (selectedInter.value || _fly.active) return; // 渠化模式下不处理 hover
  const idx = findNearestOnScreen(e.clientX, e.clientY, 20);
  if (idx !== hoverIndex) {
    hoverIndex = idx;
    canvasRef.value.style.cursor = idx >= 0 ? 'pointer' : 'default';
  }
}

function onMouseUp(e) {
  if (Math.hypot(e.clientX - mouseDownPos.x, e.clientY - mouseDownPos.y) > 5) return;
  if (selectedInter.value) return; // 渠化模式下点击地图不做处理

  const idx = findNearestOnScreen(e.clientX, e.clientY, 26);
  if (idx >= 0) selectIntersection(idx);
}

function onKeydown(e) {
  if (e.key === 'Escape' && selectedInter.value) clearSelection();
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const W = containerRef.value.clientWidth;
  const H = containerRef.value.clientHeight;

  renderer = new THREE.WebGLRenderer({ canvas: canvasRef.value, antialias: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x040c1e, 1);
  renderer.toneMapping         = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  scene  = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, W / H, 1, 20000);
  camera.position.set(avgX, 500, avgZ + 250);
  camera.lookAt(avgX, 0, avgZ);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(avgX, 0, avgZ);
  controls.minDistance   = 50;
  controls.maxDistance   = 6000;
  controls.maxPolarAngle = Math.PI / 2.1;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.update();

  loadingText.value = '正在构建 OSM 底图…';
  osmLayer = await createOSMLayer();
  scene.add(osmLayer);

  loadingText.value = '正在加载路口图标…';
  const svgTex = await loadTexture(interSvgUrl);
  buildMarkers(svgTex);

  canvasRef.value.addEventListener('mousedown', onMouseDown);
  canvasRef.value.addEventListener('mousemove', onMouseMove);
  canvasRef.value.addEventListener('mouseup',   onMouseUp);
  window.addEventListener('keydown', onKeydown);

  loading.value = false;
  animate();

  // ── 自动定位到"千佛山东路与历山路路口"并进入渠化图层 ──────────────────────────
  const AUTO_NAME = '经十路与历山路路口';
  const autoIdx   = interData.findIndex(d => d.intersection_info.inter_name === AUTO_NAME);
  if (autoIdx >= 0) {
    const info = interData[autoIdx].intersection_info;
    const [atx, atz] = project(info.longitude, info.latitude);
    // 延迟 600ms 后飞到全局俯视视角，飞完后再自动进入渠化
    setTimeout(() => {
      startFly(atx, 350, atz + 200, atx, atz, () => {
        // 到达概览位置后停顿 500ms，再模拟点击进入渠化
        setTimeout(() => selectIntersection(autoIdx), 500);
      });
    }, 600);
  }
}

// ── Animate ───────────────────────────────────────────────────────────────────
function animate() {
  animId = requestAnimationFrame(animate);
  const t = performance.now() / 1000;

  // Camera fly
  if (_fly.active) {
    camera.position.lerp(_fly.posTarget,  0.065);
    controls.target.lerp(_fly.lookTarget, 0.065);
    camera.lookAt(controls.target);
    const done = camera.position.distanceTo(_fly.posTarget)  < 2 &&
                 controls.target.distanceTo(_fly.lookTarget) < 1;
    if (done) {
      camera.position.copy(_fly.posTarget);
      controls.target.copy(_fly.lookTarget);
      camera.lookAt(controls.target);
      _fly.active = false;
      controls.enabled = true;
      controls.update();
      if (_fly.onComplete) {
        const cb = _fly.onComplete;
        _fly.onComplete = null;
        cb();
      }
    }
  } else {
    controls.update();
  }

  // Pulse ring (only in marker mode)
  if (!selectedInter.value && pulseRingMesh) {
    const pulseIdx = hoverIndex;
    if (pulseIdx >= 0) {
      const wp = markerWorldPos[pulseIdx];
      pulseRingMesh.position.set(wp.x, 2.8, wp.z);
      const s = 1 + Math.sin(t * 4) * 0.3;
      pulseRingMesh.scale.setScalar(s);
      pulseRingMesh.material.opacity = 0.6 - Math.sin(t * 4) * 0.25;
      pulseRingMesh.visible = true;
    } else {
      pulseRingMesh.visible = false;
    }
  }

  renderer?.render(scene, camera);
}

// ── Resize ────────────────────────────────────────────────────────────────────
function onResize() {
  if (!renderer || !containerRef.value) return;
  const W = containerRef.value.clientWidth;
  const H = containerRef.value.clientHeight;
  renderer.setSize(W, H);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
}

onMounted(() => { init(); window.addEventListener('resize', onResize); });

onUnmounted(() => {
  cancelAnimationFrame(animId);
  canvasRef.value?.removeEventListener('mousedown', onMouseDown);
  canvasRef.value?.removeEventListener('mousemove', onMouseMove);
  canvasRef.value?.removeEventListener('mouseup',   onMouseUp);
  window.removeEventListener('keydown',  onKeydown);
  window.removeEventListener('resize',   onResize);
  controls?.dispose();
  if (channelGroup) disposeChannelizationLayer(channelGroup);
  osmLayer?.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  markerPoints?.geometry?.dispose();
  markerPoints?.material?.dispose();
  pulseRingMesh?.geometry?.dispose();
  pulseRingMesh?.material?.dispose();
  renderer?.dispose();
});
</script>

<style scoped>
.scene-c {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #040c1e;
}

.main-canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100% !important;
  height: 100% !important;
  cursor: default;
}

/* ── Loading ──────────────────────────────────────────────────────────────── */
.overlay {
  position: absolute; inset: 0;
  background: #040c1e;
  display: flex; align-items: center; justify-content: center;
  z-index: 50;
}
.loading-inner { text-align: center; color: #7ec8f5; font-family: 'Courier New', monospace; }
.loading-ring {
  width: 52px; height: 52px;
  border: 3px solid rgba(126,200,245,0.2);
  border-top-color: #7ec8f5;
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
  margin: 0 auto 14px;
}
@keyframes spin { to { transform: rotate(360deg); } }
.loading-inner p { font-size: 13px; letter-spacing: 1px; opacity: 0.8; }

/* ── HUD ─────────────────────────────────────────────────────────────────── */
.hud {
  position: absolute; top: 20px; left: 20px; z-index: 20;
  color: #e8f4ff; font-family: 'Courier New', monospace;
  background: rgba(4, 10, 24, 0.85);
  border: 1px solid rgba(0,200,255,0.25);
  border-radius: 10px; padding: 14px 18px;
  backdrop-filter: blur(8px); pointer-events: none;
}
.title-main { display: block; font-size: 20px; font-weight: bold; color: #00e5ff; letter-spacing: 3px; text-shadow: 0 0 14px rgba(0,229,255,0.8); }
.title-sub  { display: block; font-size: 11px; opacity: 0.5; margin-top: 3px; }
.hint     { margin-top: 8px; font-size: 11px; opacity: 0.4; }
.hint-cta { margin-top: 5px; font-size: 11px; color: #00ffcc; opacity: 0.85; }

/* ── Legend ──────────────────────────────────────────────────────────────── */
.legend {
  position: absolute; bottom: 30px; left: 20px; z-index: 20;
  display: flex; flex-direction: column; gap: 5px;
  background: rgba(4,10,24,0.75); border: 1px solid rgba(0,200,255,0.15);
  border-radius: 8px; padding: 12px 16px; pointer-events: none;
  font-family: 'Courier New', monospace;
}
.leg-item { display: flex; align-items: center; gap: 8px; font-size: 11px; color: #c0eeff; }
.leg-dot  { width: 12px; height: 3px; border-radius: 2px; flex-shrink: 0; }
.leg-icon { font-size: 14px; color: #66d4ff; width: 12px; text-align: center; }

/* ── Intersection info bar ─────────────────────────────────────────────────── */
.inter-info {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 20px;
  background: rgba(3, 8, 20, 0.94);
  border: 1px solid rgba(255, 204, 0, 0.45);
  box-shadow: 0 0 30px rgba(255, 204, 0, 0.12);
  backdrop-filter: blur(8px);
  min-width: 320px;
  pointer-events: none;
}

.ii-icon {
  font-size: 22px;
  color: #ffcc00;
  line-height: 1;
  flex-shrink: 0;
}

.ii-content { flex: 1; min-width: 0; }

.ii-name {
  font-size: 14px;
  color: #fff4cc;
  font-family: 'Microsoft YaHei', sans-serif;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ii-meta {
  font-size: 11px;
  color: rgba(255, 220, 100, 0.65);
  margin-top: 3px;
  font-family: 'Courier New', monospace;
}

/* ── Return button ────────────────────────────────────────────────────────── */
.return-btn {
  position: absolute;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 28px;
  background: rgba(3, 8, 20, 0.92);
  border: 1px solid rgba(0, 200, 255, 0.50);
  box-shadow: 0 0 24px rgba(0, 200, 255, 0.20), 0 4px 16px rgba(0,0,0,0.5);
  color: #a8e8ff;
  font-family: 'Microsoft YaHei', 'Courier New', monospace;
  font-size: 14px;
  letter-spacing: 1px;
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: all 0.18s;
  user-select: none;
}

.return-btn:hover {
  background: rgba(0, 200, 255, 0.14);
  border-color: rgba(0, 200, 255, 0.80);
  color: #00e5ff;
  box-shadow: 0 0 36px rgba(0, 200, 255, 0.30);
}

.rb-icon {
  font-size: 18px;
  line-height: 1;
  color: #00e5ff;
}

.rb-text {
  font-size: 14px;
  letter-spacing: 1.5px;
}

/* ── Corner brackets ──────────────────────────────────────────────────────── */
.corner { position: absolute; width: 20px; height: 20px; opacity: 0.5; z-index: 20; pointer-events: none; }
.corner-tl { top:12px; left:12px;   border-top:2px solid #00e5ff; border-left:2px solid #00e5ff; }
.corner-tr { top:12px; right:12px;  border-top:2px solid #00e5ff; border-right:2px solid #00e5ff; }
.corner-bl { bottom:12px; left:12px;  border-bottom:2px solid #00e5ff; border-left:2px solid #00e5ff; }
.corner-br { bottom:12px; right:12px; border-bottom:2px solid #00e5ff; border-right:2px solid #00e5ff; }

/* ── Transitions ──────────────────────────────────────────────────────────── */
.fade-enter-active, .fade-leave-active { transition: opacity 0.5s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.info-pop-enter-active { transition: opacity 0.30s ease, transform 0.30s ease; }
.info-pop-leave-active { transition: opacity 0.20s ease, transform 0.20s ease; }
.info-pop-enter-from, .info-pop-leave-to { opacity: 0; transform: translateX(-50%) translateY(-14px); }

.btn-slide-enter-active { transition: opacity 0.35s ease, transform 0.35s ease; }
.btn-slide-leave-active { transition: opacity 0.20s ease, transform 0.20s ease; }
.btn-slide-enter-from, .btn-slide-leave-to { opacity: 0; transform: translateX(-50%) translateY(20px); }
</style>

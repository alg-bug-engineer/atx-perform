<template>
  <div class="map-root" ref="containerRef">

    <!-- ① 高德地图底层（处理底图 + 白膜建筑 + 交互） -->
    <div id="amap-container" ref="amapRef"></div>

    <!-- ② Three.js 可视化层（透明，覆盖在地图上） -->
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

    <!-- API Key 未配置提示 -->
    <div v-if="keyMissing" class="key-notice">
      ⚠️ 请在 <code>ThreeMap.vue</code> 顶部填写高德 API Key<br>
      <a href="https://console.amap.com/" target="_blank">前往高德控制台申请 →</a>
    </div>

    <!-- 左上角 HUD -->
    <div v-show="!loading && !keyMissing" class="hud">
      <div class="hud-title">
        <span class="title-main">济南市</span>
        <span class="title-sub">车流溯源可视化 · 全城路网</span>
      </div>
      <div class="hud-stats">
        <div class="stat"><span class="stat-val">{{ stats.roads }}</span><span class="stat-lbl">路段</span></div>
        <div class="stat"><span class="stat-val">{{ stats.particles }}</span><span class="stat-lbl">粒子</span></div>
        <div class="stat"><span class="stat-val">2km</span><span class="stat-lbl">半径</span></div>
      </div>
      <div class="legend">
        <div class="legend-item"><span class="dot express"></span>快速路</div>
        <div class="legend-item"><span class="dot arterial"></span>主干道</div>
        <div class="legend-item"><span class="dot collector"></span>次干道</div>
        <div class="legend-item"><span class="dot local"></span>支路</div>
      </div>
      <button class="scan-btn" @click="triggerCityScan">全城扫描</button>
      <p class="hint" v-if="!focusMode">点击路口查看流量溯源 · 拖动/滚轮调整视角</p>
    </div>

    <!-- 聚焦信息面板 -->
    <Transition name="slide">
      <div v-if="focusMode && focusInfo" class="focus-panel">
        <div class="focus-header">
          <span class="focus-icon">◎</span>
          <span class="focus-title">流量溯源</span>
          <button class="close-btn" @click="clearFocus">✕</button>
        </div>
        <div class="focus-name">{{ focusInfo.interName }}</div>
        <div class="focus-meta">
          <div class="meta-row"><span class="meta-label">入向路段</span><span class="meta-val inbound">{{ focusInfo.inboundCount }}</span></div>
          <div class="meta-row"><span class="meta-label">出向路段</span><span class="meta-val outbound">{{ focusInfo.outboundCount }}</span></div>
          <div class="meta-row"><span class="meta-label">溯源半径</span><span class="meta-val">2 km</span></div>
        </div>
        <div class="focus-legend">
          <div class="fl-row"><span class="fl-line inbound-line"></span>汇入流（宽→细由近到远）</div>
          <div class="fl-row"><span class="fl-line outbound-line"></span>流出支路（较暗）</div>
          <div class="fl-row"><span class="fl-arrow">▶</span>流向箭头</div>
        </div>
        <p class="focus-tip">越靠近路口 → 越宽越亮，周边由细到粗逐步汇聚</p>
      </div>
    </Transition>

    <!-- 悬浮路口名称 -->
    <div v-if="hoverInter && !focusMode" class="hover-label"
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
import { ref, onMounted, onUnmounted } from 'vue';
import { loadAMap } from '../utils/amap.js';
import * as THREE from 'three';
import { OrbitControls }    from 'three/addons/controls/OrbitControls.js';
import { EffectComposer }   from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }       from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass }  from 'three/addons/postprocessing/UnrealBloomPass.js';

import { loadGeoData }             from '../geo/loader.js';
import { computeFlows }            from '../geo/topology.js';
import { buildTopology, findBusiestIntersection, findNearestIntersection, traceFlows } from '../geo/tracing.js';
import { createRoadMeshes }        from '../mesh/roads.js';
import { FlowParticles }           from '../mesh/particles.js';
import { createDecorations }       from '../mesh/decorations.js';
import { createFocusLayer }        from '../mesh/focusLayer.js';
import { createDistrictLayer }     from '../mesh/districts.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⚠️  在高德控制台申请：https://console.amap.com/
const AMAP_KEY      = '4eb366faccf2507826f0f1e6bedec771';
const AMAP_SEC_CODE = '5e98526c6f280429a34db9e7e59fba9f';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CENTER_LON      = 117.096;
const CENTER_LAT      = 36.662;
const METERS_PER_UNIT = 10;
const DEFAULT_INTER_ID = '6fab7f422f5117';
const FOCUS_RADIUS_UNITS = 200; // 2km = 200 Three.js单位

// ── Refs ──────────────────────────────────────────────────────────────────────
const containerRef = ref(null);
const amapRef      = ref(null);
const canvasRef    = ref(null);
const loading      = ref(true);
const loadingText  = ref('正在加载高德地图…');
const keyMissing   = ref(false);
const stats        = ref({ roads: 0, particles: 0 });
const timeStr      = ref('');
const focusMode    = ref(false);
const focusInfo    = ref(null);
const hoverInter   = ref(null);
const hoverPos     = ref({ x: 0, y: 0 });
const pageScanActive = ref(false);

// ── Three.js & 数据 ───────────────────────────────────────────────────────────
let renderer, scene, camera, composer, controls;
let decorations, districtLayer, flowParticles, roadMeshGroup;
let currentFocusLayer = null;
let allRoads = [], allIntersections = [], topology = null;
let amapInstance   = null;
let glCaptureLayer = null;
let localToAMap    = null;  // THREE.js 局部坐标 → AMap customCoords 的变换矩阵

// AMap 每帧传入的 VP 矩阵（预分配 buffer 避免 GC）
const _captureBuffer = new Float32Array(16);
let   capturedMatrix = null;  // 首帧填充后变为 _captureBuffer 引用

// 预分配矩阵，避免每帧 new Matrix4
const _combined = new THREE.Matrix4();

let animId;

// ── 高德地图初始化 ────────────────────────────────────────────────────────────
async function initAMap() {
  if (!AMAP_KEY) { keyMissing.value = true; loading.value = false; return false; }

  let AMap;
  try {
    AMap = await loadAMap(AMAP_KEY, AMAP_SEC_CODE);
  } catch (e) {
    console.error('[AMap] SDK 加载失败:', e);
    return false;
  }
  if (!AMap) { console.error('[AMap] window.AMap 未定义'); return false; }

  try {
    amapInstance = new AMap.Map('amap-container', {
      zoom: 16,
      center: [CENTER_LON, CENTER_LAT],
      viewMode: '3D',
      pitch: 45,
      rotation: -20,
      mapStyle: 'amap://styles/dark',
      showBuildingBlock: true,
      buildingAnimation: false,
    });
  } catch (e) {
    console.error('[AMap] 地图初始化失败:', e);
    return false;
  }

  await Promise.race([
    new Promise(r => amapInstance.on('complete', r)),
    new Promise(r => setTimeout(r, 8000)),
  ]);

  // ── 计算 localToAMap：THREE.js 局部坐标 → AMap customCoords 变换矩阵 ───────
  // THREE.js 局部坐标系: x=东, y=高度, z=-北 (10m/unit)
  // AMap customCoords: x=东, y=北, z=高度
  const cc = amapInstance.customCoords;
  const [[ox, oy]] = cc.lngLatsToCoords([[CENTER_LON, CENTER_LAT]]);
  const dLon  = METERS_PER_UNIT / (111320 * Math.cos(CENTER_LAT * Math.PI / 180));
  const dLat  = METERS_PER_UNIT / 111320;
  const scaleX = cc.lngLatsToCoords([[CENTER_LON + dLon, CENTER_LAT]])[0][0] - ox;
  const scaleY = cc.lngLatsToCoords([[CENTER_LON, CENTER_LAT + dLat]])[0][1] - oy;

  // (lx, ly, lz) → (scaleX*lx + ox,  -scaleY*lz + oy,  scaleX*ly)
  localToAMap = new THREE.Matrix4().set(
    scaleX,  0,       0,  ox,
    0,       0, -scaleY,  oy,
    0,       scaleX,  0,   0,
    0,       0,       0,   1,
  );

  // ── GLCustomLayer：仅捕获 AMap 每帧 VP 矩阵，不做任何 GL 渲染 ─────────────
  // 不在 AMap 的 WebGL1 context 上渲染，彻底规避 VAO/context 冲突
  let firstMatrixResolve;
  const firstMatrixP = new Promise(r => { firstMatrixResolve = r; });

  glCaptureLayer = new AMap.GLCustomLayer({
    zIndex: 10,
    init(_gl) { /* 不创建 renderer，不操作 GL 状态 */ },
    render(_gl, matrix) {
      _captureBuffer.set(matrix);        // 复用 buffer，零分配
      capturedMatrix = _captureBuffer;
      if (firstMatrixResolve) { firstMatrixResolve(); firstMatrixResolve = null; }
    },
  });
  amapInstance.add(glCaptureLayer);

  // 等待首帧矩阵就绪（AMap 渲染后立即触发）
  await Promise.race([firstMatrixP, new Promise(r => setTimeout(r, 3000))]);

  amapInstance.on('click',     onMapClick);
  amapInstance.on('mousemove', onMapMouseMove);

  return true;
}

// ── Three.js 初始化 ───────────────────────────────────────────────────────────
function initThreeJS() {
  const canvas = canvasRef.value;
  const W = containerRef.value.clientWidth;
  const H = containerRef.value.clientHeight;

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 1); // 纯黑背景
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  scene = new THREE.Scene();

  // ── 纯 Three.js 模式：使用标准透视相机，固定俯角视角 ──────────────────────
  camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 5000);
  camera.position.set(80, 340, 380);
  camera.lookAt(0, 0, 0);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;
  controls.panSpeed = 0.8;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.9;
  controls.minDistance = 80;
  controls.maxDistance = 1200;
  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  controls.update();

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 1.5, 0.38, 0.12);
  composer.addPass(bloom);
}

function frameScene(bounds) {
  if (!bounds || !Number.isFinite(bounds.radius)) return;

  const radius = Math.max(bounds.radius, 220);
  camera.near = 0.1;
  camera.far = radius * 12;
  camera.position.set(radius * 0.35, radius * 0.9, radius * 1.15);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  controls.target.set(0, 0, 0);
  controls.minDistance = Math.max(60, radius * 0.06);
  controls.maxDistance = radius * 4;
  controls.update();
}

// ── 地图点击：找最近路口 ──────────────────────────────────────────────────────
function onMapClick(e) {
  if (!allIntersections.length) return;
  const { lng, lat } = e.lnglat;
  const wx = worldX(lng, lat);
  const wz = worldZ(lng, lat);
  const inter = findNearestIntersection(wx, wz, allIntersections, 40);
  if (inter) {
    selectIntersection(inter);
  } else if (focusMode.value) {
    clearFocus();
  }
}

function onMapMouseMove(e) {
  if (focusMode.value) return;
  const { lng, lat } = e.lnglat;
  const wx = worldX(lng, lat);
  const wz = worldZ(lng, lat);
  const inter = findNearestIntersection(wx, wz, allIntersections, 25);
  hoverInter.value = inter;
  if (inter && e.originEvent) {
    hoverPos.value = { x: e.originEvent.clientX + 12, y: e.originEvent.clientY - 8 };
  }
}

// 经纬度 → Three.js X（东向）
function worldX(lon, lat) {
  const dx = (lon - CENTER_LON) * Math.cos(lat * Math.PI / 180) * Math.PI / 180 * 6371000;
  return dx / METERS_PER_UNIT;
}
// 经纬度 → Three.js Z（南向）
function worldZ(lon, lat) {
  const dy = (lat - CENTER_LAT) * Math.PI / 180 * 6371000;
  return -dy / METERS_PER_UNIT; // 注意负号：北 = -Z
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
}

function triggerCityScan() {
  pageScanActive.value = false;
  requestAnimationFrame(() => {
    pageScanActive.value = true;
  });
}

// ── 主初始化 ──────────────────────────────────────────────────────────────────
async function init() {
  initThreeJS();

  // ── AMap 暂时注释，先验证 Three.js 效果是否正常渲染 ──────────────────────
  // loadingText.value = '正在加载高德地图…';
  // const [amapOk, { roads: rawRoads, intersections }] = await Promise.all([
  //   initAMap().catch(() => false),
  //   loadGeoData(),
  // ]);
  loadingText.value = '正在加载路网数据…';
  const { roads: rawRoads, intersections, bounds } = await loadGeoData();

  loadingText.value = '正在构建路网…';
  allRoads         = computeFlows(rawRoads);
  allIntersections = intersections;
  topology         = buildTopology(allRoads);
  frameScene(bounds);

  districtLayer = await createDistrictLayer();
  scene.add(districtLayer);

  decorations = createDecorations(intersections);
  scene.add(decorations);

  roadMeshGroup = createRoadMeshes(allRoads);
  roadMeshGroup.traverse(obj => {
    if (obj.material) obj.userData.origOpacity = obj.material.opacity;
  });
  scene.add(roadMeshGroup);

  flowParticles = new FlowParticles(allRoads, 8000);
  scene.add(flowParticles.mesh);

  stats.value = { roads: allRoads.length, particles: flowParticles.count };

  // AMap VP 矩阵不是标准透视格式，禁用 Three.js 视锥剔除
  scene.traverse(obj => { obj.frustumCulled = false; });

  loading.value = false;

  const defaultInter =
    allIntersections.find(inter => inter.props.inter_id === DEFAULT_INTER_ID) ||
    findBusiestIntersection(allIntersections, topology);
  if (defaultInter) selectIntersection(defaultInter);
  triggerCityScan();

  animate();
}

// ── 渲染循环 ──────────────────────────────────────────────────────────────────
function animate() {
  animId = requestAnimationFrame(animate);

  // AMap 模式：每帧将精确 VP 矩阵注入相机
  // 纯 Three.js 模式：capturedMatrix 为 null，直接使用 PerspectiveCamera 自身矩阵
  if (capturedMatrix && localToAMap) {
    _combined.fromArray(capturedMatrix).multiply(localToAMap);
    camera.projectionMatrix.copy(_combined);
    camera.projectionMatrixInverse.copy(_combined).invert();
  }

  const t = performance.now() / 1000;
  flowParticles?.update();
  decorations?.update(t);
  if (currentFocusLayer) currentFocusLayer.mesh.update?.(t);
  controls?.update();

  const now = new Date();
  timeStr.value =
    `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ` +
    `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

  composer.render();
}

// ── 窗口响应 ──────────────────────────────────────────────────────────────────
function onResize() {
  if (!renderer || !containerRef.value) return;
  const W = containerRef.value.clientWidth;
  const H = containerRef.value.clientHeight;
  renderer.setSize(W, H);
  composer.setSize(W, H);
  if (camera?.isPerspectiveCamera) {
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  }
  if (amapInstance) amapInstance.resize();
  // 相机矩阵由 animate() 中的 capturedMatrix 自动更新，无需手动同步
}

onMounted(async () => {
  await init();
  window.addEventListener('resize', onResize);
});

onUnmounted(() => {
  cancelAnimationFrame(animId);
  window.removeEventListener('resize', onResize);
  controls?.dispose();
  districtLayer?.dispose();
  renderer?.dispose();
  amapInstance?.destroy();
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
  border-top-color: #00e5ff;
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
.key-notice code { color: #ffdd88; background: rgba(255,200,0,.1); padding: 2px 6px; }
.key-notice a { color: #00e5ff; }

/* ── HUD ── */
.hud {
  position: absolute; top: 24px; left: 24px; z-index: 10;
  pointer-events: none; user-select: none;
  font-family: 'Courier New', monospace; color: #00e5ff;
}
.hud-title { display: flex; flex-direction: column; margin-bottom: 20px; }
.title-main { font-size: 24px; font-weight: bold; letter-spacing: 6px;
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
  color: #00e5ff;
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
  color: rgba(0,229,255,.55); letter-spacing: 2px; pointer-events: none;
}

/* ── 过渡 ── */
.fade-enter-active, .fade-leave-active { transition: opacity .6s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.slide-enter-active, .slide-leave-active { transition: all .35s ease; }
.slide-enter-from { opacity: 0; transform: translateX(30px); }
.slide-leave-to   { opacity: 0; transform: translateX(30px); }
</style>

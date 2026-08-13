<template>
  <div class="map-root" ref="containerRef">

    <!-- ① 高德地图底层（底图、建筑、交互） -->
    <div id="amap-container" ref="amapRef"></div>

    <!-- ② Three.js 透明覆盖层（路网、粒子、辉光） -->
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

    <!-- API Key 未配置提示 -->
    <div v-if="keyMissing" class="key-notice">
      ⚠️ 请在 <code>ThreeMap.vue</code> 顶部填写高德 API Key<br>
      <a href="https://console.amap.com/" target="_blank">前往高德控制台申请 →</a>
    </div>

    <!-- 左上角 HUD -->
    <div v-show="!loading && !keyMissing" class="hud">
      <div class="hud-title">
        <span class="title-main">济南市</span>
        <span class="title-sub">车流溯源可视化 · 2km 核心区</span>
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
      <p class="hint" v-if="!focusMode">点击路口查看流量溯源</p>
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
          <div class="meta-row"><span class="meta-label">溯源半径</span><span class="meta-val">1 km</span></div>
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
import { EffectComposer }   from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }       from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass }  from 'three/addons/postprocessing/UnrealBloomPass.js';

import { loadGeoData }             from '../geo/loader.js';
import { computeFlows }            from '../geo/topology.js';
import { buildTopology, findBusiestIntersection, findNearestIntersection, traceFlows } from '../geo/tracing.js';
import { createRoadMeshes }        from '../mesh/roads.js';
import { FlowParticles }           from '../mesh/particles.js';
import { createBoundary }          from '../mesh/boundary.js';
import { createDecorations }       from '../mesh/decorations.js';
import { createFocusLayer }        from '../mesh/focusLayer.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⚠️  在高德控制台申请：https://console.amap.com/
const AMAP_KEY      = '4eb366faccf2507826f0f1e6bedec771';
const AMAP_SEC_CODE = '5e98526c6f280429a34db9e7e59fba9f';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CENTER_LON      = 117.096;
const CENTER_LAT      = 36.662;
const METERS_PER_UNIT = 10; // 1 Three.js单位 = 10米

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

// ── Three.js & 数据 ───────────────────────────────────────────────────────────
let renderer, scene, camera, composer;
let boundary, decorations, flowParticles, roadMeshGroup;
let currentFocusLayer = null;
let allRoads = [], allIntersections = [], topology = null;
let amapInstance   = null;
let glCaptureLayer = null;
let localToAMap    = null; // Three.js 局部坐标 → AMap customCoords 的变换矩阵

// AMap 每帧传入的 VP 矩阵（预分配 buffer 避免 GC）
const _captureBuffer = new Float32Array(16);
let capturedMatrix = null;
let mapCameraMode = false;

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
  if (!AMap) return false;

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

  // 等待地图加载完成（最多 8 秒）
  await Promise.race([
    new Promise(r => amapInstance.on('complete', r)),
    new Promise(r => setTimeout(r, 8000)),
  ]);

  // ── 计算 localToAMap：Three.js 局部坐标 → AMap customCoords ──────────────
  // Three.js 几何后续会直接使用 AMap customCoords 的局部平面坐标。
  // 这里仅做轴转换：Three.js x=东, y=高度, z=-北；AMap x=东, y=北, z=高度。
  const cc = amapInstance.customCoords;
  // 将高德自定义坐标原点放到业务中心点，避免大坐标进入 Three 矩阵后精度塌缩。
  cc.setCenter?.([CENTER_LON, CENTER_LAT]);

  // (lx, ly, lz) → (lx, -lz, ly)
  localToAMap = new THREE.Matrix4().set(
    1, 0,  0, 0,
    0, 0, -1, 0,
    0, 1,  0, 0,
    0, 0,  0, 1,
  );

  // ── GLCustomLayer：只捕获 AMap VP 矩阵，不共享高德 WebGL context 渲染 ─────
  let firstMatrixResolve;
  const firstMatrixP = new Promise(r => { firstMatrixResolve = r; });
  glCaptureLayer = new AMap.GLCustomLayer({
    zIndex: 10,
    init(_gl) { /* 不操作高德 GL 状态 */ },
    render(_gl, matrix) {
      _captureBuffer.set(matrix);
      capturedMatrix = _captureBuffer;
      if (firstMatrixResolve) {
        firstMatrixResolve();
        firstMatrixResolve = null;
      }
    },
  });

  amapInstance.add(glCaptureLayer);

  // 等待首帧矩阵，避免首次进入时 Three 与底图短暂错位。
  await Promise.race([firstMatrixP, new Promise(r => setTimeout(r, 3000))]);

  // 事件绑定
  amapInstance.on('click',     onMapClick);
  amapInstance.on('mousemove', onMapMouseMove);

  return true;
}

// ── Three.js 初始化 ───────────────────────────────────────────────────────────
function initThreeJS() {
  const canvas = canvasRef.value;
  const W = containerRef.value.clientWidth;
  const H = containerRef.value.clientHeight;

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  scene = new THREE.Scene();

  // 高德矩阵到位前保留纯 Three 视角，便于降级调试。
  camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 5000);
  camera.position.set(80, 340, 380);
  camera.lookAt(0, 0, 0);

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 1.5, 0.38, 0.12);
  composer.addPass(bloom);
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
  if (inter) {
    const pixel = amapInstance?.lngLatToContainer?.(e.lnglat);
    hoverPos.value = pixel
      ? { x: pixel.x + 12, y: pixel.y - 8 }
      : { x: e.originEvent.clientX + 12, y: e.originEvent.clientY - 8 };
  }
}

function lngLatToMapLocal(lon, lat) {
  if (amapInstance?.customCoords) {
    const [[x, y]] = amapInstance.customCoords.lngLatsToCoords([[lon, lat]]);
    return [x, y];
  }
  const x = (lon - CENTER_LON) * Math.cos(lat * Math.PI / 180) * Math.PI / 180 * 6371000 / METERS_PER_UNIT;
  const y = (lat - CENTER_LAT) * Math.PI / 180 * 6371000 / METERS_PER_UNIT;
  return [x, y];
}

// 经纬度 → Three.js 局部坐标
function worldX(lon, lat) {
  return lngLatToMapLocal(lon, lat)[0];
}
function worldZ(lon, lat) {
  return -lngLatToMapLocal(lon, lat)[1];
}

// ── 选中路口 ──────────────────────────────────────────────────────────────────
function selectIntersection(inter) {
  if (currentFocusLayer) {
    currentFocusLayer.dispose();
    scene.remove(currentFocusLayer.mesh);
  }

  const traceMap = traceFlows(inter, allRoads, topology, 100);

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
    currentFocusLayer.dispose();
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

// 用高德官方坐标转换结果重建几何坐标，避免手算投影尺度导致路网塌缩。
function convertGeoDataToAMapLocal(rawRoads, rawIntersections) {
  if (!amapInstance?.customCoords) return;

  const cc = amapInstance.customCoords;
  const allLngLats = [];
  for (const road of rawRoads) {
    for (const pt of road.rawCoords) allLngLats.push(pt);
  }
  const interStart = allLngLats.length;
  for (const inter of rawIntersections) allLngLats.push(inter.lonlat);

  const converted = cc.lngLatsToCoords(allLngLats);
  let ptr = 0;

  for (const road of rawRoads) {
    const len = road.rawCoords.length;
    road.coords = Array.from({ length: len }, (_, i) => {
      const [x, y] = converted[ptr + i];
      return [x, y];
    });
    ptr += len;
  }

  for (let i = 0; i < rawIntersections.length; i++) {
    const [x, y] = converted[interStart + i];
    rawIntersections[i].pos = [x, y];
  }
}

// ── 主初始化 ──────────────────────────────────────────────────────────────────
async function init() {
  initThreeJS();

  loadingText.value = '正在加载高德地图…';
  const [amapOk, { roads: rawRoads, intersections: rawInters }] = await Promise.all([
    initAMap().catch(e => { console.error(e); return false; }),
    loadGeoData(),
  ]);

  if (!amapOk && !keyMissing.value) console.warn('[AMap] 加载失败，使用纯 Three.js 模式');
  if (amapOk) convertGeoDataToAMapLocal(rawRoads, rawInters);

  loadingText.value = '正在构建路网…';
  allRoads         = computeFlows(rawRoads);
  allIntersections = rawInters;
  topology         = buildTopology(allRoads);

  decorations = createDecorations(allIntersections);
  scene.add(decorations);

  roadMeshGroup = createRoadMeshes(allRoads);
  roadMeshGroup.traverse(obj => {
    if (obj.material) obj.userData.origOpacity = obj.material.opacity;
  });
  scene.add(roadMeshGroup);

  flowParticles = new FlowParticles(allRoads, 8000);
  scene.add(flowParticles.mesh);

  boundary = createBoundary();
  scene.add(boundary);

  stats.value = { roads: allRoads.length, particles: flowParticles.count };
  loading.value = false;

  // AMap 自定义矩阵不符合标准透视格式，禁用 Three.js 的视锥剔除
  // 防止 Frustum.setFromProjectionMatrix 误判所有对象不在视野内
  scene.traverse(obj => { obj.frustumCulled = false; });

  const defaultInter = findBusiestIntersection(allIntersections, topology);
  if (defaultInter) selectIntersection(defaultInter);

  animate();
}

// ── 场景数据帧更新（粒子/动画状态，与渲染循环解耦） ───────────────────────────
function animate() {
  animId = requestAnimationFrame(animate);

  if (capturedMatrix && localToAMap) {
    if (!mapCameraMode) {
      camera.matrixAutoUpdate = false;
      camera.matrixWorld.identity();
      camera.matrixWorldInverse.identity();
      mapCameraMode = true;
    }
    _combined.fromArray(capturedMatrix).multiply(localToAMap);
    camera.projectionMatrix.copy(_combined);
    camera.projectionMatrixInverse.copy(_combined).invert();
  }

  const t = performance.now() / 1000;

  flowParticles?.update();
  boundary?.update(t);
  decorations?.update(t);
  if (currentFocusLayer) currentFocusLayer.mesh.update?.(t);

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
  if (!mapCameraMode && camera.isPerspectiveCamera) {
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  }
  if (amapInstance) amapInstance.resize();
}

onMounted(async () => {
  await init();
  window.addEventListener('resize', onResize);
});

onUnmounted(() => {
  cancelAnimationFrame(animId);
  window.removeEventListener('resize', onResize);
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
  background: #020810;
}

/* 高德地图容器：铺满全屏 */
#amap-container {
  position: absolute;
  inset: 0;
  z-index: 0;
}

canvas {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  mix-blend-mode: screen;
}

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

.hud-stats { display: flex; gap: 20px; margin-bottom: 16px; }
.stat { display: flex; flex-direction: column; align-items: center; }
.stat-val { font-size: 20px; font-weight: bold; color: #fff; text-shadow: 0 0 8px #00e5ff; }
.stat-lbl { font-size: 10px; letter-spacing: 2px; opacity: .5; margin-top: 2px; }

.legend { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
.legend-item { display: flex; align-items: center; gap: 8px; font-size: 11px; opacity: .75; }
.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.dot.express   { background: #ff7700; box-shadow: 0 0 6px #ff7700; }
.dot.arterial  { background: #00ddff; box-shadow: 0 0 6px #00ddff; }
.dot.collector { background: #0066bb; box-shadow: 0 0 4px #0066bb; }
.dot.local     { background: #003366; }
.hint { font-size: 11px; letter-spacing: 1px; opacity: .45; }

/* ── 聚焦面板 ── */
.focus-panel {
  position: absolute; top: 24px; right: 24px; z-index: 10;
  width: 230px; background: rgba(2,8,18,.88);
  border: 1px solid rgba(0,229,255,.25); padding: 18px;
  font-family: 'Courier New', monospace; color: #00e5ff;
  backdrop-filter: blur(8px);
}
.focus-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.focus-icon { font-size: 18px; }
.focus-title { font-size: 13px; letter-spacing: 3px; flex: 1; }
.close-btn { background: none; border: 1px solid rgba(0,229,255,.3); color: #00e5ff;
  cursor: pointer; padding: 2px 7px; font-size: 12px; pointer-events: all; }
.close-btn:hover { background: rgba(0,229,255,.15); }
.focus-name { font-size: 14px; color: #fff; margin-bottom: 14px; font-weight: bold; }
.focus-meta { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.meta-row { display: flex; justify-content: space-between; font-size: 11px; }
.meta-label { opacity: .55; }
.meta-val { font-weight: bold; }
.meta-val.inbound  { color: #ffaa22; }
.meta-val.outbound { color: #0099ee; }
.focus-legend { display: flex; flex-direction: column; gap: 5px; margin-bottom: 10px; }
.fl-row { display: flex; align-items: center; gap: 8px; font-size: 10px; opacity: .7; }
.fl-line { display: inline-block; width: 24px; height: 3px; border-radius: 2px; }
.inbound-line  { background: linear-gradient(90deg, #ff8800, #cc4400); }
.outbound-line { background: linear-gradient(90deg, #0077cc, #003366); }
.fl-arrow { color: #ffaa44; font-size: 11px; }
.focus-tip { font-size: 10px; opacity: .45; line-height: 1.5; }

/* ── 悬浮标签 ── */
.hover-label {
  position: absolute; z-index: 20;
  background: rgba(0,10,20,.85); border: 1px solid rgba(0,229,255,.3);
  color: #00e5ff; font-size: 12px; padding: 4px 10px;
  pointer-events: none; white-space: nowrap;
  font-family: 'Courier New', monospace;
}

/* ── 角落装饰 ── */
.corner {
  position: absolute; z-index: 10;
  width: 18px; height: 18px;
  pointer-events: none;
}
.corner-tl { top: 12px; left: 12px; border-top: 1px solid rgba(0,229,255,.5); border-left: 1px solid rgba(0,229,255,.5); }
.corner-tr { top: 12px; right: 12px; border-top: 1px solid rgba(0,229,255,.5); border-right: 1px solid rgba(0,229,255,.5); }
.corner-bl { bottom: 12px; left: 12px; border-bottom: 1px solid rgba(0,229,255,.5); border-left: 1px solid rgba(0,229,255,.5); }
.corner-br { bottom: 12px; right: 12px; border-bottom: 1px solid rgba(0,229,255,.5); border-right: 1px solid rgba(0,229,255,.5); }

/* ── 时间戳 ── */
.timestamp {
  position: absolute; bottom: 18px; right: 18px; z-index: 10;
  font-family: 'Courier New', monospace; font-size: 11px;
  color: rgba(0,229,255,.4); letter-spacing: 2px;
  pointer-events: none;
}

/* ── Transitions ── */
.fade-enter-active, .fade-leave-active { transition: opacity .4s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.slide-enter-active, .slide-leave-active { transition: all .3s ease; }
.slide-enter-from, .slide-leave-to { transform: translateX(20px); opacity: 0; }
</style>

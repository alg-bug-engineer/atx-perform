<template>
  <div class="scene-b" ref="containerRef">
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

    <!-- 角落装饰 -->
    <template v-if="!loading">
      <div class="corner corner-tl"></div>
      <div class="corner corner-tr"></div>
      <div class="corner corner-bl"></div>
      <div class="corner corner-br"></div>
    </template>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref, reactive } from 'vue';
import * as THREE from 'three';
import { OrbitControls }   from 'three/addons/controls/OrbitControls.js';
import { createJinanBaseMapLayer }             from '../../../shared/three/createJinanBaseMapLayer.js';
import { createOSMLayer }                      from '../../../shared/three/createOSMLayer.js';
import { computeFlows }                        from '../traffic-origin/geo/topology.js';
import { buildTopology }                       from '../traffic-origin/geo/tracing.js';
import { FlowParticles }                       from '../traffic-origin/mesh/particles.js';
import { createCongestionLayer }               from './congestionLayer.js';

// 起点路口（千佛山东路与历山路路口）
const ORIGIN_ID = '6f9d6a722f3651';

const containerRef = ref(null);
const canvasRef    = ref(null);
const loading      = ref(true);
const loadingText  = ref('正在加载底图数据…');
const stats        = reactive({ roads: 0, inters: 0 });

let renderer, scene, camera, controls;
let osmLayer     = null;
let baseMapLayer = null;
let flowParticles  = null;
let congestionLayer = null;
let animId = null;

// 相机东向自动平移状态
let originTX   = NaN;   // 起点路口 Three.js X 坐标
let prevPanX   = 0;     // 上一帧的东向偏移量，用于增量更新

// ── 初始化 ────────────────────────────────────────────────────────────────────
async function init() {
  const W = containerRef.value.clientWidth;
  const H = containerRef.value.clientHeight;

  // 渲染器
  renderer = new THREE.WebGLRenderer({ canvas: canvasRef.value, antialias: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x040c1e, 1);
  renderer.toneMapping    = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  scene  = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 5000);

  // 初始相机（正北方向正俯视，数据加载后定位到起点路口）
  camera.up.set(0, 0, -1);  // 屏幕上方 = 地理正北
  camera.position.set(0, 340, 0);
  camera.lookAt(0, 0, 0);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping  = true;
  controls.dampingFactor  = 0.08;
  controls.enablePan      = true;
  controls.screenSpacePanning = true;
  controls.rotateSpeed    = -0.6;  // camera.up=(0,0,-1) 时需要反向
  controls.zoomSpeed      = 0.9;
  controls.minDistance    = 60;
  controls.maxDistance    = 1400;
  controls.minPolarAngle  = 0.1;
  controls.maxPolarAngle  = Math.PI / 2 - 0.04;
  controls.update();

  // ── 底图（区划 + 装饰节点 + 道路，与车流溯源场景共享） ────────────────────
  loadingText.value = '正在加载底图…';
  osmLayer = await createOSMLayer();
  osmLayer.traverse(o => { o.renderOrder = (o.renderOrder ?? 0) - 20; });
  scene.add(osmLayer);

  baseMapLayer = await createJinanBaseMapLayer({ showRoads: false });
  scene.add(baseMapLayer.group);

  const { roads: rawRoads, intersections } = baseMapLayer;
  stats.roads  = rawRoads.length;
  stats.inters = intersections.length;

  // ── 车流粒子（与车流溯源场景相同的 FlowParticles） ─────────────────────────
  loadingText.value = '正在生成粒子系统…';
  const flowRoads   = computeFlows(rawRoads);
  flowParticles     = new FlowParticles(flowRoads, 8000);
  flowParticles.mesh.renderOrder = 5;
  scene.add(flowParticles.mesh);

  // ── 拥堵蔓延图层（在粒子上方叠加） ──────────────────────────────────────────
  loadingText.value = '正在构建拥堵蔓延图层…';
  const topology     = buildTopology(rawRoads);
  congestionLayer    = createCongestionLayer(rawRoads, intersections, topology, ORIGIN_ID,
                         new THREE.Vector2(W, H));
  scene.add(congestionLayer);

  // ── 摄像机定位到起点路口：正北方向正俯视 ──────────────────────────────────
  const originInter = intersections.find(i => i.props.inter_id === ORIGIN_ID);
  if (originInter) {
    const [cx, cy] = originInter.pos;
    const TX = cx, TZ = -cy;
    originTX = TX;   // 存储供 animate() 自动东向平移使用
    prevPanX = 0;
    camera.position.set(TX, 280, TZ);
    camera.lookAt(TX, 0, TZ);
    camera.near = 0.5;
    camera.far  = 3000;
    camera.updateProjectionMatrix();
    controls.target.set(TX, 0, TZ);
    controls.minDistance = 60;
    controls.maxDistance = 800;
    controls.update();
  } else {
    baseMapLayer.frameCamera(camera, controls);
  }

  // 禁用视锥裁剪（保持与其他场景一致）
  scene.traverse(obj => { obj.frustumCulled = false; });

  loading.value = false;
  animate();
}

// ── 动画循环 ──────────────────────────────────────────────────────────────────
function animate() {
  animId = requestAnimationFrame(animate);
  const t = performance.now() / 1000;

  baseMapLayer?.update(t);
  flowParticles?.update(t);
  congestionLayer?.update(t);

  // ── 随波前向东缓慢平移相机 ──────────────────────────────────────────────
  if (!isNaN(originTX) && congestionLayer && controls && camera) {
    const ct      = congestionLayer.getCycleTime(t);
    const CYCLE   = congestionLayer.cycleTime;
    const FADE    = congestionLayer.fadeOutDur;
    const MAX_PAN = 60;  // 最大东向偏移（世界单位，≈600m）

    // 缓出曲线：随周期进度加速推进，末尾淡出归零
    const progress = Math.min(ct / (CYCLE - FADE), 1.0);
    const eased    = 1 - (1 - progress) ** 2;
    let panX = eased * MAX_PAN;
    if (ct > CYCLE - FADE) panX *= (CYCLE - ct) / FADE;

    // 增量更新 target 和 camera.position（保留用户手动平移的偏移量）
    const dx = panX - prevPanX;
    if (Math.abs(dx) > 0.001) {
      controls.target.x += dx;
      camera.position.x += dx;
    }
    prevPanX = panX;
  }

  controls?.update();
  renderer?.render(scene, camera);
}

// ── 窗口缩放 ──────────────────────────────────────────────────────────────────
function onResize() {
  if (!renderer || !camera || !containerRef.value) return;
  const W = containerRef.value.clientWidth;
  const H = containerRef.value.clientHeight;
  renderer.setSize(W, H);
  congestionLayer?.setResolution?.(W, H);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
}

onMounted(() => {
  init();
  window.addEventListener('resize', onResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', onResize);
  cancelAnimationFrame(animId);
  congestionLayer?.dispose();
  flowParticles?.dispose?.();
  baseMapLayer?.dispose();
  osmLayer?.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  renderer?.dispose();
});
</script>

<style scoped>
.scene-b {
  position: relative;
  width: 100vw;
  height: 100vh;
  background: #000;
  overflow: hidden;
}

canvas {
  position: absolute;
  inset: 0;
  width: 100% !important;
  height: 100% !important;
}

/* ── 加载遮罩 ────────────────────────────────────────────────────────────── */
.overlay {
  position: absolute;
  inset: 0;
  background: #010d1f;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}

.loading-inner {
  text-align: center;
  color: #7ec8f5;
  font-family: 'Courier New', monospace;
}

.loading-ring {
  width: 52px;
  height: 52px;
  border: 3px solid rgba(126, 200, 245, 0.2);
  border-top-color: #7ec8f5;
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
  margin: 0 auto 14px;
}

@keyframes spin { to { transform: rotate(360deg); } }

.loading-inner p {
  font-size: 13px;
  letter-spacing: 1px;
  opacity: 0.8;
}

/* ── HUD ─────────────────────────────────────────────────────────────────── */
.hud {
  position: absolute;
  top: 20px;
  left: 20px;
  color: #e8f4ff;
  font-family: 'Courier New', monospace;
  background: rgba(1, 8, 20, 0.80);
  border: 1px solid rgba(0, 180, 255, 0.22);
  border-radius: 10px;
  padding: 16px 20px;
  min-width: 230px;
  backdrop-filter: blur(6px);
}

.title-main {
  display: block;
  font-size: 20px;
  font-weight: bold;
  color: #ff3a22;
  letter-spacing: 3px;
  text-shadow: 0 0 14px rgba(255, 58, 34, 0.8);
}

.title-sub {
  display: block;
  font-size: 11px;
  opacity: 0.5;
  margin-top: 3px;
  letter-spacing: 1px;
}

/* 起点标签 */
.origin-badge {
  margin-top: 10px;
  padding: 6px 9px;
  background: rgba(255, 60, 20, 0.12);
  border: 1px solid rgba(255, 60, 20, 0.3);
  border-radius: 5px;
  font-size: 11px;
}

.badge-label {
  color: #ff7755;
  margin-right: 6px;
}

.badge-val {
  color: #ffd0c4;
  font-size: 11px;
}

/* 图例 */
.legend {
  margin-top: 12px;
  border-top: 1px solid rgba(255,255,255,0.08);
  padding-top: 10px;
}

.legend-row {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 12px;
  margin-bottom: 7px;
  opacity: 0.88;
}

.dot {
  width: 28px;
  height: 3px;
  border-radius: 2px;
  display: inline-block;
  flex-shrink: 0;
}

.dot.green  { background: #00cc44; box-shadow: 0 0 6px #00cc44; }
.dot.yellow { background: #ffcc00; box-shadow: 0 0 6px #ffcc00; }
.dot.red    { background: #ff1800; box-shadow: 0 0 8px #ff1800; }

.ripple-icon {
  width: 14px;
  height: 14px;
  border: 2px solid #ff2200;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
  box-shadow: 0 0 6px #ff2200;
  animation: pulse 1.9s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { transform: scale(1);   opacity: 1;   }
  50%       { transform: scale(1.4); opacity: 0.6; }
}

/* 统计 */
.hud-stats {
  display: flex;
  gap: 14px;
  margin-top: 12px;
  border-top: 1px solid rgba(255,255,255,0.08);
  padding-top: 10px;
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stat-val {
  font-size: 15px;
  font-weight: bold;
  color: #7ec8f5;
  text-shadow: 0 0 8px #7ec8f5;
}

.stat-lbl {
  font-size: 10px;
  opacity: 0.5;
  margin-top: 2px;
}

/* ── 角落装饰 ─────────────────────────────────────────────────────────────── */
.corner {
  position: absolute;
  width: 22px;
  height: 22px;
  opacity: 0.55;
}

.corner-tl { top: 12px; left: 12px; border-top: 2px solid #00e5ff; border-left: 2px solid #00e5ff; }
.corner-tr { top: 12px; right: 12px; border-top: 2px solid #00e5ff; border-right: 2px solid #00e5ff; }
.corner-bl { bottom: 12px; left: 12px; border-bottom: 2px solid #00e5ff; border-left: 2px solid #00e5ff; }
.corner-br { bottom: 12px; right: 12px; border-bottom: 2px solid #00e5ff; border-right: 2px solid #00e5ff; }

/* ── 动画过渡 ─────────────────────────────────────────────────────────────── */
.fade-enter-active, .fade-leave-active { transition: opacity 0.5s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>

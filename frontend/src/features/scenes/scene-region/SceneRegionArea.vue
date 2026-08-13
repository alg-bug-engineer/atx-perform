<template>
  <div class="region-area-scene" ref="containerRef">
    <canvas ref="canvasRef"></canvas>
    <Transition name="fade">
      <div v-if="loading" class="overlay">
        <div class="loading-inner">
          <div class="loading-ring"></div>
          <p>正在加载区域数据…</p>
        </div>
      </div>
    </Transition>
    <template v-if="!loading">
      <div class="corner corner-tl"></div>
      <div class="corner corner-tr"></div>
      <div class="corner corner-bl"></div>
      <div class="corner corner-br"></div>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import * as THREE from 'three';
import { OrbitControls }           from 'three/addons/controls/OrbitControls.js';
import { createJinanBaseMapLayer } from '../../../shared/three/createJinanBaseMapLayer.js';
import { createOSMLayer }          from '../../../shared/three/createOSMLayer.js';
import odFeatures                  from '../scene-a/tfcunit.json';
import { createOriginAreaLayer }   from '../scene-a/odLayer.js';
import { selectedRegion }          from '../../../shared/analysis-state.js';

// 拥堵排行区域名称 → tfcunit.json 中对应的 feature 索引
const REGION_FEATURE_INDEX = {
  '舜耕路—山大路片区':   1,
  '泺源大街—经七路片区': 2,
  '解放路—历山路片区':   0,
  '工业南路片区':         6,
  '北园大街片区':         3,
};

function getTargetFeature() {
  const name = selectedRegion.value;
  const idx  = (name && REGION_FEATURE_INDEX[name] !== undefined)
    ? REGION_FEATURE_INDEX[name]
    : 0;
  return odFeatures[idx] ?? odFeatures[0];
}

const containerRef = ref(null);
const canvasRef    = ref(null);
const loading      = ref(true);

let renderer, scene, camera, controls;
let osmLayer, baseMapLayer, areaLayer;
let animId;

async function init() {
  const W = containerRef.value.clientWidth;
  const H = containerRef.value.clientHeight;

  renderer = new THREE.WebGLRenderer({ canvas: canvasRef.value, antialias: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x040c1e, 1);
  renderer.toneMapping         = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  scene  = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 5000);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping      = true;
  controls.dampingFactor      = 0.08;
  controls.enablePan          = true;
  controls.screenSpacePanning = true;
  controls.panSpeed           = 1.2;
  controls.rotateSpeed        = 0.6;
  controls.zoomSpeed          = 0.9;
  controls.minDistance        = 60;
  controls.maxDistance        = 2000;
  controls.minPolarAngle      = 0.1;
  controls.maxPolarAngle      = Math.PI / 2 - 0.04;

  osmLayer = await createOSMLayer();
  osmLayer.traverse(o => { o.renderOrder = (o.renderOrder ?? 0) - 20; });
  scene.add(osmLayer);

  baseMapLayer = await createJinanBaseMapLayer({ showRoads: false });
  scene.add(baseMapLayer.group);

  // 根据跳转上下文展示对应区域围栏
  areaLayer = createOriginAreaLayer([getTargetFeature()]);
  scene.add(areaLayer);
  areaLayer.frameCamera(camera, controls);

  scene.traverse(obj => { obj.frustumCulled = false; });
  loading.value = false;
  animate();
}

function animate() {
  animId = requestAnimationFrame(animate);
  const t = performance.now() / 1000;
  baseMapLayer?.update(t);
  areaLayer?.update(t);
  controls.update();
  renderer.render(scene, camera);
}

function onResize() {
  if (!renderer || !camera) return;
  const W = containerRef.value.clientWidth;
  const H = containerRef.value.clientHeight;
  renderer.setSize(W, H);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
}

onMounted(() => {
  init();
  window.addEventListener('resize', onResize);
});

onUnmounted(() => {
  cancelAnimationFrame(animId);
  window.removeEventListener('resize', onResize);
  areaLayer?.dispose();
  baseMapLayer?.dispose();
  renderer?.dispose();
});
</script>

<style scoped>
.region-area-scene {
  position: relative;
  width: 100%;
  height: 100%;
  background: #040c1e;
  overflow: hidden;
}
canvas { display: block; width: 100%; height: 100%; }

.overlay {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(4, 12, 30, 0.85); z-index: 20;
}
.loading-inner { display: flex; flex-direction: column; align-items: center; gap: 14px; }
.loading-ring {
  width: 38px; height: 38px;
  border: 3px solid rgba(0, 200, 230, 0.25);
  border-top-color: rgba(0, 200, 230, 0.90);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}
.loading-inner p { color: rgba(0, 200, 230, 0.75); font-size: 13px; letter-spacing: 1px; }
@keyframes spin { to { transform: rotate(360deg); } }

.corner {
  position: absolute; width: 20px; height: 20px;
  border-color: rgba(0, 200, 230, 0.55); border-style: solid;
}
.corner-tl { top: 10px; left: 10px; border-width: 2px 0 0 2px; }
.corner-tr { top: 10px; right: 10px; border-width: 2px 2px 0 0; }
.corner-bl { bottom: 10px; left: 10px; border-width: 0 0 2px 2px; }
.corner-br { bottom: 10px; right: 10px; border-width: 0 2px 2px 0; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.4s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>

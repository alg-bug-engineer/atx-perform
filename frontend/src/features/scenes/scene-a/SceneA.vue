<template>
  <div class="od-scene" ref="containerRef">
    <canvas ref="canvasRef"></canvas>
    <div class="scene-title">
      <h1>OD飞线图层</h1>
      <p>第一个区域与其他区域的 OD 飞线关系。</p>
      <div class="mode-tabs">
        <button
          v-for="item in modeOptions"
          :key="item.key"
          :class="{ active: activeMode === item.key }"
          type="button"
          @click="switchMode(item.key)"
        >
          {{ item.label }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createJinanBaseMapLayer } from '../../../shared/three/createJinanBaseMapLayer.js';
import { createOSMLayer }          from '../../../shared/three/createOSMLayer.js';
import odFeatures from './tfcunit.json';
import { createODLayer } from './odLayer.js';

const containerRef = ref(null);
const canvasRef = ref(null);
const activeMode = ref('outbound');

const modeOptions = [
  { key: 'outbound', label: '内外' },
  { key: 'inbound', label: '外内' },
  { key: 'transit', label: '途径' },
];

let renderer, scene, camera, controls, osmLayer, baseMapLayer, odLayer, animId;

function rebuildODLayer() {
  if (!scene) return;
  if (odLayer) {
    scene.remove(odLayer);
    odLayer.dispose?.();
  }
  odLayer = createODLayer(odFeatures, activeMode.value);
  scene.add(odLayer);
}

function switchMode(mode) {
  activeMode.value = mode;
  rebuildODLayer();
}

async function init() {
  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;

  renderer = new THREE.WebGLRenderer({ canvas: canvasRef.value, antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x040c1e, 1);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.panSpeed = 1.2;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.9;

  // OSM 底图（最底层）
  osmLayer = await createOSMLayer();
  osmLayer.traverse(o => { o.renderOrder = (o.renderOrder ?? 0) - 20; });
  scene.add(osmLayer);

  baseMapLayer = await createJinanBaseMapLayer({ showRoads: false });
  baseMapLayer.group.traverse(obj => {
    if (obj.isMesh || obj.isLine || obj.isPoints) obj.renderOrder = 0;
  });
  scene.add(baseMapLayer.group);
  rebuildODLayer();
  // 以 OD 区块包围盒为准定位相机，使左右边缘贴屏
  odLayer.frameCamera(camera, controls);

  animate();
}

function animate() {
  animId = requestAnimationFrame(animate);
  const t = performance.now() / 1000;
  baseMapLayer?.update(t);
  odLayer?.update(t);
  controls?.update();
  renderer?.render(scene, camera);
}

function onResize() {
  if (!renderer || !camera || !containerRef.value) return;
  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

onMounted(async () => {
  await init();
  window.addEventListener('resize', onResize);
});

onUnmounted(() => {
  cancelAnimationFrame(animId);
  window.removeEventListener('resize', onResize);
  controls?.dispose();
  odLayer?.dispose();
  baseMapLayer?.dispose();
  osmLayer?.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  renderer?.dispose();
});
</script>

<style scoped>
.od-scene {
  width: 100vw;
  height: 100vh;
  position: relative;
  background: #040c1e;
  overflow: hidden;
}

canvas {
  position: absolute;
  inset: 0;
}

.scene-title {
  position: absolute;
  left: 24px;
  top: 24px;
  z-index: 10;
  color: #00e5ff;
  font-family: 'Courier New', monospace;
  pointer-events: none;
}

h1 {
  font-size: 24px;
  letter-spacing: 4px;
}

p {
  margin-top: 12px;
  opacity: 0.62;
}

.mode-tabs {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  pointer-events: auto;
}

button {
  border: 1px solid rgba(0, 229, 255, 0.32);
  background: rgba(0, 16, 24, 0.76);
  color: rgba(0, 229, 255, 0.72);
  cursor: pointer;
  font-family: 'Courier New', monospace;
  letter-spacing: 2px;
  padding: 7px 14px;
}

button.active,
button:hover {
  background: rgba(0, 229, 255, 0.16);
  color: #fff;
  box-shadow: 0 0 14px rgba(0, 229, 255, 0.22);
}
</style>

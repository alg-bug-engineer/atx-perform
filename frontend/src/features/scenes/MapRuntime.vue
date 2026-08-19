<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createOSMLayer } from '../../shared/three/createOSMLayer.js';
import { createJinanBaseMapLayer } from '../../shared/three/createJinanBaseMapLayer.js';
import { computeFlows } from '../../geo/topology.js';
import { buildTopology } from '../../geo/tracing.js';
import { project } from '../../geo/loader.js';
import { FlowParticles } from '../../mesh/particles.js';
import { createCityMonitorMapFx } from '../../layers/cityMonitorMapFx.js';
import { createScene0Opening } from './scene0-opening.js';
import { createScene2Cause } from './scene2-cause.js';
import SceneChrome from './SceneChrome.vue';
import HomeIdleStage from '../home/HomeIdleStage.vue';
import {
  activeScene,
  cityMonitorReveal,
  cityMonitorSelection,
  enterIdle,
  enterScene2,
  resetHomeIdleState,
} from '../../shared/home-idle-state.js';
import { act2MapBeat } from '../../shared/narrative-state.js';

/**
 * 分幕调试：本运行时只承担幕 0 开幕（幕 2 已原生化到 act-02）。
 * routeMode=true 时不提供内部切幕入口，切幕交给 ?scene= 路由。
 */
const props = defineProps({
  routeMode: { type: Boolean, default: false },
});

const emit = defineEmits(['ready']);

const hostRef = ref(null);
const loadingText = ref('加载地图…');
const ready = ref(false);
const sceneHud = ref({ text: '', caption: '' });

const showHomeIdle = computed(() => ready.value && activeScene.value === 'idle');
const showScene2Ui = computed(() => ready.value && activeScene.value === 'scene2');
const scene2Caption = computed(() => {
  if (!showScene2Ui.value) return '';
  return sceneHud.value.caption || sceneHud.value.text || '';
});
const dockStack = ref([]);

function formatSat(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(2);
}

function isSatCrit(v) {
  return Number(v) >= 0.85;
}

function applyDockPanel(state) {
  const phase = state.phase;
  const panel = state.panel;
  if (phase === 'trace' || phase === 'boot' || phase === 'error') {
    dockStack.value = panel ? [panel] : [];
    return;
  }
  if (phase === 'ew_clear') {
    dockStack.value = dockStack.value.filter((p) => p.kind !== 'trace');
    return;
  }
  if (!panel?.kind) return;
  const rest = dockStack.value.filter((p) => p.kind !== 'trace' && p.kind !== panel.kind);
  dockStack.value = [...rest, panel];
}

let renderer;
let scene;
let camera;
let controls;
let raf = 0;
let baseNetwork;
let flowParticles;
let cityMonitorFx;
let scene0;
let scene2;
let runtimeApi = null;
let mapCtx = null;
let disposed = false;

const camAnim = {
  active: false,
  lerp: 0.035,
  posTarget: new THREE.Vector3(),
  lookTarget: new THREE.Vector3(),
};

function resize() {
  if (!hostRef.value || !renderer || !camera) return;
  const w = hostRef.value.clientWidth;
  const h = hostRef.value.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  scene2?.setResolution?.(w, h);
}

function setTopDownCamera({ x, z, height, immediate = false }) {
  camera.up.set(0, 0, -1);
  const pos = new THREE.Vector3(x, height, z);
  const look = new THREE.Vector3(x, 0, z);
  if (immediate) {
    camAnim.active = false;
    camera.position.copy(pos);
    controls.target.copy(look);
    controls.update();
    return;
  }
  animateCamera({
    posTarget: { x: pos.x, y: pos.y, z: pos.z },
    lookTarget: { x: look.x, y: look.y, z: look.z },
    lerp: 0.035,
  });
}

function animateCamera({ posTarget, lookTarget, lerp = 0.035 }) {
  camAnim.posTarget.set(posTarget.x, posTarget.y, posTarget.z);
  camAnim.lookTarget.set(lookTarget.x, lookTarget.y, lookTarget.z);
  camAnim.lerp = lerp;
  camAnim.active = true;
  controls.minDistance = 40;
  controls.maxDistance = Math.max(4500, Math.hypot(posTarget.x, posTarget.z) + posTarget.y + 800);
  camera.far = Math.max(camera.far || 3000, controls.maxDistance + 500);
  camera.updateProjectionMatrix();
}

function tick() {
  if (disposed) return;
  raf = requestAnimationFrame(tick);
  const time = performance.now() / 1000;

  if (camAnim.active && camera && controls) {
    camera.position.lerp(camAnim.posTarget, camAnim.lerp);
    controls.target.lerp(camAnim.lookTarget, camAnim.lerp);
    camera.up.set(0, 0, -1);
    controls.update();
    if (camera.position.distanceTo(camAnim.posTarget) < 0.8) {
      camAnim.active = false;
    }
  } else {
    controls?.update();
  }

  flowParticles?.update?.();
  baseNetwork?.update?.(time);
  if (activeScene.value === 'idle') scene0?.update?.(time);
  if (activeScene.value === 'scene2') scene2?.update?.(time);
  cityMonitorFx?.update?.(time);
  renderer.render(scene, camera);
}

watch(cityMonitorSelection, (sel) => {
  if (activeScene.value !== 'idle') return;
  if (!sel?.type || !sel?.id || !cityMonitorReveal.value || !scene0) return;
  scene0.focusSelection(sel.type, sel.id);
});

// 幕 1 渠化展示后隐藏问题路段拥堵带（渠化+排队车即拥堵表达载体）
watch(act2MapBeat, (b) => {
  if (b === 'channelization') scene0?.hideProblemAlert?.();
});

// 首页内 scene0 → scene2（分析成因）由 HomeIdleStage 的 enter-scene2 事件触发
async function ensureScene2() {
  if (scene2 || !runtimeApi || !mapCtx) return;
  scene2 = await createScene2Cause(runtimeApi, mapCtx, {
    onHud: (state) => {
      sceneHud.value = { ...sceneHud.value, ...state };
      applyDockPanel(state);
    },
  });
}

async function onEnterScene2() {
  scene0?.stop?.();
  cityMonitorFx?.clear?.();
  resetHomeIdleState();
  sceneHud.value = {
    text: '正在进行问题路段流量溯源',
    caption: '正在进行问题路段流量溯源',
    phase: 'boot',
    panel: { kind: 'trace', title: '流量溯源' },
  };
  applyDockPanel(sceneHud.value);
  await ensureScene2();
  scene2?.play?.();
}

async function onBackIdle() {
  scene2?.stop?.();
  scene2?.dispose?.();
  scene2 = null;
  enterIdle();
  sceneHud.value = { text: '', caption: '', panel: null };
  dockStack.value = [];
  scene0?.replay?.();
}

function onReplay() {
  if (activeScene.value === 'scene2') {
    scene2?.replay?.();
    return;
  }
  scene0?.replay?.();
}

async function boot() {
  const el = hostRef.value;
  if (!el) return;

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
  camera.up.set(0, 0, -1);
  camera.position.set(0, 1600, 40);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x040c1e, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  el.appendChild(renderer.domElement);

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
  controls.maxDistance = 4500;
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.PAN,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE,
  };

  runtimeApi = {
    scene,
    camera,
    controls,
    setTopDownCamera,
    animateCamera,
  };

  resize();
  window.addEventListener('resize', resize);

  loadingText.value = '正在加载 OSM 底图…';
  const osm = await createOSMLayer();
  osm.traverse((o) => {
    o.renderOrder = (o.renderOrder ?? 0) - 20;
  });
  scene.add(osm);

  loadingText.value = '正在加载路网数据…';
  baseNetwork = await createJinanBaseMapLayer({ showRoads: false });
  scene.add(baseNetwork.group);

  const allRoads = computeFlows(baseNetwork.roads);
  const allIntersections = baseNetwork.intersections;
  const topology = buildTopology(allRoads);
  mapCtx = {
    roads: allRoads,
    intersections: allIntersections,
    topology,
    getResolution: () => {
      const el = hostRef.value;
      return el
        ? new THREE.Vector2(el.clientWidth, el.clientHeight)
        : new THREE.Vector2(1920, 1080);
    },
  };

  flowParticles = new FlowParticles(allRoads, 5000, {
    allowedClasses: ['express', 'arterial'],
    speedScale: 1.35,
  });
  scene.add(flowParticles.mesh);

  cityMonitorFx = createCityMonitorMapFx({ project });
  scene.add(cityMonitorFx.group);

  // merged_network 使用 hash inter_id；用名称锚定奥体西走廊
  const overviewInter =
    allIntersections.find((i) => (i.props?.inter_name || '').includes('解放东') && (i.props?.inter_name || '').includes('奥体西')) ||
    allIntersections.find((i) => (i.props?.inter_name || '').includes('经十') && (i.props?.inter_name || '').includes('奥体西')) ||
    allIntersections[0];
  const overviewCenter = overviewInter?.pos;

  scene0 = createScene0Opening(
    runtimeApi,
    { cityMonitorFx, intersections: allIntersections, overviewCenter },
    {},
  );

  scene.traverse((obj) => {
    obj.frustumCulled = false;
  });

  ready.value = true;
  loadingText.value = '';
  tick();
  emit('ready');

  enterIdle();
  scene0.play();
}

onMounted(() => {
  boot().catch((err) => {
    console.error(err);
    loadingText.value = String(err.message || err);
  });
});

onBeforeUnmount(() => {
  disposed = true;
  cancelAnimationFrame(raf);
  window.removeEventListener('resize', resize);
  scene2?.dispose?.();
  scene0?.dispose?.();
  cityMonitorFx?.dispose?.();
  flowParticles?.dispose?.();
  baseNetwork?.dispose?.();
  controls?.dispose?.();
  renderer?.dispose?.();
  if (renderer?.domElement?.parentNode) {
    renderer.domElement.parentNode.removeChild(renderer.domElement);
  }
});

defineExpose({ replay: onReplay });
</script>

<template>
  <div class="map-runtime">
    <div ref="hostRef" class="map-host" />
    <Transition name="fade">
      <div v-if="loadingText" class="boot-mask">
        <div class="loading-inner">
          <div class="loading-ring" />
          <p>{{ loadingText }}</p>
        </div>
      </div>
    </Transition>
    <SceneChrome v-if="ready" />
    <HomeIdleStage v-if="showHomeIdle" />

    <aside v-if="showScene2Ui && dockStack.length" class="scene2-dock">
      <div v-for="item in dockStack" :key="item.kind" class="dock-card">
        <div class="dock-title">{{ item.title }}</div>

        <p v-if="item.kind === 'trace'" class="dock-lead">正在进行问题路段流量溯源</p>

        <template v-else-if="item.kind === 'supply'">
          <div class="dock-row">
            <span>供给流量</span>
            <strong>{{ item.supply }} vph</strong>
          </div>
          <div class="dock-row">
            <span>需求流量</span>
            <strong>{{ item.demand }} vph</strong>
          </div>
          <div class="dock-ok">{{ item.conclusion }}</div>
        </template>

        <template v-else-if="item.kind === 'arterial'">
          <div v-for="arm in item.approaches" :key="arm.role" class="dock-arm">
            <div class="dock-arm-h">
              <span class="dock-role">{{ arm.name ? `${arm.name} ${arm.role}` : arm.role }}</span>
            </div>
            <div class="dock-metrics">
              <div>
                <div class="dock-num" :class="{ crit: isSatCrit(arm.saturation) }">
                  {{ formatSat(arm.saturation) }}
                </div>
                <div class="dock-lab">饱和度</div>
              </div>
              <div>
                <div class="dock-num">{{ arm.flow_vph }}</div>
                <div class="dock-lab">直行流量 vph</div>
              </div>
            </div>
          </div>
          <p v-if="item.copy" class="dock-copy">{{ item.copy }}</p>
        </template>

        <template v-else-if="item.kind === 'signal'">
          <div class="dock-hero">{{ item.value }}</div>
          <p v-if="item.copy" class="dock-copy">{{ item.copy }}</p>
        </template>

        <template v-else-if="item.kind === 'overflow'">
          <div class="dock-hero warn">{{ item.queue_m }} m</div>
          <div class="dock-lab">排队长度</div>
          <p v-if="item.copy" class="dock-copy">{{ item.copy }}</p>
        </template>
      </div>
    </aside>

    <div
      v-if="showScene2Ui && scene2Caption"
      class="scene2-caption"
    >
      <span class="scan-dot" />
      <span class="hint-text">{{ scene2Caption }}</span>
    </div>

    <div v-if="ready" class="bottom-actions">
      <button
        v-if="showScene2Ui && !routeMode"
        type="button"
        class="action-btn"
        @click="onBackIdle"
      >
        返回首页
      </button>
      <button type="button" class="action-btn" @click="onReplay">
        {{ showScene2Ui ? '重播溯源' : '重播巡检' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.map-runtime {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000;
}

.map-host,
.map-host :deep(canvas) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.boot-mask {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(2, 8, 16, 0.92);
  color: var(--text);
  font-family: 'Courier New', monospace;
}

.loading-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.loading-ring {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 2px solid rgba(0, 229, 255, 0.2);
  border-top-color: #00e5ff;
  animation: spin 0.9s linear infinite;
}

.loading-inner p {
  margin: 0;
  font-size: 12px;
  letter-spacing: 2px;
  color: rgba(240, 246, 255, 0.85);
}

.scene2-dock {
  position: absolute;
  left: 24px;
  top: 92px;
  z-index: 38;
  width: min(280px, calc(100vw - 48px));
  max-height: calc(100% - 160px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
  font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

.dock-card {
  padding: 10px 12px;
  background: rgba(6, 14, 26, 0.9);
  border: 1px solid rgba(0, 200, 230, 0.28);
}

.dock-title {
  font-size: 12px;
  letter-spacing: 1px;
  color: rgba(240, 246, 255, 0.9);
  margin-bottom: 8px;
}

.dock-lead {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(230, 240, 250, 0.92);
}

.dock-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 14px;
  color: rgba(240, 246, 255, 0.72);
  padding: 3px 0;
}

.dock-row strong {
  color: #e8f6ff;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.dock-ok {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(0, 229, 255, 0.22);
  color: #86efac;
  font-size: 13px;
  letter-spacing: 0.4px;
}

.dock-copy {
  margin: 8px 0 0;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  font-size: 12px;
  line-height: 1.55;
  color: rgba(220, 230, 240, 0.92);
}

.dock-arm + .dock-arm {
  margin-top: 8px;
}

.dock-arm-h {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}

.dock-role {
  font-size: 11px;
  color: rgba(255, 180, 100, 0.9);
}

.dock-mock {
  font-size: 10px;
  color: rgba(250, 204, 21, 0.9);
}

.dock-metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.dock-num {
  font-size: 18px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: rgba(230, 240, 250, 0.95);
  line-height: 1.2;
}

.dock-num.crit {
  color: #fb7185;
}

.dock-lab {
  font-size: 10px;
  color: rgba(160, 180, 200, 0.75);
  margin-top: 2px;
}

.dock-hero {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #86efac;
}

.dock-hero.warn {
  color: var(--text);
}

.scene2-caption {
  position: absolute;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 37;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  max-width: min(560px, calc(100vw - 280px));
  padding: 8px 16px;
  font-size: 14px;
  letter-spacing: 1px;
  line-height: 1.5;
  font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
  color: rgba(232, 246, 255, 0.95);
  background: rgba(4, 14, 26, 0.78);
  border: 1px solid rgba(0, 229, 255, 0.35);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(8px);
  pointer-events: none;
}

.scan-dot {
  width: 7px;
  height: 7px;
  margin-top: 4px;
  flex-shrink: 0;
  border-radius: 50%;
  background: #f5a623;
  box-shadow: 0 0 8px rgba(245, 166, 35, 0.8);
  animation: pulse 1s ease-in-out infinite;
}

.hint-text {
  flex: 1;
  min-width: 0;
  white-space: normal;
}

.bottom-actions {
  position: absolute;
  right: 20px;
  bottom: 28px;
  z-index: 40;
  display: flex;
  gap: 10px;
}

.action-btn {
  border: 1px solid rgba(0, 229, 255, 0.35);
  background: rgba(0, 20, 30, 0.72);
  color: var(--text);
  font-family: 'Courier New', monospace;
  font-size: 11px;
  letter-spacing: 2px;
  padding: 6px 12px;
  cursor: pointer;
}

.action-btn:hover {
  background: rgba(0, 229, 255, 0.14);
  box-shadow: 0 0 12px rgba(0, 229, 255, 0.22);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.6s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.85);
  }
  50% {
    opacity: 1;
    transform: scale(1.15);
  }
}
</style>

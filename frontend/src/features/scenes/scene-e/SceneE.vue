<template>
  <div class="scene-e" ref="containerRef">
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

    <!-- HUD -->
    <template v-if="!loading">
      <div class="hud">
        <div class="hud-title">
          <span class="title-main">干线诊断</span>
          <span class="title-sub">经十路 · {{ roadCount }} 条路段 · {{ sigCount }} 个信号路口</span>
        </div>
        <div class="hint">左键旋转 · 右键平移 · 滚轮缩放</div>
      </div>

      <div class="legend">
        <div class="leg-item">
          <span class="leg-line" style="background:#ff5500"></span>
          经十路干线路段
        </div>
        <div class="leg-item">
          <span class="leg-dot" style="background:#ff5533"></span>
          信号路口
        </div>
        <div class="leg-item">
          <span class="leg-dot" style="background:#ff0000; box-shadow:0 0 6px #ff0000"></span>
          重点路口
        </div>
      </div>
    </template>

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
 * SceneE — 干线诊断
 *
 * • 干线路段用 Line2（fat lines）加粗橙色显示
 * • 信号路口高亮圆点 + 路口名称标签（交错上下显示）
 * • "千佛山东路与历山路路口" 特殊：亮红色 + 向外扩散光环
 * • 侧边栏加载完毕（leftPanelReady）后才显示路口，并飞行定位至重点路口
 */

import { ref, watch, onMounted, onUnmounted } from 'vue';
import * as THREE from 'three';
import { OrbitControls }  from 'three/addons/controls/OrbitControls.js';
import { Line2 }          from 'three/addons/lines/Line2.js';
import { LineGeometry }   from 'three/addons/lines/LineGeometry.js';
import { LineMaterial }   from 'three/addons/lines/LineMaterial.js';
import { createOSMLayer } from '../../../shared/three/createOSMLayer.js';
import { rightPanelReady, activeAnalysisTab, arterialTracingActive } from '../../../shared/analysis-state.js';
import { createArterialTracingLayer } from './arterialTracingLayer.js';

// ── Projection ────────────────────────────────────────────────────────────────
const CENTER_LON = 117.096, CENTER_LAT = 36.662, MPU = 10;
function project(lon, lat) {
  const x =  (lon - CENTER_LON) * Math.cos(CENTER_LAT * Math.PI / 180) * (Math.PI / 180) * 6371000 / MPU;
  const z = -(lat - CENTER_LAT) * (Math.PI / 180) * 6371000 / MPU;
  return [x, z];
}

// ── Vue 状态 ──────────────────────────────────────────────────────────────────
const containerRef = ref(null);
const canvasRef    = ref(null);
const loading      = ref(true);
const loadingText  = ref('正在加载地图数据…');
const roadCount    = ref(0);
const sigCount     = ref(0);

// ── Three.js 变量 ──────────────────────────────────────────────────────────────
let renderer, scene, camera, controls, animId;
let osmLayer, arterialGroup;
let interGroup    = null;  // 路口标记 + 标签（初始隐藏）
let rippleMeshes  = [];    // 重点路口扩散光环
let specialPos    = null;  // 重点路口世界坐标 [x, z]
let dataReady     = false; // buildArterialLayer 完成标记
let tracingLayer   = null;  // 干线溯源图层
let _allLines      = [];    // 全量 LineString features
let _allPoints     = [];    // 全量 Point features（路口）
let _arterialRoads = [];    // 干线路段 features

// ── 相机飞行 ──────────────────────────────────────────────────────────────────
const _fly = { active: false, posTarget: new THREE.Vector3(), lookTarget: new THREE.Vector3() };

function startFly(px, py, pz, lx, lz) {
  _fly.posTarget.set(px, py, pz);
  _fly.lookTarget.set(lx, 0, lz);
  _fly.active = true;
  if (controls) controls.enabled = false;
}

// ── 重点路口名称常量 ──────────────────────────────────────────────────────────
const SPECIAL_NAME = '千佛山东路与历山路路口';

// ── 创建路口名称 Canvas Sprite ─────────────────────────────────────────────────
function createLabelSprite(text, isSpecial = false) {
  const fontSize  = 30;
  const padding   = 14;
  const font = `bold ${fontSize}px "PingFang SC","Microsoft YaHei",sans-serif`;

  const tmp = document.createElement('canvas').getContext('2d');
  tmp.font  = font;
  const tw  = tmp.measureText(text).width;

  const canvas = document.createElement('canvas');
  canvas.width  = tw + padding * 2 + 4;
  canvas.height = fontSize + padding * 2;

  const ctx = canvas.getContext('2d');

  // 背景胶囊
  ctx.fillStyle = isSpecial
    ? 'rgba(30, 4, 4, 0.92)'
    : 'rgba(4, 10, 28, 0.85)';
  const r = canvas.height / 2;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(canvas.width - r, 0);
  ctx.arcTo(canvas.width, 0, canvas.width, canvas.height, r);
  ctx.lineTo(canvas.width - r, canvas.height);
  ctx.arcTo(0, canvas.height, 0, 0, r);
  ctx.lineTo(r, 0);
  ctx.fill();

  // 边框
  ctx.strokeStyle = isSpecial ? 'rgba(255,60,0,0.85)' : 'rgba(255,140,0,0.55)';
  ctx.lineWidth   = isSpecial ? 2.5 : 1.5;
  ctx.stroke();

  // 文字
  ctx.font         = font;
  ctx.fillStyle    = isSpecial ? '#ff6644' : '#ffd080';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, padding + 2, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, sizeAttenuation: true,
  }));
  const scaleFactor = isSpecial ? 4.5 : 5.5;
  sprite.scale.set(canvas.width / scaleFactor, canvas.height / scaleFactor, 1);
  sprite.frustumCulled = false;
  return sprite;
}

// ── 构建干线图层 ──────────────────────────────────────────────────────────────
async function buildArterialLayer() {
  const resp    = await fetch('/merged_network.geojson');
  const geojson = await resp.json();
  const lines   = geojson.features.filter(f => f.geometry.type === 'LineString');
  const points  = geojson.features.filter(f => f.geometry.type === 'Point');

  // 保存全量数据供溯源使用
  _allLines  = lines;
  _allPoints = points;

  // 1. 筛选路段
  const arterialRoads = lines.filter(f =>
    String(f.properties.road_names || '').startsWith('经十路:'),
  );
  _arterialRoads = arterialRoads;
  roadCount.value = arterialRoads.length;

  // 2. 收集关联路口 ID
  const relatedIds = new Set();
  for (const road of arterialRoads) {
    const p = road.properties;
    if (p.from_inter_id) relatedIds.add(p.from_inter_id);
    if (p.to_inter_id)   relatedIds.add(p.to_inter_id);
    String(p.path_inter_ids || '').split(',').forEach(id => {
      const s = id.trim(); if (s) relatedIds.add(s);
    });
  }

  const signalInters = points.filter(f =>
    f.properties.is_signlight === 1 && relatedIds.has(f.properties.inter_id),
  );
  const normalInters = points.filter(f =>
    f.properties.is_signlight !== 1 && relatedIds.has(f.properties.inter_id),
  );
  sigCount.value = signalInters.length;

  const group = new THREE.Group();

  // ── 3. Fat Lines（橙色，三层叠加）──────────────────────────────────────────
  const W = containerRef.value?.clientWidth  || window.innerWidth;
  const H = containerRef.value?.clientHeight || window.innerHeight;
  const res = new THREE.Vector2(W, H);

  const layerCfg = [
    { lw: 14, color: 0xcc3300, opacity: 0.15 },  // 外层宽晕（暗橙）
    { lw: 7,  color: 0xdd4400, opacity: 0.45 },  // 中层橙
    { lw: 2.5,color: 0xff5500, opacity: 0.95 },  // 核心橙（不偏黄）
  ];

  for (const road of arterialRoads) {
    for (const { lw, color, opacity } of layerCfg) {
      const positions = [];
      road.geometry.coordinates.forEach(([lon, lat]) => {
        const [x, z] = project(lon, lat);
        positions.push(x, 1.5, z);
      });
      const geom = new LineGeometry();
      geom.setPositions(positions);
      const mat = new LineMaterial({
        color, linewidth: lw, transparent: true, opacity,
        blending: THREE.AdditiveBlending, depthWrite: false, resolution: res,
      });
      const line = new Line2(geom, mat);
      line.computeLineDistances();
      line.frustumCulled = false;
      group.add(line);
    }
  }

  // ── 4. 路口标记（初始隐藏，leftPanelReady 触发后显示）────────────────────────
  interGroup = new THREE.Group();
  interGroup.visible = false;
  group.add(interGroup);

  const dummy = new THREE.Object3D();

  // 普通关联路口：小蓝点
  if (normalInters.length > 0) {
    const norMesh = new THREE.InstancedMesh(
      new THREE.CircleGeometry(2.5, 12),
      new THREE.MeshBasicMaterial({
        color: 0x66ccff, transparent: true, opacity: 0.45,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
      normalInters.length,
    );
    norMesh.frustumCulled = false;
    normalInters.forEach((f, i) => {
      const [lon, lat] = f.geometry.coordinates;
      const [x, z] = project(lon, lat);
      dummy.position.set(x, 2, z); dummy.rotation.x = -Math.PI / 2; dummy.updateMatrix();
      norMesh.setMatrixAt(i, dummy.matrix);
    });
    norMesh.instanceMatrix.needsUpdate = true;
    interGroup.add(norMesh);
  }

  // 信号路口：外晕 + 核心点（按 x 排序后交错上下标签）
  const sortedSignal = [...signalInters].sort((a, b) => {
    const [ax] = project(a.geometry.coordinates[0], a.geometry.coordinates[1]);
    const [bx] = project(b.geometry.coordinates[0], b.geometry.coordinates[1]);
    return ax - bx;
  });

  const glowMesh = new THREE.InstancedMesh(
    new THREE.CircleGeometry(7, 24),
    new THREE.MeshBasicMaterial({
      color: 0xff3300, transparent: true, opacity: 0.28,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }),
    sortedSignal.length,
  );
  glowMesh.frustumCulled = false; glowMesh.renderOrder = 10;

  const coreMesh = new THREE.InstancedMesh(
    new THREE.CircleGeometry(4, 24),
    new THREE.MeshBasicMaterial({
      color: 0xff5533, transparent: true, opacity: 0.92,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }),
    sortedSignal.length,
  );
  coreMesh.frustumCulled = false; coreMesh.renderOrder = 11;

  // 重点路口（特殊颜色）
  let specialMeshGlow = null, specialMeshCore = null;
  const specialFeature = sortedSignal.find(f =>
    f.properties.inter_name === SPECIAL_NAME,
  );
  if (specialFeature) {
    const [lon, lat] = specialFeature.geometry.coordinates;
    const [sx, sz] = project(lon, lat);
    specialPos = [sx, sz];

    // 重点路口底盘（大红光晕）
    specialMeshGlow = new THREE.Mesh(
      new THREE.CircleGeometry(12, 32),
      new THREE.MeshBasicMaterial({
        color: 0xff1100, transparent: true, opacity: 0.35,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    specialMeshGlow.rotation.x = -Math.PI / 2;
    specialMeshGlow.position.set(sx, 4, sz);
    specialMeshGlow.frustumCulled = false;
    specialMeshGlow.renderOrder = 12;
    interGroup.add(specialMeshGlow);

    specialMeshCore = new THREE.Mesh(
      new THREE.CircleGeometry(6, 32),
      new THREE.MeshBasicMaterial({
        color: 0xff3300, transparent: true, opacity: 1.0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    specialMeshCore.rotation.x = -Math.PI / 2;
    specialMeshCore.position.set(sx, 5, sz);
    specialMeshCore.frustumCulled = false;
    specialMeshCore.renderOrder = 13;
    interGroup.add(specialMeshCore);

    // 扩散光环（3 个，交错相位）
    rippleMeshes = [];
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(6, 10, 40),
        new THREE.MeshBasicMaterial({
          color: 0xff2200, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        }),
      );
      ring.rotation.x  = -Math.PI / 2;
      ring.position.set(sx, 3.5, sz);
      ring.frustumCulled = false;
      ring.renderOrder   = 14;
      ring.userData.phase = i / 3; // 初始相位偏移
      interGroup.add(ring);
      rippleMeshes.push(ring);
    }
  }

  sortedSignal.forEach((f, i) => {
    const [lon, lat] = f.geometry.coordinates;
    const [x, z] = project(lon, lat);
    const isSpecial = f.properties.inter_name === SPECIAL_NAME;

    if (!isSpecial) {
      // 普通信号路口：添加到 instanced mesh
      dummy.position.set(x, 3, z); dummy.rotation.x = -Math.PI / 2; dummy.updateMatrix();
      glowMesh.setMatrixAt(i, dummy.matrix);
      coreMesh.setMatrixAt(i, dummy.matrix);
    } else {
      // 重点路口跳过 instanced mesh（已单独绘制），置于原点（scale=0 效果）
      dummy.position.set(0, -9999, 0); dummy.rotation.x = -Math.PI / 2; dummy.updateMatrix();
      glowMesh.setMatrixAt(i, dummy.matrix);
      coreMesh.setMatrixAt(i, dummy.matrix);
    }

    // ── 标签（交错上下显示）──────────────────────────────────────────────────
    const name = f.properties.inter_name;
    if (!name) return;

    const sprite = createLabelSprite(name, isSpecial);
    // 奇偶交错：偶数索引 → 路段下方偏前，奇数索引 → 路段上方偏后
    const yHigh = isSpecial ? 52 : 42;
    const yLow  = 20;
    const labelY = (i % 2 === 0) ? yLow : yHigh;
    sprite.position.set(x, labelY, z);
    interGroup.add(sprite);
  });

  glowMesh.instanceMatrix.needsUpdate = true;
  coreMesh.instanceMatrix.needsUpdate = true;
  interGroup.add(glowMesh, coreMesh);

  // ── 5. 计算路段中心 ──────────────────────────────────────────────────────
  let sumX = 0, sumZ = 0, total = 0;
  for (const road of arterialRoads) {
    for (const [lon, lat] of road.geometry.coordinates) {
      const [x, z] = project(lon, lat);
      sumX += x; sumZ += z; total++;
    }
  }
  if (total > 0) { group.userData.cx = sumX / total; group.userData.cz = sumZ / total; }

  return group;
}

// ── 构建干线溯源图层（与整条干线相交的路段） ────────────────────────────────────
function buildAndShowTracingLayer() {
  if (!scene || !renderer) return;
  if (tracingLayer) { scene.remove(tracingLayer); tracingLayer.dispose?.(); tracingLayer = null; }
  const res = new THREE.Vector2(renderer.domElement.clientWidth, renderer.domElement.clientHeight);
  tracingLayer = createArterialTracingLayer(_allLines, _allPoints, _arterialRoads, res);
  scene.add(tracingLayer);
}

// ── 显示路口并飞至重点路口 ─────────────────────────────────────────────────────
function revealIntersections() {
  if (!interGroup || interGroup.visible) return;
  interGroup.visible = true;

  // 延迟 0.8s 后飞行至重点路口
  if (specialPos) {
    setTimeout(() => {
      const [sx, sz] = specialPos;
      startFly(sx, 480, sz + 260, sx, sz);
    }, 800);
  }
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
  camera.position.set(0, 600, 300);
  camera.lookAt(0, 0, 0);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.minDistance = 60; controls.maxDistance = 8000;
  controls.maxPolarAngle = Math.PI / 2.1;
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.update();

  loadingText.value = '正在构建 OSM 底图…';
  osmLayer = await createOSMLayer();
  scene.add(osmLayer);

  loadingText.value = '正在解析干线路段数据…';
  arterialGroup = await buildArterialLayer();
  scene.add(arterialGroup);

  // 定位相机到干线全线
  const cx = arterialGroup.userData.cx ?? 0;
  const cz = arterialGroup.userData.cz ?? 0;
  camera.position.set(cx, 500, cz + 280);
  camera.lookAt(cx, 0, cz);
  controls.target.set(cx, 0, cz);
  controls.update();

  loading.value = false;
  dataReady = true;

  // 若面板已先加载完毕（skipAnim 快速路径）
  if (rightPanelReady.value && activeAnalysisTab.value === 'arterial') {
    revealIntersections();
  }

  animate();
}

// ── 监听右侧面板推理完成 ──────────────────────────────────────────────────────
watch(rightPanelReady, (ready) => {
  if (ready && activeAnalysisTab.value === 'arterial' && dataReady) {
    revealIntersections();
  }
});

// ── 监听干线溯源可视化阶段启动 ────────────────────────────────────────────────
watch(arterialTracingActive, (active) => {
  if (active && activeAnalysisTab.value === 'arterial' && dataReady) {
    buildAndShowTracingLayer();
  }
});

// ── Animate ───────────────────────────────────────────────────────────────────
function animate() {
  animId = requestAnimationFrame(animate);
  const t = performance.now() / 1000;

  // 扩散光环动画（仅路口显示后运行）
  if (interGroup?.visible && rippleMeshes.length > 0) {
    const PERIOD = 1.8;
    rippleMeshes.forEach(ring => {
      ring.userData.phase = (ring.userData.phase + (1 / 60) / PERIOD) % 1;
      const ph = ring.userData.phase;
      ring.scale.setScalar(1 + ph * 5);
      ring.material.opacity = (1 - ph) * 0.65;
    });
  }

  // 相机飞行（0.03 更慢更平滑）
  if (_fly.active) {
    camera.position.lerp(_fly.posTarget,  0.03);
    controls.target.lerp(_fly.lookTarget, 0.03);
    camera.lookAt(controls.target);
    if (camera.position.distanceTo(_fly.posTarget) < 2 &&
        controls.target.distanceTo(_fly.lookTarget) < 1) {
      camera.position.copy(_fly.posTarget);
      controls.target.copy(_fly.lookTarget);
      camera.lookAt(controls.target);
      _fly.active      = false;
      controls.enabled = true;
      controls.update();
    }
  } else {
    controls.update();
  }

  // 溯源图层动画
  tracingLayer?.update(t);

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
  arterialGroup?.traverse(obj => {
    if (obj.material instanceof LineMaterial) obj.material.resolution.set(W, H);
  });
  tracingLayer?.lineMaterials?.forEach(m => m.resolution?.set(W, H));
}

onMounted(() => { init(); window.addEventListener('resize', onResize); });

onUnmounted(() => {
  cancelAnimationFrame(animId);
  window.removeEventListener('resize', onResize);
  controls?.dispose();
  osmLayer?.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  arterialGroup?.traverse(o => {
    o.geometry?.dispose();
    if (o.material?.map) o.material.map.dispose();
    o.material?.dispose();
  });
  tracingLayer?.dispose();
  renderer?.dispose();
  rippleMeshes  = [];
  interGroup    = null;
  tracingLayer  = null;
  dataReady     = false;
});
</script>

<style scoped>
.scene-e {
  position: relative; width: 100vw; height: 100vh;
  overflow: hidden; background: #040c1e;
}
.main-canvas {
  position: absolute; inset: 0; display: block;
  width: 100% !important; height: 100% !important; cursor: default;
}

/* ── Loading ──────────────────────────────────────────────────────────────── */
.overlay {
  position: absolute; inset: 0; background: #040c1e;
  display: flex; align-items: center; justify-content: center; z-index: 50;
}
.loading-inner { text-align: center; color: #ff9933; font-family: 'Courier New', monospace; }
.loading-ring {
  width: 52px; height: 52px;
  border: 3px solid rgba(255,153,51,0.2); border-top-color: #ff9933;
  border-radius: 50%; animation: spin 0.9s linear infinite; margin: 0 auto 14px;
}
@keyframes spin { to { transform: rotate(360deg); } }
.loading-inner p { font-size: 13px; letter-spacing: 1px; opacity: 0.8; }

/* ── HUD ─────────────────────────────────────────────────────────────────── */
.hud {
  position: absolute; top: 20px; left: 20px; z-index: 20;
  color: #e8f4ff; font-family: 'Courier New', monospace;
  background: rgba(4,10,24,0.85); border: 1px solid rgba(255,120,0,0.3);
  border-radius: 10px; padding: 14px 18px;
  backdrop-filter: blur(8px); pointer-events: none;
}
.title-main {
  display: block; font-size: 20px; font-weight: bold;
  color: #ff9933; letter-spacing: 3px;
  text-shadow: 0 0 14px rgba(255,153,51,0.8);
}
.title-sub { display: block; font-size: 11px; opacity: 0.55; margin-top: 4px; }
.hint      { margin-top: 8px; font-size: 11px; opacity: 0.4; }

/* ── Legend ──────────────────────────────────────────────────────────────── */
.legend {
  position: absolute; bottom: 30px; left: 20px; z-index: 20;
  display: flex; flex-direction: column; gap: 6px;
  background: rgba(4,10,24,0.78); border: 1px solid rgba(255,120,0,0.18);
  border-radius: 8px; padding: 12px 16px;
  pointer-events: none; font-family: 'Courier New', monospace;
}
.leg-item { display: flex; align-items: center; gap: 9px; font-size: 11px; color: #d0e8ff; }
.leg-dot  { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.leg-line { width: 24px; height: 3px; border-radius: 2px; flex-shrink: 0; }

/* ── Fade ────────────────────────────────────────────────────────────────── */
.fade-enter-active, .fade-leave-active { transition: opacity 0.4s ease; }
.fade-enter-from,   .fade-leave-to     { opacity: 0; }

/* ── Corner brackets ─────────────────────────────────────────────────────── */
.corner { position: absolute; width: 18px; height: 18px; z-index: 30; pointer-events: none; }
.corner-tl { top:8px;left:8px;       border-top:2px solid rgba(255,120,0,0.5); border-left:2px solid rgba(255,120,0,0.5); }
.corner-tr { top:8px;right:8px;      border-top:2px solid rgba(255,120,0,0.5); border-right:2px solid rgba(255,120,0,0.5); }
.corner-bl { bottom:8px;left:8px;    border-bottom:2px solid rgba(255,120,0,0.5); border-left:2px solid rgba(255,120,0,0.5); }
.corner-br { bottom:8px;right:8px;   border-bottom:2px solid rgba(255,120,0,0.5); border-right:2px solid rgba(255,120,0,0.5); }
</style>

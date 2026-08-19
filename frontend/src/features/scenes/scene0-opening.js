/**
 * 幕 0 / 首页 idle：对齐 agent-loop startCityMonitorIntro
 * cityScan(~3.2s) → 揭示左栏 → 聚焦 COR-AOTIXI-JFD-JS → 问题路段高德式深红实色带 → 拉近镜头
 * 问题路段几何取本地 data/1-scene-objects.json（剧本要求：拥堵标红 + 自动连贯拉近）
 */
import sceneObjects from '@data/1-scene-objects.json';
import { createCityScan } from '../../layers/cityScan.js';
import { createProblemLinkAlert } from '../../layers/problemLinkAlert.js';
import {
  HOME_FOCUS_CORRIDOR_ID,
  loadCityMonitorDemo,
} from '../../services/cityMonitorDemo.js';
import {
  cityMonitorReveal,
  cityMonitorSelection,
  openingBeat,
  resetHomeIdleState,
} from '../../shared/home-idle-state.js';

const SCAN_BUFFER_MS = 3400;
const OVERVIEW_HEIGHT = 1600;
const SCAN_BOOST = 0.55;
/** 揭示监控后停留多久再标红问题路段，再多久拉近 */
const ALERT_DELAY_MS = 1600;
const DIVE_DELAY_MS = 2000;
const DIVE_HEIGHT = 260;

function scanBoundsFromIntersections(intersections) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const inter of intersections || []) {
    const [x, y] = inter.pos || [0, 0];
    const z = -y;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  if (!Number.isFinite(minX)) {
    minX = -400;
    maxX = 400;
    minZ = -400;
    maxZ = 400;
  }
  return {
    minX,
    maxX,
    minY: -maxZ,
    maxY: -minZ,
  };
}

function heightForFocus(focus) {
  const { type, bounds } = focus || {};
  if (type === 'intersection') return 180;
  if (bounds && Number.isFinite(bounds.minX)) {
    const spanX = Math.max(40, bounds.maxX - bounds.minX);
    const spanZ = Math.max(40, bounds.maxZ - bounds.minZ);
    const span = Math.max(spanX, spanZ);
    const pad = type === 'region' ? 1.55 : 1.75;
    let h = span * pad;
    if (type === 'region') h = Math.max(280, Math.min(780, h));
    else h = Math.max(200, Math.min(520, h));
    return h;
  }
  return type === 'region' ? 520 : 320;
}

/**
 * @param {object} runtime
 * @param {{ cityMonitorFx, intersections, overviewCenter? }} ctx
 * @param {{ onComplete?: () => void }} hooks
 */
export function createScene0Opening(runtime, ctx, hooks = {}) {
  const { cityMonitorFx, intersections = [], overviewCenter } = ctx;

  const bounds = scanBoundsFromIntersections(intersections);
  const cityScan = createCityScan(bounds);
  const scanMesh = cityScan.children[0];
  if (scanMesh?.material) scanMesh.material.opacity = 0;
  runtime.scene.add(cityScan);

  const problemAlert = createProblemLinkAlert(sceneObjects.problem_link?.geom);
  runtime.scene.add(problemAlert.group);

  const timers = new Set();
  let playing = false;
  let disposed = false;
  let scanBoost = SCAN_BOOST;

  function later(fn, ms) {
    const id = setTimeout(() => {
      timers.delete(id);
      if (!playing || disposed) return;
      fn();
    }, ms);
    timers.add(id);
    return id;
  }

  function clearTimer() {
    for (const id of timers) clearTimeout(id);
    timers.clear();
  }

  function goOverview() {
    let x = 0;
    let y = 0;
    if (overviewCenter) {
      const [ox, oy] = overviewCenter;
      x = ox;
      y = oy;
    } else if (intersections[0]?.pos) {
      [x, y] = intersections[0].pos;
    }
    runtime.setTopDownCamera({
      x,
      z: -y + 40,
      height: OVERVIEW_HEIGHT,
      immediate: true,
    });
  }

  function zoomToFocus(focus) {
    if (!focus?.worldPos) return;
    const h = heightForFocus(focus);
    const { worldPos } = focus;
    runtime.animateCamera({
      posTarget: { x: worldPos.x, y: h, z: worldPos.z },
      lookTarget: { x: worldPos.x, y: 0, z: worldPos.z },
      lerp: 0.035,
    });
  }

  /** 问题路段高德式深红实色带，再连贯拉近到路段中心 */
  function alertProblemLink() {
    openingBeat.value = 'alert';
    problemAlert.show();
    hooks.onBeat?.('alert');

    later(() => {
      openingBeat.value = 'dive';
      const { worldCenter } = problemAlert;
      runtime.animateCamera({
        posTarget: { x: worldCenter.x, y: DIVE_HEIGHT, z: worldCenter.z },
        lookTarget: { x: worldCenter.x, y: 0, z: worldCenter.z },
        lerp: 0.03,
      });
      hooks.onBeat?.('dive');
      hooks.onComplete?.();
    }, DIVE_DELAY_MS);
  }

  async function revealMonitor() {
    cityMonitorFx?.clear?.();
    const demo = await loadCityMonitorDemo();
    if (!playing || disposed) return;
    cityMonitorFx.setData(demo);
    cityMonitorSelection.value = {
      type: 'corridor',
      id: HOME_FOCUS_CORRIDOR_ID,
      ts: Date.now(),
    };
    cityMonitorReveal.value = true;
    openingBeat.value = 'reveal';
    hooks.onBeat?.('reveal');
    const focus = cityMonitorFx.setSelection('corridor', HOME_FOCUS_CORRIDOR_ID);
    zoomToFocus(focus);
    later(alertProblemLink, ALERT_DELAY_MS);
  }

  function play() {
    if (disposed || !cityMonitorFx) return;
    clearTimer();
    playing = true;
    resetHomeIdleState();
    cityMonitorFx.clear();
    problemAlert.hide();
    goOverview();

    const t0 = performance.now() / 1000;
    scanBoost = SCAN_BOOST;
    cityScan.trigger(t0);
    openingBeat.value = 'scan';
    hooks.onBeat?.('scan');

    later(() => {
      scanBoost = 0;
      void revealMonitor();
    }, SCAN_BUFFER_MS);
  }

  function stop() {
    playing = false;
    clearTimer();
    problemAlert.hide();
    openingBeat.value = '';
  }

  function replay() {
    stop();
    play();
  }

  /** 左栏点击切换 case 时复用 */
  function focusSelection(type, id) {
    if (!cityMonitorFx || !cityMonitorReveal.value) return;
    const focus = cityMonitorFx.setSelection(type, id);
    zoomToFocus(focus);
  }

  function update(time) {
    cityScan.update?.(time);
    if (scanMesh?.material && scanBoost > 0 && scanMesh.visible) {
      scanMesh.material.opacity *= scanBoost;
    }
    cityMonitorFx?.update?.(time);
    problemAlert.update(time);
  }

  function dispose() {
    disposed = true;
    stop();
    runtime.scene.remove(cityScan);
    cityScan.dispose?.();
    runtime.scene.remove(problemAlert.group);
    problemAlert.dispose?.();
  }

  return {
    play,
    replay,
    stop,
    update,
    dispose,
    focusSelection,
    // 幕 1 渠化展示后隐藏问题路段拥堵带（渠化本身即拥堵表达载体）
    hideProblemAlert: () => problemAlert.hide(),
    showProblemAlert: () => problemAlert.show(),
  };
}

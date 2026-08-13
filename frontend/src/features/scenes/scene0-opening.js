/**
 * 幕 0 / 首页 idle：对齐 agent-loop startCityMonitorIntro
 * cityScan(~3.2s) → 揭示左栏 → 聚焦 COR-AOTIXI-JFD-JS → zoomToCityMonitor
 */
import { createCityScan } from '../../layers/cityScan.js';
import {
  HOME_FOCUS_CORRIDOR_ID,
  loadCityMonitorDemo,
} from '../../services/cityMonitorDemo.js';
import {
  cityMonitorReveal,
  cityMonitorSelection,
  resetHomeIdleState,
} from '../../shared/home-idle-state.js';

const SCAN_BUFFER_MS = 3400;
const OVERVIEW_HEIGHT = 1600;
const SCAN_BOOST = 0.55;

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

  let timer = null;
  let playing = false;
  let disposed = false;
  let scanBoost = SCAN_BOOST;

  function clearTimer() {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
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
    const focus = cityMonitorFx.setSelection('corridor', HOME_FOCUS_CORRIDOR_ID);
    zoomToFocus(focus);
    hooks.onComplete?.();
  }

  function play() {
    if (disposed || !cityMonitorFx) return;
    clearTimer();
    playing = true;
    resetHomeIdleState();
    cityMonitorFx.clear();
    goOverview();

    const t0 = performance.now() / 1000;
    scanBoost = SCAN_BOOST;
    cityScan.trigger(t0);

    timer = setTimeout(() => {
      timer = null;
      if (!playing || disposed) return;
      scanBoost = 0;
      void revealMonitor();
    }, SCAN_BUFFER_MS);
  }

  function stop() {
    playing = false;
    clearTimer();
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
  }

  function dispose() {
    disposed = true;
    stop();
    runtime.scene.remove(cityScan);
    cityScan.dispose?.();
  }

  return {
    play,
    replay,
    stop,
    update,
    dispose,
    focusSelection,
  };
}

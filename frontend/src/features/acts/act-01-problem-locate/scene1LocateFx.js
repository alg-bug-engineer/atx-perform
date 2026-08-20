/**
 * 幕 1 定位态地图：先标红北向南问题路段，再画出上下游东西向流量。
 */
import * as THREE from 'three';
import { project } from '../../../geo/loader.js';
import {
  createDirectedFlowLayer,
  createJingshiEwFlowLayer,
} from '../../../layers/jingshiEwFlowLayer.js';
import { createRoadNameLabel } from '../../../layers/roadNameLabels.js';
import {
  INTERSECTIONS,
  PROBLEM_LINK_COORDS,
  PROBLEM_LOCATE_BEATS,
} from './fixture.js';
import channelizationData from '@data/1-1-channelization.json';
import { getConductorSegments } from '../../../shared/sceneNarration.js';
import {
  createChannelizationLayer,
  disposeChannelizationLayer,
  gatherArms,
  angleDiff,
} from '../../scenes/scene-c/channelizationLayer.js';
import {
  planSegmentChannelization,
  buildSegmentChannelizationLayer,
} from '../../scenes/scene-c/segmentChannelizationLayer.js';
import { channelizationMapToInterItem } from '../../../services/channelizationFromBackend.js';

function worldOf(inter) {
  const [x, y] = project(inter.lon, inter.lat);
  return { x, y, z: -y };
}

function runtimeOrigin(intersections, spec) {
  const found = (intersections || []).find((item) => item.props?.inter_id === spec.interId);
  if (found?.pos) return found;
  const [x, y] = project(spec.lon, spec.lat);
  return { pos: [x, y], props: { inter_id: spec.interId } };
}

function createMetricPin(title, lines = [], accent = '#f5c542') {
  // 卡片规范对齐幕 3 地图卡片：深底 + accent 描边 1.75 + 圆角 10；
  // 首行指标作金色 DIN 大数主值，其余白字行
  const padX = 22;
  const padY = 16;
  const [first, ...rest] = lines;
  const heroParts = first ? first.split(/\s{2,}/) : null;
  const heroLab = heroParts && heroParts.length > 1 ? heroParts[0] : '';
  const heroVal = heroParts ? (heroParts.length > 1 ? heroParts.slice(1).join(' ') : heroParts[0]) : '';
  const rowH = 24;
  const cssW = 300;
  const cssH = padY + 26 + (heroVal ? 40 + 20 : 0) + 8 + rest.length * rowH + padY;
  const dpr = 2;
  const canvas = document.createElement('canvas');
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  ctx.fillStyle = 'rgba(3, 14, 25, 0.9)';
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.75;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(4, 4, cssW - 8, cssH - 8, 10);
  else ctx.rect(4, 4, cssW - 8, cssH - 8);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '500 18px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillStyle = 'rgba(175, 205, 220, 0.94)';
  ctx.fillText(title, padX, padY + 12);

  let y = padY + 26;
  if (heroVal) {
    ctx.font = '700 32px "DIN Alternate","PingFang SC",sans-serif';
    ctx.fillStyle = accent;
    ctx.fillText(heroVal, padX, y + 18);
    y += 40;
    if (heroLab) {
      ctx.font = '500 14px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = 'rgba(150, 180, 198, 0.78)';
      ctx.fillText(heroLab, padX, y + 8);
      y += 20;
    }
  }
  y += 8;
  ctx.font = '500 16px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillStyle = 'rgba(205, 225, 238, 0.9)';
  rest.forEach((line, i) => ctx.fillText(line, padX, y + 12 + i * rowH));

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    sizeAttenuation: true,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(cssW * 0.085, cssH * 0.085, 1);
  sprite.frustumCulled = false;
  sprite.renderOrder = 80;
  sprite.userData.disposePin = () => {
    tex.dispose();
    mat.dispose();
  };
  return sprite;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function rowsOf(key) {
  return (PROBLEM_LOCATE_BEATS[key]?.panel?.rows || []).map((row) => `${row.label}  ${row.value}`);
}

/**
 * @param {{
 *   project?: (lon: number, lat: number) => [number, number],
 *   roads?: any[],
 *   intersections?: any[],
 * }} opts
 */
export function createAct2MapFx({
  roads = [],
  intersections = [],
} = {}) {
  const group = new THREE.Group();
  group.name = 'act2ProblemLocateCorridorFx';

  const JINGSHI = worldOf(INTERSECTIONS.jingshi);
  const JIEFANG = worldOf(INTERSECTIONS.jiefang);
  const problemMid = {
    x: (JIEFANG.x + JINGSHI.x) / 2,
    z: (JIEFANG.z + JINGSHI.z) / 2,
  };
  const nsCoords = (PROBLEM_LINK_COORDS || []).map(([lon, lat]) => {
    const [x, y] = project(lon, lat);
    return [x, y];
  });
  const jingshiOrigin = runtimeOrigin(intersections, INTERSECTIONS.jingshi);
  const jiefangOrigin = runtimeOrigin(intersections, INTERSECTIONS.jiefang);
  const resolution = new THREE.Vector2(window.innerWidth, window.innerHeight);

  const nsLayer = createDirectedFlowLayer({
    coords: nsCoords,
    resolution,
  });
  nsLayer.visible = false;
  group.add(nsLayer);

  const jingshiEw = createJingshiEwFlowLayer({
    roads,
    originInter: jingshiOrigin,
    resolution,
    ewRoadPrefix: '经十路',
    includeEw: true,
    includeNs: false,
  });
  jingshiEw.visible = false;
  group.add(jingshiEw);

  const jiefangEw = createJingshiEwFlowLayer({
    roads,
    originInter: jiefangOrigin,
    resolution,
    ewRoadPrefix: '解放东路',
    includeEw: true,
    includeNs: false,
  });
  jiefangEw.visible = false;
  group.add(jiefangEw);

  const jingshiPos = jingshiOrigin.pos;
  const jiefangPos = jiefangOrigin.pos;
  const problemMidPos = [
    (jiefangPos[0] + jingshiPos[0]) / 2,
    (jiefangPos[1] + jingshiPos[1]) / 2,
  ];

  const labelGroup = new THREE.Group();
  labelGroup.visible = false;
  group.add(labelGroup);
  const labelMats = [];
  [
    {
      name: '经十路',
      pos: { x: jingshiPos[0] - 26, y: 10, z: -(jingshiPos[1] + 1) },
    },
    {
      name: '奥体西路',
      pos: { x: problemMidPos[0] - 8, y: 10, z: -problemMidPos[1] },
    },
    { name: '解放东路口', pos: { x: JIEFANG.x, y: 10, z: JIEFANG.z } },
    { name: '经十路口', pos: { x: JINGSHI.x, y: 10, z: JINGSHI.z } },
  ].forEach(({ name, pos }) => {
    const spr = createRoadNameLabel(name, {
      accent: 'rgba(240, 246, 255, 0.6)',
    });
    spr.material.opacity = 0;
    spr.position.set(pos.x, pos.y, pos.z);
    labelGroup.add(spr);
    labelMats.push(spr.material);
  });

  const annotationGroup = new THREE.Group();
  group.add(annotationGroup);
  const beatPins = {};
  const addPin = (key, title, lines, pos, accent) => {
    const pin = createMetricPin(title, lines, accent);
    pin.position.set(pos.x, 24, pos.z);
    pin.visible = false;
    annotationGroup.add(pin);
    beatPins[key] = beatPins[key] || [];
    beatPins[key].push(pin);
  };

  addPin('lock', '问题路段锁定', ['路段  奥体西路·解放东路—经十路', '流向  北向南直行'], {
    x: problemMid.x - 26,
    z: problemMid.z,
  }, '#ff8a3a');
  addPin('m-queue', '排队长度', ['排队长度  270 m', '蓄车  368 m', '排队比  0.73'], {
    x: problemMid.x + 26,
    z: problemMid.z,
  }, '#ff8a3a');
  addPin('m-speed', '平均速度', ['平均速度  7.2 km/h', '延时指数  5.28'], {
    x: problemMid.x + 26,
    z: problemMid.z,
  }, '#ffb020');
  addPin('m-sat', '饱和度', ['饱和度  0.84', '预警线  0.8'], {
    x: problemMid.x + 26,
    z: problemMid.z,
  }, '#ff6b4a');
  const pinMats = annotationGroup.children.map((pin) => pin.material);

  const targets = { labels: 0, pins: 0 };

  // 依次展示语义：三窗同位、一个消失后下一个出现；keepLock 保留锁定卡
  function showPins(key, { keepLock = false } = {}) {
    const active = new Set(key ? [key] : []);
    if (keepLock) active.add('lock');
    let any = false;
    Object.entries(beatPins).forEach(([pinKey, pins]) => {
      const on = active.has(pinKey);
      if (on) any = true;
      pins.forEach((pin) => {
        pin.visible = on;
        if (pin.material) pin.material.opacity = on ? 1 : 0;
      });
    });
    targets.pins = any ? 1 : 0;
  }

  function playFlow(layer, on) {
    if (!layer) return;
    layer.visible = on;
    if (on) layer.play?.(performance.now() / 1000);
    else layer.stop?.();
  }

  // ── 渠化 + 排队过程（路段锚点·段中心化，对齐 agent-loop act2MapFx）──────
  const AXIS_ROADS = { ew_road: '经十路', ns_road: '奥体西路' };
  let channelGroup = null;
  let segmentPlan = null;
  let queueAnim = null;
  let queueBlocks = null;

  /**
   * 排队色块序列（对齐 agent-loop 新分支 act3MapFx 形态）：
   * 沿段体真实中心线贴路排布（切向定向、-X 行驶半幅），
   * 自 B 端停车线向上游逐排生长，与道路走向严格一致。
   */
  function buildQueueBlocks({ plan, laneCount, queueRatio, widen = null }) {
    const g = new THREE.Group();
    g.name = 'queueBlocks';
    // 视觉比例标定：盒体吃掉部分段长，绝对米数铺满会误读为 0.9+；
    // 改按 排队比 × 可见蓄车空间（两停车线间）绘制，画面比例精确等于 0.73
    const cl0 = (() => {
      // 轴锁定沿臂角盒缘（与段体 widen 轴同源），贴底图真实走向
      const tA = ((plan.armA?.angle ?? plan.segBearing) * Math.PI) / 180;
      const tB = ((plan.armB?.angle ?? (plan.segBearing + 180) % 360) * Math.PI) / 180;
      const p0 = { x: plan.worldA.x + Math.sin(tA) * plan.boxRA, z: plan.worldA.z - Math.cos(tA) * plan.boxRA };
      const p1 = { x: plan.worldB.x + Math.sin(tB) * plan.boxRB, z: plan.worldB.z - Math.cos(tB) * plan.boxRB };
      const dx = p1.x - p0.x;
      const dz = p1.z - p0.z;
      const total = Math.hypot(dx, dz);
      const dir = { x: total ? dx / total : 0, z: total ? dz / total : 1 };
      return {
        total,
        at: (r) => {
          const u = total ? Math.max(0, Math.min(1, r / total)) : 0;
          return {
            x: p0.x + dx * u,
            z: p0.z + dz * u,
            tx: dir.x, tz: dir.z,
            nx: dir.z, nz: -dir.x,
          };
        },
      };
    })();
    const queueLen = Math.max(2, queueRatio * cl0.total);
    const BLOCK_D = 0.58;
    const BLOCK_GAP = 0.08;
    const step = BLOCK_D + BLOCK_GAP;
    const blockCount = Math.max(6, Math.round(queueLen / step));
    const blockW = 0.8 * 0.9;
    // 拓宽口径：北向南半幅车道数沿段线性演进（3→5），
    // 直行车贴外缘石不动、左转车道自绿化带侧生长 → 列偏移随当地宽度外移
    const abA = widen?.ab?.[0] || laneCount;
    const abB = widen?.ab?.[1] || laneCount;
    const loN = Math.min(abA, abB);
    const hiN = Math.max(abA, abB);
    // 排队仅在非拓宽直行车道上演示：全程外侧 loN 列固定贴外缘，
    // 不进入近口左转拓宽区
    const rowSpec = () => {
      if (!widen) return { n: laneCount, off: 0 };
      return { n: loN, off: (hiN - loN) * 0.8 };
    };
    const meshes = [];

    // 中心线取样器：段体取直，色块沿 A→B 弦线同轴排布
    const cl = cl0;

    for (let i = 0; i < blockCount; i++) {
      const r = cl.total - (BLOCK_D / 2 + i * step);
      if (r < 0) break;
      const f = cl.at(r);
      const edge = i / Math.max(1, blockCount - 1);
      const color = new THREE.Color(0xff6b5c).lerp(new THREE.Color(0xff9588), edge * 0.35);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const rotY = Math.atan2(f.tx, f.tz);
      const spec = rowSpec();
      const xs = Array.from({ length: spec.n }, (_, k) => spec.off + (k + 0.5) * 0.8);
      xs.forEach((lx) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(blockW, BLOCK_D), mat);
        m.rotation.order = 'YXZ';
        m.rotation.y = rotY;
        m.rotation.x = -Math.PI / 2;
        // A→B 行驶半幅在 -X 侧（与段体车道同侧）
        m.position.set(f.x - f.nx * lx, 0.75, f.z - f.nz * lx);
        m.renderOrder = 54;
        m.userData.blockIndex = i;
        m.visible = false;
        g.add(m);
        meshes.push(m);
      });
    }
    g.visible = false;
    group.add(g);
    return {
      group: g,
      show(v) { g.visible = !!v; },
      setReveal(p) {
        const k = Math.max(0, Math.min(1, p));
        const n = Math.max(0, Math.ceil(blockCount * k));
        meshes.forEach((m) => { m.visible = m.userData.blockIndex < n; });
      },
    };
  }

  function interItemOf(inter) {
    const raw = channelizationData.by_intersection?.[inter.interId];
    if (!raw?.arms?.length) return null;
    return channelizationMapToInterItem(
      { available: true, links: raw.arms, center: [inter.lon, inter.lat] },
      { inter_id: inter.interId, intersection_name: inter.name, lng: inter.lon, lat: inter.lat },
      AXIS_ROADS,
    );
  }

  function ensureChannelization() {
    if (channelGroup) return channelGroup;
    channelGroup = new THREE.Group();
    channelGroup.name = 'act2Channelization';
    const channelOpts = {
      arrowScale: 1.7,
      neutralOtherArms: false,
      showArmRoadNames: false,
      axisRoads: AXIS_ROADS,
      // 真实车道演进：北向南 解放东 3→经十路 5；南向北 经十路 3→解放东 4；
      // 段中取直，近口 tB/tA 距离内曲线拓宽
      widen: { ab: [3, 5], ba: [4, 3], tA: 8, tB: 10 },
    };
    const mainItem = interItemOf(INTERSECTIONS.jingshi);
    const otherItem = interItemOf(INTERSECTIONS.jiefang);
    if (mainItem && otherItem) {
      // 车流北向南（方位角 180）；main=经十路口锚定不动
      segmentPlan = planSegmentChannelization(mainItem, otherItem, { travelBearing: 180 });
    }
    if (segmentPlan) {
      // 段体取直：两端盒缘间直线铺设，色块同轴贴路
      const layer = buildSegmentChannelizationLayer(segmentPlan, channelOpts);
      if (layer) {
        channelGroup.add(layer);
        const sl = mainItem.surrounding_links;
        const arms = gatherArms(sl['进入路口的路段'] || [], sl['离开路口的路段'] || []);
        const target = (segmentPlan.segBearing + 180) % 360;
        const armN = arms.reduce((best, a) => {
          const d = angleDiff(a.angle, target);
          return d < (best?.d ?? Infinity) ? { a, d } : best;
        }, null)?.a;
        if (armN) {
          const laneCount = Math.max(2, (armN.inLink?.lane_info || '')
            .split('|').filter(Boolean).length || 2);
          queueBlocks = buildQueueBlocks({
            plan: segmentPlan,
            laneCount,
            queueRatio: 0.73,
            widen: channelOpts.widen,
          });
        }
      }
    }
    if (!channelGroup.children.length && mainItem) {
      // 段化数据不足时回退单口渠化
      const raw = channelizationData.by_intersection?.[INTERSECTIONS.jingshi.interId];
      const north = (raw?.arms || []).find((a) => a.dir8_label === '北进口' && a.link_role === 'entrance');
      channelGroup.add(createChannelizationLayer(mainItem, null, channelOpts));
    }
    channelGroup.visible = false;
    group.add(channelGroup);
    return channelGroup;
  }

  /** 段中心渠化取景：镜头坐车流下游端回望段中点（对齐 agent-loop） */
  function getSegmentFraming() {
    if (!segmentPlan) return null;
    const t = (segmentPlan.segBearing * Math.PI) / 180;
    const back = segmentPlan.span / 2 + 40;
    return {
      midX: segmentPlan.mid.x,
      midZ: segmentPlan.mid.z,
      camX: segmentPlan.mid.x + Math.sin(t) * back,
      camZ: segmentPlan.mid.z - Math.cos(t) * back,
      alt: Math.max(62, segmentPlan.span * 1.15),
    };
  }

  function removeChannelization() {
    if (!channelGroup) return;
    channelGroup.children.forEach((layer) => disposeChannelizationLayer(layer));
    group.remove(channelGroup);
    channelGroup = null;
    queueAnim = null;
  }

  const SEG_DUR = Object.fromEntries(
    getConductorSegments('1').map((s) => [s.id, s.durationSec || s.approxSec || 5]),
  );

  function play(nextBeat, timeSec = performance.now() / 1000) {
    group.visible = true;
    if (nextBeat === 'fly_in' || nextBeat === 'lock' || nextBeat === 'metrics') {
      labelGroup.visible = true;
      targets.labels = 0.9;
      labelMats.forEach((mat) => { mat.opacity = 0.9; });
      playFlow(nsLayer, true);
      playFlow(jingshiEw, false);
      playFlow(jiefangEw, false);
      showPins('lock');
      return;
    }
    if (nextBeat === 'channelization') {
      labelGroup.visible = true;
      targets.labels = 0.9;
      labelMats.forEach((mat) => { mat.opacity = 0.9; });
      // 渠化本身即拥堵表达载体，隐藏路段中间红色拥堵带
      playFlow(nsLayer, false);
      playFlow(jingshiEw, false);
      playFlow(jiefangEw, false);
      ensureChannelization();
      channelGroup.visible = true;
      showPins('lock');
      return;
    }
    if (nextBeat === 'queue') {
      labelGroup.visible = true;
      targets.labels = 0.9;
      playFlow(nsLayer, false);
      ensureChannelization();
      channelGroup.visible = true;
      queueBlocks?.show(true);
      queueBlocks?.setReveal(0);
      queueAnim = { start: timeSec, dur: SEG_DUR['s1-queue'] || 5 };
      showPins('lock');
      return;
    }
    if (nextBeat === 'm-queue' || nextBeat === 'm-speed' || nextBeat === 'm-sat') {
      labelGroup.visible = true;
      targets.labels = 0.9;
      playFlow(nsLayer, false);
      if (queueBlocks) {
        queueBlocks.show(true);
        queueBlocks.setReveal(1);
      }
      queueAnim = null;
      showPins(nextBeat, { keepLock: true });
      return;
    }
    if (nextBeat === 'nodes' || nextBeat === 'downstream' || nextBeat === 'upstream') {
      labelGroup.visible = true;
      targets.labels = 0.85;
      playFlow(nsLayer, false);
      playFlow(jingshiEw, true);
      playFlow(jiefangEw, true);
      showPins('lock');
      return;
    }
    if (nextBeat === 'settle' || nextBeat === 'conclusion') {
      labelGroup.visible = true;
      targets.labels = 0.55;
      playFlow(nsLayer, false);
      playFlow(jingshiEw, true);
      playFlow(jiefangEw, true);
      showPins('lock');
      return;
    }
    if (nextBeat === 'dim' || nextBeat === 'handoff') {
      targets.labels = 0.35;
      showPins('lock');
      return;
    }
    if (nextBeat === 'clear') {
      targets.labels = 0;
      playFlow(nsLayer, false);
      playFlow(jingshiEw, false);
      playFlow(jiefangEw, false);
      if (channelGroup) channelGroup.visible = false;
      queueBlocks?.show(false);
      queueAnim = null;
      showPins(null);
    }
  }

  function update(time) {
    nsLayer.update?.(time);
    jingshiEw.update?.(time);
    jiefangEw.update?.(time);
    if (queueAnim && queueBlocks) {
      const t = (time - queueAnim.start) / queueAnim.dur;
      if (t >= 1) {
        queueBlocks.setReveal(1);
        queueAnim = null;
      } else {
        queueBlocks.setReveal(Math.max(0, t));
      }
    }
    if (labelGroup.visible && labelMats.length) {
      labelMats.forEach((mat) => {
        mat.opacity = lerp(mat.opacity, targets.labels, 0.1);
      });
      if (targets.labels <= 0 && labelMats.every((mat) => mat.opacity < 0.02)) {
        labelGroup.visible = false;
      }
    }
    annotationGroup.children.forEach((pin) => {
      if (!pin.visible) return;
      pin.material.opacity = lerp(pin.material.opacity, targets.pins, 0.12);
    });
  }

  function dispose() {
    nsLayer.dispose?.();
    jingshiEw.dispose?.();
    jiefangEw.dispose?.();
    labelGroup.traverse((o) => o.userData?.disposeLabel?.());
    annotationGroup.children.forEach((pin) => pin.userData.disposePin?.());
    if (channelGroup) {
      channelGroup.children.forEach((layer) => disposeChannelizationLayer(layer));
      channelGroup = null;
    }
  }

  return {
    group,
    play,
    update,
    dispose,
    setResolution: (w, h) => {
      nsLayer.setResolution?.(w, h);
      jingshiEw.setResolution?.(w, h);
      jiefangEw.setResolution?.(w, h);
    },
    hasChannelization: () => Boolean(channelGroup),
    ensureChannelization: () => ensureChannelization(),
    removeChannelization: () => removeChannelization(),
    detachChannelization: () => null,
    setQueueCarsVisible: (v) => queueBlocks?.show(v),
    getSegmentFraming: () => getSegmentFraming(),
    boostArrows: () => {},
    getTargetWorld: () => ({ x: problemMid.x, y: 0, z: problemMid.z }),
    getPathScanTarget: () => ({ x: JIEFANG.x, z: JIEFANG.z }),
    getDownstreamWorld: () => ({ x: JINGSHI.x, z: JINGSHI.z }),
    getProblemWorld: () => ({ x: problemMid.x, z: problemMid.z }),
    getNodesWorld: () => ({ x: problemMid.x, z: problemMid.z }),
  };
}

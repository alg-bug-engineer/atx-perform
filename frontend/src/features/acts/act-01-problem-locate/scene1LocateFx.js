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

function createMetricPin(title, lines = [], accent = '#00e5ff') {
  const width = 430;
  const lineH = 34;
  const height = 58 + Math.max(1, lines.length) * lineH;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(4, 14, 26, 0.92)';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.62)';
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, width - 4, height - 4);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 5, height);
  ctx.font = '600 24px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillStyle = accent;
  ctx.fillText(title, 22, 34);
  ctx.font = '500 21px "PingFang SC","Microsoft YaHei",sans-serif';
  lines.forEach((line, i) => {
    ctx.fillStyle = i === 0 ? '#f0fbff' : 'rgba(205, 225, 238, 0.9)';
    ctx.fillText(line, 22, 68 + i * lineH);
  });
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
  sprite.scale.set(width * 0.085, height * 0.085, 1);
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
      pos: { x: jingshiPos[0] - 36, y: 10, z: -(jingshiPos[1] + 8) },
    },
    {
      name: '奥体西',
      pos: { x: problemMidPos[0] - 24, y: 10, z: -problemMidPos[1] },
    },
    { name: '解放东路口', pos: { x: JIEFANG.x, y: 10, z: JIEFANG.z } },
    { name: '经十路口', pos: { x: JINGSHI.x, y: 10, z: JINGSHI.z } },
  ].forEach(({ name, pos }) => {
    const spr = createRoadNameLabel(name, {
      accent: name.includes('奥体西') ? '#9aefff' : '#7ee9ff',
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

  addPin('lock', '问题路段指标', rowsOf('lock'), {
    x: problemMid.x + 26,
    z: problemMid.z,
  }, '#ff8a3a');
  addPin('nodes', '经十路东进口', ['速度 14.5 km/h', '延时指数 5.81', '直行 1230 辆/h'], {
    x: JINGSHI.x + 36,
    z: JINGSHI.z - 10,
  }, '#ff8a3a');
  addPin('nodes', '经十路西进口', ['速度 26.2 km/h', '延时指数 3.41', '饱和度缺失 · 降级'], {
    x: JINGSHI.x - 38,
    z: JINGSHI.z + 10,
  }, '#ffb020');
  addPin('nodes', '解放东西进口', ['西向东 6.4 km/h', '延时指数 4.46'], {
    x: JIEFANG.x - 32,
    z: JIEFANG.z + 8,
  }, '#ff6b4a');
  addPin('nodes', '解放东东进口', ['速度 —', '饱和度缺失'], {
    x: JIEFANG.x + 32,
    z: JIEFANG.z - 8,
  }, '#9aa8b5');
  addPin('conclusion', '问题定位结论', rowsOf('conclusion'), {
    x: problemMid.x + 26,
    z: problemMid.z,
  }, '#ff6b4a');
  const pinMats = annotationGroup.children.map((pin) => pin.material);

  const targets = { labels: 0, pins: 0 };

  function showPins(key) {
    Object.entries(beatPins).forEach(([pinKey, pins]) => {
      pins.forEach((pin) => {
        const on = pinKey === key;
        pin.visible = on;
        if (pin.material) pin.material.opacity = on ? 1 : 0;
      });
    });
    targets.pins = beatPins[key]?.length ? 1 : 0;
  }

  function playFlow(layer, on) {
    if (!layer) return;
    layer.visible = on;
    if (on) layer.play?.(performance.now() / 1000);
    else layer.stop?.();
  }

  function play(nextBeat) {
    group.visible = true;
    if (nextBeat === 'fly_in' || nextBeat === 'lock' || nextBeat === 'channelization' || nextBeat === 'metrics') {
      labelGroup.visible = true;
      targets.labels = 0.9;
      labelMats.forEach((mat) => { mat.opacity = 0.9; });
      playFlow(nsLayer, true);
      playFlow(jingshiEw, false);
      playFlow(jiefangEw, false);
      showPins('lock');
      return;
    }
    if (nextBeat === 'nodes' || nextBeat === 'downstream' || nextBeat === 'upstream') {
      labelGroup.visible = true;
      targets.labels = 0.85;
      playFlow(nsLayer, true);
      playFlow(jingshiEw, true);
      playFlow(jiefangEw, true);
      showPins('nodes');
      return;
    }
    if (nextBeat === 'settle' || nextBeat === 'conclusion') {
      labelGroup.visible = true;
      targets.labels = 0.55;
      playFlow(nsLayer, true);
      playFlow(jingshiEw, true);
      playFlow(jiefangEw, true);
      showPins('conclusion');
      return;
    }
    if (nextBeat === 'dim' || nextBeat === 'handoff') {
      targets.labels = 0.35;
      showPins('conclusion');
      return;
    }
    if (nextBeat === 'clear') {
      targets.labels = 0;
      playFlow(nsLayer, false);
      playFlow(jingshiEw, false);
      playFlow(jiefangEw, false);
      showPins(null);
    }
  }

  function update(time) {
    nsLayer.update?.(time);
    jingshiEw.update?.(time);
    jiefangEw.update?.(time);
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
    hasChannelization: () => false,
    ensureChannelization: () => null,
    removeChannelization: () => {},
    detachChannelization: () => null,
    setQueueCarsVisible: () => {},
    boostArrows: () => {},
    getTargetWorld: () => ({ x: problemMid.x, y: 0, z: problemMid.z }),
    getPathScanTarget: () => ({ x: JIEFANG.x, z: JIEFANG.z }),
    getDownstreamWorld: () => ({ x: JINGSHI.x, z: JINGSHI.z }),
    getProblemWorld: () => ({ x: problemMid.x, z: problemMid.z }),
    getNodesWorld: () => ({ x: problemMid.x, z: problemMid.z }),
  };
}

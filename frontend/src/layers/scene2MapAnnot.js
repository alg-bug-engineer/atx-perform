/**
 * 幕 2 地图动作（方案 A）：路口脉冲、问题路段强调、示意相位环、270 m 排队条。
 * 溢流拍在排队条旁标出排队比。
 */
import * as THREE from 'three';

const C_GREEN = 0x00cc44;
const C_AMBER = 0xf5a623;
const C_RED = 0xff1800;
const C_QUEUE = 0xff8a3a;
const C_CYAN = 0x00e5ff;
const METERS_PER_UNIT = 10;
const LABEL_DPR = 2;

function beginLabelCanvas(cssW, cssH) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cssW * LABEL_DPR);
  canvas.height = Math.round(cssH * LABEL_DPR);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(LABEL_DPR, 0, 0, LABEL_DPR, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

function makeLabelTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function makeGlowTexture() {
  const sz = 64;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = sz;
  const ctx = cvs.getContext('2d');
  const g = ctx.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, sz, sz);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function toWorld(pos, y = 8) {
  return new THREE.Vector3(pos[0], y, -pos[1]);
}

function pathFromSouth(coords, lengthUnits) {
  if (!coords || coords.length < 2) return [];
  const pts = [];
  let remain = lengthUnits;
  pts.push(coords[coords.length - 1]);
  for (let i = coords.length - 1; i > 0; i -= 1) {
    const a = coords[i];
    const b = coords[i - 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    if (remain <= len) {
      const t = remain / len;
      pts.push([a[0] + dx * t, a[1] + dy * t]);
      break;
    }
    pts.push(b);
    remain -= len;
  }
  return pts;
}

const CARD_TITLE = 20;
const CARD_VALUE = 30;
const CARD_METRIC = 16;
const CARD_PAD_X = 20;
const CARD_INSET = 5;
const CARD_RADIUS = 10;
const CARD_LINE = 2;
const CARD_TWO_LINE_H = 108;
const CARD_THREE_LINE_H = 132;
const CARD_MIN_W = 260;
const CARD_WORLD_H = 10.4;

function strokeCard(ctx, cssW, cssH) {
  ctx.lineWidth = CARD_LINE;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(CARD_INSET, CARD_INSET, cssW - CARD_INSET * 2, cssH - CARD_INSET * 2, CARD_RADIUS);
  } else {
    ctx.rect(CARD_INSET, CARD_INSET, cssW - CARD_INSET * 2, cssH - CARD_INSET * 2);
  }
  ctx.fill();
  ctx.stroke();
}

function makeQueueRatioSprite(ratio) {
  const title = '排队比已达';
  const value = Number(ratio).toFixed(1);
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `500 ${CARD_TITLE}px "PingFang SC","Microsoft YaHei",sans-serif`;
  let contentW = measure.measureText(title).width;
  measure.font = `700 ${CARD_VALUE}px "DIN Alternate","PingFang SC",sans-serif`;
  contentW = Math.max(contentW, measure.measureText(value).width);
  const cssW = Math.ceil(Math.max(contentW + CARD_PAD_X * 2, CARD_MIN_W));
  const cssH = CARD_TWO_LINE_H;
  const { canvas, ctx } = beginLabelCanvas(cssW, cssH);

  ctx.fillStyle = 'rgba(18, 8, 4, 0.78)';
  ctx.strokeStyle = 'rgba(255, 138, 58, 0.85)';
  strokeCard(ctx, cssW, cssH);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `500 ${CARD_TITLE}px "PingFang SC","Microsoft YaHei",sans-serif`;
  ctx.fillStyle = 'rgba(255, 196, 140, 0.95)';
  ctx.fillText(title, CARD_PAD_X, 34);
  ctx.font = `700 ${CARD_VALUE}px "DIN Alternate","PingFang SC",sans-serif`;
  ctx.fillStyle = '#ff8a3a';
  ctx.fillText(value, CARD_PAD_X, 74);

  const tex = makeLabelTexture(canvas);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
  });
  const spr = new THREE.Sprite(mat);
  const worldH = CARD_WORLD_H;
  const worldW = worldH * (cssW / cssH);
  spr.scale.set(worldW, worldH, 1);
  spr.userData.baseScale = [worldW, worldH];
  spr.renderOrder = 62;
  spr.visible = false;
  spr.userData.disposeLabel = () => {
    tex.dispose();
    mat.dispose();
  };
  return spr;
}

function makeArterialSprite({ title, speed, saturation, flow, delay, accent = '#ff8a3a' }) {
  const speedText = `${Number(speed || 0).toFixed(1)} km/h`;
  const sat = Number(saturation);
  const flowN = Number(flow);
  const delayN = Number(delay);
  const rows = [
    `饱和度 ${Number.isFinite(sat) ? sat.toFixed(2) : '—'}`,
    `流量 ${Number.isFinite(flowN) ? `${flowN.toFixed(0)} pcu/h` : '—'}`,
    Number.isFinite(delayN) ? `拥堵延时指数 ${delayN.toFixed(2)}` : '',
  ].filter(Boolean);

  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `500 ${CARD_TITLE}px "PingFang SC","Microsoft YaHei",sans-serif`;
  let contentW = measure.measureText(title).width;
  measure.font = `700 ${CARD_VALUE}px "DIN Alternate","PingFang SC",sans-serif`;
  contentW = Math.max(contentW, measure.measureText(speedText).width);
  measure.font = `500 ${CARD_METRIC}px "PingFang SC","Microsoft YaHei",sans-serif`;
  for (const line of rows) contentW = Math.max(contentW, measure.measureText(line).width);

  const padY = 16;
  const rowH = 22;
  const cssW = Math.ceil(Math.max(contentW + CARD_PAD_X * 2, CARD_MIN_W));
  const cssH = Math.ceil(padY + CARD_TITLE + 8 + CARD_VALUE + 8 + rows.length * rowH + padY);
  const { canvas, ctx } = beginLabelCanvas(cssW, cssH);

  ctx.fillStyle = 'rgba(3, 14, 25, 0.9)';
  ctx.strokeStyle = accent;
  strokeCard(ctx, cssW, cssH);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `500 ${CARD_TITLE}px "PingFang SC","Microsoft YaHei",sans-serif`;
  ctx.fillStyle = 'rgba(175,205,220,0.94)';
  ctx.fillText(title, CARD_PAD_X, padY + CARD_TITLE / 2);
  ctx.font = `700 ${CARD_VALUE}px "DIN Alternate","PingFang SC",sans-serif`;
  ctx.fillStyle = accent;
  ctx.fillText(speedText, CARD_PAD_X, padY + CARD_TITLE + 8 + CARD_VALUE / 2);

  ctx.font = `500 ${CARD_METRIC}px "PingFang SC","Microsoft YaHei",sans-serif`;
  ctx.fillStyle = 'rgba(205,225,238,0.9)';
  const rowTop = padY + CARD_TITLE + 8 + CARD_VALUE + 8;
  rows.forEach((line, i) => ctx.fillText(line, CARD_PAD_X, rowTop + rowH / 2 + i * rowH));

  const texture = makeLabelTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  const worldH = CARD_WORLD_H * (cssH / CARD_TWO_LINE_H);
  sprite.scale.set(worldH * (cssW / cssH), worldH, 1);
  sprite.renderOrder = 63;
  sprite.visible = false;
  sprite.userData.disposeLabel = () => texture.dispose();
  return sprite;
}

function makeMetricSprite({ title, value, sub = '', accent = '#00e5ff' }) {
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `500 ${CARD_TITLE}px "PingFang SC","Microsoft YaHei",sans-serif`;
  let contentW = measure.measureText(title).width;
  measure.font = `700 ${CARD_VALUE}px "DIN Alternate","PingFang SC",sans-serif`;
  contentW = Math.max(contentW, measure.measureText(String(value)).width);
  if (sub) {
    measure.font = `500 ${CARD_METRIC}px "PingFang SC","Microsoft YaHei",sans-serif`;
    contentW = Math.max(contentW, measure.measureText(sub).width);
  }
  const cssW = Math.ceil(Math.max(contentW + CARD_PAD_X * 2, CARD_MIN_W));
  const cssH = sub ? CARD_THREE_LINE_H : CARD_TWO_LINE_H;
  const { canvas, ctx } = beginLabelCanvas(cssW, cssH);

  ctx.fillStyle = 'rgba(3, 14, 25, 0.9)';
  ctx.strokeStyle = accent;
  strokeCard(ctx, cssW, cssH);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `500 ${CARD_TITLE}px "PingFang SC","Microsoft YaHei",sans-serif`;
  ctx.fillStyle = 'rgba(175,205,220,0.9)';
  ctx.fillText(title, CARD_PAD_X, 34);
  ctx.font = `700 ${CARD_VALUE}px "DIN Alternate","PingFang SC",sans-serif`;
  ctx.fillStyle = accent;
  ctx.fillText(String(value), CARD_PAD_X, 74);
  if (sub) {
    ctx.font = `500 ${CARD_METRIC}px "PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.fillStyle = 'rgba(205,225,238,0.82)';
    ctx.fillText(sub, CARD_PAD_X, 108);
  }

  const texture = makeLabelTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  const worldH = CARD_WORLD_H * (cssH / CARD_TWO_LINE_H);
  const worldW = worldH * (cssW / cssH);
  sprite.scale.set(worldW, worldH, 1);
  sprite.userData.baseScale = [worldW, worldH];
  sprite.renderOrder = 63;
  sprite.visible = false;
  sprite.userData.disposeLabel = () => texture.dispose();
  return sprite;
}

function midpoint(coords2d) {
  if (!coords2d?.length) return null;
  const point = coords2d[Math.floor(coords2d.length / 2)];
  return point ? [point[0], point[1]] : null;
}

function metricAnchors(coords2d) {
  const mid = midpoint(coords2d);
  if (!mid || !coords2d || coords2d.length < 2) return null;
  const first = coords2d[0];
  const last = coords2d[coords2d.length - 1];
  const dx = last[0] - first[0];
  const dy = last[1] - first[1];
  const length = Math.hypot(dx, dy) || 1;
  const tx = dx / length;
  const ty = dy / length;
  const nx = -ty;
  const ny = tx;
  return [
    [mid[0] - tx * 9 + nx * 8, mid[1] - ty * 9 + ny * 8],
    [mid[0] + tx * 9 - nx * 8, mid[1] + ty * 9 - ny * 8],
  ];
}

function queueLabelAnchor(coords2d) {
  if (!coords2d || coords2d.length < 2) return null;
  const a = coords2d[0];
  const b = coords2d[coords2d.length - 1];
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return [mx + (-dy / len) * 11, my + (dx / len) * 11];
}

function makeTube(coords2d, radius, color, y = 1.2) {
  if (!coords2d || coords2d.length < 2) return null;
  const pts = coords2d.map(([x, ny]) => new THREE.Vector3(x, y, -ny));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'chordal', 0.05);
  const geo = new THREE.TubeGeometry(curve, Math.max(24, pts.length * 8), radius, 8, false);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 40;
  mesh.visible = false;
  return mesh;
}

function makeArcLine(radius, a0, a1, y, color) {
  const n = 28;
  const positions = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const a = a0 + (a1 - a0) * t;
    positions.push(radius * Math.cos(a), y, radius * Math.sin(a));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const line = new THREE.Line(geo, mat);
  line.renderOrder = 55;
  line.visible = false;
  return line;
}

/**
 * @param {{
 *   via?: { pos: [number, number] },
 *   target?: { pos: [number, number] },
 *   problemRoad?: { coords: [number, number][] },
 *   queueM?: number,
 *   queueRatio?: number,
 *   supplyMetrics?: { flow?: number, capacity?: number },
 *   arterialMetrics?: {
 *     east?: { speed?: number, delay?: number, saturation?: number, flow?: number },
 *     west?: { speed?: number, delay?: number, saturation?: number, flow?: number },
 *   },
 *   hopTimes?: {
 *     pos: [number, number],
 *     revealAt: number,
 *     label: string,
 *     shareRatio?: number|null,
 *   }[],
 * }} opts
 */
export function createScene2MapAnnot({
  via,
  target,
  problemRoad,
  queueM = 270,
  queueRatio = 0.8,
  supplyMetrics = {},
  arterialMetrics = {},
  hopTimes = [],
} = {}) {
  const group = new THREE.Group();
  group.name = 'scene2MapAnnot';
  const glowTex = makeGlowTexture();
  const fades = [];

  function track(obj) {
    group.add(obj);
    return obj;
  }

  function fadeTo(obj, targetOpacity) {
    fades.push({ obj, targetOpacity });
  }

  const targetPos = target?.pos;
  const viaPos = via?.pos;

  const hopPulses = hopTimes.map((hop) => {
    const spr = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: hop.label === '经十' ? C_GREEN : C_AMBER,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    spr.position.copy(toWorld(hop.pos, 6));
    spr.scale.set(14, 14, 1);
    spr.renderOrder = 58;
    spr.visible = false;
    track(spr);
    return { ...hop, spr };
  });

  const hopShareLabels = hopTimes
    .filter((hop) => hop.shareRatio != null && Number.isFinite(Number(hop.shareRatio)))
    .map((hop, index) => {
      const sprite = makeMetricSprite({
        title: `${hop.label} · 上游关联占比`,
        value: `${Number(hop.shareRatio).toFixed(2)}%`,
        sub: '流量关联占比',
        accent: index === 0 ? '#f5c14b' : '#00e5ff',
      });
      sprite.position.set(hop.pos[0] + (index % 2 ? -18 : 18), 15, -hop.pos[1]);
      sprite.userData.revealAt = hop.revealAt ?? 0;
      track(sprite);
      return sprite;
    });

  const linkGlow = makeTube(problemRoad?.coords, 1.35, C_CYAN, 0.9);
  if (linkGlow) track(linkGlow);

  const problemMid = midpoint(problemRoad?.coords);
  const supplyAnchors = metricAnchors(problemRoad?.coords);
  const supplyGroup = new THREE.Group();
  const flowSpr = makeMetricSprite({
    title: '当前通行流量',
    value: `${Number(supplyMetrics.flow || 0).toFixed(0)} pcu/h`,
    sub: '路段实际通行',
    accent: '#00e5ff',
  });
  const capacitySpr = makeMetricSprite({
    title: '车道能力上限',
    value: `${Number(supplyMetrics.capacity || 0).toFixed(1)} pcu/h`,
    sub: '当前仍有承接余量',
    accent: '#86efac',
  });
  if (supplyAnchors) {
    flowSpr.position.set(supplyAnchors[0][0], 17, -supplyAnchors[0][1]);
    capacitySpr.position.set(supplyAnchors[1][0], 17, -supplyAnchors[1][1]);
  } else if (problemMid) {
    flowSpr.position.set(problemMid[0] - 10, 17, -problemMid[1]);
    capacitySpr.position.set(problemMid[0] + 10, 17, -problemMid[1]);
  }
  supplyGroup.add(flowSpr, capacitySpr);
  supplyGroup.visible = false;
  track(supplyGroup);

  const arterialGroup = new THREE.Group();
  const east = arterialMetrics.east || {};
  const west = arterialMetrics.west || {};
  const eastSpr = makeArterialSprite({
    title: '经十路东侧',
    speed: east.speed,
    saturation: east.saturation,
    flow: east.flow,
    delay: east.delay,
    accent: '#ff8a3a',
  });
  const westSpr = makeArterialSprite({
    title: '经十路西侧',
    speed: west.speed,
    saturation: west.saturation,
    flow: west.flow,
    delay: west.delay,
    accent: '#f5c14b',
  });
  if (targetPos) {
    eastSpr.position.set(targetPos[0] + 30, 17, -targetPos[1]);
    westSpr.position.set(targetPos[0] - 30, 17, -targetPos[1]);
  }
  arterialGroup.add(eastSpr, westSpr);
  arterialGroup.visible = false;
  track(arterialGroup);

  const ringGroup = new THREE.Group();
  ringGroup.visible = false;
  if (targetPos) {
    ringGroup.position.set(targetPos[0], 0, -targetPos[1]);
    const arcs = [
      makeArcLine(9.5, -0.55, 0.55, 5.5, C_GREEN),
      makeArcLine(9.5, Math.PI - 0.55, Math.PI + 0.55, 5.5, C_GREEN),
      makeArcLine(9.5, Math.PI / 2 - 0.22, Math.PI / 2 + 0.22, 5.5, C_RED),
      makeArcLine(9.5, -Math.PI / 2 - 0.22, -Math.PI / 2 + 0.22, 5.5, C_RED),
    ];
    arcs.forEach((arc) => ringGroup.add(arc));
    ringGroup.userData.arcs = arcs;
  }
  track(ringGroup);

  const blockPulse = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      color: C_RED,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  if (targetPos) blockPulse.position.copy(toWorld(targetPos, 7));
  blockPulse.scale.set(16, 16, 1);
  blockPulse.renderOrder = 59;
  blockPulse.visible = false;
  track(blockPulse);

  const queueLen = Math.max(4, queueM / METERS_PER_UNIT);
  const queuePts = pathFromSouth(problemRoad?.coords, queueLen);
  const queueTube = makeTube(queuePts, 1.15, C_QUEUE, 1.2);
  if (queueTube) {
    queueTube.geometry.setDrawRange(0, 0);
    track(queueTube);
  }

  const ratioSpr = makeQueueRatioSprite(queueRatio);
  const ratioAnchor = queueLabelAnchor(queuePts);
  if (ratioAnchor) {
    ratioSpr.position.set(ratioAnchor[0], 14, -ratioAnchor[1]);
  }
  track(ratioSpr);

  const viaPulse = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      color: C_RED,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  if (viaPos) viaPulse.position.copy(toWorld(viaPos, 7));
  viaPulse.scale.set(18, 18, 1);
  viaPulse.renderOrder = 59;
  viaPulse.visible = false;
  track(viaPulse);

  let beat = 'hidden';
  let beatAt = 0;
  let traceElapsed = 0;

  function applyBeat(name) {
    fades.length = 0;
    const showLink = name === 'supply';
    const showRing = name === 'signal';
    const showQueue = name === 'overflow';
    const showSupply = name === 'supply';
    const supplyLeaving = name === 'supply_out';
    const showArterial = name === 'arterial' || name === 'signal' || name === 'overflow';
    ringGroup.visible = showRing;
    supplyGroup.visible = showSupply || supplyLeaving;
    arterialGroup.visible = showArterial;

    if (linkGlow) fadeTo(linkGlow, showLink ? 0.55 : 0);
    if (supplyLeaving) {
      for (const spr of [flowSpr, capacitySpr]) fadeTo(spr, 0);
    } else if (!showSupply) {
      for (const spr of [flowSpr, capacitySpr]) fadeTo(spr, 0);
    } else {
      flowSpr.material.opacity = 0;
      capacitySpr.material.opacity = 0;
    }
    if (!showArterial) {
      for (const spr of [eastSpr, westSpr]) fadeTo(spr, 0);
    } else if (name === 'arterial') {
      eastSpr.material.opacity = 0;
      westSpr.material.opacity = 0;
    } else {
      for (const spr of [eastSpr, westSpr]) fadeTo(spr, 1);
    }
    if (name !== 'trace') {
      for (const spr of hopShareLabels) fadeTo(spr, 0);
    }
    fadeTo(viaPulse, showQueue ? 0.9 : 0);
    fadeTo(blockPulse, name === 'signal' ? 0.85 : 0);
    if (queueTube) fadeTo(queueTube, showQueue ? 0.85 : 0);
    fadeTo(ratioSpr, showQueue ? 1 : 0);
    const ringOn = showRing ? 0.95 : 0;
    for (const arc of ringGroup.userData.arcs || []) fadeTo(arc, ringOn);
  }

  group.setBeat = (name, at = performance.now() / 1000) => {
    beat = name;
    beatAt = at;
    applyBeat(name);
  };

  group.setTraceElapsed = (elapsed) => {
    traceElapsed = elapsed;
  };

  group.update = (time) => {
    for (const f of fades) {
      const mat = f.obj.material;
      if (!mat) continue;
      const cur = mat.opacity ?? 0;
      const next = cur + (f.targetOpacity - cur) * 0.12;
      mat.opacity = next;
      f.obj.visible = next > 0.02;
    }

    if (beat === 'trace') {
      for (const hop of hopPulses) {
        const dt = traceElapsed - (hop.revealAt ?? 0);
        if (dt < 0 || dt > 1.4) {
          hop.spr.visible = false;
          hop.spr.material.opacity = 0;
          continue;
        }
        const peak = dt < 0.25 ? dt / 0.25 : 1 - (dt - 0.25) / 1.15;
        hop.spr.visible = true;
        hop.spr.material.opacity = Math.max(0, peak) * 0.95;
        const s = 10 + peak * 16;
        hop.spr.scale.set(s, s, 1);
      }
      for (const sprite of hopShareLabels) {
        const local = traceElapsed - sprite.userData.revealAt - 0.18;
        const alpha = Math.min(1, Math.max(0, local / 0.4));
        sprite.material.opacity = alpha;
        sprite.visible = alpha > 0.02;
      }
    } else {
      for (const hop of hopPulses) {
        hop.spr.visible = false;
        hop.spr.material.opacity = 0;
      }
      for (const sprite of hopShareLabels) {
        sprite.visible = false;
        sprite.material.opacity = 0;
      }
    }

    if (beat === 'signal') {
      const signalElapsed = time - beatAt;
      const arcs = ringGroup.userData.arcs || [];
      arcs.forEach((arc, index) => {
        const revealAt = index < 2 ? index * 0.18 : 0.72 + (index - 2) * 0.16;
        const reveal = Math.min(1, Math.max(0, (signalElapsed - revealAt) / 0.35));
        arc.material.opacity = reveal * (index < 2 ? 0.95 : 0.88);
      });
      const p = signalElapsed > 0.7 ? 0.55 + 0.45 * Math.sin(time * 5.2) : 0;
      blockPulse.material.opacity = Math.max(blockPulse.material.opacity, p * 0.7);
      const s = 12 + p * 10;
      blockPulse.scale.set(s, s, 1);
    }

    if (beat === 'supply') {
      const elapsed = time - beatAt;
      const flowAlpha = Math.min(1, Math.max(0, elapsed / 0.45));
      const capacityAlpha = Math.min(1, Math.max(0, (elapsed - 0.38) / 0.45));
      flowSpr.material.opacity = flowAlpha;
      capacitySpr.material.opacity = capacityAlpha;
      flowSpr.visible = flowAlpha > 0.02;
      capacitySpr.visible = capacityAlpha > 0.02;
      const [flowW, flowH] = flowSpr.userData.baseScale || [32, 12.7];
      const [capW, capH] = capacitySpr.userData.baseScale || [32, 12.7];
      flowSpr.scale.set(flowW * (0.82 + flowAlpha * 0.18), flowH, 1);
      capacitySpr.scale.set(capW * (0.82 + capacityAlpha * 0.18), capH, 1);
    }

    if (beat === 'arterial') {
      const elapsed = time - beatAt;
      const eastAlpha = Math.min(1, Math.max(0, elapsed / 0.42));
      const westAlpha = Math.min(1, Math.max(0, (elapsed - 0.58) / 0.42));
      eastSpr.material.opacity = eastAlpha;
      westSpr.material.opacity = westAlpha;
      eastSpr.visible = eastAlpha > 0.02;
      westSpr.visible = westAlpha > 0.02;
    }

    if (beat === 'overflow') {
      const p = 0.5 + 0.5 * Math.sin(time * 3.4);
      viaPulse.material.opacity = Math.max(0.35, p);
      const s = 14 + p * 10;
      viaPulse.scale.set(s, s, 1);
      if (queueTube) {
        const grow = Math.min(1, Math.max(0, (time - beatAt) / 1.1));
        queueTube.material.opacity = 0.4 + grow * 0.5;
        queueTube.visible = true;
        const indexCount = queueTube.geometry.index?.count || 0;
        queueTube.geometry.setDrawRange(0, Math.floor(indexCount * grow));
      }
      if (ratioSpr) {
        const grow = Math.min(1, Math.max(0, (time - beatAt - 0.25) / 0.7));
        ratioSpr.material.opacity = grow;
        ratioSpr.visible = grow > 0.02;
        const bob = 1 + 0.04 * Math.sin(time * 3.2);
        const [rw, rh] = ratioSpr.userData.baseScale || [34, CARD_WORLD_H];
        ratioSpr.scale.set(rw * bob, rh * bob, 1);
      }
    }
  };

  group.dispose = () => {
    glowTex.dispose();
    group.traverse((obj) => {
      obj.geometry?.dispose?.();
      obj.material?.dispose?.();
    });
  };

  applyBeat('hidden');
  return group;
}

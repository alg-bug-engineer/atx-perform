/**
 * 幕 2 地图动作（方案 A）：路口脉冲、问题路段强调、双口绿灯错配时间轴。
 */
import * as THREE from 'three';

const C_GREEN = 0x00cc44;
const C_AMBER = 0xf5a623;
const C_RED = 0xff1800;
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

function makeArterialSprite({ title, speed, saturation, flow, delay, accent = '#ff8a3a' }) {
  const speedText = `${Number(speed || 0).toFixed(1)} km/h`;
  const sat = Number(saturation);
  const flowN = Number(flow);
  const flowText = Number.isFinite(flowN)
    ? `${Number.isInteger(flowN) ? flowN.toFixed(0) : flowN.toFixed(1)} pcu/h`
    : '—';
  const delayN = Number(delay);
  const rows = [
    `饱和度 ${Number.isFinite(sat) ? sat.toFixed(2) : '—'}`,
    `流量 ${flowText}`,
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

function makeCoordinationTimelineSprite(evidence = {}, queueM = 270) {
  const cycle = Number(evidence.common_cycle_sec) || 220;
  const downstream = evidence.downstream_signal || {};
  const upstream = evidence.upstream_signal || {};
  const mismatch = evidence.mismatch || {};
  const queueDisplayM = Number(mismatch.queue_m)
    || Number(evidence.queue_observation?.display_queue_m)
    || Number(queueM)
    || 270;
  const downstreamStart = Number(downstream.effective_green_start_sec) || 85;
  const downstreamGreen = Number(downstream.green_duration_sec) || 57;
  const upstreamStart = Number(upstream.release_start_sec) || 59;
  const upstreamGreen = Number(upstream.green_duration_sec) || 21;
  const conflictStart = Number(mismatch.conflict_start_sec) || upstreamStart;
  const conflictEnd = Number(mismatch.conflict_end_sec) || downstreamStart;
  const title = mismatch.card_title || '双口绿灯错配';
  const headline = mismatch.headline || '绿灯时间不一致';
  const display = mismatch.display || '经十北直已红灯时，解放东仍在放行';
  const risk = mismatch.risk || '溢流风险加重';
  const footer = mismatch.footer || '周期一致，调整放行先后即可降低集中到达';
  const queueLabel = mismatch.queue_label || '排队';

  const cssW = 540;
  const cssH = 242;
  const { canvas, ctx } = beginLabelCanvas(cssW, cssH);
  ctx.fillStyle = 'rgba(3, 14, 25, 0.94)';
  ctx.strokeStyle = 'rgba(255, 138, 58, 0.72)';
  strokeCard(ctx, cssW, cssH);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '600 18px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#e8f6ff';
  ctx.fillText(title, 20, 24);
  ctx.font = '600 13px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#ff8a3a';
  ctx.fillText(headline, 20, 46);
  ctx.textAlign = 'right';
  ctx.font = '500 14px "DIN Alternate","PingFang SC",sans-serif';
  ctx.fillStyle = 'rgba(175,205,220,0.9)';
  ctx.fillText(`共同周期 ${cycle} s`, cssW - 20, 24);

  const barX = 148;
  const barW = cssW - barX - 22;
  const barH = 18;
  const jingshiY = 78;
  const jiefangY = 122;
  const xAt = (sec) => barX + (sec / cycle) * barW;
  const wAt = (sec) => Math.max(4, (sec / cycle) * barW);

  ctx.textAlign = 'left';
  ctx.font = '500 13px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillStyle = 'rgba(205,225,238,0.92)';
  ctx.fillText('经十路口 · 北直', 18, jingshiY + barH / 2);
  ctx.fillText('解放东路口 · 北直', 18, jiefangY + barH / 2);

  ctx.fillStyle = 'rgba(255, 48, 32, 0.72)';
  ctx.fillRect(barX, jingshiY, barW, barH);
  ctx.fillStyle = 'rgba(44, 213, 120, 0.96)';
  ctx.fillRect(xAt(downstreamStart), jingshiY, wAt(downstreamGreen), barH);

  ctx.fillStyle = 'rgba(115,140,160,0.22)';
  ctx.fillRect(barX, jiefangY, barW, barH);
  ctx.fillStyle = 'rgba(44, 213, 120, 0.96)';
  ctx.fillRect(xAt(upstreamStart), jiefangY, wAt(upstreamGreen), barH);

  const conflictX = xAt(conflictStart);
  const conflictW = wAt(conflictEnd - conflictStart);
  ctx.fillStyle = 'rgba(255, 96, 40, 0.2)';
  ctx.fillRect(conflictX, jingshiY - 8, conflictW, jiefangY + barH - jingshiY + 16);
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = 'rgba(255, 138, 58, 0.95)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(conflictX, jingshiY - 8, conflictW, jiefangY + barH - jingshiY + 16);
  ctx.setLineDash([]);

  const jingshiGreenX = xAt(downstreamStart);
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = 'rgba(0,229,255,0.8)';
  ctx.beginPath();
  ctx.moveTo(jingshiGreenX, jingshiY - 10);
  ctx.lineTo(jingshiGreenX, jiefangY + barH + 10);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = '600 11px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillStyle = 'rgba(255, 210, 180, 0.95)';
  ctx.textAlign = 'center';
  ctx.fillText('经十已红 · 解放东仍绿', conflictX + conflictW / 2, jingshiY - 16);
  ctx.fillStyle = 'rgba(180, 230, 255, 0.9)';
  ctx.fillText('经十转绿', jingshiGreenX + 28, jiefangY + barH + 16);

  ctx.font = '600 10px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillStyle = 'rgba(255, 220, 220, 0.88)';
  if (conflictW > 36) ctx.fillText('红灯', conflictX + conflictW / 2, jingshiY + barH / 2);
  ctx.fillStyle = 'rgba(20, 40, 28, 0.9)';
  ctx.fillText('绿灯', xAt(downstreamStart) + wAt(downstreamGreen) / 2, jingshiY + barH / 2);
  ctx.fillStyle = 'rgba(20, 40, 28, 0.9)';
  const jiefangGreenW = wAt(upstreamGreen);
  if (jiefangGreenW > 22) {
    ctx.fillText('绿灯', xAt(upstreamStart) + jiefangGreenW / 2, jiefangY + barH / 2);
  }

  ctx.textAlign = 'left';
  ctx.font = '600 15px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#ffb070';
  ctx.fillText(`${display}，${risk}`, 20, 178);
  ctx.font = '500 13px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#ff8a3a';
  ctx.fillText(`${queueLabel} ${queueDisplayM} m`, 20, 200);
  ctx.fillStyle = '#86efac';
  ctx.fillText('判定：可协调', 188, 200);
  ctx.font = '500 12px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillStyle = 'rgba(180,205,220,0.78)';
  ctx.fillText(footer, 20, 220);

  const texture = makeLabelTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  const worldH = 20;
  sprite.scale.set(worldH * (cssW / cssH), worldH, 1);
  sprite.renderOrder = 65;
  sprite.visible = false;
  sprite.userData.disposeLabel = () => texture.dispose();
  return sprite;
}

/**
 * @param {{
 *   target?: { pos: [number, number] },
 *   problemRoad?: { coords: [number, number][] },
 *   queueM?: number,
 *   supplyMetrics?: { flow?: number, capacity?: number },
 *   arterialMetrics?: {
 *     east?: { speed?: number, delay?: number, saturation?: number, flow?: number },
 *     west?: { speed?: number, delay?: number, saturation?: number, flow?: number },
 *   },
 *   coordinationEvidence?: object,
 *   hopTimes?: {
 *     pos: [number, number],
 *     revealAt: number,
 *     label: string,
 *     shareRatio?: number|null,
 *   }[],
 * }} opts
 */
export function createScene2MapAnnot({
  target,
  problemRoad,
  queueM = 270,
  supplyMetrics = {},
  arterialMetrics = {},
  coordinationEvidence = {},
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
    title: '进口道路能力',
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

  const coordinationGroup = new THREE.Group();
  coordinationGroup.visible = false;
  const coordinationTimeline = makeCoordinationTimelineSprite(coordinationEvidence, queueM);
  if (problemMid) {
    coordinationTimeline.position.set(problemMid[0] + 34, 22, -problemMid[1]);
  } else if (targetPos) {
    coordinationTimeline.position.set(targetPos[0] + 34, 22, -targetPos[1]);
  }
  coordinationGroup.add(coordinationTimeline);

  const signalQueueM = Number(
    coordinationEvidence.mismatch?.queue_m
      ?? coordinationEvidence.queue_observation?.display_queue_m
      ?? queueM,
  ) || 270;
  const residualQueuePts = pathFromSouth(
    problemRoad?.coords,
    Math.max(4, signalQueueM / METERS_PER_UNIT),
  );
  const residualQueueTube = makeTube(residualQueuePts, 1.05, C_RED, 1.15);
  if (residualQueueTube) {
    residualQueueTube.geometry.setDrawRange(0, 0);
    coordinationGroup.add(residualQueueTube);
  }
  track(coordinationGroup);

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

  let beat = 'hidden';
  let beatAt = 0;
  let traceElapsed = 0;

  function applyBeat(name) {
    fades.length = 0;
    const showLink = name === 'supply';
    const showCoordination = name === 'signal';
    const showSupply = name === 'supply';
    const supplyLeaving = name === 'supply_out';
    const showArterial = name === 'arterial' || name === 'signal';
    coordinationGroup.visible = showCoordination;
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
    if (name !== 'trace' && name !== 'inflow') {
      for (const spr of hopShareLabels) fadeTo(spr, 0);
    }
    fadeTo(blockPulse, name === 'signal' ? 0.85 : 0);
    fadeTo(coordinationTimeline, showCoordination ? 1 : 0);
    if (residualQueueTube) fadeTo(residualQueueTube, showCoordination ? 0.9 : 0);
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

    if (beat === 'trace' || beat === 'inflow') {
      for (const hop of hopPulses) {
        if (beat !== 'trace') {
          hop.spr.visible = false;
          hop.spr.material.opacity = 0;
          continue;
        }
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
        if (beat === 'inflow') {
          sprite.material.opacity = 1;
          sprite.visible = true;
          continue;
        }
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
      const timelineAlpha = Math.min(1, Math.max(0, signalElapsed / 0.45));
      coordinationTimeline.material.opacity = timelineAlpha;
      coordinationTimeline.visible = timelineAlpha > 0.02;

      if (residualQueueTube) {
        const grow = Math.min(1, Math.max(0, (signalElapsed - 0.35) / 0.85));
        residualQueueTube.material.opacity = 0.35 + grow * 0.55;
        residualQueueTube.visible = grow > 0.02;
        const indexCount = residualQueueTube.geometry.index?.count || 0;
        residualQueueTube.geometry.setDrawRange(0, Math.floor(indexCount * grow));
      }

      const conflict = signalElapsed > 2.65 ? 0.55 + 0.45 * Math.sin(time * 5.2) : 0;
      blockPulse.material.opacity = Math.max(blockPulse.material.opacity, conflict * 0.72);
      const s = 12 + conflict * 10;
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
  };

  group.dispose = () => {
    glowTex.dispose();
    group.traverse((obj) => {
      obj.userData?.disposeLabel?.();
      obj.geometry?.dispose?.();
      obj.material?.dispose?.();
    });
  };

  applyBeat('hidden');
  return group;
}

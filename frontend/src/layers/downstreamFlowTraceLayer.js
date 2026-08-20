/**
 * 幕 2 下游关联去向层。
 *
 * 沿真实有向路网从本口向外寻路；渲染与流量溯源相同：
 * LineSegments2 绿→黄波前、路口涟漪、流向箭头。波从前端路口向外走。
 */
import * as THREE from 'three';
import {
  FADE_IN_DUR,
  TRANS_DUR,
  VIEW_PAD,
  roadLen,
  roadKey,
  boundsFromIds,
  buildInflowRoads,
  buildRippleRings,
  buildFlowArrows,
} from './inflowTraceLayer.js';

const MAX_ROUTE_EDGES = 10;
/** 下游波前快于溯源汇入（投影单位 / 秒） */
const WAVE_SPEED = 52;

function findRoute(topology, fromId, toId) {
  if (!fromId || !toId || fromId === toId) return [];
  const queue = [{ id: fromId, roads: [] }];
  const seen = new Set([fromId]);

  while (queue.length) {
    const current = queue.shift();
    if (current.roads.length >= MAX_ROUTE_EDGES) continue;
    for (const edge of topology?.adjOut?.get(current.id) || []) {
      const nextId = edge.toId;
      if (!nextId || !edge.road) continue;
      const roads = [...current.roads, edge.road];
      if (nextId === toId) return roads;
      if (seen.has(nextId)) continue;
      seen.add(nextId);
      queue.push({ id: nextId, roads });
    }
  }
  return null;
}

function accumulateRoute(originId, roads, distTime, tracedRoadKeys) {
  let prevId = originId;
  let t = distTime.get(originId) ?? 0;
  for (const road of roads || []) {
    if (!road) continue;
    tracedRoadKeys.add(roadKey(road));
    const from = road.props?.from_inter_id;
    const to = road.props?.to_inter_id;
    const nextId = from === prevId ? to : to === prevId ? from : (to || from);
    const len = roadLen(road.coords);
    const nextT = t + (len > 0.01 ? len / WAVE_SPEED : 0);
    if (nextId && nextT < (distTime.get(nextId) ?? Infinity)) {
      distTime.set(nextId, nextT);
    }
    if (nextId) {
      prevId = nextId;
      t = distTime.get(nextId) ?? nextT;
    }
  }
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, width, height, radius);
  else ctx.rect(x, y, width, height);
}

function makeShareSprite(name, ratio, primary, extras = []) {
  const shortName = String(name || '下游关联路口').replace(/路口$/, '');
  const ratioText = `${Number(ratio).toFixed(2)}%`;
  const extraLines = extras.filter(Boolean);
  const dpr = 2;
  const padX = 26;
  const titleSize = 26;
  const ratioSize = 38;
  const metricSize = 22;
  const extraSize = 20;
  const extraH = extraLines.length ? 10 + extraLines.length * 26 : 0;
  const cssH = 136 + extraH;
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `500 ${titleSize}px "PingFang SC","Microsoft YaHei",sans-serif`;
  let contentW = measure.measureText(shortName).width;
  measure.font = `700 ${ratioSize}px "DIN Alternate","PingFang SC",sans-serif`;
  const ratioW0 = measure.measureText(ratioText).width;
  measure.font = `500 ${metricSize}px "PingFang SC","Microsoft YaHei",sans-serif`;
  contentW = Math.max(contentW, ratioW0 + 16 + measure.measureText(primary ? '主去向占比' : '下游关联占比').width);
  measure.font = `500 ${extraSize}px "PingFang SC","Microsoft YaHei",sans-serif`;
  for (const line of extraLines) contentW = Math.max(contentW, measure.measureText(line).width);
  const cssW = Math.ceil(Math.max(contentW + padX * 2, 340));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  roundedRect(ctx, 6, 6, cssW - 12, cssH - 12, 12);
  ctx.fillStyle = 'rgba(3, 15, 26, 0.9)';
  ctx.fill();
  ctx.strokeStyle = primary ? 'rgba(255,204,0,0.92)' : 'rgba(255,204,0,0.72)';
  ctx.lineWidth = 2.4;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `500 ${titleSize}px "PingFang SC","Microsoft YaHei",sans-serif`;
  ctx.fillStyle = 'rgba(220,240,250,0.94)';
  ctx.fillText(shortName, padX, 42);
  ctx.font = `700 ${ratioSize}px "DIN Alternate","PingFang SC",sans-serif`;
  ctx.fillStyle = '#ffcc00';
  ctx.fillText(ratioText, padX, 94);
  const ratioW = ctx.measureText(ratioText).width;
  ctx.font = `500 ${metricSize}px "PingFang SC","Microsoft YaHei",sans-serif`;
  ctx.fillStyle = 'rgba(150,180,198,0.82)';
  ctx.fillText(primary ? '主去向占比' : '下游关联占比', padX + ratioW + 16, 94);
  extraLines.forEach((line, index) => {
    ctx.font = `500 ${extraSize}px "PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.fillStyle = 'rgba(200,220,235,0.9)';
    ctx.fillText(line, padX, 128 + index * 26);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  const worldH = 13.6 * (cssH / 136);
  sprite.scale.set(worldH * (cssW / cssH), worldH, 1);
  sprite.userData.baseScale = [worldH * (cssW / cssH), worldH];
  sprite.renderOrder = 64;
  sprite.userData.disposeLabel = () => texture.dispose();
  return sprite;
}

function selectThroughHops(entries) {
  const byHop = new Map();
  for (const item of entries || []) {
    const hop = Number(item.chain_hop);
    const ratio = Number(item.flow_share_ratio);
    if (!Number.isFinite(hop) || !Number.isFinite(ratio)) continue;
    const current = byHop.get(hop);
    if (!current || ratio > Number(current.flow_share_ratio)) byHop.set(hop, item);
  }
  return [...byHop.values()].sort((a, b) => a.chain_hop - b.chain_hop).slice(0, 3);
}

function resolveIntersection(intersections, trace) {
  const byId = intersections.find(
    (item) => item.props?.inter_id === trace.cor_inter_id,
  );
  if (byId) return byId;
  const byName = intersections.find(
    (item) => item.props?.inter_name === trace.cor_inter_name,
  );
  if (byName) return byName;
  if (!Number.isFinite(Number(trace.cor_lon)) || !Number.isFinite(Number(trace.cor_lat))) {
    return null;
  }
  let best = null;
  let bestDistance = Infinity;
  for (const item of intersections) {
    const [lon, lat] = item.lonlat || [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const distance = (lon - trace.cor_lon) ** 2 + (lat - trace.cor_lat) ** 2;
    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return bestDistance < 0.000001 ? best : null;
}

/**
 * @param {{
 *  roads?: object[],
 *  intersections: object[],
 *  topology: object,
 *  originId: string,
 *  traces: object[],
 *  receiving?: {
 *    link?: { avg_speed_kmh?: number, congestion_delay_index?: number, length_m?: number },
 *    queue?: { queue_ratio?: number, queue_m?: number, storage_m?: number },
 *  },
 *  resolution?: THREE.Vector2,
 * }} opts
 */
export function createDownstreamFlowTraceLayer({
  roads = [],
  intersections = [],
  topology,
  originId,
  traces = [],
  receiving = null,
  resolution,
} = {}) {
  const group = new THREE.Group();
  group.name = 'scene2DownstreamFlowTrace';
  const originInter = intersections.find((item) => item.props?.inter_id === originId);
  const selected = selectThroughHops(traces);
  const distTime = new Map([[originId, 0]]);
  const tracedRoadKeys = new Set();
  const nodeSprites = [];

  const lookPath = originInter?.pos ? [originInter.pos] : [];
  selected.forEach((trace, traceIndex) => {
    const inter = resolveIntersection(intersections, trace);
    const destinationId = inter?.props?.inter_id || trace.cor_inter_id;
    const route = findRoute(topology, originId, destinationId);
    if (route?.length) accumulateRoute(originId, route, distTime, tracedRoadKeys);

    if (!inter?.pos) return;
    lookPath.push(inter.pos);
    if (inter.props?.inter_id && !distTime.has(inter.props.inter_id)) {
      distTime.set(inter.props.inter_id, (distTime.get(originId) ?? 0) + 0.8 + traceIndex * 0.35);
    }
    const extras = [];
    if (traceIndex === 0) {
      const speed = Number(receiving?.link?.avg_speed_kmh);
      const delay = Number(receiving?.link?.congestion_delay_index);
      const queueRatio = Number(receiving?.queue?.queue_ratio);
      if (Number.isFinite(speed)) extras.push(`速度 ${speed.toFixed(1)} km/h`);
      if (Number.isFinite(delay)) extras.push(`拥堵延时指数 ${delay.toFixed(2)}`);
      if (Number.isFinite(queueRatio) && queueRatio > 0) {
        extras.push(`排队占比 ${(queueRatio * 100).toFixed(1)}%`);
      }
    }
    const sprite = makeShareSprite(
      trace.cor_inter_name,
      trace.flow_share_ratio,
      traceIndex === 0,
      extras,
    );
    sprite.position.set(inter.pos[0] + (traceIndex % 2 ? 14 : -14), 14, -inter.pos[1]);
    sprite.userData.revealAt = (distTime.get(inter.props?.inter_id) ?? 0.8) + FADE_IN_DUR;
    nodeSprites.push(sprite);
    group.add(sprite);
  });

  const viewBounds = boundsFromIds(intersections, new Set(distTime.keys()), VIEW_PAD);
  const maxT = Math.max(0, ...distTime.values());
  const holdDur = Math.max(2.4, maxT + FADE_IN_DUR + TRANS_DUR);
  const jamOpts = { palette: 'yellow' };
  const roadMesh = buildInflowRoads(roads, distTime, tracedRoadKeys, viewBounds, resolution, jamOpts);
  const ripples = buildRippleRings(intersections, distTime, viewBounds);
  const arrows = buildFlowArrows(roads, distTime, tracedRoadKeys, viewBounds, jamOpts);

  group.add(roadMesh);
  group.add(ripples);
  group.add(arrows);

  let playing = false;
  let startedAt = 0;
  let doneSignaled = false;
  let resolveDone = null;
  let donePromise = Promise.resolve();

  group.play = (at = performance.now() / 1000) => {
    playing = true;
    startedAt = at;
    doneSignaled = false;
    donePromise = new Promise((resolve) => {
      resolveDone = resolve;
    });
    for (const sprite of nodeSprites) sprite.material.opacity = 0;
  };

  group.stop = () => {
    playing = false;
  };

  group.update = (time) => {
    if (!playing) return;
    const elapsed = time - startedAt;
    roadMesh.updateColors?.(Math.min(elapsed, holdDur));
    ripples.updateRipples?.(elapsed);
    arrows.updateArrows?.(elapsed);
    for (const sprite of nodeSprites) {
      const local = elapsed - sprite.userData.revealAt;
      const alpha = Math.min(1, Math.max(0, local / 0.45));
      sprite.material.opacity = alpha;
      sprite.visible = alpha > 0.02;
      const bob = 1 + 0.035 * Math.sin(time * 3.1);
      const [sx, sy] = sprite.userData.baseScale || [36, 13.6];
      sprite.scale.set(sx * bob, sy * bob, 1);
    }
    if (!doneSignaled && elapsed >= holdDur) {
      doneSignaled = true;
      resolveDone?.();
    }
  };

  const cx = (viewBounds.minX + viewBounds.maxX) / 2;
  const cy = (viewBounds.minY + viewBounds.maxY) / 2;
  group.durationSec = holdDur;
  group.whenFullyRevealed = () => donePromise;
  group.primaryTrace = selected[0] || null;
  group.lookPath = lookPath;
  group.getElapsed = (time) => (playing ? time - startedAt : 0);
  group.getProgress = (time) => {
    if (!playing) return 0;
    return Math.max(0, Math.min(1, (time - startedAt) / holdDur));
  };
  group.setResolution = (w, h) => roadMesh.setResolution?.(w, h);
  group.bounds = {
    minX: viewBounds.minX,
    maxX: viewBounds.maxX,
    minY: viewBounds.minY,
    maxY: viewBounds.maxY,
    minZ: -viewBounds.maxY,
    maxZ: -viewBounds.minY,
  };
  group.worldCenter = new THREE.Vector3(cx, 0, -cy);

  group.dispose = () => {
    playing = false;
    group.traverse((object) => {
      object.userData?.disposeLabel?.();
      object.geometry?.dispose?.();
      object.material?.dispose?.();
    });
    arrows.arrowGeo?.dispose?.();
  };

  return group;
}

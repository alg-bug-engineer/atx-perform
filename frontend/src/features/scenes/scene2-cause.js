/**
 * 幕 2：坤顺/解放东北东西进口 → 经十路–奥体西北进口 流量溯源
 * 视觉对齐 baseline 拥堵蔓延的反向：远端先亮，收束到汇点。
 * 溯源之后：路旁供需钉 → 经十东西向进口钉 → 示意相位环 → 270m 排队溢流。
 */
import { createInflowTraceLayer } from '../../layers/inflowTraceLayer.js';
import { createJingshiEwFlowLayer } from '../../layers/jingshiEwFlowLayer.js';
import { createRoadNameLabelLayer } from '../../layers/roadNameLabels.js';
import { createScene2MapAnnot } from '../../layers/scene2MapAnnot.js';

const APPROACH_ALIAS = {
  N: 'N',
  E: 'E',
  W: 'W',
  S: 'S',
  北: 'N',
  东: 'E',
  西: 'W',
  南: 'S',
  北进口: 'N',
  东进口: 'E',
  西进口: 'W',
  南进口: 'S',
};

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json();
}

function findIntersection(intersections, spec) {
  if (!spec) return null;
  const name = spec.name;
  const lng = spec.lng;
  const lat = spec.lat;
  const byName = name
    ? intersections.find((i) => i.props?.inter_name === name)
    : null;
  if (byName) return byName;
  if (lng == null || lat == null) return null;
  let best = null;
  let bestD = Infinity;
  for (const i of intersections) {
    const [lon, la] = i.lonlat || [];
    if (lon == null) continue;
    const d = (lon - lng) ** 2 + (la - lat) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function parseApproaches(raw, { allowSouth = false, fallback = ['N', 'E', 'W'] } = {}) {
  const list = Array.isArray(raw) ? raw : [];
  const dirs = [];
  for (const item of list) {
    const key = String(item).trim();
    const dir = APPROACH_ALIAS[key] || APPROACH_ALIAS[key.replace(/进口$/, '')];
    if (!dir) continue;
    if (dir === 'S' && !allowSouth) continue;
    if (!dirs.includes(dir)) dirs.push(dir);
  }
  return dirs.length ? dirs : fallback;
}

function heightForBounds(bounds) {
  if (!bounds || !Number.isFinite(bounds.minX)) return 280;
  const spanX = Math.max(40, bounds.maxX - bounds.minX);
  const spanZ = Math.max(40, bounds.maxZ - bounds.minZ);
  const span = Math.max(spanX, spanZ);
  return Math.max(240, Math.min(520, span * 1.35));
}

function heightForProblemLink(bounds) {
  if (!bounds || !Number.isFinite(bounds.minX)) return 110;
  const spanX = Math.max(18, bounds.maxX - bounds.minX);
  const spanZ = Math.max(18, bounds.maxZ - bounds.minZ);
  const span = Math.max(spanX, spanZ);
  return Math.max(72, Math.min(150, span * 2.1));
}

function resolveLabelAnchor(spec, { source, via, target }) {
  const at = spec?.at;
  let pos = null;
  if (at === 'source') pos = source?.pos;
  else if (at === 'via') pos = via?.pos;
  else if (at === 'target') pos = target?.pos;
  else if (at === 'problem_mid' && via?.pos && target?.pos) {
    pos = [(via.pos[0] + target.pos[0]) / 2, (via.pos[1] + target.pos[1]) / 2];
  }
  if (!pos || !Number.isFinite(pos[0])) return null;
  return {
    x: pos[0] + (spec.dx || 0),
    y: 10,
    z: -(pos[1] + (spec.dy || 0)),
  };
}

function buildRoadLabels(flowTrace, { source, via, target }) {
  const specs = flowTrace.road_labels || [
    { name: '经十路', at: 'target', dx: -20, dy: 6 },
    { name: '奥体西', at: 'problem_mid', dx: -12, dy: 0 },
    { name: '解放东', at: 'via', dx: 18, dy: 7 },
    { name: '坤顺路', at: 'source', dx: 18, dy: 7 },
  ];
  return specs
    .map((spec) => {
      const anchor = resolveLabelAnchor(spec, { source, via, target });
      return anchor ? { name: spec.name, anchor } : null;
    })
    .filter(Boolean);
}

function copyText(dc, id, fallback) {
  const hit = (dc?.copy || []).find((item) => item.id === id);
  return hit?.text || fallback;
}

function captionFor(beats, key, fallback) {
  return beats?.[key]?.caption || fallback;
}

function beatMs(beats, key, fallback) {
  const n = Number(beats?.[key]?.ms);
  return Number.isFinite(n) ? n : fallback;
}

function followTraceLook(progress, source, via, target) {
  const s = source?.pos;
  const v = via?.pos || s;
  const t = target?.pos || v;
  if (!s || !t) return null;
  const p = Math.max(0, Math.min(1, progress));
  let x;
  let north;
  if (p < 0.42 && v) {
    const u = p / 0.42;
    x = s[0] + (v[0] - s[0]) * u;
    north = s[1] + (v[1] - s[1]) * u;
  } else if (v) {
    const u = (p - 0.42) / 0.58;
    x = v[0] + (t[0] - v[0]) * u;
    north = v[1] + (t[1] - v[1]) * u;
  } else {
    x = s[0] + (t[0] - s[0]) * p;
    north = s[1] + (t[1] - s[1]) * p;
  }
  return {
    x,
    y: 250 - p * 95,
    z: -north,
  };
}

function findProblemRoad(roads, fromId, toId, spec) {
  const nameHint = spec?.road_name || '解放东路-经十路';
  const byEnds = roads.find(
    (r) => r.props?.from_inter_id === fromId && r.props?.to_inter_id === toId,
  );
  if (byEnds) return byEnds;
  const hint = String(nameHint).replace(/\(.*\)$/, '');
  return roads.find((r) => String(r.props?.road_names || '').includes(hint) || String(r.props?.road_names || '').includes('解放东路-经十路'));
}

function boundsFromCoords(coords, pad = 14) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of coords || []) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return null;
  return {
    minX: minX - pad,
    maxX: maxX + pad,
    minY: minY - pad,
    maxY: maxY + pad,
    minZ: -(maxY + pad),
    maxZ: -(minY - pad),
  };
}

function heightForJingshiEw(bounds) {
  if (!bounds || !Number.isFinite(bounds.minX)) return 170;
  const spanX = Math.max(40, bounds.maxX - bounds.minX);
  const spanZ = Math.max(22, (bounds.maxZ ?? 0) - (bounds.minZ ?? 0));
  const span = Math.max(spanX, spanZ);
  return Math.max(130, Math.min(240, span * 1.15));
}

/**
 * @param {object} runtime
 * @param {{ roads, intersections, topology, getResolution }} mapCtx
 * @param {{ onHud?: Function, onComplete?: Function }} hooks
 */
export async function createScene2Cause(runtime, mapCtx, hooks = {}) {
  const flowTrace = await fetchJson('/data/1-2-flow-trace.json');
  const { roads, intersections, topology, getResolution } = mapCtx;
  const hopApproaches = parseApproaches(
    flowTrace?.allowed_approaches || flowTrace?.meta?.approaches,
    { fallback: ['N', 'E', 'W'] },
  );
  const targetApproaches = parseApproaches(
    flowTrace?.target_approach_dirs || flowTrace?.meta?.target_approaches,
    { fallback: ['N'] },
  );

  let layer = null;
  let ewLayer = null;
  let nameLayer = null;
  let annot = null;
  let playing = false;
  let disposed = false;
  let timers = [];
  let playGen = 0;
  let playPhase = '';
  let followCtx = null;

  function clearTimers() {
    for (const id of timers) clearTimeout(id);
    timers = [];
  }

  function after(ms, fn) {
    const gen = playGen;
    const id = setTimeout(() => {
      if (!playing || disposed || gen !== playGen) return;
      fn();
    }, ms);
    timers.push(id);
  }

  function clearInflowLayer() {
    if (!layer) return;
    runtime.scene.remove(layer);
    layer.dispose?.();
    layer = null;
  }

  function clearEwLayer() {
    if (!ewLayer) return;
    runtime.scene.remove(ewLayer);
    ewLayer.dispose?.();
    ewLayer = null;
  }

  function clearNameLayer() {
    if (!nameLayer) return;
    runtime.scene.remove(nameLayer);
    nameLayer.dispose?.();
    nameLayer = null;
  }

  function clearAnnot() {
    if (!annot) return;
    runtime.scene.remove(annot);
    annot.dispose?.();
    annot = null;
  }

  function clearLayer() {
    clearInflowLayer();
    clearEwLayer();
    clearNameLayer();
    clearAnnot();
    followCtx = null;
    playPhase = '';
  }

  function frameSink(bounds, center) {
    const h = heightForBounds(bounds);
    runtime.animateCamera({
      posTarget: { x: center.x, y: h, z: center.z },
      lookTarget: { x: center.x, y: 0, z: center.z },
      lerp: 0.045,
    });
  }

  function frameProblemLink(viaInter, targetInter) {
    const spec = flowTrace.problem_link || {};
    const road = findProblemRoad(
      roads,
      viaInter?.props?.inter_id,
      targetInter?.props?.inter_id,
      spec,
    );
    let bounds = road?.coords?.length >= 2 ? boundsFromCoords(road.coords) : null;
    if (!bounds && viaInter?.pos && targetInter?.pos) {
      bounds = boundsFromCoords([viaInter.pos, targetInter.pos]);
    }
    if (!bounds) return;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const h = heightForProblemLink(bounds);
    runtime.animateCamera({
      posTarget: { x: cx, y: h, z: -cy },
      lookTarget: { x: cx, y: 0, z: -cy },
      lerp: 0.05,
    });
  }

  function frameJingshiEw(targetInter, problemRoad) {
    const [tx, ty] = targetInter?.pos || [];
    if (!Number.isFinite(tx)) return;
    if (ewLayer?.bounds) {
      runtime.animateCamera({
        posTarget: {
          x: ewLayer.worldCenter.x,
          y: heightForJingshiEw(ewLayer.bounds),
          z: ewLayer.worldCenter.z,
        },
        lookTarget: { x: ewLayer.worldCenter.x, y: 0, z: ewLayer.worldCenter.z },
        lerp: 0.05,
      });
      return;
    }
    const padX = 62;
    const padY = 26;
    const coords = [
      [tx - padX, ty - padY],
      [tx + padX, ty + padY],
    ];
    if (problemRoad?.coords?.length >= 2) {
      const mid = problemRoad.coords[Math.floor(problemRoad.coords.length / 2)];
      coords.push(mid);
    }
    const bounds = boundsFromCoords(coords, 8);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    runtime.animateCamera({
      posTarget: { x: cx, y: heightForJingshiEw(bounds), z: -cy },
      lookTarget: { x: cx, y: 0, z: -cy },
      lerp: 0.05,
    });
  }

  function play() {
    if (disposed) return;
    playing = true;
    clearTimers();
    clearLayer();
    const gen = ++playGen;

    const target = findIntersection(intersections, flowTrace.target);
    const source = findIntersection(intersections, flowTrace.source);
    const via = findIntersection(intersections, flowTrace.via);
    if (!target) {
      hooks.onHud?.({ phase: 'error', caption: '未找到经十路–奥体西汇点', text: '未找到经十路–奥体西汇点' });
      return;
    }
    if (!source) {
      hooks.onHud?.({ phase: 'error', caption: '未找到坤顺–奥体西源点', text: '未找到坤顺–奥体西源点' });
      return;
    }

    const allLabels = buildRoadLabels(flowTrace, { source, via, target });
    nameLayer = createRoadNameLabelLayer(allLabels);
    runtime.scene.add(nameLayer);

    const problemRoad = findProblemRoad(
      roads,
      via?.props?.inter_id,
      target?.props?.inter_id,
      flowTrace.problem_link || {},
    );
    const dc = flowTrace.downstream_constraint || {};
    const beats = flowTrace.map_beats || {};
    const res = getResolution?.();
    layer = createInflowTraceLayer({
      roads,
      intersections,
      topology,
      originId: target.props.inter_id,
      sourceId: source.props.inter_id,
      viaIds: via ? [via.props.inter_id] : [],
      hopApproaches,
      targetApproaches,
      resolution: res,
    });
    runtime.scene.add(layer);

    const hopTimes = [
      { id: source.props.inter_id, pos: source.pos, revealAt: layer.revealAt?.(source.props.inter_id) ?? 0, label: '坤顺' },
      via
        ? { id: via.props.inter_id, pos: via.pos, revealAt: layer.revealAt?.(via.props.inter_id) ?? 0, label: '解放东' }
        : null,
      { id: target.props.inter_id, pos: target.pos, revealAt: layer.revealAt?.(target.props.inter_id) ?? 0, label: '经十' },
    ].filter(Boolean);

    annot = createScene2MapAnnot({
      via,
      target,
      problemRoad,
      queueM: beats.overflow?.queue_m || 270,
      queueRatio: beats.overflow?.queue_ratio ?? 0.8,
      hopTimes,
    });
    runtime.scene.add(annot);
    annot.setBeat('trace');

    followCtx = { source, via, target };
    playPhase = 'trace';
    const startLook = followTraceLook(0, source, via, target);
    if (startLook) {
      runtime.animateCamera({
        posTarget: { x: startLook.x, y: startLook.y, z: startLook.z },
        lookTarget: { x: startLook.x, y: 0, z: startLook.z },
        lerp: 0.07,
      });
    } else {
      frameSink(layer.bounds, layer.worldCenter);
    }
    layer.play(performance.now() / 1000);

    hooks.onHud?.({
      phase: 'trace',
      caption: captionFor(beats, 'trace', flowTrace.trace_hint || '正在进行问题路段流量溯源'),
      text: captionFor(beats, 'trace', flowTrace.trace_hint || '正在进行问题路段流量溯源'),
      panel: { kind: 'trace', title: '流量溯源' },
    });

    layer.whenFullyRevealed?.().then(() => {
      if (!playing || disposed || gen !== playGen) return;
      playPhase = 'supply';
      followCtx = null;
      frameProblemLink(via, target);
      annot?.setBeat('supply');
      const ds = flowTrace.demand_supply || {};
      hooks.onHud?.({
        phase: 'supply',
        caption: captionFor(beats, 'supply', '供给小于需求，路段有承接能力'),
        text: captionFor(beats, 'supply', '供给小于需求，路段有承接能力'),
        panel: {
          kind: 'supply',
          title: ds.title || '上游需求流量分析',
          supply: ds.supply_vph,
          demand: ds.demand_vph,
          conclusion: ds.conclusion || '供给小于需求，当前路段有承接能力',
        },
      });

      after(beatMs(beats, 'supply', dc.hold_ms ?? 2800), () => {
        clearInflowLayer();
        annot?.setBeat('hidden');
        hooks.onHud?.({
          phase: 'ew_clear',
          caption: '',
          text: '',
        });
        nameLayer?.setVisibleNames?.(dc.keep_road_labels || ['经十路', '奥体西']);

        after(dc.clear_ms ?? 600, () => {
          frameJingshiEw(target, problemRoad);
          after(dc.frame_ms ?? 900, () => {
            clearEwLayer();
            ewLayer = createJingshiEwFlowLayer({
              roads,
              originInter: target,
              problemRoad,
              resolution: getResolution?.(),
            });
            runtime.scene.add(ewLayer);
            ewLayer.play(performance.now() / 1000);
            frameJingshiEw(target, problemRoad);
            playPhase = 'arterial';
            annot?.setBeat('arterial');
            hooks.onHud?.({
              phase: 'arterial',
              caption: captionFor(beats, 'arterial', '经十路为通勤主干道，保障东西方向流量'),
              text: captionFor(beats, 'arterial', '经十路为通勤主干道，保障东西方向流量'),
              panel: {
                kind: 'arterial',
                title: '本口',
                approaches: dc.approach_cards || [],
                copy: copyText(dc, 'arterial', '经十路为通勤主干道，保障东西方向流量。'),
              },
            });

            after(beatMs(beats, 'arterial', dc.ew_flow_ms ?? 3200), () => {
              playPhase = 'signal';
              annot?.setBeat('signal');
              hooks.onHud?.({
                phase: 'signal',
                caption: captionFor(beats, 'signal', '经十路主干道优先，周期内无可用绿灯分配给北向南直行'),
                text: captionFor(beats, 'signal', '经十路主干道优先，周期内无可用绿灯分配给北向南直行'),
                panel: {
                  kind: 'signal',
                  title: '绿灯约束',
                  value: '经十路主干道优先',
                  copy: copyText(dc, 'priority', '经十路主干道优先，周期内无可用绿灯时间分配给北向南直行。'),
                },
              });

              after(beatMs(beats, 'signal', dc.signal_ms ?? 2800), () => {
                playPhase = 'overflow';
                ewLayer?.setOverflowHint?.(true);
                annot?.setBeat('overflow');
                frameProblemLink(via, target);
                hooks.onHud?.({
                  phase: 'overflow',
                  caption: captionFor(beats, 'overflow', '经十路和奥体西路北进口车流在短时间内无法快速消散'),
                  text: captionFor(beats, 'overflow', '经十路和奥体西路北进口车流在短时间内无法快速消散'),
                  panel: {
                    kind: 'overflow',
                    title: '溢流风险',
                    queue_m: beats.overflow?.queue_m || 270,
                    copy: copyText(dc, 'overflow', '经十路和奥体西路北进口车流在短时间内无法快速消散。'),
                  },
                });
                after(beatMs(beats, 'overflow', dc.overflow_ms ?? 3600), () => {
                  frameJingshiEw(target, problemRoad);
                  after(dc.frame_ms ?? 900, () => {
                    hooks.onComplete?.();
                  });
                });
              });
            });
          });
        });
      });
    });
  }

  function stop() {
    playing = false;
    clearTimers();
    layer?.stop?.();
    ewLayer?.stop?.();
  }

  function replay() {
    stop();
    play();
  }

  function update(time) {
    layer?.update?.(time);
    ewLayer?.update?.(time);
    if (playPhase === 'trace' && layer && followCtx) {
      const elapsed = layer.getElapsed?.(time) ?? 0;
      annot?.setTraceElapsed?.(elapsed);
      const look = followTraceLook(layer.getProgress?.(time) ?? 0, followCtx.source, followCtx.via, followCtx.target);
      if (look) {
        runtime.animateCamera({
          posTarget: { x: look.x, y: look.y, z: look.z },
          lookTarget: { x: look.x, y: 0, z: look.z },
          lerp: 0.08,
        });
      }
    }
    annot?.update?.(time);
  }

  function setResolution(w, h) {
    layer?.setResolution?.(w, h);
    ewLayer?.setResolution?.(w, h);
  }

  function dispose() {
    disposed = true;
    stop();
    clearLayer();
  }

  return {
    meta: flowTrace.meta,
    flowTrace,
    play,
    replay,
    stop,
    update,
    setResolution,
    dispose,
  };
}

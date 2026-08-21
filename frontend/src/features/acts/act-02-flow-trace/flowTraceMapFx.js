/**
 * 幕 2 · 流量溯源（成因分析）— 地图特效工厂（原生幕）
 *
 * 由 scene2-cause.js（首页分析成因场景）移植而来，供 TrafficOriginScene
 * 在叙事幕模式下直接播放，彻底去掉「切回首页再跳转」的中间态。
 *
 * 演绎时序：坤顺/解放东北东西进口 → 经十路–奥体西北进口 流量溯源，
 * 视觉对齐 baseline 拥堵蔓延的反向（远端先亮，收束到汇点）；
 * 溯源之后：路旁供需钉 → 经十东西向进口钉 → 示意相位环 → 270m 排队溢流。
 *
 * HUD 状态经 setFlowTraceHud 桥接给幕 2 舞台组件（Act2FlowStage）渲染。
 */
import { createInflowTraceLayer } from '../../../layers/inflowTraceLayer.js';
import { createDownstreamFlowTraceLayer } from '../../../layers/downstreamFlowTraceLayer.js';
import { createJingshiEwFlowLayer } from '../../../layers/jingshiEwFlowLayer.js';
import { createRoadNameLabelLayer } from '../../../layers/roadNameLabels.js';
import { createScene2MapAnnot } from '../../../layers/scene2MapAnnot.js';
import { whenBroadcastIdle } from '../../../shared/broadcast-bus.js';
import { setFlowTraceHud } from './state.js';

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
    { name: '经十路', at: 'target', dx: -26, dy: 1 },
    { name: '奥体西路', at: 'problem_mid', dx: -8, dy: 0 },
    { name: '解放东路', at: 'via', dx: 10, dy: 4 },
    { name: '坤顺路', at: 'source', dx: 10, dy: 4 },
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

function headlineFor(beats, key, fallback) {
  return beats?.[key]?.headline || fallback;
}

function beatMs(beats, key, fallback) {
  const n = Number(beats?.[key]?.ms);
  return Number.isFinite(n) ? n : fallback;
}

function frameDownstreamLook(points) {
  if (!points?.length) return null;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const span = Math.max(maxX - minX, maxY - minY, 72);
  return {
    x: cx,
    y: Math.max(210, Math.min(290, span * 2.15)),
    z: -cy,
  };
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

/** 经十×奥体十字为焦点，不要按整段走廊拉远 */
const JINGSHI_EW_CAM_H = 122;

function heightForJingshiEw() {
  return JINGSHI_EW_CAM_H;
}

/**
 * @param {object} runtime
 * @param {{ roads, intersections, topology, getResolution }} mapCtx
 * @param {{ onHud?: Function, onComplete?: Function }} hooks
 */
export async function createFlowTraceMapFx(runtime, mapCtx, hooks = {}) {
  const [flowTrace, causeAnalysis] = await Promise.all([
    fetchJson('/data/1-2-flow-trace.json'),
    fetchJson('/data/1-2-cause-analysis.json'),
  ]);
  const { roads, intersections, topology, getResolution } = mapCtx;

  /** HUD 输出：桥接给舞台组件渲染，同时保留外部 onHud 回调 */
  function emitHud(state) {
    setFlowTraceHud(state);
    hooks.onHud?.(state);
  }
  const hopApproaches = parseApproaches(
    flowTrace?.allowed_approaches || flowTrace?.meta?.approaches,
    { fallback: ['N', 'E', 'W'] },
  );
  const targetApproaches = parseApproaches(
    flowTrace?.target_approach_dirs || flowTrace?.meta?.target_approaches,
    { fallback: ['N'] },
  );

  let layer = null;
  let downstreamLayer = null;
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

  /** 地图最短时长走完后，再等当前口播结束，避免切拍抢断 */
  function waitVoiceThen(fn) {
    const gen = playGen;
    whenBroadcastIdle({
      later: (cb, ms) => after(ms, cb),
      safetyMs: 28_000,
    }).then(() => {
      if (!playing || disposed || gen !== playGen) return;
      fn();
    });
  }

  function afterMapAndVoice(ms, fn) {
    after(ms, () => waitVoiceThen(fn));
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

  function clearDownstreamLayer() {
    if (!downstreamLayer) return;
    runtime.scene.remove(downstreamLayer);
    downstreamLayer.dispose?.();
    downstreamLayer = null;
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
    clearDownstreamLayer();
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

  function frameJingshiEw(targetInter) {
    const [tx, ty] = targetInter?.pos || [];
    if (!Number.isFinite(tx)) return;
    runtime.animateCamera({
      posTarget: { x: tx, y: heightForJingshiEw(), z: -ty },
      lookTarget: { x: tx, y: 0, z: -ty },
      lerp: 0.05,
    });
  }

  function frameDownstream() {
    const look = frameDownstreamLook(downstreamLayer?.lookPath);
    if (!look) return;
    runtime.animateCamera({
      posTarget: { x: look.x, y: look.y, z: look.z },
      lookTarget: { x: look.x, y: 0, z: look.z },
      lerp: 0.06,
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
      emitHud({ phase: 'error', caption: '未找到经十路–奥体西汇点', text: '未找到经十路–奥体西汇点' });
      return;
    }
    if (!source) {
      emitHud({ phase: 'error', caption: '未找到坤顺–奥体西源点', text: '未找到坤顺–奥体西源点' });
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
    const downstreamTraces = causeAnalysis?.downstream_traces?.by_turn?.through || [];
    const upstreamShareDisplay = flowTrace.upstream_share_display || {};
    const fallbackMetrics = causeAnalysis?.jingshi_ew_fallback_metrics || {};
    const eastMetric = fallbackMetrics.east_entrance_E2W || {};
    const westMetric = fallbackMetrics.west_entrance_W2E || {};
    const ewDisplay = dc.metrics || {};
    const arterialMetrics = {
      east: {
        speed: eastMetric.avg_speed_kmh,
        delay: eastMetric.congestion_delay_index,
        saturation: ewDisplay.east_through_saturation ?? 0.76,
        flow: ewDisplay.east_through_flow_pcu_h ?? ewDisplay.east_through_flow_vph ?? 1230,
      },
      west: {
        speed: westMetric.avg_speed_kmh,
        delay: westMetric.congestion_delay_index,
        saturation: ewDisplay.west_through_saturation ?? 0.73,
        flow: ewDisplay.west_through_flow_pcu_h ?? ewDisplay.west_through_flow_vph ?? 1180,
      },
    };
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
      {
        id: source.props.inter_id,
        pos: source.pos,
        revealAt: layer.revealAt?.(source.props.inter_id) ?? 0,
        label: '坤顺',
        shareRatio: upstreamShareDisplay.source_ratio ?? 32.4,
      },
      via
        ? {
          id: via.props.inter_id,
          pos: via.pos,
          revealAt: layer.revealAt?.(via.props.inter_id) ?? 0,
          label: '解放东',
          shareRatio: upstreamShareDisplay.via_ratio ?? 48.1,
        }
        : null,
      { id: target.props.inter_id, pos: target.pos, revealAt: layer.revealAt?.(target.props.inter_id) ?? 0, label: '经十' },
    ].filter(Boolean);

    annot = createScene2MapAnnot({
      via,
      target,
      problemRoad,
      queueM: beats.overflow?.queue_m || 270,
      queueRatio: beats.overflow?.queue_ratio ?? 0.8,
      supplyMetrics: {
        flow: flowTrace.demand_supply?.supply_pcu_h ?? flowTrace.demand_supply?.supply_vph,
        capacity: flowTrace.demand_supply?.demand_pcu_h ?? flowTrace.demand_supply?.demand_vph,
      },
      arterialMetrics,
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

    emitHud({
      phase: 'trace',
      caption: captionFor(beats, 'trace', flowTrace.trace_hint || '正在进行问题路段流量溯源'),
      text: captionFor(beats, 'trace', flowTrace.trace_hint || '正在进行问题路段流量溯源'),
      headline: headlineFor(beats, 'trace', '流量由北向南汇入经十路口'),
      panel: { kind: 'trace', title: '流量溯源' },
    });

    layer.whenFullyRevealed?.().then(() => {
      if (!playing || disposed || gen !== playGen) return;
      waitVoiceThen(() => {
      playPhase = 'supply';
      followCtx = null;
      frameProblemLink(via, target);
      annot?.setBeat('supply');
      const ds = flowTrace.demand_supply || {};
      emitHud({
        phase: 'supply',
        caption: captionFor(beats, 'supply', '当前通行量低于车道能力上限，本段仍有承接余量'),
        text: captionFor(beats, 'supply', '当前通行量低于车道能力上限，本段仍有承接余量'),
        headline: headlineFor(beats, 'supply', '本路段通行能力仍有余量'),
        panel: {
          kind: 'supply',
          title: ds.title || '路段供需核验',
          supply: ds.supply_pcu_h ?? ds.supply_vph,
          demand: ds.demand_pcu_h ?? ds.demand_vph,
          conclusion: ds.conclusion || '当前通行量低于车道能力上限，本段仍有承接余量',
        },
      });

      afterMapAndVoice(beatMs(beats, 'supply', dc.hold_ms ?? 2800), () => {
        clearInflowLayer();
        annot?.setBeat('supply_out');
        after(beatMs(beats, 'supply_clear', beats.supply?.clear_ms ?? 500), () => {
          annot?.setBeat('hidden');
          downstreamLayer = createDownstreamFlowTraceLayer({
            roads,
            intersections,
            topology,
            originId: target.props.inter_id,
            traces: downstreamTraces,
            resolution: getResolution?.(),
          });
          runtime.scene.add(downstreamLayer);
          downstreamLayer.play(performance.now() / 1000);
          frameDownstream();
          playPhase = 'downstream';
          const primaryTrace = downstreamLayer.primaryTrace;
          emitHud({
            phase: 'downstream',
            caption: captionFor(
              beats,
              'downstream',
              '北向南直行车流继续向奥体西路南段汇出，主要关联奥体西路与龙奥北路方向',
            ),
            text: captionFor(
              beats,
              'downstream',
              '北向南直行车流继续向奥体西路南段汇出，主要关联奥体西路与龙奥北路方向',
            ),
            headline: headlineFor(beats, 'downstream', '下游通道具备承接余量'),
            panel: {
              kind: 'downstream',
              title: '下游关联去向',
              destination: primaryTrace?.cor_inter_name || '奥体西路与龙奥北路路口',
              ratio: primaryTrace?.flow_share_ratio ?? 85.33,
              metric: '下游关联占比',
              conclusion: beats.downstream?.conclusion || '下游主通道具备承接余量',
            },
          });

          const downstreamMs = Math.max(
            beatMs(beats, 'downstream', 3200),
            Math.round((downstreamLayer.durationSec || 0) * 1000),
          );
          afterMapAndVoice(downstreamMs, () => {
          clearDownstreamLayer();
          emitHud({
            phase: 'ew_clear',
            caption: '',
            text: '',
          });
          nameLayer?.setVisibleNames?.(dc.keep_road_labels || ['经十路', '奥体西路']);

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
              emitHud({
                phase: 'arterial',
                caption: captionFor(beats, 'arterial', '经十路东西向通行压力突出，信号优先保障主干道通行'),
                text: captionFor(beats, 'arterial', '经十路东西向通行压力突出，信号优先保障主干道通行'),
                headline: headlineFor(beats, 'arterial', '经十路东西向优先保障'),
                panel: {
                  kind: 'arterial',
                  title: '经十路主干道保护',
                  metrics: arterialMetrics,
                  gaps: dc.gaps || [],
                  copy: copyText(dc, 'arterial', '经十路东西向通行压力突出，信号优先保障主干道通行。'),
                },
              });

              afterMapAndVoice(beatMs(beats, 'arterial', dc.ew_flow_ms ?? 3200), () => {
                playPhase = 'signal';
                annot?.setBeat('signal');
                emitHud({
                  phase: 'signal',
                  caption: captionFor(beats, 'signal', '受主干道优先约束，当前周期内难以释放北向南有效绿灯窗口'),
                  text: captionFor(beats, 'signal', '受主干道优先约束，当前周期内难以释放北向南有效绿灯窗口'),
                  headline: headlineFor(beats, 'signal', '北向南难以增配有效绿灯'),
                  panel: {
                    kind: 'signal',
                    title: '绿灯约束',
                    value: '经十路主干道优先',
                    copy: copyText(dc, 'priority', '受主干道优先约束，当前周期内难以再为北向南直行释放有效绿灯窗口。'),
                  },
                });

                afterMapAndVoice(beatMs(beats, 'signal', dc.signal_ms ?? 2800), () => {
                  playPhase = 'overflow';
                  ewLayer?.setOverflowHint?.(true);
                  annot?.setBeat('overflow');
                  frameProblemLink(via, target);
                  emitHud({
                    phase: 'overflow',
                    caption: captionFor(beats, 'overflow', '北向南车流短时难以消散，溢流风险成立'),
                    text: captionFor(beats, 'overflow', '北向南车流短时难以消散，溢流风险成立'),
                    headline: headlineFor(beats, 'overflow', '北向南溢流风险成立'),
                    panel: {
                      kind: 'overflow',
                      title: '溢流风险',
                      queue_m: beats.overflow?.queue_m || 270,
                      queue_ratio: beats.overflow?.queue_ratio ?? 0.8,
                      gaps: beats.overflow?.gaps || [],
                      copy: copyText(dc, 'overflow', '经十路东西向压力与奥体西路北进口排队叠加，北向南车流短时难以消散。'),
                    },
                  });
                  afterMapAndVoice(beatMs(beats, 'overflow', dc.overflow_ms ?? 3600), () => {
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
      });
      });
    });
  }

  function stop() {
    playing = false;
    clearTimers();
    layer?.stop?.();
    downstreamLayer?.stop?.();
    ewLayer?.stop?.();
  }

  function replay() {
    stop();
    play();
  }

  function update(time) {
    layer?.update?.(time);
    downstreamLayer?.update?.(time);
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
    downstreamLayer?.setResolution?.(w, h);
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
    /** 清空图层（保留实例可复用；对应 mapBeat 'clear'） */
    clear() {
      stop();
      clearLayer();
    },
    dispose,
  };
}

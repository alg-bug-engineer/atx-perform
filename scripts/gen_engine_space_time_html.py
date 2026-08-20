#!/usr/bin/env python3
"""把 deepagent 返回的 space-time.json 原样渲染成独立 HTML 时距图。

渲染口径与配色完全对齐引擎工作台
traffic_signal_deepagent/frontend/src/components/CorridorSpaceTimeDiagram.tsx：
- 布局常量（PLOT_W=920 等）与信号条几何（SIGNAL_BAR_LEFT/RIGHT/W）逐值照抄
- 绿窗直接用 diagram.green_windows（coord 绿 / left_feeder 琥珀），不重铺
- 红灯 = 周期内非绿底条；时间轴默认 4 周期（scaleY=1 口径）
- 车辆轨迹按工作台 sampleVehicles(180) 采样 + splitMoveWaitRuns 行驶/等待分段配色
- 队尾、服务端绿波带、图例、KPI 行均按工作台色值

用法：
    python3 scripts/gen_engine_space_time_html.py
    python3 scripts/gen_engine_space_time_html.py \\
        --raw data/deepagent-raw/space-time-dow1-1700-1900.json \\
        --meta data/deepagent-raw/_meta-dow1-1700-1900.json \\
        --out docs/engine-space-time-dow1-1700.html
"""

import argparse
import json
from pathlib import Path
from typing import List, Optional

ROOT = Path(__file__).resolve().parent.parent


def load_data(raw_path: Path, meta_path: Optional[Path], plan_path: Optional[Path]) -> dict:
    raw = json.loads(raw_path.read_text())
    sig = json.loads((ROOT / "data" / "1-3-signal-plan.json").read_text())

    # 路口 id -> 中文名（与工作台 nameMap 同源：task scope intersections）
    name_map = {n["inter_id"]: n.get("short_name") or n["name"] for n in sig.get("nodes", [])}

    # 工作台红绿条/几何带宽带按 coordination.nodes 几何重铺：从 plan-generation 提取
    plan_nodes: Optional[List[dict]] = None
    plan_links: Optional[List[dict]] = None
    if plan_path is not None and plan_path.exists():
        plan = json.loads(plan_path.read_text())
        segs = plan.get("plan", plan).get("segment_plans") or plan.get("segment_plans") or []
        seg = next(
            (s for s in segs if "晚高峰" in str(s.get("segment_key") or "")), None
        )
        if seg is None:
            seg = next(
                (s for s in segs if "晚高峰" in str(s.get("label") or "")), None
            )
        if seg:
            coord = (seg.get("plan") or {}).get("coordination") or {}
            req = seg.get("request") or {}
            plan_nodes = [
                {
                    "off": n.get("main_coordination_offset_s")
                    if n.get("main_coordination_offset_s") is not None
                    else n.get("offset_s"),
                    "green": n.get("coordinated_green_s"),
                    "green_fwd": n.get("coordinated_green_forward_s"),
                    "green_rev": n.get("coordinated_green_reverse_s"),
                }
                for n in coord.get("nodes") or []
            ]
            plan_links = [
                {
                    "dist_m": lnk.get("distance_m"),
                    "fwd_kmh": lnk.get("forward_speed_kmh"),
                    "rev_kmh": lnk.get("reverse_speed_kmh"),
                }
                for lnk in req.get("links") or []
            ]

    dg = raw.get("diagram") or {}
    ev = raw.get("evaluation") or {}
    plan = raw.get("plan") or {}

    def slim_window(w):
        return {
            "node_index": w.get("node_index"),
            "direction": w.get("direction"),
            "role": w.get("role"),
            "start_s": w.get("start_s"),
            "end_s": w.get("end_s"),
        }

    def slim_vehicle(v):
        m = v.get("meta") or {}
        return {
            "direction": v.get("direction"),
            "points": v.get("points"),
            "render": v.get("render") is not False,
            "meta": {
                "depart_s": m.get("depart_s"),
                "depart_phase": m.get("depart_phase"),
                "side_arrival": bool(m.get("side_arrival")),
                "role": m.get("role"),
            },
        }

    def slim_band(b):
        return {
            "direction": b.get("direction"),
            "points": b.get("points"),
            "meta": {"bandwidth_s": (b.get("meta") or {}).get("bandwidth_s"),
                     "cycle_s": (b.get("meta") or {}).get("cycle_s")},
        }

    def slim_tail(q):
        return {
            "kind": q.get("kind"),
            "direction": q.get("direction"),
            "points": q.get("points"),
        }

    dkp = (ev.get("direction_kpis") or [{}])[0]
    meta_file = meta_path if meta_path is not None else (raw_path.parent / "_meta.json")
    meta_extra: dict = {}
    if meta_file.exists():
        meta_raw = json.loads(meta_file.read_text())
        meta_extra = {
            "day_of_week": meta_raw.get("day_of_week"),
            "period_window": meta_raw.get("period_window"),
        }
    return {
        "meta": {
            "operation": raw.get("operation"),
            "pulled_at": meta_file.exists() and (json.loads(meta_file.read_text())).get("pulled_at") or None,
            "raw_windows": len(dg.get("green_windows") or []),
            "raw_vehicles": len(dg.get("vehicles") or []),
            "raw_tails": len(dg.get("queue_tails") or []),
            "raw_bands": len(dg.get("bandwidth_bands") or []),
            **meta_extra,
        },
        "cycle_s": float(plan.get("cycle_s") or 220),
        "cum_distance_m": dg.get("cum_distance_m"),
        "names": [name_map.get(i, i) for i in
                  sorted({w["intersection_id"] for w in dg.get("green_windows") or []},
                         key=lambda x: next((w["node_index"] for w in dg["green_windows"] if w["intersection_id"] == x), 9))],
        "green_windows": [slim_window(w) for w in dg.get("green_windows") or []],
        "bandwidth_bands": [slim_band(b) for b in dg.get("bandwidth_bands") or []],
        "vehicles": [slim_vehicle(v) for v in dg.get("vehicles") or []],
        "queue_tails": [slim_tail(q) for q in dg.get("queue_tails") or []],
        "plan_nodes": plan_nodes,
        "plan_links": plan_links,
        "kpis": {
            "mean_delay_s": ev.get("mean_delay_s", dkp.get("mean_delay_s")),
            "stop_rate": ev.get("stop_rate", dkp.get("stop_rate")),
            "chained_fwd_s": ev.get("chained_bandwidth_forward_s"),
            "chained_rev_s": ev.get("chained_bandwidth_reverse_s"),
        },
    }


HTML_TPL = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>绿波时距图 · 引擎原样数据（space-time.json）</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px; background: #f1f5f9;
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    color: #0f172a;
  }
  .card {
    max-width: 1060px; margin: 0 auto; background: #fff;
    border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px 20px 20px;
  }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .muted { color: #64748b; font-size: 12px; }
  .kpis { display: flex; gap: 10px; margin: 12px 0; flex-wrap: wrap; }
  .kpi {
    flex: 1 1 150px; border: 1px solid #e2e8f0; border-radius: 8px;
    padding: 8px 12px; background: #f8fafc;
  }
  .kpi span { display: block; font-size: 12px; color: #64748b; }
  .kpi strong { font-size: 18px; color: #0f172a; }
  svg { display: block; width: 100%; height: auto; border: 1px solid #e2e8f0; border-radius: 8px; }
  .summary { margin-top: 14px; border-top: 1px dashed #e2e8f0; padding-top: 10px; }
  .summary h2 { font-size: 13px; margin: 6px 0; color: #334155; }
  table { border-collapse: collapse; font-size: 12px; width: 100%; }
  th, td { border: 1px solid #e2e8f0; padding: 4px 8px; text-align: left; }
  th { background: #f8fafc; color: #475569; }
  .num { font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
<div class="card">
  <h1>绿波时距图 · 引擎原样数据</h1>
  <div class="muted">数据源 <span class="num">data/deepagent-raw/space-time.json</span>
    · operation=<span id="m-op" class="num"></span>
    · 拉取于 <span id="m-time" class="num"></span>
    · <span id="m-ctx" class="num"></span><br>
    渲染口径与配色完全对齐引擎工作台 <span class="num">CorridorSpaceTimeDiagram.tsx</span>（白底、4 周期、轨迹采样上限 180、绿窗直接用 diagram.green_windows）</div>
  <div class="kpis">
    <div class="kpi"><span>延误（direction_kpis[0]）</span><strong id="k-delay">—</strong></div>
    <div class="kpi"><span>停车率</span><strong id="k-stop">—</strong></div>
    <div class="kpi"><span>正向链式带宽</span><strong id="k-fwd">—</strong></div>
    <div class="kpi"><span>反向链式带宽</span><strong id="k-rev">—</strong></div>
  </div>
  <svg id="svg" viewBox="0 0 920 520" preserveAspectRatio="xMidYMid meet" role="img" aria-label="干线绿波时距图"></svg>
  <div class="summary">
    <h2>引擎返回数据摘要（比对用）</h2>
    <table>
      <tr><th>路口</th><th>里程 m</th><th>相位差 s</th><th>工作台重铺绿时 fwd / rev（s）</th></tr>
      <tbody id="tbl-nodes"></tbody>
      <tr><td colspan="4">green_windows 原始 <span id="s-win" class="num"></span> 个（coord <span id="s-win-coord" class="num"></span> / left_feeder <span id="s-win-feed" class="num"></span>，t 范围 <span id="s-win-t" class="num"></span> s）</td></tr>
      <tr><td colspan="4">vehicles 原始 <span id="s-veh" class="num"></span> 条（fwd <span id="s-veh-f" class="num"></span> / rev <span id="s-veh-r" class="num"></span>，图上采样显示 <span id="s-veh-s" class="num"></span> 条）</td></tr>
      <tr><td colspan="4">queue_tails <span id="s-qt" class="num"></span> 条 · bandwidth_bands <span id="s-bb" class="num"></span> 条（<span id="s-bb-meta" class="num"></span>）</td></tr>
    </table>
  </div>
</div>
<script>
const DATA = __DATA__;

/* ============ 常量与算法逐值照抄工作台 CorridorSpaceTimeDiagram.tsx ============ */
const PLOT_W = 920, PLOT_H = 520, PAD_L = 64, PAD_R = 24, PAD_T = 36, PAD_B = 42;
const SIGNAL_BAR_W = 8, SIGNAL_BAR_LEFT = -12, SIGNAL_BAR_RIGHT = 4;
const FWD_STOP_DX = SIGNAL_BAR_LEFT + SIGNAL_BAR_W / 2;  /* -8 */
const REV_STOP_DX = SIGNAL_BAR_RIGHT + SIGNAL_BAR_W / 2; /* +8 */
const ST_MAX_VEH = 180;

const x0 = PAD_L, x1 = PLOT_W - PAD_R, y0 = PAD_T, y1 = PLOT_H - PAD_B;
const plotW = x1 - x0, plotH = y1 - y0;
const C = DATA.cycle_s;
const pxPerS = plotH / (C * 4);        /* scaleY=1 => cyclesExact=4 */
const tVisSpan = C * 4;
const xMax = DATA.cum_distance_m[DATA.cum_distance_m.length - 1] || 1;
const pxPerM = plotW / xMax;

const sx = (d) => x0 + d * pxPerM;
const sy = (t) => y1 - t * pxPerS;
const clipY = (t) => Math.min(y1, Math.max(y0, sy(t)));
const barRect = (a, b) => {
  const yy0 = clipY(b), yy1 = clipY(a);
  return { y: Math.min(yy0, yy1), h: Math.max(1, Math.abs(yy1 - yy0)) };
};
const pathFromPoints = (pts, laneDx) => {
  if (!pts || pts.length < 2) return '';
  return pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${(sx(p[1]) + laneDx).toFixed(2)} ${sy(p[0]).toFixed(2)}`).join(' ');
};
const splitMoveWaitRuns = (pts) => {
  const moveRuns = [], waitRuns = [];
  let cur = null;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i], p1 = pts[i + 1];
    const dt = p1[0] - p0[0], dx = Math.abs(p1[1] - p0[1]);
    const isWait = dx < 0.5 && dt > 0.5;
    if (!cur || cur.wait !== isWait) {
      cur = { wait: isWait, pts: [p0, p1] };
      (isWait ? waitRuns : moveRuns).push(cur);
    } else cur.pts.push(p1);
  }
  return { moveRuns, waitRuns };
};
function sampleVehicles(list, maxN, cycleS) {
  const flt = list.filter((v) => v.render !== false && (v.points || []).length >= 2);
  if (flt.length <= maxN) return flt;
  const Cc = Math.max(1e-6, cycleS || 90);
  const buckets = new Map();
  flt.forEach((v) => {
    const t0 = Number(v.meta && v.meta.depart_s != null ? v.meta.depart_s : (v.points[0] ? v.points[0][0] : 0));
    const k = Number.isFinite(t0) ? Math.max(0, Math.floor(t0 / Cc)) : 0;
    const arr = buckets.get(k) ?? [];
    arr.push(v); buckets.set(k, arr);
  });
  const keys = Array.from(buckets.keys()).sort((a, b) => a - b);
  const per = Math.max(1, Math.floor(maxN / Math.max(keys.length, 1)));
  const picked = [];
  keys.forEach((k) => {
    const arr = buckets.get(k) || [];
    const step = Math.max(1, Math.ceil(arr.length / per));
    for (let i = 0; i < arr.length && picked.length < maxN; i += step) picked.push(arr[i]);
  });
  return picked;
}

/* ============ 工作台几何重铺：红绿灯条 + 重叠梯形带宽带 ============ */
function normalizeTime(t, cycle) {
  const Cc = Math.max(1e-6, cycle);
  return (((Number(t) || 0) % Cc) + Cc) % Cc;
}
function greenSegments(offset, green, cycle) {
  const Cc = cycle;
  const o = normalizeTime(offset, Cc);
  const g = Math.min(green, Cc);
  if (g <= 0) return [];
  if (o + g <= Cc) return [[o, o + g]];
  return [[o, Cc], [0, o + g - Cc]];
}
function redSegments(offset, green, cycle) {
  const gSegs = greenSegments(offset, green, cycle).sort((a, b) => a[0] - b[0]);
  if (!gSegs.length) return [[0, cycle]];
  const rSegs = [];
  let t = 0;
  gSegs.forEach(([a, b]) => {
    if (a > t) rSegs.push([t, a]);
    t = Math.max(t, b);
  });
  if (t < cycle) rSegs.push([t, cycle]);
  return rSegs;
}
function repeatedSegmentsInRange(base, cycle, tMin, tMax) {
  const Cc = Math.max(1e-6, cycle);
  const k0 = Math.floor(tMin / Cc) - 1;
  const k1 = Math.ceil(tMax / Cc) + 1;
  const out = [];
  for (let k = k0; k <= k1; k += 1) {
    base.forEach(([a, b]) => {
      const aa = a + k * Cc;
      const bb = b + k * Cc;
      if (bb <= tMin || aa >= tMax) return;
      out.push([Math.max(aa, tMin), Math.min(bb, tMax)]);
    });
  }
  return out;
}
function travelTimeS(distanceM, speedKmh) {
  const v = Math.max(0.1, Number(speedKmh) || 40);
  return distanceM / (v / 3.6);
}
function repeatedSegments(base, cycle, cyclesToShow, fromK) {
  const out = [];
  for (let k = fromK; k < cyclesToShow; k += 1) {
    base.forEach(([a, b]) => out.push([a + k * cycle, b + k * cycle]));
  }
  return out;
}
function collectOverlapBands(nodes, dists, cum, cycleS, designSpeed, links, cyclesToShow, tVisEnd, sxLane, reverse) {
  const bands = [];
  const repeatedGreenExtended = (offset, green) => {
    const base = greenSegments(offset, green, cycleS);
    return repeatedSegments(base, cycleS, cyclesToShow + 1, -1);
  };
  const linkSpeed = (i) => {
    const link = links[i];
    if (!link) return designSpeed;
    if (reverse && link.rev_kmh != null) return Number(link.rev_kmh) || designSpeed;
    return Number(link.fwd_kmh ?? designSpeed) || designSpeed;
  };
  if (!reverse) {
    for (let i = 0; i < nodes.length - 1; i += 1) {
      const left = nodes[i];
      const right = nodes[i + 1];
      const travel = travelTimeS(dists[i], linkSpeed(i));
      const leftSegs = repeatedGreenExtended(left.off, left.gFwd);
      const rightSegs = repeatedGreenExtended(right.off, right.gFwd);
      leftSegs.forEach(([la, lb]) => {
        rightSegs.forEach(([ra, rb]) => {
          const overlapStart = Math.max(la, ra - travel);
          const overlapEnd = Math.min(lb, rb - travel);
          if (overlapEnd <= overlapStart) return;
          if (overlapEnd < 0 || overlapStart > tVisEnd) return;
          bands.push({ xStart: sxLane(cum[i]), xEnd: sxLane(cum[i + 1]), start: overlapStart, end: overlapEnd, travel });
        });
      });
    }
  } else {
    for (let i = nodes.length - 1; i > 0; i -= 1) {
      const right = nodes[i];
      const left = nodes[i - 1];
      const linkIdx = i - 1;
      const travel = travelTimeS(dists[linkIdx], linkSpeed(linkIdx));
      const rightSegs = repeatedGreenExtended(right.off, right.gRev);
      const leftSegs = repeatedGreenExtended(left.off, left.gRev);
      rightSegs.forEach(([ra, rb]) => {
        leftSegs.forEach(([la, lb]) => {
          const overlapStart = Math.max(ra, la - travel);
          const overlapEnd = Math.min(rb, lb - travel);
          if (overlapEnd <= overlapStart) return;
          if (overlapEnd < 0 || overlapStart > tVisEnd) return;
          bands.push({ xStart: sxLane(cum[i]), xEnd: sxLane(cum[i - 1]), start: overlapStart, end: overlapEnd, travel });
        });
      });
    }
  }
  return bands;
}
const sxFwd = (d) => sx(d) + FWD_STOP_DX;
const sxRev = (d) => sx(d) + REV_STOP_DX;
const polygonOf = (band) => [
  [band.xStart, sy(band.start)],
  [band.xEnd, sy(band.start + band.travel)],
  [band.xEnd, sy(band.end + band.travel)],
  [band.xStart, sy(band.end)],
].map((p) => `${p[0]},${p[1]}`).join(' ');

/* ============ 图元组装（颜色全部照抄工作台） ============ */
const SVG_NS = 'http://www.w3.org/2000/svg';
const svg = document.getElementById('svg');
const el = (tag, attrs) => {
  const n = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};

/* 背景与坐标轴 */
svg.appendChild(el('rect', { x: 0, y: 0, width: PLOT_W, height: PLOT_H, fill: '#ffffff' }));
svg.appendChild(el('line', { x1: x0, y1: y1, x2: x1, y2: y1, stroke: '#cbd5e1' }));
svg.appendChild(el('line', { x1: x0, y1: y0, x2: x0, y2: y1, stroke: '#cbd5e1' }));
{
  const t = el('text', { x: (x0 + x1) / 2, y: PLOT_H - 10, textAnchor: 'middle', fontSize: 11, fill: '#64748b' });
  t.textContent = '距离 / 路口位置（米）'; svg.appendChild(t);
}
{
  const t = el('text', { transform: `rotate(-90 14 ${(y0 + y1) / 2})`, x: 14, y: (y0 + y1) / 2, textAnchor: 'middle', fontSize: 11, fill: '#64748b' });
  t.textContent = '时间（秒，自下而上）'; svg.appendChild(t);
}

/* 周期网格与刻度 */
for (let t = 0; t <= tVisSpan + 1e-6; t += C) {
  const yy = sy(t);
  if (yy < y0 - 1 || yy > y1 + 1) continue;
  svg.appendChild(el('line', { x1: x0, y1: yy, x2: x1, y2: yy, stroke: '#e2e8f0', strokeDasharray: '4 3' }));
  const tx = el('text', { x: x0 - 8, y: yy + 4, textAnchor: 'end', fontSize: 10, fill: '#475569' });
  tx.textContent = String(t); svg.appendChild(tx);
}

/* 裁剪区：绘图主体 */
const clipId = 'st-plot-clip';
const defs = el('defs');
defs.appendChild(el('clipPath', { id: clipId }));
defs.firstChild.appendChild(el('rect', { x: x0, y: y0, width: plotW, height: plotH }));
svg.appendChild(defs);
const clipG = el('g', { clipPath: `url(#${clipId})` });
svg.appendChild(clipG);

/* 路口竖线 + 红绿灯条：与工作台一致，按 coordination.nodes 几何重铺 */
const hasPlan = Array.isArray(DATA.plan_nodes) && DATA.plan_nodes.length === DATA.cum_distance_m.length;
const planViews = hasPlan ? DATA.plan_nodes.map((n) => {
  const off = Number(n.off != null ? n.off : 0);
  const gFwdNum = Number(n.green_fwd);
  const gRevNum = Number(n.green_rev);
  return {
    off,
    gFwd: Number.isFinite(gFwdNum) && gFwdNum > 0 ? gFwdNum : Number(n.green || 0),
    gRev: Number.isFinite(gRevNum) && gRevNum > 0 ? gRevNum : Number(n.green || 0),
  };
}) : [];
DATA.cum_distance_m.forEach((x, i) => {
  const xx = sx(x);
  const line = el('line', { x1: xx, y1: y0, x2: xx, y2: y1, stroke: '#cbd5e1', strokeDasharray: '4 4' });
  clipG.appendChild(line);
  if (hasPlan) {
    const pv = planViews[i];
    const fwdRed = repeatedSegmentsInRange(redSegments(pv.off, pv.gFwd, C), C, 0, tVisSpan);
    const revRed = repeatedSegmentsInRange(redSegments(pv.off, pv.gRev, C), C, 0, tVisSpan);
    const fwdGreen = repeatedSegmentsInRange(greenSegments(pv.off, pv.gFwd, C), C, 0, tVisSpan);
    const revGreen = repeatedSegmentsInRange(greenSegments(pv.off, pv.gRev, C), C, 0, tVisSpan);
    for (const [a, b] of fwdRed) {
      const r = barRect(a, b);
      clipG.appendChild(el('rect', { x: xx + SIGNAL_BAR_LEFT, y: r.y, width: SIGNAL_BAR_W, height: r.h, fill: 'rgba(239,68,68,.55)', rx: 1 }));
    }
    for (const [a, b] of revRed) {
      const r = barRect(a, b);
      clipG.appendChild(el('rect', { x: xx + SIGNAL_BAR_RIGHT, y: r.y, width: SIGNAL_BAR_W, height: r.h, fill: 'rgba(220,38,38,.45)', rx: 1 }));
    }
    for (const [a, b] of fwdGreen) {
      const r = barRect(a, b);
      clipG.appendChild(el('rect', { x: xx + SIGNAL_BAR_LEFT, y: r.y, width: SIGNAL_BAR_W, height: r.h, fill: 'rgba(34,197,94,.88)', rx: 1 }));
    }
    for (const [a, b] of revGreen) {
      const r = barRect(a, b);
      clipG.appendChild(el('rect', { x: xx + SIGNAL_BAR_RIGHT, y: r.y, width: SIGNAL_BAR_W, height: r.h, fill: 'rgba(21,128,61,.72)', rx: 1 }));
    }
  } else {
    /* 无 coordination 数据回退：全条红底，绿窗由 diagram 窗盖上 */
    clipG.appendChild(el('rect', { x: xx + SIGNAL_BAR_LEFT, y: y0, width: SIGNAL_BAR_W, height: plotH, fill: 'rgba(239,68,68,.55)', rx: 1 }));
    clipG.appendChild(el('rect', { x: xx + SIGNAL_BAR_RIGHT, y: y0, width: SIGNAL_BAR_W, height: plotH, fill: 'rgba(220,38,38,.45)', rx: 1 }));
  }
  /* 路口名（上下两处，同工作台） */
  const name = (DATA.names[i] || `N${i + 1}`);
  const label = name.length > 10 ? `${name.slice(0, 9)}…` : name;
  const up = el('text', { x: xx, y: y0 - 10, textAnchor: 'middle', fontSize: 11, fontWeight: 600, fill: '#1e293b' });
  up.textContent = label; svg.appendChild(up);
  const dn = el('text', { x: xx, y: y1 + 16, textAnchor: 'middle', fontSize: 10, fill: '#334155' });
  dn.textContent = label; svg.appendChild(dn);
});

/* 左转喂流窗：diagram.green_windows（工作台同源，无 plan 时 coord 窗也由此回退） */
for (const w of DATA.green_windows) {
  const xx = sx(DATA.cum_distance_m[w.node_index ?? 0] || 0);
  const r = barRect(Number(w.start_s), Number(w.end_s));
  if (w.role === 'left_feeder') {
    /* 左转喂流窗：琥珀，宽 6，同工作台 feederWindows */
    clipG.appendChild(el('rect', { x: xx + SIGNAL_BAR_LEFT, y: r.y, width: 6, height: r.h, fill: 'rgba(251,191,36,.55)', rx: 1 }));
  } else if (w.role === 'coord' && !hasPlan) {
    const fwd = w.direction !== 'reverse';
    clipG.appendChild(el('rect', {
      x: xx + (fwd ? SIGNAL_BAR_LEFT : SIGNAL_BAR_RIGHT), y: r.y, width: SIGNAL_BAR_W, height: r.h,
      fill: fwd ? 'rgba(34,197,94,.88)' : 'rgba(21,128,61,.72)', rx: 1,
    }));
  }
}

/* 绿波带：与工作台一致，几何重叠梯形带优先；几何带为空才回退服务端带宽带 */
if (hasPlan) {
  const dists = DATA.cum_distance_m.slice(0, -1).map((_, i) =>
    Math.max(0, (DATA.cum_distance_m[i + 1] || 0) - (DATA.cum_distance_m[i] || 0)));
  const designSpeed = 40;
  const fwdBands = collectOverlapBands(
    planViews, dists, DATA.cum_distance_m, C, designSpeed, DATA.plan_links || [], 4, tVisSpan, sxFwd, false);
  const revBands = collectOverlapBands(
    planViews, dists, DATA.cum_distance_m, C, designSpeed, DATA.plan_links || [], 4, tVisSpan, sxRev, true);
  if (!fwdBands.length && !revBands.length) {
    for (const b of DATA.bandwidth_bands) {
      const laneDx = b.direction === 'reverse' ? REV_STOP_DX : FWD_STOP_DX;
      clipG.appendChild(el('path', {
        d: pathFromPoints(b.points, laneDx), fill: 'none',
        stroke: b.direction === 'reverse' ? 'rgba(56,189,248,.55)' : 'rgba(74,222,128,.55)',
        strokeWidth: 2.5,
      }));
    }
  } else {
    for (const band of fwdBands) {
      clipG.appendChild(el('polygon', {
        points: polygonOf(band), fill: 'rgba(74, 222, 128, .48)', stroke: 'rgba(22, 163, 74, .9)', strokeWidth: 1,
      }));
    }
    for (const band of revBands) {
      clipG.appendChild(el('polygon', {
        points: polygonOf(band), fill: 'rgba(22, 163, 74, .22)', stroke: 'rgba(21, 128, 61, .85)',
        strokeWidth: 1, strokeDasharray: '5 4',
      }));
    }
  }
} else {
  for (const b of DATA.bandwidth_bands) {
    const laneDx = b.direction === 'reverse' ? REV_STOP_DX : FWD_STOP_DX;
    clipG.appendChild(el('path', {
      d: pathFromPoints(b.points, laneDx), fill: 'none',
      stroke: b.direction === 'reverse' ? 'rgba(56,189,248,.55)' : 'rgba(74,222,128,.55)',
      strokeWidth: 2.5,
    }));
  }
}

/* 排队尾部 */
for (const q of DATA.queue_tails) {
  const isGrowth = q.kind === 'queue_growth';
  const laneDx = q.direction === 'reverse' ? REV_STOP_DX : FWD_STOP_DX;
  clipG.appendChild(el('path', {
    d: pathFromPoints(q.points, laneDx), fill: 'none',
    stroke: isGrowth ? 'rgba(249,115,22,.75)' : 'rgba(234,88,12,.85)',
    strokeWidth: isGrowth ? 1.4 : 1.8,
    strokeDasharray: isGrowth ? '2 3' : '4 3', strokeLinejoin: 'round',
  }));
}

/* 车辆轨迹：采样 + 行驶/等待分段配色 */
const shownVehicles = sampleVehicles(DATA.vehicles, ST_MAX_VEH, C);
for (const v of shownVehicles) {
  const meta = { ...(v.meta || {}), direction: v.direction || (v.meta && v.meta.direction) || 'forward' };
  const isRedDepart = meta.depart_phase === 'red' || !!meta.side_arrival;
  const isFeeder = meta.role === 'left_feeder';
  const laneDx = meta.direction === 'reverse' ? REV_STOP_DX : FWD_STOP_DX;
  const { moveRuns, waitRuns } = splitMoveWaitRuns(v.points || []);
  for (const run of moveRuns) {
    let stroke = isRedDepart ? 'rgba(252,165,165,.9)' : 'rgba(22,163,74,.75)';
    if (isFeeder) stroke = 'rgba(251,191,36,.85)';
    if (meta.direction === 'reverse' && !isFeeder && !isRedDepart) stroke = 'rgba(56,189,248,.8)';
    clipG.appendChild(el('path', {
      d: pathFromPoints(run.pts, laneDx), fill: 'none', stroke,
      strokeWidth: isRedDepart || isFeeder ? 1.35 : 1.15, strokeLinejoin: 'round', strokeLinecap: 'round',
    }));
  }
  for (const run of waitRuns) {
    let stroke = isRedDepart ? 'rgba(248,113,113,.98)' : 'rgba(185,28,28,.98)';
    if (isFeeder) stroke = 'rgba(234,88,12,.95)';
    const waitDx = laneDx + (meta.direction === 'reverse' ? 3 : -3);
    clipG.appendChild(el('path', {
      d: pathFromPoints(run.pts, waitDx), fill: 'none', stroke,
      strokeWidth: 3, strokeLinejoin: 'round', strokeLinecap: 'round',
    }));
  }
}

/* 图例（照抄工作台） */
{
  const lg = el('g', {});
  lg.appendChild(el('rect', { x: x1 - 268, y: y0 + 4, width: 264, height: 44, rx: 5, fill: 'rgba(255,255,255,.94)', stroke: '#e2e8f0' }));
  lg.appendChild(el('line', { x1: x1 - 256, y1: y0 + 20, x2: x1 - 236, y2: y0 + 20, stroke: 'rgba(22,163,74,.9)', strokeWidth: 2.2 }));
  const t1 = el('text', { x: x1 - 232, y: y0 + 24, fontSize: 11, fill: '#166534' }); t1.textContent = '行驶'; lg.appendChild(t1);
  lg.appendChild(el('line', { x1: x1 - 196, y1: y0 + 20, x2: x1 - 176, y2: y0 + 20, stroke: 'rgba(185,28,28,.95)', strokeWidth: 3 }));
  const t2 = el('text', { x: x1 - 172, y: y0 + 24, fontSize: 11, fill: '#b91c1c' }); t2.textContent = '红等/排队'; lg.appendChild(t2);
  lg.appendChild(el('line', { x1: x1 - 92, y1: y0 + 20, x2: x1 - 72, y2: y0 + 20, stroke: 'rgba(234,88,12,.85)', strokeWidth: 1.8, strokeDasharray: '4 2' }));
  const t3 = el('text', { x: x1 - 68, y: y0 + 24, fontSize: 11, fill: '#c2410c' }); t3.textContent = '队尾'; lg.appendChild(t3);
  const t4 = el('text', { x: x1 - 256, y: y0 + 40, fontSize: 10, fill: '#64748b' });
  t4.textContent = '绿窗=协调相位 · 琥珀=左转喂流 · 数据为引擎原样返回'; lg.appendChild(t4);
  svg.appendChild(lg);
}

/* ============ 头部 KPI 与摘要表 ============ */
const fmt = (v, d = 1) => (v == null || v === '' || !Number.isFinite(Number(v))) ? '—' : Number(v).toFixed(d);
document.getElementById('m-op').textContent = DATA.meta.operation || 'evaluate';
document.getElementById('m-time').textContent = DATA.meta.pulled_at || '—';
{
  const dow = DATA.meta.day_of_week;
  const win = DATA.meta.period_window;
  const week = {1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日'};
  document.getElementById('m-ctx').textContent = [
    dow != null ? `${week[dow] || '周' + dow}` : '未指定星期',
    win ? `时段 ${win}` : '未指定时段',
  ].join(' · ');
}
document.getElementById('k-delay').textContent = fmt(DATA.kpis.mean_delay_s);
document.getElementById('k-stop').textContent = fmt(DATA.kpis.stop_rate, 2);
document.getElementById('k-fwd').textContent = fmt(DATA.kpis.chained_fwd_s) + ' s';
document.getElementById('k-rev').textContent = fmt(DATA.kpis.chained_rev_s) + ' s';

const tbody = document.getElementById('tbl-nodes');
DATA.cum_distance_m.forEach((m, i) => {
  const name = DATA.names[i] || 'N' + (i + 1);
  const tr = document.createElement('tr');
  if (hasPlan) {
    const pv = planViews[i];
    tr.innerHTML = `<td>${name}</td><td class="num">${m}</td><td class="num">${pv.off}</td><td class="num">${pv.gFwd} / ${pv.gRev}</td>`;
  } else {
    const c0 = DATA.green_windows.filter((w) => w.node_index === i && w.role === 'coord');
    const pick = (dir) => {
      const w = c0.find((x) => x.direction === dir);
      if (!w) return '—';
      return `${Number(w.start_s).toFixed(0)}..${Number(w.end_s).toFixed(0)} s（绿 ${(w.end_s - w.start_s).toFixed(0)} s）`;
    };
    tr.innerHTML = `<td>${name}</td><td class="num">${m}</td><td class="num">—</td><td class="num">${pick('forward')} / ${pick('reverse')}</td>`;
  }
  tbody.appendChild(tr);
});
{
  const ws = DATA.green_windows;
  const tmin = Math.min(...ws.map((w) => w.start_s)), tmax = Math.max(...ws.map((w) => w.end_s));
  document.getElementById('s-win').textContent = String(ws.length);
  document.getElementById('s-win-coord').textContent = String(ws.filter((w) => w.role === 'coord').length);
  document.getElementById('s-win-feed').textContent = String(ws.filter((w) => w.role === 'left_feeder').length);
  document.getElementById('s-win-t').textContent = `${tmin.toFixed(0)}..${tmax.toFixed(0)}`;
  document.getElementById('s-veh').textContent = String(DATA.vehicles.length);
  document.getElementById('s-veh-f').textContent = String(DATA.vehicles.filter((v) => v.direction === 'forward').length);
  document.getElementById('s-veh-r').textContent = String(DATA.vehicles.filter((v) => v.direction === 'reverse').length);
  document.getElementById('s-veh-s').textContent = String(shownVehicles.length);
  document.getElementById('s-qt').textContent = String(DATA.queue_tails.length);
  document.getElementById('s-bb').textContent = String(DATA.bandwidth_bands.length);
  document.getElementById('s-bb-meta').textContent = DATA.bandwidth_bands
    .map((b) => `${b.direction} ${fmt(b.meta.bandwidth_s)} s`).join(' / ');
}
</script>
</body>
</html>
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--raw",
        default=str(ROOT / "data" / "deepagent-raw" / "space-time.json"),
        help="space-time 原始响应路径",
    )
    parser.add_argument(
        "--meta",
        default=None,
        help="_meta.json 路径（默认与 --raw 同目录的 _meta.json）",
    )
    parser.add_argument(
        "--out",
        default=str(ROOT / "docs" / "engine-space-time.html"),
        help="输出 HTML 路径",
    )
    parser.add_argument(
        "--plan",
        default=None,
        help="plan-generation 响应路径：提取 coordination.nodes 与 links，"
        "红绿条/几何带宽带按工作台同款几何重铺（不传则仅用 diagram 数据）",
    )
    args = parser.parse_args()
    raw_path = Path(args.raw)
    meta_path = Path(args.meta) if args.meta else None
    out_path = Path(args.out)
    plan_path = Path(args.plan) if args.plan else None

    data = load_data(raw_path, meta_path, plan_path)
    html = HTML_TPL.replace("__DATA__", json.dumps(data, ensure_ascii=False))
    out_path.write_text(html)
    print(f"generated {out_path} ({out_path.stat().st_size / 1024:.1f} KB)")
    print(f"  windows={data['meta']['raw_windows']} vehicles={data['meta']['raw_vehicles']} "
          f"tails={data['meta']['raw_tails']} bands={data['meta']['raw_bands']} "
          f"names={data['names']}")
    if data["meta"].get("day_of_week") is not None:
        print(f"  day_of_week={data['meta']['day_of_week']} period_window={data['meta'].get('period_window')}")
    if data.get("plan_nodes"):
        print(f"  plan_nodes={len(data['plan_nodes'])} plan_links={len(data.get('plan_links') or [])} (工作台几何重铺)")


if __name__ == "__main__":
    main()

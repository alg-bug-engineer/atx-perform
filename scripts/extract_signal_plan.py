#!/usr/bin/env python3
"""把工作台权威方案蒸馏成幕「信控方案调节」用的 data/1-3-signal-plan.json。

输入：data/deepagent-raw/plan-generation.json（gitignore，见 scripts/pull_deepagent_plan.py）
输出：data/1-3-signal-plan.json（入库）

只接受 ``sync_workbench_signal_plan.py`` 写入且通过指纹校验的数据，禁止直接 API 重跑
结果覆盖工作台口径。保留公共周期 / 相位差 / 阶段配时 / 时距图 / KPI 与回归告警。
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "deepagent-raw" / "plan-generation.json"
ST = ROOT / "data" / "deepagent-raw" / "space-time.json"
OUT = ROOT / "data" / "1-3-signal-plan.json"

DEFAULT_SEGMENT_KEY = "opt-5:早高峰"
# road9.dim_line_inter_rltn，line_id=wwe2bswwwe23pb01 的累计里程
CUM_LENGTH_M = {
    "011wwe28vhw00001": 4464.7,
    "011wwe28usb00001": 4843.5,
    "011wwe28gvj00001": 5208.1,
    "011wwe28gm900001": 5585.3,
    "011wwe28fty00001": 5942.6,
    "011wwe28fmc00001": 6158.7,
    "011wwe28ctu00001": 6527.9,
}
FOCUS = ["011wwe28fmc00001", "011wwe28ctu00001"]
STRATEGY_CN = {
    "bidirectional_queue": "双向绿波 · 排队优先",
    "oneway_forward": "正向单向绿波（北向南）",
    "oneway_reverse": "反向单向绿波（南向北）",
    "bidirectional": "双向绿波",
}
SHORT_NAME = {
    "011wwe28vhw00001": "工业南路",
    "011wwe28usb00001": "天辰路",
    "011wwe28gvj00001": "新泺大街",
    "011wwe28gm900001": "安成街",
    "011wwe28fty00001": "坤顺路",
    "011wwe28fmc00001": "解放东路",
    "011wwe28ctu00001": "经十路",
}


def r1(x: Any) -> Any:
    return round(float(x), 1) if isinstance(x, (int, float)) else x


def cn_label(text: str) -> str:
    """把候选方案里的英文策略标识换成中文，前端不出现内部枚举名。"""
    out = str(text or "")
    for token, cn in STRATEGY_CN.items():
        out = out.replace(token, cn)
    return out


def atoms(stage: dict[str, Any]) -> list[str]:
    """阶段放行的机动车流向原子，行人不进条带标注。"""
    out: list[str] = []
    for d in stage.get("phaseDirInfoDTOList") or []:
        name = str(d.get("signalAtom") or "").strip()
        if name and name not in out:
            out.append(name)
    return out


def movements(stage: dict[str, Any]) -> list[dict[str, int]]:
    """渠化示意所需的放行流向：dir8 为进口方位，turn 为 0 掉头 /1 左 /2 直 /3 右。"""
    out: list[dict[str, int]] = []
    for d in stage.get("phaseDirInfoDTOList") or []:
        dir8 = d.get("dir8No")
        turn = d.get("turnDirNo")
        if dir8 is None or turn is None:
            continue
        row = {"dir8": int(dir8), "turn": int(turn)}
        if row not in out:
            out.append(row)
    return out


def baseline_stages(node: dict[str, Any]) -> list[dict[str, Any]]:
    rows = []
    for s in node.get("stages") or []:
        green = float(s.get("green_s") or 0)
        yellow = float(s.get("yellow_s") or 0)
        red = float(s.get("all_red_s") or 0)
        rows.append(
            {
                "stage_no": str(s.get("stage_no")),
                "name": s.get("phaseStageName"),
                "green_s": r1(green),
                "yellow_s": r1(yellow),
                "all_red_s": r1(red),
                "total_s": r1(green + yellow + red),
                "atoms": atoms(s),
                "movements": movements(s),
            }
        )
    return rows


def optimized_stages(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """viewer_payload 口径：greenTime 是阶段总时长，splitTime 才是有效绿。"""
    rows = []
    for s in payload.get("phaseStageTimingList") or []:
        total = float(s.get("greenTime") or 0)
        yellow = float(s.get("yellowTime") or 0)
        red = float(s.get("allRedTime") or 0)
        rows.append(
            {
                "stage_no": str(s.get("phaseStageId")),
                "name": s.get("phaseStageName"),
                "green_s": r1(s.get("splitTime") or (total - yellow - red)),
                "yellow_s": r1(yellow),
                "all_red_s": r1(red),
                "total_s": r1(total),
                "atoms": atoms(s),
                "movements": movements(s),
            }
        )
    return rows


def green_overlap(arr_start: float, width: float, green_start: float, green_dur: float, cycle: float) -> float:
    """模周期上两个窗口的最大连续重叠，口径同 deepagent arterial_bandwidth。"""
    best = 0.0
    for k in (-1, 0, 1):
        gs = (green_start % cycle) + k * cycle
        ge = gs + green_dur
        for j in (-1, 0, 1):
            a_s = (arr_start % cycle) + j * cycle
            best = max(best, max(0.0, min(ge, a_s + width) - max(gs, a_s)))
    return best


def build_links(
    nodes: list[dict[str, Any]], raw_links: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """相邻路口绿窗重叠。

    口径必须与 deepagent 的 arterial_bandwidth 完全一致，否则算出来的数
    和工作台对不上：
      - 行程时间用 links 里的 forward/reverse_speed_kmh（实测约 26.9 / 26.0 km/h），
        **不是** coordination.design_speed_kmh（15.77，那是延误/通行时间用的设计速度）；
      - 绿窗用协调阶段的绿灯 coordinated_green_s，
        **不是** coordinated_green_forward/reverse_s（那是该方向所有放行阶段的合计）。
    这只是相邻两口的窗口重叠，不等于绿波带；全线是否成波看 corridor.bandwidth。
    """
    links = []
    for i, (a, b) in enumerate(zip(nodes, nodes[1:])):
        raw = raw_links[i] if i < len(raw_links) else {}
        length = round(b["cum_length_m"] - a["cum_length_m"], 1)
        v_f = max(1e-3, float(raw.get("forward_speed_kmh") or 0) / 3.6)
        v_r = max(1e-3, float(raw.get("reverse_speed_kmh") or 0) / 3.6)
        tau_f = round(length / v_f, 1)
        tau_r = round(length / v_r, 1)
        row = {
            "from": a["short_name"],
            "to": b["short_name"],
            "length_m": length,
            "forward_speed_kmh": raw.get("forward_speed_kmh"),
            "reverse_speed_kmh": raw.get("reverse_speed_kmh"),
            "travel_time_forward_s": tau_f,
            "travel_time_reverse_s": tau_r,
        }
        for mode in ("baseline", "optimized"):
            cyc_a = a[mode]["cycle_s"]
            cyc_b = b[mode]["cycle_s"]
            if cyc_a != cyc_b:
                row[mode] = {
                    "cycle_mismatch": True,
                    "cycles_s": [cyc_a, cyc_b],
                    "forward_overlap_s": None,
                    "reverse_overlap_s": None,
                }
                continue
            cyc = float(cyc_a)
            fwd = green_overlap(
                a[mode]["offset_s"] + tau_f,
                a[mode]["coord_green_s"],
                b[mode]["offset_s"],
                b[mode]["coord_green_s"],
                cyc,
            )
            rev = green_overlap(
                b[mode]["offset_s"] + tau_r,
                b[mode]["coord_green_s"],
                a[mode]["offset_s"],
                a[mode]["coord_green_s"],
                cyc,
            )
            row[mode] = {
                "cycle_mismatch": False,
                "cycles_s": [cyc_a, cyc_b],
                "forward_overlap_s": round(fwd, 1),
                "reverse_overlap_s": round(rev, 1),
            }
        links.append(row)
    return links


def build_diagram(st: dict[str, Any], cycle_s: float) -> dict[str, Any] | None:
    """把 space-time 的时距图裁成前端能直接画的最小集合。

    坐标约定沿用引擎：points 里每个点是 [时间 s, 里程 m]，
    绘制时横轴走里程、纵轴走时间且自下而上（与工作台一致）。
    只保留几何，丢掉 meta / 饱和度等诊断字段。
    """
    d = st.get("diagram") or {}
    evaluation = st.get("evaluation") or {}
    cum = d.get("cum_distance_m") or []
    if not cum:
        return None

    def pts(raw: list[list[float]]) -> list[list[float]]:
        return [[round(float(p[0]), 1), round(float(p[1]), 1)] for p in raw or []]

    windows = [
        {
            "node": int(w.get("node_index") or 0),
            "dir": w.get("direction") or "forward",
            "role": w.get("role") or "coord",
            "t0": r1(w.get("start_s")),
            "t1": r1(w.get("end_s")),
        }
        for w in d.get("green_windows") or []
    ]
    vehicles = [
        {
            "dir": v.get("direction") or "forward",
            "role": (v.get("meta") or {}).get("role") or "main",
            # 工作台 splitMoveWaitRuns 分段配色所需：出发时刻/红发起车/侧向汇入
            "meta": {
                "depart_s": (v.get("meta") or {}).get("depart_s"),
                "depart_phase": (v.get("meta") or {}).get("depart_phase"),
                "side_arrival": bool((v.get("meta") or {}).get("side_arrival")),
            },
            "pts": pts(v.get("points")),
        }
        for v in d.get("vehicles") or []
        if v.get("render") is not False and len(v.get("points") or []) >= 2
    ]
    tails = [pts(q.get("points")) for q in d.get("queue_tails") or [] if len(q.get("points") or []) >= 2]

    times = [p[0] for v in vehicles for p in v["pts"]]
    times += [w["t0"] for w in windows] + [w["t1"] for w in windows]
    times += [p[0] for q in tails for p in q]

    return {
        "source": "traffic_signal_deepagent · /corridor/space-time · 服务端 Newell 轨迹",
        "cycle_s": cycle_s,
        "cum_distance_m": [r1(x) for x in cum],
        "t_min_s": r1(min(times)) if times else 0,
        "t_max_s": r1(max(times)) if times else cycle_s * 2,
        "windows": windows,
        "vehicles": vehicles,
        "queue_tails": tails,
        "bands": [
            {"dir": b.get("direction") or "forward", "pts": pts(b.get("points"))}
            for b in d.get("bandwidth_bands") or []
        ],
        # 保留时距评价的真实方向 KPI，供前端展示延误/停车率。
        "evaluation": {
            "chained_bandwidth_forward_s": r1(evaluation.get("chained_bandwidth_forward_s")),
            "chained_bandwidth_reverse_s": r1(evaluation.get("chained_bandwidth_reverse_s")),
            "direction_kpis": [
                {
                    key: r1(value) if isinstance(value, (int, float)) else value
                    for key, value in row.items()
                }
                for row in evaluation.get("direction_kpis") or []
            ],
            "notes": evaluation.get("notes") or [],
            "warnings": evaluation.get("warnings") or [],
        },
    }


def main() -> int:
    if not RAW.exists():
        raise SystemExit(f"缺少工作台数据 {RAW}，请先运行 scripts/sync_workbench_signal_plan.py")
    run_meta_path = ROOT / "data" / "deepagent-raw" / "_meta.json"
    run_meta = json.loads(run_meta_path.read_text(encoding="utf-8")) if run_meta_path.exists() else {}
    if run_meta.get("source_kind") != "workbench_authoritative":
        raise SystemExit(
            "拒绝提取非工作台数据：请先运行 scripts/sync_workbench_signal_plan.py，"
            "直接 API 重跑只可用于诊断，不能覆盖页面 JSON"
        )
    raw_bytes = RAW.read_bytes()
    actual_sha = hashlib.sha256(raw_bytes).hexdigest()
    expected_sha = str(run_meta.get("source_sha256") or "")
    if not expected_sha or actual_sha != expected_sha:
        raise SystemExit(
            f"拒绝提取：工作台方案 SHA256 不匹配（actual={actual_sha}, expected={expected_sha}）"
        )
    raw = json.loads(raw_bytes)
    segment_key = str(run_meta.get("segment_key") or DEFAULT_SEGMENT_KEY)
    segs = [s for s in raw.get("segment_plans") or [] if s.get("segment_key") == segment_key]
    if not segs:
        raise SystemExit(f"工作台数据中没有区间 {segment_key}")
    sp = segs[0]

    coord = sp["plan"]["coordination"]
    # 工作台时距图面板的 KPI 来源；缺文件就退化为空，不拿 coordination 里那两个
    # 口径不一致的字段冒充（正向按协调阶段绿算、反向按方向合计绿算，两者不可比）。
    st = json.loads(ST.read_text(encoding="utf-8")) if ST.exists() else {}
    st_eval = st.get("evaluation") or {}
    expected_bandwidth = (run_meta.get("workbench_signature") or {}).get("bandwidth") or []
    actual_bandwidth = [
        r1(st_eval.get("chained_bandwidth_forward_s")),
        r1(st_eval.get("chained_bandwidth_reverse_s")),
    ]
    if actual_bandwidth != expected_bandwidth:
        raise SystemExit(
            f"拒绝提取：时距图带宽不匹配（actual={actual_bandwidth}, expected={expected_bandwidth}）"
        )
    by_diagram = {d["intersection_id"]: d for d in sp.get("intersection_stage_diagrams") or []}
    by_baseline = {n["intersection_id"]: n for n in sp["baseline_comparison"]["nodes"]}

    base_m = min(CUM_LENGTH_M[n["intersection_id"]] for n in coord["nodes"])
    nodes = []
    for n in coord["nodes"]:
        iid = n["intersection_id"]
        diagram = by_diagram.get(iid) or {}
        base = (by_baseline.get(iid) or {}).get("baseline") or {}
        nodes.append(
            {
                "inter_id": iid,
                "name": diagram.get("inter_name"),
                "short_name": SHORT_NAME.get(iid, diagram.get("inter_name")),
                "is_focus": iid in FOCUS,
                "cum_length_m": CUM_LENGTH_M[iid],
                "dist_m": r1(CUM_LENGTH_M[iid] - base_m),
                "coord_stage_no": str(n.get("main_coordination_phase_id")),
                "baseline": {
                    "plan_no": base.get("plan_no"),
                    "cycle_s": r1(base.get("cycle_s")),
                    "offset_s": r1(base.get("offset_s")),
                    "coord_green_s": r1(base.get("coordinated_green_s")),
                    "coord_green_forward_s": r1(base.get("coordinated_green_forward_s")),
                    "coord_green_reverse_s": r1(base.get("coordinated_green_reverse_s")),
                    "stages": baseline_stages(base),
                },
                "optimized": {
                    "cycle_s": r1(n.get("cycle_s")),
                    "offset_s": r1(n.get("offset_s")),
                    "coord_green_s": r1(n.get("coordinated_green_s")),
                    "coord_green_forward_s": r1(n.get("coordinated_green_forward_s")),
                    "coord_green_reverse_s": r1(n.get("coordinated_green_reverse_s")),
                    "green_ratio": n.get("green_ratio"),
                    "webster_delay_s": r1(n.get("webster_delay_s")),
                    "stages": optimized_stages((diagram.get("viewer_payload") or {}).get("plan") or {}),
                },
                "offset_delta_s": r1((diagram.get("offset_s") or {}).get("delta")),
            }
        )
    nodes.sort(key=lambda x: x["cum_length_m"])

    imp = sp["expected_improvements"]
    brief = sp["recommendation_brief"]
    meta = sp["plan"]["meta"]
    min_green = float((sp["request"].get("constraints") or {}).get("min_green_s") or 0)
    period_label = str(sp.get("period_label") or run_meta.get("period_label") or "早高峰")
    period_window = {
        "早高峰": "07:00-09:00",
        "晚高峰": "17:00-19:00",
    }.get(period_label, "")
    min_green_violations = [
        {
            "inter_id": n["inter_id"],
            "name": n["short_name"],
            "stage_no": s["stage_no"],
            "green_s": s["green_s"],
        }
        for n in nodes
        for s in n["optimized"]["stages"]
        if min_green and s["green_s"] < min_green
    ]

    payload = {
        "meta": {
            "title": "信控方案调节",
            "subtitle": (
                f"奥体西路干线协调 · {period_label} {period_window.replace('-', '–')}"
                if period_window
                else f"奥体西路干线协调 · {period_label}"
            ),
            "source": {
                "engine": "traffic_signal_deepagent · 干线方案生成",
                "algorithm": meta.get("algorithm"),
                "version": meta.get("version"),
                "line_id": sp["plan"]["corridor_id"],
                "line_name": "奥体西路（书堂街--龙奥南路）",
                "segment_key": segment_key,
                "raw_json": "data/deepagent-raw/plan-generation.json（本地留存，不入库）",
                "source_project": run_meta.get("source_project"),
                "pulled_at": run_meta.get("pulled_at"),
                "source_kind": run_meta.get("source_kind"),
                "source_file": run_meta.get("source_file"),
                "source_sha256": run_meta.get("source_sha256"),
            },
            "db_supported": True,
            "period_label": period_label,
            "period_window": period_window,
            "scenario_label": sp.get("scenario_label"),
            "strategy_package": sp.get("strategy_package_name"),
            "strategy": sp.get("strategy"),
            "strategy_label": sp.get("strategy_label"),
            "strategy_family_label": sp.get("strategy_family_label"),
            "recommendation_status": sp.get("recommendation_status"),
            "requires_human_confirm": bool(sp.get("requires_human_confirm")),
            "selection_reason": sp.get("selection_reason"),
            "min_green_s": min_green,
        },
        "corridor": {
            "cycle_s": coord.get("cycle_s"),
            "baseline_cycles_s": sorted({n["baseline"]["cycle_s"] for n in nodes if n["baseline"]["cycle_s"]}),
            "design_speed_kmh": coord.get("design_speed_kmh"),
            "forward_dir8": coord.get("forward_dir8") or 0,
            "reverse_dir8": coord.get("reverse_dir8") or 4,
            "forward_label": "北向南（解放东路 → 经十路）",
            "reverse_label": "南向北（经十路 → 解放东路）",
            "coordinated_direction": coord.get("coordination_direction") or "reverse",
            # 工作台「绿波时距图」面板显示的两个数，取自 space-time evaluate，
            # 标签与工作台一致（正向/反向链式带宽 · s）。
            "bandwidth": {
                "chained_forward_s": r1(st_eval.get("chained_bandwidth_forward_s")),
                "chained_reverse_s": r1(st_eval.get("chained_bandwidth_reverse_s")),
            },
            "focus_link": {
                "from": "奥体西路与解放东路路口",
                "to": "奥体西路与经十路路口",
                "length_m": 369.2,
                "note": "幕 3 仿真所用问题路段，位于本协调区间末端。",
            },
        },
        "nodes": nodes,
        "links": build_links(nodes, sp["request"].get("links") or []),
        "diagram": build_diagram(st, float(coord.get("cycle_s") or 180)),
        # 与工作台保持一致：引擎报什么就展示什么，标签沿用引擎原文。
        # （口径备注见 docs/implementation-refs.md，不进 UI 文案。）
        "kpis": [
            {
                "name": m.get("name"),
                "label": m.get("label"),
                "baseline": r1(m.get("baseline")) if m.get("baseline") is not None else None,
                "optimized": r1(m.get("optimized")) if m.get("optimized") is not None else None,
                "delta": r1(m.get("delta")) if m.get("delta") is not None else None,
                "direction": m.get("direction"),
                "improved": m.get("improved"),
                "confidence": m.get("confidence"),
            }
            for m in imp.get("metrics") or []
        ],
        "brief": {
            "problem": brief.get("problem"),
            "strategy": brief.get("strategy"),
            "expected_effect": brief.get("expected_effect"),
            "highlights": brief.get("highlights") or [],
            "issue_labels": brief.get("issue_labels") or [],
        },
        "guardrails": {
            "regression_flags": [
                {
                    "code": f.get("code"),
                    "metric": f.get("metric"),
                    "severity": f.get("severity"),
                    "message": f.get("message"),
                }
                for f in sp.get("regression_flags") or []
            ],
            "notes": imp.get("notes") or [],
            "data_confidence": imp.get("data_confidence"),
            "min_green_violations": min_green_violations,
        },
        "candidates": [
            {
                "candidate_id": t.get("candidate_id"),
                "label": cn_label(t.get("label") or t.get("mutation")),
                "strategy": t.get("strategy"),
                "score_delta": t.get("score_delta"),
                "selected": bool(t.get("selected")),
                # 同上：这是链式加权评分，不是秒
                "chained_score": ((t.get("key_metrics") or {}).get("bandwidth_s") or {}).get("optimized"),
            }
            for t in sp.get("iteration_trace") or []
        ],
    }

    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"-> {OUT.relative_to(ROOT)}  ({OUT.stat().st_size / 1024:.0f} KB)")
    print(f"   nodes={len(nodes)}  kpis={len(payload['kpis'])}  cycle={payload['corridor']['cycle_s']}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

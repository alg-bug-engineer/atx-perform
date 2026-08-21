#!/usr/bin/env python3
"""从 traffic_signal_deepagent 拉取奥体西路走廊的信控治理方案原始 JSON。

运行前先启动 deepagent API：
    cd /Users/chenyuxiang/Desktop/Agent/traffic_signal_deepagent
    .venv/bin/python -m uvicorn traffic_signal_agent.api:app --host 127.0.0.1 --port 8010

原始响应写入 data/deepagent-raw/（已在 .gitignore 中忽略），
该脚本的直接 API 重跑仅用于诊断差异，不能作为页面权威数据。
页面 JSON 必须通过 scripts/sync_workbench_signal_plan.py 从工作台产物同步。

场景认知阶段要遍历全线路口逐时段读库，单阶段可能跑十几分钟；
已完成的阶段会落盘缓存，重跑时自动跳过，除非加 --force。
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "deepagent-raw"

BASE = "http://127.0.0.1:8010/v1/skillpack"
# road9.dim_line_info：奥体西路整条干线，seq 17/18 即解放东路、经十路
LINE_ID = "wwe2bswwwe23pb01"
LINE_NAME = "奥体西路（书堂街--龙奥南路）"
SOURCE_PROJECT = "/Users/zhangqilai/shensi/code/traffic_signal_deepagent 2"
# 幕 3 关注的问题路段：解放东路 → 经十路
FOCUS_INTERS = ["011wwe28fmc00001", "011wwe28ctu00001"]
# 晚高峰优化子区，与 extract_signal_plan.py 保持一致
SEGMENT_KEY = "opt-3:晚高峰"


def post(path: str, body: dict[str, Any], timeout: int) -> dict[str, Any]:
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"{path} HTTP {exc.code}: {detail[:1200]}") from exc


def _window_sec(window: str) -> tuple[int, int]:
    """解析 'HH:MM-HH:MM' 为 (start_sec, end_sec)。"""
    start, end = window.split("-", 1)

    def _sec(hhmm: str) -> int:
        hh, mm = hhmm.strip().split(":", 1)
        return int(hh) * 3600 + int(mm) * 60

    return _sec(start), _sec(end)


def _inject_period_window(profile: dict[str, Any], window: str) -> int:
    """把 profile 中晚高峰协调组（period_window == 16:30-19:00）改写为目标时段。

    引擎 plan-generation 的 time_context 起止秒来自
    profile.control_profile.coordination_groups（PG dws_corridor_coord_group），
    晚高峰组的窗口固定为 16:30-19:00；这里改写后全链路（诊断/策略/方案/时距图）
    都会按目标时段计算。返回改写的组数。
    """
    start_sec, end_sec = _window_sec(window)
    changed = 0

    def walk(node: Any) -> None:
        nonlocal changed
        if isinstance(node, dict):
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                if isinstance(item, dict) and item.get("period_window") == "16:30-19:00":
                    item["period_start_sec"] = start_sec
                    item["period_end_sec"] = end_sec
                    item["period_window"] = window
                    changed += 1
                elif isinstance(item, (dict, list)):
                    walk(item)

    walk(profile.get("control_profile") or {})
    return changed


def dump(name: str, payload: Any, suffix: str = "") -> Path:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    out = RAW_DIR / f"{name}{suffix}.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  -> {out.relative_to(ROOT)}  ({out.stat().st_size / 1024:.0f} KB)")
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--line-id", default=LINE_ID)
    parser.add_argument("--timeout", type=int, default=5400, help="单阶段超时秒数")
    parser.add_argument("--force", action="store_true", help="忽略已有缓存，全部重跑")
    parser.add_argument(
        "--solver-strategy",
        default=None,
        help="指定求解策略（如 oneway_forward），结果另存为 plan-generation-<strategy>.json",
    )
    parser.add_argument(
        "--day-of-week",
        type=int,
        default=None,
        choices=range(1, 8),
        help="星期几（1=周一…7=周日），传给走廊场景认知按天读流量",
    )
    parser.add_argument(
        "--period-window",
        default=None,
        help="晚高峰时段窗口（如 17:00-19:00），改写协调组时段后全链路重算",
    )
    args = parser.parse_args()
    suffix_parts = []
    if args.day_of_week is not None:
        suffix_parts.append(f"dow{args.day_of_week}")
    if args.period_window:
        suffix_parts.append(args.period_window.replace(":", ""))
    suffix = "-" + "-".join(suffix_parts) if suffix_parts else ""
    # 走廊阶段全程走确定性模板，不启用大模型叙述/动作生成。
    use_llm = False
    t0 = time.time()

    def phase(name: str, path: str, body: dict[str, Any]) -> dict[str, Any]:
        cached = RAW_DIR / f"{name}{suffix}.json"
        if cached.exists() and not args.force:
            print(f"=== {name} (cached) ===", flush=True)
            return json.loads(cached.read_text(encoding="utf-8"))
        print(f"=== {name} ===", flush=True)
        t = time.time()
        resp = post(path, body, timeout=args.timeout)
        dump(name, resp, suffix)
        print(f"  {name} done in {time.time() - t:.1f}s", flush=True)
        return resp

    scene_body: dict[str, Any] = {"line_id": args.line_id, "use_llm_narrative": use_llm}
    if args.day_of_week is not None:
        scene_body["day_of_week"] = args.day_of_week
    scene = phase("scene-cognition", "/corridor/scene-cognition", scene_body)
    task = scene.get("task") or {}
    profile = scene.get("profile") or {}
    if args.period_window:
        changed = _inject_period_window(profile, args.period_window)
        if changed <= 0:
            raise SystemExit(
                f"未在 profile 中找到 period_window == 16:30-19:00 的协调组，"
                f"无法注入时段 {args.period_window}（请检查 PG 协调组配置）"
            )
        print(f"  -> 已把 {changed} 个晚高峰协调组改写为 {args.period_window}", flush=True)

    diag_resp = phase(
        "problem-diagnosis",
        "/corridor/problem-diagnosis",
        {"profile": profile, "use_llm_narrative": use_llm},
    )
    diagnosis = diag_resp.get("diagnosis") or diag_resp

    phase(
        "congestion-cause",
        "/corridor/congestion-cause",
        {"profile": profile, "diagnosis": diagnosis, "use_llm_narrative": use_llm},
    )

    strat_resp = phase(
        "control-strategy",
        "/corridor/control-strategy",
        {
            "diagnosis": diagnosis,
            "task": task,
            "profile": profile,
            "use_llm_actions": use_llm,
        },
    )
    strategy = strat_resp.get("strategy") or strat_resp

    plan_body = {
        "strategy": strategy,
        "task": task,
        "profile": profile,
        "diagnosis": diagnosis,
        "use_llm_narrative": use_llm,
    }
    plan_name = "plan-generation"
    if args.solver_strategy:
        plan_body["solver_strategy"] = args.solver_strategy
        plan_name = f"plan-generation-{args.solver_strategy}"
    plan = phase(plan_name, "/corridor/plan-generation", plan_body)

    if args.solver_strategy:
        print(f"变体 {args.solver_strategy} 已保存，未改写 _meta.json")
        return 0

    # 工作台「绿波时距图」面板的 KPI 走的是这个接口的 evaluation，
    # 与 coordination 里那两个 chained_bandwidth 字段不是同一次计算，必须单独取。
    seg = next(
        (s for s in plan.get("segment_plans") or [] if s.get("segment_key") == SEGMENT_KEY),
        None,
    )
    if seg is None:
        # 时段注入后子区编号可能变化（如 opt-3 → opt-4），按标签回退匹配
        seg = next(
            (
                s
                for s in plan.get("segment_plans") or []
                if "晚高峰" in str(s.get("label") or "")
            ),
            None,
        )
    if seg:
        phase(
            "space-time",
            "/corridor/space-time",
            {
                "payload": seg["request"],
                "coordination": seg["plan"]["coordination"],
                "operation": "evaluate",
                "queue_mode": "none",
            },
        )
    else:
        print(f"未找到区间 {SEGMENT_KEY}，跳过 space-time")

    meta = {
        "source_kind": "direct_api_run_not_authoritative",
        "line_id": args.line_id,
        "line_name": task.get("scope", {}).get("name") or LINE_NAME,
        "focus_inter_ids": FOCUS_INTERS,
        "use_llm": use_llm,
        "pulled_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "source_project": SOURCE_PROJECT,
        "elapsed_s": round(time.time() - t0, 1),
        "plan_ok": plan.get("ok"),
        "plan_errors": plan.get("errors") or plan.get("validation_errors"),
        "segment_count": len(plan.get("segment_plans") or []),
    }
    if args.day_of_week is not None:
        meta["day_of_week"] = args.day_of_week
    if args.period_window:
        meta["period_window"] = args.period_window
    dump("_meta", meta, suffix)
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

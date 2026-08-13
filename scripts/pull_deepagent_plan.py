#!/usr/bin/env python3
"""从 traffic_signal_deepagent 拉取奥体西路走廊的信控治理方案原始 JSON。

运行前先启动 deepagent API：
    cd /Users/zhangqilai/shensi/code/traffic_signal_deepagent
    .venv/bin/python -m uvicorn traffic_signal_agent.api:app --host 127.0.0.1 --port 8010

原始响应写入 data/deepagent-raw/（已在 .gitignore 中忽略），
再由 scripts/extract_signal_plan.py 蒸馏成幕 3 使用的 data/1-3-signal-plan.json。

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


def dump(name: str, payload: Any) -> Path:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    out = RAW_DIR / f"{name}.json"
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
    args = parser.parse_args()
    # 走廊阶段全程走确定性模板，不启用大模型叙述/动作生成。
    use_llm = False
    t0 = time.time()

    def phase(name: str, path: str, body: dict[str, Any]) -> dict[str, Any]:
        cached = RAW_DIR / f"{name}.json"
        if cached.exists() and not args.force:
            print(f"=== {name} (cached) ===", flush=True)
            return json.loads(cached.read_text(encoding="utf-8"))
        print(f"=== {name} ===", flush=True)
        t = time.time()
        resp = post(path, body, timeout=args.timeout)
        dump(name, resp)
        print(f"  {name} done in {time.time() - t:.1f}s", flush=True)
        return resp

    scene = phase(
        "scene-cognition",
        "/corridor/scene-cognition",
        {"line_id": args.line_id, "use_llm_narrative": use_llm},
    )
    task = scene.get("task") or {}
    profile = scene.get("profile") or {}

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
        "line_id": args.line_id,
        "line_name": task.get("scope", {}).get("name") or LINE_NAME,
        "focus_inter_ids": FOCUS_INTERS,
        "use_llm": use_llm,
        "pulled_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "source_project": "/Users/zhangqilai/shensi/code/traffic_signal_deepagent",
        "elapsed_s": round(time.time() - t0, 1),
        "plan_ok": plan.get("ok"),
        "plan_errors": plan.get("errors") or plan.get("validation_errors"),
        "segment_count": len(plan.get("segment_plans") or []),
    }
    dump("_meta", meta)
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

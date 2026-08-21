#!/usr/bin/env python3
"""同步工作台当前权威干线方案，并生成本项目的信控 JSON。

数据契约：只接受工作台落盘的 ``tmp/aoti_xilu/05_plan_generation.json``，
锁定工作台早高峰的 ``opt-5:早高峰``。同步时会用原 request/coordination 重新调用
工作台的 space-time 接口，并对解放东路 5 阶段、相位差和带宽指纹做硬校验；任一不一致
立即失败，避免其他 API 重跑结果覆盖工作台口径。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "deepagent-raw"
DEFAULT_SOURCE = Path(
    "/Users/zhangqilai/shensi/code/traffic_signal_deepagent 2/"
    "tmp/aoti_xilu/05_plan_generation.json"
)
DEFAULT_API = "http://127.0.0.1:8010/v1/skillpack"
SEGMENT_KEY = "opt-5:早高峰"
FOCUS_INTER_ID = "011wwe28fmc00001"

EXPECTED = {
    "cycle": [200.0, 220.0],
    "offset": [0.0, 13.0],
    "stage_total_before": [73.0, 30.0, 55.0, 17.0, 25.0],
    "stage_total_after": [74.0, 31.0, 72.0, 19.0, 24.0],
    "bandwidth": [97.7, 131.7],
    "delay": 0.0,
    "stop_rate": 0.0,
    "diagram_counts": {
        "green_windows": 68,
        "bandwidth_bands": 2,
        "vehicles": 257,
        "queue_tails": 6,
    },
}


def _r1(value: Any) -> float:
    return round(float(value), 1)


def _post(url: str, body: dict[str, Any], timeout: int) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"工作台时距图接口 HTTP {exc.code}: {detail[:1600]}") from exc


def _target_segment(plan: dict[str, Any]) -> dict[str, Any]:
    segment = next(
        (row for row in plan.get("segment_plans") or [] if row.get("segment_key") == SEGMENT_KEY),
        None,
    )
    if not segment:
        available = [row.get("segment_key") for row in plan.get("segment_plans") or []]
        raise SystemExit(f"工作台结果缺少 {SEGMENT_KEY}；当前区间：{available}")
    return segment


def _stage_signature(segment: dict[str, Any]) -> dict[str, Any]:
    coord = segment["plan"]["coordination"]
    node = next(
        (row for row in coord.get("nodes") or [] if row.get("intersection_id") == FOCUS_INTER_ID),
        None,
    )
    comparison = next(
        (
            row
            for row in (segment.get("baseline_comparison") or {}).get("nodes") or []
            if row.get("intersection_id") == FOCUS_INTER_ID
        ),
        None,
    )
    diagram = next(
        (
            row
            for row in segment.get("intersection_stage_diagrams") or []
            if row.get("intersection_id") == FOCUS_INTER_ID
        ),
        None,
    )
    if not node or not comparison or not diagram:
        raise SystemExit("工作台结果缺少解放东路节点、基线对比或阶段图")

    baseline = comparison.get("baseline") or {}
    before = [
        _r1((row.get("green_s") or 0) + (row.get("yellow_s") or 0) + (row.get("all_red_s") or 0))
        for row in baseline.get("stages") or []
    ]
    viewer = ((diagram.get("viewer_payload") or {}).get("plan") or {}).get("phaseStageTimingList") or []
    after = [_r1(row.get("greenTime") or 0) for row in viewer]
    return {
        "cycle": [_r1(baseline.get("cycle_s")), _r1(node.get("cycle_s"))],
        "offset": [_r1(baseline.get("offset_s")), _r1(node.get("offset_s"))],
        "stage_total_before": before,
        "stage_total_after": after,
        "intersection_name": diagram.get("inter_name"),
    }


def _assert_equal(label: str, actual: Any, expected: Any) -> None:
    if actual != expected:
        raise SystemExit(f"工作台权威校验失败：{label}={actual!r}，期望 {expected!r}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-plan", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--api-base", default=DEFAULT_API)
    parser.add_argument("--timeout", type=int, default=300)
    parser.add_argument("--skip-extract", action="store_true")
    args = parser.parse_args()

    if not args.source_plan.exists():
        raise SystemExit(f"缺少工作台方案文件：{args.source_plan}")
    source_bytes = args.source_plan.read_bytes()
    plan = json.loads(source_bytes)
    segment = _target_segment(plan)
    signature = _stage_signature(segment)
    _assert_equal("周期", signature["cycle"], EXPECTED["cycle"])
    _assert_equal("相位差", signature["offset"], EXPECTED["offset"])
    _assert_equal("解放东路优化前阶段时长", signature["stage_total_before"], EXPECTED["stage_total_before"])
    _assert_equal("解放东路优化后阶段时长", signature["stage_total_after"], EXPECTED["stage_total_after"])

    request_payload = dict(segment["request"])
    request_payload["constraints"] = {
        **(request_payload.get("constraints") or {}),
        "cycles_to_show": 4,
    }
    space_time = _post(
        f"{args.api_base.rstrip('/')}/corridor/space-time",
        {
            "payload": request_payload,
            "coordination": segment["plan"]["coordination"],
            "operation": "evaluate",
        },
        args.timeout,
    )
    if not space_time.get("ok"):
        raise SystemExit(f"工作台时距图评价失败：{space_time.get('error')}")
    evaluation = space_time.get("evaluation") or {}
    bandwidth = [
        _r1(evaluation.get("chained_bandwidth_forward_s")),
        _r1(evaluation.get("chained_bandwidth_reverse_s")),
    ]
    direction = (evaluation.get("direction_kpis") or [{}])[0]
    _assert_equal("正反向链式带宽", bandwidth, EXPECTED["bandwidth"])
    _assert_equal("延误", _r1(direction.get("mean_delay_s") or 0), EXPECTED["delay"])
    _assert_equal("停车率", _r1(direction.get("stop_rate") or 0), EXPECTED["stop_rate"])
    diagram_counts = {
        key: len((space_time.get("diagram") or {}).get(key) or [])
        for key in ("green_windows", "bandwidth_bands", "vehicles", "queue_tails")
    }
    _assert_equal("时距图对象数", diagram_counts, EXPECTED["diagram_counts"])

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    (RAW_DIR / "plan-generation.json").write_bytes(source_bytes)
    (RAW_DIR / "space-time.json").write_text(
        json.dumps(space_time, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    manifest = {
        "source_kind": "workbench_authoritative",
        "source_project": str(args.source_plan.parents[2]),
        "source_file": str(args.source_plan),
        "source_sha256": hashlib.sha256(source_bytes).hexdigest(),
        "pulled_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "segment_key": SEGMENT_KEY,
        "period_label": segment.get("period_label"),
        "workbench_signature": {**signature, "bandwidth": bandwidth},
        "diagram_counts": diagram_counts,
    }
    (RAW_DIR / "_meta.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    if not args.skip_extract:
        subprocess.run([sys.executable, str(ROOT / "scripts" / "extract_signal_plan.py")], check=True)

    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

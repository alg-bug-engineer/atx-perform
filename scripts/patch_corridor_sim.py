#!/usr/bin/env python3
"""往 data/1-3-optimization.json 写入幕 3 走廊微观仿真配置。

渠化按现场观测：北向南上游 3 车道，距经十路约 100 m 处展宽为 5 车道，
展宽在东侧（中央分隔带一侧）开出两条左转专用道。
相位取库内 plan 13 / plan 23 的阶段顺序与绿时；相位差因 coord_stage_no=0
（库内未记录锚定阶段）无法反解，改按现场观测的放行先后标定。
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
PATH = ROOT / "data" / "1-3-optimization.json"

SIM = {
    "note": "微观仿真配置：车道渠化按现场观测，阶段顺序与绿时取自信号机方案库，相位对齐按现场放行先后标定",
    "cycle_len_sec": 220,
    "step_sec": 0.5,
    "warmup_cycles": 3,
    "seed": 20260812,
    "display_anchor": {
        "intersection": "jingshi",
        "movement": "north_through",
        "lead_in_sec": 6,
        "note": "时间轴 0 秒锚定在经十路口南北直行绿灯亮起前 6 s，按观测叙事顺序播放一个周期",
    },
    "geometry": {
        "length_m": 367.89,
        "widen_len_m": 100,
        "taper_len_m": 26,
        "widen_side": "east",
        "upstream_lanes": [
            {"index": 1, "side": "east", "label": "左转", "group": "left"},
            {"index": 2, "side": "mid", "label": "直行", "group": "through"},
            {"index": 3, "side": "west", "label": "公交专用道", "group": "right"},
        ],
        "downstream_lanes": [
            {"index": 1, "label": "左转+掉头", "group": "left", "from_upstream": 1},
            {"index": 2, "label": "左转", "group": "left", "from_upstream": 1},
            {"index": 3, "label": "直行", "group": "through", "from_upstream": 2},
            {"index": 4, "label": "直行", "group": "through", "from_upstream": 2},
            {"index": 5, "label": "右转借道 / 公交专用道", "group": "right", "from_upstream": 3},
        ],
        "field_note": "现场观测（东→西）：上游 左转·直行·公交专用道；展宽段 左转+掉头·左转·直行·直行·右转借道+公交专用道",
    },
    "vehicle": {
        "space_m": 7.0,
        "free_speed_mps": 11.1,
        "reaction_sec": 2.0,
        "accel_mps2": 2.3,
        "stopped_speed_mps": 1.2,
    },
    "turn_split": {"left": 0.24, "through": 0.60, "right": 0.16},
    "sources": [
        {
            "key": "north_through",
            "label": "北进口直行",
            "dir8": 0,
            "turn": 2,
            "veh_per_cycle": 34,
            "spread": "green",
            "note": "解放东路口北进口直行，走廊主流向",
        },
        {
            "key": "east_left",
            "label": "东进口左转",
            "dir8": 2,
            "turn": 1,
            "veh_per_cycle": 30,
            "spread": "green",
            "note": "东进口左转汇入北向南",
        },
        {
            "key": "west_right",
            "label": "西进口右转",
            "concurrent_dir8": 6,
            "concurrent_turn": 2,
            "veh_per_cycle": 18,
            "red_per_cycle": 7,
            "spread": "green",
            "note": "西进口右转与西直同放；红灯期间可右转，按低流率溢出",
        },
    ],
    "alignment": {
        "jingshi": {"stage1_start_s": 200, "source": "plan_cfg.offset_sec"},
        "jiefang": {
            "stage1_start_before_s": 83,
            "stage1_start_after_s": 139,
            "source": "field_calibrated",
            "note": "库内 offset_sec=195 但 coord_stage_no=0（未记录锚定阶段），无法确定绝对对齐；现状按现场观测的放行先后（经十绿灯 → 西进口右转 → 东进口左转 → 北进口直行）标定为 83 s，优化后 139 s，调整量 +56 s",
        },
    },
    "observation": {
        "residual_after_jingshi_green_m": 170,
        "spill_trigger": "北进口直行汇入时路段无剩余蓄车空间",
        "release_ratio": 0.5,
        "source": "现场观测（晚高峰 17:00-19:00）",
    },
}


def main() -> None:
    data = json.loads(PATH.read_text(encoding="utf-8"))
    data["corridor_demo"]["simulation"] = SIM
    data["corridor_demo"]["playback"] = {"default_speed": 12, "speed_options": [4, 8, 12, 20]}

    jiefang = next(
        i for i in data["signal_plan_board"]["intersections"] if i["key"] == "jiefang"
    )
    jiefang["offset_before_s"] = 83
    jiefang["offset_after_s"] = 139
    jiefang["offset_delta_s"] = 56
    jiefang["offset_note"] = (
        "库内 offset_sec=195，但 coord_stage_no=0 未记录锚定阶段；"
        "现状相位差按现场观测放行先后标定为 83 s"
    )
    jiefang["note"] = (
        "相位差调整 56 s：北进口直行放行窗口移进经十路南北直行绿灯，两个汇入相位各截流 6 s"
    )

    PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("simulation config written; jiefang offset", jiefang["offset_before_s"], "->", jiefang["offset_after_s"])


if __name__ == "__main__":
    main()

"""幕 2 分析成因 —— PG 几何 / 指标读取（Live 轨）。

只负责「库内可查」的数值与几何；叙事文案（map_beats / conclusion / copy）
不在 PG 中，由 SceneService 按 narration_mode 策略补齐（见 service.py）。

溯源链推导（真实部署核心）：
  基于流量溯源关联表 `ads_ts_inter_turn_flow_correlate_d`（已预计算
  上游路口的贡献占比），用「方向 + 转向」锁定问题主流向，按 chain_hop 分层：
    - chain_hop=1 占比最高 = via（第一跳上游）
    - chain_hop=2 占比最高 = source（第二跳上游）
  不再使用 dim_link_info 的 f_inter_id + 长度排序（无方向语义，会取错）。

入参（全部可选，缺省回退演示案例默认值）：
  - target_inter_id：溯源汇点路口（默认经十 011wwe28ctu00001）
  - direction / movement：问题主流向（默认 北向南 / 直行），映射 dir8 / turn
  - link_id：可选，显式指定问题路段（优先于关联表推导 via）
  - day_of_week / step_start / step_end：时间窗（默认周一 210-221）
  - trace_type / max_hop：溯源方向与跳数（默认 upstream / 3）
"""

from __future__ import annotations

import json
from typing import Any

from app.config import Settings
from app.modules.scenes.registry import (
    DOWNSTREAM_INTER_ID,
    PROBLEM_LINK_ID,
    UPSTREAM_INTER_ID,
)
from app.shared.pg import read_pg_rows

# 默认值（缺省回退）：坤顺（源点兜底）/ 对向路段 / 周一晚高峰时间窗
DEFAULT_SOURCE_INTER_ID = "011wwe28fty00001"
DEFAULT_OPPOSITE_LINK_ID = "12wwe28ctwwe28fm01"
DEFAULT_DOW = 1
DEFAULT_STEP_START = 210
DEFAULT_STEP_END = 221
DEFAULT_TRACE_TYPE = "upstream"
DEFAULT_MAX_HOP = 3
DEFAULT_DIRECTION = "北向南"
DEFAULT_MOVEMENT = "直行"

# 方向 / 转向 → dir8 / turn 编码（dir8：0北 2东 4南 6西；turn：1左 2直 3右）
DIR8_BY_DIRECTION = {"北向南": 0, "南向北": 4, "东向西": 2, "西向东": 6, "北": 0, "南": 4, "东": 2, "西": 6}
TURN_BY_MOVEMENT = {"直行": 2, "左转": 1, "右转": 3}


def _geom_to_coords(geojson: str | None) -> list[list[float]]:
    """把 PostGIS ST_AsGeoJSON 结果解析成 GeoJSON coordinates 数组。"""
    if not geojson:
        return []
    try:
        obj = json.loads(geojson)
        return obj.get("coordinates") or []
    except (json.JSONDecodeError, AttributeError):
        return []


class PgSceneRepository:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.schema = settings.pg_schema
        self.flow_schema = settings.pg_flow_schema

    def load_scene2(
        self,
        *,
        target_inter_id: str | None = None,
        link_id: str | None = None,
        direction: str | None = None,
        movement: str | None = None,
        day_of_week: int | None = None,
        step_start: int | None = None,
        step_end: int | None = None,
        trace_type: str | None = None,
        max_hop: int | None = None,
    ) -> dict[str, Any]:
        """幕 2 datasets（几何 + 指标，不含叙事文案）。"""
        topo = self._resolve_topology(target_inter_id, link_id, direction, movement)
        dow = day_of_week if day_of_week is not None else DEFAULT_DOW
        s = step_start if step_start is not None else DEFAULT_STEP_START
        e = step_end if step_end is not None else DEFAULT_STEP_END
        trace = (trace_type or DEFAULT_TRACE_TYPE).strip().lower()
        hop = max_hop if max_hop is not None else DEFAULT_MAX_HOP

        return {
            "objects": self._load_objects(topo),
            "flowTrace": self._load_flow_trace_numeric(topo, dow, s, e),
            "cause": self._load_cause_numeric(topo, dow, s, e, trace, hop),
        }

    # ── 拓扑解析：关联表推导 target → via → source ────────────────
    def _resolve_topology(
        self,
        target_inter_id: str | None,
        link_id: str | None,
        direction: str | None,
        movement: str | None,
    ) -> dict[str, Any]:
        """溯源链定位（关联表 + 方向/转向过滤 + chain_hop 分层）。

        传 link_id 时 problem_link / via 以其为准（精确指定），source 仍走关联表 hop=2；
        否则 via/source 全由关联表推导。
        """
        target = target_inter_id or DOWNSTREAM_INTER_ID
        dir8 = DIR8_BY_DIRECTION.get(direction or DEFAULT_DIRECTION, 0)
        turn = TURN_BY_MOVEMENT.get(movement or DEFAULT_MOVEMENT, 2)

        via, via_share = None, None
        source, source_share = None, None
        problem_link = PROBLEM_LINK_ID

        if link_id:
            problem_link = link_id
            rows = self._query_links([link_id])
            via = str(rows[0]["f_inter_id"]) if rows and rows[0].get("f_inter_id") else UPSTREAM_INTER_ID
            via_share = self._query_hop_share(target, dir8, turn, 1, via)
            source, source_share = self._query_hop_top(target, dir8, turn, 2, exclude=via)
            if source is None:
                source = DEFAULT_SOURCE_INTER_ID
        else:
            via, via_share = self._query_hop_top(target, dir8, turn, 1)
            via = via or UPSTREAM_INTER_ID
            source, source_share = self._query_hop_top(target, dir8, turn, 2)
            source = source or DEFAULT_SOURCE_INTER_ID
            problem_link = self._query_problem_link(via, target, dir8) or PROBLEM_LINK_ID

        opposite_link = self._query_opposite_link(problem_link, via, target)

        return {
            "target": target,
            "via": via,
            "source": source,
            "problem_link": problem_link,
            "opposite_link": opposite_link,
            "via_share": via_share,
            "source_share": source_share,
            "direction": direction or DEFAULT_DIRECTION,
            "movement": movement or DEFAULT_MOVEMENT,
            "dir8": dir8,
            "turn": turn,
        }

    def _query_hop_top(
        self,
        target: str,
        dir8: int,
        turn: int,
        hop: int,
        exclude: str | None = None,
    ) -> tuple[str | None, float | None]:
        """关联表指定 chain_hop 中占比最高的上游路口及其占比。

        同一 cor_inter 有多个日期(dt)，聚合取最大 flow_share_ratio。
        """
        sql = f"""
            SELECT cor_inter_id, flow_share_ratio
            FROM {self.flow_schema}.ads_ts_inter_turn_flow_correlate_d
            WHERE inter_id = :target AND trace_type = 'UPSTREAM'
              AND period_type = 'EVENING_PEAK'
              AND f_dir8_no = :dir8::smallint AND turn_dir_no = :turn::smallint
              AND chain_hop = :hop::smallint
              AND COALESCE(is_deleted, 0) = 0
        """
        rows = read_pg_rows(self.settings, sql,
                            {"target": target, "dir8": dir8, "turn": turn, "hop": hop})
        agg: dict[str, float] = {}
        for r in rows:
            cid = str(r.get("cor_inter_id") or "")
            if not cid or cid == exclude:
                continue
            share = _to_float(r.get("flow_share_ratio"), None)
            if share is not None:
                agg[cid] = max(agg.get(cid, 0.0), share)
        if not agg:
            return None, None
        top_id = max(agg, key=lambda k: agg[k])
        return top_id, round(agg[top_id], 1)

    def _query_problem_link(self, via: str, target: str, dir8: int) -> str | None:
        """via → target 且方向匹配的问题路段（目标进口 dir8）。"""
        sql = f"""
            SELECT link_id FROM {self.schema}.dim_link_info
            WHERE f_inter_id = :via AND t_inter_id = :target AND t_dir8 = :dir8
            ORDER BY length_m DESC
        """
        rows = read_pg_rows(self.settings, sql,
                            {"via": via, "target": target, "dir8": str(dir8)}, limit=1)
        return str(rows[0]["link_id"]) if rows and rows[0].get("link_id") else None

    def _query_hop_share(
        self, target: str, dir8: int, turn: int, hop: int, cor_id: str
    ) -> float | None:
        """关联表指定 hop + 指定上游路口的占比（聚合多日期取 max）。"""
        sql = f"""
            SELECT flow_share_ratio
            FROM {self.flow_schema}.ads_ts_inter_turn_flow_correlate_d
            WHERE inter_id = :target AND trace_type = 'UPSTREAM'
              AND period_type = 'EVENING_PEAK'
              AND f_dir8_no = :dir8::smallint AND turn_dir_no = :turn::smallint
              AND chain_hop = :hop::smallint AND cor_inter_id = :cor_id
              AND COALESCE(is_deleted, 0) = 0
        """
        rows = read_pg_rows(self.settings, sql,
                            {"target": target, "dir8": dir8, "turn": turn,
                             "hop": hop, "cor_id": cor_id})
        shares = [float(r["flow_share_ratio"]) for r in rows if r.get("flow_share_ratio") is not None]
        return round(max(shares), 1) if shares else None

    def _query_opposite_link(self, problem_link: str, via: str, target: str) -> str:
        """对向路段：与 problem_link 同一条路（road_name 前缀）的反向 link（f=target, t=via）。"""
        rows = self._query_links([problem_link])
        road_name = rows[0].get("road_name", "") if rows else ""
        prefix = road_name.split(":")[0].strip() if road_name else ""
        if not prefix:
            return DEFAULT_OPPOSITE_LINK_ID
        sql = f"""
            SELECT link_id FROM {self.schema}.dim_link_info
            WHERE f_inter_id = :target AND t_inter_id = :via
              AND strpos(road_name, :prefix) = 1
            ORDER BY length_m DESC
        """
        rows2 = read_pg_rows(self.settings, sql,
                             {"target": target, "via": via, "prefix": prefix}, limit=1)
        return str(rows2[0]["link_id"]) if rows2 and rows2[0].get("link_id") else DEFAULT_OPPOSITE_LINK_ID

    # ── objects：路口坐标 + 问题路段几何 ──────────────────────────
    def _load_objects(self, topo: dict[str, Any]) -> dict[str, Any]:
        inter_ids = [topo["target"], topo["via"]]
        opposite_id = topo.get("opposite_link") or DEFAULT_OPPOSITE_LINK_ID
        link_ids = [topo["problem_link"], opposite_id]

        inter_rows = self._query_intersections(inter_ids)
        link_rows = self._query_links(link_ids)

        inter_by_id = {r["inter_id"]: r for r in inter_rows}
        link_by_id = {r["link_id"]: r for r in link_rows}

        down = inter_by_id.get(topo["target"], {})
        up = inter_by_id.get(topo["via"], {})
        problem = link_by_id.get(topo["problem_link"], {})
        opposite = link_by_id.get(opposite_id, {})

        return {
            "intersections": {
                "downstream_jingshi": {
                    "role": "downstream_target",
                    "inter_id": down.get("inter_id"),
                    "inter_name": down.get("inter_name"),
                    "lon": down.get("lon"),
                    "lat": down.get("lat"),
                },
                "upstream_jiefang": {
                    "role": "upstream_overflow_risk",
                    "inter_id": up.get("inter_id"),
                    "inter_name": up.get("inter_name"),
                    "lon": up.get("lon"),
                    "lat": up.get("lat"),
                },
            },
            "problem_link": {
                "link_id": problem.get("link_id"),
                "road_name": problem.get("road_name"),
                "direction": "N_to_S",
                "f_inter_id": problem.get("f_inter_id"),
                "t_inter_id": problem.get("t_inter_id"),
                "length_m": _to_float(problem.get("length_m")),
                "lane_num": problem.get("lane_num"),
                "c_lane_num": problem.get("c_lane_num"),
                "lane_info": problem.get("lane_info"),
                "max_speed": problem.get("max_speed"),
                "geom": {"type": "LineString", "coordinates": _geom_to_coords(problem.get("geom"))},
                "storage_length_m": _to_float(problem.get("length_m")),
                "storage_length_source": "dim_link_info.length_m",
            },
            "opposite_link": {
                "link_id": opposite.get("link_id"),
                "road_name": opposite.get("road_name"),
                "direction": "S_to_N",
                "length_m": _to_float(opposite.get("length_m")),
                "geom": {"type": "LineString", "coordinates": _geom_to_coords(opposite.get("geom"))},
            },
        }

    # ── flowTrace：溯源拓扑 + 供需 + 下游约束（数值）──────────────
    def _load_flow_trace_numeric(
        self, topo: dict[str, Any], dow: int, s: int, e: int
    ) -> dict[str, Any]:
        inter_rows = self._query_intersections([topo["source"], topo["via"], topo["target"]])
        inter_by_id = {r["inter_id"]: r for r in inter_rows}

        def node(inter_id: str) -> dict[str, Any]:
            r = inter_by_id.get(inter_id, {})
            return {"id": r.get("inter_id"), "name": r.get("inter_name"),
                    "lng": r.get("lon"), "lat": r.get("lat")}

        demand_supply = self._query_demand_supply(topo["target"], topo["dir8"], dow, s, e)
        downstream = self._query_downstream_constraint(topo["target"], dow, s, e)

        return {
            "source": node(topo["source"]),
            "via": node(topo["via"]),
            "target": {**node(topo["target"]),
                       "direction": topo["direction"], "movement": topo["movement"]},
            "upstream_share_display": {
                "source_ratio": topo.get("source_share"),
                "via_ratio": topo.get("via_share"),
            },
            "demand_supply": demand_supply,
            "downstream_constraint": downstream,
        }

    # ── cause：溯源占比 + 供需 + 下游约束 + 降级指标（数值）────────
    def _load_cause_numeric(
        self, topo: dict[str, Any], dow: int, s: int, e: int, trace: str, hop: int
    ) -> dict[str, Any]:
        return {
            "meta": {"target_inter_id": topo["target"]},
            "upstream_traces": self._query_upstream_traces(topo["target"], trace, hop),
            "demand_supply": self._query_cause_demand_supply(topo["target"], dow, s, e),
            "downstream_constraint": self._query_cause_downstream(topo["target"], dow, s, e),
            "jingshi_ew_fallback_metrics": self._query_ew_fallback_metrics(topo["target"], dow, s, e),
        }

    # ── 查询原语 ────────────────────────────────────────────────
    def _query_intersections(self, inter_ids: list[str]) -> list[dict[str, Any]]:
        sql = f"""
            SELECT inter_id, inter_name,
                   ST_X(geom_center) AS lon, ST_Y(geom_center) AS lat
            FROM {self.schema}.dim_inter_info
            WHERE inter_id = ANY(:inter_ids)
        """
        return read_pg_rows(self.settings, sql, {"inter_ids": inter_ids})

    def _query_links(self, link_ids: list[str]) -> list[dict[str, Any]]:
        sql = f"""
            SELECT link_id, road_name, f_inter_id, t_inter_id, length_m,
                   lane_num, c_lane_num, max_speed, lane_info,
                   ST_AsGeoJSON(geom) AS geom
            FROM {self.schema}.dim_link_info
            WHERE link_id = ANY(:link_ids)
        """
        return read_pg_rows(self.settings, sql, {"link_ids": link_ids})

    def _query_demand_supply(self, inter_id: str, dir8: int, dow: int, s: int, e: int) -> dict[str, Any]:
        """主流向（指定进口 dir8）直行供需（简化口径）。

        注：data 固化值 supply_pcu_h=824 是「max(解放东汇入, 经十汇出)」的专家派生口径，
        此处直读 PG 的「主流向直行 12 步（1 小时）实测流量」，两者口径不同、数值不同属预期。
        """
        sql = f"""
            SELECT turn_dir_no, SUM(turn_flow_total) AS flow
            FROM {self.flow_schema}.dws_inter_link_turn_flow_5min_mm
            WHERE inter_id = :inter_id AND dir8_code = :dir8::smallint
              AND day_of_week = :dow AND step_index BETWEEN :s AND :e
              AND COALESCE(is_deleted, 0) = 0
            GROUP BY turn_dir_no
        """
        rows = read_pg_rows(self.settings, sql,
                            {"inter_id": inter_id, "dir8": dir8, "dow": dow, "s": s, "e": e})
        turn_flow = {r["turn_dir_no"]: _to_float(r.get("flow")) for r in rows}
        through = turn_flow.get(2, 0.0)
        return {
            "step_index": s,
            "step_label": _step_label(s),
            "day_of_week": dow,
            "supply_pcu_h": round(through, 1),
            "demand_pcu_h": round(through, 1),
        }

    def _query_downstream_constraint(self, inter_id: str, dow: int, s: int, e: int) -> dict[str, Any]:
        sat_rows = self._query_saturation(inter_id, dow, s, e)
        flow_rows = self._query_turn_flow(inter_id, dow, s, e)

        def sat(direction: str, turn: int) -> float | None:
            for r in sat_rows:
                if r["dir8_code"] == direction and r["turn_dir_no"] == turn:
                    return _to_float(r.get("turn_saturation"), None)
            return None

        def flow(direction: str, turn: int) -> float | None:
            for r in flow_rows:
                if r["dir8_code"] == direction and r["turn_dir_no"] == turn:
                    return _to_float(r.get("flow"), None)
            return None

        east_sat = sat(2, 2)
        west_sat = sat(6, 2)
        north_sat = sat(0, 2)
        sats = [v for v in (east_sat, west_sat, north_sat) if v is not None]

        east_name = self._road_prefix(self._query_approach_link(inter_id, "(东向西)"))
        west_name = self._road_prefix(self._query_approach_link(inter_id, "(西向东)"))

        return {
            "metrics": {
                "east_through_flow_pcu_h": flow(2, 2),
                "east_through_saturation": east_sat,
                "west_through_flow_pcu_h": flow(6, 2),
                "west_through_saturation": west_sat,
                "north_through_flow_pcu_h": flow(0, 2),
                "north_through_saturation": north_sat,
                "intersection_saturation_max": round(max(sats), 4) if sats else None,
                "intersection_los": _los(max(sats)) if sats else None,
            },
            "approach_cards": [
                {"role": "东进口", "name": east_name, "saturation": east_sat, "flow_pcu_h": flow(2, 2)},
                {"role": "西进口", "name": west_name, "saturation": west_sat, "flow_pcu_h": flow(6, 2)},
            ],
        }

    def _query_cause_downstream(self, inter_id: str, dow: int, s: int, e: int) -> dict[str, Any]:
        sat_rows = self._query_saturation(inter_id, dow, s, e)
        east = next((_to_float(r.get("turn_saturation")) for r in sat_rows
                     if r["dir8_code"] == 2 and r["turn_dir_no"] == 2), None)
        west = next((_to_float(r.get("turn_saturation")) for r in sat_rows
                     if r["dir8_code"] == 6 and r["turn_dir_no"] == 2), None)
        sats = [v for v in (east, west) if v is not None]
        return {
            "inter_id": inter_id,
            "east_through_saturation": east,
            "west_through_saturation": west,
            "intersection_saturation_max": round(max(sats), 4) if sats else None,
            "intersection_los": _los(max(sats)) if sats else None,
        }

    def _query_upstream_traces(self, inter_id: str, trace: str, hop: int) -> dict[str, Any]:
        sql = f"""
            SELECT f_dir8_no, turn_dir_no, cor_inter_id, cor_f_dir8_no,
                   cor_turn_dir_no, flow_share_ratio, chain_hop
            FROM {self.flow_schema}.ads_ts_inter_turn_flow_correlate_d
            WHERE inter_id = :inter_id AND trace_type = :trace
              AND chain_hop <= :hop AND period_type = 'EVENING_PEAK'
              AND COALESCE(is_deleted, 0) = 0
            ORDER BY turn_dir_no, chain_hop, flow_share_ratio DESC
        """
        rows = read_pg_rows(self.settings, sql,
                            {"inter_id": inter_id, "trace": trace.upper(), "hop": hop})
        by_turn: dict[str, list[dict[str, Any]]] = {"left": [], "through": [], "right": []}
        turn_key = {1: "left", 2: "through", 3: "right"}
        for r in rows:
            key = turn_key.get(r["turn_dir_no"])
            if not key:
                continue
            by_turn[key].append({
                "f_dir8_no": r["f_dir8_no"],
                "turn_dir_no": r["turn_dir_no"],
                "cor_inter_id": r["cor_inter_id"],
                "cor_f_dir8_no": r["cor_f_dir8_no"],
                "cor_turn_dir_no": r["cor_turn_dir_no"],
                "flow_share_ratio": _to_float(r.get("flow_share_ratio")),
                "chain_hop": r["chain_hop"],
            })
        return {"by_turn": by_turn}

    def _query_cause_demand_supply(self, inter_id: str, dow: int, s: int, e: int) -> dict[str, Any]:
        sql = f"""
            SELECT turn_dir_no, SUM(turn_flow_total) AS flow
            FROM {self.flow_schema}.dws_inter_link_turn_flow_5min_mm
            WHERE inter_id = :inter_id
              AND day_of_week = :dow AND step_index BETWEEN :s AND :e
              AND COALESCE(is_deleted, 0) = 0
            GROUP BY turn_dir_no
        """
        rows = read_pg_rows(self.settings, sql,
                            {"inter_id": inter_id, "dow": dow, "s": s, "e": e})
        turn_flow = {r["turn_dir_no"]: _to_float(r.get("flow")) for r in rows}
        through = turn_flow.get(2, 0.0)
        return {
            "turn_flow_veh_h": {
                "left": turn_flow.get(1),
                "through": through,
                "right": turn_flow.get(3),
                "sum": round(sum(v for v in turn_flow.values() if v is not None), 1),
            },
            "demand_flow_veh_h": through,
        }

    def _query_ew_fallback_metrics(self, target: str, dow: int, s: int, e: int) -> dict[str, Any]:
        """目标路口东/西进口链路速度 + 延时指数（dws_link_index_5min_mm）。"""
        east_link = self._query_approach_link(target, "(东向西)").get("link_id")
        west_link = self._query_approach_link(target, "(西向东)").get("link_id")
        if not east_link or not west_link:
            return {"east_entrance_E2W": {}, "west_entrance_W2E": {}}
        sql = f"""
            SELECT link_id, avg_speed_kmh, delay_index
            FROM {self.flow_schema}.dws_link_index_5min_mm
            WHERE link_id = ANY(:link_ids)
              AND day_of_week = :dow AND step_index BETWEEN :s AND :e
              AND COALESCE(is_deleted, 0) = 0
        """
        rows = read_pg_rows(self.settings, sql,
                            {"link_ids": [east_link, west_link],
                             "dow": dow, "s": s, "e": e})
        by_id = {r["link_id"]: r for r in rows}
        east = by_id.get(east_link, {})
        west = by_id.get(west_link, {})
        return {
            "east_entrance_E2W": {
                "link_id": east_link,
                "avg_speed_kmh": _to_float(east.get("avg_speed_kmh"), None),
                "congestion_delay_index": _to_float(east.get("delay_index"), None),
            },
            "west_entrance_W2E": {
                "link_id": west_link,
                "avg_speed_kmh": _to_float(west.get("avg_speed_kmh"), None),
                "congestion_delay_index": _to_float(west.get("delay_index"), None),
            },
        }

    def _query_approach_link(self, target: str, direction_suffix: str) -> dict[str, Any]:
        """目标路口指定方向（road_name 后缀）的进口主路 link（排除辅路，取最长）。"""
        sql = f"""
            SELECT link_id, road_name FROM {self.schema}.dim_link_info
            WHERE t_inter_id = :target AND strpos(road_name, :suffix) > 0
              AND strpos(road_name, '辅路') = 0
            ORDER BY length_m DESC
        """
        rows = read_pg_rows(self.settings, sql,
                            {"target": target, "suffix": direction_suffix}, limit=1)
        return rows[0] if rows else {}

    @staticmethod
    def _road_prefix(link_info: dict[str, Any]) -> str:
        """road_name 的道路名（冒号前），如 '经十路:奥体东路-...' → '经十路'。"""
        name = link_info.get("road_name") or ""
        return name.split(":")[0].strip() if name else ""

    def _query_saturation(self, inter_id: str, dow: int, s: int, e: int) -> list[dict[str, Any]]:
        sql = f"""
            SELECT dir8_code, turn_dir_no, turn_saturation
            FROM {self.flow_schema}.dws_turn_saturation_5min_mm
            WHERE inter_id = :inter_id
              AND day_of_week = :dow AND step_index BETWEEN :s AND :e
              AND COALESCE(is_deleted, 0) = 0
        """
        return read_pg_rows(self.settings, sql,
                            {"inter_id": inter_id, "dow": dow, "s": s, "e": e})

    def _query_turn_flow(self, inter_id: str, dow: int, s: int, e: int) -> list[dict[str, Any]]:
        sql = f"""
            SELECT dir8_code, turn_dir_no, SUM(turn_flow_total) AS flow
            FROM {self.flow_schema}.dws_inter_link_turn_flow_5min_mm
            WHERE inter_id = :inter_id
              AND day_of_week = :dow AND step_index BETWEEN :s AND :e
              AND COALESCE(is_deleted, 0) = 0
            GROUP BY dir8_code, turn_dir_no
        """
        return read_pg_rows(self.settings, sql,
                            {"inter_id": inter_id, "dow": dow, "s": s, "e": e})


def _to_float(value: Any, default: float | None = 0.0) -> float | None:
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _step_label(step_index: int) -> str:
    """step 序号（5 分钟粒度）→ 时间标签，如 208 → '17:20-17:25'。"""
    start = step_index * 5
    end = start + 5
    return f"{start // 60:02d}:{start % 60:02d}-{end // 60:02d}:{end % 60:02d}"


def _los(saturation: float) -> str:
    """饱和度 → 服务水平（HCM 简化）。"""
    if saturation >= 1.0:
        return "F"
    if saturation >= 0.9:
        return "E"
    if saturation >= 0.8:
        return "D"
    if saturation >= 0.7:
        return "C"
    if saturation >= 0.6:
        return "B"
    return "A"

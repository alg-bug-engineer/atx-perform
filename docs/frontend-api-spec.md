# 前端 API 接口规范（最终版）

> 面向后端开发实现与前后端联调。数据字段语义与详细示例见 `docs/frontend-data-requirements.md`，本文仅定义接口契约。

## 0. 通用约定

| 项 | 约定 |
|----|------|
| Base URL | `/api/v1`（前端 `services/api/client.js` 统一前缀，联调代理透传） |
| 协议 | HTTPS/HTTP，请求/响应体均为 `application/json; charset=utf-8` |
| 数值字段 | 一律 `number`，缺值用 `null`，禁止 `0`/空串占位；缺值须附带 `gaps` 或 `note` 说明 |
| 错误响应 | `{ "ok": false, "reason": "http_404 | network_error | ...", "detail": "..." }`（前端 `isApiError` 识别 `ok===false`） |
| 时间窗 | 请求侧：拆为三个标量 query 参数 `day_of_week`(1=周一) / `step_start` / `step_end`（5 分钟粒度）；响应侧：`time_window { label, day_of_week, day_of_week_label, step_start, step_end }`。默认 `1` / `210` / `221`（周一晚高峰 17:00-19:00） |
| 方向/转向 | `dir8_code` 0北/2东/4南/6西；`turn_dir_no` 1左转/2直行/3右转 |
| 路况语义色 | `derived_state_from_speed` 1绿/2黄/3红/4深红（≥35/≥20/≥10/<10 km/h），`null`=无数据 |
| 入参定位 | 所有 GET 接口参数均**可选**，缺省回退演示默认值（§0.1）；`case_id` 为场景锚定参数（各幕均支持），业务主键（`link_id` / `target_inter_id` / `skill_id`）优先于 `case_id`；优先级：业务主键 > `case_id` > 默认值 |

### 0.1 默认案例速查表（演示 Demo 缺省值）

本工程当前数据为演示 Demo（Case A · 奥体西路×经十路，线优化）；真实部署时后端按入参定位任意路口/路段/时段，参数缺省时回退下表默认值：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `case_id` | `case_aotixi` | 剧本案例清单 ID（`frontend/src/config/demo-cases.json` 定义 5 个案例）；注：幕 1 实时路况 `traffic/color-links` 的 `case_id` 为另一体系标识 `aotixi-jingshi-north-through`（前端固定传值） |
| `link_id`（问题路段） | `12wwe28fmwwe28ct01` | 奥体西路:解放东路-经十路(北向南)，幕 1/3/4 定位用 |
| `target_inter_id`（溯源汇点） | `011wwe28ctu00001` | 奥体西路与经十路路口，幕 2 溯源用 |
| `day_of_week` / `step_start` / `step_end` | `1` / `210` / `221` | 时间窗三标量参数（周一晚高峰 17:00-19:00，5 分钟粒度） |
| `trace_type` / `max_hop` | `upstream` / `3` | 幕 2 溯源方向与最大跳数 |
| `line_id` | `wwe2bswwwe23pb01` | 奥体西路干线（幕 3b 协调区间） |
| `segment_key` | `opt-5:早高峰` | 协调子区键（幕 3b `signal_plan` 块） |
| `skill_id` | `aotixi-n2s-phase-coord-evening` | 技能包目录键（幕 5） |

## 1. 接口总览

| # | 幕 | 业务职责 | 方法与路径 | 请求体 | 说明 |
|---|----|----------|------------|--------|------|
| 1 | 0 | 主动巡检（城市监控总览） | `GET /api/v1/patrol/overview` | Query | 开场镜头 + 问题路段几何 + 城市监控数据 |
| 2 | 1 | 问题定位 | `GET /api/v1/problem/locate` | Query | 指标卡 + 16 条 link 路况着色 + 双路口渠化 |
| 3 | 1 | 问题定位 · 实时路况 | `GET /api/v1/traffic/color-links` | Query | 已有接口，前端已接入 |
| 4 | 2 | 分析成因 · 流量溯源 | `GET /api/v1/cause/flow-trace` | Query | 溯源拓扑 + 供需核验 + 下游约束 |
| 5 | 3 | 优化方案 | `GET /api/v1/optimization/plan` | Query | 现状/优化配时 + 走廊微观仿真参数 + 引擎方案（含幕 3b 数据源 `signal_plan` 块） |
| 6 | 4 | 效果预评估 | `GET /api/v1/effect/trial` | Query | 试运行基线/目标/阈值 + 复用幕 3 仿真 |
| 7 | 5 | 技能固化 · 数据读取 | `GET /api/v1/skill/package` | Query | 经验吸收 + 技能包构建蓝图 |
| 8 | 5 | 技能固化 · 落盘 | `POST /api/v1/agent/skill/solidify` | JSON | 已有接口，前端已接入 |

> 幕 3b（信控方案调节）与幕 3 数据同源：**不提供独立接口**，直接复用 `optimization/plan` 返回中的 `signal_plan` 块（字段定义见 §7）。

---

## 2. GET /api/v1/patrol/overview（幕 0 · 主动巡检）

### 2.1 请求

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| `case_id` | query | string | 否 | 巡检聚焦案例 ID，决定 `opening.camera.pull_in_targets` 与 `scene_objects.problem_link` 高亮；默认 `case_aotixi` |
| `day_of_week` / `step_start` / `step_end` | query | number | 否 | 时间窗三标量参数（见 §0）；默认 `1` / `210` / `221`（周一晚高峰 17:00-19:00） |

### 2.2 出参

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `meta` | object | ✅ | `scene_index: 0`、`name`、`version` |
| `opening` | object | ✅ | 开场分镜：`camera { overview_center{lon,lat}, problem_link_id, pull_in_targets[] }`、`actions[] { id, do, link_id }` |
| `scene_objects` | object | ✅ | `intersections { downstream_jingshi{inter_id,inter_name,lon,lat}, upstream_jiefang{...} }`、`problem_link { link_id, road_name, direction, f_inter_id, t_inter_id, length_m, lane_num, lane_info, geom, storage_length_m }`、`opposite_link` |
| `city_monitor` | object | ✅ | `cityOverview { stats{totalIntersections,monitoredIntersections,abnormalIntersections,abnormalCorridors,abnormalRegions,optimizingObjects,todayOptimizations,avgSpeed,avgDelay,congestionIndex}, agentStatus{master,sceneCognition,problemDiagnosis,controlStrategy,planGeneration,evaluationFeedback}, humanIntervention, topIssues[], topImprovements[] }`、`regions[]`、`corridors[]`、`intersections[]` |

`corridors[]` 元素：`{ id, name, path, status('critical'/'warning'/'optimizing'/'optimized'/'normal'), stopRate, saturation, pinFirst, intersectionIds[], issues[] }`，必须包含 `COR-AOTIXI-JFD-JS`。
`intersections[]` 元素：`{ id, name, lat, lng, status, saturation, flow, imbalanceIndex, pinFirst, issues[] }`。
`regions[]` 元素：`{ id, name, center, polygon, status, saturation, avgSpeed, avgDelay, congestionIndex, primaryIssue, intersectionCount, issues[] }`。

### 2.3 出参示例

```json
{
  "meta": { "scene_index": 0, "name": "主动巡检", "version": "1.0.0" },
  "opening": {
    "camera": { "overview_center": { "lon": 117.11137, "lat": 36.66128 },
                "problem_link_id": "12wwe28fmwwe28ct01",
                "pull_in_targets": ["011wwe28fmc00001", "011wwe28ctu00001"] },
    "actions": [ { "id": "scan", "do": "corridor_or_map_scan" },
                 { "id": "alert", "do": "problem_link_red_blink",
                   "link_id": "12wwe28fmwwe28ct01" } ]
  },
  "scene_objects": {
    "intersections": {
      "downstream_jingshi": { "role": "downstream_target", "inter_id": "011wwe28ctu00001",
                              "inter_name": "奥体西路与经十路路口", "lon": 117.111376, "lat": 36.659469 },
      "upstream_jiefang": { "role": "upstream_overflow_risk", "inter_id": "011wwe28fmc00001",
                            "inter_name": "奥体西路与解放东路路口", "lon": 117.111368, "lat": 36.663092 }
    },
    "problem_link": { "link_id": "12wwe28fmwwe28ct01",
                      "road_name": "奥体西路:解放东路-经十路(北向南)", "direction": "N_to_S",
                      "f_inter_id": "011wwe28fmc00001", "t_inter_id": "011wwe28ctu00001",
                      "length_m": 367.89, "lane_num": 5, "lane_info": "B|B|C|C|D",
                      "geom": { "type": "LineString", "coordinates": [[117.11127, 36.662986], "..."] },
                      "storage_length_m": 367.89 }
  },
  "city_monitor": {
    "cityOverview": { "stats": { "totalIntersections": 1248, "monitoredIntersections": 986,
                                 "abnormalIntersections": 45, "avgSpeed": 24.6,
                                 "avgDelay": 68.3, "congestionIndex": 3.8 },
                      "agentStatus": { "master": { "status": "running", "queue": 4,
                                                   "successRate": 0.97, "lastRun": "..." } },
                      "topIssues": [ { "type": "corridor", "id": "COR-AOTIXI-JFD-JS",
                                       "name": "奥体西路（解放东-经十）",
                                       "issue": "北向南排队外溢", "severity": "critical" } ] },
    "corridors": [ { "id": "COR-AOTIXI-JFD-JS", "name": "奥体西路（解放东-经十）",
                     "status": "critical", "saturation": 1.28, "pinFirst": true,
                     "intersectionIds": ["INT-JN-OTX-JFD", "INT-JN-OTX-JS"] } ],
    "intersections": [ { "id": "INT-JN-OTX-JS", "name": "奥体西路与经十路路口",
                         "lat": 36.659469, "lng": 117.111376, "status": "critical",
                         "saturation": 1.28, "flow": 824, "imbalanceIndex": 0.8 } ],
    "regions": []
  }
}
```

---

## 3. GET /api/v1/problem/locate（幕 1 · 问题定位）

### 3.1 请求

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| `case_id` | query | string | 否 | 场景锚定案例；默认 `case_aotixi` |
| `link_id` | query | string | 否 | 问题路段 ID；默认 `12wwe28fmwwe28ct01`。传入时 `traffic_color_links` / `problem_link_metrics` / 渠化按该路段所在双路口组装；与 `case_id` 同时传入时**本参数优先** |
| `day_of_week` / `step_start` / `step_end` | query | number | 否 | 时间窗三标量参数（见 §0）；默认 `1` / `210` / `221` |

### 3.2 出参

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `meta` | object | ✅ | `scene_index: 1`、`name`、`time_window` |
| `locate` | object | ✅ | 问题定位主数据（见下） |
| `channelization` | object | ✅ | 双路口渠化几何 |
| `scene_objects` | object | ✅ | 与幕 0 同结构（`intersections`/`problem_link`） |

`locate` 关键字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `map_beats` | object | ✅ | 各拍 `{ lock, nodes, conclusion, channelization, queue, m-queue, m-speed, m-sat }`，每拍 `{ headline, caption, approx_sec, panel{ kind, title, hero, rows[]{label,value}, note } }` |
| `problem_link_metrics` | object | ✅ | `link_id`、`avg_speed_kmh`、`congestion_delay_index`、`jam_delay_index_weekly`、`queue_length_m`(专家 270)、`queue_length_source`、`storage_length_m`、`storage_length_source` |
| `jingshi_north_through_saturation` | object | ✅ | `inter_id`、`dir8_code`、`dir_label`、`turn_dir_no`、`turn_label`、`turn_saturation`(0.843)、`db_supported` |
| `jingshi_ew_metrics` | object | ✅ | `east_approach_through_saturation`、`west_approach_through_saturation`、`east_to_west_arrow{from_dir,to_dir,link_id,turn_flow_veh_h}`、`intersection_saturation_max`、`gaps[]`、`fallback_metrics{west_entrance_W2E,east_entrance_E2W,west_exit_E2W,east_exit_W2E}`（各含 `avg_speed_kmh`/`congestion_delay_index`）、`primary_display{east_entrance,west_entrance}` |
| `jiefang_east_metrics` | object | ✅ | `inter_id`、`east_approach_through_saturation`、`east_approach_left_saturation`、`db_supported`、`gaps[]` |
| `jingshi_ew_turn_flow` | object | ✅ | `east_entrance{turn_flow_veh_h{left,through,right,sum},through_saturation}`、`west_entrance{...}`、`impact_prediction{intersection_saturation_max,intersection_los,through_impact,turn_impact,delay_scope}` |
| `traffic_color_links` | array | ✅ | 16 条 link：`link_id`、`road_name`、`length_m`、`geom{LineString}`、`avg_speed_kmh`、`delay_index_mm`、`jam_delay_index_weekly`、`db_max_state`、`derived_state_from_speed`(1-4或null)、`color`、`is_problem_link` |
| `state_legend` | object | ✅ | `{ "1": "绿", "2": "黄", "3": "红", "4": "红" }` |

`channelization`：`by_intersection { [inter_id]: { inter_name, arms[] } }`；`arms[]` 元素：`inter_id, link_id, link_role, approach_angle, dir8_code, dir8_label, dir4_code, dir4_label, lane_num, c_lane_num, lane_info, turn_move, f_dist_m, t_dist_m`。必须包含 `011wwe28ctu00001`（经十）、`011wwe28fmc00001`（解放东）两个路口。

### 3.3 出参示例

```json
{
  "meta": { "scene_index": 1, "name": "问题定位",
            "time_window": { "label": "周一晚高峰 17:00-19:00", "day_of_week": 1,
                             "day_of_week_label": "周一", "step_start": 210, "step_end": 221 } },
  "locate": {
    "map_beats": {
      "m-queue": { "headline": "排队长度 270 m", "caption": "蓄车 368 m，排队比 0.73 接近预警线",
                   "approx_sec": 7,
                   "panel": { "kind": "m-queue", "title": "排队长度", "hero": "270 m",
                              "rows": [ { "label": "蓄车", "value": "368 m" },
                                        { "label": "排队比", "value": "0.73" } ] } },
      "m-speed": { "headline": "平均速度 7.2 km/h", "caption": "通行速度偏低，延时指数 5.28",
                   "panel": { "kind": "m-speed", "title": "平均速度", "hero": "7.2 km/h",
                              "rows": [ { "label": "延时指数", "value": "5.28" } ] } },
      "m-sat": { "headline": "饱和度 0.84", "caption": "下游经十路口东西向饱和度偏高",
                 "panel": { "kind": "m-sat", "title": "饱和度", "hero": "0.84",
                            "rows": [ { "label": "预警线", "value": "0.8" } ] } }
    },
    "problem_link_metrics": { "link_id": "12wwe28fmwwe28ct01", "avg_speed_kmh": 7.2,
                              "congestion_delay_index": 5.28, "jam_delay_index_weekly": 1.32,
                              "queue_length_m": 270, "queue_length_source": "expert_survey",
                              "storage_length_m": 367.89,
                              "storage_length_source": "dim_link_info.length_m" },
    "traffic_color_links": [
      { "link_id": "12wwe28fmwwe28ct01", "road_name": "奥体西路:解放东路-经十路(北向南)",
        "length_m": 367.89, "geom": { "type": "LineString", "coordinates": ["..."] },
        "avg_speed_kmh": 7.2, "delay_index_mm": 5.28, "jam_delay_index_weekly": 1.32,
        "db_max_state": 1, "derived_state_from_speed": 4, "color": "red",
        "is_problem_link": true }
    ]
  },
  "channelization": {
    "by_intersection": {
      "011wwe28ctu00001": { "inter_name": "奥体西路与经十路路口",
                            "arms": [ { "inter_id": "011wwe28ctu00001",
                                        "link_id": "12wwe28fmwwe28ct01", "link_role": "N_to_S",
                                        "approach_angle": 0.0, "dir8_code": 0,
                                        "dir8_label": "北进口", "lane_num": 5,
                                        "lane_info": "B|B|C|C|D", "turn_move": 11,
                                        "f_dist_m": 0.0, "t_dist_m": 367.89 } ] }
    }
  },
  "scene_objects": { "intersections": { "...": "..." }, "problem_link": { "...": "..." } }
}
```

---

## 4. GET /api/v1/traffic/color-links（幕 1 · 实时路况，已有）

### 4.1 请求（Query）

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| `case_id` | query | string | 否 | 案例标识；默认 `aotixi-jingshi-north-through`（前端固定传值，保持既有语义） |
| `day_of_week` | query | number | 否 | 周型（1=周一）；默认 `1` |
| `step_start` | query | number | 否 | 起始 5 分钟步序号；默认 `210` |
| `step_end` | query | number | 否 | 结束步序号；默认 `221` |

### 4.2 出参

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `links` | array | ✅ | 元素：`link_id, road_name, length_m, geom, avg_speed_kmh(number|null), delay_index(number|null), derived_state(1|2|3|4|null，可选——缺省前端按速度派生), is_problem_link(boolean), queue_length_m?(number)` |

### 4.3 出参示例

```json
{
  "links": [
    { "link_id": "12wwe28fmwwe28ct01", "road_name": "奥体西路:解放东路-经十路(北向南)",
      "length_m": 367.89, "geom": { "type": "LineString", "coordinates": ["..."] },
      "avg_speed_kmh": 7.2, "delay_index": 5.28, "derived_state": 4,
      "is_problem_link": true }
  ]
}
```

---

## 5. GET /api/v1/cause/flow-trace（幕 2 · 分析成因 / 流量溯源）

### 5.1 请求

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| `case_id` | query | string | 否 | 场景锚定案例；默认 `case_aotixi`（业务主键 `target_inter_id` 优先） |
| `target_inter_id` | query | string | 否 | 溯源汇点路口 ID（问题路段下游）；默认 `011wwe28ctu00001`。真实部署传入任意路口即追溯其上游来流路径 |
| `trace_type` | query | string | 否 | 溯源方向：`upstream` / `downstream`；默认 `upstream` |
| `max_hop` | query | number | 否 | 最大追溯跳数（chain_hop）；默认 `3` |
| `day_of_week` / `step_start` / `step_end` | query | number | 否 | 时间窗三标量参数（见 §0）；默认 `1` / `210` / `221` |

### 5.2 出参

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `meta` | object | ✅ | `scene_index: 2`、`name`、`approaches[]`、`target_approaches[]` |
| `flow_trace` | object | ✅ | 溯源主数据（见下） |
| `cause_analysis` | object | ✅ | 降级指标与原始溯源表 |

`flow_trace` 关键字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `trace_direction` / `business_direction` | string | ✅ | `"upstream"` / `"incoming"` |
| `source` / `via` / `target` | object | ✅ | 各含 `id, name, lng, lat`；`target` 另含 `direction, movement` |
| `source_approaches[]` / `via_approaches[]` / `target_approaches[]` | array | ✅ | 各进口 `{ dir('N'/'E'/'W'), label, from_name }` |
| `upstream_share_display` | object | ✅ | `source_ratio(32.4)`、`via_ratio(48.1)`、`mock` |
| `problem_link` | object | ✅ | `link_id, road_name, from_name, to_name` |
| `demand_supply` | object | ✅ | `step_index, step_label, day_of_week, inflow_pcu_h, outflow_pcu_h, supply_pcu_h, supply_formula, demand_pcu_h, demand_formula, demand_lanes[]{lane_no,turn,cap}, supply_gt_demand, has_receiving_capacity, conclusion, table_rows[]{label,value}` |
| `downstream_constraint` | object | ✅ | `metrics{ east_through_flow_pcu_h, east_through_saturation, west_through_flow_pcu_h, west_through_saturation, north_through_flow_pcu_h, north_through_saturation, intersection_saturation_max, intersection_los }`、`approach_cards[]{role,name,saturation,flow_pcu_h}`、`gaps[]`、`hint`、`copy[]{id,text}`、各段毫秒时长 `{hold_ms,clear_ms,frame_ms,ew_flow_ms,signal_ms,overflow_ms}` |
| `map_beats` | object | ✅ | `{ trace, supply, arterial, signal, channel_change, cycle_mismatch }`，各含 `headline/caption`，部分含 `ms/clear_ms/split_ms` |
| `road_labels[]` | array | ✅ | `{ name, at('source'/'via'/'target'/'problem_mid'), dx, dy }` |

`cause_analysis` 关键字段：`meta`、`jingshi_ew_fallback_metrics { east_entrance_E2W{link_id,avg_speed_kmh,congestion_delay_index}, west_entrance_W2E{...} }`、`upstream_traces.by_turn { left[], through[], right[] }`（元素含 `flow_share_ratio, chain_hop, cor_inter_id, cor_inter_name`）、`demand_supply{ turn_flow_veh_h, demand_flow_veh_h, supply_capacity_veh_h, demand_exceeds_supply, narrative_claim }`、`downstream_constraint{ east_through_saturation, west_through_saturation, intersection_saturation_max, intersection_los, story }`。

### 5.3 出参示例

```json
{
  "meta": { "scene_index": 2, "name": "分析成因-上游流量溯源",
            "approaches": ["北进口", "东进口", "西进口"], "target_approaches": ["北进口"] },
  "flow_trace": {
    "source": { "id": "011wwe28fty00001", "name": "坤顺路与奥体西路路口",
                "lng": 117.11126, "lat": 36.665179 },
    "via": { "id": "011wwe28fmc00001", "name": "奥体西路与解放东路路口",
             "lng": 117.111368, "lat": 36.663092 },
    "target": { "id": "011wwe28ctu00001", "name": "奥体西路与经十路路口",
                "lng": 117.111376, "lat": 36.659469,
                "direction": "北向南", "movement": "直行" },
    "upstream_share_display": { "mock": true, "source_ratio": 32.4, "via_ratio": 48.1 },
    "demand_supply": { "step_index": 208, "step_label": "17:20-17:25", "day_of_week": 1,
                       "inflow_pcu_h": 429, "outflow_pcu_h": 824, "supply_pcu_h": 824,
                       "demand_pcu_h": 1285.6, "supply_gt_demand": false,
                       "has_receiving_capacity": true,
                       "conclusion": "当前通行量低于车道能力上限，本段仍有承接余量",
                       "table_rows": [ { "label": "当前通行流量", "value": "824 pcu/h" },
                                       { "label": "车道能力上限", "value": "1285.6 pcu/h" } ] },
    "downstream_constraint": {
      "metrics": { "east_through_flow_pcu_h": 1230, "east_through_saturation": 0.76,
                   "west_through_flow_pcu_h": 1180, "west_through_saturation": 0.73,
                   "north_through_flow_pcu_h": 824, "north_through_saturation": 1.28,
                   "intersection_saturation_max": 1.29, "intersection_los": "F" },
      "approach_cards": [ { "role": "东进口", "name": "经十路", "saturation": 0.76,
                            "flow_pcu_h": 1230 } ],
      "gaps": ["GAP-WEST-SAT"],
      "hint": "成因不在路段供给不足，而在下游主干道优先保障下的绿灯约束。" },
    "map_beats": { "trace": { "caption": "追溯上游来源，车流主要来自奥体西路北直行和解放东路西进口右转",
                              "headline": "流量由北向南汇入经十路口" },
                   "signal": { "ms": 3400, "schematic": true, "gap": "相位环非库内绿秒",
                               "caption": "受主干道优先约束，当前周期内难以再为北向南直行释放有效绿灯窗口",
                               "headline": "北向南难以增配有效绿灯" } }
  },
  "cause_analysis": {
    "jingshi_ew_fallback_metrics": {
      "east_entrance_E2W": { "link_id": "12wwe291ewwe28ct01", "avg_speed_kmh": 14.51,
                             "congestion_delay_index": 5.81 },
      "west_entrance_W2E": { "link_id": "12wwe289qwwe28ct01", "avg_speed_kmh": 26.21,
                             "congestion_delay_index": 3.41 } }
  }
}
```

---

## 6. GET /api/v1/optimization/plan（幕 3 · 优化方案）

### 6.1 请求

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| `case_id` | query | string | 否 | 场景锚定案例；默认 `case_aotixi`（业务主键 `link_id` 优先） |
| `link_id` | query | string | 否 | 问题路段 ID，决定 `corridor_demo` 仿真几何与上下游路口；默认 `12wwe28fmwwe28ct01` |
| `line_id` | query | string | 否 | 干线 ID，决定 `signal_plan` 协调区间（幕 3b 数据源）；默认 `wwe2bswwwe23pb01` |
| `segment_key` | query | string | 否 | 协调子区键，决定 `signal_plan` 块内容；默认 `opt-5:早高峰` |
| `day_of_week` / `step_start` / `step_end` | query | number | 否 | 时间窗三标量参数（见 §0），作用于 `optimization` 块；默认 `1` / `210` / `221`（`signal_plan` 块按自身 `period` 返回） |

### 6.2 出参

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `meta` | object | ✅ | `scene_index: 3`、`name`、`strategy`、`time_window` |
| `optimization` | object | ✅ | 方案与仿真主数据（见下） |
| `signal_plan` | object | ✅ | 引擎信控方案（幕 3b 数据源，前端幕 3b 场景直接消费本块，字段定义见 §7） |

`optimization` 关键字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `baseline_signal_plans` | object | ✅ | `{ jingshi, jiefang }`，各含 `day_plan_no, period{start,end,plan_no}, plan{config{inter_id,plan_no,plan_name,cycle_len_sec,coord_stage_no,offset_sec,stage_cnt}, stages[]{stage_seq_no,stage_no,green_sec,yellow_sec,all_red_sec,stage_total_sec}}` |
| `optimized_signal_plans` | object | ✅ | `measure, summary, status('proposed'), offset_shift_sec{intersection,value,note}, release_timing_vs_downstream_green_sec{before,after,unit,movement,derived_from}, donor_green_delta_sec{movement,before,after,delta,note}, unchanged[]` |
| `corridor_demo` | object | ✅ | `cycle_len_sec, playback{default_speed,speed_options[]}, link{link_id,road_name,length_m,storage_length_m,warning_length_m,lanes[]{index,turn,label}}, upstream{inter_id,inter_name,cross_road,release_label,link_storage_m}, downstream{inter_id,inter_name,cross_road,release_label,north_through_saturation}, variants[]{key('before'/'after'),title,subtitle,tone}, kpis[]{key,label,unit,before,after,better,source,note}, data_note` |
| `corridor_demo.simulation` | object | ✅ | `cycle_len_sec, step_sec, warmup_cycles, seed, display_anchor{intersection,movement,lead_in_sec}, geometry{length_m,widen_len_m,taper_len_m,widen_side,upstream_lanes[]{index,side,label,group},downstream_lanes[]{index,label,group,from_upstream},field_note}, vehicle{length_m,space_m,free_speed_mps,reaction_sec,accel_mps2,stopped_speed_mps,enter_speed_mps,through_from_bus_share,startup_loss_sec,saturation_headway_sec,source_headway_sec,right_yield_factor,left_headway_factor,uturn_headway_factor}, turn_split{left,through,right,db_supported}, sources[]{key,label,dir8,turn,veh_per_cycle,spread,lanes,note}, alignment{jingshi{stage1_start_s},jiefang{stage1_start_before_s,stage1_start_after_s,note}}, observation{residual_after_jingshi_green_m,release_ratio,note}, demand{measured{north_through_pcu_h,...},saturation{north_through},proxy{left_pcu_h,right_pcu_h},field_factor}` |
| `signal_plan_board` | object | ✅（可选） | 专家建议相位板（`signal_plan` 块缺失时前端回退此处）：`reference_inter_key, reference_offset_s, dir8_label, turn_label, intersections[]{key,inter_id,inter_name,role,plan_no,cycle_len_sec,offset_before_s,offset_after_s,offset_delta_s,note,stages[]{stage_seq_no,stage_no,green_before_s,green_after_s,green_delta_s,yellow_sec,all_red_sec,min_green_sec,max_green_sec,total_before_s,total_after_s,movements[]{dir8,turn,label},role,feeds_problem_link,note}}, danger_window_s, coord_target_note` |

### 6.3 出参示例

```json
{
  "meta": { "scene_index": 3, "name": "优化方案", "strategy": "相位协调（轻微截流不致上游溢出）",
            "time_window": { "label": "周一晚高峰 17:00-19:00", "day_of_week": 1 } },
  "optimization": {
    "optimized_signal_plans": { "measure": "phase_coordination", "status": "proposed",
                                "offset_shift_sec": { "intersection": "jiefang", "value": 56 },
                                "release_timing_vs_downstream_green_sec": { "before": -26,
                                                                            "after": 36, "unit": "s" },
                                "donor_green_delta_sec": { "movement": "解放东路口 北进口直行",
                                                           "before": 21, "after": 15, "delta": -6 } },
    "corridor_demo": {
      "cycle_len_sec": 220,
      "kpis": [ { "key": "peak_queue", "label": "排队峰值", "unit": "m",
                  "before": 368, "after": 257, "better": "lower" },
                { "key": "spill_duration", "label": "路口溢出时长", "unit": "s",
                  "before": 84, "after": 0, "better": "lower" },
                { "key": "blocked_veh", "label": "路口滞留车辆", "unit": "辆",
                  "before": 36, "after": 9, "better": "lower" } ],
      "simulation": { "cycle_len_sec": 220, "step_sec": 0.5, "warmup_cycles": 4, "seed": 20260812,
                      "geometry": { "length_m": 367.89, "widen_len_m": 100, "taper_len_m": 26,
                                    "widen_side": "east" },
                      "turn_split": { "left": 0.39, "through": 0.49, "right": 0.12 },
                      "sources": [ { "key": "north_through", "label": "北进口直行",
                                     "dir8": 0, "turn": 2, "veh_per_cycle": 36, "lanes": 3 } ],
                      "alignment": { "jingshi": { "stage1_start_s": 200 },
                                     "jiefang": { "stage1_start_before_s": 83,
                                                  "stage1_start_after_s": 139 } } }
    },
    "signal_plan_board": {
      "intersections": [ { "key": "jiefang", "inter_id": "011wwe28fmc00001",
                           "inter_name": "奥体西路与解放东路路口",
                           "offset_before_s": 83, "offset_after_s": 139, "offset_delta_s": 56,
                           "stages": [ { "stage_seq_no": 5, "stage_no": 12,
                                         "green_before_s": 21, "green_after_s": 15,
                                         "green_delta_s": -6,
                                         "movements": [ { "dir8": 0, "turn": 2, "label": "北直" } ],
                                         "feeds_problem_link": true } ] } ]
    }
  },
  "signal_plan": { "meta": { "title": "信控方案调节", "period_label": "早高峰" },
                   "corridor": { "cycle_s": 220, "bandwidth": { "chained_forward_s": 97.7,
                                                                "chained_reverse_s": 131.7 } },
                   "nodes": [], "links": [], "kpis": [], "diagram": null, "brief": {},
                   "guardrails": {}, "candidates": [] }
}
```

---

## 7. `signal_plan` 块定义（幕 3b · 信控方案调节数据源）

> 幕 3b 无独立接口，本块经 `GET /api/v1/optimization/plan` 出参返回；前端 `Scene3bSignalPlan` 取 `response.signal_plan` 渲染。

### 7.2 块字段定义

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `meta` | object | ✅ | `title, subtitle, source{engine,algorithm,version,line_id,line_name,segment_key,source_kind,db_supported}, period_label, period_window, scenario_label, strategy_package, strategy, strategy_label, strategy_family_label, recommendation_status('recommended'/'not_recommended'), requires_human_confirm, selection_reason, min_green_s` |
| `corridor` | object | ✅ | `cycle_s, baseline_cycles_s[], design_speed_kmh, forward_dir8, reverse_dir8, forward_label, reverse_label, coordinated_direction('forward'/'reverse'), bandwidth{chained_forward_s,chained_reverse_s}, focus_link{from,to,length_m,note}` |
| `nodes` | array | ✅ | 3 个路口：`inter_id, name, short_name, is_focus, cum_length_m, dist_m, coord_stage_no, baseline{cycle_s,offset_s,coord_green_s,coord_green_forward_s,coord_green_reverse_s,stages[]{stage_no,name,green_s,yellow_s,all_red_s,total_s,movements[]{dir8,turn}}}, optimized{同结构}, offset_delta_s` |
| `links` | array | ✅ | `from, to, length_m, forward_speed_kmh, reverse_speed_kmh, travel_time_forward_s, travel_time_reverse_s` |
| `kpis` | array | ✅ | `name, label, baseline, optimized, delta, direction, improved(true/false/null), confidence`；必须含 `chained_bandwidth_s, travel_time_s, coordinated_direction_delay_s, cross_direction_delay_s, max_queue_length_m` |
| `diagram` | object | ⚠️ 可空 | 时距图（优化后必返回；现状侧可 `null`）：`source, cycle_s, cum_distance_m[], t_min_s, t_max_s, windows[]{node(下标),dir,role,t0,t1}, vehicles[]{dir,role,meta,pts[[t,dist]...]}, queue_tails[点列], bands[]{dir,pts}, evaluation{chained_bandwidth_forward_s,chained_bandwidth_reverse_s,direction_kpis[]{direction,bandwidth_s,demand_weighted_delay_s,mean_delay_s,stop_rate,max_queue_ratio,mean_queue_ratio,spill_area_veh_s,service_rate,unserved_fraction,vehicles_created,vehicles_exited,vehicles_eligible},notes[],warnings[]}` |
| `brief` | object | ✅ | `problem, strategy, expected_effect, highlights[]{topic,text}, issue_labels[]` |
| `guardrails` | object | ✅ | `regression_flags[]{code,metric,severity,message}, notes[], data_confidence, min_green_violations[]{inter_id,name,stage_no,green_s}` |
| `candidates` | array | ✅ | `candidate_id, label, strategy, score_delta, selected, chained_score` |

### 7.3 块示例

```json
{
  "meta": { "title": "信控方案调节", "subtitle": "奥体西路干线协调 · 早高峰 07:00–09:00",
            "source": { "engine": "traffic_signal_deepagent · 干线方案生成", "version": "1.1.0",
                        "line_id": "wwe2bswwwe23pb01", "segment_key": "opt-5:早高峰",
                        "source_kind": "workbench_authoritative", "db_supported": true },
            "period_label": "早高峰", "period_window": "07:00-09:00",
            "strategy": "congestion_capacity_balance", "strategy_label": "拥堵通行能力均衡",
            "recommendation_status": "not_recommended",
            "selection_reason": "候选池共评估 6 个方案，均未达到接受门槛，维持现状",
            "min_green_s": 12.0 },
  "corridor": { "cycle_s": 220, "baseline_cycles_s": [200.0, 220.0], "design_speed_kmh": 48.5,
                "coordinated_direction": "reverse",
                "bandwidth": { "chained_forward_s": 97.7, "chained_reverse_s": 131.7 },
                "focus_link": { "from": "奥体西路与解放东路路口", "to": "奥体西路与经十路路口",
                                "length_m": 369.2 } },
  "nodes": [ { "inter_id": "011wwe28fmc00001", "name": "奥体西路与解放东路路口",
               "short_name": "解放东", "is_focus": true, "dist_m": 216.1, "coord_stage_no": 4,
               "baseline": { "cycle_s": 200, "offset_s": 20.0, "coord_green_s": 60.0 },
               "optimized": { "cycle_s": 220, "offset_s": 65.0, "coord_green_s": 56.0 },
               "offset_delta_s": 45.0 } ],
  "links": [ { "from": "解放东", "to": "经十", "length_m": 369.2,
               "forward_speed_kmh": 35.0, "reverse_speed_kmh": 30.0,
               "travel_time_forward_s": 22.2, "travel_time_reverse_s": 25.9 } ],
  "kpis": [ { "name": "chained_bandwidth_s", "label": "链式带宽", "baseline": 0.0,
              "optimized": 97.7, "delta": 97.7, "improved": true, "confidence": 0.85 } ],
  "diagram": { "source": "traffic_signal_deepagent · /corridor/space-time · 服务端 Newell 轨迹",
               "cycle_s": 220.0, "cum_distance_m": [0.0, 216.1, 585.3],
               "t_min_s": 0.0, "t_max_s": 1003.0,
               "windows": [ { "node": 0, "dir": "forward", "role": "coordinated",
                              "t0": 30.0, "t1": 75.0 } ],
               "vehicles": [ { "dir": "forward", "role": "main",
                               "meta": { "id": "v1", "depart_s": 30.0 },
                               "pts": [[30.0, 0.0], [52.2, 216.1]] } ],
               "queue_tails": [], "bands": [] },
  "brief": { "problem": "针对早高峰区间…", "strategy": "控制策略包「瓶颈保通」…",
             "expected_effect": "候选池共评估 6 个方案，均未达到接受门槛，维持现状",
             "issue_labels": ["路段与节点过饱和", "拥堵蔓延"] },
  "guardrails": { "regression_flags": [], "notes": [], "data_confidence": "partial",
                  "min_green_violations": [ { "inter_id": "011wwe28ctu00001", "name": "经十",
                                              "stage_no": 5, "green_s": 10.0 } ] },
  "candidates": [ { "candidate_id": "opt-5:早高峰-1", "label": "方案1：带宽最大化",
                    "score_delta": 0.85, "selected": false, "chained_score": 0.72 } ]
}
```

---

## 8. GET /api/v1/effect/trial（幕 4 · 效果预评估）

### 8.1 请求

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| `case_id` | query | string | 否 | 场景锚定案例；默认 `case_aotixi`（业务主键 `link_id` 优先） |
| `link_id` | query | string | 否 | 评估对象路段，决定 `baseline` 蓄车/排队与上游约束；默认 `12wwe28fmwwe28ct01` |
| `plan_id` | query | string | 否 | 方案标识，决定 `plan.timing` 与试运行参数；默认 `expert-phase-coordination`（专家建议·相位协调 +56s，当前演示唯一方案） |
| `day_of_week` / `step_start` / `step_end` | query | number | 否 | 时间窗三标量参数（见 §0）；默认 `1` / `210` / `221` |

### 8.2 出参

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `meta` | object | ✅ | `scene_index: 4`、`name`、`ui_theme` |
| `trial_eval` | object | ✅ | 试运行参数（见下） |
| `optimization` | object | ✅ | 复用幕 3 `optimization` 块（主视觉仿真），缺失时前端主视觉降级为空 |

`trial_eval` 关键字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `trial` | object | ✅ | `cycles(5), observation_cycles, cycle_len_s(220), downstream_name, target_label, success, fail, metrics[]('queue_length_m','queue_ratio','avg_speed_kmh','delay_index','upstream_queue_ratio'), success_conditions[], rollback_rules[]` |
| `plan` | object | ✅ | `short_name, name, source_scene, timing{cycle_len_s,cycle_delta_s,target_green_delta_s,donor_green_delta_s(-6),offset_shift_s(56),release_vs_downstream_green_s{before(-26),after(36)},jingshi_offset_note,jiefang_release_note}` |
| `context` | object | ✅ | `intersection, upstream_intersection, time_period_label, problem_link_id` |
| `baseline` | object | ✅ | `queue_length_m(270), storage_length_m(367.89), queue_ratio(0.8), avg_speed_kmh(7.2), delay_index(5.28), green_utilization(0.62), upstream_queue_ratio(0.22), upstream_queue_length_m, upstream_storage_length_m(215.7), upstream_blocked_veh(36), queue_length_source` |
| `trial_targets` | object | ✅ | `start_queue_length_m(270), start_queue_ratio(0.8), end_queue_length_m(230), end_queue_ratio(0.6252), end_speed_kmh(13), end_delay_index(2.1), end_green_utilization(0.68), end_upstream_queue_ratio(0.35), end_upstream_blocked_veh(9), start_note, upstream_tradeoff_note` |
| `thresholds` | object | ✅ | `queue_ratio_warning(0.8), queue_ratio_spillback(1.0), green_utilization_low(0.6), green_utilization_high(0.85), rollback_queue_ratio(0.9)` |
| `db_supported` | boolean | ✅ | 当前 `false` |

> 说明：逐周期序列 `cycles[]`（含 `queue_length_m/queue_ratio/avg_speed_kmh/delay_index/green_utilization/upstream_queue_ratio/upstream_blocked_veh/rolled_back/spillover_risk/improved/note`）由前端从 `baseline + trial_targets + thresholds` 插值派生；后端如需回传真实监测序列，按该结构放入 `trial_eval.cycles`（可选字段），前端优先采用。

### 8.3 出参示例

```json
{
  "meta": { "scene_index": 4, "name": "效果预评估", "ui_theme": "baseline_atx_perform" },
  "trial_eval": {
    "trial": { "cycles": 5, "cycle_len_s": 220, "target_label": "北进口直行",
               "success": "缓解问题路段排队且不加重上游解放东路口溢出风险",
               "metrics": ["queue_length_m", "queue_ratio", "avg_speed_kmh",
                           "delay_index", "upstream_queue_ratio"] },
    "plan": { "short_name": "相位协调试运行", "source_scene": 3,
              "timing": { "cycle_len_s": 220, "donor_green_delta_s": -6, "offset_shift_s": 56,
                          "release_vs_downstream_green_s": { "before": -26, "after": 36 } } },
    "context": { "intersection": "奥体西路与经十路路口",
                 "upstream_intersection": "奥体西路与解放东路路口",
                 "time_period_label": "周一晚高峰 17:00-19:00",
                 "problem_link_id": "12wwe28fmwwe28ct01" },
    "baseline": { "queue_length_m": 270, "storage_length_m": 367.89, "queue_ratio": 0.8,
                  "avg_speed_kmh": 7.2, "delay_index": 5.28, "green_utilization": 0.62,
                  "upstream_queue_ratio": 0.22, "upstream_storage_length_m": 215.7,
                  "upstream_blocked_veh": 36, "queue_length_source": "expert_survey" },
    "trial_targets": { "start_queue_length_m": 270, "start_queue_ratio": 0.8,
                       "end_queue_length_m": 230, "end_queue_ratio": 0.6252,
                       "end_speed_kmh": 13, "end_delay_index": 2.1,
                       "end_green_utilization": 0.68, "end_upstream_queue_ratio": 0.35,
                       "end_upstream_blocked_veh": 9 },
    "thresholds": { "queue_ratio_warning": 0.8, "queue_ratio_spillback": 1.0,
                    "green_utilization_low": 0.6, "green_utilization_high": 0.85,
                    "rollback_queue_ratio": 0.9 },
    "db_supported": false
  },
  "optimization": { "corridor_demo": { "cycle_len_sec": 220, "kpis": ["..."],
                                       "simulation": { "..." : "..." } } }
}
```

---

## 9. GET /api/v1/skill/package（幕 5 · 技能固化 · 读取）

### 9.1 请求

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| `case_id` | query | string | 否 | 场景锚定案例；默认 `case_aotixi`（缺省 `skill_id` 时按 case 推导本轮技能） |
| `skill_id` | query | string | 否 | 技能包目录键；默认 `aotixi-n2s-phase-coord-evening`，**优先于 `case_id`**。真实部署按键检索既有技能库返回吸收/构建蓝图（对齐吸收阶段「检索既有技能库」环节）；查无该键时返回 CREATE 蓝图 |

### 9.2 出参

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `meta` | object | ✅ | `scene_index: 5`、`name`、`ui_theme` |
| `skill` | object | ✅ | 技能包蓝图（见下） |
| `db_supported` | boolean | ✅ | 当前 `false` |

`skill` 关键字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `absorption` | object | ✅ | `action('CREATE'/'UPDATE'), stages[]{key('recap'/'decompose'/'retrieve'/'compare'/'value'/'blueprint'), label, monologue, evidence_chips[]{key,label,value}, duration_ms}, value_snapshot{why_rows[]{key,label,before,after}}` |
| `build` | object | ✅ | `stages[]{key('understanding'/'planning'/'writing_skill_md'/'writing_reference'/'writing_scripts'/'writing_meta'/'packaging'), label, progress(0-100)}, files[]{path('SKILL.md'/'reference.md'/'scripts/*.sql'/'skill.meta.json'), language('markdown'/'sql'/'json'), content}` |
| `result_meta` | object | ✅ | `skillId, skillDir, downloadUrl, intersection, timePeriodLabel, action('created'/'updated')` |

### 9.3 出参示例

```json
{
  "meta": { "scene_index": 5, "name": "技能固化", "ui_theme": "baseline_atx_perform" },
  "skill": {
    "absorption": { "action": "CREATE",
      "stages": [ { "key": "recap", "label": "回顾本轮约束",
                    "monologue": "回顾本轮已采纳的诊断与治理约束：奥体西路与经十路路口 · 北向南直行 · 周一晚高峰 17:00–19:00。",
                    "evidence_chips": [ { "key": "intersection", "label": "路口",
                                          "value": "奥体西路与经十路路口" } ],
                    "duration_ms": 520 } ],
      "value_snapshot": { "why_rows": [ { "key": "reuse", "label": "复用方式",
                                          "before": "手工检索历史工单",
                                          "after": "技能库按标签自动命中" } ] } },
    "build": { "stages": [ { "key": "writing_skill_md", "label": "写入 SKILL.md",
                             "progress": 45 } ],
               "files": [ { "path": "SKILL.md", "language": "markdown",
                            "content": "# 奥体西廊道相位协调技能\n\n## 场景\n…" } ] },
    "result_meta": { "skillId": "aotixi-n2s-phase-coord-evening",
                     "skillDir": "skills/aotixi-n2s-phase-coord-evening",
                     "downloadUrl": "", "intersection": "奥体西路与经十路路口",
                     "timePeriodLabel": "周一晚高峰 17:00-19:00", "action": "created" }
  },
  "db_supported": false
}
```

---

## 10. POST /api/v1/agent/skill/solidify（幕 5 · 技能固化 · 落盘，已有）

### 10.1 请求

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| `skillId` | body | string | ✅ | 技能目录键，如 `aotixi-n2s-phase-coord-evening` |
| `skillDir` | body | string | ✅ | 相对目录，如 `skills/aotixi-n2s-phase-coord-evening` |
| `resultMeta` | body | object | ✅ | 同 §9 `skill.result_meta` 结构 |
| `files` | body | array | ✅ | 同 §9 `skill.build.files[]` 结构（`{path, language, content}`） |

### 10.2 出参

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `ok` | boolean | ✅ | `true` 成功 / `false` 失败（失败时 `reason` 必填） |
| `skillDir` | string | ✅ | 实际写入目录（成功时） |
| `action` | string | ✅ | `'created'` / `'updated'` |
| `reason` | string | ⚠️ 失败时 | 失败原因 |

### 10.3 示例

```json
// 请求
{ "skillId": "aotixi-n2s-phase-coord-evening",
  "skillDir": "skills/aotixi-n2s-phase-coord-evening",
  "resultMeta": { "skillId": "aotixi-n2s-phase-coord-evening", "action": "created" },
  "files": [ { "path": "SKILL.md", "language": "markdown", "content": "..." } ] }

// 响应（成功）
{ "ok": true, "skillDir": "skills/aotixi-n2s-phase-coord-evening", "action": "created" }
// 响应（失败）
{ "ok": false, "reason": "目录已存在且签名不一致" }
```

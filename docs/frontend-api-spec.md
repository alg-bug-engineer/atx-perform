# 前端 API 接口规范（最终版）

> 面向后端开发实现与前后端联调。数据字段语义与详细 JSON 示例见 `docs/data-contract.md`。
> 幕数据统一经 `GET /api/v1/scenes/{scene_key}` 加载（与前端 `services/gateways/sceneDataGateway.js` 对齐），不再为单幕单设业务语义化接口。

## 0. 通用约定

| 项 | 约定 |
|----|------|
| Base URL | `/api/v1`（前端 `services/api/client.js` 统一前缀，联调代理透传） |
| 协议 | HTTPS/HTTP，请求/响应体均为 `application/json; charset=utf-8` |
| 数值字段 | 一律 `number`，缺值用 `null`，禁止 `0`/空串占位；缺值须附带 `gaps` 或 `note` 说明 |
| 错误响应 | `{ "ok": false, "code": "SCENE_NOT_FOUND 等", "reason": "...", "trace_id": "...", "detail"? }`；非 2xx 由 `shared/http.py` 统一规整 |
| 时间窗 | 数据文件内 `time_window { label, day_of_week(1=周一), day_of_week_label, step_start, step_end }`，step 为 5 分钟粒度序号 |
| 方向/转向 | `dir8_code` 0北/2东/4南/6西；`turn_dir_no` 1左转/2直行/3右转 |
| 路况语义色 | `derived_state_from_speed` 1绿/2黄/3红/4深红（≥35/≥20/≥10/<10 km/h），`null`=无数据 |
| 数据轨 | `source` 字段标识 `demo`（读 data/*.json）或 `live`（PG/DeepAgent）；Demo 轨禁止静默回退 |

## 0.1 幕 → 数据集映射（统一接口口径）

`scene_key` 对应前端 `sceneRegistry` 的 key（0-based），每幕返回 `datasets` 分块：

| scene_key | 幕名 | datasets | 对应数据文件 |
|-----------|------|----------|--------------|
| `0` | 主动巡检 | `objects`、`opening` | `1-scene-objects.json`、`1-0-opening.json` |
| `1` | 问题定位 | `objects`、`locate`、`channelization` | `1-scene-objects.json`、`1-1-problem-locate.json`、`1-1-channelization.json` |
| `2` | 分析成因 | `objects`、`cause`、`flowTrace` | `1-scene-objects.json`、`1-2-cause-analysis.json`、`1-2-flow-trace.json` |
| `3` | 优化方案 | `optimization`、`signalPlan` | `1-3-optimization.json`、`1-3-signal-plan.json` |
| `4` | 效果预评估 | `effect`、`optimization` | `1-4-effect-eval.json`、`1-3-optimization.json` |
| `5` | 技能固化 | `skill` | `1-5-skill-solidify.json` |

> 幕 3b（信控方案调节）与幕 3 数据同源，复用 `3` 返回的 `signalPlan` 数据集，不单独成幕。

## 1. 接口总览

| # | 用途 | 方法与路径 | 状态 |
|---|------|------------|------|
| 1 | 按幕加载数据集 | `GET /api/v1/scenes/{scene_key}` | 已实现 |
| 2 | 按数据集名加载（对齐 loadSceneBundle） | `GET /api/v1/scenes/bundle` | 已实现 |
| 3 | 幕 1 实时路况 | `GET /api/v1/traffic/color-links` | 占位 |
| 4 | 幕 5 技能固化落盘 | `POST /api/v1/agent/skill/solidify` | 占位 |

---

## 2. GET /api/v1/scenes/{scene_key}（按幕加载数据集）

### 2.1 入参

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| `scene_key` | path | string | 是 | 幕标识，`enum: 0..5`（见 §0.1 映射表） |

### 2.2 出参

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `scene_key` | string | 是 | 回显幕标识 |
| `source` | string | 是 | `demo` / `live` |
| `contract_version` | string | 是 | 契约版本 |
| `generated_at` | string | 是 | 生成时间（ISO8601） |
| `datasets` | object | 是 | 数据集分块，键名见 §0.1，值为对应数据文件的完整 JSON |

### 2.3 出参示例（scene_key=2 · 分析成因）

```json
{
  "scene_key": "2",
  "source": "demo",
  "contract_version": "1.0",
  "generated_at": "2026-08-25T02:00:00Z",
  "datasets": {
    "objects": { "problem_link": { "link_id": "12wwe28fmwwe28ct01" },
                 "intersections": { "downstream_jingshi": { "inter_id": "011wwe28ctu00001" } } },
    "cause": { "meta": { "target_inter_id": "011wwe28ctu00001" },
               "upstream_traces": { "by_turn": { "left": [], "through": [], "right": [] } },
               "demand_supply": { "demand_flow_veh_h": 520, "supply_capacity_veh_h": 1285.6 },
               "downstream_constraint": { "intersection_saturation_max": 1.29, "intersection_los": "F" },
               "jingshi_ew_fallback_metrics": { "east_entrance_E2W": { "avg_speed_kmh": 14.51 } } },
    "flowTrace": { "meta": { "scene_index": 2, "name": "分析成因-上游流量溯源" },
                   "source": { "id": "011wwe28fty00001" },
                   "via": { "id": "011wwe28fmc00001" },
                   "target": { "id": "011wwe28ctu00001", "direction": "北向南", "movement": "直行" },
                   "upstream_share_display": { "source_ratio": 32.4, "via_ratio": 48.1 },
                   "demand_supply": { "supply_pcu_h": 824, "demand_pcu_h": 1285.6 },
                   "downstream_constraint": { "metrics": { "north_through_saturation": 1.28,
                                                            "intersection_los": "F" } },
                   "map_beats": { "trace": {}, "supply": {}, "arterial": {},
                                  "signal": {}, "channel_change": {}, "cycle_mismatch": {} } }
  }
}
```

---

## 3. GET /api/v1/scenes/bundle（按数据集名加载）

### 3.1 入参

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| `names` | query | string | 是 | 逗号分隔数据集名，如 `locate,channelization`、`objects,cause,flowTrace` |

### 3.2 出参

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `source` | string | 是 | `demo` / `live` |
| `contract_version` | string | 是 | 契约版本 |
| `generated_at` | string | 是 | 生成时间（ISO8601） |
| `datasets` | object | 是 | 请求的数据集分块 |

### 3.3 出参示例

```json
{
  "source": "demo",
  "contract_version": "1.0",
  "generated_at": "2026-08-25T02:00:00Z",
  "datasets": { "locate": { "map_beats": { "m-queue": {} } },
                "channelization": { "by_intersection": {} } }
}
```

---

## 4. GET /api/v1/traffic/color-links（幕 1 · 实时路况，占位）

### 4.1 入参（Query）

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| `case_id` | query | string | 是 | 路况案例标识，前端固定 `aotixi-jingshi-north-through` |
| `day_of_week` | query | number | 是 | 周型（1=周一），前端固定 `1` |
| `step_start` | query | number | 是 | 起始 5 分钟步序号，前端固定 `210` |
| `step_end` | query | number | 是 | 结束步序号，前端固定 `221` |

### 4.2 出参

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `links` | array | 是 | 元素：`link_id, road_name, length_m, geom, avg_speed_kmh(number|null), delay_index(number|null), derived_state(1|2|3|4|null，可选——缺省前端按速度派生), is_problem_link(boolean), queue_length_m?(number)` |

### 4.3 出参示例

```json
{
  "links": [
    { "link_id": "12wwe28fmwwe28ct01", "road_name": "奥体西路:解放东路-经十路(北向南)",
      "length_m": 367.89, "geom": { "type": "LineString", "coordinates": [] },
      "avg_speed_kmh": 7.2, "delay_index": 5.28, "derived_state": 4,
      "is_problem_link": true }
  ]
}
```

---

## 5. POST /api/v1/agent/skill/solidify（幕 5 · 技能固化落盘，占位）

### 5.1 入参（Body）

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| `skillId` | body | string | 是 | 技能目录键，如 `aotixi-n2s-phase-coord-evening` |
| `skillDir` | body | string | 是 | 相对目录，如 `skills/aotixi-n2s-phase-coord-evening` |
| `resultMeta` | body | object | 是 | 同 `skill.result_meta`（`skillId/skillDir/downloadUrl/intersection/timePeriodLabel/action`） |
| `files` | body | array | 是 | 技能包文件 `{path, language, content}` |

### 5.2 出参

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `ok` | boolean | 是 | `true` 成功 / `false` 失败（失败时 `reason` 必填） |
| `skillDir` | string | 是 | 实际写入目录（成功时） |
| `action` | string | 是 | `'created'` / `'updated'` |
| `reason` | string | 失败时 | 失败原因 |

### 5.3 示例

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

---

## 6. 真实部署参数化预留（当前 Demo 未实现）

当前 `GET /api/v1/scenes/{scene_key}` 仅按 `scene_key` 返回演示案例（Case A · 奥体西路×经十路）的固化数据。真实部署需支持多路口/多路段/多时段定位，规划在 `scenes/{scene_key}` 上增加可选 query 参数（当前后端未消费，仅作契约预留）：

| 参数 | 作用 | 默认值（演示案例） |
|------|------|--------------------|
| `case_id` | 场景锚定案例 | `case_aotixi`（`frontend/src/config/demo-cases.json` 定义 5 个案例） |
| `link_id` | 问题路段（幕 1/3/4 定位） | `12wwe28fmwwe28ct01` |
| `target_inter_id` | 溯源汇点路口（幕 2 定位） | `011wwe28ctu00001` |
| `line_id` / `segment_key` | 干线协调子区（幕 3b `signalPlan`） | `wwe2bswwwe23pb01` / `opt-5:早高峰` |
| `trace_type` / `max_hop` | 溯源方向与跳数（幕 2） | `upstream` / `3` |
| `skill_id` | 技能包目录键（幕 5） | `aotixi-n2s-phase-coord-evening` |
| `day_of_week` / `step_start` / `step_end` | 分析时间窗 | `1` / `210` / `221` |

优先级：显式业务主键（`link_id`/`target_inter_id`/`skill_id`）> `case_id` > 默认值。启用时后端须在 `datasets` 内按参数重新定位，超出覆盖范围返回 `404`（`CASE_NOT_FOUND` / `TARGET_NOT_FOUND`），禁止静默回退演示数据。

# 数据库嗅探报告（奥体西晚高峰北向南溢出剧本）

嗅探与决策更新见 `data/1-sniff-report.json`。连接：`ycx@121.40.233.80:15432/ycx`，schema：`road6` + `xianchang`，路网版本 `20260501`。

分析窗：**周一 17:30–18:30**（`day_of_week=1`, `step_index=210–221`）。

## 1. 已成功解析

| 对象/指标 | 结果 | 来源表 |
|-----------|------|--------|
| 下游路口 | `011wwe28ctu00001` 奥体西路与经十路路口 | `road6.dim_inter_info` |
| 上游路口 | `011wwe28fmc00001` 奥体西路与解放东路路口 | 同上 |
| 问题路段 N→S | `12wwe28fmwwe28ct01`，长 **367.89 m**，5 车道 | `road6.dim_link_info` |
| 双路口渠化 | 18 条进口/出口臂 + 几何 | `dwd_tfc_rltn_wide_inter_ft_link` |
| 问题路段速度 / 延时指数 | ≈7.2 km/h / ≈4.9+ | `dws_link_index_5min_mm` |
| 北进口直行饱和度 | ≈0.84 | `dws_turn_saturation_5min_mm` |
| 北进口直行流量（需求） | ≈**520** 辆/h | `dws_inter_link_turn_flow_5min_mm` |
| 北进口通行能力（已查 4 车道） | ≈1285.6 辆/h | `dws_lane_capacity_5min_mm` |
| 上游溯源份额 ≤3 跳 | 左 6 / 直 8 / 右 5 条 | `ads_ts_inter_turn_flow_correlate_d` |
| **下游去向溯源份额 ≤3 跳** | 左 8 / 直 8 / 右 7 条（已补入 JSON） | 同上 |
| 经十东西进口降级指标 | 西进口≈26.2km/h、延时≈3.41；东进口≈14.5km/h、延时≈5.81 | `dws_link_index_5min_mm` |
| 现状相位 | 经十方案 13；解放东方案 23 | `dwd_ctl_inter_*` |
| 排队长度 | **270 m**（专家值） | 非 DB |

## 2. 已确认的产品决策

| 决策 | 内容 |
|------|------|
| DEC-TRACE-SHARE | 流量溯源（上/下游，左/直/右）**只用占比份额** `flow_share_ratio` |
| DEC-DEMAND-THROUGH | 路口需求 **先取北进口直行流量** |
| DEC-EW-FALLBACK | 经十东西进口用 **速度 + 拥堵延时指数** 代替不可用的饱和度/西向流量 |
| DEC-OPT-FROM-AGENT-LOOP | 幕 3 逻辑对齐 agent-loop **main** 方案生成幕；配色用本项目 |
| DEC-EFFECT-FROM-AGENT-LOOP | 幕 4 逻辑对齐 agent-loop **main** 效果评估/试运行时序 |
| DEC-SKILL-FROM-AGENT-LOOP | 幕 5 逻辑对齐 agent-loop 技能固化流程 |

实现路径映射见 `docs/implementation-refs.md`。

## 3. 仍标记的库缺口（已降级或改实现来源）

| ID | 状态 | 说明 |
|----|------|------|
| GAP-TRACE-ABS-FLOW | accepted_share_only | 不要求绝对辆/h |
| GAP-NORTH-LR-FLOW | accepted_through_as_demand | 左/右绝对流量仍为 0；需求用直行 |
| GAP-WEST-SAT | mitigated_by_speed_delay | 已改东西进口速度/延时 |
| GAP-AMAP-STATE | open | 路况色仍用速度派生 |
| GAP-JIEFANG-SAT | open | 解放东饱和度仍为 0 |
| GAP-QUEUE-TABLE | mitigated_expert_270 | 排队用 270m |
| GAP-RIGHT-LANE-CAP | open | 缺右转车道 capacity |
| GAP-OPT-PLAN / EFFECT / SKILL | implement_from_agent_loop | 改走 agent-loop 代码逻辑 |

## 4. 产物

- 溯源含下游：`data/1-2-cause-analysis.json` → `downstream_traces`
- 东西降级：`data/1-1-problem-locate.json` → `jingshi_ew_metrics.fallback_metrics`
- 决策摘要：`data/1-sniff-report.json` → `decisions`

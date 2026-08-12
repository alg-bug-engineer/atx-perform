# 数据库嗅探报告（奥体西晚高峰北向南溢出剧本）

嗅探时间见 `data/1-sniff-report.json`。连接：`ycx@121.40.233.80:15432/ycx`，schema：`road6` + `xianchang`，路网版本 `20260501`。

分析窗：**周一 17:30–18:30**（`day_of_week=1`, `step_index=210–221`）。

## 1. 已成功解析

| 对象/指标 | 结果 | 来源表 |
|-----------|------|--------|
| 下游路口 | `011wwe28ctu00001` 奥体西路与经十路路口 | `road6.dim_inter_info` |
| 上游路口 | `011wwe28fmc00001` 奥体西路与解放东路路口 | 同上 |
| 问题路段 N→S | `12wwe28fmwwe28ct01`，长 **367.89 m**，5 车道 | `road6.dim_link_info` |
| 对向路段 S→N | `12wwe28ctwwe28fm01`，368.43 m | 同上 |
| 双路口渠化 | 18 条进口/出口臂 + 几何 | `dwd_tfc_rltn_wide_inter_ft_link` |
| 问题路段速度 | 约 **7.2 km/h** | `dws_link_index_5min_mm` |
| 拥堵延时指数 | 约 **4.87**（`delay_index`） | 同上 |
| 北进口直行饱和度 | 约 **0.84** | `dws_turn_saturation_5min_mm` |
| 东进口直行饱和度 | 约 **0.76** | 同上 |
| 东→西直行流量 | 约 **1230 辆/h** | `dws_inter_link_turn_flow_5min_mm` |
| 北进口直行流量 | 约 **520 辆/h** | 同上 |
| 北进口车道通行能力（4 条） | 合计约 **1285.6 辆/h** | `dws_lane_capacity_5min_mm` |
| 上游溯源 ≤3 跳 | 有 `UPSTREAM` 份额数据 | `ads_ts_inter_turn_flow_correlate_d` |
| 现状相位 | 经十晚高峰方案 **13**；解放东方案 **23** | `dwd_ctl_inter_*` |
| 路口评价 | saturation_max≈1.3+，LOS **F** | `dws_inter_evaluation_5min_mm` |
| 排队长度 | **270 m**（专家值，已写入 JSON） | 非 DB |

结论支撑叙事「需求未超供给」：北进口转向流量和 ≈520 ＜ 已查到的供给能力 ≈1285。

## 2. 数据库不支撑 / 缺失（需关注）

| ID | 幕 | 字段 | 说明 | 临时处理 |
|----|----|------|------|----------|
| GAP-AMAP-STATE | 1 | `max_state` / slink | 周表 `max_state` 在问题路段仍为 1（绿），与 ~7km/h 矛盾；`dwd_amap_dimlink_speed_5mi` 无 state | 用速度派生红黄绿 |
| GAP-WEST-SAT | 1/2 | 西进口饱和度/流量 | 西进口晚高峰饱和度与流量全 0 | 东西向讲解暂用东进口/路口 saturation_max |
| GAP-JIEFANG-SAT | 1 | 解放东东向饱和度 | 解放东路口各方向饱和度全 0 | 动作可做，指标卡标 `db_supported=false` |
| GAP-QUEUE-TABLE | 1 | `queue_len_*` | `dws_inter_dir_turn_perf_5min_mm` 经十路口无数据 | 固定 270 m |
| GAP-NORTH-LR-FLOW | 2 | 北进口左/右转流量 | 仅直行有值，左/右为 0 | 三转向溯源仍做，需求以直行为主 |
| GAP-RIGHT-LANE-CAP | 2 | 右转车道通行能力 | capacity 表缺第 5 车道；headway 无周一 | 用已有 4 车道之和 |
| GAP-TRACE-ABS-FLOW | 2 | 溯源绝对流量 | correlate 只有 `flow_share_ratio` | 动画用份额权重；绝对量用进口流量 |
| GAP-OPT-PLAN | 3 | 优化后方案/曲线 | 库仅有现状方案 | 左侧用现状；右侧与曲线待补 |
| GAP-EFFECT-SERIES | 4 | 效果对比时序 | 无优化前后实验序列 | 对齐 agent-loop UI，数值后补 |
| GAP-SKILL-CONTENT | 5 | 技能内容 | 非 DB | 对齐 agent-loop + assets |

## 3. 产物路径

全部落盘：`data/1-*.json`。契约见 `docs/data-contract.md`，剧本需求见 `docs/storyline-requirements.md`。

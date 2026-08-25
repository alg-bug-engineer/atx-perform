# 数据缺失登记表（Data Gaps Registry）

> **用途**：记录后端 Live 轨（PG 实时取数）中「缺失、简化、兜底」的数据项，
> 供后续开发人员识别缺口、持续补充。
>
> **使用方式**：每发现一处缺失/简化，在下方对应数据集表格**追加一行**，并标注状态与建议来源。
> 已解决/已补上的条目不要删除，把「状态」改为「已解决」并在备注写明解决方式，保留历史可追溯。

## 1. 状态图例

| 状态 | 含义 |
|------|------|
| `待补` | PG 可查但后端尚未实现取数 |
| `已降级` | PG 无此数据，当前用替代口径 / 固化值 / 省略兜底 |
| `已接受` | 确认 PG 无此数据且业务上可接受缺失（如专家配置、叙事文案） |
| `已解决` | 已从真实 PG 表取数（备注写明表名与字段） |

## 2. 缺失数据清单

### 2.1 objects（幕 0/1/2 共用）

| 字段 | 状态 | 缺失/简化原因 | 当前兜底 | 建议补充来源 |
|------|------|---------------|----------|--------------|
| `problem_link.queue_length_m` | `已降级` | PG 无排队长度表（data-contract 明确「排队长度采用专家调研值，不使用库内 queue 表」） | live 不返回该字段 | 专家调研值 270m；或检测器/轨迹推算排队 |
| `problem_link.storage_length_m` | `已降级` | 蓄车长度用 `dim_link_info.length_m` 近似（data 文件同口径） | `length_m` 近似 | 渠化表 `dwd_tfc_rltn_wide_inter_ft_link` 的蓄车段长度 |

### 2.2 flowTrace（幕 2）

| 字段 | 状态 | 缺失/简化原因 | 当前兜底 | 建议补充来源 |
|------|------|---------------|----------|--------------|
| `upstream_share_display` | `已解决` | 原 data 标注 `mock: true`（演示用关联占比） | 已改从 `ads_ts_inter_turn_flow_correlate_d.flow_share_ratio` 读真实占比 | — |
| `demand_supply.supply_pcu_h` / `demand_pcu_h` | `已降级` | 供需核验为简化口径：主流向直行 12 步流量 SUM；data 的专家口径是 `max(解放东汇入, 经十汇出)` | 主流向直行 SUM | 参考 agent-loop `load_intersection_from_pg.py` 的供需口径（需求 vs 车道能力） |
| `demand_supply.demand_lanes`（车道能力 cap） | `待补` | data 为北进口车道通行能力求和 1285.6，后端未从 PG 计算 | 省略 | `dim_link_info.lane_num` + 饱和车头时距推算 |
| `downstream_constraint.metrics.west_through_saturation` | `已降级` | `GAP-WEST-SAT`：西进口无饱和度检测 | 返回 0 | 西进口检测补点；或速度+延时指数降级（data 用 `west_mock: true`） |
| `map_beats`（headline/caption/conclusion/copy） | `已降级` | 叙事文案由专家/LLM 生成，PG 无 | 由 `narration_mode` 决定：0=缺失 / 1=固化文案 / 2=LLM 生成 | LLM 实时生成（narration_mode=2，未实现） |
| `title` / `trace_hint` / `road_labels` | `已降级` | 同叙事文案，PG 无 | 同上 | 同上 |

### 2.3 cause（幕 2）

| 字段 | 状态 | 缺失/简化原因 | 当前兜底 | 建议补充来源 |
|------|------|---------------|----------|--------------|
| `upstream_traces.by_turn` | `已解决` | 原 data 为嗅探留存 | 已改从 `ads_ts_inter_turn_flow_correlate_d` 读真实溯源 | — |
| `jingshi_ew_fallback_metrics` | `已解决` | 原硬编码经十路 link | 已改从 target 推导东/西进口主路 link（排除辅路） | — |
| `demand_supply.turn_flow_veh_h.left/right` | `已降级` | `GAP-NORTH-LR-FLOW`：北进口左/右转无检测流量 | 返回 None | 对向南进口实测流量代理（data 用 `demand.proxy`）；或检测补点 |
| `downstream_constraint.story` | `已降级` | 叙事文案，PG 无 | narration_mode 兜底 | LLM |

### 2.4 跨幕（专家配置 / 仿真参数）

| 字段 | 状态 | 缺失/简化原因 | 当前兜底 | 建议补充来源 |
|------|------|---------------|----------|--------------|
| `expert_overrides`（专家排队 270m 等） | `已接受` | 专家经验值，PG 无 | live 不返回 | 专家录入 / 规则库 |
| 走廊仿真参数 `corridor_demo.simulation`（幕 3/4） | `已接受` | 车辆跟驰/转向比等为现场标定，PG 无 | Demo 读 data 固化 | 现场观测标定表 |
| 溢流/排队比等派生指标（`queue_ratio`、`spill_duration`） | `待补` | 由排队长度 + 蓄车长度派生，排队长度缺 PG 源 | 省略 | 依赖 2.1 排队长度补上后派生 |

## 3. 已知 GAP 编码速查

| GAP 编码 | 含义 | 涉及字段 |
|----------|------|----------|
| `GAP-WEST-SAT` | 西进口饱和度缺失 | `west_through_saturation` |
| `GAP-JIEFANG-SAT` | 解放东路口饱和度缺失 | `jiefang_east_metrics` |
| `GAP-NORTH-LR-FLOW` | 北进口左/右转流量缺失 | `turn_flow_veh_h.left/right` |

## 4. 补充记录区（后续开发追加）

> 格式：在对应数据集表格追加一行；若涉及新数据集，新增「2.x」小节。
> 记录请注明：字段、状态、原因、兜底、建议来源，最好附上核实日期与核实方式（探测 SQL / data 文件）。

（暂无）

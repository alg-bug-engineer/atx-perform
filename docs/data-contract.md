# 数据契约（幕数据 JSON）

## 命名

- 所有幕数据文件位于 `data/`，前缀 `1-`（首个剧本批次）。
- 场景脚本（后续）同样带幕序号，读取对应 JSON。

| 文件 | 幕 | 内容 |
|------|----|------|
| `1-scene-objects.json` | 共用 | 双路口、问题路段、对向路段、时间窗、专家覆盖值 |
| `1-0-opening.json` | 0 | 扫描 / 标红 / 拉近镜头动作 |
| `1-1-channelization.json` | 1 | 双路口渠化臂与几何 |
| `1-1-problem-locate.json` | 1 | 指标卡、路况着色、讲解动作绑定 |
| `1-2-cause-analysis.json` | 2 | 上/下游溯源份额、直行需求、供需、东西进口降级指标、双口绿灯错配证据 |
| `1-3-optimization.json` | 3 | 现状相位 + 优化占位 + 对比脚本 |
| `1-4-effect-eval.json` | 4 | 效果评估结构（待回填） |
| `1-5-skill-solidify.json` | 5 | 技能固化结构（待回填） |
| `1-sniff-report.json` | — | 嗅探摘要与缺口列表 |

## 关键业务常量

| 字段 | 值 | 来源 |
|------|----|------|
| 下游路口 | `011wwe28ctu00001` 奥体西路与经十路路口 | DB |
| 上游路口 | `011wwe28fmc00001` 奥体西路与解放东路路口 | DB |
| 问题路段 | `12wwe28fmwwe28ct01` 奥体西路:解放东路-经十路(北向南) | DB |
| 蓄车长度 | ≈367.89 m | `dim_link_info.length_m` |
| 排队长度 | **270 m** | 专家调研（强制） |
| 经十东进口车道 | **7 直 + 1 右 + 2 左**（主路+辅路合计 10） | 实地；覆盖库内渠化 |
| 经十东进口流量 | **1586.5 pcu/h** = 左 149.5 + 直 1337 + 右 100 | 左/直：库 step 204–227；右：1 车道 × mock 100 |
| 经十西进口流量 | **1427.85 pcu/h** = 东向合计 × **0.9** | 库内全 0；分析成因幕西侧 mock |
| 经十西进口饱和度 | **0.76** | 库内为 0；分析成因幕 mock |
| 分析时段 | 周一 17:00–19:00（step 204–227） | 约定晚高峰窗 |

## 路况颜色

高德语义：`1` 绿 / `2` 黄 / `3–4` 红。

因库内 `max_state` 与低速拥堵不一致，幕 1 JSON 同时给出：

- `db_max_state`：库字段（可能不可用）
- `derived_state_from_speed`：按速度派生（推荐渲染）
  - ≥35 → 1；≥20 → 2；≥10 → 3；\<10 → 4

## 流量溯源与需求口径

- 指标：仅 `flow_share_ratio`（占比份额）。
- 方向：`upstream_traces`（UPSTREAM）与 `downstream_traces`（DOWNSTREAM），转向 `left|through|right`，`chain_hop≤3`。
- 五步导航：`diagnosis_rail`（步骤 1 解放东汇入示意图；步骤 2 下游主去向 + 南段速度/延时/峰值排队占比；3–5 仅占位）。
- 解放东汇入问题路段：`problem_link_turn_inflow` 为 **mock**（北直 70% / 东左 25% / 西右 5%）。溯源动画结束后展示带方向箭头的示意图。
- 下游承接余量：`downstream_receiving`。先用 `flow_share_ratio` 锁定主去向（龙奥北 85.33%），再用南段速度 + 拥堵延时指数 + 峰值排队占比说明为何有余量。速度/延时为晚高峰 17:00–19:00（step 204–227）均值：24.55 km/h / 1.43。排队占比 = 窗内 `MAX(queue_len_max)` / 容纳长度 = **110 / 592 = 18.6%**（`dws_inter_dir_turn_perf_5min_mm`，西北进口）。饱和度仍无表（`GAP-DOWNSTREAM-SAT`），卡片不再展示饱和度。
- 路口需求：`demand_flow_veh_h = turn_flow_veh_h.through`（直行）。
- 经十东西进口：速度 + 拥堵延时指数仍作饱和度降级。进口流量为左+直+右合计（**pcu/h**）：东 **1586.5**（库左/直 + 右转 mock 100），西 **1427.85**（东向 × 0.9 mock）。分析成因幕东西向卡读 `1-2-flow-trace.json` → `downstream_constraint.metrics`。

## 幕 3–5 实现参考

见 `docs/implementation-refs.md`（agent-loop main → 本项目配色）。

## 缺口

以 `1-sniff-report.json` / `docs/data-sniff-report.md` 为准；已接受/已降级的缺口带 `status` 字段。

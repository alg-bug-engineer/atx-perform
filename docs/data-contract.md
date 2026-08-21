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
| `1-2-cause-analysis.json` | 2 | 上游溯源份额、直行需求、供需、东西进口降级指标（`downstream_traces` 仅嗅探留存，本幕不播） |
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
| 分析时段 | 周一 17:00–19:00（step 210–221） | 约定晚高峰窗 |

## 路况颜色

高德语义：`1` 绿 / `2` 黄 / `3–4` 红。

因库内 `max_state` 与低速拥堵不一致，幕 1 JSON 同时给出：

- `db_max_state`：库字段（可能不可用）
- `derived_state_from_speed`：按速度派生（推荐渲染）
  - ≥35 → 1；≥20 → 2；≥10 → 3；\<10 → 4

## 流量溯源与需求口径

- 指标：仅 `flow_share_ratio`（占比份额）。
- 方向：`upstream_traces`（UPSTREAM）与 `downstream_traces`（DOWNSTREAM），转向 `left|through|right`，`chain_hop≤3`。
- 路口需求：`demand_flow_veh_h = turn_flow_veh_h.through`（直行）。
- 经十东西进口：优先 `jingshi_ew_fallback_metrics` 的速度 + 拥堵延时指数。

## 幕 3–5 实现参考

见 `docs/implementation-refs.md`（agent-loop main → 本项目配色）。

## 缺口

以 `1-sniff-report.json` / `docs/data-sniff-report.md` 为准；已接受/已降级的缺口带 `status` 字段。

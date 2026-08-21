# 实现参考映射（agent-loop → atx-perform）

约定：逻辑/交互/时序对齐 `references/agent-loop-project` 的 **main**；信控阶段卡与绿波时距图保持 deepagent 工作台原生白色视觉，其余页面沿用本项目夜景科技风。

幕 0 / 1 / 2 保留 baseline 的 **three.js 3D 演绎**（`frontend/src/features/**`、`layers/**`、`mesh/**`、`geo/**`），
由分幕壳按 `?scene=` 单独挂载；幕 3–5 为面板式大屏。`act1.html` 是旧独立入口，不参与构建。

| 本项目幕 | agent-loop 参考（main） | 本项目数据/资产 |
|----------|-------------------------|-----------------|
| 0 开幕 | `features/scenes/MapRuntime.vue` + `scene0-opening.js`（cityScan → 揭示城市监控 → 聚焦干线）；本项目补上剧本要求的**问题路段标红闪烁 + 连贯拉近**，接线此前未启用的 `layers/problemLinkAlert.js`，几何取 `1-scene-objects.json` | `data/1-scene-objects.json`、`public/data/city-monitor-demo.json` |
| 1 问题定位 | `features/scenes/traffic-origin/TrafficOriginScene.vue` + `acts/act-01-problem-locate/`（走廊揭示、指标窗、推理面板）；补上剧本要求但 act-01 缺的**双路口渠化**（`IntersectionChannelization.vue`，按库内进口臂逐车道还原），路况着色由 3 条扩到库内 16 条 link | `data/1-1-problem-locate.json`、`data/1-1-channelization.json`、`data/1-scene-objects.json`、`assets/路口渠化与信号实时状态.png` |
| 2 分析成因 | 原生幕：`acts/act-02-flow-trace/`（`flowTraceMapFx` 在 TrafficOriginScene 里播 trace/supply/ew_clear/arterial/signal/overflow，`Act2FlowStage` 出 HUD，不再切回首页）；首页 `scene2-cause.js` 保留为旧路径 | `data/1-2-flow-trace.json`（3D 运行时按 `/data/` 取，见 `serveRepoData`）、`data/1-2-cause-analysis.json` |
| 3 优化方案 | `src/features/acts/act-08/`：`Act8Stage.vue`、`PlanPanel.vue`、`PlanDrawer.vue`、`planVisualization.js`、`act8MapFx.js`（本项目为走廊微观仿真 `CorridorStage.vue` + `corridorSim.js`） | `data/1-3-optimization.json` |
| 3b 信控方案调节 | `StageMovementCanvas.vue`、`StageCards.vue`（阶段渠化改写为 SVG 版 `StageChannelization.vue`，补齐路面/车道虚线/停止线/斑马线标线）；时距图 `TimeSpaceDiagram.vue`、配时对比 `StageTimingCompare.vue` 为本项目新增 | `data/1-3-signal-plan.json`、`assets/信控方案可视化图.png` |
| 4 效果评估 | `TrialEffectPanel.vue`、`TrialEffectDrawer.vue`、`trialEffectSeries.js`（图表改为本项目大屏组合：主视觉 `QueueCapacityHero.vue` 蓄车占用条 + `CycleQueueChart.vue` 单周期面积图 + `GovernanceRadar.vue` 治理画像 + `TrialGuardRail.vue` 回滚护栏半环） | `data/1-4-effect-eval.json`、`assets/效果评估.png` |
| 5 技能固化 | `SkillForgeBackdrop.vue`、`ExperienceAbsorptionPanel.vue`、`SkillBuildPanel.vue`、`SkillBuildDrawer.vue`、`composables/useSkillBuildProcess.js`、`services/skillSolidifyApi.js` | `data/1-5-skill-solidify.json`、`assets/技能固化.png` |

## 讲解语音（幕 3 / 3b / 4 / 5）

- 脚本：`data/tts/scripts.json`（专家口径：思路 → 对照 → 结论）
- 预合成：`scripts/synthesize_tts.py`（Qwen TTS Realtime，音色见 `.env` `QWEN_TTS_VOICE`）
- 音频：`data/tts/scene{3,3b,4,5}/*.wav` + `data/tts/manifest.json`
- UI：`frontend/src/shared/components/DigitalAvatar.vue`（baseline 左下角头标，可关闭）
- 触发：切幕自动播报；`frontend/src/shared/sceneNarration.js`

```bash
# 重新合成（需 .env 中 DASHSCOPE_API_KEY）
references/agent-loop-project/.venv/bin/python scripts/synthesize_tts.py --force
```

## 信控方案数据来源（幕 3b）

方案以信控工作台当前落盘结果为准，取奥体西路早高峰优化子区
`opt-5:早高峰`（坤顺路 → 解放东路 → 经十路，3 个路口）。

```bash
# 1. 起 deepagent API
cd '/Users/zhangqilai/shensi/code/traffic_signal_deepagent 2'
.venv/bin/python -m uvicorn traffic_signal_agent.api:app --host 127.0.0.1 --port 8010

# 2. 从工作台落盘结果同步早高峰方案、重跑同请求时距图并生成前端 JSON
python3 scripts/sync_workbench_signal_plan.py

# 差异诊断才使用直接 API 重跑；该结果不能覆盖前端 JSON
python3 scripts/pull_deepagent_plan.py
```

权威来源固定为工作台产物 `traffic_signal_deepagent 2/tmp/aoti_xilu/05_plan_generation.json`
中的 `opt-5:早高峰`。同步器用该区间原始 request/coordination 重跑 space-time，
并硬校验解放东路 5 阶段、周期/相位差、正反向带宽和时距图对象数；不一致即停止。

- 原始响应：`data/deepagent-raw/`（已 gitignore，`scene-cognition.json` 约 436 MB）
- 前端数据：`data/1-3-signal-plan.json`
- 相位差口径 `offset_reference = coord_green_start`，即 `offset_s` 是协调相位绿灯起点
### 带宽口径（踩过坑，改前务必先读）

| 量 | 来源 | 值 | 说明 |
|----|------|----|------|
| 链式带宽 | space-time `evaluation.chained_bandwidth_*` | 97.7 / 131.7 s | 与工作台早高峰面板同一次评价 |
| 时距图对象 | space-time `diagram` | 68 绿窗 / 257 轨迹 / 6 队尾 / 2 绿波带 | 4 周期同请求完整复用 |

- 算几何重叠必须用**协调阶段绿 `coordinated_green_s`**与各链路返回的正反向实测车速。
  方向所有放行阶段合计 `coordinated_green_{forward,reverse}_s` 只用于方向信号窗，不能冒充协调阶段有效绿；`design_speed_kmh` 只用于方案评价中的设计速度口径。
- 页面 KPI 必须读取 space-time 的 `evaluation`，不能用另一次方案生成或
  `coordination.chained_bandwidth_*` 替代。

### 时距图（`TimeSpaceDiagram.vue`）

直接画 space-time 返回的 `diagram`，与工作台 `CorridorSpaceTimeDiagram.tsx` 同源同画法：
横轴里程、纵轴时间**自下而上**，`points` 每点是 `[时间 s, 里程 m]`；
路口列先铺红灯底条再叠 `green_windows`（`role=coord` 绿、`*_feeder` 琥珀），
车辆是服务端 Newell 轨迹（正向绿 / 反向青），`queue_tails` 橙色。
引擎只对优化后方案跑轨迹，**现状侧只画绿窗**，不补仿真。
- 工作台候选池共评估 6 个方案，入选 `initial`；交叉方向延误回归为 high，
  方案状态为 `not_recommended`，页面维持工作台的“建议维持现状”结论。

## 数据决策（已确认）

1. 流量溯源只用 `flow_share_ratio` 占比份额（上/下游均已落盘）。
2. 路口需求先用北进口 **直行** 流量。
3. 经十东西进口饱和度不可用时，用进口 link **速度 + 拥堵延时指数** 降级。

详见 `docs/data-sniff-report.md`、`data/1-sniff-report.json` → `decisions`。

## 前端独立调试（已落地骨架）

```bash
cd frontend && npm install && npm run dev
```

- `?scene=0..5`（含 `3b`），别名：`plan` / `signal` / `effect` / `skill`
- 默认 `?scene=3`，便于 3/4/5 分工
- 顶部步骤栏覆盖全部幕，编号即 `?scene=` 取值；`←` / `→` 切幕
- 幕 0/1/2 各自挂 3D 运行时（`MapRuntime` / `TrafficOriginScene`），幕 3–5 用 `shared/components/SceneStage.vue`
- 3D 幕依赖 `three`、`public/*.geojson` 底图；仓库 `data/` 由 vite `serveRepoData` 挂到 `/data/`
- 说明：`frontend/README.md`

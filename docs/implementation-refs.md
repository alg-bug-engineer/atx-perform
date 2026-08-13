# 实现参考映射（agent-loop → atx-perform）

约定：逻辑/交互/时序对齐 `references/agent-loop-project` 的 **main**；视觉配色对齐 `references/baseline` / 本项目夜景科技风。

另一套 three.js 实现（原 main 的 `frontend/src/features/**`、`layers/**`、`mesh/**`、`act1.html`）合并后保留在库内**只作逻辑参考**，不参与本应用构建（`vite.config.js` 只从 `index.html` 扫描）。

| 本项目幕 | agent-loop 参考（main） | 本项目数据/资产 |
|----------|-------------------------|-----------------|
| 0 开幕 | `features/scenes/scene0-opening.js` 的 cityScan → 揭示 → 聚焦节拍（本项目改为 SVG `CorridorMap.vue` + `useSceneBeats.js`：scan/alert/fly/settle） | `data/1-0-opening.json`、`data/1-scene-objects.json` |
| 1 问题定位 | `acts/act-01-problem-locate/`：`LocateReasoningPanel.vue`、`fixture.js` 的 `planningItems/recognitionSteps/CONCLUSIONS`（推理流改写为 `ReasoningStream.vue`，取数全部改读嗅探 JSON）；渠化按库内进口臂逐车道还原 `IntersectionChannelization.vue` | `data/1-1-problem-locate.json`、`data/1-1-channelization.json`、`assets/路口渠化与信号实时状态.png` |
| 2 分析成因 | `acts/act-02-flow-trace/state.js` 的 `flowTraceMapBeat`（trace/supply/arterial/signal/overflow 同名同序，改由 `1-2-flow-trace.json:map_beats` 驱动）；溯源链路由 `flow_share_ratio` + `cor_lon/cor_lat` 现算 | `data/1-2-cause-analysis.json`、`data/1-2-flow-trace.json` |
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

方案由信控专家智能体 `/Users/zhangqilai/shensi/code/traffic_signal_deepagent` 生成，取奥体西路晚高峰优化子区 `opt-3:晚高峰`（工业南路 → 经十路，7 个路口）。

```bash
# 1. 起 deepagent API
cd /Users/zhangqilai/shensi/code/traffic_signal_deepagent
.venv/bin/python -m uvicorn traffic_signal_agent.api:app --host 127.0.0.1 --port 8010

# 2. 拉原始 JSON（全程关闭大模型叙述；场景认知阶段读库较久，已按阶段缓存，可断点续跑）
python3 scripts/pull_deepagent_plan.py

# 3. 蒸馏成前端数据
python3 scripts/extract_signal_plan.py
```

拉取会依次跑 scene-cognition / problem-diagnosis / congestion-cause / control-strategy /
plan-generation / space-time，已完成阶段落盘缓存自动跳过（`--force` 强制重跑）。
space-time 那步就是工作台「绿波时距图」面板的数据源。

- 原始响应：`data/deepagent-raw/`（已 gitignore，`scene-cognition.json` 约 436 MB）
- 前端数据：`data/1-3-signal-plan.json`
- 相位差口径 `offset_reference = coord_green_start`，即 `offset_s` 是协调相位绿灯起点
### 带宽口径（踩过坑，改前务必先读）

| 量 | 来源 | 值 | 说明 |
|----|------|----|------|
| 全线共同带宽 | `coordination.bandwidth_{forward,reverse}_s` | 0 / 0 s | 贯穿 7 个路口的共同带，真·秒 |
| 链式带宽 | space-time `evaluation.chained_bandwidth_*` | 24.8 / 410.4 | `Σ own[i][j]×(j−i)`，量纲「秒×段数」，**不是秒**，只作候选排序 |
| 相邻绿窗重叠 | `links[].{baseline,optimized}` 本项目实算 | 南向北 6/6、北向南 1/6 | 相邻两口窗口交集，**不等于绿波带** |

- 算重叠必须用**协调阶段绿 `coordinated_green_s`**（12/105/59/112/26/49/29）与**链路实测车速 `forward_speed_kmh 26.87` / `reverse_speed_kmh 26.0`**。
  曾错用 `coordinated_green_{forward,reverse}_s`（方向所有放行阶段合计）+ `design_speed_kmh 15.772`，行程时间偏大 1.7 倍、绿窗偏大 2–6 倍，算出「南向北 6/6 贯通、平均 62.1 s」的虚高结论。`design_speed_kmh` 只用于延误/通行时间。
- `coordination.chained_bandwidth_forward_s`(24.85) 与 `_reverse_s`(1457.92) **两者口径不一致**：正向按协调阶段绿算（可精确复现），反向按方向合计绿算。工作台不读这两个字段，读的是 space-time 的 `evaluation`，所以必须单独拉 `space-time.json`。
- 引擎 `diagram.bandwidth_bands` 为空数组 → 本方案**没有形成任何绿波带**，页面不得宣称「贯通」。
  北向南视图里车辆逐口停车的阶梯状轨迹，就是「未成波」的直接证据。

### 时距图（`TimeSpaceDiagram.vue`）

直接画 space-time 返回的 `diagram`，与工作台 `CorridorSpaceTimeDiagram.tsx` 同源同画法：
横轴里程、纵轴时间**自下而上**，`points` 每点是 `[时间 s, 里程 m]`；
路口列先铺红灯底条再叠 `green_windows`（`role=coord` 绿、`*_feeder` 琥珀），
车辆是服务端 Newell 轨迹（正向绿 / 反向青），`queue_tails` 橙色。
引擎只对优化后方案跑轨迹，**现状侧只画绿窗**，不补仿真。
- `expected_improvements` 里的 `bandwidth_s` / `chained_bandwidth_s`（512.33 → 1457.92，+946）已剔除：引擎自己的 notes 写明「现状带宽因缺少路段行程时间未能同模型核算，不作伪对比」。
- 引擎在 7 个候选中选了「反向单向绿波」，交叉方向延误回归被标为 high，方案状态是**需人工确认**

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
- 模块：`frontend/src/scenes/scene{N}-*/`；公共外框 `shared/components/SceneStage.vue`、幕头 `SceneHeadline.vue`
- 说明：`frontend/README.md`

# 济南交管支队信控智能体 — 剧本需求与开发约束

## 1. 背景与目标

晚高峰，奥体西路 **北向南**，解放东路 → 经十路路段存在排队溢出到上游路口（解放东路–奥体西路）的风险。本项目对治理过程做可视化演绎：

| 幕序号 | 名称 | 简述 |
|--------|------|------|
| 0 | 开幕 | 地图扫描发现问题，问题路段标红闪烁，镜头拉进 |
| 1 | 问题定位 | 双路口渠化 + 问题路段指标 + 周边实时路况着色 |
| 2 | 分析成因 | 隐去渠化，上游流量溯源（≤3 跳，份额）+ 供需与经十路口约束 |
| 3 | 优化方案 | 对齐 agent-loop main 方案生成幕逻辑；配色用本项目/baseline |
| 4 | 效果评估 | 对齐 agent-loop main 效果评估/试运行时序逻辑 |
| 5 | 技能固化 | 对齐 agent-loop 技能固化/沉淀逻辑 |

视觉参考：`assets/` 下剧本与样式图（思路图、渠化、指标卡、信控方案、效果评估、技能固化等）。

## 2. 空间对象（已标定）

| 对象 | 说明 | 已知 ID / 坐标 |
|------|------|----------------|
| 下游路口 | 经十路–奥体西路 | `011wwe28ctu00001` ≈ (117.111376, 36.659469) |
| 上游路口 | 解放东路–奥体西路 | `011wwe28fmc00001` ≈ (117.111368, 36.663092) |
| 问题路段 | 奥体西路北→南，解放东→经十 | 嗅探见 `data/1-scene-objects.json` |
| 专家排队长度 | 固定采用调研值 | **270 m**（不优先用库内排队覆盖） |

方向约定：奥体西为南北向，经十路/解放东路为东西向；叙事主方向为 **北向南（N→S）**。

## 3. 各幕动作与数据依赖

### 幕 0 — 开幕

- 动作：全域/走廊扫描 → 问题路段标红闪烁 → 自动拉近镜头。
- 数据：问题 `link_id` 及几何、走廊范围、双路口坐标。

### 幕 1 — 问题定位

- 动作：显示双路口渠化；问题路段强调（虚线包裹/闪烁）；周边双向 link 按高德 `speed/state`（slink：1 绿 / 2 黄 / 3–4 红）着色；讲解对齐点先做动作、后配语音。
- 指标卡（问题路段侧）：速度、经十路口北进口直行饱和度、路段拥堵延时指数、排队长度(=270m)、蓄车长度。
- 讲解对齐动作：强调问题路段 → 下游经十路口东西向指标卡 → 强调解放东路口。
- **东西进口降级**：西进口饱和度/流量库内为 0 时，经十路东/西进口改用 **速度 + 拥堵延时指数**（见 `1-1-problem-locate.json` → `jingshi_ew_metrics.fallback_metrics`）。
- 数据：渠化几何、link 速度/状态、北进口直行饱和度、蓄车长度、东西进口降级指标。

### 幕 2 — 分析成因

- 动作：隐去双路口渠化；以经十路–奥体西为目标路口，对北进口直行做 **上游** 溯源（最多 3 跳），水流汇入可视化；路段旁标注需求与供给。本幕不演绎下游去向溯源。
- **溯源指标**：仅使用 `flow_share_ratio` **占比份额**（不要求绝对辆/h）。
- **需求口径（已确认）**：路口需求 **先取北进口直行流量**（左/右转绝对流量库内为 0）。
- 供给能力 = 北进口已查到的车道通行能力求和（查表；缺右转车道已标记）。
- 叙事：需求未超供给；经十路保障东西向通勤（东西向用速度/延时指数支撑），周期内难再向南北向分配可用绿灯。
- 数据：`1-2-cause-analysis.json` 的 `upstream_traces`；`downstream_traces` 仅作库内嗅探留存，本幕不播放。

### 幕 3 — 优化方案

- **实现来源**：`references/agent-loop-project` **main** 分支方案生成幕（`src/features/acts/act-08/`：`Act8Stage.vue`、`PlanPanel.vue`、`PlanDrawer.vue`、`planVisualization.js`、`StageMovementCanvas.vue`、`act8MapFx.js` 等）。
- 逻辑保留：候选方案 / 推荐 / 相位时序 / 地图演示；**配色与 UI 壳层改为 baseline/atx-perform**。
- 画面叙事仍对齐本剧本：相位协调；左右对比（解放东先绿溢出 vs 经十先绿再放行不溢出）。
- 现状相位基线数据：`1-3-optimization.json`（库内现状 plan）；优化后秒数/曲线可沿用 agent-loop 方案结构填槽。

### 幕 4 — 效果评估

- **实现来源**：agent-loop **main** 效果评估/试运行时序（`act-08/TrialEffectPanel.vue`、`TrialEffectDrawer.vue`、`TrialEffectCharts.vue`、`trialEffectSeries.js`）。
- 样式参考：`assets/效果评估.png`；主题色改本项目。
- 指标：排队、速度等 before/after 序列结构对齐 agent-loop，数值可接本走廊 JSON。

### 幕 5 — 技能固化

- **实现来源**：agent-loop 技能固化（`act-08/SkillSolidifyOverlay.vue`、`SkillBuildPanel.vue`、`SkillBuildDrawer.vue`、`composables/useSkillBuildProcess.js`、`planFeedbackService.js` 的 solidify 流程）。
- 样式参考：`assets/技能固化.png`；配色改本项目。

## 4. 工程约束

1. **UI/配色**：以 `references/baseline` 为主体风格；其他参考只借逻辑与布局，不借配色。
2. **分幕代码**：每一幕单独 JS；读取 `data/` 下对应 JSON；文件命名带序号前缀 `1-`、`2-`…（数据与场景脚本均带幕序号）。
3. **分支策略**：功能开发在时间戳分支（`YYYYMMDD-HHMMSS-<task>`）；**禁止自动合入 main**，仅用户明确要求时可合入。
4. **语音**：幕 3/4/5 已接入本地预合成讲解（Qwen TTS → `data/tts/`）；左下角数字人头像可关闭播报。幕 0/1/2 仍只做动作，预留时间轴 hook。
5. **排队长度**：展示与叙事统一使用专家值 **270 m**。

## 5. 数据库

见 `env.example` / `.env`：

```text
PG_DSN=host=121.40.233.80 port=15432 user=ycx password=*** dbname=ycx
PGSCHEMA=road6
PG_FLOW_SCHEMA=xianchang
```

静态路网默认 `version_id='20260501'`。指标优先查 `xianchang` DWS 表（见 traffic-metrics 技能目录）。

## 6. 参考资产

| 路径 | 用途 |
|------|------|
| `assets/*.png` | 剧本与 UI 样式 |
| `references/baseline` | 主体配色 / Three 图层 / 场景编排（gitignore） |
| `references/agent-loop-project` | 效果评估、技能固化实现参考（gitignore） |
| `references/aoti-corridor-digital-twin` | 双路口 ID/坐标/路段长度标定参考（gitignore） |
| `docs/baseline-project-analysis.md` | baseline 可视化资产分析 |

## 7. 数据产物

嗅探与幕数据落在 `data/`，详见 `docs/data-contract.md` 与 `docs/data-sniff-report.md`。

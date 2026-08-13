# atx-perform frontend

Vue 3 + Vite。分幕独立调试，幕 0–5 可并行开发。

## 启动

```bash
cd frontend
npm install
npm run dev
```

默认打开幕 3（优化方案）。浏览器访问控制台提示的本地地址（默认 `http://localhost:5174`）。

## 独立调试

| URL | 幕 |
|-----|-----|
| `?scene=0` | 开幕 |
| `?scene=1` | 问题定位 |
| `?scene=2` 或 `?scene=cause` | 分析成因 |
| `?scene=3` 或 `?scene=plan` | 优化方案 |
| `?scene=3b` 或 `?scene=signal` | 信控方案调节 |
| `?scene=4` 或 `?scene=effect` | 效果评估 |
| `?scene=5` 或 `?scene=skill` | 技能固化 |

顶部步骤栏可直接点选切幕，编号与 `?scene=` 取值一致；`←` / `→` 前后切幕。
每幕只加载自己的 `data/1-*.json`，不依赖上一幕运行时状态。

## 目录

```text
src/app/AppChrome.vue              # 大字报标题 + 步骤栏 + 执行状态
src/shared/components/
  SceneStage.vue                   # 全幕通用外框：栅格背景 + 抽屉 + 底部动作条
  SceneHeadline.vue                # 幕头：小标签 + 结论式标题 + 摘要 + chip
  CorridorMap.vue                  # 走廊路网底图（按库内 geom 投影，速度派生配色）
  ReasoningStream.vue              # 智能体推理流（逐条点亮 + 结论）
src/shared/geo.js                  # 经纬度投影、折线截取
src/shared/useSceneBeats.js        # 幕内分镜节拍（预留与播报对齐）
src/scenes/scene0-opening/         # 扫描 → 告警 → 拉近 → 巡检工单
src/scenes/scene1-problem-locate/  # 排队/蓄车对照 + 双路口渠化 + 推理收敛
src/scenes/scene2-cause-analysis/  # 流量溯源 + 供需对照 + 下游绿灯约束
src/scenes/scene3-optimization/    # 对齐 agent-loop act-08 方案生成
src/scenes/scene3b-signal-plan/    # 干线协调配时 / 绿波时距图
src/scenes/scene4-effect-eval/     # 对齐 TrialEffect*
src/scenes/scene5-skill-solidify/  # 对齐 SkillBuild*
```

`src/features/**`、`src/layers/**`、`src/mesh/**`、`act1.html` 是另一套 three.js 实现，
合并后只作逻辑参考，不参与构建（`vite.config.js` 只从 `index.html` 扫描依赖）。

配色见 `src/styles/theme.css`（baseline 青/夜景）。实现映射见仓库 `docs/implementation-refs.md`。

## 自动化截图

带 `navigator.webdriver` 或系统开启「减少动态效果」时，分镜与推理流直接落到终态，方便逐幕截图比对。

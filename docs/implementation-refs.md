# 实现参考映射（agent-loop → atx-perform）

约定：逻辑/交互/时序对齐 `references/agent-loop-project` 的 **main**；视觉配色对齐 `references/baseline` / 本项目夜景科技风。

| 本项目幕 | agent-loop 参考（main） | 本项目数据/资产 |
|----------|-------------------------|-----------------|
| 3 优化方案 | `src/features/acts/act-08/`：`Act8Stage.vue`、`PlanPanel.vue`、`PlanDrawer.vue`、`planVisualization.js`、`StageMovementCanvas.vue`、`StageCards.vue`、`act8MapFx.js` | `data/1-3-optimization.json`、`assets/信控方案可视化图.png` |
| 4 效果评估 | `TrialEffectPanel.vue`、`TrialEffectDrawer.vue`、`TrialEffectCharts.vue`、`trialEffectSeries.js` | `data/1-4-effect-eval.json`、`assets/效果评估.png` |
| 5 技能固化 | `SkillSolidifyOverlay.vue`、`SkillBuildPanel.vue`、`SkillBuildDrawer.vue`、`composables/useSkillBuildProcess.js`、`services/planFeedbackService.js` | `data/1-5-skill-solidify.json`、`assets/技能固化.png` |

## 数据决策（已确认）

1. 流量溯源只用 `flow_share_ratio` 占比份额（上/下游均已落盘）。
2. 路口需求先用北进口 **直行** 流量。
3. 经十东西进口饱和度不可用时，用进口 link **速度 + 拥堵延时指数** 降级。

详见 `docs/data-sniff-report.md`、`data/1-sniff-report.json` → `decisions`。

## 前端独立调试（已落地骨架）

```bash
cd frontend && npm install && npm run dev
```

- `?scene=0..5`，别名：`plan` / `effect` / `skill`
- 默认 `?scene=3`，便于 3/4/5 分工
- 模块：`frontend/src/scenes/scene{N}-*/`
- 说明：`frontend/README.md`

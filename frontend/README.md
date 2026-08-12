# atx-perform frontend

Vue 3 + Vite。分幕独立调试，支持 3/4/5 幕并行开发。

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
| `?scene=2` | 分析成因 |
| `?scene=3` 或 `?scene=plan` | 优化方案 |
| `?scene=4` 或 `?scene=effect` | 效果评估 |
| `?scene=5` 或 `?scene=skill` | 技能固化 |

底栏也可切换。每幕只加载自己的 `data/1-*.json`，不依赖上一幕运行时状态。

## 目录

```text
src/scenes/scene0-opening/     # index.js + Vue
src/scenes/scene1-problem-locate/
src/scenes/scene2-cause-analysis/
src/scenes/scene3-optimization/   # 对齐 agent-loop act-08 方案生成
src/scenes/scene4-effect-eval/    # 对齐 TrialEffect*
src/scenes/scene5-skill-solidify/ # 对齐 SkillBuild*
```

配色见 `src/styles/theme.css`（baseline 青/夜景）。实现映射见仓库 `docs/implementation-refs.md`。

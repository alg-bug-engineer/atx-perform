# atx-perform frontend

Vue 3 + Vite。分幕独立调试，幕 0–5 可并行开发。

- **幕 0 / 1 / 2**：three.js 3D 地图演绎（baseline 路网底图 + 走廊/溯源特效）
- **幕 3 / 3b / 4 / 5**：面板式大屏（走廊微观仿真、配时对比、效果评估、技能固化）

两类幕共用同一个壳：顶部步骤栏 + `?scene=` 路由，各自只读自己的 `data/1-*.json`。

## 启动

```bash
cd frontend
npm install
npm run dev
```

默认打开幕 3（优化方案）。浏览器访问控制台提示的本地地址（默认 `http://localhost:5174`）。
3D 幕建议 1600×900 以上窗口，卡片较多。

## 独立调试

| URL | 幕 | 形态 |
|-----|-----|------|
| `?scene=0` | 开幕 | 3D · 城市扫描 → 问题路段标红闪烁 → 拉近镜头 |
| `?scene=1` | 问题定位 | 3D · 走廊揭示 + 高德式路况 + 指标卡 + 双路口渠化 |
| `?scene=2` 或 `?scene=cause` | 分析成因 | 3D 原生幕 · 上游 3 跳流量溯源 → 供需 → 绿灯约束 → 溢流 |
| `?scene=3` 或 `?scene=plan` | 优化方案 | 面板 |
| `?scene=3b` 或 `?scene=signal` | 信控方案调节 | 面板 |
| `?scene=4` 或 `?scene=effect` | 效果评估 | 面板 |
| `?scene=5` 或 `?scene=skill` | 技能固化 | 面板 |

顶部步骤栏可直接点选切幕，编号与 `?scene=` 取值一致；`←` / `→` 前后切幕。

## 目录

```text
src/app/AppChrome.vue              # 大字报标题 + 步骤栏 + 执行状态
src/scenes/scene0-opening/         # 挂 MapRuntime（idle 开幕）
src/scenes/scene1-problem-locate/  # 挂 TrafficOriginScene + act-01，另补双路口渠化
src/scenes/scene2-cause-analysis/  # 挂 TrafficOriginScene + act-02（原生流量溯源）
src/scenes/scene3-optimization/    # 对齐 agent-loop act-08 方案生成
src/scenes/scene3b-signal-plan/    # 干线协调配时 / 绿波时距图
src/scenes/scene4-effect-eval/     # 对齐 TrialEffect*
src/scenes/scene5-skill-solidify/  # 对齐 SkillBuild*
src/shared/components/SceneStage.vue   # 面板幕通用外框
src/shared/useSceneBeats.js            # 分镜节拍 / 自动化落终态

src/features/**  src/layers/**  src/mesh/**  src/geo/**   # 3D 运行时（幕 0/1/2）
```

## 3D 幕的数据与资源

| 资源 | 位置 | 说明 |
|------|------|------|
| 路网底图 | `public/jinan-full2.json`、`public/merged_network.geojson` | OSM 风格底图 + 路口/道路拓扑 |
| 城市监控叠加 | `public/data/city-monitor-demo.json` | 幕 0 左栏与干线态势 |
| 幕数据 | 仓库根 `data/1-*.json` | `@data` 别名直接 import；3D 运行时按 `/data/xxx.json` 取，由 `vite.config.js` 的 `serveRepoData` 挂载 |

幕 1 的指标卡、路况着色统一读 `data/1-1-problem-locate.json` 与 `data/1-scene-objects.json`，
不再在 `fixture.js` 里抄写数值；速度缺值的 link 保持灰色，不臆造。

`act1.html` 是另一套实现的旧独立入口，不参与本应用构建（`vite.config.js` 只从 `index.html` 扫描）。

配色见 `src/styles/theme.css`（baseline 青/夜景）。实现映射见仓库 `docs/implementation-refs.md`。

## 口播 / 字幕

默认关闭（`broadcastSilent`）：开发阶段只做地图与面板动作，避免播报卡住面板揭示顺序。
需要幕 3/3b/4/5 的预合成讲解与数字人字幕时，在 `frontend/.env.local` 里设 `VITE_TTS_ENABLED=true`。

## 幕间流转

幕 1 演绎结束自动交棒到幕 2，幕 2 溢流揭示后交棒到幕 3；其余幕停在原地，用步骤栏切换。

## 自动化截图

带 `navigator.webdriver` 或系统开启「减少动态效果」时，面板幕的分镜与推理流直接落到终态，方便逐幕截图比对。
3D 幕需要等 8–12 秒让底图加载与分镜跑完。

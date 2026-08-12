# Baseline 项目分析报告（可视化代码基础）

> 分析对象：`references/baseline`  
> 目标：为当前仓库 `atx-perform`（奥体西车道/路段绩效可视化）提供可复用的架构理解与迁移清单。  
> 技术栈：Vue 3 + Vite + Three.js `0.162` + `d3-geo`

---

## 1. 项目定位

Baseline 是一套「交通智能体演示」前端：左侧分析 Tab + 中间 Three.js 地图场景 + 右侧推理面板 + 数字人播报。核心不是后台 KPI 计算，而是把诊断叙事与地图图层同步展示（区域 → 干线 → 路口 → 治理）。

业务剧本见 `references/baseline/data/剧本.md`（排队溢出诊断九幕）。前端用 5 个分析 Tab 驱动场景与面板联动，把剧本落成可点可看的可视化。

对当前项目最有价值的部分：**投影约定、底图管线、路网拓扑、路段/路口图层、渠化与排队可视化、面板驱动场景切换的编排模式**。

---

## 2. 总体架构

### 2.1 目录结构（有效代码）

```text
references/baseline/
├── public/                    # 静态底图与路网数据
│   ├── jinan-full2.json       # OSM 预投影底图（默认）
│   ├── merged_network.geojson # 业务路网拓扑（路口 Point + 路段 LineString）
│   └── jinan.geojson          # 行政区划（可选）
├── data/
│   ├── 剧本.md
│   └── case_a_demo_fixture.json   # 诊断案卷样板（未直接接线到场景）
├── src/
│   ├── App.vue / main.js
│   ├── app/                   # 壳层：AppShell + Layout
│   ├── shared/                # 场景注册、状态总线、Three 底图工厂、通用组件
│   ├── services/              # mapDataService 底图单例
│   ├── geo/                   # 投影、拓扑、溯源
│   ├── mesh/                  # 通用 mesh（粒子、聚焦层、道路等）
│   ├── features/
│   │   ├── analysis/          # 左右分析 Dock 与面板分发
│   │   └── scenes/            # 各场景 Scene*.vue + Layer + panels
│   ├── components/ThreeMap*.vue  # 遗留：高德 + Three 混合（未进主链路）
│   └── utils/                 # 瓦片 / 高德 / 百度工具（遗留）
└── ANALYSIS_PANEL_GUIDE.md    # 右侧面板职责边界说明（与实现略有差异）
```

### 2.2 运行时拓扑

```text
App.vue
 └─ AppShell.vue
      ├─ sceneRegistry → 异步场景组件
      ├─ activeAnalysisTab → TAB_AUTO_SCENE 强制切场景
      └─ MainLayout.vue
           ├─ AnalysisDockLeft   → DrilldownSidebar(side=left)  Tab 导航 + 左面板
           ├─ SceneViewport      → 当前 Scene*.vue（完整自建 Three 场景）
           ├─ AnalysisDock       → DrilldownSidebar(side=right) 右面板推理
           ├─ DigitalAvatar      → TTS / 播报
           └─ scene-switcher     → 按 Tab 过滤底部可切场景按钮
```

### 2.3 核心状态模块

| 模块 | 路径 | 职责 |
|------|------|------|
| 场景注册 | `src/shared/scene-registry.js` | `sceneRegistry[]`：key / name / 异步 component |
| 场景总线 | `src/shared/event-bus.js` | `activeSceneKey`、`selectedEntity`、`odZonesVisible`、`setSelection` / `setActiveScene` |
| 分析状态 | `src/shared/analysis-state.js` | Tab、就绪位、扫描触发、区域锁定、动画缓存 |
| 播报总线 | `src/shared/broadcast-bus.js` | `triggerBroadcast` / `afterBroadcastDone` |
| 底图服务 | `src/services/mapDataService.js` | `getMapData()` 单例缓存；`setMapUrl` 可换底图 |

### 2.4 Tab ↔ 场景 ↔ 面板映射

| 分析 Tab | 自动场景 (`AppShell`) | 底部可切场景 (`MainLayout`) | 面板组件 (`DrilldownSidebar`) |
|----------|----------------------|-----------------------------|-------------------------------|
| `city` 全域态势 | `traffic-origin` | 无（隐藏底栏） | `CityScanPanel` |
| `region` 区域诊断 | `scene-region` | region / a / origin / b | `ODFlowPanel` |
| `arterial` 干线诊断 | `scene-e` | 无 | `CongestionPanel` |
| `intersection` 路口诊断 | `scene-c` | scene-c | `IntersectionDiagPanel` |
| `governance` 治理方案 | `scene-region` | scene-region | `GovernanceAdvicePanel` |

说明：

- `SceneD.vue` 仅为占位；全域扫描逻辑在 `CityScanPanel`，视觉联动发生在 `TrafficOriginScene`。
- `ANALYSIS_PANEL_GUIDE.md` 建议按 `selection.type` 分发；**当前实现按 Tab 分发**，`setSelection` 协议存在但主链路未严格使用。

---

## 3. 页面与场景逻辑

### 3.1 通用交互时序

```text
切换 Tab
  → AppShell 自动切场景 / MainLayout 过滤底栏
  → leftPanelReady / rightPanelReady 复位
左面板指标动画完成 → leftPanelReady = true
右面板 AgentReasoning 开始
  → phase-start：切场景 / 开图层 / 激活溯源
  → done：rightPanelReady / showOdZones / markSeenAnimation
3D 场景 watch 就绪位 → 显示交互元素或飞入相机
```

这是当前项目复用叙事可视化时最值得保留的编排模式：**面板负责“何时”，图层负责“画什么”**。

### 3.2 traffic-origin（车流溯源）

- **文件**：`features/scenes/traffic-origin/TrafficOriginScene.vue`（本地 `mesh/`、`geo/` 与全局副本同源）
- **职责**：全城路网 + 车流粒子；点击路口聚焦上下游溯源；响应全域扫描与 OD 围栏。
- **交互**：
  1. 射线拾取最近路口 → `selectIntersection` → 聚焦层
  2. 空白点击 → `clearFocus`
  3. `cityScanTriggered` → CSS 扫描光带
  4. `odZonesVisible` → 叠加 OD 电子围栏并抬升相机
- **视觉元素**：OSM 底图、济南路网装饰、`FlowParticles`、`createFocusLayer`（Ribbon + 箭头）、OD 围栏、HUD
- **数据**：`/merged_network.geojson`、`scene-a/tfcunit.json`、`/jinan-full2.json`

### 3.3 scene-region（目标区域）

- **文件**：`features/scenes/scene-region/SceneRegionArea.vue`
- **职责**：区域/治理第一屏，只画目标片区电子围栏。
- **逻辑**：`selectedRegion` → 名称→Feature 索引 → `createOriginAreaLayer` → `frameCamera`
- **数据**：`tfcunit.json`（8 个 Polygon）；名称映射硬编码（舜耕路/泺源大街/解放路等）

### 3.4 scene-a（OD 飞线）

- **文件**：`SceneA.vue` + `odLayer.js` + `panels/ODFlowPanel.vue`
- **职责**：区域 OD 三模式：`outbound` / `inbound` / `transit`
- **视觉**：围栏墙、marker、锥形渐变管飞线、箭头、边界粒子
- **面板驱动**：推理阶段通过 `setActiveScene` 切到 scene-a / traffic-origin / scene-b
- **数据**：`tfcunit.json`；权重读取 `flow|volume|count|value`，否则按索引排名

### 3.5 scene-b（拥堵蔓延）

- **文件**：`SceneB.vue` + `congestionLayer.js` + `panels/CongestionPanel.vue`
- **职责**：从固定原点路口做波前着色（绿→黄→红）+ 涟漪；相机随波东移
- **关键 API**：`computeWaveTimes`、`buildCongestionRoads`、`createCongestionLayer`
- **注意**：`CongestionPanel` 挂在 arterial Tab；其中「干线流量溯源」phase 实际驱动的是 **SceneE** 的 `arterialTracingActive`

### 3.6 scene-c（路口诊断 / 渠化）

- **文件**：`SceneC.vue` + `channelizationLayer.js` + `intersection_links.json`
- **职责**：路口点选 → 进入渠化微观视图（车道、停车线、转向箭头、排队车模）
- **关键 API**：`createChannelizationLayer(interItem, queueData?)`、`disposeChannelizationLayer`
- **旁路未挂载**：`IntersectionChannelizationCanvas.vue` + `路口车道数据.json`（2D 车道明细，约 594 路口）
- **对车道绩效最直接**：几何与排队可视化可换真实 `queueM` / `satPct`

### 3.7 scene-d（全域扫描）

- 场景组件占位；真实流程在 `CityScanPanel`：
  - 扫前隐藏 header → 触发 `triggerGlobalScan` → 推理 → `cityAnalysisDone` + `showOdZones`
  - 排行点击 → `switchAnalysisTabWithContext('region', name)` 锁定区域

### 3.8 scene-e（干线诊断）

- **文件**：`SceneE.vue` + `arterialTracingLayer.js` + `GovernanceAdvicePanel.vue`（治理 Tab）
- **职责**：筛选 `road_names` 以「经十路:」开头的干线路段；Line2 加粗；信号灯路口标签；重点路口扩散环
- **溯源层**：`createArterialTracingLayer` 对干线 4km 内邻接路段 BFS，画流向箭头
- **联动**：`rightPanelReady` 揭示路口；`arterialTracingActive` 开启溯源层

---

## 4. 功能清单（按能力）

| 能力 | 实现位置 | 说明 |
|------|----------|------|
| 分析 Tab 流程导航 | `analysis-state.js` + `DrilldownSidebar` | city→region→arterial→intersection→governance |
| 场景懒加载切换 | `scene-registry.js` + `AppShell` | `defineAsyncComponent` |
| OSM 科技感底图 | `createOSMLayer` + `mapDataService` | 道路发光线、建筑轮廓、水体/绿地 |
| 业务路网装饰 | `createJinanBaseMapLayer` | 信号灯点、道路 mesh |
| 车流粒子 | `mesh/particles.js` → `FlowParticles` | 权重来自拓扑流量 |
| 路口聚焦溯源 | `mesh/focusLayer.js` + `geo/tracing.js` | Ribbon + 上下游路径 |
| OD 围栏/飞线 | `scene-a/odLayer.js` | 片区对比与流向叙事 |
| 拥堵波前 | `scene-b/congestionLayer.js` | BFS 时序着色 |
| 路口渠化 | `scene-c/channelizationLayer.js` | 车道级微观视图 |
| 干线走廊 | `scene-e` + `arterialTracingLayer.js` | 走廊绩效/关联路段 |
| 智能体推理动画 | `AgentReasoning.vue` | 多阶段 phase-start/done |
| TTS 播报 | `DigitalAvatar` + vite TTS 代理 | 演示增强，非可视化核心 |
| 地图对象选择协议 | `setSelection({type,id,name,payload})` | 文档有、主链路弱使用 |

---

## 5. 视觉元素与图层资产

### 5.1 底图分层

| 层 | 工厂 | 数据 | 用途 |
|----|------|------|------|
| OSM 科技底图 | `shared/three/createOSMLayer.js` | `/jinan-full2.json` | 夜景道路/建筑轮廓/水系/绿地 |
| 业务路网 | `createJinanBaseMapLayer` | `/merged_network.geojson` | 拓扑、粒子、拥堵、干线 |
| 区划（可选） | `mesh/districts.js` | `/jinan.geojson` | 当前底图工厂中已注释 |
| 瓦片地面（遗留） | `mesh/mapGround` + `utils/tiles` | 高德瓦片 | 仅 ThreeMap 时代 |

### 5.2 业务图层导出速查

| 模块 | 关键导出 | 适合复用场景 |
|------|----------|--------------|
| `odLayer.js` | `createODLayer`, `createOriginAreaLayer` | 片区绩效、OD 贡献 |
| `congestionLayer.js` | `createCongestionLayer`, `computeWaveTimes` | 路段服务水平时序 |
| `channelizationLayer.js` | `createChannelizationLayer` | **车道级绩效** |
| `arterialTracingLayer.js` | `createArterialTracingLayer` | 走廊关联路段 |
| `mesh/particles.js` | `FlowParticles` | 流量动效 |
| `mesh/focusLayer.js` | `createFocusLayer` | 热点路口周边 |
| `geo/loader.js` | `project`, `loadGeoData`, `getRoadClass` | 全项目坐标底座 |
| `geo/topology.js` | `computeFlows` | 粒子/权重 |
| `geo/tracing.js` | `buildTopology`, `traceFlows`, `findNearestIntersection` | 上下游分析 |

### 5.3 Three.js 约定（迁移必须统一）

```text
投影中心：CENTER_LON=117.096, CENTER_LAT=36.662
尺度：1 Three 单位 = 10 米（METERS_PER_UNIT=10）
平面：project(lon,lat) → [x东, y北]
Three：z = -y（东为 +X，北为 -Z）
背景色：#040c1e；多数场景 ACES Filmic
```

相机习惯：

- 全城俯视（origin / scene-b）：`camera.up = (0,0,-1)` + OrbitControls
- OD / 区域：包围盒 `frameCamera`
- 路口 / 干线：Perspective + lerp 飞行 `_fly`

**现状限制**：每个 Scene 各自完整初始化 Renderer/Camera/Controls，没有共享 MapRuntime。当前项目建议抽一层：

```text
MapRuntime
  ├─ renderer / camera / controls
  ├─ baseLayers: OSM + Network
  └─ overlayStack: congestion | channelization | arterial | focus | od ...
```

---

## 6. 数据依赖

### 6.1 主数据文件

| 文件 | 结构摘要 | 使用方 |
|------|----------|--------|
| `public/jinan-full2.json` | `meta{centerLon,centerLat,metersPerUnit}`；`roads[{t,p}]`；`buildings[{h,p}]`；`waters/parks/greens` | OSM 底图 |
| `public/merged_network.geojson` | Point≈1310 + LineString≈2666 | 拓扑/粒子/拥堵/干线 |
| `scene-a/tfcunit.json` | Polygon Feature × 8 | OD / 区域围栏 |
| `scene-c/intersection_links.json` | 594×`{intersection_info, surrounding_links}` | 渠化主数据 |
| `scene-c/路口车道数据.json` | 594×`{intersection_info, surrounding_lanes}` | 2D Canvas（未挂主场景） |
| `data/case_a_demo_fixture.json` | 诊断工单/阶段/方案字段样板 | 未接线 |
| `public/jinan.geojson` | MultiPolygon 区划 | districts 可选层 |

### 6.2 merged_network 关键字段

**Point（路口）**

- `inter_id`, `inter_name`, `is_signlight`, `break_reason`

**LineString（路段）**

- `link_id`, `from_inter_id`, `to_inter_id`, `distance_m`
- `road_class_group`, `fc`, `road_names`, `path_inter_ids`
- `avg_lanes`, `max_speed` 等

### 6.3 intersection_links 协议（车道绩效优先）

```text
{
  intersection_info: {
    inter_id, inter_name, longitude, latitude, center_point
  },
  surrounding_links: [
    {
      link_id, road_name, geom(LINESTRING WKT),
      f_inter_id, t_inter_id, f_angle, t_angle,
      length_m, lane_num, c_lane_num, max_speed, lane_info
    }
  ]
}
```

排队模拟输入（SceneC 硬编码示例）：

```js
QUEUE_DATA['经十路与历山路路口'] = [
  { armAngle, queueM, satPct }, // 按臂
]
```

### 6.4 jinan-full*.json 道路等级 `t`

| t | 含义 | 显示 |
|---|------|------|
| 1 | motorway | 亮橙发光 |
| 2 | trunk | 金橙 |
| 3 | primary | 亮青白 |
| 4 | secondary | 青灰 |
| 5–8 | tertiary / residential / service / footway | 隐藏 |

换底图：跑 `src/map/parse-map.cjs` 生成新 JSON，或 `setMapUrl('/xxx.json')`。

---

## 7. 可复用组件与模块

### 7.1 UI / 编排（可选复用）

| 组件 | 路径 | 复用建议 |
|------|------|----------|
| `MainLayout` / `SceneViewport` / Dock | `src/app/layout/*` | 可借鉴三栏布局，不必照搬数字人 |
| `DrilldownSidebar` | `features/analysis/DrilldownSidebar.vue` | Tab 分发壳层 |
| `AgentReasoning` | `shared/components/AgentReasoning.vue` | 多阶段叙事时复用 |
| `ContextHint` | `shared/components/ContextHint.vue` | Tab 跳转提示 |
| `DigitalAvatar` | `shared/components/DigitalAvatar.vue` | 演示播报；绩效工具可省略 |
| `useAnalysisData` | `features/analysis/composables/useAnalysisData.js` | **仅占位**，需自建真实 KPI composable |

### 7.2 可视化核心（强烈建议迁移）

按对「奥体西车道/路段绩效」价值排序：

#### P0 — 直接可迁

1. **`channelizationLayer.js` + `intersection_links` 协议**  
   车道几何、转向箭头、排队车模；对接真实排队/饱和度即可。
2. **`geo/loader.project` + 坐标约定**  
   与济南现有数据一致；奥体西局部可用同一投影，或改中心点。
3. **`createOSMLayer` + `mapDataService`**  
   夜景底图与换图管线。
4. **`createJinanBaseMapLayer` + `merged_network` 字段模型**  
   路段着色、路口拾取的底座。
5. **`createFocusLayer` + `traceFlows`**  
   热点路口/路段周边汇聚高亮。

#### P1 — 强相关增强

6. `FlowParticles` + `computeFlows` — 流量权重换真实 KPI  
7. `congestionLayer` — 路段 LOS / 拥堵时空动画  
8. `odLayer` 围栏/飞线 — 片区对比  
9. `SceneE` Line2 干线 + `arterialTracingLayer` — 走廊诊断  
10. `leftPanelReady` / `phase-start` / `setActiveScene` 编排 — 分析与图层同步

#### P2 — 壳层 / 备用

11. `AgentReasoning` / `broadcast-bus` / `DigitalAvatar` — 演示叙事  
12. `IntersectionChannelizationCanvas` + `路口车道数据.json` — 2D 车道明细  
13. `case_a_demo_fixture.json` — 诊断流水线字段样板  
14. `ThreeMap.vue` — 仅当必须叠高德实景时参考

### 7.3 迁移注意

1. **统一投影**：避免 SceneC/E 内联 `project` 与 `geo/loader` 双份实现继续分叉。  
2. **抽 MapRuntime**：共享 renderer，图层以 stack 挂载/卸载。  
3. **统一选择协议**：要么按 `selection.type`（文档），要么按 Tab（现状），不要两套并行。  
4. **面板指标多为 Demo 硬编码**：可沉淀的是几何与拓扑，不是面板数字。  
5. **`traffic-origin/mesh|geo` 与 `src/mesh|geo` 重复**：迁移时只保留一份。  
6. baseline 在 `.gitignore` 中（`references/baseline/`），分析文档在 `docs/`，实现代码应落到当前项目 `frontend/` 等正式目录，而不是直接改 baseline。

---

## 8. 对当前项目（atx-perform）的落地建议

### 8.1 建议的前端目录（从 baseline 抽取）

```text
frontend/
  src/
    app/                 # 壳层（可简化，先不做数字人）
    shared/
      three/             # createOSMLayer, createJinanBaseMapLayer
      constants.js       # 投影中心、场景 key
    services/
      mapDataService.js
    geo/                 # loader / topology / tracing
    layers/              # 从 scenes/*Layer 抽纯图层（无面板耦合）
      channelization.js
      congestion.js
      arterial.js
      od.js
      focus.js
      particles.js
    features/
      map/MapRuntime.vue # 统一 Three 运行时
      panels/            # 绩效指标面板（接真实 API）
    data/                # 奥体西局部 geojson / 路口渠化切片
```

### 8.2 推荐实现顺序

1. **底座**：投影 + OSM 底图 + merged_network 路网显示  
2. **路段绩效**：按 link_id 着色（速度/饱和度/排队）+ 拾取高亮  
3. **路口微观**：接入 `channelizationLayer`，排队数据接 KPI  
4. **走廊视图**：干线 Line2 + 关联路段溯源  
5. **叙事编排**（可选）：Tab / phase 驱动图层显隐

### 8.3 与 env 的衔接

当前仓库 `env.example` 已预留 PG/MySQL/地图 Key。可视化侧建议后续补充：

- 底图 URL / 局部路网切片路径  
- 默认聚焦路口 / 干线 ID（奥体西走廊）  
- KPI 接口基址（替代面板硬编码）

---

## 9. 场景对照总表

| 场景 key | Vue | 主 Layer | 主数据 | 驱动信号 |
|----------|-----|----------|--------|----------|
| traffic-origin | `TrafficOriginScene` | focus + particles + OD fence | merged_network, tfcunit, jinan-full2 | cityScan / odZones / setSelection |
| scene-region | `SceneRegionArea` | `createOriginAreaLayer` | tfcunit + selectedRegion | Tab auto |
| scene-a | `SceneA` | `createODLayer` | tfcunit | ODFlowPanel → setActiveScene |
| scene-b | `SceneB` | `createCongestionLayer` | merged_network | 底栏；面板挂 arterial |
| scene-c | `SceneC` | `channelizationLayer` | intersection_links | Tab auto |
| scene-d | 占位 | — | — | CityScanPanel 在 Dock |
| scene-e | `SceneE` | Line2 + arterialTracing | merged_network | rightPanelReady / arterialTracingActive |

---

## 10. 结论

Baseline 提供的不是完整业务后端，而是一套**可运行的交通可视化叙事骨架**。对 atx-perform 而言：

- **必拿**：坐标投影、底图服务、路网字段模型、渠化层、聚焦/干线/拥堵等纯图层模块。  
- **可选**：Agent 推理动画、TTS、数字人、全域扫描 CSS 特效。  
- **需自建**：奥体西局部数据切片、真实 KPI 接入、统一 MapRuntime、按绩效对象（lane / link / intersection）的选择与面板协议。

以此文档为索引，实现阶段应优先从 P0 资产迁入 `frontend/`，再替换 Demo 数据为奥体西绩效真源。

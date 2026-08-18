# 系统架构图绘制 Prompt v3（双工程：agent 闭环后端 + 纯前端演绎大屏）

> 用途：投喂绘图 AI / 绘图工具，绘制 atx-perform + agent-loop-project 的分层系统架构图。
> 生成日期：2026-08-18。基于两工程实际代码结构走查产出，勿凭空增删模块。

```
请绘制一张「分层 + 双工程泳道」的系统架构图，描述济南奥体西路路口拥堵治理智能体系统。
系统由两个工程组成：
① agent-loop-project —— 真正的 Agent 架构（FastAPI 后端 + Agent 技能闭环 + 内网大模型）
② atx-perform —— 纯前端展示工程（无后端依赖，回放 agent 闭环沉淀的剧本数据，
   面向领导汇报的六幕演绎大屏：主动巡检 → 问题定位 → 分析成因 → 优化方案 →
   效果评估 → 技能固化）
两个工程的关系：agent 闭环产出结论与技能 → 剧本化落盘 → 纯前端大屏演绎回放。

【总体布局】
自下而上五个水平分层；中间一层分为左右两个工程泳道（左：agent-loop-project 后端域；
右：atx-perform 纯前端域）；右上角单独一个「内网部署区」（大模型/TTS，用隔离虚线框
与锁形图标表示内网）。右侧纵向侧栏标注运行时驱动源。整体横向 16:9。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第一层 · 设备感知层（交警侧路侧设备，数据最终来源）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
设备图标：视频摄像头（轨迹/排队观测）、雷视一体机（分车道流量/速度/排队）、
电井/线圈（断面过车/占有率）、信号机（相位/配时灯态）。
向上箭头标注「感知数据汇聚」，汇入数据层。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第二层 · 数据层（真源与剧本双轨）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
左半（Live 真源轨）：PostgreSQL 真源库 —— 设备感知数据落库，供 agent 实时取数
右半（剧本资产轨，atx-perform 消费）：
- 幕剧本 JSON（data/1-*.json：1-0-opening … 1-5-skill-solidify、1-3-signal-plan、
  1-scene-objects、1-sniff-report）—— agent 闭环结论的剧本化落盘
- TTS 资产（data/tts/）：scripts.json 口播文案 + manifest 时长 + 预合成 WAV
- 地理底图（frontend/public/）：jinan-full.json、merged_network.geojson、
  city-monitor-demo.json
- 固化技能（data/skills/）：SKILL.md 技能包（与 agent-loop skills/ 同构）
中间画一条「沉淀」箭头：agent 后端域 → 剧本资产轨，标注
「结论剧本化 + 技能固化 + 口播合成（离线产物）」

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第三层左泳道 · Agent 后端域（agent-loop-project，FastAPI）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
模块框：
1. API 接入（app/api/）：routes.py + response_builder，/api/v1 对前端输出诊断结论
2. Agent 运行时（app/runtime/）：executor 执行器 + skill_loader/registry 技能装载注册
   + pipeline_validation 流水线校验 —— 画成循环箭头表示 Agent Loop
3. 技能库（skills/）：intent-understanding 意图理解 → data-analysis-diagnosis
   数据分析诊断 → cause-analysis 成因分析 → strategy-generation 策略生成 →
   plan-generation 方案生成（五技能流水线，顺序连线）
4. 领域计算（app/decision/ + app/optimization/ + app/metrics/ + app/trace/）：
   溢出机理（overflow_mechanism）、有效绿（effective_green）、进口压力等确定性计算
5. LLM 客户端（app/llm/qwen.py）：调用大模型 —— 箭头指向「内网部署区」
   大模型（内网部署），标注「推理请求/内网专线」
6. 数据服务（app/services/ + app/data/）：PG 真源取数 + demo 回退
依赖箭头：PostgreSQL ↔ 数据服务 → 领域计算 → 技能流水线；LLM 客户端 ↔ 技能流水线
（每个技能节点均可调用大模型）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
内网部署区（右上独立虚线隔离框，锁形图标）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- 大模型服务（Qwen 系列，QWEN_BASE_URL 指向内网端点）—— Agent 推理
- TTS 语音合成服务（Qwen-TTS，scripts/synthesize_tts.py 离线调用）—— 生成口播 WAV
两者均标注「内网部署 · 不出专网」

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第三层右泳道 + 第四层 + 第五层 · atx-perform 纯前端域（无后端，Vite 静态部署）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
顶部醒目注释：「纯前端展示工程：零后端依赖，全部数据来自第二层剧本资产轨」

子层 3R · 前端服务层（frontend/src/services/）：
- loadSceneData.js：loadJson/loadSceneBundle，经 Vite @data 别名静态 import 剧本 JSON
- fixtureAdapter/caseFixture/runtimeFixture：剧本 → 运行时 fixture
- api/（client/endpoints/sse）：保留的可选通道，虚线框标注「本工程未启用后端」

子层 4 · 核心业务层（features/acts + shared 引擎 + layers 特效 + 仿真引擎）：
A 指挥家时序引擎（shared/）：conductor/conductor.js（语音主轴节拍引擎）、
  sceneNarration.js、broadcast-bus.js + tts.js（WAV 播放）、act-voice/act-playback/
  act-timing、useSceneRoute + scene-registry（?scene=0..5 路由，展示编号 1–6）
B 幕演绎逻辑（features/acts/）：act-registry（可插拔幕注册）、act-01-problem-locate
  （state 状态机/timeline 拍表/actMapFx 特效工厂/ProblemLocateStage 舞台）、
  act-02-flow-trace（Act2FlowStage/flowTraceMapFx playBeat 五拍）
C 3D 地图运行时（features/scenes + layers/）：TrafficOriginScene.vue（THREE.js 主场景）、
  MapRuntime.vue、inflowTraceLayer/jingshiEwFlowLayer/problemLinkAlert 等特效图层、
  geo/loader.js 经纬度投影
D 走廊仿真引擎（scenes/scene3-optimization/）：corridorSim 微观仿真核 →
  corridorDemo 预计算前后轨迹 → CorridorStage 渲染

子层 5 · 展示层（app 壳层 + scenes 幕页面 + UI）：
- 壳层：AppShell.vue（动态幕挂载）+ AppChrome.vue（步骤栏 1–6、执行状态）
- 幕页面：scene0 主动巡检 / scene1 问题定位 / scene2 分析成因 / scene3 优化方案
  （PlanComparePanel、PhaseSequenceBoard、CorridorStage）/ scene3b 信控方案
  （TimeSpaceDiagram 绿波时距图）/ scene4 效果评估（★ 三层决策看板
  DecisionBoardPanel + BoardComparePanel + BoardTimingBars；TrialEffectPanel
  保留未引用、TrialEffectDrawer 已移除）/ scene5 技能固化（呼应左侧技能库）
- 通用 UI：HeadlineOverlay 大字报、DigitalAvatar 数字人、SceneStage

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【关键数据流箭头（带标注）】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
0. 感知采集链：摄像头/雷视/电井/信号机 → PostgreSQL（Live 真源）
1. Agent 闭环链（左泳道核心，高亮粗线）：
   PG 取数 → 领域计算 → 技能流水线（五技能，逐步调用内网大模型）→ 诊断结论/优化方案
2. 模型调用链（跨内网边界，虚线 + 锁）：app/llm/qwen.py ↔ 内网大模型；
   synthesize_tts.py ↔ 内网 TTS → WAV 落入 data/tts/
3. 沉淀链（跨工程粗实线，全图点睛）：Agent 闭环结论 → data/1-*.json 剧本 +
   data/skills/ 技能包 + WAV 口播（标注：离线剧本化，一次生成、反复回放）
4. 剧本消费链（右泳道粗实线）：剧本 JSON → loadSceneData → 幕页面 → 子面板
5. 路由链：?scene=0..5 → useSceneRoute → scene-registry → AppShell + 步骤栏
6. 语音指挥链（右泳道高亮线）：WAV + scripts.json → conductor 逐拍 →
   三路输出：大字报 / 侧板逐条 / mapBeat → TrafficOriginScene → 特效图层动作
7. 仿真对比链：corridor_demo 数据 → corridorSim → corridorDemo →
   CorridorStage 双面板与 scene4 决策看板同步播放
8. 技能闭环链（虚线回环，首尾呼应）：scene5 技能固化展示 ←→ agent-loop skills/
   技能库（标注：技能资产同构，大屏沉淀回技能库）

【右侧驱动源侧栏】语音主时钟（conductor beat）、rAF/定时器（仿真播放）、URL 路由

【视觉规范】
- 左泳道（agent 后端）用 Python/服务端色系（深蓝灰）；右泳道（纯前端）用青色系；
  内网部署区用深色隔离框 + 锁图标；设备层深灰金属质感
- 跨工程「沉淀链」箭头是全图叙事核心，用最粗最高亮的样式
- 实线=数据流；高亮线=时序驱动；虚线=可选/离线/跨内网；圆角框=组件，方框=模块
- 不要画出已删除的模块：map-bridge.js、MapAnchoredCard.vue、TrialEffectDrawer.vue、
  data/tts/scene2/

【参考结构（Mermaid 校验骨架）】
graph BT
  subgraph L0[设备感知层]
    E1[摄像头] ; E2[雷视] ; E3[电井/线圈] ; E4[信号机]
  end
  subgraph L1[数据层]
    P[(PostgreSQL 真源)] ; D1[幕剧本 data/1-*.json] ; D2[TTS WAV] ; D3[地理底图] ; D4[skills 技能包]
  end
  subgraph AL[agent-loop-project · Agent 后端域]
    API[app/api] ; RT[runtime executor+skill_loader] ; SK[skills 五技能流水线]
    DM[decision/optimization 领域计算] ; LLM[app/llm/qwen.py]
  end
  subgraph NET[内网部署区]
    M1[大模型 Qwen 内网] ; M2[TTS 合成 内网]
  end
  subgraph PF[atx-perform · 纯前端展示域]
    SV[loadSceneData 服务层] ; CO[conductor 指挥家] ; ACT[acts 幕逻辑]
    THREE[TrafficOriginScene+layers] ; SIM[corridorSim 仿真] ; UI[scenes 六幕+决策看板]
  end
  E1 & E2 & E3 & E4 --> P
  P --> DM --> SK --> RT --> API
  LLM <-.内网专线.-> M1
  SK <-.调用.-> LLM
  M2 -.离线合成.-> D2
  SK ==沉淀：剧本化+技能固化==> D1
  SK ==沉淀==> D4
  D1 --> SV --> UI
  D2 --> CO --> ACT --> THREE --> UI
  D3 --> THREE
  D1 --> SIM --> UI
  D4 <-.技能闭环.-> UI
```

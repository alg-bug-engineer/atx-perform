/**
 * 幕 1 · 问题定位 — 模块数据装配
 *
 * 一律读本幕的本地 JSON，不再抄写数值：
 * - data/1-scene-objects.json（路口坐标 / 问题路段几何）
 * - data/1-1-problem-locate.json（指标卡、路况着色 16 条 link）
 * - docs/data-sniff-report.md（车流量 520 辆/h 等库内缺项）
 *
 * 场景：线优化案例 —— 奥体西路·经十路上游区域
 * 关键路口：
 *   - 坤顺路与奥体西路路口（北，上游上游）
 *   - 解放路与奥体西路路口（中，上游）
 *   - 经十路与奥体西路路口（南，目标）
 * 主流向：奥体西路 北向南（N→S）
 */

import sceneObjects from '@data/1-scene-objects.json';
import locateData from '@data/1-1-problem-locate.json';

const SCENE_INTERSECTIONS = sceneObjects.intersections || {};
const SCENE_PROBLEM_LINK = sceneObjects.problem_link || {};
const LOCATE_METRICS = locateData.problem_link_metrics || {};
const COLOR_LINKS = locateData.traffic_color_links || [];

/** 幕 1 三拍文案 / HUD / 时长，结构与幕 2 map_beats 对齐。 */
export const PROBLEM_LOCATE_BEATS = locateData.map_beats || {};

function colorLink(linkId) {
  return COLOR_LINKS.find((l) => l.link_id === linkId) || {};
}

/** 投影中心与尺度（对齐 geo/loader.js：1 单位 = 10 m） */
export const PROJECTION = {
  centerLon: 117.096,
  centerLat: 36.662,
  metersPerUnit: 10,
  // 定位态镜头：高度 135，FOV 45°，地面可见半高 ≈ 135*tan(22.5°) ≈ 55.9 单位
  holdCamHeight: 135,
  holdCamFovDeg: 45,
};

/** 三个关键路口 */
export const INTERSECTIONS = {
  // 目标路口（下游，幕镜头锚点）
  jingshi: {
    interId: SCENE_INTERSECTIONS.downstream_jingshi?.inter_id,
    name: '经十路与奥体西路路口',
    shortName: '经十路口',
    role: 'downstream_target',
    lon: SCENE_INTERSECTIONS.downstream_jingshi?.lon,
    lat: SCENE_INTERSECTIONS.downstream_jingshi?.lat,
  },
  // 上游路口（问题路段北端）
  jiefang: {
    interId: SCENE_INTERSECTIONS.upstream_jiefang?.inter_id,
    name: '解放路与奥体西路路口',
    shortName: '解放路口',
    role: 'upstream_overflow_risk',
    lon: SCENE_INTERSECTIONS.upstream_jiefang?.lon,
    lat: SCENE_INTERSECTIONS.upstream_jiefang?.lat,
  },
  // 上游上游路口（坤顺路，线优化廊道北端）
  kunshun: {
    interId: '011wwe28fty00001',
    name: '坤顺路与奥体西路路口',
    shortName: '坤顺路口',
    role: 'upstream_corridor_north',
    // 由渠化几何端点标定：奥体西路:无名道路-坤顺路(南向北) 北端点
    lon: 117.1112,
    lat: 36.6651,
  },
};

/** 问题路段（奥体西路:解放东路-经十路 北向南） */
export const PROBLEM_LINK = {
  linkId: SCENE_PROBLEM_LINK.link_id,
  roadName: SCENE_PROBLEM_LINK.road_name,
  direction: SCENE_PROBLEM_LINK.direction,
  lengthM: SCENE_PROBLEM_LINK.length_m,
  queueLengthM: LOCATE_METRICS.queue_length_m, // 专家调研值 270 m（强制）
  queueLengthSource: LOCATE_METRICS.queue_length_source,
  storageLengthM: LOCATE_METRICS.storage_length_m,
  storageLengthSource: LOCATE_METRICS.storage_length_source,
  avgSpeedKmh: LOCATE_METRICS.avg_speed_kmh,
  delayIndex: LOCATE_METRICS.congestion_delay_index, // 主展示
  jamDelayIndexWeekly: LOCATE_METRICS.jam_delay_index_weekly, // 周表对照
  northThroughSaturation: locateData.jingshi_north_through_saturation?.turn_saturation,
  northThroughFlowVehH: 520, // 北进口直行流量：库内在幕 2 溯源表，见 docs/data-sniff-report.md
  stateDerived: colorLink(SCENE_PROBLEM_LINK.link_id).derived_state_from_speed ?? 4,
};

/** 问题路段几何（经纬度），供幕 1 北向南标红。 */
export const PROBLEM_LINK_COORDS = colorLink(SCENE_PROBLEM_LINK.link_id)?.geom?.coordinates || [];

/** 上游坤顺段（奥体西路:无名道路-解放东路 北向南） */
const KUNSHUN_LINK_ID = '12wwe28ftwwe28fm01';
export const KUNSHUN_LINK = {
  linkId: KUNSHUN_LINK_ID,
  roadName: colorLink(KUNSHUN_LINK_ID).road_name || '奥体西路:无名道路-解放东路(北向南)',
  direction: 'N_to_S',
  lengthM: colorLink(KUNSHUN_LINK_ID).length_m,
  avgSpeedKmh: colorLink(KUNSHUN_LINK_ID).avg_speed_kmh,
  delayIndex: colorLink(KUNSHUN_LINK_ID).delay_index_mm,
  jamDelayIndexWeekly: colorLink(KUNSHUN_LINK_ID).jam_delay_index_weekly,
  stateDerived: colorLink(KUNSHUN_LINK_ID).derived_state_from_speed ?? 4,
  gaps: ['GAP-NORTH-LR-FLOW'], // 坤顺路口无转向流量数据
};

/** 诊断工单（对齐主工程 diagnosis_ticket 结构） */
export const DIAGNOSIS_TICKET = {
  // 路段问题：问题路段为奥体西路与经十路北入口（排队外溢），非路口问题
  object_type: 'link',
  object_type_label: '路段',
  link_id: PROBLEM_LINK.linkId,
  link_name: PROBLEM_LINK.roadName,
  intersection_name: '经十路与奥体西路路口',
  time_range: '17:00–19:00',
  period: '晚高峰',
  direction: '北向南',
  movement: '直行',
  problem_type: '排队外溢',
  constraints: ['避免加重下游拥堵'],
  constraint_text: '避免加重下游拥堵',
  diagnosis_scope: '经十路与奥体西路路口 + 解放路与奥体西路路口',
  diagnosis_scope_raw: ['经十路与奥体西路路口', '解放路与奥体西路路口'],
  governance_goal: '配时优化',
  inter_id: INTERSECTIONS.jingshi.interId,
  lng: INTERSECTIONS.jingshi.lon,
  lat: INTERSECTIONS.jingshi.lat,
};

/** 空间定位结论（对齐主工程 spatial_objects / spatial_scene 结构） */
export const SPATIAL_SCENE = {
  available: true,
  target: {
    inter_id: INTERSECTIONS.jingshi.interId,
    inter_name: INTERSECTIONS.jingshi.name,
    lng: INTERSECTIONS.jingshi.lon,
    lat: INTERSECTIONS.jingshi.lat,
    direction: '北向南',
    movement: '直行',
  },
  upstream_nodes: [
    {
      inter_id: INTERSECTIONS.jiefang.interId,
      inter_name: INTERSECTIONS.jiefang.name,
      lng: INTERSECTIONS.jiefang.lon,
      lat: INTERSECTIONS.jiefang.lat,
      role: 'upstream',
      distance_m: PROBLEM_LINK.lengthM,
    },
    {
      inter_id: INTERSECTIONS.kunshun.interId,
      inter_name: INTERSECTIONS.kunshun.name,
      lng: INTERSECTIONS.kunshun.lon,
      lat: INTERSECTIONS.kunshun.lat,
      role: 'upstream',
      distance_m: KUNSHUN_LINK.lengthM,
    },
  ],
  downstream_nodes: [
    {
      inter_id: '011wwe28cnj00001',
      inter_name: '奥体西路与无名道路路口',
      lng: 117.111833,
      lat: 36.656908,
      role: 'downstream',
      distance_m: 264.42,
    },
  ],
  main_path: '坤顺路与奥体西路路口 → 解放路与奥体西路路口 → 经十路与奥体西路路口',
  axis_roads: {
    ew_road: '经十路',
    ns_road: '奥体西路',
    road_pair: ['经十路', '奥体西路'],
    available: true,
    source: 'road_topology',
  },
};

/**
 * 信息窗口指标（北向南流向奥体西路）
 * 需求字段：车流量、排队比、延误指数、拥堵指数
 */
export const FLOW_INFO_WINDOWS = [
  {
    id: 'jingshi-n2s',
    anchor: 'jingshi',
    // 核心问题路段窗口（奥体西路·北向南）：幕 1 只展示本窗口，其余路口窗口不显示
    core: true,
    title: '奥体西路与经十路路口',
    subtitle: '奥体西路 · 北向南',
    metrics: [
      {
        key: 'flow',
        label: '车流量',
        value: '520',
        unit: '辆/h',
        status: 'normal',
        hint: '北进口直行，饱和度 0.843（GAP-NORTH-LR-FLOW：左/右转无值）',
      },
      {
        key: 'queueRatio',
        label: '排队比',
        value: '0.73',
        unit: '',
        status: 'warn',
        hint: '排队 270 m / 蓄车 367.89 m（预警线 0.8）',
      },
      {
        key: 'delayIndex',
        label: '延误指数',
        value: '5.28',
        unit: '',
        status: 'danger',
        hint: 'delay_index_mm（周表 1.32 作对照）',
      },
      {
        key: 'congestionIndex',
        label: '拥堵指数',
        value: '1.32',
        unit: '',
        status: 'danger',
        hint: 'jam_delay_index_weekly',
      },
    ],
  },
  {
    id: 'kunshun-n2s',
    anchor: 'kunshun',
    title: '坤顺路与奥体西路路口',
    subtitle: '奥体西路 · 北向南（上游）',
    metrics: [
      {
        key: 'flow',
        label: '车流量',
        value: '—',
        unit: '',
        status: 'gap',
        hint: 'GAP-NORTH-LR-FLOW：本口无转向流量数据',
      },
      {
        key: 'queueRatio',
        label: '排队比',
        value: '—',
        unit: '',
        status: 'gap',
        hint: 'GAP-QUEUE-TABLE：无排队数据',
      },
      {
        key: 'delayIndex',
        label: '延误指数',
        value: '8.30',
        unit: '',
        status: 'danger',
        hint: 'delay_index_mm（上游段）',
      },
      {
        key: 'congestionIndex',
        label: '拥堵指数',
        value: '2.19',
        unit: '',
        status: 'danger',
        hint: 'jam_delay_index_weekly（上游段）',
      },
    ],
  },
];

/**
 * 经十路口东西进口车流窗口（E→W / W→E）
 * 数据来源：data/1-1-problem-locate.json → jingshi_ew_turn_flow
 *
 * 注：幕 1 信息窗目前只展示核心问题路段窗口（core: true），
 * 本组窗口保留在 fixture 中供后续幕次复用，不参与幕 1 渲染。
 * 直行：东进口 1230 辆/h（dws_inter_link_turn_flow_5min_mm 有值）
 * 左/右转：库内绝对流量缺值（西进口全向 GAP-WEST-SAT；东进口左/右转同缺）
 * 关联影响预测：由饱和度/延误指数派生估算（非库内直读）
 *
 * 结构对齐 FLOW_INFO_WINDOWS 的 metrics 项 + 新增 turnFlow：
 *   turnFlow.turns  —— 直行/左转/右转分类流量（辆/h）
 *   turnFlow.impact —— 南北配时调整的关联影响预测
 */
export const JINGSHI_EW_FLOW_WINDOWS = [
  {
    id: 'jingshi-east-ew',
    anchor: 'jingshi',
    title: '经十路 · 东入口',
    subtitle: '经十路 · 东向西 E→W',
    flowDir: '东向西 ←',
    source: 'turn_flow_veh_h · 直行 1230',
    turnFlow: {
      turns: [
        {
          key: 'left',
          label: '左转',
          value: '—',
          unit: '辆/h',
          status: 'gap',
          hint: '东进口左转绝对流量缺值（同 GAP-NORTH-LR-FLOW 模式）',
        },
        {
          key: 'through',
          label: '直行',
          value: '1230',
          unit: '辆/h',
          status: 'normal',
          hint: '经十路:奥体东路-无名道路, 经十路:无名道路-奥体西路(东向西) 直行流量',
        },
        {
          key: 'right',
          label: '右转',
          value: '—',
          unit: '辆/h',
          status: 'gap',
          hint: '东进口右转绝对流量缺值（同 GAP-NORTH-LR-FLOW 模式）',
        },
      ],
      impact: [
        {
          key: 'throughImpact',
          label: '直行影响',
          value: '高',
          unit: '',
          status: 'warn',
          hint: '东进口直行饱和度 0.76，南北加绿将压缩东西直行绿灯',
        },
        {
          key: 'turnImpact',
          label: '转向影响',
          value: '待评估',
          unit: '',
          status: 'gap',
          hint: '东西向转向流量缺值，无法精确评估',
        },
        {
          key: 'delay',
          label: '时间延迟',
          value: '5.81',
          unit: '指数',
          status: 'danger',
          hint: '东进口拥堵延时指数 5.81，压缩绿灯后预计进一步上升',
        },
        {
          key: 'scope',
          label: '波及范围',
          value: '东西上游',
          unit: '',
          status: 'normal',
          hint: '奥体东路方向，1–2 跳溯源',
        },
      ],
    },
  },
  {
    id: 'jingshi-west-ew',
    anchor: 'jingshi',
    title: '经十路 · 西入口',
    subtitle: '经十路 · 西向东 W→E',
    flowDir: '西向东 →',
    source: 'GAP-WEST-SAT · 速度/延时降级',
    turnFlow: {
      turns: [
        {
          key: 'left',
          label: '左转',
          value: '—',
          unit: '辆/h',
          status: 'gap',
          hint: 'GAP-WEST-SAT：西进口转向流量库内全为 0',
        },
        {
          key: 'through',
          label: '直行',
          value: '—',
          unit: '辆/h',
          status: 'gap',
          hint: 'GAP-WEST-SAT：西进口直行流量库内为 0，改用速度+延时指数降级',
        },
        {
          key: 'right',
          label: '右转',
          value: '—',
          unit: '辆/h',
          status: 'gap',
          hint: 'GAP-WEST-SAT：西进口转向流量库内全为 0',
        },
      ],
      impact: [
        {
          key: 'throughImpact',
          label: '直行影响',
          value: '待评估',
          unit: '',
          status: 'gap',
          hint: '西进口直行饱和度 0（GAP-WEST-SAT），影响待补数',
        },
        {
          key: 'turnImpact',
          label: '转向影响',
          value: '待评估',
          unit: '',
          status: 'gap',
          hint: 'GAP-WEST-SAT：西进口转向流量/饱和度全为 0',
        },
        {
          key: 'delay',
          label: '时间延迟',
          value: '3.41',
          unit: '指数',
          status: 'warn',
          hint: '西进口拥堵延时指数 3.41（速度 26.2 km/h）',
        },
        {
          key: 'scope',
          label: '波及范围',
          value: '东西上游',
          unit: '',
          status: 'normal',
          hint: '欣顺路·转山西路方向，1–2 跳溯源',
        },
      ],
    },
  },
];

/** 问题理解（幕 1 前半）规划条目 */
export function planningItems() {
  const t = DIAGNOSIS_TICKET;
  return [
    `识别对象：${t.object_type_label || '路段'}`,
    `定位路段：${t.link_name}`,
    `锁定时间：${t.time_range}（${t.period}）`,
    `确认流向：${t.direction} · ${t.movement}`,
    `判定问题：${t.problem_type}`,
    t.constraint_text ? `写入约束：${t.constraint_text}` : '写入约束：无显式约束',
  ];
}

/** 空间定位（幕 1 后半）识别步骤 */
export function recognitionSteps() {
  return [
    '锁定下游路口：经十路与奥体西路路口',
    '锁定上游路口：解放路与奥体西路路口',
    '锁定廊道北端：坤顺路与奥体西路路口',
    '确认主流向：奥体西路 北向南',
    '确认问题路段：解放东路→经十路（排队 270 m）',
  ];
}

/** 结论文案 */
export const CONCLUSIONS = {
  ticket:
    '诊断工单已生成：奥体西路与经十路北入口路段 · 晚高峰北向南直行排队外溢；' +
    '目标为配时优化，诊断范围含下游经十路口与上游来车。',
  locate:
    '问题定位完成：北向南车流经坤顺路口、解放路口汇入奥体西路，' +
    '问题路段排队 270 m（蓄车 367.89 m），下游经十路口东西向饱和度偏高。',
};

/** 默认演示输入（对齐线优化案例） */
export const DEFAULT_PROMPT =
  '奥体西路与经十路北入口，晚高峰五点半到六点半，北向南直行经常排队外溢。' +
  '上游解放路口和坤顺路口也一起看看，帮忙看看配时怎么调，别加重下游拥堵。';

// ══════════════════════════════════════════════════════════════════
// 路况着色（高德语义 2D 叠加层）
// ══════════════════════════════════════════════════════════════════

/**
 * 路况着色范围：data/1-1-problem-locate.json 的 traffic_color_links（问题路段 + 周边双向 link），
 * 按剧本要求做成「高德导航实时路况」式的红黄绿，而不是只给三条。
 *
 * 数值来源：PG 嗅探（road6/xianchang，2026-05-01 路网，周一晚高峰）：
 *   dws_link_index_5min_mm.avg_speed / delay_index → 按速度派生状态
 *   ≥35→1绿 / ≥20→2黄 / ≥10→3红 / <10→4深红（data-contract.md）
 *   速度缺值的 link 保持 null（灰），不臆造。
 * Live 模式下由后端接口从 PG 读取（见 trafficColorService.js）。
 */
export const TRAFFIC_COLOR_CASE_LINKS = COLOR_LINKS.map((l) => ({
  link_id: l.link_id,
  road_name: l.road_name,
  role: l.is_problem_link ? 'north_entrance' : 'context',
  avg_speed_kmh: l.avg_speed_kmh,
  delay_index: l.delay_index_mm,
  derived_state: l.derived_state_from_speed,
  ...(l.is_problem_link ? { queue_length_m: LOCATE_METRICS.queue_length_m, is_problem_link: true } : {}),
  geom: l.geom,
}));

/**
 * 幕 2 · 流量溯源（成因分析）— 模块注册入口
 *
 * 原生幕：地图演绎由 flowTraceMapFx（地图特效工厂）在 TrafficOriginScene
 * 中直接播放，Stage 组件（Act2FlowStage）负责 HUD 渲染与交棒退出，
 * 不再切回首页跳转。
 *
 * 可插拔约定：
 * - 本文件被主工程入口（main.js）import 时产生副作用注册；
 * - 主工程其余部分只通过 act-registry 读取，不直接 import 本模块内部文件。
 */
import { registerAct } from '../act-registry.js';
import Act2FlowStage from './Act2FlowStage.vue';
import { createFlowTraceMapFx } from './flowTraceMapFx.js';
import {
  FLOW_TRACE_ACT_ID,
  FLOW_TRACE_ACT_KEY,
  FLOW_TRACE_ACT_NAME,
  completeFlowTrace,
  enterFlowTrace,
  exitFlowTrace,
  markFlowTraceRevealed,
  requestFlowTraceReplay,
} from './state.js';

export const ACT_ID = FLOW_TRACE_ACT_ID;
export const ACT_KEY = FLOW_TRACE_ACT_KEY;
export const ACT_NAME = FLOW_TRACE_ACT_NAME;

/** 幕模块描述（可插拔注册对象） */
const descriptor = {
  id: ACT_ID,
  key: ACT_KEY,
  name: ACT_NAME,
  order: 2,
  stageComponent: Act2FlowStage,
  // 地图特效工厂：TrafficOriginScene 消费，播放流量溯源完整演绎
  fxCompat: {
    createAct2FlowMapFx: createFlowTraceMapFx,
  },
  compatExports: {
    enterFlowTrace,
    markFlowTraceRevealed,
    completeFlowTrace,
    requestFlowTraceReplay,
  },
  enter: enterFlowTrace,
  exit: exitFlowTrace,
};

// 副作用注册（幂等）
registerAct(descriptor);

export default descriptor;

export { enterFlowTrace as enterAct2Flow };
export { exitFlowTrace as exitAct2Flow };
export { Act2FlowStage };

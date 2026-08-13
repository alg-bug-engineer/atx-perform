/**
 * 幕 2 · 流量溯源（成因分析）— 模块注册入口
 *
 * 可插拔约定：
 * - 本文件被主工程入口（main.js）import 时产生副作用注册；
 * - 主工程其余部分只通过 act-registry 读取，不直接 import 本模块内部文件。
 */
import { registerAct } from '../act-registry.js';
import Act2FlowStage from './Act2FlowStage.vue';
import {
  FLOW_TRACE_ACT_ID,
  FLOW_TRACE_ACT_KEY,
  FLOW_TRACE_ACT_NAME,
  enterFlowTrace,
  exitFlowTrace,
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
  // 幕 2 暂用跳转方式（切回首页「分析成因」），不提供地图特效工厂
  fxCompat: {},
  compatExports: {
    enterFlowTrace,
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

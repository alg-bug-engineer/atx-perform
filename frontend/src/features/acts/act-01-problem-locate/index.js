/**
 * 幕 1 · 问题定位 — 模块注册入口
 *
 * 合并原幕 1（诊断工单）+ 幕 2（路网定位）为统一模块，无渠化显示。
 *
 * 可插拔约定：
 * - 本文件被主工程入口（main.js / standalone 入口）import 时产生副作用注册；
 * - 主工程其余部分只通过 act-registry 读取，不直接 import 本模块内部文件；
 * - 独立开发时运行 vite 多页入口 /act1.html（standalone.js 仅装配本幕）。
 */
import { registerAct } from '../act-registry.js';
import ProblemLocateStage from './ProblemLocateStage.vue';
import {
  createAct1MapFx,
  createAct2MapFx,
} from './actMapFx.js';
import {
  PROBLEM_LOCATE_ACT_ID,
  PROBLEM_LOCATE_ACT_KEY,
  PROBLEM_LOCATE_ACT_NAME,
  enterProblemLocate,
  exitProblemLocate,
  markChannelizationReady,
} from './state.js';

export const ACT_ID = PROBLEM_LOCATE_ACT_ID;
export const ACT_KEY = PROBLEM_LOCATE_ACT_KEY;
export const ACT_NAME = PROBLEM_LOCATE_ACT_NAME;

/** 幕模块描述（可插拔注册对象） */
const descriptor = {
  id: ACT_ID,
  key: ACT_KEY,
  name: ACT_NAME,
  order: 1,
  stageComponent: ProblemLocateStage,
  // 主工程地图运行时（TrafficOriginScene）消费的特效兼容工厂
  fxCompat: {
    createAct1MapFx,
    createAct2MapFx,
  },
  // 主工程辅助函数兼容导出（错误恢复 / 地图运行时回调）
  compatExports: {
    enterAct1: enterProblemLocate,
    markChannelizationReady,
  },
  enter: enterProblemLocate,
  exit: exitProblemLocate,
};

// 副作用注册（幂等）
registerAct(descriptor);

export default descriptor;

// 兼容旧命名导出（供迁移期引用）
export { enterProblemLocate as enterAct1 };
export { exitProblemLocate as exitAct1 };
export { markChannelizationReady };
export { ProblemLocateStage };

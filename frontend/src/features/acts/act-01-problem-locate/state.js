/**
 * 幕 1 · 问题定位 — 状态机
 *
 * 阶段（合并原幕 1 诊断工单 + 幕 2 路网定位，无渠化）：
 *   idle → parsing → ticket_ready → locating → confirming → handoff
 *
 * 地图节拍（对齐主工程 narrative-state，供地图运行时消费）：
 *   act1MapBeat: null | 'scan' | 'settle' | 'clear'           （搜索态）
 *   act2MapBeat: null | 'fly_in' | 'channelization' | 'settle' | 'dim' | 'clear'
 *     - 本幕无渠化，'channelization' 节拍语义 = 走廊揭示
 *     - 走廊后续动效（流向箭头、指标脉冲）由 actMapFx 内部时间轴推进
 */
import {
  act1MapBeat,
  act1Phase,
  act2MapBeat,
  act2Phase,
  captureCamera,
  narrativeState,
  setAct,
  setAct1MapBeat,
  setAct2MapBeat,
  setBeat,
  setLayerFlags,
  taskBarLabel,
  taskBarVisible,
  writeTicket,
} from '../../../shared/narrative-state.js';
import { DIAGNOSIS_TICKET, SPATIAL_SCENE } from './fixture.js';

export const PROBLEM_LOCATE_ACT_ID = 1;
export const PROBLEM_LOCATE_ACT_KEY = 'problem-locate';
export const PROBLEM_LOCATE_ACT_NAME = '问题定位';

/**
 * 幕内就绪信号（Stage 订阅）：
 * corridorReady —— 地图走廊揭示完成（markChannelizationReady 触发）
 */
export const locateCorridorReady = {
  _ready: false,
  _listeners: new Set(),
  get ready() {
    return this._ready;
  },
  set ready(v) {
    this._ready = v;
    if (v) this._listeners.forEach((fn) => fn());
  },
  reset() {
    this._ready = false;
  },
  once(fn) {
    if (this._ready) {
      fn();
      return;
    }
    this._listeners.add(fn);
  },
  clear() {
    this._listeners.clear();
  },
};

/** 进入幕 1（合并幕：问题定位） */
export function enterProblemLocate(prevState = null) {
  setAct(PROBLEM_LOCATE_ACT_ID);
  setBeat('a1.input');
  act1Phase.value = 'idle';
  act2Phase.value = 'idle';
  act1MapBeat.value = null;
  act2MapBeat.value = null;
  taskBarVisible.value = false;
  taskBarLabel.value = '';
  writeTicket(DIAGNOSIS_TICKET);
  locateCorridorReady.reset();
  locateCorridorReady.clear();

  if (prevState?.camera) {
    narrativeState.camera = { ...prevState.camera };
  }

  return {
    act: PROBLEM_LOCATE_ACT_ID,
    beatId: 'a1.input',
    ticket: narrativeState.ticket,
    camera: narrativeState.camera,
    layers: { ...narrativeState.layers },
  };
}

/** 兼容旧命名（LiveErrorOverlay 重试入口） */
export const enterAct1 = enterProblemLocate;

/** 开始问题理解 */
export function beginParse() {
  setBeat('a1.parse');
  act1Phase.value = 'parsing';
  taskBarVisible.value = true;
  taskBarLabel.value = '执行中：问题理解';
  // 地图：上游双路口搜索态脉冲
  setAct1MapBeat('scan');
}

/** 工单落地 */
export function completeTicket(cameraSnapshot = null) {
  writeTicket(DIAGNOSIS_TICKET);
  if (cameraSnapshot) captureCamera(cameraSnapshot);
  setBeat('a1.ticket_ready');
  act1Phase.value = 'ticket_ready';
}

/** 进入空间定位（主工程地图运行时侦听 act2Phase='locating' 触发飞入） */
export function beginLocate() {
  setBeat('a2.fly_in');
  act2Phase.value = 'locating';
  taskBarVisible.value = true;
  taskBarLabel.value = '执行中：问题定位';
  setAct2MapBeat('fly_in');
}

/**
 * 走廊揭示完成（兼容 markChannelizationReady：由主工程地图运行时在
 * 飞入完成后回调；本幕无渠化，语义 = 走廊/双路口/流向箭头揭示）
 */
export function markChannelizationReady() {
  setBeat('a2.corridor');
  setLayerFlags({
    mainPath: true,
    upstreamNodes: true,
    downstreamNodes: true,
    focusTrace: true,
  });
  locateCorridorReady.ready = true;
}

/** 兼容旧命名 */
export const markChannelizationReadyCompat = markChannelizationReady;

/** 定位确认（信息窗口揭示完成后的收束） */
export function completeLocateConfirm() {
  setBeat('a2.settle');
  act2Phase.value = 'confirming';
  taskBarLabel.value = '问题定位完成';
  setLayerFlags({
    mainPath: true,
    upstreamNodes: true,
    downstreamNodes: true,
  });
}

/** 退出幕 1 */
export function exitProblemLocate(nextHint = {}) {
  act2Phase.value = 'handoff';
  act1Phase.value = 'handoff';
  taskBarLabel.value = '问题定位完成，准备进入下一幕';
  setBeat('a2.handoff');
  setAct2MapBeat('settle');

  return {
    act: PROBLEM_LOCATE_ACT_ID,
    beatId: 'a2.handoff',
    ticket: narrativeState.ticket,
    spatial: {
      objects: {
        target_intersection: SPATIAL_SCENE.target.inter_name,
        target_direction: SPATIAL_SCENE.target.direction,
        target_movement: SPATIAL_SCENE.target.movement,
        main_path: SPATIAL_SCENE.main_path,
      },
      scene: SPATIAL_SCENE,
    },
    camera: narrativeState.camera,
    layers: { ...narrativeState.layers },
    nextAct: nextHint.nextAct ?? 3,
  };
}

/** 兼容旧命名 */
export const exitAct1 = exitProblemLocate;

export default {
  actId: PROBLEM_LOCATE_ACT_ID,
  enter: enterProblemLocate,
  exit: exitProblemLocate,
  beginParse,
  completeTicket,
  beginLocate,
  completeLocateConfirm,
  markChannelizationReady,
};

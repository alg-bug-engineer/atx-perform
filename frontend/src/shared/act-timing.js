/**
 * Act 幕间时机与退出栅栏
 *
 * 严格栅栏：本幕地图 / 打字机 / 左侧卡片等全部就绪后，
 * 再等本幕口播队列空闲（避免旧句盖住新镜头），再等待 HANDOFF_HOLD_MS，切下一幕。
 *
 * 口播对齐优先于「抢切幕」；卡死兜底靠：
 * - 软词槽短超时跳过（act-voice）
 * - 幕间口播安全超时后打断残留再交棒（禁止无限挂起）
 *
 * 幕内约定：口播、地图动作、打字机可并行触发；幕间必须对齐后再切。
 *
 * 环境变量：
 * - VITE_ACT_HANDOFF_HOLD_MS=500   毫秒
 * - VITE_ACT_HANDOFF_HOLD_S=0.5    秒（与 MS 二选一；MS 优先）
 * 默认 0.5s —— 仅作用于「内容齐备且口播空闲后」的幕间停留。
 */

import {
  dropBroadcastQueueBeforeAct,
  freezeBroadcastForBarrier,
  interruptBroadcastQueue,
  isBroadcastPending,
  whenBroadcastIdle,
} from './broadcast-bus.js';
import { pauseAfterActRequested } from './act-playback.js';
import { clearPendingVoiceForHandoff } from './act-voice.js';
import { narrativeState } from './narrative-state.js';

function parseNonNeg(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function resolveHandoffHoldMs() {
  const fromMs = parseNonNeg(import.meta.env.VITE_ACT_HANDOFF_HOLD_MS);
  if (fromMs != null) return fromMs;
  const fromS = parseNonNeg(import.meta.env.VITE_ACT_HANDOFF_HOLD_S);
  if (fromS != null) return Math.round(fromS * 1000);
  return 500;
}

/** 内容齐备后的幕间停留（ms），默认 500 */
export const HANDOFF_HOLD_MS = resolveHandoffHoldMs();

/** 侧栏 dock 淡入 */
export const DOCK_FADE_MS = 450;

/** 卡片 module-reveal CSS 过渡 */
export const CARD_REVEAL_TRANSITION_MS = 400;

/** 栅栏兜底，防止 reveal-done 丢失导致卡死 */
export const BARRIER_SAFETY_MS = 8000;

/**
 * 逐条揭示完成所需时间（含末卡 CSS 过渡）
 * @param {number} count
 * @param {{ firstMs: number, stepMs: number, transitionMs?: number }} opts
 */
export function staggerRevealDoneMs(
  count,
  { firstMs, stepMs, transitionMs = CARD_REVEAL_TRANSITION_MS } = {},
) {
  if (!count || count <= 0) return transitionMs;
  return firstMs + (count - 1) * stepMs + transitionMs;
}

/**
 * 幕间口播等待兜底：够播完本幕短句；超时则打断残留再切幕，禁止错位与死等。
 */
export const BROADCAST_BARRIER_SAFETY_MS = 28_000;

/**
 * 本幕退出栅栏：
 * 1) 等齐内容 barrier（地图/打字机/左卡）
 * 2) 若已请求幕间暂停 → 立即冻结口播
 * 3) 默认等口播空闲（对齐镜头/内容）；超时打断残留，避免旧句盖新幕
 * 4) 清理本幕挂起词槽 → holdMs → onExit
 *
 * @param {{
 *   later: (fn: Function, ms: number) => any,
 *   barriers?: Array<Promise<any> | null | undefined>,
 *   holdMs?: number,
 *   safetyMs?: number,
 *   waitBroadcast?: boolean,
 *   broadcastSafetyMs?: number,
 *   onExit: () => void,
 * }} opts
 */
export function runExitBarrier({
  later,
  barriers = [],
  holdMs = HANDOFF_HOLD_MS,
  safetyMs = BARRIER_SAFETY_MS,
  waitBroadcast = true,
  broadcastSafetyMs = BROADCAST_BARRIER_SAFETY_MS,
  onExit,
}) {
  const pending = barriers.filter(Boolean);
  const safety = new Promise((resolve) => {
    later(resolve, safetyMs);
  });

  const contentReady = pending.length
    ? Promise.race([Promise.all(pending), safety])
    : Promise.resolve();

  contentReady.then(() => {
    // 用户已请求「本幕结束后暂停」：内容齐备即停播，不再把剩余口播听完
    if (pauseAfterActRequested.value) {
      freezeBroadcastForBarrier();
      clearPendingVoiceForHandoff();
      later(onExit, holdMs);
      return;
    }
    const voiceReady = waitBroadcast
      ? whenBroadcastIdle({ later, safetyMs: broadcastSafetyMs })
      : Promise.resolve();
    voiceReady.then(() => {
      const nextAct = (Number(narrativeState.act) || 0) + 1;
      // 安全超时仍在播：打断残留，禁止 ActN 口播盖住 ActN+1 地图/镜头
      if (waitBroadcast && isBroadcastPending()) {
        interruptBroadcastQueue();
      } else {
        dropBroadcastQueueBeforeAct(nextAct);
      }
      clearPendingVoiceForHandoff();
      later(onExit, holdMs);
    });
  });
}

/**
 * 创建一个可由子组件 resolve 的就绪闸门。
 * @returns {{ current: Promise<void>, signal: () => void, isReady: () => boolean, reset: () => void }}
 */
export function createReadyGate() {
  let settled = false;
  let resolveFn = null;
  let promise = null;

  function makePromise() {
    settled = false;
    promise = new Promise((resolve) => {
      resolveFn = resolve;
    });
    return promise;
  }

  makePromise();

  return {
    isReady: () => settled,
    signal() {
      if (settled) return;
      settled = true;
      resolveFn?.();
    },
    reset() {
      makePromise();
    },
    get current() {
      return promise;
    },
  };
}

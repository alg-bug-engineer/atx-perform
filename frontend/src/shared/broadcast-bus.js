import { ref, reactive } from 'vue';
import { getVoiceTemplate } from './voice-scripts.js';
import { applyDisplayNameAlias } from '../utils/userFacingCopy.js';

// 当前正在播报的条目，DigitalAvatar 消费此状态驱动动画
export const currentBroadcast = ref(null); // { key, text } | null

// 待播报队列（FIFO），DigitalAvatar 依次消费
export const broadcastQueue = reactive([]);

// 全局静音开关，可供用户在 UI 上控制
export const broadcastMuted = ref(false);

/**
 * 叙事演示静默：true 时不入队。
 * 默认跟随 VITE_TTS_ENABLED（未设则看 TTS_ENABLED）；均为 true/未设时开启口播。
 */
function resolveSilentDefault() {
  const raw = import.meta.env.VITE_TTS_ENABLED ?? import.meta.env.TTS_ENABLED;
  if (raw === '0' || raw === 'false' || raw === 'False') return true;
  if (raw === '1' || raw === 'true' || raw === 'True') return false;
  // 未配置时默认开启（与 .env.example TTS_ENABLED=true 一致）
  return false;
}

export const broadcastSilent = ref(resolveSilentDefault());

/**
 * 幕间栅栏冻结：true 时不入队、不消费队列（对齐 act 幕间暂停）。
 * DigitalAvatar 监听后中断当前 TTS。
 */
export const broadcastFrozen = ref(false);

/** 递增后 DigitalAvatar 强制中断当前播报 */
export const broadcastInterruptSeq = ref(0);

// ── 播报忙碌状态（由 DigitalAvatar 维护）──────────────────────────────────
// true = 正在播报或队列非空；false = 完全空闲
export const broadcastBusy = ref(false);

const _idleCallbacks = [];

function flushIdleCallbacks() {
  const cbs = _idleCallbacks.splice(0);
  cbs.forEach((fn) => fn());
}

/**
 * 注册一个回调：等当前所有排队/正在播报的内容全部结束后执行。
 * 若当前已空闲，则在下一个 microtask 执行。
 * @returns {() => void} cancel 函数，可在组件 unmount 时调用以防止泄漏
 */
export function afterBroadcastDone(cb) {
  let active = true;
  const wrapped = () => { if (active) cb(); };
  if (broadcastFrozen.value || !isBroadcastPending()) {
    Promise.resolve().then(wrapped);
  } else {
    _idleCallbacks.push(wrapped);
  }
  return () => { active = false; };
}

/** 仅供 DigitalAvatar.vue 调用：开始处理一条播报 */
export function _notifyBroadcastStart() {
  broadcastBusy.value = true;
}

/** 仅供 DigitalAvatar.vue 调用：一条播报结束，检查是否已全部完成 */
export function _notifyBroadcastEnd() {
  // 队列中仍有待处理项时不算空闲（item 已被 shift 所以此时 length 反映剩余条数）
  if (!broadcastFrozen.value && broadcastQueue.length > 0) return;
  broadcastBusy.value = false;
  flushIdleCallbacks();
}

function clearQueue() {
  broadcastQueue.splice(0, broadcastQueue.length);
}

/**
 * 打断当前口播并清空队列（不冻结）。
 * 用于幕间安全超时放行：禁止旧幕残留句盖住新幕镜头。
 */
export function interruptBroadcastQueue() {
  clearQueue();
  broadcastBusy.value = false;
  broadcastInterruptSeq.value += 1;
  flushIdleCallbacks();
}

/**
 * 丢掉队列中早于指定幕次的口播（交棒前清理错幕句）。
 * @param {number} nextAct
 */
export function dropBroadcastQueueBeforeAct(nextAct) {
  const act = Number(nextAct) || 0;
  if (act <= 1) return;
  for (let i = broadcastQueue.length - 1; i >= 0; i -= 1) {
    const itemAct = actNumberFromVoiceKey(broadcastQueue[i]?.key);
    if (itemAct != null && itemAct < act) {
      broadcastQueue.splice(i, 1);
    }
  }
  if (!broadcastQueue.length && !broadcastFrozen.value) {
    broadcastBusy.value = false;
    flushIdleCallbacks();
  }
}

/**
 * 幕间暂停：中断当前口播、清空队列、冻结入队。
 * 与 gateActAdvance 幕间暂停对齐。
 */
export function freezeBroadcastForBarrier() {
  broadcastFrozen.value = true;
  clearQueue();
  broadcastBusy.value = false;
  broadcastInterruptSeq.value += 1;
  flushIdleCallbacks();
}

/**
 * 幕间恢复：解冻；默认清空残留，由下一幕重新入队。
 * @param {{ clearQueue?: boolean }} [opts]
 */
export function unfreezeBroadcastAfterBarrier(opts = {}) {
  const shouldClear = opts.clearQueue !== false;
  if (shouldClear) clearQueue();
  broadcastFrozen.value = false;
  broadcastBusy.value = false;
}

// 兼容旧场景面板的静态文案（优先 voice-scripts.json）
const BROADCAST_SCRIPTS = {
  scan_start: '开始全域态势扫描，正在读取城市数据…',
  scan_done: '扫描完成',
  viz_arterial_flow_tracing: '干线流量溯源，正在分析干线流入、流出的主要路径，请关注地图…',
  viz_od_analysis: '正在分析区域交通OD，地图正在展示OD流量分布，请关注…',
  viz_flow_tracing: '区域流量溯源，正在分析区域流入、流出和内部的主要通行路径，请关注地图…',
  viz_congestion_spread: '区域拥堵蔓延分析，正在展示拥堵传播路径与时序演进，请关注地图…',
  tab_city: '进入全域态势分析…',
  tab_region: '进入区域诊断环节…',
  tab_arterial: '进入干线诊断分析…',
  tab_intersection: '进入路口精细诊断…',
  tab_governance: '进入智能治理方案生成…',
  governance_thinking: '智能体正在归纳整合诊断结论，生成治理方案…',
};

/** @param {string} key @returns {number|null} */
export function actNumberFromVoiceKey(key) {
  const m = /^a(\d+)\./.exec(String(key || ''));
  return m ? Number(m[1]) : null;
}

/**
 * 触发一条播报。
 * @param {string} key - 播报 key，对应 voice-scripts / BROADCAST_SCRIPTS；或直接传完整文案
 * @param {string} [customText] - 可选，覆盖默认文案（已填充词槽的文本）
 */
export function triggerBroadcast(key, customText) {
  if (broadcastSilent.value || broadcastFrozen.value) return;
  const raw = customText
    ?? getVoiceTemplate(key)
    ?? BROADCAST_SCRIPTS[key]
    ?? key;
  if (!raw) return;
  // 字幕与口播统一展示别名（齐川路 → 齐音路）；查库名不变
  const text = applyDisplayNameAlias(raw);
  broadcastQueue.push({ key, text, ts: Date.now() });
}

/** 运行时开关口播（不影响用户静音按钮） */
export function setBroadcastSilent(silent) {
  broadcastSilent.value = !!silent;
}

/**
 * 外部忙碌检查（如 act-voice 词槽挂起）。返回 true 表示尚未可交棒。
 * @type {null | (() => boolean)}
 */
let _externalBusyCheck = null;

/** @param {null | (() => boolean)} fn */
export function registerBroadcastBusyCheck(fn) {
  _externalBusyCheck = typeof fn === 'function' ? fn : null;
}

/** 当前是否仍有口播在播 / 排队 / 词槽挂起 */
export function isBroadcastPending() {
  if (broadcastSilent.value || broadcastFrozen.value) return false;
  if (_externalBusyCheck?.()) return true;
  return broadcastBusy.value || broadcastQueue.length > 0;
}

/**
 * Promise：等到口播队列空闲（幕间同步用）。
 * 静默 / 冻结模式下立即 resolve；带 safety 超时，过期即放行（由交棒方打断残留）。
 * 词槽挂起不计入 busy（软槽超时跳过，避免缺字段卡死）。
 * @param {{ later?: (fn: Function, ms: number) => any, safetyMs?: number, settleMs?: number }} [opts]
 * @returns {Promise<void>}
 */
export function whenBroadcastIdle(opts = {}) {
  const safetyMs = opts.safetyMs ?? 28_000;
  const settleMs = opts.settleMs ?? 80;
  const later = opts.later || ((fn, ms) => setTimeout(fn, ms));

  if (broadcastSilent.value || broadcastFrozen.value) return Promise.resolve();

  return new Promise((resolve) => {
    let finished = false;
    let cancelIdle = null;
    let pollTimer = null;

    const finish = () => {
      if (finished) return;
      finished = true;
      cancelIdle?.();
      if (pollTimer != null) clearTimeout(pollTimer);
      resolve();
    };

    const tryFinish = () => {
      if (finished) return;
      if (!isBroadcastPending()) {
        finish();
        return;
      }
      // TTS 队列忙：等播完再看；仅词槽挂起：短轮询
      if (broadcastBusy.value || broadcastQueue.length > 0) {
        cancelIdle?.();
        cancelIdle = afterBroadcastDone(() => {
          pollTimer = later(tryFinish, 100);
        });
      } else {
        pollTimer = later(tryFinish, 200);
      }
    };

    // 留给刚入队的 handoff 口播一个微空隙，避免误判空闲
    later(tryFinish, settleMs);
    later(finish, safetyMs);
  });
}

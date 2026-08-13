import { computed, ref } from 'vue';
import {
  freezeBroadcastForBarrier,
  unfreezeBroadcastAfterBarrier,
} from './broadcast-bus.js';

/**
 * 幕间播放控制（空格暂停）
 *
 * 粒度 = act 之间的栅栏：
 * - 幕内按空格 → 仅标记「本幕结束后暂停」，当前 act 继续演完（内容/地图/动作/口播齐备）
 * - exit 交棒时若有标记 → 不 setAct(下一幕)，停在 handoff 终态，并冻结口播
 * - 再按空格 → 解冻口播并恢复交棒，链式进入下一幕（prev-state / 镜头 / 图层继承不变）
 */

/** 用户已请求：当前 act 演完后在幕间暂停 */
export const pauseAfterActRequested = ref(false);

/** 已停在幕间栅栏，等待空格继续 */
export const barrierPaused = ref(false);

/** AgentReasoning 结论区等待空格继续时，ActLoop 不应切换幕间暂停 */
export const conclusionSpaceWaitActive = ref(false);

/** @type {{ nextAct: number, apply: () => void } | null} */
let pendingAdvance = null;

export const playbackHint = computed(() => {
  if (barrierPaused.value) {
    return '已暂停 · 空格继续下一幕';
  }
  if (pauseAfterActRequested.value) {
    return '本幕结束后暂停 · 空格取消';
  }
  return '';
});

export function isTypingTarget(target) {
  if (!target || !(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest?.('input, textarea, select, [contenteditable="true"]'));
}

/**
 * 空格切换：幕间暂停中 → 恢复；否则切换「本幕结束后暂停」请求。
 * @returns {boolean} 是否消费了该按键
 */
export function toggleSpacePlayback() {
  if (barrierPaused.value) {
    resumeFromBarrier();
    return true;
  }
  pauseAfterActRequested.value = !pauseAfterActRequested.value;
  return true;
}

/**
 * Shell 交棒门控：有暂停请求则挂起 setAct，保持本幕挂载与地图终态。
 * @param {{ nextAct: number, apply: () => void }} opts
 * @returns {boolean} true = 已进入幕间暂停
 */
export function gateActAdvance({ nextAct, apply }) {
  if (typeof apply !== 'function') return false;

  if (!pauseAfterActRequested.value) {
    pendingAdvance = null;
    barrierPaused.value = false;
    apply();
    return false;
  }

  pauseAfterActRequested.value = false;
  barrierPaused.value = true;
  pendingAdvance = { nextAct, apply };
  // 本幕已完成且进入幕间暂停：立即停播并清空残留队列
  freezeBroadcastForBarrier();
  console.info('[ActLoop] barrier pause · hold before Act', nextAct);
  return true;
}

/** 从幕间栅栏恢复，执行挂起的 setAct */
export function resumeFromBarrier() {
  if (!barrierPaused.value || !pendingAdvance) return false;
  const { nextAct, apply } = pendingAdvance;
  pendingAdvance = null;
  barrierPaused.value = false;
  // 解冻后再交棒，由下一幕重新入队口播
  unfreezeBroadcastAfterBarrier({ clearQueue: true });
  console.info('[ActLoop] barrier resume → Act', nextAct);
  apply();
  return true;
}

export function resetPlaybackPause() {
  pauseAfterActRequested.value = false;
  barrierPaused.value = false;
  conclusionSpaceWaitActive.value = false;
  pendingAdvance = null;
  unfreezeBroadcastAfterBarrier({ clearQueue: true });
}

/** 幕间暂停期间供外部查询：口播应保持静默 */
export function isBarrierPaused() {
  return barrierPaused.value;
}

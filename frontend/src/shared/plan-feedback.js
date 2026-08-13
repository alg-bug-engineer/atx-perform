/**
 * 方案反馈与技能固化状态（对齐参考项目 presentation store 子集）
 */
import { computed, ref } from 'vue';
import {
  acceptPlan,
  rejectPlan,
  solidifySkill,
} from '../services/planFeedbackService.js';
import { resetAgentRun } from '../services/runtimeFixture.js';
import { resetNarrativeToHome } from './narrative-state.js';
import { resetPlaybackPause } from './act-playback.js';

/** @typedef {'idle'|'prompt'|'absorbing'|'building'|'completed'|'effect'} SolidifyPhase */

/** @type {import('vue').Ref<SolidifyPhase>} */
export const solidifyPhase = ref('idle');

/** 下发后抽屉收起，进入 running 态 */
export const planDrawerDismissed = ref(false);

export const planFeedbackBusy = ref(false);
export const planFeedbackToast = ref('');

/** @type {import('vue').Ref<object|null>} */
export const skillResult = ref(null);

export const showSolidifyFlow = computed(
  () => solidifyPhase.value !== 'idle',
);

export function setSolidifyPhase(phase) {
  solidifyPhase.value = phase;
}

export function clearPlanFeedbackToast() {
  planFeedbackToast.value = '';
}

function showToast(msg) {
  planFeedbackToast.value = msg;
}

export function resetPlanFeedback() {
  solidifyPhase.value = 'idle';
  planDrawerDismissed.value = false;
  planFeedbackBusy.value = false;
  skillResult.value = null;
}

/** 返回 Act1 输入主页 */
export function returnToHome(message) {
  resetPlanFeedback();
  resetPlaybackPause();
  resetAgentRun();
  resetNarrativeToHome();
  if (message) showToast(message);
}

/** 方案页：保持现状返回主页 */
export function returnHomeFromPlan() {
  returnToHome('本轮保持现状配时，已返回主页。');
}

/** 下发成功 → 固化确认 */
export async function acceptAndDeploy() {
  if (planFeedbackBusy.value) return;
  planFeedbackBusy.value = true;
  try {
    const res = await acceptPlan();
    if (!res.ok) {
      returnToHome(`方案下发失败：${res.reason || '未知错误'}`);
      return;
    }
    planDrawerDismissed.value = true;
    solidifyPhase.value = 'prompt';
  } finally {
    planFeedbackBusy.value = false;
  }
}

/** 暂不固化 */
export function declineSolidify() {
  returnToHome('方案已下发，已返回主页。');
}

/** 确认固化 → API → absorbing */
export async function confirmSolidify() {
  if (planFeedbackBusy.value) return;
  planFeedbackBusy.value = true;
  solidifyPhase.value = 'absorbing';
  try {
    const res = await solidifySkill();
    if (!res.ok) {
      returnToHome(`技能固化失败：${res.reason || '未知错误'}`);
      return;
    }
    if (solidifyPhase.value !== 'absorbing') return;
    skillResult.value = res.data;
  } finally {
    planFeedbackBusy.value = false;
  }
}

/** 效果页 / 固化收尾 → 返回主页 */
export function finishSolidify() {
  returnToHome('技能已固化并入库，已返回主页。');
}

/** 退回修改 → 再生成（Case A mock） */
export async function rejectAndRegenerate(reason) {
  if (planFeedbackBusy.value || !reason?.trim()) return;
  planFeedbackBusy.value = true;
  showToast('已记录修改意见，正在按意见再生成…');
  try {
    const res = await rejectPlan(reason.trim());
    if (res.ok) {
      returnToHome('方案已按修改意见再生成，已返回主页。');
    } else {
      showToast(`再生成失败：${res.reason || '未知错误'}`);
    }
  } finally {
    planFeedbackBusy.value = false;
  }
}

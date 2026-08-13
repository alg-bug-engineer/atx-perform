/**
 * 方案决策 / 技能固化服务
 * Live（VITE_MOCK=0）：真实 API；Mock fixture 已移除。
 */
import {
  isApiError,
  isLiveApiMode,
  solidifySkillApi,
  submitDecision,
} from './api/endpoints.js';
import { getPlanMeta, getDiagnosisTicket } from './caseFixture.js';
import { agentRunState } from './runtimeFixture.js';
import { failLivePipeline } from './livePipelineError.js';

function currentTraceId() {
  return agentRunState.traceId || null;
}

function currentPlanId() {
  return getPlanMeta()?.plan_id ?? null;
}

/** POST /agent/plan/decision accept */
export async function acceptPlan() {
  const meta = getPlanMeta();
  if (meta?.executable === false) {
    return { ok: false, reason: '当前方案不可执行' };
  }
  if (!isLiveApiMode()) {
    failLivePipeline('Mock fixture 已移除，请使用 VITE_MOCK=0');
  }
  const planId = currentPlanId();
  const traceId = currentTraceId();
  if (!planId || !traceId) {
    return { ok: false, reason: '缺少 plan_id / trace_id' };
  }
  const res = await submitDecision({
    trace_id: traceId,
    plan_id: planId,
    decision: 'accept',
    plan_snapshot: agentRunState.snapshot?.plan || agentRunState.snapshot?.phases?.plan || meta,
    diagnosis_ticket: getDiagnosisTicket(),
  });
  if (isApiError(res)) {
    return { ok: false, reason: res.reason };
  }
  return { ok: true, plan_id: planId, data: res };
}

/** POST /agent/plan/decision reject */
export async function rejectPlan(reason) {
  if (!reason?.trim()) {
    return { ok: false, reason: '请填写修改意见' };
  }
  if (!isLiveApiMode()) {
    failLivePipeline('Mock fixture 已移除，请使用 VITE_MOCK=0');
  }
  const planId = currentPlanId();
  const traceId = currentTraceId();
  if (!planId || !traceId) {
    return { ok: false, reason: '缺少 plan_id / trace_id' };
  }
  const res = await submitDecision({
    trace_id: traceId,
    plan_id: planId,
    decision: 'reject',
    rejection_reason: reason.trim(),
    plan_snapshot: agentRunState.snapshot?.plan || agentRunState.snapshot?.phases?.plan || getPlanMeta(),
    diagnosis_ticket: getDiagnosisTicket(),
  });
  if (isApiError(res)) {
    return { ok: false, reason: res.reason };
  }
  return { ok: true, reason: reason.trim(), data: res };
}

/** POST /agent/skill/solidify */
export async function solidifySkill() {
  if (!isLiveApiMode()) {
    failLivePipeline('Mock fixture 已移除，请使用 VITE_MOCK=0');
  }
  const planId = currentPlanId();
  const traceId = currentTraceId();
  if (!planId || !traceId) {
    return { ok: false, reason: '缺少 plan_id / trace_id' };
  }
  const res = await solidifySkillApi({
    trace_id: traceId,
    plan_id: planId,
    diagnosis_ticket: getDiagnosisTicket(),
    plan_snapshot: agentRunState.snapshot?.plan || agentRunState.snapshot?.phases?.plan || getPlanMeta(),
    strategy: agentRunState.snapshot?.phases?.strategy || null,
  });
  if (isApiError(res)) {
    return { ok: false, reason: res.reason };
  }
  return { ok: true, data: res };
}

export function getSkillSolidifyFixture() {
  return null;
}

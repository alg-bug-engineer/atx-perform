/**
 * 业务 API 封装。
 * VITE_MOCK !== '0'：Mock，走 caseFixture 静态切片。
 * VITE_MOCK === '0'：Live，仅 runtime 数据；失败报错，严禁回退 fixture。
 */
import { getJSON, isApiError, postJSON } from './client.js';
import { streamPost } from './sse.js';

/** Live 模式：显式 VITE_MOCK=0 */
export function isLiveApiMode() {
  return import.meta.env.VITE_MOCK === '0';
}

/**
 * @typedef {{
 *   trace_id?: string,
 *   task?: Record<string, unknown>,
 *   skill_ids?: string[],
 *   stop_after?: string,
 *   signal?: AbortSignal,
 * }} RunOptions
 */

/**
 * @param {string} userInput
 * @param {RunOptions} [opts]
 */
export async function runAgent(userInput, opts = {}) {
  return postJSON('/agent/run', {
    user_input: userInput,
    trace_id: opts.trace_id,
    task: opts.task ?? {},
    skill_ids: opts.skill_ids,
    stop_after: opts.stop_after,
  }, opts.signal);
}

/**
 * 流式推演：POST /api/v1/agent/run/stream
 * @param {string} userInput
 * @param {import('./sse.js').StreamHandlers} handlers
 * @param {RunOptions} [opts]
 */
export function runAgentStream(userInput, handlers, opts = {}) {
  return streamPost(
    '/api/v1/agent/run/stream',
    {
      user_input: userInput,
      trace_id: opts.trace_id,
      task: opts.task ?? {},
      skill_ids: opts.skill_ids,
      stop_after: opts.stop_after,
    },
    handlers,
  );
}

/**
 * 从 PG 加载路口指标 / 拓扑 / 信号，返回可注入 run 的 task。
 * @param {{
 *   inter_id?: string,
 *   intersection_name?: string,
 *   time_range?: string,
 *   direction?: string,
 *   movement?: string,
 *   day_of_week?: number,
 *   time_hhmm?: string,
 * }} params
 */
export async function loadIntersection(params) {
  return postJSON('/intersection/load', params);
}

/**
 * @param {{
 *   trace_id: string,
 *   plan_id: string,
 *   decision: 'accept'|'reject',
 *   rejection_reason?: string,
 *   plan_snapshot?: unknown,
 *   diagnosis_ticket?: unknown,
 *   artifacts_summary?: unknown,
 * }} opts
 */
export async function submitDecision(opts) {
  return postJSON('/agent/plan/decision', opts);
}

/**
 * @param {{
 *   trace_id: string,
 *   plan_id: string,
 *   diagnosis_ticket?: unknown,
 *   plan_snapshot?: unknown,
 *   strategy?: unknown,
 *   artifacts_summary?: unknown,
 * }} opts
 */
export async function solidifySkillApi(opts) {
  return postJSON('/agent/skill/solidify', opts);
}

/**
 * @param {{
 *   trace_id: string,
 *   user_input: string,
 *   task: Record<string, unknown>,
 *   restart_from?: string,
 * }} opts
 */
export async function regeneratePlan(opts) {
  return postJSON('/agent/plan/regenerate', {
    trace_id: opts.trace_id,
    user_input: opts.user_input,
    task: opts.task,
    restart_from: opts.restart_from ?? 'plan_generation',
  });
}

export async function fetchHealth() {
  return getJSON('/health');
}

/**
 * @param {string} text
 * @param {string} [context]
 * @param {{ text?: string, context?: string, case_text?: string }} [payload]
 */
export async function postVoiceBrief(text, context = 'traffic_gov', payload = null) {
  if (payload && typeof payload === 'object') {
    return postJSON('/voice/brief', payload);
  }
  return postJSON('/voice/brief', { text, context });
}

export { isApiError };

/**
 * Live 模式运行时快照：Act1 提交后 SSE 推演，幕间 phase 门控。
 * Mock 模式（VITE_MOCK !== '0'）下所有函数为 no-op / 立即就绪。
 */
import { reactive, ref } from 'vue';
import {
  isApiError,
  isLiveApiMode,
  loadIntersection,
  runAgent,
  runAgentStream,
} from './api/endpoints.js';
import { adaptSlice } from './fixtureAdapter.js';
import { clearLivePipelineError, failLivePipeline } from './livePipelineError.js';
import { DEFAULT_DEMO_QUERY, matchDemoCase } from './demoCases.js';
import { taskBarLabel, taskBarVisible } from '../shared/narrative-state.js';

/** 幕次 → 所需公开 phase */
export const ACT_PHASE_GATE = {
  1: 'intent',
  2: 'intent',
  3: 'diagnosis',
  4: 'diagnosis',
  5: 'diagnosis',
  6: 'cause',
  7: 'strategy',
  8: 'plan',
};

const PHASE_LABEL = {
  intent: '问题理解',
  diagnosis: '指标诊断',
  cause: '成因分析',
  strategy: '策略生成',
  plan: '方案生成',
};

/** 幕次等待文案：禁止出现 Act 字样 */
const ACT_WAIT_LABEL = {
  1: '等待问题理解…',
  2: '等待路网定位数据…',
  3: '等待溢出核验数据…',
  4: '等待瓶颈分流数据…',
  5: '等待干线上游数据…',
  6: '等待成因分析…',
  7: '等待策略生成…',
  8: '等待方案生成…',
};

const SKILL_TO_PHASE = {
  intent_understanding: 'intent',
  data_analysis_diagnosis: 'diagnosis',
  cause_analysis: 'cause',
  strategy_generation: 'strategy',
  plan_generation: 'plan',
  // skill.meta.phase 别名（SSE phase 字段可能直接给这些）
  intent: 'intent',
  diagnosis: 'diagnosis',
  cause: 'cause',
  strategy: 'strategy',
  plan: 'plan',
};

/** 默认幕门控；策略/方案需覆盖 LLM soft-timeout（~120s）+ 确定性回退余量 */
const PHASE_WAIT_MS = 240_000;
/** 策略 / 方案阶段：SSE 断流后还可能走同步整链，单独放宽 */
const PHASE_WAIT_MS_HEAVY = 420_000;

function phaseWaitMs(phase) {
  if (phase === 'strategy' || phase === 'plan') return PHASE_WAIT_MS_HEAVY;
  return PHASE_WAIT_MS;
}

/** @type {import('./api/sse.js').StreamController|null} */
let streamController = null;

/** @type {Map<string, Array<{ resolve: () => void, reject: (err: Error) => void, timer: ReturnType<typeof setTimeout> }>>} */
const phaseWaiters = new Map();

export const agentRunState = reactive({
  /** @type {'idle'|'loading'|'running'|'done'|'error'} */
  status: 'idle',
  traceId: /** @type {string|null} */ (null),
  /** @type {Record<string, unknown>|null} */
  snapshot: null,
  /** @type {string|null} */
  computingPhase: null,
  /** @type {string|null} */
  error: null,
  userInput: '',
  /** @type {Record<string, unknown>|null} */
  task: null,
  /** 诊断判定健康提前收尾（无成因/策略/方案） */
  healthy: false,
});

/** 最近一次运行错误，供 UI toast */
export const agentRunError = ref('');

export function isLiveMode() {
  return isLiveApiMode();
}

export function getAgentSnapshot() {
  return agentRunState.snapshot;
}

/**
 * @param {string} actKey
 * @returns {Record<string, unknown>|null}
 */
export function getRuntimeSlice(actKey) {
  if (!isLiveMode() || !agentRunState.snapshot) return null;
  return adaptSlice(agentRunState.snapshot, actKey);
}

/** @param {string} phase */
export function isPhaseReady(phase) {
  if (!isLiveMode()) return true;
  const snap = agentRunState.snapshot;
  if (!snap) return false;
  if (phase === 'intent') {
    return !!(snap.diagnosis_ticket || snap.phases?.intent);
  }
  if (phase === 'plan') {
    return !!(snap.plan || snap.phases?.plan);
  }
  if (phase === 'diagnosis') {
    // 对齐参考：diagnosis 产出即可放行；queue_length_m 可为 null（DB 无数据）
    const diagnosis = snap.phases?.diagnosis;
    return !!(diagnosis && typeof diagnosis === 'object' && diagnosis.metrics);
  }
  if (phase === 'strategy') {
    // 空 {}（LLM 失败残留）不算就绪；必须有策略包
    const strategy = snap.phases?.strategy;
    if (!strategy || typeof strategy !== 'object') return false;
    return !!(
      strategy.strategy_package
      || strategy.decision?.strategy_package
      || strategy.strategy?.strategy_package
    );
  }
  if (phase === 'cause') {
    const cause = snap.phases?.cause;
    if (!cause || typeof cause !== 'object') return false;
    return !!(cause.cause_analysis?.primary_cause || cause.primary_cause);
  }
  return !!(snap.phases && snap.phases[phase]);
}

function notifyPhase(phase) {
  const list = phaseWaiters.get(phase);
  if (!list?.length) return;
  phaseWaiters.delete(phase);
  list.forEach((waiter) => {
    clearTimeout(waiter.timer);
    waiter.resolve();
  });
}

function rejectAllPhaseWaiters(message) {
  const err = new Error(message || '推演失败');
  for (const [, list] of phaseWaiters) {
    list.forEach((waiter) => {
      clearTimeout(waiter.timer);
      waiter.reject(err);
    });
  }
  phaseWaiters.clear();
}

function notifyAllReadyPhases() {
  for (const phase of Object.keys(PHASE_LABEL)) {
    if (isPhaseReady(phase)) notifyPhase(phase);
  }
}

/**
 * SSE 断流转同步推演时，重置尚未就绪阶段的等待计时，避免旧 timer 提前 reject。
 * @param {number} [timeoutMs]
 */
function refreshPhaseWaiters(timeoutMs) {
  for (const [phase, list] of phaseWaiters) {
    const ms = timeoutMs ?? phaseWaitMs(phase);
    for (const waiter of list) {
      clearTimeout(waiter.timer);
      waiter.timer = setTimeout(() => {
        waiter.reject(new Error(`等待阶段 ${PHASE_LABEL[phase] || phase} 超时`));
      }, ms);
    }
  }
}

/**
 * @param {number} act
 * @param {number} [timeoutMs]
 */
export function ensurePhaseForAct(act, timeoutMs) {
  if (!isLiveMode()) return Promise.resolve(true);
  const phase = ACT_PHASE_GATE[act];
  if (!phase) return Promise.resolve(true);
  if (isPhaseReady(phase)) return Promise.resolve(true);

  if (agentRunState.status === 'error') {
    return Promise.reject(new Error(agentRunState.error || '推演失败'));
  }

  // 流水线已结束且本阶段未产出：立即失败，禁止无限等待
  if (agentRunState.status === 'done' && !isPhaseReady(phase)) {
    if (isDiagnosisHealthy()) {
      return Promise.reject(new Error('诊断判定路口无明显问题，已提前结束'));
    }
    return Promise.reject(new Error(`推演已结束，缺少${PHASE_LABEL[phase] || phase}`));
  }

  const waitMs = timeoutMs ?? phaseWaitMs(phase);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`等待阶段 ${PHASE_LABEL[phase] || phase} 超时`));
    }, waitMs);

    if (!phaseWaiters.has(phase)) phaseWaiters.set(phase, []);
    phaseWaiters.get(phase).push({ resolve, reject, timer });

    // 若已在等待期间就绪
    if (isPhaseReady(phase)) {
      notifyPhase(phase);
    }
  });
}

/** @param {Record<string, unknown>|null|undefined} snapshot */
function applySnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  agentRunState.snapshot = snapshot;
  if (snapshot.trace_id) agentRunState.traceId = /** @type {string} */ (snapshot.trace_id);
  if (snapshot.healthy === true) agentRunState.healthy = true;
  const diagnosis = snapshot.phases?.diagnosis;
  if (diagnosis && typeof diagnosis === 'object' && diagnosis.healthy === true) {
    agentRunState.healthy = true;
  }
  notifyAllReadyPhases();
}

/** 诊断是否健康提前收尾（Live） */
export function isDiagnosisHealthy() {
  if (!isLiveMode()) return false;
  if (agentRunState.healthy) return true;
  const snap = agentRunState.snapshot;
  if (snap?.healthy === true) return true;
  const diagnosis = snap?.phases?.diagnosis;
  return Boolean(diagnosis && typeof diagnosis === 'object' && diagnosis.healthy === true);
}

function updateTaskBarComputing(phase) {
  const label = PHASE_LABEL[phase] || phase;
  if (label) {
    taskBarVisible.value = true;
    taskBarLabel.value = `推理中：${label}`;
  }
}

/**
 * 从自然语言粗提 PG 预载参数（Live 专用）。
 * - 仅当能从输入中识别路口时才返回；**绝不**默认回退 Case A。
 * - 无法识别时返回 null，由后端 LLM + enrich_ticket 做 PG 匹配。
 * @param {string} prompt
 * @returns {Record<string, string>|null}
 */
/** @deprecated 使用 DEFAULT_DEMO_QUERY / demoCases；保留别名以免旧引用断裂 */
export const CASE_A_DEMO_QUERY = DEFAULT_DEMO_QUERY;

export function extractLoadParams(prompt) {
  const text = (prompt || '').trim();
  if (!text) return null;

  const parsed = parseDirectionMovement(text);
  const base = {
    time_range: '17:00-19:00',
    movement: parsed.movement || '直行',
    ...(parsed.direction ? { direction: parsed.direction } : {}),
  };

  // 典型点/线 Case（manifest）：命中则带 inter_id 预载 PG + typical profile
  const demo = matchDemoCase(text);
  if (demo) {
    return {
      inter_id: demo.inter_id,
      intersection_name: demo.intersection_name,
      time_range: '17:00-19:00',
      direction: parsed.direction || inferDirectionFromQuery(demo.query) || '北向南',
      movement: parsed.movement || inferMovementFromQuery(demo.query) || '直行',
    };
  }

  // Case A 展示名/旧称兼容（齐音路、齐音绿 → PG 齐川路）
  if (/齐音绿|齐音路/.test(text) && /解放东/.test(text)) {
    return {
      inter_id: '011wwe28f7c00001',
      intersection_name: '解放东路与齐川路路口',
      time_range: '17:00-19:00',
      direction: parsed.direction || '北向南',
      movement: parsed.movement || '直行',
    };
  }

  // 完整路口名
  const named = text.match(/([\u4e00-\u9fa5A-Za-z0-9与和×xX\-—]+路口)/);
  if (named) {
    return { intersection_name: named[1], ...base };
  }

  // 道路对（无「路口」后缀，两段均须以路/街/道结尾）：奥体中路与解放东路
  const pair = text.match(
    /([\u4e00-\u9fa5]{2,12}(?:路|街|道|大道|大街))\s*[与和×xX]\s*([\u4e00-\u9fa5]{2,12}(?:路|街|道|大道|大街))/,
  );
  if (pair) {
    return { intersection_name: `${pair[1]}与${pair[2]}路口`, ...base };
  }

  return null;
}

/** @param {string} query */
function inferDirectionFromQuery(query) {
  return parseDirectionMovement(query).direction || null;
}

/** @param {string} query */
function inferMovementFromQuery(query) {
  return parseDirectionMovement(query).movement || null;
}

/** @param {string} text */
function parseDirectionMovement(text) {
  /** @type {Record<string, string>} */
  const out = {};
  if (/北进口|北口|由北|从北|北向南/.test(text)) out.direction = '北向南';
  else if (/南进口|南口|由南|从南|南向北/.test(text)) out.direction = '南向北';
  else if (/东进口|东口|由东|从东|东向西/.test(text)) out.direction = '东向西';
  else if (/西进口|西口|由西|从西|西向东/.test(text)) out.direction = '西向东';
  if (/左转/.test(text)) out.movement = '左转';
  else if (/右转/.test(text)) out.movement = '右转';
  else if (/直行/.test(text)) out.movement = '直行';
  return out;
}

function resetRunState(userInput) {
  agentRunState.status = 'idle';
  agentRunState.traceId = null;
  agentRunState.snapshot = null;
  agentRunState.computingPhase = null;
  agentRunState.error = null;
  agentRunState.userInput = userInput || '';
  agentRunState.task = null;
  agentRunState.healthy = false;
  agentRunError.value = '';
  phaseWaiters.clear();
}

/**
 * Act1 提交后启动：可选 PG 预载 + SSE 流式推演。
 * 非阻塞；幕间用 ensurePhaseForAct 等待。
 * @param {string} userInput
 * @param {{ skipLoad?: boolean, task?: Record<string, unknown> }} [opts]
 */
export async function startAgentRun(userInput, opts = {}) {
  if (!isLiveMode()) {
    if (import.meta.env.DEV) {
      console.warn('[agent-loop] startAgentRun 跳过：当前为 Mock 模式（需 VITE_MOCK=0）')
    }
    return;
  }

  if (import.meta.env.DEV) {
    console.info('[agent-loop] startAgentRun → PG 预载 + SSE 推演')
  }

  if (streamController) {
    streamController.close();
    streamController = null;
  }
  resetRunState(userInput);
  clearLivePipelineError();

  agentRunState.status = 'loading';
  taskBarVisible.value = true;
  taskBarLabel.value = '加载路口数据…';

  let task = opts.task || {};
  if (!opts.skipLoad) {
    const loadParams = extractLoadParams(userInput);
    if (loadParams) {
      const loadRes = await loadIntersection(loadParams);
      const loadFailed = isApiError(loadRes) || (loadRes && loadRes.ok === false)
        || (loadRes && typeof loadRes === 'object' && loadRes.available === false);
      if (loadFailed) {
        const reason = isApiError(loadRes)
          ? loadRes.reason
          : (loadRes?.reason || (loadRes?.errors || []).join('; ') || 'unknown');
        failLivePipeline(`Live PG 预载失败，禁止降级到无坐标推演：${reason}`);
      } else if (loadRes?.task && typeof loadRes.task === 'object') {
        task = { ...task, ...loadRes.task };
        if (import.meta.env.DEV) {
          const scope = /** @type {Record<string, unknown>} */ (loadRes.task.scope || {});
          console.info('[agent-loop] PG 预载成功', scope.intersection_id || scope.name || '');
        }
      } else if (loadRes && typeof loadRes === 'object') {
        const { available, reason, checklist, checklist_queries, ok, errors, ...rest } = loadRes;
        if (Object.keys(rest).length) task = { ...task, ...rest };
      }
    } else if (import.meta.env.DEV) {
      console.info('[agent-loop] 输入未识别路口名，跳过 PG 预载，由 LLM 匹配');
    }
  }
  agentRunState.task = task;
  agentRunState.status = 'running';
  taskBarLabel.value = '推理中：问题理解';

  let sawComplete = false;

  streamController = runAgentStream(
    userInput,
    {
      onEvent(ev) {
        const data = /** @type {Record<string, unknown>} */ (ev.data || {});
        if (ev.event === 'phase_start') {
          const skill = /** @type {string} */ (data.skill_id || data.phase || '');
          const phase = SKILL_TO_PHASE[skill] || /** @type {string} */ (data.phase);
          agentRunState.computingPhase = phase || null;
          if (phase) updateTaskBarComputing(phase);
        }
        if (ev.event === 'phase_done') {
          const snap = data.snapshot;
          if (snap) applySnapshot(/** @type {Record<string, unknown>} */ (snap));
          const skill = /** @type {string} */ (data.skill_id || '');
          const phase = SKILL_TO_PHASE[skill] || /** @type {string} */ (data.phase);
          // 失败 phase：不放行幕门控；若有等待者立即失败（避免空 {} 假就绪后 Act7 硬崩）
          if (data.success === false) {
            const errors = Array.isArray(data.errors) ? data.errors.filter(Boolean) : [];
            const msg = errors.length
              ? errors.join('；')
              : `阶段 ${PHASE_LABEL[phase] || phase || skill} 执行失败`;
            if (phase && phaseWaiters.has(phase)) {
              const list = phaseWaiters.get(phase) || [];
              phaseWaiters.delete(phase);
              list.forEach((waiter) => {
                clearTimeout(waiter.timer);
                waiter.reject(new Error(msg));
              });
            }
            return;
          }
          if (phase) notifyPhase(phase);
        }
        if (ev.event === 'pipeline_complete') {
          sawComplete = true;
          const snap = /** @type {Record<string, unknown>} */ (data.snapshot || {});
          if (data.snapshot) applySnapshot(snap);
          agentRunState.status = 'done';
          agentRunState.computingPhase = null;
          // 流水线已结束：未产出的后续阶段不得无限等待（如 healthy 提前收尾无成因）
          if (snap.healthy === true) {
            agentRunState.healthy = true;
            // 健康收尾：不把等待者打成流水线失败（由 Act3 友好收尾）；仅结束未注册等待
            rejectAllPhaseWaiters('诊断判定路口无明显问题，已提前结束');
          } else {
            const pending = [];
            for (const phase of ['cause', 'strategy', 'plan']) {
              if (!isPhaseReady(phase) && phaseWaiters.has(phase)) {
                pending.push(PHASE_LABEL[phase] || phase);
              }
            }
            if (pending.length) {
              rejectAllPhaseWaiters(`推演已结束，仍缺少：${pending.join('、')}`);
            } else {
              notifyAllReadyPhases();
            }
          }
        }
        if (ev.event === 'error') {
          const errors = data.errors;
          const msg = Array.isArray(errors) ? errors.join('; ') : (data.reason || 'pipeline_error');
          agentRunState.error = String(msg);
          agentRunError.value = agentRunState.error;
          agentRunState.status = 'error';
          rejectAllPhaseWaiters(agentRunState.error);
        }
      },
      onFail: async (reason) => {
        if (sawComplete) return;
        taskBarLabel.value = '流式中断，尝试同步推演…';
        // 同步整链可能再耗数分钟：先刷新等待计时，避免幕门控先于结果超时
        refreshPhaseWaiters(PHASE_WAIT_MS_HEAVY);
        const res = await runAgent(userInput, { task, trace_id: agentRunState.traceId || undefined });
        if (isApiError(res)) {
          agentRunState.status = 'error';
          agentRunState.error = `推演失败：${res.reason}（${reason}）`;
          agentRunError.value = agentRunState.error;
          taskBarLabel.value = agentRunState.error;
          rejectAllPhaseWaiters(agentRunState.error);
          return;
        }
        applySnapshot(/** @type {Record<string, unknown>} */ (res));
        agentRunState.status = 'done';
        agentRunState.computingPhase = null;
        notifyAllReadyPhases();
      },
      onDone() {
        if (agentRunState.status === 'running') {
          agentRunState.status = sawComplete ? 'done' : agentRunState.status;
        }
      },
    },
    { task },
  );
}

export function stopAgentRun() {
  if (streamController) {
    streamController.close();
    streamController = null;
  }
}

export function resetAgentRun() {
  stopAgentRun();
  resetRunState('');
  clearLivePipelineError();
}

/** TaskBar：后台推理文案（Live 且仍在跑） */
export function getComputingLabel() {
  if (!isLiveMode()) return '';
  if (agentRunState.status !== 'running' && agentRunState.status !== 'loading') return '';
  if (agentRunState.status === 'loading') return '加载路口数据…';
  const phase = agentRunState.computingPhase;
  return phase ? `推理中：${PHASE_LABEL[phase] || phase}` : '推理中…';
}

/** 幕进入前等待文案（禁止 Act 字样） */
export function getActWaitLabel(act) {
  return ACT_WAIT_LABEL[act] || '等待阶段数据…';
}

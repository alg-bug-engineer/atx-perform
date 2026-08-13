/**
 * 口播摘要：优先走后端 LLM，失败则本地截句兜底。
 */
import { postVoiceBrief, isApiError } from './api/endpoints.js';

const DECIMAL_IN_TEXT = /(?<![:/\d])(\d+\.\d+)(?![/\d:%])/g;

/** Act8 末页「整体结论」口播：小数两位 */
export const OVERALL_BRIEF_CONTEXT = 'overall';

/** Act8 末页融合口播：整体结论 + 案例借鉴 */
export const ACT8_CONCLUSION_BUNDLE_CONTEXT = 'act8_conclusion_bundle';

/** Act6 案例详情字段口播 */
export const CASE_SCENE_CONTEXT = 'case_scene';
export const CASE_SOLUTION_CONTEXT = 'case_solution';
export const VOICE_BRIEF_CASE_FIELD_MAX = 90;

export const VOICE_BRIEF_TARGET_MAX = 40;
export const VOICE_BRIEF_BUNDLE_TARGET_MAX = 70;

/** 口播稿中的小数统一两位（整数、时间片如 18:10 不处理） */
export function formatVoiceNumbers(text) {
  return String(text || '').replace(DECIMAL_IN_TEXT, (_, num) => {
    const v = Number(num);
    return Number.isFinite(v) ? v.toFixed(2) : num;
  });
}

export function compressToVoiceLength(text, maxChars = VOICE_BRIEF_TARGET_MAX) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim().replace(/[。；]+$/g, '');
  if (!raw) return '';
  if (raw.length <= maxChars) return raw;
  const cut = raw.slice(0, maxChars);
  const punct = Math.max(cut.lastIndexOf('，'), cut.lastIndexOf('；'), cut.lastIndexOf('、'));
  if (punct >= Math.floor(maxChars * 0.55)) return cut.slice(0, punct).replace(/[，、； ]+$/g, '');
  return cut.replace(/[，、； ]+$/g, '');
}

/** 口播前移除（图7相位1）、（表1–表4）、见图6 等图表编号 */
export function stripFigureTableRefs(text) {
  let s = String(text || '');
  s = s.replace(/[（(][^）)]*[图表][^）)]*[）)]/g, '');
  s = s.replace(/(?:如|见|参见|详见)?[图表]\d+(?:[–—-]\d+)?(?:相位\d+)?/g, '');
  s = s.replace(/[，、；]{2,}/g, '，');
  return s.replace(/\s+/g, ' ').trim().replace(/[，、； ]+$/g, '');
}

/**
 * @param {string} text
 * @param {'overall'|'case_reference'|'act8_conclusion_bundle'|string} [context]
 * @param {string} [caseText]
 */
export async function fetchVoiceBrief(text, context = 'overall', caseText = '') {
  const stripFigures = context === CASE_SCENE_CONTEXT || context === CASE_SOLUTION_CONTEXT;
  let raw = String(text || '').replace(/\s+/g, ' ').trim();
  let caseRaw = String(caseText || '').replace(/\s+/g, ' ').trim();
  if (stripFigures) {
    raw = stripFigureTableRefs(raw);
    caseRaw = stripFigureTableRefs(caseRaw);
  }
  if (!raw && !caseRaw) return '';

  const formatNumbers = context === OVERALL_BRIEF_CONTEXT
    || context === ACT8_CONCLUSION_BUNDLE_CONTEXT;
  const maxChars = context === ACT8_CONCLUSION_BUNDLE_CONTEXT
    ? VOICE_BRIEF_BUNDLE_TARGET_MAX
    : (context === CASE_SCENE_CONTEXT || context === CASE_SOLUTION_CONTEXT)
      ? VOICE_BRIEF_CASE_FIELD_MAX
      : VOICE_BRIEF_TARGET_MAX;

  try {
    const payload = { text: raw || caseRaw, context };
    if (context === ACT8_CONCLUSION_BUNDLE_CONTEXT && caseRaw) {
      payload.case_text = caseRaw;
    }
    const res = await postVoiceBrief(payload);
    if (!isApiError(res)) {
      const brief = String(res?.brief || '').trim();
      if (brief) return finalizeBrief(brief, formatNumbers, maxChars, stripFigures);
    } else {
      console.warn('[voiceBrief] API 返回错误，使用本地归纳', res.reason, res.detail);
    }
  } catch (err) {
    console.warn('[voiceBrief] API 不可用，使用本地归纳', err);
  }

  if (context === ACT8_CONCLUSION_BUNDLE_CONTEXT) {
    return fallbackAct8ConclusionBundle(raw, caseRaw);
  }
  if (context === CASE_SCENE_CONTEXT || context === CASE_SOLUTION_CONTEXT) {
    return fallbackCaseFieldBrief(raw, context, formatNumbers, maxChars, stripFigures);
  }
  return fallbackBrief(raw, formatNumbers, maxChars, stripFigures);
}

function finalizeBrief(text, formatNumbers = false, maxChars = VOICE_BRIEF_TARGET_MAX, stripFigures = false) {
  let raw = String(text || '').replace(/建议建议+/g, '建议').trim();
  if (stripFigures) raw = stripFigureTableRefs(raw);
  raw = compressToVoiceLength(raw, maxChars);
  if (formatNumbers) raw = formatVoiceNumbers(raw);
  if (!raw) return '';
  return raw.endsWith('。') ? raw : `${raw}。`;
}

function fallbackBrief(text, formatNumbers = false, maxChars = VOICE_BRIEF_TARGET_MAX, stripFigures = false) {
  let raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (stripFigures) raw = stripFigureTableRefs(raw);
  if (!raw) return '';
  const parts = raw.split(/[。；]/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) {
    return finalizeBrief(raw.slice(0, maxChars), formatNumbers, maxChars, stripFigures);
  }
  let brief = parts[0];
  for (let i = 1; i < parts.length; i += 1) {
    const joined = `${brief}，${parts[i]}`;
    if (joined.length <= maxChars) brief = joined;
    else break;
  }
  return finalizeBrief(brief, formatNumbers, maxChars, stripFigures);
}

const CASE_SCENE_FACT_RULES = [
  [/间距仅?(\d+)米/, (m) => `间距${m[1]}米`],
  [/非联网|哑终端|无通信联网/, () => '非联网哑终端'],
  [/东西向/, () => '东西向流量主导'],
  [/短距|相邻路口/, () => '短距相邻路口'],
];

function oralizeCaseScene(raw, maxChars) {
  const clauses = String(raw || '').split(/[，,]/).map((s) => s.trim()).filter(Boolean);
  const head = compressToVoiceLength(clauses[0] || raw, 34);
  const facts = [];
  const seen = new Set();
  for (const [re, fmt] of CASE_SCENE_FACT_RULES) {
    const m = String(raw || '').match(re);
    if (!m) continue;
    const fact = fmt(m);
    if (seen.has(fact)) continue;
    seen.add(fact);
    facts.push(fact);
  }
  const body = (facts.length ? facts : clauses.slice(1, 3)).slice(0, 3).join('，');
  return compressToVoiceLength(body ? `${head}，${body}` : head, maxChars);
}

function oralizeCaseSolution(raw, maxChars) {
  const items = String(raw || '').split(/[①②③④⑤⑥⑦⑧⑨⑩]/).map((s) => s.trim().replace(/^[；;，,]+/, '')).filter(Boolean);
  if (items.length >= 2) {
    const chunks = items.slice(0, 3).map((item) => compressToVoiceLength(item, 36)).filter(Boolean);
    return compressToVoiceLength(chunks.join('；'), maxChars);
  }
  return compressToVoiceLength(raw, maxChars);
}

function fallbackCaseFieldBrief(text, context, formatNumbers = false, maxChars = VOICE_BRIEF_TARGET_MAX, stripFigures = false) {
  let raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (stripFigures) raw = stripFigureTableRefs(raw);
  if (!raw) return '';

  if (context === CASE_SOLUTION_CONTEXT) {
    const items = raw.split(/[①②③④⑤⑥⑦⑧⑨⑩]/).map((s) => s.trim().replace(/^[；;，,]+/, '')).filter(Boolean);
    if (items.length >= 2) {
      return finalizeBrief(oralizeCaseSolution(raw, maxChars), formatNumbers, maxChars, stripFigures);
    }
  }

  if (context === CASE_SCENE_CONTEXT && (raw.length > 48 || /[。；]/.test(raw))) {
    return finalizeBrief(oralizeCaseScene(raw, maxChars), formatNumbers, maxChars, stripFigures);
  }

  return fallbackBrief(raw, formatNumbers, maxChars, stripFigures);
}

const OVERALL_CASE_REF_RE = /案例|借鉴|相似案例|参考.{0,6}案例/;
const CASE_SHORT_NAME_RE = /借鉴([^，：:。\n]{2,24}?)(?:等相似案例|[：:，,]|$)/;
const FIELD_LABEL_RE = /(问题对象|成因判定|过程分析|证据说明|策略结论|方案结论)[：:]/g;

function extractCaseShortName(caseText) {
  const raw = String(caseText || '').replace(/\s+/g, ' ').trim();
  const match = raw.match(CASE_SHORT_NAME_RE);
  return match?.[1]?.trim() || '';
}

function extractCaseAdvice(caseText) {
  let body = String(caseText || '').replace(/\s+/g, ' ').trim();
  body = body.replace(/^已参考相似案例库[，,]?\s*/, '');
  body = body.replace(/^借鉴[^：:，,]{1,24}(?:等相似案例)?[：:，,]\s*/, '');
  body = body.replace(/建议建议+/g, '建议').replace(/^建议\s*/, '').trim();
  if (body && !body.startsWith('建议')) body = `建议${body}`;
  return body.replace(/[。；]+$/g, '');
}

function overallReferencesCaseBorrowing(overall, caseText) {
  const overallRaw = String(overall || '').trim();
  const caseRaw = String(caseText || '').trim();
  if (!caseRaw || !overallRaw) return false;
  if (OVERALL_CASE_REF_RE.test(overallRaw)) return true;
  return Boolean(extractCaseShortName(caseRaw));
}

export function fallbackAct8ConclusionBundle(overall, caseText) {
  const overallClean = String(overall || '').replace(FIELD_LABEL_RE, '');
  if (!overallReferencesCaseBorrowing(overall, caseText)) {
    return finalizeBrief(
      fallbackBrief(overallClean, true, VOICE_BRIEF_BUNDLE_TARGET_MAX),
      true,
      VOICE_BRIEF_BUNDLE_TARGET_MAX,
    );
  }
  const caseName = extractCaseShortName(caseText);
  const advice = extractCaseAdvice(caseText);
  if (!caseName || !advice) {
    return finalizeBrief(
      fallbackBrief(overallClean, true, VOICE_BRIEF_BUNDLE_TARGET_MAX),
      true,
      VOICE_BRIEF_BUNDLE_TARGET_MAX,
    );
  }
  const caseClause = `参考${caseName}，${advice}`;
  const coreBudget = Math.max(
    28,
    VOICE_BRIEF_BUNDLE_TARGET_MAX - caseClause.length - 1,
  );
  const core = fallbackBrief(overallClean, true, coreBudget).replace(/。$/g, '');
  const merged = `${core}；${caseClause}`;
  return finalizeBrief(merged, true, VOICE_BRIEF_BUNDLE_TARGET_MAX);
}

/**
 * Act8 方案页：整体结论 + 案例借鉴 → 一条口播
 * @param {string} overall
 * @param {string} caseReference
 */
export async function fetchAct8ConclusionBrief(overall, caseReference) {
  return fetchVoiceBrief(overall, ACT8_CONCLUSION_BUNDLE_CONTEXT, caseReference);
}

/** @param {string} sceneText 案例场景全文 */
export async function fetchCaseSceneBrief(sceneText) {
  return fetchVoiceBrief(sceneText, CASE_SCENE_CONTEXT);
}

/** @param {string} solutionText 治理方案全文 */
export async function fetchCaseSolutionBrief(solutionText) {
  return fetchVoiceBrief(solutionText, CASE_SOLUTION_CONTEXT);
}

export { fallbackBrief };

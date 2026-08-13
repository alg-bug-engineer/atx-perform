/**
 * 用户可见文案清洗：打字机 / 侧栏 / 结论 / 口播
 * 禁止电影/镜头用语上屏（机位、特写、飞镜、运镜等）。
 *
 * 展示别名：PG/查询仍用「齐川路」，可见可听统一为「齐音路」。
 */

/** PG 正式名 / 旧称 → 演示展示名（仅可视化与口播，不影响查库） */
const DISPLAY_NAME_ALIASES = [
  [/齐音绿/g, '齐音路'],
  [/齐川路/g, '齐音路'],
];

const PHRASE_REPLACEMENTS = [
  [/推进(?:北)?进口道特写/g, '聚焦问题进口道'],
  [/承接廊道机位(?:\s*[·・]\s*略降高度)?/g, '沿干线进入问题进口核验'],
  [/廊道机位/g, '干线范围'],
  [/略降高度/g, ''],
  [/飞镜/g, ''],
  [/缓推至?/g, ''],
  [/运镜/g, ''],
  [/景别/g, ''],
  [/构图/g, ''],
  [/机位/g, ''],
  [/特写/g, ''],
  [/镜头飞向?/g, ''],
  [/地图可视化呈现中…?/g, '地图证据同步中'],
  [/可视化已展示/g, '地图证据已同步'],
];

/**
 * 将数据侧路名替换为演示展示名（齐川路 → 齐音路）。
 * 查库 / 地理查找请继续用原始名，不要对本函数结果做 PG 匹配。
 * @param {unknown} text
 * @returns {string}
 */
export function applyDisplayNameAlias(text) {
  if (text == null) return '';
  let t = String(text);
  for (const [re, to] of DISPLAY_NAME_ALIASES) {
    t = t.replace(re, to);
  }
  return t;
}

/**
 * @param {unknown} text
 * @returns {string}
 */
export function sanitizeUserFacingCopy(text) {
  if (text == null) return '';
  let t = applyDisplayNameAlias(String(text));
  for (const [re, to] of PHRASE_REPLACEMENTS) {
    t = t.replace(re, to);
  }
  return t
    .replace(/[·・]\s*[·・]/g, '·')
    .replace(/\s*[·・]\s*$/g, '')
    .replace(/^\s*[·・]\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/：\s*$/g, '')
    .trim();
}

/**
 * 分析步骤 → 打字机单行（label：detail）
 * @param {{ label?: string, detail?: string }|string|null|undefined} step
 * @returns {string}
 */
export function formatReasoningStep(step) {
  if (step == null) return '';
  if (typeof step === 'string') return sanitizeUserFacingCopy(step);
  const label = sanitizeUserFacingCopy(step.label || '');
  const detail = sanitizeUserFacingCopy(step.detail || '');
  if (!label) return detail;
  if (!detail) return label;
  return `${label}：${detail}`;
}

/**
 * 点/线典型演示 Case 清单（对齐 traffic-agent manifest）。
 * Live 走真实 PG + typical_intersections 取数策略；本文件只提供入口 query / 预载锚点。
 */
import manifest from '../config/demo-cases.json';

/** @typedef {{
 *   id: string,
 *   code: string,
 *   label: string,
 *   display_name: string,
 *   inter_id: string,
 *   intersection_name: string,
 *   opt_type: 'TYPE1_POINT' | 'TYPE2_LINE' | string,
 *   metric_profile_id?: string,
 *   query: string,
 * }} DemoCase */

/** @type {DemoCase[]} */
export const DEMO_CASES = Array.isArray(manifest.cases) ? manifest.cases : [];

export const DEFAULT_DEMO_CASE_ID = manifest.default_case_id || DEMO_CASES[0]?.id || 'case_a';

/** @returns {DemoCase|null} */
export function getDefaultDemoCase() {
  return DEMO_CASES.find((c) => c.id === DEFAULT_DEMO_CASE_ID) || DEMO_CASES[0] || null;
}

/** 默认演示句（Act1 placeholder / 兼容旧 CASE_A_DEMO_QUERY） */
export const DEFAULT_DEMO_QUERY = getDefaultDemoCase()?.query || '';

/** @returns {DemoCase[]} */
export function listPointDemoCases() {
  return DEMO_CASES.filter((c) => c.opt_type === 'TYPE1_POINT');
}

/** @returns {DemoCase[]} */
export function listLineDemoCases() {
  return DEMO_CASES.filter((c) => c.opt_type === 'TYPE2_LINE');
}

/**
 * 从自然语言匹配典型 Case（精确 query / inter_id / 路口名 / 短标签 / 道路对）。
 * 展示名「齐音路」与查库名「齐川路」等价，便于用户按可见文案输入。
 * @param {string} prompt
 * @returns {DemoCase|null}
 */
export function matchDemoCase(prompt) {
  const text = (prompt || '').trim();
  if (!text) return null;
  const matchText = text.replace(/齐音路/g, '齐川路').replace(/齐音绿/g, '齐川路');
  for (const c of DEMO_CASES) {
    const labelForMatch = String(c.label || '').replace(/齐音路/g, '齐川路');
    if (
      text === c.query
      || matchText === c.query
      || (c.inter_id && text.includes(c.inter_id))
      || (c.intersection_name && (text.includes(c.intersection_name) || matchText.includes(c.intersection_name)))
      || (c.label && (text.includes(c.label) || matchText.includes(labelForMatch)))
    ) {
      return c;
    }
  }
  // 宽松：路口名拆成道路对，文本同时含两段即命中（兼容「解放东路齐川路口」无「与」）
  for (const c of DEMO_CASES) {
    const tokens = String(c.intersection_name || '')
      .replace(/路口$/, '')
      .split(/[与和×xX]/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2);
    if (tokens.length >= 2 && tokens.every((t) => matchText.includes(t))) {
      return c;
    }
  }
  return null;
}

/** Case A（奥体西路×经十路）工单判定 */
export const CASE_A_INTER_ID = '011wwe28ctu00001';

/** @param {{ inter_id?: string }|null|undefined} ticket */
export function isCaseATicket(ticket) {
  return ticket?.inter_id === CASE_A_INTER_ID;
}

/** 点优化 / 线优化 上屏文案 */
export function optTypeLabel(optType) {
  if (optType === 'TYPE1_POINT') return '点优化';
  if (optType === 'TYPE2_LINE') return '线优化';
  return '典型案例';
}

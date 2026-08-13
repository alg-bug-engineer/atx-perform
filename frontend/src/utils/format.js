/**
 * 数值展示工具 — 对齐 traffic-agent `frontend/src/utils/format.ts`
 * 空值一律返回 "—"，禁止对 null 调 toFixed。
 * 面板/地图：缺指标时优先「不渲染整项」；文案位再用 "—"。
 */

export function isNum(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * 饱和度展示守卫：后端缺数时常写 0.0 + metrics_available=false。
 * 无有效正值 → 不展示（对齐参考 mapMarkers saturation > 0）。
 */
export function hasSaturation(x) {
  return isNum(x) && x > 0;
}

/** 小数比值：排队比 / 饱和度等；空值 → "—" */
export function ratio(x, digits = 2) {
  return isNum(x) ? x.toFixed(digits) : '—';
}

/** 通用小数；空值 → "—" */
export function num(x, digits = 0) {
  return isNum(x) ? x.toFixed(digits) : '—';
}

/** 米；空值 → "—" */
export function meters(x, digits = 0) {
  return isNum(x) ? `${x.toFixed(digits)}m` : '—';
}

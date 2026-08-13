/**
 * 目标进口臂角解析：禁止 Case A 北进口写死（358.79）。
 * 优先用后端 spatial_scene.target.north_arm_angle（实为 entry arm，由渠化几何推算）。
 * 上屏进口名优先用 axis_roads 映射为道路名（如「奥体中路北进口」）。
 */
import { applyDisplayNameAlias } from '../../utils/userFacingCopy.js';

/** 方位文案（东西南北进口）——仅作回退，上屏优先道路名 */
const CARDINAL_APPROACH_RE = /^(东|西|南|北|东北|东南|西南|西北)进口$/;

/**
 * @param {string|null|undefined} text
 * @returns {boolean}
 */
export function isCardinalApproachLabel(text) {
  return CARDINAL_APPROACH_RE.test(String(text || '').trim());
}

/** @param {string|null|undefined} direction */
export function directionToDefaultArmAngle(direction) {
  const d = String(direction || '');
  // 标准行驶方向：进口在反向；东向西 → 车从东来 → 东进口臂 ≈ 90°
  if (/东向西|东进口/.test(d)) return 90;
  if (/西向东|西进口/.test(d)) return 270;
  if (/南向北|南进口/.test(d)) return 180;
  if (/北向南|北进口/.test(d)) return 0;
  return null;
}

/**
 * @param {{ north_arm_angle?: number, entry_arm_angle?: number, direction?: string }|null|undefined} target
 * @param {{ direction?: string }|null|undefined} ticket
 * @returns {number}
 */
export function resolveEntryArmAngle(target, ticket) {
  const fromGeom = target?.entry_arm_angle ?? target?.north_arm_angle;
  if (typeof fromGeom === 'number' && Number.isFinite(fromGeom)) return fromGeom;
  const fromDir = directionToDefaultArmAngle(target?.direction || ticket?.direction);
  if (fromDir != null) return fromDir;
  // 无任何方向信息时用 0（正北臂），禁止回退 Case A 358.79
  return 0;
}

/**
 * 行驶方向短标签，如「东向西」
 * @param {{ direction?: string, movement?: string }|null|undefined} ticket
 * @param {{ direction?: string, movement?: string }|null|undefined} target
 */
export function resolveDirectionLabel(ticket, target) {
  return target?.direction || ticket?.direction || '';
}

/**
 * 从方向 / 进口文案解析方位键：east|west|south|north
 * @param {string|null|undefined} directionOrApproach
 * @returns {'east'|'west'|'south'|'north'|null}
 */
export function cardinalKeyFromDirection(directionOrApproach) {
  const d = String(directionOrApproach || '').trim();
  if (!d) return null;
  // 完整行驶方向 / 进口标签优先（避免「南向北」因含「北」误判）
  if (/东向西|东进口/.test(d)) return 'east';
  if (/西向东|西进口/.test(d)) return 'west';
  if (/南向北|南进口/.test(d)) return 'south';
  if (/北向南|北进口/.test(d)) return 'north';
  if (/^东$|^东向/.test(d) && !/东北|东南/.test(d)) return 'east';
  if (/^西$|^西向/.test(d) && !/西北|西南/.test(d)) return 'west';
  if (/^南$|^南向/.test(d) && !/东南|西南/.test(d)) return 'south';
  if (/^北$|^北向/.test(d) && !/东北|西北/.test(d)) return 'north';
  return null;
}

/**
 * @param {number|string|null|undefined} dir8Code
 * @param {string|null|undefined} dir8Label
 * @returns {'east'|'west'|'south'|'north'|null}
 */
export function cardinalKeyFromDir8(dir8Code, dir8Label) {
  const code = Number(dir8Code);
  if (code === 0) return 'north';
  if (code === 2) return 'east';
  if (code === 4) return 'south';
  if (code === 6) return 'west';
  return cardinalKeyFromDirection(dir8Label);
}

/**
 * 轴路名 → 某方位道路名（东西轴共用 ew，南北轴共用 ns）
 * @param {'east'|'west'|'south'|'north'|null} key
 * @param {{ ew_road?: string|null, ns_road?: string|null, approaches?: Record<string, string|null> }|null|undefined} axisRoads
 * @returns {string}
 */
export function roadNameForCardinal(key, axisRoads) {
  if (!key || !axisRoads) return '';
  const fromMap = axisRoads.approaches?.[key]
    || axisRoads.approaches?.[{
      east: '东', west: '西', south: '南', north: '北',
    }[key]];
  if (fromMap) return applyDisplayNameAlias(String(fromMap).trim());
  if (key === 'east' || key === 'west') {
    return applyDisplayNameAlias(String(axisRoads.ew_road || '').trim());
  }
  if (key === 'south' || key === 'north') {
    return applyDisplayNameAlias(String(axisRoads.ns_road || '').trim());
  }
  return '';
}

/**
 * 进口道方位名，如「东进口」（无轴路数据时的回退）
 * @param {string|null|undefined} direction
 */
export function cardinalApproachLabel(direction) {
  const key = cardinalKeyFromDirection(direction);
  if (key === 'east') return '东进口';
  if (key === 'west') return '西进口';
  if (key === 'south') return '南进口';
  if (key === 'north') return '北进口';
  return '目标进口';
}

/**
 * 进口道展示名：有轴路数据时为「奥体中路北进口」，否则回退「北进口」
 * @param {string|null|undefined} direction
 * @param {{ ew_road?: string|null, ns_road?: string|null, approaches?: Record<string, string|null> }|null|undefined} [axisRoads]
 */
export function approachLabelFromDirection(direction, axisRoads) {
  const cardinal = cardinalApproachLabel(direction);
  if (cardinal === '目标进口') return cardinal;
  const key = cardinalKeyFromDirection(direction);
  const road = roadNameForCardinal(key, axisRoads);
  if (!road || isCardinalApproachLabel(road)) return cardinal;
  // 「奥体中路」+「北进口」→「奥体中路北进口」
  const bearing = cardinal.replace('进口', '');
  return `${road}${bearing}进口`;
}

/**
 * 将已有方位文案（如 metrics.storage_direction「北进口」）替换为道路名进口
 * @param {string|null|undefined} label
 * @param {{ ew_road?: string|null, ns_road?: string|null }|null|undefined} [axisRoads]
 */
export function localizeApproachLabel(label, axisRoads) {
  const text = String(label || '').trim();
  if (!text) return '';
  if (!axisRoads) return text;
  // 已是道路名则不动
  if (!isCardinalApproachLabel(text) && !/进口/.test(text)) return text;
  const key = cardinalKeyFromDirection(text);
  if (!key) return text;
  return approachLabelFromDirection(text, axisRoads);
}

/**
 * 将后端 channelization_map 转为 createChannelizationLayer 所需 interItem 形状。
 * Live 模式严禁回退本地 intersection_links.json。
 * 路臂展示名优先真实道路名；禁止用「东/西/南/北进口」冒充 road_name。
 */

import {
  cardinalKeyFromDir8,
  isCardinalApproachLabel,
  roadNameForCardinal,
} from '../features/acts/entryArm.js';
import { applyDisplayNameAlias } from '../utils/userFacingCopy.js';

/**
 * @param {[number, number]} a
 * @param {[number, number]} b
 */
function bearing(a, b) {
  const dLat = b[1] - a[1];
  const dLon = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  return ((Math.atan2(dLon, dLat) * 180) / Math.PI + 360) % 360;
}

/**
 * @param {Record<string, unknown>} link
 * @param {{ ew_road?: string|null, ns_road?: string|null, approaches?: Record<string, string|null> }|null|undefined} axisRoads
 */
function resolveRoadName(link, axisRoads) {
  const raw = applyDisplayNameAlias(String(link.road_name || '').split(':')[0].trim());
  if (raw && !isCardinalApproachLabel(raw)) return raw;
  const key = cardinalKeyFromDir8(link.dir8_code, link.dir8_label || link.dir4_label);
  const fromAxis = roadNameForCardinal(key, axisRoads);
  if (fromAxis && !isCardinalApproachLabel(fromAxis)) return fromAxis;
  return '';
}

/**
 * @param {Record<string, unknown>} link
 * @param {boolean} isEntrance
 * @param {{ ew_road?: string|null, ns_road?: string|null }|null|undefined} axisRoads
 */
function toLocalLink(link, isEntrance, axisRoads) {
  const path = Array.isArray(link.path) ? link.path : [];
  let fAngle = link.f_angle ?? link.entrance_angle ?? null;
  let tAngle = link.t_angle ?? null;
  if (path.length >= 2) {
    if (isEntrance) {
      tAngle = bearing(path[path.length - 2], path[path.length - 1]);
      fAngle = bearing(path[path.length - 1], path[path.length - 2]);
    } else {
      fAngle = bearing(path[0], path[1]);
      tAngle = fAngle;
    }
  }
  return {
    link_id: link.link_id,
    road_name: resolveRoadName(link, axisRoads),
    lane_num: link.lane_num,
    c_lane_num: link.c_lane_num,
    lane_info: link.lane_info,
    turn_move: link.turn_move,
    f_angle: fAngle,
    t_angle: tAngle,
    length_m: link.length_m,
    // 几何与路口 id 透传：臂中心线弯曲/双向均值/手工标定均依赖这些字段，
    // 缺失时运行时臂体永远回退直线（白盒测试与线上表现不一致的根因）
    geom: link.geom || null,
    f_inter_id: link.f_inter_id,
    t_inter_id: link.t_inter_id,
  };
}

/**
 * @param {Record<string, unknown>|null|undefined} channelizationMap
 * @param {{ inter_id?: string, intersection_name?: string, lng?: number, lat?: number }} ticket
 * @param {{ ew_road?: string|null, ns_road?: string|null, approaches?: Record<string, string|null> }|null|undefined} [axisRoads]
 * @returns {Record<string, unknown>|null}
 */
export function channelizationMapToInterItem(channelizationMap, ticket = {}, axisRoads = null) {
  if (!channelizationMap?.available) return null;
  const links = Array.isArray(channelizationMap.links) ? channelizationMap.links : [];
  if (!links.length) return null;

  const center = Array.isArray(channelizationMap.center)
    ? channelizationMap.center
    : [ticket.lng, ticket.lat];
  if (center[0] == null || center[1] == null) return null;

  const inLinks = [];
  const outLinks = [];
  for (const link of links) {
    const role = String(link.link_role || '').toLowerCase();
    const isExit = role === 'exit' || role === 'out' || role === 'leaving';
    if (isExit) outLinks.push(toLocalLink(link, false, axisRoads));
    else inLinks.push(toLocalLink(link, true, axisRoads));
  }
  if (!inLinks.length && !outLinks.length) return null;

  return {
    intersection_info: {
      inter_id: ticket.inter_id || channelizationMap.target_intersection?.inter_id,
      inter_name: ticket.intersection_name || channelizationMap.target_intersection?.inter_name,
      longitude: Number(center[0]),
      latitude: Number(center[1]),
    },
    surrounding_links: {
      进入路口的路段: inLinks,
      离开路口的路段: outLinks,
      进入路段数: inLinks.length,
      离开路段数: outLinks.length,
      路段总数: inLinks.length + outLinks.length,
    },
  };
}

/**
 * 幕 1 · 问题定位 — 路况着色数据服务
 *
 * case 覆盖范围：北入口（问题路段）+ 上游两个路段
 * 数据来源：
 * - Mock（默认）：fixture 内置值 —— 数值为 PG 嗅探结果
 *   （road6/xianchang，2026-05-01 路网，周一 17:30-18:30，step 210-221）
 * - Live（VITE_MOCK=0）：GET /api/v1/traffic/color-links ——
 *   后端从 PG 读取：dws_link_index_5min_mm.avg_speed / delay_index（周表对照
 *   jam_delay_index），按速度派生高德语义状态（≥35→1绿 / ≥20→2黄 / ≥10→3红 / <10→4深红）。
 *
 * 前端只消费结构化结果：{ link_id, avg_speed_kmh, delay_index, derived_state }。
 */
import { getJSON, isApiError } from '../../../services/api/client.js';
import { isLiveApiMode } from '../../../services/api/endpoints.js';
import { failLivePipeline } from '../../../services/livePipelineError.js';
import { TRAFFIC_COLOR_CASE_LINKS } from './fixture.js';

/** case 标识（与 demo-cases / 后端 case 注册对齐） */
export const TRAFFIC_CASE_ID = 'aotixi-jingshi-north-through';

/** 分析窗口（对齐 1-scene-objects.json） */
export const TRAFFIC_TIME_WINDOW = {
  day_of_week: 1,
  step_start: 210,
  step_end: 221,
};

/** 高德语义状态 → 色板（2D 叠加层使用） */
export const TRAFFIC_STATE_COLORS = {
  1: '#2ecc71', // 绿（畅通）
  2: '#ffcc00', // 黄（缓行）
  3: '#ff5a36', // 红（拥堵）
  4: '#d0021b', // 深红（严重拥堵）
  null: '#8a97a8', // 灰（无数据）
};

/** 高德语义状态 → 图例文案 */
export const TRAFFIC_STATE_LABELS = {
  1: '畅通',
  2: '缓行',
  3: '拥堵',
  4: '严重拥堵',
  null: '无数据',
};

/**
 * 按速度派生高德语义状态（对齐 data-contract.md）
 * @param {number|null} speedKmh
 * @returns {1|2|3|4|null}
 */
export function deriveStateFromSpeed(speedKmh) {
  if (speedKmh == null || !Number.isFinite(speedKmh)) return null;
  if (speedKmh >= 35) return 1;
  if (speedKmh >= 20) return 2;
  if (speedKmh >= 10) return 3;
  return 4;
}

/**
 * 取 case 路况路段（北入口 + 上游两个路段）。
 *
 * @returns {Promise<Array<{
 *   link_id: string,
 *   road_name: string,
 *   role: string,
 *   avg_speed_kmh: number|null,
 *   delay_index: number|null,
 *   derived_state: 1|2|3|4|null,
 *   queue_length_m?: number,
 *   is_problem_link?: boolean,
 *   geom: { type: string, coordinates: number[][] },
 *   source: 'pg_live' | 'pg_sniffed_mock',
 * }>>}
 */
export async function fetchCaseTrafficLinks() {
  if (!isLiveApiMode()) {
    // Mock：fixture 内置（PG 嗅探值）
    return TRAFFIC_COLOR_CASE_LINKS.map((l) => ({
      ...l,
      source: 'pg_sniffed_mock',
    }));
  }

  // Live：后端从 PG 读取（dws_link_index_5min_mm 等）
  const res = await getJSON('/traffic/color-links', {
    case_id: TRAFFIC_CASE_ID,
    day_of_week: TRAFFIC_TIME_WINDOW.day_of_week,
    step_start: TRAFFIC_TIME_WINDOW.step_start,
    step_end: TRAFFIC_TIME_WINDOW.step_end,
  });

  if (isApiError(res)) {
    failLivePipeline(`Live 路况数据获取失败（PG 读取）：${res.reason}`);
    return [];
  }

  const links = Array.isArray(res?.links) ? res.links : [];
  if (!links.length) {
    failLivePipeline('Live 路况数据为空：后端未返回 case 覆盖路段');
    return [];
  }

  // 后端返回几何 + 速度/延误；状态按契约派生（后端若已给 derived_state 则沿用）
  return links.map((l) => ({
    ...l,
    derived_state: l.derived_state ?? deriveStateFromSpeed(l.avg_speed_kmh),
    source: 'pg_live',
  }));
}

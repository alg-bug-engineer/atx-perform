/** 默认进入幕（可用 ?scene= 覆盖） */
export const DEFAULT_SCENE_KEY = '0'

/** URL 参数名：?scene=0..5 或 ?scene=opening */
export const SCENE_QUERY_KEY = 'scene'

/**
 * 幕 1 / 幕 2 道路车流粒子流开关（TrafficOriginScene）：
 * false = 关闭全域粒子与廊道局部粒子；true = 恢复粒子流。
 */
export const ROAD_PARTICLES_VISIBLE = false

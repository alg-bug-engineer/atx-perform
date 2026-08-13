/**
 * Case A fixture inter_id（011wwe…）与路网 geojson inter_id（6fae…）不一致。
 * 渠化等可走经纬度；拥堵蔓延 / focus 溯源必须用路网真实 ID 做拓扑。
 *
 * 坐标锚点（与 fixture / merged_network 完全重合）：
 * - 目标：解放东路与齐川路  117.108428, 36.662959 → 6faeecc22f6eaf
 * - 上游：书昌街与齐音路    117.108429, 36.664068 → 6faeecd22f7304
 * - 下游：永绥路与齐音路    117.108427, 36.661851 → 6faeecb22f6a5b
 */

export const CASE_A_FIXTURE_TARGET_ID = '011wwe28f7c00001';
export const CASE_A_FIXTURE_UPSTREAM_ID = '011wwe28f7z00001';
export const CASE_A_FIXTURE_DOWNSTREAM_ID = '011wwe28f5f00001';

export const CASE_A_TARGET_LNG = 117.108428;
export const CASE_A_TARGET_LAT = 36.662959;
export const CASE_A_UPSTREAM_LNG = 117.108429;
export const CASE_A_UPSTREAM_LAT = 36.664068;
export const CASE_A_DOWNSTREAM_LNG = 117.108427;
export const CASE_A_DOWNSTREAM_LAT = 36.661851;

/** 路网侧已知映射（坐标精确命中） */
export const CASE_A_NETWORK_IDS = {
  target: '6faeecc22f6eaf',
  upstream: '6faeecd22f7304',
  downstream: '6faeecb22f6a5b',
};

/**
 * @param {Array<{ props?: object, lonlat?: number[], pos?: number[] }>} intersections
 * @param {{ interId?: string, lng?: number, lat?: number, maxDeg?: number }} query
 */
export function resolveNetworkIntersection(intersections, query = {}) {
  const list = intersections || [];
  const wantId = query.interId;
  if (wantId) {
    const byId = list.find(
      (i) => (i.props?.inter_id || i.props?.interId) === wantId,
    );
    if (byId) return byId;
  }

  // fixture → 路网已知映射
  if (wantId === CASE_A_FIXTURE_TARGET_ID) {
    const mapped = list.find(
      (i) => (i.props?.inter_id || i.props?.interId) === CASE_A_NETWORK_IDS.target,
    );
    if (mapped) return mapped;
  }
  if (wantId === CASE_A_FIXTURE_UPSTREAM_ID) {
    const mapped = list.find(
      (i) => (i.props?.inter_id || i.props?.interId) === CASE_A_NETWORK_IDS.upstream,
    );
    if (mapped) return mapped;
  }
  if (wantId === CASE_A_FIXTURE_DOWNSTREAM_ID) {
    const mapped = list.find(
      (i) => (i.props?.inter_id || i.props?.interId) === CASE_A_NETWORK_IDS.downstream,
    );
    if (mapped) return mapped;
  }

  const lng = query.lng;
  const lat = query.lat;
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || !list.length) return null;

  const maxDeg = query.maxDeg ?? 0.0008; // ≈80m
  let best = null;
  let bestD = Infinity;
  for (const inter of list) {
    const ll = inter.lonlat;
    if (!Array.isArray(ll) || ll.length < 2) continue;
    const d = Math.hypot(ll[0] - lng, ll[1] - lat);
    if (d < bestD) {
      bestD = d;
      best = inter;
    }
  }
  if (!best || bestD > maxDeg) return null;
  return best;
}

export function resolveNetworkInterId(intersections, query = {}) {
  const inter = resolveNetworkIntersection(intersections, query);
  return inter?.props?.inter_id || inter?.props?.interId || null;
}

export function getCaseANetworkIds(intersections) {
  const target = resolveNetworkInterId(intersections, {
    interId: CASE_A_FIXTURE_TARGET_ID,
    lng: CASE_A_TARGET_LNG,
    lat: CASE_A_TARGET_LAT,
  }) || CASE_A_NETWORK_IDS.target;

  const upstream = resolveNetworkInterId(intersections, {
    interId: CASE_A_FIXTURE_UPSTREAM_ID,
    lng: CASE_A_UPSTREAM_LNG,
    lat: CASE_A_UPSTREAM_LAT,
  }) || CASE_A_NETWORK_IDS.upstream;

  const downstream = resolveNetworkInterId(intersections, {
    interId: CASE_A_FIXTURE_DOWNSTREAM_ID,
    lng: CASE_A_DOWNSTREAM_LNG,
    lat: CASE_A_DOWNSTREAM_LAT,
  }) || CASE_A_NETWORK_IDS.downstream;

  return { target, upstream, downstream };
}

/**
 * 主路径路段：上游 → 目标 → 下游（最短路径边集）
 * 只返回廊道边，供 Act5 拥堵蔓延（禁止全网扩散）
 */
export function collectMainPathRoads(roads, {
  targetId,
  upstreamId,
  downstreamId,
} = {}) {
  const list = roads || [];
  if (!targetId || !upstreamId || !downstreamId) return [];

  const adj = new Map();
  const addEdge = (a, b, road) => {
    if (!a || !b) return;
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ nid: b, road });
  };

  for (const road of list) {
    const f = road.props?.from_inter_id;
    const t = road.props?.to_inter_id;
    addEdge(f, t, road);
    addEdge(t, f, road);
  }

  function shortestPathEdges(start, goal) {
    if (!start || !goal || start === goal) return [];
    const prev = new Map([[start, null]]);
    const prevRoad = new Map();
    const q = [start];
    while (q.length) {
      const id = q.shift();
      if (id === goal) break;
      for (const { nid, road } of (adj.get(id) || [])) {
        if (prev.has(nid)) continue;
        prev.set(nid, id);
        prevRoad.set(nid, road);
        q.push(nid);
      }
    }
    if (!prev.has(goal)) return [];
    const edges = [];
    let cur = goal;
    while (cur !== start) {
      const road = prevRoad.get(cur);
      if (road) edges.push(road);
      cur = prev.get(cur);
      if (cur == null) break;
    }
    return edges;
  }

  const upToTarget = shortestPathEdges(upstreamId, targetId);
  const targetToDown = shortestPathEdges(targetId, downstreamId);

  const seen = new Set();
  const out = [];
  for (const road of [...upToTarget, ...targetToDown]) {
    const key = road.props?.link_id
      || road.props?.road_id
      || `${road.props?.from_inter_id}|${road.props?.to_inter_id}|${road.coords?.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(road);
  }

  if (!out.length) {
    const ids = new Set([targetId, upstreamId, downstreamId]);
    for (const road of list) {
      const f = road.props?.from_inter_id;
      const t = road.props?.to_inter_id;
      if (ids.has(f) && ids.has(t)) out.push(road);
    }
  }

  return out;
}

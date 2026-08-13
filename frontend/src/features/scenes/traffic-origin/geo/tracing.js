/**
 * 拓扑图构建 & 车流溯源
 *
 * 流量溯源逻辑：
 *  - 以选定路口为"汇聚点"
 *  - 向外 BFS 追溯"上游"路段（to_inter_id 指向当前节点的路段）
 *  - 每条路段获得 traceWeight ∈ [0,1]：
 *      depth = 0（直接相连）→ 1.0
 *      depth 越深 → 衰减至 0
 *  - traceWeight × roadClassWeight 决定最终"流量粗细"
 */

const CLASS_WEIGHT = { express: 1.0, arterial: 0.75, collector: 0.45, local: 0.2 };

// ── 构建有向拓扑图 ─────────────────────────────────────────────────────────────
export function buildTopology(roads) {
  // adjIn[toId] = [{road, fromId}]  – 流入边（to_inter_id 指向该路口）
  // adjOut[fromId] = [{road, toId}] – 流出边
  const adjIn  = new Map();
  const adjOut = new Map();

  for (const road of roads) {
    const { from_inter_id: fid, to_inter_id: tid } = road.props;
    if (!fid || !tid) continue;

    if (!adjIn.has(tid))  adjIn.set(tid,  []);
    if (!adjOut.has(fid)) adjOut.set(fid, []);

    adjIn.get(tid).push({ road, fromId: fid });
    adjOut.get(fid).push({ road, toId: tid });
  }

  return { adjIn, adjOut };
}

// ── 找到连接度最高的路口（作为默认选中对象）─────────────────────────────────────
export function findBusiestIntersection(intersections, topology) {
  let best = null, bestDegree = -1;
  for (const inter of intersections) {
    const id = inter.props.inter_id;
    const inDeg  = (topology.adjIn.get(id)  || []).length;
    const outDeg = (topology.adjOut.get(id) || []).length;
    if (inDeg + outDeg > bestDegree) {
      bestDegree = inDeg + outDeg;
      best = inter;
    }
  }
  return best;
}

// ── 找最近路口 ─────────────────────────────────────────────────────────────────
export function findNearestIntersection(worldX, worldZ, intersections, maxDist = 40) {
  let best = null, bestDist = Infinity;
  for (const inter of intersections) {
    const [ix, iy] = inter.pos;          // iy = y in 2D projection
    const dx = ix - worldX;
    const dz = (-iy) - worldZ;          // z = -y in Three.js
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < bestDist && d < maxDist) {
      bestDist = d;
      best = inter;
    }
  }
  return best;
}

// ── BFS 溯源：返回目标路口 1km 内所有路段及其 traceWeight ─────────────────────
export function traceFlows(targetInter, roads, topology, radiusUnits = 100) {
  const { adjIn, adjOut } = topology;
  const tid = targetInter.props.inter_id;
  const [tx, ty] = targetInter.pos;

  // 辅助：路段中心到目标路口的距离
  function roadDist(road) {
    const mid = road.coords[Math.floor(road.coords.length / 2)];
    const dx = mid[0] - tx;
    const dy = mid[1] - ty;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // 先收集所有在 radiusUnits 范围内的路段，标记方向（inbound/outbound）
  const inRange = new Map(); // road 对象 → {traceWeight, isInbound}

  // ── BFS：上游（inbound） ──────────────────────────────────────────────────
  const visited  = new Set([tid]);
  const queue    = [{ id: tid, depth: 0 }];
  const MAX_DEPTH = 12;

  while (queue.length > 0) {
    const { id, depth } = queue.shift();
    if (depth >= MAX_DEPTH) continue;

    for (const { road, fromId } of (adjIn.get(id) || [])) {
      if (roadDist(road) > radiusUnits) continue;

      const classW   = CLASS_WEIGHT[road.roadClass] ?? 0.2;
      const depthW   = Math.pow(0.78, depth);          // 随 BFS 深度衰减
      const traceW   = Math.min(1, classW + depthW * 0.6);

      const existing = inRange.get(road);
      if (!existing || existing.traceWeight < traceW) {
        inRange.set(road, { traceWeight: traceW, isInbound: true });
      }

      if (!visited.has(fromId)) {
        visited.add(fromId);
        queue.push({ id: fromId, depth: depth + 1 });
      }
    }
  }

  // ── BFS：下游（outbound，流出目标路口） ─────────────────────────────────────
  const visitedOut = new Set([tid]);
  const queueOut   = [{ id: tid, depth: 0 }];

  while (queueOut.length > 0) {
    const { id, depth } = queueOut.shift();
    if (depth >= MAX_DEPTH) continue;

    for (const { road, toId } of (adjOut.get(id) || [])) {
      if (roadDist(road) > radiusUnits) continue;

      const classW   = CLASS_WEIGHT[road.roadClass] ?? 0.2;
      const depthW   = Math.pow(0.65, depth);          // 出向衰减更快，视觉上更暗
      const traceW   = Math.min(0.6, classW * 0.5 + depthW * 0.35);

      const existing = inRange.get(road);
      if (!existing || existing.traceWeight < traceW) {
        inRange.set(road, { traceWeight: traceW, isInbound: false });
      }

      if (!visitedOut.has(toId)) {
        visitedOut.add(toId);
        queueOut.push({ id: toId, depth: depth + 1 });
      }
    }
  }

  // 没被 BFS 覆盖到的范围内路段（孤立路段）也显示为低权重
  for (const road of roads) {
    if (!inRange.has(road) && roadDist(road) <= radiusUnits) {
      inRange.set(road, { traceWeight: 0.08, isInbound: false });
    }
  }

  return inRange; // Map<road, {traceWeight, isInbound}>
}

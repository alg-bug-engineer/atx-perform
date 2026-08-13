// 各道路等级的基础流量权重
const CLASS_WEIGHT = {
  express:   10,
  arterial:  5,
  collector: 2,
  local:     0.8,
};

// 2km半径 = 200 THREE单位
const RADIUS_UNITS = 200;

function distToCenter([x, y]) {
  return Math.sqrt(x * x + y * y);
}

/**
 * 计算每条路段的车流权重（模拟溯源汇聚效果）
 * - 越靠近中心，流量越大（多条支路汇聚主干）
 * - 道路等级越高，基础流量越大
 * - 返回带 flow / inward 字段的增强路段数组
 */
export function computeFlows(roads) {
  return roads.map(road => {
    const baseWeight = CLASS_WEIGHT[road.roadClass] || 1;

    // 取路段中点距中心的距离
    const midIdx = Math.floor(road.coords.length / 2);
    const mid = road.coords[midIdx];
    const dist = distToCenter(mid);

    // 汇聚因子：越近中心越大，使用非线性衰减模拟多流合并
    const normDist = Math.max(0, 1 - dist / RADIUS_UNITS);
    const convergeFactor = 0.3 + 0.7 * Math.pow(normDist, 0.6);

    const flow = baseWeight * convergeFactor;

    // 判断路段方向是否朝向中心（用于粒子运动方向）
    const first = road.coords[0];
    const last = road.coords[road.coords.length - 1];
    const firstDist = distToCenter(first);
    const lastDist = distToCenter(last);
    const inward = lastDist <= firstDist; // true = 尾端更近中心

    return { ...road, flow, inward };
  });
}

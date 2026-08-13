/**
 * 有向路网拓扑（对齐 baseline geo/tracing.js）
 * adjIn[toId] = 流入边；adjOut[fromId] = 流出边
 */
export function buildTopology(roads) {
  const adjIn = new Map();
  const adjOut = new Map();

  for (const road of roads) {
    const { from_inter_id: fid, to_inter_id: tid } = road.props;
    if (!fid || !tid) continue;

    if (!adjIn.has(tid)) adjIn.set(tid, []);
    if (!adjOut.has(fid)) adjOut.set(fid, []);

    adjIn.get(tid).push({ road, fromId: fid });
    adjOut.get(fid).push({ road, toId: tid });
  }

  return { adjIn, adjOut };
}

/** 流入边末段航向：0=北、90=东、180=南、270=西 */
export function incomingHeadingDeg(coords) {
  if (!coords || coords.length < 2) return null;
  const a = coords[coords.length - 2];
  const b = coords[coords.length - 1];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return (((Math.atan2(dx, dy) * 180) / Math.PI) + 360) % 360;
}

/**
 * 航向 → 进口象限。车往南开进路口 = 北进口。
 * @returns {'N'|'E'|'S'|'W'|null}
 */
export function approachDirFromHeading(deg) {
  if (!Number.isFinite(deg)) return null;
  if (deg >= 315 || deg < 45) return 'S';
  if (deg >= 45 && deg < 135) return 'W';
  if (deg >= 135 && deg < 225) return 'N';
  return 'E';
}

export function incomingApproachDir(road) {
  return approachDirFromHeading(incomingHeadingDeg(road?.coords));
}

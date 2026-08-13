import * as THREE from 'three';

// 各等级路段的颜色与亮度（Bloom 会根据亮度决定辉光范围）
const CLASS_CONFIG = {
  express:   { color: 0xff7700, opacity: 1.0 },
  arterial:  { color: 0x00ddff, opacity: 0.9 },
  collector: { color: 0x0066bb, opacity: 0.65 },
  local:     { color: 0x003366, opacity: 0.45 },
};

const DEFAULT_CONFIG = { color: 0x002244, opacity: 0.3 };

/**
 * 按道路等级批量创建 LineSegments
 * 所有同等级路段合并为一个 DrawCall，性能最优
 */
export function createRoadMeshes(roads) {
  const group = new THREE.Group();
  group.name = 'roads';

  // 按等级分组
  const byClass = {};
  for (const road of roads) {
    const cls = road.roadClass;
    if (!byClass[cls]) byClass[cls] = [];
    byClass[cls].push(road);
  }

  for (const [cls, classRoads] of Object.entries(byClass)) {
    const cfg = CLASS_CONFIG[cls] || DEFAULT_CONFIG;
    const positions = [];

    for (const road of classRoads) {
      const pts = road.coords;
      for (let i = 0; i < pts.length - 1; i++) {
        // Three.js: x=东, y=高度, z=-北（右手坐标系）
        positions.push(pts[i][0],     0.15, -pts[i][1]);
        positions.push(pts[i + 1][0], 0.15, -pts[i + 1][1]);
      }
    }

    if (positions.length === 0) continue;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const mat = new THREE.LineBasicMaterial({
      color: cfg.color,
      transparent: true,
      opacity: cfg.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });

    const lines = new THREE.LineSegments(geo, mat);
    lines.name = `road_${cls}`;
    group.add(lines);
  }

  return group;
}

/**
 * 程序化白模建筑
 *
 * 策略：
 *  - 在路网点之间的"空白地块"上放置方形白模楼块
 *  - 楼块高度按距中心距离随机分布（中心高、外围低）
 *  - 使用 InstancedMesh 一次 DrawCall 渲染所有楼块，性能最优
 *  - 颜色：深蓝白色（R:0.55 G:0.65 B:0.85），与深夜科技感融合
 */

import * as THREE from 'three';

const RADIUS_UNITS   = 195;  // 与2km边界一致
const BUILDING_COLOR = new THREE.Color(0x3d5a7a); // 深蓝白

/**
 * @param {Array} roads  - computeFlows 返回的路段数组（含 coords）
 * @param {number} count - 目标楼块数量
 */
export function createBuildings(roads, count = 1800) {
  // ── 生成候选放置格点 ─────────────────────────────────────────────────────
  // 以路段顶点为"已占用"集合，在间隙区域撒点
  const occupied = new Set();
  const CELL = 12; // 栅格单元大小（THREE单位 = 120m）

  for (const road of roads) {
    for (const [x, y] of road.coords) {
      const gx = Math.round(x / CELL);
      const gy = Math.round(-y / CELL);
      // 道路周边 ±1 格标记为占用
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          occupied.add(`${gx + dx},${gy + dy}`);
        }
      }
    }
  }

  // ── 在空白格点放置楼块 ─────────────────────────────────────────────────
  const placements = [];
  const GRID_RANGE = Math.ceil(RADIUS_UNITS / CELL);

  for (let gx = -GRID_RANGE; gx <= GRID_RANGE; gx++) {
    for (let gy = -GRID_RANGE; gy <= GRID_RANGE; gy++) {
      const wx = gx * CELL;
      const wz = gy * CELL;
      const dist = Math.sqrt(wx * wx + wz * wz);
      if (dist > RADIUS_UNITS) continue;
      if (occupied.has(`${gx},${gy}`)) continue;

      // 在格点内随机偏移（避免网格感）
      const ox = (Math.random() - 0.5) * CELL * 0.7;
      const oz = (Math.random() - 0.5) * CELL * 0.7;
      placements.push({ x: wx + ox, z: wz + oz, dist });
    }
  }

  // ── 限制数量，随机挑选 ─────────────────────────────────────────────────
  // 先按距中心由近到远排序，优先保留中心区楼块
  placements.sort((a, b) => a.dist - b.dist);
  const selected = [];
  // 从全部格点中按概率抽取（中心密，外围稀）
  for (const p of placements) {
    const keepProb = 1 - (p.dist / RADIUS_UNITS) * 0.5;
    if (Math.random() < keepProb) selected.push(p);
    if (selected.length >= count) break;
  }

  // ── 构建 InstancedMesh ───────────────────────────────────────────────────
  const geo = new THREE.BoxGeometry(1, 1, 1); // 单位方块，用矩阵缩放
  const mat = new THREE.MeshBasicMaterial({
    color: BUILDING_COLOR,
    transparent: true,
    opacity: 0.55,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, selected.length);
  mesh.name = 'buildings';

  const dummy  = new THREE.Object3D();
  const color  = new THREE.Color();

  selected.forEach((p, i) => {
    // 高度：中心区高（最高20单位=200m），外围矮（最低2单位=20m）
    const normDist = p.dist / RADIUS_UNITS;
    const maxH = 20 * (1 - normDist * 0.75) + 2;
    const h    = Math.random() * maxH + 2;

    // 宽度：3~8 单位（30~80m）
    const w = 3 + Math.random() * 5;
    const d = 3 + Math.random() * 5;

    dummy.position.set(p.x, h / 2, p.z);
    dummy.scale.set(w, h, d);
    dummy.rotation.y = Math.random() * Math.PI * 0.1; // 轻微随机旋转
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    // 颜色：中心区略亮
    const bright = 0.45 + 0.35 * (1 - normDist);
    color.setRGB(bright * 0.6, bright * 0.75, bright);
    mesh.setColorAt(i, color);
  });

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  return mesh;
}

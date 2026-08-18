/**
 * 贴地扁平路况色带（高德式地图语言）：
 * 平面三角条带沿曲线铺展，无圆截面、无圆头球帽，宽度克制并沿队尾轻微收细，
 * 读作「路面本身被染色」而非悬浮香肠。
 */
import * as THREE from 'three';

/**
 * @param {THREE.Curve} curve 世界坐标曲线（XZ 平面为主）
 * @param {object} opts
 * @param {number} [opts.halfWidth] 主带半宽（世界单位）
 * @param {number} [opts.casing] 描边外廓每侧加宽
 * @param {number} [opts.color] 主带色
 * @param {number} [opts.casingColor] 描边色
 * @param {number} [opts.y] 贴地高度
 * @param {number} [opts.segments] 采样段数
 * @param {number} [opts.taper] 末端宽度比例（0.7~1，形成方向楔形）
 * @param {number} [opts.opacity] 主带不透明度
 */
export function buildFlatBand(curve, {
  halfWidth = 1.3,
  casing = 0.35,
  color = 0xd0021b,
  casingColor = 0x5c0008,
  y = 0.9,
  segments = 96,
  taper = 0.8,
  opacity = 0.94,
} = {}) {
  const group = new THREE.Group();

  const pts = curve.getSpacedPoints(segments);
  const frames = curve.computeFrenetFrames(segments, false);

  /** 平面条带：逐点沿水平法线左右偏移 hw(u)，u 方向线性收细 */
  function strip(hwStart, hwEnd, yy, mat, order) {
    const pos = [];
    const idx = [];
    for (let i = 0; i <= segments; i += 1) {
      const u = i / segments;
      const p = pts[i];
      const t = frames.tangents[i];
      // 水平法线（XZ 平面内垂直于切线）
      let nx = -t.z;
      let nz = t.x;
      const len = Math.hypot(nx, nz) || 1;
      nx /= len;
      nz /= len;
      const hw = hwStart + (hwEnd - hwStart) * u;
      pos.push(p.x + nx * hw, yy, p.z + nz * hw);
      pos.push(p.x - nx * hw, yy, p.z - nz * hw);
      if (i < segments) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = order;
    group.add(mesh);
    return mesh;
  }

  const casingMat = new THREE.MeshBasicMaterial({
    color: casingColor,
    transparent: true,
    opacity: Math.min(1, opacity + 0.02),
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mainMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // 描边垫底（略低），主带覆上；末端收细形成方向楔形
  strip(halfWidth + casing, halfWidth * taper + casing, y - 0.06, casingMat, 28);
  strip(halfWidth, halfWidth * taper, y, mainMat, 29);

  return { group, casingMat, mainMat };
}

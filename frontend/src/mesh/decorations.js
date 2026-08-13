import * as THREE from 'three';

/**
 * 场景装饰物
 * - 深色地面
 * - 暗色网格
 * - 信号灯路口节点
 */
export function createDecorations(intersections) {
  const group = new THREE.Group();
  group.name = 'decorations';

  // 地面和网格由高德地图底层提供，此处不再创建（避免 z-fighting）

  // ── 信号灯路口节点 ─────────────────────────────────────────
  const signalInters = intersections.filter(i => i.props.is_signlight);
  if (signalInters.length > 0) {
    const nodePos = new Float32Array(signalInters.length * 3);
    const nodeCol = new Float32Array(signalInters.length * 3);
    signalInters.forEach((inter, i) => {
      nodePos[i * 3]     = inter.pos[0];
      nodePos[i * 3 + 1] = 0.6;
      nodePos[i * 3 + 2] = -inter.pos[1];
      nodeCol[i * 3]     = 0.7;
      nodeCol[i * 3 + 1] = 1.0;
      nodeCol[i * 3 + 2] = 0.1;
    });
    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(nodePos, 3));
    nodeGeo.setAttribute('color',    new THREE.BufferAttribute(nodeCol, 3));
    const nodeMat = new THREE.PointsMaterial({
      size: 2.5,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      sizeAttenuation: true,
    });
    group.add(new THREE.Points(nodeGeo, nodeMat));
  }

  // ── 每帧动画 ──────────────────────────────────────────────
  group.update = () => {};

  return group;
}

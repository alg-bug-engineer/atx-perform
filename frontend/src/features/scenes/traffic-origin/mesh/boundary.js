import * as THREE from 'three';

const RADIUS = 200; // 2km = 200 THREE单位

/**
 * 区域边界效果
 * - 主发光环（脉冲动画）
 * - 内侧装饰环
 * - 旋转扫描扇形（雷达效果）
 * - 圆周粒子点
 * - 1km同心辅助环
 */
export function createBoundary() {
  const group = new THREE.Group();
  group.name = 'boundary';

  // ── 主发光环 ────────────────────────────────────────────────
  const ringGeo = new THREE.RingGeometry(RADIUS - 1.2, RADIUS + 1.2, 256);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.2;
  group.add(ring);

  // 外侧加粗辉光环（略宽，亮度低，配合 Bloom 扩散）
  const outerRingGeo = new THREE.RingGeometry(RADIUS - 3, RADIUS + 3, 256);
  const outerRingMat = new THREE.MeshBasicMaterial({
    color: 0x004466,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
  });
  const outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);
  outerRing.rotation.x = -Math.PI / 2;
  outerRing.position.y = 0.18;
  group.add(outerRing);

  // 内侧装饰环
  const innerRingGeo = new THREE.RingGeometry(RADIUS - 6, RADIUS - 5, 256);
  const innerRingMat = new THREE.MeshBasicMaterial({
    color: 0x006688,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
  });
  const innerRing = new THREE.Mesh(innerRingGeo, innerRingMat);
  innerRing.rotation.x = -Math.PI / 2;
  innerRing.position.y = 0.15;
  group.add(innerRing);

  // ── 同心辅助环 (1km) ──────────────────────────────────────
  const midRingGeo = new THREE.RingGeometry(RADIUS * 0.5 - 0.4, RADIUS * 0.5 + 0.4, 256);
  const midRingMat = new THREE.MeshBasicMaterial({
    color: 0x003344,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
  });
  const midRing = new THREE.Mesh(midRingGeo, midRingMat);
  midRing.rotation.x = -Math.PI / 2;
  midRing.position.y = 0.1;
  group.add(midRing);

  // ── 旋转扫描扇形 ──────────────────────────────────────────
  const SCAN_ANGLE = Math.PI / 5; // 36°
  const scanGeo = new THREE.CircleGeometry(RADIUS, 128, 0, SCAN_ANGLE);

  // 顶点颜色渐变：中心暗 → 边缘亮
  const scanVertexCount = scanGeo.attributes.position.count;
  const scanColors = new Float32Array(scanVertexCount * 3);
  const scanPos = scanGeo.attributes.position.array;
  for (let i = 0; i < scanVertexCount; i++) {
    const x = scanPos[i * 3];
    const y = scanPos[i * 3 + 1];
    const dist = Math.sqrt(x * x + y * y) / RADIUS;
    scanColors[i * 3]     = 0;
    scanColors[i * 3 + 1] = dist * 0.9;
    scanColors[i * 3 + 2] = dist * 0.7;
  }
  scanGeo.setAttribute('color', new THREE.BufferAttribute(scanColors, 3));

  const scanMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.13,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
  });
  const scanMesh = new THREE.Mesh(scanGeo, scanMat);
  scanMesh.rotation.x = -Math.PI / 2;
  scanMesh.position.y = 0.3;
  group.add(scanMesh);

  // ── 圆周粒子点 ────────────────────────────────────────────
  const DOT_COUNT = 180;
  const dotPos = new Float32Array(DOT_COUNT * 3);
  const dotCol = new Float32Array(DOT_COUNT * 3);

  for (let i = 0; i < DOT_COUNT; i++) {
    const angle = (i / DOT_COUNT) * Math.PI * 2;
    // 稀疏随机分布在主环附近
    const r = RADIUS + (Math.random() - 0.5) * 4;
    dotPos[i * 3]     = Math.cos(angle) * r;
    dotPos[i * 3 + 1] = 0.5 + Math.random() * 0.5;
    dotPos[i * 3 + 2] = Math.sin(angle) * r;
    const bright = 0.6 + Math.random() * 0.4;
    dotCol[i * 3]     = 0;
    dotCol[i * 3 + 1] = bright;
    dotCol[i * 3 + 2] = bright;
  }
  const dotGeo = new THREE.BufferGeometry();
  dotGeo.setAttribute('position', new THREE.BufferAttribute(dotPos, 3));
  dotGeo.setAttribute('color',    new THREE.BufferAttribute(dotCol, 3));
  const dotMat = new THREE.PointsMaterial({
    size: 2.5,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    sizeAttenuation: true,
  });
  group.add(new THREE.Points(dotGeo, dotMat));

  // ── 每帧更新动画 ──────────────────────────────────────────
  group.update = (time) => {
    // 扫描旋转
    scanMesh.rotation.z = -time * 0.55;
    // 主环脉冲
    const pulse = 0.5 + 0.5 * Math.sin(time * 2.2);
    ringMat.opacity = 0.45 + 0.45 * pulse;
    outerRingMat.opacity = 0.2 + 0.25 * pulse;
  };

  return group;
}

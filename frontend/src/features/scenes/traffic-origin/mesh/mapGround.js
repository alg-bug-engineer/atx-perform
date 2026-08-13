/**
 * 地图地面
 *
 * 以瓦片拼接的高德卫星图作为 Three.js 地面平面纹理。
 * 纹理 UV 已精确对准世界坐标原点（济南市中心）。
 */

import * as THREE from 'three';
import { createMapTexture } from '../utils/tiles.js';

const CENTER_LON = 117.096;
const CENTER_LAT = 36.662;

export async function createMapGround() {
  const { texture, planeSize } = await createMapTexture(CENTER_LON, CENTER_LAT);

  // 足够大的平面，覆盖整个可见区域
  const geo = new THREE.PlaneGeometry(planeSize, planeSize, 1, 1);
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    depthWrite: true,
    // polygonOffset：将地图平面推入深度缓冲，让上方路网始终覆盖其上，消除 Z-fighting
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.4;  // 明确低于路网（y≥0）和粒子，不重叠
  mesh.renderOrder = -1;   // 优先渲染，其他透明物覆盖其上
  mesh.name = 'mapGround';

  return mesh;
}

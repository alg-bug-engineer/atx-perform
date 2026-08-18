/**
 * 问题路段拥堵展示 —— 高德路况风格：
 * 贴地扁平实色带（严重拥堵深红 #d0021b）+ 深色描边外廓 + 末端楔形收细。
 * 无圆截面/无圆头球帽/无光晕/无闪烁，读作「路面被染色」。
 */
import * as THREE from 'three';
import { project } from '../geo/loader.js';
import { buildFlatBand } from './flatBand.js';

/** 严重拥堵深红（与幕 1 路况色板 state 4 一致） */
const SEVERE_RED = 0xd0021b;
/** 描边外廓：同色系更深一档，模拟高德色带 casing */
const CASING_RED = 0x5c0008;

function pathToCurve(path, y = 1.35) {
  if (!Array.isArray(path) || path.length < 2) return null;
  const pts = path.map(([lon, lat]) => {
    const [x, ny] = project(lon, lat);
    return new THREE.Vector3(x, y, -ny);
  });
  return new THREE.CatmullRomCurve3(pts, false, 'chordal', 0.05);
}

function emptyBounds() {
  return { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
}

function expandBounds(bounds, x, z) {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.minZ = Math.min(bounds.minZ, z);
  bounds.maxZ = Math.max(bounds.maxZ, z);
}

/**
 * @param {{ coordinates: number[][] }} geom GeoJSON LineString
 */
export function createProblemLinkAlert(geom) {
  const group = new THREE.Group();
  group.name = 'problemLinkAlert';
  group.visible = false;

  const path = geom?.coordinates;
  const curve = pathToCurve(path, 1.35);
  const bounds = emptyBounds();
  const worldCenter = new THREE.Vector3();

  if (!curve || !path?.length) {
    return {
      group,
      bounds,
      worldCenter,
      show() {},
      hide() {
        group.visible = false;
      },
      update() {},
      dispose() {},
    };
  }

  for (const [lon, lat] of path) {
    const [x, y] = project(lon, lat);
    expandBounds(bounds, x, -y);
  }
  worldCenter.set(
    (bounds.minX + bounds.maxX) / 2,
    0,
    (bounds.minZ + bounds.maxZ) / 2,
  );

  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  const span = Math.max(spanX, spanZ, 1);
  const slim = span < 90;
  // 宽度克制：贴近底图路幅感知，短路段更窄；末端收细成方向楔形
  const band = buildFlatBand(curve, {
    halfWidth: slim ? 1.2 : 1.8,
    casing: 0.35,
    color: SEVERE_RED,
    casingColor: CASING_RED,
    y: 0.9,
    taper: 0.78,
  });
  group.add(band.group);

  return {
    group,
    bounds,
    worldCenter,
    show() {
      group.visible = true;
    },
    hide() {
      group.visible = false;
    },
    // 高德风格为静态渲染，无需逐帧动画
    update() {},
    dispose() {
      group.traverse((obj) => {
        obj.geometry?.dispose?.();
        obj.material?.dispose?.();
      });
    },
  };
}

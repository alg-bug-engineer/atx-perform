/**
 * 地图瓦片工具
 *
 * 坐标系：高德卫星瓦片使用 GCJ-02（火星坐标），与路网 GeoJSON 一致
 * 投影：Web Mercator（EPSG:3857），标准 XYZ 瓦片方案
 *
 * 实现步骤：
 *  1. 将中心经纬度转换为瓦片坐标（含小数）
 *  2. 下载 TILES_ACROSS×TILES_ACROSS 的瓦片方阵
 *  3. 拼接到 canvas，叠加深色调
 *  4. 返回 THREE.CanvasTexture + 平面物理尺寸
 */

import * as THREE from 'three';

const ZOOM        = 15;      // 缩放级别：1张瓦片 ≈ 979m×979m（lat 36.66°）
const TILE_PX     = 256;     // 高德标准瓦片像素尺寸
const TILES_ACROSS = 9;      // 瓦片方阵边长（9×9，覆盖约 8.8km）
const HALF_N      = Math.floor(TILES_ACROSS / 2); // = 4

// ── 坐标转换 ────────────────────────────────────────────────────────────────

function lon2tileF(lon) {
  return (lon + 180) / 360 * Math.pow(2, ZOOM);
}

function lat2tileF(lat) {
  const latRad = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * Math.pow(2, ZOOM);
}

/** 计算在给定纬度下，一个瓦片对应的 THREE.js 世界单位数（1单位=10m）*/
function tileWorldUnits(lat) {
  const EARTH_CIRC = 40075017; // 地球赤道周长（米）
  const meters = EARTH_CIRC / Math.pow(2, ZOOM) * Math.cos(lat * Math.PI / 180);
  return meters / 10; // ÷10 转为世界单位
}

// ── 单张瓦片加载 ─────────────────────────────────────────────────────────────

function loadTile(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => resolve(null); // 失败时忽略，保持背景色
    img.src = url;
  });
}

// ── 主入口：异步创建地图纹理 ─────────────────────────────────────────────────

/**
 * @param {number} centerLon - 中心经度（GCJ-02）
 * @param {number} centerLat - 中心纬度（GCJ-02）
 * @returns {{ texture: THREE.CanvasTexture, planeSize: number }}
 *   planeSize：地面平面边长（THREE.js 世界单位，正方形）
 */
export async function createMapTexture(centerLon, centerLat) {
  // ── 计算中心瓦片坐标 ────────────────────────────────────────────────────
  const cx_f = lon2tileF(centerLon);
  const cy_f = lat2tileF(centerLat);
  const cx_i = Math.floor(cx_f);
  const cy_i = Math.floor(cy_f);
  const frac_x = cx_f - cx_i; // 在中心瓦片内的横向分数
  const frac_y = cy_f - cy_i; // 在中心瓦片内的纵向分数

  const canvasW = TILES_ACROSS * TILE_PX;
  const canvasH = TILES_ACROSS * TILE_PX;

  // ── 创建画布 ─────────────────────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.width  = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');

  // 深色底图（瓦片加载失败时展示）
  ctx.fillStyle = '#08101e';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // ── 并行下载所有瓦片 ──────────────────────────────────────────────────
  const tasks = [];
  for (let dy = -HALF_N; dy <= HALF_N; dy++) {
    for (let dx = -HALF_N; dx <= HALF_N; dx++) {
      const tx   = cx_i + dx;
      const ty   = cy_i + dy;
      const imgX = (dx + HALF_N) * TILE_PX;
      const imgY = (dy + HALF_N) * TILE_PX;

      // 优先高德卫星，失败则用 CARTO Dark（公共 CORS）作为兜底
      const amapUrl  = `/amap-sat?style=6&x=${tx}&y=${ty}&z=${ZOOM}`;
      const cartoUrl = `https://a.basemaps.cartocdn.com/dark_all/${ZOOM}/${tx}/${ty}.png`;

      tasks.push(
        loadTile(amapUrl).then(img => {
          if (img) return img;
          return loadTile(cartoUrl); // 高德失败 → CARTO
        }).then(img => {
          if (img) ctx.drawImage(img, imgX, imgY, TILE_PX, TILE_PX);
        })
      );
    }
  }
  await Promise.all(tasks);

  // ── 深色科技感叠加层 ──────────────────────────────────────────────────
  // 压暗并偏蓝，与整体深蓝夜景 UI 融合
  ctx.fillStyle = 'rgba(2, 8, 22, 0.58)';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // ── 构建纹理 ─────────────────────────────────────────────────────────────
  const texture = new THREE.CanvasTexture(canvas);
  // flipY=true（默认）：UV v=1 → canvas 顶部 → 地理北方，与世界坐标一致

  // 计算 UV offset 使 UV(0.5, 0.5) 精确对准世界中心 (0,0)
  // UV(u,v) 采样 canvas 像素 = (u·W, (1-v)·H)
  // 世界中心在 canvas 中的位置：
  const px_center = (HALF_N + frac_x) * TILE_PX;
  const py_center = (HALF_N + frac_y) * TILE_PX;
  const u_center  = px_center / canvasW;           // 0~1 内的横向比
  const v_center  = py_center / canvasH;           // 0~1 内的纵向比（从顶部算）
  // flipY 后：UV v=0.5 → canvas y = (1-0.5)·H = H/2，但我们要采样 py_center
  // → offset.y = 0.5 - v_center
  texture.offset.x = u_center - 0.5;
  texture.offset.y = 0.5 - v_center;

  const planeSize = TILES_ACROSS * tileWorldUnits(centerLat);

  return { texture, planeSize };
}

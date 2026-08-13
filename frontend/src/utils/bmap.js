/**
 * 百度地图 GL（BMapGL）SDK 加载器
 *
 * BMapGL 2.0 使用 WebGL2，与 Three.js 0.162 兼容良好。
 * 官方文档：https://lbsyun.baidu.com/index.php?title=jspopularGL
 *
 * 使用方式：
 *   const BMapGL = await loadBMapGL('你的AK');
 *   const map = new BMapGL.Map('container');
 */

let _loadPromise = null;

export function loadBMapGL(ak) {
  if (_loadPromise) return _loadPromise;

  _loadPromise = new Promise((resolve, reject) => {
    // BMapGL 通过 callback query param 通知加载完成
    const cbName = `_bmapgl_cb_${Date.now()}`;
    window[cbName] = () => {
      delete window[cbName];
      if (window.BMapGL) resolve(window.BMapGL);
      else reject(new Error('BMapGL 加载完成但 window.BMapGL 未定义'));
    };

    const script = document.createElement('script');
    script.charset = 'utf-8';
    // type=webgl → BMapGL GL 版（支持 3D/WebGL2）
    script.src = `https://api.map.baidu.com/api?type=webgl&v=1.0&ak=${ak}&callback=${cbName}`;
    script.onerror = () => reject(new Error('BMapGL SDK 加载失败，请检查 AK 是否正确及域名白名单'));
    document.head.appendChild(script);
  });

  return _loadPromise;
}

// ── 坐标系转换工具 ────────────────────────────────────────────────────────────
// 百度地图使用 BD-09 坐标系，GeoJSON 路网数据为 WGS-84
// 需要两步转换：WGS-84 → GCJ-02 → BD-09

const PI = Math.PI;
const X_PI = PI * 3000.0 / 180.0;
const A = 6378245.0;
const EE = 0.00669342162296594323;

function _outOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}
function _transformLat(x, y) {
  let ret = -100.0 + 2.0*x + 3.0*y + 0.2*y*y + 0.1*x*y + 0.2*Math.sqrt(Math.abs(x));
  ret += (20.0*Math.sin(6.0*x*PI) + 20.0*Math.sin(2.0*x*PI)) * 2.0/3.0;
  ret += (20.0*Math.sin(y*PI) + 40.0*Math.sin(y/3.0*PI)) * 2.0/3.0;
  ret += (160.0*Math.sin(y/12.0*PI) + 320*Math.sin(y*PI/30.0)) * 2.0/3.0;
  return ret;
}
function _transformLng(x, y) {
  let ret = 300.0 + x + 2.0*y + 0.1*x*x + 0.1*x*y + 0.1*Math.sqrt(Math.abs(x));
  ret += (20.0*Math.sin(6.0*x*PI) + 20.0*Math.sin(2.0*x*PI)) * 2.0/3.0;
  ret += (20.0*Math.sin(x*PI) + 40.0*Math.sin(x/3.0*PI)) * 2.0/3.0;
  ret += (150.0*Math.sin(x/12.0*PI) + 300.0*Math.sin(x/30.0*PI)) * 2.0/3.0;
  return ret;
}

/** WGS-84 → GCJ-02（火星坐标系）*/
export function wgs84ToGcj02(lng, lat) {
  if (_outOfChina(lng, lat)) return [lng, lat];
  let dLat = _transformLat(lng - 105.0, lat - 35.0);
  let dLng = _transformLng(lng - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
  dLng = (dLng * 180.0) / (A / sqrtMagic * Math.cos(radLat) * PI);
  return [lng + dLng, lat + dLat];
}

/** GCJ-02 → BD-09（百度坐标系）*/
export function gcj02ToBd09(lng, lat) {
  const z     = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin(lat * X_PI);
  const theta = Math.atan2(lat, lng) + 0.000003 * Math.cos(lng * X_PI);
  return [z * Math.cos(theta) + 0.0065, z * Math.sin(theta) + 0.006];
}

/** WGS-84 → BD-09（一步到位）*/
export function wgs84ToBd09(lng, lat) {
  const [gLng, gLat] = wgs84ToGcj02(lng, lat);
  return gcj02ToBd09(gLng, gLat);
}

/** BD-09 → GCJ-02（解析反算）*/
export function bd09ToGcj02(bdLng, bdLat) {
  const z     = Math.sqrt(bdLng * bdLng + bdLat * bdLat) - 0.00002 * Math.sin(bdLat * X_PI);
  const theta = Math.atan2(bdLat, bdLng) - 0.000003 * Math.cos(bdLng * X_PI);
  return [z * Math.cos(theta), z * Math.sin(theta)];
}

/** GCJ-02 → WGS-84（迭代近似，3 轮误差 < 0.3m）*/
export function gcj02ToWgs84(gcjLng, gcjLat) {
  if (_outOfChina(gcjLng, gcjLat)) return [gcjLng, gcjLat];
  // 直接用"倒推法"：wgs84 ≈ gcj02 × 2 − wgs84ToGcj02(gcj02)
  const [b0, b1] = wgs84ToGcj02(gcjLng, gcjLat);
  return [gcjLng * 2 - b0, gcjLat * 2 - b1];
}

/** BD-09 → WGS-84（一步到位）*/
export function bd09ToWgs84(bdLng, bdLat) {
  const [gLng, gLat] = bd09ToGcj02(bdLng, bdLat);
  return gcj02ToWgs84(gLng, gLat);
}

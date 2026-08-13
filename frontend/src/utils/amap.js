/**
 * 高德地图 SDK 加载器（纯 script 标签方式，避免 npm 包引入 SES 导致的栈溢出）
 *
 * 使用步骤：
 *  1. 在 https://console.amap.com/ 申请 API Key（Web端JS API）
 *  2. 将 key 和安全密钥填入 ThreeMap.vue 顶部的常量
 */

let _loadPromise = null;

export function loadAMap(key, secCode) {
  if (_loadPromise) return _loadPromise; // 避免重复加载

  _loadPromise = new Promise((resolve, reject) => {
    // 安全密钥（2021年之后必须设置）
    if (secCode) {
      window._AMapSecurityConfig = { securityJsCode: secCode };
    }

    const script = document.createElement('script');
    script.charset = 'utf-8';
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${key}&plugin=AMap.Buildings,AMap.Scale`;
    script.onload  = () => resolve(window.AMap);
    script.onerror = () => reject(new Error('高德地图 SDK 加载失败，请检查 API Key 是否正确'));
    document.head.appendChild(script);
  });

  return _loadPromise;
}

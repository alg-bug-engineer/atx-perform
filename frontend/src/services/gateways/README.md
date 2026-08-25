# 前端数据网关

页面和 Three.js 特效不得自行拼接 `/api/v1` URL。业务数据统一经本目录加载，
再注入幕组件；静态底图、GeoJSON、WAV 可继续由 `public/` 或 CDN 提供。

前三幕 loader：

- `scene0-opening/index.js#loadScene0Data`
- `scene1-problem-locate/index.js#loadScene1Data`
- `scene2-cause-analysis/index.js#loadScene2Data`

接线顺序必须是：

1. Scene 组件预加载数据；
2. hydrate fixture / 将 datasets 传给地图工厂；
3. 挂载地图；
4. 地图发出 `ready`；
5. 再挂载 Act Stage，避免首拍丢失。

`VITE_SCENE_API=0` 保持当前静态演示，`VITE_SCENE_API=1` 走 FastAPI。
Live 模式失败必须显式报错，不得静默回退本地 fixture。

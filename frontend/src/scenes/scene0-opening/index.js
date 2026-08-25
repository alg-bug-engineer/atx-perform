import { isSceneApiEnabled, loadSceneFromApi } from '../../services/gateways/sceneDataGateway.js'
import { loadSceneBundle } from '../../services/loadSceneData.js'

export const SCENE_META = {
  key: '0',
  name: '主动巡检',
  /** 3D 运行时读取：城市监控叠加 + 问题路段几何 */
  dataFiles: ['1-scene-objects.json', 'public/data/city-monitor-demo.json'],
}

/** 幕 0 业务数据。VITE_SCENE_API=1 时走 GET /api/v1/scenes/0。 */
export async function loadScene0Data() {
  if (isSceneApiEnabled()) return loadSceneFromApi('0')
  return loadSceneBundle(['objects', 'opening'])
}

import { isSceneApiEnabled, loadSceneFromApi } from '../../services/gateways/sceneDataGateway.js'
import { loadSceneBundle } from '../../services/loadSceneData.js'

export const SCENE_META = {
  key: '2',
  name: '分析成因',
  dataFiles: ['1-scene-objects.json', '1-2-cause-analysis.json', '1-2-flow-trace.json'],
}

/** 幕 2 业务数据。VITE_SCENE_API=1 时走 GET /api/v1/scenes/2。 */
export async function loadScene2Data() {
  if (isSceneApiEnabled()) return loadSceneFromApi('2')
  return loadSceneBundle(['objects', 'cause', 'flowTrace'])
}

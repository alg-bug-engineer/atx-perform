import { isSceneApiEnabled, loadSceneFromApi } from '../../services/gateways/sceneDataGateway.js'
import { loadSceneBundle } from '../../services/loadSceneData.js'

export const SCENE_META = {
  key: '1',
  name: '问题定位',
  dataFiles: ['1-1-problem-locate.json', '1-1-channelization.json', '1-scene-objects.json'],
}

/** 幕 1 业务数据。VITE_SCENE_API=1 时走 GET /api/v1/scenes/1。 */
export async function loadScene1Data() {
  if (isSceneApiEnabled()) return loadSceneFromApi('1')
  return loadSceneBundle(['objects', 'locate', 'channelization'])
}

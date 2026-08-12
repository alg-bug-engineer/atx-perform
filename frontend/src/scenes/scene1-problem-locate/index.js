import { loadSceneBundle } from '../../services/loadSceneData.js'

export const SCENE_META = {
  key: '1',
  name: '问题定位',
  dataFiles: ['1-1-problem-locate.json', '1-1-channelization.json', '1-scene-objects.json'],
}

export async function loadScene1Data() {
  return loadSceneBundle(['locate', 'channelization', 'objects'])
}

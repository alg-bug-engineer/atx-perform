import { loadSceneBundle } from '../../services/loadSceneData.js'

export const SCENE_META = {
  key: '0',
  name: '开幕',
  dataFiles: ['1-0-opening.json', '1-scene-objects.json', '1-1-problem-locate.json'],
}

export async function loadScene0Data() {
  return loadSceneBundle(['opening', 'objects', 'locate'])
}

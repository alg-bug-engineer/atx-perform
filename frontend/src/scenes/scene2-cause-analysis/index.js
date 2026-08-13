import { loadSceneBundle } from '../../services/loadSceneData.js'

export const SCENE_META = {
  key: '2',
  name: '分析成因',
  dataFiles: ['1-2-cause-analysis.json'],
}

export async function loadScene2Data() {
  return loadSceneBundle(['cause'])
}

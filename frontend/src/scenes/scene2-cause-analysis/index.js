import { loadSceneBundle } from '../../services/loadSceneData.js'

export const SCENE_META = {
  key: '2',
  name: '分析成因',
  dataFiles: [
    '1-2-cause-analysis.json',
    '1-2-flow-trace.json',
    '1-scene-objects.json',
    '1-1-problem-locate.json',
  ],
}

export async function loadScene2Data() {
  return loadSceneBundle(['cause', 'flowTrace', 'objects', 'locate'])
}

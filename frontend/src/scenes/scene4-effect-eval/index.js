import { loadSceneBundle } from '../../services/loadSceneData.js'

export const SCENE_META = {
  key: '4',
  name: '效果预评估',
  dataFiles: ['1-4-effect-eval.json', '1-3-optimization.json'],
  implRef: '大屏记分牌：结论横幅 + 蓄车占用主视觉 + 单周期机理复核 + 治理画像雷达 + 回滚护栏半环',
}

export async function loadScene4Data() {
  return loadSceneBundle(['effect', 'optimization'])
}

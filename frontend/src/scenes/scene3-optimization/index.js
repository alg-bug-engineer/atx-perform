import { loadSceneBundle } from '../../services/loadSceneData.js'

export const SCENE_META = {
  key: '3',
  name: '优化方案',
  dataFiles: ['1-3-optimization.json', '1-3-signal-plan.json'],
  implRef: '专家时距图沿用幕 3b 引擎原图；相位相序用 signal_plan_board；效果指标见幕 4',
}

export async function loadScene3Data() {
  return loadSceneBundle(['optimization', 'signalPlan'])
}

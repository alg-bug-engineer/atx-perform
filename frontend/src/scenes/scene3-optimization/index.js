import { loadSceneBundle } from '../../services/loadSceneData.js'

export const SCENE_META = {
  key: '3',
  name: '优化方案',
  dataFiles: ['1-3-optimization.json'],
  implRef: '走廊渠化两栏对比（优化前溢出 / 相位协调后不溢出）+ 信控方案调节看板；效果指标见幕 4',
}

export async function loadScene3Data() {
  return loadSceneBundle(['optimization'])
}

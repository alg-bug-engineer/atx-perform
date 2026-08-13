import { loadSceneBundle } from '../../services/loadSceneData.js'

export const SCENE_META = {
  key: '3b',
  name: '信控方案调节',
  dataFiles: ['1-3-signal-plan.json'],
  implRef: '干线协调方案：公共周期 / 相位差 / 阶段配时前后对比 + 绿波时距图，数据来自信控专家智能体',
}

export async function loadScene3bData() {
  return loadSceneBundle(['signalPlan'])
}

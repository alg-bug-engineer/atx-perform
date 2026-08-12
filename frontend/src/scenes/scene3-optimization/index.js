import { loadSceneBundle } from '../../services/loadSceneData.js'

export const SCENE_META = {
  key: '3',
  name: '优化方案',
  dataFiles: ['1-3-optimization.json'],
  implRef:
    'agent-loop main → src/features/acts/act-08/ (PlanPanel, planVisualization, Act8Stage)；配色用本项目 theme',
}

export async function loadScene3Data() {
  return loadSceneBundle(['optimization'])
}

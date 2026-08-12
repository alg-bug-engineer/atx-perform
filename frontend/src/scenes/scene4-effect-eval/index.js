import { loadSceneBundle } from '../../services/loadSceneData.js'

export const SCENE_META = {
  key: '4',
  name: '效果评估',
  dataFiles: ['1-4-effect-eval.json'],
  implRef:
    'agent-loop → TrialEffectPanel / TrialEffectCharts / trialEffectSeries（配色 baseline）',
}

export async function loadScene4Data() {
  return loadSceneBundle(['effect'])
}

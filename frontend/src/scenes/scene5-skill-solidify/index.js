import { loadSceneBundle } from '../../services/loadSceneData.js'

export const SCENE_META = {
  key: '5',
  name: '技能固化',
  dataFiles: ['1-5-skill-solidify.json'],
  implRef:
    'Overlay / ExperienceAbsorption / SkillBuildDrawer；落盘 data/skills',
}

export async function loadScene5Data() {
  return loadSceneBundle(['skill'])
}

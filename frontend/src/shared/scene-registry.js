/**
 * 分幕注册表：一幕一个模块。
 * name 为对外展示文案，禁止写入开发/对齐类说明。
 */
export const sceneRegistry = [
  {
    key: '0',
    aliases: ['opening'],
    name: '主动巡检',
    component: () => import('../scenes/scene0-opening/Scene0Opening.vue'),
  },
  {
    key: '1',
    aliases: ['locate', 'problem'],
    name: '问题定位',
    component: () => import('../scenes/scene1-problem-locate/Scene1ProblemLocate.vue'),
  },
  {
    key: '2',
    aliases: ['cause', 'trace'],
    name: '分析成因',
    component: () => import('../scenes/scene2-cause-analysis/Scene2CauseAnalysis.vue'),
  },
  {
    key: '3',
    aliases: ['plan', 'optimization', 'signal', 'timing', '3b'],
    name: '优化方案',
    component: () => import('../scenes/scene3-optimization/Scene3Optimization.vue'),
  },
  {
    key: '4',
    aliases: ['effect', 'eval'],
    name: '效果预评估',
    component: () => import('../scenes/scene4-effect-eval/Scene4EffectEval.vue'),
  },
  {
    key: '5',
    aliases: ['skill', 'solidify'],
    name: '技能固化',
    component: () => import('../scenes/scene5-skill-solidify/Scene5SkillSolidify.vue'),
  },
]

export function resolveSceneKey(raw) {
  if (raw == null || raw === '') return null
  const token = String(raw).trim().toLowerCase()
  for (const scene of sceneRegistry) {
    if (scene.key === token) return scene.key
    if (scene.aliases?.includes(token)) return scene.key
  }
  return null
}

export function getSceneByKey(key) {
  return sceneRegistry.find((s) => s.key === key) || sceneRegistry[0]
}

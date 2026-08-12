/**
 * 分幕注册表：一幕一个模块，可独立调试。
 * key 同时支持数字序号与别名。
 */
export const sceneRegistry = [
  {
    key: '0',
    aliases: ['opening'],
    name: '开幕',
    ownerHint: '地图扫描 / 问题路段闪烁',
    component: () => import('../scenes/scene0-opening/Scene0Opening.vue'),
  },
  {
    key: '1',
    aliases: ['locate', 'problem'],
    name: '问题定位',
    ownerHint: '双渠化 + 指标卡 + 路况色',
    component: () => import('../scenes/scene1-problem-locate/Scene1ProblemLocate.vue'),
  },
  {
    key: '2',
    aliases: ['cause', 'trace'],
    name: '分析成因',
    ownerHint: '上/下游份额溯源 + 供需',
    component: () => import('../scenes/scene2-cause-analysis/Scene2CauseAnalysis.vue'),
  },
  {
    key: '3',
    aliases: ['plan', 'optimization'],
    name: '优化方案',
    ownerHint: '对齐 agent-loop act-08 方案生成',
    component: () => import('../scenes/scene3-optimization/Scene3Optimization.vue'),
  },
  {
    key: '4',
    aliases: ['effect', 'eval'],
    name: '效果评估',
    ownerHint: '对齐 agent-loop TrialEffect*',
    component: () => import('../scenes/scene4-effect-eval/Scene4EffectEval.vue'),
  },
  {
    key: '5',
    aliases: ['skill', 'solidify'],
    name: '技能固化',
    ownerHint: '对齐 agent-loop SkillBuild*',
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

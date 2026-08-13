export const sceneRegistry = [
  {
    key: 'traffic-origin',
    name: '车流溯源',
    component: () => import('../features/scenes/traffic-origin/TrafficOriginScene.vue'),
  },
  {
    key: 'scene-region',
    name: '目标区域',
    component: () => import('../features/scenes/scene-region/SceneRegionArea.vue'),
  },
  {
    key: 'scene-a',
    name: 'OD飞线',
    component: () => import('../features/scenes/scene-a/SceneA.vue'),
  },
  {
    key: 'scene-b',
    name: '拥堵蔓延',
    component: () => import('../features/scenes/scene-b/SceneB.vue'),
  },
  {
    key: 'scene-c',
    name: '路口诊断',
    component: () => import('../features/scenes/scene-c/SceneC.vue'),
  },
  {
    key: 'scene-d',
    name: '全域扫描',
    component: () => import('../features/scenes/scene-d/SceneD.vue'),
  },
  {
    key: 'scene-e',
    name: '干线诊断',
    component: () => import('../features/scenes/scene-e/SceneE.vue'),
  },
];

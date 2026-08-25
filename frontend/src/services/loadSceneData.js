/**
 * 幕 JSON 加载。
 * 默认 @data 打包（不依赖后端）；VITE_SCENE_API=1 时走 /api/v1/scenes/bundle。
 */
import { isSceneApiEnabled, loadSceneBundleFromApi } from './gateways/sceneDataGateway.js'

const loaders = {
  objects: () => import('@data/1-scene-objects.json'),
  opening: () => import('@data/1-0-opening.json'),
  channelization: () => import('@data/1-1-channelization.json'),
  locate: () => import('@data/1-1-problem-locate.json'),
  cause: () => import('@data/1-2-cause-analysis.json'),
  flowTrace: () => import('@data/1-2-flow-trace.json'),
  optimization: () => import('@data/1-3-optimization.json'),
  signalPlan: () => import('@data/1-3-signal-plan.json'),
  effect: () => import('@data/1-4-effect-eval.json'),
  skill: () => import('@data/1-5-skill-solidify.json'),
  sniff: () => import('@data/1-sniff-report.json'),
}

export async function loadJson(name) {
  if (isSceneApiEnabled()) {
    const datasets = await loadSceneBundleFromApi([name])
    if (!datasets[name]) throw new Error(`[loadSceneData] api missing dataset: ${name}`)
    return datasets[name]
  }
  const loader = loaders[name]
  if (!loader) throw new Error(`[loadSceneData] unknown dataset: ${name}`)
  const mod = await loader()
  return mod.default ?? mod
}

export async function loadSceneBundle(names) {
  if (isSceneApiEnabled()) {
    return loadSceneBundleFromApi(names)
  }
  const entries = await Promise.all(
    names.map(async (name) => [name, await loadJson(name)]),
  )
  return Object.fromEntries(entries)
}

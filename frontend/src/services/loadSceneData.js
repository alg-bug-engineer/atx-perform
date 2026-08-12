/**
 * 统一从仓库 data/ 加载幕 JSON（Vite alias @data → ../data）
 */
const loaders = {
  objects: () => import('@data/1-scene-objects.json'),
  opening: () => import('@data/1-0-opening.json'),
  channelization: () => import('@data/1-1-channelization.json'),
  locate: () => import('@data/1-1-problem-locate.json'),
  cause: () => import('@data/1-2-cause-analysis.json'),
  optimization: () => import('@data/1-3-optimization.json'),
  effect: () => import('@data/1-4-effect-eval.json'),
  skill: () => import('@data/1-5-skill-solidify.json'),
  sniff: () => import('@data/1-sniff-report.json'),
}

export async function loadJson(name) {
  const loader = loaders[name]
  if (!loader) throw new Error(`[loadSceneData] unknown dataset: ${name}`)
  const mod = await loader()
  return mod.default ?? mod
}

export async function loadSceneBundle(names) {
  const entries = await Promise.all(
    names.map(async (name) => [name, await loadJson(name)]),
  )
  return Object.fromEntries(entries)
}

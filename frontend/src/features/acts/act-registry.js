/**
 * 幕模块注册表（可插拔架构核心）
 *
 * 约定：
 * 1. 每个幕模块自包含在 `features/acts/act-NN-<name>/` 目录内，
 *    在模块 `index.js` 顶层调用 `registerAct(descriptor)` 完成注册。
 * 2. 主工程只依赖本文件读取注册表，禁止直接 import 幕模块内部文件；
 *    唯一的例外是主工程入口（main.js / standalone 入口）负责 import 幕模块
 *    （副作用注册），决定「哪些幕被装配」。
 * 3. 地图运行时（TrafficOriginScene）通过 `getActFxCompat()` /
 *    `getActCompatExports()` 获取已注册幕的地图特效工厂与兼容导出，
 *    未注册对应幕时返回空实现，保证各幕独立开发互不影响。
 *
 * 注册描述结构：
 * {
 *   id: number,                    // 幕序号（对齐 narrativeState.act）
 *   key: string,                   // 唯一 key（目录名，如 'problem-locate'）
 *   name: string,                  // 幕名（如 '问题定位'）
 *   order: number,                 // 排序（舞台挂载顺序）
 *   stageComponent: Component,     // 舞台组件（Stage）
 *   fxCompat: {                    // 地图特效兼容工厂（主工程地图运行时消费）
 *     createAct1MapFx?,            //   Act1 搜索态 fx（{intersections, roads}）
 *     createAct2MapFx?,            //   Act2 定位态 fx（{project}）
 *   },
 *   compatExports: {               // 主工程辅助函数兼容导出
 *     markChannelizationReady?,    //   渠化就绪（本幕无渠化时为走廊就绪）
 *     enterAct?,                   //   进入幕（错误恢复 overlay 使用）
 *   },
 *   enter: (prevState) => state,   // 幕生命周期：进入
 *   exit:  (nextHint)   => state,  // 幕生命周期：退出
 * }
 */

/** @type {Map<string, import('./act-types.js').ActDescriptor>} */
const actRegistry = new Map();

/**
 * 注册幕模块。重复注册同一 key 会被忽略（幂等）。
 * @param {import('./act-types.js').ActDescriptor} descriptor
 * @returns {import('./act-types.js').ActDescriptor}
 */
export function registerAct(descriptor) {
  if (!descriptor || typeof descriptor !== 'object') {
    throw new Error('[act-registry] registerAct: descriptor 必须为对象');
  }
  if (typeof descriptor.key !== 'string' || !descriptor.key) {
    throw new Error('[act-registry] registerAct: 缺少 key');
  }
  if (descriptor.id == null) {
    throw new Error(`[act-registry] registerAct: 幕 "${descriptor.key}" 缺少 id`);
  }
  if (actRegistry.has(descriptor.key)) {
    console.warn(`[act-registry] 幕 "${descriptor.key}" 重复注册，已忽略`);
    return actRegistry.get(descriptor.key);
  }
  actRegistry.set(descriptor.key, descriptor);
  if (import.meta.env.DEV) {
    console.info(`[act-registry] 注册幕 ${descriptor.id} · ${descriptor.name}（${descriptor.key}）`);
  }
  return descriptor;
}

/**
 * 按 key 获取已注册幕。
 * @param {string} key
 * @returns {import('./act-types.js').ActDescriptor|null}
 */
export function getAct(key) {
  return actRegistry.get(key) || null;
}

/**
 * 按幕序号获取已注册幕。
 * @param {number} id
 * @returns {import('./act-types.js').ActDescriptor|null}
 */
export function getActById(id) {
  for (const act of actRegistry.values()) {
    if (act.id === id) return act;
  }
  return null;
}

/**
 * 全部已注册幕（按 order 升序）。
 * @returns {import('./act-types.js').ActDescriptor[]}
 */
export function listActs() {
  return [...actRegistry.values()].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}

/**
 * 已注册幕序号列表（升序）。
 * @returns {number[]}
 */
export function listActIds() {
  return listActs().map((a) => a.id);
}

/**
 * 聚合已注册幕的地图特效兼容工厂。
 * 主工程地图运行时（TrafficOriginScene）用它替代对各幕的直接 import。
 * @returns {Record<string, Function|null>}
 */
export function getActFxCompat() {
  const keys = [
    'createAct1MapFx',
    'createAct2MapFx',
    'createAct2FlowMapFx',
    'createAct3MapFx',
    'createAct4MapFx',
    'createAct5MapFx',
    'createAct6MapFx',
    'createAct7MapFx',
    'createAct8MapFx',
  ];
  const out = {};
  for (const k of keys) out[k] = null;
  for (const act of actRegistry.values()) {
    for (const k of keys) {
      if (act.fxCompat?.[k] && !out[k]) out[k] = act.fxCompat[k];
    }
  }
  return out;
}

/**
 * 聚合已注册幕的辅助函数兼容导出。
 * @returns {Record<string, Function>}
 */
export function getActCompatExports() {
  const out = {};
  for (const act of actRegistry.values()) {
    if (act.compatExports && typeof act.compatExports === 'object') {
      for (const [k, fn] of Object.entries(act.compatExports)) {
        if (typeof fn === 'function' && !(k in out)) out[k] = fn;
      }
    }
  }
  return out;
}

export default {
  registerAct,
  getAct,
  getActById,
  listActs,
  listActIds,
  getActFxCompat,
  getActCompatExports,
};

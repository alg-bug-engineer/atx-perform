/**
 * 幕模块注册描述类型（仅 JSDoc，无运行时内容）
 *
 * @typedef {Object} ActDescriptor
 * @property {number} id 幕序号（对齐 narrativeState.act，从 1 开始）
 * @property {string} key 唯一 key（目录名，如 'problem-locate'）
 * @property {string} name 幕名（如 '问题定位'）
 * @property {number} [order] 舞台挂载排序（默认 99）
 * @property {Object} stageComponent 舞台 Vue 组件（Stage）
 * @property {Object} [fxCompat] 地图特效兼容工厂
 * @property {Function} [fxCompat.createAct1MapFx] Act1 搜索态 fx 工厂（{intersections, roads}）
 * @property {Function} [fxCompat.createAct2MapFx] Act2 定位态 fx 工厂（{project}）
 * @property {Object<string, Function>} [compatExports] 主工程辅助函数兼容导出
 * @property {Function} enter 幕生命周期：进入（prevState）→ state
 * @property {Function} exit 幕生命周期：退出（nextHint）→ state
 */

export {};

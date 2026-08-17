/**
 * 幕 1 · 问题定位 — 指挥家拍表
 *
 * 四拍（语音分段 = 原整段讲解逐字拆分，信息零增删）：
 *   lock        问题宣告：飞入经十路北入口，大字报点题
 *   metrics     指标顺序揭示：FlowInfoWindow 四指标逐条出（substeps=4）
 *   upstream    上游汇入：镜头沿走廊扫视，汇入箭头强调
 *   conclusion  结论收束：三路口同框 + 诊断对象锚点
 */
import { getConductorSegments } from '../../../shared/sceneNarration.js';

const SEGS = getConductorSegments('1');

function seg(id) {
  return SEGS.find((s) => s.id === id) || { text: '', audioUrl: '', durationSec: 0, approxSec: 0 };
}

export const ACT1_BEATS = [
  {
    ...seg('s1-lock'),
    beatId: 'a1.lock',
    headline: '排队外溢 · 奥体西路北入口',
    headlineSub: '晚高峰 · 北向南直行',
  },
  {
    ...seg('s1-metrics'),
    beatId: 'a1.metrics',
    substeps: 4,
    headline: '排队 270 m · 延误指数 5.28',
    headlineSub: '排队比 0.73 · 接近预警线 0.8',
  },
  {
    ...seg('s1-upstream'),
    beatId: 'a1.upstream',
    headline: '上游持续汇入 · 下游饱和度偏高',
    headlineSub: '坤顺 / 解放路口 → 奥体西路',
  },
  {
    ...seg('s1-conclusion'),
    beatId: 'a1.conclusion',
    headline: '问题定位完成',
    headlineSub: '治理目标：配时优化 · 避免加重下游拥堵',
  },
];

export default ACT1_BEATS;

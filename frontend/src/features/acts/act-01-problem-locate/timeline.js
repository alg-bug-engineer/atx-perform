/**
 * 幕 1 · 问题定位 — 指挥家拍表
 *
 * 三拍：锁定问题路段 → 上下游东西向 → 结论收束。
 * 口播 WAV 是主时钟；headline / panel / mapBeat 从本幕 JSON 读取。
 */
import { getConductorSegments } from '../../../shared/sceneNarration.js';
import { PROBLEM_LOCATE_BEATS } from './fixture.js';

const SEGS = getConductorSegments('1');

function seg(id) {
  return SEGS.find((s) => s.id === id) || { text: '', audioUrl: '', durationSec: 0, approxSec: 0 };
}

const ORDER = ['lock', 'channelization', 'queue', 'm-queue', 'm-speed', 'm-sat', 'nodes', 'conclusion'];

export const ACT1_BEATS = ORDER.map((key) => {
  const config = PROBLEM_LOCATE_BEATS[key] || {};
  return {
    ...seg(`s1-${key}`),
    // 文档未收录的拍无音频段，seg 回退对象不带 id；
    // 舞台按 beat.id 分派地图拍，必须显式补齐
    id: `s1-${key}`,
    beatId: `a1.${key}`,
    mapBeat: key,
    headline: config.headline || '',
    caption: config.caption || '',
    panel: config.panel || null,
    approxSec: config.approx_sec || seg(`s1-${key}`).approxSec || 4,
  };
});

export default ACT1_BEATS;

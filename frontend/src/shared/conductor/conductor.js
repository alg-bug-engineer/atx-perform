/**
 * 指挥家时间轴引擎（幕 1 / 幕 2 讲解短片式演绎）
 *
 * 语音为主轴：每拍（beat）经 broadcast-bus 入队预合成 WAV，
 * 以播报结束信号推进下一拍；静默模式（broadcastSilent）按
 * manifest 时长定时推进，保证无语音环境下节奏仍成立。
 *
 * beat 结构：
 * {
 *   id: string,            // 拍名（如 'lock' / 'trace'）
 *   beatId?: string,       // 叙事 beat（setBeat 同步，供调试/兼容）
 *   text: string,          // 口播文案（字幕）
 *   audioUrl?: string,     // 预合成 WAV
 *   durationSec?: number,  // 实际时长（manifest）
 *   approxSec?: number,    // 预算时长（fallback）
 *   substeps?: number,     // 拍内子步数（均分拍长，逐份 onBeatProgress）
 *   headline?: string,     // 大字报文案（舞台自取）
 *   ...自定义字段（mapAction / anchor 等，由舞台消费）
 * }
 *
 * hooks：
 *   onBeatStart(beat, index)      拍开始（语音入队同时）
 *   onBeatProgress(beat, subIdx)  子步推进（0 起）
 *   onBeatEnd(beat, index)        拍结束（进下一拍前）
 *   onAllEnd()                    全部拍播完
 */
import { watch } from 'vue';
import { barrierPaused } from '../act-playback.js';
import {
  afterBroadcastDone,
  broadcastSilent,
  interruptBroadcastQueue,
  triggerBroadcast,
} from '../broadcast-bus.js';
import { setBeat } from '../narrative-state.js';

/** 拍间停留（ms）：语音结束后留一拍呼吸再进下一拍 */
const SETTLE_MS = 300;

/**
 * @param {{ beats: Array<object>, hooks?: object, settleMs?: number }} opts
 */
export function createConductor({ beats, hooks = {}, settleMs = SETTLE_MS } = {}) {
  const list = Array.isArray(beats) ? beats : [];

  let index = -1;
  let running = false;
  let disposed = false;
  let paused = false;
  let gen = 0;
  let cancelWait = null;
  let advanceTimer = null;
  const progressTimers = [];

  function beatMs(beat) {
    const sec = Number(beat?.durationSec) || Number(beat?.approxSec) || 4;
    return Math.round(sec * 1000);
  }

  function clearProgressTimers() {
    while (progressTimers.length) clearTimeout(progressTimers.pop());
  }

  function cancelCurrent() {
    clearProgressTimers();
    if (advanceTimer != null) {
      clearTimeout(advanceTimer);
      advanceTimer = null;
    }
    cancelWait?.();
    cancelWait = null;
  }

  function scheduleSubsteps(beat, beatIndex) {
    const n = Number(beat.substeps) || 0;
    if (n <= 0 || typeof hooks.onBeatProgress !== 'function') return;
    const total = beatMs(beat);
    const step = Math.max(1, Math.floor(total / n));
    for (let k = 0; k < n; k += 1) {
      const t = setTimeout(() => {
        if (!running || paused || disposed || index !== beatIndex) return;
        hooks.onBeatProgress(beat, k);
      }, k * step);
      progressTimers.push(t);
    }
  }

  function startBeat(i) {
    if (disposed || !running) return;
    if (i >= list.length) {
      running = false;
      hooks.onAllEnd?.();
      return;
    }
    index = i;
    const beat = list[i];
    if (beat.beatId) setBeat(beat.beatId);
    hooks.onBeatStart?.(beat, i);
    scheduleSubsteps(beat, i);

    // 静默模式：不入队，按预算时长推进
    if (broadcastSilent.value || !beat.text) {
      advanceTimer = setTimeout(() => advance(i), beatMs(beat) + settleMs);
      return;
    }

    triggerBroadcast(beat.id, beat.text, {
      audioUrl: beat.audioUrl || '',
      durationSec: beat.durationSec || beat.approxSec || 0,
    });
    cancelWait = afterBroadcastDone(() => {
      cancelWait = null;
      if (!running || disposed || index !== i) return;
      advanceTimer = setTimeout(() => advance(i), settleMs);
    });
  }

  function advance(i) {
    advanceTimer = null;
    if (!running || disposed || paused || index !== i) return;
    hooks.onBeatEnd?.(list[i], i);
    startBeat(i + 1);
  }

  /** 从头播放（重复调用 = 重播：打断残留口播后清零重来） */
  function play() {
    if (disposed) return;
    gen += 1;
    cancelCurrent();
    interruptBroadcastQueue();
    running = true;
    paused = false;
    index = -1;
    startBeat(0);
  }

  /** 停止（不清空已入队口播；由幕间交棒统一打断） */
  function stop() {
    running = false;
    cancelCurrent();
  }

  /** 暂停：冻结推进（当前拍语音由栅栏冻结方处理） */
  function pause() {
    if (!running || paused) return;
    paused = true;
    cancelCurrent();
  }

  /** 恢复：重播当前拍（音频重头，节奏可复现） */
  function resume() {
    if (!running || !paused) return;
    paused = false;
    const i = Math.max(0, index);
    interruptBroadcastQueue();
    startBeat(i);
  }

  /** 幕间栅栏暂停联动：barrierPaused 置位即冻结，恢复后重播当前拍 */
  const stopBarrierWatch = watch(barrierPaused, (v) => {
    if (!running) return;
    if (v) pause();
    else resume();
  });

  function dispose() {
    disposed = true;
    running = false;
    cancelCurrent();
    stopBarrierWatch?.();
  }

  return {
    play,
    stop,
    pause,
    resume,
    dispose,
    get currentBeat() {
      return list[index] || null;
    },
    get currentIndex() {
      return index;
    },
    get isRunning() {
      return running;
    },
  };
}

export default createConductor;

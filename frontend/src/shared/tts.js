/**
 * Qwen-TTS Realtime 语音合成服务
 *
 * 使用阿里云 qwen3-tts-flash-realtime 模型，通过 WebSocket 流式接收
 * PCM 音频分片，用 Web Audio API 实时解码并无缝排队播放。
 *
 * 配置：在项目根目录 .env.local 中添加：
 *   QWEN_TTS_API_KEY=sk-xxxxxxxxxxxxxxxx
 * 或继续使用已有的 VITE_QWEN_TTS_API_KEY（仅由开发代理读取）。
 *
 * 安全提示：浏览器 WebSocket 无法设置 Authorization 请求头，
 * 因此默认通过同源 /api/tts/realtime 代理转发，避免 API Key 暴露在前端。
 */

import { applyDisplayNameAlias } from '../utils/userFacingCopy.js';

const MODEL = import.meta.env.VITE_QWEN_TTS_MODEL || 'qwen3-tts-flash-realtime';
const DEFAULT_VOICE = import.meta.env.VITE_QWEN_TTS_VOICE || 'Cherry';
const SAMPLE_RATE = Number(import.meta.env.VITE_QWEN_TTS_SAMPLE_RATE) || 24000;

function getDefaultWsUrl() {
  if (typeof window === 'undefined') return '';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const model = encodeURIComponent(MODEL);
  return `${protocol}//${window.location.host}/api/tts/realtime?model=${model}`;
}

const WS_URL = import.meta.env.VITE_QWEN_TTS_WS_URL || getDefaultWsUrl();

// 全局复用 AudioContext
let audioCtx = null;
/** 已排程音频的结束时刻（AudioContext 时间轴），跨句共享以防叠播 */
let globalNextPlayTime = 0;
let playbackEndPollTimer = null;

function getAudioCtx() {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
    globalNextPlayTime = 0;
  }
  // 部分浏览器在用户未交互时会 suspend，需要 resume
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function resetAudioPipeline() {
  globalNextPlayTime = 0;
  if (playbackEndPollTimer != null) {
    clearTimeout(playbackEndPollTimer);
    playbackEndPollTimer = null;
  }
  if (audioCtx && audioCtx.state !== 'closed') {
    audioCtx.close();
    audioCtx = null;
  }
}

/** 是否仍有已排程但未播完的 PCM（供口播队列判空闲） */
export function isTtsPlaybackActive() {
  const ctx = audioCtx;
  if (!ctx || ctx.state === 'closed' || globalNextPlayTime <= 0) return false;
  return ctx.currentTime < globalNextPlayTime - 0.02;
}

/**
 * 轮询 AudioContext 时钟，直到排程音频真正播完再回调。
 * 不用 wall-clock setTimeout，避免 suspend/时钟不同步导致 onEnd 提前。
 */
function waitForPlaybackEnd(endAt, finish) {
  const poll = () => {
    playbackEndPollTimer = null;
    const ctx = audioCtx;
    if (!endAt || endAt <= 0 || !ctx || ctx.state === 'closed') {
      globalNextPlayTime = 0;
      finish();
      return;
    }
    if (ctx.state === 'suspended') {
      ctx.resume().finally(poll);
      return;
    }
    if (ctx.currentTime >= endAt - 0.02) {
      if (globalNextPlayTime <= endAt + 0.02) {
        globalNextPlayTime = 0;
      }
      finish();
      return;
    }
    playbackEndPollTimer = setTimeout(poll, 40);
  };
  poll();
}

/**
 * 将 base64 编码的 PCM16LE 分片解码并排队到 AudioContext 播放。
 * @param {string} base64Chunk
 * @param {{ nextPlayTime: number }} state - 本句播放结束时刻
 */
function enqueuePCMChunk(base64Chunk, state) {
  const ctx = getAudioCtx();
  const raw = atob(base64Chunk);
  const byteLen = raw.length;
  const sampleCount = Math.floor(byteLen / 2);
  if (sampleCount === 0) return;

  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const lo = raw.charCodeAt(i * 2);
    const hi = raw.charCodeAt(i * 2 + 1);
    // PCM16LE little-endian → signed int16 → float32 [-1, 1]
    let int16 = (hi << 8) | lo;
    if (int16 >= 0x8000) int16 -= 0x10000;
    samples[i] = int16 / 32768;
  }

  const buf = ctx.createBuffer(1, sampleCount, SAMPLE_RATE);
  buf.copyToChannel(samples, 0);

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);

  // 全局时间轴排队：下一句必须接在上句排程末尾，禁止叠播
  const startAt = Math.max(ctx.currentTime + 0.02, globalNextPlayTime);
  src.start(startAt);
  const endAt = startAt + buf.duration;
  globalNextPlayTime = endAt;
  state.nextPlayTime = endAt;
}

/**
 * 调用 Qwen-TTS Realtime 合成并播放文本。
 *
 * @param {string} text - 要合成的文本
 * @param {object} [options]
 * @param {string} [options.voice='Cherry'] - 音色（Cherry / Ethan / Serena 等）
 * @param {Function} [options.onStart] - 首帧音频到达时回调（用于触发说话动画）
 * @param {Function} [options.onEnd]   - 播放结束时回调（用于结束说话动画）
 * @returns {() => void} cancel 函数，可提前中止
 */
export function speak(text, { voice = DEFAULT_VOICE, onStart, onEnd } = {}) {
  // 口播展示别名：齐川路 → 齐音路（查库名不变）
  const speakText = applyDisplayNameAlias(text);
  if (!WS_URL) {
    console.warn('[TTS] 未配置 TTS WebSocket 地址，跳过语音播报');
    const ms = Math.min(4000, Math.max(800, String(speakText || '').length * 70));
    setTimeout(() => onEnd?.(), ms);
    return () => {};
  }
  if (!speakText) {
    setTimeout(() => onEnd?.(), 0);
    return () => {};
  }

  // 每段播报独立 WebSocket 会话，避免会话状态污染
  let ws;
  let cancelled = false;
  const state = { nextPlayTime: 0 };
  let startCallbackFired = false;
  let endCallbackFired = false;

  const finish = () => {
    if (endCallbackFired) return;
    endCallbackFired = true;
    onEnd?.();
  };

  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    console.error('[TTS] WebSocket 创建失败', e);
    return () => {};
  }

  ws.onopen = () => {
    if (cancelled) { ws.close(); return; }

    // 1. 配置会话：音色、PCM 格式、server_commit 模式（服务端自动判断分段）
    ws.send(JSON.stringify({
      type: 'session.update',
      session: {
        voice,
        response_format: 'pcm',
        sample_rate: SAMPLE_RATE,
        mode: 'server_commit',
      },
    }));

    // 2. 追加文本到缓冲区
    ws.send(JSON.stringify({
      type: 'input_text_buffer.append',
      text: speakText,
    }));

    // 3. 强制触发合成（server_commit 模式下也可显式 commit 保证立即合成）
    ws.send(JSON.stringify({ type: 'input_text_buffer.commit' }));
  };

  ws.onmessage = ({ data }) => {
    if (cancelled) return;
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    switch (msg.type) {
      case 'response.created':
        break;

      case 'response.audio.delta':
        if (msg.delta) {
          if (!startCallbackFired) {
            startCallbackFired = true;
            onStart?.();
          }
          enqueuePCMChunk(msg.delta, state);
        }
        break;

      case 'response.audio.done':
        // 所有音频分片已发送完毕，通知服务端关闭会话
        ws.send(JSON.stringify({ type: 'session.finish' }));
        break;

      case 'session.finished':
        ws.close();
        waitForPlaybackEnd(state.nextPlayTime, finish);
        break;

      case 'error':
        console.error('[TTS] 服务端错误', msg);
        ws.close();
        if (startCallbackFired && state.nextPlayTime > 0) {
          waitForPlaybackEnd(state.nextPlayTime, finish);
        } else {
          finish();
        }
        break;
    }
  };

  ws.onerror = (e) => {
    console.error('[TTS] WebSocket 错误', e);
    if (startCallbackFired && state.nextPlayTime > 0) {
      waitForPlaybackEnd(state.nextPlayTime, finish);
    } else {
      finish();
    }
  };

  ws.onclose = () => {
    if (!startCallbackFired) {
      // 连接异常关闭且从未开始播放，直接触发 onEnd
      finish();
      return;
    }
    // 已起播但未收到 session.finished：仍等排程音频播完
    if (!endCallbackFired && state.nextPlayTime > 0) {
      waitForPlaybackEnd(state.nextPlayTime, finish);
    }
  };

  // 返回 cancel 函数供调用方中止播报
  return () => {
    cancelled = true;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
    resetAudioPipeline();
    finish();
  };
}

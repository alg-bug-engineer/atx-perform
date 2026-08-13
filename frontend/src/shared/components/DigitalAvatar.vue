<script setup>
import { ref, watch, onUnmounted } from 'vue';
import avatarImage from '../../assets/digital_avatar_officer_male.png';
import {
  broadcastQueue,
  broadcastMuted,
  broadcastFrozen,
  broadcastInterruptSeq,
  currentBroadcast,
  _notifyBroadcastStart,
  _notifyBroadcastEnd,
} from '../../shared/broadcast-bus.js';
import { speak, isTtsPlaybackActive } from '../../shared/tts.js';

const TTS_VOICE = import.meta.env.VITE_QWEN_TTS_VOICE || 'Cherry';
/** 句间空隙：原 1500ms 会在多句过程口播后拖出半分钟空等 */
const INTER_ITEM_GAP_MS = 350;
/** 静音时仅字幕，按时长估算（略快于真人语速） */
const MUTED_CHAR_MS = 70;

// ── 组件状态 ──────────────────────────────────────────────────────────────────
const isSpeaking   = ref(false);   // 播报中（触发说话动画）
const displayText  = ref('');      // 字幕区当前显示文本
const typeText     = ref('');      // 打字机效果正在输出的文本
const isProcessing = ref(false);   // 正在消费队列（防止并发）
const showMuteHint = ref(false);   // hover 时显示操作提示

// ── 打字机 ───────────────────────────────────────────────────────────────────
let typeTimer = null;

function runTypewriter(text, onDone) {
  typeText.value = '';
  let idx = 0;
  clearInterval(typeTimer);
  typeTimer = setInterval(() => {
    idx++;
    typeText.value = text.slice(0, idx);
    if (idx >= text.length) {
      clearInterval(typeTimer);
      onDone?.();
    }
  }, 48);
}

// ── 队列消费 ──────────────────────────────────────────────────────────────────
let cancelCurrentSpeak = null;
let endTimer = null;
/** 递增使 TTS cancel→onEnd 失效，防止暂停/中断后重复 processNext */
let speakGeneration = 0;

function hardStopSpeaking({ notifyEnd = true } = {}) {
  speakGeneration += 1; // 先作废当前会话的 onEnd
  cancelCurrentSpeak?.();
  cancelCurrentSpeak = null;
  clearTimeout(endTimer);
  clearInterval(typeTimer);
  endTimer = null;
  isSpeaking.value = false;
  isProcessing.value = false;
  displayText.value = '';
  typeText.value = '';
  currentBroadcast.value = null;
  if (notifyEnd) _notifyBroadcastEnd();
}

async function processNext() {
  if (broadcastFrozen.value) return;
  if (isProcessing.value || broadcastQueue.length === 0) return;
  isProcessing.value = true;
  _notifyBroadcastStart();

  const item = broadcastQueue.shift();
  if (!item) { isProcessing.value = false; _notifyBroadcastEnd(); return; }

  const gen = ++speakGeneration;
  currentBroadcast.value = { key: item.key, text: item.text };

  // 若静音，仅展示字幕动画，不调 TTS
  displayText.value = item.text;
  isSpeaking.value  = true;
  clearTimeout(endTimer);

  // 字幕打字机
  runTypewriter(item.text, null);

  const finishItem = (delayMs) => {
    if (gen !== speakGeneration || broadcastFrozen.value) return;
    isSpeaking.value = false;
    isProcessing.value = false;
    currentBroadcast.value = null;
    _notifyBroadcastEnd();
    endTimer = setTimeout(() => {
      if (gen !== speakGeneration || broadcastFrozen.value) return;
      displayText.value = '';
      typeText.value = '';
      processNext();
    }, delayMs);
  };

  if (!broadcastMuted.value) {
    let ended = false;
    let audioStarted = false;
    let wsDeadTimer = null;

    const safeFinish = () => {
      if (ended) return;
      const finalize = () => {
        if (ended) return;
        ended = true;
        clearTimeout(wsDeadTimer);
        finishItem(INTER_ITEM_GAP_MS);
      };
      // 队列判空闲早于 PCM 实际播完时，再等 AudioContext 排空
      const waitAudioDrain = () => {
        if (gen !== speakGeneration || broadcastFrozen.value) return;
        if (isTtsPlaybackActive()) {
          setTimeout(waitAudioDrain, 50);
          return;
        }
        finalize();
      };
      waitAudioDrain();
    };

    cancelCurrentSpeak = speak(item.text, {
      voice: TTS_VOICE,
      onStart: () => {
        audioStarted = true;
        clearTimeout(wsDeadTimer);
        if (gen !== speakGeneration) return;
        isSpeaking.value = true;
      },
      onEnd: () => {
        clearTimeout(wsDeadTimer);
        if (gen !== speakGeneration || broadcastFrozen.value) return;
        safeFinish();
      },
    });

    // 仅当 TTS 始终未起播（WS/鉴权失败）时跳过；正常长句必须等 onEnd，禁止按字数截断
    wsDeadTimer = setTimeout(() => {
      if (ended || audioStarted) return;
      console.warn('[DigitalAvatar] TTS 未起播，跳过本条口播', item.key);
      cancelCurrentSpeak?.();
      safeFinish();
    }, 12_000);
  } else {
    const mutedMs = Math.min(120_000, Math.max(1200, String(item.text || '').length * MUTED_CHAR_MS));
    endTimer = setTimeout(() => {
      if (gen !== speakGeneration || broadcastFrozen.value) return;
      finishItem(0);
    }, mutedMs);
  }
}

watch(
  () => broadcastQueue.length,
  (len) => {
    if (broadcastFrozen.value) return;
    if (len > 0 && !isProcessing.value) processNext();
  },
);

// 中断当前句后：若队列仍有（如交棒只留 handoff），继续消费
watch(broadcastInterruptSeq, () => {
  hardStopSpeaking({ notifyEnd: true });
  if (!broadcastFrozen.value && broadcastQueue.length > 0) {
    setTimeout(processNext, 0);
  }
});

watch(broadcastFrozen, (frozen) => {
  if (frozen) hardStopSpeaking({ notifyEnd: true });
});

// ── 静音切换（点击头像：关闭 / 开启语音播报）───────────────────────────────
function toggleMute() {
  const turningOff = !broadcastMuted.value;
  broadcastMuted.value = turningOff;

  if (turningOff) {
    // 关闭：立即中断当前 TTS；若仍有队列则以「仅字幕」模式继续
    if (isSpeaking.value) hardStopSpeaking({ notifyEnd: true });
    if (!broadcastFrozen.value && broadcastQueue.length > 0 && !isProcessing.value) {
      setTimeout(processNext, 0);
    }
    return;
  }

  // 开启：恢复消费队列（播 TTS）
  if (!broadcastFrozen.value && broadcastQueue.length > 0 && !isProcessing.value) {
    setTimeout(processNext, 0);
  }
}

onUnmounted(() => {
  clearTimeout(endTimer);
  clearInterval(typeTimer);
  cancelCurrentSpeak?.();
});
</script>

<template>
  <div class="da-wrap" :class="{ speaking: isSpeaking, muted: broadcastMuted }">
    <!-- 数字人头像区（可点击切换播报开关） -->
    <div
      class="da-avatar"
      :class="{ speaking: isSpeaking, muted: broadcastMuted }"
      :title="broadcastMuted ? '点击开启语音播报' : '点击关闭语音播报'"
      @click="toggleMute"
      @mouseenter="showMuteHint = true"
      @mouseleave="showMuteHint = false"
    >
      <!-- 外发光环 -->
      <div class="da-ring r1" :class="{ active: isSpeaking && !broadcastMuted }"></div>
      <div class="da-ring r2" :class="{ active: isSpeaking && !broadcastMuted }"></div>
      <!-- 公安交警数字人证件照 -->
      <img class="da-officer-image" :src="avatarImage" alt="公安交警数字人" />
      <!-- hover 时显示的操作提示遮罩 -->
      <transition name="hint-fade">
        <div v-if="showMuteHint" class="da-hover-hint">
          <svg v-if="!broadcastMuted" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
            <!-- 静音图标：speaker + slash -->
            <path d="M11 5L6 9H2v6h4l5 4V5z"/>
            <line x1="23" y1="9" x2="17" y2="15" stroke-linecap="round"/>
            <line x1="17" y1="9" x2="23" y2="15" stroke-linecap="round"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
            <!-- 开声图标：speaker with waves -->
            <path d="M11 5L6 9H2v6h4l5 4V5z"/>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
          </svg>
        </div>
      </transition>
      <!-- 静音角标 -->
      <transition name="badge-pop">
        <div v-if="broadcastMuted" class="da-mute-badge" title="语音已关闭">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M7 3.5L4 6H1.5v4H4l3 2.5V3.5z"/>
            <line x1="14" y1="5.5" x2="10" y2="9.5" stroke-linecap="round"/>
            <line x1="10" y1="5.5" x2="14" y2="9.5" stroke-linecap="round"/>
          </svg>
        </div>
      </transition>
    </div>

    <!-- 字幕条（播报时展开，静音模式下隐藏） -->
    <transition name="caption-slide">
      <div v-if="(isSpeaking || typeText) && !broadcastMuted" class="da-caption">
        <span class="da-caption-text">{{ typeText }}</span>
        <span v-if="isSpeaking" class="da-cursor">|</span>
      </div>
    </transition>
  </div>
</template>

<style scoped>
/* ── 容器 ── */
.da-wrap {
  position: fixed;
  left: 24px;
  bottom: 24px;
  z-index: 100;
  display: flex;
  align-items: flex-end;
  gap: 14px;
  pointer-events: none;
  transition: opacity 0.3s;
  opacity: 0.55;
}
.da-wrap.speaking {
  opacity: 1;
}
.da-wrap.muted {
  opacity: 0.45;
}

/* ── 头像容器 ── */
.da-avatar {
  position: relative;
  width: 80px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 12, 24, 0.78);
  border: 1px solid rgba(0, 210, 240, 0.40);
  border-radius: 50%;
  color: rgba(0, 210, 240, 0.70);
  overflow: visible;
  transition: border-color 0.3s, color 0.3s, transform 0.3s, box-shadow 0.3s, opacity 0.3s;
  flex-shrink: 0;
  pointer-events: auto;
  cursor: pointer;
  user-select: none;
}
.da-avatar:hover {
  border-color: rgba(0, 210, 240, 0.70);
  box-shadow: 0 0 12px rgba(0, 210, 240, 0.25);
  transform: scale(1.05);
}
.da-avatar:active {
  transform: scale(0.97);
}
.da-avatar.speaking {
  border-color: rgba(0, 210, 240, 0.90);
  color: #00d4f0;
  transform: scale(1.08);
  box-shadow: 0 0 18px rgba(0, 210, 240, 0.35);
}
.da-avatar.muted {
  border-color: rgba(180, 60, 60, 0.50);
  color: rgba(200, 80, 80, 0.70);
  box-shadow: none;
}
.da-avatar.muted:hover {
  border-color: rgba(220, 80, 80, 0.75);
  box-shadow: 0 0 10px rgba(200, 60, 60, 0.25);
}

/* ── hover 遮罩提示 ── */
.da-hover-hint {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: rgba(0, 8, 18, 0.62);
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(0, 210, 240, 0.95);
  z-index: 2;
  backdrop-filter: blur(1px);
}
.da-avatar.muted .da-hover-hint {
  color: rgba(100, 220, 140, 0.95);
}
.hint-fade-enter-active,
.hint-fade-leave-active {
  transition: opacity 0.18s ease;
}
.hint-fade-enter-from,
.hint-fade-leave-to {
  opacity: 0;
}

.da-officer-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center center;
  border-radius: 50%;
  filter: drop-shadow(0 0 4px rgba(0, 210, 240, 0.18));
  user-select: none;
  pointer-events: none;
}

/* ── 发光环 ── */
.da-ring {
  position: absolute;
  top: 50%;
  left: 50%;
  border-radius: 50%;
  border: 1px solid rgba(0, 210, 240, 0.22);
  pointer-events: none;
  opacity: 0;
}
.r1 {
  width: 98px;
  height: 98px;
  margin-top: -49px;
  margin-left: -49px;
}
.r2 {
  width: 116px;
  height: 116px;
  margin-top: -58px;
  margin-left: -58px;
  border-color: rgba(0, 210, 240, 0.12);
}
.r1.active {
  animation: ring-pulse 1.8s ease-in-out infinite;
}
.r2.active {
  animation: ring-pulse 1.8s ease-in-out infinite 0.4s;
}
@keyframes ring-pulse {
  0%, 100% { transform: scale(1); opacity: 0.6; }
  50%       { transform: scale(1.06); opacity: 1; }
}

/* ── 字幕条（演示大屏：24px，与放大头像底对齐） ── */
.da-caption {
  max-width: min(720px, calc(100vw - 140px));
  min-height: 80px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  background: rgba(0, 12, 24, 0.88);
  border: 1px solid rgba(0, 210, 240, 0.45);
  padding: 14px 18px;
  border-left: 3px solid rgba(0, 210, 240, 0.85);
}
.da-caption-text {
  font-size: 24px;
  color: rgba(235, 248, 255, 0.96);
  font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
  font-weight: 500;
  letter-spacing: 0.4px;
  line-height: 1.5;
  word-break: break-word;
}
.da-cursor {
  display: inline-block;
  color: #00d4f0;
  font-weight: bold;
  animation: blink-cursor 0.65s step-end infinite;
  margin-left: 1px;
}
@keyframes blink-cursor {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0; }
}

/* ── 字幕展开过渡 ── */
.caption-slide-enter-active {
  transition: opacity 0.25s ease, transform 0.25s ease, max-width 0.25s ease;
}
.caption-slide-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease, max-width 0.3s ease;
}
.caption-slide-enter-from,
.caption-slide-leave-to {
  opacity: 0;
  transform: translateX(-8px);
  max-width: 0;
}

/* ── 静音角标（钉在头像右上角） ── */
.da-mute-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  z-index: 3;
  width: 22px;
  height: 22px;
  background: rgba(200, 50, 40, 0.90);
  border: 1px solid rgba(255, 100, 80, 0.60);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  pointer-events: none;
  box-shadow: 0 0 6px rgba(200, 50, 40, 0.45);
}

/* ── 角标弹出过渡 ── */
.badge-pop-enter-active {
  transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.badge-pop-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.badge-pop-enter-from,
.badge-pop-leave-to {
  opacity: 0;
  transform: scale(0.4);
}
</style>

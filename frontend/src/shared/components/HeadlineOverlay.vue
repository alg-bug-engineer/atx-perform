<script setup>
/**
 * 大字报讲解层（指挥家时间轴 · 每拍一条要点）
 *
 * 原则：领导一眼看懂 —— 语音念到哪拍，屏幕中央下方就出现该拍的大字要点；
 * 不承载细节数据（细节在地图锚定卡），避免信息过密。
 */
import { ref, watch } from 'vue';

const props = defineProps({
  /** { main: string, sub?: string } | null */
  headline: { type: Object, default: null },
});

const shown = ref(null);
const seq = ref(0);

watch(
  () => props.headline,
  (next) => {
    if (!next?.main) {
      shown.value = null;
      return;
    }
    seq.value += 1;
    shown.value = { ...next, seq: seq.value };
  },
  { immediate: true },
);
</script>

<template>
  <transition name="headline-swap" mode="out-in">
    <div v-if="shown" :key="shown.seq" class="headline-overlay">
      <div class="hl-main">{{ shown.main }}</div>
      <div v-if="shown.sub" class="hl-sub">{{ shown.sub }}</div>
    </div>
  </transition>
</template>

<style scoped>
.headline-overlay {
  position: absolute;
  left: 50%;
  bottom: 48px;
  transform: translateX(-50%);
  z-index: 42;
  max-width: min(820px, calc(100vw - 420px));
  padding: 10px 28px;
  text-align: center;
  background: rgba(4, 12, 30, 0.82);
  border: 1px solid rgba(0, 212, 240, 0.4);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(8px);
  white-space: nowrap;
  pointer-events: none;
}

.hl-main {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 3px;
  line-height: 1.35;
  color: #00e5ff;
  text-shadow:
    0 0 14px rgba(0, 229, 255, 0.85),
    0 0 28px rgba(0, 229, 255, 0.35);
}

.hl-sub {
  margin-top: 5px;
  font-size: 14px;
  letter-spacing: 2px;
  color: rgba(126, 233, 255, 0.85);
}

.headline-swap-enter-active {
  transition: opacity 0.35s ease, transform 0.35s ease;
}

.headline-swap-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.headline-swap-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(12px);
}

.headline-swap-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-6px);
}
</style>

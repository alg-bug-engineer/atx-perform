<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue';

const timeStr = ref('');
let timer = null;

function tickClock() {
  const now = new Date();
  timeStr.value =
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ` +
    `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
}

onMounted(() => {
  tickClock();
  timer = setInterval(tickClock, 1000);
});

onBeforeUnmount(() => {
  if (timer != null) clearInterval(timer);
});
</script>

<template>
  <div class="scene-chrome">
    <div class="hud">
      <div class="hud-title">
        <span class="title-main">济南交管支队信控智能体</span>
      </div>
    </div>

    <div class="corner corner-tl" />
    <div class="corner corner-tr" />
    <div class="corner corner-bl" />
    <div class="corner corner-br" />

    <div class="timestamp">{{ timeStr }}</div>
  </div>
</template>

<style scoped>
.scene-chrome {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 20;
}

/* 对齐 agent-loop TrafficOriginScene HUD */
.hud {
  position: absolute;
  top: 24px;
  left: 24px;
  z-index: 10;
  user-select: none;
  font-family: 'Courier New', monospace;
  color: #00e5ff;
}

.hud-title {
  display: flex;
  flex-direction: column;
  margin-bottom: 20px;
}

.title-main {
  font-size: 22px;
  font-weight: bold;
  letter-spacing: 3px;
  color: #00e5ff;
  text-shadow:
    0 0 10px #00e5ff,
    0 0 22px rgba(0, 229, 255, 0.55),
    0 0 42px rgba(0, 229, 255, 0.35);
}

.corner {
  position: absolute;
  width: 20px;
  height: 20px;
  opacity: 0.55;
  z-index: 10;
}
.corner-tl {
  top: 10px;
  left: 10px;
  border-top: 1.5px solid #00e5ff;
  border-left: 1.5px solid #00e5ff;
}
.corner-tr {
  top: 10px;
  right: 10px;
  border-top: 1.5px solid #00e5ff;
  border-right: 1.5px solid #00e5ff;
}
.corner-bl {
  bottom: 10px;
  left: 10px;
  border-bottom: 1.5px solid #00e5ff;
  border-left: 1.5px solid #00e5ff;
}
.corner-br {
  bottom: 10px;
  right: 10px;
  border-bottom: 1.5px solid #00e5ff;
  border-right: 1.5px solid #00e5ff;
}

.timestamp {
  position: absolute;
  top: 24px;
  right: 280px;
  z-index: 10;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: rgba(0, 229, 255, 0.55);
  letter-spacing: 2px;
}
</style>

<script setup>
import MapRuntime from '../features/scenes/MapRuntime.vue';
import TrafficOriginScene from '../features/scenes/traffic-origin/TrafficOriginScene.vue';
import ActLoopShell from '../features/acts/ActLoopShell.vue';
import DigitalAvatar from '../shared/components/DigitalAvatar.vue';
import { narrativeActive } from '../shared/narrative-state.js';
import { broadcastSilent } from '../shared/broadcast-bus.js';
</script>

<template>
  <div class="app-shell">
    <!-- 首页（idle）：城市监控 + 交通诊断入口 -->
    <MapRuntime v-if="!narrativeActive" />

    <!-- 叙事幕模式：车流溯源地图 + 幕循环壳 -->
    <template v-else>
      <TrafficOriginScene />
      <ActLoopShell />
    </template>

    <!-- 数字人 / 口播字幕：默认关闭，避免卡住面板揭示顺序；VITE_TTS_ENABLED=true 时再挂上 -->
    <DigitalAvatar v-if="!broadcastSilent" />
  </div>
</template>

<style scoped>
.app-shell {
  width: 100%;
  height: 100%;
  background: #000;
}
</style>

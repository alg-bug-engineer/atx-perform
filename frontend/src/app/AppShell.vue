<script setup>
import MapRuntime from '../features/scenes/MapRuntime.vue';
import TrafficOriginScene from '../features/scenes/traffic-origin/TrafficOriginScene.vue';
import ActLoopShell from '../features/acts/ActLoopShell.vue';
import DigitalAvatar from '../shared/components/DigitalAvatar.vue';
import { narrativeActive } from '../shared/narrative-state.js';
</script>

<template>
  <div class="app-shell">
    <!-- 首页（idle）：城市监控 + 立即优化入口 + 分析成因 -->
    <MapRuntime v-if="!narrativeActive" />

    <!-- 叙事幕模式：车流溯源地图 + 幕循环壳 -->
    <template v-else>
      <TrafficOriginScene />
      <ActLoopShell />
    </template>

    <!-- 数字人：全局固定左下角，消费口播队列（始终可见） -->
    <DigitalAvatar />
  </div>
</template>

<style scoped>
.app-shell {
  width: 100%;
  height: 100%;
  background: #000;
}
</style>

<script setup>
import DrilldownSidebar from '../../features/analysis/DrilldownSidebar.vue';
import { selectedEntity } from '../../shared/event-bus.js';
</script>

<template>
  <aside class="analysis-dock-left">
    <DrilldownSidebar :selection="selectedEntity" side="left" />
  </aside>
</template>

<style scoped>
.analysis-dock-left {
  position: absolute;
  top: 96px;
  left: 24px;
  bottom: 64px;
  z-index: 35;
  width: 300px;
  pointer-events: auto;
}
</style>

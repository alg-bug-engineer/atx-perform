<script setup>
import DrilldownSidebar from '../../features/analysis/DrilldownSidebar.vue';
import { selectedEntity } from '../../shared/event-bus.js';
</script>

<template>
  <aside class="analysis-dock">
    <DrilldownSidebar :selection="selectedEntity" side="right" />
  </aside>
</template>

<style scoped>
.analysis-dock {
  position: absolute;
  top: 96px;
  right: 24px;
  bottom: 64px;
  z-index: 35;
  width: 360px;
  pointer-events: auto;
}
</style>

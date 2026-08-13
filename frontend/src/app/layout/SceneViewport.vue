<script setup>
defineProps({
  sceneComponent: {
    type: [Object, Function],
    required: true,
  },
});
</script>

<template>
  <section class="scene-viewport">
    <component :is="sceneComponent" />
  </section>
</template>

<style scoped>
.scene-viewport {
  position: absolute;
  inset: 0;
  z-index: 1;
}
</style>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { drawCorridorStageCanvas, stageCanvasKeys } from './corridorStageCanvas.js'

const props = defineProps({
  movements: { type: Array, default: () => [] },
  stageName: { type: String, default: '' },
})

const canvas = ref(null)
const keys = computed(() => stageCanvasKeys({ movements: props.movements, name: props.stageName }))

function draw() {
  if (canvas.value) drawCorridorStageCanvas(canvas.value, keys.value)
}

onMounted(draw)
watch(keys, draw, { deep: true })
</script>

<template>
  <canvas
    ref="canvas"
    class="corridor-stage-card-canvas"
    width="150"
    height="150"
    role="img"
    :aria-label="`${stageName || '阶段'}放行流向示意`"
  />
</template>

<style scoped>
.corridor-stage-card-canvas {
  display: block;
  width: 150px;
  height: auto;
  aspect-ratio: 1;
  max-width: 100%;
  border-radius: 6px;
}
</style>

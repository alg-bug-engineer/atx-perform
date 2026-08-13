<script setup>
defineProps({
  selection: {
    type: Object,
    required: true,
  },
});
</script>

<template>
  <section class="panel">
    <h3>行政区分析</h3>
    <p>这里用于展示行政区内路网密度、关键路口、区域流量排行等内容。</p>
  </section>
</template>

<style scoped>
.panel {
  border: 1px solid rgba(0, 229, 255, 0.14);
  margin-top: 12px;
  padding: 12px;
}

h3 {
  color: #00e5ff;
  font-size: 12px;
  letter-spacing: 2px;
  margin-bottom: 10px;
}

p {
  color: rgba(215, 249, 255, 0.62);
  font-size: 11px;
  line-height: 1.6;
}
</style>

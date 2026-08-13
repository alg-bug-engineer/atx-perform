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
    <h3>路网指标</h3>
    <p>这里用于承载路段数、入向流量、出向流量、拥堵指数等下钻分析。</p>
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

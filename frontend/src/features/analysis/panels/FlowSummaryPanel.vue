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
    <h3>流量概览</h3>
    <div class="metric-row">
      <span>对象 ID</span>
      <strong>{{ selection.id || '-' }}</strong>
    </div>
    <div class="metric-row">
      <span>名称</span>
      <strong>{{ selection.name || '-' }}</strong>
    </div>
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

.metric-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
  font-size: 11px;
}

span {
  color: rgba(215, 249, 255, 0.58);
}

strong {
  color: #fff;
  font-weight: normal;
  text-align: right;
}
</style>

<script setup>
defineProps({
  selection: { type: Object, default: null },
});
</script>

<template>
  <div class="panel">
    <div class="panel-title">流量溯源分析</div>

    <template v-if="selection">
      <div class="block">
        <div class="block-label">选中对象</div>
        <div class="block-value highlight">{{ selection.name || selection.id || '—' }}</div>
        <div class="block-meta">类型：{{ selection.type || '—' }}</div>
      </div>

      <div class="metrics">
        <div class="metric">
          <span class="metric-val">{{ selection.inboundCount ?? '—' }}</span>
          <span class="metric-lbl">入向路段</span>
        </div>
        <div class="metric">
          <span class="metric-val">{{ selection.outboundCount ?? '—' }}</span>
          <span class="metric-lbl">出向路段</span>
        </div>
        <div class="metric">
          <span class="metric-val">2 km</span>
          <span class="metric-lbl">溯源半径</span>
        </div>
      </div>

      <div class="block">
        <div class="block-label">溯源路径</div>
        <div class="flow-bars">
          <div
            v-for="n in 5"
            :key="n"
            class="flow-bar"
            :style="{ width: (100 - n * 14) + '%', opacity: 1 - n * 0.15 }"
          ></div>
        </div>
      </div>
    </template>

    <div v-else class="empty">点击路口查看流量溯源详情</div>
  </div>
</template>

<style scoped>
.panel { padding: 0 2px; }

.panel-title {
  color: rgba(0, 229, 255, 0.72);
  font-size: 10px;
  letter-spacing: 2px;
  text-transform: uppercase;
  margin-bottom: 14px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(0, 229, 255, 0.14);
}

.block { margin-bottom: 14px; }

.block-label {
  color: rgba(0, 229, 255, 0.52);
  font-size: 10px;
  letter-spacing: 1px;
  margin-bottom: 4px;
}

.block-value {
  font-size: 13px;
  color: #d7f9ff;
}
.block-value.highlight { color: #00e5ff; }

.block-meta { color: rgba(215, 249, 255, 0.45); font-size: 11px; margin-top: 2px; }

.metrics {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}

.metric {
  flex: 1;
  background: rgba(0, 229, 255, 0.06);
  border: 1px solid rgba(0, 229, 255, 0.14);
  padding: 8px 6px;
  text-align: center;
}

.metric-val {
  display: block;
  font-size: 18px;
  color: #00e5ff;
}

.metric-lbl {
  display: block;
  font-size: 10px;
  color: rgba(215, 249, 255, 0.52);
  margin-top: 2px;
}

.flow-bars { display: flex; flex-direction: column; gap: 4px; }

.flow-bar {
  height: 4px;
  background: linear-gradient(90deg, #00e5ff, transparent);
  border-radius: 2px;
}

.empty {
  color: rgba(215, 249, 255, 0.38);
  font-size: 11px;
  line-height: 1.6;
  padding: 8px 0;
}
</style>

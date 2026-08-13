<script setup>
import { computed, onMounted, ref } from 'vue';
import {
  classifyMonitorQueue,
  loadCityMonitorDemo,
  statusLabel,
  typeLabel,
} from '../../services/cityMonitorDemo.js';
import { cityMonitorSelection } from '../../shared/home-idle-state.js';

const loading = ref(true);
const error = ref('');
const demo = ref(null);
const activeTab = ref('bgIssue');

const overview = computed(() => demo.value?.overview || {});
const stats = computed(() => overview.value.stats || {});
const agentStatus = computed(() => overview.value.agentStatus || {});

const queues = computed(() =>
  demo.value
    ? classifyMonitorQueue(demo.value)
    : { bgIssue: [], dynIssue: [], optimizing: [], completed: [] },
);

const tabs = computed(() => [
  { key: 'bgIssue', label: '背景方案', count: queues.value.bgIssue.length },
  { key: 'dynIssue', label: '动态异常', count: queues.value.dynIssue.length },
  { key: 'optimizing', label: '优化中', count: queues.value.optimizing.length },
  { key: 'completed', label: '已完成', count: queues.value.completed.length },
]);

const activeItems = computed(() => queues.value[activeTab.value] || []);

const successRate = computed(() => {
  const rate = agentStatus.value.master?.successRate;
  if (rate == null) return '—';
  return `${Math.round(Number(rate) * 100)}%`;
});

const selectedKey = computed(() => {
  const s = cityMonitorSelection.value;
  return s ? `${s.type}:${s.id}` : '';
});

onMounted(async () => {
  try {
    demo.value = await loadCityMonitorDemo();
  } catch (e) {
    error.value = e?.message || '监控数据加载失败';
  } finally {
    loading.value = false;
  }
});

function onSelect(type, id) {
  cityMonitorSelection.value = { type, id, ts: Date.now() };
}

function itemDesc(obj) {
  const issue = obj.issues?.[0];
  if (issue?.name) return issue.name;
  if (obj.primaryIssue) return obj.primaryIssue;
  if (obj.saturation != null) return `饱和度 ${(Number(obj.saturation) * 100).toFixed(0)}%`;
  return statusLabel(obj.status);
}
</script>

<template>
  <div class="city-monitor-panel">
    <div class="panel-header">
      <div class="panel-title">城市信控总体运行</div>
      <div class="panel-sub">监控覆盖 · 路网态势</div>
    </div>

    <div v-if="loading" class="panel-state">加载监控数据…</div>
    <div v-else-if="error" class="panel-state error">{{ error }}</div>
    <template v-else>
      <div class="scope-row">
        <div class="scope-item">
          <div class="scope-num">{{ demo.regions.length }}</div>
          <div class="scope-label">监控区域</div>
        </div>
        <div class="scope-sep" />
        <div class="scope-item">
          <div class="scope-num">{{ demo.corridors.length }}</div>
          <div class="scope-label">监控干线</div>
        </div>
        <div class="scope-sep" />
        <div class="scope-item">
          <div class="scope-num">{{ stats.monitoredIntersections ?? demo.intersections.length }}</div>
          <div class="scope-label">信控路口</div>
        </div>
      </div>

      <div class="opt-chip">
        优化中 <strong>{{ stats.optimizingObjects ?? queues.optimizing.length }}</strong>
      </div>

      <div class="effect-strip">
        <div class="eff">
          <span class="eff-val">{{ stats.avgSpeed ?? '—' }}</span>
          <span class="eff-lab">均速</span>
        </div>
        <div class="eff-sep" />
        <div class="eff">
          <span class="eff-val">{{ stats.avgDelay ?? '—' }}</span>
          <span class="eff-lab">延误</span>
        </div>
        <div class="eff-sep" />
        <div class="eff">
          <span class="eff-val">{{ stats.congestionIndex ?? '—' }}</span>
          <span class="eff-lab">拥堵指数</span>
        </div>
        <div class="eff-sep" />
        <div class="eff">
          <span class="eff-val">{{ successRate }}</span>
          <span class="eff-lab">成功率</span>
        </div>
      </div>

      <div class="queue-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          class="queue-tab"
          :class="{ active: activeTab === tab.key }"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
          <span class="tab-cnt">{{ tab.count }}</span>
        </button>
      </div>

      <div class="queue-list">
        <button
          v-for="{ obj, type } in activeItems"
          :key="`${type}-${obj.id}`"
          type="button"
          class="queue-item"
          :class="[`st-${obj.status || 'normal'}`, { active: selectedKey === `${type}:${obj.id}` }]"
          @click="onSelect(type, obj.id)"
        >
          <div class="qi-top">
            <span class="qi-type">{{ typeLabel(type) }}</span>
            <span class="qi-badge">{{ statusLabel(obj.status) }}</span>
          </div>
          <div class="qi-name">{{ obj.name || obj.id }}</div>
          <div class="qi-desc">{{ itemDesc(obj) }}</div>
        </button>
        <div v-if="!activeItems.length" class="queue-empty">暂无对象</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.city-monitor-panel {
  box-sizing: border-box;
  width: 340px;
  max-height: calc(100vh - 96px - 72px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: rgba(4, 14, 26, 0.88);
  border: 1px solid rgba(0, 212, 240, 0.28);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(10px);
  color: rgba(230, 245, 255, 0.92);
  pointer-events: auto;
}

.panel-header {
  padding: 12px 14px 10px;
  border-bottom: 1px solid rgba(0, 212, 240, 0.14);
}

.panel-title {
  font-size: 13px;
  font-weight: 650;
  letter-spacing: 0.5px;
}

.panel-sub {
  margin-top: 3px;
  font-size: 10px;
  color: rgba(0, 212, 240, 0.65);
  letter-spacing: 1px;
}

.panel-state {
  padding: 18px 14px;
  font-size: 12px;
  color: rgba(180, 210, 230, 0.65);
}

.panel-state.error {
  color: #ff7b86;
}

.scope-row {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  gap: 4px;
}

.scope-item {
  flex: 1;
  text-align: center;
}

.scope-num {
  font-size: 18px;
  font-weight: 700;
  color: #00d4f0;
  line-height: 1.2;
}

.scope-label {
  margin-top: 2px;
  font-size: 10px;
  color: rgba(180, 210, 230, 0.55);
}

.scope-sep {
  width: 1px;
  height: 28px;
  background: rgba(0, 212, 240, 0.16);
}

.opt-chip {
  margin: 0 12px 8px;
  padding: 5px 10px;
  font-size: 11px;
  color: rgba(200, 230, 245, 0.8);
  border: 1px solid rgba(168, 160, 248, 0.35);
  background: rgba(168, 160, 248, 0.08);
}

.opt-chip strong {
  color: #a8a0f8;
  margin-left: 4px;
}

.effect-strip {
  display: flex;
  align-items: center;
  margin: 0 12px 10px;
  padding: 7px 6px;
  border: 1px solid rgba(46, 213, 115, 0.2);
  background: rgba(46, 213, 115, 0.05);
}

.eff {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.eff-val {
  font-size: 12px;
  font-weight: 650;
  color: #2ed573;
}

.eff-lab {
  font-size: 9px;
  color: rgba(180, 210, 230, 0.5);
}

.eff-sep {
  width: 1px;
  height: 18px;
  background: rgba(46, 213, 115, 0.2);
}

.queue-tabs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  padding: 0 10px 8px;
}

.queue-tab {
  box-sizing: border-box;
  border: 1px solid rgba(0, 212, 240, 0.18);
  background: rgba(0, 30, 48, 0.45);
  color: rgba(180, 210, 230, 0.65);
  font-size: 10px;
  padding: 6px 2px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.queue-tab.active {
  color: #00d4f0;
  border-color: rgba(0, 212, 240, 0.45);
  background: rgba(0, 212, 240, 0.1);
}

.tab-cnt {
  font-size: 11px;
  font-weight: 700;
}

.queue-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.queue-item {
  box-sizing: border-box;
  width: 100%;
  text-align: left;
  border: 1px solid rgba(0, 212, 240, 0.16);
  background: rgba(0, 24, 40, 0.55);
  color: inherit;
  padding: 8px 10px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.queue-item:hover,
.queue-item.active {
  border-color: rgba(0, 212, 240, 0.55);
  background: rgba(0, 80, 100, 0.28);
}

.qi-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
}

.qi-type {
  font-size: 10px;
  color: rgba(0, 212, 240, 0.75);
  letter-spacing: 1px;
}

.qi-badge {
  font-size: 10px;
  color: rgba(180, 210, 230, 0.7);
}

.queue-item.st-critical .qi-badge {
  color: #ff4757;
}
.queue-item.st-warning .qi-badge {
  color: #f5a623;
}
.queue-item.st-optimizing .qi-badge {
  color: #a8a0f8;
}
.queue-item.st-optimized .qi-badge {
  color: #2ed573;
}

.qi-name {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.35;
}

.qi-desc {
  margin-top: 3px;
  font-size: 10px;
  color: rgba(180, 210, 230, 0.55);
  line-height: 1.4;
}

.queue-empty {
  padding: 16px 8px;
  text-align: center;
  font-size: 11px;
  color: rgba(180, 210, 230, 0.4);
  font-style: italic;
}
</style>

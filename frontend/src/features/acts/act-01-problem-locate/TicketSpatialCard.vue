<script setup>
/**
 * 幕 1 · 问题定位 — 左侧结果卡
 * 前半（工单落地）：诊断工单字段
 * 后半（定位确认）：空间对象（三路口 + 问题路段）
 */
import { computed, onMounted } from 'vue';
import { DIAGNOSIS_TICKET, SPATIAL_SCENE, PROBLEM_LINK } from './fixture.js';

const props = defineProps({
  mode: { type: String, default: 'ticket' }, // 'ticket' | 'spatial'
});

const emit = defineEmits(['reveal-done']);

const ticketFields = computed(() => [
  { key: 'object', label: '对象', value: DIAGNOSIS_TICKET.object_type_label || '路段' },
  { key: 'link', label: '问题路段', value: DIAGNOSIS_TICKET.link_name },
  { key: 'intersection', label: '下游路口', value: DIAGNOSIS_TICKET.intersection_name },
  { key: 'time', label: '时间', value: DIAGNOSIS_TICKET.time_range },
  { key: 'period', label: '时段', value: DIAGNOSIS_TICKET.period },
  { key: 'direction', label: '方向', value: `${DIAGNOSIS_TICKET.direction} · ${DIAGNOSIS_TICKET.movement}` },
  { key: 'problem', label: '问题', value: DIAGNOSIS_TICKET.problem_type },
  { key: 'constraint', label: '约束', value: DIAGNOSIS_TICKET.constraint_text },
  { key: 'scope', label: '诊断范围', value: DIAGNOSIS_TICKET.diagnosis_scope },
  { key: 'goal', label: '治理目标', value: DIAGNOSIS_TICKET.governance_goal },
]);

const spatialSections = computed(() => [
  {
    title: '下游路口',
    rows: [
      { label: '路口', value: SPATIAL_SCENE.target.inter_name },
      { label: '流向', value: `${SPATIAL_SCENE.target.direction} · ${SPATIAL_SCENE.target.movement}` },
    ],
  },
  {
    title: '上游路口',
    rows: SPATIAL_SCENE.upstream_nodes.map((n) => ({
      label: n.role === 'upstream' ? '上游' : '节点',
      value: `${n.inter_name}（${Math.round(n.distance_m)} m）`,
    })),
  },
  {
    title: '问题路段',
    rows: [
      { label: '路段', value: PROBLEM_LINK.roadName },
      { label: '排队', value: `${PROBLEM_LINK.queueLengthM} m / 蓄车 ${PROBLEM_LINK.storageLengthM} m` },
      { label: '速度', value: `${PROBLEM_LINK.avgSpeedKmh.toFixed(1)} km/h（红）` },
    ],
  },
  {
    title: '空间关系',
    rows: [{ label: '主路径', value: SPATIAL_SCENE.main_path }],
  },
]);

onMounted(() => {
  // 揭示完成信号（供舞台退出栅栏）
  setTimeout(() => emit('reveal-done'), 520);
});
</script>

<template>
  <div class="locate-card">
    <div class="card-header">
      <span class="header-dot"></span>
      <span class="header-title">{{ mode === 'ticket' ? '诊断工单' : '问题定位' }}</span>
    </div>

    <template v-if="mode === 'ticket'">
      <div v-for="f in ticketFields" :key="f.key" class="field-row">
        <span class="field-label">{{ f.label }}</span>
        <span class="field-value">{{ f.value }}</span>
      </div>
    </template>

    <template v-else>
      <div v-for="(sec, i) in spatialSections" :key="i" class="spatial-section">
        <div class="section-title">{{ sec.title }}</div>
        <div v-for="(row, j) in sec.rows" :key="j" class="field-row">
          <span class="field-label">{{ row.label }}</span>
          <span class="field-value">{{ row.value }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.locate-card {
  background: rgba(6, 14, 26, 0.9);
  border: 1px solid rgba(0, 212, 240, 0.28);
  border-left: 2px solid rgba(0, 212, 240, 0.75);
  padding: 12px 14px;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(0, 212, 240, 0.16);
  margin-bottom: 8px;
}

.header-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #00d4f0;
  box-shadow: 0 0 8px rgba(0, 212, 240, 0.6);
}

.header-title {
  font-size: 12px;
  font-weight: 600;
  color: #00d4f0;
  letter-spacing: 1px;
}

.field-row {
  display: flex;
  gap: 10px;
  padding: 3px 0;
  align-items: baseline;
}

.field-label {
  flex-shrink: 0;
  width: 62px;
  font-size: 10px;
  color: rgba(180, 210, 230, 0.55);
  letter-spacing: 0.5px;
}

.field-value {
  font-size: 11px;
  color: rgba(220, 240, 255, 0.88);
  line-height: 1.5;
  word-break: break-all;
}

.spatial-section {
  padding-top: 6px;
}

.spatial-section + .spatial-section {
  border-top: 1px dashed rgba(0, 212, 240, 0.14);
  margin-top: 4px;
}

.section-title {
  font-size: 10px;
  color: rgba(0, 212, 240, 0.65);
  letter-spacing: 1.5px;
  margin-bottom: 2px;
}
</style>

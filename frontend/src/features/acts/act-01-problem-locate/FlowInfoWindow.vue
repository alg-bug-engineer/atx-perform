<script setup>
/**
 * 流向信息窗口（幕 1 · 问题定位）
 *
 * 针对北向南流向奥体西路方向，展示关键交通指标：
 * 车流量 / 排队比 / 延误指数 / 拥堵指数
 *
 * 可复用：主工程与独立运行环境共用；指标通过 props 注入。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { PROJECTION } from './fixture.js';

const props = defineProps({
  /** 锚点路口 key（fixture.INTERSECTIONS 的键） */
  anchor: { type: String, required: true },
  anchorLon: { type: Number, required: true },
  anchorLat: { type: Number, required: true },
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  metrics: {
    type: Array,
    default: () => [],
    // [{ key, label, value, unit, status: normal|warn|danger|gap, hint }]
  },
  /** 东西进口车流分类 + 影响预测（存在时替代 metrics 栅格） */
  turnFlow: {
    type: Object,
    default: null,
    // {
    //   turns:  [{ key, label, value, unit, status, hint }],  // 直行/左转/右转
    //   impact: [{ key, label, value, unit, status, hint }],  // 南北配时影响预测
    // }
  },
  /** 底部流向标签 */
  flowDir: { type: String, default: '北向南 ↓' },
  /** 底部数据来源标签 */
  source: { type: String, default: '专家值 · 270 m 排队' },
  visible: { type: Boolean, default: false },
  /** 相对地图视口的像素偏移（微调锚点位置用） */
  offsetX: { type: Number, default: 0 },
  offsetY: { type: Number, default: 0 },
});

const emit = defineEmits(['reveal-done']);

// 定位态镜头：高度 120、FOV 45°，地面可见半高 ≈ 49.7 世界单位
const HOLD_VISIBLE_HALF = Math.tan(((PROJECTION.holdCamFovDeg / 2) * Math.PI) / 180)
  * PROJECTION.holdCamHeight;

/** 走廊中点（镜头看向的锚点） */
const CORRIDOR_CENTER = {
  lon: (117.1112 + 117.111376) / 2,
  lat: (36.6651 + 36.659469) / 2,
};

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/** 经纬度 → 世界坐标（对齐 geo/loader.project） */
function worldOf(lon, lat) {
  const dx = ((lon - PROJECTION.centerLon) * Math.cos(toRad(PROJECTION.centerLat)) * toRad(1) * 6371000) / PROJECTION.metersPerUnit;
  const dy = ((lat - PROJECTION.centerLat) * toRad(1) * 6371000) / PROJECTION.metersPerUnit;
  return { x: dx, y: dy };
}

const centerWorld = worldOf(CORRIDOR_CENTER.lon, CORRIDOR_CENTER.lat);
const anchorWorld = computed(() => worldOf(props.anchorLon, props.anchorLat));

/** 视口宽高比（用于水平方向换算） */
const viewportAspect = ref(16 / 9);
let resizeObserver = null;
function updateAspect() {
  viewportAspect.value = window.innerWidth / Math.max(1, window.innerHeight);
}

onMounted(() => {
  updateAspect();
  resizeObserver = new ResizeObserver(updateAspect);
  resizeObserver.observe(document.documentElement);
  window.addEventListener('resize', updateAspect);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  window.removeEventListener('resize', updateAspect);
});

/** 世界坐标 → 屏幕百分比（镜头上北下南：北在上） */
const style = computed(() => {
  const dx = anchorWorld.value.x - centerWorld.x;
  const dy = anchorWorld.value.y - centerWorld.y;
  const pctX = 50 + (dx / (HOLD_VISIBLE_HALF * viewportAspect.value)) * 50 + props.offsetX;
  const pctY = 50 - (dy / HOLD_VISIBLE_HALF) * 50 + props.offsetY;
  return {
    left: `${pctX}%`,
    top: `${pctY}%`,
  };
});

/** 指标状态 → 颜色 */
function statusColor(status) {
  switch (status) {
    case 'warn':
      return 'var(--win-warn, #ffb020)';
    case 'danger':
      return 'var(--win-danger, #ff5252)';
    case 'gap':
      return 'var(--win-gap, #ff9800)';
    default:
      return 'var(--win-normal, #7ee9ff)';
  }
}

function statusTag(status) {
  switch (status) {
    case 'warn':
      return '接近预警';
    case 'danger':
      return '拥堵';
    case 'gap':
      return '数据缺口';
    default:
      return '';
  }
}

function onTransitionEnd() {
  if (props.visible) emit('reveal-done');
}
</script>

<template>
  <transition name="flowwin-fade">
    <div
      v-if="visible"
      class="flow-info-window"
      :style="style"
      @transitionend="onTransitionEnd"
    >
      <!-- 锚点连线 -->
      <div class="fiw-connector"></div>

      <div class="fiw-card">
        <div class="fiw-header">
          <span class="fiw-dot"></span>
          <div class="fiw-titles">
            <div class="fiw-title">{{ title }}</div>
            <div class="fiw-subtitle">{{ subtitle }}</div>
          </div>
        </div>

        <template v-if="turnFlow">
          <!-- 进口车流分类（直行/左转/右转） -->
          <div class="fiw-section-label">进口车流 · 辆/h</div>
          <div class="fiw-turns">
            <div
              v-for="t in turnFlow.turns"
              :key="t.key"
              class="fiw-turn"
              :class="`fiw-status-${t.status}`"
              :title="t.hint || ''"
            >
              <span class="fiw-turn-label">{{ t.label }}</span>
              <span class="fiw-turn-value" :style="{ color: statusColor(t.status) }">
                {{ t.value }}<span class="fiw-metric-unit">{{ t.unit }}</span>
              </span>
            </div>
          </div>

          <!-- 南北配时影响预测 -->
          <div class="fiw-section-label">南北配时影响预测</div>
          <div class="fiw-impact">
            <div
              v-for="it in turnFlow.impact"
              :key="it.key"
              class="fiw-impact-row"
              :class="`fiw-status-${it.status}`"
              :title="it.hint || ''"
            >
              <span class="fiw-impact-label">
                {{ it.label }}
                <span v-if="statusTag(it.status)" class="fiw-metric-tag">{{ statusTag(it.status) }}</span>
              </span>
              <span class="fiw-impact-value" :style="{ color: statusColor(it.status) }">
                {{ it.value }}<span class="fiw-metric-unit">{{ it.unit }}</span>
              </span>
            </div>
          </div>
        </template>

        <div v-else class="fiw-grid">
          <div
            v-for="m in metrics"
            :key="m.key"
            class="fiw-metric"
            :class="`fiw-status-${m.status}`"
            :title="m.hint || ''"
          >
            <div class="fiw-metric-label">
              {{ m.label }}
              <span v-if="statusTag(m.status)" class="fiw-metric-tag">{{ statusTag(m.status) }}</span>
            </div>
            <div class="fiw-metric-value" :style="{ color: statusColor(m.status) }">
              {{ m.value }}<span class="fiw-metric-unit">{{ m.unit }}</span>
            </div>
          </div>
        </div>

        <div class="fiw-footer">
          <span class="fiw-flow-dir">{{ flowDir }}</span>
          <span class="fiw-source">{{ source }}</span>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.flow-info-window {
  position: fixed;
  z-index: 46;
  pointer-events: auto;
  transform: translate(-50%, -100%);
  width: 300px;
}

.fiw-connector {
  position: absolute;
  left: 50%;
  bottom: -14px;
  transform: translateX(-50%);
  width: 2px;
  height: 14px;
  background: linear-gradient(to bottom, rgba(0, 212, 240, 0.55), rgba(0, 212, 240, 0));
}

.fiw-card {
  background: rgba(4, 14, 26, 0.88);
  border: 1px solid rgba(0, 212, 240, 0.35);
  border-top: 2px solid rgba(0, 212, 240, 0.75);
  backdrop-filter: blur(8px);
  padding: 10px 12px 8px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
}

.fiw-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 7px;
  border-bottom: 1px solid rgba(0, 212, 240, 0.16);
  margin-bottom: 7px;
}

.fiw-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #00d4f0;
  box-shadow: 0 0 8px rgba(0, 212, 240, 0.6);
  flex-shrink: 0;
}

.fiw-titles {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.fiw-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(230, 245, 255, 0.95);
  letter-spacing: 0.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fiw-subtitle {
  font-size: 10px;
  color: rgba(0, 212, 240, 0.7);
  letter-spacing: 1px;
}

.fiw-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.fiw-metric {
  padding: 6px 8px;
  background: rgba(0, 20, 36, 0.6);
  border: 1px solid rgba(0, 212, 240, 0.12);
  border-left: 2px solid rgba(126, 233, 255, 0.4);
}

.fiw-metric.fiw-status-warn {
  border-left-color: rgba(255, 176, 32, 0.65);
}

.fiw-metric.fiw-status-danger {
  border-left-color: rgba(255, 82, 82, 0.65);
}

.fiw-metric.fiw-status-gap {
  border-left-color: rgba(255, 152, 0, 0.6);
}

.fiw-metric-label {
  font-size: 10px;
  color: rgba(180, 210, 230, 0.75);
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 3px;
}

.fiw-metric-tag {
  font-size: 8px;
  padding: 0 4px;
  border-radius: 2px;
  letter-spacing: 0.5px;
}

.fiw-status-warn .fiw-metric-tag {
  background: rgba(255, 176, 32, 0.16);
  color: #ffb020;
}

.fiw-status-danger .fiw-metric-tag {
  background: rgba(255, 82, 82, 0.16);
  color: #ff5252;
}

.fiw-status-gap .fiw-metric-tag {
  background: rgba(255, 152, 0, 0.16);
  color: #ff9800;
}

.fiw-metric-value {
  font-size: 20px;
  font-weight: 700;
  font-family: 'SF Mono', 'JetBrains Mono', 'Courier New', monospace;
  line-height: 1.1;
}

.fiw-metric-unit {
  font-size: 10px;
  font-weight: 400;
  margin-left: 3px;
  color: rgba(180, 210, 230, 0.6);
}

.fiw-section-label {
  font-size: 9px;
  color: rgba(0, 212, 240, 0.68);
  letter-spacing: 1px;
  margin: 9px 0 4px;
  padding-left: 2px;
}

.fiw-turns {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}

.fiw-turn {
  padding: 6px 4px;
  text-align: center;
  background: rgba(0, 20, 36, 0.6);
  border: 1px solid rgba(0, 212, 240, 0.12);
  border-top: 2px solid rgba(126, 233, 255, 0.4);
}

.fiw-turn.fiw-status-warn {
  border-top-color: rgba(255, 176, 32, 0.65);
}

.fiw-turn.fiw-status-danger {
  border-top-color: rgba(255, 82, 82, 0.65);
}

.fiw-turn.fiw-status-gap {
  border-top-color: rgba(255, 152, 0, 0.6);
}

.fiw-turn-label {
  display: block;
  font-size: 10px;
  color: rgba(180, 210, 230, 0.75);
  margin-bottom: 3px;
}

.fiw-turn-value {
  font-size: 15px;
  font-weight: 700;
  font-family: 'SF Mono', 'JetBrains Mono', 'Courier New', monospace;
  line-height: 1.1;
}

.fiw-impact {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.fiw-impact-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px;
  background: rgba(0, 20, 36, 0.5);
  border: 1px solid rgba(0, 212, 240, 0.1);
  border-left: 2px solid rgba(126, 233, 255, 0.4);
}

.fiw-impact-row.fiw-status-warn {
  border-left-color: rgba(255, 176, 32, 0.65);
}

.fiw-impact-row.fiw-status-danger {
  border-left-color: rgba(255, 82, 82, 0.65);
}

.fiw-impact-row.fiw-status-gap {
  border-left-color: rgba(255, 152, 0, 0.6);
}

.fiw-impact-label {
  font-size: 10px;
  color: rgba(180, 210, 230, 0.75);
  display: flex;
  align-items: center;
  gap: 4px;
}

.fiw-impact-value {
  font-size: 13px;
  font-weight: 700;
  font-family: 'SF Mono', 'JetBrains Mono', 'Courier New', monospace;
}

.fiw-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 7px;
  padding-top: 6px;
  border-top: 1px solid rgba(0, 212, 240, 0.12);
}

.fiw-flow-dir {
  font-size: 10px;
  color: #7ee9ff;
  letter-spacing: 1px;
}

.fiw-source {
  font-size: 9px;
  color: rgba(180, 210, 230, 0.5);
}

.flowwin-fade-enter-active {
  transition: opacity 0.4s ease, transform 0.4s ease;
}

.flowwin-fade-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.flowwin-fade-enter-from,
.flowwin-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, calc(-100% + 10px));
}
</style>

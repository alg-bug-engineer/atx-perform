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
  /**
   * 逐条揭示：可见指标条数（指挥家 substeps 驱动）；
   * 0 = 全部展示（兼容旧用法）。
   */
  visibleMetricCount: { type: Number, default: 0 },
  /** 相对地图视口的像素偏移（微调锚点位置用） */
  offsetX: { type: Number, default: 0 },
  offsetY: { type: Number, default: 0 },
});

const emit = defineEmits(['reveal-done']);

/** 指标逐条揭示：visibleMetricCount>0 时只展示前 N 条 */
const shownMetrics = computed(() => {
  const n = Number(props.visibleMetricCount) || 0;
  if (n <= 0) return props.metrics;
  return props.metrics.slice(0, n);
});

// 定位态镜头：高度 135、FOV 45°，地面可见半高 ≈ 55.9 世界单位
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

/** 指标状态 → 语义标签（数值统一白/金色，状态只落在小标签上，对齐幕 3 卡片） */

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
              <span class="fiw-turn-value">
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
              <span class="fiw-impact-value">
                {{ it.value }}<span class="fiw-metric-unit">{{ it.unit }}</span>
              </span>
            </div>
          </div>
        </template>

        <div v-else class="fiw-rows">
          <template v-for="(m, i) in shownMetrics" :key="m.key">
            <!-- 首条指标作主值：幕 3 卡片式金色大数 -->
            <div v-if="i === 0" class="fiw-hero-block fiw-metric-in" :title="m.hint || ''">
              <div class="fiw-hero">
                {{ m.value }}<span class="fiw-hero-unit">{{ m.unit }}</span>
              </div>
              <div class="fiw-hero-label">
                {{ m.label }}
                <span v-if="statusTag(m.status)" class="fiw-metric-tag">{{ statusTag(m.status) }}</span>
              </div>
            </div>
            <!-- 其余指标：白字行 -->
            <div v-else class="fiw-row fiw-metric-in" :title="m.hint || ''">
              <span class="fiw-row-label">
                {{ m.label }}
                <span v-if="statusTag(m.status)" class="fiw-metric-tag">{{ statusTag(m.status) }}</span>
              </span>
              <span class="fiw-row-value">
                {{ m.value }}<span class="fiw-metric-unit">{{ m.unit }}</span>
              </span>
            </div>
          </template>
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
  width: 264px;
}

.fiw-connector {
  position: absolute;
  left: 50%;
  bottom: -14px;
  transform: translateX(-50%);
  width: 2px;
  height: 14px;
  background: linear-gradient(to bottom, rgba(240, 246, 255, 0.6), rgba(240, 246, 255, 0));
}

/* 卡片对齐幕 3 地图卡片：深底 + 金色描边 + 圆角 10 */
.fiw-card {
  background: rgba(3, 14, 25, 0.9);
  border: 1.75px solid rgba(245, 197, 66, 0.85);
  border-radius: 10px;
  padding: 12px 18px 10px;
}

.fiw-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.fiw-titles {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.fiw-title {
  font-size: 16px;
  font-weight: 500;
  color: rgba(175, 205, 220, 0.94);
  letter-spacing: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fiw-subtitle {
  font-size: 11px;
  color: rgba(150, 180, 198, 0.7);
  letter-spacing: 1px;
}

/* 主值：幕 3 卡片式 DIN 金色大数 */
.fiw-hero-block { margin: 2px 0 8px; }
.fiw-hero {
  font-family: 'DIN Alternate', 'PingFang SC', sans-serif;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #f5c542;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.fiw-hero-unit {
  font-size: 14px;
  font-weight: 500;
  margin-left: 4px;
  color: rgba(245, 197, 66, 0.8);
}
.fiw-hero-label {
  margin-top: 2px;
  font-size: 12px;
  color: rgba(150, 180, 198, 0.78);
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 其余指标：白字行 */
.fiw-rows { display: flex; flex-direction: column; gap: 6px; }
.fiw-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-size: 14px;
}
.fiw-row-label {
  color: rgba(205, 225, 238, 0.9);
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.fiw-row-value {
  color: rgba(230, 242, 250, 0.95);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.fiw-metric-unit {
  font-size: 11px;
  font-weight: 400;
  margin-left: 3px;
  color: rgba(150, 180, 198, 0.65);
}

.fiw-metric-tag {
  font-size: 9px;
  padding: 0 5px;
  border-radius: 3px;
  letter-spacing: 0.5px;
}
.fiw-status-warn .fiw-metric-tag { background: rgba(255, 255, 255, 0.12); color: #f0f6ff; }
.fiw-status-danger .fiw-metric-tag { background: rgba(255, 255, 255, 0.12); color: #f0f6ff; }
.fiw-status-gap .fiw-metric-tag { background: rgba(255, 255, 255, 0.12); color: #f0f6ff; }

.fiw-section-label {
  font-size: 10px;
  color: rgba(240, 246, 255, 0.8);
  letter-spacing: 1px;
  margin: 8px 0 4px;
}

.fiw-turns { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.fiw-turn { text-align: left; }
.fiw-turn-label {
  display: block;
  font-size: 11px;
  color: rgba(150, 180, 198, 0.75);
  margin-bottom: 2px;
}
.fiw-turn-value {
  font-family: 'DIN Alternate', 'PingFang SC', sans-serif;
  font-size: 17px;
  font-weight: 700;
  color: rgba(230, 242, 250, 0.95);
  font-variant-numeric: tabular-nums;
}

.fiw-impact { display: flex; flex-direction: column; gap: 4px; }
.fiw-impact-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 13px;
}
.fiw-impact-label {
  color: rgba(205, 225, 238, 0.9);
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.fiw-impact-value {
  font-weight: 600;
  color: rgba(230, 242, 250, 0.95);
  font-variant-numeric: tabular-nums;
}

.fiw-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid rgba(240, 246, 255, 0.2);
}
.fiw-flow-dir { font-size: 10px; color: rgba(240, 246, 255, 0.75); letter-spacing: 1px; }
.fiw-source { font-size: 9px; color: rgba(150, 180, 198, 0.55); }

.flowwin-fade-enter-active { transition: opacity 0.4s ease, transform 0.4s ease; }
.flowwin-fade-leave-active { transition: opacity 0.25s ease, transform 0.25s ease; }
.flowwin-fade-enter-from,
.flowwin-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, calc(-100% + 10px));
}

/* 指标逐条揭示：轻量上浮淡入 */
@keyframes fiw-metric-in {
  0% { opacity: 0; transform: translateY(6px); }
  100% { opacity: 1; transform: translateY(0); }
}
.fiw-metric-in { animation: fiw-metric-in 0.5s ease both; }
</style>

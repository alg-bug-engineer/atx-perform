<script setup>
import { computed, defineAsyncComponent } from 'vue';
import { activeAnalysisTab, ANALYSIS_TABS, switchAnalysisTab, cityScanTriggered } from '../../shared/analysis-state.js';

defineProps({
  selection: { type: Object, default: null },
  side:      { type: String, default: 'right' },
});

const PANEL_MAP = {
  'city':         () => import('../scenes/scene-d/panels/CityScanPanel.vue'),
  'region':       () => import('../scenes/scene-a/panels/ODFlowPanel.vue'),
  'arterial':     () => import('../scenes/scene-b/panels/CongestionPanel.vue'),
  'intersection': () => import('../scenes/scene-c/panels/IntersectionDiagPanel.vue'),
  'governance':   () => import('../scenes/scene-e/panels/GovernanceAdvicePanel.vue'),
};

const activePanel = computed(() => {
  const loader = PANEL_MAP[activeAnalysisTab.value];
  return loader ? defineAsyncComponent(loader) : null;
});

const currentTabLabel = computed(() =>
  ANALYSIS_TABS.find(t => t.key === activeAnalysisTab.value)?.label || ''
);

// 全域态势未扫描前：隐藏 header 和边框
const preScanCity = computed(() =>
  activeAnalysisTab.value === 'city' && !cityScanTriggered.value
);
</script>

<template>
  <section class="drilldown-sidebar" :class="{ 'pre-scan': preScanCity }">

    <!-- 左侧面板：显示4个 tab 导航 -->
    <template v-if="side === 'left'">
      <transition name="header-fade">
        <header v-if="!preScanCity" class="sidebar-header sidebar-header-left">
          <nav class="tab-bar">
            <button
              v-for="tab in ANALYSIS_TABS"
              :key="tab.key"
              class="tab-btn"
              :class="{ active: tab.key === activeAnalysisTab }"
              type="button"
              @click="switchAnalysisTab(tab.key)"
            >
              {{ tab.label }}
            </button>
          </nav>
          <span class="side-sub">态势总览</span>
        </header>
      </transition>
    </template>

    <!-- 右侧面板：显示当前 tab 名称 -->
    <template v-else>
      <transition name="header-fade">
        <header v-if="!preScanCity" class="sidebar-header sidebar-header-right">
          <span class="eyebrow">{{ currentTabLabel }}</span>
          <span class="divider">·</span>
          <span class="side-label">深度分析</span>
        </header>
      </transition>
    </template>

    <div class="panel-wrap" :class="{ 'panel-wrap-full': preScanCity }">
      <component
        :is="activePanel"
        v-if="activePanel"
        :selection="selection"
        :side="side"
      />
      <div v-else class="empty-state">当前暂无分析面板</div>
    </div>
  </section>
</template>

<style scoped>
.drilldown-sidebar {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #eef6ff;
  font-family: 'Courier New', monospace;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── 左侧 header ── */
.sidebar-header-left {
  flex-shrink: 0;
  background: rgba(6, 14, 26, 0.92);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding: 8px 10px 6px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.tab-bar {
  display: flex;
  gap: 2px;
}

.tab-btn {
  flex: 1;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.10);
  color: rgba(220, 240, 255, 0.50);
  font-family: 'Courier New', monospace;
  font-size: 11px;
  letter-spacing: 0.5px;
  padding: 5px 2px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  text-align: center;
  white-space: nowrap;
}

.tab-btn.active {
  background: rgba(0, 210, 240, 0.12);
  border-color: rgba(0, 210, 240, 0.50);
  color: #00d4f0;
  box-shadow: inset 0 -2px 0 rgba(0, 210, 240, 0.40);
}

.tab-btn:not(.active):hover {
  background: rgba(255, 255, 255, 0.07);
  color: rgba(220, 240, 255, 0.80);
  border-color: rgba(255, 255, 255, 0.18);
}

.side-sub {
  font-size: 10px;
  letter-spacing: 1px;
  color: rgba(220, 240, 255, 0.30);
  text-align: right;
}

/* ── 右侧 header ── */
.sidebar-header-right {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(6, 14, 26, 0.92);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding: 9px 14px;
}

.eyebrow {
  color: rgba(0, 220, 255, 0.90);
  font-size: 11px;
  letter-spacing: 2px;
  text-transform: uppercase;
}

.divider { color: rgba(255, 255, 255, 0.25); font-size: 11px; }

.side-label {
  color: rgba(220, 240, 255, 0.55);
  font-size: 11px;
  letter-spacing: 1px;
}

/* ── 内容区 ── */
.panel-wrap {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 8px 10px;
}

.empty-state {
  color: rgba(220, 240, 255, 0.55);
  font-size: 12px;
  line-height: 1.6;
  padding: 12px 0;
}

/* ── 扫描前状态：隐藏边框 ── */
.pre-scan {
  border-color: transparent !important;
  background: transparent !important;
}

.panel-wrap-full {
  padding: 0 !important;
}

/* ── header 淡入动画 ── */
.header-fade-enter-active {
  transition: opacity 0.4s ease, transform 0.4s ease;
}
.header-fade-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}
.header-fade-leave-active {
  transition: opacity 0.2s ease;
}
.header-fade-leave-to {
  opacity: 0;
}
</style>

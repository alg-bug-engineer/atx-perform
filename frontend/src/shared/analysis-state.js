import { ref, reactive, watch } from 'vue';
import { triggerBroadcast } from './broadcast-bus.js';

export const activeAnalysisTab = ref('city');

// 全局扫描是否已触发（用于协调 TrafficOriginScene 与 CityScanPanel 之间的状态）
export const cityScanTriggered = ref(false);

// 右侧智能体推理完成后置 true，左侧全域态势摘要模块监听此状态才显示
export const cityAnalysisDone = ref(false);

export function triggerGlobalScan() {
  cityScanTriggered.value = true;
  cityAnalysisDone.value = false;
  // 重新扫描时，允许城市面板再次播放推理动画
  seenAnimations.delete('city');
}

// ── 动画已展示缓存 ─────────────────────────────────────────────────────────────
// 记录「{tab}:{objectName}」是否已完整播放过一次（含指标计算 + 推理），
// 再次打开同一对象时直接跳过动画，避免重复假装"思考"。
export const seenAnimations = reactive(new Set());

export function hasSeenAnimation(key) {
  return seenAnimations.has(key);
}

export function markSeenAnimation(key) {
  seenAnimations.add(key);
}

// Tracks which tabs the user has actually visited (for progress visualization)
export const visitedTabsList = reactive(['city']);

export function hasVisited(key) {
  return visitedTabsList.includes(key);
}

// Context carried when agent-guided tab jumps occur
export const jumpContext = reactive({
  fromTab: '',
  fromLabel: '',
  target: '',
  reason: '',
});

// 当前诊断流程锁定的拥堵区域名称（跳转到区域诊断时写入，后续 tab 不覆盖）
export const selectedRegion = ref('');

export const ANALYSIS_TABS = [
  { key: 'city',         label: '全域态势' },
  { key: 'region',       label: '区域诊断' },
  { key: 'arterial',     label: '干线诊断' },
  { key: 'intersection', label: '路口诊断' },
  { key: 'governance',   label: '治理方案' },
];

const TAB_LABEL = Object.fromEntries(ANALYSIS_TABS.map(t => [t.key, t.label]));

export function switchAnalysisTab(key) {
  if (!visitedTabsList.includes(key)) visitedTabsList.push(key);
  jumpContext.fromTab = '';
  jumpContext.fromLabel = '';
  jumpContext.target = '';
  jumpContext.reason = '';
  triggerBroadcast(`tab_${key}`);
  activeAnalysisTab.value = key;
}

// 左侧面板所有子模块加载完成后置 true，右侧面板监听此状态才开始推理
export const leftPanelReady = ref(false);

// 右侧面板推理完成后置 true，3D 场景监听此状态决定何时显示交互元素
export const rightPanelReady = ref(false);

// 干线流量溯源可视化阶段是否激活（CongestionPanel phase-start 触发）
export const arterialTracingActive = ref(false);

// tab 切换时自动重置（左侧面板 onMounted 时也会主动重置）
watch(activeAnalysisTab, () => {
  leftPanelReady.value        = false;
  rightPanelReady.value       = false;
  arterialTracingActive.value = false;
});

export function switchAnalysisTabWithContext(key, target = '', reason = '') {
  jumpContext.fromTab = activeAnalysisTab.value;
  jumpContext.fromLabel = TAB_LABEL[activeAnalysisTab.value] || '';
  jumpContext.target = target;
  jumpContext.reason = reason;
  // 跳转到区域诊断时，锁定当前拥堵区域；后续 tab 跳转不覆盖
  if (key === 'region' && target) {
    selectedRegion.value = target;
  }
  if (!visitedTabsList.includes(key)) visitedTabsList.push(key);
  triggerBroadcast(`tab_${key}`);
  activeAnalysisTab.value = key;
}

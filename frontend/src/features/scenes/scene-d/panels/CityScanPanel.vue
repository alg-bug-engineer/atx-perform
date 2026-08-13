<script setup>
import { ref, computed, reactive } from 'vue';
import {
  switchAnalysisTab,
  switchAnalysisTabWithContext,
  visitedTabsList,
  hasVisited,
  cityScanTriggered,
  cityAnalysisDone,
  triggerGlobalScan,
  hasSeenAnimation,
  markSeenAnimation,
} from '../../../../shared/analysis-state.js';
import { showOdZones } from '../../../../shared/event-bus.js';
import AgentReasoning from '../../../../shared/components/AgentReasoning.vue';
import { triggerBroadcast, afterBroadcastDone } from '../../../../shared/broadcast-bus.js';

defineProps({
  selection: { type: Object, default: null },
  side:      { type: String, default: 'right' },
});

const levelColor = { 1: '#00ff88', 2: '#ffcc00', 3: '#ff8800', 4: '#ff2200' };
const trendIcon  = { up: '▲', down: '▼', stable: '—' };
const trendColor = { up: '#ff4400', down: '#00ff88', stable: '#ffcc00' };

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getPreviousWeekRange() {
  const today = new Date();
  const day = today.getDay() || 7;
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - day + 1);

  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);

  const lastSunday = new Date(thisMonday);
  lastSunday.setDate(thisMonday.getDate() - 1);

  return {
    startDate: formatDate(lastMonday),
    endDate: formatDate(lastSunday),
  };
}

const defaultScanRange = getPreviousWeekRange();

const scanConfig = reactive({
  startDate: defaultScanRange.startDate,
  endDate: defaultScanRange.endDate,
  period: 'amPeak',
});

const scanPeriods = [
  { key: 'allDay', label: '全天' },
  { key: 'amPeak', label: '早高峰' },
  { key: 'pmPeak', label: '晚高峰' },
  { key: 'offPeak', label: '平峰' },
];

const scanPeriodLabel = computed(() =>
  scanPeriods.find(p => p.key === scanConfig.period)?.label || '早高峰'
);

const scanRangeText = computed(() =>
  scanConfig.startDate === scanConfig.endDate
    ? scanConfig.startDate
    : `${scanConfig.startDate} 至 ${scanConfig.endDate}`
);

const cityOpsMetrics = [
  { label: '拥堵延时指数', value: '4.2', unit: '', status: '中度拥堵', tone: 'warn', trend: '较昨日 +0.6' },
  { label: '在途车辆数', value: '18.6', unit: '万辆', status: '高位运行', tone: 'danger', trend: '较均值 +12%' },
  { label: '快速路平均车速', value: '47.8', unit: 'km/h', status: '基本畅通', tone: 'ok', trend: '环比 -3.4' },
  { label: '地面主次干道平均车速', value: '28.6', unit: 'km/h', status: '缓行', tone: 'warn', trend: '环比 -5.1' },
];

const rankList = [
  { rank: 1, name: '舜耕路—山大路片区',    index: 7.8, affectedRoads: 12, delayMin: 28, trend: 'up',     level: 4 },
  { rank: 2, name: '泺源大街—经七路片区',  index: 6.4, affectedRoads: 9,  delayMin: 19, trend: 'stable', level: 3 },
  { rank: 3, name: '解放路—历山路片区',    index: 5.9, affectedRoads: 8,  delayMin: 16, trend: 'up',     level: 3 },
  { rank: 4, name: '工业南路片区',          index: 5.2, affectedRoads: 6,  delayMin: 12, trend: 'down',   level: 2 },
  { rank: 5, name: '北园大街片区',          index: 4.7, affectedRoads: 5,  delayMin: 10, trend: 'stable', level: 2 },
];

const flowSteps = [
  { label: '全域态势', tab: 'city' },
  { label: '区域诊断', tab: 'region' },
  { label: '干线诊断', tab: 'arterial' },
  { label: '路口诊断', tab: 'intersection' },
  { label: '治理方案', tab: 'governance' },
];

// Dynamic completion state based on visited tabs
const stepStates = computed(() =>
  flowSteps.map(s => ({
    ...s,
    done: hasVisited(s.tab),
  }))
);

// All diagnostic steps (city→governance) done → show completion banner
const allDone = computed(() =>
  ['city', 'region', 'arterial', 'intersection', 'governance'].every(t => hasVisited(t))
);

// ── 右侧多阶段推理
const cityPhases = [
  {
    type: 'planning', title: '任务规划',
    items: [
      '读取全城 18 个片区实时拥堵指数',
      '提取近 72 小时历史趋势数据',
      '识别严重拥堵片区（指数 ≥4.0）',
      '综合权重排序，定位优化优先级',
    ],
  },
  {
    type: 'analyzing', title: '指标分析',
    steps: [
      '扫描 18 片区 → 发现 7 个拥堵指数 ≥4.0',
      '舜耕路片区拥堵延时指数最高（7.8），较昨日恶化↑',
      '解放路片区连续 3 日恶化趋势，需同步关注',
      '区域失衡系数 1.64，超过临界阈值（1.5）',
    ],
  },
];
const cityConclusion = '舜耕路—山大路片区拥堵权重排名全城 TOP1（指数 7.8↑），为唯一 4 级严重片区；建议以该片区为本次优化重点，联动干线协调与区域边界控流';

// 全域态势动画缓存（全局扫描后首次看过，再切回来不重播）
const skipCityAnim = computed(() => hasSeenAnimation('city'));

// 右侧推理完成标志
const reasoningDone = ref(false);

// 推理完成后各小模块的逐步显示状态
const showRankTitle    = ref(false);
const visibleRankCount = ref(0);
const showJumpRow      = ref(false);

let _cancelRankWait = null;

// 扫描动画中间状态（点击后转圈的那段时间）
const isScanning = ref(false);

// 扫描进度（0-100，用于环形动画文字提示）
const scanProgress = ref(0);

async function handleScanClick() {
  isScanning.value = true;
  scanProgress.value = 0;
  triggerGlobalScan(); // 通知 TrafficOriginScene 触发页面扫描视觉特效
  triggerBroadcast('scan_start');

  // 模拟扫描进度
  const steps = [
    { delay: 950,  pct: 18, text: '读取全城片区数据…' },
    { delay: 950,  pct: 36, text: '提取拥堵指数序列…' },
    { delay: 850,  pct: 55, text: '识别严重拥堵区域…'},
    { delay: 1950,  pct: 74, text: '综合权重排序中…'  },
    { delay: 850,  pct: 92, text: '生成优化优先级…'  },
    { delay: 1650,  pct: 100, text: '扫描完成'         },
  ];

  for (const step of steps) {
    await new Promise(r => setTimeout(r, step.delay));
    scanProgress.value = step.pct;
    scanStepText.value = step.text;
    if (step.broadcast) triggerBroadcast(step.broadcast);
  }

  await new Promise(r => setTimeout(r, 650));
  triggerBroadcast('scan_done');
  isScanning.value = false;
}

const scanStepText = ref('初始化扫描程序…');

function handleReasoningDone() {
  const wasSeen = skipCityAnim.value; // 在 mark 之前捕获
  reasoningDone.value = true;
  markSeenAnimation('city');
  cityAnalysisDone.value = true; // 通知左侧摘要模块可以显示
  showOdZones();

  if (wasSeen) {
    showRankTitle.value    = true;
    visibleRankCount.value = rankList.length;
    showJumpRow.value      = true;
    return;
  }
  // 等 agent_done 播报完成后再逐步显示排行榜
  _cancelRankWait = afterBroadcastDone(() => {
    _cancelRankWait = null;
    setTimeout(() => { showRankTitle.value = true; }, 200);
    rankList.forEach((_, i) => {
      setTimeout(() => { visibleRankCount.value = i + 1; }, 600 + i * 700);
    });
    setTimeout(() => { showJumpRow.value = true; }, 600 + rankList.length * 700 + 500);
  });
}

function enterRegion(rankItem) {
  switchAnalysisTabWithContext(
    'region',
    rankItem.name,
    `拥堵指数 ${rankItem.index}，影响 ${rankItem.affectedRoads} 条路段，延误 ${rankItem.delayMin} min`
  );
}
</script>

<template>
  <div class="panel">

    <!-- ── LEFT ── -->
    <template v-if="side === 'left'">

      <div class="section">
        <div class="sec-label">当前城市运行态势</div>
        <div class="ops-grid">
          <div
            v-for="m in cityOpsMetrics"
            :key="m.label"
            class="ops-card"
            :class="m.tone"
          >
            <div class="ops-head">
              <span class="ops-label">{{ m.label }}</span>
              <span class="ops-status">{{ m.status }}</span>
            </div>
            <div class="ops-main">
              <span class="ops-value">{{ m.value }}</span>
              <span v-if="m.unit" class="ops-unit">{{ m.unit }}</span>
            </div>
            <div class="ops-trend">{{ m.trend }}</div>
          </div>
        </div>
      </div>

      <transition name="result-fade">
        <div v-if="!cityScanTriggered" class="left-pending">
          <div class="lp-icon">◎</div>
          <div class="lp-text">请在右侧面板点击<br><b>全局扫描</b>以开始分析</div>
        </div>
      </transition>

      <transition name="result-fade">
       <div v-if="cityScanTriggered" class="left-content">

        <!-- 全域态势摘要：推理完成后才显示 -->
        <transition name="result-fade">
          <div v-if="cityAnalysisDone" class="section">
            <div class="sec-label">全域态势摘要</div>
            <div class="sum4">
              <div class="sc"><span class="sc-v">18</span><span class="sc-l">扫描片区</span></div>
              <div class="sc"><span class="sc-v warn">7</span><span class="sc-l">拥堵片区</span></div>
              <div class="sc"><span class="sc-v warn">7.8</span><span class="sc-l">最高拥堵指数</span></div>
              <div class="sc"><span class="sc-v">4.2</span><span class="sc-l">全城均值</span></div>
            </div>
          </div>
        </transition>

        <!-- 推理进行中的占位提示 -->
        <transition name="result-fade">
          <div v-if="!cityAnalysisDone" class="summary-pending">
            <span class="sp-spin">◈</span>
            <span class="sp-text">智能体分析中，态势摘要即将生成…</span>
          </div>
        </transition>

        <div class="section">
          <div class="sec-label" style="margin-bottom:7px">诊断研判流程</div>
          <div class="flow-steps">
            <template v-for="(s, i) in stepStates" :key="s.tab">
              <div
                class="fs"
                :class="{ done: s.done }"
                @click="switchAnalysisTab(s.tab)"
              >{{ s.label }}</div>
              <div v-if="i < flowSteps.length - 1" class="fs-arrow">→</div>
            </template>
          </div>

          <!-- Completion banner -->
          <transition name="banner-fade">
            <div v-if="allDone" class="complete-banner">
              <span class="cb-icon">◈</span>
              本轮闭环诊断已完成，智能体已生成治理方案
            </div>
          </transition>
        </div>

       </div><!-- /left-content -->
      </transition>

    </template>

    <!-- ── RIGHT ── -->
    <template v-else>
      <div class="section scan-config">
        <div class="sec-label">扫描条件</div>
        <div class="date-row">
          <label class="field">
            <span>开始日期</span>
            <input v-model="scanConfig.startDate" type="date" />
          </label>
          <label class="field">
            <span>结束日期</span>
            <input v-model="scanConfig.endDate" type="date" />
          </label>
        </div>
        <div class="period-tabs">
          <button
            v-for="p in scanPeriods"
            :key="p.key"
            type="button"
            class="period-tab"
            :class="{ active: scanConfig.period === p.key }"
            @click="scanConfig.period = p.key"
          >
            {{ p.label }}
          </button>
        </div>
      </div>

      <!-- 状态一：未触发扫描 → 展示全局扫描按钮 -->
      <transition name="scan-fade">
        <div v-if="!cityScanTriggered && !isScanning" class="scan-gate">
          <div class="sg-rings">
            <div class="sg-ring r1"></div>
            <div class="sg-ring r2"></div>
            <div class="sg-ring r3"></div>
            <div class="sg-icon">⊙</div>
          </div>
          <button class="sg-btn" @click="handleScanClick">全局扫描</button>
          <p class="sg-hint">点击开始全域态势扫描分析</p>
        </div>
      </transition>

      <!-- 状态二：扫描中 → 转圈特效 -->
      <transition name="scan-fade">
        <div v-if="isScanning" class="scanning-state">
          <div class="ss-ring-wrap">
            <svg class="ss-svg" viewBox="0 0 120 120">
              <circle class="ss-track" cx="60" cy="60" r="50" />
              <circle
                class="ss-progress"
                cx="60" cy="60" r="50"
                :stroke-dasharray="`${scanProgress * 3.14159} 314.159`"
              />
            </svg>
            <div class="ss-pct">{{ scanProgress }}<span>%</span></div>
          </div>
          <div class="ss-text">{{ scanStepText }}</div>
          <div class="ss-dots"><span></span><span></span><span></span></div>
        </div>
      </transition>

      <!-- 状态三：扫描完成 → 显示分析内容 -->
      <transition name="result-fade">
        <div v-if="cityScanTriggered && !isScanning" class="right-results">

          <!-- 多阶段推理（占满右侧，推理完成后自动收起；已看过则直接跳过） -->
          <AgentReasoning
            :phases="cityPhases"
            :conclusion="cityConclusion"
            :auto-collapse="true"
            :delay="650"
            :skip-animation="skipCityAnim"
            @done="handleReasoningDone"
          />

          <!-- 推理完成后展示诊断结果（各模块逐步出现） -->
          <div v-if="reasoningDone" class="rank-results">

            <!-- 标题先出 -->
            <div class="section module-reveal" :class="{ 'mod-visible': showRankTitle }">
              <div class="sec-label">拥堵片区排行 TOP5</div>
            </div>

            <!-- 卡片列表 -->
            <div class="rank-list flex1">
              <div
                v-for="item in rankList"
                :key="item.rank"
                class="rank-card module-reveal"
                :class="{ 'top1': item.rank === 1, 'mod-visible': item.rank <= visibleRankCount }"
                @click="enterRegion(item)"
              >
                <div class="rc-left">
                  <span class="rc-num" :style="{ color: item.rank === 1 ? '#ff2200' : levelColor[item.level] }">
                    {{ item.rank }}
                  </span>
                </div>
                <div class="rc-mid">
                  <div class="rc-name">{{ item.name }}</div>
                  <div class="rc-meta">影响 {{ item.affectedRoads }} 条路段 · 延误 {{ item.delayMin }}min</div>
                  <div class="rc-bar-wrap">
                    <div class="rc-bar" :style="{ width: (item.index / 10 * 100) + '%', background: levelColor[item.level] }"></div>
                  </div>
                </div>
                <div class="rc-right">
                  <span class="rc-idx" :style="{ color: levelColor[item.level] }">{{ item.index }}</span>
                  <span class="rc-idxl">拥堵指数</span>
                  <span class="rc-trend" :style="{ color: trendColor[item.trend] }">{{ trendIcon[item.trend] }}</span>
                </div>
                <div class="rc-jump-hint">→ 区域诊断</div>
              </div>
            </div>

            <!-- 最后出现跳转行 -->
            <div class="section module-reveal" :class="{ 'mod-visible': showJumpRow }">
              <div class="jump-row">
                <button class="jump-btn" @click="enterRegion(rankList[0])">进入区域诊断 →</button>
              </div>
            </div>

          </div>

        </div>
      </transition>

    </template>
  </div>
</template>

<style scoped>
.panel { height: 100%; display: flex; flex-direction: column; gap: 8px; overflow: hidden; }
.section {
  flex-shrink: 0;
  background: rgba(6, 14, 26, 0.76);
  border: 1px solid rgba(0, 200, 230, 0.25);
  padding: 8px;
}
.flex1 { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.rank-list.flex1 {
  display: flex;
  flex-direction: column;
  gap: 5px;
  overflow: hidden;
  background: rgba(6, 14, 26, 0.76);
  border: 1px solid rgba(0, 200, 230, 0.25);
  padding: 8px;
}

.sec-label { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: rgba(0,200,230,0.80); margin-bottom: 5px; }

/* scan bar */
.scan-bar { display: flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.22); padding: 6px 9px; overflow: hidden; }
.sf { font-size: 12px; color: rgba(220,240,255,0.70); white-space: nowrap; }
.sf b { color: #eef6ff; margin-left: 3px; }
.ss { margin-left: auto; display: flex; align-items: center; gap: 4px; font-size: 11px; color: #34d89a; }
.ss i { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #34d89a; box-shadow: 0 0 5px #34d89a; animation: blink 2s infinite; }
@keyframes blink { 0%,100%{opacity:1}50%{opacity:0.3} }

/* summary */
.sum4 { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
.sc { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.22); padding: 7px 9px; display: flex; flex-direction: column; }
.sc-v { font-size: 20px; color: #00d4f0; line-height: 1; }
.sc-v.warn { color: #ff9500; }
.sc-l { font-size: 10px; color: rgba(220,240,255,0.62); margin-top: 2px; white-space: nowrap; }

/* city operation metrics */
.ops-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.ops-card {
  min-width: 0;
  background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03));
  border: 1px solid rgba(255,255,255,0.22);
  padding: 8px;
  position: relative;
  overflow: hidden;
}
.ops-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: rgba(0,212,240,0.85);
  box-shadow: 0 0 8px rgba(0,212,240,0.45);
}
.ops-card.warn::before { background: #ff9500; box-shadow: 0 0 8px rgba(255,149,0,0.45); }
.ops-card.danger::before { background: #ff4400; box-shadow: 0 0 8px rgba(255,68,0,0.45); }
.ops-card.ok::before { background: #34d89a; box-shadow: 0 0 8px rgba(52,216,154,0.45); }
.ops-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 5px; }
.ops-label { font-size: 10px; color: rgba(220,240,255,0.62); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ops-status {
  flex-shrink: 0;
  font-size: 10px;
  color: rgba(220,240,255,0.48);
  border: 1px solid rgba(255,255,255,0.22);
  padding: 1px 5px;
  background: rgba(255,255,255,0.04);
}
.ops-main { display: flex; align-items: baseline; gap: 3px; }
.ops-value { font-size: 21px; line-height: 1; color: #eef6ff; font-family: 'Courier New', monospace; font-weight: bold; }
.ops-unit { font-size: 10px; color: rgba(220,240,255,0.52); }
.ops-trend { margin-top: 4px; font-size: 10px; color: rgba(220,240,255,0.45); }

/* flow steps */
.flow-steps { display: flex; align-items: center; gap: 3px; flex-wrap: wrap; margin-bottom: 6px; }
.fs {
  font-size: 11px;
  padding: 3px 8px;
  border: 1px solid rgba(255,255,255,0.20);
  color: rgba(220,240,255,0.50);
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.fs:hover       { border-color: rgba(0,210,240,0.45); color: rgba(220,240,255,0.80); }
.fs.done        { border-color: rgba(52,216,154,0.55); color: #34d89a; }
.fs-arrow       { font-size: 11px; color: rgba(255,255,255,0.25); }

/* completion banner */
.complete-banner {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(52, 216, 154, 0.08);
  border: 1px solid rgba(52, 216, 154, 0.55);
  padding: 6px 9px;
  font-size: 11px;
  color: #34d89a;
  line-height: 1.5;
  margin-top: 6px;
}
.cb-icon { font-size: 12px; flex-shrink: 0; }

.banner-fade-enter-active { transition: opacity 0.5s, transform 0.5s; }
.banner-fade-enter-from   { opacity: 0; transform: translateY(6px); }

/* rank cards */
.rank-card {
  display: flex;
  gap: 7px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.20);
  padding: 8px;
  flex-shrink: 0;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  position: relative;
}
.rank-card:hover { background: rgba(0,210,240,0.06); border-color: rgba(0,210,240,0.28); }
.top1 { border-color: rgba(220,60,30,0.65) !important; background: rgba(200,40,20,0.07) !important; }
.top1:hover { background: rgba(200,40,20,0.12) !important; }
.rc-left { display: flex; align-items: center; width: 20px; flex-shrink: 0; }
.rc-num  { font-size: 20px; font-weight: bold; line-height: 1; }
.rc-mid  { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.rc-name { font-size: 12px; color: #eef6ff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rc-meta { font-size: 11px; color: rgba(220,240,255,0.58); }
.rc-bar-wrap { height: 4px; background: rgba(255,255,255,0.10); border-radius: 2px; overflow: hidden; }
.rc-bar { height: 100%; border-radius: 2px; }
.rc-right { display: flex; flex-direction: column; align-items: flex-end; justify-content: center; flex-shrink: 0; width: 50px; }
.rc-idx  { font-size: 19px; font-weight: bold; line-height: 1; }
.rc-idxl { font-size: 10px; color: rgba(220,240,255,0.45); }
.rc-trend { font-size: 11px; }
.rc-jump-hint {
  position: absolute;
  right: 8px;
  bottom: 4px;
  font-size: 10px;
  color: rgba(0,210,240,0.30);
  transition: color 0.15s;
}
.rank-card:hover .rc-jump-hint { color: rgba(0,210,240,0.70); }

/* jump */
.jump-row { display: flex; align-items: center; justify-content: space-between; border-top: 1px solid rgba(255,255,255,0.10); padding-top: 9px; }
.jump-lbl { font-size: 12px; color: rgba(220,240,255,0.65); }
.jump-btn { background: rgba(0,210,240,0.10); border: 1px solid rgba(0,210,240,0.40); color: #00d4f0; font-size: 11px; padding: 4px 12px; cursor: pointer; font-family: inherit; letter-spacing: 1px; transition: background 0.15s; }
.jump-btn:hover { background: rgba(0,210,240,0.22); }

/* 右侧推理结果区 */
.right-results {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
}
.rank-results {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
}

/* ── 扫描门控（未扫描时的按钮区域）── */
.scan-config { display: flex; flex-direction: column; gap: 7px; }
.scan-config .sec-label { margin-bottom: 0; }
.date-row { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.field span {
  font-size: 10px;
  color: rgba(220, 240, 255, 0.50);
  letter-spacing: 0.5px;
}
.field input {
  min-width: 0;
  height: 27px;
  background: rgba(0, 20, 35, 0.72);
  border: 1px solid rgba(0, 229, 255, 0.40);
  color: rgba(238, 246, 255, 0.88);
  font-family: 'Courier New', monospace;
  font-size: 11px;
  padding: 0 7px;
  outline: none;
}
.field input:focus {
  border-color: rgba(0, 229, 255, 0.55);
  box-shadow: 0 0 8px rgba(0, 229, 255, 0.14);
}
.period-tabs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 5px;
}
.period-tab {
  height: 26px;
  border: 1px solid rgba(255,255,255,0.20);
  background: rgba(255,255,255,0.04);
  color: rgba(220,240,255,0.58);
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s, box-shadow 0.15s;
}
.period-tab:hover {
  border-color: rgba(0,229,255,0.34);
  color: rgba(220,240,255,0.82);
}
.period-tab.active {
  border-color: rgba(0,229,255,0.55);
  background: rgba(0,229,255,0.12);
  color: #00e5ff;
  box-shadow: inset 0 0 12px rgba(0,229,255,0.08);
}

.scan-gate {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 24px 16px;
}

.sg-rings {
  position: relative;
  width: 90px;
  height: 90px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sg-ring {
  position: absolute;
  border-radius: 50%;
  border: 1px solid rgba(0, 229, 255, 0.38);
  animation: sgPulse 2.4s ease-in-out infinite;
}
.r1 { width: 90px; height: 90px; animation-delay: 0s; }
.r2 { width: 66px; height: 66px; animation-delay: 0.4s; border-color: rgba(0, 229, 255, 0.50); }
.r3 { width: 44px; height: 44px; animation-delay: 0.8s; border-color: rgba(0, 229, 255, 0.65); }
.sg-icon {
  font-size: 20px;
  color: rgba(0, 229, 255, 0.70);
  animation: sgSpin 6s linear infinite;
  z-index: 1;
}
@keyframes sgPulse {
  0%, 100% { transform: scale(1); opacity: 0.5; }
  50% { transform: scale(1.06); opacity: 1; }
}
@keyframes sgSpin { to { transform: rotate(360deg); } }

.sg-btn {
  padding: 8px 28px;
  border: 1px solid rgba(0, 229, 255, 0.55);
  background: rgba(0, 20, 35, 0.70);
  color: #00e5ff;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  letter-spacing: 3px;
  cursor: pointer;
  transition: background 0.2s, box-shadow 0.2s;
  position: relative;
  overflow: hidden;
}
.sg-btn::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent 0%, rgba(0,229,255,0.10) 50%, transparent 100%);
  transform: translateX(-100%);
  animation: sgShine 2.5s ease-in-out infinite;
}
@keyframes sgShine { to { transform: translateX(100%); } }
.sg-btn:hover {
  background: rgba(0, 229, 255, 0.14);
  box-shadow: 0 0 18px rgba(0, 229, 255, 0.30);
}

.sg-hint {
  font-size: 11px;
  color: rgba(220, 240, 255, 0.40);
  letter-spacing: 1px;
  text-align: center;
  line-height: 1.6;
  margin: 0;
}

/* ── 扫描中状态 ── */
.scanning-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
}

.ss-ring-wrap {
  position: relative;
  width: 120px;
  height: 120px;
}
.ss-svg {
  width: 120px;
  height: 120px;
  transform: rotate(-90deg);
}
.ss-track {
  fill: none;
  stroke: rgba(0, 229, 255, 0.12);
  stroke-width: 4;
}
.ss-progress {
  fill: none;
  stroke: #00e5ff;
  stroke-width: 4;
  stroke-linecap: round;
  stroke-dashoffset: 0;
  transition: stroke-dasharray 0.3s ease;
  filter: drop-shadow(0 0 6px rgba(0,229,255,0.6));
}
.ss-pct {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-family: 'Courier New', monospace;
  color: #00e5ff;
  font-weight: bold;
}
.ss-pct span { font-size: 12px; margin-left: 1px; opacity: 0.7; }

.ss-text {
  font-size: 11px;
  color: rgba(0, 229, 255, 0.80);
  letter-spacing: 2px;
  font-family: 'Courier New', monospace;
}

.ss-dots {
  display: flex;
  gap: 5px;
}
.ss-dots span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(0, 229, 255, 0.60);
  animation: ssDot 1.2s ease-in-out infinite;
}
.ss-dots span:nth-child(2) { animation-delay: 0.2s; }
.ss-dots span:nth-child(3) { animation-delay: 0.4s; }
@keyframes ssDot { 0%,100%{opacity:0.3;transform:scale(0.8)} 50%{opacity:1;transform:scale(1)} }

/* ── 左侧待扫描占位 ── */
.left-pending {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
}
.lp-icon {
  font-size: 32px;
  color: rgba(0, 229, 255, 0.20);
  animation: sgPulse 3s ease-in-out infinite;
}
.lp-text {
  font-size: 12px;
  color: rgba(220, 240, 255, 0.40);
  text-align: center;
  line-height: 1.8;
  letter-spacing: 0.5px;
}
.lp-text b {
  color: rgba(0, 229, 255, 0.65);
}

/* 左侧已扫描内容容器 */
.left-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
}

/* 摘要推理中占位 */
.summary-pending {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  background: rgba(6, 14, 26, 0.76);
  border: 1px solid rgba(0, 200, 230, 0.18);
  padding: 10px 10px;
  opacity: 0.65;
}

.sp-spin {
  font-size: 12px;
  color: rgba(0, 210, 240, 0.80);
  animation: spSpin 1.4s linear infinite;
  display: inline-block;
  flex-shrink: 0;
}

@keyframes spSpin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

.sp-text {
  font-size: 11px;
  color: rgba(0, 210, 240, 0.65);
  letter-spacing: 0.5px;
}

/* scan-bar 待扫描状态 */
.ss-wait {
  margin-left: auto;
  font-size: 11px;
  color: rgba(220, 240, 255, 0.35);
  letter-spacing: 1px;
}

/* 模块逐步显示 */
.module-reveal {
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.4s ease, transform 0.4s ease;
}
.module-reveal.mod-visible {
  opacity: 1;
  transform: translateY(0);
}

/* 过渡动画 */
.scan-fade-enter-active,
.scan-fade-leave-active {
  transition: opacity 0.4s ease, transform 0.4s ease;
  position: absolute;
  width: 100%;
}
.scan-fade-enter-from,
.scan-fade-leave-to {
  opacity: 0;
  transform: scale(0.96);
}

.result-fade-enter-active {
  transition: opacity 0.5s ease, transform 0.4s ease;
}
.result-fade-enter-from {
  opacity: 0;
  transform: translateY(10px);
}
</style>

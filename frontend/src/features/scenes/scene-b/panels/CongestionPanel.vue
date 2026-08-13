<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { switchAnalysisTab, switchAnalysisTabWithContext, leftPanelReady, rightPanelReady, arterialTracingActive, hasSeenAnimation, markSeenAnimation } from '../../../../shared/analysis-state.js';
import ContextHint from '../../../../shared/components/ContextHint.vue';
import AgentReasoning from '../../../../shared/components/AgentReasoning.vue';
import { triggerBroadcast, afterBroadcastDone } from '../../../../shared/broadcast-bus.js';

const props = defineProps({
  selection: { type: Object, default: null },
  side:      { type: String, default: 'right' },
});

// ── 动画缓存 key
const animKey = computed(() => `arterial:${props.selection?.name || '_'}`);
const skipAnim = computed(() => hasSeenAnimation(animKey.value));

// ── 左侧指标计算动画
const calcPhase       = ref('idle');
const calcStep        = ref(0);
const leftModuleCount = ref(0);

const calcSteps = [
  '获取干线路段实时流量',
  '计算各节点饱和度指标',
  '评估干线协调效率',
];

let _cancelCalcWait   = null;
let _cancelModuleWait = null;
const _calcTimers     = [];

onMounted(() => {
  if (props.side !== 'left') return;
  leftPanelReady.value = false;

  if (skipAnim.value) {
    calcPhase.value       = 'done';
    leftModuleCount.value = 3;
    leftPanelReady.value  = true;
    return;
  }

  // 立即显示加载外壳，等 Tab 播报完成后再推进步骤
  calcPhase.value = 'calculating';
  calcStep.value  = 0;

  _cancelCalcWait = afterBroadcastDone(() => {
    _cancelCalcWait = null;
    triggerBroadcast('metric_calculating_arterial', '正在计算干线诊断指标，获取实时流量并评估协调效率…');
    calcSteps.forEach((_, i) => {
      const t = setTimeout(() => { calcStep.value = i + 1; }, (i + 1) * 1900);
      _calcTimers.push(t);
    });
    const totalCalc = calcSteps.length * 1900 + 1700;
    const t = setTimeout(() => {
      calcPhase.value = 'done';
      setTimeout(() => { leftModuleCount.value = 1; }, 450);
      setTimeout(() => { leftModuleCount.value = 2; }, 1100);
      setTimeout(() => {
        leftModuleCount.value = 3;
        leftPanelReady.value  = true;
      }, 1750);
    }, totalCalc);
    _calcTimers.push(t);
  });
});

onUnmounted(() => {
  _cancelCalcWait?.();
  _cancelModuleWait?.();
  _calcTimers.forEach(t => clearTimeout(t));
  _calcTimers.length = 0;
});

const nodes = [
  { name: '交通街',   saturation: 0.61, queue: 95,  stops: 3.2, level: 2 },
  { name: '历山路',   saturation: 0.94, queue: 340, stops: 8.7, level: 4 },
  { name: '山大路',   saturation: 0.88, queue: 260, stops: 7.1, level: 4 },
  { name: '千佛山路', saturation: 0.72, queue: 140, stops: 4.8, level: 3 },
  { name: '文化路',   saturation: 0.55, queue: 80,  stops: 2.6, level: 2 },
];
const levelColor = { 1: '#00ff88', 2: '#ffcc00', 3: '#ff8800', 4: '#ff2200' };
const levelLabel = { 1: '畅通', 2: '缓行', 3: '拥堵', 4: '严重' };

const problemNodes = [...nodes].sort((a, b) => b.saturation - a.saturation).slice(0, 3);

const coordIssues = [
  { time: '07:30–09:00', loc: '历山路路口',  dir: '东进口直行',  issue: '上游绿波未覆盖，车辆二次停车' },
  { time: '07:45–08:30', loc: '山大路路口',  dir: '西进口左转',  issue: '与历山路放行时序冲突' },
  { time: '08:00–09:30', loc: '全线',        dir: '东西向主线',  issue: '历史绿波与当前流量不匹配' },
];

const historySchemes = [
  { name: '2023 早高峰绿波方案', match: 62, deviation: '流量偏高 23%' },
  { name: '2024 优化配时方案',   match: 78, deviation: '流量偏高 11%' },
];

const criticalIntersections = [
  { name: '经十路—历山路路口', grade: 'F', gradeColor: '#ff2200', issue: '西进口严重溢出', tab: 'intersection' },
];

// ── 右侧多阶段推理（历史方案数据复用为经验库结果）
const arterialPhases = [
  {
    type: 'planning', title: '任务规划',
    items: [
      '读取干线协调指标（行程时间 / 停车次数）',
      '分析不停车通过率与协调队列比',
      '排查各路口节点饱和度，识别瓶颈',
      '验证相位差与实测平均车速的匹配性',
    ],
  },
  {
    type: 'visualization',
    title: '干线流量溯源',
    broadcastKey: 'viz_arterial_flow_tracing',
    duration: 15000,
  },
  {
    type: 'analyzing', title: '指标分析',
    steps: [
      '历山路节点饱和度 0.94（最高），严重拥堵',
      '干线停车次数 8.7 次/辆（阈值 ≤3），超标 190%',
      '不停车通过率约 34%，绿波覆盖严重不足',
      '相位差偏移 >15s，车队到达时序与绿灯不匹配',
    ],
  },
  {
    type: 'searching', title: '经验库检索',
    query: '干线绿波相位差失配 + 高饱和瓶颈节点',
    results: [
      { name: '2023 早高峰绿波方案', match: 62, desc: '流量偏高 23%，需重新标定相位差后可参考' },
      { name: '2024 优化配时方案', match: 78, desc: '流量偏高 11%，协调效果尚可通过微调恢复' },
    ],
  },
];
const arterialConclusion = '干线协调失效：历山路节点饱和度 0.94 为全线最高，相位差脱离实测车速，绿波到达吻合率仅 34%；建议重新标定绿波方案并优先处理历山路路口相位供给';

const reasoningDone = ref(false);
const visibleModuleCount = ref(0);

function handlePhaseStart(phase) {
  if (phase.title === '干线流量溯源') {
    arterialTracingActive.value = true;
  }
}

function handleReasoningDone() {
  const wasSeen = skipAnim.value;
  reasoningDone.value = true;
  markSeenAnimation(animKey.value);
  if (wasSeen) {
    visibleModuleCount.value = 3;
    rightPanelReady.value = true;
    return;
  }

  // 等 agent_done 播报完成后再逐步显示结果模块
  _cancelModuleWait = afterBroadcastDone(() => {
    _cancelModuleWait = null;
    setTimeout(() => { visibleModuleCount.value = 1; }, 200);
    setTimeout(() => { visibleModuleCount.value = 2; }, 800);
    setTimeout(() => {
      visibleModuleCount.value = 3;
      rightPanelReady.value = true;   // 最后一个模块出现后通知 3D 场景
    }, 1400);
  });
}
</script>

<template>
  <div class="panel">

    <!-- ── LEFT ── -->
    <template v-if="side === 'left'">

      <ContextHint />

      <!-- 面包屑导航（始终显示） -->
      <div class="breadcrumb" @click="switchAnalysisTab('region')">
        <span class="bc-back">← 区域诊断</span>
        <span class="bc-sep">/</span>
        <span class="bc-cur">干线分析</span>
      </div>

      <!-- 指标计算中 -->
      <div v-if="calcPhase === 'calculating'" class="calc-loading">
        <div class="calc-header">
          <span class="calc-spin">◎</span>
          <span class="calc-title">正在计算指标</span>
        </div>
        <div class="calc-steps">
          <div
            v-for="(step, i) in calcSteps"
            :key="i"
            class="calc-step"
            :class="{
              'step-done':    calcStep > i + 1,
              'step-active':  calcStep === i + 1,
              'step-pending': calcStep < i + 1,
            }"
          >
            <span class="step-status">
              <template v-if="calcStep > i + 1">✓</template>
              <template v-else-if="calcStep === i + 1">◈</template>
              <template v-else>·</template>
            </span>
            <span class="step-text">{{ step }}</span>
          </div>
        </div>
      </div>

      <!-- 计算完成，逐步展示子模块 -->
      <template v-else-if="calcPhase === 'done'">

        <div class="section module-reveal" :class="{ 'mod-visible': leftModuleCount >= 1 }">
          <div class="sec-label">干线概览</div>
          <div class="name-badge">
            {{ selection?.name || '经十路（历山路段）' }}
            <span class="tag">主干道 · 双向8车道</span>
          </div>
          <div class="row3">
            <div class="kv"><span class="kv-v">4.2</span><span class="kv-u">km</span><span class="kv-l">分析长度</span></div>
            <div class="kv"><span class="kv-v">5</span><span class="kv-u">处</span><span class="kv-l">关键路口</span></div>
            <div class="kv"><span class="kv-v">24</span><span class="kv-u">处</span><span class="kv-l">沿线 POI</span></div>
          </div>
        </div>

        <div class="section module-reveal" :class="{ 'mod-visible': leftModuleCount >= 2 }">
          <div class="sec-label">核心指标</div>
          <div class="row3">
            <div class="metric"><span class="m-v warn">52,800</span><span class="m-l">早峰流量</span></div>
            <div class="metric"><span class="m-v warn">6.4</span><span class="m-l">干线拥堵指数</span></div>
            <div class="metric"><span class="m-v">2</span><span class="m-l">严重拥堵节点</span></div>
          </div>
        </div>

        <div class="section flex1 module-reveal" :class="{ 'mod-visible': leftModuleCount >= 3 }">
          <div class="sec-label">干线节点拥堵分布（西→东）</div>
          <div class="strip-wrap">
            <div class="strip-line"></div>
            <div v-for="n in nodes" :key="n.name" class="node-col">
              <div class="node-dot"
                :style="{ background: levelColor[n.level], boxShadow: `0 0 7px ${levelColor[n.level]}70` }"
              ></div>
              <span class="node-nm">{{ n.name }}</span>
              <span class="node-sat" :style="{ color: levelColor[n.level] }">{{ Math.round(n.saturation * 100) }}%</span>
            </div>
          </div>
          <div class="legend">
            <span v-for="(c, k) in levelColor" :key="k" class="leg-item">
              <i :style="{ background: c }"></i>{{ levelLabel[k] }}
            </span>
          </div>
        </div>

      </template>

    </template>

    <!-- ── RIGHT ── -->
    <template v-else>

      <!-- 等待左侧指标计算完成（已看过时无需等待） -->
      <div v-if="!leftPanelReady && !skipAnim" class="right-waiting">
        <span class="wait-spin">◎</span>
        <span class="wait-text">智能体待命中</span>
        <span class="wait-sub">等待左侧指标计算完成…</span>
      </div>

      <!-- 多阶段推理（左侧加载完毕后启动；已看过则直接跳过） -->
      <AgentReasoning
        v-if="leftPanelReady || skipAnim"
        :phases="arterialPhases"
        :conclusion="arterialConclusion"
        :auto-collapse="true"
        :delay="650"
        :skip-animation="skipAnim"
        @phase-start="handlePhaseStart"
        @done="handleReasoningDone"
      />

      <!-- 推理完成后各模块逐步出现 -->
      <div v-if="reasoningDone" class="right-results">

        <div class="section module-reveal" :class="{ 'mod-visible': visibleModuleCount >= 1 }">
          <div class="sec-label">问题节点排行</div>
          <div class="node-tbl">
            <div class="tbl-hd"><span></span><span>节点</span><span>饱和度</span><span>排队</span><span>停车次</span></div>
            <div v-for="(n, i) in problemNodes" :key="i" class="tbl-row">
              <span class="tbl-rank" :style="{ color: levelColor[n.level] }">{{ i + 1 }}</span>
              <span class="tbl-name">{{ n.name }}</span>
              <span class="tbl-val" :style="{ color: levelColor[n.level] }">{{ Math.round(n.saturation*100) }}%</span>
              <span class="tbl-val">{{ n.queue }}m</span>
              <span class="tbl-val">{{ n.stops }}</span>
            </div>
          </div>
        </div>

        <div class="section flex2 module-reveal" :class="{ 'mod-visible': visibleModuleCount >= 2 }">
          <div class="sec-label">干线协调问题诊断</div>
          <div class="coords">
            <div v-for="(c, i) in coordIssues" :key="i" class="coord-card">
              <div class="cc-top">
                <span class="cc-time">{{ c.time }}</span>
                <span class="cc-loc">{{ c.loc }}</span>
                <span class="cc-dir">{{ c.dir }}</span>
              </div>
              <div class="cc-issue">{{ c.issue }}</div>
            </div>
          </div>
        </div>

        <!-- 关键路口下钻入口 -->
        <div class="section module-reveal" :class="{ 'mod-visible': visibleModuleCount >= 3 }">
          <div class="sec-label">关键路口诊断入口</div>
          <div
            v-for="r in criticalIntersections"
            :key="r.name"
            class="drill-item"
            @click="switchAnalysisTabWithContext(r.tab, r.name, `干线历山路节点饱和度最高 94%，${r.issue}，为干线最严重瓶颈`)"
          >
            <span class="di-type">路口</span>
            <div class="di-info">
              <span class="di-name">{{ r.name }}</span>
              <span class="di-meta">{{ r.issue }}</span>
            </div>
            <span class="di-badge" :style="{ color: r.gradeColor, borderColor: r.gradeColor + '55' }">{{ r.grade }}</span>
            <span class="di-go">路口诊断 →</span>
          </div>
        </div>

      </div>

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
.flex2 { flex: 2; min-height: 0; display: flex; flex-direction: column; }
.flex1 .strip-wrap { flex: 1; min-height: 0; }
.flex2 .coords { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; gap: 6px; }

.sec-label { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: rgba(255, 150, 0, 0.80); margin-bottom: 5px; }

/* 面包屑 */
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  background: rgba(6, 14, 26, 0.60);
  border: 1px solid rgba(0, 200, 230, 0.22);
  cursor: pointer;
  transition: background 0.15s;
  flex-shrink: 0;
}
.breadcrumb:hover { background: rgba(0, 210, 240, 0.08); border-color: rgba(0, 210, 240, 0.25); }
.bc-back { font-size: 11px; color: rgba(0, 210, 240, 0.80); }
.bc-sep  { font-size: 11px; color: rgba(255, 255, 255, 0.20); }
.bc-cur  { font-size: 11px; color: rgba(220, 240, 255, 0.70); }

.name-badge { display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: #eef6ff; margin-bottom: 6px; gap: 4px; overflow: hidden; }
.tag { font-size: 11px; color: rgba(220, 240, 255, 0.58); border: 1px solid rgba(255, 255, 255, 0.12); padding: 1px 6px; white-space: nowrap; flex-shrink: 0; }

.row3 { display: flex; gap: 5px; }
.kv, .metric { flex: 1; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.22); padding: 7px 5px; text-align: center; display: flex; flex-direction: column; align-items: center; }
.kv-v, .m-v { font-size: 17px; color: #ff9500; line-height: 1.1; }
.m-v.warn { color: #f05020; }
.kv-u { font-size: 11px; color: rgba(220, 240, 255, 0.60); }
.kv-l, .m-l { font-size: 10px; color: rgba(220, 240, 255, 0.62); margin-top: 2px; white-space: nowrap; }

/* strip */
.strip-wrap { position: relative; display: flex; justify-content: space-between; padding-top: 10px; margin-bottom: 5px; }
.strip-line { position: absolute; top: 14px; left: 5px; right: 5px; height: 2px; background: rgba(255, 255, 255, 0.12); }
.node-col { display: flex; flex-direction: column; align-items: center; gap: 3px; z-index: 1; min-width: 44px; }
.node-dot { width: 10px; height: 10px; border-radius: 50%; cursor: pointer; }
.node-nm  { font-size: 11px; color: rgba(220, 240, 255, 0.68); text-align: center; white-space: nowrap; }
.node-sat { font-size: 11px; font-weight: bold; }
.legend { display: flex; gap: 8px; flex-wrap: wrap; }
.leg-item { display: flex; align-items: center; gap: 3px; font-size: 11px; color: rgba(220, 240, 255, 0.58); }
.leg-item i { display: inline-block; width: 6px; height: 6px; border-radius: 50%; }

/* table */
.node-tbl { display: flex; flex-direction: column; gap: 0; }
.tbl-hd { display: grid; grid-template-columns: 14px 1fr 38px 38px 38px; gap: 4px; font-size: 11px; color: rgba(220, 240, 255, 0.55); padding: 3px 4px; border-bottom: 1px solid rgba(255, 255, 255, 0.10); margin-bottom: 3px; }
.tbl-row { display: grid; grid-template-columns: 14px 1fr 38px 38px 38px; gap: 4px; font-size: 12px; padding: 5px 4px; border-bottom: 1px solid rgba(255, 255, 255, 0.07); align-items: center; }
.tbl-rank { font-weight: bold; }
.tbl-name { color: #eef6ff; }
.tbl-val { color: rgba(220, 240, 255, 0.78); text-align: right; }

/* coords */
.coord-card { background: rgba(255, 255, 255, 0.04); border-left: 2px solid rgba(255, 150, 0, 0.75); padding: 6px 8px; flex-shrink: 0; }
.cc-top { display: flex; gap: 6px; align-items: center; margin-bottom: 2px; overflow: hidden; }
.cc-time { font-size: 11px; color: rgba(220, 240, 255, 0.60); white-space: nowrap; flex-shrink: 0; }
.cc-loc  { font-size: 12px; color: #ffbb66; white-space: nowrap; flex-shrink: 0; }
.cc-dir  { font-size: 11px; color: rgba(220, 220, 140, 0.80); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cc-issue { font-size: 12px; color: rgba(220, 240, 255, 0.88); line-height: 1.5; }

/* schemes */
.schemes { display: flex; flex-direction: column; gap: 8px; margin-bottom: 5px; }
.sch-row { display: flex; flex-direction: column; gap: 3px; }
.sch-name { font-size: 12px; color: rgba(220, 240, 255, 0.82); }
.sch-track { height: 5px; background: rgba(255, 255, 255, 0.12); border-radius: 2px; overflow: hidden; }
.sch-bar { height: 100%; border-radius: 2px; }
.sch-foot { display: flex; justify-content: space-between; }
.sch-pct { font-size: 12px; font-weight: bold; }
.sch-dev { font-size: 11px; color: rgba(220, 240, 255, 0.58); }
.sch-note { font-size: 12px; color: #ff9500; line-height: 1.5; border-top: 1px solid rgba(255, 255, 255, 0.10); padding-top: 6px; }

/* 下钻入口 */
.drill-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.22);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.drill-item:hover { background: rgba(0, 210, 240, 0.08); border-color: rgba(0, 210, 240, 0.35); }

.di-type {
  flex-shrink: 0;
  font-size: 10px;
  padding: 2px 5px;
  border: 1px solid rgba(0, 212, 240, 0.45);
  color: #00d4f0;
  background: rgba(0, 212, 240, 0.06);
  letter-spacing: 0.5px;
}
.di-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.di-name { font-size: 12px; color: #eef6ff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.di-meta { font-size: 11px; color: rgba(220, 240, 255, 0.58); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.di-badge { flex-shrink: 0; font-size: 13px; font-weight: bold; border: 1px solid; padding: 1px 6px; }
.di-go { flex-shrink: 0; font-size: 11px; color: rgba(0, 210, 240, 0.55); letter-spacing: 0.5px; transition: color 0.15s; }
.drill-item:hover .di-go { color: #00d4f0; }

/* 右侧推理结果区 */
.right-results {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
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

/* ── 左侧指标计算 loading ── */
.calc-loading {
  flex: 1;
  background: rgba(6, 14, 26, 0.80);
  border: 1px solid rgba(0, 200, 230, 0.20);
  padding: 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.calc-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.calc-spin {
  font-size: 13px;
  color: rgba(0, 210, 240, 0.85);
  animation: calc-rotate 1.4s linear infinite;
  display: inline-block;
}

@keyframes calc-rotate {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

.calc-title {
  font-size: 11px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: rgba(0, 210, 240, 0.80);
}

.calc-steps {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.calc-step {
  display: flex;
  align-items: center;
  gap: 8px;
  transition: opacity 0.35s ease;
}

.step-pending { opacity: 0.22; }
.step-active  { opacity: 1; }
.step-done    { opacity: 0.55; }

.step-status {
  flex-shrink: 0;
  width: 14px;
  font-size: 12px;
  text-align: center;
}

.step-done .step-status   { color: #34d89a; }
.step-active .step-status { color: #00d4f0; animation: step-blink 0.7s ease-in-out infinite; }
.step-pending .step-status{ color: rgba(220, 240, 255, 0.30); }

@keyframes step-blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.25; }
}

.step-text {
  font-size: 12px;
  color: rgba(220, 240, 255, 0.75);
}

/* ── 右侧待命状态 ── */
.right-waiting {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  opacity: 0.55;
}

.wait-spin {
  font-size: 18px;
  color: rgba(0, 210, 240, 0.70);
  animation: calc-rotate 1.4s linear infinite;
  display: inline-block;
}

.wait-text {
  font-size: 12px;
  letter-spacing: 1.5px;
  color: rgba(0, 210, 240, 0.80);
  text-transform: uppercase;
}

.wait-sub {
  font-size: 11px;
  color: rgba(220, 240, 255, 0.50);
}
</style>

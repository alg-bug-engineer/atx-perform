<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { switchAnalysisTab, switchAnalysisTabWithContext, leftPanelReady, hasSeenAnimation, markSeenAnimation } from '../../../../shared/analysis-state.js';
import AgentReasoning from '../../../../shared/components/AgentReasoning.vue';
import ContextHint from '../../../../shared/components/ContextHint.vue';
import { triggerBroadcast, afterBroadcastDone } from '../../../../shared/broadcast-bus.js';

const props = defineProps({
  selection: { type: Object, default: null },
  side:      { type: String, default: 'right' },
});

// ── 动画缓存 key
const animKey = computed(() => `intersection:${props.selection?.name || '_'}`);
const skipAnim = computed(() => hasSeenAnimation(animKey.value));

// ── 左侧指标计算动画
const calcPhase       = ref('idle');
const calcStep        = ref(0);
const leftModuleCount = ref(0);

const calcSteps = [
  '采集各进口道流量数据',
  '计算相位饱和度与排队长度',
  '评估路口服务水平',
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
    triggerBroadcast('metric_calculating_intersection', '正在计算路口诊断指标，采集进口道流量、排队与服务水平数据…');
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

const gradeColor = { A: '#00ff88', B: '#88ffcc', C: '#ffcc00', D: '#ff8800', E: '#ff4400', F: '#ff0000' };
const levelBg    = { F: 'rgba(255,0,0,0.08)', D: 'rgba(255,136,0,0.06)', C: 'rgba(255,204,0,0.05)', B: 'rgba(0,255,136,0.04)' };

const directions = [
  { dir: '西', label: '西进口 直行', flow: 1840, saturation: 0.96, queue: 320, stops: 9.2, level: 'F', hi: true },
  { dir: '东', label: '东进口 直行', flow: 1520, saturation: 0.82, queue: 180, stops: 5.6, level: 'D', hi: false },
  { dir: '南', label: '南进口 左转', flow: 680,  saturation: 0.58, queue: 70,  stops: 2.4, level: 'B', hi: false },
  { dir: '北', label: '北进口 直行', flow: 740,  saturation: 0.63, queue: 90,  stops: 3.1, level: 'C', hi: false },
];

const diagIssues = [
  { level: 'critical', tag: '严重', dir: '西进口直行', desc: '直行配时严重不足，供需比仅 63%，持续溢出' },
  { level: 'warn',     tag: '警告', dir: '东进口直行', desc: '高峰期轻度溢出，饱和度 0.82 接近临界值' },
  { level: 'warn',     tag: '警告', dir: '全路口',     desc: '进口失衡系数 1.64，东西向负荷严重不均' },
  { level: 'info',     tag: '关注', dir: '北进口直行', desc: '早高峰轻度缓行，饱和度 0.63 有恶化风险' },
];

const sourcePaths = [
  { name: '经十路西段 来流', pct: 68, flow: 1250 },
  { name: '历山路南段 左转', pct: 18, flow: 330 },
  { name: '其他小街道',       pct: 14, flow: 260 },
];

const phases = [
  { name: '东西直行', green: 45, need: 72, saturation: 0.96 },
  { name: '南北直行', green: 38, need: 40, saturation: 0.62 },
  { name: '东西左转', green: 22, need: 20, saturation: 0.55 },
  { name: '南北左转', green: 15, need: 12, saturation: 0.48 },
];

const imbalance = [
  { label: '进口失衡系数',  value: '1.64', warn: true },
  { label: '车道利用率',    value: '92%',  warn: true },
  { label: '直行供需比',    value: '63%',  warn: true },
  { label: '排队溢出频率',  value: '74%',  warn: true },
];

// Causal chain for 方向三
const causalChain = [
  {
    level: 'root',
    tag: '根因',
    title: '经十路上游持续高强度流入',
    confidence: 92,
    confColor: '#ff2200',
    evidence: [
      '早高峰西段来流 1,250 辆/小时（占西进口 68%）',
      '上游 2km 路段饱和度 0.89，无有效截流',
    ],
  },
  {
    level: 'mech',
    tag: '机制',
    title: '西进口直行相位供给严重不足',
    confidence: 96,
    confColor: '#ff4400',
    evidence: [
      '东西直行绿信比 45s，实测需求 72s（供需比 63%）',
      '历史方案优先重点单位保障，直行相位被压缩',
    ],
  },
  {
    level: 'effect',
    tag: '表现',
    title: '排队 320m 溢出至上游路段',
    confidence: 88,
    confColor: '#ff8800',
    evidence: [
      '西进口饱和度 0.96，排队延伸至路段中段',
      '二次停车率 74%，干线绿波效率几乎清零',
    ],
  },
  {
    level: 'result',
    tag: '结果',
    title: '路口整体服务水平降至 F 级',
    confidence: 100,
    confColor: '#ffcc00',
    evidence: [
      '全路口均延误 68.4s，超 F 级阈值（≥60s）',
      '影响范围蔓延至全片区 12 条路段',
    ],
  },
];

const expandedNode = ref(null);

function toggleNode(i) {
  expandedNode.value = expandedNode.value === i ? null : i;
}

// Overall confidence
const overallConfidence = 84;

// ── 右侧多阶段推理
const intersectionPhases = [
  {
    type: 'planning', title: '任务规划',
    items: [
      '扫描各进口道饱和度与最大排队长度',
      '分析各相位配时供给 vs 需求比',
      '溯源西进口上游来流成分',
      '评估排队溢出风险与影响范围',
    ],
  },
  {
    type: 'analyzing', title: '指标分析',
    steps: [
      '西进口直行饱和度 0.96（最高），排队 320m 溢出',
      '东西直行相位供需比 63%（供给 45s，需求 72s）',
      '上游 1,250 辆/h 来自经十路西段（占比 68%）',
      '二次停车率 74%，均延误 68.4s，服务水平降至 F 级',
    ],
  },
  {
    type: 'searching', title: '经验库检索',
    query: '路口西进口过饱和 + 直行相位供给不足',
    results: [
      { name: '2023 历山路路口绿信比调整方案', match: 81, desc: '西进口绿信比 +18s，排队↓41%，均延误↓23s' },
      { name: '2024 信控优化-过饱和路口标准模板', match: 69, desc: '供需比<70% 触发紧急绿信比重分配流程' },
    ],
  },
];
const intersectionConclusion = '根因确认：历史配时方案优先重点单位保障，西进口直行相位被压缩至 45s，供需比仅 63%，触发持续溢出；建议重新标定绿信比至 62–68s，启动智能闭环优化';

const reasoningDone = ref(false);
const visibleModuleCount = ref(0);

function handleReasoningDone() {
  const wasSeen = skipAnim.value;
  reasoningDone.value = true;
  markSeenAnimation(animKey.value);
  if (wasSeen) {
    visibleModuleCount.value = 6;
    return;
  }
  // 等 agent_done 播报完成后再逐步显示结果模块
  _cancelModuleWait = afterBroadcastDone(() => {
    _cancelModuleWait = null;
    setTimeout(() => { visibleModuleCount.value = 1; }, 200);
    setTimeout(() => { visibleModuleCount.value = 2; }, 800);
    setTimeout(() => { visibleModuleCount.value = 3; }, 1400);
    setTimeout(() => { visibleModuleCount.value = 4; }, 2000);
    setTimeout(() => { visibleModuleCount.value = 5; }, 2600);
    setTimeout(() => { visibleModuleCount.value = 6; }, 3200);
  });
}
</script>

<template>
  <div class="panel">

    <!-- ── LEFT ── -->
    <template v-if="side === 'left'">

      <ContextHint />

      <!-- 面包屑导航（始终显示） -->
      <div class="breadcrumb">
        <span class="bc-item" @click="switchAnalysisTab('region')">区域诊断</span>
        <span class="bc-sep">/</span>
        <span class="bc-item" @click="switchAnalysisTab('arterial')">干线诊断</span>
        <span class="bc-sep">/</span>
        <span class="bc-cur">路口分析</span>
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
          <div class="name-row">
            <span class="inter-name">{{ selection?.name || '经十路与历山路路口' }}</span>
            <div class="grade-badge" :style="{ color: gradeColor['F'], borderColor: gradeColor['F'] + '55' }">
              <span class="gb-v">F</span>
              <span class="gb-l">服务水平</span>
            </div>
          </div>
          <div class="alert-bar">⚠ 西进口直行严重溢出 · 配时供需失衡</div>
        </div>

        <div class="section module-reveal" :class="{ 'mod-visible': leftModuleCount >= 2 }">
          <div class="sec-label">核心指标</div>
          <div class="row3">
            <div class="metric"><span class="m-v crit">68.4s</span><span class="m-l">均延误</span></div>
            <div class="metric"><span class="m-v crit">0.96</span><span class="m-l">最高饱和度</span></div>
            <div class="metric"><span class="m-v crit">320m</span><span class="m-l">最大排队</span></div>
          </div>
        </div>

        <div class="section module-reveal" :class="{ 'mod-visible': leftModuleCount >= 3 }">
          <div class="sec-label">各方向进口道状态</div>
          <div class="dir-grid">
            <div v-for="d in directions" :key="d.dir"
              class="dir-card"
              :class="{ 'dir-hi': d.hi }"
              :style="{ background: levelBg[d.level] || 'rgba(0,255,136,0.03)' }"
            >
              <div class="dc-top">
                <span class="dc-lbl">{{ d.label }}</span>
                <span class="dc-grade" :style="{ color: gradeColor[d.level], borderColor: gradeColor[d.level] + '44' }">{{ d.level }}</span>
              </div>
              <div class="dc-row">
                <div class="dc-cell">
                  <span class="dc-v" :style="{ color: gradeColor[d.level] }">{{ Math.round(d.saturation * 100) }}%</span>
                  <span class="dc-vl">饱和</span>
                </div>
                <div class="dc-cell">
                  <span class="dc-v">{{ d.queue }}m</span>
                  <span class="dc-vl">排队</span>
                </div>
                <div class="dc-cell">
                  <span class="dc-v">{{ d.stops }}</span>
                  <span class="dc-vl">停车</span>
                </div>
              </div>
            </div>
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
        :phases="intersectionPhases"
        :conclusion="intersectionConclusion"
        :auto-collapse="true"
        :delay="650"
        :skip-animation="skipAnim"
        @done="handleReasoningDone"
      />

      <!-- 推理完成后各模块逐步出现 -->
      <div v-if="reasoningDone" class="right-results">

          <div class="section module-reveal" :class="{ 'mod-visible': visibleModuleCount >= 1 }">
            <div class="sec-label">问题诊断清单</div>
            <div class="diag-list">
              <div v-for="(d, i) in diagIssues" :key="i" class="diag-item" :class="'diag-' + d.level">
                <div class="diag-head">
                  <span class="diag-tag" :class="'dtag-' + d.level">{{ d.tag }}</span>
                  <span class="diag-dir">{{ d.dir }}</span>
                </div>
                <div class="diag-desc">{{ d.desc }}</div>
              </div>
            </div>
          </div>

          <div class="section module-reveal" :class="{ 'mod-visible': visibleModuleCount >= 2 }">
            <div class="sec-label">西进口直行 · 流量溯源</div>
            <div class="sources">
              <div v-for="(s, i) in sourcePaths" :key="i" class="src-row">
                <span class="src-pct">{{ s.pct }}%</span>
                <span class="src-name">{{ s.name }}</span>
                <div class="src-track"><div class="src-bar" :style="{ width: s.pct + '%' }"></div></div>
                <span class="src-flow">{{ s.flow }}</span>
              </div>
            </div>
          </div>

          <div class="section flex2 module-reveal" :class="{ 'mod-visible': visibleModuleCount >= 3 }">
            <div class="sec-label">相位配时 · 供给 vs 需求</div>
            <div class="phases">
              <div v-for="p in phases" :key="p.name" class="phase-item">
                <div class="ph-name">{{ p.name }}</div>
                <div class="ph-bars">
                  <div class="ph-row">
                    <span class="ph-lbl">供给</span>
                    <div class="ph-track"><div class="ph-fill supply" :style="{ width: (p.green / 80 * 100) + '%' }"></div></div>
                    <span class="ph-val">{{ p.green }}s</span>
                  </div>
                  <div class="ph-row">
                    <span class="ph-lbl">需求</span>
                    <div class="ph-track">
                      <div class="ph-fill" :class="p.need > p.green ? 'demand-over' : 'demand-ok'"
                        :style="{ width: Math.min(p.need / 80 * 100, 100) + '%' }"></div>
                    </div>
                    <span class="ph-val" :class="{ 'val-w': p.need > p.green }">{{ p.need }}s</span>
                  </div>
                </div>
                <div class="ph-ratio" :class="(p.green / p.need) < 0.80 ? 'ratio-bad' : 'ratio-ok'">
                  供需比 {{ Math.round(p.green / p.need * 100) }}%
                </div>
              </div>
            </div>
          </div>

          <div class="section module-reveal" :class="{ 'mod-visible': visibleModuleCount >= 4 }">
            <div class="sec-label">失衡量化诊断</div>
            <div class="imb-grid">
              <div v-for="f in imbalance" :key="f.label" class="imb-item">
                <span class="imb-v" :class="{ 'imb-w': f.warn }">{{ f.value }}</span>
                <span class="imb-l">{{ f.label }}</span>
              </div>
            </div>
          </div>

          <!-- 成因推理链 -->
          <div class="section causal-section module-reveal" :class="{ 'mod-visible': visibleModuleCount >= 5 }">
            <div class="sec-label-causal">
              <span>成因推理链</span>
              <span class="conf-total">综合置信度 {{ overallConfidence }}%</span>
            </div>
            <div class="causal-chain">
              <div
                v-for="(node, i) in causalChain"
                :key="i"
                class="causal-node"
                :class="['cn-' + node.level, { expanded: expandedNode === i }]"
                @click="toggleNode(i)"
              >
                <div class="cn-header">
                  <span class="cn-tag" :style="{ color: node.confColor, borderColor: node.confColor + '44' }">{{ node.tag }}</span>
                  <span class="cn-title">{{ node.title }}</span>
                  <div class="cn-right">
                    <span class="cn-conf" :style="{ color: node.confColor }">{{ node.confidence }}%</span>
                    <span class="cn-toggle">{{ expandedNode === i ? '▲' : '▼' }}</span>
                  </div>
                </div>
                <transition name="evidence-slide">
                  <div v-if="expandedNode === i" class="cn-evidence">
                    <div v-for="(ev, ei) in node.evidence" :key="ei" class="ev-row">
                      <span class="ev-dot"></span>
                      <span class="ev-txt">{{ ev }}</span>
                    </div>
                  </div>
                </transition>
                <div v-if="i < causalChain.length - 1" class="causal-arrow">↓</div>
              </div>
            </div>
          </div>

          <!-- 治理方案入口 + 返回导航 -->
          <div class="section module-reveal" :class="{ 'mod-visible': visibleModuleCount >= 6 }">
            <div class="gov-row">
              <button
                class="gov-btn"
                @click="switchAnalysisTabWithContext('governance', '经十路与历山路路口', '路口已完成根因溯源，直行相位供需差 27s，具备优化条件')"
              >◈ 生成治理方案 →</button>
            </div>
            <div class="back-row">
              <span class="back-hint">← 返回</span>
              <span class="back-btn" @click="switchAnalysisTab('arterial')">干线诊断</span>
              <span class="back-sep">|</span>
              <span class="back-btn" @click="switchAnalysisTab('region')">区域诊断</span>
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
.flex1 .dir-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
.flex2 .phases   { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; gap: 5px; }

.sec-label { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: rgba(0, 210, 120, 0.80); margin-bottom: 5px; }

/* 面包屑 */
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  background: rgba(6, 14, 26, 0.60);
  border: 1px solid rgba(0, 200, 230, 0.22);
  flex-shrink: 0;
}
.bc-item {
  font-size: 11px;
  color: rgba(0, 210, 240, 0.75);
  cursor: pointer;
  transition: color 0.12s;
}
.bc-item:hover { color: #00d4f0; }
.bc-sep  { font-size: 11px; color: rgba(255, 255, 255, 0.20); }
.bc-cur  { font-size: 11px; color: rgba(220, 240, 255, 0.70); }

.name-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.inter-name { font-size: 13px; color: #eef6ff; }
.grade-badge { display: flex; flex-direction: column; align-items: center; border: 1px solid; padding: 2px 8px; }
.gb-v { font-size: 20px; font-weight: bold; line-height: 1; }
.gb-l { font-size: 10px; color: rgba(220, 240, 255, 0.58); }

.alert-bar { background: rgba(220, 50, 20, 0.14); border: 1px solid rgba(220, 80, 40, 0.65); color: #ff8866; font-size: 11px; padding: 5px 9px; line-height: 1.4; }

.row3 { display: flex; gap: 5px; }
.metric { flex: 1; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.22); padding: 7px 5px; text-align: center; display: flex; flex-direction: column; align-items: center; }
.m-v { font-size: 17px; color: #34d89a; line-height: 1.1; }
.m-v.crit { color: #f05020; }
.m-l { font-size: 10px; color: rgba(220, 240, 255, 0.62); margin-top: 2px; white-space: nowrap; }

/* dir cards */
.dir-card { border: 1px solid rgba(255, 255, 255, 0.20); padding: 7px; }
.dir-hi { border-color: rgba(220, 60, 30, 0.70) !important; box-shadow: 0 0 7px rgba(220, 60, 30, 0.28); }
.dc-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; }
.dc-lbl { font-size: 11px; color: #eef6ff; }
.dc-grade { font-size: 14px; font-weight: bold; border: 1px solid; padding: 1px 5px; line-height: 1; }
.dc-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px; margin-bottom: 4px; }
.dc-cell { display: flex; flex-direction: column; align-items: center; }
.dc-v   { font-size: 13px; font-weight: bold; color: #eef6ff; line-height: 1.2; white-space: nowrap; }
.dc-vl  { font-size: 10px; color: rgba(220, 240, 255, 0.55); white-space: nowrap; }

/* diag list */
.diag-list { display: flex; flex-direction: column; gap: 5px; }
.diag-item {
  padding: 6px 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.03);
}
.diag-critical { border-color: rgba(220, 60, 30, 0.60) !important; background: rgba(220, 50, 20, 0.08) !important; }
.diag-warn     { border-color: rgba(255, 149, 0, 0.50) !important;  background: rgba(255, 140, 0, 0.06) !important; }
.diag-info     { border-color: rgba(255, 204, 0, 0.40) !important;  background: rgba(255, 200, 0, 0.05) !important; }

.diag-head { display: flex; align-items: center; gap: 7px; margin-bottom: 3px; }
.diag-tag {
  font-size: 10px;
  padding: 1px 5px;
  border: 1px solid;
  letter-spacing: 0.5px;
  flex-shrink: 0;
}
.dtag-critical { color: #ff6644; border-color: rgba(255, 80, 40, 0.55); }
.dtag-warn     { color: #ff9f40; border-color: rgba(255, 149, 0, 0.55); }
.dtag-info     { color: #ffcc44; border-color: rgba(255, 204, 0, 0.50); }

.diag-dir  { font-size: 11px; color: rgba(220, 240, 255, 0.85); font-weight: 500; }
.diag-desc { font-size: 11px; color: rgba(220, 240, 255, 0.65); line-height: 1.45; }

/* sources */
.sources { display: flex; flex-direction: column; gap: 5px; }
.src-row { display: flex; align-items: center; gap: 5px; }
.src-pct  { width: 28px; font-size: 12px; color: #34d89a; text-align: right; flex-shrink: 0; }
.src-name { font-size: 12px; color: #eef6ff; width: 98px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.src-track { flex: 1; height: 4px; background: rgba(255, 255, 255, 0.12); border-radius: 2px; overflow: hidden; }
.src-bar { height: 100%; background: linear-gradient(90deg, #34d89a, #20a0e0); border-radius: 2px; }
.src-flow { font-size: 11px; color: rgba(220, 240, 255, 0.65); width: 34px; text-align: right; flex-shrink: 0; }

/* phases */
.phase-item { background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.22); padding: 6px 8px; flex-shrink: 0; }
.ph-name { font-size: 12px; color: #eef6ff; margin-bottom: 5px; }
.ph-bars { display: flex; flex-direction: column; gap: 3px; margin-bottom: 4px; }
.ph-row  { display: flex; align-items: center; gap: 5px; }
.ph-lbl  { font-size: 11px; color: rgba(220, 240, 255, 0.58); width: 24px; flex-shrink: 0; }
.ph-track { flex: 1; height: 5px; background: rgba(255, 255, 255, 0.12); border-radius: 2px; overflow: hidden; }
.ph-fill { height: 100%; border-radius: 2px; }
.supply      { background: linear-gradient(90deg, #34d89a, #20a0e0); }
.demand-ok   { background: linear-gradient(90deg, #20a0e0, #1060a0); }
.demand-over { background: linear-gradient(90deg, #ff9500, #f04020); }
.ph-val { font-size: 11px; color: rgba(220, 240, 255, 0.68); width: 22px; text-align: right; flex-shrink: 0; }
.val-w { color: #ff9500 !important; }
.ph-ratio { font-size: 11px; text-align: right; }
.ratio-bad { color: #f05020; }
.ratio-ok  { color: rgba(52, 216, 154, 0.80); }

/* imbalance */
.imb-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
.imb-item { background: rgba(200, 50, 20, 0.08); border: 1px solid rgba(200, 70, 40, 0.45); padding: 7px; }
.imb-v  { display: block; font-size: 17px; color: #ff7755; }
.imb-w  { color: #f04020; }
.imb-l  { display: block; font-size: 11px; color: rgba(220, 240, 255, 0.65); margin-top: 2px; white-space: nowrap; }

/* ── Causal chain (方向三) ── */
.causal-section { overflow: visible; }
.sec-label-causal {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 7px;
}
.sec-label-causal > span:first-child {
  font-size: 11px;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: rgba(0, 210, 120, 0.80);
}
.conf-total {
  font-size: 11px;
  color: rgba(220, 240, 255, 0.55);
}

.causal-chain {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.causal-node {
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: rgba(255, 255, 255, 0.04);
  padding: 6px 8px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  user-select: none;
}
.causal-node:hover { background: rgba(255, 255, 255, 0.07); }
.causal-node.expanded { background: rgba(0, 210, 240, 0.05); border-color: rgba(0, 210, 240, 0.55); }

.cn-header {
  display: flex;
  align-items: center;
  gap: 7px;
}

.cn-tag {
  flex-shrink: 0;
  font-size: 10px;
  border: 1px solid;
  padding: 1px 5px;
  letter-spacing: 0.5px;
}

.cn-title {
  flex: 1;
  font-size: 11px;
  color: rgba(220, 240, 255, 0.88);
  line-height: 1.4;
  min-width: 0;
}

.cn-right {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}

.cn-conf {
  font-size: 11px;
  font-weight: bold;
}

.cn-toggle {
  font-size: 9px;
  color: rgba(220, 240, 255, 0.40);
}

.cn-evidence {
  margin-top: 5px;
  padding-top: 5px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  gap: 3px;
  overflow: hidden;
}

.ev-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.ev-dot {
  display: inline-block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: rgba(0, 210, 240, 0.60);
  flex-shrink: 0;
  margin-top: 5px;
}

.ev-txt {
  font-size: 11px;
  color: rgba(220, 240, 255, 0.72);
  line-height: 1.5;
}

.causal-arrow {
  text-align: center;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.20);
  padding: 1px 0;
  line-height: 1;
}

.evidence-slide-enter-active,
.evidence-slide-leave-active {
  transition: max-height 0.22s ease, opacity 0.22s;
  max-height: 120px;
}
.evidence-slide-enter-from,
.evidence-slide-leave-to {
  max-height: 0;
  opacity: 0;
}

/* gov + back row */
.gov-row {
  margin-bottom: 8px;
}

.gov-btn {
  width: 100%;
  background: rgba(196, 170, 255, 0.10);
  border: 1px solid rgba(196, 170, 255, 0.40);
  color: #c4aaff;
  font-size: 11px;
  font-family: inherit;
  letter-spacing: 1px;
  padding: 6px 0;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  text-align: center;
}
.gov-btn:hover {
  background: rgba(196, 170, 255, 0.20);
  border-color: rgba(196, 170, 255, 0.65);
}

.back-row {
  display: flex;
  align-items: center;
  gap: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.10);
  padding-top: 7px;
}
.back-hint { font-size: 11px; color: rgba(220, 240, 255, 0.35); }
.back-btn {
  font-size: 11px;
  color: rgba(0, 210, 240, 0.70);
  cursor: pointer;
  transition: color 0.12s;
  letter-spacing: 0.5px;
}
.back-btn:hover { color: #00d4f0; }
.back-sep { font-size: 11px; color: rgba(255, 255, 255, 0.15); }

/* 右侧推理结果区 */
.right-results {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
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

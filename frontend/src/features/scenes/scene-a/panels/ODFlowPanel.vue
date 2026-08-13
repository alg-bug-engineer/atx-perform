<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { switchAnalysisTabWithContext, leftPanelReady, hasSeenAnimation, markSeenAnimation, selectedRegion } from '../../../../shared/analysis-state.js';
import AgentReasoning from '../../../../shared/components/AgentReasoning.vue';
import ContextHint from '../../../../shared/components/ContextHint.vue';
import { triggerBroadcast, afterBroadcastDone } from '../../../../shared/broadcast-bus.js';
import { setActiveScene } from '../../../../shared/event-bus.js';

const props = defineProps({
  selection: { type: Object, default: null },
  side:      { type: String, default: 'right' },
});

// ── 动画缓存 key（同一区域已看过则跳过动画）
const animKey = computed(() => `region:${props.selection?.name || '_'}`);
const skipAnim = computed(() => hasSeenAnimation(animKey.value));

// ── 左侧指标计算动画
const calcPhase    = ref('idle');   // 'idle' | 'calculating' | 'done'
const calcStep     = ref(0);
const leftModuleCount = ref(0);

const calcSteps = [
  '读取区域 OD 矩阵数据',
  '计算区域承载率与饱和度',
  '分析主路径流量失衡方向',
];

let _cancelCalcWait    = null;
let _cancelModuleWait  = null;
const _calcTimers      = [];

onMounted(() => {
  if (props.side !== 'left') return;
  leftPanelReady.value = false;

  // 已看过：跳过计算动画，直接展示结果
  if (skipAnim.value) {
    calcPhase.value       = 'done';
    leftModuleCount.value = 3;
    leftPanelReady.value  = true;
    return;
  }

  // 立即显示加载外壳（spinner + 暗色待处理步骤），等 Tab 播报完成后再推进步骤
  calcPhase.value = 'calculating';
  calcStep.value  = 0;

  _cancelCalcWait = afterBroadcastDone(() => {
    _cancelCalcWait = null;
    // 播报完成后触发指标计算播报，并同步开始步骤动画
    triggerBroadcast('metric_calculating_region', '正在计算区域诊断指标，读取区域交通画像…');
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

// ── 右侧多阶段推理
const regionPhases = [
  {
    type: 'planning', title: '任务规划',
    items: [
      '分析区域承载力 vs 实时在途量',
      '识别主路径流量失衡方向',
      '追踪拥堵蔓延起点与扩散路径',
      '定位区域内瓶颈节点',
    ],
  },
  {
    type: 'visualization',
    title: '分析区域交通流入OD',
    broadcastKey: 'viz_od_analysis',
    duration: 15000,
  },
  {
    type: 'visualization',
    title: '区域流量溯源',
    broadcastKey: 'viz_flow_tracing',
    duration: 15000,
  },
  {
    type: 'visualization',
    title: '区域拥堵蔓延分析',
    broadcastKey: 'viz_congestion_spread',
    duration: 20000,
  },
  {
    type: 'analyzing', title: '指标分析',
    steps: [
      '区域在途量达最大承载力 86%（临界阈值 80%），饱和预警',
      '净流入 +2,840 辆/h，持续积累，无有效疏散出口',
      '经十路东西向失衡系数最高：流量占比 92%',
      '拥堵蔓延：07:15 经十路/历山路→07:42 山大路北段',
    ],
  },
  {
    type: 'searching', title: '经验库检索',
    query: '区域承载力超载 + OD 主路径失衡',
    results: [
      { name: '2024 东部区域边界控流方案', match: 74, desc: '边界流量压制 + 内部绿波疏散组合，延时指数↓18%' },
      { name: '2023 主干线超载应急协调方案', match: 61, desc: '干线限速 + 平行路径诱导分流，承载率↓12%' },
    ],
  },
];
const regionConclusion = '经十路（历山路段）为区域核心瓶颈干线，承担出区流量 68%，区域承载力已达 86%；建议优先诊断干线协调效率及历山路路口相位供给问题';

const reasoningDone      = ref(false);
const visibleModuleCount = ref(0);
const pathTab            = ref('outbound');

// 可视化阶段标题 → 场景 key 映射
const VIZ_SCENE_MAP = {
  '分析区域交通流入OD': 'scene-a',
  '区域流量溯源':       'traffic-origin',
  '区域拥堵蔓延分析':   'scene-b',
};

function handlePhaseStart(phase) {
  const sceneKey = VIZ_SCENE_MAP[phase.title];
  if (sceneKey) setActiveScene(sceneKey);
}

function handleReasoningDone() {
  const wasSeen = skipAnim.value; // 在 mark 之前捕获，避免 mark 后 computed 立即变 true
  reasoningDone.value = true;
  markSeenAnimation(animKey.value);
  if (wasSeen) {
    visibleModuleCount.value = 5;
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
  });
}

const spreadTimeline = [
  { time: '07:15', event: '拥堵起始', node: '经十路/历山路', level: 4 },
  { time: '07:42', event: '开始扩散', node: '山大路北段',   level: 3 },
  { time: '08:10', event: '拥堵峰值', node: '全片区',       level: 4 },
  { time: '09:05', event: '开始消散', node: '外围路段',     level: 2 },
  { time: '09:50', event: '基本消散', node: '主干道恢复',   level: 1 },
];
const levelColor = { 1: '#00ff88', 2: '#ffcc00', 3: '#ff8800', 4: '#ff2200' };

const inboundPaths = [
  { name: '经十路 西→东', flow: 4820, pct: 92 },
  { name: '历山路 南→北', flow: 2340, pct: 56 },
  { name: '山大路 东→西', flow: 1780, pct: 42 },
];
const outboundPaths = [
  { name: '经十路 东→西', flow: 3960, pct: 84 },
  { name: '二环路 出口',   flow: 2100, pct: 60 },
  { name: '解放路 南向',   flow: 1420, pct: 44 },
];
const problems = [
  { tag: '严重', text: '经十路东西向通道承压超载',   color: '#ff2200' },
  { tag: '拥堵', text: '历山路交叉口持续排队溢出',   color: '#ff8800' },
  { tag: '协调', text: '山大路主辅路衔接段协调不畅', color: '#ffcc00' },
];

const relatedArterials = [
  { name: '经十路（历山路段）', index: 6.4, level: '拥堵', levelColor: '#ff8800', tab: 'arterial' },
];
const relatedIntersections = [
  { name: '经十路—历山路路口', grade: 'F', gradeLabel: '服务水平F', gradeColor: '#ff2200', issue: '西进口严重溢出', tab: 'intersection' },
];
</script>

<template>
  <div class="panel">

    <!-- ── LEFT ── -->
    <template v-if="side === 'left'">

      <ContextHint />

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
          <div class="sec-label">区域画像</div>
          <div class="name-badge">
            {{ selection?.name || selectedRegion || '舜耕路—山大路片区' }}
            <span class="ci">拥堵指数 <b>7.8</b></span>
          </div>
          <div class="row3">
            <div class="kv">
              <span class="kv-val">12.4</span><span class="kv-u">km²</span>
              <span class="kv-l">区域面积</span>
            </div>
            <div class="kv">
              <span class="kv-val">8.2</span><span class="kv-u">km/km²</span>
              <span class="kv-l">路网密度</span>
            </div>
            <div class="kv">
              <span class="kv-val">47</span><span class="kv-u">处</span>
              <span class="kv-l">主要 POI</span>
            </div>
          </div>
        </div>

        <div class="section module-reveal" :class="{ 'mod-visible': leftModuleCount >= 2 }">
          <div class="sec-label">核心指标</div>
          <div class="row3">
            <div class="metric"><span class="m-val warn">86%</span><span class="m-l">区域饱和度</span></div>
            <div class="metric"><span class="m-val warn">155min</span><span class="m-l">拥堵时长</span></div>
            <div class="metric"><span class="m-val">+2,840</span><span class="m-l">净流入(辆)</span></div>
          </div>
        </div>

        <div class="section module-reveal" :class="{ 'mod-visible': leftModuleCount >= 3 }">
          <div class="sec-label">早高峰交通量结构</div>
          <div class="flow4">
            <div class="fc"><span class="fc-v">38,420</span><span class="fc-l">总交通量</span></div>
            <div class="fc"><span class="fc-v pos">+2,840</span><span class="fc-l">净流入</span></div>
            <div class="fc"><span class="fc-v neg">-1,960</span><span class="fc-l">净流出</span></div>
            <div class="fc"><span class="fc-v dim">18,300</span><span class="fc-l">过境量</span></div>
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
        :phases="regionPhases"
        :conclusion="regionConclusion"
        :auto-collapse="true"
        :delay="650"
        :skip-animation="skipAnim"
        @phase-start="handlePhaseStart"
        @done="handleReasoningDone"
      />

      <!-- 推理完成后各模块逐步出现 -->
      <div v-if="reasoningDone" class="right-results">

          <div class="section module-reveal" :class="{ 'mod-visible': visibleModuleCount >= 1 }">
            <div class="path-tabs">
              <button
                class="ptab"
                :class="{ active: pathTab === 'inbound' }"
                @click="pathTab = 'inbound'"
              >流入主路径</button>
              <button
                class="ptab"
                :class="{ active: pathTab === 'outbound' }"
                @click="pathTab = 'outbound'"
              >流出主路径</button>
            </div>
            <div class="paths">
              <template v-if="pathTab === 'inbound'">
                <div v-for="(p, i) in inboundPaths" :key="i" class="path-row">
                  <span class="p-rank">{{ i + 1 }}</span>
                  <span class="p-name">{{ p.name }}</span>
                  <div class="p-track"><div class="p-bar in-bar" :style="{ width: p.pct + '%' }"></div></div>
                  <span class="p-flow">{{ p.flow.toLocaleString() }}</span>
                </div>
              </template>
              <template v-else>
                <div v-for="(p, i) in outboundPaths" :key="i" class="path-row">
                  <span class="p-rank">{{ i + 1 }}</span>
                  <span class="p-name">{{ p.name }}</span>
                  <div class="p-track"><div class="p-bar out-bar" :style="{ width: p.pct + '%' }"></div></div>
                  <span class="p-flow">{{ p.flow.toLocaleString() }}</span>
                </div>
              </template>
            </div>
          </div>

          <div class="section flex1 module-reveal" :class="{ 'mod-visible': visibleModuleCount >= 2 }">
            <div class="sec-label">早高峰拥堵蔓延时序</div>
            <div class="timeline">
              <div v-for="(e, i) in spreadTimeline" :key="i" class="tl-item">
                <div class="tl-l">
                  <div class="tl-dot" :style="{ background: levelColor[e.level], boxShadow: `0 0 5px ${levelColor[e.level]}80` }"></div>
                  <div v-if="i < spreadTimeline.length - 1" class="tl-line"></div>
                </div>
                <div class="tl-body">
                  <span class="tl-time">{{ e.time }}</span>
                  <span class="tl-ev" :style="{ color: levelColor[e.level] }">{{ e.event }}</span>
                  <span class="tl-node">{{ e.node }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="section module-reveal" :class="{ 'mod-visible': visibleModuleCount >= 3 }">
            <div class="sec-label">主要问题骨架</div>
            <div class="probs">
              <div v-for="(p, i) in problems" :key="i" class="prob-row">
                <span class="prob-tag" :style="{ color: p.color, borderColor: p.color }">{{ p.tag }}</span>
                <span class="prob-txt">{{ p.text }}</span>
              </div>
            </div>
          </div>

          <!-- 关联诊断入口 -->
          <div class="section drill-section module-reveal" :class="{ 'mod-visible': visibleModuleCount >= 4 }">
            <div class="sec-label">关联诊断入口</div>
            <div
              v-for="a in relatedArterials"
              :key="a.name"
              class="drill-item"
              @click="switchAnalysisTabWithContext(a.tab, a.name, `经十路承担出区流量 68%，拥堵指数 ${a.index}，为核心瓶颈干线`)"
            >
              <span class="di-type arterial-type">干线</span>
              <div class="di-info">
                <span class="di-name">{{ a.name }}</span>
                <span class="di-meta">拥堵指数 {{ a.index }} · {{ a.level }}</span>
              </div>
              <span class="di-badge" :style="{ color: a.levelColor, borderColor: a.levelColor + '55' }">{{ a.level }}</span>
              <span class="di-go">诊断 →</span>
            </div>
            <div
              v-for="r in relatedIntersections"
              :key="r.name"
              class="drill-item"
              @click="switchAnalysisTabWithContext(r.tab, r.name, `服务水平${r.grade}，${r.issue}，为区域拥堵核心触发点`)"
            >
              <span class="di-type intersection-type">路口</span>
              <div class="di-info">
                <span class="di-name">{{ r.name }}</span>
                <span class="di-meta">{{ r.gradeLabel }} · {{ r.issue }}</span>
              </div>
              <span class="di-badge" :style="{ color: r.gradeColor, borderColor: r.gradeColor + '55' }">{{ r.grade }}</span>
              <span class="di-go">诊断 →</span>
            </div>
          </div>

          <div class="section module-reveal" :class="{ 'mod-visible': visibleModuleCount >= 5 }">
            <div class="sec-label">区域承载力</div>
            <div class="cap-bar"><div class="cap-fill"></div></div>
            <div class="cap-row">
              <span class="cap-warn">已使用 86% · 饱和临界 ≥80%</span>
              <span class="cap-dim">剩余 14%</span>
            </div>
            <div class="cap-note">东向出口为主要失衡方向</div>
          </div>

      </div>

    </template>
  </div>
</template>

<style scoped>
.panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
}

.section {
  flex-shrink: 0;
  background: rgba(6, 14, 26, 0.76);
  border: 1px solid rgba(0, 200, 230, 0.25);
  padding: 8px;
}
.flex1   { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.flex1 .paths    { flex: 1; min-height: 0; }
.flex1 .timeline { flex: 1; min-height: 0; overflow: hidden; }

.sec-label {
  font-size: 11px;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: rgba(230, 190, 0, 0.75);
  margin-bottom: 5px;
}

.name-badge {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: #eef6ff;
  margin-bottom: 6px;
  gap: 4px;
  overflow: hidden;
}
.ci { font-size: 11px; color: rgba(255, 160, 0, 0.90); border: 1px solid rgba(255,255,255,0.15); padding: 1px 7px; white-space: nowrap; flex-shrink: 0; }
.ci b { color: #ffa500; }

.row3 { display: flex; gap: 5px; }
.kv, .metric {
  flex: 1;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.22);
  padding: 7px 5px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.kv-val, .m-val { font-size: 17px; color: #ffcc00; line-height: 1.1; }
.m-val.warn     { color: #ff8c00; }
.kv-u  { font-size: 11px; color: rgba(220, 240, 255, 0.60); }
.kv-l, .m-l { font-size: 10px; color: rgba(220, 240, 255, 0.62); margin-top: 2px; white-space: nowrap; }

.flow4 { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
.fc { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.22); padding: 6px 8px; display: flex; flex-direction: column; }
.fc-v   { font-size: 15px; color: #ffcc00; }
.fc-v.pos { color: #34d89a; }
.fc-v.neg { color: #f06060; }
.fc-v.dim { color: rgba(220, 240, 255, 0.70); }
.fc-l { font-size: 10px; color: rgba(220, 240, 255, 0.62); margin-top: 2px; white-space: nowrap; }

/* ── 路径 Tab ── */
.path-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
}
.ptab {
  flex: 1;
  padding: 4px 0;
  font-size: 11px;
  letter-spacing: 0.5px;
  color: rgba(220, 240, 255, 0.50);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.20);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.ptab.active {
  color: #ffcc00;
  background: rgba(255, 204, 0, 0.08);
  border-color: rgba(255, 204, 0, 0.40);
}
.ptab:not(.active):hover {
  color: rgba(220, 240, 255, 0.80);
  border-color: rgba(255, 255, 255, 0.22);
}

.paths { display: flex; flex-direction: column; gap: 5px; }
.path-row { display: flex; align-items: center; gap: 5px; }
.p-rank { width: 14px; font-size: 11px; color: rgba(220, 190, 0, 0.65); flex-shrink: 0; }
.p-name { font-size: 12px; color: #eef6ff; width: 90px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.p-track { flex: 1; height: 4px; background: rgba(255, 255, 255, 0.12); border-radius: 2px; overflow: hidden; }
.p-bar { height: 100%; border-radius: 2px; }
.in-bar  { background: linear-gradient(90deg, #34d89a, #20b070); }
.out-bar { background: linear-gradient(90deg, #ff8c00, #ffcc00); }
.p-flow { font-size: 11px; color: rgba(220, 240, 255, 0.68); width: 36px; text-align: right; flex-shrink: 0; }

.timeline { display: flex; flex-direction: column; }
.tl-item { display: flex; gap: 6px; }
.tl-l { display: flex; flex-direction: column; align-items: center; }
.tl-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 3px; }
.tl-line { width: 1px; flex: 1; min-height: 8px; background: rgba(255, 255, 255, 0.12); margin: 2px 0; }
.tl-body { display: flex; align-items: baseline; gap: 5px; padding-bottom: 7px; min-width: 0; }
.tl-time { font-size: 11px; color: rgba(220, 240, 255, 0.65); white-space: nowrap; flex-shrink: 0; }
.tl-ev   { font-size: 12px; font-weight: bold; white-space: nowrap; flex-shrink: 0; }
.tl-node { font-size: 11px; color: rgba(220, 240, 255, 0.58); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.probs { display: flex; flex-direction: column; gap: 6px; }
.prob-row { display: flex; align-items: flex-start; gap: 7px; }
.prob-tag { font-size: 11px; border: 1px solid; padding: 1px 5px; white-space: nowrap; flex-shrink: 0; margin-top: 1px; }
.prob-txt { font-size: 12px; color: rgba(220, 240, 255, 0.88); line-height: 1.5; }

/* ── 下钻入口 ── */
.drill-section { padding: 8px; }
.drill-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.20);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  margin-bottom: 5px;
}
.drill-item:last-child { margin-bottom: 0; }
.drill-item:hover { background: rgba(0, 210, 240, 0.08); border-color: rgba(0, 210, 240, 0.35); }

.di-type {
  flex-shrink: 0;
  font-size: 10px;
  padding: 2px 5px;
  border: 1px solid;
  letter-spacing: 0.5px;
}
.arterial-type     { color: #ff9500; border-color: rgba(255,149,0,0.45); background: rgba(255,149,0,0.08); }
.intersection-type { color: #00d4f0; border-color: rgba(0,212,240,0.45); background: rgba(0,212,240,0.06); }

.di-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.di-name { font-size: 12px; color: #eef6ff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.di-meta { font-size: 11px; color: rgba(220, 240, 255, 0.58); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.di-badge {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: bold;
  border: 1px solid;
  padding: 1px 6px;
}

.di-go {
  flex-shrink: 0;
  font-size: 11px;
  color: rgba(0, 210, 240, 0.55);
  letter-spacing: 0.5px;
  transition: color 0.15s;
}
.drill-item:hover .di-go { color: #00d4f0; }

/* capacity */
.cap-bar { height: 7px; background: rgba(255, 255, 255, 0.12); border-radius: 3px; overflow: hidden; margin-bottom: 4px; }
.cap-fill { width: 86%; height: 100%; background: linear-gradient(90deg, #34d89a, #ffcc00 55%, #ff8c00 78%, #f04020); border-radius: 3px; }
.cap-row { display: flex; justify-content: space-between; }
.cap-warn { font-size: 12px; color: #ff8c00; }
.cap-dim  { font-size: 11px; color: rgba(220, 240, 255, 0.58); }
.cap-note { font-size: 11px; color: rgba(220, 240, 255, 0.65); margin-top: 3px; }

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

<script setup>
import { ref, computed, reactive, onMounted, onUnmounted } from 'vue';
import { switchAnalysisTab, hasSeenAnimation, markSeenAnimation, leftPanelReady, selectedRegion } from '../../../../shared/analysis-state.js';
import ContextHint from '../../../../shared/components/ContextHint.vue';
import AgentReasoning from '../../../../shared/components/AgentReasoning.vue';
import { triggerBroadcast, afterBroadcastDone } from '../../../../shared/broadcast-bus.js';

const props = defineProps({
  selection: { type: Object, default: null },
  side:      { type: String, default: 'right' },
});

// 动画缓存 key
const animKey  = computed(() => `governance:${props.selection?.name || '_'}`);
const skipAnim = computed(() => hasSeenAnimation(animKey.value));

const rootCauses = [
  { icon: '①', title: '直行相位供给不足',   desc: '西进口直行绿信比 45s，供需比仅 63%',         level: 'crit' },
  { icon: '②', title: '历史配时适配偏差',   desc: '原方案优先重点单位，车流结构微变后产生偏移', level: 'high' },
  { icon: '③', title: '上下游绿波失效',     desc: '绿波方案未随流量变化更新，二次停车率偏高',   level: 'high' },
  { icon: '④', title: '干线协调不足',       desc: '历山路与山大路放行时序存在冲突，蔓延加剧',   level: 'med' },
];

const measures = reactive([
  { id: 'm1', tag: '信号优化', target: '经十路—历山路', action: '重新标定西进口直行相位绿信比至 62–68s', effect: '排队↓45% · 均延误↓22s',  conf: 88, color: '#00e5ff',  state: 'pending' },
  { id: 'm2', tag: '干线协调', target: '经十路全线',    action: '基于实测流速重建绿波协调方案',           effect: '停车次↓30% · 效率↑18%', conf: 82, color: '#00ff88',  state: 'pending' },
  { id: 'm3', tag: '策略平衡', target: '重点单位保障',  action: '动态评估保障权重，减少非必要延误',       effect: '兼顾保障与干线通行',     conf: 75, color: '#ffcc00',  state: 'pending' },
  { id: 'm4', tag: '动态感知', target: '全片区路口',    action: '更新感知阈值，启动自适应配时响应',       effect: '减少配时方案滞后',       conf: 70, color: '#a78bfa', state: 'pending' },
]);

// Loop step states
const loopSteps = reactive([
  { step: '诊断', key: 'diag',  done: true,  current: false, tooltip: '已完成路口根因分析，置信度 84%', clickable: false },
  { step: '仿真', key: 'sim',   done: false, current: true,  tooltip: '采纳措施后点击运行仿真预测', clickable: false },
  { step: '下发', key: 'exec',  done: false, current: false, tooltip: '仿真通过后，方案将自动推送至信号控制机', clickable: false },
  { step: '评估', key: 'eval',  done: false, current: false, tooltip: '下发后持续监控路口实时反馈', clickable: false },
  { step: '沉淀', key: 'learn', done: false, current: false, tooltip: '本次决策将更新智能体配时记忆库（已有 1,247 条）', clickable: false },
]);

const simResult = ref(null);
const simRunning = ref(false);
const activeTooltip = ref(null);

// Count accepted measures
const acceptedCount = computed(() => measures.filter(m => m.state === 'accepted').length);
const hasAccepted = computed(() => acceptedCount.value > 0);

// Unlock simulation step when any measure is accepted
function acceptMeasure(m) {
  m.state = 'accepted';
  loopSteps[1].clickable = true;
  loopSteps[1].tooltip = '点击运行仿真（已选 ' + acceptedCount.value + ' 项措施）';
}

function deferMeasure(m) {
  m.state = 'deferred';
}

function restoreMeasure(m) {
  m.state = 'pending';
  if (!hasAccepted.value) {
    loopSteps[1].clickable = false;
    loopSteps[1].tooltip = '采纳措施后点击运行仿真预测';
  }
}

function runSimulation() {
  if (!hasAccepted.value || simRunning.value) return;
  simRunning.value = true;
  simResult.value = null;
  loopSteps[1].current = true;

  setTimeout(() => {
    simRunning.value = false;
    simResult.value = {
      queueReduction: 43,
      delayReduction: 19,
      satReduction: 0.22,
      confidence: 87,
    };
    loopSteps[1].done = true;
    loopSteps[1].current = false;
    loopSteps[2].current = true;
    loopSteps[2].clickable = true;
  }, 2200);
}

function completeStep(idx) {
  if (!loopSteps[idx].clickable || loopSteps[idx].done) return;
  loopSteps[idx].done = true;
  loopSteps[idx].current = false;
  if (idx + 1 < loopSteps.length) {
    loopSteps[idx + 1].current = true;
    loopSteps[idx + 1].clickable = true;
  }
}

const risks = [
  '重点单位出行保障需持续监控',
  '晚高峰反向流量需同步评估',
  '周边支路溢出需预设引流预案',
];

// ── 右侧多阶段推理
const govPhases = [
  {
    type: 'planning', title: '任务规划',
    items: [
      '汇总路口根因分析结论（综合置信度 84%）',
      '评估各优化措施可行性与预期效果',
      '量化优化目标并验证约束条件',
    ],
  },
  {
    type: 'analyzing', title: '指标分析',
    steps: [
      '优先措施：西进口直行绿信比 +17s → 供需比修复至 96%',
      '联动措施：干线绿波重新标定 → 停车次数预计↓30%',
      '约束验证：重点单位保障权重 ≥0.6，不触发降级',
    ],
  },
  {
    type: 'searching', title: '经验库检索',
    query: '路口相位优化 + 干线绿波联动仿真校核',
    results: [
      { name: '2024 经十路信号联动仿真结果', match: 83, desc: '仿真排队↓43%，均延误↓19s，置信度 87%' },
      { name: '2023 重点单位保障 + 绿波兼容方案', match: 72, desc: '保障权重 0.65，干线通行效率提升 15%' },
    ],
  },
];
const govConclusion = '治理方案就绪：信号优化（88%）为最优先措施，联合干线协调可系统性消解路口-干线-区域三级拥堵；建议采纳信号优化与干线协调两项措施并运行仿真验证';

// ── 左侧归纳动画状态
const govLeftPhase = ref('idle'); // 'idle' | 'thinking' | 'done'
const govThinkStep = ref(0);
const visibleRootCauseCount = ref(0);
const visibleRootCauses = computed(() => rootCauses.slice(0, visibleRootCauseCount.value));

const leftTimers = [];
let _cancelThinkWait  = null;
let _cancelModuleWait = null;

function later(fn, ms) {
  const timer = setTimeout(fn, ms);
  leftTimers.push(timer);
}
function clearLeftTimers() {
  leftTimers.forEach(timer => clearTimeout(timer));
  leftTimers.length = 0;
  _cancelThinkWait?.();
  _cancelThinkWait = null;
  _cancelModuleWait?.();
  _cancelModuleWait = null;
}

onMounted(() => {
  if (props.side !== 'left') return;
  leftPanelReady.value = false;

  if (skipAnim.value) {
    govLeftPhase.value          = 'done';
    visibleRootCauseCount.value = rootCauses.length;
    leftPanelReady.value        = true;
    return;
  }

  // 立即显示"归纳中"外壳，等 Tab 播报完成后再推进思考步骤
  govLeftPhase.value          = 'thinking';
  govThinkStep.value          = 0;
  visibleRootCauseCount.value = 0;

  _cancelThinkWait = afterBroadcastDone(() => {
    _cancelThinkWait = null;
    triggerBroadcast('governance_thinking', '智能体正在归纳整合诊断结论，生成治理方案…');
    later(() => { govThinkStep.value = 1; }, 1000);
    later(() => { govThinkStep.value = 2; }, 2000);
    // 思考过程停留更久，强化归纳计算的可感知过程
    later(() => {
      govLeftPhase.value = 'done';

      rootCauses.forEach((_, i) => {
        later(() => { visibleRootCauseCount.value = i + 1; }, 500 + i * 750);
      });

      // 根因逐条打印完成后，右侧面板才开始推理
      later(() => {
        leftPanelReady.value = true;
      }, 500 + rootCauses.length * 750 + 900);
    }, 3400);
  });
});

onUnmounted(clearLeftTimers);

// ── 右侧推理模块状态
const reasoningDone = ref(false);
const showMeasureTitle = ref(false);
const visibleMeasureCount = ref(0);
const showRisks = ref(false);
const showFooter = ref(false);

function handleReasoningDone() {
  const wasSeen = skipAnim.value;
  reasoningDone.value = true;
  markSeenAnimation(animKey.value);
  if (wasSeen) {
    showMeasureTitle.value    = true;
    visibleMeasureCount.value = measures.length;
    showRisks.value           = true;
    showFooter.value          = true;
    return;
  }
  // 等 agent_done 播报完成后再逐步显示治理措施模块
  _cancelModuleWait = afterBroadcastDone(() => {
    _cancelModuleWait = null;
    setTimeout(() => { showMeasureTitle.value = true; }, 200);
    measures.forEach((_, i) => {
      setTimeout(() => { visibleMeasureCount.value = i + 1; }, 700 + i * 700);
    });
    const afterAllCards = 700 + measures.length * 700;
    setTimeout(() => { showRisks.value = true; },   afterAllCards + 500);
    setTimeout(() => { showFooter.value = true; },  afterAllCards + 1000);
  });
}
</script>

<template>
  <div class="panel">

    <!-- ── LEFT ── -->
    <template v-if="side === 'left'">

      <ContextHint />

      <div class="section">
        <div class="target-row">
          <span class="tgt-name">{{ selectedRegion || '舜耕路—山大路片区' }} · 经十路—历山路路口</span>
          <span class="tgt-tag">待优化</span>
        </div>
      </div>

      <!-- 思考中：智能体归纳总结动画 -->
      <div v-if="govLeftPhase === 'thinking'" class="gov-thinking">
        <div class="gt-header">
          <span class="gt-spin">◈</span>
          <span class="gt-title">智能体归纳总结中</span>
        </div>
        <div class="gt-lines">
          <div class="gt-line gt-vis">整合区域、干线、路口诊断结论…</div>
          <div class="gt-line" :class="{ 'gt-vis': govThinkStep >= 1 }">识别主要问题根因与关联关系…</div>
          <div class="gt-line" :class="{ 'gt-vis': govThinkStep >= 2 }">归纳优化优先级与约束条件…</div>
        </div>
      </div>

      <!-- 结果展示：归纳完成后显示 -->
      <div v-else-if="govLeftPhase === 'done'" class="section flex1">
        <div class="sec-label">问题根因归纳</div>
        <div class="causes">
          <transition-group name="cause-print">
            <div
              v-for="c in visibleRootCauses"
              :key="c.icon"
              class="cause-item"
              :class="'cause-' + c.level"
            >
              <span class="cause-icon">{{ c.icon }}</span>
              <div class="cause-body">
                <div class="cause-title">{{ c.title }}</div>
                <div class="cause-desc">{{ c.desc }}</div>
              </div>
            </div>
          </transition-group>
        </div>
      </div>

      <!-- Loop progress -->
      <div class="section">
        <div class="sec-label">智能闭环迭代进程</div>
        <div class="loop-row">
          <div
            v-for="(s, i) in loopSteps"
            :key="s.step"
            class="lp-step"
            @mouseenter="activeTooltip = i"
            @mouseleave="activeTooltip = null"
          >
            <div
              class="lp-dot"
              :class="{
                'lp-done': s.done,
                'lp-cur': s.current && !s.done,
                'lp-clickable': s.clickable && !s.done,
                'lp-simming': s.key === 'sim' && simRunning,
              }"
              @click="s.key === 'sim' ? runSimulation() : completeStep(i)"
            ></div>
            <div v-if="i < loopSteps.length - 1" class="lp-conn"></div>
            <span
              class="lp-lbl"
              :class="{ 'lp-lbl-done': s.done, 'lp-lbl-cur': s.current && !s.done }"
            >{{ s.step }}</span>

            <!-- Tooltip -->
            <transition name="tt-fade">
              <div v-if="activeTooltip === i" class="lp-tooltip">{{ s.tooltip }}</div>
            </transition>
          </div>
        </div>

        <!-- Sim running indicator -->
        <div v-if="simRunning" class="sim-running">
          <span class="sim-dot"></span>
          智能体仿真推演中…
        </div>

        <!-- Sim result bubble -->
        <transition name="result-pop">
          <div v-if="simResult" class="sim-result">
            <div class="sr-title">◈ 仿真预测结果</div>
            <div class="sr-grid">
              <div class="sr-item"><span class="sr-v pos">↓{{ simResult.queueReduction }}%</span><span class="sr-l">排队长度</span></div>
              <div class="sr-item"><span class="sr-v pos">↓{{ simResult.delayReduction }}s</span><span class="sr-l">均延误</span></div>
              <div class="sr-item"><span class="sr-v pos">↓{{ simResult.satReduction }}</span><span class="sr-l">饱和度</span></div>
              <div class="sr-item"><span class="sr-v conf">{{ simResult.confidence }}%</span><span class="sr-l">置信度</span></div>
            </div>
          </div>
        </transition>
      </div>

    </template>

    <!-- ── RIGHT ── -->
    <template v-else>

      <!-- 等待左侧归纳完成（已看过时无需等待） -->
      <div v-if="!leftPanelReady && !skipAnim" class="right-waiting">
        <span class="wait-spin">◎</span>
        <span class="wait-text">智能体待命中</span>
        <span class="wait-sub">等待根因归纳完成…</span>
      </div>

      <!-- 多阶段推理（左侧归纳完毕后启动；已看过则直接跳过） -->
      <AgentReasoning
        v-if="leftPanelReady || skipAnim"
        :phases="govPhases"
        :conclusion="govConclusion"
        :auto-collapse="true"
        :delay="650"
        :skip-animation="skipAnim"
        @done="handleReasoningDone"
      />

      <!-- 推理完成后各模块逐步出现 -->
      <div v-if="reasoningDone" class="right-results">

        <!-- 标题先出 -->
        <div class="section module-reveal" :class="{ 'mod-visible': showMeasureTitle }">
          <div class="sec-label-hd">
            <span>优化措施建议</span>
            <span v-if="acceptedCount > 0" class="acc-badge">已采纳 {{ acceptedCount }} 项</span>
          </div>
        </div>

        <!-- 措施卡片逐张出现 -->
        <div class="measures flex2">
          <div
            v-for="(m, idx) in measures"
            :key="m.id"
            class="measure-card module-reveal"
            :class="{
              'card-accepted': m.state === 'accepted',
              'card-deferred': m.state === 'deferred',
              'mod-visible': idx < visibleMeasureCount,
            }"
          >
            <div class="mc-hd">
              <span class="mc-tag" :style="{ color: m.color, borderColor: m.color + '44' }">{{ m.tag }}</span>
              <span class="mc-tgt">{{ m.target }}</span>
              <span class="mc-conf">{{ m.conf }}%</span>
            </div>
            <div class="mc-action">{{ m.action }}</div>
            <div class="mc-effect">↗ {{ m.effect }}</div>
            <div class="mc-bar-wrap">
              <div class="mc-bar" :style="{ width: m.conf + '%', background: m.color }"></div>
            </div>
            <div class="mc-actions">
              <template v-if="m.state === 'pending'">
                <button class="mc-btn accept" @click="acceptMeasure(m)">采纳</button>
                <button class="mc-btn defer" @click="deferMeasure(m)">暂缓</button>
              </template>
              <template v-else-if="m.state === 'accepted'">
                <span class="mc-state accepted">✓ 已采纳</span>
                <button class="mc-btn restore" @click="restoreMeasure(m)">撤回</button>
              </template>
              <template v-else>
                <span class="mc-state deferred">— 已暂缓</span>
                <button class="mc-btn restore" @click="restoreMeasure(m)">恢复</button>
              </template>
            </div>
          </div>
        </div>

        <!-- 风险提示 -->
        <div class="section module-reveal" :class="{ 'mod-visible': showRisks }">
          <div class="sec-label-risk">风险提示</div>
          <div class="risks">
            <div v-for="(r, i) in risks" :key="i" class="risk-row">
              <span class="risk-ic">△</span><span class="risk-txt">{{ r }}</span>
            </div>
          </div>
        </div>

        <!-- 页脚 -->
        <div class="section module-reveal" :class="{ 'mod-visible': showFooter }">
          <div class="af-row">
            <span class="af-lbl">智能体持续学习中</span>
            <span class="af-cnt"><i></i>已积累 1,247 条历史配时经验</span>
          </div>
          <div class="back-row">
            <span class="back-hint">← 返回</span>
            <span class="back-btn" @click="switchAnalysisTab('intersection')">路口诊断</span>
            <span class="back-sep">|</span>
            <span class="back-btn" @click="switchAnalysisTab('city')">全城态势</span>
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
.flex2 { flex: 2; min-height: 0; }
.flex1 .causes { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; gap: 6px; }
.measures.flex2 {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  background: rgba(6, 14, 26, 0.76);
  border: 1px solid rgba(0, 200, 230, 0.25);
  padding: 8px;
}

.sec-label { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: rgba(180, 160, 255, 0.80); margin-bottom: 5px; }
.sec-label-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: rgba(180, 160, 255, 0.80);
}
.acc-badge {
  font-size: 10px;
  color: #34d89a;
  border: 1px solid rgba(52, 216, 154, 0.60);
  padding: 1px 7px;
  letter-spacing: 0.5px;
  text-transform: none;
}
.sec-label-risk { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: rgba(255, 200, 0, 0.75); margin-bottom: 5px; }

/* target */
.target-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 4px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.22); padding: 7px 9px; }
.tgt-name { font-size: 12px; color: #eef6ff; }
.tgt-tag  { font-size: 11px; color: #ffcc00; border: 1px solid rgba(255,204,0,0.40); padding: 1px 7px; }

/* causes */
.cause-item { display: flex; gap: 8px; padding: 7px 8px; border-left: 2px solid; flex-shrink: 0; }
.cause-crit { background: rgba(200,40,20,0.10);  border-color: #e03020; }
.cause-high { background: rgba(200,100,0,0.08); border-color: #e07000; }
.cause-med  { background: rgba(200,160,0,0.07); border-color: #c8a000; }
.cause-icon { font-size: 12px; color: #c4aaff; flex-shrink: 0; width: 14px; }
.cause-body { display: flex; flex-direction: column; gap: 2px; }
.cause-title { font-size: 12px; color: #eef6ff; }
.cause-desc  { font-size: 11px; color: rgba(220,240,255,0.68); line-height: 1.4; }

.cause-print-enter-active {
  transition: opacity 0.35s ease, transform 0.35s ease;
}
.cause-print-enter-from {
  opacity: 0;
  transform: translateX(-8px);
}

/* ── Loop ── */
.loop-row { display: flex; align-items: flex-end; gap: 0; position: relative; }
.lp-step { display: flex; flex-direction: column; align-items: center; position: relative; flex: 1; }
.lp-dot {
  width: 10px; height: 10px; border-radius: 50%;
  background: rgba(180,160,255,0.18);
  border: 1px solid rgba(180,160,255,0.30);
  transition: transform 0.15s, box-shadow 0.15s;
}
.lp-done { background: #34d89a; border-color: #34d89a; box-shadow: 0 0 5px rgba(52,216,154,0.55); }
.lp-cur  { background: #c4aaff; border-color: #c4aaff; box-shadow: 0 0 5px rgba(196,170,255,0.60); animation: blink 2s infinite; }
.lp-clickable { cursor: pointer; border-color: rgba(196,170,255,0.70); background: rgba(196,170,255,0.25); }
.lp-clickable:hover { transform: scale(1.3); box-shadow: 0 0 8px rgba(196,170,255,0.70); }
.lp-simming { animation: spin-dot 1s linear infinite; }

@keyframes blink { 0%,100%{opacity:1}50%{opacity:0.4} }
@keyframes spin-dot { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

.lp-conn { position: absolute; top: 4px; left: calc(50% + 6px); right: calc(-50% + 6px); height: 1px; background: rgba(180,160,255,0.18); }
.lp-lbl { font-size: 11px; color: rgba(180,160,255,0.55); margin-top: 4px; }
.lp-lbl-done { color: #34d89a; }
.lp-lbl-cur  { color: #c4aaff; }

/* Tooltip */
.lp-tooltip {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: rgba(6, 14, 26, 0.95);
  border: 1px solid rgba(196, 170, 255, 0.65);
  color: rgba(220, 240, 255, 0.88);
  font-size: 10px;
  padding: 4px 8px;
  white-space: nowrap;
  z-index: 20;
  pointer-events: none;
  line-height: 1.4;
}
.tt-fade-enter-active, .tt-fade-leave-active { transition: opacity 0.15s; }
.tt-fade-enter-from, .tt-fade-leave-to { opacity: 0; }

/* sim running */
.sim-running {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-size: 11px;
  color: rgba(196, 170, 255, 0.85);
}
.sim-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: #c4aaff;
  box-shadow: 0 0 6px #c4aaff;
  flex-shrink: 0;
  animation: blink 0.8s infinite;
}

/* sim result */
.sim-result {
  margin-top: 7px;
  background: rgba(52, 216, 154, 0.06);
  border: 1px solid rgba(52, 216, 154, 0.50);
  padding: 7px 9px;
}
.sr-title {
  font-size: 11px;
  color: #34d89a;
  letter-spacing: 1px;
  margin-bottom: 6px;
}
.sr-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
.sr-item { display: flex; flex-direction: column; }
.sr-v { font-size: 16px; font-weight: bold; line-height: 1.1; }
.sr-v.pos  { color: #34d89a; }
.sr-v.conf { color: #00d4f0; }
.sr-l { font-size: 10px; color: rgba(220, 240, 255, 0.55); margin-top: 2px; }

.result-pop-enter-active { transition: opacity 0.4s, transform 0.4s; }
.result-pop-enter-from   { opacity: 0; transform: scale(0.95) translateY(5px); }

/* ── Measure cards ── */
.measure-card {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.22);
  padding: 8px;
  flex-shrink: 0;
  transition: border-color 0.2s, background 0.2s;
}
.card-accepted {
  border-color: rgba(52, 216, 154, 0.65) !important;
  background: rgba(52, 216, 154, 0.04) !important;
}
.card-deferred {
  border-color: rgba(255, 255, 255, 0.07) !important;
  opacity: 0.55;
}

.mc-hd { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; overflow: hidden; }
.mc-tag { font-size: 11px; border: 1px solid; padding: 1px 6px; white-space: nowrap; flex-shrink: 0; }
.mc-tgt { font-size: 11px; color: rgba(220,240,255,0.72); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.mc-conf { font-size: 11px; color: rgba(220,240,255,0.50); white-space: nowrap; }
.mc-action { font-size: 12px; color: #eef6ff; margin-bottom: 3px; line-height: 1.5; }
.mc-effect { font-size: 11px; color: rgba(52,216,154,0.88); margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mc-bar-wrap { height: 4px; background: rgba(255,255,255,0.10); border-radius: 2px; overflow: hidden; margin-bottom: 7px; }
.mc-bar { height: 100%; border-radius: 2px; opacity: 0.75; }

.mc-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
  padding-top: 6px;
}

.mc-btn {
  font-size: 10px;
  font-family: inherit;
  padding: 2px 10px;
  cursor: pointer;
  letter-spacing: 0.5px;
  transition: background 0.12s, border-color 0.12s;
  border: 1px solid;
}

.mc-btn.accept {
  background: rgba(52, 216, 154, 0.10);
  border-color: rgba(52, 216, 154, 0.45);
  color: #34d89a;
}
.mc-btn.accept:hover {
  background: rgba(52, 216, 154, 0.22);
}

.mc-btn.defer {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(220, 240, 255, 0.55);
}
.mc-btn.defer:hover {
  background: rgba(255, 255, 255, 0.09);
}

.mc-btn.restore {
  background: none;
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(220, 240, 255, 0.45);
}
.mc-btn.restore:hover {
  color: rgba(220, 240, 255, 0.75);
}

.mc-state {
  flex: 1;
  font-size: 11px;
}
.mc-state.accepted { color: #34d89a; }
.mc-state.deferred { color: rgba(220, 240, 255, 0.40); }

/* risks */
.risks { display: flex; flex-direction: column; gap: 5px; }
.risk-row { display: flex; gap: 6px; align-items: flex-start; }
.risk-ic  { font-size: 11px; color: #e8c040; flex-shrink: 0; margin-top: 1px; }
.risk-txt { font-size: 12px; color: rgba(220,240,255,0.80); line-height: 1.5; }

/* footer */
.af-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.af-lbl { font-size: 11px; color: rgba(180,160,255,0.75); }
.af-cnt { display: flex; align-items: center; gap: 5px; font-size: 11px; color: rgba(220,240,255,0.60); }
.af-cnt i { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #c4aaff; box-shadow: 0 0 4px #c4aaff; }

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

/* ── 左侧归纳思考动画 ── */
.gov-thinking {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: rgba(6, 14, 26, 0.80);
  border: 1px solid rgba(180, 160, 255, 0.22);
  padding: 14px 12px;
}

.gt-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(180, 160, 255, 0.12);
}

.gt-spin {
  font-size: 13px;
  color: #c4aaff;
  animation: gt-rotate 1.4s linear infinite;
  display: inline-block;
  flex-shrink: 0;
}

@keyframes gt-rotate {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

.gt-title {
  font-size: 11px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: rgba(196, 170, 255, 0.85);
}

.gt-lines {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-left: 2px;
}

.gt-line {
  font-size: 12px;
  color: rgba(196, 170, 255, 0.80);
  opacity: 0;
  transform: translateX(-6px);
  transition: opacity 0.35s ease, transform 0.35s ease;
  line-height: 1.5;
}

.gt-line.gt-vis {
  opacity: 1;
  transform: translateX(0);
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
  color: rgba(196, 170, 255, 0.70);
  animation: gt-rotate 1.4s linear infinite;
  display: inline-block;
}

.wait-text {
  font-size: 12px;
  letter-spacing: 1.5px;
  color: rgba(196, 170, 255, 0.80);
  text-transform: uppercase;
}

.wait-sub {
  font-size: 11px;
  color: rgba(220, 240, 255, 0.50);
}

/* 右侧推理结果区 */
.right-results {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
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
</style>

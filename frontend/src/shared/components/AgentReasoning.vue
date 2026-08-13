<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { triggerBroadcast, afterBroadcastDone, whenBroadcastIdle } from '../broadcast-bus.js';
import { conclusionSpaceWaitActive } from '../act-playback.js';
import {
  fetchCaseSceneBrief,
  fetchCaseSolutionBrief,
} from '../../services/voiceBrief.js';

const props = defineProps({
  // ── 新多阶段模式 ──
  phases:        { type: Array,   default: () => [] },
  // ── 兼容旧单阶段模式 ──
  steps:         { type: Array,   default: () => [] },
  // ── 共用 ──
  conclusion:    { type: String,  required: true },
  delay:         { type: Number,  default: 400 },
  autoCollapse:  { type: Boolean, default: false },
  // 跳过动画：已看过的对象重新打开时直接显示结论，不重播过程
  skipAnimation: { type: Boolean, default: false },
  /** 覆盖 analyzing 逐步间隔（ms）；默认 1520 */
  analysisStepDelay: { type: Number, default: null },
  /** 覆盖阶段收束间隔（ms）；默认 1720 */
  phaseSettleDelay: { type: Number, default: null },
  /** 打字机每字间隔（ms）；默认 26 */
  typewriterMs: { type: Number, default: null },
  /** 覆盖经验库扫描等待（ms）；默认 6000 */
  searchScanDelay: { type: Number, default: null },
  /** 覆盖检索结果逐条间隔（ms）；默认 1400 */
  searchResultDelay: { type: Number, default: null },
  /**
   * 启动前是否等待口播空闲。
   * 叙事幕次应 false：口播与打字机/地图并行；旧场景面板可保持 true。
   */
  waitBroadcastBeforeStart: { type: Boolean, default: true },
  /** 是否播 agent_planning / analyzing 等阶段口播（幕次由 beat_id 承担讲解，建议 false） */
  phaseBroadcast: { type: Boolean, default: true },
  /** 打字机结论（"主因锁定：…"）播完后暂停，等待用户按空格键才继续；
   * 节拍放在相似案例展示 + 结论都读完之后，而不是案例刚展示完就打断 */
  pauseAfterConclusion: { type: Boolean, default: false },
  /** Act6：Top1–3 展示完成后口播「查看相似案例」，再弹 Top1 并播报场景/方案 */
  autoVoiceTop1Case: { type: Boolean, default: false },
});

const emit = defineEmits(['done', 'phase-start', 'item']);

const isMultiPhase = computed(() => props.phases && props.phases.length > 0);

const PLANNING_STEP_DELAY = 1040;
const ANALYSIS_STEP_DELAY = 1520;
const PHASE_SETTLE_DELAY = 1720;
const SEARCH_SCAN_DELAY = 6000;
const SEARCH_RESULT_DELAY = 1400;

const analysisStepMs = computed(() => props.analysisStepDelay ?? ANALYSIS_STEP_DELAY);
const phaseSettleMs = computed(() => props.phaseSettleDelay ?? PHASE_SETTLE_DELAY);
const typewriterIntervalMs = computed(() => props.typewriterMs ?? 26);
const searchScanMs = computed(() => props.searchScanDelay ?? SEARCH_SCAN_DELAY);
const searchResultMs = computed(() => props.searchResultDelay ?? SEARCH_RESULT_DELAY);

// ── 共用状态 ──────────────────────────────────────────────────────
const expanded      = ref(true);
const playing       = ref(false);
const finished      = ref(false);
const inTypewriter  = ref(false);
const displayedText = ref('');

// ── 旧模式 ───────────────────────────────────────────────────────
const visibleCount = ref(0);

// ── 新模式：每阶段进度 ────────────────────────────────────────────
// 在 script 执行阶段同步初始化，确保模板首次渲染就能访问
const phaseProgress = reactive(
  (props.phases || []).map(() => ({
    visibleItems:       0,
    searchState:        'idle', // 'idle' | 'searching' | 'done'
    searchResultsCount: 0,
  }))
);

// 当前激活的阶段索引（-1 = 未开始）
const currentPhaseIdx = ref(-1);

// ── 案例展示前暂停，等待空格键 ────────────────────────────────────
const awaitingContinue = ref(false);
let _spaceHandler = null;

function waitForSpace(onContinue) {
  awaitingContinue.value = true;
  conclusionSpaceWaitActive.value = true;
  _spaceHandler = (e) => {
    if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      e.stopImmediatePropagation();
      window.removeEventListener('keydown', _spaceHandler, true);
      _spaceHandler = null;
      awaitingContinue.value = false;
      conclusionSpaceWaitActive.value = false;
      onContinue();
    }
  };
  window.addEventListener('keydown', _spaceHandler, true);
}
function clearSpaceWait() {
  if (_spaceHandler) {
    window.removeEventListener('keydown', _spaceHandler, true);
    _spaceHandler = null;
  }
  awaitingContinue.value = false;
  conclusionSpaceWaitActive.value = false;
}

// ── 案例详情弹窗 ──────────────────────────────────────────────────
const activeCaseDetail = ref(null);
let _caseDetailVoiceToken = 0;
let _top1CaseVoiceStarted = false;

function waitVoicePipelineIdle() {
  return whenBroadcastIdle({ settleMs: 150, safetyMs: 120_000 });
}

async function speakCaseDetailVoice(detail) {
  if (!detail) return;
  const token = ++_caseDetailVoiceToken;
  const sceneRaw = String(detail.scene || '').trim();
  const solutionRaw = String(detail.solution || '').trim();
  if (!sceneRaw && !solutionRaw) return;

  const sceneBrief = sceneRaw ? await fetchCaseSceneBrief(sceneRaw) : '';
  if (token !== _caseDetailVoiceToken) return;
  if (sceneBrief) {
    triggerBroadcast('a6.case_scene', `案例场景：${sceneBrief}`);
    await waitVoicePipelineIdle();
  }
  if (token !== _caseDetailVoiceToken) return;

  const solutionBrief = solutionRaw ? await fetchCaseSolutionBrief(solutionRaw) : '';
  if (token !== _caseDetailVoiceToken) return;
  if (solutionBrief) {
    triggerBroadcast('a6.case_solution', `治理方案：${solutionBrief}`);
    await waitVoicePipelineIdle();
  }
}

function openCaseDetail(r, opts = {}) {
  if (!r?.detail) return;
  activeCaseDetail.value = r.detail;
  if (opts.voice) {
    speakCaseDetailVoice(r.detail);
  }
}

function maybeAutoOpenTop1Case(results) {
  if (!props.autoVoiceTop1Case || _top1CaseVoiceStarted) return Promise.resolve();
  const list = Array.isArray(results) ? results : [];
  const top1 = list.find((r) => r.rank === 1) || list[0];
  if (!top1?.detail) return Promise.resolve();
  _top1CaseVoiceStarted = true;

  return new Promise((resolve) => {
    triggerBroadcast('a6.view_cases', '查看相似案例。');
    afterBroadcastDone(async () => {
      openCaseDetail(top1, { voice: false });
      await speakCaseDetailVoice(top1.detail);
      resolve();
    });
  });
}

function closeCaseDetail() {
  activeCaseDetail.value = null;
  _caseDetailVoiceToken += 1;
}

// ── 定时器管理 ────────────────────────────────────────────────────
const _timers = [];
let _cancelBroadcastWait = null;

function later(fn, ms) {
  const t = setTimeout(fn, ms);
  _timers.push(t);
}
function every(fn, ms) {
  const t = setInterval(fn, ms);
  _timers.push(t);
  return { stop: () => clearInterval(t) };
}
function clearAll() {
  _timers.forEach(t => { clearTimeout(t); clearInterval(t); });
  _timers.length = 0;
  _cancelBroadcastWait?.();
  _cancelBroadcastWait = null;
  clearSpaceWait();
}

// ── 旧模式动画 ────────────────────────────────────────────────────
function startLegacy() {
  visibleCount.value  = 0;
  displayedText.value = '';
  finished.value      = false;
  playing.value       = true;

  if (!props.steps.length) { runTypewriter(); return; }

  let idx = 0;
  const iv = every(() => {
    idx++;
    visibleCount.value = idx;
    if (idx >= props.steps.length) {
      iv.stop();
      later(runTypewriter, 360);
    }
  }, 460);
}

// ── 新模式动画 ────────────────────────────────────────────────────
function startMulti() {
  playing.value       = true;
  finished.value      = false;
  displayedText.value = '';
  // 重置各阶段进度
  phaseProgress.forEach(p => {
    p.visibleItems       = 0;
    p.searchState        = 'idle';
    p.searchResultsCount = 0;
  });
  runPhase(0);
}

function runPhase(pIdx) {
  if (pIdx >= props.phases.length) { later(runTypewriter, 500); return; }
  currentPhaseIdx.value = pIdx;
  const phase = props.phases[pIdx];
  emit('phase-start', phase, pIdx);
  const prog  = phaseProgress[pIdx];

  if (phase.type === 'planning') {
    if (props.phaseBroadcast) triggerBroadcast('agent_planning');
    const items = phase.items || [];
    let i = 0;
    function tick() {
      if (i < items.length) {
        prog.visibleItems = i + 1;
        emit('item', {
          type: 'planning',
          phaseIdx: pIdx,
          itemIdx: i,
          total: items.length,
          text: items[i],
        });
        i++;
        later(tick, PLANNING_STEP_DELAY);
      } else {
        later(() => runPhase(pIdx + 1), PHASE_SETTLE_DELAY);
      }
    }
    later(tick, 300);

  } else if (phase.type === 'analyzing') {
    if (props.phaseBroadcast) triggerBroadcast('agent_analyzing');
    const steps = phase.steps || [];
    let i = 0;
    function tick() {
      if (i < steps.length) {
        prog.visibleItems = i + 1;
        emit('item', {
          type: 'analyzing',
          phaseIdx: pIdx,
          itemIdx: i,
          total: steps.length,
          text: steps[i],
        });
        i++;
        later(tick, analysisStepMs.value);
      } else {
        later(() => runPhase(pIdx + 1), phaseSettleMs.value);
      }
    }
    later(tick, Math.min(300, analysisStepMs.value));

  } else if (phase.type === 'visualization') {
    if (props.phaseBroadcast) {
      triggerBroadcast(phase.broadcastKey ?? 'viz_pause', phase.broadcastText);
    }
    // 停顿指定时长，为地图可视化留出展示窗口，然后进入下一阶段
    later(() => runPhase(pIdx + 1), phase.duration ?? 15000);

  } else if (phase.type === 'searching') {
    if (props.phaseBroadcast) triggerBroadcast('agent_searching');
    prog.searchState = 'searching';
    const results = phase.results || [];
    // 经验库检索：先让扫描动画跑足够长时间，营造真实搜索感
    later(() => {
      prog.searchState = 'done';
      let i = 0;
      function tick() {
        if (i < results.length) {
          prog.searchResultsCount = i + 1; i++;
          later(tick, searchResultMs.value);
        } else {
          // 先播完「查看相似案例 + 场景/方案口播」，再进入结论打字机
          Promise.resolve(maybeAutoOpenTop1Case(results)).then(() => {
            later(() => runPhase(pIdx + 1), phaseSettleMs.value);
          });
        }
      }
      later(tick, 280);
    }, searchScanMs.value);
  }
}

// ── 打字机 ───────────────────────────────────────────────────────
function runTypewriter() {
  inTypewriter.value  = true;
  let i = 0;
  const text = props.conclusion;
  const iv = every(() => {
    if (i < text.length) {
      displayedText.value += text[i]; i++;
    } else {
      iv.stop();
      inTypewriter.value = false;
      playing.value      = false;
      finished.value     = true;
      const finishUp = () => {
        if (props.autoCollapse) {
          // 打字机结束后停顿 1200ms，让用户读完结论，再收起推理过程
          later(() => { expanded.value = false; }, 1200);
          // 收起动画约 280ms，再留 500ms 缓冲，确保完全收起后才通知面板加载子模块
          later(() => {
            if (props.phaseBroadcast) triggerBroadcast('agent_done');
            emit('done');
          }, 1980);
        } else {
          if (props.phaseBroadcast) triggerBroadcast('agent_done');
          emit('done');
        }
      };
      // 结论（"主因锁定：…"）播完后先暂停，等用户按空格键主动继续，而不是
      // 自动往下播——把节拍留在相似案例展示 + 结论都读完之后
      if (props.pauseAfterConclusion) {
        waitForSpace(finishUp);
      } else {
        finishUp();
      }
    }
  }, typewriterIntervalMs.value);
}

// ── 生命周期 ─────────────────────────────────────────────────────
onMounted(() => {
  if (props.skipAnimation) {
    // 直接跳到完成态，不播放任何过程动画
    displayedText.value = props.conclusion;
    finished.value      = true;
    playing.value       = false;
    expanded.value      = false; // 收起过程区（已看过，不需要展开）
    // 将所有阶段标记为完成，保证展开时内容完整
    if (isMultiPhase.value) {
      props.phases.forEach((phase, i) => {
        const p = phaseProgress[i];
        if (phase.type === 'planning')  p.visibleItems = (phase.items   || []).length;
        if (phase.type === 'analyzing') p.visibleItems = (phase.steps   || []).length;
        if (phase.type === 'searching') {
          p.searchState        = 'done';
          p.searchResultsCount = (phase.results || []).length;
        }
      });
      currentPhaseIdx.value = props.phases.length - 1;
    } else {
      visibleCount.value = props.steps.length;
    }
    emit('done');
    return;
  }
  // 幕内默认可与口播并行；旧场景可 waitBroadcastBeforeStart=true 串行开场
  later(() => {
    const start = () => {
      _cancelBroadcastWait = null;
      isMultiPhase.value ? startMulti() : startLegacy();
    };
    if (!props.waitBroadcastBeforeStart) {
      start();
      return;
    }
    _cancelBroadcastWait = afterBroadcastDone(start);
  }, props.delay);
});
onUnmounted(clearAll);

// ── 工具函数 ─────────────────────────────────────────────────────
const PHASE_ICONS = { planning: '▸', analyzing: '⊙', searching: '◎', visualization: '▣' };
function phaseIcon(type) { return PHASE_ICONS[type] || '◈'; }

function isPhaseComplete(pIdx) {
  if (finished.value) return true;
  return pIdx < currentPhaseIdx.value;
}
</script>

<template>
  <div class="ar-wrap">

    <!-- 顶栏 -->
    <div class="ar-header">
      <span class="ar-icon" :class="{ 'ar-spin': playing }">◈</span>
      <span class="ar-title">智能体推理</span>
      <button
        v-if="isMultiPhase ? phases.length > 0 : steps.length > 0"
        class="ar-toggle"
        @click="expanded = !expanded"
      >{{ expanded ? '收起' : '展开过程' }}</button>
    </div>

    <!-- ── 新多阶段模式 ── -->
    <template v-if="isMultiPhase">
      <transition name="slide">
        <div v-if="expanded" class="ar-process">

          <div
            v-for="(phase, pIdx) in phases"
            v-show="pIdx <= currentPhaseIdx"
            :key="pIdx"
            class="ar-phase"
            :class="{
              'ph-active': pIdx === currentPhaseIdx && !finished,
              'ph-past':   pIdx < currentPhaseIdx || finished,
            }"
          >
            <!-- 阶段标题行 -->
            <div class="ph-hd">
              <span class="ph-ic">{{ phaseIcon(phase.type) }}</span>
              <span class="ph-name">{{ phase.title }}</span>
              <span v-if="isPhaseComplete(pIdx)" class="ph-check">✓</span>
              <span v-else-if="pIdx === currentPhaseIdx" class="ph-active-dot"></span>
            </div>

            <!-- planning：任务清单 -->
            <div v-if="phase.type === 'planning'" class="task-list">
              <div
                v-for="(item, i) in (phase.items || [])"
                :key="i"
                class="task-item"
                :class="{ 'ti-done': i < phaseProgress[pIdx].visibleItems }"
              >
                <span class="ti-ic">{{ i < phaseProgress[pIdx].visibleItems ? '✓' : '○' }}</span>
                <span class="ti-txt">{{ item }}</span>
              </div>
            </div>

            <!-- analyzing：分析日志 -->
            <div v-else-if="phase.type === 'analyzing'" class="step-log">
              <div
                v-for="(step, i) in (phase.steps || [])"
                :key="i"
                class="log-item"
                :class="{ 'li-vis': i < phaseProgress[pIdx].visibleItems }"
              >
                <span class="li-ic">{{ i < phaseProgress[pIdx].visibleItems ? '✓' : '○' }}</span>
                <span class="li-txt">{{ step }}</span>
              </div>
            </div>

            <!-- visualization：地图可视化停顿 -->
            <div v-else-if="phase.type === 'visualization'" class="viz-block">
              <template v-if="pIdx === currentPhaseIdx && !finished">
                <div class="viz-active-row">
                  <span class="viz-pulse-dot"></span>
                  <span class="viz-label">地图证据同步中…</span>
                </div>
                <div class="viz-progress-bar"><div class="viz-progress-fill"></div></div>
              </template>
              <div v-else class="viz-done-row">
                <span class="viz-done-ic">✓</span>
                <span class="viz-done-txt">地图证据已同步</span>
              </div>
            </div>

            <!-- searching：扫描 + 经验库结果 -->
            <div v-else-if="phase.type === 'searching'" class="search-block">
              <!-- 扫描动画 -->
              <div v-if="phaseProgress[pIdx].searchState === 'searching'" class="scan-row">
                <span class="scan-dot"></span>
                <span class="scan-txt">正在检索历史经验库…</span>
                <div class="scan-bar"><div class="scan-fill"></div></div>
              </div>

              <!-- 检索结果 -->
              <template v-if="phaseProgress[pIdx].searchState === 'done'">
                <div class="kb-meta">
                  <span class="kb-count">命中 {{ (phase.results || []).length }} 条历史经验</span>
                  <span class="kb-query">「{{ phase.query }}」</span>
                </div>
                <div
                  v-for="(r, i) in (phase.results || [])"
                  :key="i"
                  class="kb-item"
                  :class="{ 'kbi-vis': i < phaseProgress[pIdx].searchResultsCount, 'kbi-clickable': !!r.detail }"
                  @click="openCaseDetail(r)"
                >
                  <div class="kbi-top">
                    <span v-if="r.rank" class="kbi-rank">Top{{ r.rank }}</span>
                    <span class="kbi-name">{{ r.name }}</span>
                    <span class="kbi-match">{{ r.match }}%</span>
                  </div>
                  <!-- TEMP: Top 匹配度进度条暂停
                  <div class="kbi-track">
                    <div
                      class="kbi-bar"
                      :style="{ width: r.match + '%' }"
                    ></div>
                  </div>
                  -->

                  <!-- 第一行=语义片段，第二行=标签；样式统一为弱化 tag 色 -->
                  <div
                    v-if="(r.coreMatches && r.coreMatches.length) || (r.secondaryMatches && r.secondaryMatches.length)"
                    class="kbi-points"
                  >
                    <div v-if="r.coreMatches && r.coreMatches.length" class="kbi-row-group">
                      <div class="kbi-row-title">语义片段</div>
                      <div class="kbi-row">
                        <span
                          v-for="(p, pi) in r.coreMatches"
                          :key="`core-${pi}`"
                          class="kbi-tag"
                        >{{ p }}</span>
                      </div>
                    </div>
                    <div v-if="r.secondaryMatches && r.secondaryMatches.length" class="kbi-row-group">
                      <div class="kbi-row-title">标签</div>
                      <div class="kbi-row">
                        <span
                          v-for="(p, pi) in r.secondaryMatches"
                          :key="`sec-${pi}`"
                          class="kbi-tag"
                        >{{ p }}</span>
                      </div>
                    </div>
                  </div>

                  <div v-if="r.desc" class="kbi-desc">{{ r.desc }}</div>
                  <div v-if="r.refExperience" class="kbi-ref">参考经验：{{ r.refExperience }}</div>
                </div>
              </template>
            </div>
          </div>

        </div>
      </transition>

      <!-- 推理结论（打字机，仅多阶段完成后出现） -->
      <div v-if="inTypewriter || finished" class="ar-conclusion ar-concl-multi">
        <span class="ar-ctext">{{ finished ? conclusion : displayedText }}</span>
        <span v-if="inTypewriter" class="ar-cursor">|</span>
      </div>

      <!-- 结论打字机播完后暂停，等待用户按空格键继续（把节拍留在"主因锁定"之后，
           而不是相似案例刚展示完就打断阅读结论的过程） -->
      <div v-if="finished && awaitingContinue" class="pause-row">
        <span class="pause-key">␣</span>
        <span class="pause-txt">按空格键继续</span>
      </div>
    </template>

    <!-- ── 旧单阶段模式 ── -->
    <template v-else>
      <transition name="slide">
        <div v-if="expanded && steps.length > 0" class="ar-steps">
          <div
            v-for="(s, i) in steps"
            :key="i"
            class="ar-step"
            :class="{ visible: i < visibleCount || finished }"
          >
            <span class="step-ic">{{ (i < visibleCount || finished) ? '✓' : '○' }}</span>
            <span class="step-txt">{{ s }}</span>
          </div>
        </div>
      </transition>

      <div class="ar-conclusion">
        <span class="ar-ctext">{{ finished ? conclusion : displayedText }}</span>
        <span v-if="playing" class="ar-cursor">|</span>
      </div>
    </template>

  </div>

  <!-- 案例详情弹窗：点击案例卡后展示 案例场景/交通问题诊断/治理方案 -->
  <Teleport to="body">
    <div
      v-if="activeCaseDetail"
      class="case-detail-overlay"
      role="dialog"
      aria-label="案例详情"
      @click.self="closeCaseDetail"
    >
      <div class="case-detail-card">
        <div class="cd-hd">
          <span class="cd-title">{{ activeCaseDetail.name }}</span>
          <button type="button" class="cd-close" @click="closeCaseDetail">×</button>
        </div>
        <div class="cd-section">
          <div class="cd-label">案例场景</div>
          <div class="cd-body">{{ activeCaseDetail.scene }}</div>
        </div>
        <div class="cd-section">
          <div class="cd-label">交通问题诊断</div>
          <div class="cd-body">{{ activeCaseDetail.diagnosis }}</div>
        </div>
        <div class="cd-section">
          <div class="cd-label">治理方案</div>
          <div class="cd-body">{{ activeCaseDetail.solution }}</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ── 容器 ── */
.ar-wrap {
  background: rgba(0, 18, 36, 0.70);
  border-left: 2px solid rgba(0, 210, 240, 0.75);
  padding: 7px 9px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

/* ── 顶栏 ── */
.ar-header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ar-icon {
  color: #00d4f0;
  font-size: 12px;
  flex-shrink: 0;
  transition: transform 0.3s;
}
.ar-spin {
  animation: spin-pulse 1.2s ease-in-out infinite;
}
@keyframes spin-pulse {
  0%   { transform: rotate(0deg) scale(1);    opacity: 1; }
  50%  { transform: rotate(180deg) scale(1.2); opacity: 0.6; }
  100% { transform: rotate(360deg) scale(1);  opacity: 1; }
}
.ar-title {
  font-size: 10px;
  letter-spacing: 1.5px;
  color: rgba(0, 210, 240, 0.70);
  text-transform: uppercase;
  flex: 1;
}
.ar-toggle {
  background: none;
  border: 1px solid rgba(0, 210, 240, 0.45);
  color: rgba(0, 210, 240, 0.65);
  font-size: 10px;
  font-family: inherit;
  padding: 1px 7px;
  cursor: pointer;
  letter-spacing: 0.5px;
  transition: border-color 0.12s, color 0.12s;
  white-space: nowrap;
}
.ar-toggle:hover {
  border-color: rgba(0, 210, 240, 0.55);
  color: #00d4f0;
}

/* ── 旧模式：步骤列表 ── */
.ar-steps {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 5px 0 3px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  margin-bottom: 2px;
  overflow: hidden;
}
.ar-step {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  opacity: 0;
  transform: translateX(-6px);
  transition: opacity 0.25s, transform 0.25s;
}
.ar-step.visible {
  opacity: 1;
  transform: translateX(0);
}
.step-ic {
  font-size: 10px;
  color: #34d89a;
  flex-shrink: 0;
  margin-top: 1px;
  width: 10px;
  text-align: center;
}
.step-txt {
  font-size: 11px;
  color: rgba(220, 240, 255, 0.72);
  line-height: 1.5;
}

/* ── 新模式：多阶段流程 ── */
.ar-process {
  display: flex;
  flex-direction: column;
  gap: 7px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  margin-bottom: 2px;
  padding-bottom: 4px;
  overflow: hidden;
}

.ar-phase {
  border-left: 2px solid rgba(255, 255, 255, 0.25);
  padding-left: 8px;
  transition: border-color 0.3s;
}
.ph-active { border-left-color: rgba(0, 210, 240, 0.85); }
.ph-past   { border-left-color: rgba(52, 216, 154, 0.60); }

/* 阶段标题 */
.ph-hd {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 5px;
}
.ph-ic {
  font-size: 11px;
  color: rgba(0, 210, 240, 0.75);
  flex-shrink: 0;
  width: 14px;
  text-align: center;
}
.ph-name {
  flex: 1;
  font-size: 11px;
  color: rgba(220, 240, 255, 0.78);
  letter-spacing: 0.5px;
}
.ph-check {
  font-size: 10px;
  color: #34d89a;
  flex-shrink: 0;
}
.ph-active-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: #00d4f0;
  box-shadow: 0 0 5px rgba(0, 210, 240, 0.70);
  flex-shrink: 0;
  animation: blink-dot 1s step-end infinite;
}
@keyframes blink-dot {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.2; }
}

/* planning 任务清单 */
.task-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-left: 2px;
}
.task-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  opacity: 0;
  transform: translateX(-5px);
  transition: opacity 0.22s, transform 0.22s;
}
.task-item.ti-done {
  opacity: 1;
  transform: translateX(0);
}
.ti-ic {
  font-size: 10px;
  color: #34d89a;
  flex-shrink: 0;
  margin-top: 1px;
  width: 10px;
  text-align: center;
}
.ti-txt {
  font-size: 11px;
  color: rgba(220, 240, 255, 0.78);
  line-height: 1.5;
}

/* analyzing 步骤日志 */
.step-log {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-left: 2px;
}
.log-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  opacity: 0;
  transform: translateX(-5px);
  transition: opacity 0.25s, transform 0.25s;
}
.log-item.li-vis {
  opacity: 1;
  transform: translateX(0);
}
.li-ic {
  font-size: 10px;
  color: rgba(0, 210, 240, 0.80);
  flex-shrink: 0;
  margin-top: 1px;
  width: 10px;
  text-align: center;
}
.li-txt {
  font-size: 11px;
  color: rgba(220, 240, 255, 0.72);
  line-height: 1.5;
}

/* visualization 地图可视化停顿 */
.viz-block {
  padding-left: 2px;
}
.viz-active-row {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 5px;
}
.viz-pulse-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #00d4f0;
  box-shadow: 0 0 6px rgba(0, 210, 240, 0.80);
  flex-shrink: 0;
  animation: blink-dot 0.9s step-end infinite;
}
.viz-label {
  font-size: 11px;
  color: rgba(0, 210, 240, 0.85);
  letter-spacing: 0.3px;
}
.viz-progress-bar {
  height: 3px;
  background: rgba(255, 255, 255, 0.10);
  border-radius: 2px;
  overflow: hidden;
}
.viz-progress-fill {
  width: 30%;
  height: 100%;
  background: linear-gradient(90deg, transparent, #00d4f0 50%, transparent);
  animation: scan-sweep 1.6s ease-in-out infinite;
}
.viz-done-row {
  display: flex;
  align-items: center;
  gap: 5px;
}
.viz-done-ic {
  font-size: 10px;
  color: #34d89a;
  flex-shrink: 0;
}
.viz-done-txt {
  font-size: 11px;
  color: rgba(220, 240, 255, 0.50);
}

/* searching 扫描 + 结果 */
.search-block {
  padding-left: 2px;
}

.scan-row {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 5px;
}
.scan-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: #00d4f0;
  box-shadow: 0 0 5px rgba(0, 210, 240, 0.70);
  flex-shrink: 0;
  animation: blink-dot 0.8s step-end infinite;
}
.scan-txt {
  font-size: 11px;
  color: rgba(0, 210, 240, 0.80);
  white-space: nowrap;
  flex-shrink: 0;
}
.scan-bar {
  flex: 1;
  height: 3px;
  background: rgba(255, 255, 255, 0.10);
  border-radius: 2px;
  overflow: hidden;
}
.scan-fill {
  width: 35%;
  height: 100%;
  background: linear-gradient(90deg, transparent, #00d4f0 50%, transparent);
  animation: scan-sweep 1.3s ease-in-out infinite;
}
@keyframes scan-sweep {
  0%   { transform: translateX(-200%); }
  100% { transform: translateX(500%); }
}

.kb-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 5px;
}
.kb-count {
  font-size: 10px;
  color: rgba(220, 240, 255, 0.55);
  letter-spacing: 0.5px;
}
.kb-query {
  font-size: 10px;
  color: rgba(0, 210, 240, 0.55);
  letter-spacing: 0.3px;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kb-item {
  margin-bottom: 6px;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 0.28s, transform 0.28s;
}
.kb-item.kbi-vis {
  opacity: 1;
  transform: translateY(0);
}
.kb-item:last-child { margin-bottom: 0; }
.kbi-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2px;
  gap: 6px;
}
.kbi-rank {
  font-size: 9px;
  font-weight: bold;
  letter-spacing: 0.3px;
  color: #00161f;
  background: rgba(0, 210, 240, 0.85);
  border-radius: 3px;
  padding: 1px 5px;
  flex-shrink: 0;
}
.kbi-name {
  font-size: 11px;
  color: rgba(220, 240, 255, 0.88);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
  margin-right: 6px;
}
.kbi-match {
  font-size: 12px;
  font-weight: bold;
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.92);
}

/* 匹配点：语义片段 / 标签两行；各行固定一行，放不下就少显示 */
.kbi-points {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 4px 0;
}
.kbi-row-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.kbi-row-title {
  font-size: 9px;
  letter-spacing: 0.4px;
  color: rgba(220, 240, 255, 0.42);
  line-height: 1.2;
}
.kbi-row {
  display: flex;
  flex-wrap: nowrap;
  gap: 4px;
  overflow: hidden;
  max-height: 1.65em;
}
.kbi-tag {
  font-size: 9.5px;
  line-height: 1.6;
  padding: 1px 6px;
  border-radius: 8px;
  white-space: nowrap;
  flex-shrink: 0;
  color: rgba(220, 240, 255, 0.60);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
}
.kbi-ref {
  font-size: 10px;
  color: rgba(52, 216, 154, 0.80);
  line-height: 1.45;
  margin-top: 2px;
}

/* 结论打字机播完后的暂停提示 */
.pause-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  padding: 4px 0;
}
.pause-key {
  font-size: 13px;
  font-weight: bold;
  color: #00161f;
  background: rgba(0, 210, 240, 0.85);
  border-radius: 3px;
  padding: 1px 8px;
  flex-shrink: 0;
  animation: blink-dot 1.1s step-end infinite;
}
.pause-txt {
  font-size: 11px;
  color: rgba(0, 210, 240, 0.85);
  letter-spacing: 0.3px;
}

/* 案例卡可点击态 */
.kbi-clickable {
  cursor: pointer;
  transition: background 0.15s;
}
.kbi-clickable:hover {
  background: rgba(0, 210, 240, 0.06);
}

/* 案例详情弹窗 */
.case-detail-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3vh 3vw;
  background: rgba(2, 8, 16, 0.78);
  backdrop-filter: blur(6px);
}
.case-detail-card {
  width: min(520px, calc(100% - 32px));
  max-height: 80vh;
  overflow-y: auto;
  padding: 18px 20px;
  border-radius: 8px;
  border: 1px solid rgba(0, 212, 240, 0.32);
  background: rgba(6, 14, 26, 0.98);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
}
.cd-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(0, 210, 240, 0.25);
}
.cd-title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(230, 245, 255, 0.95);
}
.cd-close {
  background: none;
  border: none;
  color: rgba(180, 200, 220, 0.65);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0 2px;
}
.cd-close:hover {
  color: #00d4f0;
}
.cd-section {
  margin-bottom: 12px;
}
.cd-section:last-child {
  margin-bottom: 0;
}
.cd-label {
  font-size: 11px;
  color: rgba(0, 210, 240, 0.80);
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}
.cd-body {
  font-size: 12.5px;
  color: rgba(220, 240, 255, 0.85);
  line-height: 1.65;
  white-space: pre-wrap;
}
.kbi-track {
  height: 4px;
  background: rgba(255, 255, 255, 0.10);
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 3px;
}
.kbi-bar {
  height: 100%;
  border-radius: 2px;
  background: #000;
  transition: width 0.4s ease;
}
.kbi-desc {
  font-size: 10px;
  color: rgba(220, 240, 255, 0.52);
  line-height: 1.45;
}

/* ── 推理结论（演示大屏：字号偏大，便于领导席阅读） ── */
.ar-conclusion {
  font-size: 16px;
  color: rgba(235, 248, 255, 0.96);
  line-height: 1.65;
  min-height: 24px;
  font-weight: 500;
}
.ar-concl-multi {
  min-height: 0;
  padding-top: 3px;
  border-top: 1px solid rgba(0, 210, 240, 0.35);
  margin-top: 2px;
}
.ar-ctext { word-break: break-word; }
.ar-cursor {
  display: inline-block;
  color: #00d4f0;
  font-weight: bold;
  animation: blink-cursor 0.7s step-end infinite;
  margin-left: 1px;
}
@keyframes blink-cursor {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0; }
}

/* ── 过渡动画 ── */
.slide-enter-active,
.slide-leave-active {
  transition: max-height 0.28s ease, opacity 0.28s;
  max-height: 600px;
}
.slide-enter-from,
.slide-leave-to {
  max-height: 0;
  opacity: 0;
}
</style>

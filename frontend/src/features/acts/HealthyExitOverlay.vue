<script setup>
/**
 * 健康场景收尾：诊断判定非问题路口后，解释依据并允许返回主页。
 */
import { computed } from 'vue';
import { getAgentSnapshot, isDiagnosisHealthy } from '../../services/runtimeFixture.js';
import { getDiagnosisTicket, getOverflowMetrics } from '../../services/caseFixture.js';
import { returnToHome } from '../../shared/plan-feedback.js';
import { narrativeState } from '../../shared/narrative-state.js';
import { applyDisplayNameAlias } from '../../utils/userFacingCopy.js';

const visible = computed(() => (
  narrativeState.act === 3
  && isDiagnosisHealthy()
  && (narrativeState.overflow?.healthy_exit === true)
));

const title = computed(() => '核验结论：当前非问题路口');

const detail = computed(() => {
  const snap = getAgentSnapshot() || {};
  const ticket = getDiagnosisTicket() || snap.diagnosis_ticket || {};
  const metrics = getOverflowMetrics() || {};
  const diagnosis = snap.phases?.diagnosis || {};
  const ov = diagnosis.overflow_verification || {};
  const name = applyDisplayNameAlias(ticket.intersection_name || '目标路口');
  const dir = ticket.direction || '';
  const mov = ticket.movement || '';
  const flow = [dir, mov].filter(Boolean).join('') || '目标进口';
  const q = metrics.queue_length_m;
  const s = metrics.storage_length_m;
  const r = metrics.queue_ratio;
  const msg = ov.message || '排队尚在进口道可容纳范围内，溢出风险较低';
  return applyDisplayNameAlias(
    `${name} ${flow} 经指标核验，未构成需治理的溢出问题。` +
    `${msg}` +
    `（排队 ${q ?? '—'} m / 蓄车 ${s ?? '—'} m / 排队比 ${r ?? '—'}）。` +
    `流水线已提前结束，不再进入成因、策略与方案生成。`,
  );
});

function goHome() {
  returnToHome('本路口无明显问题，已返回主页。');
}
</script>

<template>
  <Teleport to="body">
    <transition name="healthy-fade">
      <div v-if="visible" class="healthy-layer">
        <div class="healthy-card">
          <div class="eyebrow">诊断收尾 · 健康场景</div>
          <h2>{{ title }}</h2>
          <p class="detail">{{ detail }}</p>
          <p class="hint">若现场仍有感知问题，可补充时段/进口/问题类型后重新诊断。</p>
          <button type="button" class="home-btn" @click="goHome">返回主页</button>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.healthy-layer {
  position: fixed;
  inset: 0;
  z-index: 95;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(2, 10, 18, 0.72);
  backdrop-filter: blur(5px);
  pointer-events: auto;
}
.healthy-card {
  width: min(520px, calc(100vw - 48px));
  padding: 22px 20px 18px;
  border: 1px solid rgba(0, 212, 240, 0.35);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(8, 22, 36, 0.97), rgba(4, 14, 24, 0.96));
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
}
.eyebrow {
  font-size: 10px;
  letter-spacing: 2px;
  color: rgba(110, 230, 200, 0.9);
  margin-bottom: 8px;
}
h2 {
  margin: 0 0 12px;
  font-size: 17px;
  color: rgba(230, 245, 255, 0.95);
  font-weight: 600;
}
.detail {
  margin: 0 0 10px;
  font-size: 13px;
  line-height: 1.7;
  color: rgba(200, 220, 235, 0.88);
}
.hint {
  margin: 0 0 16px;
  font-size: 11px;
  line-height: 1.55;
  color: rgba(160, 185, 205, 0.6);
}
.home-btn {
  border: 1px solid rgba(0, 212, 240, 0.45);
  background: rgba(0, 180, 200, 0.18);
  color: #7ee8f5;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}
.home-btn:hover {
  background: rgba(0, 200, 220, 0.28);
}
.healthy-fade-enter-active,
.healthy-fade-leave-active {
  transition: opacity 0.28s ease;
}
.healthy-fade-enter-from,
.healthy-fade-leave-to {
  opacity: 0;
}
</style>

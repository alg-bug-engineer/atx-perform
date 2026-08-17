<script setup>
/**
 * 幕 0 交通诊断入口，交互对齐 agent-loop DiagnosisInput：
 * 底栏按钮 → 居中输入卡 → 发送后下沉，交棒进入问题定位。
 */
import { ref, computed, watch } from 'vue';
import {
  DEFAULT_DEMO_QUERY,
  listLineDemoCases,
  listPointDemoCases,
  optTypeLabel,
} from '../../services/demoCases.js';
import { applyDisplayNameAlias } from '../../utils/userFacingCopy.js';
import { diagnosisQuickPrompt } from './diagnosisQuickStart.js';

const emit = defineEmits(['submit']);

const text = ref('');
const sinking = ref(false);
const sunk = ref(false);
const minimized = ref(true);

const canSubmit = computed(() => text.value.trim().length > 0 && !sinking.value && !sunk.value);
const showCenter = computed(() => !sunk.value && !minimized.value);
const showLauncher = computed(() => !sunk.value && !sinking.value && minimized.value);
const placeholderQuery = computed(() => applyDisplayNameAlias(DEFAULT_DEMO_QUERY));
const pointCases = computed(() => listPointDemoCases());
const lineCases = computed(() => listLineDemoCases());

function openPanel() {
  minimized.value = false;
}

function minimizePanel() {
  if (sinking.value || sunk.value) return;
  minimized.value = true;
}

function submit() {
  if (!canSubmit.value) return;
  const prompt = text.value.trim();
  sinking.value = true;
  emit('submit', prompt);
  setTimeout(() => {
    sinking.value = false;
    sunk.value = true;
  }, 720);
}

function applyCaseAndSend(demoCase) {
  if (sinking.value || sunk.value || !demoCase?.query) return;
  text.value = demoCase.query;
  submit();
}

function onKeydown(e) {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    submit();
  }
}

watch(diagnosisQuickPrompt, (req) => {
  if (!req?.prompt || sinking.value || sunk.value) return;
  minimized.value = false;
  text.value = req.prompt;
  requestAnimationFrame(() => {
    if (!sinking.value && !sunk.value) submit();
  });
});
</script>

<template>
  <Teleport to="body">
    <transition name="launcher-fade">
      <button
        v-if="showLauncher"
        type="button"
        class="diag-launcher"
        @click="openPanel"
      >
        交通诊断
      </button>
    </transition>

    <transition name="input-fade">
      <div
        v-if="showCenter || sinking"
        class="diag-input-layer"
        :class="{ sinking }"
      >
        <div class="diag-input-card" :class="{ sinking }">
          <div class="card-header">
            <div class="card-eyebrow">交通诊断</div>
            <button
              type="button"
              class="minimize-btn"
              :disabled="sinking || sunk"
              title="收起"
              aria-label="收起交通诊断"
              @click="minimizePanel"
            >
              收起
            </button>
          </div>
          <div class="card-title">描述你观察到的路口问题</div>
          <textarea
            v-model="text"
            class="diag-textarea"
            rows="4"
            :disabled="sinking || sunk"
            :placeholder="`例如：${placeholderQuery}`"
            @keydown="onKeydown"
          />

          <div class="case-groups">
            <div v-if="pointCases.length" class="case-group">
              <div class="group-label">点优化</div>
              <div class="chip-row">
                <button
                  v-for="c in pointCases"
                  :key="c.id"
                  type="button"
                  class="hint-chip"
                  :disabled="sinking || sunk"
                  :title="applyDisplayNameAlias(c.query)"
                  @click="applyCaseAndSend(c)"
                >
                  <span class="chip-label">{{ optTypeLabel(c.opt_type) }} · {{ c.label }}</span>
                  <span class="chip-query">{{ applyDisplayNameAlias(c.display_name) }}</span>
                </button>
              </div>
            </div>
            <div v-if="lineCases.length" class="case-group">
              <div class="group-label">线优化</div>
              <div class="chip-row">
                <button
                  v-for="c in lineCases"
                  :key="c.id"
                  type="button"
                  class="hint-chip"
                  :disabled="sinking || sunk"
                  :title="applyDisplayNameAlias(c.query)"
                  @click="applyCaseAndSend(c)"
                >
                  <span class="chip-label">{{ optTypeLabel(c.opt_type) }} · {{ c.label }}</span>
                  <span class="chip-query">{{ applyDisplayNameAlias(c.display_name) }}</span>
                </button>
              </div>
            </div>
          </div>

          <div class="card-footer">
            <span class="hint">点击上方典型案例可直接发送 · ⌘/Ctrl + Enter</span>
            <button class="send-btn" type="button" :disabled="!canSubmit" @click="submit">
              发送
            </button>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.diag-launcher {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 110;
  pointer-events: auto;
  border: 1px solid rgba(0, 212, 240, 0.45);
  background: rgba(4, 14, 26, 0.88);
  color: #00d4f0;
  font-size: 12px;
  letter-spacing: 2px;
  padding: 10px 22px;
  cursor: pointer;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(10px);
  transition: background 0.15s, border-color 0.15s;
}

.diag-launcher:hover {
  background: rgba(0, 212, 240, 0.16);
  border-color: rgba(0, 212, 240, 0.7);
}

.diag-input-layer {
  position: fixed;
  inset: 0;
  z-index: 110;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  background: radial-gradient(ellipse at center, rgba(0, 12, 24, 0.35) 0%, transparent 62%);
  transition: opacity 0.7s ease, transform 0.7s cubic-bezier(0.4, 0, 0.2, 1);
}

.diag-input-layer.sinking {
  opacity: 0;
  transform: translateY(42vh) scale(0.86);
}

.diag-input-card {
  pointer-events: auto;
  width: min(620px, calc(100vw - 48px));
  max-height: min(86vh, 720px);
  overflow: auto;
  padding: 18px 18px 14px;
  background: rgba(4, 14, 26, 0.88);
  border: 1px solid rgba(0, 212, 240, 0.28);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(10px);
  transition: transform 0.7s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.7s ease;
}

.diag-input-card.sinking {
  transform: translateY(8px);
  opacity: 0.35;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}

.card-eyebrow {
  font-size: 10px;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: rgba(0, 212, 240, 0.72);
}

.minimize-btn {
  border: 1px solid rgba(0, 212, 240, 0.28);
  background: rgba(0, 40, 60, 0.35);
  color: rgba(0, 212, 240, 0.85);
  font-size: 10px;
  letter-spacing: 1px;
  padding: 4px 10px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s, border-color 0.15s;
}

.minimize-btn:hover:not(:disabled) {
  background: rgba(0, 80, 100, 0.4);
  border-color: rgba(0, 212, 240, 0.55);
}

.minimize-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.card-title {
  font-size: 14px;
  color: rgba(230, 245, 255, 0.92);
  margin-bottom: 12px;
  letter-spacing: 0.5px;
}

.diag-textarea {
  width: 100%;
  resize: none;
  box-sizing: border-box;
  padding: 12px;
  background: rgba(0, 20, 36, 0.72);
  border: 1px solid rgba(0, 212, 240, 0.18);
  color: rgba(220, 240, 255, 0.88);
  font-size: 12px;
  line-height: 1.65;
  font-family: 'Courier New', monospace;
  outline: none;
}

.diag-textarea:focus {
  border-color: rgba(0, 212, 240, 0.45);
}

.diag-textarea:disabled {
  opacity: 0.55;
}

.case-groups {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
}

.case-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.group-label {
  font-size: 10px;
  letter-spacing: 1.5px;
  color: rgba(0, 212, 240, 0.7);
}

.chip-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.hint-chip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  width: 100%;
  padding: 7px 10px;
  box-sizing: border-box;
  text-align: left;
  border: 1px dashed rgba(0, 212, 240, 0.35);
  background: rgba(0, 40, 60, 0.35);
  color: rgba(200, 230, 245, 0.88);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.hint-chip:hover:not(:disabled) {
  background: rgba(0, 80, 100, 0.4);
  border-color: rgba(0, 212, 240, 0.65);
}

.hint-chip:disabled {
  opacity: 0.45;
  cursor: default;
}

.chip-label {
  font-size: 10px;
  letter-spacing: 1px;
  color: rgba(0, 212, 240, 0.8);
}

.chip-query {
  font-size: 11px;
  line-height: 1.45;
  color: rgba(190, 215, 230, 0.78);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
}

.hint {
  font-size: 10px;
  color: rgba(180, 210, 230, 0.45);
  line-height: 1.4;
}

.send-btn {
  border: 1px solid rgba(0, 212, 240, 0.45);
  background: rgba(0, 212, 240, 0.12);
  color: #00d4f0;
  font-size: 11px;
  letter-spacing: 1px;
  padding: 7px 18px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  flex-shrink: 0;
}

.send-btn:hover:not(:disabled) {
  background: rgba(0, 212, 240, 0.22);
  border-color: rgba(0, 212, 240, 0.7);
}

.send-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.input-fade-enter-active,
.input-fade-leave-active,
.launcher-fade-enter-active,
.launcher-fade-leave-active {
  transition: opacity 0.35s ease;
}
.input-fade-enter-from,
.input-fade-leave-to,
.launcher-fade-enter-from,
.launcher-fade-leave-to {
  opacity: 0;
}
</style>

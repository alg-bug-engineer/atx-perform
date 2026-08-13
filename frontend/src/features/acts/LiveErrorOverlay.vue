<script setup>
/**
 * Live 模式流水线失败遮罩：阻断叙事，禁止回退 Mock fixture。
 */
import { livePipelineError } from '../../services/livePipelineError.js';
import { resetAgentRun } from '../../services/runtimeFixture.js';
import { act1Phase } from '../../shared/narrative-state.js';
import { getActCompatExports } from './act-registry.js';

function retry() {
  resetAgentRun();
  act1Phase.value = 'idle';
  // 注册表兼容导出：幕 1 模块的进入函数（重试入口）
  getActCompatExports().enterAct1?.();
}
</script>

<template>
  <Teleport to="body">
    <div v-if="livePipelineError" class="live-error-layer">
      <div class="live-error-card">
        <div class="live-error-eyebrow">Live 联调 · 推演失败</div>
        <div class="live-error-title">后端数据不可用，已阻断叙事</div>
        <p class="live-error-msg">{{ livePipelineError }}</p>
        <p class="live-error-hint">
          Live 模式（VITE_MOCK=0）严禁回退 Mock fixture。请检查后端日志与 Network，修复后重试。
        </p>
        <button type="button" class="live-error-btn" @click="retry">返回重新输入</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.live-error-layer {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(2, 8, 18, 0.82);
  backdrop-filter: blur(6px);
  pointer-events: auto;
}

.live-error-card {
  width: min(520px, calc(100vw - 48px));
  padding: 22px 20px 18px;
  background: rgba(8, 16, 28, 0.96);
  border: 1px solid rgba(255, 90, 90, 0.45);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
}

.live-error-eyebrow {
  font-size: 10px;
  letter-spacing: 2px;
  color: rgba(255, 120, 120, 0.85);
  margin-bottom: 8px;
}

.live-error-title {
  font-size: 16px;
  color: rgba(255, 230, 230, 0.95);
  margin-bottom: 12px;
}

.live-error-msg {
  font-size: 12px;
  line-height: 1.65;
  color: rgba(255, 200, 200, 0.88);
  font-family: 'Courier New', monospace;
  margin: 0 0 10px;
  word-break: break-word;
}

.live-error-hint {
  font-size: 11px;
  line-height: 1.55;
  color: rgba(180, 200, 220, 0.65);
  margin: 0 0 16px;
}

.live-error-btn {
  border: 1px solid rgba(0, 212, 240, 0.45);
  background: rgba(0, 212, 240, 0.12);
  color: #00d4f0;
  font-size: 11px;
  letter-spacing: 1px;
  padding: 8px 16px;
  cursor: pointer;
}
</style>

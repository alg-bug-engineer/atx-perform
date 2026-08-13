/**
 * Live 模式（VITE_MOCK=0）专用：流水线失败态。
 * 严禁回退 Mock fixture / Case A 硬编码；失败即阻断并上屏错误。
 */
import { ref } from 'vue';
import { isLiveApiMode } from './api/endpoints.js';

export const livePipelineError = ref('');

export class LivePipelineError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'LivePipelineError';
  }
}

/** @param {string} message */
export function failLivePipeline(message) {
  const msg = (message || 'Live 推演失败').trim();
  livePipelineError.value = msg;
  throw new LivePipelineError(msg);
}

export function clearLivePipelineError() {
  livePipelineError.value = '';
}

export function hasLivePipelineError() {
  return Boolean(livePipelineError.value);
}

export function isLiveStrictMode() {
  return isLiveApiMode();
}

/**
 * Live 推演后强制要求切片存在；Mock 模式 no-op。
 * @param {unknown} slice
 * @param {string} label
 */
export function requireLiveSlice(slice, label) {
  if (!isLiveStrictMode()) return;
  if (!slice) {
    failLivePipeline(`Live 模式缺少「${label}」数据，禁止回退 Mock fixture`);
  }
}

/**
 * Live 下要求对象内必填字段存在且非空；缺一即报错，禁止默认值伪装。
 * @param {Record<string, unknown>|null|undefined} obj
 * @param {string[]} fields
 * @param {string} label
 */
export function requireLiveFields(obj, fields, label) {
  if (!isLiveStrictMode()) return;
  if (!obj || typeof obj !== 'object') {
    failLivePipeline(`Live 模式缺少「${label}」对象`);
  }
  const missing = [];
  for (const key of fields) {
    const parts = key.split('.');
    let cur = obj;
    for (const p of parts) {
      if (cur == null || typeof cur !== 'object') {
        cur = undefined;
        break;
      }
      cur = cur[p];
    }
    if (cur == null || cur === '' || (Array.isArray(cur) && cur.length === 0)) {
      missing.push(key);
    }
  }
  if (missing.length) {
    failLivePipeline(`Live 模式「${label}」缺少必填字段：${missing.join(', ')}`);
  }
}

/** @deprecated 使用 requireLiveSlice */
export const assertLiveSlice = requireLiveSlice;

import { ref } from 'vue';

/**
 * 外部入口（如监控指标卡「立即优化」）触发诊断提交。
 * DiagnosisInput 监听后填入并发送。
 */
export const diagnosisQuickPrompt = ref(null);

export function requestDiagnosisSubmit(prompt) {
  const text = String(prompt || '').trim();
  if (!text) return;
  diagnosisQuickPrompt.value = { prompt: text, ts: Date.now() };
}

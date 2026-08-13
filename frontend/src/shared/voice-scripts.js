/**
 * 口播模板 + 词槽填充
 * 模板源：src/config/voice-scripts.json（可编辑）
 * 运行时也可通过 setVoiceScriptOverride / localStorage 覆盖单条文案。
 */

import scripts from '../config/voice-scripts.json';

const STORAGE_KEY = 'agent-loop.voice-script-overrides';

/** @type {Record<string, string>} */
let runtimeOverrides = loadOverrides();

function loadOverrides() {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function persistOverrides() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(runtimeOverrides));
  } catch {
    /* ignore quota */
  }
}

/**
 * 读取模板原文（不含填充）
 * @param {string} key
 * @returns {string|null}
 */
export function getVoiceTemplate(key) {
  if (!key) return null;
  if (runtimeOverrides[key]) return runtimeOverrides[key];
  const fromFile = scripts[key];
  return typeof fromFile === 'string' ? fromFile : null;
}

/**
 * 运行时覆盖 / 编辑单条模板（写入 localStorage，刷新仍生效）
 * @param {string} key
 * @param {string} template
 */
export function setVoiceScriptOverride(key, template) {
  if (!key) return;
  const text = String(template ?? '').trim();
  if (!text) {
    delete runtimeOverrides[key];
  } else {
    runtimeOverrides[key] = text;
  }
  persistOverrides();
}

/** 清除全部运行时覆盖，恢复 JSON 文件默认 */
export function clearVoiceScriptOverrides() {
  runtimeOverrides = {};
  persistOverrides();
}

/**
 * 列出全部可编辑模板（文件默认 ∪ 覆盖）
 * @returns {Record<string, string>}
 */
export function listVoiceScripts() {
  const out = {};
  for (const [k, v] of Object.entries(scripts)) {
    if (k.startsWith('_')) continue;
    if (typeof v === 'string') out[k] = runtimeOverrides[k] || v;
  }
  for (const [k, v] of Object.entries(runtimeOverrides)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/**
 * 模板中出现的词槽名（按出现顺序去重）
 * @param {string} template
 * @returns {string[]}
 */
export function listTemplateSlotNames(template) {
  const names = [];
  const seen = new Set();
  String(template || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => {
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
    return '';
  });
  return names;
}

/**
 * 词槽是否已填（非 null / 非空串）
 * @param {unknown} val
 */
export function isVoiceSlotFilled(val) {
  if (val == null) return false;
  if (typeof val === 'string') return val.trim() !== '';
  if (typeof val === 'number') return Number.isFinite(val);
  return String(val).trim() !== '';
}

/**
 * 模板内全部词槽是否就绪。无词槽 → 视为就绪（固定句可立即播）。
 * @param {string} template
 * @param {Record<string, string|number|null|undefined>} slots
 * @returns {{ ready: boolean, missing: string[] }}
 */
export function checkTemplateSlotsReady(template, slots = {}) {
  const missing = listTemplateSlotNames(template).filter((name) => !isVoiceSlotFilled(slots[name]));
  return { ready: missing.length === 0, missing };
}

/**
 * 填充 `{词槽}`；空词槽删除后清洗标点，避免「小步增绿」类缺省硬编码。
 * @param {string} template
 * @param {Record<string, string|number|null|undefined>} slots
 * @param {{ keepMissing?: boolean }} [opts]
 */
export function fillVoiceTemplate(template, slots = {}, opts = {}) {
  const keepMissing = opts.keepMissing === true;
  let text = String(template || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => {
    const val = slots[name];
    if (!isVoiceSlotFilled(val)) return keepMissing ? `{${name}}` : '';
    return String(val).trim();
  });
  text = text
    .replace(/\s{2,}/g, ' ')
    .replace(/[，、；]{2,}/g, '，')
    .replace(/([，、；])\s*([。！？])/g, '$2')
    .replace(/([：:])\s*([，、；。！？])/g, '$2')
    .replace(/([。！？])\s*[，、；]+/g, '$1')
    .replace(/^[，、；：:\s]+/, '')
    .replace(/[，、；：:\s]+$/, '')
    .replace(/。{2,}/g, '。')
    .trim();
  return text;
}

/**
 * 按 key 取模板并填充；无模板时返回 null。
 * 默认 requireFilled：任一词槽为空则返回 null（禁止「目标路口确定为。」半句）。
 * @param {string} key
 * @param {Record<string, string|number|null|undefined>} slots
 * @param {{ requireFilled?: boolean }} [opts]
 */
export function renderVoiceScript(key, slots = {}, opts = {}) {
  const tpl = getVoiceTemplate(key);
  if (!tpl) return null;
  const requireFilled = opts.requireFilled !== false;
  if (requireFilled) {
    const { ready } = checkTemplateSlotsReady(tpl, slots);
    if (!ready) return null;
  }
  const text = fillVoiceTemplate(tpl, slots);
  return text || null;
}

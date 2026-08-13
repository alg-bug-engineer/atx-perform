/**
 * 幕 1 · 问题定位 — 独立开发运行入口
 *
 * 用法：`npm run dev:act1`（或直接访问 /act1.html）
 * - 仅装配本幕模块：注册表只有「问题定位」，ActLoopShell / 地图运行时
 *   只渲染本幕，不受其他幕影响；
 * - 底图与主工程共用（TrafficOriginScene + OSM 底图 + 路网）。
 */
import { createApp } from 'vue';
import '../../../style.css';
// 副作用注册：装配本幕到注册表
import './index.js';
// 主工程壳（读取注册表渲染幕舞台）
import AppShell from '../../../app/AppShell.vue';
import { narrativeActive } from '../../../shared/narrative-state.js';

if (import.meta.env.DEV) {
  console.info('[act1-standalone] 独立运行：仅注册幕 1 · 问题定位');
}

// 独立运行：直接进入叙事幕模式（无首页城市监控）
narrativeActive.value = true;

createApp(AppShell).mount('#app');

import { createApp } from 'vue';
import './styles/base.css';
import App from './App.vue';

// 装配幕模块（副作用注册到 act-registry，供 ActLoopShell / 地图运行时消费）
import './features/acts/act-01-problem-locate/index.js';
import './features/acts/act-02-flow-trace/index.js';

createApp(App).mount('#app');

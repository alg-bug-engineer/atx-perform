<script setup>
import { computed } from 'vue';
import AnalysisDock from './AnalysisDock.vue';
import AnalysisDockLeft from './AnalysisDockLeft.vue';
import SceneViewport from './SceneViewport.vue';
import DigitalAvatar from '../../shared/components/DigitalAvatar.vue';
import ActLoopShell from '../../features/acts/ActLoopShell.vue';
import { activeAnalysisTab } from '../../shared/analysis-state.js';
import { narrativeActive } from '../../shared/narrative-state.js';

const props = defineProps({
  scenes: { type: Array, required: true },
  activeSceneKey: { type: String, required: true },
  activeSceneComponent: { type: [Object, Function], required: true },
});

defineEmits(['change-scene']);

// 不同分析 Tab 下底部允许显示的场景 key
const TAB_VISIBLE_SCENES = {
  city:         [],                                        // 全域态势：隐藏底部栏（强制 traffic-origin）
  region:       ['scene-region', 'scene-a', 'traffic-origin', 'scene-b'],  // 区域诊断
  arterial:     [],                                        // 干线诊断：待新建，暂无底部按钮
  intersection: ['scene-c'],                               // 路口诊断：显示路口诊断图层按钮
  governance:   ['scene-region'],                          // 治理方案：复用目标区域图层
};

const visibleScenes = computed(() => {
  if (narrativeActive.value) return [];
  const allowed = TAB_VISIBLE_SCENES[activeAnalysisTab.value];
  if (!allowed || allowed.length === 0) return [];
  return props.scenes.filter(s => allowed.includes(s.key));
});
</script>

<template>
  <div class="main-layout">
    <!-- 叙事 Act 模式：隐藏旧 Tab 侧栏，由 ActLoopShell 接管 UI -->
    <template v-if="!narrativeActive">
      <AnalysisDockLeft />
      <AnalysisDock />
    </template>

    <SceneViewport :scene-component="activeSceneComponent" />
    <ActLoopShell v-if="narrativeActive" />

    <!-- 左下角数字人：始终可见，点击开关口播（对齐 references/baseline） -->
    <DigitalAvatar />

    <transition name="switcher-fade">
      <div v-if="visibleScenes.length > 0" class="scene-switcher">
        <button
          v-for="scene in visibleScenes"
          :key="scene.key"
          class="scene-tab"
          :class="{ active: scene.key === activeSceneKey }"
          type="button"
          @click="$emit('change-scene', scene.key)"
        >
          {{ scene.name }}
        </button>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.main-layout {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #000;
}

.scene-switcher {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: 20px;
  z-index: 40;
  display: flex;
  gap: 6px;
  pointer-events: auto;
}

.scene-tab {
  border: 1px solid rgba(0, 229, 255, 0.28);
  background: rgba(0, 10, 18, 0.82);
  color: rgba(0, 229, 255, 0.72);
  cursor: pointer;
  font-family: 'Courier New', monospace;
  font-size: 11px;
  letter-spacing: 1px;
  padding: 6px 14px;
  transition: background 0.15s, color 0.15s;
}

.scene-tab.active,
.scene-tab:hover {
  background: rgba(0, 229, 255, 0.14);
  color: #00e5ff;
  border-color: rgba(0, 229, 255, 0.55);
}

.switcher-fade-enter-active,
.switcher-fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.switcher-fade-enter-from,
.switcher-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>

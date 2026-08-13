<script setup>
/**
 * 幕 1 · 问题定位 — 右侧推理面板（两阶段）
 * 阶段 1：问题理解（识别对象/定位路段/锁定时间/确认流向/判定问题/写入约束）
 * 阶段 2：空间定位（三路口锁定 + 主流向确认 + 问题路段确认）
 */
import { computed, ref, watch } from 'vue';
import AgentReasoning from '../../../shared/components/AgentReasoning.vue';
import { act1Phase, act2Phase } from '../../../shared/narrative-state.js';
import { CONCLUSIONS, planningItems, recognitionSteps } from './fixture.js';
import { ACT1_PLANNING_BEATS } from './actMapFx.js';
import { setAct1MapBeat } from '../../../shared/narrative-state.js';

const emit = defineEmits(['parse-done', 'locate-done']);

const mode = ref('none'); // 'none' | 'parse' | 'locate'

const phases = computed(() => {
  if (mode.value === 'parse') {
    return [{
      type: 'planning',
      title: '问题理解',
      items: planningItems(),
    }];
  }
  if (mode.value === 'locate') {
    return [{
      type: 'planning',
      title: '空间定位',
      items: recognitionSteps(),
    }];
  }
  return [];
});

const conclusion = computed(() => {
  if (mode.value === 'parse') return CONCLUSIONS.ticket;
  if (mode.value === 'locate') return CONCLUSIONS.locate;
  return '';
});

const mountKey = ref(0);

watch(act1Phase, (phase, prev) => {
  if (phase === 'parsing') {
    // 面板可能在 act1Phase 已变为 parsing 后才挂载（v-if 时机），
    // 需 immediate 捕获初始状态，避免 mode 停留在 'none' 导致推理永不启动
    if (prev !== 'parsing') {
      mountKey.value += 1;
      setAct1MapBeat('scan');
    }
    mode.value = 'parse';
  } else if (phase === 'idle') {
    mode.value = 'none';
  }
}, { immediate: true });

watch(act2Phase, (phase, prev) => {
  if (phase === 'locating') {
    // immediate 捕获挂载时已处于 locating 的情况
    if (prev !== 'locating') {
      mountKey.value += 1;
    }
    mode.value = 'locate';
  }
}, { immediate: true });

function onDone() {
  if (mode.value === 'parse') {
    setAct1MapBeat('settle');
    emit('parse-done');
  } else if (mode.value === 'locate') {
    emit('locate-done');
  }
}

function onItem(payload) {
  if (payload?.type !== 'planning' || mode.value !== 'parse') return;
  const beat = ACT1_PLANNING_BEATS[payload.itemIdx];
  if (beat) setAct1MapBeat(beat);
}
</script>

<template>
  <div class="locate-right">
    <AgentReasoning
      v-if="mode !== 'none'"
      :key="`act1-ar-${mountKey}`"
      :phases="phases"
      :conclusion="conclusion"
      :auto-collapse="false"
      :wait-broadcast-before-start="false"
      :phase-broadcast="false"
      :delay="280"
      @done="onDone"
      @item="onItem"
    />
  </div>
</template>

<style scoped>
.locate-right {
  width: 100%;
  height: auto;
}

.locate-right :deep(.ar-wrap) {
  height: auto !important;
  flex: none !important;
  min-height: 0;
  overflow: visible;
  background: rgba(6, 14, 26, 0.88);
  border: 1px solid rgba(0, 200, 230, 0.25);
  border-left: 2px solid rgba(0, 210, 240, 0.75);
  padding: 8px 9px;
}
</style>

<script setup>
/**
 * 路口配时前后对比：按公共周期归一化的阶段条，
 * 协调相位高亮，其余阶段按放行方位着色。
 */
import { computed } from 'vue'
import StageChannelization from './StageChannelization.vue'
import { offsetShiftLabel } from './signalPlanModel.js'

const props = defineProps({
  node: { type: Object, required: true },
})

/** 两条条带共用同一时间刻度，周期缩短要能一眼看出来 */
const scaleS = computed(() => Math.max(props.node.baseline.cycle_s, props.node.optimized.cycle_s))

function strip(timing, coordStageNo, scale) {
  let acc = 0
  return timing.stages.map((s) => {
    const start = acc
    acc += s.total_s
    return {
      key: `${s.stage_no}-${start}`,
      stageNo: s.stage_no,
      name: s.name,
      greenS: s.green_s,
      totalS: s.total_s,
      isCoord: s.stage_no === coordStageNo,
      leftPct: (start / scale) * 100,
      widthPct: (s.total_s / scale) * 100,
      greenPct: (s.green_s / s.total_s) * 100,
    }
  })
}

const rows = computed(() => [
  {
    key: 'baseline',
    label: '现状',
    tone: 'before',
    cycle: props.node.baseline.cycle_s,
    blocks: strip(props.node.baseline, props.node.coord_stage_no, scaleS.value),
  },
  {
    key: 'optimized',
    label: '优化后',
    tone: 'after',
    cycle: props.node.optimized.cycle_s,
    blocks: strip(props.node.optimized, props.node.coord_stage_no, scaleS.value),
  },
])

const deltas = computed(() => {
  const b = props.node.baseline
  const o = props.node.optimized
  return [
    { k: '周期', v: `${b.cycle_s} → ${o.cycle_s} s` },
    { k: '相位差', v: `${b.offset_s} → ${o.offset_s} s（${offsetShiftLabel(props.node.offset_delta_s)}）` },
    { k: '协调相位绿时', v: `${b.coord_green_s} → ${o.coord_green_s} s` },
  ]
})
</script>

<template>
  <div class="stage-compare">
    <div class="head">
      <h4>{{ node.name }}</h4>
      <span class="coord">协调相位 阶段 {{ node.coord_stage_no }}</span>
    </div>

    <ul class="deltas">
      <li v-for="d in deltas" :key="d.k">
        <span>{{ d.k }}</span>
        <strong>{{ d.v }}</strong>
      </li>
    </ul>

    <div v-for="row in rows" :key="row.key" class="row" :class="row.tone">
      <div class="row-head">
        <span class="tag">{{ row.label }}</span>
        <span class="cyc">周期 {{ row.cycle }} s</span>
        <span class="scale">刻度 {{ scaleS }} s</span>
      </div>
      <div class="bar">
        <div
          v-for="b in row.blocks"
          :key="b.key"
          class="blk"
          :class="{ coord: b.isCoord }"
          :style="{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }"
          :title="`阶段 ${b.stageNo} ${b.name} · 绿 ${b.greenS}s / 总 ${b.totalS}s`"
        >
          <span class="grn" :style="{ width: `${b.greenPct}%` }" />
          <span class="lbl">{{ b.stageNo }}</span>
        </div>
        <span v-if="row.cycle < scaleS" class="cut">−{{ scaleS - row.cycle }} s</span>
      </div>
    </div>

    <div class="chan-head">
      <span>优化后阶段渠化</span>
      <em>放行流向 / 有效绿</em>
    </div>
    <ul class="chan-grid">
      <li
        v-for="s in node.optimized.stages"
        :key="s.stage_no"
        :class="{ coord: s.stage_no === node.coord_stage_no }"
      >
        <StageChannelization class="chan" :movements="s.movements" :stage-no="s.stage_no" />
        <div class="meta">
          <span class="no">阶段 {{ s.stage_no }}</span>
          <strong class="g">{{ s.green_s }}s</strong>
        </div>
        <em class="at">{{ s.atoms.join('·') }}</em>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.stage-compare {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}
/* 只有渠化网格可伸缩滚动，其余行固定，避免整块顶破列边框 */
.stage-compare > :not(.chan-grid) {
  flex: none;
}

.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}
.coord {
  font-size: 10px;
  color: var(--text-muted);
}

.deltas {
  display: grid;
  gap: 3px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.deltas li {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 11px;
}
.deltas span {
  color: var(--text-muted);
}
.deltas strong {
  font-weight: 500;
  color: var(--text);
}

.row-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
}
.tag {
  font-size: 10px;
  letter-spacing: 1px;
  padding: 1px 7px;
  border: 1px solid var(--cyan-border);
  color: var(--text-muted);
}
.row.after .tag {
  border-color: rgba(51, 204, 136, 0.55);
  color: var(--ok);
}
.cyc {
  font-size: 10px;
  color: var(--text-muted);
}
.scale {
  margin-left: auto;
  font-size: 9px;
  color: rgba(160, 200, 220, 0.4);
}

.bar {
  position: relative;
  height: 22px;
  border: 1px solid var(--cyan-border);
  border-style: solid dashed solid solid;
  background: rgba(255, 68, 68, 0.1);
}
.blk {
  position: absolute;
  top: 0;
  bottom: 0;
  border-right: 1px solid rgba(4, 12, 30, 0.9);
  overflow: hidden;
}
.blk .grn {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: rgba(51, 204, 136, 0.4);
}
.blk.coord .grn {
  background: rgba(0, 229, 255, 0.55);
}
.blk .lbl {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 9px;
  color: var(--text);
}
.blk.coord .lbl {
  color: #041020;
  font-weight: 700;
}
.cut {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 9px;
  color: var(--ok);
}

.chan-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-top: 2px;
  font-size: 10px;
  letter-spacing: 1px;
  color: var(--text-muted);
}
.chan-head em {
  font-style: normal;
  color: rgba(160, 200, 220, 0.5);
}

.chan-grid {
  display: grid;
  /* 固定 4 列：路口最多 8 个阶段，两行即可铺完，图幅也够大 */
  grid-template-columns: repeat(4, minmax(0, 1fr));
  align-content: start;
  gap: 8px;
  margin: 0;
  padding: 2px 2px 0 0;
  list-style: none;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--cyan-border-strong) transparent;
}
.chan-grid li {
  display: grid;
  grid-template-rows: auto auto auto;
  gap: 1px;
  padding: 4px;
  border: 1px solid var(--cyan-border);
  background: rgba(0, 22, 38, 0.45);
}
.chan-grid li.coord {
  border-color: var(--cyan-border-strong);
  background: rgba(0, 229, 255, 0.07);
}
.chan-grid .chan {
  width: 100%;
  height: auto;
}
.chan-grid .meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px;
}
.chan-grid .no {
  font-size: 9px;
  color: var(--text-muted);
}
.chan-grid li.coord .no {
  color: var(--text);
}
.chan-grid .g {
  font-size: 9px;
  font-weight: 600;
  color: var(--ok);
}
.chan-grid .at {
  font-style: normal;
  font-size: 8.5px;
  line-height: 1.3;
  color: rgba(160, 200, 220, 0.55);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

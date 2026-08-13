<script setup>
import { computed, ref } from 'vue'
import StageChannelization from './StageChannelization.vue'
import { buildSignalBoard } from './signalPlanBoard.js'

const props = defineProps({
  payload: { type: Object, required: true },
})

const board = computed(() => buildSignalBoard(props.payload))
const activeKey = ref('jiefang')
const active = computed(
  () => board.value?.intersections.find((i) => i.key === activeKey.value) || board.value?.intersections[0],
)

function pct(v) {
  return `${(v / board.value.cycleLen) * 100}%`
}
function deltaText(d) {
  if (!d) return '±0s'
  return d > 0 ? `+${d}s` : `${d}s`
}
function deltaTone(d) {
  if (!d) return 'flat'
  return d > 0 ? 'up' : 'down'
}
function movementNames(stage) {
  if (!stage.movements.length) return '无机动车放行'
  return stage.movements.map((m) => m.label).join('、')
}
</script>

<template>
  <section v-if="board" class="board" data-testid="signal-plan-board">
    <header class="board-hd">
      <h3>信控方案调节</h3>
      <div class="tabs">
        <button
          v-for="i in board.intersections"
          :key="i.key"
          type="button"
          class="tab"
          :class="{ on: i.key === activeKey }"
          @click="activeKey = i.key"
        >
          {{ i.inter_name.replace('奥体西路与', '') }}
          <small>{{ i.role }}</small>
        </button>
      </div>
      <div class="hd-chips">
        <span class="chip">周期 {{ active.cycle_len_sec }} s</span>
        <span class="chip">方案 #{{ active.plan_no }}</span>
        <span class="chip" :class="active.offset_delta_s ? 'change' : ''">
          相位差 {{ active.offset_before_s }} s → {{ active.offset_after_s }} s
          <b v-if="active.offset_delta_s">{{ deltaText(active.offset_delta_s) }}</b>
        </span>
      </div>
    </header>

    <div class="coord">
      <div class="coord-hd">
        <span class="coord-title">协调时序 · 以{{ board.greenWindowLabel }}启动为零点</span>
        <span class="legend"><i class="sw green" />绿灯窗内汇入 · 跟着队列走</span>
        <span class="legend"><i class="sw red" />红灯期汇入 · 直接压队尾</span>
        <span class="coord-note">{{ active.note }}</span>
      </div>
      <div class="coord-body">
        <div class="band-layer">
          <div
            class="band green"
            :style="{ left: pct(board.windows.green.start), width: pct(board.windows.green.width) }"
          />
        </div>
        <div v-for="lane in board.lanes" :key="lane.key" class="lane" :class="`tone-${lane.tone}`">
          <span class="lane-title">{{ lane.title }}</span>
          <div class="lane-track">
            <div
              v-for="b in lane.blocks"
              :key="b.id"
              class="blk"
              :class="`zone-${b.zone}`"
              :style="{ left: pct(b.start), width: pct(b.width) }"
              :title="`${b.label} · 绿灯 ${b.greenSec}s`"
            >
              <span v-if="b.feeds && b.width > 16">{{ b.movements.map((m) => m.label).join('') }}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="axis">
        <span v-for="t in [0, 44, 88, 132, 176, 220]" :key="t" :style="{ left: pct(t) }">{{ t }}s</span>
      </div>
    </div>

    <div class="cards">
      <article
        v-for="s in active.stages"
        :key="s.stage_no"
        class="card"
        :class="{ feeds: s.feeds_problem_link, changed: s.green_delta_s !== 0 }"
      >
        <div class="card-hd">
          <span class="card-seq">阶段 {{ s.stage_seq_no }}</span>
          <span class="card-role">{{ s.role }}</span>
        </div>
        <div class="card-top">
          <StageChannelization class="diagram" :movements="s.movements" />
          <div class="card-info">
            <span class="card-k">绿灯</span>
            <div class="card-num">
              <s>{{ s.green_before_s }}s</s>
              <strong>{{ s.green_after_s }}s</strong>
              <em :class="deltaTone(s.green_delta_s)">{{ deltaText(s.green_delta_s) }}</em>
            </div>
            <p class="card-mv">{{ movementNames(s) }}</p>
            <p class="card-cons">最小/最大绿 {{ s.min_green_sec }} / {{ s.max_green_sec }} s</p>
            <p class="card-cons">阶段饱和度 —</p>
          </div>
        </div>
        <p class="card-note">{{ s.note || '维持现状配时' }}</p>
      </article>
    </div>

    <p class="board-ft">
      {{ board.coordTargetNote }}。现状配时取自信号机方案库（阶段绿时、最小/最大绿、相位放行关系）；{{ board.optimizedNote }}。
    </p>
  </section>
</template>

<style scoped>
.board {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  padding: 10px 12px;
  border: 1px solid var(--cyan-border);
  border-radius: 4px;
  background: rgba(2, 10, 24, 0.6);
}

.board-hd {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 2px;
  color: var(--cyan);
}
.tabs { display: flex; gap: 6px; }
.tab {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 4px 12px;
  border: 1px solid var(--cyan-border);
  border-radius: 2px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}
.tab small { font-size: 10px; opacity: 0.7; }
.tab.on {
  border-color: var(--cyan-border-strong);
  background: rgba(0, 229, 255, 0.12);
  color: var(--cyan);
}
.hd-chips { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; }
.chip {
  padding: 4px 10px;
  font-size: 11px;
  border: 1px solid var(--cyan-border);
  border-radius: 2px;
  color: var(--text-muted);
  background: rgba(0, 20, 34, 0.5);
}
.chip.change { border-color: rgba(51, 204, 136, 0.5); color: var(--ok); }
.chip b { font-weight: 500; margin-left: 5px; }

.coord { display: flex; flex-direction: column; gap: 5px; }
.coord-hd { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
.coord-title { font-size: 11px; color: var(--cyan-dim); letter-spacing: 1px; }
.coord-note { font-size: 11px; color: var(--text-muted); }
.coord-body { position: relative; display: flex; flex-direction: column; gap: 3px; }
.band-layer { position: absolute; inset: 0 0 0 140px; pointer-events: none; }
.band { position: absolute; top: 0; bottom: 0; }
.band.green {
  border-left: 1px dashed rgba(51, 204, 136, 0.6);
  border-right: 1px dashed rgba(51, 204, 136, 0.6);
  background: rgba(51, 204, 136, 0.12);
}
.legend { display: inline-flex; align-items: center; gap: 5px; font-size: 10px; color: var(--text-muted); }
.sw { width: 16px; height: 8px; border-radius: 1px; }
.sw.green { background: rgba(51, 204, 136, 0.65); }
.sw.red { background: rgba(255, 176, 32, 0.75); }
.lane { display: grid; grid-template-columns: 132px 1fr; align-items: center; gap: 8px; }
.lane-title { font-size: 11px; color: var(--text-muted); text-align: right; }
.lane-track {
  position: relative;
  height: 14px;
  border: 1px solid rgba(0, 229, 255, 0.16);
  background: rgba(0, 20, 34, 0.5);
}
.blk {
  position: absolute;
  top: 1px;
  bottom: 1px;
  border-right: 1px solid rgba(4, 12, 30, 0.9);
  background: rgba(0, 229, 255, 0.16);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font-size: 9px;
  white-space: nowrap;
  color: rgba(4, 16, 32, 0.9);
}
.blk.zone-none { background: rgba(160, 200, 220, 0.14); }
.tone-ref .blk.zone-none { background: rgba(0, 229, 255, 0.14); }
.blk.zone-green { background: rgba(51, 204, 136, 0.85); }
.blk.zone-red { background: rgba(255, 176, 32, 0.85); }

.axis { position: relative; height: 11px; margin-left: 140px; }
.axis span {
  position: absolute;
  transform: translateX(-50%);
  font-size: 10px;
  color: rgba(160, 200, 220, 0.5);
}

.cards {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: 8px;
  min-height: 0;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px 9px;
  border: 1px solid var(--cyan-border);
  border-radius: 3px;
  background: rgba(0, 20, 34, 0.5);
  min-width: 0;
}
.card.feeds { border-color: rgba(51, 204, 136, 0.45); }
.card.changed { background: rgba(51, 204, 136, 0.07); }
.card-hd {
  display: flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
  padding-bottom: 5px;
  border-bottom: 1px solid rgba(0, 229, 255, 0.12);
}
.card-seq { font-size: 10px; color: var(--cyan-dim); letter-spacing: 1px; flex: none; }
.card-role {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card.feeds .card-role { color: var(--ok); }
.card-top { display: flex; gap: 11px; align-items: flex-start; }
.card-info { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.card-k { font-size: 10px; color: var(--text-muted); }
.card-num { display: flex; align-items: baseline; gap: 5px; margin-bottom: 3px; }
.card-num s { font-size: 12px; color: rgba(160, 200, 220, 0.45); }
.card-num strong { font-size: 23px; font-weight: 500; color: var(--cyan); line-height: 1; }
.card.changed .card-num strong { color: var(--ok); }
.card-num em { font-size: 11px; font-style: normal; }
.card-num em.flat { color: rgba(160, 200, 220, 0.45); }
.card-num em.down { color: var(--warn); }
.card-num em.up { color: var(--ok); }

.diagram { width: 74px; height: 74px; flex: none; }

.card-mv { margin: 0 0 2px; font-size: 12px; color: var(--text); }
.card-cons { margin: 0; font-size: 10px; color: rgba(160, 200, 220, 0.5); line-height: 1.3; }
.card-note {
  margin: 0;
  font-size: 10px;
  line-height: 1.3;
  color: rgba(160, 200, 220, 0.5);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.card.changed .card-note { color: rgba(120, 220, 180, 0.72); }

.board-ft {
  margin: 0;
  font-size: 10px;
  line-height: 1.3;
  color: rgba(160, 200, 220, 0.4);
}
</style>
